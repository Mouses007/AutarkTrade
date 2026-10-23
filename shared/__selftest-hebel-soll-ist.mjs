/** Selbsttest: Soll/Ist der Hebelzonen (shared/hebelSollIst.js). */
import { sollIstZonen } from './hebelSollIst.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

// Kleiner Verlauf: Zeilen zu 100 USD um 80 000, eine Spalte.
const rows = 80, bucketSize = 100, base = 800 - 40
const leer = () => new Float32Array(rows)
const r = (preis) => Math.round(preis / bucketSize) - base
function hist({ offenLong = {}, offenShort = {}, gefegtLong = {}, gefegtShort = {} }) {
    const h = { rows, cols: 1, base, bucketSize, ts: [1000], long: leer(), short: leer(), sweptLong: leer(), sweptShort: leer() }
    for (const [p, m] of Object.entries(offenLong)) h.long[r(+p)] = m
    for (const [p, m] of Object.entries(offenShort)) h.short[r(+p)] = m
    for (const [p, m] of Object.entries(gefegtLong)) h.sweptLong[r(+p)] = m
    for (const [p, m] of Object.entries(gefegtShort)) h.sweptShort[r(+p)] = m
    return h
}
const liq = (preis, usd, isBuy = false, t = 5000) => ({ t, price: preis, qty: usd / preis, isBuy })
const opt = { mid: 80000, spannePct: 3, baender: 24, jetzt: 1000 + 41 * 3_600_000 }
const bei = (erg, preis, seite) => erg.zonen.find((z) => z.seite === seite && Math.abs(z.preis - preis) < 60)

// Zwei Long-Zonen abgeräumt: eine bekam Liquidationen, die andere nicht; eine Short-Zone offen.
const h = hist({ gefegtLong: { 79000: 10, 78000: 10 }, offenShort: { 81500: 8 } })
const ereignisse = [liq(79000, 500_000), liq(79010, 300_000), liq(78000, 20_000)]
const e = sollIstZonen(h, ereignisse, opt)
pruefe(bei(e, 79000, 'long')?.status === 'bestaetigt', 'abgeräumte Zone mit Liquidationen: bestätigt')
pruefe(bei(e, 78000, 'long')?.status === 'leer', 'abgeräumte Zone ohne nennenswerte Liquidationen: leer')
pruefe(bei(e, 81500, 'short')?.status === 'offen' && !bei(e, 81500, 'short').ist, 'noch nicht erreichte Zone: offen, kein Ist')
pruefe(e.treffer.bestaetigt === 1 && e.treffer.durchlaufen === 2, 'Trefferquote 1 von 2')
pruefe(e.stunden === 41, 'Fenster in Stunden')
pruefe(bei(e, 79000, 'long').ist <= bei(e, 79000, 'long').soll, 'Ist nie länger als das Soll')

// Gegenprobe Skala: Binance meldet zehnmal weniger — gleiches Urteil
const e10 = sollIstZonen(h, ereignisse.map((x) => ({ ...x, qty: x.qty / 10 })), opt)
pruefe(bei(e10, 79000, 'long').status === 'bestaetigt' && bei(e10, 78000, 'long').status === 'leer', 'Skalen-Gegenprobe: zehnmal weniger gemeldet, gleiches Urteil')

// Seiten-Semantik: eine liquidierte SHORT (isBuy) zählt nicht für eine Long-Zone
const s = sollIstZonen(hist({ gefegtLong: { 79000: 10, 78000: 10 } }), [liq(79000, 500_000, true), liq(78000, 400_000)], opt)
pruefe(bei(s, 79000, 'long').status === 'leer' && bei(s, 78000, 'long').status === 'bestaetigt', 'Seiten-Gegenprobe: Short-Liquidation füllt keine Long-Zone')

// Ohne Aufzeichnung: nur Soll, kein Urteil
const n = sollIstZonen(h, null, opt)
pruefe(n.erfasst === false && n.treffer === null && n.zonen.every((z) => z.ist === null), 'nicht erfasst: kein Ist, keine Trefferquote')
pruefe(bei(n, 79000, 'long').status === null, 'nicht erfasst: kein ✓/○ für durchlaufene Zonen')

// Ereignisse vor dem Fenster zählen nicht
const v = sollIstZonen(h, [liq(79000, 500_000, false, 500), liq(78000, 500_000)], opt)
pruefe(bei(v, 79000, 'long').status === 'leer', 'Liquidation vor dem Modellfenster zählt nicht')

// Kleine Zonen fallen weg, Bezug ist die grösste
const k = sollIstZonen(hist({ offenLong: { 79000: 10, 78500: 0.2 } }), [], opt)
pruefe(!bei(k, 78500, 'long') && bei(k, 79000, 'long')?.soll === 1, 'Zonen unter 5 % der grössten fallen weg; grösste = 1')

pruefe(sollIstZonen(hist({}), [], opt) === null, 'ohne Masse: null statt Nullbefund')

console.log(`hebel-soll-ist: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
