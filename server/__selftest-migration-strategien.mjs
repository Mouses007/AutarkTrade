/**
 * Selbsttest: Migration des Strategien-Umbaus (server/migrationen/strategien.js).
 *
 *   node server/__selftest-migration-strategien.mjs
 *
 * Läuft auf einer SQLite im Speicher. Geprüft wird, was die Migration auf der
 * NAS tun darf und was nicht: Zeilen gelöschter Instanzen gehen, eine OFFENE
 * Position ohne Instanz bleibt; der Zeitausstieg wird genau einmal und nur bei
 * den alten Vorgabewerten nachgezogen; gespiegelte Journal-Trades gehen, echte
 * bleiben, und die Tagessummen folgen ihnen (Stand 2 und Nachholschritt
 * Stand 4, FUN-F4-001); jede Instanz wird genau einmal neu gestartet (Archiv +
 * Kopie) — auch wenn zwei Prozesse die Migration verschränkt ausführen
 * (BUG-F1-004); Stand 5 startet nur die LSOB-Instanzen neu, und nicht, wenn
 * Stand 3 im selben Start schon alle neu gestartet hat.
 */
import knexLib from 'knex'
import { migriereStrategien } from './migrationen/strategien.js'
import { tagesSummen } from '../shared/coinM.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
const spalteDazu = async (tabelle, spalte, bauen) => {
    if (!(await knex.schema.hasColumn(tabelle, spalte))) await knex.schema.alterTable(tabelle, bauen)
}

console.log('\nMigration Strategien')

await knex.schema.createTable('settings', (t) => { t.increments('id') })
await knex('settings').insert({ id: 1 })
await knex.schema.createTable('strategy_instances', (t) => {
    t.increments('id'); t.text('strategyId'); t.text('params'); t.text('risk'); t.integer('paramsVersion')
    for (const s of ['name', 'mode', 'broker', 'market', 'timeframe', 'timeframes', 'symbols', 'agents', 'lastError']) t.text(s)
    t.integer('enabled')
})
for (const tab of ['strategy_trades', 'strategy_runs', 'strategy_suggestions']) {
    await knex.schema.createTable(tab, (t) => { t.increments('id'); t.integer('instanceId') })
}
await knex.schema.createTable('strategy_setups', (t) => {
    t.increments('id'); t.integer('instanceId'); t.text('status'); t.text('invalidReason')
})
await knex.schema.createTable('strategy_positions', (t) => { t.increments('id'); t.integer('instanceId'); t.text('status') })
await knex.schema.createTable('strategy_param_history', (t) => {
    t.increments('id'); t.integer('instanceId'); t.integer('paramsVersion'); t.text('params'); t.text('risk'); t.text('source')
    t.unique(['instanceId', 'paramsVersion'])
})

const inst = (id, strategyId, maxHold, version, enabled) => ({
    id, strategyId, params: JSON.stringify({ maxHoldCandles: maxHold }), risk: '{}', paramsVersion: version,
    name: `#${id}`, mode: 'paper', broker: 'bitunix', market: 'futures', timeframe: '1h', timeframes: '[]',
    symbols: '["BTCUSDT"]', agents: '{}', enabled,
})
await knex('strategy_instances').insert([
    inst(15, 'momentum_swing', 59, 1, 1),
    inst(16, 'liq_kerze', 47, 1, 1),
    inst(17, 'liq_kerze', 30, 4, 0),
    inst(5, 'lsob', 59, 6, 1),
])
await knex('strategy_trades').insert([{ instanceId: 15 }, { instanceId: 8 }, { instanceId: 8 }])
await knex('strategy_setups').insert([
    { instanceId: 8, status: 'closed' }, { instanceId: 16, status: 'closed' }, { instanceId: 17, status: 'waiting_retest' },
])
await knex('strategy_runs').insert([{ instanceId: 8 }])
await knex('strategy_positions').insert([
    { instanceId: 8, status: 'closed' }, { instanceId: 8, status: 'open' }, { instanceId: 15, status: 'open' },
])
// Entwürfe: zwei des entfallenen Code-Baukastens, einer im Regelformat, einer ohne Beschreibung.
// Gespiegelte Agenten-Trades im Journal (Spiegeln entfällt, Stand 2)
await knex.schema.alterTable('strategy_trades', (t) => { t.integer('journalTradeId').defaultTo(0) })
await knex('strategy_trades').where('instanceId', 15).update({ journalTradeId: 1 })
// Spalten wie in database.js: Blotter und P&L stehen neben den Trades.
const journalTabelle = (k) => k.schema.createTable('trades', (t) => {
    t.increments('id'); t.text('trades'); t.text('executions'); t.text('blotter').defaultTo('{}'); t.text('pAndL').defaultTo('{}')
})
await journalTabelle(knex)
/** Ein Journal-Trade mit den Geldfeldern des API-Imports (src/utils/quickImport.js). */
const jt = (id, category, netto, symbol = 'ETHUSDT') => {
    const gw = netto > 0
    return {
        id, category, symbol, grossProceeds: netto + 1, netProceeds: netto, commission: 1,
        grossWinsCount: gw ? 1 : 0, grossLossCount: gw ? 0 : 1, netWinsCount: gw ? 1 : 0, netLossCount: gw ? 0 : 1,
    }
}
const agentT = (n) => jt(`agent_${n}`, 'agent', 480, 'BTCUSDT')
// Tag 2 wie im Befund FUN-F4-001: nach dem Spiegeln hat ein API-Import Blotter
// und P&L über BEIDE Trades gerechnet (470 statt −10).
const tag2 = [jt('echt_1', 'futures', -10), agentT(3)]
await knex('trades').insert([
    { id: 1, trades: JSON.stringify([agentT(1), agentT(2)]), executions: '[]' },
    { id: 2, trades: JSON.stringify(tag2), executions: '[]',
        blotter: JSON.stringify(tagesSummen(tag2).blotter), pAndL: JSON.stringify(tagesSummen(tag2).pAndL) },
    { id: 3, trades: JSON.stringify([agentT(4)]), executions: JSON.stringify([{ id: 'x' }]),
        pAndL: JSON.stringify(tagesSummen([agentT(4)]).pAndL) },
    { id: 4, trades: JSON.stringify([{ id: 'echt_2', category: 'futures' }]), executions: '[]' },
])
await knex.schema.createTable('strategy_drafts', (t) => {
    t.increments('id'); t.text('spec'); t.text('generatedPath').defaultTo(''); t.text('status').defaultTo('draft')
})
await knex('strategy_drafts').insert([
    { id: 1, spec: JSON.stringify({ slug: 'alt', supportedTimeframes: ['1h'], rules: { entryLong: [] } }) },
    { id: 2, spec: '{}', generatedPath: 'server/strategies/_entwurf_alt.js' },
    { id: 3, spec: JSON.stringify({ id: 'neu', timeframes: ['1h'], indicators: [] }) },
    { id: 4, spec: 'null' },
])

await migriereStrategien(knex, spalteDazu)

const entwuerfe = (await knex('strategy_drafts').select('id')).map((r) => r.id)
pruefe('Entwürfe des alten Code-Baukastens sind weg, Regel-Entwürfe bleiben',
    entwuerfe.join(',') === '3,4', entwuerfe.join(','))
pruefe('Entwürfe haben die Spalte strategyId', await knex.schema.hasColumn('strategy_drafts', 'strategyId'))
pruefe('Setups haben die Spalte endeT (Ende ohne Einstieg)', await knex.schema.hasColumn('strategy_setups', 'endeT'))

const params = async (id) => JSON.parse((await knex('strategy_instances').where('id', id).first()).params)
pruefe('Trades gelöschter Instanzen sind weg, die anderen bleiben',
    (await knex('strategy_trades').where('instanceId', 8)).length === 0
    && (await knex('strategy_trades').where('instanceId', 15)).length === 1)
pruefe('Setups und Läufe gelöschter Instanzen sind weg',
    (await knex('strategy_setups').where('instanceId', 8)).length === 0
    && (await knex('strategy_runs').where('instanceId', 8)).length === 0)
pruefe('eine OFFENE Position ohne Instanz bleibt sichtbar',
    (await knex('strategy_positions').where({ instanceId: 8, status: 'open' })).length === 1
    && (await knex('strategy_positions').where({ instanceId: 8, status: 'closed' })).length === 0)
pruefe('Momentum Swing 59 → 60', (await params(15)).maxHoldCandles === 60)
pruefe('Liquidations-Kerze 47 → 48', (await params(16)).maxHoldCandles === 48)
pruefe('ein bewusst anderer Wert bleibt (30)', (await params(17)).maxHoldCandles === 30)
pruefe('andere Strategien bleiben unberührt (LSOB 59)', (await params(5)).maxHoldCandles === 59)
pruefe('die Änderung bekommt eine neue Version mit Historie',
    (await knex('strategy_instances').where('id', 15).first()).paramsVersion === 2
    && (await knex('strategy_param_history').where({ instanceId: 15, paramsVersion: 2 })).length === 1)
pruefe('Stand steht auf 5', (await knex('settings').where('id', 1).first()).strategienStand === 5)
const tag = async (id) => knex('trades').where('id', id).first()
pruefe('Spiegelung: ein Tag nur mit Agenten-Trades verschwindet', !(await tag(1)))
pruefe('Spiegelung: am gemischten Tag bleibt der echte Trade, der Agenten-Trade geht',
    JSON.parse((await tag(2)).trades).map((x) => x.id).join(',') === 'echt_1')
pruefe('Spiegelung: ein Tag mit Ausführungen bleibt, auch ohne Trades',
    (await tag(3)) && JSON.parse((await tag(3)).trades).length === 0)
pruefe('Spiegelung: andere Tage bleiben unberührt', JSON.parse((await tag(4)).trades)[0].id === 'echt_2')
{
    const p = JSON.parse((await tag(2)).pAndL)
    const b = JSON.parse((await tag(2)).blotter)
    pruefe('Spiegelung: der P&L des gemischten Tages zählt nur noch den echten Trade (−10 statt 470)',
        p.netProceeds === -10 && p.trades === 1 && p.grossProceeds === -9 && p.fees === 1 && p.netWinsCount === 0, JSON.stringify(p))
    pruefe('Spiegelung: der Blotter des gemischten Tages hat nur noch das Symbol des echten Trades',
        b.length === 1 && b[0].symbol === 'ETHUSDT' && b[0].netProceeds === -10, JSON.stringify(b))
    const p3 = JSON.parse((await tag(3)).pAndL)
    pruefe('Spiegelung: ein Tag mit Ausführungen ohne Trades hat leere Summen', p3.trades === 0 && p3.netProceeds === 0, JSON.stringify(p3))
}
pruefe('Spiegelung: journalTradeId steht überall auf 0',
    (await knex('strategy_trades').where('journalTradeId', '>', 0)).length === 0)

// ── Stand 3: alle Instanzen einmal neu gestartet ─────────────────────────
const zeile = (id) => knex('strategy_instances').where('id', id).first()
const nachfolger = async (id) => zeile(Number((await zeile(id)).nachfolger))
const aktiv = async () => (await knex('strategy_instances').where('archiviert', 0)).map((r) => r.id)
{
    const alte = await Promise.all([15, 16, 17, 5].map(zeile))
    pruefe('Neustart aller: jede alte Instanz ist archiviert, pausiert und hat einen Nachfolger',
        alte.every((r) => Number(r.archiviert) === 1 && Number(r.enabled) === 0 && Number(r.nachfolger) > 0))
    pruefe('Neustart aller: genau vier laufende Kopien', (await aktiv()).length === 4, (await aktiv()).join(','))
    pruefe('Neustart aller: eine Kopie übernimmt den Laufzustand (an bleibt an, pausiert bleibt pausiert)',
        Number((await nachfolger(15)).enabled) === 1 && Number((await nachfolger(17)).enabled) === 0)
    pruefe('Neustart aller: die Kopie hat die nachgezogenen Werte und zählt ab Version 1',
        JSON.parse((await nachfolger(15)).params).maxHoldCandles === 60 && Number((await nachfolger(15)).paramsVersion) === 1)
    const wartend = await knex('strategy_setups').where('instanceId', 17).first()
    pruefe('Neustart aller: ein wartendes Setup der alten Instanz ist mit „archiviert" abgeschlossen',
        wartend.status === 'invalidated' && wartend.invalidReason === 'archiviert', JSON.stringify(wartend))
    pruefe('Neustart aller: abgeschlossene Setups bleiben, wie sie waren',
        (await knex('strategy_setups').where('instanceId', 16).first()).status === 'closed')
}

// Zweiter Start: ein jetzt bewusst gesetzter alter Wert wird NICHT wieder
// umgestellt, und niemand wird ein zweites Mal neu gestartet.
await knex('strategy_instances').where('id', 15).update({ params: JSON.stringify({ maxHoldCandles: 59 }) })
const vorher = (await aktiv()).join(',')
await migriereStrategien(knex, spalteDazu)
pruefe('zweiter Start ändert nichts mehr (Einmal-Schritt)', (await params(15)).maxHoldCandles === 59)
pruefe('zweiter Start startet nichts noch einmal neu', (await aktiv()).join(',') === vorher)

// ── Neustart: archivieren und kopieren (server/strategie-neustart.js) ─────
{
    // Von Hand: die Kopie von #16 noch einmal neu starten.
    const { neustartInstanz } = await import('./strategie-neustart.js')
    const k16 = (await nachfolger(16)).id
    await knex('strategy_setups').insert({ instanceId: k16, status: 'closed' })
    const r = await neustartInstanz(knex, k16)
    const alt = await knex('strategy_instances').where('id', k16).first()
    const neu = await knex('strategy_instances').where('id', r.neuId).first()
    pruefe('Neustart: die alte Instanz ist archiviert, pausiert und zeigt auf die Kopie',
        r.ok && Number(alt.archiviert) === 1 && Number(alt.enabled) === 0 && Number(alt.nachfolger) === r.neuId && Number(alt.archiviertAm) > 0)
    pruefe('Neustart: die Kopie läuft mit denselben Einstellungen und Version 1',
        neu && Number(neu.enabled) === 1 && neu.params === alt.params && neu.symbols === alt.symbols
        && Number(neu.paramsVersion) === 1 && !Number(neu.archiviert))
    pruefe('Neustart: die Trades bleiben bei der alten Instanz',
        (await knex('strategy_setups').where('instanceId', k16)).length === 1
        && (await knex('strategy_setups').where('instanceId', r.neuId)).length === 0)
    pruefe('Neustart: Version 1 der Kopie steht in der Historie',
        (await knex('strategy_param_history').where({ instanceId: r.neuId, paramsVersion: 1 })).length === 1)
    const nochmal = await neustartInstanz(knex, k16)
    pruefe('eine archivierte Instanz startet nicht noch einmal neu', !nochmal.ok && nochmal.grund === 'schon_archiviert')

    // Doppelklick: zwei Aufrufe zugleich — beide lesen „nicht archiviert",
    // nur einer darf eine Kopie anlegen.
    const ziel = r.neuId
    const vorAnzahl = (await knex('strategy_instances')).length
    const [a, b] = await Promise.all([neustartInstanz(knex, ziel), neustartInstanz(knex, ziel)])
    pruefe('zwei Neustarts zugleich: genau einer gewinnt, genau eine Kopie',
        [a.ok, b.ok].filter(Boolean).length === 1 && (await knex('strategy_instances')).length === vorAnzahl + 1,
        JSON.stringify([a, b]))
}

await knex.destroy()

// ── Stand 4: Nachholschritt für Installationen, auf denen Stand 2 schon lief ──
{
    const k = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    const dazu = async (tabelle, spalte, bauen) => {
        if (!(await k.schema.hasColumn(tabelle, spalte))) await k.schema.alterTable(tabelle, bauen)
    }
    await k.schema.createTable('settings', (t) => { t.increments('id'); t.integer('strategienStand').defaultTo(0) })
    await k('settings').insert({ id: 1, strategienStand: 3 })
    await journalTabelle(k)
    const echt = jt('echt', 'futures', -10)
    const offenerTrade = { ...jt('offen', 'futures', 0), tradesCount: 0 }
    // Bitunix-Korrektur (bitunix-api.js) legt zusätzliche Summenfelder an.
    const mitZusatz = { ...tagesSummen([echt, agentT(9)]).pAndL, commission: 2, grossWins: 481, netWins: 480, netLoss: -10, tradingFees: 0 }
    await k('trades').insert([
        // Stand 2 alt: Agenten-Trade weg, Summen über beide stehen geblieben
        { id: 1, trades: JSON.stringify([echt]), executions: '[]',
            blotter: JSON.stringify(tagesSummen([echt, agentT(9)]).blotter), pAndL: JSON.stringify(tagesSummen([echt, agentT(9)]).pAndL) },
        // stimmige Zeile
        { id: 2, trades: JSON.stringify([echt]), executions: '[]', pAndL: JSON.stringify(tagesSummen([echt]).pAndL) },
        // Datei-Import: der offene Trade zählt nicht mit — weniger gezählt ist kein Schaden
        { id: 3, trades: JSON.stringify([echt, offenerTrade]), executions: '[]',
            blotter: JSON.stringify({ ETHUSDT: { trades: 1 } }), pAndL: JSON.stringify({ ...tagesSummen([echt]).pAndL, executions: 2, highNetSharePLLoss: -10 }) },
        // alte Brücke: P&L leer
        { id: 4, trades: JSON.stringify([echt]), executions: '[]', pAndL: '{}' },
        // mit Zusatzfeldern der Bitunix-Korrektur
        { id: 5, trades: JSON.stringify([echt]), executions: '[]', blotter: '{}', pAndL: JSON.stringify(mitZusatz) },
    ])
    const vorher = Object.fromEntries((await k('trades').select('id', 'pAndL', 'blotter')).map((z) => [z.id, z]))
    await migriereStrategien(k, dazu)
    const nachher = Object.fromEntries((await k('trades').select('id', 'pAndL', 'blotter')).map((z) => [z.id, z]))
    const p1 = JSON.parse(nachher[1].pAndL)
    pruefe('Stand 4: ein Tag mit stehengebliebenen Summen wird auf seine Trades nachgerechnet',
        p1.netProceeds === -10 && p1.trades === 1 && JSON.parse(nachher[1].blotter).length === 1, nachher[1].pAndL)
    pruefe('Stand 4: stimmige Zeilen, Datei-Import mit offenem Trade und leerer P&L bleiben unberührt',
        [2, 3, 4].every((id) => nachher[id].pAndL === vorher[id].pAndL && nachher[id].blotter === vorher[id].blotter))
    const p5 = JSON.parse(nachher[5].pAndL)
    pruefe('Stand 4: Zusatzfelder der Bitunix-Korrektur werden mit nachgezogen',
        p5.netProceeds === -10 && p5.commission === 1 && p5.grossWins === 0 && p5.netWins === 0 && p5.netLoss === -10 && p5.tradingFees === 0
        && nachher[5].blotter === '{}', nachher[5].pAndL)
    pruefe('Stand 4: der Stand steht danach auf 4', (await k('settings').where('id', 1).first()).strategienStand === 4)
    // Läuft genau einmal: eine später verunreinigte Zeile fasst er nicht mehr an.
    await k('trades').where('id', 2).update({ pAndL: JSON.stringify({ ...tagesSummen([echt]).pAndL, trades: 5 }) })
    await migriereStrategien(k, dazu)
    pruefe('Stand 4: zweiter Start rechnet nichts mehr nach (Einmal-Schritt)', JSON.parse((await k('trades').where('id', 2).first()).pAndL).trades === 5)
    await k.destroy()
}

// ── Zwei Prozesse verschränkt (BUG-F1-004) ──────────────────────────────
/**
 * Frische DB auf Stand 0 mit drei Instanzen — Schema wie oben, die Spalten der
 * Migration schon angelegt (um die Einmal-Schritte geht es hier, nicht um das
 * gleichzeitige Anlegen von Spalten).
 */
async function frischeDb() {
    const k = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await k.schema.createTable('settings', (t) => { t.increments('id'); t.integer('strategienStand').defaultTo(0) })
    await k('settings').insert({ id: 1 })
    await k.schema.createTable('strategy_instances', (t) => {
        t.increments('id'); t.text('strategyId'); t.text('params'); t.text('risk'); t.integer('paramsVersion')
        for (const sp of ['name', 'mode', 'broker', 'market', 'timeframe', 'timeframes', 'symbols', 'agents', 'lastError']) t.text(sp)
        t.integer('enabled')
        t.integer('archiviert').defaultTo(0); t.bigInteger('archiviertAm').defaultTo(0); t.integer('nachfolger').defaultTo(0)
    })
    for (const tab of ['strategy_runs', 'strategy_suggestions']) await k.schema.createTable(tab, (t) => { t.increments('id'); t.integer('instanceId') })
    await k.schema.createTable('strategy_trades', (t) => { t.increments('id'); t.integer('instanceId'); t.integer('journalTradeId').defaultTo(0) })
    await k.schema.createTable('strategy_setups', (t) => { t.increments('id'); t.integer('instanceId'); t.text('status'); t.text('invalidReason'); t.bigInteger('endeT').defaultTo(0) })
    await k.schema.createTable('strategy_positions', (t) => { t.increments('id'); t.integer('instanceId'); t.text('status') })
    await k.schema.createTable('strategy_param_history', (t) => {
        t.increments('id'); t.integer('instanceId'); t.integer('paramsVersion'); t.text('params'); t.text('risk'); t.text('source')
        t.unique(['instanceId', 'paramsVersion'])
    })
    await journalTabelle(k)
    await k('trades').insert({ trades: JSON.stringify([agentT(1)]), executions: '[]' })
    await k('strategy_instances').insert([1, 2, 3].map((id) => inst(id, 'lsob', 10, 1, 1)))
    const dazu = async (tabelle, spalte, bauen) => {
        if (!(await k.schema.hasColumn(tabelle, spalte))) await k.schema.alterTable(tabelle, bauen)
    }
    return { k, dazu }
}
const zaehle = async (k) => {
    const alle = await k('strategy_instances').select('id', 'archiviert')
    return { alle: alle.length, aktiv: alle.filter((r) => !Number(r.archiviert)).length, stand: (await k('settings').where('id', 1).first()).strategienStand }
}
{
    // Deterministisch wie im Befund: B liest Stand 0, dann läuft A komplett
    // durch, erst danach macht B weiter.
    const { k, dazu } = await frischeDb()
    let einmal = false
    const b = new Proxy(k, {
        apply(ziel, self, args) {
            const qb = ziel(...args)
            if (args[0] === 'settings' && !einmal) {
                einmal = true
                const original = qb.then.bind(qb)
                qb.then = (ok, nein) => original(async (wert) => {
                    await migriereStrategien(k, dazu)   // A
                    return ok(wert)
                }, nein)
            }
            return qb
        },
    })
    await migriereStrategien(b, dazu)                   // B mit veraltetem Stand 0
    const z = await zaehle(k)
    pruefe('verschränkt: B mit veraltetem Stand startet nichts ein zweites Mal neu (6 Zeilen, 3 aktiv)',
        einmal && z.alle === 6 && z.aktiv === 3, JSON.stringify(z))
    pruefe('verschränkt: B setzt den Stand nicht zurück', z.stand === 5, JSON.stringify(z))
    const hist = await k('strategy_param_history').select('instanceId')
    pruefe('verschränkt: jede Instanz genau einmal im Archiv (keine Kopie einer Kopie)',
        hist.length === 3, JSON.stringify(hist))
    await k.destroy()
}
{
    // Beide zugleich gestartet (eine Verbindung, Anweisungen wechseln sich ab).
    const { k, dazu } = await frischeDb()
    await Promise.all([migriereStrategien(k, dazu), migriereStrategien(k, dazu)])
    const z = await zaehle(k)
    pruefe('zugleich: genau drei Kopien, Stand 5', z.alle === 6 && z.aktiv === 3 && z.stand === 5, JSON.stringify(z))
    await k.destroy()
}

// ── Stand 5: nur die LSOB-Instanzen neu (Detektor 3, 01.11.2026) ─────────
{
    const { k, dazu } = await frischeDb()          // drei LSOB-Instanzen 1–3
    await k('settings').where('id', 1).update({ strategienStand: 4 })
    await k('strategy_instances').insert(inst(4, 'momentum_swing', 60, 1, 1))
    await k('strategy_instances').where('id', 3).update({ archiviert: 1, enabled: 0 })
    await k('strategy_setups').insert({ instanceId: 1, status: 'waiting_retest' })
    await migriereStrategien(k, dazu)
    const zeilen = await k('strategy_instances').select('id', 'strategyId', 'archiviert', 'nachfolger', 'enabled')
    const lsobAktiv = zeilen.filter((r) => r.strategyId === 'lsob' && !Number(r.archiviert))
    pruefe('Stand 5: die laufenden LSOB-Instanzen sind archiviert und haben eine Kopie',
        [1, 2].every((id) => { const r = zeilen.find((z) => z.id === id); return Number(r.archiviert) === 1 && Number(r.nachfolger) > 0 }),
        JSON.stringify(zeilen))
    pruefe('Stand 5: zwei frische LSOB-Kopien laufen', lsobAktiv.length === 2 && lsobAktiv.every((r) => r.id > 4), JSON.stringify(lsobAktiv))
    pruefe('Stand 5: eine schon archivierte LSOB-Instanz bekommt keine Kopie', Number(zeilen.find((z) => z.id === 3).nachfolger) === 0)
    pruefe('Stand 5: andere Strategien bleiben, wie sie sind', !Number(zeilen.find((z) => z.id === 4).archiviert) && zeilen.length === 6)
    const wartend = await k('strategy_setups').where('instanceId', 1).first()
    pruefe('Stand 5: das wartende Setup der alten LSOB-Instanz ist abgeschlossen',
        wartend.status === 'invalidated' && wartend.invalidReason === 'archiviert', JSON.stringify(wartend))
    pruefe('Stand 5: der Stand steht danach auf 5', (await k('settings').where('id', 1).first()).strategienStand === 5)
    await migriereStrategien(k, dazu)
    pruefe('Stand 5: zweiter Start startet nichts noch einmal neu', (await k('strategy_instances')).length === 6)
    await k.destroy()
}
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
