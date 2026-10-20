/**
 * Selbsttest Korrektur F2 „Sicherheit" — die Angriffe aus Audit A2
 * (docs/audit/2026-10-19/A2-sicherheit.md), die eine Datenbank brauchen.
 *
 *   node server/__selftest-f2-sicherheit.mjs
 *
 * Wegwerf-SQLite (`AT_DB_FILE=:memory:`), echter HTTP-Server auf einem freien
 * Port, ein Lauscher auf 127.0.0.1 für „wohin gehen die Schlüssel". Jeder
 * Block nennt im Kommentar, was VOR F2 geschah — die Gegenprobe ist, diese
 * Datei gegen den Stand vor F2 laufen zu lassen: dann schlagen genau diese
 * Prüfungen an.
 */

process.env.AT_DB_FILE = ':memory:'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import nodeCrypto from 'node:crypto'
if (!process.env.AT_SECRET_FILE) process.env.AT_SECRET_FILE = path.join(os.tmpdir(), `at-f2-selftest-${process.pid}`)
delete process.env.AT_SECRET
delete process.env.CTJ_SECRET

const { initDb, getKnex } = await import('./database.js')
const { setupApiRoutes, SETTINGS_SENSITIVE_FIELDS } = await import('./api-routes.js')
const { setupBackupRoutes } = await import('./backup-api.js')
const { setupOllamaRoutes } = await import('./ollama-api.js')
const { setupBenachrichtigungsRoutes } = await import('./benachrichtigungen.js')
const { setupHypeRadarRoutes } = await import('./hype-radar-api.js')
const { encrypt, decrypt, isEncrypted, migriereAltSchluessel, maskKey } = await import('./crypto.js')
const { ALLE_VERSCHLUESSELTEN, GEHEIME_SETTINGS, VERDAECHTIG } = await import('./geheimnisse.js')
const { getConfigPath } = await import('./db-config.js')
const express = (await import('express')).default
const http = await import('node:http')

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

await initDb()
const knex = getKnex()

const app = express()
app.use(express.json({ limit: '5mb' }))
setupApiRoutes(app)
setupBackupRoutes(app)
setupOllamaRoutes(app)
setupBenachrichtigungsRoutes(app)
setupHypeRadarRoutes(app)
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const basis = `http://127.0.0.1:${server.address().port}`
const api = async (methode, pfad, body) => {
    const r = await fetch(basis + pfad, {
        method: methode, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await r.json() } catch { /* leer */ }
    return { status: r.status, json }
}

// Lauscher: zeichnet jede Anfrage samt Authorization auf.
const mitschnitt = []
const lauscher = http.createServer((q, a) => { mitschnitt.push(`${q.method} ${q.url} ${q.headers.authorization || ''}`); a.writeHead(200, { 'content-type': 'application/json' }); a.end('{"data":[]}') })
await new Promise((r) => lauscher.listen(0, '127.0.0.1', r))
const LAUSCHER = `http://127.0.0.1:${lauscher.address().port}`

console.log('\nA2-07: Geheimnis-Spalten in der Redaktionsliste\n')
{
    const spalten = Object.keys(await knex('settings').columnInfo())
    const verdaechtig = spalten.filter((s) => VERDAECHTIG.test(s))
    // Zähl-, Budget- und Schalterfelder sind keine Geheimnisse.
    const KEIN_GEHEIMNIS = /TokenBudget|VideoTokens|MaxTokens|Tokens$/i
    const fehlen = verdaechtig.filter((s) => !KEIN_GEHEIMNIS.test(s) && !GEHEIME_SETTINGS.includes(s))
    // Vor F2: aiKeyOpenrouter, aiKeyMoonshot, aiKeyZai, aiKeyMinimax, hypeKey*, hypeAlarm* fehlten.
    check('jede Spalte mit Geheimnis-Namen steht in der Liste', fehlen.length === 0, fehlen.join(', '))
    check('Redaktion = abgeleitete Liste', GEHEIME_SETTINGS.every((f) => SETTINGS_SENSITIVE_FIELDS.includes(f)))

    await knex('settings').where('id', 1).update({
        hypeAlarmTelegramToken: encrypt('123456:TELEGRAM-GEHEIM'),
        aiKeyOpenrouter: encrypt('sk-or-GEHEIM'),
        hypeKeySolanaRpc: encrypt('https://rpc.example/?api-key=GEHEIM'),
    })
    const r = await api('GET', '/api/db/settings')
    const text = JSON.stringify(r.json)
    check('GET /api/db/settings enthält keinen dieser Werte (auch keinen Geheimtext)',
        !('hypeAlarmTelegramToken' in r.json) && !('aiKeyOpenrouter' in r.json) && !('hypeKeySolanaRpc' in r.json)
        && !/[0-9a-f]{32}:[0-9a-f]{32}:/.test(text), text.slice(0, 200))
    check('… zeigt aber, dass sie gesetzt sind', r.json.hypeAlarmTelegramTokenSet === true && r.json.aiKeyOpenrouterSet === true)

    // Polygon-/Databento-Schlüssel in `apis`
    await api('PUT', '/api/db/settings', { apis: [{ provider: 'polygon', key: 'POLY-KLAR' }] })
    const roh = await knex('settings').where('id', 1).first()
    check('apis-Schlüssel liegt verschlüsselt in der DB', !String(roh.apis).includes('POLY-KLAR') && /"key":"[0-9a-f]{32}:/.test(roh.apis), roh.apis)
    const g = await api('GET', '/api/db/settings')
    check('… und kommt in der Sitzung entschlüsselt zurück (der Browser braucht ihn)', g.json.apis?.[0]?.key === 'POLY-KLAR')
    const exp = await api('GET', '/api/db-export')
    const expText = JSON.stringify(exp.json)
    check('Backup-Export enthält weder apis-Schlüssel noch Geheimtexte',
        !expText.includes('POLY-KLAR') && !expText.includes(roh.apis) && !/"key":"[0-9a-f]{32}:/.test(expText))
}

console.log('\nA2-24/A2-05c: KI-Adressen und -Schlüssel über die generische Route\n')
{
    await api('PUT', '/api/db/settings', { aiDeepseekUrl: 'http://angreifer.example/v1', aiCustomUrl: 'http://angreifer.example/v1', aiOllamaUrl: 'http://10.evil.example', aiKeyOpenrouter: 'sk-or-KLARTEXT-123' })
    const z = await knex('settings').where('id', 1).first()
    // Vor F2: aiDeepseekUrl/aiCustomUrl gesetzt, aiKeyOpenrouter im Klartext gespeichert.
    check('aiDeepseekUrl/aiCustomUrl nicht setzbar', z.aiDeepseekUrl !== 'http://angreifer.example/v1' && z.aiCustomUrl !== 'http://angreifer.example/v1')
    check('aiOllamaUrl nicht setzbar', z.aiOllamaUrl !== 'http://10.evil.example')
    check('aiKeyOpenrouter nicht im Klartext setzbar', decrypt(z.aiKeyOpenrouter) === 'sk-or-GEHEIM')
}

console.log('\nA2-05a/b: gespeicherter Schlüssel an fremde Adresse\n')
{
    await api('POST', '/api/ai/settings', { aiProvider: 'openai', aiModel: 'gpt-x', keys: { openai: 'sk-ECHTER-OPENAI-SCHLUESSEL-42' } })
    mitschnitt.length = 0
    const t = await api('POST', '/api/ai/test', { provider: 'openai', apiKey: '••••', basisUrl: `${LAUSCHER}/v1` })
    // Vor F2: Mitschnitt „GET /v1/models Bearer sk-ECHTER-…".
    check('/api/ai/test schickt den gespeicherten Schlüssel nicht an basisUrl', !mitschnitt.some((m) => m.includes('sk-ECHTER')), mitschnitt.join(' | '))
    check('… und sagt warum', t.json?.success === false && /gespeicherte Adresse/.test(t.json?.message || ''), JSON.stringify(t.json))
    mitschnitt.length = 0
    await api('GET', `/api/ai/status?customUrl=${encodeURIComponent(LAUSCHER + '/st')}`)
    // Vor F2: „GET /st/models Bearer sk-ECHTER-…".
    check('/api/ai/status?customUrl= geht nicht an die fremde Adresse', !mitschnitt.some((m) => m.includes('sk-ECHTER') || m.startsWith('GET /st')), mitschnitt.join(' | '))
    mitschnitt.length = 0
    await api('POST', '/api/ai/test', { provider: 'openai', apiKey: 'sk-NEU-EINGEGEBEN', basisUrl: `${LAUSCHER}/v1` })
    check('mit frisch eingegebenem Schlüssel bleibt der Test einer neuen Adresse möglich', mitschnitt.some((m) => m.includes('sk-NEU-EINGEGEBEN')), mitschnitt.join(' | '))
}

console.log('\nA2-05c: Adresswechsel ohne neuen Schlüssel\n')
{
    await api('POST', '/api/ai/settings', { aiProvider: 'custom', aiCustomUrl: 'https://8.8.8.8/v1', keys: { custom: 'sk-EIGEN-GEHEIM' } })
    let z = await knex('settings').where('id', 1).first()
    check('Schlüssel des eigenen Anbieters gespeichert', decrypt(z.aiKeyCustom) === 'sk-EIGEN-GEHEIM')
    const r = await api('POST', '/api/ai/settings', { aiProvider: 'custom', aiCustomUrl: 'https://1.1.1.1/v1', keys: { custom: '••••' } })
    z = await knex('settings').where('id', 1).first()
    // Vor F2: der Schlüssel blieb, der nächste Chat schickte ihn an die neue Adresse.
    check('neue Adresse ohne neuen Schlüssel → Schlüssel geleert', !z.aiKeyCustom && r.json?.schluesselGeleert?.includes('aiKeyCustom'), JSON.stringify(r.json))
    await api('POST', '/api/ai/settings', { aiProvider: 'custom', aiCustomUrl: 'https://1.1.1.1/v1', keys: { custom: 'sk-EIGEN-NEU' } })
    await api('POST', '/api/ai/settings', { aiProvider: 'custom', aiCustomUrl: 'https://1.1.1.1/v1', aiTemperature: 0.3, keys: { custom: '••••' } })
    z = await knex('settings').where('id', 1).first()
    check('gleiche Adresse: Schlüssel bleibt', decrypt(z.aiKeyCustom) === 'sk-EIGEN-NEU')
}

console.log('\nA2-05e/A2-29: SMTP-Passwort und Ziel\n')
{
    let r = await api('POST', '/api/mail/settings', { mailHost: '192.168.178.20', mailPort: 587, mailSicherheit: 'starttls', mailUser: 'ich', mailPasswort: 'SMTP-GEHEIM' })
    check('Mail-Zugang speicherbar', r.status === 200, JSON.stringify(r.json))
    r = await api('POST', '/api/mail/settings', { mailHost: '192.168.178.99', mailPort: 587, mailSicherheit: 'starttls', mailUser: 'ich', mailPasswort: '••••' })
    const z = await knex('settings').where('id', 1).first()
    check('Host geändert ohne neues Passwort → Passwort geleert', !z.mailPasswort && r.json?.passwortGeleert === true, JSON.stringify(r.json))
    r = await api('POST', '/api/mail/settings', { mailHost: '8.8.8.8', mailPort: 25, mailSicherheit: 'keine', mailUser: 'ich', mailPasswort: 'KLARTEXT-AUTH' })
    check('Klartext-AUTH an einen Server ausserhalb des eigenen Netzes → 400', r.status === 400, JSON.stringify(r.json))
    r = await api('POST', '/api/mail/settings', { mailHost: '2852039166', mailPort: 25, mailSicherheit: 'starttls' })
    // Vor F2: 200 — `2852039166` ist 169.254.169.254.
    check('Zahlen-Host auf die Metadaten-Adresse → 400', r.status === 400, JSON.stringify(r.json))
}

console.log('\nA2-05d: ntfy-Token und -Adresse\n')
{
    await api('PUT', '/api/hype-radar/einstellungen', { alarmKanaele: { ntfy: { an: true, url: 'https://ntfy.sh', topic: 't' } }, schluessel: { ntfyToken: 'tk_NTFY_GEHEIM' } })
    let z = await knex('settings').where('id', 1).first()
    check('ntfy-Token gespeichert', decrypt(z.hypeAlarmNtfyToken) === 'tk_NTFY_GEHEIM')
    await api('PUT', '/api/hype-radar/einstellungen', { alarmKanaele: { ntfy: { an: true, url: 'https://ntfy.angreifer.example', topic: 't' } }, schluessel: { ntfyToken: '••••' } })
    z = await knex('settings').where('id', 1).first()
    // Vor F2: Token blieb und ging als Bearer an die neue Adresse.
    check('neue ntfy-Adresse ohne neues Token → Token geleert', !z.hypeAlarmNtfyToken)
}

console.log('\nA2-05f/A2-13: DB-Verbindungstest\n')
{
    for (const host of ['10.attacker.example', '192.168.attacker.net', '172.16.x.nip.io']) {
        const r = await api('POST', '/api/db-config/test', { host, port: 5432, user: 'x', database: 'y' })
        // Vor F2: Präfixvergleich liess diese Namen durch.
        check(`DB-Test „${host}" abgewiesen`, r.status === 400, JSON.stringify(r.json))
    }
    const { isAllowedOllamaUrl } = await import('./ollama-url.js')
    check('Ollama „http://10.evil.example.com:11434" abgewiesen', isAllowedOllamaUrl('http://10.evil.example.com:11434') === false)
    check('Ollama „http://192.168.178.50:11434" bleibt erlaubt', isAllowedOllamaUrl('http://192.168.178.50:11434') === true)
    check('Ollama „http://localhost:11434" bleibt erlaubt', isAllowedOllamaUrl('http://localhost:11434') === true)
    const { pruefeKiEndpunkt } = await import('./ollama-url.js')
    let abgelehnt = false
    try { await pruefeKiEndpunkt('http://[::ffff:169.254.169.254]/v1') } catch { abgelehnt = true }
    check('KI-Endpunkt [::ffff:169.254.169.254] abgewiesen', abgelehnt)
}

console.log('\nA2-06/A2-09/A2-25: Backup-Import\n')
{
    await knex('settings').where('id', 1).update({
        authEnabled: 1, authPasswordHash: 'salz:hash', sessionGeneration: 3, lizenzSchluessel: 'AT1.x.y',
        hypeAlarmWebhookUrl: encrypt('https://ha.local/api/webhook/eigen'),
        aiCustomUrl: 'https://1.1.1.1/v1', mailHost: '192.168.178.20',
    })
    if (await knex.schema.hasTable('bitunix_config')) {
        await knex('bitunix_config').del()
        await knex('bitunix_config').insert({ apiKey: encrypt('ECHT-BITUNIX'), secretKey: encrypt('ECHT-SECRET') })
    }
    const exp = (await api('GET', '/api/db-export')).json
    const fremd = JSON.parse(JSON.stringify(exp))
    fremd.tables.settings[0] = {
        ...fremd.tables.settings[0], id: 2, authEnabled: 0, authPasswordHash: 'x:y',
        hypeAlarmWebhookUrl: 'https://angreifer.example/abgriff', aiCustomUrl: 'https://angreifer.example/v1',
        mailHost: 'smtp.angreifer.example', rechtlichesZustimmung: '{}', quellenOhneFreigabe: 0,
    }
    fremd.tables.bitunix_config = [{ id: 1, apiKey: 'ANGREIFERKEY', secretKey: '[REDACTED]' }]
    const dbPfad = getConfigPath()
    const dbVorher = fs.existsSync(dbPfad) ? fs.readFileSync(dbPfad, 'utf8') : null
    fremd.dbConfig = { type: 'postgresql', host: 'angreifer.example', port: 5432, user: 'u', password: '[REDACTED]', database: 'd' }
    const r = await api('POST', '/api/db-import', { ...fremd, confirmDbConfigOverwrite: true })
    check('Import läuft', r.status === 200 && r.json?.ok, JSON.stringify(r.json).slice(0, 200))
    const zeilen = await knex('settings').select('*')
    const z = zeilen[0]
    // Vor F2: Zeile mit id 2, Gate/Lizenz/Generation nach Neustart weg.
    check('settings bleibt EINE Zeile mit id 1', zeilen.length === 1 && z.id === 1, zeilen.map((x) => x.id).join(','))
    check('Gate, Hash, Lizenz und Generation bleiben', z.authEnabled === 1 && z.authPasswordHash === 'salz:hash' && z.lizenzSchluessel === 'AT1.x.y' && Number(z.sessionGeneration) === 3)
    // Vor F2: hypeAlarmWebhookUrl = angreifer, Bitunix apiKey = ANGREIFERKEY.
    check('Webhook-Adresse bleibt die eigene', decrypt(z.hypeAlarmWebhookUrl) === 'https://ha.local/api/webhook/eigen')
    check('KI-Adresse und SMTP-Server kommen nicht aus dem Backup', z.aiCustomUrl === 'https://1.1.1.1/v1' && z.mailHost === '192.168.178.20')
    if (await knex.schema.hasTable('bitunix_config')) {
        const b = await knex('bitunix_config').first()
        check('Börsenschlüssel bleibt der eigene', decrypt(b.apiKey) === 'ECHT-BITUNIX' && decrypt(b.secretKey) === 'ECHT-SECRET')
    }
    const dbNachher = fs.existsSync(dbPfad) ? fs.readFileSync(dbPfad, 'utf8') : null
    // Vor F2: db-config.json mit host angreifer.example geschrieben.
    check('db-config.json mit fremdem Host nicht geschrieben', dbNachher === dbVorher && String(r.json?.imported?.['db-config.json']).includes('übersprungen'), String(r.json?.imported?.['db-config.json']))
    if (dbNachher !== dbVorher) { if (dbVorher === null) fs.rmSync(dbPfad, { force: true }); else fs.writeFileSync(dbPfad, dbVorher) }
}

console.log('\nA2-08/A2-09: Schlüssel-Migration ohne AT_SECRET\n')
{
    const seed = `tradenote-${os.hostname()}-${os.userInfo().username}-v1`
    const altKey = nodeCrypto.createHash('sha256').update(seed).digest()
    const mitAlt = (text) => {
        const iv = nodeCrypto.randomBytes(16)
        const c = nodeCrypto.createCipheriv('aes-256-gcm', altKey, iv)
        const d = c.update(text, 'utf8', 'hex') + c.final('hex')
        return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${d}`
    }
    const leseMitAlt = (w) => { try { const [i, t, d] = w.split(':'); const x = nodeCrypto.createDecipheriv('aes-256-gcm', altKey, Buffer.from(i, 'hex')); x.setAuthTag(Buffer.from(t, 'hex')); return x.update(d, 'hex', 'utf8') + x.final('utf8') } catch { return null } }
    check('Secret-Datei angelegt (nicht der Maschinen-Seed)', fs.existsSync(process.env.AT_SECRET_FILE)
        && (fs.statSync(process.env.AT_SECRET_FILE).mode & 0o077) === 0)
    await knex('settings').where('id', 1).update({
        aiKeyAnthropic: mitAlt('sk-ant-ALT'), aiKeyMistral: 'KLARTEXT-MISTRAL', aiKeyXai: '[REDACTED]',
    })
    check('alter Maschinen-Wert bleibt lesbar (kein Datenverlust)', decrypt(mitAlt('x-alt')) === 'x-alt')
    const zaehler = await migriereAltSchluessel(knex, ALLE_VERSCHLUESSELTEN)
    const z = await knex('settings').where('id', 1).first()
    check('umgeschlüsselt: nur noch mit der Secret-Datei lesbar', decrypt(z.aiKeyAnthropic) === 'sk-ant-ALT' && leseMitAlt(z.aiKeyAnthropic) === null, JSON.stringify(zaehler))
    check('Klartext wird verschlüsselt', isEncrypted(z.aiKeyMistral) && decrypt(z.aiKeyMistral) === 'KLARTEXT-MISTRAL')
    check('[REDACTED] wird geleert', z.aiKeyXai === '')
    const zweimal = await migriereAltSchluessel(knex, ALLE_VERSCHLUESSELTEN)
    check('zweiter Lauf ändert nichts', zweimal.umgeschluesselt + zweimal.verschluesselt + zweimal.geleert === 0, JSON.stringify(zweimal))

    // Mit AT_SECRET (Docker): keine Datei, keine Änderung am Schlüssel.
    const { execFileSync } = await import('node:child_process')
    const probeDatei = path.join(os.tmpdir(), `at-f2-probe-${process.pid}`)
    fs.rmSync(probeDatei, { force: true })
    const aus = execFileSync(process.execPath, ['--input-type=module', '-e',
        `const c = await import(${JSON.stringify(new URL('./crypto.js', import.meta.url).href)}); const e = c.encrypt('x'); process.stdout.write(String(c.hauptGeheimnis()) + '|' + c.decrypt(e))`],
    { env: { ...process.env, AT_SECRET: 'docker-secret-1234567890', AT_SECRET_FILE: probeDatei, NODE_ENV: 'production' } }).toString()
    check('mit AT_SECRET: keine Secret-Datei, Secret aus der Umgebung', !fs.existsSync(probeDatei) && aus === 'docker-secret-1234567890|x', aus)
    // Mit AT_SECRET: ein mit sha(AT_SECRET) verschlüsselter Wert bleibt lesbar (Börsenschlüssel der NAS).
    const k = nodeCrypto.createHash('sha256').update('docker-secret-1234567890').digest()
    const iv = nodeCrypto.randomBytes(16)
    const c = nodeCrypto.createCipheriv('aes-256-gcm', k, iv)
    const enc = `${iv.toString('hex')}:` + (() => { const d = c.update('BOERSE', 'utf8', 'hex') + c.final('hex'); return `${c.getAuthTag().toString('hex')}:${d}` })()
    const aus2 = execFileSync(process.execPath, ['--input-type=module', '-e',
        `const c = await import(${JSON.stringify(new URL('./crypto.js', import.meta.url).href)}); process.stdout.write(c.decrypt(${JSON.stringify(enc)}))`],
    { env: { ...process.env, AT_SECRET: 'docker-secret-1234567890', AT_SECRET_FILE: probeDatei, NODE_ENV: 'production' } }).toString()
    check('mit AT_SECRET: bestehende Börsenschlüssel bleiben lesbar', aus2 === 'BOERSE', aus2)
}

console.log('\nA2-34: Masken\n')
{
    const m = maskKey(encrypt('sk-ABCDEFGHIJKLMNOP1234'))
    check('Maske zeigt nur die letzten 4', m.endsWith('1234') && !m.includes('sk-A') && m.includes('•'), m)
}

server.close()
lauscher.close()
try { fs.rmSync(process.env.AT_SECRET_FILE, { force: true }) } catch { /* egal */ }
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
process.exit(0)
