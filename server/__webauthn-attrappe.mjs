/**
 * Software-Authenticator für die Selbsttests — ein „YubiKey" in Node.
 *
 * Erzeugt Antworten, wie sie der Browser nach `navigator.credentials.create`
 * bzw. `.get` an den Server schickt (RegistrationResponseJSON /
 * AuthenticationResponseJSON): P-256-Schlüssel (COSE alg -7), Attestation
 * `none`, Flag UP (angetippt), ohne UV (keine PIN) — genau das, was ein
 * YubiKey bei `userVerification: 'discouraged'` liefert. Nur für Tests,
 * kein Teil der App.
 */
import crypto from 'node:crypto'

const b64u = (b) => Buffer.from(b).toString('base64url')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest()

/** Minimaler CBOR-Kodierer (RFC 8949): ganze Zahlen, Bytes, Text, Map. */
function kopf(art, n) {
    if (n < 24) return Buffer.from([(art << 5) | n])
    if (n < 256) return Buffer.from([(art << 5) | 24, n])
    const b = Buffer.alloc(3); b[0] = (art << 5) | 25; b.writeUInt16BE(n, 1); return b
}
export function cbor(w) {
    if (typeof w === 'number') return w >= 0 ? kopf(0, w) : kopf(1, -1 - w)
    if (Buffer.isBuffer(w) || w instanceof Uint8Array) return Buffer.concat([kopf(2, w.length), Buffer.from(w)])
    if (typeof w === 'string') { const t = Buffer.from(w, 'utf8'); return Buffer.concat([kopf(3, t.length), t]) }
    if (w instanceof Map) return Buffer.concat([kopf(5, w.size), ...[...w].flatMap(([k, v]) => [cbor(k), cbor(v)])])
    throw new Error('cbor: Typ nicht unterstützt')
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }

export class SoftwareSchluessel {
    /** @param {object} [fest] {privatPem, id} zum Wiederherstellen aus einer Aufnahme */
    constructor(fest = null) {
        this.privat = fest?.privatPem
            ? crypto.createPrivateKey(fest.privatPem)
            : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
        const jwk = crypto.createPublicKey(this.privat).export({ format: 'jwk' })
        this.x = Buffer.from(jwk.x, 'base64url')
        this.y = Buffer.from(jwk.y, 'base64url')
        this.id = fest?.id ? Buffer.from(fest.id, 'base64url') : crypto.randomBytes(32)
        this.zaehler = 0
    }

    get kennung() { return b64u(this.id) }

    alsAufnahme() {
        return { privatPem: this.privat.export({ format: 'pem', type: 'pkcs8' }).toString(), id: this.kennung }
    }

    /** Antwort auf `credentials.create` zu den Optionen des Servers. */
    registriere(optionen, origin, { rpId = optionen.rp.id, typ = 'webauthn.create' } = {}) {
        const clientData = Buffer.from(JSON.stringify({ type: typ, challenge: optionen.challenge, origin, crossOrigin: false }))
        const coseSchluessel = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]))
        const kennLaenge = Buffer.alloc(2); kennLaenge.writeUInt16BE(this.id.length)
        const authData = Buffer.concat([
            sha256(rpId), Buffer.from([0x41]),          // UP + AT (Schlüsseldaten folgen)
            u32(this.zaehler), Buffer.alloc(16),         // AAGUID 0 (Attestation none)
            kennLaenge, this.id, coseSchluessel,
        ])
        const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))
        return {
            id: this.kennung, rawId: this.kennung, type: 'public-key',
            response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ['usb', 'nfc'] },
            clientExtensionResults: {}, authenticatorAttachment: 'cross-platform',
        }
    }

    /** Antwort auf `credentials.get`; `zaehler` übersteuert den Signaturzähler. */
    melde(optionen, origin, { rpId = optionen.rpId, zaehler } = {}) {
        this.zaehler = zaehler ?? this.zaehler + 1
        const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: optionen.challenge, origin, crossOrigin: false }))
        const authData = Buffer.concat([sha256(rpId), Buffer.from([0x01]), u32(this.zaehler)])
        const signatur = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privat)
        return {
            id: this.kennung, rawId: this.kennung, type: 'public-key',
            response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signatur) },
            clientExtensionResults: {}, authenticatorAttachment: 'cross-platform',
        }
    }
}
