/**
 * Selbsttest: Aktien für die Anzeigen (`esp32-aktien.js`, `esp32-alarme.js`).
 *
 *   node server/__selftest-esp32-aktien.mjs
 *
 * Ohne Netz. Geprüft wird, dass ein Aktien-Symbol nicht zum Fehler wird, dass
 * die geschlossene Börse ein ZUSTAND ist, dass kein bestehendes Antwortfeld
 * verschwindet oder anders heisst (Firmware im Feld) — und dass ein Coin nie
 * auf eine Aktie umgebogen wird.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import knexLib from 'knex'
import {
    boersenZustand, tickerAus, waehleListung, aktienFelder, boerseZuAntwort, aktienTitelFuer, aktienSymbole,
    leereEsp32AktienMerk, ALT_AB_KERZEN,
} from './esp32-aktien.js'
import { kursSymbol, kursAntwort } from './esp32-kurs.js'
import { ausloesungenAus } from './esp32-alarme.js'
import { SITZUNGEN } from '../shared/aktien-sitzung.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }
const utc = (j, m, t, h = 0, min = 0) => Date.UTC(j, m - 1, t, h, min)

const MONTAG_OFFEN = utc(2026, 11, 16, 16, 0)     // 11:00 New York
const SONNTAG = utc(2026, 11, 15, 16, 0)
const MONTAG_NACHT = utc(2026, 11, 17, 3, 0)      // 22:00 New York
const FEIERTAG = utc(2026, 11, 26, 16, 0)         // Thanksgiving

// ── 1. Sitzung als Zustand ──────────────────────────────────────────────
gleich(boersenZustand(MONTAG_OFFEN), { sitzung: 'regulaer', boerseOffen: true, handelstag: '2026-11-16' }, 'Montag 11:00 New York: Börse offen')
gleich(boersenZustand(SONNTAG), { sitzung: 'wochenende', boerseOffen: false, handelstag: '2026-11-15' }, 'Sonntag: Börse zu (Wochenende)')
gleich(boersenZustand(FEIERTAG).sitzung, 'feiertag', 'Thanksgiving: Feiertag')
gleich(boersenZustand(MONTAG_NACHT), { sitzung: 'nacht', boerseOffen: false, handelstag: '2026-11-17' }, 'Nacht: Börse zu, gehört zum folgenden Handelstag')
for (const ms of [MONTAG_OFFEN, SONNTAG, MONTAG_NACHT, FEIERTAG, utc(2026, 11, 16, 13), utc(2026, 11, 16, 22)]) {
    const z = boersenZustand(ms)
    ok(SITZUNGEN.includes(z.sitzung) && z.boerseOffen === (z.sitzung === 'regulaer'), `Sitzung ${z.sitzung}: offen nur in der regulären Sitzung`)
}

// ── 2. Symbol ───────────────────────────────────────────────────────────
gleich([tickerAus('nvda'), tickerAus('NVDAUSDT'), tickerAus('brk.b'), tickerAus('nvda/usdt'), tickerAus('')], ['NVDA', 'NVDA', 'BRK.B', 'NVDA', ''], 'Ticker aus der Eingabe des Geräts')
const STAMM = [
    { symbol: 'NVDAUSDT', ticker: 'NVDA', name: 'NVIDIA', handelsplatz: 'binance' },
    { symbol: 'NVDASTOCKUSDT', ticker: 'NVDA', name: 'NVIDIA', handelsplatz: 'bitget' },
    { symbol: 'BRKBUSDT', ticker: 'BRK.B', name: 'Berkshire', handelsplatz: 'binance' },
    { symbol: 'ARMSTOCKUSDT', ticker: 'ARM', name: 'Arm Holdings', handelsplatz: 'bitget' },
]
gleich(waehleListung(STAMM, 'NVDAUSDT', 'nvda', 'binance')?.symbol, 'NVDAUSDT', 'Binance: NVDA → NVDAUSDT')
gleich(waehleListung(STAMM, 'NVDAUSDT', 'nvda', 'bitget')?.symbol, 'NVDASTOCKUSDT', 'Bitget: NVDA heisst dort anders — der Stamm weiss es')
gleich(waehleListung(STAMM, 'NVDAUSDT', 'nvda', 'bitget', { nurGenau: true }), null, 'genau gefragt: das Symbol selbst gibt es bei Bitget nicht')
gleich(waehleListung(STAMM, 'BRKBUSDT', 'brk.b', 'binance')?.ticker, 'BRK.B', 'Ticker mit Punkt')
gleich(waehleListung(STAMM, 'BRKBUSDT', 'brkb', 'bitget'), null, 'nur an einer anderen Börse gelistet: kein Treffer')
gleich(waehleListung(STAMM, 'BTCUSDT', 'btc', 'binance'), null, 'BTC ist keine Aktie')
gleich(waehleListung(STAMM, 'NVDAUSDT', 'nvda', null), null, 'ohne Marktdatenquelle kein Treffer')
gleich(waehleListung([], 'NVDAUSDT', 'nvda', 'binance'), null, 'leerer Stamm: alles ist Coin')
// Ein Coin, dessen Kürzel auch ein Aktien-Ticker ist: genau gefragt bleibt er ein Coin
gleich(waehleListung(STAMM, 'ARMUSDT', 'arm', 'bitget', { nurGenau: true }), null, 'ARMUSDT (Coin) wird nicht auf die ARM-Aktie umgebogen, solange die Quelle das Symbol kennt')
gleich(kursSymbol('nvda'), 'NVDAUSDT', 'Symbol-Säuberung der Geräte unverändert')

// ── 3. Kurs-Antwort ─────────────────────────────────────────────────────
const SCHRITT = 15 * 60_000
const kerzen = (bis, anzahl = 96) => Array.from({ length: anzahl }, (_, i) => {
    const t = bis - (anzahl - i) * SCHRITT
    return { t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 5 }
})
{
    const roh = kerzen(MONTAG_OFFEN)
    const grund = kursAntwort('NVDAUSDT', '24h', roh, 96)
    const mit = { ...grund, ...aktienFelder({ ticker: 'NVDA', name: 'NVIDIA' }, roh, '15m', MONTAG_OFFEN) }
    // Kein bestehendes Feld fehlt oder hat sich geändert
    for (const feld of ['symbol', 'spanne', 'jetzt', 'start', 'hoch', 'tief', 'aenderung', 'kerzen']) {
        gleich(mit[feld], grund[feld], `Kurs-Antwort: Feld ${feld} unverändert`)
    }
    gleich([mit.anlageklasse, mit.ticker, mit.name, mit.sitzung, mit.boerseOffen, mit.veraltet], ['aktien', 'NVDA', 'NVIDIA', 'regulaer', true, false], 'Zusatzfelder während der Sitzung')
    gleich(mit.kerzeZeit, roh.at(-1).t, 'Zeit der letzten Kerze')
    // Wochenende mit laufenden Kerzen: Zustand «Börse zu», Chart bleibt
    const we = { ...kursAntwort('NVDAUSDT', '24h', kerzen(SONNTAG), 96), ...aktienFelder({ ticker: 'NVDA' }, kerzen(SONNTAG), '15m', SONNTAG) }
    gleich([we.sitzung, we.boerseOffen, we.veraltet, we.kerzen.length], ['wochenende', false, false, 96], 'Wochenende: Börse zu als Zustand, Kerzen bleiben, nichts «veraltet»')
    gleich(we.name, null, 'unbekannter Name bleibt null')
    // Steht die Quelle still, ist die letzte Kerze alt — gesagt, nicht verschwiegen
    const alt = aktienFelder({ ticker: 'NVDA' }, kerzen(SONNTAG - (ALT_AB_KERZEN + 2) * SCHRITT), '15m', SONNTAG)
    gleich(alt.veraltet, true, 'letzte Kerze älter als drei Kerzenlängen: veraltet')
    gleich(aktienFelder({ ticker: 'NVDA' }, [{ o: 1, h: 1, l: 1, c: 1 }], '15m', SONNTAG).veraltet, null, 'Kerzen ohne Zeit: unbekannt, nicht «frisch»')
}
{
    // Keine Kerzen: bei geschlossener Börse ein Zustand, in der Sitzung ein Fehler (wie bisher)
    gleich(kursAntwort('NVDAUSDT', '24h', [], 96), null, 'ohne Kerzen gibt es keine gewöhnliche Antwort')
    const zu = boerseZuAntwort('NVDAUSDT', '24h', { ticker: 'NVDA', name: 'NVIDIA' }, SONNTAG)
    gleich([zu.zustand, zu.sitzung, zu.boerseOffen, zu.kerzen, zu.anlageklasse], ['boerseZu', 'wochenende', false, [], 'aktien'], 'Wochenende ohne Kerzen: Zustand «Börse zu»')
    for (const feld of ['symbol', 'spanne', 'jetzt', 'start', 'hoch', 'tief', 'aenderung', 'kerzen']) {
        ok(feld in zu, `«Börse zu»-Antwort trägt das Feld ${feld}`)
    }
    ok(!('error' in zu) && !('aus' in zu), '«Börse zu» ist weder Fehler noch «Marktdaten aus»')
    gleich(boerseZuAntwort('NVDAUSDT', '24h', { ticker: 'NVDA' }, FEIERTAG)?.sitzung, 'feiertag', 'Feiertag ohne Kerzen: Zustand')
    gleich(boerseZuAntwort('NVDAUSDT', '24h', { ticker: 'NVDA' }, MONTAG_NACHT)?.sitzung, 'nacht', 'Nacht ohne Kerzen: Zustand')
    gleich(boerseZuAntwort('NVDAUSDT', '24h', { ticker: 'NVDA' }, MONTAG_OFFEN), null, 'offene Börse ohne Kerzen bleibt ein Datenfehler')
}

// ── 4. Alarme ───────────────────────────────────────────────────────────
{
    const zeile = (mehr) => ({ id: 7, art: 'preis', symbol: 'NVDAUSDT', markt: 'futures', notiz: '', kanaele: null, bedingung: '{}', verlauf: JSON.stringify([{ t: 5000, p: 190.5, niveau: 190 }]), ...mehr })
    const [aktie] = ausloesungenAus([zeile({ anlageklasse: 'aktien' })])
    gleich([aktie.symbol, aktie.anlageklasse, aktie.preis, aktie.id], ['NVDAUSDT', 'aktien', 190.5, '7-5000'], 'Aktien-Alarm: Auslösung mit Anlageklasse')
    ok(aktie.titel.includes('NVDAUSDT') && aktie.text.length > 0, 'Aktien-Alarm: Titel und Text wie bei jedem Alarm')
    const [coin] = ausloesungenAus([zeile({ symbol: 'BTCUSDT' })])
    gleich(coin.anlageklasse, 'krypto', 'Zeile ohne Spalte (ältere Datenbank): Krypto')
    gleich(ausloesungenAus([zeile({ symbol: 'BTCUSDT', anlageklasse: 'unsinn' })])[0].anlageklasse, 'krypto', 'unbekannter Wert: Krypto')
    // Die bisherigen Felder stehen alle noch da
    for (const feld of ['id', 'alarmId', 'art', 'zeit', 'symbol', 'symbole', 'markt', 'preis', 'niveau', 'tf', 'titel', 'text', 'schwere']) {
        ok(feld in coin, `Alarm-Antwort trägt weiter das Feld ${feld}`)
    }
}

// ── 5. Stamm-Abfrage (in-memory SQLite) ─────────────────────────────────
{
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    // Ältere Datenbank: weder Spalte noch Tabellen — alles ist Coin, nichts wirft
    await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
    await knex('settings').insert({ id: 1 })
    leereEsp32AktienMerk()
    gleich(await aktienTitelFuer(knex, 'NVDAUSDT', 'nvda', 'binance'), null, 'ohne Aktien-Tabellen: kein Titel, kein Fehler')
    gleich((await aktienSymbole(knex)).modus, false, 'ohne Aktien-Spalte: Modus aus')

    await knex.schema.alterTable('settings', (t) => { t.integer('modusAktienAn').defaultTo(0) })
    await knex.schema.createTable('instrumente', (t) => { t.increments('id'); t.string('anlageklasse'); t.string('ticker'); t.string('name'); t.string('unterart') })
    await knex.schema.createTable('instrument_listungen', (t) => { t.increments('id'); t.integer('instrumentId'); t.string('handelsplatz'); t.string('symbol'); t.string('art'); t.integer('aktiv') })
    await knex('instrumente').insert([
        { id: 1, anlageklasse: 'aktien', ticker: 'NVDA', name: 'NVIDIA', unterart: 'aktie' },
        { id: 2, anlageklasse: 'sonstige', ticker: 'XAU', name: 'Gold', unterart: 'rohstoff' },
        { id: 3, anlageklasse: 'aktien', ticker: 'TSLA', name: 'Tesla', unterart: 'aktie' },
    ])
    await knex('instrument_listungen').insert([
        { instrumentId: 1, handelsplatz: 'binance', symbol: 'NVDAUSDT', art: 'perp', aktiv: 1 },
        { instrumentId: 1, handelsplatz: 'bitunix', symbol: 'NVDAUSDT', art: 'perp', aktiv: 1 },
        { instrumentId: 1, handelsplatz: 'bitpanda', symbol: 'NVDA', art: 'broker-spot', aktiv: 1 },
        { instrumentId: 2, handelsplatz: 'binance', symbol: 'XAUUSDT', art: 'perp', aktiv: 1 },
        { instrumentId: 3, handelsplatz: 'binance', symbol: 'TSLAUSDT', art: 'perp', aktiv: 0 },
    ])
    // Aktien-Modus aus: auch mit gefülltem Stamm ist alles Coin
    leereEsp32AktienMerk()
    gleich(await aktienTitelFuer(knex, 'NVDAUSDT', 'nvda', 'binance'), null, 'Aktien-Modus aus: kein Aktien-Zusatz')

    await knex('settings').where('id', 1).update({ modusAktienAn: 1 })
    leereEsp32AktienMerk()
    gleich(await aktienTitelFuer(knex, 'NVDAUSDT', 'nvda', 'binance'), { symbol: 'NVDAUSDT', ticker: 'NVDA', name: 'NVIDIA' }, 'Aktien-Modus an: NVDA erkannt')
    gleich(await aktienTitelFuer(knex, 'XAUUSDT', 'xau', 'binance'), null, 'Gold ist keine Aktie')
    gleich(await aktienTitelFuer(knex, 'TSLAUSDT', 'tsla', 'binance'), null, 'abgeschaltete Listung zählt nicht')
    gleich(await aktienTitelFuer(knex, 'BTCUSDT', 'btc', 'binance'), null, 'BTC bleibt ein Coin')
    const { modus, je } = await aktienSymbole(knex)
    ok(modus && je.get('bitunix')?.has('NVDAUSDT') && !je.get('bitunix')?.has('XAUUSDT'), 'Positions-Marke: NVDAUSDT bei Bitunix ist eine Aktie')
    ok(!je.has('bitpanda'), 'Spot-Listungen zählen nicht als Future-Position')
    await knex.destroy()
}

// ── 6. Route: Reihenfolge und Zusatz ohne Umbenennung ───────────────────
{
    const api = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'esp32-api.js'), 'utf8')
    const kurs = api.slice(api.indexOf("app.get('/api/esp32/kurs'"), api.indexOf("app.post('/api/esp32/push'"))
    ok(kurs.indexOf('nurGenau: true') < kurs.indexOf('await hole(symbol)'), 'Kurs-Route fragt den Stamm zuerst genau nach dem Symbol')
    ok(/status === 400 && !titel \? await titelFuer\(\)/.test(kurs), 'der Ticker zählt erst, wenn die Quelle das Symbol nicht kennt')
    ok(/titel \? \{ \.\.\.antwort, \.\.\.aktienFelder/.test(kurs), 'Aktien-Felder kommen ZUSÄTZLICH zur gewöhnlichen Antwort; ein Coin bekommt sie nicht')
    ok(/titel \? boerseZuAntwort/.test(kurs) && /status\(502\)/.test(kurs), '«Börse zu» nur für Aktien; sonst bleibt 502')
    ok(/status\(400\)\.json\(\{ error: 'Symbol unbekannt' \}\)/.test(kurs), 'unbekanntes Symbol bleibt HTTP 400 (die Boards werten den Status aus)')
    const anzeige = api.slice(api.indexOf("app.get('/api/esp32/display'"), api.indexOf("app.get('/api/esp32/alarme'"))
    ok(/if \(modus\) \{/.test(anzeige) && /antwort\.aktien = boersenZustand\(\)/.test(anzeige), 'Anzeige: Sitzung nur mit Aktien-Modus')
    for (const feld of ['todayPnL', 'totalPnL', 'winRate', 'balance', 'openPositions', 'bots', 'primaryBroker', 'brokers', 'filterLabel']) {
        ok(new RegExp(`\\b${feld}:`).test(anzeige), `Anzeige: Feld ${feld} steht weiter in der Antwort`)
    }
}

console.log(`ESP32/Widget mit Aktien: ${n} bestanden, 0 fehlgeschlagen`)
