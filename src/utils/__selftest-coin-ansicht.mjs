/**
 * Selbsttest: Rechnungen der Coin-Ansicht (`coinAnsicht.js`).
 *
 * Spannen und Abstände, Marktwerte aus der CoinGecko-Vorlage gegen den
 * Börsenkurs, Verwässerung, Vergleich mit BTC, Aufbereitung von Funding und
 * Open Interest. Rein — kein Netz, keine Uhr (die Zeit wird hereingereicht).
 *
 * Aufruf: node src/utils/__selftest-coin-ansicht.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    buendelFaktor, stueckPreis, basisKurz, preisStellen, lageInSpanne, jahresSpanne, abstandZu,
    preisPasst, marktwerte, verwaesserung, mengenBalken, alterMonate,
    verlaufsLinie, linienAenderung, gegenBtc, fundingKennzahlen, oiKennzahlen, ratenProzentAusJahr,
} from './coinAnsicht.js'
import { stammdatenAus } from '../../server/coin-radar/coin-info.js'

let gut = 0
let schlecht = 0
function pruefe(name, fn) {
    try { fn(); gut++ } catch (e) { schlecht++; console.error(`  ✗ ${name}\n    ${e.message}`) }
}
const nah = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`)

const TAG = 86_400_000
const H = 3_600_000
const JETZT = Date.UTC(2026, 10, 16, 12)

console.log('Coin-Ansicht: Spannen, Marktwerte, Derivate')

// ── Symbol ──────────────────────────────────────────────────────────────
pruefe('Bündelung: 1000er, Million, 1M — und was keine ist', () => {
    assert.equal(buendelFaktor('1000PEPEUSDT'), 1000)
    assert.equal(buendelFaktor('1000000MOGUSDT'), 1_000_000)
    assert.equal(buendelFaktor('1MBABYDOGEUSDT'), 1_000_000)
    assert.equal(buendelFaktor('BTCUSDT'), 1)
    assert.equal(buendelFaktor('1INCHUSDT'), 1)
    assert.equal(buendelFaktor('100XUSDT'), 1)
    assert.equal(buendelFaktor(''), 1)
    nah(stueckPreis(0.012, '1000PEPEUSDT'), 0.000012)
    assert.equal(stueckPreis(0, 'BTCUSDT'), null)
    assert.equal(stueckPreis(null, 'BTCUSDT'), null)
    assert.equal(basisKurz('1000pepeusdt'), '1000PEPE')
    assert.equal(basisKurz('BTCUSDC'), 'BTC')
})

pruefe('Kursstellen: gross knapp, klein mit gültigen Stellen', () => {
    assert.equal(preisStellen(67234.5), 2)
    assert.equal(preisStellen(142.3), 2)
    assert.equal(preisStellen(3.4567), 4)
    assert.equal(preisStellen(0.5), 4)
    assert.equal(preisStellen(0.01234), 5)
    assert.equal(preisStellen(0.0000042), 9)
    assert.equal(preisStellen(1e-15), 10)
    assert.equal(preisStellen(null), 2)
})

// ── Spannen ─────────────────────────────────────────────────────────────
pruefe('Lage in der Spanne, an den Rändern geklemmt, ohne Spanne null', () => {
    assert.equal(lageInSpanne(150, 100, 200), 50)
    assert.equal(lageInSpanne(250, 100, 200), 100)
    assert.equal(lageInSpanne(50, 100, 200), 0)
    assert.equal(lageInSpanne(150, 200, 200), null)
    assert.equal(lageInSpanne(150, null, 200), null)
    assert.equal(lageInSpanne(null, 100, 200), null)
})

pruefe('52-Wochen-Spanne: nur das letzte Jahr, laufender Kurs zählt mit', () => {
    const kerzen = [
        [JETZT - 500 * TAG, 999, 1, 5],          // älter als ein Jahr: zählt nicht
        [JETZT - 300 * TAG, 120, 80, 100],
        [JETZT - 100 * TAG, 150, 90, 140],
        [JETZT - 1 * TAG, 130, 110, 125],
    ]
    const s = jahresSpanne(kerzen, 160, JETZT)
    assert.equal(s.hoch, 160)                     // der Kurs von eben liegt über allen Tageshochs
    assert.equal(s.tief, 80)
    assert.equal(s.voll, true)
    assert.equal(s.tiefAm, JETZT - 300 * TAG)
    assert.equal(s.hochAm, null)                  // das Hoch ist der laufende Kurs, keine Kerze
    const t = jahresSpanne(kerzen, 100, JETZT)
    assert.equal(t.hoch, 150)
    assert.equal(t.hochAm, JETZT - 100 * TAG)
})

pruefe('junger Coin: Spanne seit Listung, als solche ausgewiesen', () => {
    const s = jahresSpanne([[JETZT - 40 * TAG, 2, 1, 1.5], [JETZT - TAG, 3, 1.4, 2]], 2.5, JETZT)
    assert.equal(s.voll, false)
    assert.equal(s.tage, 40)
    assert.equal(jahresSpanne([], 2, JETZT), null)
    assert.equal(jahresSpanne(null, 2, JETZT), null)
})

pruefe('Abstand zu einer Marke (Allzeithoch)', () => {
    assert.equal(abstandZu(50, 100), -50)
    nah(abstandZu(110, 100), 10)
    assert.equal(abstandZu(null, 100), null)
    assert.equal(abstandZu(50, 0), null)
})

// ── Marktwerte gegen die CoinGecko-Vorlage ──────────────────────────────
const roh = JSON.parse(readFileSync(new URL('../../server/fixtures/coingecko-coin-handgeschrieben.json', import.meta.url), 'utf8'))
const stamm = stammdatenAus(roh, { id: 'beispielcoin' }, 'BSP')

pruefe('Marktkap und FDV aus Mengen × Börsenkurs, wenn der Kurs passt', () => {
    // CoinGecko: 0.50 USD (alt), Börse: 0.55 USD (jetzt)
    const w = marktwerte(stamm.markt, 0.55)
    assert.equal(w.passt, true)
    assert.equal(w.frisch, true)
    nah(w.marktkap, 4e9 * 0.55)
    nah(w.fdv, 1e10 * 0.55)
    assert.equal(w.deckeArt, 'hoechst')
    nah(w.umlaufAnteilPct, 40)
    nah(w.umsatzZuMarktkapPct, 7.5)               // 150 Mio / 2 Mrd, beide von CoinGecko
})

pruefe('Kurs passt nicht (anderes Projekt mit gleichem Kürzel) → CoinGecko-Werte, ausgewiesen', () => {
    const w = marktwerte(stamm.markt, 42)
    assert.equal(w.passt, false)
    assert.equal(w.frisch, false)
    assert.equal(w.marktkap, 2e9)
    assert.equal(w.fdv, 5e9)
    assert.equal(preisPasst(0.5, 0.5), true)
    assert.equal(preisPasst(1.4, 0.5), true)
    assert.equal(preisPasst(1.6, 0.5), false)
    assert.equal(preisPasst(0.16, 0.5), false)
    assert.equal(preisPasst(null, 0.5), null)
    assert.equal(preisPasst(0.5, null), null)
})

pruefe('gebündeltes Perpetual: Stückpreis, nicht Kontraktpreis', () => {
    const markt = { ...stamm.markt, preisUsd: 0.00001, umlauf: 4e14, hoechst: 4.2e14, gesamt: 4.2e14, marktkapUsd: 4e9 }
    const w = marktwerte(markt, stueckPreis(0.011, '1000PEPEUSDT'))
    assert.equal(w.passt, true)
    nah(w.marktkap, 4e14 * 0.000011)
    // Ohne die Bündelung herauszurechnen läge der Kurs um Faktor 1000 daneben:
    assert.equal(marktwerte(markt, 0.011).passt, false)
})

pruefe('ohne CoinGecko-Kurs oder ohne Mengen: nichts wird erfunden', () => {
    const w = marktwerte({ umlauf: 100, hoechst: null, gesamt: null, preisUsd: null, marktkapUsd: null }, 2)
    assert.equal(w.passt, null)
    assert.equal(w.marktkap, null)
    assert.equal(w.fdv, null)
    assert.equal(w.umlaufAnteilPct, null)
    assert.equal(w.umsatzZuMarktkapPct, null)
    assert.equal(w.deckeArt, null)
    const leer = marktwerte(null, 2)
    assert.equal(leer.marktkap, null)
    // Höchstmenge fehlt (unbegrenzt) → die Gesamtmenge ist die Decke
    const eth = marktwerte({ preisUsd: 3000, umlauf: 120e6, gesamt: 120e6, hoechst: null }, 3100)
    assert.equal(eth.deckeArt, 'gesamt')
    nah(eth.umlaufAnteilPct, 100)
})

pruefe('Verwässerung in Stufen; FDV unter der Marktkap ist „nichts offen"', () => {
    const v = verwaesserung(2e9, 5e9)
    nah(v.faktor, 2.5)
    nah(v.offenPct, 60)
    assert.equal(v.stufe, 'mittel')
    assert.equal(verwaesserung(100, 101).stufe, 'keine')
    assert.equal(verwaesserung(100, 125).stufe, 'gering')
    assert.equal(verwaesserung(100, 400).stufe, 'hoch')
    const unter = verwaesserung(100, 90)
    assert.equal(unter.faktor, 1)
    assert.equal(unter.offenPct, 0)
    assert.equal(verwaesserung(null, 5), null)
    assert.equal(verwaesserung(5, 0), null)
})

pruefe('Mengenbalken gegen die grösste gemeldete Menge', () => {
    const b = mengenBalken(stamm.markt)
    assert.deepEqual(b.map((z) => z.id), ['umlauf', 'gesamt', 'hoechst'])
    nah(b[0].pct, 40)
    nah(b[2].pct, 100)
    assert.deepEqual(mengenBalken({ umlauf: 5 }).map((z) => [z.id, z.pct]), [['umlauf', 100]])
    assert.deepEqual(mengenBalken(null), [])
})

pruefe('Alter in Monaten', () => {
    assert.equal(alterMonate(stamm.genesis, JETZT), 43)       // 23.03.2023 → 16.11.2026
    assert.equal(alterMonate(null, JETZT), null)
    assert.equal(alterMonate(JETZT + TAG, JETZT), null)
})

// ── Verlauf ─────────────────────────────────────────────────────────────
const tage = (n, fn) => Array.from({ length: n }, (_, i) => { const c = fn(i); return [JETZT - (n - i) * TAG, c * 1.02, c * 0.98, c] })

pruefe('Verlaufslinie: Ausschnitt plus laufender Kurs am Ende', () => {
    const k = tage(400, (i) => 100 + i)
    const l = verlaufsLinie(k, 31, JETZT, 512)
    assert.equal(l.length, 31 + 1)
    assert.deepEqual(l[l.length - 1], [JETZT, 512])
    assert.equal(l[0][1], 100 + 369)
    nah(linienAenderung(l), (512 / 469 - 1) * 100)
    assert.equal(verlaufsLinie(k, 31, JETZT).length, 31)       // ohne Kurs kein erfundener Punkt
    assert.equal(linienAenderung([[1, 5]]), null)
    assert.equal(linienAenderung([]), null)
})

pruefe('gegen BTC: gleicher Start, Unterschied in Prozentpunkten', () => {
    const coin = tage(90, (i) => 10 * (1 + i / 89)).map((k) => [k[0], k[3]])   // +100 %
    const btc = tage(90, (i) => 50000 * (1 + 0.25 * i / 89)).map((k) => [k[0], k[3]])   // +25 %
    const v = gegenBtc(coin, btc)
    nah(v.coinPct, 100)
    nah(v.btcPct, 25)
    nah(v.diffPct, 75)
    assert.equal(v.coin[0][1], 0)
    assert.equal(v.btc[0][1], 0)
})

pruefe('gegen BTC: junger Coin wird nur über die GEMEINSAME Zeit verglichen', () => {
    const coin = tage(30, () => 1).map((k) => [k[0], k[3]])
    const btc = tage(365, (i) => 100 + i).map((k) => [k[0], k[3]])
    const v = gegenBtc(coin, btc)
    assert.equal(v.btc.length, 30)
    nah(v.btcPct, ((100 + 364) / (100 + 335) - 1) * 100)
    assert.equal(v.coinPct, 0)
    assert.equal(gegenBtc(coin, []), null)
    assert.equal(gegenBtc([], btc), null)
    // kein gemeinsamer Starttag (BTC-Reihe mit Loch am Anfang des Coins)
    const loch = btc.filter((p) => p[0] < coin[0][0] || p[0] > coin[10][0])
    assert.equal(gegenBtc(coin, loch), null)
})

// ── Funding ─────────────────────────────────────────────────────────────
const zahlungen = (n, taktH, rate) => Array.from({ length: n }, (_, i) => ({ t: JETZT - (n - i) * taktH * H, rate: typeof rate === 'function' ? rate(i) : rate }))

pruefe('Funding: Takt gemessen, Jahresrate danach (8 h)', () => {
    const f = fundingKennzahlen(zahlungen(540, 8, 0.0001), JETZT)        // 180 Tage
    assert.equal(f.taktH, 8)
    nah(f.letztePct, 0.01)
    nah(f.jahr7dPct, 0.01 * 1095)                                         // 10,95 % p. a.
    nah(f.jahr30dPct, 10.95)
    assert.equal(f.positivAnteilPct, 100)
    assert.equal(f.zahlungen, 90)                                         // 30 Tage × 3
    nah(f.serie[0][1], 10.95)
})

pruefe('Funding: 4-h-Takt verdoppelt die Jahresrate gegenüber der 8-h-Annahme', () => {
    const f = fundingKennzahlen(zahlungen(600, 4, 0.0001), JETZT)
    assert.equal(f.taktH, 4)
    nah(f.jahr7dPct, 21.9)
    assert.equal(f.zahlungen, 180)
})

pruefe('Funding: negativ, gemischt, zu kurze Reihe', () => {
    const f = fundingKennzahlen(zahlungen(90, 8, (i) => (i % 3 === 0 ? 0.0002 : -0.0001)), JETZT)
    nah(f.positivAnteilPct, 100 / 3, 1e-6)
    nah(f.jahr30dPct, 0, 1e-6)
    nah(f.letztePct, -0.01)
    // 3 Tage Verlauf: kein 7-Tage- und kein 30-Tage-Schnitt
    const kurz = fundingKennzahlen(zahlungen(9, 8, 0.0001), JETZT)
    assert.equal(kurz.jahr7dPct, null)
    assert.equal(kurz.jahr30dPct, null)
    nah(kurz.letztePct, 0.01)
    assert.equal(fundingKennzahlen([], JETZT), null)
    assert.equal(fundingKennzahlen([{ t: 1, rate: 0.1 }], JETZT), null)
    assert.equal(fundingKennzahlen(null, JETZT), null)
    // unlesbare Einträge fallen heraus statt als 0 zu zählen
    const mitLoch = fundingKennzahlen([...zahlungen(30, 8, 0.0001), { t: JETZT, rate: null }, { t: 'x', rate: 1 }], JETZT)
    nah(mitLoch.letztePct, 0.01)
})

pruefe('Rate je Zahlung aus der Jahresrate (einheitensicher)', () => {
    nah(ratenProzentAusJahr(10.95, 8), 0.01)
    nah(ratenProzentAusJahr(21.9, 4), 0.01)
    assert.equal(ratenProzentAusJahr(null, 8), null)
    assert.equal(ratenProzentAusJahr(10, null), null)
})

// ── Open Interest und Long/Short ────────────────────────────────────────
pruefe('Open Interest: USD-Wert mit dem Kontraktkurs, Veränderung in Kontrakten', () => {
    const punkte = Array.from({ length: 200 }, (_, i) => ({ t: JETZT - (200 - i) * H, oi: 1000 + i * 10, longPct: 60, shortPct: 40, ratio: 1.5 }))
    const o = oiKennzahlen({ punkte, jetzt: { oiDelta24hPct: 8.9, preisDelta24hPct: 2.1, deutung: 'longAufbau' } }, 2)
    assert.equal(o.oi, 2990)
    assert.equal(o.oiUsd, 5980)
    assert.equal(o.oiDelta24hPct, 8.9)                                    // der Wert der Kachel hat Vorrang
    nah(o.oiDelta7dPct, (2990 / (2990 - 1680) - 1) * 100)
    assert.equal(o.longPct, 60)
    assert.equal(o.longSchnittPct, 60)
    assert.equal(o.deutung, 'longAufbau')
    assert.equal(o.oiSerie.length, 200)
})

pruefe('Open Interest fehlt: Long/Short bleibt, OI ist unbekannt (nicht 0)', () => {
    const punkte = Array.from({ length: 30 }, (_, i) => ({ t: JETZT - (30 - i) * H, oi: null, longPct: 55 + (i % 2), shortPct: 45, ratio: 1.2 }))
    const o = oiKennzahlen({ punkte, jetzt: {} }, 2)
    assert.equal(o.oi, null)
    assert.equal(o.oiUsd, null)
    assert.equal(o.oiDelta24hPct, null)
    assert.equal(o.oiDelta7dPct, null)
    assert.equal(o.deutung, 'neutral')
    nah(o.longSchnittPct, 55.5)
    assert.equal(oiKennzahlen({ punkte: [] }, 2), null)
    assert.equal(oiKennzahlen(null, 2), null)
    // zu kurze Reihe für 7 Tage
    const kurz = Array.from({ length: 30 }, (_, i) => ({ t: JETZT - (30 - i) * H, oi: 100 + i, longPct: 50, shortPct: 50, ratio: 1 }))
    const k = oiKennzahlen({ punkte: kurz, jetzt: {} }, null)
    assert.equal(k.oiDelta7dPct, null)
    nah(k.oiDelta24hPct, (129 / 105 - 1) * 100)
    assert.equal(k.oiUsd, null)
})

console.log(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
if (schlecht) process.exit(1)
process.exit(0)
