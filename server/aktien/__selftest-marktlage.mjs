/**
 * Selbsttest: Marktlage für Aktien.
 *
 *   node server/aktien/__selftest-marktlage.mjs
 */
import assert from 'node:assert/strict'
import { indexLage, schwankung, sektorStaerke, standUndAenderung, breite, urteile, schlussTag, kursStand, sitzungsStand } from './marktlage-kern.js'
import { ausChart } from '../newcomer-radar/kursquelle-kern.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const nah = (a, b, text) => { assert.ok(Math.abs(a - b) < 1e-9, `${text}: ${a} ≠ ${b}`); n++ }
const TAG = 86_400_000
/** Tageskerzen mit einer Schlusskurs-Funktion. */
const reihe = (anzahl, f) => Array.from({ length: anzahl }, (_, i) => { const c = f(i); return { t: i * TAG, c, h: c * 1.01 } })

// ── Index ──
const auf = indexLage(reihe(300, (i) => 100 + i))
ok(auf.kurs === 399 && auf.ueber200 === true && auf.ueber50 === true && auf.linie200 === 'steigt', 'stetiger Anstieg: über beiden Linien, Linie steigt')
nah(auf.sma200, 100 + (100 + 299) / 2, '200-Tage-Linie ist der Schnitt der letzten 200 Schlusskurse')
nah(auf.abstand200Pct, (399 / 299.5 - 1) * 100, 'Abstand zur Linie')
nah(auf.perf1m, (399 / 378 - 1) * 100, 'Rendite über 21 Handelstage')
const ab = indexLage(reihe(300, (i) => 500 - i))
ok(ab.ueber200 === false && ab.linie200 === 'faellt' && ab.abstandHochPct < -40, 'stetiger Rückgang: darunter, Linie fällt, weit vom Hoch')
const kurz = indexLage(reihe(120, (i) => 100 + i))
ok(kurz.sma200 === null && kurz.ueber200 === null && kurz.linie200 === null && kurz.ueber50 === true, 'zu kurze Historie: 200-Tage-Linie unbekannt, nicht «darunter»')
ok(indexLage([]) === null && indexLage(reihe(1, () => 5)) === null, 'ohne Kerzen nichts')
// Erholung: Kurs wieder über der Linie, die Linie selbst fällt noch
const erholung = indexLage(reihe(300, (i) => (i < 270 ? 300 - i * 0.5 : 165 + (i - 270) * 4)))
ok(erholung.ueber200 === true && erholung.linie200 === 'faellt', 'Kurs über der Linie, Linie fällt noch — beides wird getrennt gemeldet')

// ── Schwankung ──
const vix = reihe(260, (i) => 12 + (i % 20))            // 12 … 31
const ruhe = schwankung([...vix, { t: 0, c: 13 }], reihe(5, () => 16))
ok(ruhe.zone === 'ruhig' && ruhe.struktur === 'normal' && ruhe.verhaeltnis < 1 && ruhe.rangPct < 10, 'niedriger VIX unter dem Dreimonatswert')
const stress = schwankung([...vix, { t: 0, c: 34 }], reihe(5, () => 28))
ok(stress.zone === 'angespannt' && stress.struktur === 'umgekehrt' && stress.rangPct === 100, 'hoher VIX über dem Dreimonatswert, höchster Stand des Jahres')
const ohne3m = schwankung([...vix, { t: 0, c: 20 }], [])
ok(ohne3m.zone === 'mittel' && ohne3m.struktur === null && ohne3m.vix3m === null, 'ohne Dreimonats-VIX bleibt die Struktur unbekannt')
ok(schwankung([]) === null && schwankung(reihe(5, () => 20)).rangPct === null, 'zu wenig Historie: kein Rang')

// ── Sektoren ──
const index = reihe(100, (i) => 100 + i * 0.1)
const sek = sektorStaerke([
    { id: 'XLK', kerzen: reihe(100, (i) => 100 + i * 0.5) },
    { id: 'XLU', kerzen: reihe(100, (i) => 100 - i * 0.2) },
    { id: 'XLE', kerzen: reihe(100, (i) => 100 + i * 0.1) },
    { id: 'XLB', kerzen: [] },
], index)
ok(sek.map((s) => s.id).join() === 'XLK,XLE,XLU', 'stärkster zuerst, Sektor ohne Daten fehlt')
ok(sek[0].rs3m > 0 && sek[2].rs3m < 0 && Math.abs(sek[1].rs3m) < 1e-9, 'Mehrrendite gegen den Index')
ok(sek[0].ueber50 === true && sek[2].ueber50 === false, 'über oder unter der eigenen 50-Tage-Linie')
ok(sektorStaerke([{ id: 'XLK', kerzen: reihe(100, (i) => 100 + i) }], []).length === 0, 'ohne Index keine Stärke')

// ── Zinsen und Dollar ──
const zins = standUndAenderung(reihe(40, (i) => 4 + i * 0.01), 'punkte')
nah(zins.stand, 4.39, 'Stand'); nah(zins.aenderung1m, 0.21, 'Rendite: Änderung in Prozentpunkten')
nah(standUndAenderung(reihe(40, (i) => 100 + i), 'prozent').aenderung1m, (139 / 118 - 1) * 100, 'Dollar: relative Änderung')
ok(standUndAenderung(reihe(5, () => 7)).aenderung1m === null && standUndAenderung([]) === null, 'zu kurz oder leer')

// ── Breite ──
const b = breite([...Array(30).fill(true), ...Array(10).fill(false), null, null])
ok(b.anteilPct === 75 && b.ueber === 30 && b.gezaehlt === 40, 'Anteil über der 50-Tage-Linie; unbekannte zählen nicht')
ok(breite(Array(19).fill(true)) === null && breite([]) === null, 'unter 20 Titeln keine Aussage')

// ── Urteil ──
const vRuhig = { zone: 'ruhig', struktur: 'normal' }, vStress = { zone: 'angespannt', struktur: 'umgekehrt' }
const u1 = urteile({ spy: auf, qqq: auf, iwm: auf, vola: vRuhig, breiteFeld: b })
ok(u1.urteil === 'rueckenwind' && u1.gruende.every((g) => g.ton !== 'schlecht'), 'alles über steigenden Linien, VIX ruhig: Rückenwind')
ok(u1.gruende.map((g) => g.id).join() === 'spyUeber200,linieSteigt,qqqUeber200,iwmUeber200,vix_ruhig,breiteBreit', 'Gründe in fester Reihenfolge')
ok(urteile({ spy: ab, qqq: auf, vola: vRuhig }).urteil === 'gegenwind', 'SPY unter der 200-Tage-Linie: Gegenwind, egal was sonst')
ok(urteile({ spy: auf, qqq: auf, vola: vStress }).urteil === 'gegenwind', 'VIX angespannt UND umgekehrt: Gegenwind trotz Aufwärtstrend')
ok(urteile({ spy: auf, qqq: auf, vola: { zone: 'angespannt', struktur: 'normal' } }).urteil === 'gemischt', 'VIX angespannt ohne umgekehrte Struktur: gemischt')
ok(urteile({ spy: auf, qqq: ab, vola: vRuhig }).urteil === 'gemischt', 'QQQ unter der Linie: gemischt')
ok(urteile({ spy: erholung, qqq: auf, vola: vRuhig }).urteil === 'gemischt', 'SPY darüber, Linie fällt noch: gemischt')
ok(urteile({ spy: kurz, qqq: auf }).urteil === 'unbekannt' && urteile({}).urteil === 'unbekannt', 'Leitindex unbekannt: kein Urteil')
ok(urteile({ spy: auf, qqq: auf }).urteil === 'rueckenwind', 'ohne VIX-Daten zählt nur der Trend')

// ── Von wann sind die Zahlen? (Audit FACH-H-006) ──
{
    const Z = (iso) => Date.parse(iso)
    // Tageskerzen der Kursquelle tragen den Sitzungsbeginn (09:30 New York = 14:30 UTC im Winter).
    const fr = Z('2026-11-13T14:30:00Z'), mo = Z('2026-11-16T14:30:00Z')
    const bisFr = [{ t: Z('2026-11-12T14:30:00Z'), c: 1 }, { t: fr, c: 2 }]
    ok(schlussTag(bisFr) === '2026-11-13' && schlussTag([]) === null && schlussTag([{ t: NaN, c: 1 }]) === null, 'Handelstag der letzten Kerze, ohne Kerzen nichts')
    // Dollar-Index: Kerze um Mitternacht New York — bleibt derselbe Tag, nicht der Vortag
    ok(schlussTag([{ t: Z('2026-11-13T05:00:00Z'), c: 1 }]) === '2026-11-13', 'Kerze um 00:00 New York gehört zu diesem Tag')

    // Montag 10:30 New York: die Sitzung läuft, die Kursquelle hat die laufende Kerze verworfen
    const montagMittag = Z('2026-11-16T15:30:00Z')
    const antwort = {
        chart: { result: [{
            meta: { symbol: 'SPY', currentTradingPeriod: { regular: { start: mo / 1000, end: Z('2026-11-16T21:00:00Z') / 1000 } } },
            timestamp: [fr / 1000, mo / 1000],
            indicators: { quote: [{ close: [600, 570], open: [598, 600], high: [601, 600], low: [597, 569], volume: [1, 1] }] },
        }] },
    }
    const laufend = ausChart(antwort, montagMittag).kerzen
    ok(laufend.length === 1 && laufend[0].c === 600, 'während der Sitzung fehlt die laufende Tageskerze — der Kurs ist der vom Freitag')
    const s1 = kursStand({ index: [laufend, laufend], zins: [laufend] }, montagMittag)
    ok(s1.schluss.index === '2026-11-13' && s1.schluss.zins === '2026-11-13', 'Montag in der Sitzung: Schlusskurse vom Freitag, nicht «jetzt»')
    ok(s1.sitzung === 'regulaer' && s1.sitzungLaeuft === true, 'laufende reguläre Sitzung wird gekennzeichnet')
    // Nach dem Schluss kommt die Tageskerze mit — der Stand rückt auf Montag, nichts läuft mehr
    const montagAbend = Z('2026-11-16T21:30:00Z')
    const fertig = ausChart(antwort, montagAbend).kerzen
    const s2 = kursStand({ index: [fertig] }, montagAbend)
    ok(fertig.length === 2 && s2.schluss.index === '2026-11-16' && s2.sitzungLaeuft === false && s2.sitzung === 'nach', 'nach dem Schluss: Kurse vom selben Tag, keine Kennzeichnung')
    // Vorbörslich und am Wochenende läuft nichts — der letzte Schluss IST der Stand
    ok(sitzungsStand(Z('2026-11-16T13:00:00Z')).sitzungLaeuft === false && sitzungsStand(Z('2026-11-15T15:30:00Z')).sitzung === 'wochenende', 'vorbörslich und Wochenende: nicht gekennzeichnet')
    // Ein Block ist so alt wie sein ältester Wert; leere Reihen zählen nicht, ein leerer Block ist unbekannt
    const s3 = kursStand({ sektoren: [fertig, laufend, []], dollar: [[]], leer: [] }, montagAbend)
    ok(s3.schluss.sektoren === '2026-11-13' && s3.schluss.dollar === null && s3.schluss.leer === null, 'Block mit gemischtem Stand nennt den ältesten; ohne Kerzen null')
}

console.log(`✓ Marktlage Aktien: ${n} Prüfungen`)
