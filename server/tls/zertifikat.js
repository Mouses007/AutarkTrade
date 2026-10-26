/**
 * Eigene Stamm-CA und Server-Zertifikat — der reine Teil (ohne DB, ohne Netz).
 *
 * Warum selbst: Die App läuft im LAN (NAS, Heimrechner) ohne öffentlichen
 * Namen, Let's Encrypt scheidet aus. Bis 26.10.2026 lieferte mkcert das
 * Zertifikat und Caddy das TLS — zwei Werkzeuge, ein Zertifikat zum
 * Kopieren und ein zweiter Container. Jetzt erzeugt die App beim ersten Start
 * eine eigene Stamm-CA, stellt sich damit ein Server-Zertifikat aus und
 * erneuert es selbst (`server/tls/dienst.js`). Geräte vertrauen EINMAL der CA
 * (Download unter Einstellungen › Allgemein › HTTPS), danach jedem neuen
 * Server-Zertifikat.
 *
 * Schlüssel: ECDSA P-256 (überall unterstützt, auch ESP32/mbedTLS und
 * Android 7+), Signatur ecdsa-with-SHA256. Laufzeiten: CA 10 Jahre,
 * Server 397 Tage (Apple/Chrome nehmen höchstens 398 an).
 */
import crypto from 'node:crypto'
import net from 'node:net'
import {
    sequenz, menge, boolesch, oktette, utf8, kontext, kontextPrimitiv,
    ganzzahl, oid, bitfolge, benannteBits, zeit, ipBytes, pem, ausPem,
} from './der.js'

const TAG_MS = 24 * 60 * 60 * 1000
export const CA_TAGE = 3652
export const SERVER_TAGE = 397
/** Erneuern, sobald weniger als so viele Tage übrig sind. */
export const ERNEUERN_TAGE = 30
/** Höchstzahl Namen/IPs im Server-Zertifikat. */
export const MAX_NAMEN = 40

const OID = {
    ecdsaSha256: '1.2.840.10045.4.3.2',
    cn: '2.5.4.3',
    o: '2.5.4.10',
    ski: '2.5.29.14',
    keyUsage: '2.5.29.15',
    san: '2.5.29.17',
    basicConstraints: '2.5.29.19',
    aki: '2.5.29.35',
    extKeyUsage: '2.5.29.37',
    serverAuth: '1.3.6.1.5.5.7.3.1',
}

const SIGNATUR_ALGO = sequenz(oid(OID.ecdsaSha256))

// ── Namen ────────────────────────────────────────────────────────────────

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** IP in kanonischer Schreibweise (IPv6 klein und gekürzt) — oder null. */
export function ipKanonisch(text) {
    try {
        const b = ipBytes(text)
        if (b.length === 4) return [...b].join('.')
        // Längste Nullfolge (≥ 2 Gruppen) durch „::" ersetzen (RFC 5952).
        const g = []
        for (let i = 0; i < 16; i += 2) g.push(b.readUInt16BE(i))
        let best = -1, bestLen = 0
        for (let i = 0; i < 8;) {
            if (g[i] !== 0) { i++; continue }
            let j = i
            while (j < 8 && g[j] === 0) j++
            if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i }
            i = j
        }
        const hex = g.map((x) => x.toString(16))
        if (best < 0) return hex.join(':')
        return hex.slice(0, best).join(':') + '::' + hex.slice(best + bestLen).join(':')
    } catch {
        return null
    }
}

/**
 * Ein Name oder eine IP fürs Zertifikat, bereinigt — oder null, wenn er dort
 * nichts zu suchen hat. Keine Wildcards (ein `*.local` bürgte für jedes
 * Gerät im Netz), keine unspezifizierte Adresse, kein Port.
 *
 * @returns {{art: 'dns'|'ip', wert: string} | null}
 */
export function normName(roh) {
    let s = String(roh ?? '').trim().toLowerCase()
    if (!s || s.length > 253) return null
    if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined)
    if (net.isIP(s)) {
        const ip = ipKanonisch(s)
        if (!ip || ip === '0.0.0.0' || ip === '::') return null
        return { art: 'ip', wert: ip }
    }
    s = s.replace(/\.$/, '')
    const labels = s.split('.')
    if (!labels.every((l) => LABEL.test(l))) return null
    // „999.1.1.1" ist weder IP noch sinnvoller Name: ein rein numerisches
    // letztes Label kommt in keinem Namen vor.
    if (/^\d+$/.test(labels[labels.length - 1])) return null
    return { art: 'dns', wert: s }
}

/** Host-Kopf → Name ohne Port (`[::1]:8443` → `::1`, `nas:8080` → `nas`) — oder null. */
export function nameAusHost(rawHost) {
    let h = String(rawHost ?? '').trim()
    if (!h) return null
    if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined)
    else if ((h.match(/:/g) || []).length === 1) h = h.split(':')[0]
    const n = normName(h)
    return n ? n.wert : null
}

/**
 * Liste bereinigen: ungültige fallen weg, Doppelte auch, Namen vor IPs,
 * jeweils sortiert — damit zwei Listen mit demselben Inhalt gleich aussehen.
 */
export function normNamen(liste) {
    const dns = new Set(), ips = new Set()
    for (const roh of Array.isArray(liste) ? liste : []) {
        const n = normName(roh)
        if (!n) continue
        ;(n.art === 'dns' ? dns : ips).add(n.wert)
    }
    const sortiere = (a) => [...a].sort()
    return [...sortiere(dns), ...sortiere(ips)]
}

/** Komma-Liste aus der Umgebung (AT_TLS_NAMEN) → bereinigte Namen. */
export function namenAusText(text) {
    return normNamen(String(text || '').split(/[,\s]+/))
}

/**
 * Was immer ins Zertifikat gehört: localhost, die Loopback-Adressen, der
 * mDNS-Name (Vorgabe `autarktrade.local`, „aus" lässt ihn weg).
 */
export function basisNamen(mdnsName = 'autarktrade.local') {
    const liste = ['localhost', '127.0.0.1', '::1']
    const m = String(mdnsName ?? '').trim().toLowerCase()
    if (m && m !== 'aus') liste.push(m)
    return normNamen(liste)
}

// ── Schlüssel und Hilfen ─────────────────────────────────────────────────

/** Neues ECDSA-P-256-Schlüsselpaar (KeyObjects). */
export function erzeugeSchluessel() {
    return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
}

/** Privater Schlüssel als PKCS#8-PEM (so wird er verschlüsselt gespeichert). */
export function schluesselPem(privateKey) {
    return privateKey.export({ type: 'pkcs8', format: 'pem' })
}

/** Unkomprimierter EC-Punkt (0x04‖x‖y) eines öffentlichen Schlüssels. */
function ecPunkt(publicKey) {
    const jwk = publicKey.export({ format: 'jwk' })
    return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])
}

/** Subject Key Identifier nach RFC 5280 4.2.1.2 (1): SHA-1 des Schlüssels. */
export function schluesselKennung(publicKey) {
    return crypto.createHash('sha1').update(ecPunkt(publicKey)).digest()
}

/** Zufällige, positive Seriennummer (16 Bytes, oberstes Bit aus, nie null). */
export function seriennummer() {
    const b = crypto.randomBytes(16)
    b[0] = (b[0] & 0x7f) | 0x01
    return b
}

/** Kurze Zufalls-ID der CA für ihren Namen (8 Hex-Zeichen, gross). */
export function zufallsId() {
    return crypto.randomBytes(4).toString('hex').toUpperCase()
}

/** SHA-256 über das DER des Zertifikats, hex GROSS mit Doppelpunkten. */
export function fingerabdruck(zertPem) {
    const h = crypto.createHash('sha256').update(ausPem(zertPem)).digest('hex').toUpperCase()
    return h.match(/.{2}/g).join(':')
}

function name({ cn, o }) {
    const rdn = (typ, wert) => menge(sequenz(oid(typ), utf8(wert)))
    return sequenz(...(o ? [rdn(OID.o, o)] : []), rdn(OID.cn, cn))
}

function erweiterung(typ, kritisch, wertDer) {
    return sequenz(oid(typ), ...(kritisch ? [boolesch(true)] : []), oktette(wertDer))
}

/**
 * Elemente einer DER-SEQUENCE (nur eine Ebene) — genug, um aus dem
 * CA-Zertifikat den Subject-Namen BYTEGENAU zu übernehmen: der Aussteller im
 * Server-Zertifikat muss ihm exakt gleichen, sonst findet kein Klient die CA.
 */
function kinder(der) {
    const lies = (b, pos) => {
        let len = b[pos + 1], kopf = 2
        if (len & 0x80) {
            const n = len & 0x7f
            len = 0
            for (let i = 0; i < n; i++) len = len * 256 + b[pos + 2 + i]
            kopf = 2 + n
        }
        return { start: pos, inhalt: pos + kopf, ende: pos + kopf + len }
    }
    const aussen = lies(der, 0)
    const out = []
    for (let pos = aussen.inhalt; pos < aussen.ende;) {
        const t = lies(der, pos)
        out.push(der.subarray(t.start, t.ende))
        pos = t.ende
    }
    return out
}

/** Subject (DER) eines Zertifikats. */
function subjectDer(zertPem) {
    const tbs = kinder(kinder(ausPem(zertPem))[0])
    // [0] version, serial, sigAlg, issuer, validity, subject
    return tbs[0][0] === 0xa0 ? tbs[5] : tbs[4]
}

function baueZertifikat({ seriell, aussteller, subjekt, nichtVor, nichtNach, publicKey, erweiterungen, signierSchluessel }) {
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    const tbs = sequenz(
        kontext(0, ganzzahl(2)),          // v3
        ganzzahl(seriell),
        SIGNATUR_ALGO,
        aussteller,
        sequenz(zeit(nichtVor), zeit(nichtNach)),
        subjekt,
        spki,
        kontext(3, sequenz(...erweiterungen)),
    )
    const signatur = crypto.sign('sha256', tbs, signierSchluessel)
    return pem('CERTIFICATE', sequenz(tbs, SIGNATUR_ALGO, bitfolge(signatur)))
}

// ── Zertifikate ──────────────────────────────────────────────────────────

/**
 * Neue Stamm-CA.
 *
 * @param {object} [opt]
 * @param {number} [opt.jetzt]   ms
 * @param {string} [opt.id]      kurze ID im Namen (Vorgabe: zufällig)
 * @returns {{pem: string, schluessel: string, id: string, nichtVor: number, nichtNach: number}}
 */
export function erzeugeCa({ jetzt = Date.now(), id = zufallsId() } = {}) {
    const { privateKey, publicKey } = erzeugeSchluessel()
    // Eine Stunde zurück: eine Geräteuhr, die etwas nachgeht, soll das frische
    // Zertifikat nicht als „noch nicht gültig" ablehnen.
    const nichtVor = Math.floor((jetzt - 60 * 60 * 1000) / 1000) * 1000
    const nichtNach = Math.floor((jetzt + CA_TAGE * TAG_MS) / 1000) * 1000
    const subjekt = name({ o: 'AutarkTrade', cn: `AutarkTrade Lokale CA (${id})` })
    const ski = schluesselKennung(publicKey)
    const zert = baueZertifikat({
        seriell: seriennummer(),
        aussteller: subjekt,
        subjekt,
        nichtVor, nichtNach, publicKey,
        erweiterungen: [
            // CA, darf aber nur Endzertifikate ausstellen (pathLen 0).
            erweiterung(OID.basicConstraints, true, sequenz(boolesch(true), ganzzahl(0))),
            // keyCertSign (5) + cRLSign (6)
            erweiterung(OID.keyUsage, true, benannteBits([5, 6])),
            erweiterung(OID.ski, false, oktette(ski)),
        ],
        signierSchluessel: privateKey,
    })
    return { pem: zert, schluessel: schluesselPem(privateKey), id, nichtVor, nichtNach }
}

/**
 * Server-Zertifikat, ausgestellt von der CA.
 *
 * @param {object} opt
 * @param {string} opt.caPem
 * @param {string} opt.caSchluessel   PKCS#8-PEM des CA-Schlüssels
 * @param {string[]} opt.namen        Namen und IPs (werden bereinigt)
 * @param {number} [opt.jetzt]
 * @returns {{pem: string, schluessel: string, namen: string[], nichtVor: number, nichtNach: number}}
 */
export function erzeugeServerZertifikat({ caPem, caSchluessel, namen, jetzt = Date.now() }) {
    const liste = normNamen(namen).slice(0, MAX_NAMEN)
    if (!liste.length) throw new Error('Keine gültigen Namen für das Zertifikat')
    const caKey = crypto.createPrivateKey(caSchluessel)
    const caZert = new crypto.X509Certificate(caPem)
    const { privateKey, publicKey } = erzeugeSchluessel()
    const nichtVor = Math.floor((jetzt - 60 * 60 * 1000) / 1000) * 1000
    // Nie über die CA hinaus: ein Klient lehnt sonst die Kette ab.
    const caEnde = Date.parse(caZert.validTo)
    const nichtNach = Math.min(Math.floor((jetzt + SERVER_TAGE * TAG_MS) / 1000) * 1000, caEnde)

    const san = sequenz(...liste.map((n) => (net.isIP(n)
        ? kontextPrimitiv(7, ipBytes(n))                    // iPAddress
        : kontextPrimitiv(2, Buffer.from(n, 'ascii')))))    // dNSName

    const zert = baueZertifikat({
        seriell: seriennummer(),
        aussteller: subjectDer(caPem),
        subjekt: name({ o: 'AutarkTrade', cn: 'AutarkTrade' }),
        nichtVor, nichtNach, publicKey,
        erweiterungen: [
            erweiterung(OID.basicConstraints, true, sequenz()),        // CA:false (Vorgabe, leer)
            erweiterung(OID.keyUsage, true, benannteBits([0])),        // digitalSignature
            erweiterung(OID.extKeyUsage, false, sequenz(oid(OID.serverAuth))),
            erweiterung(OID.san, false, san),
            erweiterung(OID.ski, false, oktette(schluesselKennung(publicKey))),
            erweiterung(OID.aki, false, sequenz(kontextPrimitiv(0, schluesselKennung(caZert.publicKey)))),
        ],
        signierSchluessel: caKey,
    })
    return { pem: zert, schluessel: schluesselPem(privateKey), namen: liste, nichtVor, nichtNach }
}

// ── Lesen und Prüfen ─────────────────────────────────────────────────────

/** Namen/IPs aus dem SAN eines Zertifikats, bereinigt wie `normNamen`. */
export function zertNamen(zertPem) {
    const san = new crypto.X509Certificate(zertPem).subjectAltName || ''
    const roh = san.split(/,\s*/).map((e) => {
        const m = e.match(/^(DNS|IP Address):(.*)$/)
        return m ? m[2].trim() : null
    }).filter(Boolean)
    return normNamen(roh)
}

/** Kerndaten eines Zertifikats für Status und Oberfläche. */
export function zertInfo(zertPem) {
    const x = new crypto.X509Certificate(zertPem)
    return {
        subjekt: x.subject.replace(/\n/g, ', '),
        nichtVor: Date.parse(x.validFrom),
        nichtNach: Date.parse(x.validTo),
        sha256: fingerabdruck(zertPem),
        seriennummer: x.serialNumber,
    }
}

/**
 * Muss das Server-Zertifikat neu? Gründe in dieser Reihenfolge: keins da,
 * nicht von dieser CA, weniger als ERNEUERN_TAGE übrig, ein Soll-Name fehlt.
 * Zusätzliche Namen im Zertifikat sind KEIN Grund — sonst schaukelten sich
 * zwei Prozesse mit verschiedenem AT_TLS_NAMEN an derselben DB gegenseitig.
 *
 * @returns {{noetig: boolean, grund: string, fehlend?: string[]}}
 */
export function pruefeErneuerung({ serverPem, caPem, sollNamen, jetzt = Date.now() }) {
    if (!serverPem) return { noetig: true, grund: 'fehlt' }
    let x
    try { x = new crypto.X509Certificate(serverPem) } catch { return { noetig: true, grund: 'unlesbar' } }
    try {
        const ca = new crypto.X509Certificate(caPem)
        if (!x.verify(ca.publicKey) || !x.checkIssued(ca)) return { noetig: true, grund: 'andereCa' }
    } catch { return { noetig: true, grund: 'andereCa' } }
    if (Date.parse(x.validTo) - jetzt < ERNEUERN_TAGE * TAG_MS) return { noetig: true, grund: 'laeuftAb' }
    const vorhanden = new Set(zertNamen(serverPem))
    const fehlend = normNamen(sollNamen).filter((n) => !vorhanden.has(n))
    if (fehlend.length) return { noetig: true, grund: 'namen', fehlend }
    return { noetig: false, grund: '' }
}
