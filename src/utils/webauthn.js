/**
 * YubiKey im Browser: die native `navigator.credentials`-API mit kleinen
 * base64url-Helfern. Der Server (`server/webauthn.js`) schickt die Optionen
 * als JSON (Bytes base64url), der Browser braucht ArrayBuffer — und
 * umgekehrt für die Antwort. Keine Bibliothek.
 */

/** base64url → ArrayBuffer */
export function ausB64url(text) {
    const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/')
    const roh = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
    const bytes = new Uint8Array(roh.length)
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
    return bytes.buffer
}

/** ArrayBuffer/Uint8Array → base64url */
export function zuB64url(puffer) {
    const bytes = puffer instanceof Uint8Array ? puffer : new Uint8Array(puffer)
    let roh = ''
    for (let i = 0; i < bytes.length; i++) roh += String.fromCharCode(bytes[i])
    return btoa(roh).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Kann dieser Browser hier überhaupt einen Sicherheitsschlüssel fragen? */
export function schluesselMoeglich() {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!window.isSecureContext
}

/**
 * Fehler des Browsers in einen Grund übersetzen (für die i18n-Texte).
 * NotAllowedError heisst beides: abgebrochen oder Zeit abgelaufen — der
 * Browser unterscheidet es absichtlich nicht.
 */
function grundAus(e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return 'abgebrochen'
    if (e?.name === 'InvalidStateError') return 'schonRegistriert'
    if (e?.name === 'SecurityError') return 'unsicher'
    return 'unbekannt'
}

function mitGrund(e) {
    const f = new Error(e?.message || 'WebAuthn')
    f.grund = grundAus(e)
    return f
}

const kennungen = (liste) => (liste || []).map((c) => ({ ...c, id: ausB64url(c.id) }))

/** Neuen Schlüssel anlegen (Optionen vom Server) → Antwort als JSON für den Server. */
export async function schluesselAnlegen(optionen) {
    if (!schluesselMoeglich()) { const f = new Error('kein sicherer Kontext'); f.grund = 'unsicher'; throw f }
    let c
    try {
        c = await navigator.credentials.create({
            publicKey: {
                ...optionen,
                challenge: ausB64url(optionen.challenge),
                user: { ...optionen.user, id: ausB64url(optionen.user.id) },
                excludeCredentials: kennungen(optionen.excludeCredentials),
            },
        })
    } catch (e) { throw mitGrund(e) }
    const r = c.response
    return {
        id: c.id,
        rawId: zuB64url(c.rawId),
        type: c.type,
        response: {
            clientDataJSON: zuB64url(r.clientDataJSON),
            attestationObject: zuB64url(r.attestationObject),
            transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
        },
        clientExtensionResults: c.getClientExtensionResults?.() || {},
        authenticatorAttachment: c.authenticatorAttachment || undefined,
    }
}

/** Mit einem registrierten Schlüssel anmelden → Antwort als JSON für den Server. */
export async function schluesselAntippen(optionen) {
    if (!schluesselMoeglich()) { const f = new Error('kein sicherer Kontext'); f.grund = 'unsicher'; throw f }
    let c
    try {
        c = await navigator.credentials.get({
            publicKey: {
                ...optionen,
                challenge: ausB64url(optionen.challenge),
                allowCredentials: kennungen(optionen.allowCredentials),
            },
        })
    } catch (e) { throw mitGrund(e) }
    const r = c.response
    return {
        id: c.id,
        rawId: zuB64url(c.rawId),
        type: c.type,
        response: {
            clientDataJSON: zuB64url(r.clientDataJSON),
            authenticatorData: zuB64url(r.authenticatorData),
            signature: zuB64url(r.signature),
            userHandle: r.userHandle ? zuB64url(r.userHandle) : undefined,
        },
        clientExtensionResults: c.getClientExtensionResults?.() || {},
        authenticatorAttachment: c.authenticatorAttachment || undefined,
    }
}

/*
 * Die Login-Seite fragt unter autarktrade.local sofort nach dem YubiKey —
 * nur nicht direkt nach einem Abmelden, sonst stünde der Dialog wieder da,
 * kaum dass man ihn verlassen hat. Der Merker lebt im sessionStorage des Tabs
 * und gilt für genau einen Seitenaufbau.
 */
const ABGEMELDET = 'at.abgemeldet'

export function merkeAbmeldung() {
    try { sessionStorage.setItem(ABGEMELDET, '1') } catch (_) { /* privater Modus */ }
}

/** War der letzte Schritt ein Abmelden? Liest den Merker und löscht ihn. */
export function frischAbgemeldet() {
    try {
        const war = sessionStorage.getItem(ABGEMELDET) === '1'
        sessionStorage.removeItem(ABGEMELDET)
        return war
    } catch (_) {
        return false
    }
}
