/**
 * Volumen-Kerzen (src/utils/chart/volumenKerzen.js): Breite in Kerzenabständen wie
 * bei TradingView — ruhig ½, die grösste sichtbare 2, linear dazwischen; ohne
 * Volumen etwa normal breit. Nie 1-px-Striche für normale Kerzen (die Fassung
 * „linear bis 8 %" machte genau das).
 */
import { groesstesVolumen, volumenBreite, BREITE_MIN, BREITE_MAX, BREITE_OHNE } from './chart/volumenKerzen.js'

let ok = 0, fehler = 0
const pruefe = (name, bed) => { if (bed) ok++; else { fehler++; console.error('✗', name) } }
const nahe = (a, b) => Math.abs(a - b) < 1e-9
const k = (v) => ({ v })

const liste = [k(100), k(400), k(50), k(1000), k(undefined), k(200)]
pruefe('grösstes Volumen im Bereich', groesstesVolumen(liste, 0, 5) === 1000)
pruefe('Bereich zählt: ohne die Spitze', groesstesVolumen(liste, 0, 2) === 400)
pruefe('Bereich ausserhalb der Liste wird begrenzt', groesstesVolumen(liste, -5, 99) === 1000)
pruefe('grösstes Volumen = 2 Kerzenabstände', nahe(volumenBreite(1000, 1000), BREITE_MAX) && BREITE_MAX === 2)
pruefe('kein Umsatz = ½ Abstand, nie ein Strich', nahe(volumenBreite(0, 1000), BREITE_MIN) && BREITE_MIN === 0.5)
pruefe('normale Kerze (15 % der grössten) ≈ ¾ Abstand', nahe(volumenBreite(150, 1000), 0.725))
pruefe('linear dazwischen', nahe(volumenBreite(500, 1000), 1.25))
pruefe('ohne Volumen normal breit', volumenBreite(undefined, 1000) === BREITE_OHNE && volumenBreite(NaN, 1000) === BREITE_OHNE && volumenBreite(-1, 1000) === BREITE_OHNE)
pruefe('ohne Massstab normal breit', volumenBreite(5, 0) === BREITE_OHNE)
pruefe('mehr als das Maximum (Kerze am Rand): höchstens 2', volumenBreite(5000, 1000) === BREITE_MAX)
pruefe('leere Liste → 0', groesstesVolumen([], 0, 10) === 0)

console.log(`${ok} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
