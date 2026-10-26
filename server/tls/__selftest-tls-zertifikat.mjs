/**
 * Selbsttest des reinen TLS-Teils: DER-Kodierer und Zertifikatsaufbau.
 *
 *   node server/tls/__selftest-tls-zertifikat.mjs
 *
 * Geprüft wird das Ergebnis mit Node selbst (`crypto.X509Certificate`:
 * Signatur, Aussteller, Namen, IPs, Laufzeit) und — falls vorhanden — mit
 * openssl (`x509 -text`, `verify -x509_strict`). Fehlt openssl, wird dieser
 * Teil übersprungen, nicht als Fehler gezählt.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as der from './der.js'
import {
    erzeugeCa, erzeugeServerZertifikat, fingerabdruck, normName, normNamen, nameAusHost, namenAusText,
    basisNamen, zertNamen, pruefeErneuerung, ipKanonisch, seriennummer, CA_TAGE, SERVER_TAGE,
} from './zertifikat.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const hex = (b) => b.toString('hex')
const TAG = 24 * 60 * 60 * 1000

console.log('\nDER-Kodierer\n')
check('Länge kurz', hex(der.laenge(5)) === '05')
check('Länge 128 → 81 80', hex(der.laenge(128)) === '8180')
check('Länge 300 → 82 01 2c', hex(der.laenge(300)) === '82012c')
check('INTEGER 0', hex(der.ganzzahl(0)) === '020100')
check('INTEGER 127', hex(der.ganzzahl(127)) === '02017f')
check('INTEGER 128 bekommt führende Null', hex(der.ganzzahl(128)) === '02020080')
check('INTEGER aus Bytes: führende Nullen weg', hex(der.ganzzahl(Buffer.from([0, 0, 1]))) === '020101')
check('OID ecdsa-with-SHA256', hex(der.oid('1.2.840.10045.4.3.2')) === '06082a8648ce3d040302')
check('OID 2.5.29.17', hex(der.oid('2.5.29.17')) === '0603551d11')
check('BOOLEAN TRUE', hex(der.boolesch(true)) === '0101ff')
check('KeyUsage digitalSignature: 7 ungenutzte Bits', hex(der.benannteBits([0])) === '03020780')
check('KeyUsage keyCertSign+cRLSign: 1 ungenutztes Bit', hex(der.benannteBits([5, 6])) === '03020106')
check('UTCTime bis 2049', der.zeit(Date.UTC(2049, 11, 31, 23, 59, 59)).toString('latin1').slice(2) === '491231235959Z' && der.zeit(Date.UTC(2049, 0, 1))[0] === 0x17)
check('GeneralizedTime ab 2050', der.zeit(Date.UTC(2050, 0, 1)).toString('latin1').slice(2) === '20500101000000Z' && der.zeit(Date.UTC(2050, 0, 1))[0] === 0x18)
check('IPv4 → 4 Bytes', hex(der.ipBytes('192.168.178.100')) === 'c0a8b264')
check('IPv6 ::1 → 16 Bytes', hex(der.ipBytes('::1')) === '00000000000000000000000000000001')
check('IPv6 fe80::1:2', hex(der.ipBytes('fe80::1:2')) === 'fe800000000000000000000000010002')
check('IPv6 mit eingebetteter IPv4', hex(der.ipBytes('::ffff:10.0.0.1')) === '00000000000000000000ffff0a000001')
let wirft = false
try { der.ipBytes('nas.local') } catch { wirft = true }
check('Keine IP → wirft', wirft)
check('PEM hin und zurück', der.ausPem(der.pem('CERTIFICATE', Buffer.from('abc'))).toString() === 'abc')

console.log('\nNamen\n')
check('IP kanonisch (IPv6 gekürzt)', ipKanonisch('0:0:0:0:0:0:0:1') === '::1' && ipKanonisch('FE80:0:0:0:0:0:0:1') === 'fe80::1')
check('Name klein, ohne Punkt am Ende', normName('NAS.Fritz.Box.')?.wert === 'nas.fritz.box')
check('Wildcard abgelehnt', normName('*.local') === null)
check('0.0.0.0 abgelehnt', normName('0.0.0.0') === null && normName('::') === null)
check('„999.1.1.1" ist weder IP noch Name', normName('999.1.1.1') === null)
check('Unterstrich abgelehnt', normName('a_b.local') === null)
check('Host mit Port', nameAusHost('192.168.178.100:8443') === '192.168.178.100' && nameAusHost('NAS:8080') === 'nas')
check('Host IPv6 in Klammern', nameAusHost('[::1]:8443') === '::1')
check('Host-Unsinn → null', nameAusHost('evil.tld/x') === null && nameAusHost('') === null)
check('Liste: Namen vor IPs, sortiert, ohne Doppelte',
    JSON.stringify(normNamen(['127.0.0.1', 'localhost', 'b.local', 'LOCALHOST', '::1', 'kaputt_'])) === JSON.stringify(['b.local', 'localhost', '127.0.0.1', '::1']))
check('AT_TLS_NAMEN als Komma-Liste', JSON.stringify(namenAusText('192.168.178.100, nas.local ,,')) === JSON.stringify(['nas.local', '192.168.178.100']))
check('Basis: localhost, 127.0.0.1, ::1, mDNS', JSON.stringify(basisNamen('autarktrade.local')) === JSON.stringify(['autarktrade.local', 'localhost', '127.0.0.1', '::1']))
check('Basis ohne mDNS bei „aus"', !basisNamen('aus').includes('aus'))

console.log('\nSeriennummer\n')
{
    const s = Array.from({ length: 50 }, seriennummer)
    check('immer positiv und nie null', s.every((b) => (b[0] & 0x80) === 0 && b.some((x) => x !== 0)))
    check('zufällig (50 verschiedene)', new Set(s.map(hex)).size === 50)
}

console.log('\nStamm-CA\n')
const jetzt = Date.now()
const ca = erzeugeCa({ jetzt, id: 'AB12CD34' })
const caX = new crypto.X509Certificate(ca.pem)
check('Node liest das CA-Zertifikat', !!caX.subject)
check('CN „AutarkTrade Lokale CA (<id>)"', /CN=AutarkTrade Lokale CA \(AB12CD34\)/.test(caX.subject), caX.subject)
check('selbst signiert', caX.verify(caX.publicKey) && caX.checkIssued(caX))
check('ist CA', caX.ca === true)
check('Laufzeit 10 Jahre', Math.abs(Date.parse(caX.validTo) - (jetzt + CA_TAGE * TAG)) < 2000, caX.validTo)
check('gilt schon jetzt (eine Stunde Vorlauf)', Date.parse(caX.validFrom) <= jetzt - 59 * 60 * 1000)
check('Schlüssel ist P-256', crypto.createPrivateKey(ca.schluessel).asymmetricKeyDetails?.namedCurve === 'prime256v1')
check('Fingerabdruck = SHA-256 über DER, GROSS mit Doppelpunkten',
    fingerabdruck(ca.pem) === caX.fingerprint256 && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerabdruck(ca.pem)))

console.log('\nServer-Zertifikat\n')
const namen = ['localhost', '127.0.0.1', '::1', 'autarktrade.local', '192.168.178.100', 'nas.fritz.box']
const srv = erzeugeServerZertifikat({ caPem: ca.pem, caSchluessel: ca.schluessel, namen, jetzt })
const sx = new crypto.X509Certificate(srv.pem)
check('von der CA signiert (verify)', sx.verify(caX.publicKey))
check('Aussteller passt bytegenau (checkIssued)', sx.checkIssued(caX))
check('keine CA', sx.ca === false)
check('checkHost localhost / autarktrade.local / nas.fritz.box',
    sx.checkHost('localhost') === 'localhost' && sx.checkHost('autarktrade.local') === 'autarktrade.local' && sx.checkHost('nas.fritz.box') === 'nas.fritz.box')
check('checkHost fremd → undefined', sx.checkHost('evil.example') === undefined)
check('checkIP 127.0.0.1 / ::1 / 192.168.178.100',
    sx.checkIP('127.0.0.1') === '127.0.0.1' && !!sx.checkIP('::1') && sx.checkIP('192.168.178.100') === '192.168.178.100')
check('checkIP fremd → undefined', sx.checkIP('192.168.178.101') === undefined)
check('Laufzeit 397 Tage', Math.abs(Date.parse(sx.validTo) - (jetzt + SERVER_TAGE * TAG)) < 2000, sx.validTo)
check('Schlüssel passt zum Zertifikat', sx.checkPrivateKey(crypto.createPrivateKey(srv.schluessel)))
check('nur serverAuth', JSON.stringify(sx.keyUsage) === JSON.stringify(['1.3.6.1.5.5.7.3.1']), JSON.stringify(sx.keyUsage))
check('Namen zurückgelesen = bereinigte Liste', JSON.stringify(zertNamen(srv.pem)) === JSON.stringify(normNamen(namen)))
{
    const zwei = erzeugeServerZertifikat({ caPem: ca.pem, caSchluessel: ca.schluessel, namen, jetzt })
    check('zwei Ausstellungen → verschiedene Seriennummern', new crypto.X509Certificate(zwei.pem).serialNumber !== sx.serialNumber)
}
{
    // Nie über das Ende der CA hinaus
    const altCa = erzeugeCa({ jetzt: jetzt - (CA_TAGE - 10) * TAG })
    const kurz = erzeugeServerZertifikat({ caPem: altCa.pem, caSchluessel: altCa.schluessel, namen: ['localhost'], jetzt })
    check('Server-Zertifikat endet spätestens mit der CA',
        Date.parse(new crypto.X509Certificate(kurz.pem).validTo) <= Date.parse(new crypto.X509Certificate(altCa.pem).validTo))
}
{
    let w = false
    try { erzeugeServerZertifikat({ caPem: ca.pem, caSchluessel: ca.schluessel, namen: ['*.x', ''], jetzt }) } catch { w = true }
    check('ohne gültigen Namen → Fehler', w)
}

console.log('\nErneuern\n')
{
    const soll = ['localhost', '127.0.0.1']
    check('frisch: nichts zu tun', pruefeErneuerung({ serverPem: srv.pem, caPem: ca.pem, sollNamen: soll, jetzt }).noetig === false)
    check('fehlt: erneuern', pruefeErneuerung({ serverPem: '', caPem: ca.pem, sollNamen: soll }).grund === 'fehlt')
    check('< 30 Tage Rest: erneuern',
        pruefeErneuerung({ serverPem: srv.pem, caPem: ca.pem, sollNamen: soll, jetzt: jetzt + (SERVER_TAGE - 29) * TAG }).grund === 'laeuftAb')
    check('31 Tage Rest: noch nicht',
        pruefeErneuerung({ serverPem: srv.pem, caPem: ca.pem, sollNamen: soll, jetzt: jetzt + (SERVER_TAGE - 31) * TAG }).noetig === false)
    const n = pruefeErneuerung({ serverPem: srv.pem, caPem: ca.pem, sollNamen: [...soll, '10.0.0.5'], jetzt })
    check('neuer Soll-Name: erneuern, Name genannt', n.grund === 'namen' && JSON.stringify(n.fehlend) === '["10.0.0.5"]')
    check('zusätzlicher Name im Zertifikat ist KEIN Grund', pruefeErneuerung({ serverPem: srv.pem, caPem: ca.pem, sollNamen: ['localhost'], jetzt }).noetig === false)
    const andere = erzeugeCa({ jetzt })
    check('andere CA: erneuern', pruefeErneuerung({ serverPem: srv.pem, caPem: andere.pem, sollNamen: soll, jetzt }).grund === 'andereCa')
}

console.log('\nopenssl (falls vorhanden)\n')
{
    let openssl = true
    try { execFileSync('openssl', ['version'], { stdio: 'pipe' }) } catch { openssl = false }
    if (!openssl) {
        console.log('  – openssl nicht gefunden, übersprungen')
    } else {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-tls-'))
        try {
            fs.writeFileSync(path.join(dir, 'ca.pem'), ca.pem)
            fs.writeFileSync(path.join(dir, 'srv.pem'), srv.pem)
            const caText = execFileSync('openssl', ['x509', '-in', path.join(dir, 'ca.pem'), '-text', '-noout']).toString()
            check('openssl: CA:TRUE, pathlen:0, kritisch', /Basic Constraints: critical\s+CA:TRUE, pathlen:0/.test(caText))
            check('openssl: CA Key Usage kritisch (Certificate Sign, CRL Sign)', /Key Usage: critical\s+Certificate Sign, CRL Sign/.test(caText))
            check('openssl: CA hat SKI', /Subject Key Identifier/.test(caText))
            const sText = execFileSync('openssl', ['x509', '-in', path.join(dir, 'srv.pem'), '-text', '-noout']).toString()
            check('openssl: Version 3', /Version: 3 \(0x2\)/.test(sText))
            check('openssl: CA:FALSE kritisch', /Basic Constraints: critical\s+CA:FALSE/.test(sText))
            check('openssl: Digital Signature kritisch', /Key Usage: critical\s+Digital Signature/.test(sText))
            check('openssl: TLS Web Server Authentication', /TLS Web Server Authentication/.test(sText))
            check('openssl: SAN mit DNS und IP', /DNS:localhost/.test(sText) && /IP Address:192\.168\.178\.100/.test(sText) && /IP Address:0:0:0:0:0:0:0:1/.test(sText))
            check('openssl: AKI vorhanden', /Authority Key Identifier/.test(sText))
            check('openssl: ecdsa-with-SHA256', /Signature Algorithm: ecdsa-with-SHA256/.test(sText))
            const v = execFileSync('openssl', ['verify', '-x509_strict', '-purpose', 'sslserver', '-CAfile', path.join(dir, 'ca.pem'), path.join(dir, 'srv.pem')]).toString()
            check('openssl verify -x509_strict -purpose sslserver: OK', /: OK/.test(v), v)
            const fp = execFileSync('openssl', ['x509', '-in', path.join(dir, 'ca.pem'), '-noout', '-fingerprint', '-sha256']).toString()
            check('openssl: gleicher Fingerabdruck', fp.trim().endsWith('=' + fingerabdruck(ca.pem)), fp)
            const fremd = erzeugeCa({ jetzt })
            fs.writeFileSync(path.join(dir, 'fremd.pem'), fremd.pem)
            let abgelehnt = false
            try { execFileSync('openssl', ['verify', '-CAfile', path.join(dir, 'fremd.pem'), path.join(dir, 'srv.pem')], { stdio: 'pipe' }) } catch { abgelehnt = true }
            check('openssl verify mit fremder CA: abgelehnt', abgelehnt)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }
}

console.log(`\n${fehlgeschlagen === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
process.exit(fehlgeschlagen === 0 ? 0 : 1)
