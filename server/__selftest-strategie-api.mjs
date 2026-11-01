/**
 * Selbsttest: Strategie-API und Labor gegen eine Wegwerf-SQLite.
 *
 *   node server/__selftest-strategie-api.mjs
 *
 * Die Routen laufen echt (`setupStrategyRoutes`), aber ohne HTTP: eine kleine
 * App-Attrappe merkt sich die Handler und ruft sie mit Anfrage/Antwort-
 * Attrappen auf. Kein Netz, kein Port. Kerzen gibt es nur dort, wo der Test
 * sie selbst mitbringt (`runBacktest` mit `candles`).
 *
 * Abgedeckt (Audit 4.3.4):
 *   - FUN-F1-003: Instanz-Auswertung rechnet auf das Startkapital der Instanz.
 *   - FUN-L2-001: Regeländerung lässt archivierte Instanzen unverändert.
 *   - FUN-L2-002: Trade trägt die paramsVersion, unter der die Position entstand.
 *   - BUG-L2-004: Trade-Kontext zeigt die Regelfassung des Trades, auch auf SQLite.
 *   - FUN-S2-001: Vorschlag einer archivierten Instanz → 409; Neustart nimmt
 *     offene Vorschläge mit; das Agent-Werkzeug weist Archive ab.
 *   - BUG-S2-002: negatives `limit` hebelt den Deckel nicht aus.
 *   - FUN-L5-001: Backtest rechnet ohne `startEquity` mit `risk.startEquityUsdt`
 *     und hält das gerechnete Kapital in `meta.risk` fest.
 *   - FUN-L5-003: gespeicherter Lauf nennt die aktuelle Regelfassung und ob es
 *     die Strategie noch gibt.
 *   - BUG-L5-004: Backtest-Setups tragen strategyId und Sweep-Felder.
 * Gegenprobe gemacht: mit dem Stand vor den Fixes schlagen alle Gruppen fehl.
 */

process.env.AT_DB_FILE = ':memory:'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const { initDb } = await import('./database.js')
const knex = await initDb()
await knex('settings').where('id', 1).update({ marktdatenQuelle: 'aus' })
const { setupStrategyRoutes, ladePerformance } = await import('./strategy-api.js')
const { ladeInstanz, schliessePositionManuell, stopStrategyEngine } = await import('./strategy-engine.js')
const { openPaperPosition } = await import('./execution/paper.js')
const { runBacktest } = await import('./strategy-backtest.js')
const { STRATEGY_TOOL_IMPL } = await import('./strategy-tools.js')
const { VORLAGEN } = await import('./strategies/rule-templates.js')

// ── App-Attrappe: Routen merken, ohne Server aufrufen ────────────────────
const routen = []
const app = {}
for (const m of ['get', 'post', 'put', 'delete']) {
    app[m] = (pfad, ...handler) => routen.push({ m, pfad, handler: handler[handler.length - 1] })
}
setupStrategyRoutes(app)
async function rufe(m, url, body = {}) {
    const [pfad, suche = ''] = url.split('?')
    const query = Object.fromEntries(new URLSearchParams(suche))
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
                writableEnded: false,
            }
            Promise.resolve(r.handler({ params, query, body, headers: {} }, res)).catch((e) => fertig({ s: 599, d: e.message }))
        })
    }
    throw new Error(`keine Route ${m} ${pfad}`)
}

const regeln = structuredClone(VORLAGEN[0].rules)
const tf = regeln.timeframes[0]

// ── FUN-F1-003 ───────────────────────────────────────────────────────────
console.log('\nInstanz-Auswertung: Startkapital der Instanz')
{
    const [id] = await knex('strategy_instances').insert({ strategyId: 'lsob', name: 'F1', symbols: '["BTCUSDT"]', timeframe: '1h',
        params: '{}', risk: JSON.stringify({ startEquityUsdt: 10000 }), mode: 'paper', enabled: 0 })
    const t0 = Date.UTC(2026, 9, 1)
    await knex('strategy_trades').insert([-100, -100, 200].map((pnl, i) => ({ instanceId: id, symbol: 'BTCUSDT', timeframe: '1h', mode: 'paper',
        direction: 'long', entryTime: t0 + i * 7200000, exitTime: t0 + i * 7200000 + 3600000, netPnl: pnl, rMultiple: pnl / 100, exitReason: 'sl' })))
    const d = await ladePerformance({ instanceId: String(id) })
    pruefe('ohne startEquity: Startkapital der Instanz (10000)', d.kpis.startEquity === 10000, `startEquity ${d.kpis.startEquity}`)
    pruefe('Rückgang 2 % statt 20 %', Math.abs(d.kpis.maxDrawdownPct - 2) < 1e-9, `maxDD ${d.kpis.maxDrawdownPct}`)
    const ausdruecklich = await ladePerformance({ instanceId: String(id), startEquity: 500 })
    pruefe('ausdrückliches startEquity hat Vorrang', ausdruecklich.kpis.startEquity === 500)
}

// ── Regelstrategie und Instanz für L2/S2 ─────────────────────────────────
const angelegt = await rufe('post', '/api/strategies/rules', { strategyId: 'st_test', name: 'ST', description: 'x', rules: regeln })
const inst = (await rufe('post', '/api/strategies/instances', { strategyId: 'st_test', name: 'I', mode: 'paper', timeframe: tf,
    symbols: ['BTCUSDT'], market: 'futures' })).d
const jetzt = Date.now()

// ── FUN-L2-002 / BUG-L2-004 ──────────────────────────────────────────────
console.log('\nVersionen am Trade (Parameter und Regelfassung)')
{
    const [setupId] = await knex('strategy_setups').insert({ instanceId: inst.id, strategyId: 'st_test', symbol: 'BTCUSDT', timeframe: tf,
        direction: 'long', status: 'triggered', obCandleTime: jetzt - 7200e3, entry: 100, stopLoss: 95, takeProfit: 110, rr: 2, paramsVersion: 1 })
    const i1 = ladeInstanz(await knex('strategy_instances').where('id', inst.id).first())
    const op = await openPaperPosition({ instance: i1, setup: { id: setupId, symbol: 'BTCUSDT', timeframe: tf, direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110 },
        size: { qty: 1 }, entryPrice: 100, entryTime: jetzt - 3600e3, costs: { feeRate: 0, slippage: 0 }, clientOrderId: 'st-' + jetzt })
    const put = await rufe('put', `/api/strategies/rules/${angelegt.d.id}`, { name: 'ST', description: 'x', rules: { ...regeln, maxHoldCandles: 3 } })
    const i2 = ladeInstanz(await knex('strategy_instances').where('id', inst.id).first())
    const zeile = await knex('strategy_positions').where('id', op.positionId).first()
    await schliessePositionManuell({ instance: i2, positionRow: zeile, price: 105, time: jetzt, costs: { feeRate: 0, slippage: 0 } })
    const tr = await knex('strategy_trades').where('instanceId', inst.id).first()
    pruefe('Instanz ist nach der Regeländerung v2', put.d?.version === 2 && i2.paramsVersion === 2, `Regel v${put.d?.version}, Instanz v${i2.paramsVersion}`)
    pruefe('Trade unter der Version beim Eröffnen gebucht (v1)', Number(tr.paramsVersion) === 1, `paramsVersion ${tr.paramsVersion}`)
    pruefe('Trade trägt die Regelfassung beim Eröffnen (1)', Number(tr.ruleVersion) === 1, `ruleVersion ${tr.ruleVersion}`)
    const k = await rufe('get', `/api/strategies/trades/${tr.id}/context`)
    pruefe('Kontext: Regelfassung 1, sicher', k.d.ruleVersion === 1 && k.d.ruleVersionUnsicher === false, JSON.stringify({ v: k.d.ruleVersion, u: k.d.ruleVersionUnsicher }))

    // Altbestand ohne ruleVersion: nach dem Einstieg (ms) einordnen, nicht nach createdAt (SQLite-Text)
    await knex('rule_strategy_history').where({ strategyId: 'st_test', version: 1 }).update({ createdAt: jetzt - 60000 })
    await knex('rule_strategy_history').where({ strategyId: 'st_test', version: 2 }).update({ createdAt: jetzt - 30000 })
    const [alt] = await knex('strategy_trades').insert({ instanceId: inst.id, strategyId: 'st_test', symbol: 'BTCUSDT', timeframe: tf,
        direction: 'long', entryTime: jetzt - 10000, exitTime: jetzt, exitReason: 'timeout', paramsVersion: 2 })
    const k2 = await rufe('get', `/api/strategies/trades/${alt}/context`)
    pruefe('Altbestand nach Fassung 2 entstanden → Kontext v2', k2.d.ruleVersion === 2 && !k2.d.ruleVersionUnsicher, `v${k2.d.ruleVersion}`)
    const [uralt] = await knex('strategy_trades').insert({ instanceId: inst.id, strategyId: 'st_test', symbol: 'BTCUSDT', timeframe: tf,
        direction: 'long', entryTime: jetzt - 3600e3 * 24, exitTime: jetzt - 3600e3 * 23, exitReason: 'sl', paramsVersion: 1 })
    const k3 = await rufe('get', `/api/strategies/trades/${uralt}/context`)
    pruefe('älter als jede Fassung → älteste, als unsicher markiert', k3.d.ruleVersion === 1 && k3.d.ruleVersionUnsicher === true)
}

// ── FUN-S2-001 / FUN-L2-001 ──────────────────────────────────────────────
console.log('\nArchiv bleibt, wie es war')
{
    const [offen] = await knex('strategy_suggestions').insert({ instanceId: inst.id, source: 'agent', title: 't', rationale: 'r', proposedParams: '{}', status: 'pending' })
    const n = await rufe('post', `/api/strategies/instances/${inst.id}/neustart`)
    const kopie = Number(n.d?.neuId || n.d?.id || (await knex('strategy_instances').where('id', inst.id).first()).nachfolger)
    const umgehaengt = await knex('strategy_suggestions').where('id', offen).first()
    pruefe('Neustart: offener Vorschlag wandert zur Kopie', Number(umgehaengt.instanceId) === kopie && umgehaengt.status === 'pending',
        `instanceId ${umgehaengt.instanceId}, Kopie ${kopie}`)

    const [amArchiv] = await knex('strategy_suggestions').insert({ instanceId: inst.id, source: 'agent', title: 't', rationale: 'r', proposedParams: '{}', status: 'pending' })
    const a = await rufe('post', `/api/strategies/suggestions/${amArchiv}/accept`)
    pruefe('Vorschlag am Archiv annehmen → 409', a.s === 409, `Status ${a.s}`)
    const vorschlag = await STRATEGY_TOOL_IMPL.propose_param_change(knex, { instanceId: inst.id, title: 'x', rationale: 'y', params: { ziel: 3 } }, {})
    pruefe('Agent-Werkzeug weist Vorschläge am Archiv ab', Boolean(vorschlag.error) && !vorschlag.suggestionId, JSON.stringify(vorschlag))

    const vorher = Number((await knex('strategy_instances').where('id', inst.id).first()).paramsVersion)
    const put = await rufe('put', `/api/strategies/rules/${angelegt.d.id}`, { name: 'ST', description: 'x', rules: { ...regeln, maxHoldCandles: 5 } })
    const nachher = Number((await knex('strategy_instances').where('id', inst.id).first()).paramsVersion)
    pruefe('Regeländerung: Archiv behält seine Version', vorher === nachher, `${vorher} → ${nachher}`)
    pruefe('…betroffen ist nur die Kopie', put.d?.betroffeneInstanzen === 1, `betroffen ${put.d?.betroffeneInstanzen}`)
}

// ── BUG-S2-002 ───────────────────────────────────────────────────────────
console.log('\n?limit= mit Unsinn')
{
    await knex('strategy_trades').insert(Array.from({ length: 120 }, (_, i) => ({ instanceId: 999, symbol: 'ETHUSDT', exitTime: i })))
    const minus = await rufe('get', '/api/strategies/trades?instanceId=999&limit=-1')
    const halb = await rufe('get', '/api/strategies/trades?instanceId=999&limit=-0.5')
    const fuenf = await rufe('get', '/api/strategies/trades?instanceId=999&limit=5.9')
    pruefe('limit=-1 → Vorgabe 100, nicht unbegrenzt', minus.d.length === 100, `${minus.d.length}`)
    pruefe('limit=-0.5 → Vorgabe 100, nicht leer', halb.d.length === 100, `${halb.d.length}`)
    pruefe('limit=5.9 → 5', fuenf.d.length === 5, `${fuenf.d.length}`)
}

// ── FUN-L5-001 / BUG-L5-004: runBacktest mit eigenen Kerzen ─────────────
console.log('\nBacktest: Startkapital und Setup-Felder')
const H = 3600000
const t0 = Date.UTC(2026, 0, 1)
const kerzen = []
for (let i = 0; i < 320; i++) {
    const p = i < 260 ? 100 : 100 - (i - 260) * 0.8
    kerzen.push({ t: t0 + i * H, o: p, h: p + 0.3, l: p - 0.3, c: p, v: 1000 })
}
const testStrategie = {
    id: 'trendlinien_breakout', name: 'Pruef', params: [], supportedTimeframes: ['1h'], warmupCandles: 240,
    detect({ candles: sicht, openSetups, knownSetupKeys }) {
        const k = sicht[sicht.length - 1]
        const idx = Math.round((k.t - t0) / H)
        const setups = [], events = []
        if (idx === 257 && !knownSetupKeys.includes('long|1')) {
            setups.push({ direction: 'long', obCandleTime: 1, entry: 100, stopLoss: 98, takeProfit: 106, rr: 3,
                sweepLevel: 99.5, sweepPrice: 99.7, sweepCandleTime: t0 + 250 * H })
        }
        if (idx === 258) for (const s of openSetups) events.push({ id: s.id, status: 'triggered', candleTime: k.t, triggeredAt: k.t, confirmations: { probe: true } })
        return { setups, events, diagnostics: { rejections: [] } }
    },
}
{
    const risk = { startEquityUsdt: 10000, riskPerTradePct: 1, maxNotionalUsdt: 5000, leverage: 5, maintenanceMarginPct: 0.5, cooldownMinutes: 0, minRR: 0.1 }
    const lauf = (startEquity) => runBacktest({ strategyId: 'trendlinien_breakout', strategie: testStrategie, params: {}, risk, symbol: 'TESTUSDT', timeframe: '1h',
        fromTs: t0, toTs: t0 + 320 * H, startEquity, candles: kerzen, marketMeta: {}, fundingVerlauf: [], maxLeverage: 10 })
    const ohne = await lauf(undefined)
    pruefe('ohne startEquity: gerechnet mit risk.startEquityUsdt (10000)', ohne.stats.startEquity === 10000, `startEquity ${ohne.stats.startEquity}`)
    const mit = await lauf(1000)
    pruefe('mit startEquity 1000: meta.risk hält 1000 fest, nicht das Formularfeld',
        mit.stats.startEquity === 1000 && mit.meta.risk.startEquityUsdt === 1000, `meta ${mit.meta.risk.startEquityUsdt}`)

    const s = ohne.setups[0] || {}
    pruefe('Setup trägt strategyId', s.strategyId === 'trendlinien_breakout', `strategyId „${s.strategyId}"`)
    pruefe('Setup trägt sweepLevel und sweepPrice', s.sweepLevel === 99.5 && s.sweepPrice === 99.7, JSON.stringify({ l: s.sweepLevel, p: s.sweepPrice }))
    pruefe('Setup trägt die Bestätigungen des Auslösers', s.confirmations?.probe === true)
}

// ── FUN-L5-003 ───────────────────────────────────────────────────────────
console.log('\nGespeicherter Lauf: Stand der Strategie heute')
{
    const lauf = (strategyId, ruleVersion) => knex('strategy_backtests').insert({ strategyId, label: 'L', symbol: 'BTCUSDT', timeframe: tf,
        fromTs: 1, toTs: 2, params: '{}', risk: '{}', stats: '{}', trades: '[]', ruleVersion })
    const [alt] = await lauf('st_test', 1)
    const [weg] = await lauf('gibt_es_nicht', 2)
    const a = await rufe('get', `/api/strategies/backtests/${alt}`)
    pruefe('Lauf mit v1 nennt die aktuelle Fassung (v3)', a.d.ruleVersion === 1 && a.d.currentRuleVersion === 3 && a.d.strategieBekannt === true,
        JSON.stringify({ r: a.d.ruleVersion, c: a.d.currentRuleVersion, b: a.d.strategieBekannt }))
    const w = await rufe('get', `/api/strategies/backtests/${weg}`)
    pruefe('Lauf einer gelöschten Strategie: strategieBekannt false', w.d.strategieBekannt === false)
    const liste = await rufe('get', '/api/strategies/backtests')
    pruefe('Liste trägt dieselben Angaben', liste.d.some((l) => l.id === alt && l.currentRuleVersion === 3)
        && liste.d.some((l) => l.id === weg && l.strategieBekannt === false))
}

await stopStrategyEngine?.().catch(() => {})
await knex.destroy()
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
