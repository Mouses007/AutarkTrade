#!/usr/bin/env node
/**
 * Lizenzschlüssel ausstellen (nur beim Anbieter).
 *
 *   AT_LIZENZ_PRIVAT=~/.config/autarktrade/lizenz-signatur.pem \
 *     node scripts/lizenz-ausstellen.mjs --kaeufer "Erika Muster" [--mail erika@example.ch] \
 *       [--edition standard|test] [--monate 12 | --updates-bis 2027-10-19] \
 *       [--gueltig-bis 2026-11-02] [--id AT-2026-0001] \
 *       [--zugang-benutzer kunde --zugang-token github_pat_… --token-ablauf 2027-10-19]
 *     (Token: fine-grained, je Käufer, nur Lesen, Ablauf ≤ Update-Ende — A2-15)
 *
 *   node scripts/lizenz-ausstellen.mjs --pruefen "AT1.…"      # einen Schlüssel lesen
 *   node scripts/lizenz-ausstellen.mjs --neues-paar ~/pfad.pem  # einmalig: Paar erzeugen
 *
 * Der private Schlüssel kommt NUR über `AT_LIZENZ_PRIVAT` (Pfad zur PEM-Datei) und liegt
 * nie im Repo — `server/__selftest-lizenz.mjs` schlägt an, sobald eine .pem-Datei oder ein
 * „BEGIN PRIVATE KEY" im Baum auftaucht. Das Werkzeug prüft vor dem Ausgeben, dass der
 * fertige Schlüssel gegen den in `server/lizenz.js` EINGEBAUTEN öffentlichen Schlüssel
 * besteht — ein Schlüssel aus dem falschen Paar würde sonst still verschickt.
 */
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { signiere, leseSchluessel, lizenzStand, heute } from '../server/lizenz.js'

function argumente(argv) {
    const a = {}
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i]
        if (!t.startsWith('--')) continue
        const name = t.slice(2)
        const wert = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
        a[name] = wert
    }
    return a
}

function pfad(p) {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

function plusMonate(tag, monate) {
    const d = new Date(tag + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + Number(monate))
    return d.toISOString().slice(0, 10)
}

const a = argumente(process.argv.slice(2))

if (a['neues-paar']) {
    const ziel = pfad(String(a['neues-paar']))
    if (fs.existsSync(ziel)) {
        console.error(`${ziel} gibt es schon — ein neues Paar macht alle ausgestellten Schlüssel ungültig. Abbruch.`)
        process.exit(1)
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(ziel, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    console.log(`Privater Schlüssel: ${ziel} (nur lesbar für dich, NICHT ins Repo)`)
    console.log('Öffentlicher Schlüssel für OEFFENTLICHER_SCHLUESSEL in server/lizenz.js:')
    console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
    process.exit(0)
}

if (a.pruefen) {
    const g = leseSchluessel(String(a.pruefen))
    console.log(JSON.stringify(g.ok ? { ...lizenzStand(g.schluessel), inhalt: { ...g.inhalt, zugang: g.inhalt.zugang ? '(vorhanden)' : undefined } } : g, null, 2))
    process.exit(g.ok ? 0 : 1)
}

const privatPfad = process.env.AT_LIZENZ_PRIVAT
if (!privatPfad) {
    console.error('AT_LIZENZ_PRIVAT fehlt (Pfad zur PEM-Datei mit dem privaten Schlüssel).')
    process.exit(1)
}
if (!a.kaeufer || a.kaeufer === true) {
    console.error('--kaeufer "Name" fehlt.')
    process.exit(1)
}

/*
 * Zugangstoken im Schlüssel (Audit A2-15, F2 20.10.2026): die Nutzlast ist
 * nur signiert, nicht verschlüsselt — jeder Käufer kann das Token lesen und
 * weitergeben. Schaden begrenzen statt verstecken: nur fine-grained Tokens
 * (nur `contents:read`/`packages:read` auf das eine Repo), je Käufer eines,
 * mit Ablauf spätestens am Update-Ende — dann ist ein weitergegebenes Token
 * einzeln widerrufbar und läuft von selbst aus.
 */
if (a['zugang-token'] && a['zugang-token'] !== true) {
    const token = String(a['zugang-token'])
    if (!token.startsWith('github_pat_')) {
        console.error('--zugang-token: nur ein fine-grained Token (github_pat_…) je Käufer — ein klassisches Token gäbe Zugriff auf alle Repos des Kontos.')
        process.exit(1)
    }
    const ablauf = a['token-ablauf'] && a['token-ablauf'] !== true ? String(a['token-ablauf']) : ''
    const updatesBisVorab = a['updates-bis'] && a['updates-bis'] !== true ? String(a['updates-bis']) : plusMonate(heute(), a.monate && a.monate !== true ? a.monate : 12)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ablauf) || ablauf > updatesBisVorab) {
        console.error(`--token-ablauf JJJJ-MM-TT fehlt oder liegt nach dem Update-Ende (${updatesBisVorab}). Das Token bei GitHub mit genau diesem Ablauf anlegen.`)
        process.exit(1)
    }
}

const privat = crypto.createPrivateKey(fs.readFileSync(pfad(privatPfad)))
const ausgestellt = heute()
const edition = a.edition && a.edition !== true ? String(a.edition) : 'standard'
const inhalt = {
    v: 1,
    id: a.id && a.id !== true ? String(a.id) : `AT-${ausgestellt.slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    kaeufer: String(a.kaeufer).trim(),
    ...(a.mail && a.mail !== true ? { mail: String(a.mail).trim() } : {}),
    edition,
    ausgestellt,
    updatesBis: a['updates-bis'] && a['updates-bis'] !== true ? String(a['updates-bis']) : plusMonate(ausgestellt, a.monate && a.monate !== true ? a.monate : 12),
    ...(a['gueltig-bis'] && a['gueltig-bis'] !== true ? { gueltigBis: String(a['gueltig-bis']) } : {}),
    ...(a['zugang-token'] && a['zugang-token'] !== true
        ? { zugang: { token: String(a['zugang-token']), ...(a['zugang-benutzer'] && a['zugang-benutzer'] !== true ? { benutzer: String(a['zugang-benutzer']) } : {}) } }
        : {}),
}

const schluessel = signiere(inhalt, privat)
const probe = leseSchluessel(schluessel)
if (!probe.ok) {
    console.error(`Der ausgestellte Schlüssel besteht die Prüfung der Software nicht (${probe.fehler}) —`)
    console.error('passt der private Schlüssel zu OEFFENTLICHER_SCHLUESSEL in server/lizenz.js?')
    process.exit(1)
}
console.error(`Ausgestellt: ${inhalt.id} für ${inhalt.kaeufer}, ${inhalt.edition}, Updates bis ${inhalt.updatesBis}` +
    (inhalt.gueltigBis ? `, gültig bis ${inhalt.gueltigBis}` : '') + (inhalt.zugang ? ', mit Zugang zur Paketquelle' : ''))
console.log(schluessel)
