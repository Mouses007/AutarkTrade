/**
 * Selbsttest Footprint (shared/footprint.js) — Bündeln, Auswerten, Imbalance.
 *
 *   node shared/__selftest-footprint.mjs
 *
 * Die Seite ist die Falle: seite 1 = Käufer aggressiv. Vertauscht sähe jeder
 * Footprint plausibel aus und sagte das Gegenteil.
 */
import { buendele, legeZusammen, alsListe, werteKerze, autoStufe, stufeVon, fasseZusammen, valueArea, stapelZonen, abdeckung } from './footprint.js'
import zlib from 'zlib'
import * as fpServer from '../server/chart-footprint.js'

const { pruefeFootprintAnfrage, MAX_SPANNE_MS } = fpServer

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const M = 60_000
console.log('\nBündeln\n')
{
    const ev = [
        [0, 100.4, 2, 1], [10_000, 100.6, 1, 0], [20_000, 101.2, 3, 1], [59_999, 100.1, 1, 1],
        [60_000, 99.9, 5, 0],
    ]
    const b = buendele(ev, { ivMs: M, stufe: 1 })
    check('zwei Kerzen (0 und 60 000)', b.size === 2 && b.has(0) && b.has(M))
    check('Stufe 100: Kauf 2+1, Verkauf 1 — Seite 1 = Käufer', JSON.stringify(b.get(0).get(100)) === '[3,1]', JSON.stringify([...b.get(0)]))
    check('Stufe 101 und 99 getrennt', JSON.stringify(b.get(0).get(101)) === '[3,0]' && JSON.stringify(b.get(M).get(99)) === '[0,5]')
    check('Fenster von/bis begrenzt', buendele(ev, { ivMs: M, stufe: 1, von: M }).size === 1)
    const z = legeZusammen(new Map([[0, new Map([[100, [1, 1]]])]]), b)
    check('Zusammenlegen addiert gleiche Stufe', JSON.stringify(z.get(0).get(100)) === '[4,2]')
    const l = alsListe(b, 1)
    check('Liste: Kerzen aufsteigend, Preise absteigend', l[0].t === 0 && l[0].zeilen[0][0] === 101 && l[0].zeilen[1][0] === 100)
    check('Stufe 0,1 ohne Rundungsfehler (100.3 → Stufe 1003)', stufeVon(100.3, 0.1) === 1003)
}

console.log('\nAuswerten\n')
{
    // Preis absteigend: 103, 102, 101, 100
    const zeilen = [[103, 30, 2], [102, 40, 5], [101, 50, 10], [100, 3, 12]]
    const w = werteKerze(zeilen, { faktor: 3 })
    check('Summen und Delta', w.kauf === 123 && w.verkauf === 29 && w.delta === 94)
    check('POC = Stufe mit dem meisten Volumen (101: 60)', w.poc === 101)
    // diagonal: Kauf 103 (30) gegen Verkauf 102 (5) = 6:1 → ja; Kauf 102 (40) gegen Verkauf 101 (10) = 4:1 → ja; Kauf 101 (50) gegen 100 (12) → 4,2:1 ja
    check('Kauf-Imbalance diagonal gegen den Verkauf eine Stufe tiefer', w.imbalance[0].kauf && w.imbalance[1].kauf && w.imbalance[2].kauf, JSON.stringify(w.imbalance))
    check('drei Kauf-Imbalancen übereinander = Stapel', w.stapel.length === 1 && w.stapel[0].seite === 'kauf' && w.stapel[0].anzahl === 3 && w.stapel[0].von === 101 && w.stapel[0].bis === 103, JSON.stringify(w.stapel))
    // Verkauf 100 (12) gegen Kauf 101 (50): nein
    check('Gegenprobe: Verkauf 12 gegen Kauf 50 darüber ist keine Verkaufs-Imbalance', !w.imbalance[3].verkauf)
    const v = werteKerze([[101, 2, 1], [100, 1, 9]], { faktor: 3 })
    check('Verkaufs-Imbalance: Verkauf 9 gegen Kauf 2 eine Stufe höher', v.imbalance[1].verkauf && !v.imbalance[0].verkauf)
    const rand = werteKerze([[101, 0.1, 0], [100, 0, 0.1]], { faktor: 3, minVol: 1 })
    check('Kleinstmengen unter minVol sind keine Imbalance', !rand.imbalance.some((x) => x.kauf || x.verkauf))
    // FUN-F2A-003: Stufen ohne Handel fehlen in den Zeilen — Nachbar ist die Stufe darunter, nicht die nächste Zeile
    const luecke = werteKerze([[105, 30, 1], [100, 1, 40]], { faktor: 3, stufe: 1 })
    check('Lücke 101–104: Kauf 30 auf 105 gegen Verkauf 0 auf 104 ist eine Imbalance', luecke.imbalance[0].kauf, JSON.stringify(luecke.imbalance))
    check('Lücke: Verkauf 40 auf 100 gegen Kauf 0 auf 101 ist eine Imbalance', luecke.imbalance[1].verkauf)
    const ueberLuecke = werteKerze([[110, 30, 0], [105, 30, 1], [100, 30, 1], [90, 0, 1]], { faktor: 3, stufe: 1 })
    check('kein Stapel über Lücken (110/105/100 liegen nicht übereinander)', ueberLuecke.stapel.length === 0, JSON.stringify(ueberLuecke.stapel))
    const nachLuecke = werteKerze([[106, 30, 0], [105, 30, 1], [104, 30, 1], [103, 30, 1], [100, 0, 1]], { faktor: 3, stufe: 1 })
    check('Stapel 106–104 direkt übereinander zählt, die Lücke darunter nicht', nachLuecke.stapel.length === 1 && nachLuecke.stapel[0].von === 103 && nachLuecke.stapel[0].bis === 106, JSON.stringify(nachLuecke.stapel))
}

console.log('\nStufe und Anfrage\n')
{
    const k = Array.from({ length: 60 }, () => ({ h: 101.4, l: 100 }))
    check('autoStufe: 1,4 / 14 = 0,1', Math.abs(autoStufe(k) - 0.1) < 1e-12, String(autoStufe(k)))
    check('autoStufe rundet auf Ticks', autoStufe(k, { tick: 0.25 }) === 0.25)
    check('autoStufe: grosse Spannen → 1/2/2,5/5', autoStufe(Array.from({ length: 10 }, () => ({ h: 64500, l: 64000 }))) === 50)
    const a = pruefeFootprintAnfrage({ symbol: 'btcusdt', interval: '5m', stufe: '10', von: '1000000', bis: '2000000' }, 3_000_000)
    check('Anfrage: Symbol gross, von auf Kerzengrenze', a.symbol === 'BTCUSDT' && a.von === 900_000 && a.bis === 2_000_000, JSON.stringify(a))
    check('1d hat keinen Footprint', pruefeFootprintAnfrage({ symbol: 'BTCUSDT', interval: '1d', stufe: 1 }).fehler === 'zeiteinheit')
    check('Stufe 0 abgelehnt', pruefeFootprintAnfrage({ symbol: 'BTCUSDT', interval: '1m', stufe: 0 }).fehler === 'stufe')
    const lang = pruefeFootprintAnfrage({ symbol: 'BTCUSDT', interval: '1h', stufe: 1, von: 0, bis: 10 * MAX_SPANNE_MS }, 10 * MAX_SPANNE_MS)
    check('höchstens 48 h', lang.bis - lang.von <= MAX_SPANNE_MS)
}

console.log('\nZwischenspeicher der Stunden (BUG-S2-003)\n')
{
    const { baueFootprint, cacheStand, leereCache, MAX_ZEILEN } = fpServer
    if (typeof baueFootprint !== 'function') check('baueFootprint vorhanden', false)
    else {
        const H = 3_600_000, jetzt = Date.UTC(2026, 9, 31, 12, 30)
        const h1 = Date.UTC(2026, 9, 31, 8), h2 = h1 + H
        // Je Stunde 60 Kerzen × 600 Preise (Abstand 0,1) = 36 000 Zellen bei Stufe 0,1 — zwei Stunden sind zu fein
        const stunde = (h0) => zlib.gzipSync(Buffer.from(JSON.stringify(Array.from({ length: 60 * 600 }, (_, i) => [h0 + Math.floor(i / 600) * 60_000, 100 + (i % 600) / 10, 1, i % 2]))))
        const nutzlast = new Map([[h1, stunde(h1)], [h2, stunde(h2)]])
        let gelesen = []
        const quelle = { stunden: async () => [h1, h2], nutzlast: async (liste) => { gelesen.push(...liste); return new Map(liste.map((h) => [h, nutzlast.get(h)])) } }
        const anfrage = (stufe) => pruefeFootprintAnfrage({ symbol: 'BTCUSDT', interval: '1m', stufe, von: h1, bis: jetzt }, jetzt)
        leereCache()
        const fein = await baueFootprint(anfrage(0.1), quelle, jetzt)
        check(`zu feine Stufe (> ${MAX_ZEILEN} Zeilen) meldet zuFein`, fein.zuFein === true && fein.kerzen.length === 0)
        check('zu feine Stufe hinterlässt nichts im Zwischenspeicher', cacheStand().eintraege === 0 && cacheStand().zellen === 0, JSON.stringify(cacheStand()))
        const grob = await baueFootprint(anfrage(10), quelle, jetzt)
        check('brauchbare Stufe: Antwort mit 120 Kerzen, beide Stunden gemerkt', !grob.zuFein && grob.kerzen.length === 120 && cacheStand().eintraege === 2, `${grob.kerzen.length} ${JSON.stringify(cacheStand())}`)
        gelesen = []
        const nochmal = await baueFootprint(anfrage(10), quelle, jetzt)
        check('gemerkte Stunden: keine Nutzlast gelesen, gleiche Antwort', gelesen.length === 0 && JSON.stringify(nochmal.kerzen) === JSON.stringify(grob.kerzen))
        gelesen = []
        await baueFootprint(anfrage(10), quelle, h2 + H + 60_000)
        check('laufende Stunde wird frisch gelesen, nicht aus dem Speicher', gelesen.length === 1 && gelesen[0] === h2, JSON.stringify(gelesen))
        leereCache()
    }
}

// Darstellung (01.11.2026): Zusammenfassen, Value Area, Stapel-Zonen, Abdeckung
{
    const z = [[103, 1, 0], [102, 2, 1], [101, 0, 4], [100, 3, 3]]
    const m2 = fasseZusammen(z, 1, 2)
    check('Zusammenfassen: je 2 Stufen eine, Summen bleiben', JSON.stringify(m2) === JSON.stringify([[102, 3, 1], [100, 3, 7]]), JSON.stringify(m2))
    check('Zusammenfassen mit m=1: unverändert', fasseZusammen(z, 1, 1) === z)
    const va = valueArea([[105, 1, 0], [104, 1, 1], [103, 10, 10], [102, 5, 3], [101, 1, 0], [100, 0, 1]], 1)
    // gesamt 34, POC 103 (20) → 70 % = 23.8: + 102 (8) = 28 ≥ 23.8
    check('Value Area: vom POC zur volleren Seite, bis 70 %', va.oben === 103 && va.unten === 102, JSON.stringify(va))
    const va2 = valueArea([[110, 1, 1], [100, 9, 9]], 1)
    check('Value Area: Lücke zählt als 0, wächst trotzdem bis 70 %', va2.unten === 100 && va2.oben === 100, JSON.stringify(va2))
    check('Value Area ohne Zeilen → null', valueArea([], 1) === null)
    const k = [{ t: 0, h: 105, l: 99 }, { t: 1, h: 99, l: 95 }, { t: 2, h: 101, l: 97 }, { t: 3, h: 110, l: 103 }]
    const zonen = stapelZonen([{ t: 0, seite: 'kauf', von: 100, bis: 102 }, { t: 0, seite: 'verkauf', von: 120, bis: 121 }], k, 1)
    check('Stapel-Zone endet an der ersten späteren Kerze, die sie berührt', zonen[0].unten === 100 && zonen[0].oben === 103 && zonen[0].bisT === 2, JSON.stringify(zonen[0]))
    check('Stapel-Zone ohne Berührung läuft bis jetzt', zonen[1].bisT === null)
    const ab = [[90_000, 300_000]]
    check('Abdeckung: ganz drin = voll', abdeckung(120_000, 60_000, ab) === 'voll')
    check('Abdeckung: Aufzeichnung beginnt in der Kerze = teil', abdeckung(60_000, 60_000, ab) === 'teil')
    check('Abdeckung: davor = keine', abdeckung(0, 60_000, ab) === 'keine')
    check('Abdeckung: eine Sekunde Versatz zählt noch als voll', abdeckung(89_500, 60_000, ab) === 'voll')
    const S = 3_600_000
    const abs = fpServer.abschnitteAus([0, S, 3 * S], (h) => ({ 0: [120_000, S - 5], [S]: [S + 3, 2 * S - 2], [3 * S]: [3 * S + 600_000, 3 * S + 900_000] })[h])
    check('Abschnitte: aufeinanderfolgende Stunden zusammen, Lücke trennt', JSON.stringify(abs) === JSON.stringify([[120_000, 2 * S - 2], [3 * S + 600_000, 3 * S + 900_000]]), JSON.stringify(abs))
    check('Abschnitte: ohne bekannte Zeiten die ganze Stunde', JSON.stringify(fpServer.abschnitteAus([S], () => null)) === JSON.stringify([[S, 2 * S]]))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
