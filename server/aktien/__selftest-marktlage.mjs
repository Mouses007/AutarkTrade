/**
 * Selbsttest: Marktlage für Aktien.
 *
 *   node server/aktien/__selftest-marktlage.mjs
 */
import assert from 'node:assert/strict'
import { indexLage, schwankung, sektorStaerke, standUndAenderung, breite, urteile } from './marktlage-kern.js'

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

console.log(`✓ Marktlage Aktien: ${n} Prüfungen`)
