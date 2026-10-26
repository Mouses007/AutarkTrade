/**
 * Selbsttest: TP/SL-Verlauf vereinigen statt überschreiben (Audit FUN-TRD-002).
 *
 *   node src/utils/__selftest-tpsl-verlauf.mjs
 *
 * Der Fall aus dem Audit: Gerät A kennt [SL 100], Gerät B hat 100 → 105 → 110
 * in die DB geschrieben. Öffnet A die Seite, darf weder Stufe 105 noch B's
 * Zeitpunkt verloren gehen.
 */

import { vereinigeVerlauf, bereinigeVerlauf } from './tpslVerlauf.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const M = 60_000
const sl = (time, oldVal, newVal, action) => ({ time, type: 'SL', oldVal, newVal, action })
const tp = (time, oldVal, newVal, action) => ({ time, type: 'TP', oldVal, newVal, action })

console.log('vereinigeVerlauf')
{
    const geraetA = [sl(1 * M, null, '100', 'set')]
    const db = [sl(1 * M, null, '100', 'set'), sl(5 * M, '100', '105', 'moved'), sl(9 * M, '105', '110', 'moved')]
    const v = vereinigeVerlauf(db, geraetA)
    check('Audit-Fall: Stufe 105 bleibt', v.some((e) => e.newVal === '105'))
    check('Audit-Fall: drei Einträge, keiner doppelt', v.length === 3, JSON.stringify(v))
    check('Audit-Fall: letzter Stand 110 zu B\'s Zeit', v[v.length - 1].newVal === '110' && v[v.length - 1].time === 9 * M)
}
{
    // Beide setzten 100 zu verschiedenen Zeiten: der zweite gleiche Eintrag fällt weg
    const v = vereinigeVerlauf([sl(1 * M, null, '100', 'set')], [sl(2 * M, null, '100', 'set')])
    check('gleiche Aktion zu anderer Zeit nur einmal', v.length === 1 && v[0].time === 1 * M)
}
{
    const v = vereinigeVerlauf([sl(3 * M, null, '100', 'set')], [tp(1 * M, null, '200', 'set')])
    check('nach Zeit sortiert, SL und TP getrennt', v.length === 2 && v[0].type === 'TP' && v[1].type === 'SL')
}
{
    const dbStand = [sl(1 * M, null, '100', 'set')]
    const v = vereinigeVerlauf(dbStand, null, undefined, 'kaputt', [null, 5])
    check('Unsinn in den Ständen schadet nicht', v.length === 1)
    check('Eingaben werden nicht verändert', dbStand.length === 1)
}
{
    const v = vereinigeVerlauf([], [], [])
    check('alles leer → leer', Array.isArray(v) && v.length === 0)
}
{
    // Entfernt und neu gesetzt auf denselben Wert ist KEIN Duplikat
    const v = vereinigeVerlauf([sl(1 * M, null, '100', 'set'), sl(2 * M, '100', null, 'removed'), sl(3 * M, null, '100', 'set')])
    check('setzen–entfernen–setzen bleibt vollständig', v.length === 3)
}

console.log('bereinigeVerlauf')
{
    const v = bereinigeVerlauf([sl(1, null, '100', 'set'), sl(2, null, '100', 'set'), tp(3, null, '5', 'set'), sl(4, '100', '101', 'moved')])
    check('aufeinanderfolgende Duplikate je Art weg', v.length === 3)
    check('0 und leer gelten als „kein Wert"', bereinigeVerlauf([sl(1, 0, '1', 'set'), sl(2, '', '1', 'set')]).length === 1)
    check('kein Array → leer', bereinigeVerlauf(null).length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
