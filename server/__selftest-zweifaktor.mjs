/**
 * Selbsttest zweiter Faktor — der reine Teil (`zweifaktor.js`), ohne
 * Datenbank und ohne Server.
 *
 *   node server/__selftest-zweifaktor.mjs
 *
 * - TOTP gegen die Vektoren aus RFC 6238 Anhang B (SHA-1/256/512, 8 Stellen),
 *   das Zeitfenster ±1 Schritt und „derselbe Code gilt nur einmal".
 * - Signierte Kurzzeit-Tokens: Ablauf, falscher Zweck, andere Generation,
 *   verfälschter Inhalt.
 * - YubiKey (`webauthn.js`) steht in `__selftest-webauthn.mjs`.
 */
import {
    totpCode, totpSchritt, pruefeTotp, geheimnisBytes, neuesTotpGeheimnis, otpauthUri,
    signiere, pruefeSigniert, verbrauche,
} from './zweifaktor.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nRFC 6238 Anhang B\n')
{
    // Die Seeds des RFC: ASCII "1234567890" wiederholt auf 20/32/64 Byte.
    const seed = (n) => Buffer.from('1234567890'.repeat(7).slice(0, n), 'ascii')
    const SEEDS = { sha1: seed(20), sha256: seed(32), sha512: seed(64) }
    const VEKTOREN = [
        [59, '94287082', '46119246', '90693936'],
        [1111111109, '07081804', '68084774', '25091201'],
        [1111111111, '14050471', '67062674', '99943326'],
        [1234567890, '89005924', '91819424', '93441116'],
        [2000000000, '69279037', '90698825', '38618901'],
        [20000000000, '65353130', '77737706', '47863826'],
    ]
    for (const [t, s1, s256, s512] of VEKTOREN) {
        const schritt = totpSchritt(t * 1000)
        const ist = [totpCode(SEEDS.sha1, schritt, 8, 'sha1'), totpCode(SEEDS.sha256, schritt, 8, 'sha256'), totpCode(SEEDS.sha512, schritt, 8, 'sha512')]
        check(`T=${t}: SHA1/256/512`, ist.join() === [s1, s256, s512].join(), ist.join())
    }
    // Der 6-stellige App-Code ist derselbe Wert modulo 10^6 (RFC 4226 §5.3).
    check('6 Stellen = letzte 6 der 8', totpCode(SEEDS.sha1, totpSchritt(59000)) === '287082')
}

console.log('\nbase32 und otpauth\n')
{
    const g = neuesTotpGeheimnis()
    check('neues Geheimnis: 32 Zeichen base32 (160 Bit)', /^[A-Z2-7]{32}$/.test(g), g)
    check('… und zwei sind verschieden', g !== neuesTotpGeheimnis())
    // RFC 4648 §10: "foobar" → MZXW6YTBOI======
    check('base32-Vektor aus RFC 4648', geheimnisBytes('MZXW6YTBOI')?.toString() === 'foobar')
    check('klein, mit Leerzeichen und Auffüllung', geheimnisBytes('mzxw 6ytb oi======')?.toString() === 'foobar')
    check('ungültiges Zeichen → null', geheimnisBytes('MZXW1') === null && geheimnisBytes('') === null)
    const uri = otpauthUri('JBSWY3DPEHPK3PXP')
    check('otpauth-Adresse', uri.startsWith('otpauth://totp/AutarkTrade%3AAutarkTrade?') && uri.includes('secret=JBSWY3DPEHPK3PXP')
        && uri.includes('issuer=AutarkTrade') && uri.includes('digits=6') && uri.includes('period=30'), uri)
}

console.log('\nZeitfenster und Einmaligkeit\n')
{
    const g = 'JBSWY3DPEHPK3PXP'
    const b = geheimnisBytes(g)
    const jetzt = 1_800_000_000_000 + 12_345
    const s = totpSchritt(jetzt)
    const code = (d) => totpCode(b, s + d)
    check('aktueller Code', pruefeTotp(g, code(0), { jetzt }) === s)
    check('einen Schritt alt (Uhr des Handys nach)', pruefeTotp(g, code(-1), { jetzt }) === s - 1)
    check('einen Schritt voraus', pruefeTotp(g, code(1), { jetzt }) === s + 1)
    check('zwei Schritte daneben → abgewiesen', pruefeTotp(g, code(-2), { jetzt }) === null && pruefeTotp(g, code(2), { jetzt }) === null)
    check('derselbe Code ein zweites Mal → abgewiesen', pruefeTotp(g, code(0), { jetzt, letzterSchritt: s }) === null)
    check('… auch ein älterer aus dem Fenster', pruefeTotp(g, code(-1), { jetzt, letzterSchritt: s }) === null)
    check('der nächste geht danach', pruefeTotp(g, code(1), { jetzt, letzterSchritt: s }) === s + 1)
    check('Leerzeichen im Code sind egal', pruefeTotp(g, code(0).slice(0, 3) + ' ' + code(0).slice(3), { jetzt }) === s)
    check('5 oder 7 Stellen, Buchstaben → abgewiesen',
        pruefeTotp(g, '12345', { jetzt }) === null && pruefeTotp(g, '1234567', { jetzt }) === null && pruefeTotp(g, '12a456', { jetzt }) === null)
    check('kein Geheimnis → abgewiesen', pruefeTotp('', code(0), { jetzt }) === null)
}

console.log('\nSignierte Kurzzeit-Tokens\n')
{
    const basis = 'hauptgeheimnis-fuer-den-test'
    const t0 = 1_800_000_000_000
    const tok = signiere(basis, 'tn_zweit_v1:3', { r: 1 }, 5 * 60 * 1000, t0)
    const d = pruefeSigniert(basis, 'tn_zweit_v1:3', tok, t0 + 1000)
    check('gültiges Token liefert die Daten', d?.r === 1 && d.ablauf === t0 + 300000, JSON.stringify(d))
    check('nach Ablauf → null', pruefeSigniert(basis, 'tn_zweit_v1:3', tok, t0 + 300001) === null)
    check('falscher Zweck → null', pruefeSigniert(basis, 'tn_webauthn_v1:3', tok, t0) === null)
    check('andere Generation → null', pruefeSigniert(basis, 'tn_zweit_v1:4', tok, t0) === null)
    check('anderes Hauptgeheimnis → null', pruefeSigniert('anderes', 'tn_zweit_v1:3', tok, t0) === null)
    // Inhalt verfälschen (r: 0 statt 1, Ablauf in die Zukunft), Signatur behalten.
    const [, sig] = tok.split('.')
    const falsch = Buffer.from(JSON.stringify({ r: 0, z: 'tn_zweit_v1:3', b: t0 + 9e9 })).toString('base64url') + '.' + sig
    check('verfälschter Inhalt → null', pruefeSigniert(basis, 'tn_zweit_v1:3', falsch, t0) === null)
    check('Unsinn → null', [undefined, '', 'a.b', 'abc', '.', 'x'.repeat(3000)].every((x) => pruefeSigniert(basis, 'tn_zweit_v1:3', x, t0) === null))
}

console.log('\nEinmal-Merker\n')
{
    const t0 = 1_000_000
    let liste = verbrauche([], 'a', t0 + 100, t0)
    check('erste Einlösung geht', Array.isArray(liste) && liste.length === 1)
    check('dieselbe Kennung ein zweites Mal → null', verbrauche(liste, 'a', t0 + 100, t0 + 1) === null)
    liste = verbrauche(liste, 'b', t0 + 300, t0 + 2)
    check('abgelaufene fallen heraus', verbrauche(liste, 'c', t0 + 500, t0 + 200).map((e) => e[0]).join() === 'b,c')
    check('kaputter Merker zählt als leer', Array.isArray(verbrauche('Unsinn', 'a', 1, 0)))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
