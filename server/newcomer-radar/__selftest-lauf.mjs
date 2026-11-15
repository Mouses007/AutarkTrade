/**
 * Selbsttest: Start des Newcomer-Laufs und Lesen der Rangliste (`lauf.js`) mit
 * Datenbank im Arbeitsspeicher.
 *
 *   node server/newcomer-radar/__selftest-lauf.mjs
 *
 * OHNE Netz: `fetch` ist eine Attrappe, die jede Anfrage zählt und mit 404
 * beantwortet — die Kursquelle wird nie wirklich gefragt.
 *
 *   SEC-S-003  zwei gleichzeitige Starts ergeben EINEN Lauf
 *   DB-D-002   ein Titel ohne aktive Listung steht nicht mehr in der Rangliste
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Vor dem Laden der Datenbank: nichts im Projektordner anlegen (auch keine `.at-secret`).
const ordner = mkdtempSync(path.join(os.tmpdir(), 'at-newcomer-'))
process.env.AT_DB_FILE = ':memory:'
process.env.AT_SECRET_FILE = path.join(ordner, 'secret')

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

const abrufe = []
globalThis.fetch = async (url) => {
    abrufe.push(String(url))
    await new Promise((r) => setTimeout(r, 20))
    return { status: 404, ok: false, json: async () => ({}), text: async () => '' }
}

const log = console.log
console.log = () => {}                // Migrationsmeldungen und die Schlusszeile des Laufs
const { initDb } = await import('../database.js')
const knex = await initDb()
const { _setzeLeser } = await import('../quellen/freigabe.js')
_setzeLeser(async () => true)
const { starteLauf, laufStand, leseTitel, zaehleTitel, _setzeAbgleich } = await import('./lauf.js')

// ── Stamm: drei Titel ohne Namen (keine Namenssuche), je eine aktive Listung ──
const jetzt = Date.now()
await knex('instrumente').insert(['AAA', 'BBB', 'CCC'].map((ticker) => ({ anlageklasse: 'aktien', ticker, unterart: 'aktie', stand: jetzt, createdAt: jetzt })))
const ids = Object.fromEntries((await knex('instrumente').select('id', 'ticker')).map((z) => [z.ticker, z.id]))
await knex('instrument_listungen').insert(Object.entries(ids).map(([ticker, instrumentId]) => ({
    instrumentId, handelsplatz: 'bitget', symbol: `${ticker}USDT`, art: 'perp', quote: 'USDT', sicher: 1, aktiv: 1, ersteSichtung: jetzt, letzteSichtung: jetzt,
})))

// ── SEC-S-003: Doppelstart ──
const [a, b, c] = await Promise.all([starteLauf({ alle: true }), starteLauf({ alle: true }), starteLauf()])
ok(a === b && b === c && a === laufStand(), 'drei gleichzeitige Starts liefern denselben Lauf')
ok(a.laeuft === true && a.gesamt === 3, 'der Lauf läuft, mit drei Titeln')
ok(await starteLauf({ alle: true }) === a, 'ein Start während des Laufs: derselbe Lauf')
while (laufStand().laeuft) await new Promise((r) => setTimeout(r, 50))
await new Promise((r) => setTimeout(r, 50))
const referenz = abrufe.filter((u) => u.includes('/chart/SPY')).length
gleich(referenz, 1, 'die Referenz (SPY) wurde EINMAL geholt — ein Lauf, nicht zwei nebeneinander')
gleich(['AAA', 'BBB', 'CCC'].map((t) => abrufe.filter((u) => u.includes(`/chart/${t}?`)).length), [1, 1, 1], 'jeder Titel einmal gefragt')
ok(a.fertig === 3 && a.ende > 0, 'Lauf beendet')
// Danach ist ein neuer Lauf möglich (die Sperre hängt nicht fest)
const zweiter = await starteLauf({ alle: true })
ok(zweiter !== a && zweiter.laeuft === true, 'nach dem Ende startet ein neuer Lauf')
while (laufStand().laeuft) await new Promise((r) => setTimeout(r, 50))

// ── DB-D-002: abgelisteter Titel fällt aus Rangliste und Zähler ──
await knex('newcomer_titel').del()
const zeile = (ticker, note) => ({ instrumentId: ids[ticker], kategorie: 'boersengang', note, noten: '{}', kennzahlen: '{}', huerden: '[]', stand: jetzt })
await knex('newcomer_titel').insert([zeile('AAA', 97), zeile('BBB', 80)])
gleich((await leseTitel(knex)).map((t) => t.ticker), ['AAA', 'BBB'], 'beide gelistet: beide in der Rangliste')
await knex('instrument_listungen').where('instrumentId', ids.AAA).update({ aktiv: 0 })
gleich((await leseTitel(knex)).map((t) => t.ticker), ['BBB'], 'AAA führt keine Börse mehr: nicht mehr in der Rangliste (trotz Note 97)')
gleich((await leseTitel(knex, { mitHuerden: true, kategorie: 'boersengang' })).map((t) => t.ticker), ['BBB'], 'auch nicht mit Hürden / je Kategorie')
gleich(await zaehleTitel(knex), { boersengang: { gesamt: 1, zugelassen: 1, ohneKurse: 0 } }, 'der Zähler zählt ihn nicht mehr')
gleich(await knex('newcomer_titel').count({ n: '*' }).first().then((z) => Number(z.n)), 2, 'die gespeicherte Zeile bleibt')
// Zweite, noch aktive Listung an einem anderen Platz: der Titel bleibt
await knex('instrument_listungen').insert({ instrumentId: ids.AAA, handelsplatz: 'pionex', symbol: 'AAAX_USDT', art: 'token-spot', sicher: 1, aktiv: 1, ersteSichtung: jetzt, letzteSichtung: jetzt })
const wieder = await leseTitel(knex)
ok(wieder[0].ticker === 'AAA' && wieder[0].listungen.length === 1 && wieder[0].listungen[0].handelsplatz === 'pionex', 'eine aktive Listung genügt; gezeigt wird nur sie')

// ── Leerer Stamm: der Lauf gleicht zuerst ab; bleibt der Stamm leer, sagt er das ──
await knex('newcomer_titel').del(); await knex('instrument_listungen').del(); await knex('instrumente').del()
let abgleiche = 0
_setzeAbgleich(async () => { abgleiche++ })
const leer = await starteLauf({ alle: true })
ok(abgleiche === 1 && leer.laeuft === false && leer.abbruch === 'stammLeer' && leer.gesamt === 0, 'leerer Stamm, Abgleich bringt nichts: kein Lauf, Grund «stammLeer»')
_setzeAbgleich(async () => {
    abgleiche++
    const [id] = await knex('instrumente').insert({ anlageklasse: 'aktien', ticker: 'DDD', unterart: 'aktie', stand: jetzt, createdAt: jetzt })
    await knex('instrument_listungen').insert({ instrumentId: id, handelsplatz: 'bitget', symbol: 'DDDUSDT', art: 'perp', quote: 'USDT', sicher: 1, aktiv: 1, ersteSichtung: jetzt, letzteSichtung: jetzt })
})
const gefuellt = await starteLauf({ alle: true })
ok(abgleiche === 2 && gefuellt.gesamt === 1 && gefuellt.abbruch === null, 'leerer Stamm, Abgleich füllt ihn: der Lauf rechnet die neuen Titel')
while (laufStand().laeuft) await new Promise((r) => setTimeout(r, 50))
_setzeAbgleich(null)

console.log = log
await knex.destroy()
rmSync(ordner, { recursive: true, force: true })
console.log(`✓ Newcomer-Lauf (ohne Netz): ${n} Prüfungen`)
process.exit(0)
