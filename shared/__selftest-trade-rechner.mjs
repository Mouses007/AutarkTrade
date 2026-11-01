/**
 * Selbsttest des Positionsrechners (`shared/tradeRechner.js`).
 *
 *   node shared/__selftest-trade-rechner.mjs
 */
import { rechnePosition, rechnerEingabe, betragUmrechnen } from './tradeRechner.js'
import { liqPreisLong, liqPreisShort } from './liquidation.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

// Long 100 → Stop 98 → Ziel 104, max. Verlust 50 USDT, ohne Gebühr
const ohne = { modus: 'risiko', betrag: 50, hebel: 10, gebuehrPct: 0 }
const a = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: ohne, mmr: 0.005 })
check('Richtung Long, stimmig', a.richtung === 'long' && a.stimmig)
check('Menge = Verlust / Stopabstand (25)', nah(a.menge, 25), a.menge)
check('Nominal 2500, Marge 250 bei 10×', nah(a.nominal, 2500) && nah(a.marge, 250))
check('Verlust am Stop genau −50', nah(a.verlustStop, -50), a.verlustStop)
check('Gewinn am Ziel +100, 2 R', nah(a.gewinnZiel, 100) && nah(a.rr, 2))
check('Liq nach Börsenformel', nah(a.liq, liqPreisLong(100, 10, 0.005)), a.liq)
check('Liq hinter dem Stop → keine Warnung', !a.liqVorStop && a.liq < 98)
check('Prozente', nah(a.stopPct, -2) && nah(a.zielPct, 4))

// Gebühren: der Verlust am Stop bleibt der eingegebene
const mitG = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, gebuehrPct: 0.06 }, mmr: 0.005 })
check('mit Gebühr: Verlust am Stop weiterhin −50', nah(mitG.verlustStop, -50), mitG.verlustStop)
check('mit Gebühr: kleinere Menge', mitG.menge < a.menge)
check('mit Gebühr: Gewinn unter 100', mitG.gewinnZiel < 100)

// Short
const s = rechnePosition({ einstieg: 100, stop: 103, ziel: 94, eingabe: ohne, mmr: 0.005 })
check('Short: Richtung, Menge, Verlust', s.richtung === 'short' && nah(s.menge, 50 / 3) && nah(s.verlustStop, -50))
check('Short: Liq über dem Einstieg (Börsenformel)', nah(s.liq, liqPreisShort(100, 10, 0.005)) && s.liq > 100)

// Hoher Hebel: Liq vor dem Stop
const eng = rechnePosition({ einstieg: 100, stop: 90, ziel: 120, eingabe: { ...ohne, hebel: 20 }, mmr: 0.005 })
check('Hebel 20, Stop −10 %: Liq liegt vor dem Stop → Warnung', eng.liqVorStop && eng.liq > 90, eng.liq)
const unhaltbar = rechnePosition({ einstieg: 100, stop: 99, ziel: 102, eingabe: { ...ohne, hebel: 200 }, mmr: 0.01 })
check('nicht haltbarer Hebel (1/L ≤ mmr): Warnung', !unhaltbar.haltbar && unhaltbar.liqVorStop)

// Andere Modi
const gr = rechnePosition({ einstieg: 200, stop: 190, ziel: 230, eingabe: { modus: 'groesse', betrag: 1000, hebel: 5, gebuehrPct: 0 } })
check('Grösse: Nominal 1000 → Menge 5, Marge 200', nah(gr.menge, 5) && nah(gr.marge, 200) && nah(gr.verlustStop, -50))
const mg = rechnePosition({ einstieg: 200, stop: 190, ziel: 230, eingabe: { modus: 'marge', betrag: 100, hebel: 5, gebuehrPct: 0 } })
check('Marge 100 × 5 → Nominal 500', nah(mg.nominal, 500) && nah(mg.menge, 2.5))

// Konto
const k = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, konto: 5000 } })
check('Risiko in % vom Konto (1 %), Marge 5 %', nah(k.kontoRisikoPct, 1) && nah(k.margeKontoPct, 5))
check('ohne Konto keine Prozente', a.kontoRisikoPct === null)

// Stop auf der falschen Seite
const falsch = rechnePosition({ einstieg: 100, stop: 102, ziel: 104, eingabe: ohne })
check('Stop über Long-Einstieg: nicht stimmig, kein Stop-Verlust', !falsch.stimmig && falsch.verlustStop === null)
check('ohne Einstieg: null', rechnePosition({ einstieg: 0, stop: 1, ziel: 2, eingabe: ohne }) === null)

// Betrag in % vom Konto
const konto = 1000
const pRisiko = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, betrag: 2, einheit: 'prozent', konto } })
check('Max. Verlust 2 % von 1000 = 20 USDT am Stop', nah(pRisiko.verlustStop, -20) && nah(pRisiko.betragUsdt, 20), pRisiko.verlustStop)
const pRisiko20 = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, betrag: 2, einheit: 'prozent', konto, hebel: 20 } })
check('Max. Verlust in %: Hebel ändert die Grösse nicht, nur die Marge', nah(pRisiko20.nominal, pRisiko.nominal) && nah(pRisiko20.marge, pRisiko.marge / 2))
const pMarge = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, modus: 'marge', betrag: 2, einheit: 'prozent', konto } })
const pMarge20 = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, modus: 'marge', betrag: 2, einheit: 'prozent', konto, hebel: 20 } })
check('Marge 2 % = 20 USDT, Nominal = Marge × Hebel', nah(pMarge.marge, 20) && nah(pMarge.nominal, 200) && nah(pMarge20.nominal, 400))
const pGroesse = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, modus: 'groesse', betrag: 50, einheit: 'prozent', konto } })
check('Positionsgrösse 50 % von 1000 = 500 Nominal', nah(pGroesse.nominal, 500))
const ohneKonto = rechnePosition({ einstieg: 100, stop: 98, ziel: 104, eingabe: { ...ohne, betrag: 2, einheit: 'prozent' } })
check('% ohne Kontostand: Menge 0, kontoFehlt', ohneKonto.menge === 0 && ohneKonto.kontoFehlt === true)
check('USDT-Betrag: kontoFehlt false, betragUsdt = Betrag', a.kontoFehlt === false && nah(a.betragUsdt, 50))

// USDT ↔ % umschalten (Audit FUN-F2B-004): die Position bleibt gleich gross
{
    const pos = (betrag, einheit, k) => rechnePosition({ einstieg: 100, stop: 95, ziel: 110, eingabe: { ...ohne, betrag, einheit, konto: k } }).menge
    let ok = true
    const schlecht = []
    for (const [b, k] of [[15, 200000], [9, 200000], [12, 50000], [45, 100000], [20, 623], [1000, 200000]]) {
        const pr = betragUmrechnen(b, k, true)
        const zurueck = betragUmrechnen(pr, k, false)
        const abw = Math.abs(pos(pr, 'prozent', k) / pos(b, 'usdt', k) - 1)
        if (!(pr > 0) || abw > 1e-5 || Math.abs(zurueck - b) > 1e-6 * b) { ok = false; schlecht.push(`${b}@${k}→${pr}→${zurueck}`) }
    }
    check('Umschalten USDT → % → USDT: Menge gleich, Betrag zurück, nie 0', ok, schlecht.join(', '))
    check('Umschalten ohne Kontostand: Zahl bleibt', betragUmrechnen(20, 0, true) === 20)
}

// Eingaben säubern
const e = rechnerEingabe({ modus: 'x', betrag: -5, hebel: 999, gebuehrPct: 'a' })
check('Eingabe: unbekannter Modus, negativer Betrag, Hebel gedeckelt', e.modus === 'risiko' && e.betrag === 50 && e.hebel === 200 && e.gebuehrPct === 0.06, JSON.stringify(e))
check('Eingabe: Hebel unter 1 → Vorgabe', rechnerEingabe({ hebel: 0.5 }).hebel === 10)
check('Eingabe: unbekannte Einheit → USDT, alte Zeichnungen ohne Einheit → USDT',
    rechnerEingabe({ einheit: 'eur' }).einheit === 'usdt' && rechnerEingabe({ modus: 'risiko', betrag: 20 }).einheit === 'usdt')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
