// Selbsttest: Seitenmenü per Wischen (src/utils/menueWisch.js)
import { wischErgebnis } from './menueWisch.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`) }
}

check('Vom Rand nach rechts öffnet', wischErgebnis({ x: 8, y: 300 }, { x: 90, y: 310 }, false) === 'oeffnen')
check('Mitten im Inhalt nach rechts öffnet nicht (Tabellen, Charts)', wischErgebnis({ x: 120, y: 300 }, { x: 250, y: 300 }, false) === null)
check('Zu kurzer Weg öffnet nicht', wischErgebnis({ x: 8, y: 300 }, { x: 40, y: 300 }, false) === null)
check('Senkrechtes Scrollen am Rand öffnet nicht', wischErgebnis({ x: 8, y: 300 }, { x: 70, y: 420 }, false) === null)
check('Offen: nach links wischen schliesst, egal wo', wischErgebnis({ x: 200, y: 300 }, { x: 100, y: 320 }, true) === 'schliessen')
check('Offen: nach rechts wischen tut nichts', wischErgebnis({ x: 8, y: 300 }, { x: 120, y: 300 }, true) === null)
check('Zu: nach links wischen tut nichts', wischErgebnis({ x: 200, y: 300 }, { x: 50, y: 300 }, false) === null)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
