/**
 * Selbsttest: Skala und Grid-Linien des Bot-Charts (src/utils/bot-chart.js).
 * Aufruf: node src/utils/__selftest-bot-chart.mjs
 */
import { gridStufen, chartSkala, abstandProzent, duenneAus, legeBeschriftungen } from './bot-chart.js'

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
const s3 = chartSkala([95, 100], [{ wert: 50, immer: true }], {})   // nur noch der Kurs ist `immer`
p('„immer“-Linie kommt auch von weit her auf die Achse', s3.innen(50))
p('ohne Preise → null', chartSkala([], [], {}) === null)
p('flache Kerzen: Spanne aus 5 % des Kurses', chartSkala([100, 100], [{ wert: 101 }]).innen(101))

{ const f = chartSkala([100, 100], [], {}); p('eine flache Kerze: Achse hat eine Spanne', f.hi > f.lo) }

console.log('Abstand')
p('−19.8 %', nahe(abstandProzent(0.721878, 0.8999), (0.721878 / 0.8999 - 1) * 100))
p('ohne Kurs → null', abstandProzent(1, 0) === null && abstandProzent(null, 1) === null)

console.log('Einstieg ist eine normale Linie')
{
    const fern = chartSkala([100, 110], [{ wert: 10 }, { wert: 105, immer: true }], {})
    p('Einstieg weit weg dehnt die Achse nicht', !fern.innen(10) && fern.lo > 90)
    const nah = chartSkala([100, 110], [{ wert: 98.5 }, { wert: 105, immer: true }], {})
    p('Einstieg nahe kommt auf die Achse', nah.innen(98.5))
}

console.log('Grid-Linien ausdünnen')
{
    const viele = Array.from({ length: 499 }, (_, i) => i)
    const d = duenneAus(viele, 80)
    p('499 Linien → höchstens 80, jede 7.', d.werte.length <= 80 && d.jede === 7 && d.werte.length === 72, `${d.werte.length}/${d.jede}`)
    p('gleicher Abstand', d.werte.every((v, i) => i === 0 || v - d.werte[i - 1] === 7))
    p('bis 80 unverändert', duenneAus(viele.slice(0, 80), 80).jede === 1 && duenneAus(viele.slice(0, 80), 80).werte.length === 80)
    p('81 → jede 2.', duenneAus(viele.slice(0, 81), 80).werte.length === 41)
    p('Unsinn → leer', duenneAus(null).werte.length === 0)
}

console.log('Beschriftungen legen')
{
    // 300 px Höhe über 100 Preis-Einheiten: 1 Einheit = 3 px
    const o = { lo: 0, hi: 100, hoehe: 300, breite: 600 }
    const oben = (s) => /Top$/.test(s)
    const frei = legeBeschriftungen([{ wert: 50, text: 'Kurs 50', wunsch: 'insideStartBottom' }, { wert: 80, text: 'Ø Einstieg 80', wunsch: 'insideEndTop' }], o)
    p('weit auseinander: jeder bekommt seinen Wunsch', frei[0] === 'insideStartBottom' && frei[1] === 'insideEndTop')
    // Einstieg 2 Einheiten (6 px) UNTER dem Kurs: Kurs-Text unter der Kurs-Linie wäre vom Einstieg durchgestrichen
    const eng = legeBeschriftungen([{ wert: 50, text: 'Kurs 50', wunsch: 'insideStartBottom' }, { wert: 48, text: 'Ø Einstieg 48', wunsch: 'insideEndTop' }], o)
    p('Einstieg knapp unter dem Kurs: Kurs-Text weicht nach oben', oben(eng[0]), eng[0])
    p('… und der Einstieg-Text nach unten', !oben(eng[1]), eng[1])
    const eng2 = legeBeschriftungen([{ wert: 50, text: 'Kurs 50', wunsch: 'insideStartBottom' }, { wert: 52, text: 'Ø Einstieg 52', wunsch: 'insideEndTop' }], o)
    p('Einstieg knapp über dem Kurs: Wünsche passen schon', eng2[0] === 'insideStartBottom' && eng2[1] === 'insideEndTop')
    // gleiche Seite, gleiche Höhe: zwei Texte dürfen nicht aufeinander liegen
    const gleich = legeBeschriftungen([{ wert: 50, text: 'SL 50', wunsch: 'insideEndTop' }, { wert: 50.5, text: 'Liq 50.5', wunsch: 'insideEndTop' }], o)
    p('zwei Linien fast gleich, gleicher Wunsch: verschiedene Plätze', gleich[0] !== gleich[1], gleich.join(' / '))
    // Band-Ende als Hindernis: Startpreis-Text nicht dorthin, wo die Band-Linie durchläuft
    const hind = legeBeschriftungen([{ wert: 60, text: 'Startpreis 60', wunsch: 'insideStartTop' }], { ...o, hindernisse: [62] })
    p('fremde Linie im Text: Text wechselt die Seite der Linie', !oben(hind[0]), hind[0])
    // ganz oben: über der Linie ist kein Platz
    const rand = legeBeschriftungen([{ wert: 99, text: 'TP 99', wunsch: 'insideEndTop' }], o)
    p('Linie am oberen Rand: Text darunter', !oben(rand[0]))
    // schmal (Handy): links und rechts überlappen sich in der Breite → nicht dieselbe Höhe
    const schmal = legeBeschriftungen([{ wert: 50, text: 'Kurs 0.8999', wunsch: 'insideStartBottom' }, { wert: 49, text: 'Ø Einstieg 0.960639', wunsch: 'insideEndTop' }], { ...o, breite: 150 })
    p('schmale Fläche: Texte auf verschiedenen Seiten der Linien', oben(schmal[0]) !== oben(schmal[1]), schmal.join(' / '))
    p('ohne Fläche: Wunsch bleibt', legeBeschriftungen([{ wert: 1, text: 'x', wunsch: 'insideStartTop' }], { lo: 1, hi: 1, hoehe: 0, breite: 0 })[0] === 'insideStartTop')
}

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
