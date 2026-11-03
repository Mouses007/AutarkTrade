/**
 * Selbsttest Umkehrmuster (server/chart-umkehr.js): Doppeltop/-boden und
 * Kopf-Schulter (normal, invers) an künstlichen Kerzen — erkannt, richtig
 * benannt, Nackenlinie und Bruch gemessen; ungleiche Tops, ein Kopf unter den
 * Schultern und ein Muster über dem Top sind keine.
 *
 *   node server/__selftest-chart-umkehr.mjs
 */
import { kandidatenUmkehr, zickzack, umkehrName, umkehrKurz } from './chart-umkehr.js'
import { atr } from '../shared/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
/** Kerzen entlang eines Polygonzugs [[kerzen, preis], …], mit kleinem Zittern. */
function zug(punkte, rausch = 0.15) {
    const k = []
    for (let j = 1; j < punkte.length; j++) {
        const [l, a] = punkte[j - 1], [, b] = punkte[j]
        for (let i = 0; i < l; i++) {
            const v = a + (b - a) * (i / l) + Math.sin(k.length * 1.7) * rausch
            k.push({ o: v, h: v + 0.2, l: v - 0.2, c: v })
        }
    }
    const v = punkte[punkte.length - 1][1]
    k.push({ o: v, h: v + 0.2, l: v - 0.2, c: v })
    return k.map((x, i) => ({ ...x, t: i * H, v: 100 }))
}
const finde = (k) => { const a = atr(k, 14); return kandidatenUmkehr(k, a[a.length - 1]) }
const spiegel = (k) => k.map((x) => ({ ...x, o: 300 - x.o, h: 300 - x.l, l: 300 - x.h, c: 300 - x.c }))

check('Zickzack: abwechselnd, nur bestätigte Punkte', (() => {
    const w = zickzack(zug([[20, 100], [20, 110], [20, 100], [20, 110]]), 4)
    return w.length >= 2 && w.every((x, i) => !i || x.hoch !== w[i - 1].hoch) && w[w.length - 1].i < 79
})())

// Doppeltop: Anstieg 90 → 110, Rücksetzer 100, zweites Top 110, Bruch unter 100
{
    const k = zug([[30, 100], [25, 90], [20, 110], [20, 100], [20, 110], [15, 97]])
    const d = finde(k).find((x) => x.form === 'doppeltop')
    check('Doppeltop erkannt', !!d, JSON.stringify(finde(k).map((x) => x.form)))
    check('Doppeltop: Nackenlinie am Tief dazwischen, waagerecht', d && Math.abs(d.nacken.p1 - d.nacken.p2) < 1e-9 && Math.abs(d.nackenJetzt - 99.8) < 0.5, JSON.stringify(d?.nacken))
    check('Doppeltop: Schluss unter der Nackenlinie = gebrochen', d?.bruch === true && umkehrName(d).startsWith('Doppeltop, Nackenlinie gebrochen'))
    check('Doppeltop: vier Punkte (Anlauf, Top, Tief, Top)', d?.punkte.length === 4 && d.punkte[1].p > d.punkte[2].p && d.punkte[3].p > d.punkte[2].p)
    const b = finde(spiegel(k)).find((x) => x.form === 'doppelboden')
    check('gespiegelt: Doppelboden, Nackenlinie über den Tiefs', b && b.bruch && umkehrKurz(b) === 'Doppelboden' && b.nackenJetzt > b.punkte[1].p)
    const ungleich = zug([[30, 100], [25, 90], [20, 110], [20, 100], [20, 106], [15, 97]])
    check('ungleiche Tops (110 / 106 bei Tiefe 6) sind kein Doppeltop', !finde(ungleich).some((x) => x.form === 'doppeltop'))
    const darueber = zug([[30, 100], [25, 90], [20, 110], [20, 100], [20, 110], [10, 104], [10, 113]])
    check('ein Schluss über dem Top verwirft es', !finde(darueber).some((x) => x.form === 'doppeltop'))
    const offen = zug([[30, 100], [25, 90], [20, 110], [20, 100], [20, 110]])
    check('ohne Umkehr nach dem zweiten Top: noch kein Doppeltop (laufender Schwung zählt nicht)', !finde(offen).some((x) => x.form === 'doppeltop'))
}

// Kopf-Schulter: Anstieg, Schulter 108, Nacken 100, Kopf 116, Nacken 100, Schulter 108, Bruch
{
    const k = zug([[30, 95], [20, 88], [20, 108], [15, 100], [20, 116], [20, 100], [15, 108], [15, 97]])
    const d = finde(k).find((x) => x.form === 'kopfSchulter')
    check('Kopf-Schulter erkannt', !!d, JSON.stringify(finde(k).map((x) => x.form)))
    check('Kopf-Schulter: sechs Punkte, Kopf am höchsten', d?.punkte.length === 6 && d.punkte[3].p > d.punkte[1].p && d.punkte[3].p > d.punkte[5].p)
    check('Kopf-Schulter: gebrochen, Höhe in ATR gemessen', d?.bruch === true && d.hoeheAtr > 2 && umkehrName(d).includes('ATR'))
    const inv = finde(spiegel(k)).find((x) => x.form === 'inverseKopfSchulter')
    check('gespiegelt: inverse Kopf-Schulter', !!inv && umkehrKurz(inv) === 'Inverse Kopf-Schulter')
    const ohneKopf = zug([[30, 95], [20, 88], [20, 108], [15, 100], [20, 109], [20, 100], [15, 108], [15, 97]])
    check('Kopf kaum über den Schultern: keine Kopf-Schulter', !finde(ohneKopf).some((x) => x.form === 'kopfSchulter'))
    const schief = zug([[30, 95], [20, 88], [20, 104], [15, 100], [20, 116], [20, 100], [15, 112], [15, 97]])
    check('Schultern sehr ungleich (104 / 112): keine Kopf-Schulter', !finde(schief).some((x) => x.form === 'kopfSchulter'))
}
check('zu wenig Kerzen: nichts', !kandidatenUmkehr(zug([[10, 100], [10, 110]]), 1).length)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
