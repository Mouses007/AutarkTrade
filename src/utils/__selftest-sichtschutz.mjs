/**
 * Selbsttest des Sichtschutzes (Audit SEC-WEB-007): welcher Text wird verwischt?
 *
 *   node src/utils/__selftest-sichtschutz.mjs
 *
 * Werte ohne Beschriftung wie bisher; neu auch Beschriftung MIT Geld- oder
 * Prozentwert („Gross: 12$"). Reine Beschriftungen bleiben lesbar.
 */

import { istZensurText } from './privacy.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const verwischt = ['$ 573.62', '-57.9%', '215', "$ 16'610", '1:1.2', 'Gross: 12$', 'Net: -3$', "Net 1'200 USDT",
    'Win rate 57.9 %', 'Kontostand 1000 CHF', '€ 12,50 Gebühr']
const lesbar = ['Kontostand', 'P/L Ratio', 'Letzte 30 Tage', 'BTCUSDT', 'Top 10', 'USDT-M', '', '   ',
    'Ein sehr langer Satz mit 12 $ darin, der deutlich länger ist als sechzig Zeichen insgesamt']

for (const t of verwischt) check(`verwischt: ${JSON.stringify(t)}`, istZensurText(t) === true)
for (const t of lesbar) check(`lesbar: ${JSON.stringify(t)}`, istZensurText(t) === false)
check('null/undefined lesbar', istZensurText(null) === false && istZensurText(undefined) === false)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
