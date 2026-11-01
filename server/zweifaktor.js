/**
 * Zweiter Faktor beim Anmelden — der reine Teil, ohne Datenbank und ohne
 * Express: Einmal-Codes aus einer Authenticator-App (TOTP) und signierte
 * Kurzzeit-Tokens für die Zwischenschritte des Logins.
 *
 * TOTP nach RFC 6238 (HOTP aus RFC 4226 über die Zeit): HMAC-SHA1, 30 s,
 * 6 Stellen, ±1 Schritt Spielraum für eine ungenaue Uhr. Eigene Umsetzung mit
 * Node-`crypto`, base32 aus dem vorhandenen `@scure/base`. Geprüft gegen die
 * Vektoren aus RFC 6238 Anhang B (`__selftest-zweifaktor.mjs`).
 *
 * Warum signierte Tokens statt Prozessspeicher: NAS-Container und
 * Entwicklungsrechner teilen sich eine PostgreSQL. Ein Login, dessen erster
 * Schritt in einem Prozess und dessen zweiter in einem anderen landet (oder
 * nach einem Neustart), fände einen Merker im Speicher nicht mehr. Das Token
 * trägt seinen Zustand selbst und ist mit dem Hauptgeheimnis signiert; die
 * Bindung an die Sitzungs-Generation steckt im Zweck (`auth.js`), so dass
 * „Überall abmelden" und ein Passwortwechsel auch laufende Zwischenschritte
 * entwerten.
 */
import crypto from 'crypto'
import { base32 } from '@scure/base'

// ==================== TOTP (RFC 6238) ====================

export const TOTP_PERIODE_S = 30
export const TOTP_STELLEN = 6
/** Spielraum in Schritten je Richtung (RFC 6238 §5.2 empfiehlt höchstens einen). */
export const TOTP_FENSTER = 1

/** Neues Geheimnis: 20 Zufallsbytes (160 Bit, RFC 4226 §4), base32 ohne Auffüllung. */
export function neuesTotpGeheimnis() {
    return base32.encode(crypto.randomBytes(20)).replace(/=+$/, '')
}

/**
 * base32-Text → Bytes. Apps zeigen das Geheimnis in Vierergruppen und klein;
 * Leerzeichen, Bindestriche und fehlende Auffüllung werden hier verziehen.
 *
 * @returns {Buffer|null} null bei ungültigem Text
 */
export function geheimnisBytes(text) {
    const s = String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
    if (!s || !/^[A-Z2-7]+$/.test(s)) return null
    try {
        return Buffer.from(base32.decode(s + '='.repeat((8 - (s.length % 8)) % 8)))
    } catch {
        return null
    }
}

/** Zeitschritt zu einem Zeitpunkt (ms). */
export function totpSchritt(jetztMs = Date.now(), periode = TOTP_PERIODE_S) {
    return Math.floor(jetztMs / 1000 / periode)
}

/**
 * HOTP-Wert eines Schritts (RFC 4226 §5.3, dynamische Kürzung).
 *
 * @param {Buffer} schluessel Geheimnis als Bytes
 * @param {number} schritt    Zähler (bei TOTP der Zeitschritt)
 * @param {number} stellen    6 in der App, 8 in den RFC-Vektoren
 * @param {string} algo       'sha1' in der App; 'sha256'/'sha512' nur für die Vektoren
 */
export function totpCode(schluessel, schritt, stellen = TOTP_STELLEN, algo = 'sha1') {
    const zaehler = Buffer.alloc(8)
    // 64-Bit-Zähler grosser Byte-Reihenfolge; Schritte der nächsten Jahrtausende passen in 53 Bit.
    zaehler.writeUInt32BE(Math.floor(schritt / 0x100000000), 0)
    zaehler.writeUInt32BE(schritt >>> 0, 4)
    const mac = crypto.createHmac(algo, schluessel).update(zaehler).digest()
    const versatz = mac[mac.length - 1] & 0x0f
    const zahl = ((mac[versatz] & 0x7f) << 24) | (mac[versatz + 1] << 16) | (mac[versatz + 2] << 8) | mac[versatz + 3]
    return String(zahl % 10 ** stellen).padStart(stellen, '0')
}

/**
 * Eingegebenen Code prüfen.
 *
 * Angenommen wird nur ein Schritt NACH `letzterSchritt`: ein einmal benutzter
 * Code (oder ein älterer aus demselben Fenster) gilt kein zweites Mal — wer
 * einem über die Schulter schaut, hat sonst 90 Sekunden.
 *
 * @returns {number|null} der getroffene Schritt (zum Merken), sonst null
 */
export function pruefeTotp(geheimnis, eingabe, { jetzt = Date.now(), letzterSchritt = 0, fenster = TOTP_FENSTER } = {}) {
    const schluessel = Buffer.isBuffer(geheimnis) ? geheimnis : geheimnisBytes(geheimnis)
    const code = String(eingabe ?? '').replace(/\s/g, '')
    if (!schluessel || !/^\d{6}$/.test(code)) return null
    const mitte = totpSchritt(jetzt)
    let treffer = null
    // Alle Schritte des Fensters durchrechnen, nicht beim ersten Treffer
    // aufhören: die Laufzeit verrät sonst, welcher Schritt passte.
    for (let d = -fenster; d <= fenster; d++) {
        const s = mitte + d
        const a = Buffer.from(totpCode(schluessel, s))
        const b = Buffer.from(code)
        if (crypto.timingSafeEqual(a, b) && s > (Number(letzterSchritt) || 0) && treffer === null) treffer = s
    }
    return treffer
}

/**
 * otpauth-Adresse für den QR-Code (Key-URI-Format, wie es Google
 * Authenticator, Aegis, 2FAS und andere lesen).
 */
export function otpauthUri(geheimnis, { aussteller = 'AutarkTrade', konto = 'AutarkTrade' } = {}) {
    const etikett = encodeURIComponent(`${aussteller}:${konto}`)
    const q = new URLSearchParams({
        secret: geheimnis, issuer: aussteller, algorithm: 'SHA1',
        digits: String(TOTP_STELLEN), period: String(TOTP_PERIODE_S),
    })
    return `otpauth://totp/${etikett}?${q.toString()}`
}

// ==================== Signierte Kurzzeit-Tokens ====================

/*
 * Aufbau: base64url(JSON{...daten, z: Zweck, b: Ablauf}) "." base64url(HMAC).
 *
 * Der HMAC-Schlüssel wird je Zweck aus dem Hauptgeheimnis abgeleitet, und der
 * Zweck steht zusätzlich im Inhalt: ein Halb-Anmelde-Token taugt so nie als
 * Challenge und umgekehrt, selbst wenn jemand beide Teile vertauscht.
 */
function zweckSchluessel(basis, zweck) {
    return crypto.createHmac('sha256', basis).update(`at_kurzzeit:${zweck}`).digest()
}

/**
 * @param {string|Buffer} basis  Hauptgeheimnis (oder der Zufallswert des Prozesses)
 * @param {string} zweck         z. B. 'tn_zweit_v1:<generation>'
 * @param {object} daten         klein halten — das Token wird zur Challenge
 * @param {number} gueltigMs
 */
export function signiere(basis, zweck, daten, gueltigMs, jetzt = Date.now()) {
    const inhalt = Buffer.from(JSON.stringify({ ...daten, z: zweck, b: jetzt + gueltigMs })).toString('base64url')
    const sig = crypto.createHmac('sha256', zweckSchluessel(basis, zweck)).update(inhalt).digest('base64url')
    return `${inhalt}.${sig}`
}

/**
 * Token prüfen: Signatur, Zweck, Ablauf.
 *
 * @returns {object|null} die Daten (ohne z/b), sonst null
 */
export function pruefeSigniert(basis, zweck, token, jetzt = Date.now()) {
    if (typeof token !== 'string' || token.length > 2048) return null
    const teile = token.split('.')
    if (teile.length !== 2 || !teile[0] || !teile[1]) return null
    const erwartet = Buffer.from(crypto.createHmac('sha256', zweckSchluessel(basis, zweck)).update(teile[0]).digest('base64url'))
    const gegeben = Buffer.from(teile[1])
    if (erwartet.length !== gegeben.length || !crypto.timingSafeEqual(erwartet, gegeben)) return null
    let d
    try { d = JSON.parse(Buffer.from(teile[0], 'base64url').toString('utf8')) } catch { return null }
    if (!d || d.z !== zweck || !Number.isFinite(d.b) || jetzt > d.b) return null
    const { z, b, ...daten } = d
    return { ...daten, ablauf: b }
}

/** Zufällige Kennung für ein Token (Einmal-Merker). */
export function zufallsId() {
    return crypto.randomBytes(12).toString('base64url')
}

/**
 * Liste verbrauchter Kennungen fortschreiben: abgelaufene fallen heraus,
 * die neue kommt dazu. Liefert null, wenn die Kennung schon verbraucht ist.
 *
 * @param {Array<[string, number]>} liste  [[id, ablaufMs], …]
 */
export function verbrauche(liste, id, ablauf, jetzt = Date.now(), max = 50) {
    const gueltig = (Array.isArray(liste) ? liste : [])
        .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Number(e[1]) >= jetzt)
    if (gueltig.some((e) => e[0] === id)) return null
    return [...gueltig, [id, ablauf]].slice(-max)
}
