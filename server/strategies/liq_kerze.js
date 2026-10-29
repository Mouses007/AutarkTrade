/**
 * Liquidations-Kerze — Long nach einer grünen Kerze mit Volumen- und
 * Spannenspitze im Aufwärtstrend.
 *
 * Entstanden aus der Strategie-Forschung vom 29.10.2026 („K2"). Die eigenen
 * Liquidations-Aufnahmen des Journals (ab 12.08.2026) zeigten, dass sich eine
 * Liquidationsstunde an der Kerze erkennen lässt: Volumen ≥ 4× das Mittel der
 * 20 Kerzen davor UND Spanne ≥ 2× ATR14 trifft in 53 % der Fälle eine der
 * stärksten 2 % Liquidationsstunden, und die Kerzenfarbe passt in 97 % zur
 * liquidierten Seite. Grün = Shorts wurden zwangsgeschlossen.
 *
 * Regel (1h):
 *   1. Signalkerze grün, Volumen ≥ `volFaktor` × SMA(Volumen, 20) der Kerzen
 *      DAVOR, Spanne (Hoch − Tief) ≥ `spannenFaktor` × ATR14 der Kerze davor.
 *   2. Letzte bei Schluss der Signalkerze geschlossene Tageskerze über EMA50.
 *   3. Die Einstiegskerze beginnt nicht an einem Samstag oder Sonntag (UTC).
 *   4. Einstieg Markt zum Open der Folgekerze, Stop = Schluss der Signalkerze
 *      − 1,5 × ATR14, KEIN Ziel, Ausstieg zum Schluss der 48. Kerze.
 *
 * Gemessen (12 Coins, Regeln nur auf 2019–2023 gewählt): IS 668 Trades
 * Ø +0,47 R, 2024 bis Mitte 2025 Ø +0,38 R, ab 1.7.2025 Ø +0,68 R, Treffer
 * 27–29 %. Vorbehalte, die im Papierbetrieb geprüft werden sollen: ohne die
 * besten 5 % der Trades ist die Summe negativ (Ausreisser tragen alles), 2022
 * war negativ, und von Juli 2025 bis August 2026 lag das Ergebnis bei null.
 *
 * Nur Long. Die rote Spiegelung (Long-Liquidationen) trug in der Forschung nicht.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import { atr, ema, volumeSma } from './indicators.js'
import { MARKT } from '../fill-simulator.js'
import { kerzenMs, istWochenende, trendBei } from './momentum_swing.js'

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
    WOCHENTAG_GESPERRT: 'weekday_blocked',
    TREND_DAGEGEN: 'trend_against',
    TREND_UNBEKANNT: 'trend_unknown',
    STOP_UNGUELTIG: 'invalid_stop',
}

const params = [
    // ── Signal ────────────────────────────────────────────────
    { key: 'volFaktor', type: 'number', default: 4, min: 1.5, max: 20, step: 0.5, group: 'entry' },
    { key: 'volLaenge', type: 'integer', default: 20, min: 5, max: 200, step: 1, group: 'entry' },
    { key: 'spannenFaktor', type: 'number', default: 2, min: 0.5, max: 10, step: 0.25, group: 'entry' },
    { key: 'atrLaenge', type: 'integer', default: 14, min: 2, max: 50, step: 1, group: 'entry' },
    { key: 'scanWindowCandles', type: 'integer', default: 3, min: 1, max: 200, step: 1, group: 'entry' },

    // ── Filter ────────────────────────────────────────────────
    { key: 'htfTrendFilter', type: 'boolean', default: true, group: 'filter' },
    { key: 'htfTimeframe', type: 'select', default: '1d', options: ['4h', '1d', '1w'], group: 'filter' },
    { key: 'htfEmaPeriod', type: 'integer', default: 50, min: 5, max: 200, step: 1, group: 'filter' },
    { key: 'sperreWochenende', type: 'boolean', default: true, group: 'filter' },

    // ── Ausstieg ──────────────────────────────────────────────
    { key: 'stopAtr', type: 'number', default: 1.5, min: 0.25, max: 10, step: 0.25, group: 'exit' },
    // Kein Ziel: der Gewinn kommt aus wenigen langen Läufen. 0 = ohne Ziel.
    { key: 'tpRR', type: 'number', default: 0, min: 0, max: 20, step: 0.5, group: 'exit' },
    // 47 = Schluss der 48. Kerze ab der Einstiegskerze (die Engine schliesst
    // zum Schluss der Kerze, die `maxHoldCandles` Kerzen nach dem Einstieg beginnt).
    { key: 'maxHoldCandles', type: 'integer', default: 47, min: 1, max: 2000, step: 1, group: 'exit' },
    { key: 'breakEvenAtR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
]

const paramGroups = [
    { id: 'entry', labelKey: 'strategies.groups.entry' },
    { id: 'filter', labelKey: 'strategies.groups.filter' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
]

/**
 * @param {object} input  wie bei den anderen Strategien (siehe momentum_swing.js)
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

    const mindestens = Math.max(p.volLaenge, p.atrLaenge) + 5
    if (!Array.isArray(candles) || candles.length < mindestens) return { setups, events, diagnostics }
    const n = candles.length
    const tfMs = kerzenMs(candles)
    const atrSerie = atr(candles, p.atrLaenge)
    const volSerie = volumeSma(candles, p.volLaenge)
    const htfMs = Array.isArray(htfCandles) && htfCandles.length > 1 ? kerzenMs(htfCandles) : 0
    const htfEma = p.htfTrendFilter && htfMs ? ema(htfCandles, p.htfEmaPeriod) : null

    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    // ══ Phase A: Signalkerzen ═════════════════════════════════════════════
    for (let i = Math.max(mindestens, n - p.scanWindowCandles); i < n; i++) {
        const k = candles[i]
        const volVorher = volSerie[i - 1]
        const atrVorher = atrSerie[i - 1]
        if (!(volVorher > 0) || !(atrVorher > 0) || !(atrSerie[i] > 0)) continue
        if (!(k.c >= k.o)) continue
        if (!(k.v >= p.volFaktor * volVorher)) continue
        if (!(k.h - k.l >= p.spannenFaktor * atrVorher)) continue

        const key = `long|${k.t}`
        if (bekannt.has(key)) continue
        diagnostics.sweepsFound++
        bekannt.add(key)

        // Die Einstiegskerze beginnt mit dem Schluss der Signalkerze.
        const schluss = k.t + tfMs
        if (p.sperreWochenende && istWochenende(schluss)) { reject(INVALID_REASONS.WOCHENTAG_GESPERRT, key); continue }
        if (p.htfTrendFilter) {
            const trend = htfEma ? trendBei(htfCandles, htfEma, htfMs, schluss) : null
            if (trend === null) { reject(INVALID_REASONS.TREND_UNBEKANNT, key); continue }
            if (trend !== 'long') { reject(INVALID_REASONS.TREND_DAGEGEN, key); continue }
        }

        const stopLoss = k.c - p.stopAtr * atrSerie[i]
        if (!(stopLoss > 0)) { reject(INVALID_REASONS.STOP_UNGUELTIG, key); continue }
        setups.push({
            direction: 'long',
            status: 'waiting_retest',
            sweepLevel: k.h,
            sweepPrice: k.c,
            sweepCandleTime: k.t,
            obHigh: k.h,
            obLow: k.l,
            obCandleTime: k.t,
            impulseExtreme: k.l,
            // Vorläufig: der echte Einstieg ist das Open der Folgekerze und
            // steht erst mit dem Auslöser fest.
            entry: k.c,
            stopLoss,
            takeProfit: 0,
            rr: 0,
            confirmations: {
                entryTrigger: MARKT,
                volFaktor: Number((k.v / volVorher).toFixed(2)),
                spanneAtr: Number(((k.h - k.l) / atrVorher).toFixed(2)),
            },
            detectorVersion: DETECTOR_VERSION,
            watchFrom: k.t,
            tradeableFrom: k.t,
        })
        diagnostics.setupsCreated++
    }

    // ══ Phase B: Markt-Einstieg zum Open der Folgekerze ═══════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue
        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const j = candles.findIndex((c) => c.t > ab)
        if (j === -1) continue
        const k = candles[j]
        const entry = k.o
        // Eröffnet die Kerze schon unter dem Stop, gibt es keinen sinnvollen
        // Einstieg mehr — kein Trade statt eines Trades mit negativem Risiko.
        if (!(entry > s.stopLoss)) {
            events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.STOP_UNGUELTIG, candleTime: k.t })
            continue
        }
        const takeProfit = p.tpRR > 0 ? entry + p.tpRR * (entry - s.stopLoss) : 0
        events.push({
            id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
            entry, stopLoss: s.stopLoss, takeProfit, rr: p.tpRR,
            confirmations: { ...(s.confirmations || {}), entryTrigger: MARKT },
        })
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'liq_kerze',
    name: 'Liquidations-Kerze',
    description: 'Long nach einer grünen Kerze mit Volumen- und Spannenspitze (Short-Liquidationen) im Tagestrend, Ausstieg nach Zeit.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['15m', '1h', '4h'],
    warmupCandles: 100,
    htfKerzen: 300,
    params,
    paramGroups,
    detect,
}
