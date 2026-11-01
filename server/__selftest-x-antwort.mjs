/**
 * Selbsttest: Grok-Antworten der X-Suche mit unsichtbaren Zeichen.
 *
 * Läuft ohne Netz und ohne Datenbank. xAI setzt ab dem 07.11.2026 ein
 * Wasserzeichen in Grok-Texte, ohne zu sagen wie. Wären es unsichtbare
 * Zeichen, fände die Frühphase keine Adressen und Kürzel mehr, die
 * Zitat-Kontrolle keine Post-IDs und `JSON.parse` keine Liste — still.
 * Geprüft wird beides: dass `leseXAntwort` solche Zeichen entfernt, und dass
 * dieselbe Antwort ohne den Filter wirklich bräche (sonst prüfte der Test
 * nichts). Dazu: Parsen VOR dem Filtern (U+2028 roh, `\u200B`-Escapes),
 * Schrift und Emoji, die Verbinder brauchen, bleiben heil, und die Zeit eines
 * Posts kommt aus seiner ID, nicht aus Groks `datum`.
 *
 * Aufruf: node server/__selftest-x-antwort.mjs
 */
import { leseXAntwort, leseXListe, ohneUnsichtbares, tweetZeit, xImFenster, sucheXZuCoin, sucheXErwaehnungen } from './news-recherche.js'
import { erwaehnungenIn } from './hype-radar/fruehphase-bewertung.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const NB = '\u200B'          // Leerzeichen der Breite null
const WV = '\u200D'          // Wortverbinder (Emoji)
const BOM = '\uFEFF'
const TAG = '\u{E0041}'      // Tag-Zeichen „A"
const SOL = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'
const EVM = '0x6982508145454ce325ddbe47a25d4ec3d2311933'

// ── ohneUnsichtbares ─────────────────────────────────────────────────────
{
    pruefe('Nullbreite raus', ohneUnsichtbares(`$PE${NB}PE`) === '$PEPE')
    pruefe('BOM, Wortverbinder, Tag-Zeichen raus', ohneUnsichtbares(`${BOM}a${WV}b${TAG}c`) === 'abc')
    pruefe('Variantenwähler und Graphem-Verbinder raus', ohneUnsichtbares('x\uFE0Fy\u034Fz\u{E0101}') === 'xyz')
    pruefe('Bidi-Steuerung raus', ohneUnsichtbares('\u202Eab\u202C\u2066c\u2069') === 'abc')
    pruefe('andere Leerzeichen werden gewöhnliche', ohneUnsichtbares('a\u00A0b\u202Fc\u3000d') === 'a b c d')
    pruefe('Zeilentrenner werden Zeilenenden', ohneUnsichtbares('a\u2028b\u2029c') === 'a\nb\nc')
    const normal = 'Größe ändert sich: 1,5 % — „Zitat" 🚀 $BTC über 80.000'
    pruefe('gewöhnlicher Text bleibt gleich', ohneUnsichtbares(normal) === normal)
    pruefe('leer und null', ohneUnsichtbares(null) === '' && ohneUnsichtbares(undefined) === '' && ohneUnsichtbares('') === '')

    // Default-Ignorable ausserhalb von Cf (bis 01.11.2026 durchgelassen).
    for (const c of [0x3164, 0x115F, 0x1160, 0xFFA0, 0x180B, 0x180F, 0x17B4, 0x17B5, 0x2065, 0xFFF0, 0xFFF8, 0xE0080, 0xE0FFF]) {
        const z = String.fromCodePoint(c)
        const t = ohneUnsichtbares(`$PE${z}PE ${SOL.slice(0, 20)}${z}${SOL.slice(20)}`)
        const e = erwaehnungenIn(t)
        pruefe(`U+${c.toString(16).toUpperCase()} raus, PEPE und Adresse gefunden`, e.kuerzel.includes('PEPE') && e.adressen.includes(SOL), t)
    }
    pruefe('Braille-Leerzeichen wird ein Leerzeichen', ohneUnsichtbares('a\u2800b') === 'a b')
    // Gegenproben: wo die Verbinder zur Schrift gehören, bleiben sie.
    for (const [name, t] of [
        ['Emoji-Familie (ZWJ)', '👩\u200D💻 👨\u200D👩\u200D👧'],
        ['Emoji mit Hautton und ZWJ', '👩🏽\u200D💻'],
        ['Regenbogenfahne (FE0F + ZWJ)', '🏳\uFE0F\u200D🌈'],
        ['Herz mit FE0F', '❤\uFE0F'],
        ['Tasten-Emoji', '1\uFE0F\u20E3'],
        ['Persisch mit Nichtverbinder', 'می\u200Cخواهم'],
        ['Devanagari mit Wortverbinder', 'क्\u200Dष'],
        ['Malayalam mit Nichtverbinder', 'ന്\u200Cന'],
        ['Mongolisch mit Variantenwähler', 'ᠮ\u180Bᠣᠩᠭᠣᠯ'],
    ]) pruefe(`${name} bleibt`, ohneUnsichtbares(t) === t, JSON.stringify(ohneUnsichtbares(t)))
    pruefe('Verbinder zwischen lateinischen Buchstaben raus', ohneUnsichtbares('$PE\u200CPE \u200D$X') === '$PEPE $X')
    pruefe('Verbinder neben weiterem unsichtbarem Zeichen raus', ohneUnsichtbares('👩\u200B\u200D💻') === '👩💻')
    pruefe('Verbinder zwischen Emoji und Kürzel raus', ohneUnsichtbares('🚀\u200D$PEPE') === '🚀$PEPE')
    pruefe('Mongolischer Variantenwähler im Kürzel raus', ohneUnsichtbares('$PE\u180B\u180BPE') === '$PEPE')
    pruefe('FE0F nach Buchstabe raus', ohneUnsichtbares('P\uFE0FEPE') === 'PEPE')
}

// ── leseXAntwort: gezeichnete Antwort wie von der Responses-API ──────────
{
    const liste = `${BOM}[${NB}{"handle":"alice","url":"https://x.com/alice/status/18${NB}5501","text":"Neu: ${SOL.slice(0, 20)}${NB}${SOL.slice(20)} und $PE${WV}PE 🚀"},`
        + `\n{"handle":"bob","url":"https://x.com/bob/status/1855${NB}02","text":"${EVM.slice(0, 10)}${NB}${EVM.slice(10)} pumpt"}${NB}]`
    const antwort = {
        output: [
            { type: 'x_search_call' },
            {
                type: 'message',
                content: [{
                    type: 'output_text',
                    text: liste,
                    annotations: [
                        { type: 'url_citation', url: `https://x.com/alice/status/1855${NB}01` },
                        { type: 'url_citation', url: 'https://x.com/bob/status/185502' },
                    ],
                }],
            },
        ],
        citations: [`https://x.com/carol/status/99${BOM}9`],
    }

    // Gegenprobe: ohne Filter bräche genau das, worauf der Rest baut.
    let rohLesbar = true
    try { JSON.parse(liste.trim()) } catch { rohLesbar = false }
    pruefe('Gegenprobe: roh scheitert JSON.parse', !rohLesbar)
    const rohErw = erwaehnungenIn(`Neu: ${SOL.slice(0, 20)}${NB}${SOL.slice(20)} und $PE${WV}PE`)
    pruefe('Gegenprobe: roh keine Adresse, kein PEPE', !rohErw.adressen.includes(SOL) && !rohErw.kuerzel.includes('PEPE'))

    const { text, zitierteIds, zitierteUrls } = leseXAntwort(antwort)
    let posts = null
    try { posts = JSON.parse(text.trim()) } catch (e) { pruefe('Text ist JSON', false, e.message) }
    pruefe('zwei Posts gelesen', Array.isArray(posts) && posts.length === 2)
    if (Array.isArray(posts) && posts.length === 2) {
        const a = erwaehnungenIn(posts[0].text)
        pruefe('Solana-Adresse gefunden', a.adressen.includes(SOL), JSON.stringify(a))
        pruefe('Kürzel PEPE gefunden', a.kuerzel.includes('PEPE'), JSON.stringify(a))
        pruefe('EVM-Adresse gefunden', erwaehnungenIn(posts[1].text).adressen.includes(EVM))
        pruefe('Post-URL ohne Zeichen', posts[0].url === 'https://x.com/alice/status/185501')
    }
    pruefe('Zitat-IDs aus Anmerkungen und citations',
        zitierteIds.has('185501') && zitierteIds.has('185502') && zitierteIds.has('999'), [...zitierteIds].join(','))
    pruefe('Zitat-URLs ohne Zeichen', zitierteUrls.every((u) => ohneUnsichtbares(u) === u))
}

// ── leseXListe: erst parsen, dann filtern ─────────────────────────────────
{
    const posts = [
        { handle: 'alice', url: 'https://x.com/alice/status/185501', text: 'Binance listet $FOO\u2028Details folgen' },
        { handle: 'bob', url: 'https://x.com/bob/status/185502', text: 'Unlock\u2029$FOO' },
    ]
    const roh = JSON.stringify(posts)          // U+2028/2029 roh im String — gültiges JSON
    pruefe('Gegenprobe: roh mit U+2028 ist gültiges JSON', JSON.parse(roh).length === 2)
    const liste = leseXListe(roh)
    pruefe('U+2028 roh: beide Posts gelesen', liste?.length === 2, String(liste?.length))
    pruefe('U+2028 im Feld wird ein Zeilenende', liste?.[0]?.text === 'Binance listet $FOO\nDetails folgen', JSON.stringify(liste?.[0]?.text))
    const antwort = { output: [{ type: 'message', content: [{ type: 'output_text', text: roh }] }] }
    const gelesen = leseXAntwort(antwort)
    let textOk = true
    try { JSON.parse(gelesen.text) } catch { textOk = false }
    pruefe('leseXAntwort.text bleibt JSON trotz U+2028', textOk)
    pruefe('leseXAntwort.roh ist ungefiltert', gelesen.roh === roh)
    // Zeichen zwischen den Teilen UND U+2028 im String: Rückfall auf den gefilterten Text.
    const beides = `${BOM}[${NB}` + roh.slice(1, -1) + `${NB}]`
    pruefe('Gegenprobe: so roh nicht lesbar', (() => { try { JSON.parse(beides); return false } catch { return true } })())
    pruefe('Rückfall: beide Posts gelesen', leseXListe(beides)?.length === 2)

    // Escapes: erst JSON.parse macht das Zeichen — der Filter muss danach laufen.
    const E = '\\u200b'
    const esc = `[{"handle":"al${E}ice","url":"https://x.com/alice/status/1855${E}01","datum":"2026-10-31${E}T10:00:00Z",`
        + `"text":"Neu: ${SOL.slice(0, 20)}${E}${SOL.slice(20)} und $PE\\u2060PE"}]`
    pruefe('Gegenprobe: nach JSON.parse steckt das Zeichen drin', JSON.parse(esc)[0].text.includes('\u200B'))
    const [p] = leseXListe(esc) || [{}]
    const e = erwaehnungenIn(p.text || '')
    pruefe('Escape: Adresse gefunden', e.adressen.includes(SOL), JSON.stringify(e))
    pruefe('Escape: Kürzel PEPE gefunden', e.kuerzel.includes('PEPE'), JSON.stringify(e))
    pruefe('Escape: URL, Handle und Datum sauber', p.url === 'https://x.com/alice/status/185501' && p.handle === 'alice' && p.datum === '2026-10-31T10:00:00Z')
    pruefe('kein JSON → null', leseXListe('keine Liste') === null && leseXListe('') === null)
}

// ── Zeit aus der Post-ID ──────────────────────────────────────────────────
const snow = (ms) => ((BigInt(ms) - 1288834974657n) << 22n).toString()
{
    const JETZT = Date.UTC(2026, 9, 31, 20, 0)
    pruefe('Snowflake hin und zurück', tweetZeit(snow(JETZT - 123456)) === JETZT - 123456)
    pruefe('bekannte ID (20.03.2023)', new Date(tweetZeit('1637843547326738432')).toISOString().slice(0, 10) === '2023-03-20')
    pruefe('fortlaufende alte ID hat keine Zeit', tweetZeit('185501') === null && tweetZeit('') === null && tweetZeit('12a') === null)
    pruefe('30 min alt liegt in 1 h', xImFenster(snow(JETZT - 30 * 60e3), 1, JETZT))
    pruefe('70 min alt liegt im Spielraum', xImFenster(snow(JETZT - 70 * 60e3), 1, JETZT))
    pruefe('80 min alt liegt nicht in 1 h', !xImFenster(snow(JETZT - 80 * 60e3), 1, JETZT))
    pruefe('80 min alt liegt in 6 h', xImFenster(snow(JETZT - 80 * 60e3), 6, JETZT))
    pruefe('40 h alt liegt nicht in 24 h', !xImFenster(snow(JETZT - 40 * 3600e3), 24, JETZT))
    pruefe('eine Stunde in der Zukunft: nein', !xImFenster(snow(JETZT + 3600e3), 1, JETZT))
    pruefe('ID ohne Zeit: nein', !xImFenster('185501', 24, JETZT))
}

// ── sucheXZuCoin / sucheXErwaehnungen mit Attrappe statt Netz ─────────────
{
    const jetzt = Date.now()
    const posts = [
        // Grok datiert ihn auf vor zehn Minuten — laut ID ist er 40 h alt.
        { handle: 'binance', url: `https://x.com/binance/status/${snow(jetzt - 40 * 3600e3)}`, datum: new Date(jetzt - 10 * 60e3).toISOString(), text: 'Binance will list $FOO' },
        // Zonenlos und falsch datiert, laut ID von 2024.
        { handle: 'foo', url: `https://x.com/foo/status/${snow(Date.UTC(2024, 0, 1))}`, datum: '2026-10-31T19:30:00', text: 'Hack drained 10M $FOO' },
        // Wirklich frisch, aber Grok nennt kein Datum; U+2028 roh im Text.
        { handle: 'bar', url: `https://x.com/bar/status/${snow(jetzt - 20 * 60e3)}`, datum: '', text: 'Unlock $FOO\u2028morgen' },
    ]
    const echtesFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(posts),
            annotations: posts.map((x) => ({ type: 'url_citation', url: x.url })) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    try {
        const c = await sucheXZuCoin({ coin: 'FOO', stunden: 1, apiKey: 'attrappe' })
        pruefe('Flash-News: nur der frische Post bleibt', c.posts.length === 1 && c.posts[0].handle === 'bar', JSON.stringify(c.posts.map((x) => x.handle)))
        pruefe('Flash-News: Zeit aus der ID', c.posts[0] && Math.abs(c.posts[0].zeit - (jetzt - 20 * 60e3)) < 5)
        const c24 = await sucheXZuCoin({ coin: 'FOO', stunden: 24, apiKey: 'attrappe' })
        pruefe('Flash-News 24 h: 40 h und 2024 fallen weg', c24.posts.length === 1)
        const h = await sucheXErwaehnungen({ token: [{ symbol: 'FOO', contract: SOL }], stunden: 6, apiKey: 'attrappe' })
        pruefe('Frühphase: nur der frische Post bleibt', h.posts.length === 1 && h.posts[0].handle === 'bar', JSON.stringify(h.posts.map((x) => x.handle)))
    } finally { globalThis.fetch = echtesFetch }
}

// ── leseXAntwort: ältere Form mit output_text oben, ohne Anmerkungen ─────
{
    const { text, zitierteIds } = leseXAntwort({ output_text: `${BOM}[]` })
    pruefe('output_text oben wird gereinigt', text === '[]')
    pruefe('ohne Zitate leer', zitierteIds.size === 0)
    pruefe('leere Antwort', leseXAntwort(null).text === '' && leseXAntwort({}).zitierteUrls.length === 0)
}

console.log(`x-antwort: ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
