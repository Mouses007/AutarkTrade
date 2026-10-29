/**
 * Selbsttest: Bewertungs-Popup — was ist neu, was ist gemeldet.
 *
 *   node server/__selftest-trade-popups.mjs
 *
 * Läuft gegen eine In-Memory-SQLite durch die echte Migration und die echten
 * Abfragen (`server/trade-popups.js`). Die wichtigere Richtung ist „nicht
 * neu": Altbestand nach dem Update, Positionen eines neu eingerichteten
 * Kontos, der 24-h-Nachholscan, Rückstau beim Einschalten. Ein Popup zu viel
 * fällt auf, eines zu wenig nie.
 */
import { readFileSync } from 'node:fs'
import knexLib from 'knex'
import { migriereTradePopups } from './migrationen/trade-popups.js'
import {
    zeitstempel, felderBeimAnlegen, felderBeimSchliessen, baselineBeimEinschalten,
    waehleNeue, grenzeFuer, neueMeldungen, quittiere,
} from './trade-popups.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const MIN = 60 * 1000
const UPDATE = 1_761_700_000_000          // Zeitpunkt des Updates (fest, kein Date.now())

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })

async function addColumnIfNotExists(table, column, buildCol) {
    if (!(await knex.schema.hasTable(table))) return
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, buildCol)
}

// Stand vor dem Update: Tabellen ohne die neuen Spalten
await knex.schema.createTable('settings', (t) => {
    t.increments('id').primary()
    t.integer('showTradePopups').defaultTo(1)
})
await knex.schema.createTable('incoming_positions', (t) => {
    t.increments('id').primary()
    t.text('positionId').notNullable().unique()
    t.text('status').defaultTo('open')
    t.text('broker').defaultTo('bitunix')
    t.integer('openingEvalDone').defaultTo(0)
    t.integer('skipEvaluation').defaultTo(0)
    t.text('bitunixData').defaultTo('{}')
    t.text('historyData').defaultTo('{}')
})
await knex('settings').insert({ id: 1, showTradePopups: 1 })
await knex('incoming_positions').insert([
    { positionId: 'alt-offen', status: 'open', bitunixData: JSON.stringify({ ctime: UPDATE - 60 * MIN }) },
    { positionId: 'alt-pendent', status: 'pending_evaluation', historyData: JSON.stringify({ mtime: UPDATE - 5 * MIN }) },
    { positionId: 'alt-bewertet', status: 'open', openingEvalDone: 1 },
])

/** Zeile anlegen wie POST /api/db/incoming_positions. */
async function lege(zeile, jetzt) {
    const roh = { status: 'open', broker: 'bitunix', ...zeile }
    await knex('incoming_positions').insert({
        ...roh,
        bitunixData: JSON.stringify(roh.bitunixData || {}),
        historyData: JSON.stringify(roh.historyData || {}),
        ...felderBeimAnlegen(roh, jetzt),
    })
}
/** Status ändern wie PUT /api/db/incoming_positions/:id. */
async function schliesse(positionId, historyData, jetzt) {
    const alt = await knex('incoming_positions').where({ positionId }).first()
    const neu = { status: 'pending_evaluation', historyData }
    await knex('incoming_positions').where({ positionId }).update({
        status: 'pending_evaluation', historyData: JSON.stringify(historyData),
        ...felderBeimSchliessen(alt, neu, jetzt),
    })
}
const ids = (r) => r.meldungen.map((m) => `${m.art}:${m.positionId}`).sort().join(',')

console.log('\nZeitstempel aus Rohdaten\n')
{
    check('ms bleibt ms', zeitstempel({ ctime: 1761700000123 }, ['ctime']) === 1761700000123)
    check('Text-Zahl', zeitstempel({ ctime: '1761700000123' }, ['ctime']) === 1761700000123)
    check('Sekunden werden ms', zeitstempel({ cTime: 1761700000 }, ['ctime', 'cTime']) === 1761700000000)
    check('JSON-Text wird gelesen', zeitstempel('{"mtime":1761700000999}', ['mtime']) === 1761700000999)
    check('Vorrang nach Reihenfolge', zeitstempel({ mtime: 1761700000001, uTime: 1761700000002 }, ['mtime', 'uTime']) === 1761700000001)
    check('leer, 0, Unsinn → null', zeitstempel({ ctime: '' }, ['ctime']) === null && zeitstempel({ ctime: 0 }, ['ctime']) === null
        && zeitstempel({ ctime: 'abc' }, ['ctime']) === null && zeitstempel('kaputt', ['ctime']) === null && zeitstempel(null, ['ctime']) === null)
    check('Pionex-Bot: closeTime als Schliesszeit', felderBeimAnlegen({ status: 'pending_evaluation', historyData: { createTime: 1761700000000, closeTime: 1761700500000 } }, 1).closedAt === 1761700500000)
    check('ohne Börsenzeit: Erkennungszeit', felderBeimAnlegen({ status: 'open', bitunixData: {} }, 42).openedAt === 42)
    check('offene Zeile bekommt keine Schliesszeit', !('closedAt' in felderBeimAnlegen({ status: 'open', bitunixData: { ctime: 1761700000000, mtime: 1761700001000 } }, 1)))
}

console.log('\nMigration beim Update\n')
{
    await migriereTradePopups(knex, addColumnIfNotExists, UPDATE)
    const s = await knex('settings').where('id', 1).first()
    check('Baseline = Zeitpunkt des Updates', Number(s.tradePopupBaseline) === UPDATE)
    const z = Object.fromEntries((await knex('incoming_positions')).map((r) => [r.positionId, r]))
    check('Altbestand: Eröffnungen gelten als gemeldet', ['alt-offen', 'alt-pendent', 'alt-bewertet'].every((k) => Number(z[k].openNotifiedAt) === UPDATE))
    check('geschlossener Altbestand gilt als gemeldet', Number(z['alt-pendent'].closeNotifiedAt) === UPDATE)
    check('offene Position: Schliessung bleibt meldbar', z['alt-offen'].closeNotifiedAt === null)
    check('nach dem Update: keine Meldung', (await neueMeldungen(knex, UPDATE + MIN)).meldungen.length === 0)

    await migriereTradePopups(knex, addColumnIfNotExists, UPDATE + 99 * MIN)
    const s2 = await knex('settings').where('id', 1).first()
    check('zweiter Lauf ändert die Baseline nicht', Number(s2.tradePopupBaseline) === UPDATE)
}

console.log('\nWas neu ist\n')
{
    const t = UPDATE + 10 * MIN
    await lege({ positionId: 'neu-offen', bitunixData: { ctime: t - MIN } }, t)
    await lege({ positionId: 'vor-update-offen', bitunixData: { ctime: UPDATE - MIN } }, t)  // erst jetzt erkannt
    await lege({ positionId: 'neu-zu', status: 'pending_evaluation', historyData: { ctime: UPDATE - 90 * MIN, mtime: t - 2 * MIN } }, t)
    await lege({ positionId: 'nachgeholt-zu', status: 'pending_evaluation', historyData: { mtime: UPDATE - 20 * 60 * MIN } }, t)  // 24-h-Scan
    await lege({ positionId: 'uebersprungen', skipEvaluation: 1, bitunixData: { ctime: t } }, t)
    await knex('incoming_positions').insert({ positionId: 'ohne-zeit', status: 'pending_evaluation' })  // älterer Codestand
    await schliesse('alt-offen', { mtime: t - 30 * 1000 }, t)

    const r = await neueMeldungen(knex, t)
    check('an', r.an === true)
    check('genau: neue Eröffnung, neue Schliessung, Schliessung einer Altposition',
        ids(r) === 'close:alt-offen,close:neu-zu,open:neu-offen', ids(r))
    check('Meldung trägt die Börse', r.meldungen.every((m) => m.broker === 'bitunix'))

    await knex('incoming_positions').where({ positionId: 'neu-offen' }).update({ openingEvalDone: 1 })
    check('bewertete Eröffnung fällt weg', !ids(await neueMeldungen(knex, t)).includes('open:neu-offen'))
    await knex('incoming_positions').where({ positionId: 'neu-offen' }).update({ openingEvalDone: 0 })

    const zweimal = await knex('incoming_positions').where({ positionId: 'alt-offen' }).first()
    check('Schliesszeit bleibt beim zweiten Status-Update', Object.keys(felderBeimSchliessen(zweimal, { status: 'pending_evaluation' }, t + MIN)).length === 0)
}

console.log('\nQuittieren\n')
{
    const t = UPDATE + 11 * MIN
    check('quittiert zwei Zeilen', await quittiere(knex, { open: ['neu-offen'], close: ['neu-zu'] }, t) === 2)
    check('zweimal quittieren ändert nichts', await quittiere(knex, { open: ['neu-offen'], close: ['neu-zu'] }, t + MIN) === 0)
    const z = await knex('incoming_positions').where({ positionId: 'neu-offen' }).first()
    check('Zeitpunkt der ersten Quittung bleibt', Number(z.openNotifiedAt) === t)
    check('Eröffnung quittiert, Schliessung derselben Position bleibt offen', z.closeNotifiedAt === null)
    check('übrig: nur die Altposition', ids(await neueMeldungen(knex, t)) === 'close:alt-offen')
    check('leere und kaputte Listen', await quittiere(knex, {}) === 0 && await quittiere(knex, { open: 'x', close: [null, {}] }) === 0)

    await schliesse('neu-offen', { mtime: t + MIN }, t + MIN)
    check('quittierte Eröffnung, später geschlossen: Schliessung ist neu', ids(await neueMeldungen(knex, t + MIN)) === 'close:alt-offen,close:neu-offen')
    await quittiere(knex, { close: ['alt-offen', 'neu-offen'] }, t + 2 * MIN)
}

console.log('\nNeuer Börsenschlüssel\n')
{
    const schluessel = UPDATE + 60 * MIN
    await knex('settings').where('id', 1).update({ tradePopupBoersen: JSON.stringify({ bitget: schluessel }) })
    check('Grenze = späterer Wert', grenzeFuer('bitget', { baseline: UPDATE, anker: { bitget: schluessel } }) === schluessel
        && grenzeFuer('bitunix', { baseline: UPDATE, anker: { bitget: schluessel } }) === UPDATE)
    const t = schluessel + 2 * MIN
    await lege({ positionId: 'bg-alt', broker: 'bitget', bitunixData: { cTime: UPDATE + 30 * MIN } }, t)   // offen seit vor dem Schlüssel
    await lege({ positionId: 'bg-scan', broker: 'bitget', status: 'pending_evaluation', historyData: { utime: UPDATE + 40 * MIN } }, t)
    await lege({ positionId: 'bg-neu', broker: 'bitget', bitunixData: { cTime: schluessel + MIN } }, t)
    await lege({ positionId: 'bx-neu', bitunixData: { ctime: UPDATE + 30 * MIN } }, t)   // andere Börse: alte Grenze
    check('Konto-Altbestand nicht, Neues schon', ids(await neueMeldungen(knex, t)) === 'open:bg-neu,open:bx-neu', ids(await neueMeldungen(knex, t)))
    await quittiere(knex, { open: ['bg-neu', 'bx-neu'] }, t)
}

console.log('\nSchalter\n')
{
    const t = UPDATE + 200 * MIN
    await lege({ positionId: 'waehrend-an', bitunixData: { ctime: t } }, t)
    await knex('settings').where('id', 1).update({ showTradePopups: 0 })
    const r = await neueMeldungen(knex, t)
    check('aus: nichts, und sagt es', r.an === false && r.meldungen.length === 0)
    await lege({ positionId: 'waehrend-aus', bitunixData: { ctime: t + MIN } }, t + MIN)

    check('Einschalten setzt die Baseline', baselineBeimEinschalten(0, 1, 5).tradePopupBaseline === 5 && baselineBeimEinschalten('0', true, 5).tradePopupBaseline === 5)
    check('an bleibt an, aus, fehlt: keine neue Baseline', !Object.keys(baselineBeimEinschalten(1, 1, 5)).length
        && !Object.keys(baselineBeimEinschalten(1, 0, 5)).length && !Object.keys(baselineBeimEinschalten(null, 1, 5)).length
        && !Object.keys(baselineBeimEinschalten(0, undefined, 5)).length)

    const ein = t + 5 * MIN
    await knex('settings').where('id', 1).update({ showTradePopups: 1, ...baselineBeimEinschalten(0, 1, ein) })
    const r2 = await neueMeldungen(knex, ein)
    check('Einschalten meldet keinen Rückstau', r2.an === true && r2.meldungen.length === 0, ids(r2))
    await lege({ positionId: 'nach-ein', bitunixData: { ctime: ein + MIN } }, ein + MIN)
    check('danach Neues wieder gemeldet', ids(await neueMeldungen(knex, ein + MIN)) === 'open:nach-ein')
}

console.log('\nFehlende Baseline (alte Einstellungszeile zurückgesichert)\n')
{
    const t = UPDATE + 400 * MIN
    await knex('settings').where('id', 1).update({ tradePopupBaseline: null })
    const r = await neueMeldungen(knex, t)
    const s = await knex('settings').where('id', 1).first()
    check('nichts gemeldet, Baseline nachgeholt', r.meldungen.length === 0 && Number(s.tradePopupBaseline) === t)
    check('Offenes gilt danach als gemeldet', ids(await neueMeldungen(knex, t + MIN)) === '')
}

console.log('\nRein: waehleNeue ohne Baseline\n')
check('ohne Baseline nie neu', waehleNeue([{ positionId: '1', status: 'open', openedAt: 9e12 }], { baseline: 0 }).length === 0)

console.log('\nEinbau (Quelltext)\n')
{
    const lies = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
    const rahmen = lies('../src/layouts/Rahmen.vue')
    check('Popup hängt im Rahmen ohne Journal-Bedingung', /<TradeEvalPopup\s*\/>/.test(rahmen) && !/<TradeEvalPopup v-if/.test(rahmen))
    const popup = lies('../src/components/TradeEvalPopup.vue')
    check('Popup: Cockpit und Pendente Trades gesperrt', popup.includes("route.query?.cockpit !== '1'") && popup.includes("route.path !== '/incoming'"))
    check('Popup quittiert beim Schliessen', /function verworfen\(\)[\s\S]*quittiereBewertungen/.test(popup))
    const routen = lies('./api-routes.js')
    check('Notified-Spalten nicht über die generische Route schreibbar', !/'openNotifiedAt'|'closeNotifiedAt'/.test(routen))
    check('alte localStorage-Liste nicht mehr benutzt', !lies('../src/utils/incoming.js').includes('evalNotifiedPositionIds')
        && !lies('../src/stores/journal/offenePositionen.js').includes('evalNotifiedPositionIds'))
}

await knex.destroy()
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
