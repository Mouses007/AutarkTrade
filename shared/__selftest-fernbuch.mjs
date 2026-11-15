/**
 * Selbsttest Orderbuch-Fernfeld (shared/fernBuch.js) — Zonen, Spalten, Profil.
 *
 *   node shared/__selftest-fernbuch.mjs
 *
 * Fallen: eine Wand, die nur eine von 60 Minuten stand, darf nicht so kräftig
 * sein wie eine, die die ganze Stunde stand (Mittel, nicht Summe); Spot und
 * Perp werden je Minute zusammengezählt, nicht hintereinandergehängt; „steht
 * seit" bricht an einer Aufnahmelücke ab, statt über sie hinweg zu behaupten.
 */
import {
    fernSchritt, fernFrame, summiereFrames, spaltenAus, profilAus, viertelAus, anzeigeStufe,
    mischeFrames, kodiereStunde, dekodiereStunde, runde, FERN_FRAME_MS,
} from './fernBuch.js'
import { pruefeBuchkarteAnfrage } from '../server/chart-buchkarte.js'
import { overlaysFuer, fuerSymbol } from '../src/utils/chart/overlays/liste.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const M = FERN_FRAME_MS

console.log('\nZonen\n')
check('Schritt BTC 64 000 → 50', fernSchritt(64_000) === 50, fernSchritt(64_000))
check('Schritt ETH 2 000 → 2', fernSchritt(2000) === 2, fernSchritt(2000))
check('Schritt 0.5 → 0.0005 (glatt)', fernSchritt(0.5) === 0.0005, fernSchritt(0.5))
check('Schritt ohne Kurs → 0', fernSchritt(0) === 0)
check('runde: 4 Stellen', runde(1079.4567) === 1079 && runde(0.0123456) === 0.01235)
{
    const bids = new Map([[60_000, 500], [60_010, 579], [59_960, 140], [40_000, 999], [63_990, 1]])
    const asks = new Map([[64_010, 2], [70_000, 300], [90_000, 5]])
    const f = fernFrame({ bids, asks }, { mid: 64_000, schritt: 50 })
    check('Frame: Stufen derselben Zone summiert (60 000 + 60 010 → 1079)', JSON.stringify(f.b.find(([i]) => i === 1200)) === JSON.stringify([1200, 1079]), JSON.stringify(f.b))
    check('Frame: jenseits ±20 % weggelassen (40 000 / 90 000)', !f.b.some(([i]) => i === 800) && !f.a.some(([i]) => i === 1800))
    check('Frame: nach Zone aufsteigend', f.b.every((x, k) => k === 0 || f.b[k - 1][0] < x[0]))
    check('Frame: Asks getrennt von Bids', f.a.length === 2 && f.a[1][0] === 1400)
}

console.log('\nSpot + Perp, Spalten\n')
const fr = (t, b, a = [], s = 50, extra = {}) => ({ t, s, mid: 64_000, seit: 0, lo: 0, hi: 0, b, a, ...extra })
{
    const perp = [fr(0, [[1200, 100]]), fr(M, [[1200, 100]])]
    const spot = [fr(0, [[1200, 900], [1199, 5]]), fr(2 * M, [[1200, 50]])]
    const sum = summiereFrames([perp, spot])
    check('Summe: je Minute ein Frame (3 Minuten)', sum.length === 3, sum.length)
    check('Summe: gleiche Minute addiert (100 + 900)', sum[0].b.find(([i]) => i === 1200)[1] === 1000, JSON.stringify(sum[0].b))
    check('Summe: Eingaben unverändert', perp[0].b[0][1] === 100)
    const andererSchritt = summiereFrames([[fr(0, [[1200, 1]])], [fr(0, [[600, 2]], [], 100)]])
    check('Summe: anderer Schritt über den Preis umgerechnet (600×100 = 1200×50)', andererSchritt[0].b[0][1] === 3, JSON.stringify(andererSchritt[0].b))
}
{
    // Stunde: Wand A steht 60 Minuten, Wand B nur 1 Minute — beide 1000 Coins
    const frames = []
    for (let k = 0; k < 60; k++) frames.push(fr(k * M, k === 30 ? [[1200, 1000], [1100, 1000]] : [[1200, 1000]]))
    const sp = spaltenAus(frames, { ivMs: 3_600_000, stufe: 50 })
    const a = sp[0].z.find(([z]) => z === 1200)[1]
    const b = sp[0].z.find(([z]) => z === 1100)[1]
    check('Spalte: eine Kerze je Stunde', sp.length === 1)
    check('Spalte: ganze Stunde = 1000, eine Minute ≈ 16.7 (Mittel, nicht Summe)', a === 1000 && Math.abs(b - 1000 / 60) < 0.01, `${a} / ${b}`)
    const grob = spaltenAus(frames, { ivMs: 3_600_000, stufe: 200 })
    check('Spalte: Anzeigestufe bündelt Zonen (1200×50 → Zeile 300 bei 200)', grob[0].z.some(([z]) => z === 300))
    const eng = spaltenAus(frames, { ivMs: 3_600_000, stufe: 50, lo: 58_000, hi: 70_000 })
    check('Spalte: nur Zeilen im Preisbereich (55 000 fällt weg)', !eng[0].z.some(([z]) => z === 1100))
    const v = viertelAus(frames)
    check('Viertel: vier Viertelstunden mit Gewicht 15', v.length === 4 && v.every((x) => x.w === 15), JSON.stringify(v.map((x) => x.w)))
    const ausViertel = spaltenAus(v, { ivMs: 3_600_000, stufe: 50 })
    const b2 = ausViertel[0].z.find(([z]) => z === 1100)[1]
    check('Viertel: gewichtet ergibt dieselbe Stundenspalte', ausViertel[0].z.find(([z]) => z === 1200)[1] === 1000 && Math.abs(b2 - b) < 0.05, `${b2}`)
    const gemischt = spaltenAus([...v.slice(0, 3), ...frames.slice(45)], { ivMs: 3_600_000, stufe: 50 })
    check('Viertel + Minuten gemischt: Gewichte stimmen', Math.abs(gemischt[0].z.find(([z]) => z === 1100)[1] - b) < 0.05)
}
check('Anzeigestufe: 25 000 USD Spanne, Schritt 50, ≤ 300 Zeilen → 100', anzeigeStufe(25_000, 50, 300) === 100, anzeigeStufe(25_000, 50, 300))
check('Anzeigestufe: nie feiner als der Schritt', anzeigeStufe(100, 50, 300) === 50)

console.log('\nProfil\n')
{
    const frames = []
    for (let k = 0; k < 30; k++) frames.push(fr(k * M, [[1200, k >= 10 ? 1000 : 100], [1250, 20]], [[1300, k >= 25 ? 400 : 0]]))
    const p = profilAus(frames)
    const w = p.b.find(([preis]) => preis === 60_000)
    check('Profil: Preis aus Zone (1200 × 50)', !!w)
    check('Profil: Wand steht seit Minute 10 (vorher nur 100 < 50 %)', w[2] === 10 * M, w?.[2])
    check('Profil: kleine Dauerzone steht seit Beginn', p.b.find(([preis]) => preis === 62_500)[2] === 0)
    check('Profil: Ask seit Minute 25', p.a.find(([preis]) => preis === 65_000)[2] === 25 * M)
    // Lücke von 30 min: „seit" darf nicht darüber hinweg
    const mitLuecke = [fr(0, [[1200, 1000]]), fr(M, [[1200, 1000]]), fr(40 * M, [[1200, 1000]]), fr(41 * M, [[1200, 1000]])]
    check('Profil: Aufnahmelücke bricht „seit"', profilAus(mitLuecke).b[0][2] === 40 * M, profilAus(mitLuecke).b[0][2])
    check('Profil: ohne Frames → null', profilAus([]) === null)
}

console.log('\nSpeichern, Neustart\n')
{
    const alt = [fr(0, [[1, 1]]), fr(M, [[1, 2]])]
    const neu = [fr(M + 5, [[1, 9]]), fr(2 * M, [[1, 3]])]
    const m = mischeFrames(alt, neu)
    check('Mischen: je Minute gewinnt der neue', m.length === 3 && m[1].b[0][1] === 9, JSON.stringify(m.map((f) => f.b[0][1])))
    check('Kodieren ↔ Dekodieren', JSON.stringify(dekodiereStunde(kodiereStunde(m))) === JSON.stringify(m))
}

console.log('\nAnfrage und Schalter\n')
{
    const jetzt = 10 * 86_400_000
    const a = pruefeBuchkarteAnfrage({ symbol: 'BTCUSDT', quellen: 'perp,spot,quatsch', iv: '60000' }, jetzt)
    check('Anfrage: perp = futures, Unbekanntes fällt weg', JSON.stringify(a.quellen) === JSON.stringify(['futures', 'spot']), JSON.stringify(a.quellen))
    check('Anfrage: unter 15 min höchstens 24 h', a.bis - a.von === 24 * 3_600_000)
    check('Anfrage: 15 min höchstens 72 h', (() => { const b = pruefeBuchkarteAnfrage({ symbol: 'ETHUSDT', iv: '900000', von: '0' }, jetzt); return b.bis - b.von === 72 * 3_600_000 })())
    check('Anfrage: Bitunix-Schreibweise BTC_USDT erkannt', pruefeBuchkarteAnfrage({ symbol: 'btc_usdt' }, jetzt).symbol === 'BTCUSDT')
    check('Anfrage: SOL nicht erfasst', pruefeBuchkarteAnfrage({ symbol: 'SOLUSDT' }, jetzt).nichtErfasst === true)
    check('Schalter: bei BTC angeboten', overlaysFuer(false, 'BTCUSDT').some((o) => o.id === 'buchSpot'))
    check('Schalter: bei MEGA nicht', !overlaysFuer(false, 'MEGAUSDT').some((o) => o.id === 'buchPerp') && !fuerSymbol('buchPerp', 'MEGAUSDT'))
    check('Schalter: bei Aktien nicht', !overlaysFuer(true, 'BTCUSDT').some((o) => o.id === 'buchPerp'))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
