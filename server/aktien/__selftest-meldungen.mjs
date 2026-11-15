/**
 * Selbsttest der Aktien-Benachrichtigungen (`meldungen.js`, Register).
 *
 *   node server/aktien/__selftest-meldungen.mjs
 *
 * Ohne Netz, ohne SMTP — es geht nie eine Nachricht hinaus. Geprüft wird, was
 * das Postfach fluten oder still Falsches melden würde: der erste Abgleich als
 * hundert «neue» Listungen, ein Rohstoff als Aktie, ein vergangener Termin,
 * derselbe Titel doppelt, ein etablierter Wert als «Newcomer».
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import knexLib from 'knex'
import { migriereAktien } from '../migrationen/aktien.js'
import { ordneAlle } from './einordnung.js'
import { speichereStamm } from './stamm-speicher.js'
import {
    listungsMeldung, faelligeZahlen, zahlenMeldung, zahlenTag, newcomerKandidaten, newcomerMeldung, watchlistSymbole,
    MAX_ZEILEN, MAX_NEWCOMER, NEWCOMER_SCHWELLE, ZAHLEN_VORLAUF_MS,
} from './meldungen.js'
import { REGISTER, kanalWahl, sichtbareTypen } from '../benachrichtigungen.js'

const hier = path.dirname(fileURLToPath(import.meta.url))
let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.deepEqual(a, b, text); n++ }

// ── 1. Register ─────────────────────────────────────────────────────────
const AKTIEN = ['aktienListung', 'aktienZahlen', 'aktienNewcomer']
for (const id of AKTIEN) {
    const e = REGISTER.find((x) => x.id === id)
    ok(e, `${id} steht im Register`)
    ok(e.gruppe === 'aktien' && e.nurAktien === true, `${id}: Gruppe Aktien, nur im Aktien-Modus`)
    ok(e.email === true && e.browser === false, `${id}: Mail möglich, kein Browser-Sender`)
    gleich(kanalWahl({}, id), { browser: false, email: false }, `${id}: ab Werk aus`)
    ok(kanalWahl({ benachrichtigungen: { [id]: { email: true } } }, id).email === true, `${id}: einzeln einschaltbar`)
    // Die anderen beiden bleiben aus, wenn nur diese eine an ist
    for (const anderes of AKTIEN.filter((x) => x !== id)) {
        ok(kanalWahl({ benachrichtigungen: { [id]: { email: true } } }, anderes).email === false, `${id} an schaltet ${anderes} nicht ein`)
    }
}
ok(!sichtbareTypen(false).some((e) => AKTIEN.includes(e.id)), 'ohne Aktien-Modus zeigt die Matrix keine Aktien-Ereignisse')
gleich(sichtbareTypen(true).filter((e) => AKTIEN.includes(e.id)).length, 3, 'mit Aktien-Modus alle drei')
gleich(sichtbareTypen(false).length, REGISTER.length - 3, 'die übrigen Ereignisse bleiben ohne Aktien-Modus vollständig')
// Texte der Matrix stehen im eigenen Sprachblock, in beiden Sprachen
for (const sprache of ['de', 'en']) {
    const texte = JSON.parse(fs.readFileSync(path.join(hier, `../../src/i18n/locales/${sprache}.json`), 'utf8'))
    for (const e of REGISTER.filter((x) => x.i18n)) {
        const block = e.i18n.split('.').reduce((o, k) => o?.[k], texte)
        ok(block?.[`typ_${e.id}`] && block?.[`hinweis_${e.id}`] && block?.[`gruppe_${e.gruppe}`], `${sprache}: Texte für ${e.id}`)
    }
    for (const e of REGISTER.filter((x) => !x.i18n)) {
        ok(texte.settings.benachrichtigungen[`typ_${e.id}`], `${sprache}: Text für ${e.id} (bestehender Block)`)
    }
}

// ── 2. Neue Listungen ───────────────────────────────────────────────────
gleich(listungsMeldung([]), null, 'nichts Neues: keine Meldung')
const nvda = { handelsplatz: 'bitunix', symbol: 'NVDAUSDT', art: 'perp', anlageklasse: 'aktien', unterart: 'aktie', ticker: 'NVDA', name: 'NVIDIA' }
{
    const m = listungsMeldung([nvda])
    ok(m.betreff === 'Neu handelbar: NVDA bei Bitunix' && m.text.includes('NVDA — NVIDIA: Bitunix (Future)'), 'eine Listung: Titel und Platz im Text')
    gleich(m.anzahl, 1, 'eine Listung gezählt')
    // Derselbe Titel an zwei Plätzen ist EINE Zeile
    const zwei = listungsMeldung([nvda, { ...nvda, handelsplatz: 'bitget', symbol: 'NVDASTOCKUSDT' }])
    gleich(zwei.anzahl, 1, 'zwei Plätze, ein Titel')
    ok(zwei.text.includes('Bitunix (Future), Bitget (Future)'), 'beide Plätze in einer Zeile')
    ok(zwei.schluessel !== m.schluessel, 'anderer Schlüssel, wenn ein Platz dazukommt')
    gleich(listungsMeldung([nvda, { ...nvda }]).schluessel, listungsMeldung([{ ...nvda }, nvda]).schluessel, 'Schlüssel hängt nicht an der Reihenfolge')
    // Rohstoffe, Devisen und Coins gehören nicht hierher
    gleich(listungsMeldung([{ ...nvda, anlageklasse: 'sonstige', unterart: 'rohstoff', ticker: 'XAU' }]), null, 'Rohstoff ist keine Aktien-Listung')
    gleich(listungsMeldung([{ ...nvda, anlageklasse: 'krypto', ticker: 'BTC' }]), null, 'Coin ist keine Aktien-Listung')
    ok(listungsMeldung([{ ...nvda, wieder: true }]).text.includes('wieder gelistet'), 'Wiederaufnahme ist gekennzeichnet')
    ok(listungsMeldung([{ ...nvda, unterart: 'etf', ticker: 'SOXS', name: '' }]).text.includes('SOXS [ETF]'), 'ETF ist gekennzeichnet')
    // Viele auf einmal: EINE Mail, gedeckelte Liste
    const viele = Array.from({ length: 120 }, (_, i) => ({ ...nvda, ticker: `T${String(i).padStart(3, '0')}`, symbol: `T${i}USDT` }))
    const g = listungsMeldung(viele)
    gleich(g.anzahl, 120, '120 Titel gezählt')
    gleich(g.text.split('\n').filter((z) => /^T\d{3} /.test(z)).length, MAX_ZEILEN, `höchstens ${MAX_ZEILEN} Zeilen`)
    ok(g.text.includes(`… und ${120 - MAX_ZEILEN} weitere.`), 'der Rest ist gezählt, nicht aufgelistet')
    ok(g.betreff === 'Neu handelbar: 120 Aktien-Titel', 'Betreff nennt die Zahl')
}

// Am echten Abgleich: erster Lauf meldet NICHTS, ein später dazugekommener Titel genau sich selbst
{
    const roh = JSON.parse(fs.readFileSync(path.join(hier, '../fixtures/aktien-listungen.json'), 'utf8'))
    const PLAETZE = ['binance', 'bitget', 'bitunix', 'pionex', 'bitpanda']
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await knex.schema.createTable('settings', (t) => { t.increments('id').primary() })
    await knex('settings').insert({ id: 1 })
    await migriereAktien(knex, async (table, column, buildCol) => {
        if (!(await knex.schema.hasTable(table))) return
        if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => buildCol(t))
    })
    const alle = ordneAlle(roh)
    const aktienBitunix = alle.filter((l) => l.handelsplatz === 'bitunix' && l.anlageklasse === 'aktien')
    ok(aktienBitunix.length >= 2, 'Fixture hat Aktien bei Bitunix')
    const spaeter = aktienBitunix[0]
    const ohne = alle.filter((l) => l !== spaeter)

    let r = await speichereStamm(knex, ohne, PLAETZE, 1000)
    ok(r.listungen > 10, 'erster Abgleich schreibt die Listungen')
    gleich(listungsMeldung(r.neu), null, 'ERSTER Abgleich: keine Meldung, obwohl alles neu in der Datenbank steht')

    r = await speichereStamm(knex, ohne, PLAETZE, 2000)
    gleich(listungsMeldung(r.neu), null, 'unveränderter zweiter Abgleich: keine Meldung')

    r = await speichereStamm(knex, alle, PLAETZE, 3000)
    const m = listungsMeldung(r.neu)
    gleich(m?.anzahl, 1, 'ein Titel kommt dazu: genau eine Zeile')
    ok(m.text.includes(spaeter.basis) && m.text.includes('Bitunix'), 'die Meldung nennt den neuen Titel und seinen Platz')

    // Ein Handelsplatz, der zum ersten Mal gelesen wird (z. B. neue Marktdatenquelle), ist Ausgangslage
    const knex2 = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    await knex2.schema.createTable('settings', (t) => { t.increments('id').primary() })
    await knex2('settings').insert({ id: 1 })
    await migriereAktien(knex2, async (table, column, buildCol) => {
        if (!(await knex2.schema.hasTable(table))) return
        if (!(await knex2.schema.hasColumn(table, column))) await knex2.schema.alterTable(table, (t) => buildCol(t))
    })
    await speichereStamm(knex2, alle, PLAETZE.filter((p) => p !== 'binance'), 1000)
    r = await speichereStamm(knex2, alle, PLAETZE, 2000)
    gleich(listungsMeldung(r.neu), null, 'ein Handelsplatz kommt erstmals dazu: seine Listungen sind Ausgangslage, keine Meldung')
    await knex.destroy()
    await knex2.destroy()
}

// ── 3. Quartalszahlen ───────────────────────────────────────────────────
{
    const jetzt = Date.UTC(2026, 10, 16, 12)
    const tag = 24 * 3600e3
    const titel = [
        { ticker: 'NVDA', name: 'NVIDIA', zeit: jetzt + 2 * tag, geschaetzt: false },
        { ticker: 'AAPL', name: 'Apple', zeit: jetzt + 10 * tag },                 // zu weit weg
        { ticker: 'TSLA', name: 'Tesla', zeit: jetzt - tag },                      // vorbei
        { ticker: 'MSFT', name: '', zeit: jetzt + 3600e3, geschaetzt: true },
        { ticker: 'NVDA', name: 'NVIDIA', zeit: jetzt + 2 * tag },                 // doppelt (zwei Listungen)
        { ticker: 'AMD', name: 'AMD', zeit: null },                                // unbekannt
        { ticker: 'GOOG', zeit: jetzt + ZAHLEN_VORLAUF_MS + 1 },                   // knapp ausserhalb
    ]
    const f = faelligeZahlen(titel, jetzt)
    gleich(f.map((t) => t.ticker), ['MSFT', 'NVDA'], 'nur künftige Termine im Vorlauf, je Titel einmal, früheste zuerst')
    gleich(faelligeZahlen([{ ticker: 'X', zeit: jetzt }], jetzt), [], 'ein Termin genau jetzt ist nicht mehr «steht an»')
    gleich(zahlenMeldung([]), null, 'nichts fällig: keine Meldung')
    const m = zahlenMeldung(f, 'Europe/Zurich')
    ok(m.betreff === 'Quartalszahlen stehen an: 2 Titel deiner Watchlist', 'Betreff nennt die Zahl')
    ok(m.text.includes('MSFT: ') && m.text.includes('(Termin geschätzt)') && m.text.includes('NVDA — NVIDIA: '), 'Text nennt Titel, Zeit und Schätzung')
    ok(m.text.includes('13:00'), 'Zeit in der Zeitzone des Nutzers (12:00 UTC + 1 h = 13:00 Zürich)')
    ok(zahlenMeldung(f, 'America/New_York').text.includes('08:00'), 'andere Zeitzone, andere Uhrzeit')
    ok(zahlenMeldung([f[0]]).betreff.startsWith('Quartalszahlen: MSFT am '), 'ein Titel: Betreff nennt ihn')
    // Der Tag des Termins zählt in New York — eine Meldung um 21:00 UTC und eine um 02:00 UTC des Folgetags
    // gehören zum selben US-Abend und damit zum selben Schlüssel.
    gleich(zahlenTag(Date.UTC(2026, 10, 18, 21, 5)), '2026-11-18', 'Termin-Tag New Yorker Zeit')
    gleich(zahlenTag(Date.UTC(2026, 10, 19, 2, 0)), '2026-11-18', 'nach Mitternacht UTC noch derselbe US-Tag')
}
gleich(watchlistSymbole([
    { symbole: JSON.stringify([{ symbol: 'nvdausdt', markt: 'futures' }, 'TSLAUSDT']) },
    { symbole: [{ symbol: 'NVDAUSDT' }, { markt: 'x' }, null] },
    { symbole: '{kaputt' },
    {},
]), ['NVDAUSDT', 'TSLAUSDT'], 'Watchlist-Symbole: Text und Objekt, ohne Doppelte, kaputte Zeilen ohne Absturz')

// ── 4. Newcomer ─────────────────────────────────────────────────────────
{
    const t = (ticker, note, kategorie = 'boersengang', huerden = []) => ({ ticker, name: ticker + ' Inc.', note, kategorie, huerden, listungen: [{ handelsplatz: 'bitget' }, { handelsplatz: 'bitget' }, { handelsplatz: 'bitpanda' }] })
    const k = newcomerKandidaten([
        t('AAA', 91), t('BBB', 79.9), t('CCC', 95, 'etabliert'), t('DDD', 88, 'neuGelistet'),
        t('EEE', 99, 'boersengang', ['umsatz']), { ticker: 'FFF', note: null, kategorie: 'boersengang', huerden: [] },
        t('GGG', 85, 'vorboerslich'), t('HHH', NEWCOMER_SCHWELLE),
    ])
    gleich(k.map((x) => x.ticker), ['AAA', 'DDD', 'HHH'], 'nur junge, zugelassene Titel ab der Schwelle, beste zuerst')
    gleich(newcomerMeldung([]), null, 'kein Kandidat: keine Meldung')
    const m = newcomerMeldung(k)
    ok(m.betreff === `Newcomer-Radar: 3 Titel mit Note ab ${NEWCOMER_SCHWELLE}`, 'Betreff')
    ok(m.text.includes('AAA — AAA Inc.: Note 91 (junger Börsengang), handelbar bei Bitget, Bitpanda'), 'Zeile mit Note, Kategorie und Plätzen ohne Doppelte')
    ok(m.text.includes('keine Empfehlung'), 'Hinweis: keine Empfehlung')
    ok(newcomerMeldung([k[0]]).betreff === 'Newcomer-Radar: AAA mit Note 91', 'ein Titel: Betreff nennt ihn')
    const viele = newcomerKandidaten(Array.from({ length: 25 }, (_, i) => t(`N${String(i).padStart(2, '0')}`, 80 + i / 10)))
    const g = newcomerMeldung(viele)
    gleich(g.text.split('\n').filter((z) => /^N\d\d /.test(z)).length, MAX_NEWCOMER, `höchstens ${MAX_NEWCOMER} Titel in der Mail`)
    ok(g.text.includes(`… und ${25 - MAX_NEWCOMER} weitere.`), 'der Rest ist gezählt')
    gleich(g.schluessel.split(',').length, 25, 'alle 25 stehen im Schlüssel (sie gelten als gemeldet und tröpfeln nicht nach)')
}

// ── 5. Verdrahtung: wo gemeldet wird, und dass nichts am Schalter vorbeigeht ──
{
    const lies = (p) => fs.readFileSync(path.join(hier, p), 'utf8')
    const meldungen = lies('meldungen.js')
    ok(/meldeNeueListungen\(ergebnis\.neu\)/.test(lies('stamm.js')), 'Stamm-Abgleich meldet neue Listungen')
    ok(/meldeNewcomer\(meiner\.beginn\)/.test(lies('../newcomer-radar/lauf.js')), 'Newcomer-Lauf meldet nach dem Lauf')
    ok(/pruefeZahlentermine\(\)/.test(lies('../benachrichtigungen.js')), 'Benachrichtigungs-Takt prüft Zahlentermine')
    // Jeder Weg geht durch `bereit` (Aktien-Modus + Mail an + Versand eingerichtet) und durch `melde`
    for (const fn of ['meldeNeueListungen', 'pruefeZahlentermine', 'meldeNewcomer']) {
        const rumpf = meldungen.slice(meldungen.indexOf(`export async function ${fn}`)).split('\nexport ')[0]
        ok(/await bereit\('aktien(Listung|Zahlen|Newcomer)'\)/.test(rumpf), `${fn} prüft Modus und Schalter, bevor etwas geschieht`)
    }
    ok(/modusAktienAn \?\? 0\) !== 1\) return null/.test(meldungen), '`bereit` verlangt den Aktien-Modus')
    ok(!/nodemailer|sendeMail|fetch\(|stelleZu|telegram|ntfy/i.test(meldungen), 'kein eigener Versandweg — nur `melde` (Sperre im Testbetrieb, Stundendeckel, Entprellung)')
    // Die Kursquelle wird erst gefragt, wenn feststeht, dass gemeldet werden soll
    const zahlen = meldungen.slice(meldungen.indexOf('export async function pruefeZahlentermine'))
    ok(zahlen.indexOf("await bereit('aktienZahlen')") < zahlen.indexOf('ladeTermine('), 'Zahlentermine: erst Schalter, dann Abruf')
    ok(zahlen.indexOf("quelleErlaubt('yahoo')") < zahlen.indexOf('ladeTermine('), 'Zahlentermine: Kursquelle nur mit Freigabe')
    ok(zahlen.indexOf("beansprucheAufgabe('aktien_zahlen_pruefung'") < zahlen.indexOf('ladeTermine('), 'Zahlentermine: höchstens alle sechs Stunden')
}

console.log(`Aktien-Benachrichtigungen: ${n} bestanden, 0 fehlgeschlagen`)
