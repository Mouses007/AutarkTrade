/**
 * Selbsttest der Anzeigewährung (server/waehrung.js).
 * Der Kurs kommt aus `fxHeute`; hier wird nur geprüft, welcher Kurs gilt —
 * ohne Netz und ohne Datenbank.
 */
import { normWaehrung, anzeigeKursAus, WAEHRUNGEN } from './waehrung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

const fx = { chf: 0.79, eur: 0.91, quelle: 'EZB', datum: '2026-10-28' }

pruefe(WAEHRUNGEN.join() === 'USD,CHF,EUR', 'drei Währungen wählbar')
pruefe(normWaehrung('chf') === 'CHF' && normWaehrung(' EUR ') === 'EUR', 'Code wird normalisiert')
pruefe(normWaehrung('') === 'USD' && normWaehrung(null) === 'USD' && normWaehrung('JPY') === 'USD', 'leer oder unbekannt = USD')

const usd = anzeigeKursAus('USD', fx, 0.8)
pruefe(usd.code === 'USD' && usd.faktor === 1 && usd.quelle === null, 'USD: Faktor 1, kein Kurs nötig')

const chf = anzeigeKursAus('CHF', fx, 0.8)
pruefe(chf.code === 'CHF' && chf.faktor === 0.79 && chf.quelle === 'EZB' && chf.datum === '2026-10-28', 'CHF: EZB-Kurs statt fester 0.8')
const eur = anzeigeKursAus('EUR', fx, 0.8)
pruefe(eur.code === 'EUR' && eur.faktor === 0.91, 'EUR: EUR-Kurs, nicht der CHF-Kurs')

const gemerkt = anzeigeKursAus('CHF', { chf: 0.81, eur: 0.92, quelle: 'EZB vom 2026-10-20', datum: '2026-10-20' }, 0.8)
pruefe(gemerkt.faktor === 0.81 && gemerkt.quelle.startsWith('EZB vom'), 'gemerkter Kurs (offline) gilt vor dem Faktor')

// `fxHeute` fällt zuletzt selbst auf die Einstellung bzw. 0.8 zurück — das ist kein Kurs
const notnagel = { chf: 0.8, eur: 0.8, quelle: 'Einstellung', datum: null }
const rueck = anzeigeKursAus('CHF', notnagel, 0.85)
pruefe(rueck.faktor === 0.85 && rueck.quelle === 'einstellung', 'ohne Kurs: gespeicherter Faktor als Rückfall')
const ohne = anzeigeKursAus('EUR', notnagel, null)
pruefe(ohne.code === 'USD' && ohne.faktor === 1, 'Gegenprobe: ohne Kurs und Faktor in USD statt erfundener 0.8')
pruefe(anzeigeKursAus('CHF', null, 0).code === 'USD', 'Gegenprobe: Faktor 0 ist kein Kurs')
pruefe(anzeigeKursAus('CHF', { chf: -1, eur: 0, quelle: 'EZB' }, 0.8).quelle === 'einstellung', 'Gegenprobe: unsinniger Kurs wird verworfen')

// EUR nie aus CHF: der gemerkte Ersatz trägt dann `eurAusChf`
const nurChf = { chf: 0.81, eur: 0.81, quelle: 'EZB vom 2026-10-20', datum: '2026-10-20', ersatz: true, eurAusChf: true }
pruefe(anzeigeKursAus('EUR', nurChf, 0.8).code === 'USD', 'EUR ohne eigenen Kurs: USD statt CHF-Kurs')
pruefe(anzeigeKursAus('CHF', nurChf, 0.8).faktor === 0.81, 'Gegenprobe: CHF nimmt den gemerkten CHF-Kurs')
// Der gespeicherte Faktor stammt aus der CHF-Zeit
pruefe(anzeigeKursAus('EUR', notnagel, 0.8).code === 'USD', 'EUR: der CHF-Faktor gilt nicht')
pruefe(anzeigeKursAus('CHF', notnagel, 0.8).faktor === 0.8, 'Gegenprobe: CHF nimmt den Faktor')

console.log(`waehrung: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
