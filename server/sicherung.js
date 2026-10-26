/**
 * Tägliche Sicherung der Datenbank (Audit FUN-BAK-001, 26.10.2026).
 *
 * Bis dahin gab es nur den JSON-Export von Hand — ein Volume- oder NAS-Verlust
 * kostete alles seit dem letzten Klick, darunter die Handarbeit am Steuerteil.
 *
 *   SQLite      `VACUUM INTO` — eine in sich stimmige Kopie der laufenden
 *               WAL-Datenbank (eine Dateikopie wäre ohne `-wal` inkonsistent).
 *   PostgreSQL  derselbe JSON-Export wie der Knopf (`baueExport`, gzip).
 *               `pg_dump` ist im Container nicht installiert, und eine neue
 *               Systemabhängigkeit nur dafür ist es nicht wert; der JSON-Export
 *               ist das, was `/api/db-import` wieder einspielt.
 *
 * Geheimnisse sind im JSON redigiert (wie beim Knopf); die SQLite-Kopie trägt
 * die Schlüssel verschlüsselt — lesbar nur mit demselben `AT_SECRET`. Die
 * Dateien bekommen 0600.
 *
 * Ziel: `AT_SICHERUNG_ORDNER` (relativ zum Projekt oder absolut; `aus` schaltet
 * ab). Vorgabe nativ: `data/sicherungen` im Projekt. Im Container gibt es KEINE
 * Vorgabe: das mitgelieferte docker-compose.yml bindet für die App kein Volume
 * ein — eine Sicherung im Container-Dateisystem verschwände mit dem nächsten
 * `docker compose pull`. Dort also einen Ordner einbinden und die Variable setzen.
 *
 * Aufbewahrung: die letzten 14 Tage (eine Datei je UTC-Tag). Nur ein Prozess
 * sichert (DB-Anspruch `sicherung_taeglich` — NAS und Entwicklungsrechner teilen
 * eine PostgreSQL), im Testbetrieb gar keiner (`starteTakte` in index.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { getKnex } from './database.js'
import { umgebung } from './umgebung.js'
import { beansprucheTagesaufgabe, merkeAufgabenFehler } from './db-claim.js'
import { baueExport } from './backup-api.js'

export const AUFBEWAHRUNG_TAGE = 14
const TAKT_MS = 60 * 60e3
const SCHLUESSEL = 'sicherung_taeglich'
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATEI = /^autarktrade-sicherung-(\d{4}-\d{2}-\d{2})\.(json\.gz|db)$/
const gzip = promisify(zlib.gzip)

/** Läuft dieser Prozess in einem Container? */
export function imContainer() {
    return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')
}

/**
 * Zielordner der Sicherung oder null (aus). Rein bis auf die Vorgaben.
 * @param {{ wert?: string, container?: boolean, wurzel?: string }} [o]
 */
export function sicherungsOrdner({ wert = umgebung('SICHERUNG_ORDNER'), container = imContainer(), wurzel = WURZEL } = {}) {
    if (wert != null && String(wert).trim() !== '') {
        if (/^(aus|off|0|false|nein)$/i.test(String(wert).trim())) return null
        return path.resolve(wurzel, String(wert).trim())
    }
    return container ? null : path.join(wurzel, 'data', 'sicherungen')
}

/** Dateiname einer Sicherung. */
export function dateiName(datum, art) {
    return `autarktrade-sicherung-${datum}.${art === 'sqlite' ? 'db' : 'json.gz'}`
}

/**
 * Welche Sicherungen sind älter als die Aufbewahrung? (rein) Behalten werden
 * die letzten `tage` Kalendertage einschliesslich heute; fremde Dateien im
 * Ordner werden nie angefasst.
 * @param {string[]} namen
 * @param {string} heute  YYYY-MM-DD (UTC)
 */
export function zuLoeschen(namen, heute, tage = AUFBEWAHRUNG_TAGE) {
    const h = Date.parse(`${heute}T00:00:00Z`)
    return namen.filter((n) => {
        const m = String(n).match(DATEI)
        if (!m) return false
        const alter = Math.round((h - Date.parse(`${m[1]}T00:00:00Z`)) / 86400e3)
        return alter >= tage
    })
}

/**
 * Eine Sicherung schreiben und alte entfernen.
 * @returns {Promise<{ datei: string, bytes: number, geloescht: string[] }>}
 */
export async function fuehreSicherungAus({ ordner = sicherungsOrdner(), jetzt = Date.now() } = {}) {
    if (!ordner) throw new Error('Sicherung ist aus (kein Ordner)')
    fs.mkdirSync(ordner, { recursive: true, mode: 0o700 })
    const knex = getKnex()
    const art = knex.client.config.client === 'pg' ? 'json' : 'sqlite'
    const heute = new Date(jetzt).toISOString().slice(0, 10)
    const ziel = path.join(ordner, dateiName(heute, art))
    const tmp = `${ziel}.tmp`
    fs.rmSync(tmp, { force: true })
    if (art === 'sqlite') {
        // VACUUM INTO verlangt, dass die Zieldatei noch nicht existiert.
        await knex.raw('VACUUM INTO ?', [tmp])
    } else {
        const daten = await baueExport()
        fs.writeFileSync(tmp, await gzip(Buffer.from(JSON.stringify(daten))), { mode: 0o600 })
    }
    try { fs.chmodSync(tmp, 0o600) } catch { /* Windows */ }
    fs.renameSync(tmp, ziel)
    const geloescht = zuLoeschen(fs.readdirSync(ordner), heute)
    for (const n of geloescht) fs.rmSync(path.join(ordner, n), { force: true })
    return { datei: ziel, bytes: fs.statSync(ziel).size, geloescht }
}

let taktId = null
let ausGemeldet = false

/** Stündlich prüfen, ob die Sicherung des (UTC-)Tages fehlt. Start über `starteTakte`. */
export function startSicherungsTakt() {
    if (taktId) return
    const tick = async () => {
        const ordner = sicherungsOrdner()
        if (!ordner) {
            if (!ausGemeldet) console.log(' -> Tägliche Sicherung aus (im Container ohne AT_SICHERUNG_ORDNER — dort einen eingebundenen Ordner angeben)')
            ausGemeldet = true
            return
        }
        const jetzt = Date.now()
        const tagesbeginn = Date.parse(new Date(jetzt).toISOString().slice(0, 10) + 'T00:00:00Z')
        if (!(await beansprucheTagesaufgabe(SCHLUESSEL, { tagesbeginn, wiederholungMs: 3 * 60 * 60e3 }))) return
        try {
            const r = await fuehreSicherungAus({ ordner, jetzt })
            await merkeAufgabenFehler(SCHLUESSEL, '')
            console.log(` -> Sicherung geschrieben: ${r.datei} (${Math.round(r.bytes / 1024)} kB)${r.geloescht.length ? `, ${r.geloescht.length} alte entfernt` : ''}`)
        } catch (e) {
            console.warn(' -> Sicherung fehlgeschlagen:', e.message)
            await merkeAufgabenFehler(SCHLUESSEL, e.message || 'Fehler')
        }
    }
    setTimeout(tick, 5 * 60e3)
    taktId = setInterval(tick, TAKT_MS)
}

export function stoppeSicherungsTakt() {
    if (taktId) clearInterval(taktId)
    taktId = null
}
