/**
 * Selbsttest: Aktien-Alltag gegen eine Wegwerf-Datenbank (in-memory SQLite,
 * volles Schema) — ohne Netz, ohne Server, ohne Versand.
 *
 *   node server/__selftest-aktien-alltag-db.mjs
 *
 * Die reinen Teile prüfen `coin-radar/__selftest-aktien-alltag.mjs`,
 * `aktien/__selftest-meldungen.mjs` und `__selftest-esp32-aktien.mjs`. Hier
 * steht, was erst mit echtem SQL sichtbar wird: dass gespeicherte
 * Aktien-Einstellungen wirklich gelesen werden (das taten sie vorher nicht),
 * dass die Routen prüfen und antworten, dass die Erfolgskontrolle ihre
 * Aufträge anlegt, ohne die des Coin-Radars zu berühren — und dass keine
 * Benachrichtigung etwas verbraucht oder abruft, solange sie aus ist.
 *
 * `AT_TESTBETRIEB=1`: der Versand ist am Transport gesperrt. Es geht keine
 * Mail und kein Push hinaus, auch wenn eine Prüfung «Mail an» durchspielt.
 */
process.env.AT_DB_FILE = ':memory:'
process.env.AT_TESTBETRIEB = '1'

import assert from 'node:assert/strict'

const log = console.log
console.log = () => {}           // Migrationen der Wegwerf-Datenbank melden jede Tabelle
const { initDb } = await import('./database.js')
const knex = await initDb()
console.log = log

const { leseEinstellungen, schreibeEinstellungen, VORGABEN } = await import('./coin-radar/einstellungen.js')
const { setupCoinRadarRoutes } = await import('./coin-radar-api.js')
const { setupBenachrichtigungsRoutes, melde } = await import('./benachrichtigungen.js')
const { legeAnAktienRadar, legeAnCoinRadar } = await import('./radar-ergebnisse.js')
const { ART_AKTIEN } = await import('./coin-radar/aktien-erfolg.js')
const { meldeNeueListungen, pruefeZahlentermine, meldeNewcomer } = await import('./aktien/meldungen.js')
const { versandGesperrt } = await import('./testbetrieb.js')

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

ok(versandGesperrt(), 'Versand ist in diesem Test gesperrt')

// Jeder Netzabruf in diesem Test wäre ein Fehler
let abrufe = 0
globalThis.fetch = async () => { abrufe++; throw new Error('kein Netz im Selbsttest') }

/* Routen ohne Server: die Handler einsammeln und direkt aufrufen. */
const routen = new Map()
const app = Object.fromEntries(['get', 'put', 'post', 'delete'].map((m) => [m, (pfad, ...h) => routen.set(`${m} ${pfad}`, h.at(-1))]))
console.log = () => {}
setupCoinRadarRoutes(app)
setupBenachrichtigungsRoutes(app)
console.log = log
async function rufe(methode, pfad, { query = {}, body = {} } = {}) {
    const antwort = { status: 200, json: null }
    const res = { status(c) { antwort.status = c; return res }, json(j) { antwort.json = j; return res } }
    await routen.get(`${methode} ${pfad}`)({ query, body, params: {} }, res)
    return antwort
}

// ── 1. Einstellungen: gespeichert heisst gelesen ────────────────────────
let e = await leseEinstellungen()
gleich([e.huerdenAktien, e.gewichteAktien, e.aktienZeitplan], [VORGABEN.huerdenAktien, VORGABEN.gewichteAktien, VORGABEN.aktienZeitplan], 'frische Datenbank: Vorgaben')
const coinVorher = JSON.stringify([e.aktiv, e.intervallStunden, e.zeiteinheiten, e.gewichte, e.huerden, e.einordnungAn, e.abverkauf])

let r = await rufe('put', '/api/coin-radar/einstellungen', { body: { huerdenAktien: { minUmsatz24hUsd: '5000000', maxSpreadBp: '7,5' }, gewichteAktien: { staerke: 50 } } })
gleich(r.status, 200, 'gültige Eingabe wird gespeichert')
e = await leseEinstellungen()
gleich([e.huerdenAktien.minUmsatz24hUsd, e.huerdenAktien.maxSpreadBp, e.huerdenAktien.minKerzen], [5_000_000, 7.5, VORGABEN.huerdenAktien.minKerzen], 'gespeicherte Hürden werden gelesen, der Rest bleibt Vorgabe')
gleich(e.gewichteAktien, { ...VORGABEN.gewichteAktien, staerke: 50 }, 'gespeicherte Gewichte werden gelesen')
gleich(JSON.stringify([e.aktiv, e.intervallStunden, e.zeiteinheiten, e.gewichte, e.huerden, e.einordnungAn, e.abverkauf]), coinVorher, 'Coin-Einstellungen unberührt')

for (const [body, code, block] of [
    [{ huerdenAktien: { maxSpreadBp: 'eng' } }, 'keineZahl', 'huerdenAktien'],
    [{ huerdenAktien: { minUmsatz24hUsd: -1 } }, 'bereich', 'huerdenAktien'],
    [{ gewichteAktien: { staerke: 0, hochNaehe: 0, imSpiel: 0, bewegung: 0, trend: 0 } }, 'gewichteNull', 'gewichteAktien'],
    [{ aktienZeitplan: { an: true, nachEroeffnungMin: 0 } }, 'zeitplanAbstand', 'aktienZeitplan'],
]) {
    r = await rufe('put', '/api/coin-radar/einstellungen', { body })
    gleich([r.status, r.json.code, r.json.block], [400, code, block], `ungültig (${code}) → 400 mit Kürzel und Block`)
    ok(typeof r.json.error === 'string' && r.json.error.length > 10, `ungültig (${code}) → lesbarer Text`)
}
e = await leseEinstellungen()
gleich(e.huerdenAktien.maxSpreadBp, 7.5, 'eine abgelehnte Eingabe ändert nichts')
gleich(e.aktienZeitplan.an, false, 'ein abgelehnter Zeitplan schaltet nichts ein')

// Die Coin-Regeln der Route gelten weiter
r = await rufe('put', '/api/coin-radar/einstellungen', { body: { gewichte: { bewegung: 0, imSpiel: 0, trend: 0, kosten: 0 } } })
gleich(r.status, 400, 'Coin-Gewichte alle null: weiter abgelehnt')
r = await rufe('put', '/api/coin-radar/einstellungen', { body: { zeiteinheiten: [] } })
gleich(r.status, 400, 'leere Zeiteinheiten: weiter abgelehnt')

// Zeitplan einschalten, Stand lesen
r = await rufe('put', '/api/coin-radar/einstellungen', { body: { aktienZeitplan: { an: true, nachEroeffnungMin: 45, vorSchlussMin: 20 } } })
gleich(r.status, 200, 'Zeitplan gespeichert')
r = await rufe('get', '/api/coin-radar/aktien-einstellungen')
gleich(r.status, 200, 'Einstell-Abruf antwortet')
gleich(r.json.zeitplan, { an: true, nachEroeffnungMin: 45, vorSchlussMin: 20 }, 'Einstell-Abruf: Zeitplan')
gleich(r.json.vorgaben, { huerden: VORGABEN.huerdenAktien, gewichte: VORGABEN.gewichteAktien, zeitplan: VORGABEN.aktienZeitplan }, 'Einstell-Abruf: Vorgaben')
ok(r.json.grenzen.huerden.maxSpreadBp.max > 0 && r.json.grenzen.gewichte.max === 100 && r.json.grenzen.zeitplan.min === 5, 'Einstell-Abruf: Grenzen für die Prüfung im Browser')
ok(r.json.naechster && ['eroeffnung', 'schluss'].includes(r.json.naechster.platz) && r.json.naechster.zeit > Date.now(), 'Einstell-Abruf: nächster Lauf liegt in der Zukunft')
gleich(r.json.modusAktienAn, false, 'Einstell-Abruf: Aktien-Modus aus wird gesagt')
gleich(r.json.letzte, { eroeffnung: null, schluss: null }, 'Einstell-Abruf: noch kein automatischer Lauf')
ok(typeof r.json.sitzung === 'string', 'Einstell-Abruf: Sitzung')

// Vorgabe wiederherstellen
r = await rufe('put', '/api/coin-radar/einstellungen', { body: { huerdenAktien: null, gewichteAktien: null, aktienZeitplan: null } })
gleich(r.status, 200, 'Vorgabe wiederherstellen gespeichert')
e = await leseEinstellungen()
gleich([e.huerdenAktien, e.gewichteAktien, e.aktienZeitplan], [VORGABEN.huerdenAktien, VORGABEN.gewichteAktien, VORGABEN.aktienZeitplan], 'danach gelten wieder die Vorgaben')
const gespeichert = Object.fromEntries((await knex('coinradar_settings').whereIn('schluessel', ['huerdenAktien', 'gewichteAktien', 'aktienZeitplan'])).map((z) => [z.schluessel, z.wert]))
gleich(gespeichert, { huerdenAktien: 'null', gewichteAktien: 'null', aktienZeitplan: 'null' }, 'gespeichert ist «keine Abweichung», keine eingefrorene Vorgabe')
// Gleich der Vorgabe eingegeben: ebenfalls nichts eingefroren
await rufe('put', '/api/coin-radar/einstellungen', { body: { huerdenAktien: { ...VORGABEN.huerdenAktien } } })
gleich((await knex('coinradar_settings').where('schluessel', 'huerdenAktien').first()).wert, 'null', 'Eingabe gleich der Vorgabe friert nichts ein')
// Direkt geschriebener Müll in der Datenbank kippt den Zeitplan auf «aus», nicht auf «an»
await schreibeEinstellungen({ aktienZeitplan: { an: true, nachEroeffnungMin: 'x' } })
r = await rufe('get', '/api/coin-radar/aktien-einstellungen')
gleich([r.json.zeitplan.an, r.json.naechster], [false, null], 'kaputter gespeicherter Zeitplan gilt als aus')
await schreibeEinstellungen({ aktienZeitplan: null })

// ── 2. Erfolgskontrolle ─────────────────────────────────────────────────
async function lauf(anlageklasse, anzahl, referenz) {
    const [id] = await knex('coinradar_laeufe').insert({
        erstelltAm: Date.now(), status: 'fertig', ausloeser: 'manuell', anlageklasse,
        quellenStand: JSON.stringify(referenz ? { referenz: { symbol: referenz, ticker: 'SPY' } } : {}),
    })
    const zeilen = Array.from({ length: anzahl }, (_, i) => ({
        laufId: id, symbol: i === 2 && referenz ? referenz : `A${i}USDT`, status: 'bewertet', rang: i + 1, note: 90 - i, atrPct: 1.5, erstelltAm: Date.now(),
    }))
    for (let i = 0; i < zeilen.length; i += 20) await knex('coinradar_zeilen').insert(zeilen.slice(i, i + 20))
    return id
}
const klein = await lauf('aktien', 6, 'SPYUSDT')
gleich(await legeAnAktienRadar(klein), 0, 'ein Lauf mit sechs Titeln wird nicht verfolgt')
const krypto = await lauf('krypto', 60, null)
gleich(await legeAnAktienRadar(krypto), 0, 'ein Krypto-Lauf legt keine Aktien-Aufträge an')
gleich(await knex('radar_ergebnisse').count({ n: '*' }).first().then((z) => Number(z.n)), 0, 'bis hier steht nichts in der Erfolgskontrolle')

const erster = await lauf('aktien', 60, 'SPYUSDT')
gleich(await legeAnAktienRadar(erster), 93, '20 Spitze + 10 Kontrolle + Referenz, je drei Horizonte (der kleine Lauf hat den Tag nicht verbraucht)')
let auftraege = await knex('radar_ergebnisse').where('laufId', erster)
ok(auftraege.every((a) => a.art === ART_AKTIEN && a.anlageklasse === 'aktien' && a.status === 'offen'), 'Aufträge tragen Art und Anlageklasse')
gleich(auftraege.filter((a) => a.gruppe === 'referenz').map((a) => [a.symbol, a.horizont]).sort(), [['SPYUSDT', '1d'], ['SPYUSDT', '28d'], ['SPYUSDT', '7d']], 'die Referenz je Horizont einmal')
gleich(auftraege.filter((a) => a.symbol === 'SPYUSDT' && a.gruppe !== 'referenz').length, 0, 'die Referenz steht nicht in Spitze oder Kontrolle')
gleich([...new Set(auftraege.map((a) => a.faelligAm - a.erstelltAm))].sort((a, b) => a - b), [86_400_000, 7 * 86_400_000, 28 * 86_400_000], 'fällig nach einem Tag, einer Woche, vier Wochen')
const zweiter = await lauf('aktien', 60, 'SPYUSDT')
gleich(await legeAnAktienRadar(zweiter), 0, 'ein zweiter Lauf am selben Tag wird nicht verfolgt')

// Der Coin-Radar legt daneben an wie immer
gleich(await legeAnCoinRadar(krypto), 90, 'Coin-Radar: 20 + 10, je drei Horizonte — unverändert')
auftraege = await knex('radar_ergebnisse').where('art', 'coinradar')
ok(auftraege.every((a) => a.anlageklasse === 'krypto' && ['15m', '1h', '4h'].includes(a.horizont)), 'Coin-Aufträge: Krypto, Coin-Horizonte')

// Auswertungs-Routen: getrennt nach Markt
await knex('radar_ergebnisse').where({ laufId: erster, horizont: '1d' }).update({ status: 'gemessen', gemessenAm: Date.now(), renditePct: 2, maePct: -1, mfePct: 3 })
await knex('radar_ergebnisse').where({ laufId: erster, horizont: '1d', gruppe: 'referenz' }).update({ renditePct: 0.5 })
await knex('radar_ergebnisse').where({ laufId: erster, horizont: '1d', gruppe: 'kontrolle' }).update({ renditePct: 1 })
r = await rufe('get', '/api/coin-radar/guete', { query: { markt: 'aktien' } })
gleich([r.status, r.json.gesamt, r.json.jeHorizont.map((h) => h.horizont)], [200, 93, ['1d', '7d', '28d']], 'Güte Aktien: drei Horizonte')
const tag = r.json.jeHorizont[0]
gleich([tag.mehrrenditeMedian, tag.abstandMedian, tag.laeufeMitReferenz, tag.urteil, tag.vorIndex.k], [1.5, 1, 1, 'zuWenig', 20], 'Güte Aktien: Mehrrendite gegen die Referenz, ein Lauf ist zu wenig für ein Urteil')
gleich(r.json.jeHorizont[1].offen, 31, 'Güte Aktien: offene Aufträge gezählt')
r = await rufe('get', '/api/coin-radar/guete')
ok(r.status === 200 && r.json.gesamt === 90 && !JSON.stringify(r.json).includes('mehrrendite'), 'Güte Krypto: nur Coin-Aufträge, alte Form')

// ── 3. Benachrichtigungen: aus heisst, es geschieht nichts ──────────────
const nvda = { handelsplatz: 'bitunix', symbol: 'NVDAUSDT', art: 'perp', anlageklasse: 'aktien', unterart: 'aktie', ticker: 'NVDA', name: 'NVIDIA' }
const ansprueche = async () => (await knex('radar_fetch_state').select('key')).map((z) => z.key).filter((k) => /aktien_(zahlen|newcomer)|mail\|aktien|mail_deckel/.test(k))
const mailAn = { mailAktiv: 1, mailHost: 'smtp.example.invalid', mailPort: 587, mailVon: 'a@example.invalid', mailAn: 'b@example.invalid' }
const alleAn = { aktienListung: { email: true }, aktienZahlen: { email: true }, aktienNewcomer: { email: true } }

r = await rufe('get', '/api/benachrichtigungen/typen')
ok(!r.json.typen.some((t) => t.gruppe === 'aktien') && r.json.typen.length > 5, 'Matrix ohne Aktien-Modus: keine Aktien-Ereignisse')

// a) Aktien-Modus aus, alles andere an
await knex('settings').where('id', 1).update({ ...mailAn, modusAktienAn: 0, benachrichtigungen: JSON.stringify(alleAn) })
gleich([await meldeNeueListungen([nvda]), await pruefeZahlentermine(), await meldeNewcomer(0)], [false, false, false], 'Aktien-Modus aus: keine der drei Arten meldet')
gleich(await ansprueche(), [], 'Aktien-Modus aus: kein Anspruch verbraucht')

// b) Aktien-Modus an, Mail je Art aus (Vorgabe)
await knex('settings').where('id', 1).update({ modusAktienAn: 1, benachrichtigungen: '{}' })
r = await rufe('get', '/api/benachrichtigungen/typen')
gleich(r.json.typen.filter((t) => t.gruppe === 'aktien').map((t) => t.id), ['aktienListung', 'aktienZahlen', 'aktienNewcomer'], 'Matrix mit Aktien-Modus: die drei Aktien-Ereignisse')
await knex('chart_watchlists').insert({ name: 'Aktien', symbole: JSON.stringify([{ symbol: 'NVDAUSDT', markt: 'futures' }]), anlageklasse: 'aktien', reihenfolge: 0, geaendertAm: Date.now() }).catch(async () => {
    await knex('chart_watchlists').insert({ name: 'Aktien', symbole: JSON.stringify([{ symbol: 'NVDAUSDT', markt: 'futures' }]), anlageklasse: 'aktien' })
})
gleich([await meldeNeueListungen([nvda]), await pruefeZahlentermine(), await meldeNewcomer(0)], [false, false, false], 'ab Werk (Mail je Art aus): keine der drei Arten meldet')
gleich(await ansprueche(), [], 'ab Werk: kein Anspruch verbraucht')

// c) Nur EINE Art an: die anderen bleiben still
await knex('settings').where('id', 1).update({ benachrichtigungen: JSON.stringify({ aktienListung: { email: true } }) })
gleich([await pruefeZahlentermine(), await meldeNewcomer(0)], [false, false], 'nur «Neue Listung» an: Zahlen und Newcomer bleiben aus')
gleich(await ansprueche(), [], 'nur «Neue Listung» an: nichts verbraucht')

// d) Mail an, aber Versand nicht eingerichtet
await knex('settings').where('id', 1).update({ mailAktiv: 0, benachrichtigungen: JSON.stringify(alleAn) })
gleich([await meldeNeueListungen([nvda]), await pruefeZahlentermine(), await meldeNewcomer(0)], [false, false, false], 'ohne eingerichteten Versand: nichts')
gleich(await ansprueche(), [], 'ohne eingerichteten Versand: nichts verbraucht')

// e) Alles an — der Transport ist im Testbetrieb gesperrt: nichts geht hinaus, nichts bleibt verbraucht
await knex('settings').where('id', 1).update({ mailAktiv: 1 })
gleich(await meldeNeueListungen([nvda]), false, 'alles an, Testbetrieb: Listung wird nicht verschickt')
gleich(await meldeNewcomer(0), false, 'alles an, kein Newcomer-Lauf: nichts zu melden')
gleich(await melde('aktienListung', { betreff: 'x', text: 'y', schluessel: 'z' }), false, 'der Transport selbst ist gesperrt')
gleich(await ansprueche(), [], 'gesperrter Versand hinterlässt keinen Anspruch (die Meldung ginge später noch hinaus)')
gleich(await meldeNeueListungen([]), false, 'keine neue Listung: nichts')
gleich(await meldeNeueListungen([{ ...nvda, anlageklasse: 'sonstige' }]), false, 'Rohstoff: nichts')

gleich(abrufe, 0, 'im ganzen Test ging kein Abruf ins Netz')

await knex.destroy()
console.log(`Aktien-Alltag mit Datenbank: ${n} bestanden, 0 fehlgeschlagen`)
