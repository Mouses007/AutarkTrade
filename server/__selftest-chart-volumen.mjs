/**
 * Selbsttest Volumen im Muster (server/chart-volumen.js): Verlauf der zweiten
 * gegen die erste Hälfte, Ausbruchskerze gegen den Schnitt, unbekannt statt 0.
 *
 *   node server/__selftest-chart-volumen.mjs
 */
import { ausbruchAb, volumenImMuster, volumenText } from './chart-volumen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

// 20 Kerzen im Muster: erste Hälfte Volumen 200, zweite 100; danach Ausbruch mit 450
const k = Array.from({ length: 21 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: i === 20 ? 105 : 100, v: i < 10 ? 200 : i < 20 ? 100 : 450 }))
const ab = ausbruchAb(k, () => 101, () => 99, 0.1)
check('Ausbruch: erste Kerze jenseits der Kante am Ende', ab === 20)
check('ohne Schluss draussen: kein Ausbruch', ausbruchAb(k.slice(0, 20), () => 101, () => 99, 0.1) === null)
const v = volumenImMuster(k, 0, ab)
check('Verlauf: zweite Hälfte halb so viel = −50 %', v && Math.abs(v.verlaufPct + 50) < 1e-9, JSON.stringify(v))
check('Ausbruchskerze 450 gegen Schnitt 150 = 3×', v && Math.abs(v.ausbruchFaktor - 3) < 1e-9)
check('Text', volumenText(v) === 'Volumen im Muster −50 %, Ausbruchskerze 3.0× Schnitt', volumenText(v))
check('ohne Volumen: unbekannt, nicht 0', volumenImMuster(k.map((x) => ({ ...x, v: 0 })), 0, ab) === null && volumenText(null) === 'Volumen unbekannt')
check('ohne Ausbruch: nur Verlauf', (() => { const w = volumenImMuster(k.slice(0, 20), 0, null); return w && w.ausbruchFaktor === null && Math.abs(w.verlaufPct + 50) < 1e-9 })())

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
