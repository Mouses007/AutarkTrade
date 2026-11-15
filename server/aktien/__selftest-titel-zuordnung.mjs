/**
 * Selbsttest: Titel-Seite findet ihren Titel und das richtige Kurssymbol
 * (Audit vom 15.11.2026, FUN-F-002 und DB-D-001). In-memory SQLite, ohne Netz.
 *
 *   node server/aktien/__selftest-titel-zuordnung.mjs
 *
 * Geprüft wird, was still Falsches zeigen würde: ein kurzer Ticker ohne seine
 * Listungen («nirgends handelbar»), die Kennzahlen einer fremden Firma unter
 * demselben Ticker, eine Suche, die den exakten Ticker nicht liefert.
 */
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { migriereAktien } from '../migrationen/aktien.js'
import { leseStamm, suchForm } from './stamm-speicher.js'
import { ladeTitel, namensWarnung } from './titel-stamm.js'

// Ohne Netz: hier ruft nichts ab — täte es das doch, fällt der Test.
globalThis.fetch = async (url) => { throw new Error(`Abruf im Selbsttest: ${url}`) }

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

async function lege(ticker, name, plaetze, mehr = {}) {
    // `suchName` wie vom Stamm-Abgleich gefüllt (DB-D-003) — die Namenssuche liest nur diese Spalte
    const [id] = await knex('instrumente').insert({ anlageklasse: 'aktien', ticker, unterart: 'aktie', name, suchName: name ? suchForm(name) : null, stand: 1, createdAt: 1, ...mehr })
    const instrumentId = typeof id === 'object' ? id.id : id
    for (const [handelsplatz, symbol, art] of plaetze) {
        await knex('instrument_listungen').insert({ instrumentId, handelsplatz, symbol, art, quote: 'USDT', sicher: 1, aktiv: 1, ersteSichtung: 1, letzteSichtung: 1 })
    }
    return instrumentId
}

// 120 Titel, die «V» im Namen tragen und VOR Visa angelegt sind (kleinere ID) — die alte Abfrage nahm die ersten 50 davon.
for (let i = 0; i < 120; i++) await lege(`A${String(i).padStart(3, '0')}`, `Vorrat Nummer ${i} Verwaltung`, [['bitpanda', `A${i}`, 'broker-spot']])
await lege('VZ', 'Verizon', [['binance', 'VZUSDT', 'perp']])
const visa = await lege('V', 'Visa', [['binance', 'VUSDT', 'perp'], ['bitget', 'VSTOCKUSDT', 'perp'], ['bitpanda', 'V', 'broker-spot']])
const san = await lege('SAN', 'Sanofi', [['bitpanda', 'SAN', 'broker-spot']])
const byd = await lege('BYD', null, [['binance', 'BYDUSDT', 'perp']], { region: 'HK' })
await lege('NVDA', 'NVIDIA', [['binance', 'NVDAUSDT', 'perp']])

// ── DB-D-001: kurzer Ticker ──
let t = await ladeTitel(knex, 'V')
gleich(t.titel.listungen.map((l) => l.symbol).sort(), ['V', 'VSTOCKUSDT', 'VUSDT'], 'Titel-Seite «V»: alle Listungen trotz > 50 Namens-Treffern')
gleich([t.titel.id, t.kursSymbol], [visa, 'V'], '«V»: der Titel selbst, Kurssymbol aus dem Ticker (noch kein Newcomer-Lauf)')
gleich(await ladeTitel(knex, 'GIBTSNICHT'), null, 'unbekannter Ticker')

let liste = await leseStamm(knex, { anlageklasse: 'aktien', suche: 'v', grenze: 50 })
gleich(liste.slice(0, 2).map((x) => x.ticker), ['V', 'VZ'], 'Suche «V»: exakter Ticker zuerst, dann Ticker-Anfang')
ok(liste.length === 50 && liste.slice(2).every((x) => x.name.includes('V')), 'danach Namens-Treffer, erst dann begrenzt')
liste = await leseStamm(knex, { anlageklasse: 'aktien', suche: 'V', grenze: 1 })
gleich(liste.map((x) => x.ticker), ['V'], 'Grenze 1: es bleibt der exakte Ticker')
liste = await leseStamm(knex, { anlageklasse: 'aktien', grenze: 5000 })
gleich(liste.length, 125, 'ohne Suche: jeder Titel einmal')
gleich(liste.map((x) => x.ticker), liste.map((x) => x.ticker).slice().sort(), 'ohne Suche: nach Ticker geordnet wie bisher')
liste = await leseStamm(knex, { anlageklasse: 'aktien', suche: 'V', handelsplatz: 'bitget' })
gleich(liste.map((x) => x.ticker), ['V'], 'Suche mit Handelsplatz-Filter')

// ── FUN-F-002: kein Rückfall auf den blossen Ticker ──
t = await ladeTitel(knex, 'SAN')
gleich(t.kursSymbol, 'SAN', 'SAN vor dem ersten Newcomer-Lauf: Kandidat aus dem Ticker (die Seite warnt am Namen)')
await knex('newcomer_titel').insert({ instrumentId: san, stand: 1, kursSymbol: null, zuordnung: null, grund: 'keinTreffer', noten: '{}', kennzahlen: '{}', huerden: '[]' })
t = await ladeTitel(knex, 'SAN')
gleich(t.kursSymbol, null, 'SAN mit gespeichertem keinTreffer: kein Kurssymbol (nicht Banco Santander)')
await knex('newcomer_titel').where('instrumentId', san).update({ kursSymbol: 'SAN.PA', zuordnung: 'suche', grund: null })
gleich((await ladeTitel(knex, 'SAN')).kursSymbol, 'SAN.PA', 'gefundenes Symbol gilt')

// ── FUN-F-014: Titel-Seite kennt die Zuordnung und nimmt dieselbe Börsengang-Regel wie der Lauf ──
gleich((await ladeTitel(knex, 'SAN')).zuordnung, 'suche', 'ladeTitel liefert die gespeicherte Zuordnung')
gleich((await ladeTitel(knex, 'V')).zuordnung, null, 'ohne Newcomer-Stand: keine Zuordnung')
await knex('newcomer_titel').where('instrumentId', san).update({ zuordnung: 'sucheFremd' })
{
    const { boersengangDatum } = await import('../newcomer-radar/kursquelle-kern.js')
    const ersterHandel = Date.UTC(2026, 5, 1)
    gleich(boersengangDatum((await ladeTitel(knex, 'SAN')).zuordnung, ersterHandel), null, 'Zweitlistung: erster Handel ist kein Börsengang → keine «junge Firma», keine Haltefrist')
    gleich(boersengangDatum('suche', ersterHandel), ersterHandel, 'Heimatlistung: Datum gilt')
    gleich([boersengangDatum(null, ersterHandel), boersengangDatum('ticker', null), boersengangDatum('name', undefined)], [ersterHandel, null, null], 'ohne Zuordnung gilt das Datum; fehlt es, null')
    const fs = await import('node:fs')
    const lies = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
    ok(/ipoDatum: chart\.status === 'fulfilled' \? boersengangDatum\(zuordnung, chart\.value\.meta\.ipoDatum\) : null/.test(lies('./api.js')), 'Titel-Seite: Börsengang über die gemeinsame Regel')
    ok(/const ipoDatum = boersengangDatum\(zuordnung, chart\.meta\.ipoDatum\)/.test(lies('../newcomer-radar/lauf.js')), 'Newcomer-Lauf: dieselbe Funktion, keine Kopie')
}
await knex('newcomer_titel').where('instrumentId', san).update({ zuordnung: 'suche' })

t = await ladeTitel(knex, 'BYD')
gleich(t.kursSymbol, null, 'BYD (Region HK): kein Kurssymbol aus dem blossen Ticker')
await knex('newcomer_titel').insert({ instrumentId: byd, stand: 1, kursSymbol: 'BYD', zuordnung: 'ticker', grund: null, noten: '{}', kennzahlen: '{}', huerden: '[]' })
gleich((await ladeTitel(knex, 'BYD')).kursSymbol, null, 'BYD (Region HK): der alte Stand «BYD» = Boyd Gaming gilt nicht')

// ── Warnung der Titel-Seite ──
gleich(namensWarnung('Sanofi', 'Banco Santander, S.A.', 'SAN'), 'Banco Santander, S.A.', 'Sanofi / Banco Santander: Warnung mit dem Namen der Quelle')
gleich(namensWarnung('BYD Company', 'Boyd Gaming Corporation', 'BYD'), 'Boyd Gaming Corporation', 'BYD Company / Boyd Gaming: Warnung')
gleich(namensWarnung('NVIDIA', 'NVIDIA Corporation', 'NVDA'), null, 'gleiche Firma: keine Warnung')
gleich(namensWarnung('TSMC', 'Taiwan Semiconductor Manufacturing Company Limited', 'TSM'), null, 'Kürzel: keine Warnung')
gleich([namensWarnung(null, 'Boyd Gaming Corporation', 'BYD'), namensWarnung('Visa', null, 'V')], [null, null], 'ein Name fehlt: unbekannt, keine Warnung')

gleich(namensWarnung('Air Liquide', 'C3.ai, Inc.', 'AI'), 'C3.ai, Inc.', 'RAS-04: Air Liquide / C3.ai — der Ticker im Namen der Kursquelle reicht nicht, Warnung')

// ── RAS-01: Future und Bitpanda-Aktie mit demselben Kürzel, aber verschiedene Firmen ──
// Der Stamm bündelt nach Ticker und trägt Bitpandas Namen. Für den Titel gilt der Ticker des Futures.
{
    const zeile = (instrumentId, kursSymbol, zuordnung, grund = null) => ({ instrumentId, stand: 1, kursSymbol, zuordnung, grund, noten: '{}', kennzahlen: '{}', huerden: '[]' })
    for (const [ticker, bpName, heim, zuordnung] of [['AA', 'Anglo American', 'AAL.L', 'sucheFremd'], ['MC', 'LVMH', 'MC.PA', 'suche'], ['T', 'Telus', 'T.TO', 'suche']]) {
        const id = await lege(ticker, bpName, [['bitget', `${ticker}USDT`, 'perp'], ['bitpanda', ticker, 'broker-spot']])
        let s = await ladeTitel(knex, ticker)
        gleich([s.kursSymbol, s.zuordnung, s.perp, s.titel.name], [ticker, null, true, bpName], `${ticker} mit Future, vor dem ersten Lauf: Kurssymbol aus dem Ticker`)
        await knex('newcomer_titel').insert(zeile(id, heim, zuordnung))
        s = await ladeTitel(knex, ticker)
        gleich([s.kursSymbol, s.zuordnung], [ticker, null], `${ticker} mit Future, Altstand ${heim} (${zuordnung}): sofort ${ticker}; die Zuordnung des alten Symbols gilt nicht mit`)
        await knex('newcomer_titel').where('instrumentId', id).update({ kursSymbol: ticker, zuordnung: 'ticker' })
        s = await ladeTitel(knex, ticker)
        gleich([s.kursSymbol, s.zuordnung], [ticker, 'ticker'], `${ticker} mit Future, nach dem neuen Lauf: ${ticker}, ungeprüft über den Ticker`)
        gleich(namensWarnung(s.titel.name, { AA: 'Alcoa Corporation', MC: 'Moelis & Company', T: 'AT&T Inc.' }[ticker], ticker) !== null, true, `${ticker}: der Stamm-Name «${bpName}» widerspricht der Kursquelle → Warnung`)
    }
    // SAN: bisher reiner Bitpanda-Titel mit gespeichertem SAN.PA (oben). Kommt der Future SANUSDT dazu, gilt SAN.
    gleich([(await ladeTitel(knex, 'SAN')).kursSymbol, (await ladeTitel(knex, 'SAN')).perp], ['SAN.PA', false], 'SAN nur bei Bitpanda: SAN.PA gilt, kein Future')
    await knex('instrument_listungen').insert({ instrumentId: san, handelsplatz: 'bitunix', symbol: 'SANUSDT', art: 'perp', quote: 'USDT', sicher: 1, aktiv: 1, ersteSichtung: 1, letzteSichtung: 1 })
    let s = await ladeTitel(knex, 'SAN')
    gleich([s.kursSymbol, s.zuordnung, s.perp], ['SAN', null, true], 'SAN mit Future daneben: gespeichertes SAN.PA (Sanofi) gilt nicht mehr, Kurssymbol SAN')
    await knex('newcomer_titel').where('instrumentId', san).update({ kursSymbol: null, zuordnung: null, grund: 'keinTreffer' })
    gleich((await ladeTitel(knex, 'SAN')).kursSymbol, null, 'SAN mit Future, Lauf fand nichts: unbekannt bis zum nächsten Lauf')
    await knex('newcomer_titel').where('instrumentId', san).update({ kursSymbol: 'SAN.PA', zuordnung: 'suche', grund: null })
    await knex('instrument_listungen').where({ instrumentId: san, handelsplatz: 'bitunix' }).update({ aktiv: 0 })
    gleich([(await ladeTitel(knex, 'SAN')).kursSymbol, (await ladeTitel(knex, 'SAN')).perp], ['SAN.PA', false], 'Future abgelistet (inaktiv): wieder der reine Bitpanda-Titel')
    // Ein Token an Pionex ist kein Future: reine Bitpanda-Regel.
    const ai = await lege('AI', 'Air Liquide', [['bitpanda', 'AI', 'broker-spot'], ['pionex', 'AIX_USDT', 'token-spot']])
    await knex('newcomer_titel').insert(zeile(ai, 'AI.PA', 'suche'))
    gleich([(await ladeTitel(knex, 'AI')).kursSymbol, (await ladeTitel(knex, 'AI')).perp], ['AI.PA', false], 'AI ohne Future: gefundene Heimatlistung gilt weiter')

    // Dieselbe Regel überall, wo ein Future gemeint ist — und die Titel-Seite nennt den Namen zweifelhaft.
    const fs = await import('node:fs')
    const lies = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
    ok(/kursSymbolFuer\(zeile, gemerkt \|\| null, \{ perp: true \}\)/.test(lies('./kontext.js')), 'Chart-Kontext (Backtest, Papierbetrieb): Ticker des Futures massgebend')
    ok(/kursSymbolFuer\(t, \(t\.id && zeilen\.get\(t\.id\)\) \|\| null, \{ perp: true \}\)/.test(lies('../coin-radar/aktien-tagesdaten.js')), 'Aktien-Radar: Ticker des Futures massgebend')
    ok(/kursSymbolFuer\(t, kursSymbole\.get\(t\.id\) \|\| null, \{ perp: mitPerp\.has\(t\.id\) \}\)/.test(lies('./meldungen.js')), 'Zahlen-Mail: Ticker des Futures massgebend')
    ok(/nameZweifelhaft: !!nameQuelle && perp === true/.test(lies('./api.js')), 'Titel-Seite: mit Future ist der Stamm-Name der zweifelhafte Teil')
    ok(/seite\.nameZweifelhaft \? 'titel\.nameZweifelhaft' : 'titel\.nameAbweichung'/.test(lies('../../src/components/aktien/TitelAnsicht.vue')), 'Titel-Seite zeigt den eigenen Hinweis')
    for (const sprache of ['de', 'en']) {
        const text = JSON.parse(lies(`../../src/i18n/locales/${sprache}.json`)).titel.nameZweifelhaft
        ok(typeof text === 'string' && ['{stamm}', '{quelle}', '{symbol}'].every((p) => text.includes(p)), `Hinweistext ${sprache} mit allen Platzhaltern`)
    }
}

await knex.destroy()
console.log(`✓ Titel-Zuordnung: ${n} Prüfungen`)
