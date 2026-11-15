/**
 * Selbsttest: Split-Wache.
 *
 *   node server/aktien/__selftest-splits.mjs
 */
import assert from 'node:assert/strict'
import { ausSplits, bereinigeSplits, bereinigeSeite, verdaechtigeSpruenge, bereinigeFunding, positionUeberSplit, faelligeSplits, leseSplitVermerk } from './splits.js'

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

// ── Funding über einen Split: Mark-Preise davor in den neuen Massstab ──
{
    const bericht = [{ t: 1000, faktor: 20, bei: 1000, angewendet: true }, { t: 5000, faktor: 0.5, bei: 5000, angewendet: true },
        { t: 3000, faktor: 4, bei: null, angewendet: false }]
    const verlauf = [{ t: 500, rate: 0.0001, markPrice: 400 }, { t: 1000, rate: 0.0001, markPrice: 20 }, { t: 6000, rate: 0.0001, markPrice: 40 }, { t: 700, rate: 0.0002 }]
    const b = bereinigeFunding(verlauf, bericht)
    ok(b[0].markPrice === 400 / 20 / 0.5 && b[1].markPrice === 20 / 0.5 && b[2] === verlauf[2], 'Mark-Preis vor dem Sprung durch jeden späteren Faktor geteilt, danach unverändert')
    ok(b[3] === verlauf[3] && verlauf[0].markPrice === 400, 'ohne Mark-Preis unverändert; die Eingabe bleibt, wie sie war')
    ok(bereinigeFunding(verlauf, []) === verlauf && bereinigeFunding(null, bericht) === null && bereinigeFunding(verlauf, [bericht[2]]) === verlauf, 'kein angewendeter Split: dieselbe Liste')
}

// ── Offene Position über einen Split (Bitget-Regel: Menge × Faktor, Kurse ÷ Faktor) ──
{
    const pos = { qty: 2, initialQty: 3, partialQty: 1, entryPrice: 480, stopLoss: 470, initialStopLoss: 460, takeProfit: 520,
        maePrice: 475, mfePrice: 500, partialPrice: 490, notionalUsdt: 1440, marginUsdt: 288, feeOpen: 0.86, partialGross: 10, partialFee: 0.3, leverage: 5 }
    const vor = positionUeberSplit(pos, 20)
    ok(vor.qty === 40 && vor.initialQty === 60 && vor.partialQty === 20, 'Vorwärts-Split 20:1: Mengen mal 20')
    ok(vor.entryPrice === 24 && vor.stopLoss === 23.5 && vor.initialStopLoss === 23 && vor.takeProfit === 26 && vor.maePrice === 23.75 && vor.mfePrice === 25 && vor.partialPrice === 24.5, 'Einstieg, Stop, Ursprungsstop, Ziel, MAE/MFE, Teilausstieg durch 20')
    ok(!('notionalUsdt' in vor) && !('marginUsdt' in vor) && !('feeOpen' in vor) && !('partialGross' in vor) && !('leverage' in vor), 'Geldbeträge und Hebel bleiben')
    nah(vor.qty * vor.entryPrice, pos.qty * pos.entryPrice, 'der Wert der Position bleibt gleich')
    nah((vor.entryPrice - vor.initialStopLoss) * vor.initialQty, (pos.entryPrice - pos.initialStopLoss) * pos.initialQty, 'das Risiko in USDT (Basis für R) bleibt gleich')
    const rueck = positionUeberSplit(pos, 0.1)
    ok(Math.abs(rueck.qty - 0.2) < 1e-12 && Math.abs(rueck.entryPrice - 4800) < 1e-9 && Math.abs(rueck.stopLoss - 4700) < 1e-9 && Math.abs(rueck.takeProfit - 5200) < 1e-9, 'Zusammenlegung 1:10: Menge durch 10, Kurse mal 10')
    const hin = { ...pos, ...vor }
    const zurueck = { ...hin, ...positionUeberSplit(hin, 1 / 20) }
    ok(['qty', 'entryPrice', 'stopLoss', 'takeProfit', 'mfePrice'].every((k) => Math.abs(zurueck[k] - pos[k]) < 1e-9), 'hin und zurück ergibt die Ausgangswerte')
    const ohneZiel = positionUeberSplit({ qty: 1, entryPrice: 100, stopLoss: 90, takeProfit: 0, partialQty: 0 }, 2)
    ok(!('takeProfit' in ohneZiel) && !('partialQty' in ohneZiel) && !('initialQty' in ohneZiel), '0 = «kein Ziel»/«kein Teilausstieg» und fehlende Felder bleiben unberührt')
    ok(Object.keys(positionUeberSplit(pos, 1)).length === 0 && Object.keys(positionUeberSplit(pos, 0)).length === 0 && Object.keys(positionUeberSplit(pos, NaN)).length === 0, 'Faktor 1 oder unbrauchbar: nichts')
    ok(pos.qty === 2 && pos.entryPrice === 480, 'die Eingabe bleibt unverändert')
}

// ── Welche Splits sind an einer Position noch fällig? ──
{
    const bericht = [{ t: 9 * H, faktor: 20, bei: 10 * H, angewendet: true }, { t: 30 * H, faktor: 2, bei: null, angewendet: false }]
    const f = (lastCandleTime, vermerk = []) => faelligeSplits(bericht, { lastCandleTime, kerzeMs: H, vermerk }).length
    ok(f(9 * H) === 1 && f(5 * H) === 1, 'zuletzt auf einer Kerze vor dem Sprung bewertet: fällig')
    ok(f(10 * H) === 0 && f(12 * H) === 0, 'auf der Sprungkerze oder danach bewertet: schon im neuen Massstab')
    ok(f(10 * H - 1) === 0, 'Einstieg zur Eröffnung der Sprungkerze (Stand = ihr Beginn − 1 ms): neuer Massstab')
    ok(f(9 * H - 1) === 1, 'Einstieg zur Eröffnung der Kerze davor: alter Massstab')
    ok(f(9 * H, [{ t: 9 * H, faktor: 20, bei: 10 * H }]) === 0, 'steht im Vermerk: erledigt — kein zweites Mal')
    ok(f(0) === 0 && faelligeSplits([], { lastCandleTime: 5 * H, kerzeMs: H }).length === 0, 'ohne Stand oder ohne Bericht: nichts')
    ok(leseSplitVermerk('[{"t":5,"faktor":2,"bei":6}]').length === 1 && leseSplitVermerk('').length === 0 && leseSplitVermerk(null).length === 0 && leseSplitVermerk('{kaputt').length === 0 && leseSplitVermerk([{ t: 3 }]).length === 1, 'Vermerk lesen: JSON, leer, kaputt, Liste')
}

console.log(`✓ Split-Wache: ${n} Prüfungen`)
