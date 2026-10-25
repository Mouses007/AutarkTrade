/**
 * LSOB-Alarme des Chart-Arbeitsplatzes — rein, ohne Netz und Datenbank
 * (Selbsttest: `server/__selftest-chart-alarm-lsob.mjs`).
 *
 * Ein LSOB-Alarm meldet, was der Indikator „LSOB-Boxen" (`shared/lsobCv.js`)
 * auf der jüngsten geschlossenen Kerze zeigt:
 *
 *   retest  der Docht berührt eine gültige Box, der Körper bleibt drin —
 *           das Signal des Indikators (ein Signal je Box)
 *   box     eine neue Box ist mit dieser Kerze bestätigt (Pivot + pivotLaenge)
 *   beide   beides
 *
 * Aufbau wie der Momentum-Alarm (`chart-alarm-momentum.js`): ein Symbol ODER
 * Watchlists, mehrere Zeiteinheiten, je Paar Symbol × Zeiteinheit; nur
 * geschlossene Kerzen, nur die jüngste, eine Kerze meldet einmal
 * (`juengsteKerze`). Die Box-Einstellungen nimmt der Dialog aus dem
 * LSOB-Boxen-Indikator des Charts, sonst gelten die Vorgaben — so meldet der
 * Alarm dieselben Boxen, die der Chart zeichnet.
 *
 * Gerechnet wird über `LSOB_KERZEN` Kerzen. Eine Box, die älter ist, sieht der
 * Alarm nicht (der Chart mit längerer Historie schon) — das kann einen Retest
 * VERPASSEN, nie einen erfinden: jede Box im Fenster hat ihre ganze Geschichte
 * (Invalidierung, früherer Retest) im Fenster.
 */
import { lsobCv, LSOB_VORGABEN } from '../shared/lsobCv.js'
import { nurGeschlossene, juengsteKerze, MOMENTUM_ZEITEBENEN, TF_MS } from './chart-alarm-momentum.js'

export const LSOB_ZEITEBENEN = MOMENTUM_ZEITEBENEN
export const LSOB_EREIGNISSE = ['retest', 'box', 'beide']
export const LSOB_RICHTUNGEN = ['beide', 'long', 'short']
/** 1000 Kerzen: unter 1000 kostet ein Binance-Abruf Gewicht 5 (Futures), mehr als 1000 schon 10. */
export const LSOB_KERZEN = 1000
export const LSOB_MIN_KERZEN = 50

/** Die Box-Einstellungen, die der Alarm übernimmt — Grenzen wie im Indikator (`LSOB_CV_PARAMS`). */
const PARAM_GRENZEN = {
    pivotLaenge: [1, 50, true],
    invalidierungPct: [0, 100],
    retestPct: [0, 100],
    maxDochtPct: [0, 100],
}

/** Nur bekannte Einstellungen, in ihren Grenzen; Vorgaben weglassen (gespeichert wird nur, was abweicht). */
export function lsobParams(roh) {
    const aus = {}
    if (!roh || typeof roh !== 'object') return aus
    for (const [k, [min, max, ganz]] of Object.entries(PARAM_GRENZEN)) {
        const n = Number(roh[k])
        if (roh[k] == null || roh[k] === '' || !Number.isFinite(n)) continue
        const v = Math.max(min, Math.min(max, ganz ? Math.round(n) : n))
        if (v !== LSOB_VORGABEN[k]) aus[k] = v
    }
    if (roh.strengDocht === true) aus.strengDocht = true
    return aus
}

/**
 * Was zeigt die jüngste geschlossene Kerze?
 * @param {Array} chart  geschlossene Kerzen {t,o,h,l,c} aufsteigend
 * @returns {Array<{typ:'retest'|'box', seite, tief, hoch, boxT}>}
 */
export function lsobEreignisse(chart, params = {}) {
    if (!chart?.length) return []
    const letzte = chart[chart.length - 1]
    const p = { ...LSOB_VORGABEN, ...params }
    const r = lsobCv(chart, p)
    const n = Math.min(chart.length, Math.max(50, p.maxHistorie))
    const L = Math.max(1, Math.round(p.pivotLaenge))
    const aus = []
    for (const s of r.signale) {
        if (s.t !== letzte.t) continue
        const b = r.boxen.find((x) => x.t === s.boxT && x.seite === s.seite)
        aus.push({ typ: 'retest', seite: s.seite, tief: b?.tief ?? null, hoch: b?.hoch ?? null, boxT: s.boxT })
    }
    // Neu bestätigt: das Pivot hat mit dieser Kerze seine `pivotLaenge` Kerzen rechts.
    for (const b of r.boxen) {
        if (b.gueltig && b.i === n - 1 - L) aus.push({ typ: 'box', seite: b.seite, tief: b.tief, hoch: b.hoch, boxT: b.t })
    }
    return aus
}

export function passtEreignis(bedingung, e) {
    const welche = LSOB_EREIGNISSE.includes(bedingung?.ereignis) ? bedingung.ereignis : 'retest'
    if (welche !== 'beide' && welche !== e.typ) return false
    const r = bedingung?.richtung || 'beide'
    return r === 'beide' || r === e.seite
}

/**
 * Meldet das Paar auf seiner jüngsten geschlossenen Kerze?
 * @param {object} o
 * @param {object} o.bedingung  { ereignis, richtung, params }
 * @param {object} o.kerzen     { [tf]: [...] }
 * @returns {{ ausloesen: boolean, grund?: string, kerzeT?: number, ereignisse?: Array, preis?: number }}
 */
export function pruefeLsob({ bedingung, tf, kerzen, jetzt, gemeldetBis = 0, abMs = 0 }) {
    if (!TF_MS[tf] || !LSOB_ZEITEBENEN.includes(tf)) return { ausloesen: false, grund: 'zeiteinheit' }
    const chart = nurGeschlossene(kerzen?.[tf], tf, jetzt)
    const lage = juengsteKerze({ tf, chart, jetzt, gemeldetBis, abMs, minKerzen: LSOB_MIN_KERZEN })
    if (lage.grund) return { ausloesen: false, ...lage }
    const letzte = lage.letzte
    const alle = lsobEreignisse(chart, lsobParams(bedingung?.params))
    const ereignisse = alle.filter((e) => passtEreignis(bedingung, e))
    if (!ereignisse.length) return { ausloesen: false, grund: alle.length ? 'passtNicht' : 'keinEreignis', kerzeT: letzte.t }
    return { ausloesen: true, kerzeT: letzte.t, ereignisse, preis: letzte.c }
}

const SEITE = { long: 'Long', short: 'Short' }
/** „Retest Long-Box 64 200–64 550" / „neue Short-Box 64 200–64 550". */
export function ereignisText(e, zahl = String, mitBox = true) {
    const box = mitBox && e.tief != null && e.hoch != null ? ` ${zahl(e.tief)}–${zahl(e.hoch)}` : ''
    return `${e.typ === 'box' ? 'neue' : 'Retest'} ${SEITE[e.seite]}-Box${box}`
}

/** Text einer (gebündelten) Auslösung — derselbe für Push, Handy, Mail und die Meldung im Browser. */
export function lsobText(alarm, treffer, zahl = String) {
    const ort = (tr) => `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf}`
    const zeile = (tr) => `${ort(tr)}: ${tr.ereignisse.map((e) => ereignisText(e, zahl)).join(', ')} — Kurs ${zahl(tr.preis)}`
    const titel = treffer.length === 1
        ? `LSOB ${ort(treffer[0])}: ${treffer[0].ereignisse.map((e) => ereignisText(e, zahl, false)).join(', ')}`
        : `LSOB: ${treffer.length} Signale`
    const text = `${treffer.map(zeile).join('\n')}${alarm.notiz ? `\n${alarm.notiz}` : ''}`
    return { titel, text }
}
