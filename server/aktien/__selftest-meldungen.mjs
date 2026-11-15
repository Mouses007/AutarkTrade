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
    meldeEinmalig, zahlenFenster,
    MAX_ZEILEN, MAX_NEWCOMER, NEWCOMER_SCHWELLE, ZAHLEN_VORLAUF_MS, ZAHLEN_MAX_TITEL, ZAHLEN_PRUEF_MS,
} from './meldungen.js'
import { kennzahlen } from '../newcomer-radar/kennzahlen.js'
import { bewerte } from '../newcomer-radar/bewertung.js'
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
    const t = (ticker, note, kategorie = 'boersengang', huerden = [], momentumTeile = 3) => ({ ticker, name: ticker + ' Inc.', note, kategorie, huerden, kennzahlen: { momentumTeile }, listungen: [{ handelsplatz: 'bitget' }, { handelsplatz: 'bitget' }, { handelsplatz: 'bitpanda' }] })
    const k = newcomerKandidaten([
        t('AAA', 91), t('BBB', 79.9), t('CCC', 95, 'etabliert'), t('DDD', 88, 'neuGelistet'),
        t('EEE', 99, 'boersengang', ['umsatz']), { ticker: 'FFF', note: null, kategorie: 'boersengang', huerden: [] },
        t('GGG', 85, 'vorboerslich'), t('HHH', NEWCOMER_SCHWELLE),
        // FACH-H-004: Momentum nur an einem Mass gemessen (die ersten Wochen nach dem Börsengang) → keine Mail
        t('III', 94, 'boersengang', [], 1), t('JJJ', 94, 'boersengang', [], 0),
        { ticker: 'KKK', note: 94, kategorie: 'boersengang', huerden: [] }, { ticker: 'LLL', note: 94, kategorie: 'boersengang', huerden: [], kennzahlen: {} },
        t('MMM', 90, 'boersengang', ['wechselkursFehlt']),
    ])
    gleich(k.map((x) => x.ticker), ['AAA', 'DDD', 'HHH'], 'nur junge, zugelassene Titel ab der Schwelle, beste zuerst')
    gleich(newcomerMeldung([]), null, 'kein Kandidat: keine Meldung')
    gleich(newcomerKandidaten([t('ZWEI', 81, 'boersengang', [], 2)]).length, 1, 'zwei Momentum-Teilmasse reichen')
    {
        // Durch die echte Kette: ein Börsengang von vor fünf Handelstagen, 3 % unter dem Hoch (war Note 94 und eine Mail)
        const TAG = 86400e3, jetzt = 1.7e12 + 40 * TAG
        const kette = (tage) => {
            const kerzen = Array.from({ length: tage }, (_, i) => { const c = i === tage - 1 ? 97 : 100; return { t: 1.7e12 + i * TAG, o: c, h: c, l: c, c, v: 1e6 } })
            const kz = kennzahlen(kerzen, { jetzt, ipoDatum: jetzt - tage * TAG, referenz: { perf3m: 2 } })
            const b = bewerte(kz, { jetzt, waehrung: 'USD' })
            return { ticker: 'IPO' + tage, note: b.note, kategorie: b.kategorie, huerden: b.huerden, kennzahlen: { ...kz, momentumTeile: b.momentumTeile } }
        }
        for (const tage of [5, 15, 30]) {
            const z = kette(tage)
            ok(z.kategorie === 'boersengang' && !(z.note >= NEWCOMER_SCHWELLE), `${tage} Handelstage: Note ${z.note} bleibt unter ${NEWCOMER_SCHWELLE}`)
            gleich(newcomerKandidaten([z]), [], `${tage} Handelstage: keine Mail`)
            gleich(newcomerKandidaten([{ ...z, note: 94 }]), [], `${tage} Handelstage: auch mit hoher Note keine Mail (ein Teilmass)`)
        }
    }
    const m = newcomerMeldung(k)
    ok(m.betreff === `Newcomer-Radar: 3 Titel mit Note ab ${NEWCOMER_SCHWELLE}`, 'Betreff')
    ok(m.text.includes('AAA — AAA Inc.: Note 91 (junger Börsengang), handelbar bei Bitget, Bitpanda'), 'Zeile mit Note, Kategorie und Plätzen ohne Doppelte')
    ok(m.text.includes('keine Empfehlung'), 'Hinweis: keine Empfehlung')
    ok(newcomerMeldung([k[0]]).betreff === 'Newcomer-Radar: AAA mit Note 91', 'ein Titel: Betreff nennt ihn')
    const viele = newcomerKandidaten(Array.from({ length: 25 }, (_, i) => t(`N${String(i).padStart(2, '0')}`, 80 + i / 10)))
    const g = newcomerMeldung(viele)
    gleich(g.text.split('\n').filter((z) => /^N\d\d /.test(z)).length, MAX_NEWCOMER, `höchstens ${MAX_NEWCOMER} Titel in der Mail`)
    ok(g.text.includes(`… und ${25 - MAX_NEWCOMER} weitere.`), 'der Rest ist gezählt')
    gleich(g.schluessel.split(',').length, MAX_NEWCOMER, 'im Schlüssel stehen nur die genannten Titel (FUN-F-009)')

    // FUN-F-009: beansprucht wird nur, was die Mail nennt — der Rest kommt in der nächsten Mail dran.
    const ansprueche = new Map()           // Schlüssel → gesetzt (Attrappe der Datenbank-Ansprüche)
    const post = []
    const dienste = {
        beanspruche: async (k) => (ansprueche.has(k) ? false : (ansprueche.set(k, true), true)),
        gibFrei: async (k) => { ansprueche.delete(k) },
        istFrei: async (k) => !ansprueche.has(k),
        melde: async (id, m) => { post.push(m); return true },
    }
    const sende = () => meldeEinmalig('aktienNewcomer', viele, (x) => `aktien_newcomer|${x.ticker}`, 1,
        (frei, o) => newcomerMeldung(frei, NEWCOMER_SCHWELLE, o), { hoechstens: MAX_NEWCOMER, dienste })
    ok(await sende() === true && ansprueche.size === MAX_NEWCOMER, `erste Mail beansprucht genau ${MAX_NEWCOMER} von 25`)
    const genannt = (m) => m.text.split('\n').filter((z) => /^N\d\d /.test(z)).map((z) => z.slice(0, 3))
    gleich(genannt(post[0]).sort(), [...ansprueche.keys()].map((k) => k.split('|')[1]).sort(), 'beansprucht sind genau die genannten Titel')
    ok(post[0].text.includes('folgen in einer späteren Mail') && !post[0].text.includes('… und'), 'die Mail sagt, dass weitere folgen')
    ok(await sende() && await sende(), 'zweite und dritte Mail')
    gleich([...genannt(post[0]), ...genannt(post[1]), ...genannt(post[2])].sort(), viele.map((x) => x.ticker).sort(), 'nach drei Mails ist jeder der 25 Titel einmal namentlich gemeldet')
    ok(genannt(post[2]).length === 5 && !post[2].text.includes('späteren Mail'), 'die letzte Mail kündigt nichts mehr an')
    ok(await sende() === false && post.length === 3, 'danach: nichts mehr frei, keine Mail')
    // Scheitert der Versand, sind die Ansprüche wieder frei
    ansprueche.clear()
    ok(await meldeEinmalig('aktienNewcomer', viele, (x) => `n|${x.ticker}`, 1, (frei, o) => newcomerMeldung(frei, NEWCOMER_SCHWELLE, o),
        { hoechstens: MAX_NEWCOMER, dienste: { ...dienste, melde: async () => false } }) === false && ansprueche.size === 0, 'gescheiterter Versand gibt die Ansprüche zurück')

    // Zahlen-Mail: der Deckel von 40 Titeln je Runde wandert, statt immer dieselben zu prüfen
    const wl = Array.from({ length: 95 }, (_, i) => ({ ticker: `W${String(i).padStart(2, '0')}` })).reverse()
    gleich(zahlenFenster(wl.slice(0, 12), 0).length, 12, 'kleine Watchlist: alle Titel, jede Runde')
    const runden = [0, 1, 2].map((r) => zahlenFenster(wl, r * ZAHLEN_PRUEF_MS).map((x) => x.ticker))
    ok(runden.every((r) => r.length <= ZAHLEN_MAX_TITEL), `nie mehr als ${ZAHLEN_MAX_TITEL} Titel je Runde`)
    gleich(new Set(runden.flat()).size, 95, 'drei Runden decken alle 95 Titel der Watchlist ab')
    gleich(zahlenFenster(wl, 3 * ZAHLEN_PRUEF_MS).map((x) => x.ticker), runden[0], 'danach beginnt es von vorn')
    ok(zahlenMeldung([{ ticker: 'MSFT', zeit: Date.UTC(2026, 0, 28, 21) }], 'Europe/Zurich', { offen: 2 }).text.includes('späteren Mail'), 'Zahlen-Mail nennt, dass weitere folgen')
}

// ── 5. Verdrahtung: wo gemeldet wird, und dass nichts am Schalter vorbeigeht ──
{
    const lies = (p) => fs.readFileSync(path.join(hier, p), 'utf8')
    const meldungen = lies('meldungen.js')
    ok(/meldeNeueListungen\(ergebnis\.neu\)/.test(lies('stamm.js')), 'Stamm-Abgleich meldet neue Listungen')
    ok(/meldeNewcomer\(meiner\.beginn\)/.test(lies('../newcomer-radar/lauf.js')), 'Newcomer-Lauf meldet nach dem Lauf')
    ok(/momentumTeile: b\.momentumTeile/.test(lies('../newcomer-radar/lauf.js')), 'Newcomer-Lauf speichert die Zahl der Momentum-Teilmasse, nach der die Mail fragt')
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
    ok(/hoechstens: MAX_ZEILEN/.test(zahlen) && /hoechstens: MAX_NEWCOMER/.test(meldungen) && /zahlenFenster\(/.test(zahlen), 'FUN-F-009: beide Mails beanspruchen nur Genanntes, die Zahlen-Runde wandert')
}

console.log(`Aktien-Benachrichtigungen: ${n} bestanden, 0 fehlgeschlagen`)
