/**
 * Selbsttest der Pionex-Signatur — ohne Netz, ohne Datenbank.
 *
 *   node server/__selftest-pionex-signatur.mjs
 *
 * Warum das einen eigenen Test verdient: eine falsche Signatur meldet sich bei
 * Pionex nicht als „falsche Signatur", sondern als `APIKEY_INVALID`. Man sucht
 * dann am Schluessel, an der IP-Freigabe oder an den Rechten — nur nicht an
 * der Zeichenkette, die tatsaechlich schuld ist. Zwei Tage Fehlersuche stehen
 * hier gegen zwanzig Zeilen Test.
 *
 * Der erwartete HMAC ist fest hinterlegt und mit einem WEGWERF-Schluessel
 * gerechnet. Er prueft die REGEL, nicht ein Geheimnis: aendert jemand die
 * Sortierung, das Trennzeichen oder die Stelle, an der der Body angehaengt
 * wird, faellt der Test.
 */

import crypto from 'crypto'
import { createSignature, baueQuery, BASE_URL, pionexRequest } from './pionex-transport.js'

const SECRET = 'testgeheimnis-nicht-echt'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex')

console.log('\nQuery-Aufbau (baueQuery)\n')
{
    check('timestamp wird ergaenzt', baueQuery({}, 1700000000000) === 'timestamp=1700000000000')

    // Sortiert wird nach ASCII, nicht nach Einfuegereihenfolge: 'limit' <
    // 'symbol' < 'timestamp'. Dass der timestamp hier hinten landet, ist
    // Zufall der Buchstaben — ein Parameter wie 'type' stuende dahinter.
    check('Keys stehen aufsteigend nach ASCII',
        baueQuery({ symbol: 'BTC_USDT_PERP', limit: 10 }, 1700000000000)
        === 'limit=10&symbol=BTC_USDT_PERP&timestamp=1700000000000')

    check('Einfuegereihenfolge aendert nichts',
        baueQuery({ limit: 10, symbol: 'X' }, 1) === baueQuery({ symbol: 'X', limit: 10 }, 1))

    // Pionex-Vorgabe: Werte NICHT url-encoden. Wer hier encodeURIComponent
    // einbaut, bekommt eine Signatur ueber einen anderen String als die URL
    // traegt — und jede Anfrage scheitert.
    check('Werte werden NICHT url-encodiert',
        baueQuery({ q: 'a b+c/d' }, 1) === 'q=a b+c/d&timestamp=1',
        baueQuery({ q: 'a b+c/d' }, 1))

    check('Trennzeichen ist & ohne Leerraum',
        baueQuery({ a: 1, b: 2 }, 3) === 'a=1&b=2&timestamp=3')
}

console.log('\nSignatur-String (createSignature)\n')
{
    const q = 'symbol=BTC_USDT_PERP&timestamp=1700000000000'

    // GET: METHOD + PATH + "?" + query, kein Body.
    const erwartetGet = hmac('GET/uapi/v1/account/positions?' + q)
    check('GET signiert METHOD+PATH+?+query',
        createSignature(SECRET, 'GET', '/uapi/v1/account/positions', q, '') === erwartetGet)

    // POST: derselbe String, danach der Body-JSON ANGEHAENGT (nicht getrennt,
    // kein weiteres Zeichen dazwischen).
    const body = '{"symbol":"BTC_USDT_PERP","side":"BUY"}'
    const erwartetPost = hmac('POST/uapi/v1/account/leverage?' + q + body)
    check('POST haengt den Body direkt an die Query an',
        createSignature(SECRET, 'POST', '/uapi/v1/account/leverage', q, body) === erwartetPost)

    check('ohne Body ist POST wie GET aufgebaut',
        createSignature(SECRET, 'POST', '/p', q, '') === hmac('POST/p?' + q))

    check('ohne Query faellt auch das Fragezeichen weg',
        createSignature(SECRET, 'GET', '/p', '', '') === hmac('GET/p'))

    check('Methode wird grossgeschrieben',
        createSignature(SECRET, 'get', '/p', q, '') === createSignature(SECRET, 'GET', '/p', q, ''))

    check('Ergebnis ist hex, 64 Zeichen',
        /^[0-9a-f]{64}$/.test(createSignature(SECRET, 'GET', '/p', q, '')))
}

console.log('\nDie Signatur haengt wirklich an allem, was sie soll\n')
{
    const q = 'symbol=BTC_USDT_PERP&timestamp=1700000000000'
    const grund = createSignature(SECRET, 'POST', '/uapi/v1/account/leverage', q, '{"a":1}')

    check('anderer Body → andere Signatur',
        createSignature(SECRET, 'POST', '/uapi/v1/account/leverage', q, '{"a":2}') !== grund)
    check('anderer Pfad → andere Signatur',
        createSignature(SECRET, 'POST', '/uapi/v1/trade/massOrder', q, '{"a":1}') !== grund)
    check('andere Methode → andere Signatur',
        createSignature(SECRET, 'DELETE', '/uapi/v1/account/leverage', q, '{"a":1}') !== grund)
    check('anderer timestamp → andere Signatur',
        createSignature(SECRET, 'POST', '/uapi/v1/account/leverage',
            'symbol=BTC_USDT_PERP&timestamp=1700000000001', '{"a":1}') !== grund)
    check('anderes Geheimnis → andere Signatur',
        crypto.createHmac('sha256', 'anderes').update('x').digest('hex') !== hmac('x'))
}

console.log('\nSonstiges\n')
{
    check('Basis-URL ist die Produktions-API', BASE_URL === 'https://api.pionex.com')
    // Der timestamp gehoert in die QUERY, nicht in einen Header. Steht er im
    // Header, ist er nicht Teil der Signatur und Pionex lehnt ab.
    check('timestamp steckt in der Query, nicht im Header',
        baueQuery({}, 42).includes('timestamp=42'))
}

console.log('\nHTTP-Status am Fehler (Audit SEC-R-103) — fetch ist eine Attrappe, nichts geht ins Netz\n')
{
    const echt = globalThis.fetch
    const antwort = (status, koerper) => async () => new Response(koerper, { status, statusText: 'Test' })
    const fange = async () => { try { return { daten: await pionexRequest('POST', '/api/v1/test', 'k', SECRET, {}, { a: 1 }) } } catch (e) { return { e } } }
    try {
        globalThis.fetch = antwort(503, '{"result":false,"code":"INTERNAL_ERROR","message":"try again"}')
        const a = await fange()
        check('503 mit JSON-Körper: Status am Fehler, Text wie bisher', a.e?.status === 503 && a.e.message === 'Pionex API: [INTERNAL_ERROR] try again', a.e?.message)
        globalThis.fetch = antwort(502, '<html>Bad Gateway</html>')
        const b = await fange()
        check('502 ohne JSON: Status am Fehler und im Text', b.e?.status === 502 && /^Pionex API: 502\b/.test(b.e.message), b.e?.message)
        globalThis.fetch = antwort(400, '{"result":false,"code":"BOT_INVALID_ARGUMENT","message":"nein"}')
        const c = await fange()
        check('400 mit JSON: Status 400', c.e?.status === 400 && c.e.message === 'Pionex API: [BOT_INVALID_ARGUMENT] nein')
        globalThis.fetch = antwort(200, '{"result":false,"code":"X","message":"y"}')
        const d = await fange()
        check('200 mit result false: Fehler mit Status 200', d.e?.status === 200 && d.e.message === 'Pionex API: [X] y')
        globalThis.fetch = antwort(200, '{"result":true,"data":{}}')
        const f = await fange()
        check('200 mit result true: Antwort, kein Fehler', f.daten?.result === true && !f.e)
    } finally { globalThis.fetch = echt }
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
