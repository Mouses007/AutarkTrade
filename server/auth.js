/**
 * API authentication for single-user local app.
 *
 * Standardmodus (authEnabled=false): Wie bisher — der Server setzt beim Laden
 * der Seite ein httpOnly-Cookie mit einem Session-Token. Alle /api/*-Requests
 * brauchen dieses Cookie. Das schützt vor Zugriff anderer Geräte/Skripte, ist
 * aber KEIN Passwortschutz (für reinen Localhost-Betrieb gedacht).
 *
 * Optionales Passwort-Gate (authEnabled=true): Der Server stellt das Cookie
 * NICHT mehr automatisch aus. Der Nutzer muss sich per POST /api/login mit
 * Passwort anmelden. Gedacht für Betrieb hinter öffentlicher Bindung
 * (AT_HOST=0.0.0.0). Zusätzlich wird HTTPS via Reverse-Proxy empfohlen.
 *
 * Das Token überlebt einen Neustart, WENN `AT_SECRET` gesetzt ist — siehe unten.
 */
import crypto from 'crypto'
import { getKnex } from './database.js'
import { isLocalRequest } from './update-api.js'
import { logWarn } from './logger.js'
import { umgebung, umgebungAn } from './umgebung.js'

/**
 * Sitzungs-Token.
 *
 * Es lebt im Prozess, nicht in der Datenbank. Wurde es bei jedem Start neu
 * gewürfelt, meldete JEDER Neustart alle Geräte ab, die auf diesen Server
 * zeigen — beim NAS also nach jedem Container-Update Desktop, Handy und Tablet
 * gleichzeitig. Ein Update ist kein Sicherheitsereignis, das rechtfertigt das
 * nicht.
 *
 * Ist `AT_SECRET` gesetzt, wird das Token daraus ABGELEITET statt gewürfelt.
 * Damit überlebt die Anmeldung einen Neustart. Die Angriffsfläche wächst
 * dadurch nicht: `AT_SECRET` ist ohnehin das Hauptgeheimnis der Installation,
 * aus ihm werden bereits die API-Schlüssel entschlüsselt.
 *
 * Der Preis, bewusst in Kauf genommen: ein einmal abgegriffenes Cookie bleibt
 * gültig, bis `AT_SECRET` gewechselt wird — vorher half ein Neustart. Wer ein
 * Token für verbrannt hält, ändert `AT_SECRET` (oder setzt es ab, dann wird
 * wieder gewürfelt).
 *
 * Ohne `AT_SECRET` bleibt es beim alten Verhalten: zufällig je Start. Ein aus
 * dem Maschinennamen abgeleiteter Ersatz wäre erratbar und damit schlechter als
 * eine lästige Neuanmeldung.
 */
/**
 * Generation des Sitzungs-Tokens.
 *
 * Bis zum Audit vom 28.08.2026 war das Token allein aus `AT_SECRET`
 * abgeleitet und damit unveraenderlich: Abmelden loeschte nur das Cookie beim
 * Client, und ein Passwortwechsel liess bestehende Sitzungen ausdruecklich
 * weiterlaufen. Wer sein Passwort wechselt, tut das aber meistens, WEIL er
 * einen Kompromiss vermutet — genau dann muss ein abgegriffenes Cookie
 * sterben.
 *
 * Die Generation liegt in den Einstellungen und geht in die Ableitung ein.
 * Sie erhoehen entwertet jedes ausgestellte Cookie auf einen Schlag, ohne dass
 * jemand `AT_SECRET` anfassen muss. Der uebrige Preis bleibt bewusst bestehen
 * (siehe Kopf): das Token ueberlebt einen Neustart, damit ein Container-Update
 * nicht alle Geraete abmeldet.
 */
let sessionGeneration = 0

function leiteTokenAb(generation) {
    /*
     * Die Generation geht in BEIDE Faelle ein.
     *
     * Erster Entwurf gab ohne `AT_SECRET` einfach `zufallsToken` zurueck —
     * dann waere der Passwortwechsel dort wirkungslos gewesen, und zwar
     * lautlos. Der Selbsttest hat genau das gefangen. Ohne Secret ist die
     * Basis der Zufallswert des Prozesses statt des Hauptgeheimnisses; die
     * Rotation funktioniert in beiden Faellen gleich.
     */
    const basis = umgebung('SECRET') ? String(umgebung('SECRET')) : zufallsToken
    /*
     * Generation 0 ergibt GENAU das alte Token.
     *
     * Ohne diese Ausnahme haette schon das Einspielen dieser Aenderung jedes
     * Geraet abgemeldet — beim NAS also Desktop, Handy und Tablet gleichzeitig,
     * und zwar ohne dass irgendetwas passiert waere. Der Dateikopf nennt genau
     * das als unerwuenscht: "Ein Update ist kein Sicherheitsereignis, das
     * rechtfertigt das nicht." Entwertet wird erst, wenn jemand sein Passwort
     * wechselt — dann ab Generation 1.
     */
    // Der Zweck-Text 'tn_session_v1' bleibt trotz Umbenennung zu AutarkTrade:
    // er geht in das Token ein, ein neuer Text meldete jedes Gerät ab und
    // machte die Shell-Token der Diagnose-Skripte ungültig.
    const zweck = generation > 0 ? `tn_session_v1:${generation}` : 'tn_session_v1'
    return crypto.createHmac('sha256', basis).update(zweck).digest('hex')
}

/*
 * Ohne `AT_SECRET` bleibt es beim alten Verhalten: zufaellig je Start. Der
 * Wert wird EINMAL gewuerfelt, sonst wechselte das Token bei jedem Aufruf und
 * niemand koennte angemeldet bleiben.
 */
const zufallsToken = crypto.randomBytes(32).toString('hex')
let SESSION_TOKEN = leiteTokenAb(sessionGeneration)

/**
 * Alle bestehenden Sitzungen entwerten.
 *
 * @returns {Promise<void>}
 */
export async function entwerteAlleSitzungen() {
    /*
     * ZUERST rotieren, dann speichern — nicht umgekehrt.
     *
     * Im ersten Entwurf stand `getKnex()` vor der Erhoehung. Ohne erreichbare
     * Datenbank warf der Aufruf, die Generation blieb stehen, und die
     * Entwertung fiel lautlos aus: genau in dem Moment, in dem etwas nicht
     * stimmt, waere das abgegriffene Cookie am Leben geblieben. Das Speichern
     * darf scheitern; das Entwerten nicht.
     */
    sessionGeneration = Number(sessionGeneration || 0) + 1
    SESSION_TOKEN = leiteTokenAb(sessionGeneration)
    try {
        const knex = getKnex()
        await knex('settings').where('id', 1).update({
            sessionGeneration,
            updatedAt: knex.fn.now(),
        })
    } catch (e) {
        // Nicht persistiert: nach einem Neustart gilt wieder die alte
        // Generation. Das ist der kleinere Schaden — jetzt sofort ist alles
        // entwertet, und der Passwortwechsel selbst ist ohne Datenbank
        // ohnehin nicht durchgekommen.
        logWarn('auth', 'Sitzungs-Generation konnte nicht gespeichert werden', e)
    }
}
const COOKIE_NAME = 'at_session'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 Tage in Sekunden

// In-memory Auth-Konfiguration (aus settings geladen)
let authConfig = { enabled: false, passwordHash: '' }

// Auf welcher Adresse der Server lauscht. Ohne Passwort-Gate wird das Cookie
// jedem Besucher zugeteilt — das ist nur vertretbar, solange ausschliesslich
// der eigene Rechner den Dienst erreicht. Standard `true`, damit Werkzeuge, die
// dieses Modul ohne laufenden Server laden, ihr Verhalten nicht ändern.
let bindNurLokal = true

/** Lauscht der Server ausschliesslich auf der Loopback-Adresse? */
export function istLoopbackHost(host) {
    const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
    /*
     * Nur echte IP-Literale aus 127.0.0.0/8, kein Präfix-Vergleich.
     *
     * Bis F2 (20.10.2026, Audit A2-01) stand hier `h.startsWith('127.')` —
     * damit galt auch `127.0.0.1.angreifer.tld` als Loopback, also genau der
     * Name, unter dem eine DNS-Rebinding-Seite die lokale App erreicht. Der
     * Host-Guard liess sie durch, und `/api/auth/reset` öffnete das Gate.
     */
    return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h)
}

/** Beim Start aufrufen, sobald die Bind-Adresse feststeht. */
export function setzeBindungsModus(nurLokal) {
    bindNurLokal = !!nurLokal
}

/**
 * Darf der Dienst ohne Passwort-Gate betrieben werden? Nur lokal — oder wenn
 * der Betreiber es mit AT_ALLOW_INSECURE=1 ausdrücklich in Kauf nimmt.
 */
export function offenerBetriebErlaubt() {
    return bindNurLokal || umgebungAn('ALLOW_INSECURE')
}

// Routen, die ohne gültige Session erreichbar sein müssen (Login-Flow +
// unkritischer Setup-Status, den der Router-Guard vor dem Login abfragt).
const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/auth/status', '/api/setup/status', '/api/auth/reset'])

/**
 * Lädt die Auth-Konfiguration aus der settings-Tabelle. Nach DB-Init und nach
 * Änderungen (Login-Aktivierung/Passwortwechsel) aufrufen.
 */
export async function loadAuthConfig() {
    try {
        const knex = getKnex()
        const row = await knex('settings').select('authEnabled', 'authPasswordHash', 'sessionGeneration').where('id', 1).first()
        authConfig = {
            enabled: !!(row && row.authEnabled) && !!(row && row.authPasswordHash),
            passwordHash: (row && row.authPasswordHash) || ''
        }
        /*
         * Die Generation kommt aus der Datenbank, nicht aus dem Prozess: ein
         * Neustart darf die Entwertung nicht zuruecknehmen.
         */
        const gen = Number(row?.sessionGeneration) || 0
        if (gen !== sessionGeneration) {
            sessionGeneration = gen
            SESSION_TOKEN = leiteTokenAb(sessionGeneration)
        }
    } catch (e) {
        authConfig = { enabled: false, passwordHash: '' }
    }
    return authConfig
}

export function isAuthEnabled() {
    return authConfig.enabled
}

/**
 * Notfall-Reset per Umgebungsvariable: Wird der Server mit AT_RESET_AUTH=1
 * gestartet, wird der Passwortschutz einmalig deaktiviert (für den Fall, dass
 * das Passwort verloren ging und kein localhost-Zugriff möglich ist).
 * Beim Start VOR loadAuthConfig aufrufen. Danach Env-Variable wieder entfernen.
 */
export async function maybeResetAuthFromEnv() {
    if (!umgebungAn('RESET_AUTH')) return
    try {
        const knex = getKnex()
        await knex('settings').where('id', 1).update({ authEnabled: 0, authPasswordHash: '', updatedAt: knex.fn.now() })
        console.warn('[AUTH] Passwortschutz via AT_RESET_AUTH zurückgesetzt. Bitte AT_RESET_AUTH wieder entfernen.')
    } catch (e) {
        console.error('[AUTH] AT_RESET_AUTH Reset fehlgeschlagen:', e.message)
    }
}

/** True, wenn der Request über HTTPS kommt (auch hinter Reverse-Proxy). */
function isHttps(req) {
    if (!req) return false
    if (req.secure) return true
    const xfp = req.headers && req.headers['x-forwarded-proto']
    return typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https'
}

/**
 * Returns the Set-Cookie header string for the session token.
 * `Secure` wird nur über HTTPS gesetzt (sonst würde der Browser das Cookie bei
 * Plain-HTTP-Betrieb im LAN verwerfen).
 */
export function getSessionCookieString(req, remember = true) {
    const secure = isHttps(req) ? ' Secure;' : ''
    // remember=true → persistentes Cookie (30 Tage). false → Session-Cookie ohne
    // Max-Age (läuft ab, wenn der Browser geschlossen wird).
    const maxAge = remember ? ` Max-Age=${COOKIE_MAX_AGE};` : ''
    return `${COOKIE_NAME}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict;${maxAge} Path=/;${secure}`
}

/** Cookie löschen (Logout). */
function getClearCookieString(req) {
    const secure = isHttps(req) ? ' Secure;' : ''
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/;${secure}`
}

// ==================== DNS-Rebinding ====================
//
// Der ganze localhost-Vertrauensbau hängt an der Peer-IP: „kommt von 127.0.0.1,
// also ist es der Nutzer selbst". Eine Rebinding-Seite bricht genau das. Sie
// lässt ihren eigenen Namen (evil.tld) kurz auf 127.0.0.1 zeigen; der Browser
// des Nutzers schickt die Anfrage dann brav an den eigenen Rechner — mit
// lokaler Peer-IP, aber mit `Host: evil.tld`. Damit stünde `/api/auth/reset`
// offen (schaltet das Passwort-Gate ab), und der nächste Seitenaufruf liefert
// das Session-Cookie an die fremde Domain.
//
// Der Host-Header ist die einzige Stelle, an der man das sieht — deshalb wird
// er hier geprüft. Kein Ersatz für die Peer-IP-Prüfung, sondern ihr Gegenstück.

/** Private IPv4-Bereiche, unter denen der Dienst im eigenen Netz erreichbar ist. */
const PRIVATE_V4 = [
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/,   // CGNAT (Tailscale)
]

/** Zusätzlich erlaubte Namen aus der Umgebung (Komma-getrennt). */
function zusatzHosts() {
    return String(umgebung('ALLOWED_HOSTS') || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * Darf unter diesem Host-Header zugegriffen werden?
 *
 * Erlaubt sind Loopback, private IP-Adressen und was in AT_ALLOWED_HOSTS
 * steht. Registrierbare Domains sind es nicht — genau die braucht ein
 * Rebinding-Angriff.
 *
 * @param {string} rawHost Inhalt des Host-Headers (mit oder ohne Port)
 */
export function istErlaubterHost(rawHost) {
    // Kein Host-Header: HTTP/1.0-Klienten wie das ESP-Display oder curl. Ein
    // Rebinding-Angriff läuft immer über einen Browser, und der schickt den
    // Header immer — hier gibt es also nichts zu erkennen und nichts zu sperren.
    if (rawHost === undefined || rawHost === null || rawHost === '') return true

    let host = String(rawHost).trim().toLowerCase().replace(/\.$/, '')
    // IPv6 steht in eckigen Klammern und enthält selbst Doppelpunkte — erst die
    // Klammer abtrennen, sonst zerlegt die Port-Abtrennung die Adresse.
    if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined)
    else host = host.split(':')[0]

    if (istLoopbackHost(host)) return true
    if (PRIVATE_V4.some((r) => r.test(host))) return true
    // IPv6: eindeutig lokale (fc00::/7) und verbindungslokale (fe80::/10) Adressen
    if (host.includes(':')) {
        const kopf = parseInt(host.split(':')[0] || '0', 16)
        if ((kopf & 0xfe00) === 0xfc00 || (kopf & 0xffc0) === 0xfe80) return true
    }
    return zusatzHosts().includes(host)
}

/** Middleware-Fassung: weist unbekannte Hosts mit 421 ab. */
export function hostGuardMiddleware(req, res, next) {
    if (istErlaubterHost(req.headers?.host)) return next()
    res.status(421).type('text/plain').send(
        'Unbekannter Host. Der Dienst ist nur über localhost oder eine private '
        + 'Netzadresse erreichbar (sonst AT_ALLOWED_HOSTS setzen).'
    )
}

/**
 * Middleware: set session cookie on any non-API request.
 * Im Passwort-Gate-Modus wird KEIN Cookie automatisch gesetzt — nur nach Login.
 *
 * Und: im Netzbetrieb ohne Gate ebenfalls nicht. Der Startcheck in index.mjs
 * fängt diesen Zustand normalerweise ab; er kann aber im Betrieb entstehen,
 * wenn jemand den Passwortschutz nachträglich abschaltet. Dann lieber
 * verschlossen als jedem im LAN das Cookie in die Hand drücken.
 */
export function sessionCookieMiddleware(req, res, next) {
    if (!req.url.startsWith('/api/') && !authConfig.enabled && offenerBetriebErlaubt()) {
        res.setHeader('Set-Cookie', getSessionCookieString(req))
    }
    next()
}

/**
 * Middleware: verify session cookie on all /api/* requests.
 * Login-Routen sind ausgenommen, damit man sich überhaupt anmelden kann.
 */
export function apiAuthMiddleware(req, res, next) {
    // Login-Flow-Routen immer durchlassen.
    // Hinweis: bei `app.use('/api', ...)` ist req.path ohne /api-Präfix, daher
    // originalUrl verwenden, damit die Allowlist mit /api/... matcht.
    const basePath = (req.originalUrl || req.url).split('?')[0]
    if (PUBLIC_API_PATHS.has(basePath)) return next()

    // Erst-Einrichtung: solange KEIN Passwort existiert, darf das erste ohne
    // Session gesetzt werden. Ohne diese Ausnahme käme ein netzgebundener
    // Container nie aus dem gesperrten Zustand heraus — er verteilt ja keine
    // Cookies mehr, und Passwort-Setzen bräuchte eines (Henne-Ei). Sobald das
    // Gate aktiv ist, gilt wieder die volle Session-Pflicht.
    if (basePath === '/api/auth/set-password' && !authConfig.enabled) return next()

    const token = parseCookieToken(req)
    if (isValidSessionToken(token)) {
        return next()
    }

    res.status(401).json({ error: 'Nicht autorisiert. Bitte lade die Seite im Browser neu.' })
}

/** Konstantzeitiger Vergleich des Session-Tokens (verhindert Timing-Leaks). */
/** Trägt die Anfrage ein gültiges Session-Cookie? (Für das Body-Limit in index.mjs.) */
export function hatGueltigeSession(req) {
    return isValidSessionToken(parseCookieToken(req))
}

function isValidSessionToken(token) {
    if (typeof token !== 'string') return false
    const a = Buffer.from(token)
    const b = Buffer.from(SESSION_TOKEN)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Parse the session token from the Cookie header.
 */
function parseCookieToken(req) {
    const cookieHeader = req.headers.cookie
    if (!cookieHeader) return null

    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.trim().split('=')
        if (name === COOKIE_NAME) {
            return valueParts.join('=')
        }
    }
    return null
}

// ==================== Passwort-Hashing (scrypt) ====================

/*
 * Asynchron und mit Parallelitätsgrenze (Audit A2-11, F2 20.10.2026).
 *
 * `scryptSync` rechnete jeden Login synchron in der Event-Loop — auch jeden
 * falschen. 200 parallele Versuche hielten die ganze App rund 4 s fest, Takte
 * und SSE eingeschlossen. Jetzt rechnet der Thread-Pool, und mehr als
 * `HASH_PARALLEL` Hashes gleichzeitig gibt es nicht; wer dahinter in einer
 * vollen Schlange stünde, bekommt sofort 429 statt zu warten.
 */
const HASH_PARALLEL = 2
const HASH_SCHLANGE_MAX = 16
let hashLaufend = 0
const hashWarten = []

function scryptAsync(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
    })
}

async function mitHashPlatz(fn) {
    if (hashLaufend >= HASH_PARALLEL) {
        if (hashWarten.length >= HASH_SCHLANGE_MAX) {
            const e = new Error('Zu viele gleichzeitige Anmeldeversuche.')
            e.status = 429
            throw e
        }
        await new Promise((r) => hashWarten.push(r))
    }
    hashLaufend++
    try { return await fn() } finally {
        hashLaufend--
        const naechster = hashWarten.shift()
        if (naechster) naechster()
    }
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = await mitHashPlatz(() => scryptAsync(password, salt))
    return `${salt}:${derived.toString('hex')}`
}

async function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false
    const [salt, derivedHex] = stored.split(':')
    let derived
    try {
        derived = await mitHashPlatz(() => scryptAsync(password, salt))
    } catch (e) {
        if (e.status === 429) throw e
        return false
    }
    const expected = Buffer.from(derivedHex, 'hex')
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
}

/** Mindestlänge für NEUE Passwörter (A2-23). Bestehende kürzere gelten weiter. */
export const PASSWORT_MIN = 10

// ==================== Rate-Limiting (in-memory, pro IP) ====================

const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_LOCK_MS = 5 * 60 * 1000 // 5 min Sperre nach zu vielen Versuchen
const loginAttempts = new Map() // ip -> { count, lockUntil }

/*
 * Globale Bremse über alle Adressen (A2-03): selbst wenn ein Angreifer viele
 * echte Adressen hat (IPv6-Präfix, Botnetz hinter dem Proxy), kommt er nicht
 * über GLOBAL_MAX Fehlversuche je Minute. Der Preis: während eines laufenden
 * Angriffs muss auch der Eigentümer bis zu einer Minute warten.
 */
const GLOBAL_FENSTER_MS = 60 * 1000
const GLOBAL_MAX = 60
let globaleFehler = []

/*
 * Wem darf der X-Forwarded-For geglaubt werden?
 *
 * Bis F2 (Audit A2-03) reichte `AT_TRUST_PROXY=1`, und der letzte XFF-Eintrag
 * galt als Client — egal, wer die Verbindung aufgebaut hatte. Die Compose-
 * Vorgabe setzt den Schalter und veröffentlicht 8080 zugleich direkt im LAN:
 * wer 8080 direkt erreichte, schickte je Versuch einen neuen XFF und wurde nie
 * gesperrt (~40 Versuche/s gemessen). Jetzt zählt der Kopf nur, wenn die
 * Peer-IP selbst ein bekannter Proxy ist: `AT_TRUSTED_PROXY` (IPs oder Namen,
 * Komma-getrennt). Ohne Angabe gelten die Compose-Namen des mitgelieferten
 * Caddy (`caddy`, `autarktrade-caddy`) — sie lösen nur im Docker-Netz auf, so
 * bleibt eine bestehende NAS-Installation ohne Anpassung richtig.
 */
const PROXY_VORGABE = ['caddy', 'autarktrade-caddy']
let proxyCache = { schluessel: '', bis: 0, ips: new Set() }

function normIp(ip) {
    return String(ip || '').trim().replace(/^::ffff:/i, '').toLowerCase()
}

async function vertrauteProxyIps() {
    const liste = String(umgebung('TRUSTED_PROXY') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const namen = liste.length ? liste : PROXY_VORGABE
    const schluessel = namen.join(',')
    if (proxyCache.schluessel === schluessel && Date.now() < proxyCache.bis) return proxyCache.ips
    const ips = new Set()
    const { lookup } = await import('dns/promises')
    const net = await import('net')
    for (const n of namen) {
        if (net.isIP(n)) { ips.add(normIp(n)); continue }
        try {
            for (const a of await lookup(n, { all: true })) ips.add(normIp(a.address))
        } catch { /* Name löst hier nicht auf: kein Proxy dieses Namens */ }
    }
    proxyCache = { schluessel, bis: Date.now() + 60 * 1000, ips }
    return ips
}

/**
 * Adresse, unter der Fehlversuche gezählt werden.
 *
 * Exportiert für den Selbsttest.
 *
 * @param {import('express').Request} req
 * @returns {Promise<string>}
 */
export async function clientIp(req) {
    const peer = normIp(req.socket?.remoteAddress || req.ip || 'unknown')
    /*
     * Hinter dem hauseigenen Reverse-Proxy (Caddy) tragen ALLE Klienten
     * dieselbe Peer-IP — der Zähler kollabierte zu einem einzigen Eimer, und
     * fünf fremde Fehlversuche sperrten auch den Eigentümer aus. Deshalb liest
     * NUR dieser Zähler die vom unmittelbaren Proxy angehängte Adresse (letzter
     * Eintrag — den setzt der eigene Proxy, alles davor ist Klienten-
     * Behauptung), und nur wenn die Verbindung wirklich vom Proxy kommt.
     * isLocalRequest bleibt bewusst bei der Peer-IP.
     */
    if (umgebungAn('TRUST_PROXY') && (await vertrauteProxyIps()).has(peer)) {
        const xff = String(req.headers['x-forwarded-for'] || '')
        const letzte = xff.split(',').map((s) => s.trim()).filter(Boolean).pop()
        if (letzte) return normIp(letzte)
    }
    return peer
}

function globalGebremst() {
    const jetzt = Date.now()
    globaleFehler = globaleFehler.filter((t) => t > jetzt - GLOBAL_FENSTER_MS)
    return globaleFehler.length >= GLOBAL_MAX
}

function isRateLimited(ip) {
    if (globalGebremst()) return true
    const rec = loginAttempts.get(ip)
    if (!rec) return false
    if (rec.lockUntil && Date.now() < rec.lockUntil) return true
    return false
}

function registerFailure(ip) {
    const jetzt = Date.now()
    globaleFehler.push(jetzt)
    /*
     * Abgelaufene Einträge auskehren — ALLE, nicht nur gesperrte.
     *
     * Vorher wurden nur Zeilen mit `lockUntil` geräumt: wer ein- bis viermal
     * daneben tippte, blieb für immer in der Map stehen. Mit IPv6-Privacy-
     * Adressen (die sich regelmässig ändern) wuchs sie damit unbegrenzt.
     * Jetzt zählt der letzte Versuch: eine Stunde ohne neuen Fehlversuch und
     * der Eintrag ist ohnehin bedeutungslos.
     */
    const verfallen = jetzt - 60 * 60 * 1000
    for (const [altIp, altRec] of loginAttempts) {
        const aktiv = altRec.lockUntil && altRec.lockUntil > jetzt
        if (!aktiv && (altRec.zuletzt || 0) < verfallen) loginAttempts.delete(altIp)
    }
    const rec = loginAttempts.get(ip) || { count: 0, lockUntil: 0 }
    rec.count += 1
    rec.zuletzt = jetzt
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
        rec.lockUntil = jetzt + LOGIN_LOCK_MS
        rec.count = 0
    }
    loginAttempts.set(ip, rec)
}

function clearFailures(ip) {
    loginAttempts.delete(ip)
}

/** Nur für den Selbsttest: Gate ohne Datenbank ein-/ausschalten. */
export async function _authFuerTest(passwort) {
    authConfig = passwort
        ? { enabled: true, passwordHash: await hashPassword(passwort) }
        : { enabled: false, passwordHash: '' }
}

/** Nur für den Selbsttest: Zähler zurücksetzen. */
export function _zaehlerLeeren() {
    loginAttempts.clear()
    globaleFehler = []
    proxyCache = { schluessel: '', bis: 0, ips: new Set() }
}

const ZU_VIELE = { error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' }

/**
 * Passwortprüfung mit Zähler — für Login UND für `currentPassword` beim
 * Ändern/Abschalten (A2-23: dort gab es bis F2 unbegrenzt Versuche).
 *
 * @returns {Promise<'ok'|'falsch'|'gesperrt'>}
 */
async function pruefeMitZaehler(req, password) {
    const ip = await clientIp(req)
    if (isRateLimited(ip)) return 'gesperrt'
    let ok
    try {
        ok = !!password && await verifyPassword(password, authConfig.passwordHash)
    } catch (e) {
        if (e.status === 429) return 'gesperrt'
        throw e
    }
    if (!ok) { registerFailure(ip); return 'falsch' }
    clearFailures(ip)
    return 'ok'
}

// ==================== Erst-Einrichtung ====================

/*
 * Einrichtungscode (Audit A2-16, F2 20.10.2026).
 *
 * Ein netzgebundener Dienst ohne Passwort startet gesperrt, und das erste
 * Passwort darf ohne Sitzung gesetzt werden — bis F2 von JEDEM, der den Port
 * zuerst erreicht. Jetzt verlangt das Setzen aus dem Netz den Code, der beim
 * Start (und nach jedem Zurücksetzen) im Server-Log steht; wer das Log lesen
 * kann, ist der Betreiber. Direkt am Rechner (localhost, keine fremde Seite)
 * braucht es ihn nicht. Der Code lebt nur im Prozess.
 */
let einrichtungsCode = erzeugeCode()

function erzeugeCode() {
    // Ohne 0/O/1/I/L, damit ihn niemand falsch abtippt.
    const zeichen = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const b = crypto.randomBytes(8)
    let s = ''
    for (let i = 0; i < 8; i++) s += zeichen[b[i] % zeichen.length]
    return s.slice(0, 4) + '-' + s.slice(4)
}

/** Braucht das Setzen des ersten Passworts gerade einen Code? */
function einrichtungGesperrt() {
    return !authConfig.enabled && !offenerBetriebErlaubt()
}

/** Code ins Log schreiben, wenn der Dienst auf das erste Passwort wartet. */
export function meldeEinrichtungsCode() {
    if (!einrichtungGesperrt()) return
    console.warn('\n  🔑  Einrichtungscode für das erste Passwort: ' + einrichtungsCode)
    console.warn('      Im Browser bei „Passwort festlegen" eingeben (nur aus dem Netz nötig).\n')
}

/** Nur für den Selbsttest. */
export function _einrichtungsCode() { return einrichtungsCode }

function codePasst(eingabe) {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const a = Buffer.from(norm(eingabe))
    const b = Buffer.from(norm(einrichtungsCode))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ==================== Auth-Routen ====================

export function setupAuthRoutes(app) {
    // Status (öffentlich): zeigt ob Gate aktiv ist und ob man eingeloggt ist
    app.get('/api/auth/status', (req, res) => {
        const loggedIn = !authConfig.enabled || isValidSessionToken(parseCookieToken(req))
        // setupRequired: netzgebunden (oder Container) ohne Passwort — der
        // Server verteilt dann keine Cookies, das Frontend muss zuerst ein
        // Passwort setzen lassen. Wer schon ein gültiges Cookie trägt (Token
        // überlebt via AT_SECRET), arbeitet normal weiter.
        const setupRequired = einrichtungGesperrt() && !isValidSessionToken(parseCookieToken(req))
        res.json({
            authEnabled: authConfig.enabled,
            loggedIn,
            setupRequired,
            codeNoetig: setupRequired && !isLocalRequest(req),
            passwortMin: PASSWORT_MIN,
        })
    })

    // Login (öffentlich): Passwort prüfen, bei Erfolg Session-Cookie setzen
    app.post('/api/login', async (req, res) => {
        if (!authConfig.enabled) {
            // Gate nicht aktiv — Login nicht nötig
            return res.json({ ok: true, authEnabled: false })
        }
        const ergebnis = await pruefeMitZaehler(req, req.body && req.body.password)
        if (ergebnis === 'gesperrt') return res.status(429).json(ZU_VIELE)
        if (ergebnis === 'falsch') return res.status(401).json({ error: 'Falsches Passwort.' })
        // „30 Tage angemeldet bleiben": Frontend kann { remember:false } senden für ein
        // reines Session-Cookie. Fehlt das Feld → true → 30 Tage (bisheriges Verhalten).
        const remember = req.body?.remember !== false
        res.setHeader('Set-Cookie', getSessionCookieString(req, remember))
        res.json({ ok: true })
    })

    // Logout (öffentlich): Cookie löschen
    app.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', getClearCookieString(req))
        res.json({ ok: true })
    })

    /*
     * Überall abmelden (geschützt, A2-22): das Sitzungs-Token ist eines für
     * alle Geräte; Logout löscht nur das Cookie beim Klienten. Wer ein Cookie
     * für abgegriffen hält, entwertet hiermit ALLE — auch das eigene.
     */
    app.post('/api/auth/ueberall-abmelden', async (req, res) => {
        await entwerteAlleSitzungen()
        res.setHeader('Set-Cookie', getClearCookieString(req))
        res.json({ ok: true })
    })

    // Passwort setzen/ändern (geschützt — erfordert gültige Session).
    // Aktiviert das Gate. Beim Ändern eines bestehenden Passworts ist das
    // aktuelle Passwort erforderlich.
    app.post('/api/auth/set-password', async (req, res) => {
        try {
            const { newPassword, currentPassword, einrichtungsCode: code } = req.body || {}
            if (!newPassword || String(newPassword).length < PASSWORT_MIN) {
                return res.status(400).json({ error: `Neues Passwort muss mindestens ${PASSWORT_MIN} Zeichen haben.` })
            }
            if (authConfig.enabled) {
                const ergebnis = await pruefeMitZaehler(req, currentPassword || '')
                if (ergebnis === 'gesperrt') return res.status(429).json(ZU_VIELE)
                if (ergebnis === 'falsch') return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' })
            } else if (einrichtungGesperrt() && !isLocalRequest(req)
                && !isValidSessionToken(parseCookieToken(req))) {
                // Erst-Einrichtung aus dem Netz: nur mit dem Code aus dem Log.
                const ip = await clientIp(req)
                if (isRateLimited(ip)) return res.status(429).json(ZU_VIELE)
                if (!codePasst(code)) {
                    registerFailure(ip)
                    meldeEinrichtungsCode()
                    return res.status(403).json({
                        error: 'Einrichtungscode fehlt oder ist falsch. Er steht im Server-Log (Container-Protokoll).',
                        codeNoetig: true,
                    })
                }
            }
            const warErstEinrichtung = !authConfig.enabled
            const hash = await hashPassword(newPassword)
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 1,
                authPasswordHash: hash,
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            einrichtungsCode = erzeugeCode()
            /*
             * Passwortwechsel entwertet ALLE bestehenden Sitzungen — wer sein
             * Passwort aendert, vermutet meistens einen Kompromiss. Danach ein
             * frisches Cookie fuer den Aufrufer, sonst meldete sich gerade der
             * ab, der die Aenderung vorgenommen hat.
             *
             * Seit F2 (A2-22) auch bei der Erst-Einrichtung: davor kann ein
             * Reset gelegen haben, und ein vor dem Reset abgegriffenes Cookie
             * darf das neue Passwort nicht überleben.
             */
            await entwerteAlleSitzungen()
            res.setHeader('Set-Cookie', getSessionCookieString(req))
            res.json({ ok: true, authEnabled: true, sitzungenEntwertet: !warErstEinrichtung })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            res.status(500).json({ error: e.message || 'Fehler beim Setzen des Passworts.' })
        }
    })

    // Passwort vergessen / Reset (öffentlich, aber NUR von localhost).
    // Kein aktuelles Passwort nötig — wer lokal am Server sitzt, gilt als
    // Eigentümer (gleiches Vertrauensmodell wie Update/Restart).
    app.post('/api/auth/reset', async (req, res) => {
        /*
         * Drei Riegel seit F2 (Audit A2-01/A2-02):
         * - isLocalRequest verlangt jetzt auch gleiche Herkunft (Origin /
         *   Sec-Fetch-Site) — eine fremde Seite im Browser des Nutzers ist
         *   nicht „lokal", auch wenn ihr fetch von 127.0.0.1 kommt;
         * - der Host-Guard erkennt `127.0.0.1.angreifer.tld` nicht mehr als
         *   Loopback (istLoopbackHost);
         * - Content-Type muss JSON sein. Ein `no-cors`-POST einer fremden
         *   Seite darf nur „simple" Typen schicken; JSON erzwingt einen
         *   Preflight, den dieser Server nie beantwortet.
         */
        if (!isLocalRequest(req)) {
            return res.status(403).json({ error: 'Zurücksetzen nur direkt am Server (localhost) möglich.' })
        }
        if (!req.is('application/json')) {
            return res.status(415).json({ error: 'Zurücksetzen nur aus der App heraus.' })
        }
        try {
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 0,
                authPasswordHash: '',
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            // Ein vor dem Reset abgegriffenes Cookie stirbt hier (A2-22).
            await entwerteAlleSitzungen()
            einrichtungsCode = erzeugeCode()
            meldeEinrichtungsCode()
            res.json({ ok: true, authEnabled: false })
        } catch (e) {
            res.status(500).json({ error: 'Zurücksetzen fehlgeschlagen.' })
        }
    })

    // Gate deaktivieren (geschützt) — aktuelles Passwort erforderlich
    app.post('/api/auth/disable', async (req, res) => {
        try {
            // Im Netzbetrieb wäre das Abschalten gleichbedeutend mit „Tür auf
            // für alle im LAN". Wer das wirklich will, startet mit
            // AT_ALLOW_INSECURE=1 — dann greift diese Sperre nicht.
            if (!offenerBetriebErlaubt()) {
                return res.status(403).json({
                    error: 'Der Dienst ist im Netzwerk erreichbar. Ohne Passwortschutz hätte dann jeder im Netz vollen Zugriff. Zum Abschalten den Dienst nur lokal binden (AT_HOST=127.0.0.1) oder mit AT_ALLOW_INSECURE=1 starten.'
                })
            }
            if (authConfig.enabled) {
                const { currentPassword } = req.body || {}
                const ergebnis = await pruefeMitZaehler(req, currentPassword || '')
                if (ergebnis === 'gesperrt') return res.status(429).json(ZU_VIELE)
                if (ergebnis === 'falsch') return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' })
            }
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 0,
                authPasswordHash: '',
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            res.json({ ok: true, authEnabled: false })
        } catch (e) {
            res.status(500).json({ error: e.message || 'Fehler beim Deaktivieren.' })
        }
    })
}
