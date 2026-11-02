/**
 * Selbsttest des Kursverlaufs für die ESP32-Displays (`esp32-kurs.js`).
 *
 *   node server/__selftest-esp32-kurs.mjs
 *
 * Wichtig ist vor allem die Verdichtung: die neueste Kerze muss die letzte
 * bleiben (sonst stimmt der angezeigte Kurs nicht), und Hoch/Tief dürfen
 * beim Zusammenfassen nicht verloren gehen.
 */
import { KURS_SPANNEN, kursSymbol, kursSpanne, kursN, verdichte, kursAntwort } from './esp32-kurs.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nSymbol, Spanne, Anzahl\n')
check('btc → BTCUSDT', kursSymbol('btc') === 'BTCUSDT')
check('SOLUSDT bleibt', kursSymbol('SOLUSDT') === 'SOLUSDT')
check('USDC bleibt', kursSymbol('ethusdc') === 'ETHUSDC')
check('Sonderzeichen weg', kursSymbol('sol/usdt') === 'SOLUSDT')
check('leer → null', kursSymbol('') === null && kursSymbol('?') === null)
check('unbekannte Spanne → 24h', kursSpanne('5y') === '24h' && kursSpanne('__proto__') === '24h')
check('bekannte Spanne bleibt', kursSpanne('7d') === '7d')
check('n ohne Angabe = volle Anzahl', kursN(undefined, 96) === 96)
check('n nach unten begrenzt', kursN('2', 96) === 10)
check('n nicht über die Kerzenzahl', kursN('500', 96) === 96)
check('jede Spanne hat Kerzenlänge und Anzahl', Object.values(KURS_SPANNEN).every(s => s.interval && s.limit > 0))

console.log('\nVerdichten\n')
const kerzen = Array.from({ length: 96 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i }))
kerzen[40].h = 500   // Ausreisser nach oben
kerzen[70].l = 1     // Ausreisser nach unten
const v = verdichte(kerzen, 30)
check('30 Fächer', v.length === 30, String(v.length))
check('erstes o = erste Kerze', v[0].o === kerzen[0].o)
check('letztes c = neueste Kerze', v[29].c === kerzen[95].c)
check('Hoch bleibt erhalten', Math.max(...v.map(k => k.h)) === 500)
check('Tief bleibt erhalten', Math.min(...v.map(k => k.l)) === 1)
check('weniger Kerzen als n: unverändert', verdichte(kerzen.slice(0, 5), 30).length === 5)

console.log('\nAntwort\n')
const a = kursAntwort('BTCUSDT', '24h', kerzen, 48)
check('Kerzen als [o,h,l,c]', a.kerzen.length === 48 && a.kerzen[0].length === 4)
check('jetzt = letzter Schluss', a.jetzt === kerzen[95].c)
check('Änderung in % mit 2 Stellen', a.aenderung === Math.round((kerzen[95].c - 100) / 100 * 10000) / 100, String(a.aenderung))
check('hoch/tief über alles', a.hoch === 500 && a.tief === 1)
check('zu wenig Kerzen → null', kursAntwort('BTCUSDT', '24h', kerzen.slice(0, 1), 48) === null)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:', fehler.join(' | ')); process.exit(1) }
