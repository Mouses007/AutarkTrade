/**
 * Selbsttest: Kontostand je Börse (shared/kontostand.js) — eine Regel für die
 * Dashboard-Karte und den KI-Agenten. Bis 10/2026 nahm der Agent bei einem
 * Börseneintrag ohne `start` die alte Sammel-Einzahlung, das Journal 0.
 *
 * Aufruf: node shared/__selftest-kontostand.mjs
 */
import { kontostand } from './kontostand.js'
import { kontostand as ausDashboard } from '../src/components/dashboard/rechnung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

pruefe(ausDashboard === kontostand, 'Dashboard-Karte nutzt dieselbe Funktion')

const k = kontostand({ benutzer: { balances: { bitget: { start: 1000 } }, startBalance: 500 }, broker: 'bitget', allTimeNetPnL: 250, positionen: [], bonus: 0 })
pruefe(k.start === 1000 && k.aktuell === 1250, 'Start der Börse + Netto-Ergebnis')

const ohneStart = kontostand({ benutzer: { balances: { bitget: {} }, startBalance: 500 }, broker: 'bitget', allTimeNetPnL: 250 })
pruefe(ohneStart === null, 'Börseneintrag ohne Start: kein Stand (nicht die Sammel-Einzahlung)')

const alt = kontostand({ benutzer: { balances: {}, startBalance: 500 }, broker: 'pionex', allTimeNetPnL: -100 })
pruefe(alt.start === 500 && alt.aktuell === 400, 'ohne Börseneintrag: die alte Sammel-Einzahlung')

const mitPos = kontostand({
    benutzer: { balances: { bitunix: { start: 100 } } }, broker: 'bitunix', allTimeNetPnL: 0, bonus: 5,
    positionen: [{ status: 'open', broker: 'bitunix', unrealizedPNL: 10 }, { status: 'open', broker: 'bitget', unrealizedPNL: 99 }],
})
pruefe(mitPos.aktuell === 115 && mitPos.pnl === 10, 'offene Positionen der Börse und Bonus im Stand, Bonus nicht im Ergebnis')

console.log(`kontostand: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
