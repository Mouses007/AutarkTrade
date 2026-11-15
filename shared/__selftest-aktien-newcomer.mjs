/**
 * Selbsttest: Newcomer-Karte (Haltefrist, Reichweite, Insider).
 *
 *   node shared/__selftest-aktien-newcomer.mjs
 */
import assert from 'node:assert/strict'
import { istJung, haltefrist, reichweite, insiderBilanz, shortVeraenderung, HALTEFRIST_TAGE } from './aktien-newcomer.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const TAG = 86_400_000
const JETZT = Date.UTC(2026, 10, 15)

ok(istJung(JETZT - 100 * TAG, JETZT) === true && istJung(JETZT - 800 * TAG, JETZT) === false, 'jung bis zwei Jahre')
ok(istJung(null, JETZT) === null && istJung(0, JETZT) === null, 'Börsengang unbekannt: null, nicht «alt»')

const laeuft = haltefrist(JETZT - 100 * TAG, JETZT)
ok(laeuft.status === 'laeuft' && laeuft.tage === 80 && laeuft.ablauf === JETZT + 80 * TAG, 'Tag 100: läuft, noch 80 Tage')
ok(haltefrist(JETZT - 160 * TAG, JETZT).status === 'bald' && haltefrist(JETZT - 150 * TAG, JETZT).status === 'bald', 'ab 30 Tagen vorher: bald')
ok(haltefrist(JETZT - 149 * TAG, JETZT).status === 'laeuft', '31 Tage vorher: läuft noch')
const vorbei = haltefrist(JETZT - 200 * TAG, JETZT)
ok(vorbei.status === 'abgelaufen' && vorbei.tage === -20, 'seit 20 Tagen abgelaufen')
ok(haltefrist(JETZT - (HALTEFRIST_TAGE + 91) * TAG, JETZT) === null, 'länger als 90 Tage vorbei: kein Thema mehr')
ok(haltefrist(JETZT - HALTEFRIST_TAGE * TAG, JETZT).tage === 0 && haltefrist(JETZT - HALTEFRIST_TAGE * TAG, JETZT).status === 'bald', 'am Tag selbst')
ok(haltefrist(null, JETZT) === null && haltefrist(JETZT + TAG, JETZT) === null, 'unbekannt oder in der Zukunft')

ok(Math.abs(reichweite(4.2e9, -19.6e9).monate - 2.5714) < 0.001, 'CoreWeave-Grössenordnung: gut zweieinhalb Monate')
ok(reichweite(1e6, -1.2e6).monate === 10, 'eine Million bei 100 000 Abfluss im Monat: 10 Monate')
ok(reichweite(1e6, 5e5).positiv === true && reichweite(1e6, 0).positiv === true, 'kein Abfluss')
ok(reichweite(null, -1) === null && reichweite(1e6, null) === null && reichweite(1e6, NaN) === null, 'fehlt eine Zahl: unbekannt')
ok(reichweite(0, -1e6).monate === 0, 'leere Kasse: null Monate')

const b = insiderBilanz([
    { zeit: JETZT - 5 * TAG, art: 'verkauf', stueck: 100, wert: 5000 },
    { zeit: JETZT - 50 * TAG, art: 'verkauf', stueck: 200, wert: 9000 },
    { zeit: JETZT - 20 * TAG, art: 'zuteilung', stueck: 999, wert: 0 },
    { zeit: JETZT - 300 * TAG, art: 'kauf', stueck: 50, wert: 100 },
    { zeit: JETZT - 10 * TAG, art: 'sonstig', stueck: 7 },
], JETZT)
ok(b.verkaeufe.anzahl === 2 && b.verkaeufe.stueck === 300 && b.verkaeufe.wert === 14000, 'Verkäufe der letzten sechs Monate')
ok(b.kaeufe.anzahl === 0 && b.bild === 'verkauf', 'Zuteilung ist kein Kauf; alter Kauf zählt nicht')
ok(insiderBilanz([{ zeit: JETZT - TAG, art: 'kauf', stueck: 1 }], JETZT).bild === 'kauf', 'nur Käufe')
ok(insiderBilanz([{ zeit: JETZT - TAG, art: 'kauf' }, { zeit: JETZT - TAG, art: 'verkauf' }], JETZT).bild === 'gemischt', 'beides')
ok(insiderBilanz([], JETZT).bild === 'keine' && insiderBilanz(undefined, JETZT).verkaeufe.anzahl === 0, 'nichts gemeldet')

ok(Math.abs(shortVeraenderung(74211562, 59952639) - 23.78) < 0.01, 'Leerverkäufe gegen Vormonat')
ok(shortVeraenderung(5, 0) === null && shortVeraenderung(null, 5) === null, 'ohne Vormonat unbekannt')

console.log(`✓ Newcomer-Karte: ${n} Prüfungen`)
