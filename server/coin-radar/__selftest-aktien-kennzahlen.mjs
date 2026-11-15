/**
 * Selbsttest: Kennzahlen und Note des Aktien-Radars.
 *
 *   node server/coin-radar/__selftest-aktien-kennzahlen.mjs
 */
import assert from 'node:assert/strict'
import { rvolTageszeit, staerkeGegenIndex, raengeImFeld, staerkeImFeld, bewerteAktie, GEWICHTE_AKTIEN, DECKEL_DUENN } from './aktien-kennzahlen.js'
import { bewerte, STANDARD_GEWICHTE } from './bewertung.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const nah = (a, b, text) => { assert.ok(Math.abs(a - b) < 1e-9, `${text}: ${a} ≠ ${b}`); n++ }
const H = 3_600_000

// ── Volumen gegen dieselbe Tageszeit ──
// 10 Tage Stundenkerzen ab Mo 2.11.2026 00:00 UTC. U-Form: in der regulären Sitzung 1000, sonst 100, Wochenende 20.
const T0 = Date.UTC(2026, 10, 2)
const { sitzungVon } = await import('../../shared/aktien-sitzung.js')
const volumen = (t) => ({ regulaer: 1000, wochenende: 20, feiertag: 20 }[sitzungVon(t)] ?? 100)
const reihe = (bis, letztes) => {
    const k = []
    for (let t = T0; t <= bis; t += H) k.push({ t, v: volumen(t) })
    if (letztes != null) k[k.length - 1].v = letztes
    return k
}
const di10 = Date.UTC(2026, 10, 10, 15)     // Dienstag 10:00 New York, reguläre Sitzung
const normal = rvolTageszeit(reihe(di10))
ok(normal.basis === 'stunde' && normal.sitzung === 'regulaer' && normal.proben >= 4, 'Vergleich mit derselben Stunde früherer Handelstage')
nah(normal.rvol, 1, 'übliches Volumen zur Börsenzeit ist 1,0 — kein Ausbruch')
nah(rvolTageszeit(reihe(di10, 3000)).rvol, 3, 'dreifaches Volumen zur selben Stunde')
// Gegenprobe: gegen die letzten 20 Kerzen (Nacht und Vorbörse) sähe dieselbe Kerze wie ein Ausbruch aus
const letzte20 = reihe(di10).slice(-21, -1).reduce((s, k) => s + k.v, 0) / 20
ok(1000 / letzte20 > 3, `der alte Vergleich meldete hier ${(1000 / letzte20).toFixed(1)}× — das ist die U-Form, kein Signal`)

const nacht = rvolTageszeit(reihe(Date.UTC(2026, 10, 11, 6)))        // Mittwoch 01:00 New York
ok(nacht.sitzung === 'nacht' && Math.abs(nacht.rvol - 1) < 1e-9, 'Nacht wird mit Nacht verglichen')
const samstag = rvolTageszeit(reihe(Date.UTC(2026, 10, 14, 15), 5000))     // Samstag, 250-faches Volumen
ok(samstag.sitzung === 'wochenende' && samstag.rvol === null && samstag.basis === 'geschlossen', 'Wochenende: kein Volumenvergleich, auch nicht bei einem Ausreisser')
const freitagNacht = rvolTageszeit(reihe(Date.UTC(2026, 10, 12, 3)))       // Mittwoch 22:00 New York
ok(freitagNacht.sitzung === 'nacht' && freitagNacht.rvol != null, 'Nacht vor einem Handelstag wird verglichen')
ok(rvolTageszeit(reihe(T0 + 5 * H)) === null && rvolTageszeit([]) === null, 'zu wenig Vergleich → null')
ok(rvolTageszeit([{ t: T0, v: 0 }, { t: T0 + H, v: 5 }]) === null, 'ohne Basis kein Wert')

// ── Stärke gegen den Index ──
const s = staerkeGegenIndex({ perf3m: 30, perf6m: 50, perf12m: 100 }, { perf3m: 5, perf6m: 10, perf12m: 20 })
ok(s.rs3m === 25 && s.rs6m === 40 && s.rs12m === 80, 'Mehrrendite je Zeitraum in Prozentpunkten')
const jung = staerkeGegenIndex({ perf3m: 30, perf6m: null }, { perf3m: 5, perf6m: 10, perf12m: 20 })
ok(jung.rs3m === 25 && jung.rs6m === null && jung.rs12m === null, 'junge Firma: nur 3 Monate')
ok(staerkeGegenIndex({}, { perf3m: 5 }).rs3m === null && staerkeGegenIndex({ perf3m: 5 }, {}).rs3m === null, 'ohne Titel- oder Indexdaten: unbekannt')
ok(staerkeGegenIndex({ perf3m: -10 }, { perf3m: 5 }).rs3m === -15, 'schwächer als der Index ist negativ')

// ── Rang im Feld ──
const r = raengeImFeld([10, null, -5, 30, 10])
ok(r[1] === null && r[2] === 0 && r[3] === 100, 'schwächster 0, stärkster 100, unbekannt null')
nah(r[0], 50, 'Gleichstand teilt den mittleren Rang')
ok(r[0] === r[4], 'gleiche Werte, gleicher Rang')
ok(raengeImFeld([5]).every((x) => x === null) && raengeImFeld([null, 3])[1] === null, 'ein einziger Titel hat keinen Rang')

// ── Stärke im Feld: Rang je Zeitraum, dann gemittelt ──
const feld = staerkeImFeld([
    { rs3m: 20, rs6m: 30, rs12m: 40 },      // überall vorn
    { rs3m: -49, rs6m: -34, rs12m: 300 },   // ein extremer Zeitraum, sonst schwach (MUU)
    { rs3m: 0, rs6m: 0, rs12m: 0 },         // wie der Index
    { rs3m: 10, rs6m: null, rs12m: null },  // junge Firma
    { rs3m: null, rs6m: null, rs12m: null },
])
ok(feld[0] > 2 * feld[1], `stetig stark schlägt «einmal extrem» klar: ${feld[0].toFixed(0)} gegen ${feld[1].toFixed(0)}`)
// Gegenprobe: mit gewichteten Prozentpunkten läge der Ausreisser vorn
ok(-49 * 0.4 - 34 * 0.3 + 300 * 0.3 > 20 * 0.4 + 30 * 0.3 + 40 * 0.3, 'gewichtete Rohwerte hätten ihn auf Platz 1 gesetzt')
nah(feld[1], (0 * 0.4 + 0 * 0.3 + 100 * 0.3), 'der Ausreisser zählt nur mit seinem Anteil')
nah(feld[3], (2 / 3) * 100, 'junge Firma: Rang aus dem einen Zeitraum, den es gibt')
ok(feld[4] === null && staerkeImFeld([]).length === 0, 'ohne Daten kein Rang')

// ── Note ──
const voll = bewerteAktie({ kerzen: { atrPct: 3, adx: 40 }, rvol: 4, staerkeRang: 100, abstandHochPct: 0 })
ok(voll.note === 100 && voll.gewichtBekannt === 100 && voll.hinweise.length === 0, 'alles am Anschlag: 100')
const mitte = bewerteAktie({ kerzen: { atrPct: 1.5, adx: 30 }, rvol: 2.5, staerkeRang: 50, abstandHochPct: -15 })
ok(mitte.note === 50 && mitte.teilnoten.hochNaehe === 50, 'Mitte: 50')
ok(bewerteAktie({ kerzen: { atrPct: 3, adx: 40 }, rvol: 4, staerkeRang: 0, abstandHochPct: -40 }).note === 45, 'schwach und fern vom Hoch: lebhafte Kerzen retten die Note nicht')

// Unbekanntes fällt aus dem Nenner — es zählt weder als gut noch als schlecht
const ohneVol = bewerteAktie({ kerzen: { atrPct: 1.5, adx: 30 }, rvol: null, staerkeRang: 50, abstandHochPct: -15 })
ok(ohneVol.note === 50 && ohneVol.gewichtBekannt === 80 && !ohneVol.duenn, 'Wochenende ohne Volumenvergleich: Note aus dem Rest, 80 % gemessen')
const ohne = bewerteAktie({ kerzen: { atrPct: 1.5, adx: 30 }, rvol: 2.5, staerkeRang: null, abstandHochPct: null })
ok(ohne.note === DECKEL_DUENN && ohne.teilnoten.staerke === null && ohne.gewichtBekannt === 45 && ohne.duenn, 'ohne Tagesdaten: 45 % des Gewichts gemessen — dünn, 50 wird auf 49 gedeckelt')
ok(ohne.hinweise.includes('Stärke unbekannt') && ohne.hinweise.includes('52-Wochen-Hoch unbekannt'), 'und das steht dabei')
const dick = bewerteAktie({ kerzen: { atrPct: 3, adx: 40 }, rvol: 4, staerkeRang: null, abstandHochPct: null })
ok(dick.note === DECKEL_DUENN && dick.hinweise.includes('Note gedeckelt: zu wenig gemessen'), 'dünn und trotzdem 100: gedeckelt — über wen man wenig weiss, der steht nicht oben')
ok(bewerteAktie({}).note === null && bewerteAktie({}).gewichtBekannt === 0, 'nichts gemessen: keine Note')
ok(bewerteAktie({ rvol: 0.2, kerzen: {} }).teilnoten.imSpiel === 0, 'Volumen unter üblich: 0 Punkte, nicht unbekannt')

// Funding spielt keine Rolle mehr; die Coin-Note bleibt, wie sie war
ok(!('kosten' in GEWICHTE_AKTIEN) && Object.values(GEWICHTE_AKTIEN).reduce((a, b) => a + b, 0) === 100, 'Aktien-Gewichte: Summe 100, ohne Funding')
ok(STANDARD_GEWICHTE.kosten === 15 && bewerte({ fundingJahresRate: 0 }, { '1h': { atrPct: 3, rvol: 4, adx: 40 } }).note === 100, 'Coin-Bewertung unverändert')

console.log(`✓ Aktien-Radar Kennzahlen: ${n} Prüfungen`)
