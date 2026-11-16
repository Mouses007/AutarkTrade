/**
 * Selbsttest: wie lange die Aktien-Auskunft gemerkt wird.
 *
 *   node server/aktien/__selftest-kontext.mjs
 */
import assert from 'node:assert/strict'
import { kontextHaltbarMs } from './kontext.js'

let n = 0
const gleich = (a, b, text) => { assert.equal(a, b, text); n++ }
const LANG = 10 * 60_000, KURZ = 60_000, KEIN_TITEL = 30_000
const voll = { splits: [], splitsGrund: null, termine: { naechster: null, vergangene: [] }, termineGrund: null }

gleich(kontextHaltbarMs(voll), LANG, 'vollständige Auskunft: zehn Minuten')
gleich(kontextHaltbarMs(null), KEIN_TITEL, 'kein Aktien-Future: dreissig Sekunden')
gleich(kontextHaltbarMs({ ...voll, termine: null, termineGrund: 'abrufFehlgeschlagen' }), KURZ, 'Termin-Abruf gescheitert: kurz')
gleich(kontextHaltbarMs({ ...voll, termine: null, termineGrund: 'gebremst' }), KURZ, 'gebremst: kurz')
gleich(kontextHaltbarMs({ ...voll, splits: null, splitsGrund: 'abrufFehlgeschlagen' }), KURZ, 'Split-Abruf gescheitert: kurz')
gleich(kontextHaltbarMs({ ...voll, termine: null, termineGrund: 'quelleAus' }), LANG, 'Quelle aus: bleibt, also lang')
gleich(kontextHaltbarMs({ ...voll, termine: null, termineGrund: 'nichtGefunden' }), LANG, 'Titel unbekannt: bleibt')
gleich(kontextHaltbarMs({ ...voll, splits: null, splitsGrund: 'keinKursSymbol', termine: null, termineGrund: 'keinKursSymbol' }), LANG, 'kein Kurssymbol: bleibt')
gleich(kontextHaltbarMs({ ...voll, splits: null, splitsGrund: 'quelleAus', termine: null, termineGrund: 'abrufFehlgeschlagen' }), KURZ, 'eine Lücke genügt')

console.log(`${n} bestanden, 0 fehlgeschlagen`)
