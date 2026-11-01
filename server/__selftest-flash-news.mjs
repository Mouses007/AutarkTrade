/**
 * Selbsttest der Flash-News im Chart — Quellenliste und Antwortprüfung, ohne Netz.
 *
 *   node server/__selftest-flash-news.mjs
 *
 * Die Prüfung entscheidet, was ein Händler in Eile anklickt. Zu lasch, und
 * ein erfundener Link oder eine Prognose steht da; zu streng, und eine
 * bezahlte, belegte Meldung verschwindet. Zu jeder Ablehnung gibt es deshalb
 * eine Gegenprobe, die durchgehen MUSS.
 */
import { basisCoin, quellenListe, webTextUmnummerieren, baueEingabe, pruefeFlashAntwort, systemText, MAX_PUNKTE } from './flash-news-kern.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nCoin aus dem Symbol\n')
check('BTCUSDT → BTC', basisCoin('BTCUSDT') === 'BTC')
check('1000PEPEUSDT → PEPE', basisCoin('1000PEPEUSDT') === 'PEPE')
check('Bitget-Form SOLUSDT_UMCBL → SOL', basisCoin('SOLUSDT_UMCBL') === 'SOL')
check('Gegenprobe: 1INCHUSDT bleibt 1INCH', basisCoin('1INCHUSDT') === '1INCH', basisCoin('1INCHUSDT'))
check('RENDERUSDC → RENDER', basisCoin('RENDERUSDC') === 'RENDER')

console.log('\nQuellenliste\n')
const T = Date.UTC(2026, 9, 30, 6, 0)
const { quellen, webNr } = quellenListe({
    xPosts: [
        { handle: '@binance', url: 'https://x.com/binance/status/111', text: 'Binance will delist  XYZ', zeit: T },
        { handle: 'kopie', url: 'https://twitter.com/binance/status/111?s=20', text: 'dasselbe', zeit: T },
        { handle: 'ohne', url: 'http://unsicher.example/1', text: 'kein https' },
        { handle: 'leer', url: '', text: 'keine Adresse' },
    ],
    webZitate: ['https://www.coindesk.com/a', 'https://x.com/binance/status/111', 'javascript:alert(1)', 'https://theblock.co/b'],
    webDaten: new Map([['https://www.coindesk.com/a', '2026-10-30']]),
})
check('Doppelter Tweet (twitter.com, ?s=) nur einmal', quellen.filter((q) => q.art === 'x').length === 1, JSON.stringify(quellen))
check('nur https-Adressen', quellen.every((q) => q.url.startsWith('https://')))
check('Nummern lückenlos ab 1', quellen.map((q) => q.nr).join(',') === '1,2,3')
check('Web-Titel ist die Domain ohne www', quellen[1].titel === 'coindesk.com')
check('Web-Datum übernommen', quellen[1].zeit === Date.parse('2026-10-30'))
check('Web-Zitat 2 (= Tweet) zeigt auf dieselbe Nummer', webNr.get(2) === 1)
check('ungültiges Zitat 3 hat keine Nummer', !webNr.has(3))
check('Leerzeichen im X-Text zusammengezogen', quellen[0].text === 'Binance will delist XYZ')
check('Umnummerieren: [1][4][3] → [2][3] und unbekanntes weg',
    webTextUmnummerieren('A [1]. B [4]. C [3].', webNr) === 'A [2]. B [3]. C .', webTextUmnummerieren('A [1]. B [4]. C [3].', webNr))
{
    const viele = quellenListe({ xPosts: Array.from({ length: 40 }, (_, i) => ({ url: `https://x.com/a/status/${i + 1}`, text: 't' })) })
    check('X auf 25 begrenzt', viele.quellen.length === 25)
}

console.log('\nEntdoppeln: verschiedene Artikel bleiben verschieden\n')
for (const [name, a, b] of [
    ['YouTube ?v=AAA / ?v=BBB', 'https://www.youtube.com/watch?v=AAA', 'https://www.youtube.com/watch?v=BBB'],
    ['Artikel ?id=111 / ?id=222', 'https://news.example.com/article?id=111', 'https://news.example.com/article?id=222'],
    ['Pfad mit anderer Gross-/Kleinschreibung', 'https://example.com/News/ABC', 'https://example.com/news/abc'],
]) {
    const { quellen: q, webNr: n } = quellenListe({ webZitate: [a, b] })
    check(`${name}: zwei Quellen`, q.length === 2 && n.get(1) === 1 && n.get(2) === 2, JSON.stringify([...n]))
    const r = pruefeFlashAntwort({ punkte: [{ text: 'Aussage zu B', quellen: [n.get(2)] }] }, q)
    check(`${name}: Punkt zu B verlinkt B`, q.find((x) => x.nr === r.punkte[0]?.quellen[0])?.url === b)
}
{
    const m = quellenListe({ xPosts: [{ url: 'https://x.com/foo/status/12345', text: 'X-Post' }], webZitate: ['https://mastodon.social/users/bar/statuses/12345'] })
    check('Mastodon statuses/<id> ist kein X-Post gleicher ID', m.quellen.length === 2 && m.webNr.get(1) === 2)
    // Gegenproben: dieselbe Meldung bleibt eine.
    const g = quellenListe({
        xPosts: [{ url: 'https://mobile.twitter.com/foo/status/777', text: 'a' }],
        webZitate: [
            'https://www.x.com/foo/status/777?s=20',
            'https://Example.COM/a/?b=2&a=1&utm_source=x#oben',
            'https://example.com/a?a=1&b=2&fbclid=abc&gclid=1&ref=tw',
            'https://example.com/a?a=1&b=3',
        ],
    })
    check('x.com, www., mobile.twitter.com: ein Post', g.webNr.get(1) === 1)
    check('Host-Schreibung, Schrägstrich, Anker, Verfolgung, Reihenfolge egal', g.webNr.get(2) === 2 && g.webNr.get(3) === 2, JSON.stringify([...g.webNr]))
    check('anderer Parameterwert: eigene Quelle', g.webNr.get(4) === 3 && g.quellen.length === 3)
}

console.log('\nEingabe\n')
{
    const e = baueEingabe({ symbol: '1000PEPEUSDT', coin: 'PEPE', stunden: 1, quellen, webText: 'Delisting gemeldet [2].', zeitzone: 'Europe/Zurich', jetzt: T })
    check('nennt Coin und Kontrakt', e.includes('Coin: PEPE (Kontrakt 1000PEPEUSDT)'))
    check('„letzte 1 Stunde" (Einzahl)', e.includes('letzte 1 Stunde bis'))
    check('Quellen nummeriert mit Art', /^\[1\] X @binance/m.test(e) && /^\[2\] Web coindesk\.com/m.test(e))
    check('keine URL in der Eingabe (das Modell soll keine abschreiben)', !/https?:\/\//.test(e))
    check('Web-Recherche angehängt', e.includes('Delisting gemeldet [2].'))
    check('System verbietet URLs und Prognosen', /nie eine URL/.test(systemText()) && /KEINE Prognose/.test(systemText()))
    check('System englisch', /Never write a URL/.test(systemText(true)))
}

console.log('\nAntwortprüfung\n')
{
    const gut = pruefeFlashAntwort({
        lage: 'etwas', kurz: 'Binance kündigt das Delisting an.',
        punkte: [
            { zeit: '06:00', text: 'Binance nimmt XYZ am Freitag vom Handel.', quellen: [1, 2] },
            { zeit: 'gestern', text: 'Gerücht über einen Hack, unbestätigt.', quellen: [3] },
        ],
    }, quellen)
    check('belegte Punkte bleiben', gut.punkte.length === 2)
    check('lage etwas', gut.lage === 'etwas')
    check('ungültige Uhrzeit wird leer', gut.punkte[1].zeit === '')
    check('Gegenprobe: „fallen" ohne Zukunft ist keine Prognose',
        pruefeFlashAntwort({ punkte: [{ text: 'In diese Meldung fallen drei Börsen.', quellen: [1] }] }, quellen).punkte.length === 1)

    const schlecht = pruefeFlashAntwort({
        lage: 'etwas', kurz: 'XYZ dürfte weiter fallen.',
        punkte: [
            { text: 'Ohne Beleg erfunden.', quellen: [] },
            { text: 'Nummer gibt es nicht.', quellen: [99] },
            { text: 'Der Kurs wird in den nächsten Stunden steigen.', quellen: [1] },
            { text: 'Jetzt kaufen, sagt ein Analyst.', quellen: [1] },
            { text: '', quellen: [1] },
            { text: 'Gemischte Nummern bleiben mit der gültigen.', quellen: [99, '2', 2] },
        ],
    }, quellen)
    check('ohne Quelle verworfen', schlecht.verworfen.some((v) => v.grund === 'ohneQuelle' && v.text === 'Ohne Beleg erfunden.'))
    check('unbekannte Nummer verworfen', schlecht.verworfen.some((v) => v.text === 'Nummer gibt es nicht.'))
    check('Prognose verworfen', schlecht.verworfen.some((v) => v.grund === 'prognose'))
    check('Handelsrat verworfen', schlecht.verworfen.some((v) => v.grund === 'empfehlung'))
    check('Prognose im Kurzsatz: Satz weg, Punkte bleiben', schlecht.kurz === '' && schlecht.punkte.length === 1)
    check('Nummern entdoppelt, unbekannte raus', JSON.stringify(schlecht.punkte[0].quellen) === '[2]')

    const nichts = pruefeFlashAntwort({ lage: 'etwas', kurz: 'Nichts Besonderes.', punkte: [] }, quellen)
    check('ohne Punkte ist die Lage „nichts", auch wenn das Modell „etwas" sagt', nichts.lage === 'nichts' && nichts.kurz === 'Nichts Besonderes.')
    check('keine Antwort → null', pruefeFlashAntwort(null, quellen) === null && pruefeFlashAntwort([], quellen) === null)
    const zuviel = pruefeFlashAntwort({ punkte: Array.from({ length: 20 }, (_, i) => ({ text: `Meldung ${i}`, quellen: [1] })) }, quellen)
    check(`höchstens ${MAX_PUNKTE} Punkte`, zuviel.punkte.length === MAX_PUNKTE)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
