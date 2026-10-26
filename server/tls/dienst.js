/**
 * HTTPS der App: Zertifikate aus der Datenbank, der HTTPS-Server, der
 * Erneuerungs-Takt und die Routen.
 *
 * Bis 26.10.2026 terminierte Caddy das TLS mit einem mkcert-Zertifikat, das
 * man von Hand erzeugen, kopieren und erneuern musste. Jetzt:
 *
 *   - Beim ersten Start legt die App eine eigene Stamm-CA an (einmal je
 *     Datenbank — zwei Prozesse an derselben PostgreSQL erzeugen nicht zwei:
 *     angelegt wird per INSERT … ON CONFLICT DO NOTHING, danach gilt, was in
 *     der Zeile steht) und stellt sich ein Server-Zertifikat aus.
 *   - Ein HTTPS-Server lauscht neben dem HTTP-Server auf AT_TLS_PORT
 *     (Vorgabe 8443, `aus` schaltet ab) mit derselben Express-App. HTTP bleibt
 *     (ESP32-Displays sprechen kein TLS).
 *   - Neue Zertifikate greifen ohne Neustart (`server.setSecureContext`).
 *   - Erneuert wird, wenn weniger als 30 Tage übrig sind oder ein Soll-Name
 *     fehlt (Takt täglich; ein Prozess, der den Wechsel eines anderen sieht,
 *     lädt ihn alle 15 min nach).
 *
 * Namen im Zertifikat: localhost, 127.0.0.1, ::1, der mDNS-Name
 * (AT_MDNS_NAME, Vorgabe autarktrade.local), AT_TLS_NAMEN (Komma-Liste, z. B.
 * die NAS-IP) und die in der Oberfläche bestätigten. Im Container kennt die
 * App die Adresse der NAS nicht — sie merkt sich deshalb die Host-Köpfe, unter
 * denen sie aufgerufen wurde (nur was der Host-Schutz durchlässt), und schlägt
 * sie vor. Aufgenommen wird ein Vorschlag erst nach Bestätigung.
 *
 * Öffentlich (ohne Sitzung): das CA-Zertifikat unter /api/tls/ca.crt,
 * /api/tls/ca und /api/esp32/ca. Ein CA-Zertifikat ist öffentlich — ohne es
 * kann ein Gerät der App gar nicht erst vertrauen.
 */
import https from 'node:https'
import { getKnex } from '../database.js'
import { encrypt, decrypt } from '../crypto.js'
import { umgebung } from '../umgebung.js'
import { logError, logWarn } from '../logger.js'
import { ausPem } from './der.js'
import {
    erzeugeCa, erzeugeServerZertifikat, pruefeErneuerung, basisNamen, namenAusText,
    normNamen, normName, nameAusHost, zertNamen, zertInfo, fingerabdruck, ERNEUERN_TAGE, MAX_NAMEN,
} from './zertifikat.js'

const TABELLE = 'tls_zertifikat'
const NACHLADEN_MS = 15 * 60 * 1000
const PRUEFEN_MS = 24 * 60 * 60 * 1000
const MAX_VORSCHLAEGE = 20
/** Ein gesehener Host wird höchstens so oft je Name in die DB geschrieben. */
const VORSCHLAG_SCHREIBEN_MS = 6 * 60 * 60 * 1000

/** Zuletzt geladener Stand (entschlüsselt) — null bis zum ersten Laden. */
let aktuell = null
let fehler = null
let tlsServer = null
let tlsLauscht = false
let nachladeTakt = null
let letztePruefung = 0
const gesehen = new Map()   // name → letzter Schreibzeitpunkt

// ── Umgebung ─────────────────────────────────────────────────────────────

/** HTTPS-Port aus AT_TLS_PORT: Vorgabe 8443, `aus`/`0` = kein HTTPS. */
export function tlsPort(wert = umgebung('TLS_PORT')) {
    const s = String(wert ?? '').trim().toLowerCase()
    if (s === '') return 8443
    if (['aus', 'off', 'nein', 'no', '0', 'false'].includes(s)) return null
    const n = Number(s)
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8443
}

function mdnsName() {
    const m = umgebung('MDNS_NAME')
    return m === undefined || m === null || String(m).trim() === '' ? 'autarktrade.local' : String(m)
}

/** Namen aus der Umgebung dieses Prozesses (Basis + AT_TLS_NAMEN). */
export function umgebungsNamen() {
    return { basis: basisNamen(mdnsName()), umgebung: namenAusText(umgebung('TLS_NAMEN')) }
}

// ── Datenbank ────────────────────────────────────────────────────────────

const json = (text, leer) => { try { const v = JSON.parse(text || ''); return v ?? leer } catch { return leer } }

async function ladeZeile() {
    return getKnex()(TABELLE).where('id', 1).first()
}

function sollNamen(zeile) {
    const { basis, umgebung: umg } = umgebungsNamen()
    return normNamen([...basis, ...umg, ...json(zeile?.namen, [])])
}

/** Zeile → entschlüsselter Arbeitsstand (oder Fehlertext). */
function entpacke(zeile) {
    const caSchluessel = zeile.caSchluessel ? decrypt(zeile.caSchluessel) : ''
    const serverSchluessel = zeile.serverSchluessel ? decrypt(zeile.serverSchluessel) : ''
    let imZertifikat = []
    try { imZertifikat = zeile.serverPem ? zertNamen(zeile.serverPem) : [] } catch { /* unlesbar */ }
    return {
        stand: Number(zeile.stand) || 0,
        caPem: zeile.caPem || '',
        caId: zeile.caId || '',
        caSchluessel,
        serverPem: zeile.serverPem || '',
        serverSchluessel,
        serverErstellt: Number(zeile.serverErstellt) || 0,
        imZertifikat,
        namen: normNamen(json(zeile.namen, [])),
        vorschlaege: json(zeile.vorschlaege, []).filter((v) => v && typeof v.name === 'string'),
        abgelehnt: normNamen(json(zeile.abgelehnt, [])),
    }
}

/** Neue Zeile mit CA und Server-Zertifikat anlegen — nur, wenn noch keine da ist. */
async function legeCaAn(knex) {
    const jetzt = Date.now()
    const ca = erzeugeCa({ jetzt })
    const { basis, umgebung: umg } = umgebungsNamen()
    const server = erzeugeServerZertifikat({ caPem: ca.pem, caSchluessel: ca.schluessel, namen: [...basis, ...umg], jetzt })
    await knex(TABELLE).insert({
        id: 1,
        caPem: ca.pem, caSchluessel: encrypt(ca.schluessel), caId: ca.id, caErstellt: jetzt,
        serverPem: server.pem, serverSchluessel: encrypt(server.schluessel), serverErstellt: jetzt,
        namen: '[]', vorschlaege: '[]', abgelehnt: '[]', stand: 1,
    }).onConflict('id').ignore()
    return ca.id
}

/**
 * Server-Zertifikat neu ausstellen und schreiben — nur, wenn die Zeile noch
 * den gelesenen Stand hat. Sonst war ein anderer Prozess schneller; dessen
 * Zertifikat gilt dann.
 *
 * @param {object} zeile     gelesene DB-Zeile
 * @param {string[]} namen   Namen fürs neue Zertifikat
 * @returns {Promise<boolean>} geschrieben?
 */
async function stelleAus(zeile, namen, extra = {}) {
    const z = entpacke(zeile)
    if (!z.caSchluessel) throw new Error('Der Schlüssel der CA ist nicht lesbar (AT_SECRET geändert?). Unter Einstellungen › Allgemein › HTTPS eine neue CA erzeugen.')
    const jetzt = Date.now()
    const server = erzeugeServerZertifikat({ caPem: z.caPem, caSchluessel: z.caSchluessel, namen, jetzt })
    const n = await getKnex()(TABELLE).where({ id: 1, stand: z.stand }).update({
        serverPem: server.pem, serverSchluessel: encrypt(server.schluessel), serverErstellt: jetzt,
        stand: z.stand + 1, ...extra,
    })
    return n > 0
}

/** Stand aus der DB übernehmen und dem laufenden HTTPS-Server geben. */
function uebernimm(zeile) {
    const neu = entpacke(zeile)
    const wechsel = !aktuell || aktuell.serverPem !== neu.serverPem
    aktuell = neu
    if (!neu.serverSchluessel) {
        fehler = 'Der Schlüssel des Server-Zertifikats ist nicht lesbar (AT_SECRET geändert?).'
        return
    }
    fehler = null
    if (wechsel && tlsServer) {
        try {
            tlsServer.setSecureContext({ key: neu.serverSchluessel, cert: neu.serverPem })
            console.log(` -> HTTPS: neues Zertifikat aktiv (gültig bis ${new Date(zertInfo(neu.serverPem).nichtNach).toISOString().slice(0, 10)})`)
        } catch (e) {
            fehler = 'Zertifikat ließ sich nicht laden: ' + e.message
            logError('tls', 'setSecureContext fehlgeschlagen', e)
        }
    }
}

/**
 * Prüfen und nötigenfalls erneuern. `ausdruecklich` (Knopf, Namensänderung):
 * genau die Soll-Namen dieses Prozesses. Sonst (Takt, Start): die Soll-Namen
 * PLUS die, die schon im Zertifikat stehen — ein zweiter Prozess an derselben
 * DB mit anderem AT_TLS_NAMEN soll seine nicht verlieren.
 *
 * @returns {Promise<{erneuert: boolean, grund: string}>}
 */
export async function pruefeUndErneuere({ ausdruecklich = false } = {}) {
    const knex = getKnex()
    for (let versuch = 0; versuch < 3; versuch++) {
        let zeile = await ladeZeile()
        if (zeile && !zeile.caPem) {
            // Zeile ohne CA (von Hand geleert): wie „CA neu erzeugen".
            await erzeugeNeueCa()
            zeile = await ladeZeile()
        }
        if (!zeile) {
            const meine = await legeCaAn(knex)
            zeile = await ladeZeile()
            // Nur wer wirklich angelegt hat, meldet es (die anderen haben verloren).
            if (zeile?.caPem && zeile.caId === meine) console.log(` -> HTTPS: eigene Stamm-CA angelegt (${zeile.caId}), Fingerabdruck ${fingerabdruck(zeile.caPem)}`)
        }
        if (!zeile?.caPem) throw new Error('TLS-Zeile fehlt nach dem Anlegen')
        const soll = sollNamen(zeile)
        const serverLesbar = !!(zeile.serverSchluessel && decrypt(zeile.serverSchluessel))
        const p = ausdruecklich
            ? { noetig: true, grund: 'ausdruecklich' }
            : (serverLesbar ? pruefeErneuerung({ serverPem: zeile.serverPem, caPem: zeile.caPem, sollNamen: soll }) : { noetig: true, grund: 'schluesselUnlesbar' })
        if (!p.noetig) { uebernimm(zeile); return { erneuert: false, grund: '' } }
        let namen = soll
        if (!ausdruecklich && zeile.serverPem) {
            try { namen = normNamen([...soll, ...zertNamen(zeile.serverPem)]) } catch { /* altes Zertifikat unlesbar */ }
        }
        if (await stelleAus(zeile, namen)) {
            uebernimm(await ladeZeile())
            console.log(` -> HTTPS: Server-Zertifikat erneuert (${p.grund}${p.fehlend ? ': ' + p.fehlend.join(', ') : ''})`)
            return { erneuert: true, grund: p.grund }
        }
        // Ein anderer Prozess hat gerade geschrieben — mit seinem Stand neu prüfen.
    }
    uebernimm(await ladeZeile())
    return { erneuert: false, grund: 'konkurrenz' }
}

/** Beim Start: CA anlegen, falls keine da ist, Zertifikat prüfen. Wirft nie. */
export async function stelleTlsSicher() {
    try {
        return await pruefeUndErneuere()
    } catch (e) {
        fehler = e.message
        logError('tls', 'Zertifikat beim Start nicht bereit', e)
        // Was da ist, trotzdem übernehmen (ein unlesbarer CA-Schlüssel hindert
        // ein noch gültiges Server-Zertifikat nicht).
        try { const z = await ladeZeile(); if (z) { uebernimm(z); if (!fehler) fehler = e.message } } catch { /* DB weg */ }
        return { erneuert: false, grund: 'fehler' }
    }
}

/** Neue Stamm-CA (Knopf, mit Warnung). Alle Geräte müssen ihr neu vertrauen. */
export async function erzeugeNeueCa() {
    const zeile = await ladeZeile()
    const jetzt = Date.now()
    const ca = erzeugeCa({ jetzt })
    const soll = sollNamen(zeile)
    const server = erzeugeServerZertifikat({ caPem: ca.pem, caSchluessel: ca.schluessel, namen: soll, jetzt })
    await getKnex()(TABELLE).where('id', 1).update({
        caPem: ca.pem, caSchluessel: encrypt(ca.schluessel), caId: ca.id, caErstellt: jetzt,
        serverPem: server.pem, serverSchluessel: encrypt(server.schluessel), serverErstellt: jetzt,
        stand: (Number(zeile?.stand) || 0) + 1,
    })
    uebernimm(await ladeZeile())
    console.log(` -> HTTPS: NEUE Stamm-CA (${ca.id}) — alle Geräte müssen ihr neu vertrauen`)
}

/** Eigene Namen ersetzen und sofort neu ausstellen. */
export async function setzeNamen(liste) {
    const roh = (Array.isArray(liste) ? liste : []).map((s) => String(s ?? '').trim()).filter(Boolean)
    const ungueltig = roh.filter((s) => !normName(s))
    if (ungueltig.length) {
        const e = new Error('Ungültige Namen/IPs: ' + ungueltig.join(', '))
        e.status = 400
        throw e
    }
    const namen = normNamen(roh)
    if (namen.length > MAX_NAMEN - 6) {
        const e = new Error(`Höchstens ${MAX_NAMEN - 6} eigene Einträge`)
        e.status = 400
        throw e
    }
    await sichereZeile()
    const z = await ladeZeile()
    const set = new Set(namen)
    const vorschlaege = json(z.vorschlaege, []).filter((v) => !set.has(v.name))
    const abgelehnt = normNamen(json(z.abgelehnt, [])).filter((n) => !set.has(n))
    await getKnex()(TABELLE).where('id', 1).update({
        namen: JSON.stringify(namen), vorschlaege: JSON.stringify(vorschlaege), abgelehnt: JSON.stringify(abgelehnt),
    })
    return pruefeUndErneuere({ ausdruecklich: true })
}

/** Vorschlag aufnehmen (→ eigene Namen, neues Zertifikat) oder verwerfen. */
export async function entscheideVorschlag(name, aufnehmen) {
    const n = normName(name)
    if (!n) { const e = new Error('Ungültiger Name'); e.status = 400; throw e }
    await sichereZeile()
    const z = await ladeZeile()
    if (aufnehmen) return setzeNamen([...json(z.namen, []), n.wert])
    const vorschlaege = json(z.vorschlaege, []).filter((v) => v.name !== n.wert)
    const abgelehnt = normNamen([...json(z.abgelehnt, []), n.wert])
    await getKnex()(TABELLE).where('id', 1).update({ vorschlaege: JSON.stringify(vorschlaege), abgelehnt: JSON.stringify(abgelehnt) })
    uebernimm(await ladeZeile())
    return { erneuert: false, grund: '' }
}

async function sichereZeile() {
    if (!(await ladeZeile())) await pruefeUndErneuere()
}

// ── Host-Köpfe merken (Vorschläge) ───────────────────────────────────────

/**
 * Middleware NACH dem Host-Schutz: merkt sich Namen, unter denen die App
 * aufgerufen wird, die aber nicht im Zertifikat stehen. Schreibt selten
 * (je Name höchstens alle 6 h) und nie mehr als 20 Vorschläge. Aufgenommen
 * wird nichts von selbst.
 */
export function merkeHostMiddleware(req, _res, next) {
    try {
        const name = aktuell && nameAusHost(req.headers?.host)
        if (name && !istBekannt(name)) {
            const jetzt = Date.now()
            if (jetzt - (gesehen.get(name) || 0) > VORSCHLAG_SCHREIBEN_MS) {
                gesehen.set(name, jetzt)
                if (gesehen.size > 200) gesehen.clear()
                merkeVorschlag(name, jetzt).catch((e) => logWarn('tls', 'Vorschlag nicht gespeichert', e))
            }
        }
    } catch { /* nie eine Anfrage daran scheitern lassen */ }
    next()
}

function istBekannt(name) {
    if (!aktuell) return true
    if (aktuell.abgelehnt.includes(name) || aktuell.namen.includes(name)) return true
    const { basis, umgebung: umg } = umgebungsNamen()
    return basis.includes(name) || umg.includes(name) || aktuell.imZertifikat.includes(name)
}

async function merkeVorschlag(name, jetzt) {
    const z = await ladeZeile()
    if (!z) return
    const liste = json(z.vorschlaege, []).filter((v) => v && v.name !== name)
    liste.unshift({ name, zuletzt: jetzt })
    await getKnex()(TABELLE).where('id', 1).update({ vorschlaege: JSON.stringify(liste.slice(0, MAX_VORSCHLAEGE)) })
    if (aktuell) aktuell.vorschlaege = liste.slice(0, MAX_VORSCHLAEGE)
}

// ── Server und Takt ──────────────────────────────────────────────────────

/**
 * HTTPS-Server mit derselben App starten. Ein belegter Port ist kein Grund,
 * den Dienst sterben zu lassen — HTTP läuft weiter, die Oberfläche zeigt es.
 *
 * @param {import('express').Express} app
 * @param {object} opt
 * @param {string} opt.host
 * @param {number|null} [opt.port]     Vorgabe: AT_TLS_PORT
 * @param {Function} [opt.upgrade]     WebSocket-Upgrade (Vite im Entwicklungsbetrieb)
 * @returns {Promise<import('node:https').Server|null>}
 */
export async function starteHttps(app, { host, port = tlsPort(), upgrade } = {}) {
    if (port === null) {
        console.log(' -> HTTPS aus (AT_TLS_PORT=aus)')
        return null
    }
    if (!aktuell?.serverSchluessel || !aktuell?.serverPem) {
        console.warn(` -> HTTPS NICHT gestartet: ${fehler || 'kein Zertifikat'}`)
        return null
    }
    const server = https.createServer({ key: aktuell.serverSchluessel, cert: aktuell.serverPem, minVersion: 'TLSv1.2' }, app)
    if (upgrade) server.on('upgrade', upgrade)
    // Fehlerhafte Handshakes (alte Klienten, Port-Scanner) nur zählen, nicht melden.
    server.on('tlsClientError', () => {})
    const ok = await new Promise((fertig) => {
        server.once('error', (e) => {
            fehler = `HTTPS-Port ${port} nicht verfügbar: ${e.code || e.message}`
            console.warn(` -> ${fehler} — HTTP läuft weiter`)
            fertig(false)
        })
        server.listen(port, host, () => fertig(true))
    })
    if (!ok) return null
    tlsServer = server
    tlsLauscht = true
    server.on('error', (e) => logError('tls', 'HTTPS-Server', e))
    server.on('close', () => { tlsLauscht = false; if (tlsServer === server) tlsServer = null })
    console.log(` -> HTTPS auf https://${host}:${server.address().port} (CA ${aktuell.caId}, ${fingerabdruck(aktuell.caPem)})`)
    return server
}

/**
 * Takt: alle 15 min nachladen, was ein anderer Prozess geschrieben hat;
 * einmal am Tag prüfen und nötigenfalls erneuern.
 */
export function startTlsTakt() {
    if (nachladeTakt) return
    letztePruefung = Date.now()
    nachladeTakt = setInterval(async () => {
        try {
            if (Date.now() - letztePruefung >= PRUEFEN_MS) {
                letztePruefung = Date.now()
                await pruefeUndErneuere()
            } else {
                const z = await ladeZeile()
                if (z && (!aktuell || Number(z.stand) !== aktuell.stand)) uebernimm(z)
            }
        } catch (e) {
            fehler = e.message
            logError('tls', 'Takt', e)
        }
    }, NACHLADEN_MS)
    nachladeTakt.unref?.()
}

export function stopTlsTakt() {
    if (nachladeTakt) clearInterval(nachladeTakt)
    nachladeTakt = null
}

// ── Routen ───────────────────────────────────────────────────────────────

function caAntwort() {
    if (!aktuell?.caPem) return null
    return { pem: aktuell.caPem, sha256: fingerabdruck(aktuell.caPem) }
}

/** Öffentliche Routen — VOR der Sitzungsprüfung registrieren. */
export function setupTlsOeffentlich(app) {
    const alsJson = (req, res) => {
        const a = caAntwort()
        if (!a) return res.status(503).json({ error: 'Noch keine CA' })
        res.setHeader('Cache-Control', 'no-cache')
        res.json(a)
    }
    app.get('/api/tls/ca', alsJson)
    // Die Geräte (Android-App, ESP32) kennen den Pfad unter /api/esp32.
    app.get('/api/esp32/ca', alsJson)
    app.get('/api/tls/ca.crt', (req, res) => {
        if (!aktuell?.caPem) return res.status(503).type('text/plain').send('Noch keine CA')
        // DER: so erkennen Android, Windows und iOS die Datei als CA-Zertifikat.
        res.setHeader('Content-Type', 'application/x-x509-ca-cert')
        res.setHeader('Content-Disposition', `attachment; filename="AutarkTrade-CA-${aktuell.caId || 'lokal'}.crt"`)
        res.setHeader('Cache-Control', 'no-cache')
        res.send(ausPem(aktuell.caPem))
    })
}

/** Stand für die Oberfläche (ohne Schlüssel). */
export function tlsStatus() {
    const { basis, umgebung: umg } = umgebungsNamen()
    const info = (pem) => { try { return pem ? zertInfo(pem) : null } catch { return null } }
    const ca = info(aktuell?.caPem)
    const server = info(aktuell?.serverPem)
    const imZertifikat = aktuell?.imZertifikat || []
    return {
        aktiv: tlsLauscht,
        port: tlsPort(),
        lauschPort: tlsServer?.address()?.port || null,
        fehler,
        erneuernTage: ERNEUERN_TAGE,
        ca: ca && { ...ca, id: aktuell.caId },
        server: server && { ...server, namen: imZertifikat, erstellt: aktuell.serverErstellt },
        namen: { basis, umgebung: umg, eigene: aktuell?.namen || [] },
        vorschlaege: (aktuell?.vorschlaege || []).filter((v) => !imZertifikat.includes(v.name)),
        abgelehnt: aktuell?.abgelehnt || [],
    }
}

/** Verwaltung — hinter der Sitzung. */
export function setupTlsRoutes(app) {
    const fehlerAntwort = (res, e) => {
        const status = e.status || 500
        if (status >= 500) logError('tls', 'Route', e)
        res.status(status).json({ error: e.message || 'Fehler', status: tlsStatus() })
    }
    app.get('/api/tls/status', (req, res) => res.json(tlsStatus()))
    app.put('/api/tls/namen', async (req, res) => {
        try { await setzeNamen(req.body?.namen); res.json(tlsStatus()) } catch (e) { fehlerAntwort(res, e) }
    })
    app.post('/api/tls/vorschlag', async (req, res) => {
        try { await entscheideVorschlag(req.body?.name, req.body?.aufnehmen === true); res.json(tlsStatus()) } catch (e) { fehlerAntwort(res, e) }
    })
    app.post('/api/tls/erneuern', async (req, res) => {
        try { await pruefeUndErneuere({ ausdruecklich: true }); res.json(tlsStatus()) } catch (e) { fehlerAntwort(res, e) }
    })
    app.post('/api/tls/ca-neu', async (req, res) => {
        // Ausdrücklich bestätigt: ein versehentlicher Aufruf trennte jedes Gerät.
        if (req.body?.bestaetigt !== true) return res.status(400).json({ error: 'Bestätigung fehlt' })
        try { await erzeugeNeueCa(); res.json(tlsStatus()) } catch (e) { fehlerAntwort(res, e) }
    })
}

/** Nur für den Selbsttest. */
export function _tlsZuruecksetzen() {
    aktuell = null; fehler = null; tlsServer = null; tlsLauscht = false; gesehen.clear()
}
