/**
 * Selbsttest „Chart teilen per Mail" — Prüfung der Eingaben, ohne Netz.
 *
 *   node server/__selftest-chart-teilen.mjs
 *
 * Der Versand geht an eine eingegebene Adresse mit einem Bild aus dem Browser:
 * keine Kopfzeilen-Injektion über den Betreff, kein Nicht-Bild als Anhang.
 */
import { pruefeTeilenMail, BILD_MAX_ZEICHEN, MAX_EMPFAENGER } from './chart-teilen-kern.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]).toString('base64')
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]).toString('base64')
const gut = { an: 'a@b.ch', betreff: 'BTC 4h', text: 'Schau mal', dateiname: 'BTCUSDT_4h', bild: { mediaType: 'image/png', base64: png } }

console.log('\nChart teilen — Eingaben\n')
{
    const r = pruefeTeilenMail(gut)
    check('gültige Eingabe geht durch', !r.fehler && r.an[0] === 'a@b.ch' && r.dateiname === 'BTCUSDT_4h.png' && Buffer.isBuffer(r.bild))
    check('JPEG mit passender Signatur geht durch, Endung .jpg', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/jpeg', base64: jpg } }).dateiname === 'BTCUSDT_4h.jpg')
    check('mehrere Adressen, Komma getrennt', pruefeTeilenMail({ ...gut, an: 'a@b.ch, c@d.de' }).an.length === 2)
    check('ungültige Adresse wird abgelehnt, nicht still verworfen', pruefeTeilenMail({ ...gut, an: 'a@b.ch, kaputt' }).fehler === 'adresse')
    check('ohne Empfänger Fehler', pruefeTeilenMail({ ...gut, an: '' }).fehler === 'keinEmpfaenger')
    const viele = Array.from({ length: MAX_EMPFAENGER + 1 }, (_, i) => `x${i}@y.ch`).join(',')
    check(`mehr als ${MAX_EMPFAENGER} Empfänger abgelehnt`, pruefeTeilenMail({ ...gut, an: viele }).fehler === 'adresse')
    check('Betreff ohne Zeilenumbruch (keine Kopfzeilen-Injektion)', pruefeTeilenMail({ ...gut, betreff: 'Hallo\r\nBcc: x@y.ch' }).betreff === 'Hallo Bcc: x@y.ch')
    check('leerer Betreff → Vorgabe', pruefeTeilenMail({ ...gut, betreff: '  ' }).betreff === 'Chart aus AutarkTrade')
    const dn = pruefeTeilenMail({ ...gut, dateiname: '../../etc/passwd' }).dateiname
    check('Dateiname gesäubert (kein Pfad, kein führender Punkt)', /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(dn) && !dn.includes('/'), dn)
    check('anderer Bildtyp abgelehnt (svg)', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/svg+xml', base64: png } }).fehler === 'bildTyp')
    check('PNG-Typ mit JPEG-Inhalt abgelehnt', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/png', base64: jpg } }).fehler === 'bildKaputt')
    check('kein Base64 abgelehnt', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/png', base64: '<script>'.repeat(30) } }).fehler === 'bildKaputt')
    check('zu kurzes Bild abgelehnt', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/png', base64: 'iVBORw0K' } }).fehler === 'bildLeer')
    check('zu grosses Bild abgelehnt', pruefeTeilenMail({ ...gut, bild: { mediaType: 'image/png', base64: 'A'.repeat(BILD_MAX_ZEICHEN + 4) } }).fehler === 'bildZuGross')
    check('keine Eingabe → Fehler', pruefeTeilenMail(null).fehler === 'eingabe')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
