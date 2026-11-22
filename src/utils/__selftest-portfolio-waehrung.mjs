/**
 * Selbsttest der Anzeigewährung des Portfolios (`portfolioWaehrung.js`).
 *
 *   node src/utils/__selftest-portfolio-waehrung.mjs
 *
 * Geprüft wird, was still danebengeht: die Richtung der Umrechnung (CHF →
 * USD teilt durch den Kurs), und dass ohne Kurs CHF bleibt statt einer Zahl
 * mit erfundenem Kurs.
 */
import { faktorAusChf, wirksameWaehrung, waehrungsAuswahl, normWaehrung } from './portfolioWaehrung.js'

let bestanden = 0, fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b) => Math.abs(a - b) < 1e-12
const fx = { chf: 0.8, eur: 0.9 }

console.log('\nFaktor')
check('CHF bleibt', faktorAusChf('CHF', fx) === 1 && faktorAusChf('CHF', null) === 1)
check('CHF → USD teilt durch den Kurs: 80 CHF = 100 USD', nah(80 * faktorAusChf('USD', fx), 100))
check('CHF → EUR über USD: 80 CHF = 90 EUR', nah(80 * faktorAusChf('EUR', fx), 90))
check('ohne Kurs kein Faktor', faktorAusChf('USD', null) === null && faktorAusChf('USD', { chf: 0 }) === null && faktorAusChf('USD', {}) === null)
check('EUR ohne echten EUR-Kurs: keiner', faktorAusChf('EUR', { chf: 0.8, eur: null }) === null)
check('unbekannte Währung: keiner', faktorAusChf('GBP', fx) === null)

console.log('\nWirksame Währung')
check('Standard gilt ohne Wahl', wirksameWaehrung(null, 'CHF', fx) === 'CHF' && wirksameWaehrung(null, 'usd', fx) === 'USD')
check('Wahl des Geräts geht vor', wirksameWaehrung('USD', 'CHF', fx) === 'USD')
check('ohne Kurs bleibt CHF', wirksameWaehrung('USD', 'CHF', null) === 'CHF' && wirksameWaehrung(null, 'EUR', { chf: 0.8 }) === 'CHF')
check('leerer Standard = CHF', wirksameWaehrung(null, '', fx) === 'CHF')
check('unbekannte Wahl fällt auf den Standard', wirksameWaehrung('GBP', 'USD', fx) === 'USD' && normWaehrung('gbp') === null)

console.log('\nAuswahl')
check('Standard CHF: CHF und USD', waehrungsAuswahl('CHF', fx).join() === 'CHF,USD')
check('Standard EUR: EUR zuerst', waehrungsAuswahl('EUR', fx).join() === 'EUR,CHF,USD')
check('Standard USD: USD zuerst', waehrungsAuswahl('USD', fx).join() === 'USD,CHF')
check('ohne Kurs nur CHF (Schalter verschwindet)', waehrungsAuswahl('CHF', null).join() === 'CHF')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
