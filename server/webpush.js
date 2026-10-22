/**
 * Web-Push-Verschlüsselung (RFC 8291, Inhaltskodierung aes128gcm nach RFC 8188).
 *
 * Wofür: Chart-Alarme gehen sofort ans Handy über UnifiedPush — die ntfy-App
 * hält dort die Verbindung, der Server POSTet an deren Adresse (oft ntfy.sh).
 * Ohne Verschlüsselung läse ntfy.sh Symbol und Kurs mit, und wer die Adresse
 * kennt, könnte dem Handy falsche Alarme schicken. Mit ihr kann nur die App
 * lesen (privater Schlüssel bleibt auf dem Gerät), und nur wer das
 * Auth-Geheimnis kennt — dieser Server —, erzeugt Nachrichten, die sie
 * annimmt; die App verwirft alles, was nicht entschlüsselt.
 *
 * Nur Node-Bordmittel (ECDH P-256, HKDF-SHA-256, AES-128-GCM), keine
 * Abhängigkeit. Geprüft gegen das Beispiel aus RFC 8291 Anhang A.
 */
import crypto from 'crypto'

const RS = 4096   // Satzgrösse; eine Alarm-Nachricht passt immer in einen Satz

export function b64url(buf) {
    return Buffer.from(buf).toString('base64url')
}

export function vonB64url(text) {
    return Buffer.from(String(text || ''), 'base64url')
}

/**
 * @param klartext Buffer|string
 * @param empfaenger { p256dh, auth } — öffentlicher Schlüssel (65 Byte, unkomprimiert)
 *                   und Auth-Geheimnis (16 Byte), beide base64url
 * @param fest       nur für den Selbsttest: { salt, privat } (base64url) statt Zufall
 * @returns Buffer   fertiger Nachrichtenrumpf (Kopf + ein verschlüsselter Satz)
 */
export function verschluessle(klartext, empfaenger, fest = null) {
    const uaPublic = vonB64url(empfaenger.p256dh)
    const authGeheimnis = vonB64url(empfaenger.auth)
    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh ungültig')
    if (authGeheimnis.length < 16) throw new Error('auth ungültig')

    const ecdh = crypto.createECDH('prime256v1')
    if (fest?.privat) ecdh.setPrivateKey(vonB64url(fest.privat))
    else ecdh.generateKeys()
    const asPublic = ecdh.getPublicKey()               // 65 Byte, unkomprimiert
    const ecdhGeheimnis = ecdh.computeSecret(uaPublic)
    const salt = fest?.salt ? vonB64url(fest.salt) : crypto.randomBytes(16)

    // RFC 8291 §3.4: IKM aus dem ECDH-Geheimnis, gebunden an beide öffentlichen Schlüssel
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
    const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhGeheimnis, authGeheimnis, keyInfo, 32))
    // RFC 8188 §2.2/2.3: Inhaltsschlüssel und Nonce
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

    const daten = Buffer.concat([Buffer.from(klartext), Buffer.from([0x02])])   // 0x02 = letzter Satz
    if (daten.length + 16 > RS) throw new Error('Nachricht zu gross für einen Satz')
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
    const chiffre = Buffer.concat([cipher.update(daten), cipher.final(), cipher.getAuthTag()])

    const kopf = Buffer.alloc(16 + 4 + 1)
    salt.copy(kopf, 0)
    kopf.writeUInt32BE(RS, 16)
    kopf[20] = asPublic.length
    return Buffer.concat([kopf, asPublic, chiffre])
}

/**
 * Gegenstück — nur für den Selbsttest (das Handy entschlüsselt mit Tink).
 * @param privat base64url des privaten Empfängerschlüssels
 */
export function entschluessle(rumpf, { privat, p256dh, auth }) {
    const salt = rumpf.subarray(0, 16)
    const idlen = rumpf[20]
    const asPublic = rumpf.subarray(21, 21 + idlen)
    const chiffre = rumpf.subarray(21 + idlen)
    const ecdh = crypto.createECDH('prime256v1')
    ecdh.setPrivateKey(vonB64url(privat))
    const uaPublic = vonB64url(p256dh)
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
    const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(asPublic), vonB64url(auth), keyInfo, 32))
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
    const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
    decipher.setAuthTag(chiffre.subarray(chiffre.length - 16))
    const daten = Buffer.concat([decipher.update(chiffre.subarray(0, chiffre.length - 16)), decipher.final()])
    let ende = daten.length - 1
    while (ende >= 0 && daten[ende] === 0) ende--   // Auffüllung
    if (daten[ende] !== 0x02) throw new Error('Satzende fehlt')
    return daten.subarray(0, ende)
}
