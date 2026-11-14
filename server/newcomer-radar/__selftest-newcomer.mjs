/**
 * Selbsttest des Newcomer-Radars: Kennzahlen, Bewertung, Zuordnung zur Kursquelle.
 *
 *   node server/newcomer-radar/__selftest-newcomer.mjs
 *
 * Ohne Netz. Die Aufnahme `server/fixtures/newcomer-kursquelle.json` hält echte
 * Antworten vom 14.11.2026 (Reddit: Börsengang März 2024; `SAN`: an der NYSE
 * Banco Santander, bei Bitpanda Sanofi).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { kennzahlen, rendite } from './kennzahlen.js'
import { bewerte, noteNeuheit, noteMomentum, noteBeteiligung, kategorie, huerden, juengsteListung, fruehesteListung } from './bewertung.js'
import { kursSymbolKandidaten, nameGleich, nameAehnlich, tickerStamm, namensWoerter, ausChart, ausSuche } from './kursquelle-kern.js'

const hier = path.dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(fs.readFileSync(path.join(hier, '../fixtures/newcomer-kursquelle.json'), 'utf8'))

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }
const nah = (a, b, text, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${text}: ${a} statt ${b}`); n++ }
const TAG = 86400e3

/** Künstliche Kerzen: Schlusskurse vorgegeben, Hoch = Schluss, Volumen konstant oder je Tag. */
const reihe = (schluss, vol = 1e6) => schluss.map((c, i) => ({ t: 1.7e12 + i * TAG, o: c, h: c, l: c, c, v: typeof vol === 'function' ? vol(i) : vol }))
const flach = (tage, kurs = 100) => reihe(Array(tage).fill(kurs))

// ── Kennzahlen ──
gleich(kennzahlen([], { ipoDatum: null }), { tage: 0, alterTage: null }, 'ohne Kerzen nur das Alter')
gleich(rendite(flach(10), 21), null, 'Rendite ohne genug Historie ist unbekannt, nicht 0')
nah(rendite(reihe([100, 110]), 1), 10, 'Rendite über einen Tag')

let k = kennzahlen(flach(15))
gleich([k.perf1m, k.perf3m, k.perf6m, k.ueberSma50, k.rvol, k.relStaerke3m], [null, null, null, null, null, null], 'drei Wochen Historie: nichts davon messbar')
gleich(k.abstandHochPct, 0, 'am Hoch der kurzen Historie')
gleich(k.seitStartPct, 0, 'seit Start')

// 300 Tage steigend von 100 auf 399: am Hoch, über dem Schnitt
const steigend = reihe(Array.from({ length: 300 }, (_, i) => 100 + i))
k = kennzahlen(steigend, { referenz: { perf3m: 5 } })
gleich([k.abstandHochPct, k.hochVorTagen, k.ueberSma50], [0, 0, true], 'steigend: am Hoch')
nah(k.perf3m, (399 / 336 - 1) * 100, 'perf3m über 63 Handelstage', 0.01)
nah(k.relStaerke3m, k.perf3m - 5, 'Stärke gegen den Index', 0.011)
gleich(k.seitStartPct, null, 'seit Start nur bei kurzer Historie')
gleich(k.rvol, 1, 'gleiches Volumen = 1')

// Hoch vor 100 Tagen, seither −40 %
const gefallen = reihe([...Array.from({ length: 200 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 100 }, (_, i) => 199.5 * (1 - 0.4 * (i + 1) / 100))])
k = kennzahlen(gefallen)
nah(k.abstandHochPct, -40, 'Abstand zum Hoch', 0.01)
gleich([k.hochVorTagen, k.ueberSma50], [100, false], 'Hoch vor 100 Tagen, unter dem Schnitt')

// Das 52-Wochen-Fenster vergisst ein Hoch von vor zwei Jahren
k = kennzahlen(reihe([500, ...Array(300).fill(100)]))
gleich(k.hoch52w, 100, 'altes Hoch liegt ausserhalb des Fensters')

// Relatives Volumen: 5 Tage mit dreifachem Volumen gegen die 50 davor — der Ausreisser dämpft sich nicht selbst
k = kennzahlen(reihe(Array(80).fill(100), (i) => (i >= 75 ? 3e6 : 1e6)))
gleich(k.rvol, 3, 'RVOL 3')
gleich(k.umsatz20, Math.round((15 * 1e8 + 5 * 3e8) / 20), 'Umsatz = Kurs × Volumen, 20-Tage-Schnitt')
gleich(kennzahlen(flach(20)).rvol, null, 'RVOL ohne 20 Tage Basis unbekannt')

gleich(kennzahlen(flach(5), { jetzt: 100 * TAG, ipoDatum: 10 * TAG }).alterTage, 90, 'Alter seit Börsengang')

// ── Teil-Noten ──
gleich([noteNeuheit(30), noteNeuheit(90), noteNeuheit(730), noteNeuheit(5 * 365), noteNeuheit(9000)], [100, 100, 40, 0, 0], 'Neuheit: Stützpunkte')
ok(noteNeuheit(400) < 100 && noteNeuheit(400) > 40, 'Neuheit dazwischen')
gleich(noteNeuheit(null, null), null, 'Neuheit unbekannt')
gleich(noteNeuheit(9000, 10), 70, 'alte Firma, frisch gelistet')
gleich(noteNeuheit(30, 10), 100, 'Börsengang schlägt Listung')
gleich(noteNeuheit(null, 400, 'vorboerslich'), 100, 'vorbörslich')
gleich(noteMomentum({}), null, 'Momentum ohne Messung unbekannt')
gleich(noteMomentum({ abstandHochPct: 0, perf3m: 40, relStaerke3m: 25, ueberSma50: true }), 100, 'Momentum voll')
gleich(noteMomentum({ abstandHochPct: -30, perf3m: -20, relStaerke3m: -15, ueberSma50: false }), 0, 'Momentum null')
gleich(noteMomentum({ abstandHochPct: -15 }), 50, 'Momentum aus einer Messung')
gleich([noteBeteiligung(null), noteBeteiligung(0.5), noteBeteiligung(1), noteBeteiligung(2), noteBeteiligung(3), noteBeteiligung(9)], [null, 0, 40, 80, 100, 100], 'Beteiligung: Stützpunkte')

// ── Kategorie und Hürden ──
gleich(kategorie({ alterTage: 200 }, null), 'boersengang', 'junger Börsengang')
gleich(kategorie({ alterTage: 5000 }, 10), 'neuGelistet', 'alt, aber frisch gelistet')
gleich(kategorie({ alterTage: 5000 }, 200), 'etabliert', 'etabliert')
gleich(kategorie({ alterTage: null }, null), 'unbekannt', 'ohne Alter unbekannt')
gleich(kategorie({ alterTage: 5000 }, 200, 'vorboerslich'), 'vorboerslich', 'vorbörslich geht vor')
gleich(huerden({ kurs: 0.4, umsatz20: 5e6 }), ['kursUnter1'], 'Pennystock')
gleich(huerden({ kurs: 20, umsatz20: 2e5 }), ['umsatzZuKlein'], 'zu wenig Umsatz')
gleich(huerden({ kurs: 20, umsatz20: null }), ['umsatzUnbekannt'], 'unbekannter Umsatz ist eine Hürde')
gleich(huerden({ kurs: 20, umsatz20: 5e6 }), [], 'keine Hürde')
gleich([fruehesteListung([{ gelistetSeit: 5 }, { gelistetSeit: null }, { gelistetSeit: 3 }]), juengsteListung([{ gelistetSeit: 5 }, { gelistetSeit: 3 }]), juengsteListung([{}])], [3, 5, null], 'Listungsdaten')

// ── Gesamt ──
let b = bewerte(kennzahlen(flach(15), { jetzt: 1.7e12 + 40 * TAG, ipoDatum: 1.7e12 }), { jetzt: 1.7e12 + 40 * TAG })
gleich(b.kategorie, 'boersengang', 'drei Wochen alt: Börsengang')
gleich([b.noten.neuheit, b.noten.momentum, b.noten.beteiligung], [100, 100, null], 'Momentum nur aus der Nähe zum Hoch')
ok(b.belastbar && b.note === 100, 'zwei Teil-Noten reichen')
b = bewerte({ tage: 0, alterTage: 30 })
gleich([b.note, b.belastbar, b.zugelassen, b.noten.neuheit], [null, false, false, 100], 'Neuheit allein ergibt keine Note')
b = bewerte(kennzahlen(steigend, { ipoDatum: null }))
gleich(b.kategorie, 'unbekannt', 'ohne Börsengangs-Datum')
ok(b.belastbar && b.noten.neuheit === null, 'fehlende Neuheit fällt aus dem Nenner')
nah(b.note, (b.noten.momentum * 45 + b.noten.beteiligung * 20) / 65, 'gewichtet nur über Gemessenes (Teil-Noten sind gerundet)', 0.5)
b = bewerte(kennzahlen(reihe(Array(300).fill(0.5))), {})
gleich([b.huerden.includes('kursUnter1'), b.zugelassen], [true, false], 'gerissene Hürde: nicht in der Rangliste')
b = bewerte(kennzahlen(steigend, { jetzt: 2e12, ipoDatum: 1e12 }), { jetzt: 2e12, listungen: [{ gelistetSeit: 2e12 - 5 * TAG }, { gelistetSeit: 1.9e12 }] })
gleich([b.kategorie, b.listungVorTagen, b.noten.neuheit], ['neuGelistet', 5, 70], 'die JÜNGSTE Listung zählt')

// ── Zuordnung zur Kursquelle ──
gleich(kursSymbolKandidaten('NVDA'), ['NVDA'], 'US-Ticker')
gleich(kursSymbolKandidaten('BRKB'), ['BRK-B'], 'Aktiengattung')
gleich(kursSymbolKandidaten('PEG-US'), ['PEG'], 'Bitpanda -US')
gleich(kursSymbolKandidaten('ENT-LN'), ['ENT.L'], 'Bitpanda -LN → London')
gleich(kursSymbolKandidaten('ABC-ZZ'), [], 'unbekannte Nachsilbe: nicht raten')
gleich(kursSymbolKandidaten('3382'), [], 'reine Zahl: nicht ableitbar')
gleich(kursSymbolKandidaten(''), [], 'leer')
gleich(kursSymbolKandidaten('HK0700'), ['HK0700'], 'Börsen-Schreibweise bleibt (scheitert dann am Abruf, nicht hier)')

gleich(namensWoerter('The Goldman Sachs Group, Inc.'), ['goldman', 'sachs'], 'Rechtsform und Füllwörter weg')
gleich(namensWoerter('Wärtsilä Oyj Abp'), ['wartsila', 'abp'], 'Akzente weg')
ok(nameGleich('Goldman Sachs', 'The Goldman Sachs Group, Inc.'), 'Kurzname im Langnamen')
ok(nameGleich('Illumina Inc', 'Illumina, Inc.'), 'gleiche Firma, andere Zeichensetzung')
ok(nameGleich('Reddit', 'Reddit, Inc.'), 'Reddit')
ok(!nameGleich('Sanofi', 'Banco Santander, S.A.'), 'SAN: Sanofi ist nicht Santander')
ok(!nameGleich('AAR', 'Airbus SE'), 'AIR: AAR ist nicht Airbus')
ok(!nameGleich('', 'Reddit'), 'leerer Name passt nie')
ok(!nameGleich('SE', 'Sea Limited'), 'zwei Buchstaben tragen nicht')

// ── Antworten lesen ──
const nachSchluss = 1794603742 * 1000 + 3600e3
const rddt = ausChart(fx.chartRddt, nachSchluss)
gleich([rddt.meta.symbol, rddt.meta.name, rddt.meta.boerse, rddt.meta.waehrung, rddt.meta.typ], ['RDDT', 'Reddit, Inc.', 'NYSE', 'USD', 'EQUITY'], 'Stammdaten')
gleich(new Date(rddt.meta.ipoDatum).toISOString().slice(0, 10), '2024-03-21', 'Börsengang Reddit')
ok(rddt.kerzen.length > 400 && rddt.kerzen.every((x, i, a) => x.c > 0 && (!i || x.t > a[i - 1].t)), 'Kerzen aufsteigend, mit Schlusskurs')
// Dieselbe Antwort, aber «jetzt» mitten in der Sitzung: der angefangene Tag fällt weg
const sitzung = fx.chartRddt.chart.result[0].meta.currentTradingPeriod.regular
const mitten = ausChart(fx.chartRddt, (sitzung.start + 3600) * 1000)
ok(mitten.kerzen.length === rddt.kerzen.length - 1 || rddt.kerzen[rddt.kerzen.length - 1].t < sitzung.start * 1000, 'laufender Tag zählt nicht')
ok(nameGleich('Reddit', rddt.meta.name) && !nameGleich('Sanofi', ausChart(fx.chartSan, nachSchluss).meta.name), 'Namensprüfung an echten Antworten')
{
    // Exxon: erster Handel 1962, also vor 1970 und damit negativ — «etabliert», nicht «ohne Börsendatum».
    const alt = structuredClone(fx.chartRddt)
    alt.chart.result[0].meta.firstTradeDate = -252322200
    const m = ausChart(alt, nachSchluss).meta
    gleich(new Date(m.ipoDatum).getUTCFullYear(), 1962, 'Datum vor 1970 bleibt ein Datum')
    delete alt.chart.result[0].meta.firstTradeDate
    gleich(ausChart(alt, nachSchluss).meta.ipoDatum, null, 'fehlendes Datum ist unbekannt')
}
assert.throws(() => ausChart(fx.fehler), /No data found/); n++
assert.throws(() => ausChart({}), /leere Antwort/); n++
gleich(ausSuche(fx.sucheSanofi, 'Sanofi', 'SAN'), { symbol: 'SAN.PA', heimat: true }, 'Suche: Listung mit dem Bitpanda-Ticker ist die Heimatbörse')
gleich(ausSuche(fx.sucheSanofi, 'Sanofi', 'XYZ'), { symbol: 'SNY', heimat: false }, 'Suche ohne Ticker-Treffer: US-Listung, als Zweitlistung markiert')
gleich(ausSuche({ quotes: [{ symbol: 'SNW.F', quoteType: 'EQUITY', longname: 'Sanofi' }] }, 'Sanofi', 'SAN'), { symbol: 'SNW.F', heimat: false }, 'Suche: nur eine Zweitlistung')
gleich(ausSuche({ quotes: [{ symbol: '0101.HK', quoteType: 'EQUITY', longname: 'Hang Lung Properties Limited' }] }, 'Hang Lung Properties', '101'), { symbol: '0101.HK', heimat: true }, 'Zahlen-Ticker ohne führende Nullen')
gleich(ausSuche(fx.sucheSanofi, 'Nestle', 'NESN'), null, 'Suche ohne passenden Namen')
gleich(ausSuche({}, 'Sanofi', 'SAN'), null, 'leere Suche')
gleich([tickerStamm('SAN.PA'), tickerStamm('0101.HK'), tickerStamm('PEG-US'), tickerStamm('brk-b')], ['SAN', '101', 'PEG', 'BRK-B'], 'Ticker-Stamm')

// Lockere Namensprüfung, wenn der Ticker schon passt — Paare aus dem Probelauf vom 14.11.2026
for (const [stamm, quelle, ticker] of [
    ['TSMC', 'Taiwan Semiconductor Manufacturing Company Limited', 'TSM'],
    ['AMD', 'Advanced Micro Devices, Inc.', 'AMD'],
    ['IBM', 'International Business Machines Corporation', 'IBM'],
    ['Pinduoduo', 'PDD Holdings Inc.', 'PDD'],
    ['British Petroleum', 'BP p.l.c.', 'BP'],
    ['HP', 'HP Inc.', 'HPQ'],
    ['ExxonMobil', 'Exxon Mobil Corporation', 'XOM'],
    ['Zoom Video Communications', 'Zoom Communications, Inc.', 'ZM'],
    ['Circle Internet Group, Inc.', 'Circle Internet Group, Inc.', 'CRCL'],
]) ok(nameAehnlich(stamm, quelle, ticker), `ähnlich: ${stamm} / ${quelle}`)
for (const [stamm, quelle, ticker] of [
    ['Sanofi', 'Banco Santander, S.A.', 'SAN'],
    ['AAR', 'Airbus SE', 'AIR-US'],
    ['National Grid', 'NovaGold Resources Inc.', 'NG'],
    ['Sealed Air', 'Sea Limited', 'SEE'],
    ['First Solar', 'First Horizon Corporation', 'FSLR'],
    ['Bank of Ireland', 'Bank of America Corporation', 'BAC'],
    ['Carlsberg', 'Carlsmed, Inc.', 'CARL'],
    ['Commerzbank', 'Commercial Bancgroup, Inc.', 'CBK'],
    ['', 'Reddit, Inc.', 'RDDT'],
]) ok(!nameAehnlich(stamm, quelle, ticker), `nicht ähnlich: ${stamm} / ${quelle}`)

// ── Echte Daten durch die ganze Kette ──
k = kennzahlen(rddt.kerzen, { jetzt: nachSchluss, ipoDatum: rddt.meta.ipoDatum, referenz: { perf3m: 3 } })
ok(k.alterTage > 900 && k.alterTage < 1000, 'Reddit: gut 2,6 Jahre an der Börse')
ok(k.abstandHochPct < -50 && k.hoch52w > 250, 'Reddit: weit unter dem 52-Wochen-Hoch')
b = bewerte(k, { jetzt: nachSchluss })
gleich([b.kategorie, b.zugelassen], ['etabliert', true], 'Reddit ist kein «junger Börsengang» mehr, aber liquide')
ok(b.note != null && b.noten.momentum < 40, 'Reddit: schwaches Momentum')

console.log(`✓ Newcomer-Radar: ${n} Prüfungen`)
