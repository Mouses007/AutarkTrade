/**
 * Selbsttest: Zuordnungen für das automatische Chartbild (tradeBild.js).
 *
 *   node src/utils/__selftest-trade-bild.mjs
 *
 * Ausschnitt (tradeBildAusschnitt.js): Anlass SOLUSDT 1h am 28.10.2026 — 160 Kerzen
 * (knapp sieben Tage) und eine Preisachse von 97 bis 114 für einen Trade zwischen
 * 99,4 und 102,1.
 *
 * Die Bewertung kennt andere Zeiteinheiten als der Chart (1D, 1W, 2m, 45m …),
 * und die Strategie kommt aus einem freien Tag — beides muss stimmen, sonst
 * zeigt das Bild eine andere Zeiteinheit oder keine Setups.
 */
import { chartZeiteinheit, strategieAusTags } from './chart/tradeBild.js'
import { zeitAusschnitt, preisAusschnitt, VORLAUF, RECHTS, NACHLAUF_MAX } from './chart/tradeBildAusschnitt.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nZeiteinheit\n')
check('1D → 1d, 1W → 1w', chartZeiteinheit('1D') === '1d' && chartZeiteinheit('1W') === '1w')
check('4h, 15m bleiben', chartZeiteinheit('4h') === '4h' && chartZeiteinheit('15m') === '15m')
check('Zwischenstufen auf die nächste Chart-Zeiteinheit (2m→3m, 45m→1h, 3h→4h)', chartZeiteinheit('2m') === '3m' && chartZeiteinheit('45m') === '1h' && chartZeiteinheit('3h') === '4h')
check('unbekannt / leer → null', chartZeiteinheit('12M') === null && chartZeiteinheit('') === null)

console.log('\nStrategie aus Tags\n')
check('Tag „LSOB" → lsob', strategieAusTags([{ name: 'LSOB' }]) === 'lsob')
check('Tag „LSOB Long 4h" → lsob (enthält)', strategieAusTags([{ name: 'LSOB Long 4h' }]) === 'lsob')
check('Tag „GUSS" → ema_touch', strategieAusTags([{ name: 'Guss' }]) === 'ema_touch')
check('Tag „EMA Touch" → ema_touch', strategieAusTags([{ name: 'EMA Touch' }]) === 'ema_touch')
check('kein Strategie-Tag → null', strategieAusTags([{ name: 'FOMO' }, { name: 'Breakout' }]) === null && strategieAusTags(null) === null)

const H = 3600_000
const zeiten = Array.from({ length: 1000 }, (_, i) => Date.UTC(2026, 9, 1) + i * H)

console.log('\nZeitfenster\n')
{
    const einstiegT = zeiten[980] + 20 * 60_000     // mitten in Kerze 980
    const a = zeitAusschnitt({ zeiten, interval: '1h', einstiegT })
    check('Einstieg auf die Kerze, in der er liegt', a.iE === 980, String(a.iE))
    check('1h: 48 Kerzen Vorlauf (2 Tage), nicht 160', a.von === 980 - VORLAUF['1h'] && VORLAUF['1h'] === 48, String(a.von))
    check('rechts Platz für Box und Schilder', a.bis === 999 + RECHTS)
    const m5 = zeitAusschnitt({ zeiten, interval: '5m', einstiegT })
    const d1 = zeitAusschnitt({ zeiten, interval: '1d', einstiegT })
    check('kleinere Zeiteinheit → mehr Kerzen Vorlauf', (m5.iE - m5.von) > (a.iE - a.von) && (d1.iE - d1.von) > (a.iE - a.von))
    const unbekannt = zeitAusschnitt({ zeiten, interval: '7h', einstiegT })
    check('unbekannte Zeiteinheit: Vorgabe 60', unbekannt.iE - unbekannt.von === 60)
    const alt = zeitAusschnitt({ zeiten, interval: '1h', einstiegT: zeiten[500] })
    check('lange offener Trade: höchstens 120 Kerzen nach dem Einstieg', alt.bis === 500 + NACHLAUF_MAX + RECHTS, String(alt.bis))
    const frueh = zeitAusschnitt({ zeiten, interval: '1h', einstiegT: zeiten[10] })
    check('Einstieg am Datenanfang: nicht unter 0', frueh.von === 0)
    const vorher = zeitAusschnitt({ zeiten, interval: '1h', einstiegT: zeiten[0] - 5 * H })
    check('Einstieg vor den Daten: erste Kerze', vorher.iE === 0 && vorher.von === 0)
    const ohne = zeitAusschnitt({ zeiten, interval: '1h' })
    check('ohne Einstiegszeit: an der letzten Kerze', ohne.iE === 999 && ohne.von === 999 - 48)
}

console.log('\nPreisachse\n')
{
    // Kerzen zwischen 99 und 103, weit darüber nichts
    const kerzen = zeiten.map((_, i) => ({ h: 102 + (i % 3) * 0.5, l: 99 + (i % 2) * 0.3 }))
    const b = preisAusschnitt({ kerzen, von: 950, bis: 1030, marken: [102.11, 101.6, 99.4] })
    check('nur Kerzen und Marken bestimmen die Achse', b && b.from > 98.5 && b.to < 104.5, JSON.stringify(b))
    check('Ziel unter den Kerzen liegt im Bild', preisAusschnitt({ kerzen, von: 950, bis: 1030, marken: [97] }).from < 97)
    check('Rand 8 % oben und unten', Math.abs(b.to - 103 - (103 - 99) * 0.08) < 1e-9 && Math.abs(99 - (103 - 99) * 0.08 - b.from) < 1e-9, JSON.stringify(b))
    check('fehlende Marken (null/0) stören nicht', JSON.stringify(preisAusschnitt({ kerzen, von: 950, bis: 1030, marken: [null, 0, NaN] }))
        === JSON.stringify(preisAusschnitt({ kerzen, von: 950, bis: 1030 })))
    check('bis jenseits der Daten (rechter Rand) wird abgeschnitten', preisAusschnitt({ kerzen, von: 990, bis: 2000 }) !== null)
    check('keine Kerzen → null (Achse bleibt automatisch)', preisAusschnitt({ kerzen: [], von: 0, bis: 10 }) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
