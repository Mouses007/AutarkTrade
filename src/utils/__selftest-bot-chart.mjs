/**
 * Selbsttest: Skala und Grid-Linien des Bot-Charts (src/utils/bot-chart.js).
 * Aufruf: node src/utils/__selftest-bot-chart.mjs
 */
import { gridStufen, chartSkala, abstandProzent } from './bot-chart.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

console.log('Grid-Stufen')
const ar = gridStufen(0.88, 1.3043, 14, 'arithmetic')
p('arithmetisch: 15 Linien inkl. Enden', ar.length === 15 && ar[0] === 0.88 && ar[14] === 1.3043)
p('arithmetisch: gleicher Schritt', nahe(ar[1] - ar[0], (1.3043 - 0.88) / 14) && nahe(ar[14] - ar[13], (1.3043 - 0.88) / 14))
const geo = gridStufen(100, 200, 4, 'geometric')
p('geometrisch: gleicher Faktor', nahe(geo[1] / geo[0], geo[4] / geo[3]) && geo[4] === 200)
const cm = gridStufen(100, 200, 4, 'arithmetic', true)
p('Coin-M: arithmetisch im Kehrwert', nahe(1 / cm[0] - 1 / cm[1], 1 / cm[3] - 1 / cm[4]) && cm[0] === 100 && cm[4] === 200)
p('Coin-M: in USD unten dichter', cm[1] - cm[0] < cm[4] - cm[3])
p('aufsteigend', [ar, geo, cm].every((s) => s.every((v, i) => i === 0 || v > s[i - 1])))
p('Unsinn → leer', gridStufen(2, 1, 5).length === 0 && gridStufen(1, 2, 0).length === 0 && gridStufen(1, 2, 2.5).length === 0 && gridStufen(null, 2, 3).length === 0)

console.log('Skala (Fall XRP 15.11.2026)')
const preise = [0.8949, 0.9999]
const s = chartSkala(preise, [{ wert: 0.721878 }, { wert: 0.960639, immer: true }, { wert: 0.8999, immer: true }], { unten: 0.88, oben: 1.3043 })
p('Liquidation 0.72 weit weg → nicht auf der Achse', !s.innen(0.721878))
p('Band-Ende oben 1.30 weit weg → nicht auf der Achse', !s.innen(1.3043))
p('Band-Ende unten 0.88 nah → auf der Achse', s.innen(0.88))
p('Kerzen ganz drin', s.innen(0.8949) && s.innen(0.9999))
p('Rand 4 %', s.lo < 0.88 && s.hi > 0.9999)
const s2 = chartSkala([95, 100], [{ wert: 94 }], {})
p('nahe Liquidation kommt auf die Achse', s2.innen(94))
const s3 = chartSkala([95, 100], [{ wert: 50, immer: true }], {})
p('„immer“-Linie kommt auch von weit her auf die Achse', s3.innen(50))
p('ohne Preise → null', chartSkala([], [], {}) === null)
p('flache Kerzen: Spanne aus 5 % des Kurses', chartSkala([100, 100], [{ wert: 101 }]).innen(101))

console.log('Abstand')
p('−19.8 %', nahe(abstandProzent(0.721878, 0.8999), (0.721878 / 0.8999 - 1) * 100))
p('ohne Kurs → null', abstandProzent(1, 0) === null && abstandProzent(null, 1) === null)

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
