/**
 * Selbsttest: Favoriten (Aktien und Coins) und Sparten-Filter. In-memory SQLite, ohne Netz.
 *
 *   node server/aktien/__selftest-favoriten.mjs
 *   FAVORITEN_TEST_PG=postgres://nutzer:passwort@127.0.0.1:5439/leer node server/aktien/__selftest-favoriten.mjs
 *
 * Geprüft wird, was still Falsches zeigen würde:
 *   - die Sparte einer FREMDEN Firma (Audit FUN-F-002: BYD Company als Boyd Gaming) —
 *     gemerkt und gezeigt wird sie nur bei sicherer Zuordnung, sonst «unbekannt»
 *   - ein Favorit, der verschwindet, weil der Radar ihn nicht bewertet hat
 *   - eine Note an einer Hürden-Zeile
 *   - die Coin-Favoriten-Seite, die an Favoriten oder Alarmen etwas ändert
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import knexLib from 'knex'
import { migriereAktien } from '../migrationen/aktien.js'
import { suchForm } from './stamm-speicher.js'
import { sparteAus, sparteGilt, brauchtSparte, SPARTE_FRISCH_MS, SPARTE_WIEDER_MS } from './sparte-kern.js'
import { leseSparten, merkeSparte, fuelleSparten } from './sparte.js'
import { favoritenZeilen, tagesstandAus, normTicker, MAX_FAVORITEN } from './favoriten-kern.js'
import { leseFavoriten, fuegeFavoritHinzu } from './favoriten.js'
import { coinFavoritenZeilen } from '../coin-radar/favoriten-kern.js'
import { leseCoinFavoriten } from '../coin-radar/favoriten.js'
import { spartenAuswahl, passtSparte, bereinigeFilter, sektorSchluessel, SEKTOR_SCHLUESSEL, UNBEKANNT } from '../../shared/aktien-sparte.js'
import { Gebremst, NichtGefunden } from '../newcomer-radar/kursquelle.js'

// Ohne Netz: hier ruft nichts ab — täte es das doch, fällt der Test.
globalThis.fetch = async (url) => { throw new Error(`Abruf im Selbsttest: ${url}`) }

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

/* ── 1. Sparte: wann sie als sicher gilt (rein) ──────────────────────── */

const nvidia = { name: 'NVIDIA Corporation', art: 'EQUITY', sektor: 'Technology', branche: 'Semiconductors' }
gleich(sparteAus(nvidia, 'Nvidia', 'NVDA'), { ok: true, sektor: 'Technology', branche: 'Semiconductors' }, 'Name passt → Sparte gilt')
gleich(sparteAus(nvidia, null, 'NVDA'), { ok: true, sektor: 'Technology', branche: 'Semiconductors' }, 'Stamm ohne Namen (nur Krypto-Börse): der Ticker gilt')
// FUN-F-002: BYD Company im Stamm, die Quelle liefert unter `BYD` Boyd Gaming.
gleich(sparteAus({ name: 'Boyd Gaming Corporation', art: 'EQUITY', sektor: 'Consumer Cyclical', branche: 'Resorts & Casinos' }, 'BYD Company', 'BYD'),
    { ok: false, grund: 'nameWiderspruch' }, 'fremde Firma unter demselben Ticker → unbekannt')
gleich(sparteAus({ name: 'Banco Santander, S.A.', art: 'EQUITY', sektor: 'Financial Services', branche: 'Banks - Diversified' }, 'Sanofi', 'SAN'),
    { ok: false, grund: 'nameWiderspruch' }, 'Sanofi gegen Banco Santander → unbekannt')
gleich(sparteAus({ name: 'SPDR S&P 500 ETF', art: 'ETF', sektor: null, branche: null }, 'SPDR S&P 500 ETF', 'SPY'), { ok: false, grund: 'keineAktie' }, 'ETF trägt keine Sparte')
gleich(sparteAus({ name: 'Irgendwas AG', art: 'EQUITY', sektor: null, branche: 'Software' }, 'Irgendwas', 'IRG'), { ok: false, grund: 'ohneAngabe' }, 'ohne Sektor keine Sparte — die Branche allein reicht nicht')
gleich(sparteAus(null, 'Nvidia', 'NVDA'), { ok: false, grund: 'keinProfil' }, 'kein Profil')

const gemerkt = { sektor: 'Technology', branche: 'Semiconductors', sparteSymbol: 'NVDA', sparteStand: 1000 }
gleich(sparteGilt(gemerkt, 'NVDA'), { sektor: 'Technology', branche: 'Semiconductors' }, 'gemerkte Sparte gilt für ihr Kurssymbol')
gleich(sparteGilt(gemerkt, 'NVDA.DE'), null, 'anderes Kurssymbol → unbekannt (Zuordnung hat gewechselt)')
gleich(sparteGilt(gemerkt, null), null, 'ohne Kurssymbol → unbekannt')
gleich(sparteGilt({ sektor: null, sparteSymbol: 'X' }, 'X'), null, 'gemerktes «unbekannt» bleibt unbekannt')

ok(brauchtSparte({}, 'NVDA', 5000), 'nie gefragt → fragen')
ok(!brauchtSparte({}, null, 5000), 'ohne Kurssymbol wird nie gefragt')
ok(!brauchtSparte(gemerkt, 'NVDA', 1000 + SPARTE_FRISCH_MS - 1), 'frisch → nicht fragen')
ok(brauchtSparte(gemerkt, 'NVDA', 1000 + SPARTE_FRISCH_MS + 1), 'veraltet → fragen')
ok(brauchtSparte(gemerkt, 'NVDA.DE', 2000), 'Kurssymbol gewechselt → fragen')
ok(!brauchtSparte({ sektor: null, sparteSymbol: 'X', sparteStand: 1000 }, 'X', 1000 + SPARTE_WIEDER_MS - 1), 'unbekannt: nicht täglich wieder fragen')
ok(brauchtSparte({ sektor: null, sparteSymbol: 'X', sparteStand: 1000 }, 'X', 1000 + SPARTE_WIEDER_MS + 1), 'unbekannt: nach einer Woche wieder')

/* ── 2. Filter (rein, geteilt mit der Oberfläche) ────────────────────── */

const feld = [
    { id: 'NVDA', sparte: { sektor: 'Technology', branche: 'Semiconductors' } },
    { id: 'AMD', sparte: { sektor: 'Technology', branche: 'Semiconductors' } },
    { id: 'MSFT', sparte: { sektor: 'Technology', branche: 'Software - Infrastructure' } },
    { id: 'JPM', sparte: { sektor: 'Financial Services', branche: 'Banks - Diversified' } },
    { id: 'XOM', sparte: { sektor: 'Energy', branche: null } },
    { id: 'BYD', sparte: null },
    { id: 'SPY' },
]
const auswahl = spartenAuswahl(feld)
gleich(auswahl.unbekannt, 2, 'zwei Titel ohne Sparte')
gleich(auswahl.sektoren.map((s) => [s.sektor, s.anzahl]), [['Energy', 1], ['Financial Services', 1], ['Technology', 3]], 'Sektoren mit Anzahl, nach Namen')
gleich(auswahl.sektoren[2].branchen, [{ branche: 'Semiconductors', anzahl: 2 }, { branche: 'Software - Infrastructure', anzahl: 1 }], 'Branchen des Sektors')
const ids = (filter) => feld.filter((z) => passtSparte(z, filter)).map((z) => z.id)
gleich(ids({}), feld.map((z) => z.id), 'leerer Filter zeigt alles')
gleich(ids({ sektor: 'Technology' }), ['NVDA', 'AMD', 'MSFT'], 'Sektor')
gleich(ids({ sektor: 'Technology', branche: 'Semiconductors' }), ['NVDA', 'AMD'], 'Sektor und Branche')
gleich(ids({ sektor: UNBEKANNT }), ['BYD', 'SPY'], '«unbekannt» zeigt genau die Titel ohne Sparte')
ok(!ids({ sektor: 'Energy' }).includes('BYD'), 'ein gewählter Sektor zeigt nie einen Titel ohne Sparte')
gleich(bereinigeFilter({ sektor: 'Technology', branche: 'Weg' }, auswahl), { sektor: 'Technology', branche: '' }, 'verschwundene Branche fällt aus dem Filter')
gleich(bereinigeFilter({ sektor: 'Utilities', branche: '' }, auswahl), { sektor: '', branche: '' }, 'verschwundener Sektor fällt aus dem Filter')
gleich(bereinigeFilter({ sektor: UNBEKANNT }, { sektoren: [], unbekannt: 0 }), { sektor: '', branche: '' }, '«unbekannt» ohne solche Titel fällt aus dem Filter')
gleich(sektorSchluessel('Technology'), 'technologie', 'Sektor → Übersetzungsschlüssel')
gleich(sektorSchluessel('Neuer Sektor'), null, 'unbekannter Sektorname bleibt, wie die Quelle ihn nennt')

/* ── 3. Datenbank: Migration, Sparte merken und nachfüllen ───────────── */

// Vorgabe SQLite im Speicher. Mit `FAVORITEN_TEST_PG=postgres://…` läuft derselbe Test gegen eine (leere, wegwerfbare) PostgreSQL.
const knex = process.env.FAVORITEN_TEST_PG
    ? knexLib({ client: 'pg', connection: process.env.FAVORITEN_TEST_PG })
    : knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
await knex('settings').insert({ id: 1 })
const spalteDazu = async (table, column, buildCol) => {
    if (!(await knex.schema.hasTable(table))) return
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => buildCol(t))
}
await knex.schema.createTable('coinradar_laeufe', (t) => {
    t.increments('id').primary(); t.string('status'); t.bigInteger('erstelltAm'); t.bigInteger('beendetAm'); t.text('quellenStand')
})
await knex.schema.createTable('coinradar_zeilen', (t) => {
    t.increments('id').primary(); t.integer('laufId'); t.string('symbol'); t.integer('note'); t.integer('rang'); t.string('status')
    t.text('huerdeGrund'); t.double('umsatz24h'); t.double('spreadBp'); t.double('fundingJahresRate'); t.double('atrPct'); t.double('rvol'); t.double('adx')
    t.integer('noteAusfuehrung'); t.text('jeZeiteinheit'); t.text('teilnoten'); t.text('boersen')
})
await migriereAktien(knex, spalteDazu)
await migriereAktien(knex, spalteDazu)   // ein zweiter Start darf nichts umwerfen
ok(await knex.schema.hasTable('aktien_favoriten'), 'Tabelle aktien_favoriten angelegt')
ok(await knex.schema.hasColumn('instrumente', 'sparteSymbol') && await knex.schema.hasColumn('instrumente', 'sparteStand'), 'Sparten-Spalten am Stamm')

async function lege(ticker, name, plaetze, mehr = {}) {
    const [id] = await knex('instrumente').insert({ anlageklasse: 'aktien', ticker, unterart: 'aktie', name, suchName: name ? suchForm(name) : null, stand: 1, createdAt: 1, ...mehr }).returning('id')
    const instrumentId = typeof id === 'object' ? id.id : id
    for (const [handelsplatz, symbol, art] of plaetze) {
        await knex('instrument_listungen').insert({ instrumentId, handelsplatz, symbol, art, quote: 'USDT', sicher: 1, aktiv: 1, ersteSichtung: 1, letzteSichtung: 1 })
    }
    return instrumentId
}
const idNvda = await lege('NVDA', 'Nvidia', [['bitget', 'NVDAUSDT', 'perp'], ['bitpanda', 'NVDA', 'broker-spot']])
await lege('INTC', null, [['bitget', 'INTCUSDT', 'perp']])
await lege('BYD', 'BYD Company', [['binance', 'BYDUSDT', 'perp']], { region: 'HK' })   // fremde Region: kein Kurssymbol aus dem Ticker
await lege('BOYD', 'BYD Company', [['bitget', 'BOYDUSDT', 'perp']])                    // Name widerspricht der Quelle
await lege('SPY', 'SPDR S&P 500 ETF', [['bitget', 'SPYUSDT', 'perp']], { unterart: 'etf' })
await lege('NESN', 'Nestlé', [['bitpanda', 'NESN', 'broker-spot']])                    // kein Future
await lege('AMD', 'Advanced Micro Devices', [['bitget', 'AMDUSDT', 'perp']])
await lege('WEG', 'Wegfall Inc', [['bitget', 'WEGUSDT', 'perp']])

const antwort = (name, art, sektor, branche) => ({ quoteSummary: { result: [{ price: { longName: name, quoteType: art }, assetProfile: { sector: sektor, industry: branche } }] } })
const QUELLE = {
    NVDA: antwort('NVIDIA Corporation', 'EQUITY', 'Technology', 'Semiconductors'),
    INTC: antwort('Intel Corporation', 'EQUITY', 'Technology', 'Semiconductors'),
    BOYD: antwort('Boyd Gaming Corporation', 'EQUITY', 'Consumer Cyclical', 'Resorts & Casinos'),
    SPY: antwort('SPDR S&P 500 ETF', 'ETF', undefined, undefined),
    AMD: antwort('Advanced Micro Devices, Inc.', 'EQUITY', 'Technology', 'Semiconductors'),
}
const gefragt = []
const abruf = async (symbol, module) => {
    gefragt.push(symbol)
    ok(module === 'assetProfile,price', 'der Nachfüller holt nur die zwei Module, die er braucht')
    if (!QUELLE[symbol]) throw new NichtGefunden('unbekanntes Symbol')
    return QUELLE[symbol]
}
const alle = ['NVDA', 'INTC', 'BYD', 'BOYD', 'SPY', 'NESN', 'AMD', 'WEG']
const lauf1 = await fuelleSparten(knex, { tickers: alle, pauseMs: 0, jetzt: 10_000, abruf })
ok(!gefragt.includes('BYD'), 'BYD Company (Hongkong) wird NIE unter dem blossen Ticker gefragt')
gleich([lauf1.gemerkt, lauf1.unbekannt, lauf1.grund], [3, 4, null], 'drei sicher (NVDA, INTC, AMD), vier unbekannt (BOYD, SPY, NESN, WEG)')
let sparten = await leseSparten(knex, alle)
gleich(sparten.get('NVDA'), { sektor: 'Technology', branche: 'Semiconductors' }, 'NVDA: Sparte gemerkt')
gleich(sparten.get('INTC'), { sektor: 'Technology', branche: 'Semiconductors' }, 'INTC ohne Namen im Stamm: der Ticker des Futures gilt')
gleich(sparten.get('BOYD'), null, 'Namenswiderspruch → unbekannt, nicht «Resorts & Casinos»')
gleich(sparten.get('BYD'), null, 'BYD Company → unbekannt')
gleich(sparten.get('SPY'), null, 'ETF → unbekannt')
ok((await knex('instrumente').where('ticker', 'BOYD').first()).sektor == null, 'die Sparte der fremden Firma steht auch nicht in der Datenbank')

// Zweiter Lauf direkt danach: nichts ist veraltet, also kein einziger Abruf.
gefragt.length = 0
await fuelleSparten(knex, { tickers: alle, pauseMs: 0, jetzt: 20_000, abruf })
gleich(gefragt, [], 'frische Stände kosten keinen Abruf')

// Bremst die Quelle, hört der Nachfüller auf und merkt KEIN «unbekannt».
await lege('TSLA', 'Tesla', [['bitget', 'TSLAUSDT', 'perp']])
await lege('AAPL', 'Apple', [['bitget', 'AAPLUSDT', 'perp']])
gefragt.length = 0
const gebremst = await fuelleSparten(knex, { tickers: ['TSLA', 'AAPL'], pauseMs: 0, jetzt: 30_000, abruf: async (s) => { gefragt.push(s); throw new Gebremst('HTTP 429') } })
gleich([gebremst.grund, gefragt.length], ['gebremst', 1], 'nach der ersten Bremse wird nicht weitergefragt')
ok((await knex('instrumente').where('ticker', 'TSLA').first()).sparteStand == null, 'ein gebremster Abruf zählt nicht als «gefragt»')

// Wechselt die Zuordnung (neues Kurssymbol), ist die alte Sparte nicht mehr gültig.
await knex('newcomer_titel').insert({ instrumentId: await knex('instrumente').where('ticker', 'NESN').first('id').then((z) => z.id), kursSymbol: 'NESN.SW', zuordnung: 'suche', kennzahlen: JSON.stringify({ kurs: 80, waehrung: 'CHF', abstandHochPct: -22, perf3m: -5 }), stand: 40_000 })
await merkeSparte(knex, { ticker: 'NESN' }, 'NESN.SW', { name: 'Nestlé S.A.', art: 'EQUITY', sektor: 'Consumer Defensive', branche: 'Packaged Foods' }, 40_000)
gleich((await leseSparten(knex, ['NESN'])).get('NESN'), { sektor: 'Consumer Defensive', branche: 'Packaged Foods' }, 'Titel-Seite merkt die Sparte nebenbei')
await knex('newcomer_titel').where('kursSymbol', 'NESN.SW').update({ kursSymbol: 'NESN.XX' })
gleich((await leseSparten(knex, ['NESN'])).get('NESN'), null, 'neues Kurssymbol → Sparte wieder unbekannt')
await knex('newcomer_titel').where('kursSymbol', 'NESN.XX').update({ kursSymbol: 'NESN.SW' })
await merkeSparte(knex, { ticker: 'BOYD' }, 'BOYD', { name: 'Boyd Gaming Corporation', art: 'EQUITY', sektor: 'Consumer Cyclical', branche: 'Resorts & Casinos' }, 50_000)
gleich((await leseSparten(knex, ['BOYD'])).get('BOYD'), null, 'auch die Titel-Seite merkt die Sparte einer fremden Firma nicht')

/* ── 4. Favoriten Aktien ─────────────────────────────────────────────── */

gleich(normTicker(' nvda '), 'NVDA', 'Ticker wird normiert')
gleich(normTicker('NV DA'), null, 'kein Ticker')
gleich(normTicker("X'; drop table"), null, 'kein Ticker')
gleich((await fuegeFavoritHinzu(knex, 'gibtsnicht')).status, 404, 'nur Titel des Stamms lassen sich merken')
for (const t of ['NVDA', 'BOYD', 'NESN', 'AMD', 'WEG']) gleich((await fuegeFavoritHinzu(knex, t, 60_000)).body, { ok: true, ticker: t, neu: true }, `${t} gemerkt`)
gleich((await fuegeFavoritHinzu(knex, 'nvda')).body, { ok: true, ticker: 'NVDA', neu: false }, 'ein zweiter Klick legt keine zweite Zeile an')
gleich(Number((await knex('aktien_favoriten').count({ n: '*' }).first()).n), 5, 'fünf Favoriten')

let seite = await leseFavoriten(knex)
gleich(seite.lauf, null, 'noch kein Lauf')
gleich(new Set(seite.favoriten.map((f) => f.status)), new Set(['keinLauf']), 'ohne Lauf sagt jeder Favorit «noch kein Lauf»')

// Ein fertiger Aktien-Lauf: NVDA bewertet, BOYD an einer Hürde, AMD gar nicht dabei. Davor ein fertiger KRYPTO-Lauf, der nicht zählen darf.
await knex('coinradar_laeufe').insert({ status: 'fertig', anlageklasse: 'krypto', erstelltAm: 1, beendetAm: 2, quellenStand: '{}' })
const [laufRoh] = await knex('coinradar_laeufe').insert({ status: 'fertig', anlageklasse: 'aktien', erstelltAm: 70_000, beendetAm: 71_000, quellenStand: JSON.stringify({ referenz: { ticker: 'SPY' } }) }).returning('id')
const laufId = typeof laufRoh === 'object' ? laufRoh.id : laufRoh
const zeile = (symbol, ticker, mehr) => ({ laufId, symbol, boersen: JSON.stringify({ ticker }), jeZeiteinheit: '{}', teilnoten: '{}', huerdeGrund: '', ...mehr })
await knex('coinradar_zeilen').insert([
    zeile('NVDAUSDT', 'NVDA', {
        status: 'bewertet', rang: 3, note: 71, teilnoten: JSON.stringify({ staerke: 80, hochNaehe: 60, imSpiel: 70, bewegung: 65, trend: 75 }),
        jeZeiteinheit: JSON.stringify({ tages: { staerkeRang: 88, abstandHochPct: -12.4, zahlenIn: 2, zahlenZeit: 99_000, zahlenGeschaetzt: true } }),
    }),
    zeile('BOYDUSDT', 'BOYD', { status: 'huerde', huerdeGrund: 'umsatz_zu_klein', rang: 0, note: 0 }),
])
seite = await leseFavoriten(knex)
gleich(seite.lauf, { id: laufId, zeit: 71_000, referenz: 'SPY' }, 'der letzte fertige AKTIEN-Lauf, nicht der Krypto-Lauf')
const je = Object.fromEntries(seite.favoriten.map((f) => [f.ticker, f]))
gleich(seite.favoriten.map((f) => f.ticker), ['NVDA', 'AMD', 'BOYD', 'NESN', 'WEG'], 'kein Favorit verschwindet; bewertete zuerst')
gleich([je.NVDA.status, je.NVDA.rang, je.NVDA.note, je.NVDA.staerkeRang, je.NVDA.abstandHochPct, je.NVDA.zahlenIn, je.NVDA.zahlenGeschaetzt, je.NVDA.abstandHochQuelle],
    ['bewertet', 3, 71, 88, -12.4, 2, true, 'lauf'], 'NVDA: Note, Rang, Stärke, Abstand zum Hoch, Zahlentermin aus dem Lauf')
gleich(je.NVDA.teilnoten.staerke, 80, 'NVDA: Teilnoten')
gleich(je.NVDA.sparte, { sektor: 'Technology', branche: 'Semiconductors' }, 'NVDA: Sparte')
gleich(je.NVDA.listungen.map((l) => l.handelsplatz).sort(), ['bitget', 'bitpanda'], 'NVDA: handelbar bei')
gleich(je.NVDA.chart, { bitget: 'NVDAUSDT' }, 'NVDA: Sprung in den Chart über das Future-Symbol der Börse')
gleich([je.BOYD.status, je.BOYD.huerdeGrund, je.BOYD.note, je.BOYD.rang, je.BOYD.sparte], ['huerde', 'umsatz_zu_klein', null, null, null],
    'an der Hürde gescheitert: sagt es, trägt KEINE Note (die Spalte steht auf 0) und keine geratene Sparte')
gleich([je.AMD.status, je.AMD.note], ['nichtImLauf', null], 'Future vorhanden, aber nicht im Lauf: bleibt sichtbar und sagt es')
gleich([je.NESN.status, je.NESN.chart], ['ohneFuture', null], 'ohne Future: bleibt sichtbar, kein Chart-Sprung')
gleich([je.NESN.abstandHochPct, je.NESN.abstandHochQuelle], [-22, 'tagesstand'], 'Abstand zum Hoch als Rückfall aus dem Tagesstand, als solcher gekennzeichnet')

// Fällt ein Favorit aus dem Stamm, bleibt er mit seinem gemerkten Namen stehen.
const idWeg = (await knex('instrumente').where('ticker', 'WEG').first()).id
await knex('instrument_listungen').where('instrumentId', idWeg).del()
await knex('instrumente').where('id', idWeg).del()
seite = await leseFavoriten(knex)
const weg = seite.favoriten.find((f) => f.ticker === 'WEG')
gleich([weg.status, weg.name, weg.listungen], ['nichtImStamm', 'Wegfall Inc', []], 'aus dem Stamm gefallen: bleibt mit Namen stehen')

// Tagesstand nur zum Kurssymbol, das heute gilt.
gleich(tagesstandAus({ kursSymbol: 'SAN.PA', kennzahlen: '{"kurs":90}', stand: 1 }, 'SAN'), null, 'Tagesstand eines anderen Kurssymbols zählt nicht')
gleich(tagesstandAus({ kursSymbol: 'NVDA', kennzahlen: 'kaputt', stand: 1 }, 'NVDA'), null, 'unlesbarer Tagesstand → keiner')
gleich(tagesstandAus({ kursSymbol: 'NVDA', kennzahlen: '{"kurs":120,"waehrung":"USD","abstandHochPct":-30}', stand: 7 }, 'NVDA'),
    { kurs: 120, waehrung: 'USD', abstandHochPct: -30, perf3m: null, stand: 7 }, 'Tagesstand gelesen')

// Zwei Kontrakte desselben Titels: die bewertete Zeile gewinnt gegen die Hürden-Zeile.
const doppelt = favoritenZeilen([{ ticker: 'X' }], {
    lauf: { id: 1 }, stamm: new Map([['X', { name: 'X AG', unterart: 'aktie', listungen: [{ handelsplatz: 'bitget', art: 'perp', symbol: 'XUSDT' }] }]]),
    zeilen: [{ symbol: 'XSTOCKUSDT', status: 'huerde', huerdeGrund: 'spread_zu_weit', boersen: { ticker: 'X' } }, { symbol: 'XUSDT', status: 'bewertet', rang: 9, note: 55, boersen: { ticker: 'X' } }],
})
gleich([doppelt[0].status, doppelt[0].symbol, doppelt[0].note], ['bewertet', 'XUSDT', 55], 'von zwei Kontrakten zählt der bewertete')
ok(MAX_FAVORITEN >= 50, 'die Merkliste fasst genug Titel')

/* ── 5. Favoriten Coins: bestehende Liste, nur gelesen ───────────────── */

await knex.schema.createTable('hype_favoriten', (t) => {
    t.increments('id').primary(); t.string('symbol'); t.text('name'); t.string('chain').defaultTo(''); t.string('contractAddress').defaultTo('')
    t.string('pairAddress').defaultTo(''); t.string('narrative').defaultTo(''); t.bigInteger('erstelltAm'); t.integer('stumm').defaultTo(0)
    t.string('quelle').defaultTo('hype'); t.text('letzteDaten').defaultTo('{}')
})
await knex.schema.createTable('hype_alarme', (t) => { t.increments('id').primary(); t.integer('favoritId'); t.string('regel'); t.integer('gelesen').defaultTo(0); t.bigInteger('erstelltAm') })
await knex.schema.createTable('hype_candidates', (t) => {
    t.increments('id').primary(); t.string('symbol'); t.string('chain'); t.integer('hypeScore'); t.integer('safetyScore'); t.string('status'); t.text('verworfenGrund'); t.bigInteger('erstelltAm')
})
await knex('hype_favoriten').insert([
    { symbol: 'SOLUSDT', quelle: 'coinradar', erstelltAm: 1 },
    { symbol: 'XRPUSDT', quelle: 'coinradar', erstelltAm: 2, stumm: 1 },
    { symbol: 'DOGEUSDT', quelle: 'coinradar', erstelltAm: 3 },
    { symbol: 'PEPE', name: 'Pepe', chain: 'solana', contractAddress: 'abc', quelle: 'hype', erstelltAm: 4 },
])
await knex('hype_alarme').insert([{ favoritId: 1, regel: 'preisSprung', gelesen: 0, erstelltAm: 5 }, { favoritId: 1, regel: 'preisSprung', gelesen: 1, erstelltAm: 6 }])
await knex('hype_candidates').insert([
    { symbol: 'PEPE', chain: 'solana', hypeScore: 40, safetyScore: 50, status: 'bewertet', verworfenGrund: '', erstelltAm: 10 },
    { symbol: 'PEPE', chain: 'solana', hypeScore: 66, safetyScore: 72, status: 'bestanden', verworfenGrund: '', erstelltAm: 20 },
])
const [kryptoRoh] = await knex('coinradar_laeufe').insert({ status: 'fertig', anlageklasse: 'krypto', erstelltAm: 80_000, beendetAm: 81_000, quellenStand: '{}' }).returning('id')
const kryptoLauf = typeof kryptoRoh === 'object' ? kryptoRoh.id : kryptoRoh
await knex('coinradar_zeilen').insert([
    { laufId: kryptoLauf, symbol: 'SOLUSDT', status: 'bewertet', rang: 4, note: 77, atrPct: 2.5, rvol: 1.4, adx: 31, fundingJahresRate: 9, teilnoten: JSON.stringify({ bewegung: 70 }), boersen: '{}', jeZeiteinheit: '{}' },
    { laufId: kryptoLauf, symbol: 'XRPUSDT', status: 'huerde', huerdeGrund: 'spread_zu_weit', rang: 0, note: 0, atrPct: 0, teilnoten: '{}', boersen: '{}', jeZeiteinheit: '{}' },
])
const vorher = JSON.stringify([await knex('hype_favoriten').orderBy('id'), await knex('hype_alarme').orderBy('id')])
const coins = await leseCoinFavoriten(knex)
gleich(JSON.stringify([await knex('hype_favoriten').orderBy('id'), await knex('hype_alarme').orderBy('id')]), vorher, 'die Seite ändert weder Favoriten noch Alarme')
gleich(coins.lauf, { id: kryptoLauf, zeit: 81_000 }, 'der letzte fertige KRYPTO-Lauf, nicht der Aktien-Lauf')
gleich(coins.favoriten.map((f) => f.symbol), ['SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'PEPE'], 'alle vier Favoriten, bewertete zuerst, DEX-Funde zuletzt')
const jeCoin = Object.fromEntries(coins.favoriten.map((f) => [f.symbol, f]))
gleich([jeCoin.SOLUSDT.status, jeCoin.SOLUSDT.rang, jeCoin.SOLUSDT.note, jeCoin.SOLUSDT.alarmeUngelesen], ['bewertet', 4, 77, 1], 'SOL: Rang, Note, ein ungelesener Alarm')
gleich([jeCoin.XRPUSDT.status, jeCoin.XRPUSDT.huerdeGrund, jeCoin.XRPUSDT.note, jeCoin.XRPUSDT.atrPct, jeCoin.XRPUSDT.stumm], ['huerde', 'spread_zu_weit', null, null, true],
    'XRP: an der Hürde gescheitert, keine Note und keine Kennzahl aus der Null-Vorgabe, stumm')
gleich(jeCoin.DOGEUSDT.status, 'nichtImLauf', 'DOGE: nicht im Lauf, bleibt sichtbar')
gleich([jeCoin.PEPE.art, jeCoin.PEPE.status, jeCoin.PEPE.pruefung.hypeScore, jeCoin.PEPE.pruefung.zeit], ['dex', 'geprueft', 66, 20], 'Hype-Fund: die JÜNGSTE Prüfung')
gleich(coinFavoritenZeilen([{ id: 9, symbol: 'ABC', chain: 'base', contractAddress: '0x1', quelle: 'hype' }])[0].status, 'ohnePruefung', 'Hype-Fund ohne gespeicherte Prüfung sagt das')
gleich(coinFavoritenZeilen([{ id: 9, symbol: 'BTCUSDT', quelle: 'coinradar' }])[0].status, 'keinLauf', 'ohne Lauf: «noch kein Lauf»')

/* ── 6. Rundherum: Backup, Texte ─────────────────────────────────────── */

const lies = (pfad) => readFileSync(new URL(pfad, import.meta.url), 'utf8')
const backup = lies('../backup-api.js')
gleich((backup.match(/'aktien_favoriten'/g) || []).length, 2, 'aktien_favoriten steht in beiden Backup-Listen (sichern und löschen)')
ok(lies('../database.js').includes("'aktien_favoriten'"), 'aktien_favoriten in der Liste der PostgreSQL-Zähler')
for (const sprache of ['de', 'en']) {
    const texte = JSON.parse(lies(`../../src/i18n/locales/${sprache}.json`))
    for (const schluessel of Object.values(SEKTOR_SCHLUESSEL)) ok(typeof texte.sparte?.['sektor_' + schluessel] === 'string', `Sektor ${schluessel} übersetzt (${sprache})`)
    for (const status of ['bewertet', 'huerde', 'nichtImLauf', 'ohneFuture', 'keinLauf', 'nichtImStamm']) {
        ok(texte.favoriten?.['status_' + status] && texte.favoriten?.['statusInfo_' + status], `Aktien-Status ${status} hat Text und Erklärung (${sprache})`)
    }
    for (const status of ['bewertet', 'huerde', 'nichtImLauf', 'keinLauf', 'geprueft', 'ohnePruefung']) {
        ok(texte.coinFavoriten?.['status_' + status] && texte.coinFavoriten?.['statusInfo_' + status], `Coin-Status ${status} hat Text und Erklärung (${sprache})`)
    }
}
void idNvda

await knex.destroy()
console.log(`✓ Favoriten und Sparte: ${n} Prüfungen`)
