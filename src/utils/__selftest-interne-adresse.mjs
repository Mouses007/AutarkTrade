/**
 * Selbsttest: bleiben KI-Bilder und Rücksprung-Ziele in der eigenen App?
 *
 *   node src/utils/__selftest-interne-adresse.mjs
 *
 * Audit SEC-WEB-001 (KI-Bilder) und SEC-WEB-003 (`?rueckkehr=`). Jede Angriffs-
 * zeile hier wurde gegen `new URL()` geprüft: sie landet ohne die Prüfung auf
 * einem fremden Server.
 */

import { istEigenesBild, internerPfad } from './interneAdresse.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const O = 'https://nas.local'

// Beleg, dass die Angriffe ohne Prüfung tatsächlich hinausführen
check('Beleg: /\\evil.com löst nach aussen auf', new URL('/\\evil.com/a?d=1', O).origin === 'https://evil.com')
check('Beleg: /<TAB>/evil.com löst nach aussen auf', new URL('/\t/evil.com/a', O).origin === 'https://evil.com')

console.log('istEigenesBild')
check('eigener Pfad', istEigenesBild('/bilder/logo.png', O))
check('eigener Pfad mit Query', istEigenesBild('/bilder/a.png?v=2', O))
check('Protokoll-relativ //evil.com', !istEigenesBild('//evil.com/x', O))
check('Backslash /\\evil.com', !istEigenesBild('/\\evil.com/x', O))
check('Backslash später im Pfad', !istEigenesBild('/a\\..\\..\\x', O))
check('Tab /<TAB>/evil.com', !istEigenesBild('/\t/evil.com/x', O))
check('Zeilenumbruch /<LF>/evil.com', !istEigenesBild('/\n/evil.com/x', O))
check('Leerzeichen vorne', !istEigenesBild(' /bilder/a.png', O))
check('absolute fremde URL', !istEigenesBild('https://evil.com/x.png', O))
check('absolute eigene URL (kein schlichter Pfad)', !istEigenesBild('https://nas.local/x.png', O))
check('javascript:', !istEigenesBild('javascript:alert(1)', O))
check('data:', !istEigenesBild('data:image/png;base64,AAAA', O))
check('relativ ohne /', !istEigenesBild('bild.png', O))
check('leer', !istEigenesBild('', O))
check('null', !istEigenesBild(null, O))
check('/api/ ausgeschlossen', !istEigenesBild('/api/trades?x=1', O))
check('/api ohne Schrägstrich ausgeschlossen', !istEigenesBild('/api', O))
check('/%61pi/ (kodiert) ausgeschlossen', !istEigenesBild('/%61pi/trades', O))
check('/apix/ ist kein API-Pfad', istEigenesBild('/apix/a.png', O))

console.log('internerPfad')
check('/einstellungen', internerPfad('/einstellungen', O) === '/einstellungen')
check('mit Query und Hash', internerPfad('/journal?x=1#a', O) === '/journal?x=1#a')
check('Vorgabe-Origin ohne Angabe', internerPfad('/journal') === '/journal')
check('fremde URL', internerPfad('https://evil.example/login', O) === null)
check('//evil.example', internerPfad('//evil.example/login', O) === null)
check('/\\evil.example', internerPfad('/\\evil.example/login', O) === null)
check('\\\\evil.example', internerPfad('\\\\evil.example', O) === null)
check('/<TAB>/evil.example', internerPfad('/\t/evil.example', O) === null)
check('javascript:', internerPfad('javascript:alert(1)', O) === null)
check('relativ ohne /', internerPfad('journal', O) === null)
check('leer', internerPfad('', O) === null)
check('undefined', internerPfad(undefined, O) === null)
check('Array aus der Query: erster Wert', internerPfad(['/journal', 'https://evil'], O) === '/journal')
check('Array mit fremdem ersten Wert', internerPfad(['https://evil', '/journal'], O) === null)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
