/**
 * Selbsttest: Volumenprofil über einen festen Bereich.
 *
 *   node shared/__selftest-volumenprofil.mjs
 */
import { volumenprofil } from './volumenprofil.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const k = (o, h, l, c, v) => ({ o, h, l, c, v })

console.log('\nVolumenprofil\n')
{
    // Spanne 100–110, 10 Zeilen à 1. Viel Volumen in Kerzen um 104–105.
    const kerzen = [k(100, 110, 100, 101, 10), k(104, 105, 104, 105, 50), k(105, 105, 104, 104, 30)]
    const vp = volumenprofil(kerzen, { zeilen: 10 })
    check('Spanne = tiefstes Tief bis höchstes Hoch', vp.unten === 100 && vp.oben === 110)
    check('POC in der Zeile 104–105', vp.pocIndex === 4 && Math.abs(vp.poc - 104.5) < 1e-9, JSON.stringify(vp.zeilen[4]))
    check('Summe = Volumen aller Kerzen', Math.abs(vp.summe - 90) < 1e-9, String(vp.summe))
    check('Kauf und Verkauf nach Kerzenfarbe getrennt', Math.abs(vp.zeilen[4].auf - 51) < 1e-9 && Math.abs(vp.zeilen[4].ab - 30) < 1e-9, JSON.stringify(vp.zeilen[4]))
    check('Value Area enthält den POC und ≥ 70 %', vp.vaVon <= 4 && vp.vaBis >= 4 && vp.zeilen.slice(vp.vaVon, vp.vaBis + 1).reduce((s, r) => s + r.summe, 0) >= 0.7 * 90)
    check('VAL/VAH sind die Ränder der Value Area', vp.val === vp.zeilen[vp.vaVon].von && vp.vah === vp.zeilen[vp.vaBis].bis)
}
{
    const breit = volumenprofil([k(100, 110, 100, 105, 100)], { zeilen: 10 })
    check('gleichmässig verteilt: jede Zeile 10', breit.zeilen.every((r) => Math.abs(r.summe - 10) < 1e-9))
    check('Kerze ohne Spanne landet ganz in einer Zeile', volumenprofil([k(100, 110, 100, 101, 1), k(105.5, 105.5, 105.5, 105.5, 9)], { zeilen: 10 }).zeilen[5].summe > 9)
    check('ohne Volumen → null statt Nullprofil', volumenprofil([k(1, 2, 1, 2, 0)]) === null)
    check('leere Eingabe → null', volumenprofil([]) === null && volumenprofil(null) === null)
}

{
    // Zeilen nach Preis je Zeile (TradingView „Ticks pro Zeile"): Spanne 100–110, je Zeile 0,5 → 20 Zeilen
    const vp = volumenprofil([k(100, 110, 100, 105, 100)], { schritt: 0.5 })
    check('Preis je Zeile: Zeilenzahl folgt der Spanne', vp.zeilen.length === 20 && Math.abs(vp.schritt - 0.5) < 1e-9, String(vp.zeilen.length))
    const fein = volumenprofil([k(100, 110, 100, 105, 100)], { schritt: 0.001 })
    check('Preis je Zeile: höchstens 1000 Zeilen, dann breiter', fein.zeilen.length === 1000)
    check('150 Zeilen gehen (VRVP-Vorgabe)', volumenprofil([k(100, 110, 100, 105, 100)], { zeilen: 150 }).zeilen.length === 150)
    const voll = volumenprofil([k(100, 110, 100, 101, 10), k(104, 105, 104, 105, 50)], { zeilen: 10, va: 1 })
    check('Value Area 100 % umfasst alle Zeilen mit Volumen', voll.vaVon === 0 && voll.vaBis === 9)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
