/**
 * Selbsttest der Zugangsschicht — ohne Datenbank und ohne laufenden Server.
 *
 *   node server/__selftest-auth.mjs
 *
 * Geprüft wird genau der Teil, der ohne DB entscheidbar ist: wann der Server
 * das Session-Cookie überhaupt verteilt. Das ist die Stelle, an der ein Fehler
 * am teuersten wäre — ohne Passwort-Gate bekommt JEDER Besucher beim ersten
 * Seitenaufruf ein gültiges Cookie und damit Broker-Schlüssel, Handel und
 * Backup. Solange der Dienst nur auf 127.0.0.1 lauscht, ist das in Ordnung;
 * netzwerkweit ist es eine offene Tür.
 *
 * `authConfig` steht ohne `loadAuthConfig()` auf { enabled: false } — also
 * genau der Fall, den diese Prüfungen brauchen.
 */

import { istLoopbackHost, setzeBindungsModus, offenerBetriebErlaubt, sessionCookieMiddleware, apiAuthMiddleware, istErlaubterHost, getSessionCookieString, hatGueltigeSession, entwerteAlleSitzungen } from './auth.js'
import { pruefeKiEndpunkt } from './ollama-url.js'
import { clientIp, setupAuthRoutes, _authFuerTest, _zaehlerLeeren, _einrichtungsCode, _ruecksetzCode } from './auth.js'
import { isLocalRequest, istFremdeHerkunft } from './update-api.js'
import { umgebung, umgebungAn, alteSicherheitsSchalter } from './umgebung.js'
import express from 'express'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Minimal-Attrappe für res: merkt sich nur die gesetzten Kopfzeilen. */
function laufe(url) {
    const kopf = {}
    let weiter = false
    sessionCookieMiddleware(
        { url },
        { setHeader: (k, v) => { kopf[k] = v } },
        () => { weiter = true },
    )
    return { cookie: kopf['Set-Cookie'] || '', weiter }
}

console.log('\nBind-Adresse\n')

for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
    check(`„${h}" gilt als lokal`, istLoopbackHost(h) === true)
}
for (const h of ['0.0.0.0', '192.168.178.100', '::', 'example.com', '', undefined, null]) {
    check(`„${h}" gilt NICHT als lokal`, istLoopbackHost(h) === false)
}

console.log('\nCookie-Vergabe ohne Passwortschutz\n')

{
    const alt = process.env.AT_ALLOW_INSECURE
    delete process.env.AT_ALLOW_INSECURE

    setzeBindungsModus(true)
    check('lokal gebunden: Betrieb ohne Gate ist erlaubt', offenerBetriebErlaubt() === true)
    const lokal = laufe('/journal')
    check('lokal gebunden: Seitenaufruf bekommt ein Cookie', lokal.cookie.includes('at_session='), lokal.cookie)
    check('Cookie ist httpOnly und SameSite=Strict',
        lokal.cookie.includes('HttpOnly') && lokal.cookie.includes('SameSite=Strict'), lokal.cookie)
    check('API-Aufrufe bekommen nie ein Cookie zugeteilt', laufe('/api/db/trades').cookie === '')

    setzeBindungsModus(false)
    check('netzwerkweit gebunden: offener Betrieb ist nicht erlaubt', offenerBetriebErlaubt() === false)
    const netz = laufe('/journal')
    check('netzwerkweit ohne Gate: KEIN Cookie mehr', netz.cookie === '', netz.cookie)
    check('die Middleware ruft trotzdem next()', netz.weiter === true)

    // Der ausdrückliche Übersteuerungs-Schalter muss weiterhin greifen, sonst
    // stünde jemand, der es bewusst so will, plötzlich vor verschlossener Tür.
    process.env.AT_ALLOW_INSECURE = '1'
    check('AT_ALLOW_INSECURE=1 erlaubt den offenen Betrieb wieder', offenerBetriebErlaubt() === true)
    check('und verteilt dann auch wieder Cookies', laufe('/journal').cookie.includes('at_session='))

    process.env.AT_ALLOW_INSECURE = '0'
    check('jeder andere Wert zählt nicht als Freigabe', offenerBetriebErlaubt() === false)

    if (alt === undefined) delete process.env.AT_ALLOW_INSECURE
    else process.env.AT_ALLOW_INSECURE = alt
    setzeBindungsModus(true)
}

console.log('\nErst-Einrichtung (gesperrter Netzbetrieb)\n')

{
    // Attrappe für die API-Auth: prüft nur, ob die Middleware durchlässt.
    const apiLauf = (url) => {
        let weiter = false
        let status = 0
        apiAuthMiddleware(
            { originalUrl: url, url, headers: {} },
            { status: (s) => { status = s; return { json: () => {} } } },
            () => { weiter = true },
        )
        return { weiter, status }
    }

    // Gate ist aus (authConfig ohne loadAuthConfig = { enabled: false }):
    // das ERSTE Passwort darf ohne Session gesetzt werden — sonst käme ein
    // netzgebundener Container (keine Cookie-Vergabe) nie aus der Sperre.
    const setzen = apiLauf('/api/auth/set-password')
    check('Gate aus: /api/auth/set-password geht ohne Session durch', setzen.weiter === true)
    check('andere API-Routen bleiben ohne Session gesperrt', apiLauf('/api/db/trades').status === 401)
    check('Login-Flow-Routen bleiben öffentlich', apiLauf('/api/auth/status').weiter === true)
}

console.log('\nHost-Header (DNS-Rebinding)\n')

{
    const altHosts = process.env.AT_ALLOWED_HOSTS
    delete process.env.AT_ALLOWED_HOSTS

    // Das, worüber der Dienst wirklich aufgerufen wird, muss durch:
    for (const h of ['localhost:8080', '127.0.0.1:8080', '127.0.0.1', '[::1]:8080',
        '192.168.178.100:8080', '10.0.0.5', '172.20.1.2:8080', '100.100.1.1']) {
        check(`„${h}" ist erlaubt`, istErlaubterHost(h) === true)
    }
    // Kein Host-Header = HTTP/1.0-Klient (ESP-Display) — kein Browser, kein Rebinding.
    check('fehlender Host-Header ist erlaubt (ESP32, curl)', istErlaubterHost(undefined) === true)

    // Und das ist der Angriff: eine registrierbare Domain, die auf 127.0.0.1 zeigt.
    for (const h of ['evil.example:8080', 'rebind.attacker.io', '8.8.8.8', '203.0.113.7:8080']) {
        check(`„${h}" wird abgewiesen`, istErlaubterHost(h) === false)
    }

    process.env.AT_ALLOWED_HOSTS = 'mein-nas.beispiel.de, journal.local'
    check('AT_ALLOWED_HOSTS ergänzt eigene Namen', istErlaubterHost('mein-nas.beispiel.de:8080') === true)
    check('andere Domains bleiben trotzdem draussen', istErlaubterHost('evil.example') === false)

    if (altHosts === undefined) delete process.env.AT_ALLOWED_HOSTS
    else process.env.AT_ALLOWED_HOSTS = altHosts

    // Name der mDNS-Ansage (AT_MDNS_NAME): genau dieser eine .local-Name, keine Wildcard
    const altMdns = process.env.AT_MDNS_NAME
    delete process.env.AT_MDNS_NAME
    check('ohne AT_MDNS_NAME ist autarktrade.local nicht erlaubt', istErlaubterHost('autarktrade.local:8080') === false)
    process.env.AT_MDNS_NAME = 'AutarkTrade.local'
    check('AT_MDNS_NAME gibt den angesagten Namen frei', istErlaubterHost('autarktrade.local:8080') === true)
    check('Gegenprobe: andere .local-Namen bleiben draussen', istErlaubterHost('chefkoch_nas.local:8080') === false)
    process.env.AT_MDNS_NAME = 'evil.example'
    check('Gegenprobe: ein Nicht-.local-Name in AT_MDNS_NAME öffnet nichts', istErlaubterHost('evil.example') === false)
    process.env.AT_MDNS_NAME = 'aus'
    check('AT_MDNS_NAME=aus gibt nichts frei', istErlaubterHost('aus') === false && istErlaubterHost('autarktrade.local') === false)
    if (altMdns === undefined) delete process.env.AT_MDNS_NAME
    else process.env.AT_MDNS_NAME = altMdns
}

console.log('\nFrei eingetragene KI-Endpunkte\n')

{
    const abgelehnt = async (url) => {
        try { await pruefeKiEndpunkt(url); return false } catch { return true }
    }
    const angenommen = async (url) => {
        try { await pruefeKiEndpunkt(url); return true } catch { return false }
    }

    check('file:// wird abgelehnt', await abgelehnt('file:///etc/passwd'))
    check('Zugangsdaten in der Adresse werden abgelehnt', await abgelehnt('http://nutzer:geheim@example.com/v1'))
    check('Metadaten-Name wird abgelehnt', await abgelehnt('http://metadata.google.internal/v1'))
    check('.internal-Namen werden abgelehnt', await abgelehnt('http://irgendwas.internal/v1'))
    // Literale Adressen lösen ohne Netz auf — deshalb hier prüfbar.
    check('Cloud-Metadaten-Adresse wird abgelehnt', await abgelehnt('http://169.254.169.254/latest/meta-data/'))
    check('Multicast-Bereich wird abgelehnt', await abgelehnt('http://239.1.2.3/v1'))

    // Und das, was diese Felder gerade ermöglichen sollen, bleibt erlaubt:
    // ein selbst gehostetes Modell im eigenen Netz.
    check('eigener Rechner bleibt erlaubt', await angenommen('http://127.0.0.1:8000/v1'))
    check('eigenes Netz bleibt erlaubt', await angenommen('http://192.168.178.50:8000/v1'))
    check('öffentlicher Anbieter bleibt erlaubt', await angenommen('https://8.8.8.8/v1'))
}

/*
 * Entwertung bestehender Sitzungen.
 *
 * Bis zum Audit vom 28.08.2026 war das Token unveraenderlich aus `AT_SECRET`
 * abgeleitet: Abmelden loeschte nur das Cookie beim Client, und der
 * Passwortwechsel liess bestehende Sitzungen ausdruecklich weiterlaufen — mit
 * einem Kommentar, der genau das festhielt. Wer sein Passwort wechselt,
 * vermutet aber meistens einen Kompromiss.
 *
 * Ohne Datenbank schlaegt das Schreiben der Generation fehl; die Rotation muss
 * TROTZDEM greifen. Genau das prueft dieser Block: im Zweifel lieber alle
 * abmelden als ein Cookie am Leben lassen, das weg soll.
 */
console.log('\nEntwertung von Sitzungen')
{
    const tokenAus = (cookie) => String(cookie).split(';')[0].split('=')[1]
    const req = { headers: { host: '127.0.0.1:8080' }, secure: false }

    const vorher = tokenAus(getSessionCookieString(req))
    check('ein Cookie wird ueberhaupt ausgestellt', !!vorher && vorher.length > 20, String(vorher).slice(0, 12))
    check('das ausgestellte Cookie gilt',
        hatGueltigeSession({ headers: { cookie: `at_session=${vorher}` } }))

    await entwerteAlleSitzungen()

    const nachher = tokenAus(getSessionCookieString(req))
    check('nach dem Entwerten ist das Token ein anderes', nachher !== vorher,
        `${String(vorher).slice(0, 8)} vs ${String(nachher).slice(0, 8)}`)
    check('das ALTE Cookie gilt nicht mehr',
        hatGueltigeSession({ headers: { cookie: `at_session=${vorher}` } }) === false)
    check('das NEUE Cookie gilt',
        hatGueltigeSession({ headers: { cookie: `at_session=${nachher}` } }))

    // Zweimal entwerten muss zweimal etwas aendern — sonst haengt die
    // Generation und ein zweiter Wechsel waere wirkungslos.
    await entwerteAlleSitzungen()
    const drittes = tokenAus(getSessionCookieString(req))
    check('erneutes Entwerten wirkt wieder', drittes !== nachher)
    check('kein altes Cookie ueberlebt',
        [vorher, nachher].every((t) => hatGueltigeSession({ headers: { cookie: `at_session=${t}` } }) === false))

    check('ein leeres oder falsches Cookie gilt nie',
        hatGueltigeSession({ headers: { cookie: 'at_session=' } }) === false
        && hatGueltigeSession({ headers: {} }) === false
        && hatGueltigeSession({ headers: { cookie: 'at_session=abc' } }) === false)
}

/*
 * Audit A2 (19.10.2026) — jeder Angriff aus dem Bericht als Gegenprobe.
 * Was hier „abgewiesen" erwartet, ging vor F2 durch (Bericht A2-01/02/03/
 * 11/16/22/23/30); der Kommentar je Block nennt den alten Ausgang.
 */
console.log('\nA2-01: DNS-Rebinding über 127.-Präfix\n')
{
    // Vor F2: istLoopbackHost('127.0.0.1.evil.example') === true, Host-Guard 200.
    for (const h of ['127.0.0.1.evil.example', '127.0.0.1.rebind.example', '127.evil', '127.0.0.1x', '127.0.0.256']) {
        check(`„${h}" ist kein Loopback`, istLoopbackHost(h) === false)
    }
    check('Host „127.0.0.1.rebind.example:8080" wird abgewiesen', istErlaubterHost('127.0.0.1.rebind.example:8080') === false)
    check('echtes 127.255.0.1 bleibt Loopback', istLoopbackHost('127.255.0.1') === true)
}

console.log('\nA2-02: CSRF auf /api/auth/reset — Herkunft\n')
{
    const lokal = (headers) => isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:8080', ...headers } })
    // Vor F2: lokal({origin:'https://evil.example'}) === true.
    check('fremde Origin ist nicht lokal', lokal({ origin: 'https://evil.example' }) === false)
    check('Origin null ist nicht lokal', lokal({ origin: 'null' }) === false)
    check('Sec-Fetch-Site cross-site ist nicht lokal', lokal({ 'sec-fetch-site': 'cross-site' }) === false)
    check('Sec-Fetch-Site same-site ist nicht lokal', lokal({ 'sec-fetch-site': 'same-site' }) === false)
    check('gleiche Origin bleibt lokal', lokal({ origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin' }) === true)
    check('curl ohne Origin bleibt lokal', lokal({}) === true)
    check('istFremdeHerkunft: Port zählt mit', istFremdeHerkunft({ headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:9999' } }) === true)
}

/** Echter HTTP-Lauf gegen die Auth-Routen (ohne DB: DB-Schritte enden in 500). */
async function mitServer(fn) {
    const app = express()
    app.use(express.json({ limit: '100kb' }))
    app.use(hostGuardMiddleware)
    setupAuthRoutes(app)
    const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
    const basis = `http://127.0.0.1:${srv.address().port}`
    try { await fn(basis) } finally { srv.close() }
}
import { hostGuardMiddleware } from './auth.js'

await mitServer(async (basis) => {
    console.log('\nA2-02: Reset per HTTP\n')
    // Der Angriff aus dem Bericht: text/plain, fremde Origin. Vor F2: 200 {authEnabled:false}.
    let r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: 'x' })
    check('Reset mit fremder Origin → 403', r.status === 403, String(r.status))
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' })
    check('Reset cross-site (auch mit JSON) → 403', r.status === 403, String(r.status))
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })
    check('Reset ohne JSON (no-cors-Form) → 415', r.status === 415, String(r.status))
    // Audit SEC-SRV-009 (26.10.2026): lokal + JSON reicht nicht mehr — vorher
    // schaltete genau dieser curl-Aufruf jedes Gate ab.
    const warn = console.warn
    const log = []
    console.warn = (...a) => log.push(a.join(' '))
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    let j = await r.json()
    console.warn = warn
    const code = _ruecksetzCode()
    check('Reset ohne Rücksetzcode → 403 codeNoetig', r.status === 403 && j.codeNoetig === true, String(r.status))
    check('… und der Code steht im Server-Log, nicht in der Antwort', !!code && log.some((z) => z.includes(code)) && !JSON.stringify(j).includes(code))
    _zaehlerLeeren()
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'AAAA-BBBB' }) })
    check('falscher Rücksetzcode → 403', r.status === 403)
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ code }) })
    check('richtiger Code von fremder Seite → 403', r.status === 403)
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.toLowerCase() }) })
    check('Reset mit Code aus dem Log (lokal, JSON) erreicht die DB-Stufe', r.status === 500 || r.status === 200, String(r.status))
    check('Code gilt nur einmal', _ruecksetzCode() === null)
    r = await fetch(basis + '/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    check('derselbe Code ein zweites Mal → 403', r.status === 403)
    _zaehlerLeeren()

    console.log('\nA2-01: Rebinding-Kette per HTTP\n')
    // fetch überschreibt den Host-Kopf nicht — deshalb http.request.
    const { request } = await import('http')
    const statusMitHost = (host) => new Promise((ok, nein) => {
        const q = request(basis + '/api/auth/status', { headers: { host } }, (a) => { a.resume(); ok(a.statusCode) })
        q.on('error', nein); q.end()
    })
    check('Host 127.0.0.1.evil.example → 421', (await statusMitHost('127.0.0.1.evil.example')) === 421)
    check('Host 127.0.0.1:8080 → 200', (await statusMitHost('127.0.0.1:8080')) === 200)

    console.log('\nA2-03: Login-Sperre mit X-Forwarded-For\n')
    const altTP = process.env.AT_TRUST_PROXY
    const altTPx = process.env.AT_TRUSTED_PROXY
    process.env.AT_TRUST_PROXY = '1'
    delete process.env.AT_TRUSTED_PROXY
    _zaehlerLeeren()
    await _authFuerTest('richtiges-passwort-123')
    const stati = []
    for (let i = 0; i < 12; i++) {
        const a = await fetch(basis + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.9.${i}` }, body: JSON.stringify({ password: 'falsch' }) })
        stati.push(a.status)
    }
    // Vor F2: 12× 401, keine 429 (jeder Versuch ein neuer Eimer).
    check('rotierender XFF direkt am Port: Sperre greift nach 5', stati.slice(5).every((x) => x === 429), stati.join(' '))
    const richtig = await fetch(basis + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.200' }, body: JSON.stringify({ password: 'richtiges-passwort-123' }) })
    check('auch das richtige Passwort mit frischem XFF bleibt gesperrt', richtig.status === 429, String(richtig.status))

    // Vom vertrauten Proxy zählt XFF weiter — sonst sperrten Fremde den Eigentümer aus.
    process.env.AT_TRUSTED_PROXY = '127.0.0.1'
    _zaehlerLeeren()
    for (let i = 0; i < 6; i++) {
        await fetch(basis + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ password: 'falsch' }) })
    }
    const eigner = await fetch(basis + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.4' }, body: JSON.stringify({ password: 'richtiges-passwort-123' }) })
    check('hinter vertrautem Proxy: Fremde sperren den Eigentümer nicht aus', eigner.status === 200, String(eigner.status))
    check('clientIp: XFF zählt nur vom vertrauten Peer',
        await clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }) === '5.6.7.8'
        && await clientIp({ socket: { remoteAddress: '192.168.1.9' }, headers: { 'x-forwarded-for': '5.6.7.8' } }) === '192.168.1.9')

    console.log('\nA2-11: Login blockiert die Event-Loop nicht\n')
    _zaehlerLeeren()
    process.env.AT_TRUSTED_PROXY = '127.0.0.1'
    let maxLuecke = 0
    let zuletzt = Date.now()
    const ticker = setInterval(() => { const j = Date.now(); maxLuecke = Math.max(maxLuecke, j - zuletzt); zuletzt = j }, 5)
    const viele = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(basis + '/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${i >> 8}.${i & 255}` }, body: JSON.stringify({ password: 'falsch' }),
    }).then((x) => x.status)))
    clearInterval(ticker)
    check('40 parallele Logins: Event-Loop nie > 150 ms blockiert', maxLuecke < 150, `${maxLuecke} ms`)
    check('überzählige Logins bekommen 429 statt zu warten', viele.includes(429), viele.join(' '))

    console.log('\nA2-16/A2-23: Erst-Einrichtung\n')
    _zaehlerLeeren()
    await _authFuerTest(null)
    setzeBindungsModus(false)
    const altAI = process.env.AT_ALLOW_INSECURE
    delete process.env.AT_ALLOW_INSECURE
    const ausDemNetz = { 'content-type': 'application/json', 'x-forwarded-for': '192.168.178.77' }
    // Vor F2: 200 + Set-Cookie für den ersten Besucher.
    r = await fetch(basis + '/api/auth/set-password', { method: 'POST', headers: ausDemNetz, body: JSON.stringify({ newPassword: 'angreifer12345' }) })
    check('erstes Passwort aus dem Netz ohne Code → 403', r.status === 403 && !r.headers.get('set-cookie'), String(r.status))
    r = await fetch(basis + '/api/auth/set-password', { method: 'POST', headers: ausDemNetz, body: JSON.stringify({ newPassword: 'angreifer12345', einrichtungsCode: 'AAAA-BBBB' }) })
    check('… mit falschem Code → 403', r.status === 403, String(r.status))
    const st = await (await fetch(basis + '/api/auth/status', { headers: { 'x-forwarded-for': '192.168.178.77' } })).json()
    check('Status meldet codeNoetig aus dem Netz', st.setupRequired === true && st.codeNoetig === true, JSON.stringify(st))
    r = await fetch(basis + '/api/auth/set-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newPassword: '123456' }) })
    // Vor F2: '123456' → 200.
    check('Passwort „123456" → 400 (min. 10)', r.status === 400, String(r.status))
    r = await fetch(basis + '/api/auth/set-password', { method: 'POST', headers: ausDemNetz, body: JSON.stringify({ newPassword: 'eigentuemer-1234', einrichtungsCode: _einrichtungsCode().toLowerCase() }) })
    check('mit richtigem Code (Gross/Klein egal) erreicht es die DB-Stufe', r.status === 500 || r.status === 200, String(r.status))
    setzeBindungsModus(true)
    if (altAI !== undefined) process.env.AT_ALLOW_INSECURE = altAI

    console.log('\nA2-23: currentPassword läuft über den Zähler\n')
    _zaehlerLeeren()
    process.env.AT_TRUSTED_PROXY = 'nichts.invalid'
    await _authFuerTest('richtiges-passwort-123')
    const cookie = String(getSessionCookieString({ headers: {} })).split(';')[0]
    const cp = []
    for (let i = 0; i < 7; i++) {
        const a = await fetch(basis + '/api/auth/set-password', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ currentPassword: 'falsch', newPassword: 'neues-passwort-99' }) })
        cp.push(a.status)
    }
    // Vor F2: 10× 401, keine 429.
    check('falsches currentPassword: nach 5 Versuchen 429', cp.slice(5).every((x) => x === 429), cp.join(' '))

    await _authFuerTest(null)
    _zaehlerLeeren()
    if (altTP === undefined) delete process.env.AT_TRUST_PROXY; else process.env.AT_TRUST_PROXY = altTP
    if (altTPx === undefined) delete process.env.AT_TRUSTED_PROXY; else process.env.AT_TRUSTED_PROXY = altTPx
})

console.log('\nA2-30: alte CTJ_-Schalter\n')
{
    const sichern = ['AT_RESET_AUTH', 'CTJ_RESET_AUTH', 'AT_NO_ENGINE', 'CTJ_NO_ENGINE'].map((k) => [k, process.env[k]])
    process.env.CTJ_RESET_AUTH = '1'
    delete process.env.AT_RESET_AUTH
    check('ohne AT_RESET_AUTH wirkt CTJ_RESET_AUTH weiter (keine Aussperrung beim Update)', umgebungAn('RESET_AUTH') === true)
    check('… und wird beim Start gemeldet', alteSicherheitsSchalter().includes('CTJ_RESET_AUTH=1'))
    process.env.AT_RESET_AUTH = ''
    // Vor F2: leeres AT_RESET_AUTH fiel auf CTJ_RESET_AUTH=1 zurück → Gate bei jedem Start aus.
    check('leeres AT_RESET_AUTH überstimmt CTJ_RESET_AUTH', umgebungAn('RESET_AUTH') === false)
    process.env.AT_NO_ENGINE = ''
    process.env.CTJ_NO_ENGINE = '1'
    check('andere Variablen fallen wie bisher zurück', umgebung('NO_ENGINE') === '1')
    for (const [k, v] of sichern) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
