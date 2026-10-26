/**
 * Selbsttest des Journal-CSV-Exports (Audit SEC-WEB-004).
 *
 *   node src/utils/__selftest-csv-export.mjs
 *
 * Festgehalten: Formeln werden entschärft, negative Zahlen bleiben Zahlen,
 * Anführungszeichen und Trenner im Text verschieben keine Spalten, und Felder
 * späterer Zeilen gehen nicht verloren.
 */

import { csvZelle, csvAusZeilen, CSV_BOM } from './journal/csv.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const gleich = (name, ist, soll) => check(name, ist === soll, `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`)

console.log('csvZelle')
gleich('Text gequotet', csvZelle('BTCUSDT'), '"BTCUSDT"')
gleich('Anführungszeichen verdoppelt', csvZelle('a"b'), '"a""b"')
gleich('Trenner im Text bleibt in der Zelle', csvZelle('a;b'), '"a;b"')
gleich('Zeilenumbruch im Text bleibt in der Zelle', csvZelle('a\nb'), '"a\nb"')
gleich('=Formel', csvZelle('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
gleich('+Formel', csvZelle('+1+A1'), '"\'+1+A1"')
gleich('-Formel', csvZelle('-1+A1'), '"\'-1+A1"')
gleich('@Formel', csvZelle('@SUM(A1)'), '"\'@SUM(A1)"')
gleich('Tab vorne', csvZelle('\t=1'), '"\'\t=1"')
gleich('CR vorne', csvZelle('\r=1'), '"\'\r=1"')
gleich('negative Zahl als Zahl', csvZelle(-12.5), '-12.5')
gleich('negative Zahl als Text bleibt ohne Apostroph', csvZelle('-12.5'), '"-12.5"')
gleich('positive Zahl mit + als Text bleibt', csvZelle('+3'), '"+3"')
gleich('Exponent als Text bleibt', csvZelle('-1e-7'), '"-1e-7"')
gleich('Minus mitten im Text harmlos', csvZelle('BTC-PERP'), '"BTC-PERP"')
gleich('Zahl roh', csvZelle(42), '42')
gleich('null leer', csvZelle(null), '')
gleich('undefined leer', csvZelle(undefined), '')
gleich('NaN leer', csvZelle(NaN), '')
gleich('Wahrheitswert', csvZelle(true), 'true')
gleich('Tags als Namen', csvZelle([{ id: 'a', name: 'FOMO' }, { id: 'b', name: 'A-Setup' }]), '"FOMO, A-Setup"')
gleich('Liste von Texten', csvZelle(['x', 'y']), '"x, y"')
gleich('Objekt als JSON', csvZelle({ a: 1 }), '"{""a"":1}"')
gleich('Formel in Tag-Namen', csvZelle([{ name: '=1+1' }]), '"\'=1+1"')

console.log('csvAusZeilen')
const text = csvAusZeilen([
    { symbol: 'BTCUSDT', netProceeds: -12.5 },
    { symbol: '=cmd|x', netProceeds: 3, bot: 'grid' },
])
const zeilen = text.split('\r\n')
gleich('Kopf = Vereinigung aller Schlüssel', zeilen[0], '"symbol";"netProceeds";"bot"')
gleich('erste Zeile, fehlendes Feld leer', zeilen[1], '"BTCUSDT";-12.5;')
gleich('zweite Zeile entschärft', zeilen[2], '"\'=cmd|x";3;"grid"')
gleich('CRLF, drei Zeilen', zeilen.length, 3)
gleich('leere Daten', csvAusZeilen([]), '')
gleich('kein Array', csvAusZeilen(null), '')
gleich('BOM', CSV_BOM, '﻿')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
