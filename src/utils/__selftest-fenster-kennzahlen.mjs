/**
 * Selbsttest der Fenster-Kennzahlen (ATR, ADX, MFI) (`util./chart/fensterKennzahlen.js`).
 *
 *   node src/utils/__selftest-fenster-kennzahlen.mjs
 */
import { atrKennzahlen, stufe, FENSTER, adxKennzahlen, adxStufe, mfiKennzahlen, obvKennzahlen, oiKennzahlen, letzteKreuzung, rsiKennzahlen, stochKennzahlen, macdKennzahlen, fundingKennzahlen, fundingStufe, longAnteilKennzahlen, volumenKennzahlen, rangProzent } from './chart/fensterKennzahlen.js'
import { atr, obv } from '../../shared/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const H = 3_600_000
const START = Date.UTC(2026, 9, 1)     // 00:00 UTC — der erste Tag ist vollständig
// 15 Tage 1h-Kerzen: ruhig (Spanne 10), die letzten 24 Kerzen laut (Spanne 40)
const kerzen = []
for (let i = 0; i < 15 * 24; i++) {
    const laut = i >= 14 * 24
    const s = laut ? 40 : 10
    kerzen.push({ t: START + i * H, o: 1000, h: 1000 + s / 2, l: 1000 - s / 2, c: 1000 })
}
const a = atr(kerzen, 14)
const r = atrKennzahlen(kerzen, a, H)
check('ATR in Preis und %', nah(r.atr, a[a.length - 1]) && nah(r.atrPct, (a[a.length - 1] / 1000) * 100))
check('nach dem Lautwerden: Perzentil ganz oben, Stufe „hoch"', r.perzentil === 100 && r.stufe === 'hoch', `${r.perzentil} ${r.stufe}`)
check('Vielfaches des Medians > 3', r.vielfaches > 3, r.vielfaches)
check('Richtung: ATR steigt gegen vor 5 Kerzen', r.richtungPct > 0)
check('Stops 1 / 1,5 / 2 ATR', r.stops.length === 3 && nah(r.stops[1].abstand, 1.5 * r.atr) && nah(r.stops[2].pct, (2 * r.atr / 1000) * 100))
check('laufende Kerze in ATR', nah(r.kerzeAtr, 40 / r.atr))
// Tag: heute (Tag 15) Spanne 40, die 10 Tage davor je 10 → 400 %
check('Tag: heutige Spanne gegen Median der Vortage', r.tag && nah(r.tag.spanne, 40) && nah(r.tag.ueblich, 10) && nah(r.tag.anteilPct, 400) && r.tag.tage === 10, JSON.stringify(r.tag))

// Ein Crash-Tag verschiebt den Median nicht (wohl aber ein Mittel)
const mitCrash = kerzen.map((k, i) => (i >= 5 * 24 && i < 6 * 24 ? { ...k, h: 1500, l: 500 } : k))
const rc = atrKennzahlen(mitCrash, atr(mitCrash, 14), H)
check('Tag: ein Crash-Tag hebt den Massstab nicht (Median)', nah(rc.tag.ueblich, 10), rc.tag.ueblich)

// Zu wenig Tage, Tageskerzen, angeschnittener erster Tag
const kurz = kerzen.slice(-3 * 24)
check('weniger als 5 ganze Tage: keine Tageszeile', atrKennzahlen(kurz, atr(kurz, 14), H).tag === null)
check('auf 1d keine Tageszeile', atrKennzahlen(kerzen, a, 86_400_000).tag === null)
const angeschnitten = kerzen.slice(5)    // erster Tag beginnt 05:00 → zählt nicht
const ra = atrKennzahlen(angeschnitten, atr(angeschnitten, 14), H)
check('angeschnittener erster Tag zählt nicht', ra.tag.tage === 10 && nah(ra.tag.ueblich, 10))

// Ruhiger Markt
const ruhig = kerzen.slice(0, 14 * 24)
const rr = atrKennzahlen(ruhig, atr(ruhig, 14), H)
check('gleichmässig ruhig: Vielfaches ≈ 1', nah(rr.vielfaches, 1, 1e-6), rr.vielfaches)

// Stufen und Grenzfälle
check('Stufen', stufe(5) === 'sehrRuhig' && stufe(30) === 'ruhig' && stufe(50) === 'normal' && stufe(70) === 'erhoeht' && stufe(95) === 'hoch' && stufe(null) === null)
check('zu wenig ATR-Werte: kein Perzentil', atrKennzahlen(kerzen.slice(0, 25), atr(kerzen.slice(0, 25), 14), H).perzentil === null)
check('ohne ATR: null', atrKennzahlen(kerzen.slice(0, 5), atr(kerzen.slice(0, 5), 14), H) === null)
check('Fenster begrenzt', FENSTER === 200)

// ── ADX ──
check('ADX-Stufen', adxStufe(12) === 'keinTrend' && adxStufe(22) === 'entsteht' && adxStufe(30) === 'trend' && adxStufe(45) === 'stark' && adxStufe(60) === 'sehrStark' && adxStufe(null) === null)
const reihe = (werte) => [null, null, ...werte]
const ad = adxKennzahlen({ adx: reihe([20, 18, 16, 14, 12.2]), plus: reihe([20, 21, 22, 23, 24.7]), minus: reihe([25, 24, 23, 22, 19.8]) })
check('ADX: Stufe, Seite, Tendenz', ad.stufe === 'keinTrend' && ad.seite === 'long' && ad.tendenz === 'faellt' && Math.abs(ad.diAbstand - 4.9) < 1e-9, JSON.stringify(ad))
check('ADX: letzte DI-Kreuzung vor 1 Kerze nach Long (−1 → +1 auf der vorletzten)', ad.kreuzung?.nach === 'long' && ad.kreuzung.vorKerzen === 1, JSON.stringify(ad.kreuzung))
const flach = adxKennzahlen({ adx: reihe([30, 30.2, 30.1, 30.3]), plus: reihe([10, 10, 10, 10]), minus: reihe([20, 20, 20, 20]) })
check('ADX: kleine Schwankung = flach, keine Kreuzung', flach.tendenz === 'flach' && flach.kreuzung === null && flach.seite === 'short')
check('ADX: ohne Werte null', adxKennzahlen({ adx: [null], plus: [null], minus: [null] }) === null)

// ── MFI ──
{
    const k = (c) => ({ c })
    // Kurs steigt 20 Kerzen auf ein neues Hoch, MFI fiel von 80 auf 55 → bärische Divergenz
    const preise = Array.from({ length: 25 }, (_, i) => 100 + i)
    const mfiW = Array.from({ length: 25 }, (_, i) => (i < 10 ? 80 : 80 - (i - 9) * 1.6))
    const m = mfiKennzahlen(preise.map(k), mfiW)
    check('MFI: Kurs auf Hoch, MFI deutlich darunter → bärische Divergenz', m.divergenz === 'baerisch', JSON.stringify(m))
    check('MFI: Zone neutral, Zufluss (> 50), fallend', m.zone === 'neutral' && m.fluss === 'zufluss' && m.tendenz === 'faellt')
    const gleich = mfiKennzahlen(preise.map(k), preise.map(() => 60))
    check('MFI läuft mit: keine Divergenz', gleich.divergenz === null)
    const tief = mfiKennzahlen(preise.map((p) => k(300 - p)), Array.from({ length: 25 }, (_, i) => (i < 10 ? 15 : 15 + (i - 9) * 1.5)))
    check('MFI: Kurs auf Tief, MFI deutlich darüber → bullische Divergenz', tief.divergenz === 'bullisch')
    const ueber = mfiKennzahlen(preise.map(k), [...Array(15).fill(50), ...Array(10).fill(85)])
    check('MFI: überkauft seit 10 Kerzen', ueber.zone === 'ueberkauft' && ueber.seitKerzen === 10)
    check('MFI: ohne Wert null', mfiKennzahlen([k(1)], [null]) === null)
}

// ── OBV ──
{
    const mache = (schluesse) => schluesse.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 100 }))
    // Kurs steigt (2 kleine grüne, 1 rote Kerze), aber die roten tragen das Volumen → Verteilung
    const ks = []
    let c = 100
    for (let i = 0; i < 40; i++) { const rot = i % 3 === 2; c += rot ? -1 : 0.6; ks.push({ t: i, o: c, h: c, l: c, c, v: rot ? 500 : 100 }) }
    const o = obvKennzahlen(ks, obv(ks))
    check('OBV: Kurs steigt, Netto-Volumen negativ → Verteilung', o.kursPct > 0 && o.nettoPct < -10 && o.abgleich === 'verteilung', JSON.stringify(o))
    const hoch = mache(Array.from({ length: 40 }, (_, i) => 100 + i))
    const oh = obvKennzahlen(hoch, obv(hoch))
    check('OBV: jede Kerze grün und Kurs steigt → +100 %, bestätigt, über Schnitt', Math.abs(oh.nettoPct - 100) < 1e-9 && oh.abgleich === 'bestaetigt' && oh.lage === 'ueber', JSON.stringify(oh))
    const runter = mache(Array.from({ length: 40 }, (_, i) => 200 - i))
    check('OBV: fallend bestätigt', obvKennzahlen(runter, obv(runter)).abgleich === 'bestaetigt' && obvKennzahlen(runter, obv(runter)).nettoPct < -99)
    check('OBV: zu wenig Kerzen null', obvKennzahlen(hoch.slice(0, 10), obv(hoch.slice(0, 10))) === null)
}

// ── Open Interest ──
{
    const ks = (n, f) => Array.from({ length: n }, (_, i) => ({ c: f(i) }))
    const auf = oiKennzahlen(ks(30, (i) => 100 + i), Array.from({ length: 30 }, (_, i) => 1000 + i * 10))
    check('OI: Kurs ↑ OI ↑ → neue Longs (Fenster)', auf.fenster.lage === 'neueLongs' && auf.fenster.kerzen === 20, JSON.stringify(auf.fenster))
    const deck = oiKennzahlen(ks(30, (i) => 100 + i), Array.from({ length: 30 }, (_, i) => 2000 - i * 10))
    check('OI: Kurs ↑ OI ↓ → Short-Eindeckung', deck.fenster.lage === 'shortEindeckung')
    const sh = oiKennzahlen(ks(30, (i) => 200 - i), Array.from({ length: 30 }, (_, i) => 1000 + i * 10))
    check('OI: Kurs ↓ OI ↑ → neue Shorts', sh.fenster.lage === 'neueShorts')
    const aus = oiKennzahlen(ks(30, (i) => 200 - i), Array.from({ length: 30 }, (_, i) => 2000 - i * 10))
    check('OI: Kurs ↓ OI ↓ → Long-Ausstieg', aus.fenster.lage === 'longAusstieg')
    const flach = oiKennzahlen(ks(30, (i) => 100 + i), Array(30).fill(1000))
    check('OI: OI unverändert → flach', flach.fenster.lage === 'oiFlach')
    const lauf = oiKennzahlen(ks(30, (i) => 100 + i), [...Array.from({ length: 29 }, (_, i) => 1000 + i * 10), null])
    check('OI: laufende Kerze ohne Stand → letzter Stand zählt', lauf.stand === 28 && lauf.oi === 1280)
    check('OI: ohne Daten null', oiKennzahlen(ks(3, () => 1), [null, null, null]) === null)
}

// ── Kreuzung, RSI, Stochastik ──
{
    check('Kreuzung: a geht über b vor 1 Kerze', JSON.stringify(letzteKreuzung([1, 2, 5, 6], [3, 3, 3, 3])) === '{"vorKerzen":1,"nach":"oben"}')
    check('Kreuzung: keine', letzteKreuzung([1, 2], [3, 3]) === null && letzteKreuzung([null, 1], [null, 2]) === null)
    const ks = Array.from({ length: 30 }, (_, i) => ({ c: 100 + i }))
    const r = rsiKennzahlen(ks, Array.from({ length: 30 }, (_, i) => 50 + i), Array(30).fill(60))
    check('RSI: überkauft über 70, über der Mitte, Linie über MA gekreuzt', r.zone === 'ueberkauft' && r.mitte === 'ueber' && r.maKreuzung?.nach === 'oben' && r.seitKerzen === 9, JSON.stringify(r))
    const st = stochKennzahlen(ks, [...Array(28).fill(50), 30, 15], [...Array(28).fill(50), 40, 35])
    check('Stochastik: unter 20, %K unter %D, Kreuzung nach unten', st.zone === 'ueberverkauft' && st.kUeberD === false && st.kreuzung?.nach === 'unten', JSON.stringify(st))
}
// ── MACD ──
{
    const m = macdKennzahlen([1, 2, 3, 4], [2, 2, 2, 2], [-1, 0.5, 1, 2])
    check('MACD: über Null, über Signal, Histogramm wächst, Kreuzung vor 1 Kerze (0 → +1)', m.trend === 'ueberNull' && m.linie === 'ueberSignal' && m.schwung === 'waechst' && m.kreuzung.vorKerzen === 1, JSON.stringify(m))
    const s = macdKennzahlen([-1, -2, -3, -3.5], [-1, -2.5, -3.2, -3.6], [0.2, 0.5, 0.2, 0.1])
    check('MACD: unter Null, Histogramm schrumpft', s.trend === 'unterNull' && s.schwung === 'schrumpft')
}
// ── Funding ──
{
    check('Funding-Stufen', fundingStufe(-0.02) === 'negativ' && fundingStufe(0.01) === 'normal' && fundingStufe(0.03) === 'erhoeht' && fundingStufe(0.1) === 'hoch' && fundingStufe(null) === null)
    const ks = Array.from({ length: 24 * 8 }, (_, i) => ({ t: i * H }))
    const hist = ks.map((_, i) => (i % 8 === 0 ? 0.01 : null))
    const f = fundingKennzahlen(ks, hist)
    check('Funding: 3 Zahlungen in 24 h = 0,03 %, aufs Jahr 10,95 %, Woche 0,21 %', nah(f.tagPct, 0.03) && nah(f.jahrPct, 10.95) && nah(f.wochePct, 0.21) && f.zahlt === 'longs', JSON.stringify(f))
    check('Funding: zu kurze Historie → keine Woche', fundingKennzahlen(ks.slice(-30), hist.slice(-30)).wochePct === null)
}
// ── Long-Anteil, Volumen ──
{
    const w = [...Array.from({ length: 100 }, (_, i) => 50 + (i % 10)), 75]
    const l = longAnteilKennzahlen(w)
    check('Long-Anteil: Extrem → viele Longs (Gedränge), Mehrheit long', l.gedraenge === 'vieleLongs' && l.mehrheit === 'long' && l.perzentil === 100, JSON.stringify(l))
    const ks = [...Array.from({ length: 60 }, () => ({ v: 100 })), { v: 400 }, { v: 50 }]
    const v = volumenKennzahlen(ks, 20)
    check('Volumen: letzte geschlossene 4× Schnitt, laufende 0,5×', nah(v.rvol, 4) && nah(v.laufend, 0.5) && v.perzentil === 100, JSON.stringify(v))
    check('Volumen: zu wenig Kerzen null', volumenKennzahlen(ks.slice(0, 10), 20) === null)
}

check('Rang: gleichförmige Reihe liegt in der Mitte (50 %), nicht bei 0', rangProzent([5, 5, 5, 5, 5], 5) === 50 && rangProzent([1, 2, 3, 4, 5], 5) === 100 && rangProzent([1, 2, 3, 4, 5], 1) === 0)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
