// Selbsttest: VRVP — Volumenprofil des sichtbaren Bereichs (src/utils/chart/vrvp.js)
import { sichtbareKerzen, vrvpProfil } from './chart/vrvp.js'
import { INDIKATOREN, vorgaben } from './chart/indikatorRegister.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`) }
}
const k = (o, h, l, c, v) => ({ o, h, l, c, v })

const p = vorgaben('vrvp')
check('Vorgaben wie die TradingView-Vorlage: 150 Zeilen, Gesamt, Value Area 100 %',
    INDIKATOREN.vrvp && p.zeilenLayout === 'anzahl' && p.zeilen === 150 && p.volumen === 'gesamt' && p.va === 100, JSON.stringify(p))

check('Sichtbar: halbe Kerzen am Rand zählen, rechts über die Daten = letzte Kerze', JSON.stringify(sichtbareKerzen(100, 39.6, 130)) === '{"a":40,"b":99}')
check('Nichts sichtbar → null', sichtbareKerzen(100, 120, 140) === null && sichtbareKerzen(0, 0, 10) === null)

// Erste Hälfte 100–110 mit viel Volumen, zweite Hälfte 200–210: das Profil hängt am Bereich
const kerzen = [...Array.from({ length: 10 }, () => k(100, 110, 100, 108, 100)), ...Array.from({ length: 10 }, () => k(210, 210, 200, 201, 10))]
const links = vrvpProfil(kerzen, { a: 0, b: 9 }, p)
const rechts = vrvpProfil(kerzen, { a: 10, b: 19 }, p)
check('Profil nur aus den sichtbaren Kerzen', links.vp.unten === 100 && links.vp.oben === 110 && rechts.vp.unten === 200, `${links.vp.unten}/${rechts.vp.unten}`)
check('150 Zeilen, Value Area 100 % = alle Zeilen', links.balken.length === 150 && links.balken.every((b) => b.inVa))
check('Gesamt: ein Balken je Zeile, längster = 1', links.balken.every((b) => b.teile.length === 1 && b.teile[0].art === 'gesamt') && Math.abs(Math.max(...links.balken.map((b) => b.teile[0].anteil)) - 1) < 1e-9)

const gemischt = [k(100, 110, 100, 108, 60), k(108, 110, 100, 101, 40)]
const aufAb = vrvpProfil(gemischt, { a: 0, b: 1 }, { ...p, zeilen: 10, volumen: 'aufAb' })
check('Auf/Ab: Kauf und Verkauf je Zeile', aufAb.balken[0].teile.length === 2 && aufAb.balken[0].teile[0].art === 'auf' && aufAb.balken[0].teile[0].anteil > aufAb.balken[0].teile[1].anteil)
const delta = vrvpProfil(gemischt, { a: 0, b: 1 }, { ...p, zeilen: 10, volumen: 'delta' })
check('Delta: Überhang je Zeile, Seite nach dem grösseren', delta.balken[0].teile.length === 1 && delta.balken[0].teile[0].art === 'auf' && Math.abs(delta.balken[0].teile[0].anteil - 1) < 1e-9)
const va70 = vrvpProfil(kerzen, { a: 0, b: 19 }, { ...p, va: 70 })
check('Value Area 70 %: nicht mehr alle Zeilen', va70.balken.some((b) => !b.inVa) && va70.balken.some((b) => b.inVa))
const ticks = vrvpProfil(kerzen, { a: 0, b: 9 }, { ...p, zeilenLayout: 'ticks', zeilen: 10 }, 0.1)
check('Ticks pro Zeile: 10 Ticks à 0,1 auf 10 Preis-Spanne = 10 Zeilen', ticks.balken.length === 10, String(ticks.balken.length))
check('Ohne Volumen → null', vrvpProfil([k(1, 2, 1, 2, 0)], { a: 0, b: 0 }, p) === null)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
