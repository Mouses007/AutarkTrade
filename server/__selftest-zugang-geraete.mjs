/**
 * Selbsttest zu den Server-Befunden des Gesamtaudits vom 26.10.2026
 * (docs/audit/2026-10-26-gesamtaudit.md, Paket A2):
 * SEC-SRV-002/003/004/005/006/007/009/014/015/017, SEC-OPS-018, SEC-WEB-006.
 *
 *   node server/__selftest-zugang-geraete.mjs
 *
 * Wegwerf-SQLite (`AT_DB_FILE=:memory:`) und echter HTTP-Server auf einem
 * freien Port. Jeder Block nennt, was VOR der Korrektur geschah.
 */

process.env.AT_DB_FILE = ':memory:'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import nodeCrypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (!process.env.AT_SECRET_FILE) process.env.AT_SECRET_FILE = path.join(os.tmpdir(), `at-a2-selftest-${process.pid}`)
delete process.env.AT_SECRET
delete process.env.CTJ_SECRET
delete process.env.AT_TESTBETRIEB
delete process.env.CTJ_TESTBETRIEB

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.resolve(HIER, '..')
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8')

const { initDb, getKnex, schuetzeDbDatei } = await import('./database.js')
const { encrypt, decrypt, secretZuKurz, warneSchwachesSecret, SECRET_MIN, migriereAltSchluessel } = await import('./crypto.js')
const { herkunftMiddleware, cookieAutomatischErlaubt, setzeBindungsModus, _authFuerTest } = await import('./auth.js')
const { setupEsp32Routes, setupEsp32AdminRoutes, waehleFilter, erstelleBremse, _esp32BremseLeeren, ESP32_FEHLER_MAX } = await import('./esp32-api.js')
const { pruefeGeraet, mitGeraet, geraeteUebersicht, istGesperrtesPushZiel, MAX_GERAETE } = await import('./esp32-push.js')
const { ALLE_VERSCHLUESSELTEN, JSON_GEHEIMNISSE, VERDAECHTIG } = await import('./geheimnisse.js')
const { updateCheckBeimStart } = await import('./update-api.js')
const { gespeicherterApiSchluessel, pruefeDatabentoRumpf } = await import('./databento-api.js')
const { apisOhneSchluessel, apisZusammenfuehren } = await import('./api-routes.js')
const express = (await import('express')).default

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

await initDb()
const knex = getKnex()

// ── SEC-SRV-002 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-002: Herkunftsprüfung für ändernde API-Aufrufe\n')
{
    const lauf = async (methode, headers, peer = '192.168.1.20') => {
        let status = null
        let weiter = false
        await herkunftMiddleware(
            { method: methode, headers, socket: { remoteAddress: peer } },
            { status(s) { status = s; return { json() {} } } },
            () => { weiter = true },
        )
        return weiter ? 'weiter' : status
    }
    const nas = { host: '192.168.1.5:8080' }
    // Der Angriff aus dem Bericht: same-site von einem anderen Port. Vorher: 200.
    check('POST Sec-Fetch-Site same-site (anderer Port) → 403', await lauf('POST', { ...nas, 'sec-fetch-site': 'same-site', origin: 'http://192.168.1.5:5000' }) === 403)
    check('POST Sec-Fetch-Site cross-site → 403', await lauf('POST', { ...nas, 'sec-fetch-site': 'cross-site' }) === 403)
    check('POST nur Origin mit anderem Port → 403', await lauf('POST', { ...nas, origin: 'http://192.168.1.5:5000' }) === 403)
    check('DELETE mit Origin null → 403', await lauf('DELETE', { ...nas, origin: 'null' }) === 403)
    check('POST same-origin → durch', await lauf('POST', { ...nas, 'sec-fetch-site': 'same-origin', origin: 'http://192.168.1.5:8080' }) === 'weiter')
    check('POST nur Origin gleich Host (inkl. Port) → durch', await lauf('POST', { ...nas, origin: 'http://192.168.1.5:8080' }) === 'weiter')
    check('POST ohne beide Köpfe (curl, Skript, ESP32) → durch', await lauf('POST', { ...nas }) === 'weiter')
    check('GET same-site → durch (nur ändernde Methoden)', await lauf('GET', { ...nas, 'sec-fetch-site': 'same-site' }) === 'weiter')
    check('Standard-Port zählt wie keiner (https://nas = nas:443)', await lauf('PUT', { host: 'nas:443', origin: 'https://nas' }) === 'weiter')
    // Hinter Caddy (8443): Host kommt unverändert an.
    check('hinter Caddy: Origin https://nas:8443, Host nas:8443 → durch', await lauf('POST', { host: 'nas:8443', origin: 'https://nas:8443', 'sec-fetch-site': 'same-origin' }) === 'weiter')

    // X-Forwarded-Host nur vom vertrauten Proxy
    const sichern = ['AT_TRUST_PROXY', 'AT_TRUSTED_PROXY'].map((k) => [k, process.env[k]])
    process.env.AT_TRUST_PROXY = '1'
    process.env.AT_TRUSTED_PROXY = '10.0.0.2'
    const proxyKopf = { host: 'journal:8080', origin: 'https://nas:8443', 'x-forwarded-host': 'nas:8443' }
    check('X-Forwarded-Host vom vertrauten Proxy → durch', await lauf('POST', proxyKopf, '10.0.0.2') === 'weiter')
    check('X-Forwarded-Host von beliebiger Adresse → 403', await lauf('POST', proxyKopf, '10.0.0.9') === 403)
    delete process.env.AT_TRUST_PROXY
    check('X-Forwarded-Host ohne AT_TRUST_PROXY → 403', await lauf('POST', proxyKopf, '10.0.0.2') === 403)
    for (const [k, v] of sichern) { if (v === undefined) delete process.env[k]; else process.env[k] = v }

    const index = lies('index.mjs')
    const esp = index.indexOf('setupEsp32Routes(app)\n')
    const herkunft = index.indexOf("app.use('/api', herkunftMiddleware)")
    const auth = index.indexOf("app.use('/api', apiAuthMiddleware)")
    check('index.mjs: Herkunft nach den ESP32-Routen, vor der Sitzungsprüfung', esp > 0 && herkunft > esp && auth > herkunft, `${esp}/${herkunft}/${auth}`)
}

// ── SEC-SRV-003 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-003: Push-Ziele und Geräteliste\n')
const ecdh = nodeCrypto.createECDH('prime256v1'); ecdh.generateKeys()
const p256dh = ecdh.getPublicKey().toString('base64url')
const authB = nodeCrypto.randomBytes(16).toString('base64url')
const geraet = (endpoint, name = '') => ({ endpoint, p256dh, auth: authB, geraet: name })
{
    // Vorher: alle drei angenommen (Probe aus dem Audit).
    for (const url of ['http://127.0.0.1:8080/api/auth/ueberall-abmelden', 'http://169.254.169.254/latest/meta-data/',
        'http://0.0.0.0:8080/', 'http://[::1]:8080/', 'http://[fe80::1]/', 'http://224.0.0.1/', 'http://localhost:8080/',
        'http://[::ffff:127.0.0.1]/', 'http://user:pw@ntfy.example/x']) {
        check(`gesperrt: ${url}`, !!pruefeGeraet(geraet(url)).fehler)
    }
    for (const url of ['http://192.168.1.1/up', 'https://10.0.0.5:8443/up', 'https://ntfy.sh/upAbc', 'http://[fd00::5]/up']) {
        check(`erlaubt: ${url}`, !pruefeGeraet(geraet(url)).fehler, pruefeGeraet(geraet(url)).fehler)
    }
    check('istGesperrtesPushZiel: 255.255.255.255', istGesperrtesPushZiel('255.255.255.255'))
    check('istGesperrtesPushZiel: ff02::1', istGesperrtesPushZiel('ff02::1'))
    check('istGesperrtesPushZiel: 192.168.178.20 nicht', !istGesperrtesPushZiel('192.168.178.20'))

    let liste = []
    for (let i = 1; i <= MAX_GERAETE; i++) liste = mitGeraet(liste, { ...geraet(`https://ntfy.example/up${i}`, `Handy${i}`) }, i).liste
    // Vorher: das sechste verdrängte das älteste.
    const voll = mitGeraet(liste, geraet('https://ntfy.example/fremd', 'Fremd'), 99)
    check('volle Liste: neues Gerät abgelehnt', voll.fehler === 'voll' && !voll.liste)
    const neuAdresse = mitGeraet(liste, geraet('https://ntfy.example/neu1', 'Handy1'), 100)
    check('gleiches Gerät mit neuer Adresse ersetzt seinen Eintrag', neuAdresse.liste?.length === MAX_GERAETE
        && neuAdresse.liste.filter((g) => g.geraet === 'Handy1').length === 1
        && neuAdresse.liste.some((g) => g.endpoint === 'https://ntfy.example/neu1'))
    const gleicheAdresse = mitGeraet(liste, geraet('https://ntfy.example/up3', ''), 101)
    check('gleiche Adresse ersetzt ihren Eintrag', gleicheAdresse.liste?.length === MAX_GERAETE)
    const ueb = geraeteUebersicht(liste)
    const text = JSON.stringify(ueb)
    check('Übersicht: Name, Host, Datum — keine Schlüssel, kein Pfad', ueb.length === MAX_GERAETE && ueb[0].host === 'ntfy.example'
        && !text.includes(p256dh) && !text.includes(authB) && !text.includes('/up1'), text.slice(0, 160))

    const push = lies('server/esp32-push.js')
    check('Push-fetch ohne Umleitungen und über den prüfenden Agenten', /redirect: 'manual'/.test(push) && /dispatcher: PUSH_AGENT/.test(push))
}

// ── HTTP: ESP32-Routen ────────────────────────────────────────────────────
const SCHLUESSEL = nodeCrypto.randomBytes(32).toString('hex')
await knex('settings').where('id', 1).update({ esp32ApiKey: encrypt(SCHLUESSEL), esp32PushGeraete: '[]' })
const app = express()
app.use(express.json({ limit: '1mb' }))
setupEsp32Routes(app)
app.use('/api', herkunftMiddleware)
setupEsp32AdminRoutes(app)
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const basis = `http://127.0.0.1:${server.address().port}`
const api = async (methode, pfad, body, kopf = {}) => {
    const r = await fetch(basis + pfad, {
        method: methode, headers: { 'Content-Type': 'application/json', ...kopf },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await r.json() } catch { /* leer */ }
    return { status: r.status, json }
}

console.log('\nSEC-SRV-003 (HTTP): Anmelden, volle Liste, Übersicht, Löschen\n')
{
    const k = { 'X-ESP32-Key': SCHLUESSEL }
    for (let i = 1; i <= MAX_GERAETE; i++) await api('POST', '/api/esp32/push', geraet(`https://ntfy.example/up${i}`, `Handy${i}`), k)
    let r = await api('POST', '/api/esp32/push', geraet('https://ntfy.example/fremd', 'Fremd'), k)
    check('sechstes Gerät → 409, keines verdrängt', r.status === 409 && r.json?.voll === true, JSON.stringify(r.json))
    r = await api('POST', '/api/esp32/push', geraet('https://ntfy.example/neu2', 'Handy2'), k)
    check('echtes Handy nach Neuregistrierung wird angenommen', r.status === 200 && r.json?.geraete === MAX_GERAETE, JSON.stringify(r.json))
    r = await api('POST', '/api/esp32/push', geraet('http://127.0.0.1:8080/api/x', 'X'), k)
    check('Loopback-Ziel → 400', r.status === 400)
    r = await api('POST', '/api/esp32/push', geraet('https://ntfy.example/x', 'X'), { ...k, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
    check('Schlüssel-Route ist von der Herkunftsprüfung ausgenommen (409 statt 403)', r.status === 409, String(r.status))

    const liste = await api('GET', '/api/esp32/geraete')
    const text = JSON.stringify(liste.json)
    check('GET /api/esp32/geraete: 5 Geräte ohne Schlüssel', liste.json?.geraete?.length === MAX_GERAETE && !text.includes(p256dh) && !text.includes(authB), text.slice(0, 160))
    const ziel = liste.json.geraete.find((g) => g.geraet === 'Handy3')
    r = await api('DELETE', `/api/esp32/geraete/${ziel.id}`)
    check('DELETE /api/esp32/geraete/:id entfernt genau eines', r.status === 200 && r.json?.geraete?.length === MAX_GERAETE - 1
        && !r.json.geraete.some((g) => g.geraet === 'Handy3'))
    r = await api('DELETE', '/api/esp32/geraete/gibtsnicht')
    check('unbekannte Kennung → 404', r.status === 404)
    r = await api('DELETE', `/api/esp32/geraete/${ziel.id}`, undefined, { origin: 'http://192.168.1.5:5000', 'sec-fetch-site': 'same-site' })
    check('Löschen von fremder Herkunft → 403', r.status === 403)
}

// ── SEC-SRV-004 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-004: Filter, Schlüssellänge, Fehlversuchsbremse\n')
{
    check('filter frei → all', waehleFilter({ force: true, abfrage: 'xyz123' }) === 'all')
    check('filter week bleibt', waehleFilter({ force: true, abfrage: 'week' }) === 'week')
    check('Einstellung hat Vorrang ohne force', waehleFilter({ force: false, abfrage: 'week', einstellung: 'year' }) === 'year')
    check('kaputte Einstellung → all', waehleFilter({ force: false, einstellung: 'bogus' }) === 'all')
    check('ohne alles → month', waehleFilter({ force: false }) === 'month')
    check('display: Filter geht nur über waehleFilter in den Cache-Schlüssel', /waehleFilter\(/.test(lies('server/esp32-api.js')) && !/req\.query\.filter \|\| 'all'/.test(lies('server/esp32-api.js')))

    let r = await api('POST', '/api/esp32/settings', { esp32ApiKey: 'kurz-1234' })
    check('Schlüssel von Hand unter 32 Zeichen → 400', r.status === 400)
    const langer = 'L'.repeat(40)
    r = await api('POST', '/api/esp32/settings', { esp32ApiKey: langer })
    const z = await knex('settings').where('id', 1).first()
    check('Schlüssel von Hand mit 40 Zeichen gespeichert', r.status === 200 && decrypt(z.esp32ApiKey) === langer)
    await knex('settings').where('id', 1).update({ esp32ApiKey: encrypt(SCHLUESSEL) })

    _esp32BremseLeeren()
    const gut = { 'X-ESP32-Key': SCHLUESSEL }
    const stati = []
    for (let i = 0; i < 30; i++) stati.push((await api('GET', '/api/esp32/alarme?seit=0', undefined, gut)).status)
    check('30 gültige Abrufe in Folge werden nicht gebremst', stati.every((s) => s === 200), stati.join(' '))
    const falsch = []
    for (let i = 0; i < ESP32_FEHLER_MAX + 2; i++) falsch.push((await api('GET', '/api/esp32/alarme', undefined, { 'X-ESP32-Key': 'falsch' + i })).status)
    // Vorher: 40× 401, keine Bremse.
    check(`nach ${ESP32_FEHLER_MAX} Fehlversuchen → 429`, falsch.slice(0, ESP32_FEHLER_MAX).every((s) => s === 401) && falsch.slice(ESP32_FEHLER_MAX).every((s) => s === 429), falsch.join(' '))
    r = await api('GET', '/api/esp32/alarme', undefined, gut)
    check('… auch mit dem richtigen Schlüssel, solange gesperrt (kein Treffer-Orakel)', r.status === 429)
    _esp32BremseLeeren()

    const b = erstelleBremse({ max: 3, globalMax: 100, fensterMs: 1000 })
    b.fehler('a', 0); b.fehler('a', 10); b.fehler('a', 20)
    check('Bremse: gesperrt nach max im Fenster', b.gesperrt('a', 30) === true && b.gesperrt('b', 30) === false)
    check('Bremse: nach Ablauf des Fensters frei', b.gesperrt('a', 1100) === false)
    const g = erstelleBremse({ max: 100, globalMax: 5, fensterMs: 1000 })
    for (let i = 0; i < 5; i++) g.fehler('ip' + i, i)
    check('Bremse: globale Grenze über rotierende Adressen', g.gesperrt('neu', 10) === true)
}

// ── SEC-SRV-005 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-005: Zeitgrenzen der signierten Abrufe\n')
{
    const bitget = lies('server/bitget-api.js')
    const fetches = bitget.match(/await fetch\([^]*?\}\)/g) || []
    check('bitget-api.js: jeder fetch mit AbortSignal.timeout(15000)', fetches.length >= 2 && fetches.every((f) => f.includes('AbortSignal.timeout(15000)')), `${fetches.length} Aufrufe`)
    check('pionex-transport.js: pionexRequest mit AbortSignal.timeout(15000)', /fetch\(url, \{[^]*?signal: AbortSignal\.timeout\(15000\)/.test(lies('server/pionex-transport.js')))
    check('pionex-api.js: fetchTickerPrice mit AbortSignal.timeout(15000)', /tickers\?symbol=[^]*?AbortSignal\.timeout\(15000\)/.test(lies('server/pionex-api.js')))
}

// ── SEC-SRV-006 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-006: Bitget-Hinweis und Nur-Lese-Hinweis\n')
{
    const bitget = lies('server/bitget-api.js')
    check('Bitget-Test rät nicht mehr, die IP-Beschränkung zu entfernen', !/entferne die IP-Beschränkung/.test(bitget) && /Server-IP in der Whitelist ein/.test(bitget))
    const de = JSON.parse(lies('src/i18n/locales/de.json'))
    const en = JSON.parse(lies('src/i18n/locales/en.json'))
    check('Hinweis „nur Leserechte" in de und en', /Leserecht/.test(de.settings?.nurLeserechteText || '') && !!en.settings?.nurLeserechteText)
    check('… und in den Börsenschlüsseln eingebunden', lies('src/views/einstellungen/journal/BoersenApi.vue').includes("t('settings.nurLeserechteText')"))
}

// ── SEC-SRV-007 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-007: kurzes AT_SECRET\n')
{
    check('31 Zeichen sind zu kurz', secretZuKurz('x'.repeat(SECRET_MIN - 1)) === true)
    check('32 Zeichen genügen', secretZuKurz('x'.repeat(SECRET_MIN)) === false)
    check('leer (Secret-Datei) zählt nicht', secretZuKurz('') === false && secretZuKurz(undefined) === false)
    const alt = console.warn
    const gesehen = []
    console.warn = (...a) => gesehen.push(a.join(' '))
    const gewarnt = warneSchwachesSecret('kurz-123')
    console.warn = alt
    check('Warnung beim Start, ohne das Secret zu nennen', gewarnt && gesehen.some((z) => /AT_SECRET ist nur 8 Zeichen/.test(z)) && !gesehen.some((z) => z.includes('kurz-123')), gesehen.join(' | '))
    check('index.mjs ruft die Warnung beim Start auf', /warneSchwachesSecret\(\)/.test(lies('index.mjs')))
}

// ── SEC-SRV-009 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-009: DB-Datei 0600\n')
if (process.platform !== 'win32') {
    const datei = path.join(os.tmpdir(), `at-a2-db-${process.pid}.db`)
    fs.writeFileSync(datei, 'x'); fs.chmodSync(datei, 0o644)
    fs.writeFileSync(datei + '-wal', 'x'); fs.chmodSync(datei + '-wal', 0o664)
    const geaendert = schuetzeDbDatei(datei)
    check('Datei und WAL auf 0600', (fs.statSync(datei).mode & 0o777) === 0o600 && (fs.statSync(datei + '-wal').mode & 0o777) === 0o600, geaendert.join(','))
    check('zweiter Lauf ändert nichts', schuetzeDbDatei(datei).length === 0)
    check(':memory: wird übergangen', schuetzeDbDatei(':memory:').length === 0)
    fs.rmSync(datei, { force: true }); fs.rmSync(datei + '-wal', { force: true })
}

// ── SEC-SRV-014 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-014: Cookie im Entwicklungs-Proxy\n')
{
    const alt = process.env.AT_ALLOW_INSECURE
    delete process.env.AT_ALLOW_INSECURE
    await _authFuerTest(null)
    setzeBindungsModus(false)
    check('Netzbindung ohne Gate: kein Cookie', cookieAutomatischErlaubt() === false)
    setzeBindungsModus(true)
    check('lokal ohne Gate: Cookie', cookieAutomatischErlaubt() === true)
    await _authFuerTest('ein-langes-passwort')
    check('mit Gate: kein Cookie', cookieAutomatischErlaubt() === false)
    await _authFuerTest(null)
    if (alt !== undefined) process.env.AT_ALLOW_INSECURE = alt
    // Vorher: `if (isAuthEnabled()) return` — Netzbindung ohne Gate verteilte das Cookie.
    check('index.mjs: Vite-Haken nutzt dieselbe Regel', /proxy\.on\('proxyRes'[^]*?if \(!cookieAutomatischErlaubt\(\)\) return/.test(lies('index.mjs')))
}

// ── SEC-SRV-015 ───────────────────────────────────────────────────────────
console.log('\nSEC-SRV-015: Portfolio-Geheimnisse\n')
/** Portfolio-Spalten, deren Name verdächtig klingt, die aber kein Geheimnis tragen. */
const OHNE_GEHEIMNIS = new Set(['portfolio_bewegungen.txHash'])   // öffentliche Transaktionskennung
{
    const tabellen = ALLE_VERSCHLUESSELTEN.map(([t]) => t)
    check('portfolio_schluessel.wert mit Schlüsselspalte name', ALLE_VERSCHLUESSELTEN.some(([t, sp, id]) => t === 'portfolio_schluessel' && sp.includes('wert') && id === 'name'))
    check('portfolio_adressen.adresse aufgenommen', ALLE_VERSCHLUESSELTEN.some(([t, sp]) => t === 'portfolio_adressen' && sp.includes('adresse')))
    check('settings.apis als JSON-Geheimnis', JSON_GEHEIMNISSE.some(([t, sp, f]) => t === 'settings' && sp === 'apis' && f === 'key'))
    // Namensscan über ALLE Portfolio-Tabellen (vorher nur settings)
    const alle = await knex.raw("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'portfolio_%'")
    const fehlen = []
    for (const { name } of alle) {
        const spalten = Object.keys(await knex(name).columnInfo())
        for (const s of spalten) {
            if (!VERDAECHTIG.test(s) && !/^(wert|adresse)$/.test(s)) continue
            const gelistet = ALLE_VERSCHLUESSELTEN.some(([t, sp]) => t === name && sp.includes(s))
            if (!gelistet && !OHNE_GEHEIMNIS.has(`${name}.${s}`)) fehlen.push(`${name}.${s}`)
        }
    }
    check('jede Portfolio-Spalte mit Geheimnis-Namen ist gelistet', fehlen.length === 0, fehlen.join(', '))
    check('alle Tabellen der Liste existieren', tabellen.every((t) => !t.startsWith('portfolio_') || alle.some((x) => x.name === t)))

    // Start-Migration mit `name` als Schlüssel: Klartext wird verschlüsselt.
    await knex('portfolio_schluessel').insert({ name: 'etherscan', wert: 'KLARTEXT-ETHERSCAN', updatedAt: 1 })
    await migriereAltSchluessel(knex, ALLE_VERSCHLUESSELTEN)
    const z = await knex('portfolio_schluessel').where('name', 'etherscan').first()
    check('Migration behandelt portfolio_schluessel (Schlüssel name)', z.wert !== 'KLARTEXT-ETHERSCAN' && decrypt(z.wert) === 'KLARTEXT-ETHERSCAN')
}

// ── SEC-SRV-015 + SEC-SRV-017: reencrypt-keys.mjs ─────────────────────────
console.log('\nSEC-SRV-015/017: Umschlüsselung mit Portfolio und apis, ohne Schlüsselteile im Protokoll\n')
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-a2-reenc-'))
    const ALT = 'altes-secret-' + 'a'.repeat(30)
    const NEU = 'NEUESSECRET' + 'b'.repeat(30)
    const mit = (secret, text) => {
        const k = nodeCrypto.createHash('sha256').update(secret).digest()
        const iv = nodeCrypto.randomBytes(16)
        const c = nodeCrypto.createCipheriv('aes-256-gcm', k, iv)
        const d = c.update(text, 'utf8', 'hex') + c.final('hex')
        return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${d}`
    }
    const lese = (secret, w) => {
        try {
            const k = nodeCrypto.createHash('sha256').update(secret).digest()
            const [i, t, d] = String(w).split(':')
            const x = nodeCrypto.createDecipheriv('aes-256-gcm', k, Buffer.from(i, 'hex')); x.setAuthTag(Buffer.from(t, 'hex'))
            return x.update(d, 'hex', 'utf8') + x.final('utf8')
        } catch { return null }
    }
    const KLAR = { ai: 'QAIQ-schluessel-0001', bp: 'QBPQ-bitpanda-0002', adr: 'QADQ-xpub-0003', poly: 'QPOQ-polygon-0004' }
    const knexLib = (await import('knex')).default
    const k2 = knexLib({ client: 'better-sqlite3', connection: { filename: path.join(dir, 'autarktrade.db') }, useNullAsDefault: true })
    await k2.schema.createTable('settings', (t) => { t.increments('id'); t.text('aiApiKey'); t.text('apis') })
    await k2.schema.createTable('portfolio_schluessel', (t) => { t.string('name').primary(); t.text('wert') })
    await k2.schema.createTable('portfolio_adressen', (t) => { t.increments('id'); t.text('adresse') })
    await k2('settings').insert({ id: 1, aiApiKey: mit(ALT, KLAR.ai), apis: JSON.stringify([{ provider: 'polygon', key: mit(ALT, KLAR.poly) }]) })
    await k2('portfolio_schluessel').insert({ name: 'bitpanda', wert: mit(ALT, KLAR.bp) })
    await k2('portfolio_adressen').insert({ id: 7, adresse: mit(ALT, KLAR.adr) })
    await k2.destroy()
    let aus = ''
    try {
        aus = execFileSync(process.execPath, [path.join(HIER, 'reencrypt-keys.mjs'), '--apply'], {
            cwd: dir,
            env: { ...process.env, AT_SECRET: NEU, AT_SECRET_ALT: ALT, AT_SECRET_FILE: path.join(dir, 'gibtsnicht'), AT_DB_FILE: '' },
        }).toString()
    } catch (e) { aus = String(e.stdout || '') + String(e.stderr || '') }
    const k3 = knexLib({ client: 'better-sqlite3', connection: { filename: path.join(dir, 'autarktrade.db') }, useNullAsDefault: true })
    const s = await k3('settings').where('id', 1).first()
    const ps = await k3('portfolio_schluessel').where('name', 'bitpanda').first()
    const pa = await k3('portfolio_adressen').where('id', 7).first()
    await k3.destroy()
    check('portfolio_schluessel (ohne id) umgeschlüsselt', lese(NEU, ps.wert) === KLAR.bp, aus.slice(-300))
    check('portfolio_adressen umgeschlüsselt', lese(NEU, pa.adresse) === KLAR.adr)
    check('settings.apis[].key umgeschlüsselt', lese(NEU, JSON.parse(s.apis)[0].key) === KLAR.poly)
    check('settings.aiApiKey umgeschlüsselt', lese(NEU, s.aiApiKey) === KLAR.ai)
    // Vorher: „AT_SECRET (NEUESS…)" und je Schlüssel „QAIQ…001".
    check('Protokoll ohne Anfang des Secrets', !aus.includes(NEU.slice(0, 6)) && /\(\d+ Zeichen\)/.test(aus))
    check('Protokoll ohne Anfang der Schlüssel', !Object.values(KLAR).some((v) => aus.includes(v.slice(0, 4))), aus.split('\n').filter((l) => /Q..Q/.test(l)).join(' | '))
    fs.rmSync(dir, { recursive: true, force: true })
}

// ── SEC-SRV-017: Rollback mit npm ci ──────────────────────────────────────
console.log('\nSEC-SRV-017: Rollback mit npm ci\n')
{
    const upd = lies('server/update-api.js')
    const rollback = upd.slice(upd.indexOf("'/api/update/rollback'"), upd.indexOf("'/api/update/rollback-status'"))
    check('Rollback nutzt npm ci, wenn ein Lockfile da ist', /mitLock \? 'npm ci'/.test(rollback) && /'npm ci \|\| npm install'/.test(rollback))
    check('… und kein festes `execSync(\'npm install\'` ohne Rückfallzweig', !/const npmOutput = execSync\('npm install'/.test(rollback))
}

// ── SEC-OPS-018 ───────────────────────────────────────────────────────────
console.log('\nSEC-OPS-018: Update-Prüfung beim Start\n')
{
    const sichern = ['AT_TESTBETRIEB', 'AT_KEIN_UPDATECHECK'].map((k) => [k, process.env[k]])
    delete process.env.AT_TESTBETRIEB; delete process.env.AT_KEIN_UPDATECHECK
    check('normal: Prüfung beim Start', updateCheckBeimStart() === true)
    process.env.AT_TESTBETRIEB = '1'
    check('Testbetrieb: keine Prüfung', updateCheckBeimStart() === false)
    delete process.env.AT_TESTBETRIEB
    process.env.AT_KEIN_UPDATECHECK = '1'
    check('AT_KEIN_UPDATECHECK=1: keine Prüfung', updateCheckBeimStart() === false)
    for (const [k, v] of sichern) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
}

// ── SEC-WEB-006 ───────────────────────────────────────────────────────────
console.log('\nSEC-WEB-006: Polygon-/Databento-Schlüssel bleiben auf dem Server\n')
{
    const aus = apisOhneSchluessel([{ provider: 'polygon', key: 'enc' }, { provider: 'databento', key: '' }])
    check('Sitzung: nur keySet', aus[0].keySet === true && !('key' in aus[0]) && aus[1].keySet === false)
    const zus = apisZusammenfuehren([{ provider: 'polygon', keySet: true }, { provider: 'databento', key: 'NEU' }], [{ provider: 'polygon', key: 'ALT-ENC' }])
    check('Zurückschreiben ohne key behält den gespeicherten', zus[0].key === 'ALT-ENC' && !('keySet' in zus[0]) && zus[1].key === 'NEU')
    await knex('settings').where('id', 1).update({ apis: JSON.stringify([{ provider: 'databento', key: encrypt('db-GEHEIM-123') }]) })
    check('Server liest den gespeicherten Schlüssel entschlüsselt', await gespeicherterApiSchluessel('databento') === 'db-GEHEIM-123' && await gespeicherterApiSchluessel('polygon') === '')
    const ok = pruefeDatabentoRumpf({ dataset: 'XNAS.ITCH', stype_in: 'raw_symbol', symbols: 'AAPL', schema: 'ohlcv-1m', start: 1700000000 * 1e9, end: 1700086400 * 1e9, username: 'fremd' })
    check('Databento-Rumpf: geprüfte Felder, kein username', ok.felder && !('username' in ok.felder) && ok.felder.start === '1700000000000000000', JSON.stringify(ok))
    check('Databento-Rumpf: unbekannter Datensatz abgewiesen', !!pruefeDatabentoRumpf({ dataset: undefined, stype_in: 'raw_symbol', symbols: 'BTC', schema: 'ohlcv-1m', start: 1, end: 2 }).fehler)
    check('Databento-Rumpf: Symbol mit Sonderzeichen abgewiesen', !!pruefeDatabentoRumpf({ dataset: 'XNAS.ITCH', stype_in: 'raw_symbol', symbols: 'A&B=C', schema: 'ohlcv-1m', start: 1, end: 2 }).fehler)
    const imp = lies('src/utils/journal/import.js')
    check('Browser ruft Databento nicht mehr direkt und schickt keinen Schlüssel', !imp.includes('hist.databento.com') && !imp.includes('x-polygon-api-key') && !/username:/.test(imp))
    check('/api/databento ist eingerichtet', /setupDatabentoRoutes\(app\)/.test(lies('index.mjs')))
}

server.close()
try { fs.rmSync(process.env.AT_SECRET_FILE, { force: true }) } catch { /* egal */ }
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
process.exit(0)
