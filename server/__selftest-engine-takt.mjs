/**
 * Selbsttest: ganzer Engine-Takt (`tick`) gegen eine Wegwerf-SQLite.
 *
 *   node server/__selftest-engine-takt.mjs
 *
 * Die übrigen Engine-Tests prüfen einzelne Regeln (`ausloeserAlter`, das SQL
 * des Risiko-Kontexts). Die Fehler hier lagen aber im ZUSAMMENSPIEL — die
 * Regel stimmte, nur ihre Eingabe stammte aus der falschen Zeit oder aus einem
 * veralteten Zustand. Deshalb läuft hier der echte Takt: Engine, Risk-Engine,
 * Papierbuchung und DB echt, nur `market-data.js` ist durch den Lade-Haken
 * `__engine-attrappen.mjs` ersetzt (keine Netzabrufe).
 *
 * Abgedeckt (Audit 4.3.4):
 *   - FUN-F1-001: Risiko-Kontext zum Schluss der Auslösekerze — eine 15m-
 *     Position, -Sperrfrist und -Tagesverluste sehen auch 4h-Auslöser.
 *   - FUN-F1-005: ein Einstieg zum Schluss beginnt mit dem Kerzenende.
 *   - FUN-S4-005: Neustart während eines laufenden Takts — die archivierte
 *     Instanz legt weder Setups noch Positionen an.
 *   - FUN-L2-003: Regeländerung in einem anderen Prozess (hier: direkt in der
 *     DB, an der Registry vorbei) — der Takt lädt nach; eine hier unbekannte
 *     Strategie steht als `lastError` an der Instanz.
 *   - FUN-L2-001: eine Regeländerung nach dem Archivieren stellt die offenen
 *     Positionen des Archivs nicht mehr um; aktive Instanzen erben sie.
 *   - FUN-R0-002 (Nachbesserung): bei dauerhaft kurzer Historie fragt die
 *     Engine höchstens einmal je neuer Kerze frisch nach (force), nicht in
 *     jedem 15-s-Takt.
 * Gegenprobe gemacht: mit dem Stand vor den Fixes schlagen alle drei Gruppen fehl.
 */

process.env.AT_DB_FILE = ':memory:'

import { register } from 'node:module'
register('./__engine-attrappen.mjs', import.meta.url)

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const M = 60000
const H = 60 * M
// Entscheidungszeit: eine feste 4h-Grenze mitten am Tag (12:00 UTC) — sonst
// fiele der Tagesbeginn je nach Uhrzeit des Laufs zwischen die Testtrades.
// Die jüngste geschlossene 15m-Kerze beginnt D − 15 min, die 4h-Kerze D − 4 h.
const D = Date.UTC(2026, 9, 29, 12)

const { initDb } = await import('./database.js')
const knex = await initDb()
await knex('settings').where('id', 1).update({ marktdatenQuelle: 'aus' })
const { registerStrategy, getStrategy } = await import('./strategies/index.js')
const engine = await import('./strategy-engine.js')
const { neustartInstanz } = await import('./strategie-neustart.js')
const { timeframeMs } = await import('./market-data.js')
const { ladeAlleRegelStrategien } = await import('./strategy-api.js')
engine.setAgentHook(null)

const kerzenBis = (ende, tf, limit, k) => {
    const step = timeframeMs(tf)
    const out = []
    for (let i = limit; i >= 1; i--) { const t = ende - i * step; out.push({ t, ...k, v: 10, closeTime: t + step - 1 }) }
    return out
}
const standardMarkt = () => ({
    kerzen: async (symbol, tf, limit) => kerzenBis(D, tf, limit, { o: 2.55, h: 2.6, l: 2.45, c: 2.55 }),
    meta: { stepSize: 0.1, tickSize: 0.0001, minQty: 0, minNotional: 0 },
    preis: 2.55,
})
globalThis.__engineMarkt = standardMarkt()

async function leeren() {
    for (const t of ['strategy_runs', 'strategy_trades', 'strategy_positions', 'strategy_setups', 'strategy_param_history', 'strategy_instances']) {
        await knex(t).delete()
    }
    engine.resetSymbolCache()
    globalThis.__engineMarkt = standardMarkt()
    engine.setAgentHook(null)
}

// ── FUN-F1-001: Stichtag der Risikoprüfung ───────────────────────────────
console.log('\nRisiko-Kontext bei 15m + 4h (Stichtag = Schluss der Auslösekerze)')

registerStrategy({ id: 'test_mtf', name: 'Test MTF', supportedTimeframes: ['15m', '4h'], params: [], warmupCandles: 50,
    detect({ candles, openSetups }) {
        const k = candles[candles.length - 1]
        return { setups: [], events: openSetups.map((s) => ({ id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t, entry: 2.5, stopLoss: 2.3, takeProfit: 3.0 })) }
    } })

async function mtfFall(vorbereiten, cooldownMinutes = 0) {
    await leeren()
    const risk = { startEquityUsdt: 1000, maxConcurrentPositions: 1, duplicateScope: 'symbol', cooldownMinutes, maintenanceMarginPct: 0.5, maxDailyLossPct: 3 }
    await knex('strategy_instances').insert({ id: 30, strategyId: 'test_mtf', name: 'mtf', mode: 'paper', broker: 'bitunix', market: 'futures',
        timeframe: '15m', timeframes: '["15m","4h"]', symbols: '["XRPUSDT"]', params: '{}', risk: JSON.stringify(risk), agents: '{}', enabled: 1 })
    const setup = (id, tf) => ({ id, instanceId: 30, strategyId: 'test_mtf', symbol: 'XRPUSDT', timeframe: tf, direction: 'long', status: 'armed',
        obCandleTime: D - 10 * H - id, watchFrom: D - 10 * H, entry: 2.5, stopLoss: 2.3, takeProfit: 3.0, rr: 2.5, confirmations: '{}' })
    await vorbereiten(setup)
    await engine.tick()
    return {
        positionen: await knex('strategy_positions').where('instanceId', 30).where('status', 'open'),
        setup4h: await knex('strategy_setups').where({ instanceId: 30, timeframe: '4h' }).first(),
    }
}
const trade = (id, tf, entryTime, exitTime, netPnl, symbol = 'XRPUSDT') => ({ instanceId: 30, positionId: id, symbol, timeframe: tf, direction: 'long',
    entryPrice: 2.5, exitPrice: 2.3, qty: 10, entryTime, exitTime, exitReason: 'sl', netPnl })
const offenePos = (entryTime) => ({ id: 77, instanceId: 30, setupId: 901, mode: 'paper', broker: 'bitunix', symbol: 'XRPUSDT', timeframe: '15m',
    direction: 'long', qty: 10, initialQty: 10, entryPrice: 2.5, entryTime, stopLoss: 2.3, initialStopLoss: 2.3, takeProfit: 3.0,
    leverage: 3, notionalUsdt: 25, marginUsdt: 8, clientOrderId: 'ctj-30-901', lastCandleTime: D - 15 * M, status: 'open' })

{
    const r = await mtfFall((s) => knex('strategy_setups').insert([s(1, '15m'), s(2, '4h')]))
    pruefe('15m eröffnet im selben Takt → 4h-Auslöser sieht sie (Deckel 1)',
        r.positionen.length === 1 && r.setup4h?.rejectReason === 'max_concurrent_positions',
        `${r.positionen.length} offen, 4h: ${r.setup4h?.status}/${r.setup4h?.rejectReason}`)
}
{
    const r = await mtfFall(async (s) => {
        await knex('strategy_setups').insert([s(2, '4h')])
        await knex('strategy_positions').insert(offenePos(D - 2 * H - 45 * M))   // nach Beginn der 4h-Kerze eingestiegen
    })
    pruefe('15m-Position seit Mitte der 4h-Kerze zählt als offen',
        r.positionen.length === 1 && r.setup4h?.rejectReason === 'max_concurrent_positions',
        `${r.positionen.length} offen, 4h: ${r.setup4h?.status}/${r.setup4h?.rejectReason}`)
}
{
    const r = await mtfFall(async (s) => {
        await knex('strategy_setups').insert([s(2, '4h')])
        await knex('strategy_trades').insert(trade(999, '15m', D - 2 * H, D - 30 * M, -2))
    }, 60)
    pruefe('15m-Ausstieg 30 min vor dem Entscheid sperrt (Sperrfrist 60 min)',
        r.setup4h?.rejectReason === 'symbol_cooldown', `4h: ${r.setup4h?.status}/${r.setup4h?.rejectReason}`)
}
{
    const r = await mtfFall(async (s) => {
        await knex('strategy_setups').insert([s(2, '4h')])
        await knex('strategy_trades').insert(trade(998, '15m', D - 3 * H, D - 1 * H, -40, 'BTCUSDT'))
    })
    pruefe('15m-Verlust innerhalb der 4h-Kerze zählt fürs Tageslimit',
        r.setup4h?.rejectReason === 'daily_loss_limit', `4h: ${r.setup4h?.status}/${r.setup4h?.rejectReason}`)
}
{
    const r = await mtfFall(async (s) => {
        await knex('strategy_setups').insert([s(2, '4h')])
        await knex('strategy_trades').insert(trade(997, '15m', D - 6 * H, D - 4 * H - 30 * M, -2))
    }, 60)
    pruefe('Ausstieg 4,5 h vor dem Entscheid sperrt nicht mehr (Sperrfrist 60 min)',
        r.setup4h?.status === 'open' && r.positionen.length === 1, `4h: ${r.setup4h?.status}/${r.setup4h?.rejectReason}`)
}
pruefe('risikoStichtag = Kerzenbeginn + Kerzenlänge',
    engine.risikoStichtag?.({ candleTime: D - 4 * H, triggeredAt: D - 4 * H }, 4 * H) === D)

// ── FUN-F1-005: Einstieg zum Schluss im Papierbetrieb ────────────────────
console.log('\nEinstieg zum Schluss: Einstiegszeit der Papierposition')
{
    registerStrategy({ id: 'test_schluss', name: 'Test Schluss', supportedTimeframes: ['1h'], params: [], warmupCandles: 50,
        detect({ candles, openSetups }) {
            const k = candles[candles.length - 1]
            return { setups: [], events: openSetups.map((s) => ({ id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
                entry: 2.55, stopLoss: 2.3, takeProfit: 3.0, entryAtClose: true,
                confirmations: { entryTrigger: 'market', entryAtClose: true } })) }
        } })
    await leeren()
    await knex('strategy_instances').insert({ id: 31, strategyId: 'test_schluss', name: 'schluss', mode: 'paper', broker: 'bitunix', market: 'futures',
        timeframe: '1h', timeframes: '["1h"]', symbols: '["XRPUSDT"]', params: '{}', risk: JSON.stringify({ maintenanceMarginPct: 0.5 }), agents: '{}', enabled: 1 })
    await knex('strategy_setups').insert({ id: 50, instanceId: 31, strategyId: 'test_schluss', symbol: 'XRPUSDT', timeframe: '1h', direction: 'long', status: 'armed',
        obCandleTime: D - 10 * H, watchFrom: D - 10 * H, entry: 2.55, stopLoss: 2.3, takeProfit: 3.0, rr: 2, confirmations: '{}' })
    await engine.tick()
    const p = await knex('strategy_positions').where('instanceId', 31).first()
    pruefe('Position beginnt mit dem Schluss der Auslösekerze, Nachlauf ab ihrem Beginn',
        p && Number(p.entryTime) === D && Number(p.lastCandleTime) === D - H,
        p ? `entryTime ${new Date(Number(p.entryTime)).toISOString()}, lastCandleTime ${new Date(Number(p.lastCandleTime)).toISOString()}` : 'keine Position')
}

// ── FUN-S4-005: Neustart mitten im Takt ──────────────────────────────────
console.log('\nNeustart während eines laufenden Takts')
{
    let szenario = 'A'
    registerStrategy({ id: 'test_wettlauf', name: 'Wettlauf', params: [], supportedTimeframes: ['1h'], warmupCandles: 10,
        detect({ candles, openSetups, knownSetupKeys }) {
            const last = candles[candles.length - 1]
            const ob = candles[candles.length - 5].t
            const setups = knownSetupKeys.includes(`long|${ob}`) ? [] : [{
                direction: 'long', status: 'armed', sweepLevel: 99, sweepPrice: 99, sweepCandleTime: ob,
                obHigh: 101, obLow: 100, obCandleTime: ob, watchFrom: ob, entry: 100, stopLoss: 95, takeProfit: 110, rr: 2,
            }]
            const events = szenario === 'B'
                ? openSetups.map((s) => ({ id: s.id, status: 'triggered', triggeredAt: last.t, candleTime: last.t, entry: 100, stopLoss: 95, takeProfit: 110 }))
                : []
            return { setups, events }
        },
    })
    let tor = null
    let torWo = ''
    const warte = () => new Promise((f) => { tor = f })
    const wettlaufMarkt = () => ({
        ...standardMarkt(),
        kerzen: async (symbol, tf, limit) => {
            if (torWo === 'kerzen') await warte()
            return kerzenBis(Math.floor(Date.now() / H) * H, '1h', Math.min(limit, 400), { o: 101, h: 102, l: 99.5, c: 101 })
        },
    })
    const lauf = async (wo, vorbereiten) => {
        await leeren()
        globalThis.__engineMarkt = wettlaufMarkt()
        engine.setAgentHook(async () => {
            if (torWo === 'agent') await warte()
            return { action: 'approve', sizeFactor: 1 }
        })
        const id = (await knex('strategy_instances').insert({
            strategyId: 'test_wettlauf', name: 'wettlauf', mode: 'paper', broker: 'bitunix', market: 'futures', timeframe: '1h',
            timeframes: '["1h"]', symbols: '["BTCUSDT"]', params: '{}', risk: JSON.stringify({ maintenanceMarginPct: 0.5 }),
            agents: '{}', enabled: 1, paramsVersion: 1,
        }))[0]
        await vorbereiten?.(id)
        torWo = wo
        const takt = engine.tick()
        for (let i = 0; i < 500 && !tor; i++) await new Promise((f) => setTimeout(f, 10))
        const neu = await neustartInstanz(knex, id)
        const f = tor; tor = null; torWo = ''; f?.()
        await takt
        return {
            neu,
            setups: await knex('strategy_setups').where('instanceId', id).select('id', 'status', 'invalidReason'),
            positionen: await knex('strategy_positions').where('instanceId', id),
        }
    }

    const a = await lauf('kerzen')
    pruefe('Neustart während des Kerzenabrufs: kein neues Setup im Archiv',
        a.neu.ok && a.setups.length === 0, JSON.stringify(a.setups))

    szenario = 'B'
    const b = await lauf('agent', async (id) => {
        const ob = Math.floor(Date.now() / H) * H - 20 * H
        await knex('strategy_setups').insert({ instanceId: id, strategyId: 'test_wettlauf', symbol: 'BTCUSDT', timeframe: '1h', direction: 'long', status: 'armed',
            obHigh: 101, obLow: 100, obCandleTime: ob, watchFrom: ob, entry: 100, stopLoss: 95, takeProfit: 110, rr: 2, confirmations: '{}', paramsVersion: 1 })
    })
    pruefe('Neustart während des Agenten-Vetos: keine Papierposition für das Archiv',
        b.neu.ok && b.positionen.length === 0, `${b.positionen.length} Position(en)`)
    pruefe('…und der Abschluss „archiviert" bleibt stehen',
        b.setups.length > 0 && b.setups.every((s) => s.status === 'invalidated' && s.invalidReason === 'archiviert'), JSON.stringify(b.setups))
}

// ── FUN-L2-003: Regeländerung aus einem anderen Prozess ──────────────────
console.log('\nRegelstrategien: Abgleich mit der DB im Takt')
{
    await leeren()
    const RV1 = {
        timeframes: ['1h'], direction: 'long', warmupCandles: 100,
        params: [{ key: 'ziel', type: 'number', label: 'Ziel', default: 2, min: 0.5, max: 10, step: 0.5 }],
        indicators: [{ id: 'm', type: 'macd', fast: 12, slow: 26, signal: 9 }, { id: 's', type: 'macdSignal', fast: 12, slow: 26, signal: 9 }],
        signal: { type: 'crossUp', a: 'm', b: 's' }, entry: { type: 'immediate' },
        stopLoss: { anchor: 'lastSwingLow', offsetPct: 0.2 }, takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
        breakEvenAtR: 0, maxHoldCandles: 0,
    }
    const zeile = (strategyId, rules, version = 1) => ({ strategyId, name: strategyId, description: 'Test', enabled: 1, rules: JSON.stringify(rules), version })
    await knex('rule_strategies').insert(zeile('test_regel', RV1))
    // So startet der führende Prozess: Regeln einmal geladen.
    await ladeAlleRegelStrategien()
    pruefe('Ausgangslage: Regel geladen, Zeitausstieg 0', getStrategy('test_regel')?.regeln?.maxHoldCandles === 0)

    // Ein zweiter Prozess ändert die Regel und legt eine neue Strategie samt
    // Instanz an — an der Registry dieses Prozesses vorbei.
    await knex('rule_strategies').where('strategyId', 'test_regel')
        .update({ rules: JSON.stringify({ ...RV1, maxHoldCandles: 3 }), version: 2 })
    await knex('rule_strategies').insert(zeile('test_regel_neu', RV1))
    const instanz = (strategyId) => ({ strategyId, name: strategyId, mode: 'paper', broker: 'bitunix', market: 'futures', timeframe: '1h',
        timeframes: '["1h"]', symbols: '["XRPUSDT"]', params: '{}', risk: JSON.stringify({ maintenanceMarginPct: 0.5 }), agents: '{}', enabled: 1 })
    const idNeu = (await knex('strategy_instances').insert(instanz('test_regel_neu')))[0]
    const idFehlt = (await knex('strategy_instances').insert(instanz('gibt_es_nirgends')))[0]

    await engine.tick()
    pruefe('geänderte Regel aus der DB nachgeladen (Zeitausstieg 3)',
        getStrategy('test_regel')?.regeln?.maxHoldCandles === 3, `maxHold ${getStrategy('test_regel')?.regeln?.maxHoldCandles}`)
    const neu = await knex('strategy_instances').where('id', idNeu).first()
    pruefe('im anderen Prozess angelegte Strategie wird gerechnet',
        Number(neu.lastRunAt) > 0 && !neu.lastError, `lastRunAt ${neu.lastRunAt}, lastError „${neu.lastError}"`)
    const fehlt = await knex('strategy_instances').where('id', idFehlt).first()
    pruefe('unbekannte Strategie steht als Fehler an der Instanz',
        /nicht geladen/.test(fehlt.lastError || ''), `lastError „${fehlt.lastError}"`)
}

// ── FUN-L2-001: Regeländerung nach dem Archivieren ───────────────────────
console.log('\nArchiv: offene Positionen behalten die Regeln vom Archivieren')
{
    const RV1 = {
        timeframes: ['1h'], direction: 'long', warmupCandles: 100,
        params: [{ key: 'ziel', type: 'number', label: 'Ziel', default: 2, min: 0.5, max: 10, step: 0.5 }],
        indicators: [{ id: 'm', type: 'macd', fast: 12, slow: 26, signal: 9 }, { id: 's', type: 'macdSignal', fast: 12, slow: 26, signal: 9 }],
        signal: { type: 'crossUp', a: 'm', b: 's' }, entry: { type: 'immediate' },
        stopLoss: { anchor: 'lastSwingLow', offsetPct: 0.2 }, takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
        breakEvenAtR: 0, maxHoldCandles: 0,
    }
    const lauf = async (archiviert) => {
        await leeren()
        await knex('rule_strategies').where('strategyId', 'test_archiv').delete()
        await knex('rule_strategy_history').where('strategyId', 'test_archiv').delete()
        const jetzt = Date.now()
        await knex('rule_strategies').insert({ strategyId: 'test_archiv', name: 'Archiv', description: 'Test', enabled: 1, rules: JSON.stringify(RV1), version: 1 })
        await knex('rule_strategy_history').insert({ strategyId: 'test_archiv', version: 1, rules: JSON.stringify(RV1), source: 'angelegt', createdAt: jetzt - 60000 })
        await ladeAlleRegelStrategien()
        await knex('strategy_instances').insert({ id: 40, strategyId: 'test_archiv', name: 'archiv', mode: 'paper', broker: 'bitunix', market: 'futures',
            timeframe: '1h', timeframes: '["1h"]', symbols: '["XRPUSDT"]', params: '{}', risk: JSON.stringify({ maintenanceMarginPct: 0.5 }), agents: '{}',
            enabled: 0, archiviert: archiviert ? 1 : 0, archiviertAm: archiviert ? jetzt : 0 })
        await knex('strategy_positions').insert({ instanceId: 40, setupId: 0, mode: 'paper', broker: 'bitunix', symbol: 'XRPUSDT', timeframe: '1h',
            direction: 'long', qty: 10, initialQty: 10, entryPrice: 2.5, entryTime: D - 10 * H, stopLoss: 2.3, initialStopLoss: 2.3, takeProfit: 3.0,
            leverage: 3, notionalUsdt: 25, marginUsdt: 8, clientOrderId: `ctj-40-${archiviert}`, lastCandleTime: D - 5 * H, status: 'open' })
        // Regeländerung NACH dem Archivieren: Zeitausstieg 3 Kerzen
        await knex('rule_strategies').where('strategyId', 'test_archiv').update({ rules: JSON.stringify({ ...RV1, maxHoldCandles: 3 }), version: 2 })
        await knex('rule_strategy_history').insert({ strategyId: 'test_archiv', version: 2, rules: JSON.stringify({ ...RV1, maxHoldCandles: 3 }), source: 'manuell', createdAt: jetzt + 5000 })
        await engine.tick()
        return knex('strategy_positions').where('instanceId', 40).first()
    }
    const archiv = await lauf(true)
    pruefe('archivierte Instanz: Position bleibt offen (Zeitausstieg der Fassung beim Archivieren = 0)',
        archiv?.status === 'open', `Status ${archiv?.status}`)
    const aktiv = await lauf(false)
    pruefe('nicht archivierte Instanz erbt die Änderung (Zeitausstieg 3 → geschlossen)',
        aktiv?.status === 'closed', `Status ${aktiv?.status}`)
    await knex('rule_strategies').where('strategyId', 'test_archiv').delete()
    await ladeAlleRegelStrategien()
}

// ── FUN-R0-002 (Nachbesserung): Nachfrage mit force höchstens je Kerze ──
console.log('\nKurze Historie: frische Nachfrage nur einmal je neuer Kerze')
{
    registerStrategy({ id: 'test_kurz', name: 'Test kurz', supportedTimeframes: ['1h'], params: [], warmupCandles: 50,
        detect() { return { setups: [], events: [] } } })
    let ende = D
    let laenge = 120
    let nachfragen = 0
    const kurzMarkt = () => ({
        ...standardMarkt(),
        kerzen: async (symbol, tf, limit, opts = {}) => {
            if (opts.force) nachfragen++
            return kerzenBis(ende, tf, Math.min(limit, laenge), { o: 2.55, h: 2.6, l: 2.45, c: 2.55 })
        },
    })
    await leeren()
    globalThis.__engineMarkt = kurzMarkt()
    await knex('strategy_instances').insert({ id: 32, strategyId: 'test_kurz', name: 'kurz', mode: 'paper', broker: 'bitunix', market: 'futures',
        timeframe: '1h', timeframes: '["1h"]', symbols: '["XRPUSDT"]', params: '{}', risk: JSON.stringify({ maintenanceMarginPct: 0.5 }), agents: '{}', enabled: 1 })
    for (let i = 0; i < 3; i++) await engine.tick()
    pruefe('drei Takte auf derselben Kerze → eine Nachfrage', nachfragen === 1, `${nachfragen} Nachfragen`)
    ende = D + H
    for (let i = 0; i < 3; i++) await engine.tick()
    pruefe('neue Kerze → genau eine weitere Nachfrage', nachfragen === 2, `${nachfragen} Nachfragen`)
    // Unter 50 Kerzen gilt die Kerze nie als verarbeitet — die Nachfrage darf
    // trotzdem nicht jeden Takt wiederkehren.
    laenge = 30
    ende = D + 2 * H
    for (let i = 0; i < 3; i++) await engine.tick()
    pruefe('zu wenige Kerzen: auch dann nur eine Nachfrage je Kerze', nachfragen === 3, `${nachfragen} Nachfragen`)

    // Die Nachfrage selbst wirkt weiter: kurzer erster Abruf, volle frische Reihe.
    let gesehen = 0
    registerStrategy({ id: 'test_kurz', name: 'Test kurz', supportedTimeframes: ['1h'], params: [], warmupCandles: 50,
        detect({ candles }) { gesehen = candles.length; return { setups: [], events: [] } } })
    globalThis.__engineMarkt = {
        ...standardMarkt(),
        kerzen: async (symbol, tf, limit, opts = {}) =>
            kerzenBis(D + 3 * H, tf, opts.force ? limit : Math.min(limit, 120), { o: 2.55, h: 2.6, l: 2.45, c: 2.55 }),
    }
    await engine.tick()
    pruefe('kurzer erster Abruf → die Kerze wird mit der vollen frischen Reihe gerechnet', gesehen === 300, `${gesehen} Kerzen`)
}

await engine.stopStrategyEngine().catch(() => {})
await knex.destroy()
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
