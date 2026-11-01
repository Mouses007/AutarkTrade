/**
 * Selbsttest: welche Felder öffnen den Kalender per Klick (src/utils/datumsfeld.js).
 *
 * Aufruf: node src/utils/__selftest-datumsfeld.mjs
 */
import { oeffnetKalender } from './datumsfeld.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung) => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}`)
}
const feld = (type, extra = {}) => ({ tagName: 'INPUT', type, disabled: false, readOnly: false, ...extra })

pruefe('Datum öffnet', oeffnetKalender(feld('date')))
pruefe('Monat öffnet', oeffnetKalender(feld('month')))
pruefe('Datum mit Zeit öffnet', oeffnetKalender(feld('datetime-local')))
pruefe('Textfeld nicht', !oeffnetKalender(feld('text')))
pruefe('Zahlenfeld nicht', !oeffnetKalender(feld('number')))
pruefe('gesperrtes Datumsfeld nicht', !oeffnetKalender(feld('date', { disabled: true })))
pruefe('schreibgeschütztes Datumsfeld nicht', !oeffnetKalender(feld('date', { readOnly: true })))
pruefe('anderes Element nicht', !oeffnetKalender({ tagName: 'DIV', type: 'date' }))
pruefe('nichts nicht', !oeffnetKalender(null))

console.log(`datumsfeld: ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
