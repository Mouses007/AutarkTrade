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
import { speichereStamm, leseStamm, stammZahlen, holeListen, ausgefalleneListen, suchForm, fuelleSuchNamen } from './stamm-speicher.js'

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

// ── 8b. DB-D-003: Namenssuche über die Suchform (Umlaute, Akzente, Gross/Klein) ──
gleich(['Münchener Rück', 'Nestlé S.A.', 'STRAßE  Ørsted', 'İstanbul', null].map(suchForm), ['munchener ruck', 'nestle s.a.', 'strasse orsted', 'istanbul', ''], 'Suchform: klein, ohne Akzente')
ok((await knex('instrumente').whereNotNull('name')).every((z) => z.suchName === suchForm(z.name)), 'der Abgleich füllt die Suchform für jeden Titel mit Namen')
{
    const j = Date.now()
    const neuTitel = [['MUV2', 'Münchener Rück'], ['NESN', 'Nestlé S.A.'], ['ORSTED', 'Ørsted A/S']]
    // Wie eine Zeile aus der Zeit vor der Spalte: Name da, Suchform fehlt
    await knex('instrumente').insert(neuTitel.map(([ticker, name]) => ({ anlageklasse: 'aktien', ticker, name, unterart: 'aktie', stand: j, createdAt: j })))
    const neu = await knex('instrumente').whereIn('ticker', neuTitel.map((x) => x[0])).select('id', 'ticker')
    await knex('instrument_listungen').insert(neu.map((z) => ({ instrumentId: z.id, handelsplatz: 'bitpanda', symbol: z.ticker, art: 'broker-spot', sicher: 1, aktiv: 1, ersteSichtung: j, letzteSichtung: j })))
    gleich((await leseStamm(knex, { suche: 'münch' })).map((t) => t.ticker), [], 'vor dem Nachfüllen: nicht gefunden (so sähe eine alte Zeile aus)')
    // Die Migration füllt bestehende Zeilen nach — und fasst beim zweiten Lauf nichts mehr an
    await migriereAktien(knex, async () => {})
    gleich(await fuelleSuchNamen(knex), 0, 'Migration hat nachgefüllt; ein zweiter Durchgang ändert nichts')
    for (const [frage, ticker] of [['münch', 'MUV2'], ['MÜNCH', 'MUV2'], ['munch', 'MUV2'], ['Rück', 'MUV2'], ['nestlé', 'NESN'], ['NESTLE', 'NESN'], ['ørsted', 'ORSTED'], ['orsted a/s', 'ORSTED']]) {
        gleich((await leseStamm(knex, { suche: frage })).map((t) => t.ticker), [ticker], `Suche «${frage}» findet ${ticker}`)
    }
    gleich((await leseStamm(knex, { suche: 'APPLE' })).map((t) => t.ticker), ['AAPL'], 'Namenssuche ohne Sonderzeichen wie bisher, gross geschrieben')
    // Ändert ein anderer Weg den Namen, zieht der nächste Abgleich die Suchform nach
    await knex('instrumente').where('ticker', 'NESN').update({ name: 'Nestlé AG' })
    gleich(await fuelleSuchNamen(knex), 1, 'geänderter Name: genau eine Zeile nachgezogen')
    gleich((await leseStamm(knex, { suche: 'nestle ag' })).map((t) => t.ticker), ['NESN'], 'neuer Name wird gefunden')
    // Kein Datenbank-eigenes Umwandeln mehr in der Abfrage — nur das trägt auf SQLite UND PostgreSQL gleich
    const quelle = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'stamm-speicher.js'), 'utf8')
    ok(!/upper\(|lower\(|ilike|unaccent/i.test(quelle.slice(quelle.indexOf('export async function leseStamm'))), 'leseStamm überlässt Gross/Klein und Akzente nicht der Datenbank')
    await knex('instrument_listungen').whereIn('instrumentId', neu.map((z) => z.id)).del()
    await knex('instrumente').whereIn('id', neu.map((z) => z.id)).del()
}
{
    // Datenbank aus der Zeit vor der Spalte: die Migration legt sie an und füllt bestehende Zeilen
    const alt = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    const add = async (table, column, buildCol) => {
        if (!(await alt.schema.hasTable(table))) return
        if (!(await alt.schema.hasColumn(table, column))) await alt.schema.alterTable(table, (t) => buildCol(t))
    }
    await migriereAktien(alt, add)
    await alt.schema.alterTable('instrumente', (t) => t.dropColumn('suchName'))
    await alt('instrumente').insert([{ anlageklasse: 'aktien', ticker: 'MUV2', name: 'Münchener Rück' }, { anlageklasse: 'aktien', ticker: 'OHNE', name: null }])
    ok(!(await alt.schema.hasColumn('instrumente', 'suchName')), 'Ausgangslage: Spalte fehlt')
    await migriereAktien(alt, add)
    gleich(await alt('instrumente').orderBy('ticker').select('ticker', 'suchName'), [{ ticker: 'MUV2', suchName: 'munchener ruck' }, { ticker: 'OHNE', suchName: null }], 'Migration: Spalte angelegt, bestehende Zeile nachgefüllt, ohne Namen bleibt leer')
    await alt.destroy()
}
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
gleich(ausgefalleneListen(stand), ['bitunix', 'pionex'], 'ausgefallen = Fehler oder leer; eine nicht gewählte Quelle ist kein Ausfall')

// ── 10. Fällt eine Kennzeichen-Liste aus, bleiben Bitunix und Pionex unberührt (Regel 4, Audit FUN-F-005) ──
{
    const frisch = async () => {
        const k = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
        await k.schema.createTable('settings', (t) => { t.increments('id').primary() })
        await migriereAktien(k, async () => {})
        return k
    }
    const aktiv = async (k, platz) => Number((await k('instrument_listungen').where({ handelsplatz: platz, aktiv: 1 }).count({ n: '*' }).first()).n)
    // 20 Aktien: Binance kennt 12, Bitget alle; Bitunix und Pionex führen alle 20 ohne Kennzeichen.
    const T = Array.from({ length: 20 }, (_, i) => 'AK' + String.fromCharCode(65 + i))
    const welt = {
        binance: T.slice(0, 12).map((t) => ({ symbol: t + 'USDT', baseAsset: t, quoteAsset: 'USDT', underlyingType: 'EQUITY', underlyingSubType: [] })),
        bitget: T.map((t) => ({ symbol: t + 'USDT', baseCoin: t, quoteCoin: 'USDT', isRwa: 'YES', maxLever: '10', symbolStatus: 'normal' })),
        bitunix: T.map((t) => ({ symbol: t + 'USDT', base: t, quote: 'USDT', maxLeverage: 10 })),
        pionex: T.map((t) => ({ symbol: t + 'X_USDT', baseCurrency: t + 'X', quoteCurrency: 'USDT' })),
    }
    const P = ['binance', 'bitget', 'bitunix', 'pionex']
    const ohneBitget = P.filter((p) => p !== 'bitget')
    const ausfall = { ausgefallen: ['bitget'] }

    // a) Bitget fällt einen Lauf lang aus
    let k = await frisch()
    let e = await speichereStamm(k, ordneAlle(welt), P, 1000)
    gleich([e.neu.length, e.eingefroren], [0, []], 'Ausgangslage, nichts eingefroren')
    e = await speichereStamm(k, ordneAlle({ ...welt, bitget: [] }), ohneBitget, 2000, ausfall)
    gleich(e.weg, [], 'Bitget ausgefallen: keine Bitunix-/Pionex-Listung abgeschaltet')
    gleich(e.eingefroren, ['bitunix', 'pionex'], 'Bitunix und Pionex für diesen Lauf unberührt')
    gleich([await aktiv(k, 'bitunix'), await aktiv(k, 'pionex'), await aktiv(k, 'bitget')], [20, 20, 20], 'alle Listungen bleiben aktiv')
    e = await speichereStamm(k, ordneAlle(welt), P, 3000)
    gleich([e.neu, e.weg, e.eingefroren], [[], [], []], 'Bitget wieder da: nichts «neu handelbar», nichts weg')
    // Danach meldet der Abgleich wieder — bei vollständigem Vorlauf ist neu wirklich neu
    const mehr = { ...welt, bitget: [...welt.bitget, { symbol: 'NEUUSDT', baseCoin: 'NEU', quoteCoin: 'USDT', isRwa: 'YES', symbolStatus: 'normal' }], bitunix: [...welt.bitunix, { symbol: 'NEUUSDT', base: 'NEU', quote: 'USDT' }] }
    e = await speichereStamm(k, ordneAlle(mehr), P, 4000)
    gleich(e.neu.map((l) => `${l.handelsplatz}:${l.ticker}`).sort(), ['bitget:NEU', 'bitunix:NEU'], 'echte Neulistung bei Bitunix wird weiter gemeldet')
    // Echte Delistung bei Bitunix wird weiter erkannt, wenn alle Kennzeichen-Listen da sind
    e = await speichereStamm(k, ordneAlle({ ...mehr, bitunix: welt.bitunix }), P, 5000)
    gleich(e.weg.map((l) => `${l.handelsplatz}:${l.symbol}`), ['bitunix:NEUUSDT'], 'echte Delistung bei Bitunix erkannt')
    // Ohne den Hinweis «ausgefallen» (alter Aufruf) galt: 16 weg, danach 16 «wieder» — der Beleg des Audits
    await k.destroy()

    // b) Bitget ist beim ALLERERSTEN Abgleich aus: der zweite Lauf meldet keine Nachzügler
    k = await frisch()
    e = await speichereStamm(k, ordneAlle({ ...welt, bitget: [] }), ohneBitget, 1000, ausfall)
    gleich([await aktiv(k, 'binance'), await aktiv(k, 'bitunix'), await aktiv(k, 'pionex')], [12, 0, 0], 'erster Lauf ohne Bitget: Binance gespeichert, Bitunix/Pionex noch nicht')
    e = await speichereStamm(k, ordneAlle(welt), P, 2000)
    gleich(e.neu, [], 'zweiter Lauf mit Bitget: Ausgangslage, keine Neulistungs-Meldung')
    gleich([await aktiv(k, 'bitunix'), await aktiv(k, 'pionex')], [20, 20], 'Bitunix/Pionex jetzt vollständig')
    await k.destroy()

    // c) Eine Kennzeichen-Liste kommt dazu, die der vorige Lauf nicht hatte (Binance neu als Marktdaten-Quelle):
    //    was sie bei Bitunix/Pionex zusätzlich einordnet, ist nicht neu gelistet.
    k = await frisch()
    const spaet = T.slice(15).map((t) => ({ symbol: t + 'USDT', baseAsset: t, quoteAsset: 'USDT', underlyingType: 'EQUITY', underlyingSubType: [] }))
    await speichereStamm(k, ordneAlle({ ...welt, binance: [], bitget: welt.bitget.slice(0, 15) }), ['bitget', 'bitunix', 'pionex'], 1000)
    gleich(await aktiv(k, 'bitunix'), 15, 'nur Bitget gelesen: 15 Bitunix-Aktien bekannt')
    e = await speichereStamm(k, ordneAlle({ ...welt, binance: spaet, bitget: welt.bitget.slice(0, 15) }), P, 2000)
    gleich([e.neu, await aktiv(k, 'bitunix'), await aktiv(k, 'pionex')], [[], 20, 20], 'Binance kommt dazu und kennt fünf weitere: bei Bitunix/Pionex gespeichert, nicht gemeldet')
    e = await speichereStamm(k, ordneAlle({ ...welt, binance: spaet, bitget: welt.bitget.slice(0, 15), bitunix: [...welt.bitunix, { symbol: 'AKPUSDT2', base: 'AKP', quote: 'USDT' }] }), P, 3000)
    gleich(e.neu.map((l) => `${l.handelsplatz}:${l.symbol}`), ['bitunix:AKPUSDT2'], 'im Lauf danach wird wieder gemeldet')
    await k.destroy()

    // d) Eine EINGEBROCHENE Kennzeichen-Liste (Regel 2) friert die Abgleich-Plätze ebenso ein
    k = await frisch()
    await speichereStamm(k, ordneAlle({ ...welt, binance: [] }), ['bitget', 'bitunix', 'pionex'], 1000)
    e = await speichereStamm(k, ordneAlle({ ...welt, binance: [], bitget: welt.bitget.slice(0, 4) }), ['bitget', 'bitunix', 'pionex'], 2000)
    gleich([e.gebremst, e.eingefroren, e.weg], [['bitget'], ['bitunix', 'pionex'], []], 'Bitget auf 4 von 20 eingebrochen: Störung, Bitunix/Pionex unberührt')
    gleich(await aktiv(k, 'bitunix'), 20, 'Bitunix behält alle 20')
    // Bitpanda oder Pionex fallen aus: das berührt die Einordnung von Bitunix nicht
    e = await speichereStamm(k, ordneAlle({ ...welt, binance: [] }), ['bitget', 'bitunix'], 3000, { ausgefallen: ['pionex', 'bitpanda'] })
    gleich(e.eingefroren, [], 'Ausfall eines Platzes ohne Kennzeichen friert nichts ein')
    await k.destroy()
}

await knex.destroy()
console.log(`✓ Stamm-Abgleich: ${n} Prüfungen`)
