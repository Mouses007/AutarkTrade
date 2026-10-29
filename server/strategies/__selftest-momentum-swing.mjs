/**
 * Selbsttest der beiden Strategien aus der Forschung vom 29.10.2026:
 * Momentum Swing (Signalpunkt + Tagestrend + Limit im Rücksetzer) und
 * Liquidations-Kerze (Volumen-/Spannenspitze, Markt-Einstieg, Zeitausstieg).
 *
 *   node server/strategies/__selftest-momentum-swing.mjs
 *
 * Die Zahlen der Forschung hängen an Details, die man beim Nachbauen leicht
 * verliert: der Trend gilt nur aus GESCHLOSSENEN Tageskerzen, die
 * Wochenendsperre schaut auf den Schluss der Signalkerze, das Limit verfällt
 * nach genau `limitGueltigKerzen` Kerzen, und die Liquidations-Kerze zahlt
 * Taker, weil sie zur Eröffnung kauft. Jede dieser Regeln hat hier einen Fall.
 */

import momentum, { INVALID_REASONS as GRUND_M, trendBei, istWochenende } from './momentum_swing.js'
import liq, { INVALID_REASONS as GRUND_L } from './liq_kerze.js'
import { getStrategy, validateParams } from './index.js'
import { ema } from './indicators.js'
import { welle, signale } from '../momentum-radar.js'
import { einstiegsSorte, MARKT } from '../fill-simulator.js'

const H = 3600000
const TAG = 24 * H
// Montag, 13.11.2023 00:00 UTC
const MONTAG = Date.UTC(2023, 10, 13)

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const vorgaben = (m, over = {}) => ({ ...Object.fromEntries(m.params.map((d) => [d.key, d.default])), ...over })

/** Deterministischer Zufall, damit der Test immer dieselben Kerzen sieht. */
function zufall(seed) {
    let s = seed >>> 0
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** Pendelnder Kurs: erzeugt regelmässig Signalpunkte beider Seiten. */
function pendel(n, tfMs, start = MONTAG, seed = 7) {
    const r = zufall(seed)
    const out = []
    let vor = 100
    for (let i = 0; i < n; i++) {
        const c = 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 3.7) + (r() - 0.5) * 1.5
        const o = vor
        out.push({ t: start + i * tfMs, o, h: Math.max(o, c) + r() * 0.8, l: Math.min(o, c) - r() * 0.8, c, v: 100 + r() * 20 })
        vor = c
    }
    return out
}

/** Tageskerzen mit festem Trend: steigend → Schluss über der EMA. */
function tage(n, richtung, start = MONTAG - 400 * TAG) {
    return Array.from({ length: n }, (_, i) => {
        const c = 500 + richtung * i * 0.5          // bleibt über 0 — eine EMA ≤ 0 gilt als unbekannt
        return { t: start + i * TAG, o: c - richtung * 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 }
    })
}

/**
 * Kerze für Kerze wie der Backtest: wachsendes Fenster, offene Setups weiterreichen,
 * Ereignisse anwenden. Die höhere Zeiteinheit nur bis zur jeweils geschlossenen Kerze.
 */
function abspielen(m, kerzen, p, htf = null, ab = 60) {
    let offen = []
    const alle = []
    const ereignisse = []
    const bekannt = new Set()
    const ablehnungen = []
    let id = 1
    const tfMs = kerzen[1].t - kerzen[0].t
    for (let i = ab; i < kerzen.length; i++) {
        const sicht = kerzen.slice(0, i + 1)
        const schluss = kerzen[i].t + tfMs
        const htfSicht = htf ? htf.filter((k) => k.t + TAG <= schluss) : null
        const { setups, events, diagnostics } = m.detect({
            candles: sicht, params: p, openSetups: offen, knownSetupKeys: [...bekannt], htfCandles: htfSicht,
        })
        ablehnungen.push(...diagnostics.rejections)
        for (const s of setups) {
            const neu = { ...s, id: id++ }
            offen.push(neu); alle.push(neu); bekannt.add(`${s.direction}|${s.obCandleTime}`)
        }
        for (const ev of events) {
            ereignisse.push({ ...ev, setup: offen.find((s) => s.id === ev.id) })
            offen = offen.filter((s) => s.id !== ev.id)
        }
    }
    return { setups: alle, ereignisse, ablehnungen }
}

// ── Registry ─────────────────────────────────────────────────────────────
console.log('\nRegistry')
check('momentum_swing ist registriert', getStrategy('momentum_swing') === momentum)
check('liq_kerze ist registriert', getStrategy('liq_kerze') === liq)
for (const m of [momentum, liq]) {
    const { errors } = validateParams(m.id, {})
    check(`${m.id}: Vorgaben sind gültig`, errors.length === 0, errors.join('; '))
    check(`${m.id}: holt genug Tageskerzen für eine ausgeschwungene EMA`, m.htfKerzen >= 4 * vorgaben(m).htfEmaPeriod)
}

// ── Momentum Swing ───────────────────────────────────────────────────────
console.log('\nMomentum Swing')
{
    const k = pendel(700, 4 * H)
    const { w1, w2 } = welle(k)
    const sig = signale(w1, w2)
    const punkte = sig.map((s, i) => (s.long || s.short ? i : -1)).filter((i) => i >= 60)
    check('Testkurs erzeugt Signalpunkte beider Seiten',
        punkte.some((i) => sig[i].long) && punkte.some((i) => sig[i].short), `${punkte.length} Punkte`)

    const p = vorgaben(momentum)
    const lauf = abspielen(momentum, k, p, tage(800, +1))

    check('im Aufwärtstrend nur Long-Setups', lauf.setups.length > 0 && lauf.setups.every((s) => s.direction === 'long'),
        `${lauf.setups.length} Setups`)
    check('Short-Punkte gegen den Trend werden mit trend_against abgelehnt',
        lauf.ablehnungen.some((r) => r.reason === GRUND_M.TREND_DAGEGEN))

    const idx = new Map(k.map((x, i) => [x.t, i]))
    let alleAufPunkt = true, keinWochenende = true, stopRichtig = true, limitRichtig = true
    for (const s of lauf.setups) {
        const i = idx.get(s.obCandleTime)
        if (!sig[i]?.long) alleAufPunkt = false
        if (istWochenende(k[i].t + 4 * H)) keinWochenende = false
        const tief = Math.min(...k.slice(i - 4, i + 1).map((x) => x.l)) * (1 - p.slBufferPct / 100)
        if (Math.abs(s.stopLoss - tief) > 1e-9) stopRichtig = false
        if (Math.abs(s.entry - (k[i].c - p.limitAnteil * (k[i].c - tief))) > 1e-9) limitRichtig = false
    }
    check('jedes Setup sitzt auf einem Long-Punkt', alleAufPunkt)
    check('kein Setup, dessen Punktkerze am Wochenende schliesst', keinWochenende)
    check('Wochenend-Punkte werden mit weekday_blocked abgelehnt',
        lauf.ablehnungen.some((r) => r.reason === GRUND_M.WOCHENTAG_GESPERRT))
    check('Stop = Tief der letzten 5 Kerzen − 0,2 %', stopRichtig)
    check('Limit = Schluss − 25 % der Strecke zum Stop', limitRichtig)

    const ausgeloest = lauf.ereignisse.filter((e) => e.status === 'triggered')
    const verfallen = lauf.ereignisse.filter((e) => e.status === 'expired')
    check('es gibt gefüllte und verfallene Limits', ausgeloest.length > 0 && verfallen.length > 0,
        `${ausgeloest.length} gefüllt, ${verfallen.length} verfallen`)
    check('Füllung frühestens in der Kerze NACH dem Punkt und höchstens 6 Kerzen danach',
        ausgeloest.every((e) => {
            const d = idx.get(e.candleTime) - idx.get(e.setup.obCandleTime)
            return d >= 1 && d <= p.limitGueltigKerzen
        }))
    check('gefüllt wird nur, wenn die Kerze das Limit berührt — zum Limitpreis',
        ausgeloest.every((e) => k[idx.get(e.candleTime)].l <= e.setup.entry && e.entry === e.setup.entry))
    check('gefüllt wird in der ERSTEN berührenden Kerze',
        ausgeloest.every((e) => {
            const von = idx.get(e.setup.obCandleTime) + 1
            return k.slice(von, idx.get(e.candleTime)).every((x) => x.l > e.setup.entry)
        }))
    check('Ziel liegt bei 2R', ausgeloest.every((e) =>
        Math.abs((e.takeProfit - e.entry) - 2 * (e.entry - e.stopLoss)) < 1e-9))
    check('verfallen erst nach 6 Kerzen ohne Berührung (limit_expired)',
        verfallen.every((e) => {
            const von = idx.get(e.setup.obCandleTime) + 1
            return e.invalidReason === GRUND_M.NICHT_GEFUELLT
                && k.slice(von, von + p.limitGueltigKerzen).every((x) => x.l > e.setup.entry)
        }))

    // Ohne Tageskerzen ist der Trend unbekannt — und unbekannt ist kein Ja.
    const ohne = abspielen(momentum, k, p, null)
    check('ohne Tageskerzen entsteht kein Setup (trend_unknown)',
        ohne.setups.length === 0 && ohne.ablehnungen.some((r) => r.reason === GRUND_M.TREND_UNBEKANNT))

    // Abwärtstrend spiegelt: nur Shorts, Stop über dem Hoch, Limit darüber.
    const ab = abspielen(momentum, k, p, tage(800, -1))
    check('im Abwärtstrend nur Short-Setups mit Stop über dem Limit',
        ab.setups.length > 0 && ab.setups.every((s) => s.direction === 'short' && s.stopLoss > s.entry && s.entry > s.sweepPrice))

    // Ohne Sperre gibt es mindestens so viele Setups.
    const mitWe = abspielen(momentum, k, { ...p, sperreWochenende: false }, tage(800, +1))
    check('ohne Wochenendsperre kommen Setups dazu', mitWe.setups.length > lauf.setups.length)

    // Kein Blick in die Zukunft: das Setup eines Punktes ist dasselbe, egal
    // wie viele Kerzen danach im Fenster liegen.
    const s0 = lauf.setups[0]
    const i0 = idx.get(s0.obCandleTime)
    const spaeter = momentum.detect({
        candles: k.slice(0, i0 + 4), params: p, openSetups: [], knownSetupKeys: [],
        htfCandles: tage(800, +1).filter((x) => x.t + TAG <= k[i0 + 3].t + 4 * H),
    }).setups.find((s) => s.obCandleTime === s0.obCandleTime)
    check('spätere Kerzen ändern Einstieg und Stop eines Punktes nicht',
        spaeter && spaeter.entry === s0.entry && spaeter.stopLoss === s0.stopLoss)
}

// Trend aus GESCHLOSSENEN Tageskerzen
{
    const d = tage(100, +1)
    // Die letzte Tageskerze stürzt ab — sie darf erst nach ihrem Schluss zählen.
    d[99] = { ...d[99], c: 1, l: 1 }
    const e = ema(d, 50)
    const vorSchluss = d[99].t + 12 * H
    const nachSchluss = d[99].t + TAG
    check('laufende Tageskerze zählt nicht für den Trend', trendBei(d, e, TAG, vorSchluss) === 'long')
    check('geschlossene Tageskerze zählt', trendBei(d, e, TAG, nachSchluss) === 'short')
    check('vor der ersten geschlossenen Tageskerze ist der Trend unbekannt', trendBei(d, e, TAG, d[0].t + H) === null)
}

// ── Liquidations-Kerze ───────────────────────────────────────────────────
console.log('\nLiquidations-Kerze')
{
    const p = vorgaben(liq)
    const auf = tage(800, +1)
    /** Ruhiger 1h-Kurs mit EINER Spitzenkerze an `spitze`. */
    // Spitze am Dienstag 10:00 UTC (Kerze 150), Einstieg also werktags
    const DIENSTAG = MONTAG + TAG + 10 * H - 150 * H
    function fall({ start = DIENSTAG, spitze = 150, farbe = 'gruen', vol = 600, folgeOpen = null } = {}) {
        // ruhige kleine Kerzen um 100
        const k = Array.from({ length: 200 }, (_, i) => {
            const c = 100 + Math.sin(i / 5) * 0.3
            return { t: start + i * H, o: c - 0.05, h: c + 0.2, l: c - 0.2, c, v: 100 }
        })
        const b = k[spitze - 1].c
        k[spitze] = farbe === 'gruen'
            ? { t: k[spitze].t, o: b, h: b + 2.2, l: b - 0.1, c: b + 2, v: vol }
            : { t: k[spitze].t, o: b, h: b + 0.1, l: b - 2.2, c: b - 2, v: vol }
        // Danach geht es auf dem neuen Niveau weiter — die Folgekerze eröffnet am Schluss der Spitze.
        const sprung = k[spitze].c - b
        for (let i = spitze + 1; i < k.length; i++) {
            const x = k[i]
            k[i] = { ...x, o: (i === spitze + 1 ? k[spitze].c : x.o + sprung), h: x.h + sprung, l: x.l + sprung, c: x.c + sprung }
        }
        if (folgeOpen !== null) k[spitze + 1] = { ...k[spitze + 1], o: folgeOpen, l: Math.min(folgeOpen, k[spitze + 1].l) }
        return k
    }
    const lauf = (k) => abspielen(liq, k, p, auf, 40)

    const gruen = lauf(fall())
    check('grüne Spitzenkerze erzeugt genau ein Setup', gruen.setups.length === 1, `${gruen.setups.length}`)
    const ev = gruen.ereignisse.find((e) => e.status === 'triggered')
    const k = fall()
    check('Einstieg in der Folgekerze zu deren Eröffnung', ev && ev.candleTime === k[151].t && ev.entry === k[151].o)
    check('Stop = Schluss der Spitzenkerze − 1,5 ATR', ev && ev.stopLoss < k[150].c && ev.stopLoss > k[150].c - 5)
    check('kein Ziel — Ausstieg nur über Stop oder Zeit', ev && ev.takeProfit === 0)
    check('der Einstieg ist als Marktorder gekennzeichnet (Taker + Slippage)',
        ev && einstiegsSorte({ entryOrder: 'limit' }, { confirmations: ev.confirmations }) === MARKT)

    check('rote Spitzenkerze erzeugt kein Setup', lauf(fall({ farbe: 'rot' })).setups.length === 0)
    check('Volumen unter 4× erzeugt kein Setup', lauf(fall({ vol: 350 })).setups.length === 0)

    // Spitze am Freitag 23:00 UTC → die Einstiegskerze beginnt Samstag 00:00.
    const freitag = MONTAG + 4 * TAG + 23 * H
    const we = lauf(fall({ start: freitag - 150 * H }))
    check('Einstieg am Wochenende wird mit weekday_blocked abgelehnt',
        we.setups.length === 0 && we.ablehnungen.some((r) => r.reason === GRUND_L.WOCHENTAG_GESPERRT))

    const runter = abspielen(liq, fall(), p, tage(800, -1), 40)
    check('im Abwärtstrend kein Setup (trend_against)',
        runter.setups.length === 0 && runter.ablehnungen.some((r) => r.reason === GRUND_L.TREND_DAGEGEN))

    const luecke = lauf(fall({ folgeOpen: 90 }))
    check('eröffnet die Folgekerze unter dem Stop, wird verworfen (invalid_stop)',
        luecke.ereignisse.some((e) => e.status === 'invalidated' && e.invalidReason === GRUND_L.STOP_UNGUELTIG)
        && !luecke.ereignisse.some((e) => e.status === 'triggered'))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(`\nFehlgeschlagen:\n  ${fehler.join('\n  ')}\n`); process.exit(1) }
console.log('')
