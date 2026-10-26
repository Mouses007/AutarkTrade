/**
 * Update API — prüft die private Paketquelle auf neue Fassungen und installiert sie.
 *
 * GET  /api/update/check    → lokale Fassung gegen das neueste Release vergleichen
 * POST /api/update/install  → git fetch + reset + npm install (bzw. docker pull) + Neustart
 *
 * Kanal: das Repo `Mouses007/AutarkTrade` (Releases und Quelltext) bzw. das Image
 * `ghcr.io/mouses007/autarktrade`. Seit 22.10.2026 steht AutarkTrade unter der
 * AGPL-3.0 — es gibt keinen Lizenzschlüssel und keine Update-Sperre mehr. Solange
 * das Repo privat ist, braucht die Abfrage `AT_UPDATE_TOKEN` (+ `AT_UPDATE_BENUTZER`);
 * ohne Token wird öffentlich gefragt, und ein 404 heisst dann „keinZugang", kein Fehler.
 */
import { execSync, spawn } from 'child_process'
import crypto from 'crypto'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { fileURLToPath } from 'url'
import { umgebung, umgebungAn, istTestbetrieb } from './umgebung.js'

/** Soll der Server beim Start selbst nach Updates fragen? (SEC-OPS-018) */
export function updateCheckBeimStart() {
    return !istTestbetrieb() && !umgebungAn('KEIN_UPDATECHECK')
}

/** Zugangsdaten zur Paketquelle aus der Umgebung; `null` ohne (dann öffentlich). Nie an die Oberfläche. */
function updateZugang() {
    const token = umgebung('UPDATE_TOKEN')
    return token ? { benutzer: umgebung('UPDATE_BENUTZER') || 'x-access-token', token } : null
}
import { macheFlach, FETCH_FLACH } from './update-flach.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Private Quelle. Das alte, öffentliche Repo (GPL, 3.x) ist bewusst KEIN Kanal mehr:
// gegen es würde die Prüfung 3.x als „neuer" melden und per git reset den alten Stand holen.
export const GITHUB_REPO = 'Mouses007/AutarkTrade'
export const GIT_URL = `https://github.com/${GITHUB_REPO}.git`
export const IMAGE = 'ghcr.io/mouses007/autarktrade'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const IS_WINDOWS = os.platform() === 'win32'
const IS_DOCKER = existsSync('/.dockerenv')
const DOCKER_SOCK = '/var/run/docker.sock'
const HAS_DOCKER_SOCK = IS_DOCKER && existsSync(DOCKER_SOCK)

/**
 * Minimal Docker Engine API client via Unix socket.
 * No dependency — just http over the docker socket.
 */
function dockerApi(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            socketPath: DOCKER_SOCK,
            method,
            path: apiPath,
            headers: { 'Host': 'docker' }
        }
        if (body !== undefined) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body)
            opts.headers['Content-Type'] = 'application/json'
            opts.headers['Content-Length'] = Buffer.byteLength(payload)
            const req = http.request(opts, (res) => {
                let data = ''
                res.on('data', c => data += c)
                res.on('end', () => {
                    if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${data}`))
                    try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({ raw: data }) }
                })
            })
            req.on('error', reject)
            req.write(payload)
            req.end()
            return
        }
        const req = http.request(opts, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${data}`))
                try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({ raw: data }) }
            })
        })
        req.on('error', reject)
        req.end()
    })
}

/**
 * Treat localhost-access as "non-Docker" even when the server runs in a container.
 * This restores direct git-based updates for developers who run the stack
 * locally (docker-compose on their own machine) while keeping the Watchtower
 * UI for remote access (e.g. NAS at 192.168.x.x).
 */
export function isLocalRequest(req) {
    // Nur die echte Peer-IP der TCP-Verbindung zählt. req.hostname stammt aus dem
    // client-kontrollierten Host-Header — ein LAN-Client könnte sonst
    // "Host: localhost" senden und den localhost-Schutz aushebeln (z.B. das
    // Passwort-Gate über /api/auth/reset ohne Anmeldung deaktivieren).
    const ip = String(req.socket?.remoteAddress || req.ip || '').replace('::ffff:', '')
    if (ip !== '127.0.0.1' && ip !== '::1') return false

    /*
     * Die Peer-IP allein reicht NICHT. Läuft ein Reverse-Proxy (nginx, Caddy,
     * Traefik, Synology-Portalweiterleitung) auf demselben Rechner und
     * verbindet über Loopback zur App, dann trägt JEDE Anfrage aus dem Internet
     * die Peer-IP 127.0.0.1. Damit gälte ein wildfremder Client als „lokal" —
     * und `/api/auth/reset` ist öffentlich erreichbar und schaltet das
     * Passwort-Gate ab. Anschliessend darf sich der Aufrufer als
     * „Ersteinrichtung" ein eigenes Passwort setzen und bekommt sofort das
     * Sitzungs-Cookie. Aus „nur von diesem Rechner" wird so „von überall".
     *
     * Ein echter Aufruf vom selben Rechner trägt keine Weiterleitungs-Header;
     * ein durchgereichter Aufruf trägt sie praktisch immer. Sind sie da, ist
     * die Verbindung nicht das, wofür sie sich ausgibt.
     *
     * Bewusst KEIN `trust proxy`: das würde der App erlauben, der vom Proxy
     * behaupteten Client-IP zu glauben. Für ein Einzelplatz-Journal ist die
     * strengere Antwort die richtige — im Zweifel nicht lokal.
     */
    const weiterleitungsHinweise = [
        'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
        'x-real-ip', 'forwarded', 'cf-connecting-ip',
    ]
    for (const kopf of weiterleitungsHinweise) {
        if (req.headers?.[kopf]) return false
    }
    /*
     * Und die Anfrage muss von der App selbst stammen, nicht von einer fremden
     * Seite im Browser des Nutzers (Audit A2-02, F2 20.10.2026). Ein
     * `fetch('http://127.0.0.1:8080/api/auth/reset', {method:'POST',
     * mode:'no-cors'})` von irgendeiner Webseite kommt mit Peer 127.0.0.1 und
     * ohne Weiterleitungs-Header an — bis F2 reichte das, um das Passwort-Gate
     * abzuschalten. Der Browser verrät die Herkunft in `Origin` und
     * `Sec-Fetch-Site`; curl und Skripte schicken beides nicht.
     */
    if (istFremdeHerkunft(req)) return false
    return true
}

/**
 * Stammt die Anfrage laut Browser von einer anderen Seite als dieser App?
 *
 * `Sec-Fetch-Site` setzen alle aktuellen Browser selbst (nicht per Skript
 * fälschbar); erlaubt sind nur `same-origin` und `none` (Adresszeile,
 * Lesezeichen). Fehlt der Kopf, entscheidet `Origin`: fehlt auch der, ist es
 * kein Browser-Aufruf über Seitengrenzen (curl, Skripte, ältere Browser bei
 * gleicher Herkunft); ist er da, muss sein Host samt Port gleich dem Host-Kopf
 * sein — oder einem der `weitereHosts` (seit dem Audit vom 26.10.2026: der
 * `X-Forwarded-Host` eines VERTRAUTEN Proxys, den `herkunftMiddleware` in
 * auth.js nur nach Prüfung der Peer-IP übergibt; `isLocalRequest` übergibt
 * nie welche). Der Standard-Port des Schemas zählt wie keiner
 * (`https://nas` = `nas:443`).
 *
 * @param {import('express').Request} req
 * @param {string[]} [weitereHosts]
 * @returns {boolean}
 */
export function istFremdeHerkunft(req, weitereHosts = []) {
    const h = req?.headers || {}
    const sfs = String(h['sec-fetch-site'] || '').toLowerCase()
    if (sfs && sfs !== 'same-origin' && sfs !== 'none') return true
    const origin = h.origin
    if (origin === undefined || origin === '') return false
    // `Origin: null` kommt aus Sandbox-Frames und file:-Seiten — nie die App.
    try {
        const o = new URL(String(origin))
        const norm = (host) => {
            try { return new URL(`${o.protocol}//${String(host || '').trim()}`).host.toLowerCase() } catch { return null }
        }
        const ziel = o.host.toLowerCase()
        return ![h.host, ...weitereHosts].some((x) => x && norm(x) === ziel)
    } catch {
        return true
    }
}
function effectiveIsDocker(req) {
    return IS_DOCKER && !isLocalRequest(req)
}

/**
 * Docker-Mode Install:
 * 1. Lese eigene Container-Config via Docker-Socket (hostname = Container-ID im Docker-Netzwerk)
 * 2. Extrahiere compose-Projekt-Label (working_dir auf dem Host) + Image-Name
 * 3. Pull neues Image via Docker API (blocking, damit wir erst danach antworten)
 * 4. Erstelle einen Helfer-Container (Image: docker:cli) der nach kurzer Wartezeit
 *    `docker compose -f <compose> up -d --force-recreate --no-deps journal` ausfuehrt
 * 5. Antworte dem Client, sterbe kurz danach — der Helfer ersetzt uns
 */
async function installDockerUpdate(res, zugang) {
    if (!HAS_DOCKER_SOCK) {
        return res.status(400).json({
            ok: false,
            error: 'Docker-Socket nicht verfuegbar (/var/run/docker.sock nicht gemountet). Fuege in docker-compose.yml im journal-Service hinzu:\n\n' +
                '  volumes:\n    - /var/run/docker.sock:/var/run/docker.sock\n\n' +
                'Oder update manuell: docker compose pull && docker compose up -d'
        })
    }

    const steps = []
    let selfName = process.env.HOSTNAME || 'autarktrade'

    // 1. Eigene Config lesen (hostname inside docker == container short-id)
    let self
    try {
        self = await dockerApi('GET', `/containers/${selfName}/json`)
    } catch (e) {
        // Fallback: try by known container_name from compose
        try {
            self = await dockerApi('GET', `/containers/autarktrade/json`)
            selfName = 'autarktrade'
        } catch (e2) {
            return res.status(500).json({ ok: false, error: 'Kann eigenen Container nicht identifizieren: ' + e.message })
        }
    }
    const imageName = self.Config?.Image || `${IMAGE}:latest`
    const labels = self.Config?.Labels || {}
    // HOST-Pfad bevorzugt aus AT_HOST_COMPOSE_DIR (.env) — der ist stabil.
    // Der compose-Label 'working_dir' wird von compose bei jedem Recreate
    // auf den CWD gesetzt und damit pollutet, wenn compose aus einem
    // Helfer-Container heraus laeuft. Env-Var aus .env bleibt unveraendert.
    const composeWorkingDir = umgebung('HOST_COMPOSE_DIR') || labels['com.docker.compose.project.working_dir']
    const composeService = labels['com.docker.compose.service']
    const composeProject = labels['com.docker.compose.project']

    if (!composeWorkingDir || !composeService) {
        return res.status(400).json({
            ok: false,
            error: 'Container wurde nicht mit docker-compose gestartet oder AT_HOST_COMPOSE_DIR fehlt in .env. Update manuell: docker pull ' + imageName + ' && docker compose up -d'
        })
    }
    steps.push({ step: 'self config', output: `image=${imageName} service=${composeService} project=${composeProject} cwd=${composeWorkingDir}` })

    // 2. Neues Image pullen (streaming response — wir lesen bis Ende)
    try {
        await new Promise((resolve, reject) => {
            const opts = {
                socketPath: DOCKER_SOCK,
                method: 'POST',
                path: `/images/create?fromImage=${encodeURIComponent(imageName)}`,
                headers: { 'Host': 'docker' }
            }
            // Private Registry: Anmeldung je Pull, nichts bleibt im Docker-Daemon gespeichert.
            if (zugang && imageName.startsWith('ghcr.io/')) {
                opts.headers['X-Registry-Auth'] = Buffer.from(JSON.stringify({
                    username: zugang.benutzer, password: zugang.token, serveraddress: 'ghcr.io'
                })).toString('base64url')
            }
            const req = http.request(opts, (pullRes) => {
                pullRes.on('data', () => {}) // verbrauchen
                pullRes.on('end', () => pullRes.statusCode < 400 ? resolve() : reject(new Error('Pull fehlgeschlagen: HTTP ' + pullRes.statusCode)))
            })
            req.on('error', reject)
            req.end()
        })
        steps.push({ step: 'docker pull', output: 'OK: ' + imageName })
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'docker pull fehlgeschlagen: ' + e.message })
    }

    // 3. Helfer-Container erstellen + starten
    // - docker:cli Image enthaelt `docker` CLI + compose-Plugin
    // - Socket gemountet; Host-Projekt-Dir wird an den IDENTISCHEN Pfad im
    //   Helfer gemountet. Damit sieht compose denselben Pfad wie auf dem
    //   Host und setzt die compose-Labels korrekt — verhindert die
    //   "/compose"-Label-Pollution die beim Pfad-Remapping auftritt.
    // - AutoRemove loescht den Helfer nach Abschluss
    // - Das Skript wartet 3s, damit unsere Response den Client erreicht
    const helperName = `autarktrade-updater-${Date.now()}`
    const helperConfig = {
        Image: 'docker:cli',
        Cmd: ['sh', '-c',
            `sleep 3 && cd "${composeWorkingDir}" && docker compose up -d --force-recreate --no-deps ${composeService}`
        ],
        Env: [
            `COMPOSE_PROJECT_NAME=${composeProject || ''}`
        ],
        HostConfig: {
            Binds: [
                `${DOCKER_SOCK}:${DOCKER_SOCK}`,
                `${composeWorkingDir}:${composeWorkingDir}`
            ],
            AutoRemove: true,
            NetworkMode: 'bridge'
        }
    }

    try {
        const created = await dockerApi('POST', `/containers/create?name=${helperName}`, helperConfig)
        await dockerApi('POST', `/containers/${created.Id}/start`)
        steps.push({ step: 'helper container', output: helperName + ' gestartet' })
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'Helfer-Container konnte nicht gestartet werden: ' + e.message })
    }

    // 4. Antworten — danach wird uns der Helfer in ~3s beenden und neu erstellen
    res.json({ ok: true, dockerMode: true, steps, newVersion: null, message: 'Update laeuft (Docker-Modus). Container wird in ~10 Sekunden neu erstellt.' })

    // Defensive: Cache leeren, damit naechster Check nicht wartet
    lastCheck = null
    lastCheckTime = 0
}

/**
 * Windows: Erstellt ein .bat-Script und startet es in einem neuen Fenster.
 * Nötig weil Windows native .node-Dateien sperrt solange der Server läuft.
 * Das Script wartet bis der Server beendet ist, dann: npm install + build + Neustart.
 */
function spawnWindowsUpdateScript(commands, label) {
    const scriptPath = path.join(PROJECT_ROOT, '_autarktrade_update.bat')
    const script = `@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   AutarkTrade - ${label}
echo ========================================
echo.
echo Warte auf Server-Beendigung...
timeout /t 4 /nobreak >nul
cd /d "${PROJECT_ROOT}"
${commands.map(cmd => `echo ^> ${cmd}\ncall ${cmd}\nif %errorlevel% neq 0 (\n    echo.\n    echo FEHLER bei: ${cmd}\n    echo Druecke eine Taste zum Schliessen...\n    pause >nul\n    exit /b 1\n)`).join('\n')}
echo.
echo ========================================
echo   ${label} erfolgreich!
echo   Server wird neu gestartet...
echo ========================================
echo.
node index.mjs
`
    writeFileSync(scriptPath, script, 'utf8')

    spawn('cmd.exe', ['/c', 'start', `"AutarkTrade ${label}"`, 'cmd.exe', '/k', scriptPath], {
        detached: true,
        stdio: 'ignore',
        cwd: PROJECT_ROOT
    }).unref()
}

// HTTPS GET mit JSON-Antwort. Der Token geht nur an api.github.com — eine
// Weiterleitung auf einen anderen Host bekommt ihn nicht mit.
function httpsGetJson(url, token) {
    return new Promise((resolve, reject) => {
        const headers = { 'User-Agent': 'AutarkTrade', 'Accept': 'application/vnd.github+json' }
        if (token && new URL(url).host === 'api.github.com') headers.Authorization = `Bearer ${token}`
        https.get(url, { headers, timeout: 15000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume()
                return httpsGetJson(new URL(res.headers.location, url).href, token).then(resolve).catch(reject)
            }
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                if (res.statusCode === 404) return reject(Object.assign(new Error('Not Found'), { status: 404 }))
                if (res.statusCode === 401 || res.statusCode === 403) {
                    return reject(Object.assign(new Error(`Zugang zur Paketquelle abgelehnt (HTTP ${res.statusCode})`), { status: res.statusCode }))
                }
                try { resolve(JSON.parse(data)) }
                catch (e) { reject(new Error('Invalid JSON: ' + data.substring(0, 200))) }
            })
        }).on('timeout', function () { this.destroy(new Error('Zeitüberschreitung')) }).on('error', reject)
    })
}

/**
 * Umgebung für git mit Anmeldung — über GIT_CONFIG_* statt `-c` auf der
 * Befehlszeile, damit der Token nicht in der Prozessliste steht, und ohne ihn in
 * `.git/config` zu schreiben.
 */
function gitUmgebung(zugang) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    if (!zugang) return env
    const basic = Buffer.from(`${zugang.benutzer}:${zugang.token}`).toString('base64')
    return {
        ...env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    }
}

/** Texte für die Gründe aus `updateErlaubt` — die Oberfläche zeigt sie, wie sie kommen. */
const GRUND_TEXT = {
    keinZugang: 'Die Paketquelle ist nicht erreichbar (privates Repo ohne AT_UPDATE_TOKEN).',
}

// Get local version from package.json. Cached: an update always ends in
// process.exit() (see installGitUpdate/installDockerUpdate below), so the
// version cannot change without a process restart — no need to re-read the
// file from disk on every call, which matters now that /api/setup/status
// (a public, unauthenticated endpoint) calls this on every request.
let localVersionCache = null
export function getLocalVersion() {
    if (localVersionCache === null) {
        const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
        localVersionCache = pkg.version
    }
    return localVersionCache
}

// Compare semver: returns 1 if a > b, -1 if a < b, 0 if equal
export function compareSemver(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number)
    const pb = b.replace(/^v/, '').split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1
        if ((pa[i] || 0) < (pb[i] || 0)) return -1
    }
    return 0
}

// Cache: last check result (avoid hammering GitHub)
let lastCheck = null
let lastCheckTime = 0
const CHECK_CACHE_MS = 5 * 60 * 1000 // 5 min cache

// Rollback: Commit-Hash vor dem Update
let preUpdateCommit = null

// Bestätigungs-Token für destruktive Update-Aktionen.
// Wird beim /check ausgegeben (kurzlebig) und von /install + /rollback verlangt.
// Verhindert „Drive-by"/CSRF-Auslösung des Updates über eine geklaute Session.
let confirmToken = null
let confirmTokenExpires = 0
const CONFIRM_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 min

function issueConfirmToken() {
    confirmToken = crypto.randomBytes(16).toString('hex')
    confirmTokenExpires = Date.now() + CONFIRM_TOKEN_TTL_MS
    return confirmToken
}

/**
 * Hartes Gate für destruktive Update-Routen:
 * 1. Request muss von localhost stammen.
 * 2. Gültiges, nicht abgelaufenes Bestätigungs-Token (aus /check) im Body.
 * Bei Verstoß wird direkt geantwortet und false zurückgegeben.
 */
function guardDestructiveUpdate(req, res) {
    if (!isLocalRequest(req)) {
        res.status(403).json({ ok: false, error: 'Update nur von localhost erlaubt. Bitte führe das Update direkt auf dem Server-Host aus.' })
        return false
    }
    const token = req.body && req.body.confirmToken
    if (!token || token !== confirmToken || Date.now() > confirmTokenExpires) {
        res.status(403).json({ ok: false, error: 'Ungültiges oder abgelaufenes Bestätigungs-Token. Bitte erst auf „Nach Updates suchen" klicken und dann bestätigen.' })
        return false
    }
    // Einmalverwendung: Token nach erfolgreicher Prüfung entwerten
    confirmToken = null
    confirmTokenExpires = 0
    return true
}

/**
 * Versionsstand ermitteln — ohne Express, damit auch der
 * Benachrichtigungs-Takt die Prüfung nutzen kann, statt die GitHub-Abfrage
 * ein zweites Mal zu schreiben.
 *
 * Der Zwischenspeicher ist derselbe wie für die Route: zwei Abfragen kurz
 * hintereinander sollen GitHub nicht doppelt belasten.
 *
 * @param {boolean} forceRefresh Zwischenspeicher übergehen
 */
export async function pruefeAufUpdate(forceRefresh = false) {
    const now = Date.now()
    if (!forceRefresh && lastCheck && (now - lastCheckTime) < CHECK_CACHE_MS) return lastCheck

    const localVersion = getLocalVersion()
    const zugang = updateZugang()
    const basis = {
        ok: true,
        localVersion,
        remoteVersion: localVersion,
        updateAvailable: false,
        releaseName: '',
        releaseNotes: '',
        releaseUrl: '',
        publishedAt: '',
        kanal: zugang ? 'token' : 'oeffentlich',
        berechtigt: true,
        grund: null,
    }
    try {
        const release = await httpsGetJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, zugang?.token)
        const remoteVersion = (release.tag_name || '').replace(/^v/, '') || localVersion
        lastCheck = {
            ...basis,
            remoteVersion,
            updateAvailable: compareSemver(remoteVersion, localVersion) > 0,
            releaseName: release.name || '',
            releaseNotes: release.body || '',
            releaseUrl: release.html_url || '',
            publishedAt: release.published_at || '',
        }
        lastCheckTime = now
        return lastCheck
    } catch (err) {
        // Noch kein Release — oder privates Repo ohne Token (GitHub antwortet dann 404): kein Fehler
        if (err.status === 404) {
            lastCheck = zugang ? basis : { ...basis, grund: 'keinZugang', grundText: GRUND_TEXT.keinZugang }
            lastCheckTime = Date.now()
            return lastCheck
        }
        throw err
    }
}

export function setupUpdateRoutes(app) {

    // ── Check for updates ──────────────────────────────────────────
    app.get('/api/update/check', async (req, res) => {
        try {
            const stand = await pruefeAufUpdate(req.query.force === '1')
            res.json({ ...stand, isDocker: effectiveIsDocker(req), confirmToken: issueConfirmToken() })
        } catch (err) {
            console.error('Update check failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Install update ─────────────────────────────────────────────
    app.post('/api/update/install', async (req, res) => {
        try {
            // Hartes Gate: localhost + gültiges Bestätigungs-Token
            if (!guardDestructiveUpdate(req, res)) return

            // Frisch prüfen, nicht aus dem Zwischenspeicher.
            const stand = await pruefeAufUpdate(true)
            if (!stand.updateAvailable) {
                return res.status(400).json({ ok: false, error: 'Kein neueres Release in der Paketquelle.' })
            }
            const zugang = updateZugang()

            // Docker-Modus: neues Image pullen und Container via Helfer neu erstellen
            if (IS_DOCKER) {
                return await installDockerUpdate(res, zugang)
            }

            // Pruefen ob Git-Repository vorhanden ist
            if (!existsSync(path.join(PROJECT_ROOT, '.git'))) {
                return res.status(400).json({
                    ok: false,
                    error: 'Git-Repository nicht gefunden. Bitte im Installationsordner einmal ./update.sh ' +
                        '(Windows: update.bat, macOS: update-mac.command) ausführen — es richtet die Paketquelle ein.'
                })
            }

            const steps = []

            // 0. Aktuellen Commit-Hash speichern (für Rollback)
            // HEAD kann fehlen wenn git init ohne Commits (frische Installation)
            try {
                preUpdateCommit = execSync('git rev-parse HEAD', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 5000
                }).trim()
                steps.push({ step: 'save rollback point', output: preUpdateCommit })
            } catch (e) {
                // Kein HEAD vorhanden — frische Installation ohne Commits
                preUpdateCommit = null
                steps.push({ step: 'save rollback point', output: 'Kein bisheriger Commit (frische Installation) — Rollback nicht verfügbar' })
            }

            // 1. git fetch + reset statt pull (funktioniert auch ohne HEAD/Commits).
            // Die URL steht hier fest statt `origin`: so zieht auch eine Installation,
            // deren origin noch auf das alte, öffentliche Repo zeigt, aus dem neuen Kanal.
            // `--depth 1` (Audit A3-28): beim Kunden landet nur der ausgelieferte Stand,
            // keine Historie; `macheFlach` unten schneidet einen alten, vollen Klon ab.
            const fetchOutput = execSync(`git fetch ${FETCH_FLACH.join(' ')} ${GIT_URL} master`, {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 60000,
                env: gitUmgebung(zugang)
            }).trim()
            steps.push({ step: 'git fetch', output: fetchOutput || 'OK' })

            const pullOutput = execSync('git reset --hard FETCH_HEAD', {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 60000
            }).trim()
            steps.push({ step: 'git reset', output: pullOutput })

            // Alte Historie entfernen, den Stand vor dem Update für den Rollback behalten.
            // Scheitert das, läuft das Update trotzdem weiter — der neue Stand ist da.
            try {
                const flach = macheFlach(PROJECT_ROOT, { rollback: preUpdateCommit })
                steps.push({ step: 'git flach', output: `${flach.commits} Commit(s) im Repo, ${flach.geloescht.length} Referenz(en) entfernt` })
            } catch (e) {
                steps.push({ step: 'git flach', output: 'übersprungen: ' + e.message })
            }

            // Read new version (from git reset — package.json ist schon aktuell)
            const newVersion = getLocalVersion()

            // Clear cache
            lastCheck = null
            lastCheckTime = 0

            if (IS_WINDOWS) {
                // Windows: native .node-Dateien sind gesperrt → externes Script
                steps.push({ step: 'npm install + build', output: 'Wird in neuem Fenster ausgeführt...' })
                spawnWindowsUpdateScript(['npm ci || npm install', 'npm run build'], 'Update')
                res.json({ ok: true, steps, newVersion })
                setTimeout(() => {
                    console.log('\n🔄 Update — Server wird beendet, externes Script übernimmt...')
                    process.exit(0)
                }, 1500)
            } else {
                // Linux/macOS: npm ci + build inline (keine Dateisperren).
                // `npm ci` statt `npm install` (Audit A2-26, F2): installiert
                // genau die Versionen aus package-lock.json samt Prüfsummen,
                // statt Semver-Bereichen zu folgen. Nur wenn das scheitert
                // (Lock passt nicht), fällt es auf `npm install` zurück —
                // ein halb gelöschtes node_modules wäre schlimmer.
                let npmOutput
                let npmSchritt = 'npm ci'
                try {
                    npmOutput = execSync('npm ci', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 300000 }).trim()
                } catch (e) {
                    npmSchritt = 'npm install (Rückfall, npm ci scheiterte)'
                    npmOutput = execSync('npm install', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 300000 }).trim()
                }
                steps.push({ step: npmSchritt, output: npmOutput })

                const buildOutput = execSync('npm run build', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm run build', output: buildOutput })

                res.json({ ok: true, steps, newVersion })

                setTimeout(() => {
                    console.log('\n🔄 Update installed — restarting server...')
                    process.exit(0)
                }, 1500)
            }

        } catch (err) {
            console.error('Update install failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Rollback to previous version ────────────────────────────────
    app.post('/api/update/rollback', async (req, res) => {
        // Hartes Gate: localhost + gültiges Bestätigungs-Token
        if (!guardDestructiveUpdate(req, res)) return

        // Pruefen ob Git-Repository vorhanden ist
        if (!existsSync(path.join(PROJECT_ROOT, '.git'))) {
            return res.status(400).json({
                ok: false,
                error: 'Git-Repository nicht gefunden. Rollback nicht moeglich.'
            })
        }
        if (!preUpdateCommit) {
            return res.status(400).json({ ok: false, error: 'Kein Rollback-Punkt vorhanden. Rollback ist nur nach einem Update möglich.' })
        }

        try {
            const steps = []

            // 1. Zurück zum gespeicherten Commit
            const checkoutOutput = execSync(`git checkout ${preUpdateCommit} -- .`, {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 30000
            }).trim()
            steps.push({ step: 'git checkout', output: checkoutOutput || 'OK' })

            const restoredVersion = getLocalVersion()
            preUpdateCommit = null // Rollback-Punkt verbraucht
            lastCheck = null
            lastCheckTime = 0

            /*
             * `npm ci` wie beim Update (Audit SEC-SRV-017): der zurückgeholte
             * Stand bringt sein eigenes package-lock.json mit, und genau diese
             * Versionen sollen es sein — `npm install` folgte Semver-Bereichen
             * und konnte beim Rollback neuere Pakete holen als der alte Stand
             * je hatte. Ohne Lockfile (sehr alter Stand) bleibt `npm install`.
             */
            const mitLock = existsSync(path.join(PROJECT_ROOT, 'package-lock.json'))
            if (IS_WINDOWS) {
                steps.push({ step: 'npm install + build', output: 'Wird in neuem Fenster ausgeführt...' })
                spawnWindowsUpdateScript([mitLock ? 'npm ci || npm install' : 'npm install', 'npm run build'], 'Rollback')
                res.json({ ok: true, steps, restoredVersion })
                setTimeout(() => {
                    console.log('\n🔄 Rollback — Server wird beendet, externes Script übernimmt...')
                    process.exit(0)
                }, 1500)
            } else {
                let npmOutput
                let npmSchritt = mitLock ? 'npm ci' : 'npm install'
                try {
                    npmOutput = execSync(npmSchritt, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 300000 }).trim()
                } catch (e) {
                    if (!mitLock) throw e
                    npmSchritt = 'npm install (Rückfall, npm ci scheiterte)'
                    npmOutput = execSync('npm install', { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 300000 }).trim()
                }
                steps.push({ step: npmSchritt, output: npmOutput })

                const buildOutput = execSync('npm run build', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm run build', output: buildOutput })

                res.json({ ok: true, steps, restoredVersion })

                setTimeout(() => {
                    console.log('\n🔄 Rollback durchgeführt — Server wird neu gestartet...')
                    process.exit(0)
                }, 1500)
            }

        } catch (err) {
            console.error('Rollback failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Rollback status ─────────────────────────────────────────────
    app.get('/api/update/rollback-status', (req, res) => {
        res.json({ available: !!preUpdateCommit, commit: preUpdateCommit || null })
    })

    // ── Startup check (non-blocking) ───────────────────────────────
    /*
     * Nicht im Testbetrieb und nicht mit AT_KEIN_UPDATECHECK=1 (Audit
     * SEC-OPS-018): die Prüfinstanz fragte beim Start von selbst GitHub nach
     * Releases — der einzige Netzabruf, den sie ohne Knopfdruck machte. Der
     * Knopf in den Einstellungen (`GET /api/update/check`) bleibt.
     */
    if (!updateCheckBeimStart()) {
        console.log(' -> Update-Prüfung beim Start ausgelassen (' + (istTestbetrieb() ? 'Testbetrieb' : 'AT_KEIN_UPDATECHECK=1') + ')')
        return
    }
    setTimeout(async () => {
        try {
            const stand = await pruefeAufUpdate(true)
            if (stand.grund === 'keinZugang') {
                console.log(' -> Update-Prüfung: Paketquelle nicht erreichbar (privates Repo ohne AT_UPDATE_TOKEN)')
            } else if (stand.updateAvailable) {
                console.log(`\n🆕 Update verfügbar: v${stand.localVersion} → v${stand.remoteVersion}`)
            } else {
                console.log(` -> Version v${stand.localVersion} ist aktuell`)
            }
        } catch (err) {
            console.log(' -> Update-Check fehlgeschlagen:', err.message)
        }
    }, 3000)
}
