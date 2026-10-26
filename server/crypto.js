import crypto from 'crypto'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { umgebung } from './umgebung.js'
import { logWarn } from './logger.js'

// Verschlüsselungs-Key: bevorzugt aus ENV, sonst aus der Secret-Datei (F2)
const ENV_SECRET = umgebung('SECRET')
// NICHT umbenennen: Aus diesem Seed (und aus dem Secret) entsteht der Schlüssel,
// mit dem die Börsen- und KI-Schlüssel in der DB verschlüsselt sind. Der Name
// stammt aus der Zeit vor AutarkTrade; ein neuer Name machte jeden gespeicherten
// Schlüssel unlesbar. Ebenso bleibt 'tn_session_v1' in auth.js stehen.
const MACHINE_SEED = `tradenote-${os.hostname()}-${os.userInfo().username}-v1`
const ALGORITHM = 'aes-256-gcm'
const sha = (s) => crypto.createHash('sha256').update(s).digest()

/*
 * Secret-Datei für native Installationen (Audit A2-08, F2 20.10.2026).
 *
 * `install.sh`, die Startskripte und `npm start` setzen kein `AT_SECRET`. Bis
 * F2 nahm `crypto.js` dann den Maschinen-Seed aus Hostname und Benutzer — wer
 * die DB-Datei oder ein Backup hatte und beides errät, entschlüsselte alle
 * Schlüssel. Jetzt wird beim ersten Start ohne `AT_SECRET` ein zufälliges
 * Secret erzeugt und neben der Datenbank abgelegt (`.at-secret`, Modus 0600,
 * nie im Repo, nie im Image, nie im Backup). Werte, die noch mit dem
 * Maschinen-Seed verschlüsselt sind, bleiben lesbar (`ALT_SCHLUESSEL`) und
 * werden beim Start einmal umgeschlüsselt (`migriereAltSchluessel`).
 *
 * Docker mit gesetztem `AT_SECRET`: unverändert, die Datei wird nie angelegt.
 * Ohne `AT_SECRET` in Produktion (`NODE_ENV=production`, das Image): weiter
 * Abbruch — dort gehört das Secret in die Umgebung, nicht in den Container.
 *
 * Wer die Installation umzieht, nimmt `.at-secret` mit (wie vorher die
 * Datenbank) — ohne sie sind die gespeicherten Schlüssel nicht lesbar.
 */
const PROJEKT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SECRET_DATEI = umgebung('SECRET_FILE') || path.join(PROJEKT, '.at-secret')

function ladeOderErzeugeDateiSecret() {
    try {
        const vorhanden = fs.readFileSync(SECRET_DATEI, 'utf8').trim()
        if (vorhanden.length >= 32) return vorhanden
        console.warn(`[CRYPTO] ${SECRET_DATEI} ist zu kurz — wird nicht verwendet.`)
        return null
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.warn(`[CRYPTO] ${SECRET_DATEI} nicht lesbar (${e.code}) — Maschinen-Schlüssel bleibt.`)
            return null
        }
    }
    try {
        const neu = crypto.randomBytes(32).toString('hex')
        // 'wx': nie eine Datei überschreiben, die ein paralleler Start gerade anlegt
        fs.writeFileSync(SECRET_DATEI, neu + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        console.warn(`[CRYPTO] Neues Secret erzeugt: ${SECRET_DATEI} — beim Umzug der Installation mitnehmen.`)
        return neu
    } catch (e) {
        if (e.code === 'EEXIST') return ladeOderErzeugeDateiSecret()
        console.warn(`[CRYPTO] Secret-Datei nicht anlegbar (${e.code}) — Maschinen-Schlüssel bleibt.`)
        return null
    }
}

let DATEI_SECRET = null
if (!ENV_SECRET) {
    // In Produktion ist ein vorhersehbarer Maschinen-Seed nicht akzeptabel:
    // harter Abbruch statt unsicherem Fallback.
    if (process.env.NODE_ENV === 'production') {
        throw new Error('[CRYPTO] AT_SECRET ist in Produktion erforderlich (NODE_ENV=production). Setze AT_SECRET als Umgebungsvariable.')
    }
    DATEI_SECRET = ladeOderErzeugeDateiSecret()
    if (!DATEI_SECRET) {
        console.warn('[CRYPTO] Kein AT_SECRET gesetzt – verwende maschinenspezifischen Schlüssel. Für höhere Sicherheit AT_SECRET als Umgebungsvariable setzen.')
    }
}

/*
 * Mindestlänge für `AT_SECRET` (Audit SEC-SRV-007).
 *
 * Schlüssel und Sitzungs-Cookie hängen ohne KDF direkt am Secret
 * (sha256 bzw. HMAC). Wer ein Cookie mitliest, kann ein kurzes Secret
 * offline mit SHA-256-Geschwindigkeit raten. Nur WARNEN, nicht abbrechen und
 * nichts an der Ableitung ändern: eine neue Ableitung machte jeden
 * gespeicherten Schlüssel unlesbar, ein Abbruch legte bestehende
 * Installationen still. Die Secret-Datei wird schon beim Lesen auf ≥ 32
 * Zeichen geprüft.
 */
export const SECRET_MIN = 32

/** Ist dieses `AT_SECRET` zu kurz? Leer zählt nicht (dann gilt die Secret-Datei). Rein. */
export function secretZuKurz(wert) {
    const s = String(wert ?? '')
    return s.length > 0 && s.length < SECRET_MIN
}

/** Beim Start: laut warnen, wenn `AT_SECRET` kürzer als SECRET_MIN ist. Liefert true bei Warnung. */
export function warneSchwachesSecret(wert = ENV_SECRET) {
    if (!secretZuKurz(wert)) return false
    logWarn('crypto', `⚠️  AT_SECRET ist nur ${String(wert).length} Zeichen lang (empfohlen: mindestens ${SECRET_MIN}). `
        + 'Ein kurzes Secret lässt sich aus einem mitgelesenen Cookie offline erraten — danach sind alle '
        + 'gespeicherten Schlüssel lesbar. Neues Secret z. B. mit `openssl rand -hex 32` erzeugen und die '
        + 'Schlüssel mit `node server/reencrypt-keys.mjs` umschlüsseln.')
    return true
}

/** Das Hauptgeheimnis der Installation (für die Sitzungs-Ableitung in auth.js), oder null. */
export function hauptGeheimnis() {
    return ENV_SECRET || DATEI_SECRET || null
}

const ENCRYPTION_KEY = sha(ENV_SECRET || DATEI_SECRET || MACHINE_SEED)
// Nur ohne AT_SECRET und mit Datei: der alte Maschinen-Schlüssel zum Lesen
// noch nicht umgeschlüsselter Werte.
const ALT_SCHLUESSEL = !ENV_SECRET && DATEI_SECRET ? sha(MACHINE_SEED) : null

function entschluesselnMit(encryptedText, key) {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
}

/**
 * Verschlüsselt einen String mit AES-256-GCM
 * @param {string} text - Klartext
 * @returns {string} - Verschlüsselter Text (iv:authTag:encrypted in hex)
 */
export function encrypt(text) {
    if (!text) return ''
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')
    return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Entschlüsselt einen String
 * @param {string} encryptedText - Verschlüsselter Text (iv:authTag:encrypted)
 * @returns {string} - Klartext oder '' bei Fehler
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return ''
    // Legacy-Klartext (Format ≠ iv:authTag:data) unverändert durchreichen —
    // Abwärtskompatibilität für bereits unverschlüsselt gespeicherte Werte.
    if (!isEncrypted(encryptedText)) {
        return encryptedText
    }
    try {
        return entschluesselnMit(encryptedText, ENCRYPTION_KEY)
    } catch (e) {
        if (ALT_SCHLUESSEL) {
            try { return entschluesselnMit(encryptedText, ALT_SCHLUESSEL) } catch { /* auch nicht */ }
        }
        // Der Wert war verschlüsselt, ließ sich aber nicht entschlüsseln
        // (z.B. falscher Key). KEINEN Ciphertext als Klartext zurückgeben.
        console.warn('[CRYPTO] Entschlüsselung fehlgeschlagen — leeren Wert zurückgeben:', e.message)
        return ''
    }
}

/**
 * Prüft ob ein String verschlüsselt ist (hat das Format iv:authTag:data)
 */
export function isEncrypted(text) {
    if (!text) return false
    const parts = text.split(':')
    return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32
}

/**
 * Maskiert einen Klartext-Schlüssel für die Anzeige: Punkte + die letzten 4
 * Zeichen. Bis F2 (Audit A2-34) standen auch die ersten 4 da — 8 echte
 * Zeichen je Schlüssel, bei kurzen Tokens ein guter Teil davon.
 */
export function maske(key) {
    const k = String(key || '')
    if (!k) return ''
    if (k.length <= 8) return '•'.repeat(k.length)
    return '•'.repeat(Math.min(k.length - 4, 20)) + k.slice(-4)
}

/**
 * Maskiert einen (verschlüsselt gespeicherten) Key für die Anzeige.
 * Gibt '' zurück, wenn kein Key. Liefert NIE den vollständigen Klartext aus.
 */
export function maskKey(encryptedKey) {
    if (!encryptedKey) return ''
    return maske(decrypt(encryptedKey))
}

/**
 * Einmalige Bereinigung beim Start (F2, Audit A2-08/A2-09):
 * - Werte, die noch mit dem Maschinen-Seed verschlüsselt sind, werden mit dem
 *   Schlüssel aus der Secret-Datei neu geschrieben (nur ohne `AT_SECRET`);
 * - Klartext in Schlüsselspalten (Altbestand, fremde Backups) wird
 *   verschlüsselt, `[REDACTED]` aus einem eingespielten Export geleert;
 * - Polygon-/Databento-Schlüssel in `settings.apis` werden verschlüsselt.
 * Ein Wert, der mit KEINEM Schlüssel lesbar ist, bleibt unangetastet — ihn zu
 * überschreiben zerstörte ihn endgültig.
 *
 * @param {import('knex').Knex} knex
 * @param {Array<[string, string[]]>} stellen  aus `geheimnisse.js`
 * @returns {Promise<{umgeschluesselt:number, verschluesselt:number, geleert:number}>}
 */
export async function migriereAltSchluessel(knex, stellen) {
    const zaehler = { umgeschluesselt: 0, verschluesselt: 0, geleert: 0 }
    for (const [tabelle, spalten, schluesselSpalte = 'id'] of stellen) {
        if (!(await knex.schema.hasTable(tabelle))) continue
        const vorhanden = Object.keys(await knex(tabelle).columnInfo())
        const felder = spalten.filter((sp) => vorhanden.includes(sp))
        if (!felder.length || !vorhanden.includes(schluesselSpalte)) continue
        // Schlüsselspalte je Tabelle (SEC-SRV-015): portfolio_schluessel hat `name` statt `id`.
        const zeilen = await knex(tabelle).select([schluesselSpalte, ...felder])
        for (const z of zeilen) {
            const aenderung = {}
            for (const sp of felder) {
                const w = z[sp]
                if (!w || typeof w !== 'string') continue
                if (w === '[REDACTED]') { aenderung[sp] = ''; zaehler.geleert++; continue }
                if (!isEncrypted(w)) { aenderung[sp] = encrypt(w); zaehler.verschluesselt++; continue }
                try { entschluesselnMit(w, ENCRYPTION_KEY); continue } catch { /* weiter */ }
                if (!ALT_SCHLUESSEL) continue
                try {
                    aenderung[sp] = encrypt(entschluesselnMit(w, ALT_SCHLUESSEL))
                    zaehler.umgeschluesselt++
                } catch { /* fremder Schlüssel: nicht anfassen */ }
            }
            if (Object.keys(aenderung).length) await knex(tabelle).where(schluesselSpalte, z[schluesselSpalte]).update(aenderung)
        }
    }
    // settings.apis: [{provider, key}] als JSON-Text
    try {
        const z = await knex('settings').select('id', 'apis').where('id', 1).first()
        const liste = JSON.parse(z?.apis || '[]')
        if (Array.isArray(liste)) {
            let geaendert = false
            const neu = liste.map((a) => {
                if (!a || typeof a.key !== 'string' || !a.key) return a
                if (a.key === '[REDACTED]') { geaendert = true; zaehler.geleert++; return { ...a, key: '' } }
                if (!isEncrypted(a.key)) { geaendert = true; zaehler.verschluesselt++; return { ...a, key: encrypt(a.key) } }
                try { entschluesselnMit(a.key, ENCRYPTION_KEY); return a } catch { /* weiter */ }
                if (!ALT_SCHLUESSEL) return a
                try {
                    const k = encrypt(entschluesselnMit(a.key, ALT_SCHLUESSEL))
                    geaendert = true; zaehler.umgeschluesselt++
                    return { ...a, key: k }
                } catch { return a }
            })
            if (geaendert) await knex('settings').where('id', 1).update({ apis: JSON.stringify(neu) })
        }
    } catch { /* keine settings-Zeile oder kein JSON */ }
    return zaehler
}
