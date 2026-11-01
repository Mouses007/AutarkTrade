/**
 * YubiKey / Passkey (WebAuthn) — Optionen erzeugen und Antworten prüfen.
 *
 * Die Kryptographie (CBOR, COSE, Signaturprüfung, Attestation) macht
 * `@simplewebauthn/server` (MIT). Hier steht nur, was AutarkTrade dazu
 * entscheidet; die Routen und die Datenbank liegen in `auth.js`.
 *
 * - Attestation `none`: wir wollen wissen, DASS es derselbe Schlüssel ist,
 *   nicht welches Modell — dafür bräuchte es Herstellerzertifikate.
 * - `userVerification: 'discouraged'`: nur antippen, keine PIN. Der Schlüssel
 *   ist der zweite Faktor bzw. beim Direkt-Login der Besitz-Nachweis. Den
 *   Direkt-Login (Schlüssel ersetzt Passwort und App-Code) gibt es nur mit
 *   dem Schalter `settings.schluesselDirekt`, ab Werk aus (Audit 4.3.4
 *   SEC-S1-002, geprüft in `auth.js`).
 * - Keine residenten Schlüssel: es gibt nur einen Benutzer, also schickt der
 *   Server beim Login ALLE gespeicherten Kennungen als `allowCredentials`. So
 *   reicht ein Klick ohne Benutzernamen, und der YubiKey verlangt keine PIN
 *   (die er für residente Schlüssel ab Firmware 5.7 immer will).
 *
 * RP-ID ist der Hostname der Anfrage — aber nur ein NAME, nie eine IP
 * (WebAuthn lässt IP-Adressen als RP-ID nicht zu, und eine IP kann jeder
 * im Netz annehmen). Erlaubt sind `localhost` und die Namen, die der
 * Host-Schutz ausdrücklich kennt (`AT_MDNS_NAME`, `AT_ALLOWED_HOSTS`).
 * Ein Schlüssel ist an die RP-ID gebunden, unter der er registriert wurde:
 * über autarktrade.local registriert, gilt er nur dort.
 */
import net from 'net'
import {
    generateRegistrationOptions, verifyRegistrationResponse,
    generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'

const RP_NAME = 'AutarkTrade'
// Fester Benutzer: Einzelbenutzer-App. Ein zweiter Schlüssel ersetzt so
// nichts auf dem YubiKey, er kommt dazu (nicht resident, also ohnehin nichts gespeichert).
const BENUTZER_ID = new TextEncoder().encode('autarktrade-eigentuemer')
/** Wie lange der Browser auf das Antippen wartet. */
export const WARTEN_MS = 120 * 1000

/**
 * Taugt dieser Aufruf für einen Sicherheitsschlüssel?
 *
 * @param {object} p
 * @param {string} p.host            Host-Kopf der Anfrage (mit Port)
 * @param {boolean} p.https          kam die Anfrage über HTTPS
 * @param {string[]} p.erlaubteNamen zusätzlich erlaubte Namen (klein geschrieben)
 * @returns {{rpId: string, origin: string} | {grund: 'fehlt'|'ip'|'name'|'unsicher'}}
 */
export function schluesselKontext({ host, https, erlaubteNamen = [] }) {
    const roh = String(host ?? '').trim().toLowerCase()
    if (!roh) return { grund: 'fehlt' }
    if (roh.startsWith('[')) return { grund: 'ip' }               // IPv6-Literal
    const [name0, port0] = roh.split(':')
    const name = name0.replace(/\.$/, '')
    if (!name || net.isIP(name)) return { grund: 'ip' }
    if (name !== 'localhost' && !erlaubteNamen.filter((n) => !net.isIP(n)).includes(name)) return { grund: 'name' }
    // Sicherer Kontext: HTTPS, oder localhost (dort lässt der Browser WebAuthn auch über http zu).
    if (!https && name !== 'localhost') return { grund: 'unsicher' }
    const proto = https ? 'https' : 'http'
    const standard = https ? '443' : '80'
    const port = port0 && port0 !== standard ? `:${port0}` : ''
    return { rpId: name, origin: `${proto}://${name}${port}` }
}

/** Kennungen als Liste für exclude-/allowCredentials. */
function kennungen(schluessel) {
    return schluessel.map((s) => ({ id: s.credentialId, transports: leseTransports(s.transports) }))
}

export function leseTransports(wert) {
    try {
        const t = typeof wert === 'string' ? JSON.parse(wert || '[]') : wert
        return Array.isArray(t) ? t.filter((x) => typeof x === 'string').slice(0, 8) : []
    } catch {
        return []
    }
}

/**
 * Optionen zum Registrieren eines neuen Schlüssels.
 *
 * @param {string} challenge  signiertes Token (`auth.js`), wird als UTF-8 zur Challenge
 * @param {Array} vorhandene  schon registrierte Schlüssel derselben RP-ID (nicht doppelt anlegen)
 */
export function registrierOptionen({ rpId, challenge, vorhandene = [] }) {
    return generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userName: 'AutarkTrade',
        userDisplayName: 'AutarkTrade',
        userID: BENUTZER_ID,
        challenge,
        timeout: WARTEN_MS,
        attestationType: 'none',
        excludeCredentials: kennungen(vorhandene),
        authenticatorSelection: { residentKey: 'discouraged', requireResidentKey: false, userVerification: 'discouraged' },
    })
}

/** Optionen zum Anmelden: alle Schlüssel dieser RP-ID, ohne PIN. */
export function loginOptionen({ rpId, challenge, schluessel }) {
    return generateAuthenticationOptions({
        rpID: rpId,
        challenge,
        timeout: WARTEN_MS,
        allowCredentials: kennungen(schluessel),
        userVerification: 'discouraged',
    })
}

/**
 * Challenge aus der Antwort des Browsers lesen (clientDataJSON.challenge).
 *
 * Die Challenge IST das signierte Token: der Server muss sich nichts merken,
 * und das Token kommt — vom Schlüssel mitsigniert — mit der Antwort zurück.
 *
 * @returns {string|null} das Token als Text
 */
export function tokenAusAntwort(antwort) {
    try {
        const cd = JSON.parse(Buffer.from(String(antwort?.response?.clientDataJSON || ''), 'base64url').toString('utf8'))
        if (typeof cd?.challenge !== 'string') return null
        return Buffer.from(cd.challenge, 'base64url').toString('utf8')
    } catch {
        return null
    }
}

const alsChallenge = (token) => Buffer.from(token, 'utf8').toString('base64url')

/**
 * Registrier-Antwort prüfen (Challenge, Origin, RP-ID, Signatur des Formats).
 *
 * @returns {Promise<{credentialId, publicKey, signCount, transports}|null>}
 */
export async function pruefeRegistrierung({ antwort, token, origin, rpId }) {
    let erg
    try {
        erg = await verifyRegistrationResponse({
            response: antwort,
            expectedChallenge: alsChallenge(token),
            expectedOrigin: origin,
            expectedRPID: rpId,
            requireUserVerification: false,
        })
    } catch {
        return null
    }
    if (!erg?.verified || !erg.registrationInfo?.credential) return null
    const c = erg.registrationInfo.credential
    return {
        credentialId: c.id,
        publicKey: Buffer.from(c.publicKey).toString('base64url'),
        signCount: Number(c.counter) || 0,
        transports: Array.isArray(c.transports) ? c.transports : leseTransports(antwort?.response?.transports),
    }
}

/**
 * Login-Antwort gegen einen gespeicherten Schlüssel prüfen.
 *
 * Der Zähler muss steigen (sofern der Schlüssel einen führt): ein
 * geklonter Schlüssel fällt dann auf, sobald beide benutzt wurden. YubiKeys
 * zählen; manche Passkeys melden immer 0, die lässt die Bibliothek durch.
 *
 * @returns {Promise<{neuerZaehler: number}|null>}
 */
export async function pruefeLogin({ antwort, token, origin, rpId, schluessel }) {
    let erg
    try {
        erg = await verifyAuthenticationResponse({
            response: antwort,
            expectedChallenge: alsChallenge(token),
            expectedOrigin: origin,
            expectedRPID: rpId,
            credential: {
                id: schluessel.credentialId,
                publicKey: new Uint8Array(Buffer.from(schluessel.publicKey, 'base64url')),
                counter: Number(schluessel.signCount) || 0,
                transports: leseTransports(schluessel.transports),
            },
            requireUserVerification: false,
        })
    } catch {
        return null
    }
    if (!erg?.verified) return null
    const neu = Number(erg.authenticationInfo?.newCounter) || 0
    const alt = Number(schluessel.signCount) || 0
    // Doppelt gesichert: die Bibliothek prüft das auch, aber diese Regel ist
    // zu wichtig, um sie einer fremden Voreinstellung zu überlassen.
    if ((neu > 0 || alt > 0) && neu <= alt) return null
    return { neuerZaehler: neu }
}
