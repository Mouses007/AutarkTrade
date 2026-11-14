/**
 * Selbsttest des Stamm-Abgleichs (in-memory SQLite, ohne Netz).
 *
 *   node server/aktien/__selftest-stamm.mjs
 *
 * Geprüft wird, was still Falsches schreiben würde: eine ausgefallene Liste
 * als «alles delistet», der erste Lauf als «alles neu», ein Coin im Stamm.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import knexLib from 'knex'
import { migriereAktien } from '../migrationen/aktien.js'
import { ordneAlle } from './einordnung.js'
import { speichereStamm, leseStamm, stammZahlen, holeListen } from './stamm-speicher.js'

const hier = path.dirname(fileURLToPath(import.meta.url))
const roh = JSON.parse(fs.readFileSync(path.join(hier, '../fixtures/aktien-listungen.json'), 'utf8'))
const PLAETZE = ['binance', 'bitget', 'bitunix', 'pionex', 'bitpanda']

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
await knex('settings').insert({ id: 1 })
await migriereAktien(knex, async (table, column, buildCol) => {
    if (!(await knex.schema.hasTable(table))) return
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => buildCol(t))
})

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }
const listung = (platz, symbol) => knex('instrument_listungen').where({ handelsplatz: platz, symbol }).first()

// ── 1. Erster Lauf: Ausgangslage, nichts ist «neu» ──
const alle = ordneAlle(roh)
let r = await speichereStamm(knex, alle, PLAETZE, 1000)
gleich(r.neu, [], 'erster Lauf meldet nichts als neu')
gleich(r.weg, [], 'erster Lauf schaltet nichts ab')
ok(r.titel > 10 && r.listungen > r.titel, 'Titel und Listungen gezählt')

ok(!(await knex('instrumente').where('anlageklasse', 'krypto').first()), 'kein Coin im Stamm')
ok(!(await knex('instrumente').where('ticker', 'BTC').first()), 'BTC nicht im Stamm')
ok(!(await listung('pionex', 'AVAX_USDT')), 'AVAX ist kein xStock')

const nvda = await knex('instrumente').where({ anlageklasse: 'aktien', ticker: 'NVDA' }).first()
gleich(nvda.name, 'Nvidia', 'Name kommt von Bitpanda')
const nvdaL = await knex('instrument_listungen').where('instrumentId', nvda.id)
gleich(nvdaL.map((l) => l.handelsplatz).sort(), [...PLAETZE].sort(), 'NVDA an allen fünf Plätzen')
gleich((await listung('bitunix', 'NVDAUSDT')).sicher, 0, 'Bitunix-Zuordnung als unsicher gespeichert')
gleich((await listung('bitget', 'NVDAUSDT')).sicher, 1, 'Bitget-Zuordnung sicher')
gleich((await knex('instrumente').where({ ticker: 'ANTHROPIC' }).first()).unterart, 'vorboerslich', 'Pre-IPO als vorbörslich')
gleich((await knex('instrumente').where({ ticker: 'HK0700' }).first()).region, 'HK', 'Region gespeichert')
gleich((await knex('instrumente').where({ ticker: 'XAU' }).first()).anlageklasse, 'sonstige', 'Gold ist sonstige')

// ── 2. Zweiter Lauf, unverändert: idempotent ──
const vorher = await knex('instrument_listungen').count({ n: '*' }).first()
r = await speichereStamm(knex, alle, PLAETZE, 2000)
gleich([r.neu.length, r.weg.length], [0, 0], 'gleicher Stand: nichts neu, nichts weg')
gleich((await knex('instrument_listungen').count({ n: '*' }).first()).n, vorher.n, 'keine doppelten Zeilen')
gleich(Number((await listung('bitget', 'NVDAUSDT')).letzteSichtung), 2000, 'letzteSichtung aufgefrischt')
gleich(Number((await listung('bitget', 'NVDAUSDT')).ersteSichtung), 1000, 'ersteSichtung bleibt')

// ── 3. Neue Listung bei Bitget ──
const mitNeu = ordneAlle({ ...roh, bitget: [...roh.bitget, { symbol: 'RDDTUSDT', baseCoin: 'RDDT', quoteCoin: 'USDT', isRwa: 'YES', maxLever: '25', symbolStatus: 'normal' }] })
r = await speichereStamm(knex, mitNeu, PLAETZE, 3000)
gleich(r.neu.map((l) => `${l.handelsplatz}:${l.ticker}:${l.art}`), ['bitget:RDDT:perp'], 'neue Listung gemeldet')
gleich(Number((await listung('bitget', 'RDDTUSDT')).maxHebel), 25, 'Hebel gespeichert')

// ── 4. Ausgefallene Liste ändert nichts (Regel 1) ──
const ohnePionex = PLAETZE.filter((p) => p !== 'pionex')
r = await speichereStamm(knex, ordneAlle({ ...roh, pionex: [] }), ohnePionex, 4000)
gleich((await listung('pionex', 'NVDAX_USDT')).aktiv, 1, 'Pionex nicht gelesen → Listung bleibt aktiv')
ok(!r.weg.some((l) => l.handelsplatz === 'pionex'), 'Pionex nicht in «weg»')
// RDDT fehlt in diesem Lauf wieder bei Bitget (1 von vielen) → abgeschaltet
gleich(r.weg.map((l) => l.symbol), ['RDDTUSDT'], 'echte Delistung erkannt')
gleich((await listung('bitget', 'RDDTUSDT')).aktiv, 0, 'delistet = inaktiv, Zeile bleibt')

// ── 5. Wieder gelistet ──
r = await speichereStamm(knex, mitNeu, PLAETZE, 5000)
ok(r.neu.length === 1 && r.neu[0].wieder === true, 'Rückkehr als neu mit Kennzeichen «wieder»')
gleich(Number((await listung('bitget', 'RDDTUSDT')).ersteSichtung), 3000, 'ersteSichtung der Rückkehr bleibt die alte')

// ── 6. Eingebrochene Liste schaltet nichts ab (Regel 2) ──
const bitgetVoll = []
for (let i = 0; i < 20; i++) bitgetVoll.push({ symbol: `T${i}USDT`, baseCoin: `T${i}`, quoteCoin: 'USDT', isRwa: 'YES', symbolStatus: 'normal' })
await speichereStamm(knex, ordneAlle({ bitget: bitgetVoll }), ['bitget'], 6000)   // schaltet die alten wenigen ab, legt 20 an
r = await speichereStamm(knex, ordneAlle({ bitget: bitgetVoll.slice(0, 3) }), ['bitget'], 7000)
gleich(r.gebremst, ['bitget'], 'Einbruch auf 3 von 20 gilt als Störung')
gleich((await listung('bitget', 'T19USDT')).aktiv, 1, 'nichts abgeschaltet')

// ── 7. Ein neuer Handelsplatz ist beim ersten Mal Ausgangslage (Regel 3) ──
const k2 = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await k2.schema.createTable('settings', (t) => { t.increments('id').primary() })
await migriereAktien(k2, async () => {})
await speichereStamm(k2, ordneAlle({ bitget: roh.bitget }), ['bitget'], 1)
r = await speichereStamm(k2, ordneAlle({ bitget: roh.bitget, binance: roh.binance }), ['bitget', 'binance'], 2)
gleich(r.neu, [], 'Binance kommt später dazu: Ausgangslage, nicht neu')
await k2.destroy()

// ── 8. Lesen ──
let liste = await leseStamm(knex, { anlageklasse: 'aktien', suche: 'nvd' })
gleich(liste.map((t) => t.ticker), ['NVDA'], 'Suche nach Ticker-Anfang')
ok(liste[0].spot && liste[0].future, 'NVDA: Spot und Future')
liste = await leseStamm(knex, { suche: 'apple' })
gleich(liste.map((t) => t.ticker), ['AAPL'], 'Suche im Namen')
liste = await leseStamm(knex, { anlageklasse: 'aktien', art: 'token-spot' })
ok(liste.length >= 3 && liste.every((t) => t.listungen.some((l) => l.art === 'token-spot')), 'Filter nach Art')
liste = await leseStamm(knex, { suche: "%' OR 1=1 --" })
gleich(liste, [], 'Sonderzeichen in der Suche sind harmlos')
const zahlen = await stammZahlen(knex)
ok(zahlen.titelFuture > 0 && zahlen.titelFuture <= zahlen.handelsplaetze.filter((p) => p.art === 'perp').reduce((s, p) => s + p.anzahl, 0), 'Future-Titel zählen Titel, nicht Listungen')
ok(zahlen.unterarten.some((u) => u.unterart === 'vorboerslich') && zahlen.handelsplaetze.some((p) => p.handelsplatz === 'pionex'), 'Zahlen je Unterart und Handelsplatz')

// ── 9. Abruf: jede Liste darf einzeln ausfallen ──
const { roh: geholt, stand } = await holeListen({
    binance: async () => null,
    bitget: async () => roh.bitget,
    bitunix: async () => { throw new Error('HTTP 502') },
    pionex: async () => [],
    bitpanda: async () => roh.bitpanda,
})
gleich(Object.keys(geholt).sort(), ['bitget', 'bitpanda'], 'nur gelungene Listen zählen als gelesen')
gleich([stand.binance.grund, stand.bitunix.grund, stand.pionex.grund], ['nichtGewaehlt', 'HTTP 502', 'leer'], 'Gründe je Handelsplatz')

await knex.destroy()
console.log(`✓ Stamm-Abgleich: ${n} Prüfungen`)
