/**
 * Selbsttest des EMA-Indikators mit 3 + 3 Linien (`indikatorRegister.js`, Eintrag `ema`).
 *
 *   node src/utils/__selftest-ema-mehrfach.mjs
 *
 * Wichtigster Fall: ein gespeichertes einfaches EMA (nur `laenge`/`quelle`) zeigt
 * nach dem Umbau genau seine eine Linie, mit derselben Rechnung wie vorher.
 */
import { INDIKATOREN, rechneIndikator, saubereParams, neueInstanz, kurzname, emaMtfQuellen } from './chart/indikatorRegister.js'
import { ema } from '../../shared/indicators.js'
import { emaHoehereTf } from './chart/vwapVector.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const gleich = (a, b) => a.length === b.length && a.every((v, i) => (v == null && b[i] == null) || Math.abs(v - b[i]) < 1e-9)

const H = 3_600_000
const START = Date.UTC(2026, 8, 1)
const k = Array.from({ length: 600 }, (_, i) => {
    const c = 100 + Math.sin(i / 17) * 8 + i * 0.02
    return { t: START + i * H, o: c - 0.3, h: c + 1, l: c - 1, c, v: 100 }
})
const def = INDIKATOREN.ema

// Altbestand
const alt = { laenge: 34, quelle: 'c' }
const pa = saubereParams('ema', alt)
const ausgabenAlt = def.ausgabenFuer(pa)
check('altes EMA: genau eine Linie (Schlüssel „wert")', ausgabenAlt.length === 1 && ausgabenAlt[0].key === 'wert', JSON.stringify(ausgabenAlt.map((a) => a.key)))
const wa = rechneIndikator('ema', k, alt)
check('altes EMA: gleiche Rechnung wie vorher (ema 34)', gleich(wa.wert, ema(k, 34)) && wa.e2 === undefined && wa.m1 === undefined)
check('altes EMA: Name „EMA 34" wie vorher', kurzname('ema', alt, 'EMA') === 'EMA 34', kurzname('ema', alt, 'EMA'))

// Neu angelegt: 21/50/200
const neu = neueInstanz('ema')
const pn = saubereParams('ema', neu.params)
check('neues EMA: drei Linien 21/50/200', def.ausgabenFuer(pn).map((a) => a.key).join() === 'wert,e2,e3' && pn.laenge === 21 && pn.laenge2 === 50 && pn.laenge3 === 200)
const wn = rechneIndikator('ema', k, neu.params)
check('neues EMA: jede Linie ist ihre EMA', gleich(wn.e2, ema(k, 50)) && gleich(wn.e3, ema(k, 200)))
check('neues EMA: Name „EMA 21 · 50 · 200"', kurzname('ema', neu.params, 'EMA') === 'EMA 21 · 50 · 200', kurzname('ema', neu.params, 'EMA'))

// MTF
const mtf = { ...neu.params, mtfAn1: true, mtfTf1: '4h', mtfLaenge1: 20, mtfAn2: true, mtfTf2: '1h', mtfLaenge2: 10 }
const h4 = []
for (let i = 0; i < k.length; i += 4) {
    const g = k.slice(i, i + 4)
    h4.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)), c: g[g.length - 1].c, v: 400 })
}
const wm = rechneIndikator('ema', k, mtf, { emaMtf: { htf: { '4h': h4 } } })
check('MTF 4h auf 1h: wie emaHoehereTf (ohne Blick in die Zukunft)', gleich(wm.m1, emaHoehereTf(k, h4, 20, 4 * H, H)))
check('MTF-Zeiteinheit nicht höher (1h auf 1h): normale EMA', gleich(wm.m2, ema(k, 10)))
check('Quellen: nur wirklich höhere Zeiteinheiten werden geladen', JSON.stringify(emaMtfQuellen(saubereParams('ema', mtf), H)) === '["4h"]')
check('MTF-Linien gestrichelt in der Legende', def.ausgabenFuer(saubereParams('ema', mtf)).filter((a) => a.key.startsWith('m')).every((a) => a.strich === 'gestrichelt'))
check('Name mit MTF', kurzname('ema', mtf, 'EMA') === 'EMA 21 · 50 · 200 · 20 4h · 10 1h', kurzname('ema', mtf, 'EMA'))
// MTF ohne geladene Kerzen: leere Linie, kein Fehler
const ohne = rechneIndikator('ema', k, mtf, {})
check('MTF ohne geladene Kerzen: leer statt Fehler', ohne.m1.every((v) => v == null))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
