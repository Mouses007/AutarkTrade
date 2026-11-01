/**
 * Selbsttest Orderflow aus den Kerzen (src/utils/chart/orderflow.js) und das
 * Kaufvolumen in den Binance-Kerzen (server/chart-api.js kerzenAusBinance).
 *
 *   node src/utils/__selftest-orderflow.mjs
 */
import { deltaJeKerze, cvdSerie, kaufVerkauf, sessionBereiche, periodeVon, hatKaufvolumen, cvdKerzen, maJeAbschnitt, preisDivergenzen, quelleJeKerze, fensterEnde } from './chart/orderflow.js'
import { kerzenAusBinance } from '../../server/chart-api.js'
import { rechneIndikator, vorgaben } from './chart/indikatorRegister.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 26, 0, 0)   // Montag
console.log('\nKaufvolumen und Delta\n')
{
    const roh = [[T0, '1', '2', '0.5', '1.5', '10', T0 + H - 1, '15', 5, '6', '9', '0'], [T0 + H, '1', '2', '0.5', '1.5', '10']]
    const k = kerzenAusBinance(roh)
    check('Binance-Feld 9 (taker buy base) als 7. Wert', k[0].length === 7 && k[0][6] === 6, JSON.stringify(k[0]))
    check('Gegenprobe: kurze Zeile ohne Feld 9 bleibt 6 Werte', k[1].length === 6)
    const kerzen = [{ t: T0, v: 10, vb: 6 }, { t: T0 + H, v: 10, vb: 2 }, { t: T0 + 2 * H, v: 10 }]
    check('Delta = 2·Kauf − Volumen, ohne Kaufvolumen null', JSON.stringify(deltaJeKerze(kerzen)) === '[2,-6,null]')
    check('Kauf positiv, Verkauf negativ', JSON.stringify(kaufVerkauf(kerzen)) === JSON.stringify({ kauf: [6, 2, null], verkauf: [-4, -8, null] }))
    check('hatKaufvolumen', hatKaufvolumen(kerzen) && !hatKaufvolumen([{ v: 1 }]))
}

console.log('\nCVD\n')
{
    const k = Array.from({ length: 50 }, (_, i) => ({ t: T0 + i * H, v: 10, vb: 7 }))   // Delta je Kerze +4
    const fort = cvdSerie(k)
    check('fortlaufend: 4, 8, … 200', fort[0] === 4 && fort[49] === 200)
    const tag = cvdSerie(k, { anker: 'tag' })
    check('je Tag zurückgesetzt (UTC): Kerze 24 beginnt bei 4', tag[23] === 96 && tag[24] === 4 && tag[49] === 8, `${tag[23]} ${tag[24]} ${tag[49]}`)
    const zuerich = cvdSerie(k, { anker: 'tag', zone: 'Europe/Zurich' })
    // 26.10.2026 ist Winterzeit (UTC+1): Mitternacht Zürich = 23:00 UTC → Kerze 23 beginnt neu
    check('Ortszeit Zürich: neuer Tag um 23:00 UTC', zuerich[22] === 92 && zuerich[23] === 4, `${zuerich[22]} ${zuerich[23]}`)
    const luecke = cvdSerie([{ t: 0, v: 10, vb: 7 }, { t: H, v: 10 }, { t: 2 * H, v: 10, vb: 7 }])
    check('Lücke ohne Kaufvolumen: null, danach neu ab 0 (keine falsche Fortsetzung)', JSON.stringify(luecke) === '[4,null,4]')
    check('Woche beginnt Montag', periodeVon(T0, 'woche') !== periodeVon(T0 - 1, 'woche') && periodeVon(T0, 'woche') === periodeVon(T0 + 6 * 24 * H, 'woche'))
    const r = rechneIndikator('cvd', k, { ...vorgaben('cvd'), skala: 'coins' }, {})
    check('Indikator cvd rechnet Kerzen (Schluss) und MA', r.cvd[49] === 200 && r.cvd_o[49] === 196 && Array.isArray(r._div) && r.ma[49] != null)
    const d = rechneIndikator('deltaVol', k, vorgaben('deltaVol'), {})
    check('Indikator deltaVol: Kauf, Verkauf, Delta', d.kauf[0] === 7 && d.verkauf[0] === -3 && d.delta[0] === 4)
}

console.log('\nSessions\n')
{
    const k = Array.from({ length: 24 * 7 }, (_, i) => ({ t: T0 + i * H }))
    const b = sessionBereiche(k, { anzahl: 3 })
    check('die jüngsten 3 Tage, älteste zuerst, letzte laufend', b.length === 3 && b[0].a === 96 && b[2].b === 167 && b[2].laufend && !b[0].laufend, JSON.stringify(b))
    check('Woche: ein Bereich über alle 7 Tage', sessionBereiche(k, { art: 'woche' }).length === 1)
}

console.log('\nCVD-Kerzen, MA je Abschnitt, Preis-Divergenzen\n')
{
    const M = 60_000
    // Chart 1h: Kerze 0 Delta +4; ihre 60 Intrabar-Minuten: erst 40 × +1, dann 20 × −1,8 → Zwischenstand bis +40, Schluss +4
    const chart = [{ t: 0, h: 2, l: 1, c: 1.5, v: 10, vb: 7 }]
    const intra = Array.from({ length: 60 }, (_, i) => (i < 40 ? { t: i * M, h: 2, l: 1, c: 1.5, v: 1, vb: 1 } : { t: i * M, h: 2, l: 1, c: 1.5, v: 1.8, vb: 0 }))
    const r = cvdKerzen(chart, { intra, ivMs: H })
    check('Docht aus Intrabar: Hoch 40, Schluss aus der Chart-Kerze (4)', r.h[0] === 40 && r.c[0] === 4 && r.o[0] === 0 && Math.abs(r.l[0]) < 1e-9, JSON.stringify(r))
    const ohne = cvdKerzen(chart)
    check('ohne Intrabar keine Dochte, gleicher Schluss', ohne.h[0] === 4 && ohne.l[0] === 0 && ohne.c[0] === 4)
    const usd = cvdKerzen([{ t: 0, h: 12, l: 9, c: 9, v: 10, vb: 7 }], { usd: true })
    check('USD = Delta × hlc3 (4 × 10)', usd.c[0] === 40)
    // Bitunix-Kerzen ohne vb, Binance-Kerzen als Quelle
    const fremd = cvdKerzen([{ t: 0, v: 99 }, { t: H, v: 99 }], { quelle: [{ t: 0, v: 10, vb: 6 }, { t: H, v: 10, vb: 8 }] })
    check('Quelle Binance: Delta aus deren Kerzen, eigene ignoriert', fremd.c[0] === 2 && fremd.c[1] === 8)
    // FUN-F2A-001: 3d von Bitunix/Bitget beginnt an anderen Tagen als 3d von Binance — Binance-1d summiert
    const D = 24 * H, T3 = Date.UTC(2026, 9, 1)
    const chart3d = Array.from({ length: 4 }, (_, i) => ({ t: T3 + i * 3 * D, h: 2, l: 1, c: 1.5, v: 99 }))
    const bn3d = chart3d.map((k) => ({ ...k, t: k.t + D, v: 30, vb: 18 }))
    check('Gegenprobe: Binance-3d mit versetztem Beginn trifft keine Kerze', !quelleJeKerze(chart3d, bn3d, { ivMs: 3 * D }).some(Boolean))
    const bn1d = Array.from({ length: 11 }, (_, i) => ({ t: T3 + i * D, h: 2, l: 1, c: 1.5, v: 10, vb: 6 }))
    const r3 = cvdKerzen(chart3d, { quelle: bn1d, quelleMs: D, ivMs: 3 * D, interval: '3d' })
    check('3d aus Binance-1d: je Kerze drei Tage summiert (Delta 6), laufende letzte Kerze mit 2 Tagen', JSON.stringify(r3.c) === '[6,12,18,22]', JSON.stringify(r3.c))
    const loch = bn1d.filter((_, i) => i !== 4)
    check('Lücke in den Quelltagen: diese Chart-Kerze bleibt leer statt halber Summe', cvdKerzen(chart3d, { quelle: loch, quelleMs: D, ivMs: 3 * D }).c[1] === null)
    // FUN-F2A-002: 1M — das Fenster endet am nächsten Monatsbeginn, nicht nach 30,44 Tagen
    const MON = 30.44 * D
    const monate = [0, 1, 2].map((m) => ({ t: Date.UTC(2026, m, 1), h: 2, l: 1, c: 1.5, v: 10, vb: 5 }))
    check('Fensterende Februar = 1. März (nächste Kerze)', fensterEnde(monate, 1, MON, '1M') === Date.UTC(2026, 2, 1))
    check('Fensterende März (letzte Kerze, 31 Tage) = 1. April', fensterEnde(monate, 2, MON, '1M') === Date.UTC(2026, 3, 1))
    // Verkäufe am 1./2. März (je Stunde −20) dürfen nicht im Februar-Docht stehen; 31. März 20:00 gehört zum März
    const intraM = []
    for (let t = monate[0].t; t < Date.UTC(2026, 3, 1); t += H) {
        const verkauf = t >= monate[2].t && t < monate[2].t + 48 * H
        intraM.push({ t, h: 2, l: 1, c: 1.5, v: 40, vb: verkauf ? 10 : (t === Date.UTC(2026, 2, 31, 20) ? 1020 : 20) })
    }
    const rm = cvdKerzen(monate, { intra: intraM, ivMs: MON, interval: '1M' })
    check('1M: Februar ohne Docht aus dem März', rm.l[1] === 0 && rm.h[1] === 0, `l ${rm.l[1]} h ${rm.h[1]}`)
    check('1M: März-Docht reicht bis Monatsende (Kauf +2000 am 31. um 20 Uhr)', rm.h[2] === 1040 && rm.l[2] === -960, `h ${rm.h[2]} l ${rm.l[2]}`)
    const tage = Array.from({ length: 48 }, (_, i) => ({ t: T0 + i * H, h: 2, l: 1, c: 1.5, v: 10, vb: 6 }))
    const rt = cvdKerzen(tage, { anker: 'tag' })
    check('Reset: neuer Abschnitt und Startmarke an Kerze 24, erste Kerze ohne Marke', rt.seg[23] === 0 && rt.seg[24] === 1 && rt.start[24] && !rt.start[0] && rt.o[24] === 0)
    const ma = maJeAbschnitt(rt.c, rt.seg, 3, 'sma')
    // Delta je Kerze 2 (2·6 − 10): Abschnitt 2 läuft 2, 4, 6 … → laufendes Mittel 2, 3, dann SMA 3 = 4
    check('MA beginnt nach dem Reset neu: laufendes Mittel, dann SMA', ma[24] === 2 && ma[25] === 3 && ma[26] === 4, `${ma[24]} ${ma[25]} ${ma[26]}`)
    const rr = rechneIndikator('cvd', tage, { ...vorgaben('cvd'), reset: 'tag', skala: 'coins' }, {})
    const mitExt = rechneIndikator('cvd', [{ t: 0, h: 2, l: 1, c: 1.5, v: 99 }], { ...vorgaben('cvd'), skala: 'coins' }, { cvd: { kerzen: [{ t: 0, v: 10, vb: 6 }], intra: intra.slice(0, 1), ivMs: H } })
    check('Indikator liest die nachgeladenen Binance-Kerzen (extern.cvd)', mitExt.cvd[0] === 2, JSON.stringify(mitExt.cvd))
    check('Linienstück zum Reset unsichtbar, sonst Farbe aus dem Register', rr._farbe_ma[23] === 'rgba(0,0,0,0)' && rr._farbe_ma[24] === null && rr._farbe_ma[22] === null)
    // Preis-Divergenz bärisch: Preis-Hoch 20 → 40 höher, CVD-Hoch tiefer; innerhalb eines Abschnitts
    const n = 60
    const pk = Array.from({ length: n }, (_, i) => ({ t: i * H, o: 100, c: 100, h: 101 + (i === 20 ? 5 : 0) + (i === 40 ? 8 : 0), l: 99, v: 1 }))
    const cv = { c: [], h: [], l: [], o: [], seg: new Array(n).fill(0) }
    for (let i = 0; i < n; i++) { const w = Math.sin(i / 3) * 10 + (i === 20 ? 100 : 0) + (i === 40 ? 60 : 0); cv.c.push(w); cv.h.push(w); cv.l.push(w); cv.o.push(w) }
    const d = preisDivergenzen(pk, cv, { links: 10, rechts: 3, minAtr: 0.5, minProzent: 5 })
    check('bärisch an Preis-Pivots 20 → 40 (CVD-Hoch 100 → 60)', d.length === 1 && d[0].art === 'baerisch' && d[0].i1 === 20 && d[0].i2 === 40 && d[0].v2 < d[0].v1, JSON.stringify(d))
    const segGetrennt = { ...cv, seg: cv.seg.map((_, i) => (i < 30 ? 0 : 1)) }
    check('nie über einen Reset (Pivots in verschiedenen Abschnitten)', preisDivergenzen(pk, segGetrennt).length === 0)
    check('nur geschlossene Kerzen bestätigen: Pivot 3 Kerzen vor der laufenden zählt nicht', preisDivergenzen(pk.slice(0, 44), { c: cv.c.slice(0, 44), h: cv.h.slice(0, 44), l: cv.l.slice(0, 44), seg: cv.seg.slice(0, 44) }).length === 0
        && preisDivergenzen(pk.slice(0, 45), { c: cv.c.slice(0, 45), h: cv.h.slice(0, 45), l: cv.l.slice(0, 45), seg: cv.seg.slice(0, 45) }).length === 1)
    check('Mindest-CVD-Abstand filtert', preisDivergenzen(pk, cv, { minProzent: 90 }).length === 0)
    check('Höchstabstand der Pivots filtert', preisDivergenzen(pk, cv, { maxAbstand: 15 }).length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
