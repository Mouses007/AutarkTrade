/**
 * Momentum Swing — Signalpunkt des Momentum Radars als Setup, Einstieg tiefer
 * per Limit im Rücksetzer.
 *
 * Entstanden aus der Strategie-Forschung vom 29.10.2026 (12 Coins, 2019 bis
 * heute, Regeln nur auf 2019–2023 gewählt). Dort hiess sie „Kandidat F":
 *
 *   1. Ein Signalpunkt des Momentum Radars auf der eigenen Zeiteinheit
 *      (WaveTrend kreuzt seine Signallinie in der Zone ≤ −50 bzw. ≥ +50,
 *      `signale()` aus `momentum-radar.js` — dieselbe Rechnung wie die Kachel).
 *   2. Nur in Richtung des Tagestrends DESSELBEN Coins: Long, wenn die letzte
 *      bei Schluss der Punktkerze geschlossene Tageskerze über ihrer EMA50
 *      schliesst, Short darunter.
 *   3. Keine Punkte, deren Kerze am Samstag oder Sonntag (UTC) schliesst. Das
 *      war der robusteste Einzelbefund der Forschung: Wochenend-Punkte waren in
 *      jedem Jahr, auf beiden Seiten und bei 11 von 12 Coins schlecht.
 *   4. Stop hinter dem Extrem der letzten fünf Kerzen (mit Puffer), Einstieg
 *      als Limit 25 % vom Schlusskurs Richtung Stop, gültig 24 Stunden.
 *   5. Ziel 2R, Zeitausstieg nach zehn Tagen.
 *
 * Gemessen (Maker-Limit, Taker-Stop, Slippage; ohne Funding): IS 703 Trades
 * Ø +0,16 R, 2024–2026 560 Trades Ø +0,19 R, Treffer 41 % bei einer
 * Gewinnschwelle von 35 %. Die Kante ist dünn, die Durststrecken sind lang
 * (längste Verlustserie 19, bis 503 Tage unter dem Höchststand). Diese
 * Strategie existiert, um das im Papierbetrieb NACH VORNE zu prüfen — die
 * Rückblick-Daten sind ausgeschöpft.
 *
 * Bewusst NICHT verwendet: grosse Punkte (`stark`) und Divergenzen — beide
 * trugen in der Forschung nichts. Darum braucht die Strategie nur die Kerzen
 * der eigenen Zeiteinheit und die Tageskerzen des Trendfilters.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import { ema } from './indicators.js'
import { welle, signale } from '../momentum-radar.js'

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
    WOCHENTAG_GESPERRT: 'weekday_blocked',
    TREND_DAGEGEN: 'trend_against',
    TREND_UNBEKANNT: 'trend_unknown',
    STOP_UNGUELTIG: 'invalid_stop',
    NICHT_GEFUELLT: 'limit_expired',
}

const params = [
    // ── Einstieg ──────────────────────────────────────────────
    // Anteil der Strecke Schlusskurs → Stop, um den das Limit tiefer (Long)
    // bzw. höher (Short) liegt. 0 = Limit auf dem Schlusskurs.
    { key: 'limitAnteil', type: 'number', default: 0.25, min: 0, max: 0.9, step: 0.05, group: 'entry' },
    // Wie viele Kerzen nach der Punktkerze das Limit liegen bleibt (4h × 6 = 24 h).
    { key: 'limitGueltigKerzen', type: 'integer', default: 6, min: 1, max: 48, step: 1, group: 'entry' },
    // Nur Punkte der letzten N Kerzen werden als neue Setups angelegt — ältere
    // hätten ihr Limit ohnehin schon verfallen lassen.
    { key: 'scanWindowCandles', type: 'integer', default: 8, min: 1, max: 200, step: 1, group: 'entry' },

    // ── Filter ────────────────────────────────────────────────
    // Trendfilter über die Tageskerzen. Der Schalter muss an sein, damit die
    // Engine die Kerzen der höheren Zeiteinheit überhaupt lädt.
    { key: 'htfTrendFilter', type: 'boolean', default: true, group: 'filter' },
    { key: 'htfTimeframe', type: 'select', default: '1d', options: ['1d', '1w'], group: 'filter' },
    { key: 'htfEmaPeriod', type: 'integer', default: 50, min: 5, max: 200, step: 1, group: 'filter' },
    { key: 'sperreWochenende', type: 'boolean', default: true, group: 'filter' },

    // ── Ausstieg ──────────────────────────────────────────────
    { key: 'stopKerzen', type: 'integer', default: 5, min: 1, max: 30, step: 1, group: 'exit' },
    { key: 'slBufferPct', type: 'number', default: 0.2, min: 0, max: 3, step: 0.05, group: 'exit' },
    { key: 'tpRR', type: 'number', default: 2, min: 0.5, max: 10, step: 0.25, group: 'exit' },
    // Zehn Tage auf 4h. Die Engine schliesst zum Schluss der Kerze, deren
    // Beginn `maxHoldCandles` Kerzen nach dem Einstieg liegt — 59 heisst also
    // „Schluss der 60. Kerze ab der Füllkerze".
    { key: 'maxHoldCandles', type: 'integer', default: 59, min: 0, max: 2000, step: 1, group: 'exit' },
    { key: 'breakEvenAtR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
]

const paramGroups = [
    { id: 'entry', labelKey: 'strategies.groups.entry' },
    { id: 'filter', labelKey: 'strategies.groups.filter' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
]

// ── Hilfsfunktionen ──────────────────────────────────────────────────────

/** Kerzenlänge aus den Daten — detect() kennt seine Zeiteinheit nicht. */
export function kerzenMs(kerzen) {
    let ms = Infinity
    for (let i = Math.max(1, kerzen.length - 5); i < kerzen.length; i++) {
        const d = kerzen[i].t - kerzen[i - 1].t
        if (d > 0 && d < ms) ms = d
    }
    return Number.isFinite(ms) ? ms : 0
}

/** Sa/So in UTC. */
export const istWochenende = (ms) => {
    const tag = new Date(ms).getUTCDay()
    return tag === 0 || tag === 6
}

/**
 * Trend der höheren Zeiteinheit zum Zeitpunkt `zeit`: Schluss der letzten
 * dann GESCHLOSSENEN Kerze gegen ihre EMA. 'long' | 'short' | null (unbekannt).
 * `emaSerie` ist `ema(htfKerzen, periode)`, einmal je Aufruf gerechnet.
 */
export function trendBei(htfKerzen, emaSerie, htfMs, zeit) {
    if (!Array.isArray(htfKerzen) || !htfKerzen.length || !(htfMs > 0)) return null
    let j = -1
    for (let i = htfKerzen.length - 1; i >= 0; i--) {
        if (htfKerzen[i].t + htfMs <= zeit) { j = i; break }
    }
    if (j < 0) return null
    const e = emaSerie[j]
    if (!(e > 0)) return null
    return htfKerzen[j].c > e ? 'long' : htfKerzen[j].c < e ? 'short' : null
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array}  input.candles          geschlossene Kerzen, aufsteigend
 * @param {object} input.params           validierte Parameter
 * @param {Array}  input.openSetups       laufende Setups mit id
 * @param {Array}  [input.knownSetupKeys] ALLE bekannten `${direction}|${obCandleTime}`
 * @param {Array}  [input.htfCandles]     geschlossene Kerzen der höheren Zeiteinheit
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 */
function detect({ candles, params: p, openSetups = [], knownSetupKeys = [], htfCandles = null }) {
    const setups = []
    const events = []
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }
    const reject = (reason, key) => {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1
        diagnostics.rejections.push({ reason, key })
    }

    if (!Array.isArray(candles) || candles.length < 60) return { setups, events, diagnostics }
    const n = candles.length
    const tfMs = kerzenMs(candles)

    // Trend der höheren Zeiteinheit. Ohne Kerzen ist er unbekannt, und
    // unbekannt ist kein Ja: dann entsteht kein Setup.
    const htfMs = Array.isArray(htfCandles) && htfCandles.length > 1 ? kerzenMs(htfCandles) : 0
    const htfEma = p.htfTrendFilter && htfMs ? ema(htfCandles, p.htfEmaPeriod) : null

    // ══ Phase A: neue Setups aus Signalpunkten ════════════════════════════
    const { w1, w2 } = welle(candles)
    const sig = signale(w1, w2)
    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    for (let i = Math.max(p.stopKerzen, n - p.scanWindowCandles); i < n; i++) {
        if (!sig[i].long && !sig[i].short) continue
        const dir = sig[i].long ? 'long' : 'short'
        const k = candles[i]
        const key = `${dir}|${k.t}`
        if (bekannt.has(key)) continue
        diagnostics.sweepsFound++
        bekannt.add(key)

        // Der Punkt ist erst mit dem Schluss seiner Kerze bekannt.
        const schluss = k.t + tfMs
        if (p.sperreWochenende && istWochenende(schluss)) { reject(INVALID_REASONS.WOCHENTAG_GESPERRT, key); continue }
        if (p.htfTrendFilter) {
            const trend = htfEma ? trendBei(htfCandles, htfEma, htfMs, schluss) : null
            if (trend === null) { reject(INVALID_REASONS.TREND_UNBEKANNT, key); continue }
            if (trend !== dir) { reject(INVALID_REASONS.TREND_DAGEGEN, key); continue }
        }

        const fenster = candles.slice(i - p.stopKerzen + 1, i + 1)
        const puffer = p.slBufferPct / 100
        const stopLoss = dir === 'long'
            ? Math.min(...fenster.map((x) => x.l)) * (1 - puffer)
            : Math.max(...fenster.map((x) => x.h)) * (1 + puffer)
        const entry = k.c - p.limitAnteil * (k.c - stopLoss)
        const risiko = Math.abs(entry - stopLoss)
        if (!(risiko > 0) || (dir === 'long' ? !(stopLoss < entry) : !(stopLoss > entry))) {
            reject(INVALID_REASONS.STOP_UNGUELTIG, key); continue
        }
        const takeProfit = dir === 'long' ? entry + p.tpRR * risiko : entry - p.tpRR * risiko

        setups.push({
            direction: dir,
            status: 'waiting_retest',
            sweepLevel: k.c,
            sweepPrice: k.c,
            sweepCandleTime: k.t,
            // Zone für den Chart: zwischen Limit und Schlusskurs der Punktkerze.
            obHigh: Math.max(entry, k.c),
            obLow: Math.min(entry, k.c),
            obCandleTime: k.t,
            impulseExtreme: stopLoss,
            entry,
            stopLoss,
            takeProfit,
            rr: p.tpRR,
            confirmations: { w1: Number(w1[i].toFixed(1)), limitAnteil: p.limitAnteil },
            detectorVersion: DETECTOR_VERSION,
            watchFrom: k.t,
            tradeableFrom: k.t,
        })
        diagnostics.setupsCreated++
    }

    // ══ Phase B: liegt das Limit noch, ist es gefüllt? ════════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue
        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const start = candles.findIndex((c) => c.t > ab)
        if (start === -1) continue
        const long = s.direction === 'long'
        let erledigt = false
        for (let j = start; j < n && j < start + p.limitGueltigKerzen; j++) {
            const k = candles[j]
            // Berührt die Kerze das Limit, ist es gefüllt. Liegt der Stop in
            // derselben Kerze, bucht die Engine das pessimistisch als Verlust.
            if (long ? k.l <= s.entry : k.h >= s.entry) {
                events.push({
                    id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
                    entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit, rr: s.rr,
                    confirmations: s.confirmations || {},
                })
                erledigt = true
                break
            }
        }
        if (!erledigt && n - start >= p.limitGueltigKerzen) {
            events.push({
                id: s.id, status: 'expired', invalidReason: INVALID_REASONS.NICHT_GEFUELLT,
                candleTime: candles[Math.min(n - 1, start + p.limitGueltigKerzen - 1)].t,
            })
        }
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'momentum_swing',
    name: 'Momentum Swing',
    description: 'Signalpunkt des Momentum Radars in Richtung des Tagestrends, Einstieg per Limit im Rücksetzer, kein Wochenende.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['1h', '4h', '1d'],
    // WaveTrend glättet mit EMAs — 300 Kerzen Vorlauf, damit der Fensterbeginn
    // die Werte am rechten Rand nicht mehr verschiebt.
    warmupCandles: 300,
    // Tageskerzen für die EMA des Trendfilters: genug, dass der Startwert der
    // EMA ausgeschwungen ist (Engine und Backtest rechnen sonst verschieden).
    htfKerzen: 300,
    params,
    paramGroups,
    detect,
}
