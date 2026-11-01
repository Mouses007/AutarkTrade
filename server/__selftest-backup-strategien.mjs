/**
 * Selbsttest: Rücksicherung und Strategie-Positionen gegen eine Wegwerf-SQLite.
 *
 *   node server/__selftest-backup-strategien.mjs
 *
 * Export und Import laufen echt (`setupBackupRoutes`), ebenso Schliessen und
 * Not-Aus (`setupStrategyRoutes`) — ohne HTTP, über dieselbe App-Attrappe wie
 * `__selftest-strategie-api.mjs`. Kein Netz, kein Port, Marktdaten aus.
 *
 * Abgedeckt (Audit 4.3.4):
 *   - FUN-L3-001: `strategy_positions` steht im Backup; eine nach dem Backup
 *     eröffnete Position wird beim Import verworfen und gemeldet.
 *   - FUN-L3-002: ein Backup im alten Format (ohne Positionen) lässt eine
 *     offene Position ohne Instanz zurück — der Import meldet sie, Schliessen
 *     antwortet 409 statt 500, Ausbuchen entfernt sie, der Not-Aus nennt sie
 *     als fehlgeschlagen; keine neue Instanz erbt die Nummer einer Waise; ein
 *     Backup mit altem `strategienStand` wird sofort nachmigriert.
 *   - Nachbesserung: Waisen im Altstatus 'closing'/'pending' erscheinen in
 *     der Liste und lassen sich ausbuchen; nach einer Rücksicherung in eine
 *     frische DB schliesst eine zurückgespielte Position kein fremdes Setup
 *     (Bezug gelöst, Setup-Zähler über die Nummern der Trades gehoben).
 * Gegenprobe gemacht: mit dem Stand vor den Fixes schlagen alle Gruppen fehl.
 */

process.env.AT_DB_FILE = ':memory:'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const log = console.log
console.log = () => {}                // Migrationsmeldungen beim Anlegen der DB
const { initDb } = await import('./database.js')
const knex = await initDb()
console.log = log
await knex('settings').where('id', 1).update({ marktdatenQuelle: 'aus' })
const { setupStrategyRoutes } = await import('./strategy-api.js')
const { setupBackupRoutes, baueExport } = await import('./backup-api.js')
const { stopStrategyEngine } = await import('./strategy-engine.js')

// ── App-Attrappe: Routen merken, ohne Server aufrufen ────────────────────
const routen = []
const app = {}
for (const m of ['get', 'post', 'put', 'delete']) {
    app[m] = (pfad, ...handler) => routen.push({ m, pfad, handler: handler[handler.length - 1] })
}
setupStrategyRoutes(app)
setupBackupRoutes(app)
async function rufe(m, pfad, body = {}) {
    for (const r of routen) {
        if (r.m !== m) continue
        const teile = r.pfad.split('/'), ist = pfad.split('/')
        if (teile.length !== ist.length) continue
        const params = {}
        if (!teile.every((t, i) => (t.startsWith(':') ? ((params[t.slice(1)] = ist[i]), true) : t === ist[i]))) continue
        return new Promise((fertig) => {
            const res = {
                statusCode: 200,
                status(c) { this.statusCode = c; return this },
                json(d) { fertig({ s: this.statusCode, d }) },
                send(d) { fertig({ s: this.statusCode, d }) },
                setHeader() {}, on() {},
            }
            Promise.resolve(r.handler({ params, query: {}, body, headers: {} }, res)).catch((e) => fertig({ s: 599, d: e.message }))
        })
    }
    throw new Error(`keine Route ${m} ${pfad}`)
}
const leise = async (f) => { const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await f() } finally { console.log = log; console.warn = w } }

const instanz = async (name, sym) => {
    const r = await rufe('post', '/api/strategies/instances',
        { strategyId: 'lsob', name, timeframe: '1h', symbols: [sym], mode: 'paper', market: 'futures' })
    return r.d.id
}
let coid = 0
const offenePosition = (instanceId, symbol) => knex('strategy_positions').insert({
    instanceId, mode: 'paper', broker: 'binance', symbol, timeframe: '1h', direction: 'short',
    qty: 1, entryPrice: 100, entryTime: Date.now() - 1800e3, stopLoss: 110, initialStopLoss: 110, takeProfit: 80,
    notionalUsdt: 100, marginUsdt: 100, clientOrderId: `test-${++coid}`, status: 'open',
})
const offen = () => knex('strategy_positions').whereIn('status', ['open', 'closing']).select('id', 'instanceId')

console.log('\nRücksicherung und Strategie-Positionen')

// ── FUN-L3-001: Positionen im Backup ─────────────────────────────────────
const a = await instanz('A', 'BTCUSDT')
await offenePosition(a, 'BTCUSDT')
const backup = await baueExport()
pruefe('das Backup enthält strategy_positions', Array.isArray(backup.tables.strategy_positions)
    && backup.tables.strategy_positions.length === 1, Object.keys(backup.tables).filter((t) => t.startsWith('strategy')).join(','))
{
    const b = await instanz('B-neu', 'XRPUSDT')
    await offenePosition(b, 'XRPUSDT')
    const imp = await leise(() => rufe('post', '/api/db-import', structuredClone(backup)))
    const jetzt = await offen()
    pruefe('Import: die Position aus dem Backup steht wieder offen, die spätere ist weg',
        imp.s === 200 && jetzt.length === 1 && jetzt[0].instanceId === a, JSON.stringify({ s: imp.s, jetzt }))
    pruefe('Import: die verworfene offene Position wird gemeldet',
        Object.entries(imp.d.imported || {}).some(([k, v]) => /verworfen/.test(k) && v === 1), JSON.stringify(imp.d.imported))
}

// ── FUN-L3-002: Backup im alten Format → Waise ───────────────────────────
{
    const alt = structuredClone(backup)
    delete alt.tables.strategy_positions
    const c = await instanz('C-neu', 'SOLUSDT')
    await offenePosition(c, 'SOLUSDT')
    const imp = await leise(() => rufe('post', '/api/db-import', alt))
    const waise = (await offen()).find((p) => p.instanceId === c)
    pruefe('alter Import: die offene Position ohne Instanz bleibt sichtbar und wird gemeldet',
        imp.s === 200 && waise && Object.entries(imp.d.imported || {}).some(([k, v]) => /ohne Instanz/.test(k) && v === 1),
        JSON.stringify(imp.d.imported))
    const z = await rufe('post', `/api/strategies/positions/${waise.id}/close`, {})
    pruefe('Schliessen einer Waise: 409 mit ohneInstanz statt 500', z.s === 409 && z.d.ohneInstanz === true, JSON.stringify(z))
    const k = await rufe('post', '/api/strategies/kill-switch', { closePositions: true })
    pruefe('Not-Aus nennt die Waise als fehlgeschlagen (instanz_fehlt)',
        k.d.fehlgeschlagen?.some((f) => f.id === waise.id && f.grund === 'instanz_fehlt'), JSON.stringify(k.d))
    const aus = await rufe('post', `/api/strategies/positions/${waise.id}/close`, { ausbuchen: true })
    const zeile = await knex('strategy_positions').where('id', waise.id).first()
    pruefe('Ausbuchen schliesst die Waise ohne Trade',
        aus.s === 200 && aus.d.ausgebucht === true && zeile.status === 'closed'
        && (await knex('strategy_trades').where('positionId', waise.id)).length === 0, JSON.stringify(aus))
    const nochmal = await rufe('post', `/api/strategies/positions/${waise.id}/close`, { ausbuchen: true })
    pruefe('zweites Ausbuchen: 409', nochmal.s === 409)
    await knex('settings').where('id', 1).update({ strategyKillSwitch: 0 })
}

// ── Keine neue Instanz erbt die Nummer einer Waise ───────────────────────
{
    const mitWaise = structuredClone(backup)
    mitWaise.tables.strategy_positions.push({ ...mitWaise.tables.strategy_positions[0], id: 999, instanceId: 50, clientOrderId: 'waise-50' })
    await leise(() => rufe('post', '/api/db-import', mitWaise))
    const neu = await instanz('nach Waise', 'ETHUSDT')
    pruefe('eine neue Instanz bekommt eine Nummer über der Waise (50)', neu > 50, `neu = ${neu}`)
}

// ── Waisen im Altstatus 'closing'/'pending' lassen sich ausbuchen ────────
for (const st of ['closing', 'pending']) {
    const [w] = await knex('strategy_positions').insert({
        instanceId: 777, mode: 'paper', broker: 'binance', symbol: 'SOLUSDT', timeframe: '1h', direction: 'long',
        qty: 1, entryPrice: 100, entryTime: Date.now(), stopLoss: 90, initialStopLoss: 90, takeProfit: 120,
        notionalUsdt: 100, marginUsdt: 100, clientOrderId: `alt-${st}`, status: st,
    }).returning('id')
    const id = typeof w === 'object' ? w.id : w
    const zw = await leise(() => rufe('get', '/api/strategies/positions/zwischenstand'))
    const aus = await rufe('post', `/api/strategies/positions/${id}/close`, { ausbuchen: true })
    const zeile = await knex('strategy_positions').where('id', id).first()
    pruefe(`Waise im Status '${st}': in der Liste und ausbuchbar`,
        (zw.d.positionen || []).some((p) => p.id === id && p.ohneInstanz) && aus.s === 200 && zeile.status === 'closed',
        JSON.stringify({ aus, status: zeile.status }))
}

// ── Rücksicherung in eine frische DB: kein fremdes Setup schliessen ──────
{
    const s = await instanz('S', 'ADAUSDT')
    const [su] = await knex('strategy_setups').insert({ instanceId: s, symbol: 'ADAUSDT', status: 'open' }).returning('id')
    const setupId = typeof su === 'object' ? su.id : su
    await offenePosition(s, 'ADAUSDT')
    await knex('strategy_positions').where('clientOrderId', `test-${coid}`).update({ setupId })
    await knex('strategy_trades').insert({ instanceId: s, setupId: setupId + 5, positionId: 0, symbol: 'ADAUSDT', mode: 'paper' })
    const mitSetup = await baueExport()
    // frische DB: keine Setups, Setup-Zähler auf null
    await knex('strategy_setups').del()
    await knex('sqlite_sequence').where('name', 'strategy_setups').del()
    await leise(() => rufe('post', '/api/db-import', structuredClone(mitSetup)))
    const pos = await knex('strategy_positions').where('clientOrderId', `test-${coid}`).first()
    const [fr] = await knex('strategy_setups').insert({ instanceId: a, symbol: 'BTCUSDT', status: 'waiting_retest' }).returning('id')
    const fremdId = typeof fr === 'object' ? fr.id : fr
    pruefe('frische DB: neue Setups erben keine Nummer, auf die Trades zeigen', fremdId > setupId + 5, `neu = ${fremdId}`)
    await knex('strategy_setups').where('id', fremdId).update({ id: setupId })   // Kollision erzwingen
    const z = await leise(() => rufe('post', `/api/strategies/positions/${pos.id}/close`, {}))
    const fremd = await knex('strategy_setups').where('id', setupId).first()
    pruefe('frische DB: Schliessen der zurückgespielten Position lässt das fremde Setup wartend',
        z.s === 200 && Number(pos.setupId) === 0 && fremd.status === 'waiting_retest',
        JSON.stringify({ s: z.s, setupId: pos.setupId, status: fremd?.status }))
}

// ── Älterer strategienStand im Backup wird sofort nachmigriert ───────────
{
    const altStand = structuredClone(backup)
    altStand.tables.settings[0].strategienStand = 2
    await leise(() => rufe('post', '/api/db-import', altStand))
    const stand = (await knex('settings').where('id', 1).first()).strategienStand
    const alteA = await knex('strategy_instances').where('id', a).first()
    // Stand 5 (LSOB neu, 01.11.2026) läuft mit; die Instanz startet trotzdem nur
    // einmal neu, weil Stand 3 im selben Durchgang schon alle frisch gemacht hat.
    pruefe('Import eines Backups mit Stand 2: Stand 5 und die Instanz ist neu gestartet (Archiv + Kopie)',
        Number(stand) === 5 && Number(alteA.archiviert) === 1 && Number(alteA.nachfolger) > 0, JSON.stringify({ stand, alteA: alteA?.archiviert }))
}

await stopStrategyEngine?.().catch(() => {})
await knex.destroy()
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
