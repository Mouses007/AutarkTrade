/**
 * Selbsttest: Grid-Simulation (shared/grid-simulation.js), von Hand nachgerechnete Fälle.
 *
 * Aufruf: node shared/__selftest-grid-simulation.mjs
 */
import { gridLinien, inverseKerzen, mengeFuerGleichesKapital, simuliereGrid, simuliereBot } from './grid-simulation.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const k = (t, o, h, l, c) => ({ t, o, h, l, c })

console.log('Linien')
const L = gridLinien(100, 110, 10)
p('arithmetisch: 11 Linien 100…110 im Schritt 1', L.length === 11 && L[0] === 100 && L[10] === 110 && nahe(L[3], 103))
const G = gridLinien(100, 200, 4, 'geometric')
p('geometrisch: gleiche Faktoren', nahe(G[1] / G[0], G[4] / G[3]) && nahe(G[4], 200))
p('ungültig → leer', gridLinien(110, 100, 10).length === 0)

console.log('Long-Grid 100–110, 10 Zellen, Start 105, eine grüne Kerze 105 → 101 → 109')
// Startposition: Zellen über 105 (106–110 … 109–110) = 4 gekauft zu 105.
// Fall auf 101: Käufe bei 104, 103, 102, 101 (105 = Startkurs zählt nicht).
// Anstieg auf 109: Verkäufe 102,103,104,105 (je +1) und 107,108,109 (Einstieg 105: +2,+3,+4).
const r = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 109)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1 })
p('7 Zyklen, Grid-Gewinn 7', r.zyklen === 7 && nahe(r.gridGewinn, 7))
p('realisiert 4 + 9 = 13', nahe(r.realisiert, 13))
p('offen: Zelle 109–110 aus dem Start, schwebend +4', r.position === 1 && nahe(r.schwebend, 4))
p('gesamt 17 ohne Gebühren', nahe(r.gesamt, 17))
p('Ausführungen: 4 Start + 4 Käufe + 7 Verkäufe', r.ausfuehrungen === 15)

const rg = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 109)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, gebuehr: 0.001 })
const erwGeb = 0.001 * (4 * 105 + (104 + 103 + 102 + 101) + (102 + 103 + 104 + 105 + 107 + 108 + 109))
p('Gebühr je Ausführung auf den Ausführungspreis', nahe(rg.gebuehren, -erwGeb) && nahe(rg.gesamt, 17 - erwGeb))

console.log('Rote Kerze: zuerst das Hoch, dann das Tief')
const rr = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 101)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1 })
// Hoch zuerst: Startzellen verkaufen bei 107,108,109 (+2,+3,+4), dann Fall auf 101: Käufe 108…101 (ausser offene)
p('3 Zyklen beim Anstieg, danach Käufe im Fall', rr.zyklen === 3 && nahe(rr.realisiert, 9))
p('Position am Tief: alle Zellen über 101 offen (9)', rr.position === 9)

console.log('Short- und Neutral-Grid')
const rs = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 101)], unten: 100, oben: 110, anzahl: 10, richtung: 'short', menge: 1 })
// Start: Zellen unter 105 (L[i+1] < 105: 100–101 … 103–104) = 4 verkauft zu 105.
// Hoch 109: Short öffnet bei 106,107,108,109. Fall 101: Rückkauf 108,107,106,105 (je +1) und 103,102,101 (Einstieg 105: +2,+3,+4)
p('Short spiegelt Long: 7 Zyklen, realisiert 13', rs.zyklen === 7 && nahe(rs.realisiert, 13))
p('Short-Position −1, schwebend +4', rs.position === -1 && nahe(rs.schwebend, 4))
const rn = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'neutral', menge: 1 })
p('Neutral: keine Startposition', rn.position === 0 && rn.ausfuehrungen === 0)
const rn2 = simuliereGrid({ kerzen: [k(0, 105, 107, 103, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'neutral', menge: 1 })
p('Neutral: Short oben, Long unten, beide schliessen', rn2.zyklen === 4 && rn2.position === 0 && nahe(rn2.gesamt, 4))

console.log('Ausserhalb des Bands')
const ra = simuliereGrid({ kerzen: [k(0, 105, 105, 95, 95), k(1, 95, 96, 94, 95)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1 })
p('unter dem Band: alle Zellen ausser der Startzelle gekauft, keine Zyklen', ra.position === 9 && ra.zyklen === 0 && nahe(ra.zeitImBand, 0))

console.log('Liquidation')
const rl = simuliereGrid({ kerzen: [k(0, 105, 105, 80, 80), k(1, 80, 81, 70, 75)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, einsatz: 30, mmr: 0.005 })
p('Long mit kleiner Marge wird im Fall liquidiert', rl.liquidation !== null && rl.liquidation.t === 0)
p('liquidiert: gesamt = −Einsatz, Position 0', nahe(rl.gesamt, -30) && rl.position === 0)
const rl2 = simuliereGrid({ kerzen: [k(0, 105, 105, 80, 80)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, einsatz: 1000 })
p('grosse Marge: keine Liquidation', rl2.liquidation === null)

console.log('Inverse Kerzen und Menge bei anderem Band')
const iv = inverseKerzen([k(0, 100, 125, 80, 100)])[0]
p('inverse: Hoch = 1/Tief, Tief = 1/Hoch', nahe(iv.h, 1 / 80) && nahe(iv.l, 1 / 125) && nahe(iv.o, 0.01))
const m = mengeFuerGleichesKapital(3, gridLinien(100, 200, 10), gridLinien(50, 100, 10))
p('halbes Preisniveau → doppelte Menge', nahe(m, 6))

console.log('simuliereBot: Coin-M wird invers gerechnet, Ergebnis in der Coin')
const bot = {
    coinM: true, marginCoin: 'SOL',
    roh: { trend: 'short', top: String(1 / 95), bottom: String(1 / 200) }, hebel: 4,
    grid: { unten: 95, oben: 200, anzahl: 50, art: 'arithmetic', mengeJeGrid: 3 },
    einsatz: { aktuell: 3, extraMarge: 0 },
}
const kerzenUsd = [k(0, 120, 125, 110, 115), k(1, 115, 118, 100, 105)]
const sb = simuliereBot(bot, kerzenUsd)
p('Original: Einstellung 95–200, 50 Grids', sb.einstellung.unten === 95 && sb.einstellung.oben === 200 && sb.menge === 3)
p('Start- und Endpreis in USD zurückgerechnet', nahe(sb.startPreis, 120) && nahe(sb.endPreis, 105))
p('Coin fällt → Long der Coin verliert schwebend', sb.schwebend < 0)
const sv = simuliereBot(bot, kerzenUsd, { aenderung: { unten: 75, oben: 150 } })
p('Variante 75–150 übernimmt Band, Menge angepasst', sv.einstellung.unten === 75 && sv.einstellung.oben === 150 && sv.menge !== 3)
p('Variante hat eigene Ergebnisse', sv.zyklen !== undefined && sv.gesamt !== sb.gesamt)

console.log('Grid-Gewinn nach Gebühren (wie Pionex)')
const rf = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 109)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, gebuehr: 0.001, gebuehrMarkt: 0.002 })
const zyklenGeb = 0.001 * ((101 + 102) + (102 + 103) + (103 + 104) + (104 + 105) + (106 + 107) + (107 + 108) + (108 + 109))
p('Grid-Gewinn = brutto − Gebühren beider Ausführungen je Zyklus', nahe(rf.gridBrutto, 7) && nahe(rf.gridGewinn, 7 - zyklenGeb))
p('Startposition zahlt die Markt-Gebühr', nahe(rf.gebuehren, -(0.002 * 4 * 105 + 0.001 * ((104 + 103 + 102 + 101) + (102 + 103 + 104 + 105 + 107 + 108 + 109)))))

console.log('Durchstich')
const rd = simuliereGrid({ kerzen: [k(0, 105, 109, 101, 109)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, durchstich: 0.005 })
// Tief 101: Linie 101 wird nur berührt (101 × 0,995 < 101) → kein Kauf; Hoch 109: 109 nur berührt → kein Verkauf
p('Berühren am Extrem füllt nicht, Durchstechen schon', rd.zyklen === 5 && rd.position === 2)

console.log('Funding')
const ff = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105), k(8, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, funding: [{ t: 8, rate: 0.001 }] })
p('Long zahlt bei positivem Satz: −Satz × Position × Preis', nahe(ff.funding, -0.001 * 4 * 105) && nahe(ff.gesamt, ff.funding))
const fi = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105), k(8, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, funding: [{ t: 8, rate: 0.001 }], fundingFaktor: -1 })
p('inverses Instrument: Vorzeichen gedreht', nahe(fi.funding, 0.001 * 4 * 105))

console.log('Ausstieg')
const rx = simuliereGrid({ kerzen: [k(0, 105, 105, 95, 96), k(1, 96, 99, 90, 92)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, ausstiegUnten: 97 })
p('Stop unter dem Band: alles bei 97 geschlossen, Schluss', rx.ausstieg?.preis === 97 && rx.position === 0 && rx.kurve.length === 1)
p('Verlust = Summe der Einstiege − 97 je Zelle', nahe(rx.gesamt, rx.realisiert))

console.log('Liquidationsschätzung (alle Orders der Risikoseite gefüllt)')
// Long 100–110, 10 Zellen, Start 105, Menge 1, Marge 20, mmr 0
const rs2 = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, einsatz: 20 })
// Fall: Käufe bei 104, 103, 102 → Position 7, Einstiege 105×4 + 309 = 729.
// Bei 102: EK = 20 + 714 − 729 = 5 > 0; bei 101 wäre es −2 → zwischen 102 und 101:
// 20 + 7p − 729 = 0 → p = 709/7 ≈ 101,29 (vor dem Kauf bei 101)
p('Long: Liquidation im Abschnitt, in dem das Eigenkapital kippt', nahe(rs2.liqSchaetzung.unten, 709 / 7, 1e-9) && rs2.liqSchaetzung.oben === null)
const rs4 = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, einsatz: 100 })
// grosse Marge: alle Käufe bis 100 → Position 9, Einstiege 930; 100 + 9p − 930 = 0 → p = 830/9 (unter dem Band)
p('Long mit grosser Marge: Liquidation unter dem Band', nahe(rs4.liqSchaetzung.unten, 830 / 9, 1e-9))
const rs3 = simuliereGrid({ kerzen: [k(0, 105, 105, 105, 105)], unten: 100, oben: 110, anzahl: 10, richtung: 'long', menge: 1, einsatz: 3 })
// schon im Band: bei 104 → Position 5, EK = 3 + 4×(104−105) = −1 < 0 → zwischen 105 und 104: 3 + 4(p − 105) = 0 → p = 104,25
p('Long mit kleiner Marge: Liquidation schon im Band', nahe(rs3.liqSchaetzung.unten, 104.25, 1e-9))

console.log('simuliereBot: Hebel, Einsatz, Stops')
const sb2 = simuliereBot(bot, kerzenUsd, { aenderung: { hebel: 2 } })
p('Hebel 4 → 2 wie Pionex: Menge bleibt, Einsatz verdoppelt sich', nahe(sb2.menge, 3) && sb2.einstellung.hebel === 2 && nahe(sb2.einstellung.einsatz, 6))
const sb2b = simuliereBot(bot, kerzenUsd, { aenderung: { hebel: 3 } })
p('Hebel 4 → 3: Einsatz × 4/3 (Pionex-App: 3,068 → +1,022)', nahe(sb2b.einstellung.einsatz, 4) && nahe(sb2b.menge, 3))
const kz1 = [{ t: 0, o: 120, h: 120, l: 120, c: 120 }]
const h4 = simuliereBot(bot, kz1, { startPreis: 120 }), h8 = simuliereBot(bot, kz1, { startPreis: 120, aenderung: { hebel: 8 } })
p('Hebel 4 → 8 wie Pionex: Investition halb, Rest in dynamische Marge, Liquidation unverändert', nahe(h8.einstellung.einsatz, 1.5) && nahe(h8.menge, 3) && nahe(h8.liqSchaetzung.unten, h4.liqSchaetzung.unten, 1e-9))
const sb2c = simuliereBot(bot, kerzenUsd, { aenderung: { hebel: 2, einsatz: 3 } })
p('Hebel 2 bei gleichem Einsatz ausdrücklich: halbe Menge', nahe(sb2c.menge, 1.5))
const sb3 = simuliereBot(bot, kerzenUsd, { aenderung: { einsatz: 6 } })
p('doppelter Einsatz → doppelte Menge', nahe(sb3.menge, 6) && sb3.einstellung.einsatz === 6)
const sbE0 = simuliereBot(bot, [{ t: 0, o: 120, h: 120, l: 120, c: 120 }], { startPreis: 120 })
const sbE = simuliereBot(bot, [{ t: 0, o: 120, h: 120, l: 120, c: 120 }], { startPreis: 120, aenderung: { extraMarge: 1 } })
p('Extra-Marge: gleiche Menge, Liquidation weiter weg', sbE.menge === sbE0.menge && sbE.liqSchaetzung.unten < sbE0.liqSchaetzung.unten && sbE.einstellung.extraMarge === 1)
const sb4 = simuliereBot(bot, kerzenUsd, { aenderung: { stopLoss: 108 } })
p('Coin-M Long: Stop-Loss in USD wird invers zum oberen Ausstieg', sb4.ausstieg?.art === 'stopLoss' && nahe(sb4.ausstieg.preis, 108, 1e-9))
const sb5 = simuliereBot(bot, kerzenUsd, { aenderung: { takeProfit: 122 } })
p('Coin-M Long: Take-Profit 122 wird im Anstieg auf 125 getroffen', sb5.ausstieg?.art === 'takeProfit' && nahe(sb5.ausstieg.preis, 122, 1e-9))

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
