/**
 * Selbsttest: Split-Wache.
 *
 *   node server/aktien/__selftest-splits.mjs
 */
import assert from 'node:assert/strict'
import { ausSplits, bereinigeSplits, bereinigeSeite, verdaechtigeSpruenge } from './splits.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const nah = (a, b, text) => { assert.ok(Math.abs(a - b) < 1e-9, `${text}: ${a} ≠ ${b}`); n++ }
const H = 3_600_000, TAG = 24 * H

// Yahoo-Form (NVDA, echte Antwort vom 15.11.2026, gekürzt)
const yahoo = { chart: { result: [{ events: { splits: {
    1717214400: { date: 1718026200, numerator: 10, denominator: 1, splitRatio: '10:1' },
    1625112000: { date: 1626787800, numerator: 4, denominator: 1, splitRatio: '4:1' },
    9: { date: 5, numerator: 1, denominator: 1, splitRatio: '1:1' },
} } }] } }
const sp = ausSplits(yahoo)
ok(sp.length === 2 && sp[0].faktor === 4 && sp[1].faktor === 10 && sp[1].t === 1718026200000, 'Splits gelesen, aufsteigend, 1:1 verworfen')
ok(ausSplits({}).length === 0 && ausSplits({ chart: { result: [{ events: {} }] } }).length === 0, 'ohne Splits leer')
ok(ausSplits({ chart: { result: [{ events: { splits: { 1: { date: 100, numerator: 1, denominator: 10 } } } }] } })[0].faktor === 0.1, 'Zusammenlegung: Faktor unter 1')

// Stundenkerzen: 480 vor dem Split 20:1, 23 danach (leicht bewegt), Split nach Kerze 49
const t0 = Date.UTC(2026, 6, 13)
const kerzen = Array.from({ length: 100 }, (_, i) => {
    const p = i < 50 ? 480 + i * 0.1 : 23 + (i - 50) * 0.01
    return { t: t0 + i * H, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1000, vb: 400 }
})
const split = { t: t0 + 53 * H, faktor: 20, text: '20:1' }
const kopie = JSON.stringify(kerzen)
const r = bereinigeSplits(kerzen, [split])
ok(JSON.stringify(kerzen) === kopie, 'Eingabe bleibt unverändert')
ok(r.splits.length === 1 && r.splits[0].angewendet && r.splits[0].bei === t0 + 50 * H, 'Sprung gefunden, obwohl der Ex-Zeitpunkt drei Kerzen daneben liegt')
nah(r.kerzen[0].c, 24, 'Kurs davor geteilt')
nah(r.kerzen[49].h, (480 + 4.9) * 1.01 / 20, 'Hoch davor geteilt')
nah(r.kerzen[0].v, 20000, 'Volumen davor vervielfacht')
nah(r.kerzen[0].vb, 8000, 'Kaufvolumen ebenso')
ok(r.kerzen[50] === kerzen[50] && r.kerzen[99].c === kerzen[99].c, 'Kerzen ab dem Split unverändert')
ok(verdaechtigeSpruenge(r.kerzen).length === 0 && verdaechtigeSpruenge(kerzen).length === 1, 'nach der Umrechnung kein Sprung mehr')

// Der Sprung steht NICHT in den Kerzen (Future erst danach gelistet, oder schon bereinigt)
const glatt = kerzen.map((k) => ({ ...k, o: 23, h: 23.2, l: 22.8, c: 23 }))
const r2 = bereinigeSplits(glatt, [split])
ok(r2.kerzen === glatt && r2.splits[0].angewendet === false && r2.splits[0].bei === null, 'ohne Sprung wird nichts umgerechnet')

// Split ausserhalb des Zeitraums zählt nicht
ok(bereinigeSplits(kerzen, [{ t: t0 - 30 * TAG, faktor: 4 }]).splits.length === 0, 'Split lange vor den Kerzen')
ok(bereinigeSplits(kerzen, [{ t: t0 + 60 * TAG, faktor: 4 }]).splits.length === 0, 'Split lange nach den Kerzen')

// Ein Kurssturz um 40 % ist kein Split 20:1
const sturz = kerzen.map((k, i) => (i < 50 ? { ...k, c: 100, o: 100, h: 101, l: 99 } : { ...k, c: 60, o: 60, h: 61, l: 59 }))
ok(bereinigeSplits(sturz, [split]).splits[0].angewendet === false, 'Sturz passt nicht zum Faktor')

// Zusammenlegung 1:10: der Kurs springt hinauf, die Historie davor wird hochgerechnet
const rev = kerzen.map((k, i) => (i < 50 ? { ...k, o: 2, h: 2.1, l: 1.9, c: 2 } : { ...k, o: 20, h: 21, l: 19, c: 20 }))
const r3 = bereinigeSplits(rev, [{ t: t0 + 50 * H, faktor: 0.1 }])
ok(r3.splits[0].angewendet, 'Zusammenlegung erkannt')
nah(r3.kerzen[0].c, 20, 'Kurs davor hochgerechnet')
nah(r3.kerzen[0].v, 100, 'Volumen davor verkleinert')

// Zwei Splits: 2:1 bei Kerze 30, 5:1 bei Kerze 70 → ganz vorn ÷ 10
const zwei = Array.from({ length: 100 }, (_, i) => {
    const p = i < 30 ? 1000 : i < 70 ? 500 : 100
    return { t: t0 + i * TAG, o: p, h: p, l: p, c: p, v: 1 }
})
const r4 = bereinigeSplits(zwei, [{ t: t0 + 30 * TAG, faktor: 2 }, { t: t0 + 70 * TAG, faktor: 5 }])
ok(r4.splits.length === 2 && r4.splits.every((s) => s.angewendet) && r4.splits[0].faktor === 2, 'beide Splits angewendet, Bericht aufsteigend')
nah(r4.kerzen[0].c, 100, 'vor beiden Splits: ÷ 10')
nah(r4.kerzen[50].c, 100, 'zwischen den Splits: ÷ 5')
nah(r4.kerzen[0].v, 10, 'Volumen × 10')

ok(bereinigeSplits([], [split]).kerzen.length === 0 && bereinigeSplits(kerzen, []).kerzen === kerzen, 'leere Eingaben')
ok(verdaechtigeSpruenge(rev)[0].verhaeltnis === 0.1, 'Sprung nach oben ist ebenfalls verdächtig')

// ── Tageskerze, IN die der Split fällt: eröffnet im alten, schliesst im neuen Massstab ──
const tage = [
    { t: 1 * TAG, o: 470, h: 485, l: 465, c: 480, v: 10 },
    { t: 2 * TAG, o: 481, h: 498, l: 21, c: 23, v: 10 },       // Ex-Tag: Hoch 498 stammt aus dem alten Massstab
    { t: 3 * TAG, o: 23, h: 24, l: 22, c: 23.5, v: 10 },
]
const rt = bereinigeSplits(tage, [{ t: 2 * TAG + 12 * H, faktor: 20 }])
ok(rt.splits[0].angewendet && rt.splits[0].bei === 2 * TAG, 'Sprung an der Ex-Tag-Kerze gefunden')
nah(rt.kerzen[1].o, 481 / 20, 'ihre Eröffnung wird umgerechnet')
ok(rt.kerzen[1].h < 30 && rt.kerzen[1].h >= rt.kerzen[1].o && rt.kerzen[1].l === 21 && rt.kerzen[1].c === 23, `ihr Hoch aus dem alten Massstab ist begrenzt (${rt.kerzen[1].h.toFixed(2)}), Tief und Schluss bleiben`)
ok(Math.max(...rt.kerzen.map((k) => k.h)) < 30, 'kein Hoch aus dem alten Massstab bleibt stehen')
ok(tage[1].h === 498, 'Eingabe unverändert')
// Gegenprobe: eine Kerze, die sauber im neuen Massstab eröffnet, bleibt wie sie ist
ok(r.kerzen[50] === kerzen[50], 'Stundenkerze nach einer Handelspause: unverändert')
// Zusammenlegung 1:10 in einer Tageskerze: Tief stammt aus dem alten Massstab
const rz = bereinigeSplits([{ t: TAG, o: 2, h: 2.1, l: 1.9, c: 2, v: 1 }, { t: 2 * TAG, o: 2, h: 21, l: 1.95, c: 20, v: 1 }, { t: 3 * TAG, o: 20, h: 21, l: 19, c: 20, v: 1 }], [{ t: 2 * TAG, faktor: 0.1 }])
ok(rz.kerzen[1].o === 20 && rz.kerzen[1].l === 20 && rz.kerzen[1].h === 21, 'Zusammenlegung: Eröffnung hochgerechnet, altes Tief begrenzt')
const seiteTag = bereinigeSeite(tage, [{ t: 2 * TAG + 12 * H, faktor: 20 }], new Map())
ok(Math.max(...seiteTag.kerzen.map((k) => k.h)) < 30 && seiteTag.angewendet === 1, 'seitenweise ebenso')

// ── Seitenweise (Chart): neu nach alt, das Wissen um den Sprung wandert mit ──
const wissen = new Map()
const seiteNeu = kerzen.slice(70)          // ganz nach dem Split
const seiteMitte = kerzen.slice(40, 70)    // enthält den Sprung (Kerze 50)
const seiteAlt = kerzen.slice(0, 40)       // ganz davor
const s1 = bereinigeSeite(seiteNeu, [split], wissen)
ok(s1.kerzen === seiteNeu && s1.angewendet === 0 && wissen.size === 0, 'Seite nach dem Split: unverändert, noch kein Wissen')
const s2 = bereinigeSeite(seiteMitte, [split], wissen)
ok(s2.angewendet === 1 && wissen.get(split.t) === t0 + 50 * H, 'Seite mit dem Sprung: gefunden und gemerkt')
nah(s2.kerzen[0].c, (480 + 4) / 20, 'davor geteilt')
ok(s2.kerzen[10] === seiteMitte[10], 'ab dem Sprung unverändert')
const s3 = bereinigeSeite(seiteAlt, [split], wissen)
ok(s3.angewendet === 1 && Math.abs(s3.kerzen[0].c - 24) < 1e-9 && Math.abs(s3.kerzen[39].v - 20000) < 1e-9, 'ältere Seite ohne Sprung: dank Wissen ganz umgerechnet')
ok(seiteAlt[0].c === 480, 'die Seite selbst bleibt unverändert')
const ohneWissen = bereinigeSeite(seiteAlt, [split], new Map())
ok(ohneWissen.kerzen === seiteAlt && ohneWissen.angewendet === 0, 'ohne Wissen bleibt eine Seite vor dem Split unverändert — unbekannt, nicht geraten')
ok(bereinigeSeite(seiteNeu, [split], wissen).kerzen === seiteNeu, 'mit Wissen: Seite nach dem Split bleibt unverändert')
ok(bereinigeSeite([], [split], wissen).kerzen.length === 0 && bereinigeSeite(seiteAlt, [], wissen).kerzen === seiteAlt, 'leere Eingaben')
// Zusammengesetzt ergibt sich dieselbe Reihe wie beim Rechnen in einem Stück
const gestueckelt = [...s3.kerzen, ...s2.kerzen, ...s1.kerzen]
ok(gestueckelt.every((k, i) => Math.abs(k.c - r.kerzen[i].c) < 1e-9 && Math.abs(k.v - r.kerzen[i].v) < 1e-9), 'seitenweise gerechnet = in einem Stück gerechnet')

console.log(`✓ Split-Wache: ${n} Prüfungen`)
