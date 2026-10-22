/** Selbsttest der Spenden-Nachfragen (server/spenden.js, nur der reine Teil). */
import { naechsteNachfrage, nachAntwort, SPERRE_MS } from './spenden.js'

let ok = 0, fehler = 0
const pruefe = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text) } else { fehler++; console.log('  ✗ ' + text) } }
const TAG = 24 * 60 * 60 * 1000
const J = Date.UTC(2026, 9, 22)
const f = (o) => naechsteNachfrage({ jetzt: J, seit: J - 5 * TAG, version: '4.0.0', letzteVersion: '4.0.0', ...o })

// Meilensteine
pruefe(f({ bewertet: 49 }) === null, '49 bewertet, junge Installation: nichts')
pruefe(f({ bewertet: 50 })?.art === 'meilenstein' && f({ bewertet: 50 }).wert === 50, 'ab 50: Meilenstein 50')
pruefe(f({ bewertet: 260, meilenstein: 0 })?.wert === 200, 'mehrere überschritten: nur der höchste (200), keine Serie')
pruefe(f({ bewertet: 260, meilenstein: 200 }) === null, 'Meilenstein 200 schon gefragt: nichts bis 500')
pruefe(f({ bewertet: 1500, meilenstein: 500 })?.wert === 1000, '1000 nach 500')
// Sperre
pruefe(f({ bewertet: 500, meilenstein: 200, letzte: J - 10 * TAG }) === null, 'Gegenprobe: weniger als 30 Tage seit der letzten Nachfrage → nichts')
pruefe(f({ bewertet: 500, meilenstein: 200, letzte: J - SPERRE_MS })?.wert === 500, 'nach 30 Tagen wieder möglich')
// Zeit
pruefe(f({ seit: J - 31 * TAG })?.art === 'zeit', '30 Tage nach der ersten Nutzung: Zeit-Nachfrage')
pruefe(f({ seit: J - 100 * TAG, letzte: J - 40 * TAG }) === null, 'Zeit: erst 90 Tage nach der letzten Nachfrage wieder')
pruefe(f({ seit: J - 200 * TAG, letzte: J - 91 * TAG })?.art === 'zeit', '… und dann wieder')
// Update
pruefe(f({ version: '4.1.0', letzteVersion: '4.0.0' })?.art === 'update', 'neue Fassung: Update-Hinweis')
pruefe(f({ version: '4.1.0', letzteVersion: '4.0.0', bewertet: 60 })?.art === 'update', 'Update vor Meilenstein')
pruefe(f({ version: '4.1.0', letzteVersion: '' }) === null, 'Gegenprobe: erste Fassung ist kein Update')
// Antworten
pruefe(f({ status: 'nein', bewertet: 1000, seit: J - 999 * TAG, version: '9' }) === null, '„definitiv nicht": nie wieder')
pruefe(f({ status: 'gespendet', bewertet: 1000, dank: J - 100 * TAG }) === null, 'gespendet: kein Meilenstein, kein Update')
pruefe(f({ status: 'gespendet', dank: J - 366 * TAG })?.art === 'dank', 'gespendet: nach einem Jahr ein leiser Dank')
pruefe(f({ an: false, bewertet: 1000 }) === null, 'Schalter aus: nichts')
const n = nachAntwort({ meilenstein: 50, version: '4.1.0' }, { art: 'meilenstein', wert: 200, antwort: 'spaeter' }, J)
pruefe(n.meilenstein === 200 && n.letzte === J && !n.status, '„Später" beim Meilenstein: erledigt, Sperre läuft')
pruefe(nachAntwort({}, { art: 'update', wert: '4.1.0', antwort: 'zu' }, J).letzteVersion === '4.1.0', 'Update-Hinweis gilt nur einmal je Fassung')
pruefe(nachAntwort({}, { art: 'zeit', antwort: 'gespendet' }, J).status === 'gespendet', '„schon gespendet" wird gemerkt')
pruefe(nachAntwort({}, { art: 'zeit', antwort: 'nein' }, J).status === 'nein', '„definitiv nicht" wird gemerkt')

console.log(`spenden: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
