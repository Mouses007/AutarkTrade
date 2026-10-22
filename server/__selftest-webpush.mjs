/**
 * Selbsttest der Web-Push-Verschlüsselung (webpush.js) und der Geräteliste
 * der Sofort-Zustellung (esp32-push.js).
 *
 *   node server/__selftest-webpush.mjs
 *
 * Kern ist das Beispiel aus RFC 8291 Anhang A, Byte für Byte: eine
 * Verschlüsselung, die nur mit sich selbst zusammenpasst, nähme das Handy
 * (Tink) nicht an — und eine abgelehnte Nachricht sieht dort genauso aus
 * wie keine.
 */
import crypto from 'crypto'
import { verschluessle, entschluessle, b64url, vonB64url } from './webpush.js'
import { pruefeGeraet, mitGeraet, ohneGeraet, MAX_GERAETE } from './esp32-push.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const wirft = (f) => { try { f(); return false } catch { return true } }

// RFC 8291 Anhang A
const RFC = {
    klartext: vonB64url('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivat: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    asPrivat: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    kopf: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    chiffre: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
}

console.log('\nRFC 8291 Anhang A\n')
{
    check('Klartext des Beispiels', RFC.klartext.toString() === 'When I grow up, I want to be a watermelon')
    const rumpf = verschluessle(RFC.klartext, RFC, { salt: RFC.salt, privat: RFC.asPrivat })
    const soll = Buffer.concat([vonB64url(RFC.kopf), vonB64url(RFC.chiffre)])
    check('Kopf (86 Byte) wie im RFC', b64url(rumpf.subarray(0, 86)) === RFC.kopf, b64url(rumpf.subarray(0, 86)))
    check('ganze Nachricht Byte für Byte wie im RFC', rumpf.equals(soll), b64url(rumpf))
    check('Gegenprobe: entschlüsselt mit dem Empfänger-Schlüssel', entschluessle(soll, { privat: RFC.uaPrivat, p256dh: RFC.p256dh, auth: RFC.auth }).equals(RFC.klartext))
}

console.log('\nHin und zurück mit Zufallsschlüsseln\n')
{
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys()
    const empf = { p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.randomBytes(16)), privat: b64url(ua.getPrivateKey()) }
    const text = JSON.stringify({ id: '7-1761100000000', titel: 'BTCUSDT steigt über 108’400', text: 'Ä ö ü — €' })
    const a = verschluessle(text, empf)
    const b = verschluessle(text, empf)
    check('UTF-8-Nachricht kommt unverändert zurück', entschluessle(a, empf).toString() === text)
    check('jede Nachricht anders (Salz und Schlüssel frisch)', !a.equals(b))
    check('Klartext steht nicht im Rumpf', !a.includes(Buffer.from('BTCUSDT')))
    const kaputt = Buffer.from(a); kaputt[kaputt.length - 20] ^= 0x01
    check('ein gekipptes Bit → Entschlüsseln scheitert (Fälschung fällt auf)', wirft(() => entschluessle(kaputt, empf)))
    const fremd = { ...empf, auth: b64url(crypto.randomBytes(16)) }
    check('falsches Auth-Geheimnis → Entschlüsseln scheitert', wirft(() => entschluessle(a, fremd)))
    check('Nachricht über einen Satz (4 KB) wird abgelehnt', wirft(() => verschluessle('x'.repeat(4096), empf)))
    check('kaputter öffentlicher Schlüssel wird abgelehnt', wirft(() => verschluessle('x', { p256dh: 'AAAA', auth: empf.auth })))
}

console.log('\nGeräteangaben\n')
{
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys()
    const gut = { endpoint: 'https://ntfy.sh/upAbC123?up=1', p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.randomBytes(16)), geraet: 'Sony <script>' }
    const g = pruefeGeraet(gut)
    check('gültige Angaben werden angenommen', !g.fehler)
    check('Gerätename wird von Sonderzeichen befreit', g.daten.geraet === 'Sony script', g.daten.geraet)
    check('lokales ntfy (http, privates Netz) ist erlaubt', !pruefeGeraet({ ...gut, endpoint: 'http://192.168.178.100:8085/up1?up=1' }).fehler)
    check('andere Schemata werden abgelehnt (file:)', !!pruefeGeraet({ ...gut, endpoint: 'file:///etc/passwd' }).fehler)
    check('ohne Adresse abgelehnt', !!pruefeGeraet({ ...gut, endpoint: '' }).fehler)
    check('zu lange Adresse abgelehnt', !!pruefeGeraet({ ...gut, endpoint: 'https://x.y/' + 'a'.repeat(600) }).fehler)
    check('kurzer Schlüssel abgelehnt', !!pruefeGeraet({ ...gut, p256dh: b64url(crypto.randomBytes(33)) }).fehler)
    check('fehlendes Auth abgelehnt', !!pruefeGeraet({ ...gut, auth: '' }).fehler)

    let liste = []
    for (let i = 0; i < MAX_GERAETE + 2; i++) liste = mitGeraet(liste, { ...g.daten, endpoint: `https://ntfy.sh/up${i}` }, i)
    check(`höchstens ${MAX_GERAETE} Geräte, die ältesten fliegen`, liste.length === MAX_GERAETE && liste[0].endpoint === 'https://ntfy.sh/up2')
    const n = liste.length
    liste = mitGeraet(liste, { ...g.daten, endpoint: 'https://ntfy.sh/up3' }, 99)
    check('gleiche Adresse frischt auf statt zu verdoppeln', liste.length === n && liste.at(-1).endpoint === 'https://ntfy.sh/up3' && liste.at(-1).seit === 99)
    check('Abmelden entfernt genau dieses Gerät', ohneGeraet(liste, 'https://ntfy.sh/up3').length === n - 1)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:', fehler.join(' | ')); process.exit(1) }
