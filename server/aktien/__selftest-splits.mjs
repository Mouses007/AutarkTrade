/**
 * Selbsttest: Split-Wache.
 *
 *   node server/aktien/__selftest-splits.mjs
 */
import assert from 'node:assert/strict'
import { ausSplits, bereinigeSplits, bereinigeSeite, verdaechtigeSpruenge, bereinigeFunding, positionUeberSplit, faelligeSplits, leseSplitVermerk, ohneSplitSprung, ohneSplitSpruengeJe, faktorNaheEins, auffaelligeSpruenge } from './splits.js'

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

// ── Audit 15.11.2026, FUN-F-003: kleine Faktoren «fanden» immer einen Sprung ──
{
    // Flache Reihe ohne Sprung (pendelt ±0,5 %), Split-Eintrag mitten im Fenster
    const flach = Array.from({ length: 24 * 8 }, (_, i) => { const c = 100 * (1 + 0.005 * Math.sin(i / 3)); return { t: t0 + i * H, o: c, h: c * 1.002, l: c * 0.998, c, v: 10 } })
    for (const faktor of [1.05, 1.1, 1.2, 1.25, 1.5, 2, 20, 0.9, 0.8, 0.5, 0.1]) {
        const b = bereinigeSplits(flach, [{ t: t0 + 4 * TAG, faktor }])
        ok(b.kerzen === flach && b.splits.length === 1 && b.splits[0].angewendet === false && b.splits[0].bei === null, `flache Reihe, Faktor ${faktor}: nichts umgerechnet`)
        ok(bereinigeSeite(flach, [{ t: t0 + 4 * TAG, faktor }], new Map()).kerzen === flach, `flache Reihe, Faktor ${faktor}: auch seitenweise nichts`)
    }
    ok(bereinigeSplits(flach, [{ t: t0 + 4 * TAG, faktor: 1.05 }]).splits[0].nurGemeldet === true
        && bereinigeSplits(flach, [{ t: t0 + 4 * TAG, faktor: 2 }]).splits[0].nurGemeldet === undefined, 'Faktor nahe 1 ist als «nur gemeldet» gekennzeichnet')
    ok(faktorNaheEins(1.25) && faktorNaheEins(0.8) && faktorNaheEins(1.05) && !faktorNaheEins(1.5) && !faktorNaheEins(2) && !faktorNaheEins(0.5) && !faktorNaheEins(0.1), 'Grenze der Faktoren nahe 1')

    // Faktor nahe 1 wird auch dann nicht angewendet, wenn der Sprung wirklich dasteht — nur gemeldet
    const stufe = (f) => flach.map((k, i) => (i < 96 ? k : { ...k, o: k.o / f, h: k.h / f, l: k.l / f, c: k.c / f }))
    const klein = bereinigeSplits(stufe(1.1), [{ t: t0 + 4 * TAG, faktor: 1.1 }])
    ok(klein.kerzen.every((k, i) => k === stufe(1.1)[i] || k.c === stufe(1.1)[i].c) && klein.splits[0].angewendet === false && klein.splits[0].nurGemeldet, 'Aktiendividende 11:10: gemeldet, nicht umgerechnet')
    // … und altes Wissen des Charts über einen solchen Split wirkt nicht mehr
    ok(bereinigeSeite(flach, [{ t: t0 + 4 * TAG, faktor: 1.1 }], new Map([[t0 + 4 * TAG, t0 + 96 * H]])).angewendet === 0, 'seitenweise: gemerkter Sprung eines kleinen Faktors zählt nicht')

    // Echte Splits werden weiter erkannt: 3:2, 2:1, 20:1, 1:10
    for (const f of [1.5, 2, 20, 0.1, 0.5]) {
        const b = bereinigeSplits(stufe(f), [{ t: t0 + 4 * TAG + 13 * H, faktor: f }])
        ok(b.splits[0].angewendet && b.splits[0].bei === t0 + 96 * H, `echter Split Faktor ${f} erkannt`)
        ok(verdaechtigeSpruenge(b.kerzen, 1.02).length === 0, `Faktor ${f}: Reihe danach ohne Stufe`)
    }
    // Toleranz relativ zum Faktor: ein Kurstag von −22 % ist kein Split 3:2 (früher: innerhalb von 25 %)
    ok(bereinigeSplits(stufe(1.22), [{ t: t0 + 4 * TAG, faktor: 1.5 }]).splits[0].angewendet === false, 'Stufe 1,22 passt nicht zu 3:2')
    ok(bereinigeSplits(stufe(1.45), [{ t: t0 + 4 * TAG, faktor: 1.5 }]).splits[0].angewendet, 'Stufe 1,45 passt zu 3:2 (Kursbewegung am Ex-Tag)')
    // Die feste Obergrenze bleibt: ein Sturz auf ein Sechstel ist kein Split 20:1
    ok(bereinigeSplits(stufe(6), [{ t: t0 + 4 * TAG, faktor: 20 }]).splits[0].angewendet === false, 'Stufe 6 passt nicht zu 20:1')

    // Der Sprung muss über der üblichen Kerzenbewegung liegen: Reihe, die je Kerze um ±12 % schwankt
    const wild = Array.from({ length: 200 }, (_, i) => { const c = (i % 2 ? 112 : 100) / (i >= 101 ? 1.5 : 1); return { t: t0 + i * H, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 } })
    ok(bereinigeSplits(wild, [{ t: t0 + 101 * H, faktor: 1.5 }]).splits[0].angewendet === false, 'Sprung geht in der Kerzenbewegung unter: nicht angewendet')
}

// ── Messungen ohne Position (Radar, Erfolgskontrolle): `ohneSplitSprung` ──
{
    let abrufe = 0
    const hole = (splits) => () => { abrufe++; return splits }
    const ruhig = await ohneSplitSprung(glatt, hole([split]))
    ok(ruhig.kerzen === glatt && !ruhig.offen && ruhig.splits.length === 0 && abrufe === 0, 'ohne Sprung in den Kerzen werden die Splits gar nicht erst geholt')
    const sauber = await ohneSplitSprung(kerzen, hole([split]))
    ok(abrufe === 1 && !sauber.offen && sauber.splits.length === 1 && sauber.splits[0].faktor === 20 && Math.abs(sauber.kerzen[0].c - 24) < 1e-9, 'Split erklärt den Sprung: bereinigt')
    for (const unbekannt of [null, [], undefined]) {
        const u = await ohneSplitSprung(kerzen, hole(unbekannt))
        ok(u.offen && u.kerzen === kerzen && u.splits.length === 0, `Splits ${JSON.stringify(unbekannt)}: Sprung bleibt offen, nichts umgerechnet`)
    }
    const wirft = await ohneSplitSprung(kerzen, async () => { throw new Error('Quelle aus') })
    ok(wirft.offen && wirft.kerzen === kerzen, 'Abruf scheitert: offen statt Absturz')
    ok((await ohneSplitSprung(sturz, hole([split]))).offen === false, 'Sturz um 40 % ohne passenden Split: kein Split-Verdacht (unter 1,8×)')
    ok((await ohneSplitSprung(rev, hole([{ t: t0 + 50 * H, faktor: 0.5 }]))).offen, 'Sprung ×10, Kursquelle nennt nur 1:2: bleibt offen')
    ok((await ohneSplitSprung([], hole([split]))).kerzen.length === 0, 'leere Kerzen')

    // Viele Symbole, mehrere Zeiteinheiten (Aktien-Radar): `merk` sammelt, was umgerechnet wurde und was offen blieb
    const merk = new Map()
    const gefragt = []
    const quelle = async (symbol) => { gefragt.push(symbol); return symbol === 'KORU' ? [split] : symbol === 'SOXS' ? [] : null }
    const eingabe = new Map([['KORU', kerzen], ['SOXS', kerzen], ['NVDA', glatt], ['MSTU', rev]])
    const m1 = await ohneSplitSpruengeJe(eingabe, quelle, merk)
    const m2 = await ohneSplitSpruengeJe(new Map([['KORU', kerzen], ['NVDA', glatt]]), quelle, merk)
    ok(eingabe.get('KORU') === kerzen && m1 !== eingabe && m1.size === 4, 'Eingabe-Map bleibt, wie sie ist')
    ok(Math.abs(m1.get('KORU')[0].c - 24) < 1e-9 && m1.get('NVDA') === glatt && m1.get('SOXS') === kerzen && Math.abs(m2.get('KORU')[0].c - 24) < 1e-9, 'bereinigt, wo ein Split den Sprung erklärt; sonst dieselbe Reihe')
    ok(merk.size === 3 && merk.get('KORU').offen === false && merk.get('KORU').splits.length === 1 && merk.get('KORU').splits[0].text === '20:1', 'gemerkt: KORU umgerechnet — über zwei Zeiteinheiten nur ein Eintrag')
    ok(merk.get('SOXS').offen && merk.get('MSTU').offen && !merk.has('NVDA'), 'gemerkt: SOXS (leere Liste) und MSTU (unbekannt) offen, NVDA ohne Sprung gar nicht')
    ok(!gefragt.includes('NVDA') && gefragt.filter((x) => x === 'KORU').length === 2, 'Splits nur für Titel mit Sprung geholt')
}

// ── Split-Verdacht des Papierbetriebs ab 1,25× (`auffaelligeSpruenge`, RAS-09) ──
{
    // Stundenkerzen einer Aktie mit gewöhnlichem Rauschen (±0,6 % je Kerze, fester Zufall); ab Kerze 150 gilt `mal`.
    let saat = 7
    const zufall = () => { saat = (saat * 1103515245 + 12345) % 2147483648; return saat / 2147483648 }
    const rauschen = Array.from({ length: 300 }, () => 1 + (zufall() - 0.5) * 0.012)
    const reihe = (mal, breite = 1) => {
        let p = 100
        return rauschen.map((r, i) => {
            p *= 1 + (r - 1) * breite
            const c = p * (i >= 150 ? mal : 1)
            return { t: t0 + i * H, o: c, h: c * 1.002, l: c * 0.998, c, v: 1 }
        })
    }
    const bei = (k) => auffaelligeSpruenge(k).map((x) => (x.t - t0) / H)
    // Keine Fehlalarme bei gewöhnlichen Kurslücken
    ok(bei(reihe(1)).length === 0, 'ruhige Reihe: kein Verdacht')
    for (const luecke of [0.85, 1.15, 0.9, 1.1, 0.81, 1.24]) {
        ok(bei(reihe(luecke)).length === 0, `Kurslücke ${luecke > 1 ? '+' : '−'}${Math.round(Math.abs(luecke - 1) * 100)} % (Zahlen): kein Verdacht`)
    }
    // Tageskerzen eines schwankungsreichen Titels (±3 % je Kerze) mit Zahlen-Gap ±15 %: ebenfalls nichts
    ok(bei(reihe(0.85, 5)).length === 0 && bei(reihe(1.15, 5)).length === 0, 'schwankungsreicher Titel (±3 % je Kerze), Lücke ±15 %: kein Verdacht')
    // Splits unter 1,8×, die bisher durchrutschten
    for (const [text, mal] of [['3:2', 1 / 1.5], ['4:3', 3 / 4], ['3:2 mit −15 % am Ex-Tag', 0.85 / 1.5], ['3:2 mit +15 % am Ex-Tag', 1.15 / 1.5], ['Zusammenlegung 2:3', 1.5]]) {
        const treffer = bei(reihe(mal))
        ok(treffer.length === 1 && treffer[0] === 150, `Split ${text}: Verdacht an der Sprungkerze`)
        ok(verdaechtigeSpruenge(reihe(mal)).length === 0, `…den die alte Schwelle 1,8× nicht sah (${text})`)
    }
    // Das Rausch-Kriterium: ein Sprung 1,5×, der in der Kerzenbewegung untergeht, ist kein Verdacht — ab 1,8× wie bisher immer
    const wild = (mal) => Array.from({ length: 200 }, (_, i) => { const c = (i % 2 ? 112 : 100) * (i >= 101 ? mal : 1); return { t: t0 + i * H, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 } })
    ok(auffaelligeSpruenge(wild(1 / 1.5)).length === 0, 'Reihe mit ±12 % je Kerze, Sprung 1,5×: geht im Rauschen unter, kein Verdacht')
    ok(auffaelligeSpruenge(wild(1 / 2.5)).length >= 1 && auffaelligeSpruenge(wild(1 / 2.5)).length === verdaechtigeSpruenge(wild(1 / 2.5)).length, 'ab 1,8× unverändert: jeder solche Sprung, auch in unruhiger Reihe')
    ok(auffaelligeSpruenge(kerzen).length === 1 && auffaelligeSpruenge(kerzen)[0].t === verdaechtigeSpruenge(kerzen)[0].t, 'Sprung 20:1: derselbe Treffer wie bisher')
    // `nach`: nur junge Sprünge
    ok(auffaelligeSpruenge(reihe(1 / 1.5), { nach: t0 + 150 * H }).length === 0 && auffaelligeSpruenge(reihe(1 / 1.5), { nach: t0 + 149 * H }).length === 1, '`nach` begrenzt auf Sprünge nach dem Zeitpunkt')
    // Der Preis der engeren Schwelle, ausdrücklich: ein echter Sturz um 40 % (1,67×) ist für den Papierbetrieb jetzt ein Verdacht
    ok(auffaelligeSpruenge(sturz).length === 1 && verdaechtigeSpruenge(sturz).length === 0, 'echter Sturz um 40 %: Verdacht im Papierbetrieb (Runde ausgesetzt), weiterhin keiner in Backtest und Radar')
    ok(auffaelligeSpruenge([]).length === 0 && auffaelligeSpruenge([{ t: 1, c: 0 }, { t: 2, c: 5 }]).length === 0, 'leer und Kurs 0: nichts')
}

console.log(`✓ Split-Wache: ${n} Prüfungen`)
