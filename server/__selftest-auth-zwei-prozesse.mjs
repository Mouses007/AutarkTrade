/**
 * Selbsttest Anmeldung mit zwei Prozessen an EINER Datenbank (Audit 4.3.4 SEC-S1-001).
 *
 *   node server/__selftest-auth-zwei-prozesse.mjs
 *
 * NAS-Container und Entwicklungsrechner teilen sich eine Datenbank. Bis zum
 * Audit las jeder Prozess die Zugangsfelder nur beim Start und nach eigenen
 * Änderungen: schaltete A den App-Code ein, meldete B weiter allein mit dem
 * Passwort an, und alte Cookies galten in B bis zum Neustart.
 *
 * Aufbau: dieser Prozess (A) und ein Kindprozess (B, dieselbe Datei mit dem
 * Argument `kind`) öffnen dieselbe Wegwerf-SQLite mit derselben Secret-Datei
 * und lauschen je auf einem freien Port, mit derselben Middleware-Kette wie
 * `index.mjs`. Geprüft wird nach Ablauf der Nachladefrist (5 s):
 * - B verlangt den zweiten Faktor, den A eingeschaltet hat;
 * - alte Cookies sind in B tot, das neue aus A gilt dort;
 * - „Überall abmelden" in A wirkt in B;
 * - ein Datenbankfehler beim Nachladen öffnet das Gate nicht, und eine nicht
 *   gespeicherte Entwertung wird vom Nachladen nicht zurückgenommen.
 */
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KIND = process.argv[2] === 'kind'
const DIESE_DATEI = fileURLToPath(import.meta.url)

let ordner = process.env.AT_ZWEI_PROZESSE_ORDNER
if (!KIND) {
    ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'at-zwei-prozesse-'))
    process.env.AT_ZWEI_PROZESSE_ORDNER = ordner
}
process.env.AT_DB_FILE = path.join(ordner, 'test.db')
process.env.AT_SECRET_FILE = path.join(ordner, 'secret')
delete process.env.AT_SECRET
delete process.env.CTJ_SECRET
delete process.env.AT_RESET_AUTH
delete process.env.AT_ALLOW_INSECURE

const { initDb, getKnex } = await import('./database.js')
const auth = await import('./auth.js')
const express = (await import('express')).default

await initDb()
auth.setzeBindungsModus(true)
await auth.loadAuthConfig()

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(auth.hostGuardMiddleware)
app.use('/api', auth.herkunftMiddleware)
app.use('/api', auth.apiAuthMiddleware)
auth.setupAuthRoutes(app)
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })

if (KIND) {
    // Kind: Port melden und laufen, bis der Elternprozess die Leitung schliesst.
    process.stdout.write(`KIND-PORT ${server.address().port}\n`)
    process.stdin.on('end', () => process.exit(0))
    process.stdin.resume()
} else {
    await eltern()
}

async function eltern() {
    const { totpCode, totpSchritt, geheimnisBytes } = await import('./zweifaktor.js')
    const knex = getKnex()
    let bestanden = 0
    let fehlgeschlagen = 0
    const fehler = []
    function check(name, ok, detail) {
        if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
        else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
    }
    const warte = (ms) => new Promise((r) => setTimeout(r, ms))
    const FRIST = 5500   // Nachladefrist in auth.js (5 s) plus Rand

    function keks(antwort, name) {
        for (const z of antwort.headers.getSetCookie()) {
            const [paar] = z.split(';')
            const [n, ...w] = paar.split('=')
            if (n.trim() === name) return w.join('=')
        }
        return undefined
    }
    async function api(port, methode, pfad, body, cookie = '') {
        const r = await fetch(`http://127.0.0.1:${port}${pfad}`, {
            method: methode,
            headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        let json = null
        try { json = await r.json() } catch { /* leer */ }
        return { status: r.status, json, r }
    }
    // Geschützte Route ohne Nebenwirkung: 200 = Sitzung gilt.
    const drin = async (port, cookie) => (await api(port, 'GET', '/api/auth/schluessel', undefined, cookie)).status === 200

    const A = server.address().port
    const PW = 'richtiges-passwort-123'
    let kind = null
    try {
        console.log('\nZwei Prozesse, eine Datenbank\n')
        let r = await api(A, 'POST', '/api/auth/set-password', { newPassword: PW })
        const c0 = `at_session=${keks(r.r, 'at_session')}`
        check('A: Passwort gesetzt', r.status === 200 && !!keks(r.r, 'at_session'), String(r.status))

        kind = spawn(process.execPath, [DIESE_DATEI, 'kind'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env })
        const B = await new Promise((ok, nein) => {
            let puffer = ''
            kind.stdout.on('data', (d) => {
                // Vor der Zeile stehen die Meldungen von initDb.
                puffer += d
                const m = puffer.match(/^KIND-PORT (\d+)$/m)
                if (m) ok(Number(m[1]))
            })
            kind.on('exit', (code) => nein(new Error(`Kindprozess beendet (${code})`)))
            setTimeout(() => nein(new Error('Kindprozess meldet keinen Port')), 30000)
        })
        r = await api(B, 'POST', '/api/login', { password: PW })
        check('B vorher: Passwort allein meldet an', r.json?.ok === true && !!keks(r.r, 'at_session'), JSON.stringify(r.json))
        check('B vorher: Cookie aus A gilt', await drin(B, c0))

        // A schaltet den App-Code ein (entwertet alle Sitzungen, neues Cookie für A).
        r = await api(A, 'POST', '/api/auth/totp/einrichten', {}, c0)
        const geheimnis = r.json?.geheimnis
        r = await api(A, 'POST', '/api/auth/totp/bestaetigen', { code: totpCode(geheimnisBytes(geheimnis), totpSchritt()), currentPassword: PW }, c0)
        const c1 = `at_session=${keks(r.r, 'at_session')}`
        check('A: App-Code eingeschaltet, neues Cookie', r.status === 200 && !!keks(r.r, 'at_session'), JSON.stringify(r.json))

        await warte(FRIST)
        r = await api(B, 'POST', '/api/login', { password: PW })
        check('B nachher: Passwort allein ergibt KEINE Sitzung', r.json?.ok === false && keks(r.r, 'at_session') === undefined, JSON.stringify(r.json))
        check('B nachher: verlangt den App-Code', Array.isArray(r.json?.zweiterFaktor) && r.json.zweiterFaktor.includes('totp'), JSON.stringify(r.json))
        check('B nachher: altes Cookie tot', !(await drin(B, c0)))
        check('B nachher: neues Cookie aus A gilt', await drin(B, c1))
        const st = (await api(B, 'GET', '/api/auth/status')).json
        check('B nachher: Status meldet den App-Code', st?.zweiFaktor?.totp === true, JSON.stringify(st?.zweiFaktor))

        // „Überall abmelden" in A
        r = await api(A, 'POST', '/api/auth/ueberall-abmelden', {}, c1)
        check('A: überall abgemeldet', r.status === 200, String(r.status))
        await warte(FRIST)
        check('B: Cookie nach „Überall abmelden" in A tot', !(await drin(B, c1)))

        console.log('\nDatenbankfehler beim Nachladen\n')
        await knex('settings').where('id', 1).update({ totpAn: 1 })
        await auth.loadAuthConfig()
        const vorher = auth.zweiFaktorAktiv()
        const warn = console.warn
        console.warn = () => {}
        await knex.schema.renameTable('settings', 'settings_weg')
        try {
            await auth.loadAuthConfig()
            check('Gate bleibt an, wenn die Datenbank nicht antwortet', auth.isAuthEnabled() === true)
            check('… und der zweite Faktor auch', vorher === true && auth.zweiFaktorAktiv() === true)
        } finally {
            await knex.schema.renameTable('settings_weg', 'settings')
            console.warn = warn
        }
        /*
         * Gescheitertes Speichern einer Entwertung nachstellen: entwerten
         * (Generation steigt im Prozess und in der DB), dann die DB auf den
         * alten Wert zurücksetzen. Das Nachladen darf die alte Generation
         * nicht übernehmen — sonst lebte ein abgegriffenes Cookie wieder auf.
         */
        const { default: crypto } = await import('node:crypto')
        const { hauptGeheimnis } = await import('./crypto.js')
        const tokenFuer = (g) => crypto.createHmac('sha256', hauptGeheimnis()).update(g > 0 ? `tn_session_v1:${g}` : 'tn_session_v1').digest('hex')
        const genAlt = Number((await knex('settings').where('id', 1).first()).sessionGeneration)
        await auth.entwerteAlleSitzungen()
        const genNeu = Number((await knex('settings').where('id', 1).first()).sessionGeneration)
        check('Kontrolle: Entwerten speichert die Generation', genNeu === genAlt + 1, `${genAlt} → ${genNeu}`)
        check('Kontrolle: Cookie der neuen Generation gilt', await drin(A, `at_session=${tokenFuer(genNeu)}`))
        await knex('settings').where('id', 1).update({ sessionGeneration: genAlt })
        await auth.loadAuthConfig()
        check('Nachladen nimmt eine Entwertung nicht zurück (Cookie der alten Generation bleibt tot)',
            !(await drin(A, `at_session=${tokenFuer(genAlt)}`)))
        check('… das Cookie der neuen gilt weiter', await drin(A, `at_session=${tokenFuer(genNeu)}`))
        const genNachgeholt = Number((await knex('settings').where('id', 1).first()).sessionGeneration)
        check('… und das Speichern wird nachgeholt', genNachgeholt === genNeu, `${genNachgeholt} statt ${genNeu}`)
    } catch (e) {
        check('Ablauf ohne Ausnahme', false, e.stack || String(e))
    } finally {
        if (kind) { kind.stdin.end(); kind.kill('SIGTERM') }
        server.close()
        try { await getKnex().destroy() } catch { /* egal */ }
        try { fs.rmSync(ordner, { recursive: true, force: true }) } catch { /* egal */ }
    }

    console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
    if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
    process.exit(0)
}
