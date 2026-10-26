/**
 * Kleiner DER-Kodierer (ASN.1, X.690) — genau so viel, wie ein X.509-v3-
 * Zertifikat braucht. Ohne Abhängigkeit: Node bringt Schlüssel und Signatur
 * mit (`crypto.generateKeyPairSync`, `crypto.sign`), aber keinen Weg, ein
 * Zertifikat zu BAUEN. Gelesen wird mit `crypto.X509Certificate`.
 *
 * Jede Funktion liefert einen Buffer mit Tag, Länge und Inhalt. Rein, ohne
 * Zustand — Selbsttest in `__selftest-tls-zertifikat.mjs`.
 */
import net from 'node:net'

/** Länge in DER: kurz bis 127, sonst 0x80|n gefolgt von n Bytes (big endian). */
export function laenge(n) {
    if (n < 0x80) return Buffer.from([n])
    const bytes = []
    while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256) }
    return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** Ein TLV: Tag-Byte, Länge, Inhalt. */
export function tlv(tag, inhalt) {
    const b = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt)
    return Buffer.concat([Buffer.from([tag]), laenge(b.length), b])
}

export const sequenz = (...teile) => tlv(0x30, Buffer.concat(teile))
export const menge = (...teile) => tlv(0x31, Buffer.concat(teile))
export const boolesch = (wert) => tlv(0x01, Buffer.from([wert ? 0xff : 0x00]))
export const oktette = (b) => tlv(0x04, b)
export const utf8 = (text) => tlv(0x0c, Buffer.from(String(text), 'utf8'))
/** Kontextspezifisch, konstruiert ([n] EXPLICIT). */
export const kontext = (n, ...teile) => tlv(0xa0 | n, Buffer.concat(teile))
/** Kontextspezifisch, primitiv ([n] IMPLICIT eines einfachen Typs). */
export const kontextPrimitiv = (n, b) => tlv(0x80 | n, b)

/**
 * INTEGER aus einer Zahl, einem BigInt oder vorzeichenlosen Bytes. Positiv
 * gemeint: ist das oberste Bit gesetzt, kommt eine 0x00 davor (sonst läse es
 * sich als negativ), führende Nullen fallen weg (DER: kürzeste Form).
 */
export function ganzzahl(wert) {
    let b
    if (Buffer.isBuffer(wert)) b = Buffer.from(wert)
    else {
        let n = BigInt(wert)
        if (n < 0n) throw new Error('nur nicht-negative Ganzzahlen')
        const hex = n.toString(16)
        b = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex')
    }
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    b = b.subarray(i)
    if (b.length === 0) b = Buffer.from([0])
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b])
    return tlv(0x02, b)
}

/** OBJECT IDENTIFIER aus „1.2.840.10045.4.3.2". */
export function oid(text) {
    const teile = String(text).split('.').map((s) => BigInt(s))
    if (teile.length < 2) throw new Error('OID zu kurz: ' + text)
    const zahlen = [teile[0] * 40n + teile[1], ...teile.slice(2)]
    const bytes = []
    for (let z of zahlen) {
        const stueck = [Number(z & 0x7fn)]
        z >>= 7n
        while (z > 0n) { stueck.unshift(Number(z & 0x7fn) | 0x80); z >>= 7n }
        bytes.push(...stueck)
    }
    return tlv(0x06, Buffer.from(bytes))
}

/** BIT STRING mit ganzen Bytes (Schlüssel, Signatur): 0 ungenutzte Bits. */
export function bitfolge(b) {
    return tlv(0x03, Buffer.concat([Buffer.from([0]), b]))
}

/**
 * BIT STRING einer benannten Bitliste (KeyUsage): Bit 0 ist das höchste Bit
 * des ersten Bytes. DER verlangt, dass hinten keine Null-Bits stehen — die
 * Zahl der ungenutzten Bits ergibt sich aus dem letzten gesetzten.
 */
export function benannteBits(bits) {
    if (!bits.length) return tlv(0x03, Buffer.from([0]))
    const hoechstes = Math.max(...bits)
    const bytes = Buffer.alloc(Math.floor(hoechstes / 8) + 1)
    for (const bit of bits) bytes[Math.floor(bit / 8)] |= 0x80 >> (bit % 8)
    const ungenutzt = 7 - (hoechstes % 8)
    return tlv(0x03, Buffer.concat([Buffer.from([ungenutzt]), bytes]))
}

const zwei = (n) => String(n).padStart(2, '0')

/**
 * Zeitpunkt nach RFC 5280 4.1.2.5: bis einschliesslich 2049 UTCTime
 * (JJMMTTHHMMSSZ), ab 2050 GeneralizedTime (JJJJMMTTHHMMSSZ). Sekundengenau.
 */
export function zeit(datum) {
    const d = new Date(datum)
    if (Number.isNaN(d.getTime())) throw new Error('ungültiges Datum')
    const j = d.getUTCFullYear()
    const rest = zwei(d.getUTCMonth() + 1) + zwei(d.getUTCDate()) + zwei(d.getUTCHours())
        + zwei(d.getUTCMinutes()) + zwei(d.getUTCSeconds()) + 'Z'
    if (j >= 1950 && j < 2050) return tlv(0x17, Buffer.from(zwei(j % 100) + rest, 'ascii'))
    return tlv(0x18, Buffer.from(String(j).padStart(4, '0') + rest, 'ascii'))
}

/**
 * IP-Adresse als Bytes (4 für IPv4, 16 für IPv6) — für den SAN-Eintrag
 * iPAddress. IPv6 mit `::` und eingebetteter IPv4 (`::ffff:1.2.3.4`).
 * Wirft bei allem, was keine IP ist.
 */
export function ipBytes(text) {
    const ip = String(text).trim().replace(/^\[|\]$/g, '')
    const art = net.isIP(ip)
    if (art === 4) return Buffer.from(ip.split('.').map(Number))
    if (art !== 6) throw new Error('keine IP-Adresse: ' + text)
    let kopf = ip, schwanz = ''
    const doppel = ip.indexOf('::')
    if (doppel >= 0) { kopf = ip.slice(0, doppel); schwanz = ip.slice(doppel + 2) }
    const gruppen = (teil) => {
        if (!teil) return []
        const out = []
        for (const g of teil.split(':')) {
            if (g.includes('.')) {
                const v4 = g.split('.').map(Number)
                out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3])
            } else out.push(parseInt(g, 16))
        }
        return out
    }
    const vorn = gruppen(kopf)
    const hinten = gruppen(schwanz)
    const fehlend = 8 - vorn.length - hinten.length
    const alle = doppel >= 0 ? [...vorn, ...new Array(fehlend).fill(0), ...hinten] : vorn
    if (alle.length !== 8) throw new Error('keine IP-Adresse: ' + text)
    const b = Buffer.alloc(16)
    alle.forEach((g, i) => b.writeUInt16BE(g, i * 2))
    return b
}

/** PEM-Hülle um DER-Bytes (64 Zeichen je Zeile). */
export function pem(art, der) {
    const b64 = der.toString('base64').match(/.{1,64}/g).join('\n')
    return `-----BEGIN ${art}-----\n${b64}\n-----END ${art}-----\n`
}

/** DER-Bytes aus einer PEM-Hülle (erste passende). */
export function ausPem(text) {
    const m = String(text).match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/)
    if (!m) throw new Error('kein PEM')
    return Buffer.from(m[1].replace(/\s+/g, ''), 'base64')
}
