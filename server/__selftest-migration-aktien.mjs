/**
 * Selbsttest der Aktien-Migration (in-memory SQLite).
 *
 *   node server/__selftest-migration-aktien.mjs
 *
 * Geprüft: zweimal laufen lassen ändert nichts, bestehende Zeilen gelten als
 * Krypto, fehlende Tabellen werden übersprungen statt den Start abzubrechen.
 */
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { migriereAktien, normMarkt, TABELLEN_MIT_ANLAGEKLASSE } from './migrationen/aktien.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
const addColumnIfNotExists = async (table, column, buildCol) => {
    if (!(await knex.schema.hasTable(table))) return
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => buildCol(t))
}

await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
await knex('settings').insert({ id: 1 })
// Zwei der sechs Tabellen gibt es, mit je einer alten Zeile; die anderen fehlen.
await knex.schema.createTable('coin_universen', (t) => { t.increments('id').primary(); t.string('name') })
await knex.schema.createTable('strategy_instances', (t) => { t.increments('id').primary(); t.string('symbols') })
await knex('coin_universen').insert({ name: 'alt' })
await knex('strategy_instances').insert({ symbols: '["BTCUSDT"]' })

await migriereAktien(knex, addColumnIfNotExists)
await migriereAktien(knex, addColumnIfNotExists)

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }

ok(await knex.schema.hasTable('instrumente'), 'instrumente angelegt')
ok(await knex.schema.hasTable('instrument_listungen'), 'instrument_listungen angelegt')
ok((await knex('coin_universen').first()).anlageklasse === 'krypto', 'altes Universum ist Krypto')
ok((await knex('strategy_instances').first()).anlageklasse === 'krypto', 'alte Instanz ist Krypto')
for (const t of TABELLEN_MIT_ANLAGEKLASSE) {
    if (await knex.schema.hasTable(t)) ok(await knex.schema.hasColumn(t, 'anlageklasse'), `${t}.anlageklasse`)
}
ok(!(await knex.schema.hasTable('chart_alarme')), 'fehlende Tabelle bleibt fehlend')

const s = await knex('settings').where('id', 1).first()
ok(s.aktiverMarkt === 'krypto', 'Vorgabe aktiverMarkt = krypto')
ok(!s.modusAktienAn, 'Vorgabe modusAktienAn = aus')

// Ein Titel, zwei Listungen; dieselbe Listung kein zweites Mal.
const [id] = await knex('instrumente').insert({ anlageklasse: 'aktien', ticker: 'NVDA', unterart: 'aktie' })
await knex('instrument_listungen').insert({ instrumentId: id, handelsplatz: 'bitget', symbol: 'NVDAUSDT', art: 'perp' })
await knex('instrument_listungen').insert({ instrumentId: id, handelsplatz: 'pionex', symbol: 'NVDAX_USDT', art: 'token-spot' })
await assert.rejects(knex('instrument_listungen').insert({ instrumentId: id, handelsplatz: 'bitget', symbol: 'NVDAUSDT', art: 'perp' }))
await assert.rejects(knex('instrumente').insert({ anlageklasse: 'aktien', ticker: 'NVDA' }))
// Derselbe Ticker darf in einer anderen Anlageklasse stehen (Coin ACN neben Aktie ACN).
await knex('instrumente').insert({ anlageklasse: 'krypto', ticker: 'NVDA' })
n += 3

ok(normMarkt('aktien') === 'aktien' && normMarkt('krypto') === 'krypto', 'normMarkt kennt beide')
ok(normMarkt('forex') === 'krypto' && normMarkt(null) === 'krypto' && normMarkt(undefined) === 'krypto', 'Unbekanntes ist Krypto')

await knex.destroy()
console.log(`✓ Migration Aktien: ${n} Prüfungen`)
