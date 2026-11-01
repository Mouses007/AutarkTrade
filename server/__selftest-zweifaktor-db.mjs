/**
 * Selbsttest zweiter Faktor — die Login-Abläufe mit Datenbank.
 *
 *   node server/__selftest-zweifaktor-db.mjs
 *
 * Wegwerf-SQLite (`AT_DB_FILE=:memory:`), echter HTTP-Server auf einem
 * freien Port mit derselben Middleware-Kette wie `index.mjs` (Host-Schutz,
 * Herkunft, Sitzungspflicht). Muster: `__selftest-f2-sicherheit.mjs`.
 *
 * Geprüft wird, was den zweiten Faktor zu einem macht:
 * - Passwort bei aktivem App-Code ergibt KEIN Sitzungs-Cookie, nur das Halb-Cookie;
 * - Halb-Cookie plus richtiger Code ergibt die Sitzung, derselbe Code kein zweites Mal;
 * - das Einschalten entwertet alte Cookies;
 * - die Sperre nach Fehlversuchen greift auch beim Code, und kontoweit über
 *   alle Adressen (Audit 4.3.4 SEC-S1-003);
 * - „Anmelden nur mit dem YubiKey" ist ab Werk aus und braucht zum Einschalten
 *   das Passwort (Audit 4.3.4 SEC-S1-002);
 * - Reset, Deaktivieren und AT_RESET_AUTH löschen App-Code und Schlüssel.
 */
process.env.AT_DB_FILE = ':memory:'
import os from 'node:os'
import path from 'node:path'
if (!process.env.AT_SECRET_FILE) process.env.AT_SECRET_FILE = path.join(os.tmpdir(), `at-zweifaktor-selftest-${process.pid}`)
delete process.env.AT_SECRET
delete process.env.CTJ_SECRET
delete process.env.AT_RESET_AUTH
delete process.env.AT_ALLOW_INSECURE

const { initDb, getKnex } = await import('./database.js')
const auth = await import('./auth.js')
const { decrypt } = await import('./crypto.js')
const { geheimnisBytes, totpCode, totpSchritt } = await import('./zweifaktor.js')
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
auth.setzeBindungsModus(true)
await auth.loadAuthConfig()

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(auth.hostGuardMiddleware)
app.use('/api', auth.herkunftMiddleware)
app.use('/api', auth.apiAuthMiddleware)
auth.setupAuthRoutes(app)
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const basis = `http://127.0.0.1:${server.address().port}`

/** Cookie-Wert aus den Set-Cookie-Zeilen (undefined = nicht gesetzt, '' = gelöscht). */
function keks(antwort, name) {
    for (const z of antwort.headers.getSetCookie()) {
        const [paar] = z.split(';')
        const [n, ...w] = paar.split('=')
        if (n.trim() === name) return w.join('=')
    }
    return undefined
}

async function api(methode, pfad, body, { cookie = '', kopf = {} } = {}) {
    const r = await fetch(basis + pfad, {
        method: methode,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...kopf },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await r.json() } catch { /* leer */ }
    return { status: r.status, json, r }
}

const PW = 'richtiges-passwort-123'
const geschuetzt = async (cookie) => (await api('POST', '/api/auth/totp/einrichten', {}, { cookie })).status !== 401

console.log('\nEinrichten\n')
let sitzung
let geheimnis
{
    let r = await api('POST', '/api/auth/totp/einrichten', {})
    check('ohne Gate und ohne Sitzung: kein Einrichten', r.status === 401 || r.status === 409, String(r.status))
    r = await api('POST', '/api/auth/set-password', { newPassword: PW })
    sitzung = `at_session=${keks(r.r, 'at_session')}`
    check('Passwort gesetzt (lokal, ohne Code)', r.status === 200 && !!keks(r.r, 'at_session'), String(r.status))
    const st = (await api('GET', '/api/auth/status')).json
    check('Status: noch kein zweiter Faktor', st.zweiFaktor?.totp === false && st.zweiFaktor?.schluessel === false, JSON.stringify(st.zweiFaktor))

    r = await api('POST', '/api/auth/totp/einrichten', {}, { cookie: sitzung })
    geheimnis = r.json?.geheimnis
    check('Einrichten liefert Geheimnis und otpauth-Adresse', r.status === 200 && /^[A-Z2-7]{32}$/.test(geheimnis || '') && r.json.uri?.startsWith('otpauth://totp/'), JSON.stringify(r.json))
    const z = await knex('settings').where('id', 1).first()
    check('Geheimnis liegt verschlüsselt, noch nicht aktiv', z.totpGeheimnis !== geheimnis && decrypt(z.totpGeheimnis) === geheimnis && !z.totpAn)
    check('ohne Bestätigung verlangt der Login keinen Code',
        (await api('POST', '/api/login', { password: PW })).json?.ok === true)

    const jetzt = totpSchritt()
    r = await api('POST', '/api/auth/totp/bestaetigen', { code: totpCode(geheimnisBytes(geheimnis), jetzt), currentPassword: 'falsch' }, { cookie: sitzung })
    check('Bestätigen mit falschem Passwort → 401', r.status === 401, String(r.status))
    r = await api('POST', '/api/auth/totp/bestaetigen', { code: '000000', currentPassword: PW }, { cookie: sitzung })
    check('Bestätigen mit falschem Code → 400', r.status === 400 || (r.status === 200 && totpCode(geheimnisBytes(geheimnis), jetzt) === '000000'), String(r.status))
    r = await api('POST', '/api/auth/totp/bestaetigen', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt()), currentPassword: PW }, { cookie: sitzung })
    const neu = `at_session=${keks(r.r, 'at_session')}`
    check('Bestätigen mit richtigem Code → aktiv, neues Cookie', r.status === 200 && !!keks(r.r, 'at_session') && neu !== sitzung, String(r.status))
    check('das alte Cookie gilt nicht mehr', !(await geschuetzt(sitzung)))
    check('das neue gilt', await geschuetzt(neu))
    sitzung = neu
    r = await api('POST', '/api/auth/totp/einrichten', {}, { cookie: sitzung })
    check('aktives Geheimnis wird nicht stillschweigend ersetzt → 409', r.status === 409, String(r.status))
    const st2 = (await api('GET', '/api/auth/status')).json
    check('Status meldet App-Code aktiv', st2.zweiFaktor?.totp === true)
}

console.log('\nAnmelden mit App-Code\n')
let halb
{
    auth._zaehlerLeeren()
    let r = await api('POST', '/api/login', { password: PW })
    halb = `at_zweit=${keks(r.r, 'at_zweit')}`
    check('Passwort allein ergibt KEIN Sitzungs-Cookie', keks(r.r, 'at_session') === undefined && r.json?.ok === false, JSON.stringify(r.json))
    check('… sondern das Halb-Cookie und die Liste der Faktoren', !!keks(r.r, 'at_zweit') && r.json?.zweiterFaktor?.includes('totp'))
    const roh = r.r.headers.getSetCookie().join(' | ')
    check('Halb-Cookie: httpOnly, nur unter /api/login, 5 Minuten', /HttpOnly/.test(roh) && /Path=\/api\/login;/.test(roh) && /Max-Age=300;/.test(roh), roh)
    check('Halb-Cookie öffnet keine geschützte Route', !(await geschuetzt(halb)))

    const naechster = totpCode(geheimnisBytes(geheimnis), totpSchritt() + 1)   // der beim Bestätigen benutzte ist verbraucht
    r = await api('POST', '/api/login/totp', { code: naechster })
    check('Code ohne Halb-Cookie → 401', r.status === 401 && r.json?.neuAnmelden === true, String(r.status))
    r = await api('POST', '/api/login/totp', { code: naechster }, { cookie: 'at_zweit=' + 'x'.repeat(40) })
    check('Code mit gefälschtem Halb-Cookie → 401', r.status === 401)
    r = await fetch(basis + '/api/login/totp', { method: 'POST', headers: { 'content-type': 'text/plain', cookie: halb }, body: naechster })
    check('ohne JSON → 415', r.status === 415, String(r.status))
    r = await api('POST', '/api/login/totp', { code: naechster }, { cookie: halb })
    const s = keks(r.r, 'at_session')
    check('Halb-Cookie + richtiger Code → Sitzung', r.status === 200 && !!s && await geschuetzt(`at_session=${s}`), String(r.status))
    check('… und das Halb-Cookie wird gelöscht', keks(r.r, 'at_zweit') === '')
    r = await api('POST', '/api/login/totp', { code: naechster }, { cookie: halb })
    check('derselbe Code ein zweites Mal → 401', r.status === 401, String(r.status))
    r = await api('POST', '/api/login', { password: PW, remember: false })
    const kurz = `at_zweit=${keks(r.r, 'at_zweit')}`
    r = await api('POST', '/api/login/totp', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt() - 1) }, { cookie: kurz })
    check('alter Code nach einem neueren → 401', r.status === 401, String(r.status))
}

/** Kontoweite Code-Bremse zurücksetzen (sonst zählen die Fehlversuche früherer Abschnitte mit). */
const codeBremseLeeren = () => knex('settings').where('id', 1).update({ totpFehlZahl: 0, totpFehlAb: 0, totpSperreBis: 0 })

console.log('\nSperre nach Fehlversuchen beim Code\n')
{
    auth._zaehlerLeeren()
    await codeBremseLeeren()
    // Echte Zeit: der nächste unbenutzte Schritt liegt nach dem verbrauchten.
    await knex('settings').where('id', 1).update({ totpLetzterSchritt: 0 })
    const r0 = await api('POST', '/api/login', { password: PW })
    const h = `at_zweit=${keks(r0.r, 'at_zweit')}`
    const stati = []
    for (let i = 0; i < 6; i++) stati.push((await api('POST', '/api/login/totp', { code: String(100000 + i) }, { cookie: h })).status)
    check('nach 5 falschen Codes 429', stati[5] === 429, stati.join(' '))
    const r = await api('POST', '/api/login/totp', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt()) }, { cookie: h })
    check('… auch der richtige Code bleibt gesperrt', r.status === 429 && !keks(r.r, 'at_session'), String(r.status))
    auth._zaehlerLeeren()
    await codeBremseLeeren()
    // Das Passwort setzt den Zähler des Codes nicht zurück.
    for (let i = 0; i < 4; i++) await api('POST', '/api/login/totp', { code: String(200000 + i) }, { cookie: h })
    await api('POST', '/api/login', { password: PW })
    await api('POST', '/api/login/totp', { code: '299999' }, { cookie: h })   // fünfter → Sperre
    const nach = await api('POST', '/api/login/totp', { code: '299998' }, { cookie: h })
    check('richtiges Passwort löscht die Code-Fehlversuche nicht', nach.status === 429, String(nach.status))
    auth._zaehlerLeeren()
}

console.log('\nKontoweite Bremse beim Code (viele Adressen)\n')
{
    /*
     * Ein Angreifer mit Passwort rät von vielen Adressen je wenige Codes. Hier
     * nachgestellt mit `_zaehlerLeeren()` vor jedem Versuch: Zähler je Adresse
     * und globale Bremse sind dann leer, wie bei einer frischen Adresse.
     */
    auth._zaehlerLeeren()
    await codeBremseLeeren()
    await knex('settings').where('id', 1).update({ totpLetzterSchritt: 0 })
    const r0 = await api('POST', '/api/login', { password: PW })
    const h = `at_zweit=${keks(r0.r, 'at_zweit')}`
    const gueltig = new Set([-1, 0, 1].map((d) => totpCode(geheimnisBytes(geheimnis), totpSchritt() + d)))
    const falsch = []
    for (let c = 300000; falsch.length < 10; c++) if (!gueltig.has(String(c))) falsch.push(String(c))
    const stati = []
    for (const c of falsch) {
        auth._zaehlerLeeren()
        stati.push((await api('POST', '/api/login/totp', { code: c }, { cookie: h })).status)
    }
    check('zehn falsche Codes von „zehn Adressen" werden noch geprüft', stati.every((x) => x === 401), stati.join(' '))
    auth._zaehlerLeeren()
    let r = await api('POST', '/api/login/totp', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt()) }, { cookie: h })
    check('danach ist der Code-Schritt kontoweit gesperrt, auch für den richtigen Code', r.status === 429 && r.json?.codeGesperrt === true && !keks(r.r, 'at_session'), `${r.status} ${JSON.stringify(r.json)}`)
    const z = await knex('settings').where('id', 1).first()
    check('Sperre liegt in der Datenbank (gilt für alle Prozesse), etwa 15 Minuten', Number(z.totpSperreBis) > Date.now() + 14 * 60 * 1000)
    // Neun falsche Codes ohne Sperre, dann ein richtiger: Zähler zurück.
    await codeBremseLeeren()
    for (const c of falsch.slice(0, 9)) { auth._zaehlerLeeren(); await api('POST', '/api/login/totp', { code: c }, { cookie: h }) }
    auth._zaehlerLeeren()
    r = await api('POST', '/api/login/totp', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt()) }, { cookie: h })
    check('unter der Schwelle geht der richtige Code durch', r.status === 200 && !!keks(r.r, 'at_session'), `${r.status} ${JSON.stringify(r.json)}`)
    check('… und setzt den Zähler zurück', Number((await knex('settings').where('id', 1).first()).totpFehlZahl) === 0)
    auth._zaehlerLeeren()
}

/*
 * YubiKey über die Routen, mit dem Software-Authenticator. Der Host-Kopf
 * entscheidet über RP-ID und Origin; fetch setzt ihn nicht um, deshalb
 * http.request (wie in `__selftest-auth.mjs`).
 */
const http = await import('node:http')
const { SoftwareSchluessel } = await import('./__webauthn-attrappe.mjs')
const port = server.address().port
const LH = `localhost:${port}`
const ORIGIN = `http://${LH}`
function anfrage(methode, pfad, body, { cookie = '', host = LH, kopf = {} } = {}) {
    return new Promise((ok, nein) => {
        const daten = body === undefined ? null : Buffer.from(JSON.stringify(body))
        const q = http.request({ host: '127.0.0.1', port, path: pfad, method: methode, headers: {
            host, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(daten ? { 'content-length': daten.length } : {}), ...kopf,
        } }, (a) => {
            let text = ''
            a.on('data', (c) => { text += c })
            a.on('end', () => {
                let json = null
                try { json = JSON.parse(text) } catch { /* leer */ }
                const setze = [].concat(a.headers['set-cookie'] || [])
                const keks2 = (name) => { for (const z of setze) { const [p] = z.split(';'); const [n, ...w] = p.split('='); if (n.trim() === name) return w.join('=') } return undefined }
                ok({ status: a.statusCode, json, keks: keks2 })
            })
        })
        q.on('error', nein)
        if (daten) q.write(daten)
        q.end()
    })
}

console.log('\nYubiKey: Registrieren\n')
const sw = new SoftwareSchluessel()
{
    auth._zaehlerLeeren()
    let st = (await anfrage('GET', '/api/auth/status')).json
    check('Status unter localhost: Kontext ok, noch kein Schlüssel-Login', st.schluesselKontext === 'ok' && st.schluesselLogin === false, JSON.stringify(st))
    st = (await anfrage('GET', '/api/auth/status', undefined, { host: `192.168.1.5:${port}` })).json
    check('Status über die IP: Kontext „ip"', st.schluesselKontext === 'ip', JSON.stringify(st))
    let r = await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {}, { host: `192.168.1.5:${port}`, cookie: sitzung })
    check('Registrieren über die IP → 409 mit Grund', r.status === 409 && r.json?.grund === 'ip', String(r.status))
    r = await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {})
    check('Registrieren ohne Sitzung → 401', r.status === 401)
    r = await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {}, { cookie: sitzung })
    check('Registrier-Optionen unter localhost', r.status === 200 && r.json?.optionen?.rp?.id === 'localhost', JSON.stringify(r.json).slice(0, 120))
    const antwort = sw.registriere(r.json.optionen, ORIGIN)
    r = await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort, name: 'YubiKey 5C', currentPassword: 'falsch' }, { cookie: sitzung })
    check('Registrieren mit falschem Passwort → 401', r.status === 401, String(r.status))
    auth._zaehlerLeeren()
    r = await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort, name: 'YubiKey 5C', currentPassword: PW }, { cookie: sitzung })
    check('Registrieren → 200', r.status === 200 && r.json?.ok, JSON.stringify(r.json))
    const z = await knex('auth_schluessel').first()
    check('Schlüssel gespeichert (Kennung, COSE-Schlüssel, RP-ID localhost)', z?.credentialId === sw.kennung && z.rpId === 'localhost' && z.publicKey.length > 40 && z.name === 'YubiKey 5C')
    r = await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort, name: 'nochmal', currentPassword: PW }, { cookie: sitzung })
    check('dieselbe Registrier-Antwort ein zweites Mal → abgewiesen', r.status === 400 && r.json?.grund === 'verbraucht', JSON.stringify(r.json))
    const fremd = new SoftwareSchluessel().registriere((await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {}, { cookie: sitzung })).json.optionen, 'http://evil.example')
    r = await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort: fremd, currentPassword: PW }, { cookie: sitzung })
    check('Registrierung mit fremder Origin → abgewiesen', r.status === 400, String(r.status))
    const liste = await anfrage('GET', '/api/auth/schluessel', undefined, { cookie: sitzung })
    check('Liste ohne Schlüsseldaten', liste.status === 200 && liste.json.schluessel.length === 1 && !JSON.stringify(liste.json).includes(sw.kennung)
        && !('publicKey' in liste.json.schluessel[0]) && liste.json.schluessel[0].hier === true, JSON.stringify(liste.json))
    st = (await anfrage('GET', '/api/auth/status')).json
    check('Status: Schlüssel als zweiter Faktor, Direkt-Login ab Werk aus', st.schluesselLogin === false && st.zweiFaktor.schluessel === true, JSON.stringify(st))
}

console.log('\nYubiKey: Hinweis-Adresse folgt dem Host-Schutz (FUN-S1-004)\n')
{
    const alt = { m: process.env.AT_MDNS_NAME, h: process.env.AT_ALLOWED_HOSTS }
    delete process.env.AT_MDNS_NAME
    delete process.env.AT_ALLOWED_HOSTS
    const IP = `192.168.1.5:${port}`
    const adresse = async (kopf = {}, host = IP) => (await anfrage('GET', '/api/auth/status', undefined, { host, kopf })).json?.schluesselAdresse
    check('ohne AT_MDNS_NAME und AT_ALLOWED_HOSTS: keine Adresse (autarktrade.local bekäme 421)', (await adresse()) == null, String(await adresse()))
    check('Gegenprobe: autarktrade.local wird ohne AT_MDNS_NAME tatsächlich abgewiesen', (await anfrage('GET', '/api/auth/status', undefined, { host: 'autarktrade.local:8443' })).status === 421)
    process.env.AT_MDNS_NAME = 'autarktrade.local'
    const a1 = await adresse()
    check('mit AT_MDNS_NAME: https://autarktrade.local mit dem HTTPS-Port', /^https:\/\/autarktrade\.local(:\d+)?$/.test(a1 || ''), String(a1))
    check('… und dieser Name kommt durch den Host-Schutz', (await anfrage('GET', '/api/auth/status', undefined, { host: 'autarktrade.local:8443' })).status === 200)
    check('über HTTPS aufgerufen: Port aus dem Host-Kopf (Mapping des Containers)',
        (await adresse({ 'x-forwarded-proto': 'https' }, '192.168.1.5:9443')) === 'https://autarktrade.local:9443')
    process.env.AT_MDNS_NAME = 'aus'
    process.env.AT_ALLOWED_HOSTS = '192.168.1.9, nas.fritz.box'
    const a2 = await adresse()
    check('AT_MDNS_NAME=aus, Name in AT_ALLOWED_HOSTS: dieser Name (keine IP)', /^https:\/\/nas\.fritz\.box(:\d+)?$/.test(a2 || ''), String(a2))
    for (const [k, v] of [['AT_MDNS_NAME', alt.m], ['AT_ALLOWED_HOSTS', alt.h]]) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
}

console.log('\nYubiKey: Schalter „Anmelden nur mit dem YubiKey"\n')
{
    auth._zaehlerLeeren()
    let r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    check('ausgeschaltet: Direkt-Optionen → 409 direktAus', r.status === 409 && r.json?.grund === 'direktAus', JSON.stringify(r.json))
    check('Liste meldet den Schalter aus', (await anfrage('GET', '/api/auth/schluessel', undefined, { cookie: sitzung })).json?.direkt === false)
    r = await anfrage('POST', '/api/auth/schluessel/direkt', { an: true })
    check('Einschalten ohne Sitzung → 401', r.status === 401, String(r.status))
    r = await anfrage('POST', '/api/auth/schluessel/direkt', { an: true, currentPassword: 'falsch' }, { cookie: sitzung })
    check('Einschalten mit falschem Passwort → 401', r.status === 401, String(r.status))
    auth._zaehlerLeeren()
    r = await anfrage('POST', '/api/auth/schluessel/direkt', { an: true, currentPassword: PW }, { cookie: sitzung })
    check('Einschalten mit Passwort → an', r.status === 200 && r.json?.direkt === true, JSON.stringify(r.json))
    let st = (await anfrage('GET', '/api/auth/status')).json
    check('Status unter localhost: Schlüssel-Login möglich', st.schluesselLogin === true && st.zweiFaktor.schluessel === true)
    st = (await anfrage('GET', '/api/auth/status', undefined, { host: `192.168.1.5:${port}` })).json
    check('… über die IP nicht', st.schluesselLogin === false)
    // Eine Challenge, die vor dem Ausschalten ausgestellt wurde, gilt danach nicht mehr.
    const vorher = (await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })).json.optionen
    r = await anfrage('POST', '/api/auth/schluessel/direkt', { an: false }, { cookie: sitzung })
    check('Ausschalten ohne Passwort → aus', r.status === 200 && r.json?.direkt === false, JSON.stringify(r.json))
    // Ein unbeteiligter Schlüssel genügt: der Schalter wird vor allem anderen geprüft (und der Zähler von `sw` bleibt unberührt).
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: new SoftwareSchluessel().melde(vorher, ORIGIN) })
    check('ausgeschaltet: Antwort auf eine alte Direkt-Challenge → keine Sitzung', r.status === 409 && !r.keks('at_session') && r.json?.grund === 'direktAus', JSON.stringify(r.json))
    r = await anfrage('POST', '/api/auth/schluessel/direkt', { an: true, currentPassword: PW }, { cookie: sitzung })
    check('wieder eingeschaltet', r.json?.direkt === true)
    auth._zaehlerLeeren()
}

console.log('\nYubiKey: Anmelden\n')
{
    auth._zaehlerLeeren()
    // Direkt, ohne Passwort (Schalter an)
    let r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    check('Login-Optionen: alle Schlüssel in allowCredentials', r.status === 200 && r.json.optionen.allowCredentials?.[0]?.id === sw.kennung, JSON.stringify(r.json).slice(0, 150))
    const opt1 = r.json.optionen
    const a1 = sw.melde(opt1, ORIGIN)
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: a1 })
    const s = r.keks('at_session')
    check('Direkt-Login per Antippen → Sitzung', r.status === 200 && !!s && await geschuetzt(`at_session=${s}`), JSON.stringify(r.json))
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: a1 })
    check('dieselbe Antwort ein zweites Mal → 401', r.status === 401 && !r.keks('at_session'), JSON.stringify(r.json))
    const zSign = await knex('auth_schluessel').first()
    check('Zähler nachgeführt, zuletzt benutzt gesetzt', Number(zSign.signCount) === 1 && Number(zSign.zuletztAm) > 0)

    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: sw.melde(r.json.optionen, ORIGIN, { zaehler: 1 }) })
    check('sinkender bzw. gleicher Zähler → 401', r.status === 401 && !r.keks('at_session'), JSON.stringify(r.json))
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: sw.melde(r.json.optionen, 'http://evil.example', { zaehler: 10 }) })
    check('falsche Origin → 401', r.status === 401, String(r.status))
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' }, { host: `192.168.1.5:${port}` })
    check('Login-Optionen über die IP → 409', r.status === 409 && r.json?.grund === 'ip')
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    const fremd = new SoftwareSchluessel()
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: fremd.melde(r.json.optionen, ORIGIN) })
    check('nicht registrierter Schlüssel → 401', r.status === 401 && r.json?.grund === 'unbekannt')
    auth._zaehlerLeeren()

    // Als zweiter Faktor nach dem Passwort
    r = await anfrage('POST', '/api/login', { password: PW })
    const h = `at_zweit=${r.keks('at_zweit')}`
    check('Passwort unter localhost: beide Faktoren angeboten', r.json?.zweiterFaktor?.join() === 'totp,schluessel', JSON.stringify(r.json))
    const ip = await anfrage('POST', '/api/login', { password: PW }, { host: `192.168.1.5:${port}` })
    check('… über die IP nur der App-Code', ip.json?.zweiterFaktor?.join() === 'totp', JSON.stringify(ip.json))
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'zweit' })
    check('zweiter Schritt ohne Halb-Cookie → 401', r.status === 401)
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'zweit' }, { cookie: h })
    const az = sw.melde(r.json.optionen, ORIGIN, { zaehler: 20 })
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: az })
    check('Antwort zum zweiten Schritt ohne Halb-Cookie → 401', r.status === 401 && r.json?.neuAnmelden === true, JSON.stringify(r.json))
    r = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: az }, { cookie: h })
    check('Halb-Cookie + YubiKey → Sitzung', r.status === 200 && !!r.keks('at_session') && r.keks('at_zweit') === '', JSON.stringify(r.json))

    // Einmaligkeit unabhängig vom Zähler: ein Passkey, der immer 0 meldet.
    const null0 = new SoftwareSchluessel()
    const ro = await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {}, { cookie: sitzung })
    await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort: null0.registriere(ro.json.optionen, ORIGIN), name: 'ohne Zähler', currentPassword: PW }, { cookie: sitzung })
    r = await anfrage('POST', '/api/login/schluessel/optionen', { verwendung: 'direkt' })
    const n1 = null0.melde(r.json.optionen, ORIGIN, { zaehler: 0 })
    const erst = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: n1 })
    const wieder = await anfrage('POST', '/api/login/schluessel/pruefen', { antwort: n1 })
    check('Zähler 0: erste Antwort geht', erst.status === 200, JSON.stringify(erst.json))
    check('Zähler 0: wiederverwendete Challenge → 401 „verbraucht"', wieder.status === 401 && wieder.json?.grund === 'verbraucht', JSON.stringify(wieder.json))
    auth._zaehlerLeeren()
}

console.log('\nYubiKey: Verwalten, erster Schlüssel entwertet\n')
{
    const liste = (await anfrage('GET', '/api/auth/schluessel', undefined, { cookie: sitzung })).json.schluessel
    let r = await anfrage('PUT', `/api/auth/schluessel/${liste[0].id}`, { name: 'Haupt-YubiKey' }, { cookie: sitzung })
    check('Umbenennen', r.status === 200 && (await knex('auth_schluessel').where('id', liste[0].id).first()).name === 'Haupt-YubiKey')
    r = await anfrage('DELETE', `/api/auth/schluessel/${liste[1].id}`, { currentPassword: 'falsch' }, { cookie: sitzung })
    check('Entfernen mit falschem Passwort → 401', r.status === 401)
    auth._zaehlerLeeren()
    for (const s of liste) await anfrage('DELETE', `/api/auth/schluessel/${s.id}`, { currentPassword: PW }, { cookie: sitzung })
    check('Entfernen', Number((await knex('auth_schluessel').count({ n: '*' }).first()).n) === 0)
    r = await anfrage('POST', '/api/auth/totp/aus', { currentPassword: PW }, { cookie: sitzung })
    check('App-Code aus → Login wieder nur mit Passwort', r.status === 200 && (await anfrage('POST', '/api/login', { password: PW })).json?.ok === true)
    // Jetzt kein zweiter Faktor: der erste Schlüssel schaltet ihn ein und entwertet alte Cookies.
    const ro = await anfrage('POST', '/api/auth/schluessel/registrieren/optionen', {}, { cookie: sitzung })
    r = await anfrage('POST', '/api/auth/schluessel/registrieren', { antwort: new SoftwareSchluessel().registriere(ro.json.optionen, ORIGIN), currentPassword: PW }, { cookie: sitzung })
    const neu = `at_session=${r.keks('at_session')}`
    check('erster Schlüssel: Sitzungen entwertet, neues Cookie', r.json?.sitzungenEntwertet === true && !(await geschuetzt(sitzung)) && await geschuetzt(neu), JSON.stringify(r.json))
    sitzung = neu
    r = await anfrage('POST', '/api/login', { password: PW })
    check('… und das Passwort allein reicht nicht mehr', r.json?.ok === false && !r.keks('at_session') && r.json?.zweiterFaktor?.join() === 'schluessel')
    auth._zaehlerLeeren()
}

/** Zweiten Faktor (App-Code + ein Schlüssel) direkt in die DB legen. */
async function legeZweitenFaktorAn() {
    await knex('settings').where('id', 1).update({ totpAn: 1, totpGeheimnis: (await import('./crypto.js')).encrypt('JBSWY3DPEHPK3PXP'), totpLetzterSchritt: 5,
        totpFehlZahl: 3, totpFehlAb: Date.now(), totpSperreBis: Date.now() + 60000, schluesselDirekt: 1 })
    await knex('auth_schluessel').insert({ credentialId: 'AAAA' + Math.random().toString(36).slice(2), publicKey: 'pk', signCount: 3, rpId: 'localhost', name: 'Test', erstelltAm: Date.now() })
    await auth.loadAuthConfig()
}
async function zweiterFaktorWeg() {
    const z = await knex('settings').where('id', 1).first()
    const n = Number((await knex('auth_schluessel').count({ n: '*' }).first()).n)
    return !z.totpAn && !z.totpGeheimnis && !Number(z.totpLetzterSchritt) && n === 0
        && !Number(z.totpFehlZahl) && !Number(z.totpSperreBis) && !Number(z.schluesselDirekt)
}

console.log('\nRücksetzwege löschen den zweiten Faktor\n')
{
    // 1. Deaktivieren (lokal gebunden, also erlaubt)
    await legeZweitenFaktorAn()
    let r = await api('POST', '/api/auth/disable', { currentPassword: PW }, { cookie: sitzung })
    check('Deaktivieren → 200', r.status === 200, String(r.status))
    check('… App-Code und Schlüssel sind weg', await zweiterFaktorWeg())
    check('… und alte Sitzungen entwertet', !(await geschuetzt(sitzung)))
    const st = (await api('GET', '/api/auth/status')).json
    check('Status: kein Gate, kein zweiter Faktor', st.authEnabled === false && st.zweiFaktor?.totp === false && st.zweiFaktor?.schluessel === false)

    // 2. /api/auth/reset mit Code aus dem Log
    r = await api('POST', '/api/auth/set-password', { newPassword: PW })
    sitzung = `at_session=${keks(r.r, 'at_session')}`
    await legeZweitenFaktorAn()
    const warn = console.warn
    console.warn = () => {}
    await api('POST', '/api/auth/reset', {})
    const code = auth._ruecksetzCode()
    r = await api('POST', '/api/auth/reset', { code })
    console.warn = warn
    check('Reset mit Code → 200', r.status === 200, String(r.status))
    check('… App-Code und Schlüssel sind weg', await zweiterFaktorWeg())
    check('… und die alte Sitzung gilt nicht mehr', !(await geschuetzt(sitzung)))

    // 3. AT_RESET_AUTH beim Start
    r = await api('POST', '/api/auth/set-password', { newPassword: PW })
    await legeZweitenFaktorAn()
    const genVorher = Number((await knex('settings').where('id', 1).first()).sessionGeneration)
    process.env.AT_RESET_AUTH = '1'
    console.warn = () => {}
    await auth.maybeResetAuthFromEnv()
    console.warn = warn
    delete process.env.AT_RESET_AUTH
    await auth.loadAuthConfig()
    const z = await knex('settings').where('id', 1).first()
    check('AT_RESET_AUTH: Gate aus', !z.authEnabled && !z.authPasswordHash)
    check('AT_RESET_AUTH: App-Code und Schlüssel sind weg', await zweiterFaktorWeg())
    check('AT_RESET_AUTH: Sitzungs-Generation steigt', Number(z.sessionGeneration) === genVorher + 1, `${genVorher} → ${z.sessionGeneration}`)
}

server.close()
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
process.exit(0)
