/**
 * Selbsttest YubiKey (`webauthn.js`) — ohne Datenbank und ohne Server.
 *
 *   node server/__selftest-webauthn.mjs
 *   WEBAUTHN_AUFNAHME_SCHREIBEN=1 node server/__selftest-webauthn.mjs   # Aufnahme neu
 *
 * Die Antworten in `fixtures/webauthn-aufnahme.json` hat einmal der
 * Software-Authenticator (`__webauthn-attrappe.mjs`) erzeugt; sie sind fest,
 * damit ein Wechsel der Bibliothek, der dieselbe Antwort plötzlich anders
 * bewertet, hier auffällt. Geprüft wird, was abgewiesen werden MUSS: falsche
 * Origin, eine IP als RP-ID, ein sinkender Zähler, eine fremde Challenge.
 * Die Einmaligkeit der Challenge braucht die Datenbank und steht in
 * `__selftest-zweifaktor-db.mjs`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { schluesselKontext, registrierOptionen, loginOptionen, tokenAusAntwort, pruefeRegistrierung, pruefeLogin } from './webauthn.js'
import { SoftwareSchluessel } from './__webauthn-attrappe.mjs'

const hier = path.dirname(fileURLToPath(import.meta.url))
const AUFNAHME = path.join(hier, 'fixtures', 'webauthn-aufnahme.json')

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const RP = 'autarktrade.local'
const ORIGIN = 'https://autarktrade.local:8443'

if (process.env.WEBAUTHN_AUFNAHME_SCHREIBEN === '1') {
    const sw = new SoftwareSchluessel()
    const tokRegistrieren = 'aufnahme-registrieren-token'
    const reg = sw.registriere(await registrierOptionen({ rpId: RP, challenge: tokRegistrieren }), ORIGIN)
    const optionen = (t) => loginOptionen({ rpId: RP, challenge: t, schluessel: [{ credentialId: sw.kennung, transports: '["usb"]' }] })
    const tok1 = 'aufnahme-login-1'
    const tok2 = 'aufnahme-login-2'
    const login1 = sw.melde(await optionen(tok1), ORIGIN, { zaehler: 1 })
    const login2 = sw.melde(await optionen(tok2), ORIGIN, { zaehler: 2 })
    fs.writeFileSync(AUFNAHME, JSON.stringify({
        hinweis: 'Erzeugt von __selftest-webauthn.mjs mit WEBAUTHN_AUFNAHME_SCHREIBEN=1 (Software-Authenticator, P-256, ohne PIN).',
        rpId: RP, origin: ORIGIN, tokRegistrieren, reg, tok1, login1, tok2, login2,
    }, null, 2) + '\n')
    console.log('Aufnahme geschrieben:', AUFNAHME)
}

console.log('\nRP-ID und Origin aus dem Host\n')
{
    const erlaubt = ['autarktrade.local', '192.168.1.5']
    const k = (host, https) => schluesselKontext({ host, https, erlaubteNamen: erlaubt })
    let x = k('autarktrade.local:8443', true)
    check('autarktrade.local über HTTPS', x.rpId === 'autarktrade.local' && x.origin === 'https://autarktrade.local:8443', JSON.stringify(x))
    x = k('localhost:8091', false)
    check('localhost über http (sicherer Kontext)', x.rpId === 'localhost' && x.origin === 'http://localhost:8091', JSON.stringify(x))
    check('Standardport fällt aus der Origin', k('autarktrade.local:443', true).origin === 'https://autarktrade.local')
    check('IPv4 als Host → nie RP-ID', k('192.168.1.5:8443', true).grund === 'ip')
    check('… auch wenn sie in AT_ALLOWED_HOSTS steht', k('192.168.1.5', true).grund === 'ip')
    check('IPv6 und 127.0.0.1 → nie RP-ID', k('[::1]:8080', true).grund === 'ip' && k('127.0.0.1:8080', false).grund === 'ip')
    check('unbekannter Name → abgewiesen', k('nas.fritz.box:8443', true).grund === 'name')
    check('erlaubter Name über http → braucht HTTPS', k('autarktrade.local:8080', false).grund === 'unsicher')
    check('ohne Host → abgewiesen', k('', true).grund === 'fehlt')
    check('Gross/Klein und Punkt am Ende', k('AutarkTrade.Local.:8443', true).rpId === 'autarktrade.local')
}

console.log('\nOptionen: antippen, keine PIN, keine residenten Schlüssel\n')
{
    const r = await registrierOptionen({ rpId: RP, challenge: 'abc', vorhandene: [{ credentialId: 'QUJD', transports: '["usb"]' }] })
    check('Registrieren: Attestation none', r.attestation === 'none')
    check('Registrieren: userVerification discouraged, residentKey discouraged',
        r.authenticatorSelection?.userVerification === 'discouraged' && r.authenticatorSelection?.residentKey === 'discouraged'
        && r.authenticatorSelection?.requireResidentKey === false, JSON.stringify(r.authenticatorSelection))
    check('Registrieren: vorhandene werden ausgeschlossen', r.excludeCredentials?.[0]?.id === 'QUJD')
    check('Registrieren: RP-ID und Challenge = Token als UTF-8', r.rp?.id === RP && Buffer.from(r.challenge, 'base64url').toString() === 'abc')
    const l = await loginOptionen({ rpId: RP, challenge: 'xyz', schluessel: [{ credentialId: 'QUJD' }, { credentialId: 'REVG' }] })
    check('Login: alle Schlüssel in allowCredentials (kein Benutzername nötig)', l.allowCredentials?.map((c) => c.id).join() === 'QUJD,REVG')
    check('Login: userVerification discouraged', l.userVerification === 'discouraged')
}

console.log('\nAufgenommene Antworten\n')
{
    const a = JSON.parse(fs.readFileSync(AUFNAHME, 'utf8'))
    check('Token aus clientDataJSON gelesen', tokenAusAntwort(a.reg) === a.tokRegistrieren && tokenAusAntwort(a.login1) === a.tok1)
    check('Unsinn → kein Token', tokenAusAntwort(null) === null && tokenAusAntwort({ response: { clientDataJSON: 'xx' } }) === null)

    const s = await pruefeRegistrierung({ antwort: a.reg, token: a.tokRegistrieren, origin: a.origin, rpId: a.rpId })
    check('Registrierung angenommen', !!s && s.credentialId === a.reg.id && s.publicKey.length > 40 && s.signCount === 0, JSON.stringify(s))
    check('Registrierung: Transports übernommen', s?.transports?.includes('usb'))
    check('Registrierung mit falscher Origin → abgewiesen', await pruefeRegistrierung({ antwort: a.reg, token: a.tokRegistrieren, origin: 'https://evil.example', rpId: a.rpId }) === null)
    check('Registrierung mit anderer Challenge → abgewiesen', await pruefeRegistrierung({ antwort: a.reg, token: 'anderes', origin: a.origin, rpId: a.rpId }) === null)
    check('Registrierung unter anderer RP-ID → abgewiesen', await pruefeRegistrierung({ antwort: a.reg, token: a.tokRegistrieren, origin: a.origin, rpId: 'localhost' }) === null)

    const gespeichert = { ...s, transports: JSON.stringify(s.transports), signCount: 0 }
    const l1 = await pruefeLogin({ antwort: a.login1, token: a.tok1, origin: a.origin, rpId: a.rpId, schluessel: gespeichert })
    check('Login 1 angenommen, Zähler 1', l1?.neuerZaehler === 1, JSON.stringify(l1))
    check('Login mit falscher Origin → abgewiesen',
        await pruefeLogin({ antwort: a.login1, token: a.tok1, origin: 'https://192.168.1.5:8443', rpId: a.rpId, schluessel: gespeichert }) === null)
    check('Login mit IP als RP-ID → abgewiesen',
        await pruefeLogin({ antwort: a.login1, token: a.tok1, origin: a.origin, rpId: '192.168.1.5', schluessel: gespeichert }) === null)
    check('Login mit fremder Challenge → abgewiesen',
        await pruefeLogin({ antwort: a.login1, token: a.tok2, origin: a.origin, rpId: a.rpId, schluessel: gespeichert }) === null)
    check('Login 1 noch einmal (Zähler gleich) → abgewiesen',
        await pruefeLogin({ antwort: a.login1, token: a.tok1, origin: a.origin, rpId: a.rpId, schluessel: { ...gespeichert, signCount: 1 } }) === null)
    check('Login 2 nach Login 1 → Zähler 2',
        (await pruefeLogin({ antwort: a.login2, token: a.tok2, origin: a.origin, rpId: a.rpId, schluessel: { ...gespeichert, signCount: 1 } }))?.neuerZaehler === 2)
    check('sinkender Zähler (gespeichert 5, gemeldet 2) → abgewiesen',
        await pruefeLogin({ antwort: a.login2, token: a.tok2, origin: a.origin, rpId: a.rpId, schluessel: { ...gespeichert, signCount: 5 } }) === null)
    check('fremder öffentlicher Schlüssel → abgewiesen',
        await pruefeLogin({ antwort: a.login1, token: a.tok1, origin: a.origin, rpId: a.rpId, schluessel: { ...gespeichert, publicKey: (await pruefeRegistrierung({ antwort: new SoftwareSchluessel().registriere(await registrierOptionen({ rpId: RP, challenge: 'z' }), ORIGIN), token: 'z', origin: ORIGIN, rpId: RP })).publicKey } }) === null)
}

console.log('\nFrischer Software-Schlüssel unter localhost\n')
{
    const sw = new SoftwareSchluessel()
    const o = 'http://localhost:8091'
    const reg = sw.registriere(await registrierOptionen({ rpId: 'localhost', challenge: 't-reg' }), o)
    const s = await pruefeRegistrierung({ antwort: reg, token: 't-reg', origin: o, rpId: 'localhost' })
    check('Registrieren unter localhost', !!s)
    // Ein Passkey ohne Zähler meldet immer 0 — das muss gehen, solange auch gespeichert 0 steht.
    const l = sw.melde(await loginOptionen({ rpId: 'localhost', challenge: 't-1', schluessel: [{ credentialId: s.credentialId }] }), o, { zaehler: 0 })
    check('Zähler 0/0 (Passkey ohne Zähler) wird angenommen',
        (await pruefeLogin({ antwort: l, token: 't-1', origin: o, rpId: 'localhost', schluessel: { ...s, signCount: 0 } }))?.neuerZaehler === 0)
    check('… aber 0 nach einem gezählten Login nicht',
        await pruefeLogin({ antwort: l, token: 't-1', origin: o, rpId: 'localhost', schluessel: { ...s, signCount: 3 } }) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
