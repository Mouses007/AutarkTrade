/** Selbsttest der Spenden-Nachfragen (server/spenden.js, nur der reine Teil). */
import { faelligeFrage } from './spenden.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }

pruefe(faelligeFrage({ stufe: 0, bewertet: 49 }) === null, '49 bewertete Trades: noch keine Frage')
pruefe(faelligeFrage({ stufe: 0, bewertet: 50 }) === 1, 'ab 50: erste Frage')
pruefe(faelligeFrage({ stufe: 1, bei: 50, bewertet: 199 }) === null, 'nach der ersten: bei 199 nichts')
pruefe(faelligeFrage({ stufe: 1, bei: 50, bewertet: 200 }) === 2, 'ab 200: zweite Frage')
pruefe(faelligeFrage({ stufe: 2, bei: 200, bewertet: 5000 }) === null, 'nach der zweiten: nie wieder')
pruefe(faelligeFrage({ stufe: 1, bei: 260, bewertet: 300 }) === null, 'erste erst bei 260 gezeigt: bei 300 noch nicht die zweite')
pruefe(faelligeFrage({ stufe: 1, bei: 260, bewertet: 410 }) === 2, '… sondern 150 Bewertungen später')
pruefe(faelligeFrage({ stufe: 1, bei: 158, bewertet: 200 }) === 2, 'erste bei 158 gezeigt: zweite trotzdem bei 200')
pruefe(faelligeFrage({ an: false, stufe: 0, bewertet: 500 }) === null, 'Schalter aus: keine Frage')

console.log(`spenden: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
