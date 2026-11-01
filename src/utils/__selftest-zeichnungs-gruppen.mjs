/**
 * Selbsttest Gruppen von Zeichnungen (src/utils/chart/zeichnungsGruppen.js).
 *   node src/utils/__selftest-zeichnungs-gruppen.mjs
 */
import { gruppiereZeichnungen, gruppenName } from './chart/zeichnungsGruppen.js'
import { pruefeZeichnung } from '../../server/chart-api.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const z = [
    { id: 1, gruppe: 'Volumen Daily', erstelltAm: 1, versteckt: true },
    { id: 2, gruppe: 'Volumen Daily', erstelltAm: 3, versteckt: true, gesperrt: true },
    { id: 3, gruppe: null, erstelltAm: 2 },
    { id: 4, gruppe: 'abc', erstelltAm: 5 },
    { id: 5, erstelltAm: 9 },
]
const g = gruppiereZeichnungen(z)
check('Gruppen nach Name (gross/klein egal), ungruppierte extra', g.gruppen.map((x) => x.name).join() === 'abc,Volumen Daily' && g.ohne.map((x) => x.id).join() === '5,3')
check('in der Gruppe neueste zuerst', g.gruppen[1].zeichnungen.map((x) => x.id).join() === '2,1')
check('alleVersteckt / alleGesperrt', g.gruppen[1].alleVersteckt && !g.gruppen[1].alleGesperrt && !g.gruppen[0].alleVersteckt)
check('Name säubern, leer → null', gruppenName('  Volumen   Daily ') === 'Volumen Daily' && gruppenName('  ') === null && gruppenName('x'.repeat(90)).length === 80)
check('Server übernimmt die Gruppe gesäubert, leer = keine', pruefeZeichnung({ gruppe: ' A  B ' }, { teilweise: true }).daten.gruppe === 'A B'
    && pruefeZeichnung({ gruppe: '' }, { teilweise: true }).daten.gruppe === null)
check('ohne Angabe bleibt die Gruppe unangetastet', !('gruppe' in pruefeZeichnung({ versteckt: true }, { teilweise: true }).daten))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
