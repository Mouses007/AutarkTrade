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
// Tief 101: Linie 101 wird nur berührt (101 × 0,995 < 101) → kein Kauf; Hoch 109: 109 nur berührt → kein Verkauf.
// Seit FUN-R-101 zählt die Schwelle, nicht die Linie: der Start liegt AUF der Linie 105, der Fall
// durchsticht sie (104,475) → Kauf bei 105, Verkauf bei 106. Käufe 105, 104, 103, 102; Verkäufe
// 103, 104, 105, 106 (je +1) und 107, 108 aus der Startposition → 6 Zyklen (vorher 5: die Linie 105
// wurde nie gefüllt), offen bleiben die Startzellen 108–109 und 109–110.
p('Berühren am Extrem füllt nicht, Durchstechen schon', rd.zyklen === 6 && rd.position === 2 && rd.ausfuehrungen === 4 + 4 + 6, `${rd.zyklen}/${rd.position}/${rd.ausfuehrungen}`)

console.log('Wegpunkt auf oder knapp hinter einer Linie (Audit FUN-R-101)')
// Band 80–120, 40 Zellen (Linien im Schritt 1), Kerzen im Schritt 0,5: jeder zweite Wegpunkt
// liegt genau auf einer Linie, durchstochen wird sie erst von der nächsten Kerze.
const treppe = (von, bis, t0 = 0) => {
    const aus = []; const s = bis < von ? -0.5 : 0.5; let t = t0
    for (let x = von + s; s < 0 ? x >= bis : x <= bis; x += s) aus.push(k(t += 60000, x - s, Math.max(x, x - s), Math.min(x, x - s), x))
    return aus
}
const runter = treppe(100, 70), rauf = treppe(70, 100, runter.at(-1).t)
const band = { unten: 80, oben: 120, anzahl: 40, menge: 1, startPreis: 100 }
const fl = simuliereGrid({ ...band, kerzen: runter, richtung: 'long', durchstich: 0.0002 })
// Start: 19 Zellen (Linien 101…119) zu 100. Fall: Käufe bei 100, 99, … 80 (21) → alle 40 offen.
// Schwebend bei 70: 19 × (70 − 100) + Σ(70 − l, l = 80…100) = −570 − 420 = −990.
p('Long 100 → 70: jede Linie wird gekauft (21 Käufe, Position 40)', fl.position === 40 && fl.ausfuehrungen === 19 + 21, `${fl.position}/${fl.ausfuehrungen}`)
p('Long 100 → 70: Verlust −990 statt −570', nahe(fl.gesamt, -990) && nahe(fl.maxVerlust, -990), String(fl.gesamt))
const fl2 = simuliereGrid({ ...band, kerzen: [...runter, ...rauf], richtung: 'long', durchstich: 0.0002 })
// Zurück auf 100: Verkäufe bei 81…99 (19 Zyklen zu +1); 100 wird nur berührt → Zelle 99–100 bleibt (+1 schwebend).
p('Long 100 → 70 → 100: 19 Zyklen, 21 offen, gesamt 20', fl2.zyklen === 19 && fl2.position === 21 && nahe(fl2.gesamt, 20) && nahe(fl2.maxVerlust, -990), `${fl2.zyklen}/${fl2.position}/${fl2.gesamt}`)
const fl0 = simuliereGrid({ ...band, kerzen: [...runter, ...rauf], richtung: 'long' })
// Ohne Durchstich: der Startkurs auf der Linie 100 zählt nicht (wie bisher), Käufe 99…80, Verkäufe 81…100.
p('ohne Durchstich unverändert: 20 Zyklen, 19 offen, gesamt 20', fl0.zyklen === 20 && fl0.position === 19 && nahe(fl0.gesamt, 20) && nahe(fl0.maxVerlust, -960))
// Marge 600: bei 80 sind 39 Zellen offen, schwebend −380 − 210 = −590 → Eigenkapital 10 ≤ 0,005 × 39 × 80
const fliq = simuliereGrid({ ...band, kerzen: [...runter, ...rauf], richtung: 'long', durchstich: 0.0002, einsatz: 600, mmr: 0.005 })
p('Long mit Marge 600 wird bei 80 liquidiert (vorher: keine Liquidation)', fliq.liquidation?.preis === 80 && nahe(fliq.gesamt, -600), JSON.stringify(fliq.liquidation))
const hoch = treppe(100, 130), ab = treppe(130, 100, hoch.at(-1).t)
const fs = simuliereGrid({ ...band, kerzen: [...hoch, ...ab], richtung: 'short', durchstich: 0.0002 })
// Spiegel: Start 19 Zellen short zu 100, Verkäufe 100…120, bei 130 schwebend −990; zurück: Rückkäufe 119…101.
p('Short 100 → 130 → 100: 19 Zyklen, −21 offen, gesamt 20, grösster Verlust −990', fs.zyklen === 19 && fs.position === -21 && nahe(fs.gesamt, 20) && nahe(fs.maxVerlust, -990), `${fs.zyklen}/${fs.position}/${fs.gesamt}/${fs.maxVerlust}`)
const fn = simuliereGrid({ ...band, kerzen: [...runter, ...rauf, ...treppe(100, 130, 1e7), ...treppe(130, 100, 2e7)], richtung: 'neutral', durchstich: 0.0002 })
// Neutral: Long-Zellen 80…99 kaufen (20), verkaufen 81…99 und – im Anstieg über 100 – auch 100 (20 Zyklen);
// Short-Zellen verkaufen 101…120 (20), kaufen 119…101 zurück (19 Zyklen), Zelle 100–101 bleibt short (+1).
p('Neutral 100 → 70 → 100 → 130 → 100: 39 Zyklen, Position −1, gesamt 40', fn.zyklen === 39 && fn.position === -1 && nahe(fn.gesamt, 40), `${fn.zyklen}/${fn.position}/${fn.gesamt}`)
// Knapp hinter der Linie: 98,99 liegt unter 99, aber über der Schwelle 99 × 0,9998 = 98,9802
const fk = simuliereGrid({ ...band, kerzen: [k(1, 100, 100, 98.99, 98.99), k(2, 98.99, 98.99, 97.5, 97.5)], richtung: 'long', durchstich: 0.0002 })
p('Wegpunkt 98,99 (< 2 bp unter 99): 99 wird von der nächsten Kerze gekauft', fk.position === 19 + 3 && nahe(fk.realisiert, 0), String(fk.position))

// Gegenprobe ohne Indexrechnung: je Zelle entscheidet das letzte Ereignis auf dem Weg
// (Schwelle unten erreicht / Schwelle oben erreicht) über offen oder zu, jeder Wechsel
// zurück ist ein Zyklus. Kurse auf Tick 0,5 gerundet, damit Wegpunkte oft auf Linien liegen.
{
    let saat = 4711
    const zufall = () => (saat = (saat * 1664525 + 1013904223) >>> 0) / 2 ** 32
    let abweichungen = 0, faelle = 0, aufLinie = 0
    for (let lauf = 0; lauf < 300; lauf++) {
        const eps = [0, 0.0002, 0.003][lauf % 3], richtung = ['long', 'short', 'neutral'][(lauf / 3 | 0) % 3]
        const start = 100.25, kz = []
        let x = start
        for (let i = 0; i < 60; i++) {
            const o = x, e1 = Math.round((o + (zufall() - 0.5) * 6) * 2) / 2, e2 = Math.round((o + (zufall() - 0.5) * 6) * 2) / 2
            const h = Math.max(o, e1, e2), l = Math.min(o, e1, e2)
            x = Math.round((l + zufall() * (h - l)) * 2) / 2
            kz.push(k(i + 1, o, h, l, x))
        }
        const r = simuliereGrid({ kerzen: kz, unten: 90, oben: 110, anzahl: 20, richtung, menge: 1, startPreis: start, durchstich: eps })
        const Lg = gridLinien(90, 110, 20)
        const weg = kz.flatMap((c) => (c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c]))
        aufLinie += weg.filter((w) => Number.isInteger(w)).length
        let pos = 0, zyk = 0
        for (let i = 0; i < 20; i++) {
            const lang = richtung === 'long' || (richtung === 'neutral' && Lg[i] < start)
            let offen = richtung === 'long' ? Lg[i] > start : richtung === 'short' ? Lg[i + 1] < start : false
            for (const w of weg) {
                const unten = w <= Lg[i] * (1 - eps), oben = w >= Lg[i + 1] * (1 + eps)
                const auf = lang ? unten : oben, zu = lang ? oben : unten
                if (auf) offen = true
                else if (zu && offen) { offen = false; zyk++ }
            }
            if (offen) pos += lang ? 1 : -1
        }
        faelle++
        if (r.position !== pos || r.zyklen !== zyk) abweichungen++
    }
    p(`Gegenprobe je Zelle: ${faelle} Zufallswege (Long/Short/Neutral, Durchstich 0/2 bp/30 bp, ${aufLinie} Wegpunkte auf einer Linie) – Position und Zyklen gleich`, abweichungen === 0 && aufLinie > 1000, `${abweichungen} Abweichungen`)
}

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
