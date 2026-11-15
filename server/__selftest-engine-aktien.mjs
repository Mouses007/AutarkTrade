/**
 * Selbsttest: Papierbetrieb einer Aktien-Instanz — ganzer Engine-Takt (`tick`)
 * gegen eine Wegwerf-SQLite, mit eingespeisten Kerzen und GESTELLTEM
 * Aktien-Kontext (`setAktienKontext`). Kein Netz: `market-data.js` ist durch
 * den Lade-Haken `__engine-attrappen.mjs` ersetzt, `axios.get` wirft.
 *
 *   node server/__selftest-engine-aktien.mjs
 *
 * Der Papierlauf vom 15.11.2026 (ein Sonntag) hatte nur die Sitzungs-Sperre
 * gezeigt. Hier steht, was dabei offen blieb (`docs/PLAN-AKTIEN.md`, Zeile
 * «Papierbetrieb geprüft»):
 *   1. Sperre `zahlentermin` (Signal im Zahlen-Fenster → `reject_risk`), samt
 *      Fensterrändern, unbekannten Terminen und der Gegenprobe Coin;
 *   2. Tageslimit am New Yorker Handelstag (Grenze 20:00 New York) — Winter,
 *      Sommer und beide Umstellungstage; ein Coin zählt weiter ab Mitternacht UTC;
 *   3. Ausstieg einer Aktien-Position an Ziel und Stop, Funding aus dem
 *      Verlauf als Haltekosten, Wartungsmarge 2,5 % (Liquidation vor dem Stop),
 *      Rutsch-Aufschlag ausserhalb der regulären Sitzung;
 *   4. offene Position über einen Split (vorwärts und rückwärts): umgerechnet,
 *      genau einmal, im Verlauf vermerkt; wartende Setups aus der Zeit davor
 *      beendet; Funding über den Split im richtigen Massstab.
 * Jede Gruppe hat ihre Gegenprobe (Coin bzw. unbekannte Splits/Termine).
 */

process.env.AT_DB_FILE = ':memory:'

import { register } from 'node:module'
register('./__engine-attrappen.mjs', import.meta.url)

import axios from 'axios'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nah = (a, b, tol = 1e-9) => Math.abs(Number(a) - Number(b)) <= tol * Math.max(1, Math.abs(Number(b)))

// Kein Netz: die Wartungsmarge fragt sonst Binance und Bybit. Was hier ankommt, wird gezählt.
const netz = []
axios.get = async (url) => { netz.push(String(url)); throw new Error('kein Netz im Selbsttest') }
const warnEcht = console.warn
console.warn = () => {}   // «Wartungsmarge nicht abrufbar» je Takt wäre nur Lärm

const M = 60000
const H = 60 * M

const { initDb } = await import('./database.js')
const knex = await initDb()
await knex('settings').where('id', 1).update({ marktdatenQuelle: 'aus', strategyMaxLeverage: 25 })
const { registerStrategy } = await import('./strategies/index.js')
const engine = await import('./strategy-engine.js')
const { sitzungVon } = await import('../shared/aktien-sitzung.js')
engine.setAgentHook(null)

// Gestellter Aktien-Kontext: Symbol → Kontext; alles andere ist ein Coin (null).
const kontexte = {}
engine.setAktienKontext(async (symbol) => kontexte[symbol] ?? null)
const AKTIE = { ticker: 'NVDA', name: 'NVIDIA', unterart: 'aktie', boerse: 'binance', kursSymbol: 'NVDA', splits: [], splitsGrund: null, termine: null, termineGrund: null }

const FLACH = { o: 100, h: 101, l: 99, c: 100 }
/** `limit` Stundenkerzen bis vor `ende`; `form(t)` darf eine Kerze je Zeit vorgeben. */
const kerzenBis = (ende, limit, form = () => FLACH, tf = H) => {
    const out = []
    for (let i = limit; i >= 1; i--) { const t = ende - i * tf; out.push({ t, ...form(t), v: 10, closeTime: t + tf - 1 }) }
    return out
}
const markt = (ende, form, funding = []) => ({
    kerzen: async (symbol, tf, limit) => kerzenBis(ende, Math.min(limit, 400), form),
    meta: { stepSize: 0.001, tickSize: 0.0001, minQty: 0, minNotional: 0 },
    preis: 100,
    funding: async () => funding,
})

async function leeren() {
    for (const t of ['strategy_runs', 'strategy_trades', 'strategy_positions', 'strategy_setups', 'strategy_param_history', 'strategy_instances']) {
        await knex(t).delete()
    }
    engine.resetSymbolCache()
    for (const k of Object.keys(kontexte)) delete kontexte[k]
}

// Löst jedes wartende Setup auf der jüngsten Kerze aus — mit den Marken des Setups.
registerStrategy({ id: 'test_aktie', name: 'Test Aktie', supportedTimeframes: ['1h'], params: [], warmupCandles: 50,
    detect({ candles, openSetups }) {
        const k = candles[candles.length - 1]
        return { setups: [], events: openSetups.map((s) => ({ id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
            entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit })) }
    } })

const RISK = { startEquityUsdt: 1000, riskPerTradePct: 1, maxNotionalUsdt: 100000, leverage: 5, maxConcurrentPositions: 3, cooldownMinutes: 0,
    maxDailyLossPct: 3, minRR: 1, maintenanceMarginPct: 0.5, feeMakerBps: 2, feeTakerBps: 6, slippageBps: 2, fundingBpsPer8h: 0 }
const instanz = (symbol, risk = {}, extra = {}) => ({ id: 60, strategyId: 'test_aktie', name: 'aktie', mode: 'paper', broker: 'bitunix', market: 'futures',
    timeframe: '1h', timeframes: '["1h"]', symbols: JSON.stringify([symbol]), params: '{}', risk: JSON.stringify({ ...RISK, ...risk }), agents: '{}', enabled: 1, ...extra })
const setup = (symbol, D, marken = {}) => ({ id: 700, instanceId: 60, strategyId: 'test_aktie', symbol, timeframe: '1h', direction: 'long', status: 'armed',
    obCandleTime: D - 10 * H, watchFrom: D - 10 * H, entry: 100, stopLoss: 95, takeProfit: 110, rr: 2, confirmations: '{}', ...marken })
const verlust = (exitTime, netPnl = -40) => ({ instanceId: 60, positionId: 999, symbol: 'ANDERES', timeframe: '1h', direction: 'long', mode: 'paper',
    entryPrice: 100, exitPrice: 96, qty: 10, entryTime: exitTime - 2 * H, exitTime, exitReason: 'sl', netPnl })

/** Ein Takt zum Entscheid `D` (jüngste geschlossene Kerze beginnt D − 1 h). */
async function fall({ D, symbol = 'NVDAUSDT', aktie = AKTIE, risk = {}, vorher = null, marken = {} }) {
    await leeren()
    if (aktie) kontexte[symbol] = aktie
    globalThis.__engineMarkt = markt(D)
    await knex('strategy_instances').insert(instanz(symbol, risk))
    await knex('strategy_setups').insert(setup(symbol, D, marken))
    if (vorher) await vorher()
    await engine.tick()
    const s = await knex('strategy_setups').where('id', 700).first()
    const lauf = await knex('strategy_runs').where({ instanceId: 60, setupId: 700 }).orderBy('id', 'desc').first()
    const position = await knex('strategy_positions').where('instanceId', 60).first()
    return { status: s.status, grund: s.rejectReason || '', lauf, position }
}
const zeigt = (r) => `${r.status}/${r.grund || '–'} · ${r.lauf?.finalAction || 'kein Lauf'} „${r.lauf?.reason || ''}"`

// ── 1. Sperre `zahlentermin` ─────────────────────────────────────────────
console.log('\nZahlentermine: Signal im Fenster → reject_risk')
{
    // Dienstag, 10.11.2026, 11:00 New York — reguläre Sitzung. Auslösekerze beginnt 10:00.
    const D = Date.UTC(2026, 10, 10, 16)
    const K = D - H
    const mit = (zeiten, naechster = null) => ({ ...AKTIE, termine: { naechster: naechster ? { zeit: naechster, geschaetzt: false } : null, vergangene: zeiten } })
    const an = { meideZahlentermine: true }

    let r = await fall({ D, aktie: mit([], K + 10 * H), risk: an })
    pruefe('Termin in zehn Stunden: abgelehnt mit `zahlentermin`, kein Einstieg',
        r.status === 'rejected' && r.grund === 'zahlentermin' && r.lauf?.finalAction === 'reject_risk' && !r.position, zeigt(r))
    pruefe('der Verlauf nennt den Tag der Meldung', /^zahlentermin: Zahlen am 2026-11-11/.test(r.lauf?.reason || ''), r.lauf?.reason)

    r = await fall({ D, aktie: mit([K - 20 * H]), risk: an })
    pruefe('Termin vor zwanzig Stunden (vergangen): ebenfalls gesperrt', r.grund === 'zahlentermin' && !r.position, zeigt(r))

    r = await fall({ D, aktie: mit([], K + 24 * H), risk: an })
    pruefe('Rand: Meldung genau 24 h nach der Auslösekerze → noch im Fenster', r.grund === 'zahlentermin', zeigt(r))
    r = await fall({ D, aktie: mit([], K + 24 * H + 1), risk: an })
    pruefe('Rand: eine Millisekunde später → Einstieg', r.status === 'open' && r.lauf?.finalAction === 'execute' && Boolean(r.position), zeigt(r))
    r = await fall({ D, aktie: mit([K - 24 * H]), risk: an })
    pruefe('Rand: Meldung genau 24 h vor der Auslösekerze → noch im Fenster', r.grund === 'zahlentermin', zeigt(r))
    r = await fall({ D, aktie: mit([K - 24 * H - 1]), risk: an })
    pruefe('Rand: eine Millisekunde früher → Einstieg', r.status === 'open' && Boolean(r.position), zeigt(r))

    r = await fall({ D, aktie: mit([], K + 10 * H), risk: {} })
    pruefe('Schalter aus: Termin im Fenster sperrt nicht', r.status === 'open' && Boolean(r.position), zeigt(r))
    r = await fall({ D, aktie: { ...AKTIE, termine: null, termineGrund: 'quelleAus' }, risk: an })
    pruefe('Termine unbekannt: die Sperre wirkt nicht (nicht geraten)', r.status === 'open' && Boolean(r.position), zeigt(r))
    r = await fall({ D, symbol: 'BTCUSDT', aktie: null, risk: { ...an, nurRegulaereSitzung: true } })
    pruefe('Coin: beide Aktien-Schalter ohne Wirkung', r.status === 'open' && Boolean(r.position), zeigt(r))

    // Reihenfolge der Sperren und der verkürzte Handelstag (Freitag, 27.11.2026: Schluss 13:00)
    r = await fall({ D: Date.UTC(2026, 10, 15, 13), aktie: mit([], Date.UTC(2026, 10, 15, 20)), risk: { ...an, nurRegulaereSitzung: true } })
    pruefe('Sonntag UND Zahlen-Fenster: die Sitzungs-Sperre meldet sich zuerst',
        r.grund === 'ausserhalb_sitzung' && /Sitzung wochenende/.test(r.lauf?.reason || ''), zeigt(r))
    r = await fall({ D: Date.UTC(2026, 10, 27, 19), risk: { nurRegulaereSitzung: true } })
    pruefe('verkürzter Handelstag: Auslösekerze ab 13:00 New York ist nachbörslich → gesperrt',
        r.grund === 'ausserhalb_sitzung' && /Sitzung nach/.test(r.lauf?.reason || ''), zeigt(r))
    r = await fall({ D: Date.UTC(2026, 10, 27, 18), risk: { nurRegulaereSitzung: true } })
    pruefe('…die Kerze ab 12:00 noch regulär → Einstieg', r.status === 'open' && Boolean(r.position), zeigt(r))
    r = await fall({ D: Date.UTC(2026, 10, 25, 20), risk: { nurRegulaereSitzung: true } })
    pruefe('Gegenprobe: am Mittwoch davor ist 14:00 New York regulär', r.status === 'open', zeigt(r))
}

// ── 2. Tageslimit am New Yorker Handelstag ───────────────────────────────
console.log('\nTageslimit: Grenze 20:00 New York, auch über die Zeitumstellung')
{
    const tagFall = (D, exitTime, opt = {}) => fall({ D, ...opt, vorher: () => knex('strategy_trades').insert(verlust(exitTime)) })
    const gesperrt = (r) => r.grund === 'daily_loss_limit' && r.lauf?.finalAction === 'reject_risk' && !r.position
    const frei = (r) => r.status === 'open' && Boolean(r.position)

    // Winterzeit (New York = UTC − 5): der Handelstag vom 10.11.2026 beginnt 01:00 UTC.
    const W = Date.UTC(2026, 10, 10, 16)
    let r = await tagFall(W, Date.UTC(2026, 10, 10, 0, 30))
    pruefe('Winter: Verlust um 19:30 New York (00:30 UTC) gehört zum Vortag → Einstieg', frei(r), zeigt(r))
    r = await tagFall(W, Date.UTC(2026, 10, 10, 0, 30), { symbol: 'BTCUSDT', aktie: null })
    pruefe('Gegenprobe Coin: derselbe Verlust zählt (Tag ab Mitternacht UTC)', gesperrt(r), zeigt(r))
    r = await tagFall(W, Date.UTC(2026, 10, 10, 1, 0))
    pruefe('Winter: Verlust genau um 20:00 New York zählt zum neuen Handelstag → gesperrt', gesperrt(r), zeigt(r))
    r = await tagFall(W, Date.UTC(2026, 10, 10, 1, 0) - 1)
    pruefe('Winter: eine Millisekunde davor → Einstieg', frei(r), zeigt(r))
    r = await tagFall(W, Date.UTC(2026, 10, 10, 1, 30))
    pruefe('Winter: Verlust um 20:30 New York → gesperrt', gesperrt(r), zeigt(r))
    pruefe('das Protokoll nennt Verlust und Limit', /daily_loss_limit: heute -40\.00 USDT, Limit −30\.00/.test(r.lauf?.reason || ''), r.lauf?.reason)

    // Sommerzeit (UTC − 4): der Handelstag vom 16.6.2026 beginnt 00:00 UTC.
    const S = Date.UTC(2026, 5, 16, 16)
    r = await tagFall(S, Date.UTC(2026, 5, 16, 0, 30))
    pruefe('Sommer: Verlust um 20:30 New York (00:30 UTC) zählt → gesperrt (mit festem Winter-Versatz wäre er frei)', gesperrt(r), zeigt(r))
    r = await tagFall(S, Date.UTC(2026, 5, 15, 23, 30))
    pruefe('Sommer: Verlust um 19:30 New York → Einstieg', frei(r), zeigt(r))

    // Umstellung auf Sommerzeit: Sonntag, 8.3.2026, 02:00 → 03:00. Der Tag begann Samstag 20:00 EST = 01:00 UTC.
    const U1 = Date.UTC(2026, 2, 8, 16)
    r = await tagFall(U1, Date.UTC(2026, 2, 8, 0, 30))
    pruefe('Umstellungstag März: Verlust Samstag 19:30 (Winterzeit) → Einstieg', frei(r), zeigt(r))
    r = await tagFall(U1, Date.UTC(2026, 2, 8, 1, 30))
    pruefe('Umstellungstag März: Verlust Samstag 20:30 → gesperrt, obwohl der Entscheid schon in Sommerzeit fällt', gesperrt(r), zeigt(r))
    // Der Montag danach beginnt Sonntag 20:00 EDT = 00:00 UTC.
    const U2 = Date.UTC(2026, 2, 9, 16)
    r = await tagFall(U2, Date.UTC(2026, 2, 9, 0, 30))
    pruefe('Tag nach der Umstellung: Grenze liegt jetzt bei 00:00 UTC → Verlust um 00:30 UTC gesperrt', gesperrt(r), zeigt(r))
    r = await tagFall(U2, Date.UTC(2026, 2, 8, 23, 30))
    pruefe('…und 23:30 UTC am Vorabend zählt nicht', frei(r), zeigt(r))

    // Umstellung auf Winterzeit: Sonntag, 1.11.2026, 02:00 → 01:00. Der Tag begann Samstag 20:00 EDT = 00:00 UTC.
    const U3 = Date.UTC(2026, 10, 1, 16)
    r = await tagFall(U3, Date.UTC(2026, 10, 1, 0, 30))
    pruefe('Umstellungstag November: Verlust Samstag 20:30 (Sommerzeit) → gesperrt', gesperrt(r), zeigt(r))
    r = await tagFall(U3, Date.UTC(2026, 9, 31, 23, 30))
    pruefe('Umstellungstag November: Verlust Samstag 19:30 → Einstieg', frei(r), zeigt(r))
    // Der Montag danach beginnt Sonntag 20:00 EST = 01:00 UTC.
    const U4 = Date.UTC(2026, 10, 2, 16)
    r = await tagFall(U4, Date.UTC(2026, 10, 2, 0, 30))
    pruefe('Tag nach der Umstellung: Grenze wieder bei 01:00 UTC → Verlust um 00:30 UTC zählt nicht', frei(r), zeigt(r))
    r = await tagFall(U4, Date.UTC(2026, 10, 2, 1, 30))
    pruefe('…und 01:30 UTC zählt', gesperrt(r), zeigt(r))
}

// ── 3. Ausstieg, Funding, Wartungsmarge, Rutsch ──────────────────────────
console.log('\nAusstieg einer Aktien-Position: Ziel, Stop, Funding, Wartungsmarge 2,5 %')
{
    // Einstieg wie oben (Takt 1), danach laufen drei Kerzen weiter (Takt 2).
    async function verlauf({ D, form, funding = [], risk = {}, symbol = 'NVDAUSDT', aktie = AKTIE, marken = {} }) {
        const start = await fall({ D, symbol, aktie, risk, marken })
        if (!start.position) return { start }
        engine.resetSymbolCache()
        globalThis.__engineMarkt = markt(D + 3 * H, (t) => (t >= D ? form(t) : FLACH), funding)
        await engine.tick()
        return {
            start,
            position: await knex('strategy_positions').where('instanceId', 60).first(),
            trade: await knex('strategy_trades').where('instanceId', 60).first(),
            setup: await knex('strategy_setups').where('id', 700).first(),
        }
    }
    const D = Date.UTC(2026, 10, 10, 16)   // Dienstag, reguläre Sitzung

    // Ziel in der zweiten Kerze; eine Funding-Abrechnung dazwischen, eine nach dem Ausstieg.
    const fund = [{ t: D + 30 * M, rate: 0.0003, markPrice: 101 }, { t: D + 2 * H, rate: 0.0003, markPrice: 111 }]
    let v = await verlauf({ D, form: (t) => (t === D + H ? { o: 100, h: 111, l: 99.5, c: 110.5 } : FLACH), funding: fund })
    let t = v.trade
    const menge = Number(v.start.position?.qty)
    pruefe('Ziel erreicht: Position geschlossen, Trade mit Grund `tp` zur Zeit der Zielkerze',
        v.position?.status === 'closed' && t?.exitReason === 'tp' && Number(t.exitTime) === D + H && v.setup?.status === 'closed',
        `Position ${v.position?.status}, Trade ${t?.exitReason}`)
    pruefe('Ausstieg zum Zielkurs (Limit: kein Rutsch), Menge wie beim Einstieg', t && Number(t.exitPrice) === 110 && nah(t.qty, menge), `${t?.exitPrice}, ${t?.qty}`)
    pruefe('Funding = eine Abrechnung auf Menge × Mark-Preis, als Kosten des Longs',
        t && nah(t.funding, -menge * 101 * 0.0003), `${t?.funding} statt ${-menge * 101 * 0.0003}`)
    pruefe('Gebühren: Maker auf Einstieg und Ziel', t && nah(t.fees, (100 * menge + 110 * menge) * 2 / 10000), `${t?.fees}`)
    pruefe('Netto = Brutto − Gebühren + Funding', t && nah(t.netPnl, (110 - 100) * menge - Number(t.fees) + Number(t.funding)) && Number(t.netPnl) < 10 * menge, `${t?.netPnl}`)
    pruefe('R gegen den Ursprungsstop', t && nah(t.rMultiple, Number(t.netPnl) / (5 * menge)), `${t?.rMultiple}`)

    // Stop in der ersten Kerze danach.
    v = await verlauf({ D, form: (z) => (z === D ? { o: 100, h: 100.5, l: 94, c: 96 } : FLACH), funding: [] })
    t = v.trade
    pruefe('Stop gerissen: Grund `sl`, Ausstieg am Stop minus Rutsch (Marktorder), Taker-Gebühr',
        t?.exitReason === 'sl' && nah(t.exitPrice, 95 * (1 - 2 / 10000)) && nah(t.fees, 100 * menge * 2 / 10000 + Number(t.exitPrice) * menge * 6 / 10000),
        `${t?.exitReason} @ ${t?.exitPrice}, Gebühren ${t?.fees}`)
    pruefe('Verlust etwas grösser als 1 R (Kosten), Funding 0 ohne Abrechnung', t && Number(t.rMultiple) < -1 && Number(t.rMultiple) > -1.1 && Number(t.funding) === 0, `${t?.rMultiple} R`)

    // Short: positives Funding ist eine Gutschrift.
    v = await verlauf({ D, marken: { direction: 'short', stopLoss: 105, takeProfit: 90 }, form: (z) => (z === D + H ? { o: 100, h: 100.5, l: 89, c: 90 } : FLACH), funding: fund })
    t = v.trade
    pruefe('Short am Ziel: Funding mit positivem Satz ist eine Gutschrift', t?.exitReason === 'tp' && nah(t.funding, Number(t.qty) * 101 * 0.0003) && Number(t.funding) > 0, `${t?.exitReason}, Funding ${t?.funding}`)

    // Funding-Verlauf nicht abrufbar → die Annahme der Instanz (hier 1 bp je 8 h).
    await leeren()
    {
        kontexte.NVDAUSDT = AKTIE
        const D8 = Date.UTC(2026, 10, 10, 15)   // Einstieg 14:00 UTC, Abrechnung 16:00 UTC liegt in der Haltezeit
        globalThis.__engineMarkt = markt(D8)
        await knex('strategy_instances').insert(instanz('NVDAUSDT', { fundingBpsPer8h: 1 }))
        await knex('strategy_setups').insert(setup('NVDAUSDT', D8))
        await engine.tick()
        engine.resetSymbolCache()
        globalThis.__engineMarkt = { ...markt(D8 + 3 * H, (z) => (z === D8 + 2 * H ? { o: 100, h: 111, l: 99.5, c: 110 } : FLACH)), funding: async () => { throw new Error('Verlauf aus') } }
        await engine.tick()
        const tr = await knex('strategy_trades').where('instanceId', 60).first()
        pruefe('Funding-Verlauf nicht abrufbar: eine Abrechnung mit der Annahme der Instanz',
            tr?.exitReason === 'tp' && nah(tr.funding, -Number(tr.notionalUsdt) * 1 / 10000), `${tr?.exitReason}, Funding ${tr?.funding}`)
    }

    // Wartungsmarge: Hebel 20, Stop bei 96, Tief 97. Liquidation Long = 100 × (1 − 1/20) / (1 − Wartungsmarge).
    const hoch = { leverage: 20, maintenanceMarginPct: 0 }
    const tief = (z) => (z === D ? { o: 100, h: 100.5, l: 97, c: 98.5 } : FLACH)
    netz.length = 0
    v = await verlauf({ D, risk: hoch, marken: { stopLoss: 96, takeProfit: 108 }, form: tief })
    t = v.trade
    pruefe('Aktie ohne Tabelleneintrag: Wartungsmarge 2,5 % → Liquidation bei 97,44 VOR dem Stop',
        t?.exitReason === 'liquidation' && nah(t.exitPrice, 100 * 0.95 / 0.975 * (1 - 2 / 10000)), `${t?.exitReason} @ ${t?.exitPrice}`)
    pruefe('…gefragt wurden die Börsen (und im Test abgewiesen) — der Satz ist der Rückfall, keine Messung', netz.length > 0, `${netz.length} Abrufe`)
    v = await verlauf({ D, symbol: 'ALTUSDT', aktie: null, risk: hoch, marken: { stopLoss: 96, takeProfit: 108 }, form: tief })
    pruefe('Gegenprobe Coin: Rückfall 0,4 % → Liquidation erst bei 95,38, die Position bleibt offen',
        !v.trade && v.position?.status === 'open', `Trade ${v.trade?.exitReason}, Position ${v.position?.status}`)
    v = await verlauf({ D, risk: { leverage: 20, maintenanceMarginPct: 0.5 }, marken: { stopLoss: 96, takeProfit: 108 }, form: tief })
    pruefe('eigene Vorgabe 0,5 % schlägt den Aktien-Rückfall: Position bleibt offen', !v.trade && v.position?.status === 'open', `Trade ${v.trade?.exitReason}`)

    // Rutsch-Aufschlag ausserhalb der regulären Sitzung: Sonntag, 15.11.2026.
    const SO = Date.UTC(2026, 10, 15, 13)
    const stopKerze = (z) => (z === SO ? { o: 100, h: 100.5, l: 94, c: 96 } : FLACH)
    v = await verlauf({ D: SO, risk: { slippageAusserhalbBps: 50 }, form: stopKerze })
    pruefe('Wochenende, Aufschlag 50 bp: der Stop rutscht 2 + 50 bp',
        sitzungVon(SO) === 'wochenende' && v.trade?.exitReason === 'sl' && nah(v.trade.exitPrice, 95 * (1 - 52 / 10000)), `${v.trade?.exitReason} @ ${v.trade?.exitPrice}`)
    v = await verlauf({ D: SO, risk: {}, form: stopKerze })
    pruefe('Vorgabe (aus): 2 bp wie immer', nah(v.trade?.exitPrice, 95 * (1 - 2 / 10000)), `${v.trade?.exitPrice}`)
    v = await verlauf({ D: SO, symbol: 'BTCUSDT', aktie: null, risk: { slippageAusserhalbBps: 50 }, form: stopKerze })
    pruefe('Coin mit gesetztem Aufschlag: ohne Wirkung', nah(v.trade?.exitPrice, 95 * (1 - 2 / 10000)), `${v.trade?.exitPrice}`)
    v = await verlauf({ D, risk: { slippageAusserhalbBps: 50 }, form: (z) => (z === D ? { o: 100, h: 100.5, l: 94, c: 96 } : FLACH) })
    pruefe('reguläre Sitzung mit gesetztem Aufschlag: 2 bp', nah(v.trade?.exitPrice, 95 * (1 - 2 / 10000)), `${v.trade?.exitPrice}`)
}

// ── 4. Offene Position über einen Split ──────────────────────────────────
console.log('\nSplit: offene Papier-Position und wartende Setups')
{
    // Sprung S: die Kerzen davor stehen im alten Massstab, ab S im neuen.
    const S = Date.UTC(2026, 6, 15, 14)
    const reihe = (alt, neu, spaeter = () => null) => (t) => (t < S ? alt : spaeter(t) || neu)
    const ALT20 = { o: 480, h: 482, l: 478, c: 480 }
    const NEU20 = { o: 24, h: 24.1, l: 23.9, c: 24 }
    const SPLIT20 = { t: S, faktor: 20, text: '20:1' }
    const position = (marken = {}) => ({ id: 80, instanceId: 60, setupId: 700, mode: 'paper', broker: 'bitunix', symbol: 'KORUUSDT', timeframe: '1h',
        direction: 'long', qty: 2, initialQty: 2, entryPrice: 480, entryTime: S - 10 * H, stopLoss: 470, initialStopLoss: 470, takeProfit: 520,
        leverage: 5, notionalUsdt: 960, marginUsdt: 192, feeOpen: 0.192, maePrice: 478, mfePrice: 482,
        clientOrderId: 'ctj-60-700', lastCandleTime: S - 2 * H, status: 'open', ...marken })
    const stelle = async ({ aktie, pos = position(), enabled = 0, form, ende = S + 2 * H, funding = [] }) => {
        await leeren()
        if (aktie) kontexte.KORUUSDT = aktie
        globalThis.__engineMarkt = markt(ende, form, funding)
        await knex('strategy_instances').insert(instanz('KORUUSDT', {}, { enabled }))
        await knex('strategy_setups').insert({ ...setup('KORUUSDT', S, { entry: pos.entryPrice, stopLoss: pos.initialStopLoss, takeProfit: pos.takeProfit, direction: pos.direction }), status: 'open' })
        await knex('strategy_positions').insert(pos)
    }
    const lies = async () => ({
        p: await knex('strategy_positions').where('id', 80).first(),
        trade: await knex('strategy_trades').where('instanceId', 60).first(),
        vermerke: await knex('strategy_runs').where({ instanceId: 60, finalAction: 'split' }),
    })
    const KORU = { ...AKTIE, ticker: 'KORU', splits: [SPLIT20] }

    // Gegenprobe zuerst: ohne Split-Angaben reisst der Sprung den Stop — der Fehler, um den es geht.
    await stelle({ aktie: { ...KORU, splits: null, splitsGrund: 'quelleAus' }, form: reihe(ALT20, NEU20) })
    await engine.tick()
    let z = await lies()
    pruefe('Gegenprobe (Splits unbekannt): der Sprung 480 → 24 «reisst» den Stop, Verlust von 95 %',
        z.trade?.exitReason === 'sl' && Number(z.trade.exitPrice) < 25 && Number(z.trade.netPnl) < -900 && z.vermerke.length === 0,
        `${z.trade?.exitReason} @ ${z.trade?.exitPrice}, netto ${z.trade?.netPnl}`)

    // Vorwärts-Split 20:1
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20) })
    await engine.tick()
    z = await lies()
    pruefe('Vorwärts-Split 20:1: Position bleibt offen, kein Trade', z.p?.status === 'open' && !z.trade, `Status ${z.p?.status}, Trade ${z.trade?.exitReason}`)
    pruefe('Menge × 20, Einstieg, Stop, Ursprungsstop und Ziel ÷ 20',
        nah(z.p.qty, 40) && nah(z.p.initialQty, 40) && nah(z.p.entryPrice, 24) && nah(z.p.stopLoss, 23.5) && nah(z.p.initialStopLoss, 23.5) && nah(z.p.takeProfit, 26),
        JSON.stringify({ qty: z.p.qty, e: z.p.entryPrice, sl: z.p.stopLoss, tp: z.p.takeProfit }))
    pruefe('Geldbeträge bleiben: Nominalwert, Marge, Eröffnungsgebühr', nah(z.p.notionalUsdt, 960) && nah(z.p.marginUsdt, 192) && nah(z.p.feeOpen, 0.192))
    pruefe('MAE/MFE umgerechnet und auf den neuen Kerzen fortgeschrieben', nah(z.p.maePrice, 23.9) && nah(z.p.mfePrice, 24.1), `${z.p.maePrice} / ${z.p.mfePrice}`)
    pruefe('fortgeschrieben bis zur jüngsten Kerze', Number(z.p.lastCandleTime) === S + H)
    const vermerk = JSON.parse(z.p.splitsAngewendet || '[]')
    pruefe('Vermerk an der Position: Split, Faktor, Sprungkerze', vermerk.length === 1 && vermerk[0].t === S && vermerk[0].faktor === 20 && vermerk[0].bei === S, z.p.splitsAngewendet)
    pruefe('im Verlauf der Instanz vermerkt (`strategy_runs`, Aktion `split`)',
        z.vermerke.length === 1 && /^split: KORUUSDT 20:1 am 2026-07-15 — offene Position #80 umgerechnet: Menge 2 → 40, Einstieg 480 → 24, Stop 470 → 23\.5, Ziel 520 → 26$/.test(z.vermerke[0].reason),
        z.vermerke[0]?.reason)
    const aus = JSON.parse(z.vermerke[0]?.executionOutput || '{}')
    pruefe('…mit den Werten vorher und nachher', aus.art === 'split' && aus.vorher?.qty === 2 && aus.nachher?.qty === 40 && aus.vorher?.entryPrice === 480 && aus.nachher?.entryPrice === 24)

    // Idempotenz: derselbe Stand noch einmal, dann «Neustart zwischen Umrechnung und Fortschreiben».
    engine.resetSymbolCache()
    await engine.tick()
    z = await lies()
    pruefe('zweiter Takt auf denselben Kerzen: nichts ändert sich', nah(z.p.qty, 40) && nah(z.p.entryPrice, 24) && z.vermerke.length === 1, `Menge ${z.p.qty}, ${z.vermerke.length} Vermerke`)
    await knex('strategy_positions').where('id', 80).update({ lastCandleTime: S - 2 * H })
    engine.resetSymbolCache()
    await engine.tick()
    z = await lies()
    pruefe('Neustart nach der Umrechnung, vor dem Fortschreiben: kein zweites Mal (Vermerk), Position weiter offen',
        nah(z.p.qty, 40) && nah(z.p.entryPrice, 24) && nah(z.p.stopLoss, 23.5) && z.vermerke.length === 1 && z.p.status === 'open' && Number(z.p.lastCandleTime) === S + H,
        `Menge ${z.p.qty}, ${z.vermerke.length} Vermerke, ${z.p.status}`)

    // Zwei Prozesse zugleich: nur einer rechnet um.
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20) })
    const bericht = [{ t: S, faktor: 20, text: '20:1', angewendet: true, bei: S }]
    const beide = await Promise.all([1, 2].map(() => engine.rechneUeberSplitsUm({ instanceId: 60, symbol: 'KORUUSDT', timeframe: '1h', bericht, kerzeMs: H })))
    z = await lies()
    pruefe('zwei Umrechnungen gleichzeitig: genau eine greift', beide[0].positionen + beide[1].positionen === 1 && nah(z.p.qty, 40) && z.vermerke.length === 1,
        `${beide.map((b) => b.positionen).join('+')}, Menge ${z.p.qty}`)

    // Danach läuft die Position normal weiter — bis ans (umgerechnete) Ziel; Funding über den Split.
    const fund = [{ t: S - 5 * H, rate: 0.0001, markPrice: 480 }, { t: S + 30 * M, rate: 0.0001, markPrice: 24 }]
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20, (t) => (t === S + 2 * H ? { o: 24, h: 26.5, l: 23.9, c: 26.2 } : null)), ende: S + 4 * H, funding: fund })
    await engine.tick()
    z = await lies()
    pruefe('nach dem Split am umgerechneten Ziel geschlossen: 26 statt 520, Menge 40',
        z.trade?.exitReason === 'tp' && Number(z.trade.exitPrice) === 26 && nah(z.trade.qty, 40) && nah(z.trade.entryPrice, 24), `${z.trade?.exitReason} @ ${z.trade?.exitPrice}`)
    pruefe('Brutto wie ohne Split: (520 − 480) × 2 = (26 − 24) × 40 = 80', nah(z.trade?.grossPnl, 80), `${z.trade?.grossPnl}`)
    pruefe('R wie ohne Split (Risiko 10 je Stück × 2 = 0,5 × 40)', z.trade && nah(z.trade.rMultiple, Number(z.trade.netPnl) / 20), `${z.trade?.rMultiple}`)
    pruefe('Funding über den Split: die Abrechnung davor zählt mit dem Mark-Preis im neuen Massstab (zweimal 40 × 24 × 1 bp)',
        nah(z.trade?.funding, -2 * 40 * 24 * 0.0001), `${z.trade?.funding} statt ${-2 * 40 * 24 * 0.0001}`)

    // Rückwärts-Split 1:10 (Zusammenlegung): ein Long würde sonst «am Ziel» geschlossen.
    const ALT10 = { o: 2, h: 2.02, l: 1.98, c: 2 }
    const NEU10 = { o: 20, h: 20.2, l: 19.8, c: 20 }
    const penny = position({ qty: 100, initialQty: 100, entryPrice: 2, stopLoss: 1.8, initialStopLoss: 1.8, takeProfit: 2.4, notionalUsdt: 200, marginUsdt: 40, feeOpen: 0.04, maePrice: 1.98, mfePrice: 2.02 })
    await stelle({ aktie: { ...KORU, splits: null }, pos: penny, form: reihe(ALT10, NEU10) })
    await engine.tick()
    z = await lies()
    pruefe('Gegenprobe (Splits unbekannt): der Sprung 2 → 20 «erreicht» das Ziel, Scheingewinn',
        z.trade?.exitReason === 'tp' && Number(z.trade.netPnl) > 1500, `${z.trade?.exitReason}, netto ${z.trade?.netPnl}`)
    await stelle({ aktie: { ...KORU, splits: [{ t: S, faktor: 0.1, text: '1:10' }] }, pos: penny, form: reihe(ALT10, NEU10) })
    await engine.tick()
    z = await lies()
    pruefe('Rückwärts-Split 1:10: Menge ÷ 10, Einstieg, Stop und Ziel × 10, Position offen',
        z.p?.status === 'open' && !z.trade && nah(z.p.qty, 10) && nah(z.p.entryPrice, 20) && nah(z.p.stopLoss, 18) && nah(z.p.takeProfit, 24),
        JSON.stringify({ s: z.p?.status, qty: z.p?.qty, e: z.p?.entryPrice, sl: z.p?.stopLoss, tp: z.p?.takeProfit }))
    pruefe('…vermerkt als 1:10', z.vermerke.length === 1 && /1:10 am 2026-07-15/.test(z.vermerke[0].reason) && /Menge 100 → 10, Einstieg 2 → 20/.test(z.vermerke[0].reason), z.vermerke[0]?.reason)
    // Short über die Zusammenlegung: sonst risse der Stop.
    await stelle({ aktie: { ...KORU, splits: [{ t: S, faktor: 0.1, text: '1:10' }] }, form: reihe(ALT10, NEU10),
        pos: { ...penny, direction: 'short', stopLoss: 2.2, initialStopLoss: 2.2, takeProfit: 1.6 } })
    await engine.tick()
    z = await lies()
    pruefe('Short über die Zusammenlegung: offen, Stop 22, Ziel 16', z.p?.status === 'open' && !z.trade && nah(z.p.stopLoss, 22) && nah(z.p.takeProfit, 16), `${z.p?.status}, ${z.trade?.exitReason}`)

    // Nachgezogene Marken: ein nachgezogener Stop (475 statt 470) und ein Teilausstieg wandern mit.
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20),
        pos: position({ stopLoss: 475, breakEvenDone: 1, qty: 1, partialDone: 1, partialQty: 1, partialPrice: 500, partialGross: 20, partialFee: 0.1 }) })
    await engine.tick()
    z = await lies()
    pruefe('nachgezogener Stop und Teilausstieg umgerechnet, Ursprungsstop und gebuchtes Teilergebnis richtig',
        z.p?.status === 'open' && nah(z.p.stopLoss, 23.75) && nah(z.p.initialStopLoss, 23.5) && nah(z.p.qty, 20) && nah(z.p.initialQty, 40)
        && nah(z.p.partialQty, 20) && nah(z.p.partialPrice, 25) && nah(z.p.partialGross, 20) && Number(z.p.breakEvenDone) === 1,
        JSON.stringify({ s: z.p?.status, sl: z.p?.stopLoss, isl: z.p?.initialStopLoss, qty: z.p?.qty, pq: z.p?.partialQty, pp: z.p?.partialPrice }))

    // Position, die erst NACH dem Sprung entstand (schon im neuen Massstab): bleibt, wie sie ist.
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20), ende: S + 4 * H,
        pos: position({ qty: 40, initialQty: 40, entryPrice: 24, stopLoss: 23.5, initialStopLoss: 23.5, takeProfit: 26, maePrice: 24, mfePrice: 24, entryTime: S + H, lastCandleTime: S + H }) })
    await engine.tick()
    z = await lies()
    pruefe('Position nach dem Sprung eröffnet: nicht umgerechnet, kein Vermerk', z.p?.status === 'open' && nah(z.p.qty, 40) && nah(z.p.entryPrice, 24) && z.vermerke.length === 0, `Menge ${z.p?.qty}`)
    await stelle({ aktie: KORU, form: reihe(ALT20, NEU20), ende: S + 3 * H,
        pos: position({ qty: 40, initialQty: 40, entryPrice: 24, stopLoss: 23.5, initialStopLoss: 23.5, takeProfit: 26, maePrice: 24, mfePrice: 24, entryTime: S, lastCandleTime: S - 1 }) })
    await engine.tick()
    z = await lies()
    pruefe('Einstieg zur Eröffnung der Sprungkerze (Stand = ihr Beginn − 1 ms): ebenfalls nicht umgerechnet', z.p?.status === 'open' && nah(z.p.qty, 40) && z.vermerke.length === 0, `Menge ${z.p?.qty}`)

    // Coin mit demselben Kursbild: nichts wird umgerechnet (Coins unverändert).
    await stelle({ aktie: null, form: reihe(ALT20, NEU20) })
    await engine.tick()
    z = await lies()
    pruefe('Coin mit demselben Sprung: keine Umrechnung — der Stop greift wie eh und je', z.trade?.exitReason === 'sl' && z.vermerke.length === 0, `${z.trade?.exitReason}`)

    // Wartende Setups: das alte wird beendet, ein auf bereinigten Kerzen entstandenes bleibt.
    registerStrategy({ id: 'test_split_setup', name: 'Split-Setup', supportedTimeframes: ['1h'], params: [], warmupCandles: 50,
        detect({ candles, openSetups, knownSetupKeys }) {
            const k = candles[candles.length - 1]
            const ob = S - 3 * H
            const kerzeOb = candles.find((c) => c.t === ob)
            const setups = knownSetupKeys.includes(`long|${ob}`) || !kerzeOb ? [] : [{
                direction: 'long', status: 'armed', obHigh: kerzeOb.h, obLow: kerzeOb.l, obCandleTime: ob, watchFrom: ob,
                entry: kerzeOb.l, stopLoss: kerzeOb.l * 0.95, takeProfit: kerzeOb.l * 1.2, rr: 4,
            }]
            // Das alte Setup (Einstieg 480) würde auf der ersten Kerze im neuen Massstab «ausgelöst».
            const events = openSetups.filter((s) => s.entry > 100).map((s) => ({ id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
                entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit }))
            return { setups, events }
        } })
    const setupFall = async (aktie) => {
        await leeren()
        if (aktie) kontexte.KORUUSDT = aktie
        globalThis.__engineMarkt = markt(S + 2 * H, reihe(ALT20, NEU20))
        await knex('strategy_instances').insert({ ...instanz('KORUUSDT'), strategyId: 'test_split_setup' })
        await knex('strategy_setups').insert({ ...setup('KORUUSDT', S, { entry: 480, stopLoss: 470, takeProfit: 520 }), strategyId: 'test_split_setup', obCandleTime: S - 6 * H })
        await engine.tick()
        globalThis.__engineMarkt = markt(S + 3 * H, reihe(ALT20, NEU20))
        await engine.tick()
        return {
            alt: await knex('strategy_setups').where('id', 700).first(),
            neu: await knex('strategy_setups').where('instanceId', 60).whereNot('id', 700).first(),
            trades: await knex('strategy_trades').where('instanceId', 60),
            positionen: await knex('strategy_positions').where('instanceId', 60),
        }
    }
    let sf = await setupFall({ ...KORU, splits: null })
    pruefe('Gegenprobe (Splits unbekannt): das alte Setup wird im neuen Massstab «ausgelöst» und als Verlust gebucht',
        sf.trades.length === 1 && Number(sf.trades[0].netPnl) < 0, `${sf.trades.length} Trades, Setup ${sf.alt?.status}`)
    sf = await setupFall(KORU)
    pruefe('wartendes Setup aus der Zeit vor dem Split: beendet mit Grund `split`, kein Einstieg',
        sf.alt?.status === 'invalidated' && sf.alt.invalidReason === 'split' && Number(sf.alt.endeT) === S && sf.trades.length === 0 && sf.positionen.length === 0,
        `${sf.alt?.status}/${sf.alt?.invalidReason}, ${sf.trades.length} Trades`)
    pruefe('Setup, das auf bereinigten Kerzen entstand: Marken im neuen Massstab, trägt den Split im Vermerk und bleibt über den nächsten Takt',
        sf.neu?.status === 'armed' && nah(sf.neu.entry, 478 / 20) && JSON.parse(sf.neu.splitsAngewendet || '[]')[0]?.t === S,
        `${sf.neu?.status}, Einstieg ${sf.neu?.entry}, Vermerk ${sf.neu?.splitsAngewendet}`)
}

console.warn = warnEcht
await engine.stopStrategyEngine().catch(() => {})
await knex.destroy()
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
