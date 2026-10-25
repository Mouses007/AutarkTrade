/** Selbsttest: Break-even zählt in der Auswertung wie auf dem Dashboard als Gewinn (Audit FIN-07). */
import { istGewinner } from '../components/auswertung/rechnung.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

pruefe(istGewinner({ netWins: 0, netWinsCount: 1, netSharePL: 0 }, 'net') === true, 'Break-even (0) ist ein Gewinner, wie auf dem Dashboard')
pruefe(istGewinner({ netWins: 12, netWinsCount: 1, netSharePL: 12 }, 'net') === true, 'Gewinn ist ein Gewinner')
pruefe(istGewinner({ netWins: 0, netWinsCount: 0, netSharePL: -5 }, 'net') === false, 'Gegenprobe: Verlust ist kein Gewinner')
pruefe(istGewinner({ grossSharePL: 0 }, 'gross') === true && istGewinner({ grossSharePL: -1 }, 'gross') === false, 'ältere Zeile ohne Zähler: entscheidet am Ergebnis')

console.log(`auswertung-gewinner: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
