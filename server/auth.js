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
import net from 'net'
import { getKnex } from './database.js'
import { isLocalRequest, istFremdeHerkunft } from './update-api.js'
import { logWarn } from './logger.js'
import { umgebung, umgebungAn } from './umgebung.js'
import { hauptGeheimnis, encrypt, decrypt } from './crypto.js'
import { neuesTotpGeheimnis, pruefeTotp, otpauthUri, signiere, pruefeSigniert, zufallsId, verbrauche } from './zweifaktor.js'
import { schluesselKontext, registrierOptionen, loginOptionen, tokenAusAntwort, pruefeRegistrierung, pruefeLogin, leseTransports, WARTEN_MS } from './webauthn.js'
import { tlsPort } from './tls/dienst.js'

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
    // Seit F2 auch die Secret-Datei nativer Installationen (crypto.js): dann
    // überlebt die Anmeldung dort ebenfalls einen Neustart.
    const basis = hauptGeheimnis() || zufallsToken
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

// In-memory Auth-Konfiguration (aus settings geladen). `totpAn` und
// `schluessel` (Anzahl registrierter YubiKeys je RP-ID) gehören zum zweiten
// Faktor; ohne Passwort-Gate zählen sie nicht (`zweiFaktorAktiv`).
// `schluesselDirekt`: „Mit YubiKey anmelden" ohne Passwort erlaubt (Audit
// 4.3.4 SEC-S1-002, ab Werk aus).
const LEERE_KONFIG = () => ({ enabled: false, passwordHash: '', totpAn: false, schluesselDirekt: false, schluessel: new Map() })
let authConfig = LEERE_KONFIG()

/*
 * Nachladen mit kurzer Frist (Audit 4.3.4 SEC-S1-001).
 *
 * Bis dahin las ein Prozess die Zugangsfelder nur beim Start und nach EIGENEN
 * Änderungen. Teilen sich zwei Prozesse eine Datenbank (NAS-Container und
 * Entwicklungsrechner, vorgesehen laut db-claim) und schaltete einer den
 * zweiten Faktor ein, meldete der andere bis zum Neustart weiter allein mit
 * dem Passwort an, und jedes alte 30-Tage-Cookie galt dort weiter — ebenso
 * nach Passwortwechsel und „Überall abmelden".
 *
 * Jetzt holt `frischeAuthConfig()` die Felder neu, wenn der letzte Stand älter
 * als NACHLADEN_MS ist: vor jeder /api-Anfrage (Token-Prüfung), vor dem
 * automatischen Cookie und in den Login-Routen. Ein Lauf auf einmal; mehr als
 * eine Abfragerunde je Frist gibt es nicht. Zwischen Einschalten im einen und
 * Wirkung im anderen Prozess liegen damit höchstens wenige Sekunden.
 */
const NACHLADEN_MS = 5000
let geladenAm = 0
let ladeLauf = null
let ladeNr = 0
let zugewiesenNr = 0
let ladeFehlerGemeldet = false
// Nur Selbsttest (`_authFuerTest`): von Hand gesetzte Konfiguration nicht überschreiben.
let nachladenAus = false

/**
 * Auth-Konfiguration auffrischen, wenn sie älter als NACHLADEN_MS ist.
 * Wirft nie (ein Datenbankfehler lässt den letzten guten Stand stehen).
 *
 * @returns {Promise<object>}
 */
export function frischeAuthConfig() {
    if (nachladenAus || Date.now() - geladenAm < NACHLADEN_MS) return Promise.resolve(authConfig)
    if (!ladeLauf) ladeLauf = loadAuthConfig().finally(() => { ladeLauf = null })
    return ladeLauf
}

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
const PUBLIC_API_PATHS = new Set([
    '/api/login', '/api/logout', '/api/auth/status', '/api/setup/status', '/api/auth/reset',
    // Zweiter Schritt des Logins (verlangt das Halb-Cookie `at_zweit`)
    '/api/login/totp',
    // YubiKey: als zweiter Schritt (mit at_zweit) oder direkt ohne Passwort
    '/api/login/schluessel/optionen', '/api/login/schluessel/pruefen',
])

/**
 * Lädt die Auth-Konfiguration aus der settings-Tabelle. Nach DB-Init und nach
 * Änderungen (Login-Aktivierung/Passwortwechsel) aufrufen; Änderungen anderer
 * Prozesse holt `frischeAuthConfig()` nach.
 */
export async function loadAuthConfig() {
    const nr = ++ladeNr
    geladenAm = Date.now()
    try {
        const knex = getKnex()
        const row = await knex('settings').select('authEnabled', 'authPasswordHash', 'sessionGeneration').where('id', 1).first()
        /*
         * Erst vollständig aufbauen, dann EINMAL zuweisen. Vorher stand das
         * Gate schon an, während der zweite Faktor noch geladen wurde — ein
         * Login in dieser Lücke hätte mit dem Passwort allein eine Sitzung
         * bekommen. Mit dem Nachladen (SEC-S1-001) käme diese Lücke laufend vor.
         */
        const neu = {
            ...LEERE_KONFIG(),
            enabled: !!(row && row.authEnabled) && !!(row && row.authPasswordHash),
            passwordHash: (row && row.authPasswordHash) || ''
        }
        await ladeZweitenFaktor(knex, neu)
        // Ein älterer Lauf, der nach einem jüngeren fertig wird, überschreibt nichts.
        if (nr < zugewiesenNr) return authConfig
        zugewiesenNr = nr
        authConfig = neu
        /*
         * Die Generation kommt aus der Datenbank, nicht aus dem Prozess: ein
         * Neustart darf die Entwertung nicht zuruecknehmen.
         *
         * Sie steigt nur. Liegt sie im Prozess HÖHER als in der Datenbank,
         * ist das Speichern in `entwerteAlleSitzungen` gescheitert — dann gilt
         * die eigene (das Nachladen darf eine Entwertung nicht zurücknehmen),
         * und das Speichern wird nachgeholt.
         */
        const gen = Number(row?.sessionGeneration) || 0
        if (gen > sessionGeneration) {
            sessionGeneration = gen
            SESSION_TOKEN = leiteTokenAb(sessionGeneration)
        } else if (gen < sessionGeneration) {
            await knex('settings').where('id', 1).where('sessionGeneration', '<', sessionGeneration)
                .update({ sessionGeneration }).catch(() => {})
        }
        ladeFehlerGemeldet = false
    } catch (e) {
        /*
         * Letzten guten Stand behalten (SEC-S1-001). Bis dahin fiel ein
         * Datenbankfehler auf LEERE_KONFIG zurück, also „kein Passwort-Gate" —
         * mit dem Nachladen hätte jede kurze Störung das Gate geöffnet.
         */
        if (!ladeFehlerGemeldet) {
            ladeFehlerGemeldet = true
            logWarn('auth', 'Zugangsdaten konnten nicht nachgeladen werden — letzter Stand bleibt', e)
        }
    }
    return authConfig
}

/*
 * Zweiter Faktor in die Konfiguration laden — in eigenem try: fehlen die
 * Spalten (älterer Stand an derselben Datenbank, Migration noch nicht
 * gelaufen), bleibt der Login beim Passwort statt ganz zu scheitern.
 *
 * Scheitert eine Abfrage, gilt der bisherige Wert dieses Prozesses, nicht
 * „aus": fehlende Spalten hat er schon immer als „aus" gelesen, eine kurze
 * Störung schaltet so den zweiten Faktor nicht ab (SEC-S1-001).
 */
async function ladeZweitenFaktor(knex, ziel) {
    try {
        const z = await knex('settings').select('totpAn').where('id', 1).first()
        ziel.totpAn = !!z?.totpAn
    } catch { ziel.totpAn = authConfig.totpAn }
    try {
        const z = await knex('settings').select('schluesselDirekt').where('id', 1).first()
        ziel.schluesselDirekt = !!z?.schluesselDirekt
    } catch { ziel.schluesselDirekt = authConfig.schluesselDirekt }
    try {
        const zeilen = await knex('auth_schluessel').select('rpId').count({ n: '*' }).groupBy('rpId')
        ziel.schluessel = new Map(zeilen.map((z) => [String(z.rpId), Number(z.n) || 0]))
    } catch { ziel.schluessel = authConfig.schluessel }
}

/** Anzahl registrierter Schlüssel (alle RP-IDs). */
function schluesselGesamt() {
    let n = 0
    for (const v of authConfig.schluessel.values()) n += v
    return n
}

/** Verlangt der Login nach dem Passwort einen zweiten Faktor? */
export function zweiFaktorAktiv() {
    return authConfig.enabled && (authConfig.totpAn || schluesselGesamt() > 0)
}

/**
 * Zweiten Faktor vollständig entfernen: App-Code und alle Schlüssel.
 *
 * Für die drei Rücksetzwege (`/api/auth/reset`, `/api/auth/disable`,
 * AT_RESET_AUTH). Wer sein Passwort zurücksetzt, hat meistens auch den
 * YubiKey oder das Handy nicht mehr — ein Reset, der den zweiten Faktor
 * stehen liesse, sperrte ihn trotzdem aus. Wiederherstellungscodes gibt es
 * bewusst nicht; dieser Weg ist der Rückweg.
 */
async function loescheZweitenFaktor(knex) {
    await knex('settings').where('id', 1).update({
        totpAn: 0, totpGeheimnis: '', totpLetzterSchritt: 0, webauthnVerbraucht: '',
        totpFehlZahl: 0, totpFehlAb: 0, totpSperreBis: 0, schluesselDirekt: 0,
    })
    if (await knex.schema.hasTable('auth_schluessel')) await knex('auth_schluessel').del()
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
        /*
         * Seit dem zweiten Faktor (30.10.2026) auch App-Code und YubiKeys weg,
         * und die Sitzungs-Generation steigt: ein vor dem Reset abgegriffenes
         * Cookie darf ihn nicht überleben (wie bei `/api/auth/reset`).
         * `loadAuthConfig` liest die neue Generation direkt danach.
         */
        const row = await knex('settings').select('sessionGeneration').where('id', 1).first()
        await knex('settings').where('id', 1).update({
            authEnabled: 0, authPasswordHash: '',
            sessionGeneration: (Number(row?.sessionGeneration) || 0) + 1,
            updatedAt: knex.fn.now(),
        })
        await loescheZweitenFaktor(knex)
        console.warn('[AUTH] Passwortschutz, App-Code und Sicherheitsschlüssel via AT_RESET_AUTH zurückgesetzt. Bitte AT_RESET_AUTH wieder entfernen.')
    } catch (e) {
        console.error('[AUTH] AT_RESET_AUTH Reset fehlgeschlagen:', e.message)
    }
}

/**
 * True, wenn der Request über HTTPS kommt: direkt über den eigenen
 * HTTPS-Server (`server/tls/dienst.js`, Socket verschlüsselt) oder hinter
 * einem Reverse-Proxy (X-Forwarded-Proto).
 */
export function isHttps(req) {
    if (!req) return false
    if (req.socket?.encrypted || req.secure) return true
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

// ==================== Halb angemeldet (zweiter Faktor fehlt) ====================

/*
 * Passwort stimmt, zweiter Faktor fehlt noch: dafür gibt es KEIN
 * Sitzungs-Cookie, sondern das kurzlebige `at_zweit` — ein signiertes Token
 * (`zweifaktor.js`), 5 Minuten gültig, an die Sitzungs-Generation gebunden
 * und nur unter /api/login sichtbar. Es öffnet nichts ausser den Routen des
 * zweiten Schritts. Zustandslos, weil NAS und Entwicklungsrechner sich eine
 * PostgreSQL teilen und der zweite Schritt in einem anderen Prozess landen
 * kann als der erste.
 */
const ZWEIT_COOKIE = 'at_zweit'
const ZWEIT_GUELTIG_MS = 5 * 60 * 1000

/** Schlüssel der Kurzzeit-Tokens: dasselbe Hauptgeheimnis wie das Sitzungs-Token. */
function kurzzeitBasis() {
    return hauptGeheimnis() || zufallsToken
}

function zweitCookieString(req, remember) {
    const secure = isHttps(req) ? ' Secure;' : ''
    const token = signiere(kurzzeitBasis(), `tn_zweit_v1:${sessionGeneration}`, { r: remember ? 1 : 0 }, ZWEIT_GUELTIG_MS)
    return `${ZWEIT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Max-Age=${ZWEIT_GUELTIG_MS / 1000}; Path=/api/login;${secure}`
}

function zweitLoeschString(req) {
    const secure = isHttps(req) ? ' Secure;' : ''
    return `${ZWEIT_COOKIE}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/api/login;${secure}`
}

/** Gültiges Halb-Cookie? → { remember } sonst null. */
function halbAngemeldet(req) {
    if (!zweiFaktorAktiv()) return null
    const d = pruefeSigniert(kurzzeitBasis(), `tn_zweit_v1:${sessionGeneration}`, parseCookie(req, ZWEIT_COOKIE))
    return d ? { remember: d.r === 1 } : null
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

/** Namen aus AT_ALLOWED_HOSTS (Komma-getrennt, klein geschrieben). */
function erlaubteHostsAusUmgebung() {
    return String(umgebung('ALLOWED_HOSTS') || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * Der mDNS-Name, den der Host-Schutz zulässt — oder null.
 *
 * EINE Regel für Host-Schutz und YubiKey-Hinweis (Audit 4.3.4 FUN-S1-004):
 * nur ein ausdrücklich gesetztes AT_MDNS_NAME auf `.local`, nicht `aus`. Der
 * Hinweis fiel ohne Eintrag auf `autarktrade.local` zurück, den der
 * Host-Schutz dann mit 421 abwies — die mitgelieferte docker-compose.yml setzt
 * keinen Namen.
 */
function mdnsNameAktiv() {
    const mdns = String(umgebung('MDNS_NAME') || '').trim().toLowerCase().replace(/\.$/, '')
    return mdns && mdns !== 'aus' && mdns.endsWith('.local') ? mdns : null
}

/** Zusätzlich erlaubte Namen aus der Umgebung (Komma-getrennt). */
function zusatzHosts() {
    const liste = erlaubteHostsAusUmgebung()
    // Der Name, den die mDNS-Ansage (server/mdns-name.mjs) im LAN verkündet, gehört
    // dazu: Ein .local-Name ist nicht registrierbar, ein Rebinding-Angreifer kann ihn
    // nicht auf sich zeigen lassen. Nur genau dieser eine Name, keine *.local-Wildcard.
    const mdns = mdnsNameAktiv()
    if (mdns) liste.push(mdns)
    return liste
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
 * Darf das Sitzungs-Cookie ohne Anmeldung verteilt werden? Nur ohne Gate und
 * nur, wenn offener Betrieb erlaubt ist. EINE Regel für die Middleware und den
 * Vite-Proxy im Entwicklungsbetrieb (Audit SEC-SRV-014: der prüfte nur das Gate).
 */
export function cookieAutomatischErlaubt() {
    return !authConfig.enabled && offenerBetriebErlaubt()
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
export async function sessionCookieMiddleware(req, res, next) {
    if (!req.url.startsWith('/api/')) {
        // Ein anderer Prozess kann das Gate eingeschaltet haben (SEC-S1-001).
        await frischeAuthConfig()
        if (cookieAutomatischErlaubt()) res.setHeader('Set-Cookie', getSessionCookieString(req))
    }
    next()
}

// ==================== Herkunftsprüfung (CSRF derselben Site) ====================

/*
 * Audit SEC-SRV-002 (26.10.2026): `SameSite=Strict` trennt nach SITE, nicht
 * nach Herkunft. Eine Seite auf derselben IP mit anderem Port (DSM auf der
 * NAS, ein anderer Container, ein lokaler Dev-Server) ist same-site, ihre
 * Anfragen tragen das Cookie mit — und konnten bezahlte KI-Läufe starten,
 * alle Geräte abmelden oder Strategievorschläge übernehmen. Lesen konnte sie
 * nichts (CORS), schreiben schon.
 *
 * Jetzt wird jede ändernde Anfrage unter /api abgewiesen, wenn der Browser
 * eine fremde Herkunft meldet (`istFremdeHerkunft`, dieselbe Prüfung wie bei
 * `isLocalRequest`). Fehlen `Sec-Fetch-Site` UND `Origin` — curl, Skripte,
 * ESP32, Android-Widget —, geht sie durch: ohne Browser gibt es kein
 * mitgeschicktes Cookie, das man missbrauchen könnte.
 *
 * Hinter Caddy (8443) kommt der Host-Kopf unverändert an; sollte ein Proxy
 * ihn umschreiben, zählt sein `X-Forwarded-Host` — aber nur, wenn die
 * Verbindung von einem vertrauten Proxy kommt (gleiche Regel wie
 * `X-Forwarded-For` in `clientIp`). Sonst könnte jede Seite den Kopf selbst
 * setzen … was sie per CORS-Preflight zwar nicht darf, aber die Regel soll
 * nicht davon abhängen.
 */
const SICHERE_METHODEN = new Set(['GET', 'HEAD', 'OPTIONS'])

/** `X-Forwarded-Host` des unmittelbaren, vertrauten Proxys — sonst keiner. */
async function vertrauterWeitergeleiteterHost(req) {
    const xfh = String(req.headers?.['x-forwarded-host'] || '')
    if (!xfh || !umgebungAn('TRUST_PROXY')) return []
    const peer = normIp(req.socket?.remoteAddress || '')
    if (!(await vertrauteProxyIps()).has(peer)) return []
    const letzter = xfh.split(',').map((s) => s.trim()).filter(Boolean).pop()
    return letzter ? [letzter] : []
}

/**
 * Middleware vor den /api-Routen: ändernde Anfragen fremder Herkunft → 403.
 * Die ESP32-Routen mit eigenem Schlüssel (display, alarme, push) liegen
 * davor und sind damit ausgenommen.
 */
export async function herkunftMiddleware(req, res, next) {
    if (SICHERE_METHODEN.has(req.method)) return next()
    try {
        if (!istFremdeHerkunft(req)) return next()
        const weitere = await vertrauterWeitergeleiteterHost(req)
        if (weitere.length && !istFremdeHerkunft(req, weitere)) return next()
    } catch (e) {
        logWarn('auth', 'Herkunftsprüfung fehlgeschlagen', e)
    }
    res.status(403).json({ error: 'Anfrage von fremder Herkunft abgewiesen. Bitte die App direkt öffnen.' })
}

/**
 * Middleware: verify session cookie on all /api/* requests.
 * Login-Routen sind ausgenommen, damit man sich überhaupt anmelden kann.
 */
export async function apiAuthMiddleware(req, res, next) {
    /*
     * Zuerst auffrischen (SEC-S1-001): Gate, zweiter Faktor und
     * Sitzungs-Generation können sich in einem anderen Prozess an derselben
     * Datenbank geändert haben. Auch für die öffentlichen Login-Routen, die
     * danach mit dem frischen Stand arbeiten.
     */
    await frischeAuthConfig()
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
    return parseCookie(req, COOKIE_NAME)
}

function parseCookie(req, gesucht) {
    const cookieHeader = req.headers?.cookie
    if (!cookieHeader) return null

    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.trim().split('=')
        if (name === gesucht) {
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
export async function _authFuerTest(passwort, { totpAn = false } = {}) {
    nachladenAus = true
    authConfig = passwort
        ? { ...LEERE_KONFIG(), enabled: true, passwordHash: await hashPassword(passwort), totpAn }
        : LEERE_KONFIG()
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
async function pruefeMitZaehler(req, password, { erfolgLoescht = true } = {}) {
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
    /*
     * Folgt noch ein zweiter Faktor, bleibt der Zähler stehen: sonst setzte
     * jedes richtige Passwort die Fehlversuche beim Code zurück, und wer das
     * Passwort hat, könnte den Code in Fünferschritten durchprobieren.
     */
    if (erfolgLoescht) clearFailures(ip)
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

// ==================== Rücksetzcode ====================

/*
 * Rücksetzcode (Audit SEC-SRV-009, 26.10.2026).
 *
 * Bis dahin reichte für `/api/auth/reset` „kommt von 127.0.0.1, ohne fremde
 * Herkunft, mit JSON" — also JEDEM Prozess und JEDEM Benutzer auf dem
 * Server-Rechner: ein `curl -X POST -H 'Content-Type: application/json' -d '{}'`
 * schaltete das Gate ab. Jetzt braucht es zusätzlich einen Einmal-Code, den
 * der Server erst auf Anfrage ins Log schreibt (wie den Einrichtungscode):
 * wer das Log lesen kann, ist der Betreiber. Der Code lebt nur im Prozess,
 * gilt RUECKSETZ_GUELTIG_MS und genau einmal. Der andere Weg bleibt der
 * Startschalter `AT_RESET_AUTH=1` (maybeResetAuthFromEnv).
 */
const RUECKSETZ_GUELTIG_MS = 15 * 60 * 1000
let ruecksetzCode = null   // { code, bis }

/** Gültigen Rücksetzcode liefern, sonst einen neuen erzeugen. */
function aktuellerRuecksetzCode(jetzt = Date.now()) {
    if (!ruecksetzCode || jetzt > ruecksetzCode.bis) {
        ruecksetzCode = { code: erzeugeCode(), bis: jetzt + RUECKSETZ_GUELTIG_MS }
    }
    return ruecksetzCode
}

function meldeRuecksetzCode() {
    const { code } = aktuellerRuecksetzCode()
    console.warn('\n  🔑  Rücksetzcode für „Passwort vergessen": ' + code)
    console.warn('      Gilt 15 Minuten und einmal. Wer das nicht angefordert hat: ignorieren.\n')
}

function ruecksetzCodePasst(eingabe, jetzt = Date.now()) {
    if (!ruecksetzCode || jetzt > ruecksetzCode.bis) return false
    const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const a = Buffer.from(norm(eingabe))
    const b = Buffer.from(norm(ruecksetzCode.code))
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Nur für den Selbsttest. */
export function _ruecksetzCode() { return ruecksetzCode?.code || null }

// ==================== Auth-Routen ====================

export function setupAuthRoutes(app) {
    // Status (öffentlich): zeigt ob Gate aktiv ist und ob man eingeloggt ist
    app.get('/api/auth/status', async (req, res) => {
        await frischeAuthConfig()
        const loggedIn = !authConfig.enabled || isValidSessionToken(parseCookieToken(req))
        // setupRequired: netzgebunden (oder Container) ohne Passwort — der
        // Server verteilt dann keine Cookies, das Frontend muss zuerst ein
        // Passwort setzen lassen. Wer schon ein gültiges Cookie trägt (Token
        // überlebt via AT_SECRET), arbeitet normal weiter.
        const setupRequired = einrichtungGesperrt() && !isValidSessionToken(parseCookieToken(req))
        const k = schluesselKontextFuer(req)
        res.json({
            authEnabled: authConfig.enabled,
            loggedIn,
            setupRequired,
            codeNoetig: setupRequired && !isLocalRequest(req),
            passwortMin: PASSWORT_MIN,
            // Welche zweiten Faktoren eingerichtet sind (ohne Gate: keiner).
            zweiFaktor: {
                totp: authConfig.enabled && authConfig.totpAn,
                schluessel: authConfig.enabled && schluesselGesamt() > 0,
            },
            // „Mit YubiKey anmelden": Gate an, ausdrücklich eingeschaltet
            // (`schluesselDirekt`, SEC-S1-002), sicherer Kontext unter einem
            // erlaubten Namen, und für GENAU diesen Namen ist ein Schlüssel registriert.
            schluesselLogin: authConfig.enabled && authConfig.schluesselDirekt && !!k.rpId && (authConfig.schluessel.get(k.rpId) || 0) > 0,
            // 'ok' oder warum dieser Aufruf keinen Schlüssel kann: ip | name | unsicher | fehlt
            schluesselKontext: k.rpId ? 'ok' : k.grund,
            schluesselAdresse: schluesselAdresse(req),
        })
    })

    // Login (öffentlich): Passwort prüfen, bei Erfolg Session-Cookie setzen
    app.post('/api/login', async (req, res) => {
        await frischeAuthConfig()
        if (!authConfig.enabled) {
            // Gate nicht aktiv — Login nicht nötig
            return res.json({ ok: true, authEnabled: false })
        }
        const zweit = zweiFaktorAktiv()
        const ergebnis = await pruefeMitZaehler(req, req.body && req.body.password, { erfolgLoescht: !zweit })
        if (ergebnis === 'gesperrt') return res.status(429).json(ZU_VIELE)
        if (ergebnis === 'falsch') return res.status(401).json({ error: 'Falsches Passwort.' })
        // „30 Tage angemeldet bleiben": Frontend kann { remember:false } senden für ein
        // reines Session-Cookie. Fehlt das Feld → true → 30 Tage (bisheriges Verhalten).
        const remember = req.body?.remember !== false
        if (zweit) {
            // Passwort stimmt, aber noch keine Sitzung: nur das Halb-Cookie.
            res.setHeader('Set-Cookie', zweitCookieString(req, remember))
            return res.json({ ok: false, zweiterFaktor: zweiteFaktorenFuer(req) })
        }
        res.setHeader('Set-Cookie', getSessionCookieString(req, remember))
        res.json({ ok: true })
    })

    /*
     * Zweiter Schritt mit dem Code aus der Authenticator-App (öffentlich,
     * aber nur mit gültigem Halb-Cookie). Fehlversuche zählen in denselben
     * Zähler wie das Passwort — und seit Audit 4.3.4 (SEC-S1-003) zusätzlich
     * kontoweit in der Datenbank (`codeGesperrt`/`zaehleCodeFehler`).
     */
    app.post('/api/login/totp', async (req, res) => {
        if (!req.is('application/json')) return res.status(415).json({ error: 'Nur aus der App heraus.' })
        await frischeAuthConfig()
        const halb = halbAngemeldet(req)
        if (!halb) return res.status(401).json({ error: 'Anmeldung abgelaufen. Bitte das Passwort erneut eingeben.', neuAnmelden: true })
        if (!authConfig.totpAn) return res.status(409).json({ error: 'Kein App-Code eingerichtet.' })
        const ip = await clientIp(req)
        if (isRateLimited(ip)) return res.status(429).json(ZU_VIELE)
        let ok = false
        try {
            if (await codeGesperrt()) return res.status(429).json(CODE_GESPERRT)
            ok = await loeseTotpEin(req.body?.code)
            if (ok) await codeFehlerLoeschen()
            else await zaehleCodeFehler()
        } catch (e) {
            logWarn('auth', 'App-Code-Prüfung fehlgeschlagen', e)
            return res.status(500).json({ error: 'Prüfung fehlgeschlagen.' })
        }
        if (!ok) {
            registerFailure(ip)
            return res.status(401).json({ error: 'Code falsch oder schon benutzt.' })
        }
        clearFailures(ip)
        res.setHeader('Set-Cookie', [getSessionCookieString(req, halb.remember), zweitLoeschString(req)])
        res.json({ ok: true })
    })

    // Logout (öffentlich): Cookie löschen
    app.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', [getClearCookieString(req), zweitLoeschString(req)])
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

    // Passwort vergessen / Reset (öffentlich, aber NUR von localhost und mit
    // dem Rücksetzcode aus dem Server-Log). Kein aktuelles Passwort nötig —
    // wer am Server sitzt UND dessen Log lesen kann, gilt als Eigentümer.
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
        /*
         * Vierter Riegel seit dem Audit vom 26.10.2026 (SEC-SRV-009): der
         * Einmal-Code aus dem Server-Log. Ohne Code wird er dort ausgegeben
         * und die Oberfläche fragt danach; ein falscher zählt als Fehlversuch.
         */
        const code = req.body?.code
        if (!code) {
            meldeRuecksetzCode()
            return res.status(403).json({
                error: 'Rücksetzcode erforderlich. Er steht jetzt im Server-Log (Terminal bzw. Container-Protokoll).',
                codeNoetig: true,
            })
        }
        const ip = await clientIp(req)
        if (isRateLimited(ip)) return res.status(429).json(ZU_VIELE)
        if (!ruecksetzCodePasst(code)) {
            registerFailure(ip)
            return res.status(403).json({ error: 'Rücksetzcode falsch oder abgelaufen.', codeNoetig: true })
        }
        ruecksetzCode = null   // einmal
        clearFailures(ip)
        try {
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 0,
                authPasswordHash: '',
                updatedAt: knex.fn.now()
            })
            // App-Code und YubiKeys gehören zum Zugang: ohne sie kein Aussperren.
            await loescheZweitenFaktor(knex)
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
            /*
             * Seit dem zweiten Faktor (30.10.2026) auch App-Code und
             * Schlüssel weg — ein später neu gesetztes Passwort fände sonst
             * einen alten YubiKey vor, an den keiner mehr denkt —, und alle
             * Sitzungen entwertet. Der Aufrufer bekommt ein frisches Cookie.
             */
            await loescheZweitenFaktor(knex)
            await loadAuthConfig()
            await entwerteAlleSitzungen()
            res.setHeader('Set-Cookie', getSessionCookieString(req))
            res.json({ ok: true, authEnabled: false })
        } catch (e) {
            res.status(500).json({ error: e.message || 'Fehler beim Deaktivieren.' })
        }
    })

    setupZweitfaktorRouten(app)
    setupSchluesselRouten(app)
}

// ==================== Zweiter Faktor: App-Code (TOTP) ====================

/** Welche zweiten Faktoren dieser Aufruf anbieten kann. */
function zweiteFaktorenFuer(req) {
    const arten = []
    if (authConfig.totpAn) arten.push('totp')
    // Der YubiKey nur, wenn er unter DIESEM Namen registriert ist — über die
    // IP aufgerufen bleibt dann nur der App-Code.
    const k = schluesselKontextFuer(req)
    if (k.rpId && (authConfig.schluessel.get(k.rpId) || 0) > 0) arten.push('schluessel')
    return arten
}

/**
 * Eingegebenen App-Code gegen das gespeicherte Geheimnis prüfen und den
 * Schritt verbrauchen.
 *
 * Das Verbrauchen ist ein bedingtes UPDATE („nur wenn der gespeicherte
 * Schritt kleiner ist"): melden sich zwei Prozesse an derselben PostgreSQL
 * gleichzeitig mit demselben Code an, gewinnt genau einer.
 */
async function loeseTotpEin(code) {
    const knex = getKnex()
    const row = await knex('settings').select('totpGeheimnis', 'totpLetzterSchritt').where('id', 1).first()
    const geheimnis = row?.totpGeheimnis ? decrypt(row.totpGeheimnis) : ''
    if (!geheimnis) return false
    const schritt = pruefeTotp(geheimnis, code, { letzterSchritt: Number(row.totpLetzterSchritt) || 0 })
    if (schritt === null) return false
    const n = await knex('settings').where('id', 1).where('totpLetzterSchritt', '<', schritt)
        .update({ totpLetzterSchritt: schritt })
    return Number(n) === 1
}

/*
 * Kontoweite Bremse für den App-Code (Audit 4.3.4 SEC-S1-003).
 *
 * Die Sperre je Adresse (5 Fehlversuche → 5 min) und die globale Bremse
 * (60/min) zählen nur im Prozessspeicher. Wer das Passwort kannte, holte sich
 * ein Halb-Cookie und riet von zwölf Adressen je fünf Codes: 60 Codes je
 * Minute, ≈ 23 % Treffer am Tag. Jetzt zählt die Datenbank ALLE falschen
 * Codes, über Adressen und Prozesse hinweg: CODE_FEHL_MAX in CODE_FENSTER_MS
 * sperren den Code-Schritt für CODE_SPERRE_MS — ≈ 1000 Versuche am Tag statt
 * 86 000, ein Treffer wird damit unwahrscheinlich (≈ 0,3 %/Tag).
 *
 * Der Preis: während eines Angriffs wartet auch der Eigentümer auf den Code.
 * Ein eingerichteter YubiKey zählt nicht dazu und meldet weiter an.
 */
const CODE_FEHL_MAX = 10
const CODE_FENSTER_MS = 15 * 60 * 1000
const CODE_SPERRE_MS = 15 * 60 * 1000
const CODE_GESPERRT = {
    error: 'Zu viele falsche App-Codes. Die Code-Eingabe ist für 15 Minuten gesperrt (ein eingerichteter YubiKey geht weiter).',
    codeGesperrt: true,
}

/** Ist der Code-Schritt kontoweit gesperrt? */
async function codeGesperrt(jetzt = Date.now()) {
    const row = await getKnex()('settings').select('totpSperreBis').where('id', 1).first()
    return (Number(row?.totpSperreBis) || 0) > jetzt
}

/** Einen falschen Code kontoweit zählen; beim CODE_FEHL_MAX-ten sperren. */
async function zaehleCodeFehler(jetzt = Date.now()) {
    const knex = getKnex()
    const row = await knex('settings').select('totpFehlAb').where('id', 1).first()
    const ab = Number(row?.totpFehlAb) || 0
    if (!ab || jetzt - ab > CODE_FENSTER_MS) {
        // Neues Fenster. Zwei Prozesse, die das gleichzeitig tun, verlieren
        // höchstens einen Zähler — die Sperre kommt dann einen Versuch später.
        await knex('settings').where('id', 1).update({ totpFehlZahl: 1, totpFehlAb: jetzt })
        return
    }
    // Hochzählen in der Datenbank, nicht gelesen + 1: zwei Prozesse zählen beide.
    await knex('settings').where('id', 1).increment('totpFehlZahl', 1)
    const n = Number((await knex('settings').select('totpFehlZahl').where('id', 1).first())?.totpFehlZahl) || 0
    if (n >= CODE_FEHL_MAX) {
        await knex('settings').where('id', 1).update({ totpSperreBis: jetzt + CODE_SPERRE_MS, totpFehlZahl: 0, totpFehlAb: 0 })
        logWarn('auth', `App-Code: ${n} falsche Codes in 15 Minuten — Code-Eingabe für 15 Minuten gesperrt`)
    }
}

/** Nach einem richtigen Code: Zähler zurück (eine laufende Sperre gibt es dann nicht). */
async function codeFehlerLoeschen() {
    await getKnex()('settings').where('id', 1).update({ totpFehlZahl: 0, totpFehlAb: 0 })
}

/** Antwort, wenn ohne Passwort-Gate etwas am zweiten Faktor geändert werden soll. */
const OHNE_GATE = { error: 'Zuerst den Passwortschutz aktivieren — der zweite Faktor ergänzt das Passwort.' }

/**
 * Aktuelles Passwort für eine Änderung am zweiten Faktor prüfen.
 *
 * @returns {Promise<boolean>} false = Antwort ist schon gesendet
 */
async function passwortFuerAenderung(req, res) {
    const ergebnis = await pruefeMitZaehler(req, req.body?.currentPassword || '')
    if (ergebnis === 'gesperrt') { res.status(429).json(ZU_VIELE); return false }
    if (ergebnis === 'falsch') { res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' }); return false }
    return true
}

/**
 * Nach dem Einschalten eines zweiten Faktors: alle Sitzungen entwerten,
 * dem Aufrufer ein frisches Cookie. Sonst gälten alte 30-Tage-Cookies weiter,
 * die nur mit dem Passwort entstanden sind — genau das soll der zweite
 * Faktor ja ausschliessen.
 */
async function nachEinschalten(req, res) {
    await loadAuthConfig()
    await entwerteAlleSitzungen()
    res.setHeader('Set-Cookie', getSessionCookieString(req))
}

function setupZweitfaktorRouten(app) {
    // Neues Geheimnis anlegen (noch NICHT aktiv). Geschützt durch die Sitzung.
    app.post('/api/auth/totp/einrichten', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        try {
            const knex = getKnex()
            const row = await knex('settings').select('totpAn').where('id', 1).first()
            // Ein aktives Geheimnis wird nicht stillschweigend ersetzt: das
            // Handy zeigte dann Codes, die nicht mehr gelten.
            if (row?.totpAn) return res.status(409).json({ error: 'Der App-Code ist schon aktiv. Zum Neueinrichten zuerst ausschalten.' })
            const geheimnis = neuesTotpGeheimnis()
            await knex('settings').where('id', 1).update({ totpGeheimnis: encrypt(geheimnis), totpAn: 0, totpLetzterSchritt: 0 })
            res.json({ ok: true, geheimnis, uri: otpauthUri(geheimnis) })
        } catch (e) {
            logWarn('auth', 'App-Code einrichten fehlgeschlagen', e)
            res.status(500).json({ error: 'Einrichten fehlgeschlagen.' })
        }
    })

    // Mit dem ersten Code aus der App bestätigen — erst dann gilt er.
    app.post('/api/auth/totp/bestaetigen', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        try {
            if (!(await passwortFuerAenderung(req, res))) return
            const knex = getKnex()
            const row = await knex('settings').select('totpGeheimnis', 'totpAn').where('id', 1).first()
            if (row?.totpAn) return res.status(409).json({ error: 'Der App-Code ist schon aktiv.' })
            const geheimnis = row?.totpGeheimnis ? decrypt(row.totpGeheimnis) : ''
            if (!geheimnis) return res.status(409).json({ error: 'Zuerst „Einrichten" wählen.' })
            const schritt = pruefeTotp(geheimnis, req.body?.code)
            if (schritt === null) {
                return res.status(400).json({ error: 'Der Code passt nicht. Uhrzeit von Handy und Server prüfen und den nächsten Code versuchen.' })
            }
            // Frisch eingerichtet: eine alte Code-Sperre oder ein alter Zähler gilt nicht weiter.
            await knex('settings').where('id', 1).update({ totpAn: 1, totpLetzterSchritt: schritt, totpFehlZahl: 0, totpFehlAb: 0, totpSperreBis: 0 })
            await nachEinschalten(req, res)
            res.json({ ok: true, sitzungenEntwertet: true })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            logWarn('auth', 'App-Code bestätigen fehlgeschlagen', e)
            res.status(500).json({ error: 'Bestätigen fehlgeschlagen.' })
        }
    })

    // Ausschalten (aktuelles Passwort nötig). Schlüssel bleiben.
    app.post('/api/auth/totp/aus', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        try {
            if (!(await passwortFuerAenderung(req, res))) return
            const knex = getKnex()
            await knex('settings').where('id', 1).update({ totpAn: 0, totpGeheimnis: '', totpLetzterSchritt: 0 })
            await loadAuthConfig()
            res.json({ ok: true })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            logWarn('auth', 'App-Code ausschalten fehlgeschlagen', e)
            res.status(500).json({ error: 'Ausschalten fehlgeschlagen.' })
        }
    })
}

// ==================== Zweiter Faktor: YubiKey (WebAuthn) ====================

/** RP-ID und Origin dieses Aufrufs — oder warum er keinen Schlüssel kann. */
function schluesselKontextFuer(req) {
    return schluesselKontext({ host: req.headers?.host, https: isHttps(req), erlaubteNamen: zusatzHosts() })
}

/**
 * Adresse, unter der der YubiKey geht: ein Name, den der Host-Schutz kennt,
 * über HTTPS. Nur ein Hinweis für die Oberfläche, wenn die App über die IP
 * geöffnet wurde.
 *
 * Seit Audit 4.3.4 (FUN-S1-004) nur noch Namen, die wirklich durchkommen:
 * der aktive mDNS-Name (`mdnsNameAktiv`), sonst der erste Name (keine IP) aus
 * AT_ALLOWED_HOSTS. Ohne solchen Namen gibt es keine Adresse — die Oberfläche
 * nennt dann AT_MDNS_NAME/AT_ALLOWED_HOSTS. Der Port kommt aus dem Host-Kopf,
 * wenn die Anfrage schon über HTTPS kam (im Container ist 8443 nur der innere
 * Port, das Mapping kann ihn ändern); sonst aus `tlsPort()`.
 *
 * @param {import('express').Request} [req]
 */
function schluesselAdresse(req) {
    const name = mdnsNameAktiv() || erlaubteHostsAusUmgebung().find((h) => !net.isIP(h.replace(/^\[|\]$/g, '')) && !h.includes(':')) || null
    if (!name) return null
    let port = null
    const kopf = String(req?.headers?.host || '')
    const m = kopf.match(/:(\d+)$/)
    if (req && isHttps(req)) port = m ? Number(m[1]) : 443
    else port = tlsPort()
    if (!port) return null
    return `https://${name}${port === 443 ? '' : `:${port}`}`
}

const CHALLENGE_GUELTIG_MS = WARTEN_MS
const MAX_SCHLUESSEL = 10
const challengeZweck = () => `tn_webauthn_v1:${sessionGeneration}`

/** Signierte Challenge für eine Verwendung (`login-zweit`, `login-direkt`, `registrieren`). */
function neueChallenge(verwendung, rpId) {
    return signiere(kurzzeitBasis(), challengeZweck(), { v: verwendung, h: rpId, i: zufallsId() }, CHALLENGE_GUELTIG_MS)
}

/**
 * Challenge einlösen — genau einmal.
 *
 * Bedingtes UPDATE auf den gelesenen Merker: zwei Prozesse an derselben
 * PostgreSQL, die dieselbe Antwort gleichzeitig prüfen, schreiben nicht
 * beide durch. Der Verlierer bekommt false, wie bei einer Wiederholung.
 */
async function loeseChallengeEin(daten) {
    const knex = getKnex()
    const row = await knex('settings').select('webauthnVerbraucht').where('id', 1).first()
    const alt = row?.webauthnVerbraucht || ''
    let liste = []
    try { liste = JSON.parse(alt || '[]') } catch { liste = [] }
    const neu = verbrauche(liste, daten.i, daten.ablauf)
    if (!neu) return false
    const n = await knex('settings').where('id', 1)
        .where((q) => (alt ? q.where('webauthnVerbraucht', alt) : q.whereNull('webauthnVerbraucht').orWhere('webauthnVerbraucht', '')))
        .update({ webauthnVerbraucht: JSON.stringify(neu) })
    return Number(n) === 1
}

/** Antwort, wenn „Anmelden nur mit dem YubiKey" ausgeschaltet ist (SEC-S1-002). */
const DIREKT_AUS = { error: 'Die Anmeldung nur mit dem YubiKey ist ausgeschaltet. Bitte mit dem Passwort anmelden.', grund: 'direktAus' }

/** Gründe, warum der Aufruf keinen Schlüssel kann, als Text für die Oberfläche. */
const KONTEXT_TEXT = {
    ip: 'Über eine IP-Adresse geht der YubiKey nicht. Bitte die App über ihren Namen öffnen (AT_MDNS_NAME bzw. AT_ALLOWED_HOSTS).',
    name: 'Unter diesem Namen geht der YubiKey nicht (nur localhost, AT_MDNS_NAME oder AT_ALLOWED_HOSTS).',
    unsicher: 'Der YubiKey braucht HTTPS.',
    fehlt: 'Unbekannter Host.',
}
function kontextFehler(req, res, k) {
    return res.status(409).json({ error: KONTEXT_TEXT[k.grund] || KONTEXT_TEXT.fehlt, grund: k.grund, adresse: schluesselAdresse(req) })
}

/** Schlüssel einer RP-ID aus der Datenbank. */
function schluesselFuer(rpId) {
    return getKnex()('auth_schluessel').where('rpId', rpId).orderBy('id')
}

function sauberName(name) {
    return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || 'Sicherheitsschlüssel'
}

function setupSchluesselRouten(app) {
    /*
     * Login-Optionen (öffentlich). `verwendung: 'zweit'` braucht das
     * Halb-Cookie (Passwort war schon richtig), `'direkt'` ist der
     * passwortlose Login: Schlüssel einstecken, antippen, angemeldet.
     *
     * Den passwortlosen Login gibt es seit Audit 4.3.4 (SEC-S1-002) nur mit
     * dem Schalter `schluesselDirekt`, ab Werk aus — auch für Installationen,
     * die schon einen Schlüssel registriert hatten. Ohne Schalter ersetzte
     * ein Schlüssel Passwort UND App-Code: wer ihn in die Hand bekam und die
     * App erreichte, war angemeldet, ohne PIN. Geprüft wird hier und beim
     * Einlösen (eine vorher ausgestellte Challenge gilt nach dem Ausschalten
     * nicht mehr).
     */
    app.post('/api/login/schluessel/optionen', async (req, res) => {
        if (!req.is('application/json')) return res.status(415).json({ error: 'Nur aus der App heraus.' })
        await frischeAuthConfig()
        if (!authConfig.enabled) return res.status(409).json({ error: 'Kein Passwortschutz aktiv.' })
        const k = schluesselKontextFuer(req)
        if (!k.rpId) return kontextFehler(req, res, k)
        const zweit = req.body?.verwendung === 'zweit'
        if (!zweit && !authConfig.schluesselDirekt) return res.status(409).json(DIREKT_AUS)
        if (zweit && !halbAngemeldet(req)) {
            return res.status(401).json({ error: 'Anmeldung abgelaufen. Bitte das Passwort erneut eingeben.', neuAnmelden: true })
        }
        const ip = await clientIp(req)
        if (isRateLimited(ip)) return res.status(429).json(ZU_VIELE)
        try {
            const schluessel = await schluesselFuer(k.rpId)
            if (!schluessel.length) return res.status(409).json({ error: 'Für diese Adresse ist kein Schlüssel registriert.', grund: 'keiner' })
            const challenge = neueChallenge(zweit ? 'login-zweit' : 'login-direkt', k.rpId)
            res.json({ optionen: await loginOptionen({ rpId: k.rpId, challenge, schluessel }) })
        } catch (e) {
            logWarn('auth', 'Schlüssel-Optionen fehlgeschlagen', e)
            res.status(500).json({ error: 'Optionen fehlgeschlagen.' })
        }
    })

    // Antwort des Schlüssels prüfen (öffentlich) → bei Erfolg die Sitzung.
    app.post('/api/login/schluessel/pruefen', async (req, res) => {
        if (!req.is('application/json')) return res.status(415).json({ error: 'Nur aus der App heraus.' })
        await frischeAuthConfig()
        if (!authConfig.enabled) return res.status(409).json({ error: 'Kein Passwortschutz aktiv.' })
        const k = schluesselKontextFuer(req)
        if (!k.rpId) return kontextFehler(req, res, k)
        const ip = await clientIp(req)
        if (isRateLimited(ip)) return res.status(429).json(ZU_VIELE)
        const abweisen = (text, grund) => { registerFailure(ip); return res.status(401).json({ error: text, grund }) }
        try {
            const antwort = req.body?.antwort
            const token = tokenAusAntwort(antwort)
            const d = token ? pruefeSigniert(kurzzeitBasis(), challengeZweck(), token) : null
            if (!d) return abweisen('Zeit abgelaufen. Bitte noch einmal.', 'abgelaufen')
            if (d.h !== k.rpId || (d.v !== 'login-zweit' && d.v !== 'login-direkt')) return abweisen('Anfrage passt nicht.', 'falsch')
            if (d.v === 'login-direkt' && !authConfig.schluesselDirekt) return res.status(409).json(DIREKT_AUS)
            let remember = req.body?.remember !== false
            if (d.v === 'login-zweit') {
                const halb = halbAngemeldet(req)
                if (!halb) return res.status(401).json({ error: 'Anmeldung abgelaufen. Bitte das Passwort erneut eingeben.', neuAnmelden: true })
                remember = halb.remember
            }
            const schluessel = typeof antwort?.id === 'string'
                ? await getKnex()('auth_schluessel').where({ credentialId: antwort.id, rpId: k.rpId }).first()
                : null
            if (!schluessel) return abweisen('Dieser Schlüssel ist hier nicht registriert.', 'unbekannt')
            const erg = await pruefeLogin({ antwort, token, origin: k.origin, rpId: k.rpId, schluessel })
            if (!erg) return abweisen('Der Schlüssel wurde nicht angenommen.', 'falsch')
            if (!(await loeseChallengeEin(d))) return abweisen('Diese Anfrage wurde schon benutzt.', 'verbraucht')
            // Zähler nachführen — bedingt auf den gelesenen Stand (siehe loeseChallengeEin).
            const n = await getKnex()('auth_schluessel').where({ id: schluessel.id, signCount: schluessel.signCount })
                .update({ signCount: erg.neuerZaehler, zuletztAm: Date.now() })
            if (Number(n) !== 1) return abweisen('Der Schlüssel wurde nicht angenommen.', 'falsch')
            clearFailures(ip)
            res.setHeader('Set-Cookie', [getSessionCookieString(req, remember), zweitLoeschString(req)])
            res.json({ ok: true })
        } catch (e) {
            logWarn('auth', 'Schlüssel-Prüfung fehlgeschlagen', e)
            res.status(500).json({ error: 'Prüfung fehlgeschlagen.' })
        }
    })

    // ── Hinter der Sitzung: verwalten ──

    app.get('/api/auth/schluessel', async (req, res) => {
        try {
            const zeilen = await getKnex()('auth_schluessel')
                .select('id', 'name', 'rpId', 'transports', 'erstelltAm', 'zuletztAm').orderBy('id')
            const k = schluesselKontextFuer(req)
            res.json({
                // Ohne Schlüsseldaten: Kennung und öffentlicher Schlüssel bleiben in der DB.
                schluessel: zeilen.map((z) => ({ ...z, transports: leseTransports(z.transports), hier: z.rpId === k.rpId })),
                kontext: k.rpId ? 'ok' : k.grund,
                rpId: k.rpId || null,
                adresse: schluesselAdresse(req),
                gate: authConfig.enabled,
                direkt: authConfig.schluesselDirekt,
            })
        } catch (e) {
            res.status(500).json({ error: 'Liste fehlgeschlagen.' })
        }
    })

    /*
     * Schalter „Anmelden nur mit dem YubiKey" (SEC-S1-002). Einschalten
     * verlangt das aktuelle Passwort — es macht den Schlüssel zum alleinigen
     * Zugang. Ausschalten nicht: es nimmt nur etwas weg.
     */
    app.post('/api/auth/schluessel/direkt', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        try {
            const an = req.body?.an === true
            if (an && !(await passwortFuerAenderung(req, res))) return
            await getKnex()('settings').where('id', 1).update({ schluesselDirekt: an ? 1 : 0 })
            await loadAuthConfig()
            res.json({ ok: true, direkt: authConfig.schluesselDirekt })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            logWarn('auth', 'Schalter Direkt-Login fehlgeschlagen', e)
            res.status(500).json({ error: 'Speichern fehlgeschlagen.' })
        }
    })

    app.post('/api/auth/schluessel/registrieren/optionen', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        const k = schluesselKontextFuer(req)
        if (!k.rpId) return kontextFehler(req, res, k)
        try {
            const vorhandene = await schluesselFuer(k.rpId)
            if (schluesselGesamt() >= MAX_SCHLUESSEL) return res.status(409).json({ error: `Höchstens ${MAX_SCHLUESSEL} Schlüssel.` })
            const challenge = neueChallenge('registrieren', k.rpId)
            res.json({ optionen: await registrierOptionen({ rpId: k.rpId, challenge, vorhandene }) })
        } catch (e) {
            logWarn('auth', 'Registrier-Optionen fehlgeschlagen', e)
            res.status(500).json({ error: 'Optionen fehlgeschlagen.' })
        }
    })

    app.post('/api/auth/schluessel/registrieren', async (req, res) => {
        if (!authConfig.enabled) return res.status(409).json(OHNE_GATE)
        const k = schluesselKontextFuer(req)
        if (!k.rpId) return kontextFehler(req, res, k)
        try {
            if (!(await passwortFuerAenderung(req, res))) return
            const antwort = req.body?.antwort
            const token = tokenAusAntwort(antwort)
            const d = token ? pruefeSigniert(kurzzeitBasis(), challengeZweck(), token) : null
            if (!d) return res.status(400).json({ error: 'Zeit abgelaufen. Bitte noch einmal.', grund: 'abgelaufen' })
            if (d.v !== 'registrieren' || d.h !== k.rpId) return res.status(400).json({ error: 'Anfrage passt nicht.', grund: 'falsch' })
            const neu = await pruefeRegistrierung({ antwort, token, origin: k.origin, rpId: k.rpId })
            if (!neu) return res.status(400).json({ error: 'Der Schlüssel wurde nicht angenommen.', grund: 'falsch' })
            if (!(await loeseChallengeEin(d))) return res.status(400).json({ error: 'Diese Anfrage wurde schon benutzt.', grund: 'verbraucht' })
            const knex = getKnex()
            if (await knex('auth_schluessel').where('credentialId', neu.credentialId).first()) {
                return res.status(409).json({ error: 'Dieser Schlüssel ist schon registriert.', grund: 'doppelt' })
            }
            // Der erste Schlüssel schaltet den zweiten Faktor ein (wenn der App-Code es nicht schon tat).
            const schaltetEin = !zweiFaktorAktiv()
            await knex('auth_schluessel').insert({
                credentialId: neu.credentialId,
                publicKey: neu.publicKey,
                signCount: neu.signCount,
                transports: JSON.stringify(neu.transports || []),
                name: sauberName(req.body?.name),
                rpId: k.rpId,
                erstelltAm: Date.now(),
            })
            if (schaltetEin) await nachEinschalten(req, res)
            else await loadAuthConfig()
            res.json({ ok: true, sitzungenEntwertet: schaltetEin })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            logWarn('auth', 'Schlüssel registrieren fehlgeschlagen', e)
            res.status(500).json({ error: 'Registrieren fehlgeschlagen.' })
        }
    })

    app.put('/api/auth/schluessel/:id', async (req, res) => {
        try {
            const n = await getKnex()('auth_schluessel').where('id', Number(req.params.id) || 0).update({ name: sauberName(req.body?.name) })
            if (!Number(n)) return res.status(404).json({ error: 'Schlüssel nicht gefunden.' })
            res.json({ ok: true })
        } catch (e) {
            res.status(500).json({ error: 'Umbenennen fehlgeschlagen.' })
        }
    })

    app.delete('/api/auth/schluessel/:id', async (req, res) => {
        try {
            if (authConfig.enabled && !(await passwortFuerAenderung(req, res))) return
            const n = await getKnex()('auth_schluessel').where('id', Number(req.params.id) || 0).del()
            if (!Number(n)) return res.status(404).json({ error: 'Schlüssel nicht gefunden.' })
            await loadAuthConfig()
            res.json({ ok: true })
        } catch (e) {
            if (e.status === 429) return res.status(429).json(ZU_VIELE)
            res.status(500).json({ error: 'Entfernen fehlgeschlagen.' })
        }
    })
}
