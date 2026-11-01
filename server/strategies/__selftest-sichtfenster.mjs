/**
 * Selbsttest: Sichtfenster, Zeitablauf, Codes, Komplexitätsgrenzen, Funding-
 * Abdeckung und HTF-Vorlauf im Backtest (Audit 4.3.4).
 *
 *   node server/strategies/__selftest-sichtfenster.mjs
 *
 * Abgedeckt:
 *   - FUN-S4-002: ein Zeitablauf länger als das Sichtfenster (550 Kerzen)
 *     greift — und zwar genau nach N Kerzen.
 *   - FUN-S4-003: eine Indikatorperiode über dem bisherigen Fenster (EMA 600)
 *     findet ihre Signale; das Fenster wächst mit (`sichtFensterKerzen`).
 *   - FUN-L4-004: Set and Forget ohne HTF-Filter mit zweiter Ebene bekommt
 *     so viele Kerzen, wie `zonenFensterHtf` verlangt (`ltfKerzen`).
 *   - BUG-S4-004: Codes wie `constructor`/`__proto__` verfälschen den
 *     Trichter nicht mehr.
 *   - SEC-S4-001: Komplexitätsgrenzen in `pruefeRegeln`, Rechenzeit-Grenze
 *     und Abbruch im Backtest.
 *   - FUN-F1-007: ein Funding-Verlauf, der erst spät beginnt, heisst
 *     'teilweise'; davor gilt die Annahme.
 *   - BUG-L4-003: HTF-Kerzen ohne Vorlauf werden als `vorlaufFehlt` gemeldet.
 *
 * Kein Netz: alle Kerzen erfunden, Börsenregeln und Funding übergeben.
 * Gegenprobe gemacht: mit dem Stand vor den Fixes schlagen alle Gruppen fehl.
 */

import { pruefeRegeln, KOMPLEXITAET } from './rule-validate.js'
import { alsManifest, detectMitRegeln } from './rule-engine.js'
import { getStrategy, validateParams, sichtFensterKerzen } from './index.js'
import { runBacktest } from '../strategy-backtest.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3600000
const TAG = 24 * H
const RISIKO = { maintenanceMarginPct: 0.5, minRR: 0.1 }

console.log('\nSichtfenster und Grenzen — Selbsttest\n')

// ── Zeitablauf länger als das Sichtfenster ───────────────────────────────
console.log('Zeitablauf über dem Sichtfenster (FUN-S4-002)')
{
    // Signal bei Kerze 700 (Schluss kreuzt über 50), Rücklauf zum Limit 40
    // erst bei Kerze 2400 — 1700 Kerzen später.
    const SIG = 700
    const t0 = Date.UTC(2026, 2, 2)
    let saat = 7
    const rnd = () => (saat = (saat * 16807) % 2147483647) / 2147483647
    const kerzen = []
    for (let i = 0; i < 3000; i++) {
        const p = (i < SIG ? 45 : i < 2400 ? 55 : 39) + (rnd() - 0.5) * 0.8
        kerzen.push({ t: t0 + i * H, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 500 })
    }
    const regeln = (timeout) => pruefeRegeln({
        id: 'zeitablauf_test', timeframes: ['1h'], direction: 'long',
        signal: { type: 'crossUp', a: 'close', b: { value: 50 } },
        entry: { type: 'touch', anchor: { value: 40 }, from: 'above' },
        invalidations: [{ type: 'timeout', code: 'abgelaufen', candles: timeout }],
        stopLoss: { anchor: { value: 30 } }, takeProfit: { mode: 'rr', rr: 2 },
    }).regeln
    for (const n of [549, 550, 1000, 1600]) {
        const e = await runBacktest({
            strategie: alsManifest(regeln(n)), params: {}, risk: RISIKO, symbol: 'XUSDT', timeframe: '1h',
            candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: kerzen[0].t, toTs: kerzen.at(-1).t,
        })
        check(`Zeitablauf ${n}: das Setup läuft ab, statt 1700 Kerzen später gefüllt zu werden`,
            e.trades.length === 0 && e.funnel.invalidated.abgelaufen === 1,
            JSON.stringify({ trades: e.trades.length, invalidated: e.funnel.invalidated }))
    }
    // Genau nach N Kerzen: Fenster von 550 Kerzen, das 600 Kerzen nach dem
    // Signal beginnt — der Ablauf bei N = 1000 fällt auf Kerze SIG + 1000.
    const r = regeln(1000)
    const setup = {
        id: 1, direction: 'long', status: 'waiting_retest', obCandleTime: kerzen[SIG].t,
        watchFrom: kerzen[SIG].t, tradeableFrom: kerzen[SIG].t, signalPrice: 50, obHigh: 50, obLow: 50,
    }
    const ablauf = (bis) => detectMitRegeln(r, { candles: kerzen.slice(bis - 550, bis), params: {}, openSetups: [setup] })
        .events.find((ev) => ev.id === 1)
    check('vor Kerze SIG + 1000 läuft es noch nicht ab', !ablauf(SIG + 1000), JSON.stringify(ablauf(SIG + 1000)))
    const ev = ablauf(SIG + 1001)
    check('mit Kerze SIG + 1000 läuft es ab (N Kerzen, gezählt ab dem Zeitstempel)',
        ev && ev.status === 'expired' && ev.candleTime === kerzen[SIG + 1000].t,
        JSON.stringify(ev))
}

// ── Indikatorperiode über dem Sichtfenster ───────────────────────────────
console.log('\nIndikatorperiode über dem Sichtfenster (FUN-S4-003)')
{
    let s = 7
    const zufall = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const T0 = Date.UTC(2026, 0, 1)
    const kerzen = []
    let p = 100
    for (let i = 0; i < 4000; i++) {
        const o = p
        p = p * (1 + 0.006 * Math.sin(i / 60) + 0.003 * Math.sin(i / 25) + (zufall() - 0.5) * 0.01)
        kerzen.push({ t: T0 + i * H, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 1000 })
    }
    const regeln = (langsam) => pruefeRegeln({
        id: 'periode_test', timeframes: ['1h'], direction: 'long',
        indicators: [{ id: 'emaF', type: 'ema', period: 50 }, { id: 'emaS', type: 'ema', period: langsam }],
        signal: { type: 'crossUp', a: 'emaF', b: 'emaS' },
        entry: { type: 'immediate' }, invalidations: [{ type: 'timeout', candles: 5 }],
        stopLoss: { anchor: 'signalLow', offsetPct: 0.5 }, takeProfit: { mode: 'rr', rr: 2 },
    }).regeln
    for (const langsam of [560, 600]) {
        const m = alsManifest(regeln(langsam))
        const fenster = sichtFensterKerzen(m, {}, H)
        const e = await runBacktest({
            strategie: m, symbol: 'TESTUSDT', timeframe: '1h', candles: kerzen, risk: { maintenanceMarginPct: 0.5 },
            marketMeta: {}, fundingVerlauf: [], fromTs: kerzen[0].t, toTs: kerzen.at(-1).t,
        })
        check(`EMA ${langsam}: Sichtfenster wächst über die Periode hinaus (${fenster} Kerzen)`,
            fenster >= langsam + 200, String(fenster))
        check(`EMA ${langsam}: die Strategie findet ihre Kreuzungen (Trades > 0)`,
            e.trades.length > 0, String(e.trades.length))
    }
    // Die Vorgaben der Vorlagen bleiben beim bisherigen Fenster.
    const kurz = alsManifest(regeln(200))
    check('EMA 200: Fenster bleibt beim Grundfenster (550)', sichtFensterKerzen(kurz, {}, H) === 550,
        String(sichtFensterKerzen(kurz, {}, H)))
    // Die Engine kann keine ganze Historie halten — sie bekommt eine Zahl.
    const ath = alsManifest(pruefeRegeln({
        id: 'ath_test', timeframes: ['1h'], direction: 'long',
        indicators: [{ id: 'v', type: 'vwap', anchor: 'ath' }, { id: 'e', type: 'ema', period: 700 }],
        signal: { type: 'crossUp', a: 'close', b: 'e' }, entry: { type: 'immediate' },
        stopLoss: { anchor: 'low' }, takeProfit: { mode: 'rr', rr: 2 },
    }).regeln)
    check('ATH-Anker: Backtest nimmt die ganze Historie', sichtFensterKerzen(ath, {}, H) === Infinity)
    check('ATH-Anker: Engine bekommt trotzdem die Periode der EMA', sichtFensterKerzen(ath, {}, H, { endlich: true }) >= 900,
        String(sichtFensterKerzen(ath, {}, H, { endlich: true })))
}

// ── Set and Forget: eigenes Fenster ohne HTF-Filter ─────────────────────
console.log('\nSet and Forget ohne HTF-Filter (FUN-L4-004)')
{
    const snf = getStrategy('set_and_forget')
    const p = (zonen, zweite = true) => validateParams('set_and_forget',
        { htfTrendFilter: false, zweiteEbene: zweite, zonenFensterHtf: zonen }).values
    check('Vorgabe 250: Fenster bleibt 550', sichtFensterKerzen(snf, p(250), 4 * H) === 550,
        String(sichtFensterKerzen(snf, p(250), 4 * H)))
    check('zonenFensterHtf 1000: Fenster mindestens 1000', sichtFensterKerzen(snf, p(1000), 4 * H) >= 1000,
        String(sichtFensterKerzen(snf, p(1000), 4 * H)))
    check('mit HTF-Filter braucht die Handelszeiteinheit nichts extra',
        sichtFensterKerzen(snf, validateParams('set_and_forget', { zonenFensterHtf: 1000 }).values, 4 * H) === 550)
    // Der Detector bekommt diese Kerzen auch wirklich zu sehen.
    let gesehen = 0
    const zaehler = { ...snf, detect: ({ candles }) => { gesehen = Math.max(gesehen, candles.length); return { setups: [], events: [], diagnostics: {} } } }
    const kerzen = Array.from({ length: 1500 }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * 4 * H, o: 100, h: 101, l: 99, c: 100, v: 1 }))
    await runBacktest({
        strategyId: 'set_and_forget', strategie: zaehler, params: p(1000), risk: RISIKO, symbol: 'TESTUSDT', timeframe: '4h',
        candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: kerzen[0].t, toTs: kerzen.at(-1).t,
    })
    check('der Detector sieht mindestens 1000 Kerzen', gesehen >= 1000, String(gesehen))
}

// ── Codes aus dem Prototyp ───────────────────────────────────────────────
console.log('\nCodes wie constructor/__proto__ (BUG-S4-004)')
{
    let p = 50
    let saat = 99
    const rnd = () => (saat = (saat * 48271) % 2147483647) / 2147483647
    const kerzen = Array.from({ length: 1200 }, (_, i) => {
        const o = p
        p *= 1 + (rnd() - 0.5) * 0.012
        return { t: Date.UTC(2026, 1, 1) + i * H, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 500 }
    })
    for (const code of ['constructor', '__proto__', 'toString']) {
        const g = pruefeRegeln({
            id: 'code_test', timeframes: ['1h'],
            indicators: [{ id: 'e', type: 'ema', period: 10 }],
            signal: { type: 'pivotLow', left: 2, right: 2 },
            signalFilters: [{ op: 'lt', left: 'close', right: { value: 0 }, code }],
            entry: { type: 'immediate' }, stopLoss: { anchor: 'signalLow', offsetPct: 0.3 }, takeProfit: { mode: 'rr', rr: 1.5 },
        })
        const gespeichert = g.regeln.signalFilters[0].code
        const e = await runBacktest({
            strategie: alsManifest(g.regeln), params: {}, risk: { maintenanceMarginPct: 0.5 }, symbol: 'XUSDT', timeframe: '1h',
            candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: kerzen[0].t, toTs: kerzen.at(-1).t,
        })
        const n = e.funnel.invalidated[gespeichert]
        check(`Code "${code}": der Trichter zählt eine Zahl (${gespeichert}: ${n})`,
            Number.isInteger(n) && n > 0 && n === e.funnel.sweepsFound,
            JSON.stringify(e.funnel.invalidated).slice(0, 120))
    }
}

// ── Komplexitätsgrenzen und Rechenzeit ───────────────────────────────────
console.log('\nKomplexitätsgrenzen (SEC-S4-001)')
{
    const basis = {
        id: 'grenzen_test', timeframes: ['15m'],
        signal: { type: 'pivotLow', left: 5, right: 2 }, entry: { type: 'immediate' },
        stopLoss: { anchor: 'low' }, takeProfit: { mode: 'rr', rr: 2 },
    }
    const stoch = pruefeRegeln({ ...basis, indicators: [{ id: 's', type: 'stochK', period: 10000, smoothK: 5000 }] })
    check('Stochastik mit Periode 10 000 wird abgelehnt', !stoch.ok && stoch.fehler.some((f) => f.includes('Periode')),
        JSON.stringify(stoch.fehler))
    const viaParam = pruefeRegeln({
        ...basis, params: [{ key: 'laenge', type: 'integer', default: 50, min: 1, max: 100000 }],
        indicators: [{ id: 'e', type: 'ema', period: { param: 'laenge' } }],
    })
    check('eine Periode über einen Parameter zählt mit dessen Obergrenze', !viaParam.ok
        && viaParam.fehler.some((f) => f.includes('laenge')), JSON.stringify(viaParam.fehler))
    const fenster = pruefeRegeln({ ...basis, signal: { type: 'levelTouch', line: 'close', window: 5000 } })
    check('Rückblick 5000 wird abgelehnt', !fenster.ok, JSON.stringify(fenster.fehler))
    const imRahmen = pruefeRegeln({ ...basis, indicators: [{ id: 'e', type: 'ema', period: KOMPLEXITAET.periode }] })
    check(`Periode ${KOMPLEXITAET.periode} liegt im Rahmen`, imRahmen.ok, JSON.stringify(imRahmen.fehler))
    const geladen = pruefeRegeln({ ...basis, indicators: [{ id: 's', type: 'stochK', period: 10000 }] }, { komplexitaet: false })
    check('gespeicherte Strategien laden ohne Grenzen weiter', geladen.ok, JSON.stringify(geladen.fehler))

    // Rechenzeit: ein Detector, der je Takt 5 ms rechnet, über 2000 Kerzen.
    const kerzen = Array.from({ length: 2000 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * 900000, o: 100, h: 101, l: 99, c: 100, v: 1 }))
    const langsam = {
        id: 'langsam', name: 'langsam', params: [], supportedTimeframes: ['15m'], warmupCandles: 20,
        detect: () => { const bis = Date.now() + 5; while (Date.now() < bis) { /* rechnen */ } return { setups: [], events: [], diagnostics: {} } },
    }
    const opts = { strategie: langsam, strategyId: 'langsam', params: {}, risk: RISIKO, symbol: 'XUSDT', timeframe: '15m',
        candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: kerzen[0].t, toTs: kerzen.at(-1).t }
    const beginn = Date.now()
    const zeit = await runBacktest({ ...opts, zeitBudgetMs: 200 })
    check('die Rechenzeit-Grenze bricht den Lauf ab', zeit.stats.abgebrochen === 'zeit' && Date.now() - beginn < 2000,
        `${zeit.stats.abgebrochen} nach ${Date.now() - beginn} ms`)
    let gefragt = 0
    const weg = await runBacktest({ ...opts, abbrechen: () => ++gefragt > 2 })
    check('ein Abbruch von aussen beendet den Lauf', weg.stats.abgebrochen === 'abbruch', String(weg.stats.abgebrochen))
}

// ── Funding-Verlauf deckt den Zeitraum nur teilweise ─────────────────────
console.log('\nFunding-Abdeckung (FUN-F1-007)')
{
    const T0 = Date.UTC(2025, 9, 1)
    const ende = T0 + 365 * TAG
    const ab = ende - 90 * TAG
    const kerzen = Array.from({ length: 365 * 6 }, (_, i) => ({ t: T0 + i * 4 * H, o: 100, h: 100.5, l: 99.5, c: 100, v: 1 }))
    const verlauf = []
    for (let t = ab; t < ende; t += 8 * H) verlauf.push({ t, rate: 0.0001, markPrice: 100 })
    const manifest = {
        id: 'funding_test', name: 'f', params: [], supportedTimeframes: ['4h'], warmupCandles: 20, regeln: { maxHoldCandles: 18 },
        detect({ candles: sicht, openSetups }) {
            const idx = Math.round((sicht.at(-1).t - T0) / (4 * H))
            const events = openSetups.filter((s) => idx === s._ausloeser).map((s) => ({
                id: s.id, status: 'triggered', candleTime: sicht.at(-1).t, triggeredAt: sicht.at(-1).t, entryAtOpen: true, entryTrigger: 'market',
            }))
            const setups = idx >= 30 && idx % 60 === 0
                ? [{ direction: 'long', entry: 100, stopLoss: 90, takeProfit: 150, obCandleTime: sicht.at(-1).t, _ausloeser: idx + 1 }] : []
            return { setups, events, diagnostics: {} }
        },
    }
    const lauf = (bps) => runBacktest({
        strategyId: 'funding_test', strategie: manifest, params: {}, risk: { ...RISIKO, fundingBpsPer8h: bps },
        symbol: 'XUSDT', timeframe: '4h', market: 'futures', candles: kerzen, fromTs: T0, toTs: ende, marketMeta: {}, fundingVerlauf: verlauf,
    })
    const ohne = await lauf(0)
    check('ein Verlauf erst ab Tag 275 heisst „teilweise", mit Datum',
        ohne.stats.fundingQuelle === 'teilweise' && ohne.stats.fundingAbdeckungAb === ab,
        `${ohne.stats.fundingQuelle} ${ohne.stats.fundingAbdeckungAb}`)
    const mit = await lauf(1)
    const vorher = mit.trades.filter((t) => t.exitReason !== 'open_at_end' && t.exitTime < ab)
    check('Trades vor dem Verlaufsbeginn tragen die Annahme statt 0',
        vorher.length > 0 && vorher.every((t) => t.funding < 0),
        `${vorher.length} Trades, Funding ${vorher.slice(0, 3).map((t) => t.funding.toFixed(4)).join(' ')}`)
    const voll = await runBacktest({
        strategyId: 'funding_test', strategie: manifest, params: {}, risk: RISIKO, symbol: 'XUSDT', timeframe: '4h', market: 'futures',
        candles: kerzen, fromTs: T0, toTs: ende, marketMeta: {},
        fundingVerlauf: Array.from({ length: 365 * 3 }, (_, i) => ({ t: T0 + i * 8 * H, rate: 0.0001, markPrice: 100 })),
    })
    check('ein Verlauf über den ganzen Zeitraum heisst weiter „verlauf"', voll.stats.fundingQuelle === 'verlauf',
        String(voll.stats.fundingQuelle))
}

// ── HTF-Kerzen ohne Vorlauf ──────────────────────────────────────────────
console.log('\nHTF-Vorlauf (BUG-L4-003)')
{
    const manifest = {
        id: 'htf_test', name: 'htf', supportedTimeframes: ['4h'], warmupCandles: 20, htfKerzen: 100,
        params: [{ key: 'htfTrendFilter', type: 'boolean', default: true }, { key: 'htfTimeframe', type: 'string', default: '1d' },
            { key: 'htfEmaPeriod', type: 'integer', default: 20, min: 1, max: 200 }],
        detect: () => ({ setups: [], events: [], diagnostics: {} }),
    }
    const von = Date.UTC(2026, 0, 1)
    const kerzen = Array.from({ length: 600 }, (_, i) => ({ t: von + i * 4 * H, o: 100, h: 101, l: 99, c: 100, v: 1 }))
    const tage = (ab) => Array.from({ length: 300 }, (_, i) => ({ t: ab + i * TAG, o: 100, h: 101, l: 99, c: 100, v: 1 })).filter((k) => k.t < kerzen.at(-1).t)
    const lauf = (htf) => runBacktest({
        strategyId: 'htf_test', strategie: manifest, params: {}, risk: RISIKO, symbol: 'XUSDT', timeframe: '4h',
        candles: kerzen, htfCandles: htf, marketMeta: {}, fundingVerlauf: [], fromTs: von, toTs: kerzen.at(-1).t,
    })
    const ohne = await lauf(tage(von))
    check('HTF-Kerzen erst ab Laufbeginn: als vorlaufFehlt gemeldet', ohne.stats.htfFilter.vorlaufFehlt === true,
        JSON.stringify(ohne.stats.htfFilter))
    const mit = await lauf(tage(von - 100 * TAG))
    check('mit vollem Vorlauf keine Meldung', !mit.stats.htfFilter.vorlaufFehlt, JSON.stringify(mit.stats.htfFilter))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(`\nFehlgeschlagen:\n  ${fehler.join('\n  ')}\n`); process.exit(1) }
console.log('')
