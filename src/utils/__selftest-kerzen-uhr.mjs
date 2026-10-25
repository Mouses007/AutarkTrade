/**
 * Selbsttest der Kerzen-Uhr (`utils/chart/overlays/KerzenUhr.js`).
 *
 *   node src/utils/__selftest-kerzen-uhr.mjs
 */
import { kerzenEnde, laufendesEnde, restzeitText } from './chart/overlays/KerzenUhr.js'
import { INTERVALL_MS } from './chart/kerzenQuelle.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const T = Date.UTC(2026, 9, 25, 12, 0)
check('15m endet nach 15 min', kerzenEnde(T, INTERVALL_MS['15m'], '15m') === T + 15 * 60_000)
check('Monat: Februar endet am 1. März', kerzenEnde(Date.UTC(2026, 1, 1), INTERVALL_MS['1M'], '1M') === Date.UTC(2026, 2, 1))
check('Monat: Dezember endet am 1. Januar', kerzenEnde(Date.UTC(2026, 11, 1), INTERVALL_MS['1M'], '1M') === Date.UTC(2027, 0, 1))
const montag = Date.UTC(2026, 9, 19)
check('Woche ab Montag endet am nächsten Montag', kerzenEnde(montag, INTERVALL_MS['1w'], '1w') === Date.UTC(2026, 9, 26))

check('laufende Kerze: ihr eigenes Ende', laufendesEnde(T, INTERVALL_MS['1h'], '1h', T + 10 * 60_000) === T + 3_600_000)
check('letzte Kerze schon zu (Bitunix): Ende der nächsten', laufendesEnde(T, INTERVALL_MS['1h'], '1h', T + 70 * 60_000) === T + 2 * 3_600_000)
check('genau auf der Grenze: die neue Kerze zählt', laufendesEnde(T, INTERVALL_MS['1h'], '1h', T + 3_600_000) === T + 2 * 3_600_000)
check('Monat übersprungen', laufendesEnde(Date.UTC(2026, 0, 1), INTERVALL_MS['1M'], '1M', Date.UTC(2026, 1, 10)) === Date.UTC(2026, 2, 1))

check('Sekunden', restzeitText(42_400) === '00:42', restzeitText(42_400))
check('Minuten', restzeitText(4 * 60_000 + 59_999) === '04:59', restzeitText(4 * 60_000 + 59_999))
check('Stunden', restzeitText(3_600_000 + 4 * 60_000 + 59_000) === '1:04:59')
check('Tage', restzeitText(3 * 86_400_000 + 4 * 3_600_000 + 59 * 60_000) === '3T 04:59')
check('nie negativ', restzeitText(-5000) === '00:00')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
