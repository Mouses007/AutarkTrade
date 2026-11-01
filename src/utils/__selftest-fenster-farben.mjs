/**
 * Selbsttest der Fenster-Farben und Divergenz-Linien (`utils/chart/fensterFarben.js`).
 *
 *   node src/utils/__selftest-fenster-farben.mjs
 */
import { adxFarben, atrFarben, obvFarben, volumenFarben, fundingFarben, longAnteilFarben, divergenzen, divArtenAus, DIV_ARTEN, FARBE } from './chart/fensterFarben.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const a = adxFarben([null, 15, 30, 30], [null, 30, 30, 10], [null, 10, 10, 30])
check('ADX: ohne Wert null, unter 20 grau, Käufer grün, Verkäufer rot', a[0] === null && a[1] === FARBE.grau && a[2] === FARBE.gruen && a[3] === FARBE.rot, JSON.stringify(a))

const atrR = [...Array(50).fill(10), 40]
const af = atrFarben(atrR)
check('ATR: Sprung nach oben ist rot (hoch), Gleichmass grau (normal)', af[50] === FARBE.rot && af[30] === FARBE.grau && af[5] === null, `${af[50]} ${af[30]}`)
const ruhig = atrFarben([...Array(50).fill(10), 2])
check('ATR: Einbruch nach unten ist blau (ruhig)', ruhig[50] === FARBE.blau)
// keine Zukunft: die Farbe einer Kerze hängt nicht von späteren ab
check('ATR: spätere Werte ändern frühere Farben nicht', atrFarben(atrR.slice(0, 40))[35] === af[35])

const k = Array.from({ length: 30 }, (_, i) => ({ o: 100 + i, c: 101 + i, v: i === 29 ? 500 : 100 }))
const of = obvFarben(k, Array.from({ length: 30 }, (_, i) => i * 10))
check('OBV: steigt mit dem Kurs → grün', of[25] === FARBE.gruen && of[5] === null)
const ofv = obvFarben(k, Array.from({ length: 30 }, (_, i) => -i * 10))
check('OBV: fällt bei steigendem Kurs → orange (Verteilung)', ofv[25] === FARBE.orange)
const vf = volumenFarben(k)
check('Volumen: steigende Kerze grün, ab 2× Schnitt kräftig', vf[29].includes('0.95') && vf[25].includes('0.35') && vf[25].startsWith('rgba(38'), `${vf[29]} ${vf[25]}`)

const ff = fundingFarben([null, 0.01, 0.03, 0.1, -0.05])
check('Funding: normal gedämpft, erhöht orange, hoch rot, negativ violett', ff[0] === null && ff[1].startsWith('rgba') && ff[2] === FARBE.orange && ff[3] === FARBE.rot && ff[4] === FARBE.violett)

const lf = longAnteilFarben([...Array.from({ length: 40 }, (_, i) => 52 + (i % 5)), 70, 49])
check('Long-Anteil: Extrem orange, darunter 50 rot oder Extrem', lf[40] === FARBE.orange && (lf[41] === FARBE.rot || lf[41] === FARBE.orange) && lf[10] === FARBE.gruen, JSON.stringify(lf.slice(38)))

// Divergenz: Kurs macht höhere Hochs, Oszillator tiefere
{
    const n = 60
    const kurs = Array.from({ length: n }, (_, i) => ({ h: 100 + i * 0.5 + (i === 20 ? 5 : 0) + (i === 40 ? 8 : 0), l: 90 + i * 0.5 }))
    const osz = Array.from({ length: n }, (_, i) => 50 + (i === 20 ? 30 : 0) + (i === 40 ? 20 : 0))
    const d = divergenzen(kurs, osz)
    check('Divergenz: höheres Kurs-Hoch, tieferes Oszillator-Hoch → bärisch 20→40', d.length === 1 && d[0].art === 'baerisch' && d[0].i1 === 20 && d[0].i2 === 40, JSON.stringify(d))
    const ohne = divergenzen(kurs, osz.map((v, i) => (i === 40 ? 85 : v)))
    check('Oszillator bestätigt (höheres Hoch): keine Divergenz', ohne.length === 0)
    const tiefK = Array.from({ length: n }, (_, i) => ({ h: 200 - i * 0.5, l: 190 - i * 0.5 - (i === 20 ? 5 : 0) - (i === 40 ? 8 : 0) }))
    const tiefO = Array.from({ length: n }, (_, i) => 50 - (i === 20 ? 30 : 0) - (i === 40 ? 20 : 0))
    const b = divergenzen(tiefK, tiefO)
    check('tieferes Kurs-Tief, höheres Oszillator-Tief → bullisch', b.length === 1 && b[0].art === 'bullisch')
    // Ein Pivot ganz am Ende (weniger als L Kerzen rechts) ist noch nicht bestätigt
    const spaet = divergenzen(kurs.slice(0, 43), osz.slice(0, 43))
    check('Pivot ohne 5 Kerzen rechts: noch keine Linie (kein Blick in die Zukunft)', spaet.length === 0)
}

// Doppel-Tief mit exakt gleichem Oszillatorwert (RENDERUSDT 1h, 30.10.2026): das tiefste
// Tief muss Pivot bleiben — sonst wird die Divergenz darüber hinweg vom Tief davor gezogen.
{
    const n = 70
    const kurs = Array.from({ length: n }, (_, i) => ({ h: 110, l: 100 - (i === 15 ? 5 : 0) - (i === 35 || i === 36 ? 12 : 0) - (i === 55 ? 8 : 0) }))
    const osz = Array.from({ length: n }, (_, i) => 50 - (i === 15 ? 18 : 0) - (i === 35 || i === 36 ? 26 : 0) - (i === 55 ? 12 : 0))
    const d = divergenzen(kurs, osz)
    check('Doppel-Tief gleich: keine Divergenz über das tiefste Tief hinweg', !d.some((x) => x.i1 === 15 && x.i2 === 55), JSON.stringify(d))
    const ohneDoppel = osz.map((v, i) => (i === 36 ? v + 0.5 : v))
    check('gleiches Ergebnis wie ohne Gleichstand', JSON.stringify(divergenzen(kurs, ohneDoppel)) === JSON.stringify(d))
}

// Weitere Arten (31.10.2026): versteckt und übertrieben, nur wenn gewählt, nie zwei Arten für ein Paar
{
    const n = 60
    const hochs = (k20, k40) => Array.from({ length: n }, (_, i) => ({ h: 100 + (i === 20 ? k20 : 0) + (i === 40 ? k40 : 0), l: 90 }))
    const osz = (o20, o40) => Array.from({ length: n }, (_, i) => 50 + (i === 20 ? o20 : 0) + (i === 40 ? o40 : 0))
    const alle = { arten: DIV_ARTEN }
    // Kurs tieferes Hoch (110 → 106), Oszillator höheres (80 → 90): versteckt bärisch
    const vb = divergenzen(hochs(10, 6), osz(30, 40), alle)
    check('versteckt bärisch: tieferes Kurs-Hoch, höheres Oszillator-Hoch', vb.length === 1 && vb[0].typ === 'versteckt' && vb[0].art === 'baerisch', JSON.stringify(vb))
    check('Gegenprobe: versteckt nicht gewählt → nichts', divergenzen(hochs(10, 6), osz(30, 40)).length === 0)
    // Doppelhoch (110 / 110.5, Spanne 10 → Toleranz 1.5), Oszillator schwächer: übertrieben bärisch
    const ub = divergenzen(hochs(10, 10.5), osz(30, 20), alle)
    check('übertrieben bärisch: gleiches Hoch, Oszillator tiefer', ub.length === 1 && ub[0].typ === 'uebertrieben' && ub[0].art === 'baerisch', JSON.stringify(ub))
    const rb = divergenzen(hochs(10, 16), osz(30, 20), alle)
    check('Gegenprobe: deutlich höheres Hoch bleibt regulär, nicht zusätzlich übertrieben', rb.length === 1 && rb[0].typ === 'regulaer')
    const tiefs = (k20, k40) => Array.from({ length: n }, (_, i) => ({ h: 110, l: 100 - (i === 20 ? k20 : 0) - (i === 40 ? k40 : 0) }))
    const oszT = (o20, o40) => Array.from({ length: n }, (_, i) => 50 - (i === 20 ? o20 : 0) - (i === 40 ? o40 : 0))
    const vu = divergenzen(tiefs(10, 6), oszT(20, 30), alle)
    check('versteckt bullisch: höheres Kurs-Tief, tieferes Oszillator-Tief', vu.length === 1 && vu[0].typ === 'versteckt' && vu[0].art === 'bullisch', JSON.stringify(vu))
    const uu = divergenzen(tiefs(10, 10.2), oszT(30, 20), alle)
    check('übertrieben bullisch: gleiches Tief, Oszillator höher', uu.length === 1 && uu[0].typ === 'uebertrieben' && uu[0].art === 'bullisch', JSON.stringify(uu))
    check('divArtenAus: Vorgabe nur regulär, Schalter einzeln', divArtenAus({}).join() === 'regulaer' && divArtenAus({ divRegulaer: false, divVersteckt: true, divUebertrieben: true }).join() === 'versteckt,uebertrieben')
    check('keine Art gewählt → keine Linie', divergenzen(hochs(10, 16), osz(30, 20), { arten: [] }).length === 0)
    // MACD-ähnliche Werte (Grössenordnung 0,001): absoluter Mindestunterschied 1 fände nichts, relativer schon
    const klein = osz(30, 20).map((v) => (v - 50) * 0.0001 + 0.0005)
    check('kleine Werte: minDiffRel statt fester Punkte', divergenzen(hochs(10, 16), klein).length === 0 && divergenzen(hochs(10, 16), klein, { minDiffRel: 0.05 }).length === 1)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
