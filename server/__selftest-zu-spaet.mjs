/**
 * Selbsttest: die Engine handelt nur Auslöser auf der jüngsten geschlossenen Kerze.
 *
 *   node server/__selftest-zu-spaet.mjs
 *
 * Bis 01.11.2026 buchte der Papierbetrieb jeden Auslöser, auch einen auf einer
 * Kerze, die beim Erkennen schon Stunden vorbei war — beim ersten Scan nach
 * dem Anlegen einer Instanz, nach einem Neustart oder bei einem Detektor, der
 * spät erkennt. Instanz #15 (Momentum Swing) bestand so in den ersten Tagen
 * nur aus Trades, deren Einstieg vor ihrer Anlage lag. `ausloeserAlter` ist
 * die Regel, `fuehreAus` lehnt mit `zu_spaet_erkannt` ab, sobald sie > 0 ist.
 * Die Gegenstücke im Backtest prüft `strategies/__selftest-lookahead.mjs`.
 */
import { ausloeserAlter } from './strategy-engine.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nEngine: Auslöser zu spät erkannt')

const H = 3600000
const T = Date.UTC(2026, 9, 29, 12)
const kerzen = [0, 1, 2, 3].map((i) => ({ t: T + i * H }))
const neueste = kerzen[3].t

pruefe('Auslöser auf der jüngsten Kerze → 0 (handelbar)', ausloeserAlter({ candleTime: neueste }, kerzen, H) === 0)
pruefe('eine Kerze alt → 1', ausloeserAlter({ candleTime: kerzen[2].t }, kerzen, H) === 1)
pruefe('drei Kerzen alt → 3', ausloeserAlter({ candleTime: kerzen[0].t }, kerzen, H) === 3)
pruefe('ohne candleTime zählt triggeredAt', ausloeserAlter({ triggeredAt: kerzen[1].t }, kerzen, H) === 2)
pruefe('ohne Zeitangabe → 0 (wie bisher gemeldet)', ausloeserAlter({}, kerzen, H) === 0)
pruefe('Bruchteil einer Kerze zählt als 1, nicht als 0',
    ausloeserAlter({ candleTime: neueste - 1000 }, kerzen, H) === 1)
// Gegenprobe zum Fall #15: Einstieg am 28.10. 20:00, erkannt beim ersten Scan am 29.10. ~12:00 (4h)
{
    const vierH = 4 * H
    const scan = [0, 1, 2, 3, 4].map((i) => ({ t: Date.UTC(2026, 9, 28, 20) + i * vierH }))
    pruefe('Fall #15: 4 Kerzen alter 4h-Auslöser wird abgelehnt',
        ausloeserAlter({ candleTime: scan[0].t }, scan, vierH) === 4)
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
