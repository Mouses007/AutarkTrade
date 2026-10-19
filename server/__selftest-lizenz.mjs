/**
 * Selbsttest für die Lizenzschlüssel (`server/lizenz.js`).
 *
 *   node server/__selftest-lizenz.mjs
 *
 * Warum: ein Fehler in der Prüfung fällt sonst erst beim Kunden auf — in die eine
 * Richtung als „mein gekaufter Schlüssel geht nicht", in die andere als Schlüssel,
 * die sich jeder selbst schreiben kann. Geprüft wird deshalb vor allem das, was
 * NICHT durchgehen darf: fremde Signatur, ein Byte geändert, Inhalt ausgetauscht,
 * ein Testschlüssel ohne Ende. Mit einem Wegwerf-Schlüsselpaar; der echte private
 * Schlüssel ist nie im Spiel.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    signiere, leseSchluessel, lizenzStand, updateErlaubt, inhaltMaengel, heute,
    oeffentlicherSchluessel, OEFFENTLICHER_SCHLUESSEL,
} from './lizenz.js'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

const paar = crypto.generateKeyPairSync('ed25519')
const fremd = crypto.generateKeyPairSync('ed25519')
const pub = paar.publicKey

const inhalt = {
    v: 1, id: 'AT-2026-0001', kaeufer: 'Erika Muster', edition: 'standard',
    ausgestellt: '2026-10-19', updatesBis: '2027-10-19',
}

console.log('Signieren und lesen')
const schluessel = signiere(inhalt, paar.privateKey)
pruefe('Format AT1.x.y', /^AT1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(schluessel), schluessel)
const g = leseSchluessel(schluessel, pub)
pruefe('eigener Schlüssel geht durch', g.ok, JSON.stringify(g))
pruefe('Inhalt kommt unverändert zurück', g.ok && g.inhalt.kaeufer === 'Erika Muster' && g.inhalt.updatesBis === '2027-10-19')
pruefe('Zeilenumbrüche und Leerzeichen aus der Mail stören nicht',
    leseSchluessel('  ' + schluessel.slice(0, 30) + '\n  ' + schluessel.slice(30) + '\n', pub).ok)

console.log('Was nicht durchgehen darf')
pruefe('leer → leer', leseSchluessel('', pub).fehler === 'leer')
pruefe('Unsinn → format', leseSchluessel('hallo', pub).fehler === 'format')
pruefe('falsches Präfix → format', leseSchluessel(schluessel.replace(/^AT1/, 'AT2'), pub).fehler === 'format')
pruefe('fremder privater Schlüssel → signatur',
    leseSchluessel(signiere(inhalt, fremd.privateKey), pub).fehler === 'signatur')
const [k, mitte, sig] = schluessel.split('.')
const anderer = Buffer.from(JSON.stringify({ ...inhalt, updatesBis: '2099-12-31' })).toString('base64url')
pruefe('Inhalt ausgetauscht, Signatur behalten → signatur', leseSchluessel(`${k}.${anderer}.${sig}`, pub).fehler === 'signatur')
const kaputt = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1)
pruefe('ein Zeichen der Signatur geändert → signatur', leseSchluessel(`${k}.${mitte}.${kaputt}`, pub).fehler === 'signatur')
pruefe('Signatur fehlt → format', leseSchluessel(`${k}.${mitte}.`, pub).fehler === 'format')
pruefe('gegen den eingebauten Schlüssel ist ein Testpaar-Schlüssel ungültig',
    leseSchluessel(schluessel).fehler === 'signatur')

console.log('Inhalt')
pruefe('vollständiger Inhalt ohne Mängel', inhaltMaengel(inhalt).length === 0)
pruefe('ohne Käufer', inhaltMaengel({ ...inhalt, kaeufer: ' ' }).includes('kaeufer'))
pruefe('erfundenes Datum 2027-02-31', inhaltMaengel({ ...inhalt, updatesBis: '2027-02-31' }).includes('updatesBis'))
pruefe('unbekannte Edition', inhaltMaengel({ ...inhalt, edition: 'gold' }).includes('edition'))
pruefe('Testschlüssel ohne Ende', inhaltMaengel({ ...inhalt, edition: 'test' }).includes('testOhneEnde'))
pruefe('Zugang ohne Token', inhaltMaengel({ ...inhalt, zugang: { benutzer: 'x' } }).includes('zugang'))
let geworfen = false
try { signiere({ ...inhalt, kaeufer: '' }, paar.privateKey) } catch { geworfen = true }
pruefe('signiere weigert sich bei Mängeln', geworfen)

console.log('Stand')
pruefe('kein Schlüssel → Testmodus', lizenzStand('', { oeffentlich: pub }).modus === 'test')
const voll = lizenzStand(schluessel, { tag: '2026-11-01', oeffentlich: pub })
pruefe('gültig → voll, kein Testmodus', voll.modus === 'voll' && voll.testmodus === false)
pruefe('Updates aktiv vor dem Ende', voll.updatesAktiv === true)
pruefe('Updates aus nach dem Ende, Lizenz bleibt voll',
    (() => { const s = lizenzStand(schluessel, { tag: '2027-10-20', oeffentlich: pub }); return s.modus === 'voll' && !s.updatesAktiv })())
pruefe('ungültiger Text → ungueltig + Testmodus',
    (() => { const s = lizenzStand('AT1.a.b', { oeffentlich: pub }); return s.modus === 'ungueltig' && s.testmodus })())
const test = signiere({ ...inhalt, edition: 'test', gueltigBis: '2026-11-02' }, paar.privateKey)
pruefe('Testschlüssel am letzten Tag noch voll', lizenzStand(test, { tag: '2026-11-02', oeffentlich: pub }).modus === 'voll')
pruefe('Testschlüssel danach abgelaufen', lizenzStand(test, { tag: '2026-11-03', oeffentlich: pub }).modus === 'abgelaufen')
const mitZugang = signiere({ ...inhalt, zugang: { benutzer: 'kunde', token: 'geheim-123' } }, paar.privateKey)
const zs = lizenzStand(mitZugang, { tag: '2026-11-01', oeffentlich: pub })
pruefe('Zugang wird nur als ja/nein gemeldet', zs.zugang === true && !JSON.stringify(zs).includes('geheim-123'))

console.log('Update-Berechtigung')
pruefe('Fassung vor dem Ende erlaubt', updateErlaubt(voll, '2027-05-01T10:00:00Z').erlaubt)
pruefe('Fassung am letzten Tag erlaubt', updateErlaubt(voll, '2027-10-19').erlaubt)
pruefe('Fassung nach dem Ende nicht', updateErlaubt(voll, '2027-10-20T08:00:00Z').grund === 'updatesAbgelaufen')
pruefe('Mitternacht zählt in Zürich, nicht in UTC (23:30 UTC am 19. = 20. in Zürich)',
    updateErlaubt(voll, '2027-10-19T23:30:00Z').grund === 'updatesAbgelaufen')
pruefe('ohne Schlüssel kein Update', updateErlaubt(lizenzStand('', { oeffentlich: pub }), '2026-11-01').grund === 'keinSchluessel')
pruefe('ohne Erscheinungsdatum kein Update', updateErlaubt(voll, '').grund === 'datumUnbekannt')
pruefe('heute() liefert YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(heute()))

console.log('Eingebauter Schlüssel und Repo')
let geladen = false
try { geladen = oeffentlicherSchluessel(OEFFENTLICHER_SCHLUESSEL).asymmetricKeyType === 'ed25519' } catch { /* bleibt false */ }
pruefe('eingebauter öffentlicher Schlüssel ist Ed25519', geladen)
// Ein privater Schlüssel im Repo wäre das Ende jeder Lizenzprüfung.
const verdaechtig = []
function durchsuche(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', '.claude'].includes(e.name)) continue
        const p = path.join(ordner, e.name)
        if (e.isDirectory()) durchsuche(p)
        else if (/\.(pem|key)$/i.test(e.name)) verdaechtig.push(path.relative(wurzel, p))
        else if (fs.statSync(p).size < 2_000_000 && /\.(m?js|json|md|sh|txt)$/.test(e.name)
            && /-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/.test(fs.readFileSync(p, 'utf8'))
            && !p.endsWith('__selftest-lizenz.mjs')) verdaechtig.push(path.relative(wurzel, p))
    }
}
durchsuche(wurzel)
pruefe('kein privater Schlüssel im Repo', verdaechtig.length === 0, verdaechtig.join(', '))

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
