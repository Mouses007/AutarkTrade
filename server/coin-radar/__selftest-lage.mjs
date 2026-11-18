/**
 * Selbsttest der Karte «Projekt-Lage» in der Coin-Ansicht:
 * `lage-kern.js` (rein) und die Verdrahtung in `lage.js`.
 *
 * Ohne Netz: `fetch` und axios sind gesperrt; Google News, Coin-Info und die
 * KI-Recherche sind Attrappen. Es geht NIE ein bezahlter Abruf hinaus. Die
 * Datenbank ist eine SQLite im Speicher.
 *
 * Geprüft wird vor allem, was den Anlass der Karte wieder verschwinden liesse:
 * die Hivemapper-Schlagzeile (Auszahlung in USDC, Vertrag beendet) muss als
 * Änderung am Token-Nutzen erkannt werden, ein Kurskommentar nicht.
 *
 * Aufruf: node server/coin-radar/__selftest-lage.mjs
 */
import assert from 'node:assert/strict'
import axios from 'axios'
import knexLib from 'knex'

globalThis.fetch = async (url) => { throw new Error('Netz gesperrt (fetch): ' + url) }
axios.defaults.adapter = async (c) => { throw new Error('Netz gesperrt (axios): ' + c.url) }

const k = await import('./lage-kern.js')
const { holeLage, starteRecherche, _vergiss } = await import('./lage.js')

let gut = 0
let schlecht = 0
async function pruefe(name, fn) {
    try { await fn(); gut++ } catch (e) { schlecht++; console.error(`  ✗ ${name}\n    ${e.message}`) }
}

const TAG = 86_400_000
const JETZT = Date.UTC(2026, 10, 18, 12, 0, 0)

console.log('Projekt-Lage (Coin-Ansicht)')

// ── Warnmuster ──────────────────────────────────────────────────────────
await pruefe('Hivemapper: USDC statt HONEY, Vertrag beendet → tokenZweck', () => {
    const r = k.ordneEin('Bee Maps switches contributor rewards to USDC, ends Hivemapper Foundation agreement')
    assert.equal(r.art, 'tokenZweck')
})
await pruefe('Warnmuster je Art (en + de)', () => {
    const faelle = [
        ['Bee app now pays drivers in stablecoins instead of HONEY', 'tokenZweck'],
        ['Project X will no longer support its native token', 'tokenZweck'],
        ['Foundation announces token migration to new chain', 'tokenZweck'],
        ['Token swap: holders can exchange XYZ for the new token', 'tokenZweck'],
        ['Fantom rebrands to Sonic', 'tokenZweck'],
        ['Company to sunset its mapping app by year end', 'tokenZweck'],
        ['Partner terminates licensing agreement', 'tokenZweck'],
        ['Auszahlungen künftig in USDC statt im eigenen Token', 'tokenZweck'],
        ['Stiftung hat den Vertrag mit der App-Firma gekündigt', 'tokenZweck'],
        ['Binance will delist FOO, BAR and BAZ', 'delisting'],
        ['Coinbase removes trading pairs for ABC', 'delisting'],
        ['Upbit suspends deposits and withdrawals for XYZ', 'delisting'],
        ['Protocol drained of $12M in bridge exploit', 'sicherheit'],
        ['Investors fear a rug pull after team wallet moves', 'sicherheit'],
        ['Börse gehackt: Coins gestohlen', 'sicherheit'],
        ['SEC sues developer over unregistered securities', 'recht'],
        ['Firm behind the token files for bankruptcy', 'recht'],
        ['Klage gegen die Gründer eingereicht', 'recht'],
        ['$80M token unlock next week', 'angebot'],
        ['Emission schedule raises inflation to 12 %', 'angebot'],
    ]
    for (const [titel, art] of faelle) assert.equal(k.ordneEin(titel).art, art, titel)
})
await pruefe('Neutrale Schlagzeilen bleiben ohne Warnsignal', () => {
    for (const titel of [
        'Hivemapper Price (HONEY/USD) Today | Live Price, Market Cap & Chart',
        'Top DePIN Projects 2026: Explore the Best in DePIN Crypto',
        'Escape Velocity raises a $62 million fund to bet on DePIN networks',
        'Solana ecosystem: leading projects and tokens',
        'Wie funktioniert ein Kartennetzwerk mit Dashcams?',
        'Security token offerings explained',          // «security» allein ist kein Hack
    ]) assert.equal(k.ordneEin(titel).art, null, titel)
})
await pruefe('«SEC» nur in Grossbuchstaben (nicht «sec» als Sekunde)', () => {
    assert.equal(k.ordneEin('Block time drops to 0.4 sec').art, null)
})
await pruefe('Mehrere Arten: Vorrang nach Reihenfolge, alle in `arten`', () => {
    const r = k.ordneEin('Exchange delists token after exploit')
    assert.equal(r.art, 'sicherheit')
    assert.deepEqual(r.arten, ['sicherheit', 'delisting'])
    assert.equal(k.SCHWERE.tokenZweck, 'rot')
    assert.equal(k.SCHWERE.angebot, 'gelb')
})

// ── Titel ───────────────────────────────────────────────────────────────
await pruefe('Titelbereinigung: bekannte Quelle fällt weg', () => {
    assert.deepEqual(k.bereinigeTitel('Crypto backers bet on hotspots - Fortune', 'Fortune'), { titel: 'Crypto backers bet on hotspots', quelle: 'Fortune' })
    assert.deepEqual(k.bereinigeTitel('Top DePIN Projects 2026 - Coin Bureau', 'Coin Bureau'), { titel: 'Top DePIN Projects 2026', quelle: 'Coin Bureau' })
})
await pruefe('Titelbereinigung: Gedankenstrich mitten im Titel bleibt', () => {
    assert.equal(k.bereinigeTitel('Bitcoin - the long view - Reuters', 'Reuters').titel, 'Bitcoin - the long view')
    assert.equal(k.bereinigeTitel('Rally continues - but for how long, analysts ask about the recent move in markets').titel,
        'Rally continues - but for how long, analysts ask about the recent move in markets')
    assert.deepEqual(k.bereinigeTitel('Something happened - CoinDesk'), { titel: 'Something happened', quelle: 'CoinDesk' })
})

// ── RSS-Parsing (handgeschriebene Fixture im Format der Google-News-Suche) ──
const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google News</title>
<item><title>Bee Maps switches contributor rewards to USDC, ends Hivemapper Foundation agreement - The Block</title>
<link>https://news.google.com/rss/articles/AAA?oc=5</link><guid isPermaLink="false">AAA</guid>
<pubDate>Tue, 12 Aug 2026 14:00:00 GMT</pubDate><description>&lt;a href="x"&gt;…&lt;/a&gt;</description><source url="https://www.theblock.co">The Block</source></item>
<item><title>Bee Maps switches contributor rewards to USDC, ends Hivemapper Foundation agreement - CoinDesk</title>
<link>https://news.google.com/rss/articles/BBB?oc=5</link><guid isPermaLink="false">BBB</guid>
<pubDate>Tue, 12 Aug 2026 18:00:00 GMT</pubDate><source url="https://www.coindesk.com">CoinDesk</source></item>
<item><title>Hivemapper Price (HONEY/USD) Today &amp; Chart - Binance</title>
<link>https://news.google.com/rss/articles/CCC?oc=5</link><guid isPermaLink="false">CCC</guid>
<pubDate>Wed, 11 Nov 2026 08:00:00 GMT</pubDate><source url="https://www.binance.com">Binance</source></item>
<item><title>Old news from two years ago - Fortune</title>
<link>https://news.google.com/rss/articles/DDD?oc=5</link><guid isPermaLink="false">DDD</guid>
<pubDate>Mon, 01 Jan 2024 08:00:00 GMT</pubDate><source url="https://fortune.com">Fortune</source></item>
<item><title>Bad link - Spam</title><link>javascript:alert(1)</link><guid>EEE</guid><source url="https://x">Spam</source></item>
</channel></rss>`

await pruefe('RSS: Titel, Quelle separat, Zeit, Verweis', () => {
    const l = k.leseGoogleNews(RSS)
    assert.equal(l.length, 4, 'javascript:-Verweis fällt weg')
    assert.equal(l[0].titel, 'Bee Maps switches contributor rewards to USDC, ends Hivemapper Foundation agreement')
    assert.equal(l[0].quelle, 'The Block')
    assert.equal(l[2].titel, 'Hivemapper Price (HONEY/USD) Today & Chart')
    assert.equal(l[2].quelle, 'Binance')
    assert.equal(l[0].zeit, Date.UTC(2026, 7, 12, 14))
    assert.equal(l[0].url, 'https://news.google.com/rss/articles/AAA?oc=5')
    assert.equal(l[0].herkunft, 'googleNews')
})
await pruefe('RSS: leer und Unsinn ergeben eine leere Liste', () => {
    assert.deepEqual(k.leseGoogleNews(''), [])
    assert.deepEqual(k.leseGoogleNews('<html>Fehlerseite</html>'), [])
})
await pruefe('Google-News-Adresse: Phrase, ein Jahr, kodiert, ohne Anführungszeichen im Namen', () => {
    const u = k.googleNewsUrl('Hive"mapper')
    assert.ok(u.startsWith('https://news.google.com/rss/search?q='))
    assert.equal(new URL(u).searchParams.get('q'), '"Hive mapper" when:1y')
    assert.equal(new URL(u).searchParams.get('ceid'), 'US:en')
    assert.equal(new URL(k.googleNewsUrl('HONEY', { zusatz: 'crypto' })).searchParams.get('q'), '"HONEY" crypto when:1y')
    assert.equal(k.googleNewsUrl('  '), '')
})

// ── Dubletten, Sortierung, Kürzen ───────────────────────────────────────
await pruefe('Dubletten zusammengefasst, Alte weg, neueste oben', () => {
    const z = k.fasseZusammen(k.leseGoogleNews(RSS), { jetzt: JETZT })
    assert.equal(z.length, 2, JSON.stringify(z.map((e) => e.titel)))
    assert.equal(z[0].titel, 'Hivemapper Price (HONEY/USD) Today & Chart')
    assert.equal(z[1].art, 'tokenZweck')
    assert.equal(z[1].schwere, 'rot')
    assert.deepEqual(z[1].weitere, ['CoinDesk'], 'zweite Quelle wird mitgezählt')
    assert.equal(z[1].zeit, Date.UTC(2026, 7, 12, 14), 'die frühere Meldung zählt')
    assert.deepEqual(k.zaehleWarnungen(z), { tokenZweck: 1 })
})
await pruefe('Gleicher Verweis aus beiden Herkünften zählt einmal', () => {
    const z = k.fasseZusammen([
        { titel: 'A', url: 'https://a.example/1', zeit: JETZT - TAG, herkunft: 'eigene' },
        { titel: 'B anders', url: 'https://a.example/1', zeit: JETZT - TAG, herkunft: 'googleNews' },
    ], { jetzt: JETZT })
    assert.equal(z.length, 1)
    assert.equal(z[0].herkunft, 'eigene')
})
await pruefe('Kürzen auf 15: Warnungen bleiben, auch wenn sie älter sind', () => {
    const roh = []
    for (let i = 0; i < 30; i++) roh.push({ titel: `Neutral meldung nummer ${i}`, url: `https://n.example/${i}`, zeit: JETZT - i * TAG })
    roh.push({ titel: 'Exchange will delist the token', url: 'https://w.example/1', zeit: JETZT - 200 * TAG })
    const z = k.fasseZusammen(roh, { jetzt: JETZT })
    assert.equal(z.length, k.LAGE_MAX)
    assert.ok(z.some((e) => e.art === 'delisting'), 'Warnung bleibt drin')
    assert.equal(z[z.length - 1].art, 'delisting', 'sortiert nach Datum, die alte Warnung steht unten')
    for (let i = 1; i < z.length; i++) assert.ok((z[i - 1].zeit ?? 0) >= (z[i].zeit ?? 0))
})
await pruefe('Ohne Titel, ohne http(s) oder in der Zukunft fällt weg', () => {
    const z = k.fasseZusammen([
        { titel: '', url: 'https://a.example/1', zeit: JETZT },
        { titel: 'x', url: 'ftp://a.example/1', zeit: JETZT },
        { titel: 'Zukunft', url: 'https://a.example/2', zeit: JETZT + 10 * TAG },
        { titel: 'Ohne Datum', url: 'https://a.example/3', zeit: null },
    ], { jetzt: JETZT })
    assert.deepEqual(z.map((e) => e.titel), ['Ohne Datum'])
})

// ── Treffer aufs Projekt ────────────────────────────────────────────────
await pruefe('Kürzel nur, wenn eindeutig', () => {
    assert.equal(k.symbolEindeutig('HONEY'), false, 'Honig')
    assert.equal(k.symbolEindeutig('ONE'), false)
    assert.equal(k.symbolEindeutig('OP'), false, 'zu kurz')
    assert.equal(k.symbolEindeutig('HNT'), true)
    assert.equal(k.symbolEindeutig('1000'), false)
})
await pruefe('Name als ganzes Wort, Kürzel gross und eindeutig', () => {
    const p = { name: 'Hivemapper', basis: 'HONEY' }
    assert.ok(k.passtZuProjekt('Hivemapper drivers mapped 30% of the world', p))
    assert.ok(k.passtZuProjekt('Neues von hivemapper', p))
    assert.ok(!k.passtZuProjekt('Hivemappers fan club', p), 'Wortteil zählt nicht')
    assert.ok(!k.passtZuProjekt('HONEY price rallies', p), 'HONEY ist mehrdeutig')
    const h = { name: 'Helium', basis: 'HNT' }
    assert.ok(k.passtZuProjekt('HNT jumps after listing', h))
    assert.ok(k.passtZuProjekt('Why $HNT moved today', h))
    assert.ok(!k.passtZuProjekt('hnt in kleinbuchstaben', h))
    assert.ok(!k.passtZuProjekt('HNTX token launches', h))
    assert.ok(!k.passtZuProjekt('BREAKING: HNT MARKET UPDATE FOR TODAY', { name: '', basis: 'HNT' }), 'Titel ganz in Grossbuchstaben')
})

// ── KI-Recherche: Antwort lesen (Attrappen) ─────────────────────────────
const ZITATE = ['https://www.theblock.co/post/1', 'https://beemaps.com/blog/usdc', 'http://unsicher.example/x']
await pruefe('Recherche: sauberes JSON im Zaun, Belege über Nummern', () => {
    const text = '```json\n' + JSON.stringify({
        befunde: [
            { art: 'tokenZweck', text: 'Die Bee-App zahlt seit August 2026 in USDC statt HONEY aus.[2]', datum: '2026-08', quelleUrl: '[2]' },
            { art: 'partner', text: 'Vertrag mit der Hivemapper Foundation gekündigt [1].', datum: '2026-08-12', quelleUrl: '' },
            { art: 'Börse', text: 'Kein Delisting bekannt.', datum: 'August', quelleUrl: 'javascript:alert(1)' },
            { art: 'tokenZweck', text: '', datum: '2026-01' },
        ],
        fazit: 'Der Token verlor seine Rolle als Auszahlungsmittel.[1][2]',
    }) + '\n```'
    const r = k.leseRecherche(text, ZITATE, new Map([['https://www.theblock.co/post/1', '2026-08-12']]))
    assert.equal(r.kaputt, false)
    assert.equal(r.befunde.length, 3, 'leerer Befund fällt weg')
    assert.equal(r.befunde[0].quelleUrl, 'https://beemaps.com/blog/usdc')
    assert.equal(r.befunde[0].text, 'Die Bee-App zahlt seit August 2026 in USDC statt HONEY aus.')
    assert.equal(r.befunde[1].quelleUrl, 'https://www.theblock.co/post/1', 'Nummer aus dem Text')
    assert.equal(r.befunde[1].datum, '2026-08-12')
    assert.equal(r.befunde[2].art, 'delisting', 'Synonym «Börse»')
    assert.equal(r.befunde[2].datum, '', 'ungültiges Datum fällt weg')
    assert.equal(r.befunde[2].quelleUrl, '', 'javascript: ist keine Quelle')
    assert.equal(r.fazit, 'Der Token verlor seine Rolle als Auszahlungsmittel.')
    assert.deepEqual(r.quellen.map((q) => q.url), ZITATE.slice(0, 2), 'nur https-Zitate')
    assert.equal(r.quellen[0].datum, '2026-08-12')
})
await pruefe('Recherche: JSON mit Sätzen drumherum', () => {
    const r = k.leseRecherche('Hier das Ergebnis:\n{"befunde": [], "fazit": "Nichts Belegtes gefunden."}\nViel Erfolg!', [])
    assert.equal(r.kaputt, false)
    assert.deepEqual(r.befunde, [])
    assert.equal(r.fazit, 'Nichts Belegtes gefunden.')
})
await pruefe('Recherche: kaputtes JSON → Rohtext, Quellen bleiben', () => {
    const r = k.leseRecherche('{"befunde": [{"art": "tokenZweck", "text": "abgebrochen', ZITATE)
    assert.equal(r.kaputt, true)
    assert.deepEqual(r.befunde, [])
    assert.ok(r.rohText.includes('abgebrochen'))
    assert.equal(r.quellen.length, 2)
    const fliess = k.leseRecherche('**Kurz:** Die App zahlt nun in USDC aus [1].', ZITATE)
    assert.equal(fliess.kaputt, true)
    assert.ok(!fliess.rohText.includes('**'), 'Markdown-Sternchen weg')
    assert.equal(k.leseRecherche('', null).kaputt, true)
    assert.equal(k.leseRecherche('[1, 2, 3]', []).kaputt, true, 'eine Liste ist kein Ergebnis')
})
await pruefe('Recherche-Frage: Projekt, Zeitraum, JSON, keine Anlageberatung', () => {
    const f = k.rechercheFrage({ name: 'Hivemapper', basis: 'HONEY', heute: new Date(JETZT) })
    assert.ok(f.includes('Hivemapper (HONEY)'))
    assert.ok(f.includes('12 Monaten') && f.includes('2026-11-18'))
    assert.ok(f.includes('"befunde"') && f.includes('"fazit"'))
    assert.ok(/keine Anlageberatung/.test(f))
})

// ── Verdrahtung in lage.js (SQLite im Speicher, Attrappen) ──────────────
const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
await knex.schema.createTable('settings', (t) => { t.increments('id').primary(); t.text('radarNewsRechercheModell') })
await knex('settings').insert({ id: 1, radarNewsRechercheModell: 'sonar-pro' })
await knex.schema.createTable('api_cache', (t) => { t.string('key').primary(); t.bigInteger('ts'); t.text('payload') })
await knex.schema.createTable('news_sources', (t) => { t.increments('id').primary(); t.string('art'); t.text('name') })
await knex.schema.createTable('news_items', (t) => {
    t.increments('id').primary(); t.integer('sourceId'); t.text('titel'); t.text('url'); t.text('inhalt'); t.bigInteger('publishedAt')
})
await knex('news_sources').insert([{ id: 1, art: 'rss', name: 'The Defiant' }, { id: 2, art: 'telegram', name: 'Kanal' }])
await knex('news_items').insert([
    { sourceId: 1, titel: 'Hivemapper ends token rewards for drivers', url: 'https://thedefiant.io/1', inhalt: '', publishedAt: JETZT - 3 * TAG },
    { sourceId: 1, titel: 'Honeypot scams on the rise', url: 'https://thedefiant.io/2', inhalt: 'no project here', publishedAt: JETZT - 2 * TAG },
    { sourceId: 2, titel: 'Hivemapper hacked (Telegram)', url: 'https://t.me/x/1', inhalt: '', publishedAt: JETZT - TAG },
])

let gnAbrufe = 0
let kiAbrufe = 0
const basisDeps = (extra = {}) => ({
    knex,
    jetzt: JETZT,
    coinInfo: async () => ({ id: 'hivemapper', name: 'Hivemapper' }),
    holeText: async (url) => { gnAbrufe++; assert.ok(url.startsWith('https://news.google.com/rss/search?q=')); return RSS },
    erlaubt: async (id) => { assert.equal(id, 'googleNews'); return true },
    artenEntfernt: async () => ['telegram'],
    llm: { ladeLlmConfig: async () => ({ apiKey: 'pplx-attrappe' }), merkeKiGuthaben: async () => { }, istGuthabenFehler: () => false },
    rechercheThema: async (a) => {
        kiAbrufe++
        assert.equal(a.funktion, 'coin-lage')
        assert.equal(a.ausloeser, 'manuell')
        assert.equal(a.modell, 'sonar-pro', 'Modell der Nachrichten-Recherche')
        return {
            text: JSON.stringify({ befunde: [{ art: 'tokenZweck', text: 'Auszahlung in USDC.', datum: '2026-08', quelleUrl: '[1]' }], fazit: 'Token ohne Auszahlungsrolle.' }),
            citations: ['https://beemaps.com/blog/usdc'], quellenDaten: new Map(), kostenUsd: 0.012,
        }
    },
    ...extra,
})

await pruefe('GET-Teil: Google News + eigene Meldungen, Telegram und Wortteile draussen, keine KI', async () => {
    _vergiss()
    const r = await holeLage('HONEYUSDT', basisDeps())
    assert.equal(r.basis, 'HONEY')
    assert.equal(r.name, 'Hivemapper')
    assert.equal(r.googleNews.zustand, 'ok')
    assert.equal(r.eigene.anzahl, 1, 'nur die passende eigene Meldung')
    assert.ok(r.eintraege.some((e) => e.herkunft === 'eigene' && e.url === 'https://thedefiant.io/1'))
    assert.ok(!r.eintraege.some((e) => e.url.startsWith('https://t.me')), 'abgeschaltete Art bleibt draussen')
    assert.ok(r.warnAnzahl >= 1 && r.warnungen.tokenZweck >= 1)
    assert.equal(r.recherche.moeglich, true)
    assert.equal(r.recherche.ergebnis, null)
    assert.equal(kiAbrufe, 0, 'GET löst nie eine Recherche aus')
})
await pruefe('Google News 6 h im Zwischenspeicher', async () => {
    const vorher = gnAbrufe
    await holeLage('HONEYUSDT', basisDeps())
    assert.equal(gnAbrufe, vorher, 'zweites Öffnen ohne Abruf')
    await holeLage('HONEYUSDT', basisDeps({ jetzt: JETZT + 7 * 3600e3 }))
    assert.equal(gnAbrufe, vorher + 1, 'nach 7 h neu')
})
await pruefe('Schalter aus: Zustand «aus» mit Grund, kein Abruf', async () => {
    const vorher = gnAbrufe
    const r = await holeLage('HONEYUSDT', basisDeps({ jetzt: JETZT + 30 * 3600e3, erlaubt: async () => false }))
    assert.equal(r.googleNews.zustand, 'aus')
    assert.equal(r.googleNews.aus.grund, 'ohneFreigabe')
    assert.equal(r.googleNews.aus.quelle, 'Google News (RSS-Suche)')
    assert.equal(gnAbrufe, vorher)
    assert.equal(r.eigene.anzahl, 1, 'die eigenen Meldungen stehen trotzdem')
})
await pruefe('Google News gestört: Fehlerzustand, Rest steht', async () => {
    _vergiss()
    const r = await holeLage('HONEYUSDT', basisDeps({ jetzt: JETZT + 60 * 3600e3, holeText: async () => { throw new Error('HTTP 503') } }))
    assert.equal(r.googleNews.zustand, 'fehler')
    assert.equal(r.eigene.zustand, 'ok')
})
await pruefe('Ohne CoinGecko und mit mehrdeutigem Kürzel: keine Suche, Recherche nicht möglich', async () => {
    const r = await holeLage('HONEYUSDT', basisDeps({ coinInfo: async () => null }))
    assert.equal(r.googleNews.zustand, 'ohneName')
    assert.equal(r.recherche.moeglich, false)
    assert.equal(r.recherche.grund, 'ohneName')
})
await pruefe('Ohne Perplexity-Schlüssel: Knopf aus, POST verweigert ohne Abruf', async () => {
    _vergiss()
    const ohne = basisDeps({ llm: { ladeLlmConfig: async () => ({ apiKey: '' }) } })
    const r = await holeLage('HONEYUSDT', ohne)
    assert.equal(r.recherche.moeglich, false)
    assert.equal(r.recherche.grund, 'ohneSchluessel')
    await assert.rejects(() => starteRecherche('HONEYUSDT', ohne), (e) => e.status === 400)
    assert.equal(kiAbrufe, 0)
})
await pruefe('POST: Recherche mit Attrappe, gespeichert, GET liefert sie ohne neuen Abruf', async () => {
    _vergiss()
    const e = await starteRecherche('HONEYUSDT', basisDeps())
    assert.equal(kiAbrufe, 1)
    assert.equal(e.befunde[0].quelleUrl, 'https://beemaps.com/blog/usdc')
    assert.equal(e.kiGeneriert, true)
    const r = await holeLage('HONEYUSDT', basisDeps({ jetzt: JETZT + 3600e3 }))
    assert.equal(r.recherche.ergebnis.fazit, 'Token ohne Auszahlungsrolle.')
    assert.equal(r.recherche.ergebnis.alterMs, 3600e3)
    assert.equal(kiAbrufe, 1)
    const spaeter = await holeLage('HONEYUSDT', basisDeps({ jetzt: JETZT + 25 * 3600e3 }))
    assert.equal(spaeter.recherche.ergebnis, null, 'nach 24 h verfallen')
})
await pruefe('POST: Fehlschlag sperrt 45 s', async () => {
    _vergiss()
    const kaputt = basisDeps({ rechercheThema: async () => { kiAbrufe++; throw new Error('Perplexity HTTP 500') } })
    const vorher = kiAbrufe
    await assert.rejects(() => starteRecherche('HNTUSDT', kaputt))
    await assert.rejects(() => starteRecherche('HNTUSDT', kaputt), (e) => e.status === 429)
    assert.equal(kiAbrufe, vorher + 1)
})

await knex.destroy()
console.log(`\n${gut} bestanden, ${schlecht} fehlgeschlagen`)
process.exit(schlecht ? 1 : 0)
