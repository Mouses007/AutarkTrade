/**
 * Integrationstest HTTPS: Wegwerf-SQLite, echter HTTPS-Server auf einem
 * freien Port, dieselben Middlewares wie `index.mjs`.
 *
 *   node server/tls/__selftest-tls-server.mjs
 *
 * Geprüft wird, was ein Gerät erlebt: CA holen (ohne Sitzung), mit genau
 * dieser CA als einzigem Vertrauensanker verbinden (mit einer fremden CA
 * scheitern), Zertifikat erneuern und in einer NEUEN Verbindung das neue
 * sehen — ohne Neustart. Dazu Secure-Cookie/HSTS bei direkter TLS-Verbindung,
 * Host-Schutz und Herkunftsprüfung auf dem HTTPS-Port, Vorschläge aus dem
 * Host-Kopf (erst nach Bestätigung im Zertifikat), eine CA je Datenbank bei
 * gleichzeitigem Anlegen, Backup ohne CA-Schlüssel und der ESP32-Anzeige-
 * Schlüssel (SEC-GER-001).
 */
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'

process.env.AT_DB_FILE = ':memory:'
if (!process.env.AT_SECRET_FILE) process.env.AT_SECRET_FILE = path.join(os.tmpdir(), `at-tls-selftest-${process.pid}`)
delete process.env.AT_SECRET
delete process.env.CTJ_SECRET
delete process.env.AT_MDNS_NAME
delete process.env.CTJ_MDNS_NAME
process.env.AT_TLS_NAMEN = '192.168.178.100'

const { initDb, getKnex } = await import('../database.js')
const { encrypt, isEncrypted } = await import('../crypto.js')
const auth = await import('../auth.js')
const { setupEsp32Routes, _esp32BremseLeeren } = await import('../esp32-api.js')
const { ALLE_VERSCHLUESSELTEN } = await import('../geheimnisse.js')
const dienst = await import('./dienst.js')
const { erzeugeCa, fingerabdruck } = await import('./zertifikat.js')
const { ausPem } = await import('./der.js')
const express = (await import('express')).default

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

await initDb()
await auth.loadAuthConfig()
auth.setzeBindungsModus(true)   // lokal gebunden, ohne Passwort: Cookie wird verteilt

// ── App wie in index.mjs ─────────────────────────────────────────────────
const app = express()
app.use(express.json())
app.use((req, res, next) => {
    if (auth.isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
    next()
})
app.use(auth.hostGuardMiddleware)
app.use(dienst.merkeHostMiddleware)
setupEsp32Routes(app)
dienst.setupTlsOeffentlich(app)
app.use(auth.sessionCookieMiddleware)
app.use('/api', auth.herkunftMiddleware)
app.use('/api', auth.apiAuthMiddleware)
dienst.setupTlsRoutes(app)
app.get('/seite', (req, res) => res.type('text/plain').send('ok'))

console.log('\nStart\n')
const start = await dienst.stelleTlsSicher()
check('CA beim ersten Start angelegt', start.grund === '' || start.erneuert === false, JSON.stringify(start))
const zeile1 = await getKnex()('tls_zertifikat').where('id', 1).first()
check('genau eine Zeile', (await getKnex()('tls_zertifikat').count('* as n'))[0].n == 1)
check('CA- und Server-Schlüssel verschlüsselt gespeichert', isEncrypted(zeile1.caSchluessel) && isEncrypted(zeile1.serverSchluessel))
check('Zertifikate im Klartext', /BEGIN CERTIFICATE/.test(zeile1.caPem) && /BEGIN CERTIFICATE/.test(zeile1.serverPem))
check('geheimnisse.js kennt die Spalten (Umschlüsselung)', ALLE_VERSCHLUESSELTEN.some(([t, sp]) => t === 'tls_zertifikat' && sp.includes('caSchluessel') && sp.includes('serverSchluessel')))

const httpServer = await new Promise((f) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => f(s)) })
const httpPort = httpServer.address().port
const tlsServer = await dienst.starteHttps(app, { host: '127.0.0.1', port: 0 })
check('HTTPS-Server läuft', !!tlsServer)
const port = tlsServer.address().port

const cookie = (await auth.getSessionCookieString(null)).split(';')[0]

/** Roh-Anfrage über HTTP oder HTTPS (mit gewählter CA und frei setzbarem Host-Kopf). */
function anfrage({ ueber = 'https', pfad, methode = 'GET', ca, kopf = {}, body } = {}) {
    return new Promise((fertig, fehler) => {
        const daten = body === undefined ? undefined : JSON.stringify(body)
        const opt = {
            host: '127.0.0.1', port: ueber === 'https' ? port : httpPort, path: pfad, method: methode,
            headers: { ...(daten ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(daten) } : {}), ...kopf },
            agent: false,
        }
        if (ueber === 'https') { opt.ca = ca; opt.servername = 'localhost' }
        const r = (ueber === 'https' ? https : http).request(opt, (res) => {
            const teile = []
            res.on('data', (d) => teile.push(d))
            res.on('end', () => {
                const roh = Buffer.concat(teile)
                let json = null
                try { json = JSON.parse(roh.toString()) } catch { /* kein JSON */ }
                fertig({ status: res.statusCode, kopf: res.headers, roh, json })
            })
        })
        r.on('error', fehler)
        if (daten) r.write(daten)
        r.end()
    })
}

/** TLS-Handshake mit genau dieser CA als einzigem Anker → Zertifikat der Gegenseite. */
function verbinde(caPem, { servername, host = '127.0.0.1' } = {}) {
    return new Promise((fertig) => {
        const s = tls.connect({ host, port, ca: [caPem], servername, rejectUnauthorized: true }, () => {
            const z = s.getPeerX509Certificate()
            s.end()
            fertig({ ok: s.authorized, zert: z })
        })
        s.on('error', (e) => fertig({ ok: false, fehler: e.code || e.message }))
    })
}

console.log('\nCA öffentlich holen\n')
const ca = await anfrage({ ueber: 'http', pfad: '/api/tls/ca' })
check('GET /api/tls/ca ohne Sitzung: 200 {pem, sha256}', ca.status === 200 && /BEGIN CERTIFICATE/.test(ca.json?.pem) && typeof ca.json?.sha256 === 'string', String(ca.status))
check('sha256 = SHA-256 über DER, GROSS mit Doppelpunkten',
    ca.json.sha256 === crypto.createHash('sha256').update(ausPem(ca.json.pem)).digest('hex').toUpperCase().match(/.{2}/g).join(':'))
const esp = await anfrage({ ueber: 'http', pfad: '/api/esp32/ca' })
check('GET /api/esp32/ca: dasselbe JSON', esp.status === 200 && esp.json?.pem === ca.json.pem && esp.json?.sha256 === ca.json.sha256)
const crt = await anfrage({ ueber: 'http', pfad: '/api/tls/ca.crt' })
check('ca.crt: application/x-x509-ca-cert', crt.kopf['content-type'] === 'application/x-x509-ca-cert', crt.kopf['content-type'])
check('ca.crt: Dateiname AutarkTrade-CA-<id>.crt', /attachment; filename="AutarkTrade-CA-[0-9A-F]{8}\.crt"/.test(crt.kopf['content-disposition'] || ''), crt.kopf['content-disposition'])
check('ca.crt: DER = PEM-Inhalt', crt.roh.equals(ausPem(ca.json.pem)))
check('ca.crt als X.509 lesbar, ist CA', new crypto.X509Certificate(crt.roh).ca === true)
const st0 = await anfrage({ ueber: 'http', pfad: '/api/tls/status' })
check('Verwaltung ohne Sitzung: 401', st0.status === 401, String(st0.status))

console.log('\nVerbinden\n')
const v1 = await verbinde(ca.json.pem, { servername: 'localhost' })
check('TLS mit genau dieser CA: vertraut', v1.ok === true, v1.fehler)
const vIp = await verbinde(ca.json.pem)
check('TLS über die IP 127.0.0.1 (ohne SNI): vertraut', vIp.ok === true, vIp.fehler)
check('Zertifikat trägt AT_TLS_NAMEN (192.168.178.100)', v1.zert?.checkIP('192.168.178.100') === '192.168.178.100')
const fremd = erzeugeCa()
const vf = await verbinde(fremd.pem, { servername: 'localhost' })
check('TLS mit fremder CA: scheitert', vf.ok === false && /UNABLE_TO_VERIFY|SELF_SIGNED|unable/i.test(String(vf.fehler)), vf.fehler)
const vName = await verbinde(ca.json.pem, { servername: 'evil.example' })
check('TLS mit fremdem Namen: scheitert (Namensprüfung)', vName.ok === false, vName.fehler)

console.log('\nCookie, HSTS, Host-Schutz, Herkunft (direkt auf dem HTTPS-Port)\n')
{
    const s = await anfrage({ pfad: '/seite', ca: ca.json.pem })
    const sc = String(s.kopf['set-cookie'] || '')
    check('HTTPS: Cookie mit Secure', s.status === 200 && /Secure/.test(sc), sc)
    check('HTTPS: HSTS gesetzt', /max-age=/.test(s.kopf['strict-transport-security'] || ''))
    const h = await anfrage({ ueber: 'http', pfad: '/seite' })
    check('HTTP: Cookie ohne Secure, kein HSTS', !/Secure/.test(String(h.kopf['set-cookie'] || '')) && !h.kopf['strict-transport-security'])
    const fremdHost = await anfrage({ pfad: '/api/tls/ca', ca: ca.json.pem, kopf: { host: 'evil.example:' + port } })
    check('Host-Schutz auf 8443: fremder Host → 421', fremdHost.status === 421, String(fremdHost.status))
    const gleich = await anfrage({ pfad: '/api/tls/erneuern', methode: 'POST', ca: ca.json.pem, body: {},
        kopf: { cookie, host: `127.0.0.1:${port}`, origin: `https://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' } })
    check('Herkunft: gleiche Herkunft mit Port → durch', gleich.status === 200, String(gleich.status))
    const andersPort = await anfrage({ pfad: '/api/tls/erneuern', methode: 'POST', ca: ca.json.pem, body: {},
        kopf: { cookie, host: `127.0.0.1:${port}`, origin: `https://127.0.0.1:${port + 1}` } })
    check('Herkunft: anderer Port → 403', andersPort.status === 403, String(andersPort.status))
}

console.log('\nErneuern ohne Neustart\n')
{
    const vorher = await verbinde(ca.json.pem, { servername: 'localhost' })
    const r = await anfrage({ pfad: '/api/tls/erneuern', methode: 'POST', ca: ca.json.pem, body: {}, kopf: { cookie } })
    check('POST /api/tls/erneuern: 200 mit Status', r.status === 200 && r.json?.server?.sha256, String(r.status))
    const nachher = await verbinde(ca.json.pem, { servername: 'localhost' })
    check('neue Verbindung sieht das neue Zertifikat', nachher.ok && nachher.zert.fingerprint256 !== vorher.zert.fingerprint256 && nachher.zert.fingerprint256 === r.json.server.sha256)
    check('derselbe HTTPS-Server (kein Neustart)', tlsServer.listening && tlsServer.address().port === port)
}

console.log('\nVorschläge aus dem Host-Kopf\n')
{
    await anfrage({ pfad: '/api/tls/ca', ca: ca.json.pem, kopf: { host: `192.168.178.55:${port}` } })
    await new Promise((f) => setTimeout(f, 100))
    let st = (await anfrage({ pfad: '/api/tls/status', ca: ca.json.pem, kopf: { cookie } })).json
    check('gesehener Host wird vorgeschlagen', st.vorschlaege.some((v) => v.name === '192.168.178.55'), JSON.stringify(st.vorschlaege))
    const v = await verbinde(ca.json.pem, { servername: 'localhost' })
    check('… aber NICHT von selbst ins Zertifikat', v.zert.checkIP('192.168.178.55') === undefined)
    await anfrage({ pfad: '/api/tls/ca', ca: ca.json.pem, kopf: { host: `localhost:${port}` } })
    st = (await anfrage({ pfad: '/api/tls/status', ca: ca.json.pem, kopf: { cookie } })).json
    check('bekannter Name wird nicht vorgeschlagen', !st.vorschlaege.some((v) => v.name === 'localhost'))
    const r = await anfrage({ pfad: '/api/tls/vorschlag', methode: 'POST', ca: ca.json.pem, body: { name: '192.168.178.55', aufnehmen: true }, kopf: { cookie } })
    check('Vorschlag bestätigt → eigener Name', r.status === 200 && r.json.namen.eigene.includes('192.168.178.55') && !r.json.vorschlaege.length)
    const v2 = await verbinde(ca.json.pem, { servername: 'localhost' })
    check('neue Verbindung: IP im Zertifikat', v2.zert.checkIP('192.168.178.55') === '192.168.178.55')
    const falsch = await anfrage({ pfad: '/api/tls/namen', methode: 'PUT', ca: ca.json.pem, body: { namen: ['ok.local', '*.evil'] }, kopf: { cookie } })
    check('ungültiger Name → 400', falsch.status === 400 && /\*\.evil/.test(falsch.json?.error || ''), JSON.stringify(falsch.json))
    const weg = await anfrage({ pfad: '/api/tls/namen', methode: 'PUT', ca: ca.json.pem, body: { namen: ['nas.fritz.box'] }, kopf: { cookie } })
    check('Namen ersetzt: alter fällt raus, neuer drin', weg.status === 200 && weg.json.server.namen.includes('nas.fritz.box') && !weg.json.server.namen.includes('192.168.178.55'), JSON.stringify(weg.json?.server?.namen))
    await anfrage({ pfad: '/api/tls/ca', ca: ca.json.pem, kopf: { host: `10.1.2.3:${port}` } })
    await new Promise((f) => setTimeout(f, 100))
    const ab = await anfrage({ pfad: '/api/tls/vorschlag', methode: 'POST', ca: ca.json.pem, body: { name: '10.1.2.3', aufnehmen: false }, kopf: { cookie } })
    check('Vorschlag verworfen → abgelehnt, nicht im Zertifikat', ab.json.abgelehnt.includes('10.1.2.3') && !ab.json.server.namen.includes('10.1.2.3'))
}

console.log('\nZwei Prozesse an derselben DB\n')
{
    // Ein anderer Prozess hat erneuert (Stand +1): dieser übernimmt es beim nächsten Prüfen.
    const z = await getKnex()('tls_zertifikat').where('id', 1).first()
    const { erzeugeServerZertifikat } = await import('./zertifikat.js')
    const { decrypt } = await import('../crypto.js')
    const fremdesZert = erzeugeServerZertifikat({ caPem: z.caPem, caSchluessel: decrypt(z.caSchluessel), namen: ['localhost', '127.0.0.1', '::1', 'autarktrade.local', '192.168.178.100', 'nas.fritz.box', 'anderer.local'] })
    await getKnex()('tls_zertifikat').where('id', 1).update({ serverPem: fremdesZert.pem, serverSchluessel: encrypt(fremdesZert.schluessel), stand: Number(z.stand) + 1 })
    const p = await dienst.pruefeUndErneuere()
    const v = await verbinde(ca.json.pem, { servername: 'localhost' })
    check('Zertifikat des anderen Prozesses übernommen, nicht überschrieben', !p.erneuert && v.zert.checkHost('anderer.local') === 'anderer.local', JSON.stringify(p))

    // Gleichzeitiges Anlegen: genau eine CA.
    await getKnex()('tls_zertifikat').del()
    await Promise.all([dienst.pruefeUndErneuere(), dienst.pruefeUndErneuere(), dienst.pruefeUndErneuere()])
    const zeilen = await getKnex()('tls_zertifikat')
    const st = (await anfrage({ pfad: '/api/tls/status', ca: zeilen[0].caPem, kopf: { cookie } })).json
    check('drei gleichzeitige Starts → genau eine CA', zeilen.length === 1 && st.ca.sha256 === fingerabdruck(zeilen[0].caPem), String(zeilen.length))
}

console.log('\nNeue CA\n')
{
    const alt = (await anfrage({ ueber: 'http', pfad: '/api/tls/ca' })).json
    const ohne = await anfrage({ ueber: 'http', pfad: '/api/tls/ca-neu', methode: 'POST', body: {}, kopf: { cookie } })
    check('ohne Bestätigung: 400', ohne.status === 400)
    const r = await anfrage({ ueber: 'http', pfad: '/api/tls/ca-neu', methode: 'POST', body: { bestaetigt: true }, kopf: { cookie } })
    check('mit Bestätigung: neue CA', r.status === 200 && r.json.ca.sha256 !== alt.sha256)
    const neu = (await anfrage({ ueber: 'http', pfad: '/api/tls/ca' })).json
    check('alte CA als Anker: scheitert', (await verbinde(alt.pem, { servername: 'localhost' })).ok === false)
    check('neue CA als Anker: vertraut', (await verbinde(neu.pem, { servername: 'localhost' })).ok === true)
}

console.log('\nBackup\n')
{
    const { baueExport } = await import('../backup-api.js')
    const exp = await baueExport()
    const text = JSON.stringify(exp)
    check('Export ohne tls_zertifikat', !('tls_zertifikat' in exp.tables))
    check('Export ohne privaten Schlüssel (weder Klartext noch Geheimtext)', !/PRIVATE KEY/.test(text) && !text.includes((await getKnex()('tls_zertifikat').first()).caSchluessel))
}

console.log('\nESP32: Anzeige-Schlüssel (SEC-GER-001)\n')
{
    const HAUPT = 'h'.repeat(64)
    const ANZEIGE = 'a'.repeat(64)
    await getKnex()('settings').where('id', 1).update({ esp32ApiKey: encrypt(HAUPT), esp32AnzeigeKey: encrypt(ANZEIGE) })
    _esp32BremseLeeren()
    const mit = (k) => ({ 'x-esp32-key': k })
    const dA = await anfrage({ ueber: 'http', pfad: '/api/esp32/display', kopf: mit(ANZEIGE) })
    check('display mit Anzeige-Schlüssel: offen', dA.status === 200, String(dA.status))
    const dH = await anfrage({ ueber: 'http', pfad: '/api/esp32/display', kopf: mit(HAUPT) })
    check('display mit Hauptschlüssel: offen (rückwärtskompatibel)', dH.status === 200, String(dH.status))
    const aA = await anfrage({ ueber: 'http', pfad: '/api/esp32/alarme?seit=0', kopf: mit(ANZEIGE) })
    check('alarme mit Anzeige-Schlüssel: 401', aA.status === 401, String(aA.status))
    const aH = await anfrage({ ueber: 'http', pfad: '/api/esp32/alarme?seit=0', kopf: mit(HAUPT) })
    check('alarme mit Hauptschlüssel: 200', aH.status === 200, String(aH.status))
    const pA = await anfrage({ ueber: 'http', pfad: '/api/esp32/push', methode: 'POST', body: { endpoint: 'https://ntfy.example/x' }, kopf: mit(ANZEIGE) })
    check('push mit Anzeige-Schlüssel: 401', pA.status === 401, String(pA.status))
    const dP = await anfrage({ ueber: 'http', pfad: '/api/esp32/push', methode: 'DELETE', body: { endpoint: 'https://ntfy.example/x' }, kopf: mit(ANZEIGE) })
    check('push abmelden mit Anzeige-Schlüssel: 401', dP.status === 401, String(dP.status))
    check('esp32AnzeigeKey ist ein verschlüsseltes Geheimnis', ALLE_VERSCHLUESSELTEN.find(([t]) => t === 'settings')[1].includes('esp32AnzeigeKey'))
    _esp32BremseLeeren()
}

dienst.stopTlsTakt()
tlsServer.close()
httpServer.close()
console.log(`\n${fehlgeschlagen === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
process.exit(fehlgeschlagen === 0 ? 0 : 1)
