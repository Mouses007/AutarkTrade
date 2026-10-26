/**
 * Selbsttest der Zahl-Lese-Hilfe für Textfelder (Audit FUN-LIV-001).
 *
 *   node src/utils/__selftest-zahl-eingabe.mjs
 *
 * Festgehalten wird vor allem: leer ist `null`, Unsinn ist `NaN` — und NIE 0.
 * Genau das war der Fehler: `Number('') || 0` machte aus „150,5" bei englischer
 * Browsersprache still eine Verlustgrenze von 0.
 */

import { zahlAus, pruefeZahl } from './zahlEingabe.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const gleich = (name, ist, soll) => check(name, Object.is(ist, soll), `ist ${ist}, soll ${soll}`)

console.log('zahlAus')
gleich('Punkt', zahlAus('150.5'), 150.5)
gleich('Komma', zahlAus('150,5'), 150.5)
gleich('Komma ohne Vorstelle', zahlAus(',5'), 0.5)
gleich('Tausender-Apostroph', zahlAus("1'000"), 1000)
gleich('Tausender-Apostroph typografisch', zahlAus('1’000,25'), 1000.25)
gleich('Leerzeichen innen und aussen', zahlAus(' 1 000 '), 1000)
gleich('negativ', zahlAus('-12,5'), -12.5)
gleich('Zahl statt Text', zahlAus(42), 42)
gleich('leer → null', zahlAus(''), null)
gleich('nur Leerzeichen → null', zahlAus('   '), null)
gleich('undefined → null', zahlAus(undefined), null)
gleich('null → null', zahlAus(null), null)
check('Buchstaben → NaN', Number.isNaN(zahlAus('abc')))
check('zwei Trenner → NaN', Number.isNaN(zahlAus('1,000.5')))
check('Exponent → NaN', Number.isNaN(zahlAus('1e3')))
check('Hex → NaN', Number.isNaN(zahlAus('0x10')))
check('Infinity → NaN', Number.isNaN(zahlAus('Infinity')))
check('nur Minus → NaN', Number.isNaN(zahlAus('-')))
check('Einheit dahinter → NaN', Number.isNaN(zahlAus('200$')))

console.log('pruefeZahl')
check('leer erlaubt', pruefeZahl('').ok && pruefeZahl('').wert === null)
check('leer verboten', !pruefeZahl('', { leerErlaubt: false }).ok)
check('unter min', !pruefeZahl('-1', { min: 0 }).ok)
check('0 bei min 0', pruefeZahl('0', { min: 0 }).ok)
check('ganz verlangt, 2,5', !pruefeZahl('2,5', { ganz: true }).ok)
check('ganz verlangt, 3', pruefeZahl('3', { ganz: true }).ok)
check('Unsinn nie ok', !pruefeZahl('x').ok)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
