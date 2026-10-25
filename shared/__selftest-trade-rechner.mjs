/**
 * Selbsttest des Positionsrechners (`shared/tradeRechner.js`).
 *
 *   node shared/__selftest-trade-rechner.mjs
 */
import { rechnePosition, rechnerEingabe } from './tradeRechner.js'
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

// Eingaben säubern
const e = rechnerEingabe({ modus: 'x', betrag: -5, hebel: 999, gebuehrPct: 'a' })
check('Eingabe: unbekannter Modus, negativer Betrag, Hebel gedeckelt', e.modus === 'risiko' && e.betrag === 50 && e.hebel === 200 && e.gebuehrPct === 0.06, JSON.stringify(e))
check('Eingabe: Hebel unter 1 → Vorgabe', rechnerEingabe({ hebel: 0.5 }).hebel === 10)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
