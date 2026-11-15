/**
 * Selbsttest: Quartalszahlen in der Simulation.
 *
 *   node shared/__selftest-aktien-zahlen.mjs
 */
import assert from 'node:assert/strict'
import { imZahlenFenster, beruehrtZahlen, zahlenBilanz, terminListe, tageBisZahlen } from './aktien-zahlen.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const H = 3_600_000, TAG = 24 * H
const T = Date.UTC(2026, 7, 26, 20, 20)       // Meldung 26.8.2026, 16:20 New York
const termine = [T - 98 * TAG, T]

ok(imZahlenFenster(T, termine) === T && imZahlenFenster(T - 23 * H, termine) === T && imZahlenFenster(T + 24 * H, termine) === T, 'ein Tag davor bis ein Tag danach')
ok(imZahlenFenster(T - 25 * H, termine) === null && imZahlenFenster(T + 25 * H, termine) === null, 'ausserhalb des Fensters')
ok(imZahlenFenster(T, []) === null, 'ohne Termine nie im Fenster')

ok(beruehrtZahlen(T - 5 * TAG, T - 3 * TAG, termine) === null, 'Trade vor dem Fenster')
ok(beruehrtZahlen(T - 5 * TAG, T + 3 * TAG, termine) === T, 'Trade über die Meldung gehalten — auch wenn Ein- und Ausstieg weit weg liegen')
ok(beruehrtZahlen(T - 2 * TAG, T - 20 * H, termine) === T, 'Ausstieg im Vorlauf des Fensters')
ok(beruehrtZahlen(T + 26 * H, T + 30 * H, termine) === null, 'Trade nach dem Fenster')
ok(beruehrtZahlen(T - 99 * TAG, T - 97 * TAG, termine) === T - 98 * TAG, 'der frühere Termin zählt ebenso')

const b = zahlenBilanz([{ zahlen: T, netPnl: -30, rMultiple: -3 }, { zahlen: null, netPnl: 10, rMultiple: 1 }, { netPnl: 5, rMultiple: 0.5 }])
ok(b.mit.trades === 1 && b.mit.summeR === -3 && b.mit.gewinner === 0, 'mit Zahlen-Fenster')
ok(b.ohne.trades === 2 && b.ohne.netPnl === 15 && b.ohne.gewinner === 2, 'ohne — Trades ohne Angabe zählen dazu')
ok(zahlenBilanz().mit.trades === 0, 'leer')

const l = terminListe({ naechster: { zeit: T + 83 * TAG }, vergangene: [T, T - 98 * TAG] })
ok(l.liste.length === 3 && l.liste[0] === T - 98 * TAG && l.liste[2] === T + 83 * TAG, 'eine aufsteigende Liste mit dem nächsten Termin')
ok(l.bekanntAb === T - 98 * TAG - 99 * TAG, 'vollständig erst ab einem Quartal vor dem ältesten bekannten Termin')
ok(terminListe(null).liste.length === 0 && terminListe(null).bekanntAb === null && terminListe({ vergangene: [NaN, 0] }).liste.length === 0, 'ohne Angaben leer')

ok(tageBisZahlen([T], T - 2 * TAG - 3 * H) === 2 && tageBisZahlen([T], T - 3 * H) === 0, 'Tage bis zum Termin')
ok(tageBisZahlen([T], T + 12 * H) === 0 && tageBisZahlen([T], T + 2 * TAG) === null, 'am Tag danach noch 0, später kein Termin mehr')
ok(tageBisZahlen([T - 98 * TAG, T], T - 50 * TAG) === 50 && tageBisZahlen([], T) === null, 'vergangene Termine zählen nicht')

console.log(`✓ Aktien-Zahlentermine: ${n} Prüfungen`)
