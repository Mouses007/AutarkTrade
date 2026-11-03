/**
 * Selbsttest Dreiecke und Keile (server/chart-dreiecke.js) an künstlichen
 * Kerzen: jede der fünf Formen wird erkannt und richtig benannt; ein
 * Parallelkanal und eine auseinanderlaufende Form sind keine.
 *
 *   node server/__selftest-chart-dreiecke.mjs
 */
import { kandidatenDreiecke, dreieckForm, dreieckName } from './chart-dreiecke.js'
import fs from 'node:fs'
import { atr } from '../shared/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
/**
 * Kerzen, die zwischen zwei Kanten pendeln (Periode `P`), davor 40 Kerzen
 * Vorlauf. `oben(x)`/`unten(x)` mit x = 0 … 1 über die Formation.
 */
function formation(oben, unten, { N = 100, P = 14, vor = 40 } = {}) {
    const k = []
    const start = (oben(0) + unten(0)) / 2
    for (let i = 0; i < vor; i++) { const v = start + Math.sin(i / 3) * 0.3; k.push({ o: v, h: v + 0.2, l: v - 0.2, c: v }) }
    for (let i = 0; i < N; i++) {
        const x = i / (N - 1)
        const phase = (i % P) / P
        const w = 1 - Math.abs(2 * phase - 1)                 // 0 … 1 … 0: unten → oben → unten
        const v = unten(x) + (oben(x) - unten(x)) * w
        k.push({ o: v, h: v + 0.08, l: v - 0.08, c: v })
    }
    return k.map((x, i) => ({ ...x, t: i * H, v: 100 }))
}
const finde = (k) => { const a = atr(k, 14); return kandidatenDreiecke(k, a[a.length - 1]) }
const formen = (k) => finde(k).map((d) => d.form)

check('Form aus Steigungen', dreieckForm(-3, 3) === 'symmetrisch' && dreieckForm(0.2, 3) === 'aufsteigend' && dreieckForm(-3, 0.1) === 'absteigend'
    && dreieckForm(2, 5) === 'steigenderKeil' && dreieckForm(-5, -2) === 'fallenderKeil' && dreieckForm(3, 3) === null && dreieckForm(2, -2) === null)

const fall = [
    ['symmetrisch', (x) => 110 - 7 * x, (x) => 90 + 7 * x],
    ['aufsteigend', () => 110, (x) => 90 + 14 * x],
    ['absteigend', (x) => 110 - 14 * x, () => 90],
    ['steigenderKeil', (x) => 100 + 10 * x, (x) => 80 + 24 * x],
    ['fallenderKeil', (x) => 120 - 24 * x, (x) => 100 - 10 * x],
]
for (const [name, o, u] of fall) {
    const f = formen(formation(o, u))
    check(`${name} erkannt`, f.includes(name), JSON.stringify(f))
}
{
    const d = finde(formation((x) => 110 - 7 * x, (x) => 90 + 7 * x))[0]
    check('Kanten jetzt, Spitze voraus, Berührungen ≥ 2 je Kante', d && d.obenJetzt > d.untenJetzt && d.spitzeT >= d.tE - 1 && d.beruehrOben >= 2 && d.beruehrUnten >= 2 && d.restPct < 75, JSON.stringify(d))
    check('Name vom Code', d && dreieckName(d).startsWith('Symmetrisches Dreieck (') && dreieckName(d, true).startsWith('Symmetrical triangle ('))
}
check('Parallelkanal ist kein Dreieck', !formen(formation((x) => 110 + 10 * x, (x) => 95 + 10 * x)).length)
check('auseinanderlaufend ist kein Dreieck', !formen(formation((x) => 105 + 8 * x, (x) => 95 - 8 * x)).length)
{
    const k = formation((x) => 110 - 7 * x, (x) => 90 + 7 * x)
    const letzte = k[k.length - 1]
    const ausbruch = [...k, ...[1, 2].map((j) => ({ t: letzte.t + j * H, o: 104, h: 108, l: 103.5, c: 107.5, v: 100 }))]
    const d = finde(ausbruch).find((x) => x.form === 'symmetrisch')
    check('Schluss über der oberen Kante am Ende = Bruch oben', d && d.bruch === 'oben', JSON.stringify(finde(ausbruch).map((x) => [x.form, x.bruch])))
}

// Echte Kerzen (03.11.2026): ein V nach oben ist kein Keil — Doppelhoch und Doppeltief
// zählten je zweimal, zwischen den Kanten pendelte nichts. Ein Lehrbuch-Dreieck bleibt.
const echt = (datei) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${datei}`, import.meta.url))).kerzen
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
{
    const f = finde(echt('chart-avax-15m-kein-keil.json'))
    check('AVAXUSDT 15m: das V ist kein steigender Keil', !f.length, JSON.stringify(f.map((d) => [d.form, d.beruehrOben, d.beruehrUnten])))
}
{
    const f = finde(echt('chart-btc-4h-dreieck.json'))
    const d = f.find((x) => x.form === 'symmetrisch')
    check('BTCUSDT 4h: symmetrisches Dreieck erkannt', !!d, JSON.stringify(f.map((x) => x.form)))
    const p = d?.pendelPunkte || []
    check('Berührungen wechseln oben/unten ab, ≥ 5, je Kante ≥ 2', p.length >= 5 && p.every((x, i) => !i || x.oben !== p[i - 1].oben) && d.beruehrOben >= 2 && d.beruehrUnten >= 2, JSON.stringify(p))
    check('Formation beginnt an der ersten Berührung, jede Kante an ihrer eigenen', d && d.tA === p[0].t && d.tOA === p.find((x) => x.oben).t && d.tUA === p.find((x) => !x.oben).t)
}
{
    // Ein V: hinunter, einmal hinauf, kurz zurück — zwei Kanten lassen sich hineinlegen, ein Pendel ist es nicht
    const k = formation((x) => 110 - 7 * x, (x) => 90 + 7 * x, { N: 100, P: 100 })
    check('ein einziger Schwung ist kein Dreieck', !formen(k).length, JSON.stringify(formen(k)))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
