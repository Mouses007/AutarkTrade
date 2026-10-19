/**
 * Lizenzschlüssel (LIZENZ-PLAN.md, Abschnitt 3 „Aktivierung").
 *
 * Ein Schlüssel ist ein Ed25519-signiertes Token:
 *
 *     AT1.<base64url(JSON-Inhalt)>.<base64url(Signatur)>
 *
 * signiert wird der Text `AT1.<base64url(JSON-Inhalt)>`. Der Inhalt nennt die Person
 * (`kaeufer`), die Edition und bis wann Updates dazugehören (`updatesBis`); ein
 * Testschlüssel trägt zusätzlich `gueltigBis`. Geprüft wird OFFLINE gegen den
 * eingebauten öffentlichen Schlüssel — kein Lizenzserver, kein Zwang ins Netz, passend
 * zur lokalen Einzelplatz-Idee. Der private Schlüssel liegt nur beim Anbieter
 * (`scripts/lizenz-ausstellen.mjs`, Pfad über `AT_LIZENZ_PRIVAT`) und NIE im Repo.
 *
 * Was ein Schlüssel NICHT tut: Funktionen oder Daten sperren. Ohne gültigen Schlüssel
 * läuft die Software im Testmodus — alles benutzbar, ein Hinweis sichtbar, und
 * Updates über den eingebauten Knopf gibt es nicht (Ziffer 3 und 7 der
 * Lizenzbedingungen). Ein abgelaufener Update-Zeitraum heisst: die installierte
 * Fassung läuft weiter, neuere bekommt man erst mit einer Verlängerung.
 *
 * Optional `zugang: {benutzer, token}` — die Zugangsdaten zur privaten Paketquelle
 * (GitHub-Repo bzw. ghcr.io). Sie stehen mit im signierten Inhalt, damit der Kunde nur
 * EINEN Text einfügen muss; `AT_UPDATE_TOKEN`/`AT_UPDATE_BENUTZER` gehen vor.
 *
 * Die reinen Teile (`leseSchluessel`, `lizenzStand`, `updateErlaubt`) nehmen den
 * öffentlichen Schlüssel und das Datum als Argument und sind in
 * `__selftest-lizenz.mjs` geprüft; nur `ladeLizenz`/`speichereLizenz` fassen die DB an.
 */
import crypto from 'crypto'

export const PRAEFIX = 'AT1'

/**
 * Eingebauter öffentlicher Schlüssel (Ed25519, SPKI/DER, base64), erzeugt am 19.10.2026.
 * Der zugehörige private Schlüssel liegt beim Anbieter ausserhalb des Repos. Wird er
 * ersetzt, sind alle bisher ausgestellten Schlüssel ungültig — nur bei einem Leck tun.
 */
export const OEFFENTLICHER_SCHLUESSEL = 'MCowBQYDK2VwAyEA6cJ9duer9K/r008QMEjf6uzApTTMzo3v0j2wen48HB8='

export const EDITIONEN = ['standard', 'test']
const DATUM = /^\d{4}-\d{2}-\d{2}$/

export function oeffentlicherSchluessel(base64 = OEFFENTLICHER_SCHLUESSEL) {
    return crypto.createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function ausB64url(text) {
    return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** Ein Datum `YYYY-MM-DD`, das es wirklich gibt (kein 2026-02-31). */
function istDatum(text) {
    if (typeof text !== 'string' || !DATUM.test(text)) return false
    const d = new Date(text + 'T00:00:00Z')
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
}

/** Heute als `YYYY-MM-DD` in der Zeitzone der Schweiz — der Anbieter rechnet in ihr. */
export function heute(jetzt = new Date()) {
    return jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
}

/**
 * Inhalt eines Schlüssels prüfen, unabhängig von der Signatur. Liefert die Liste der
 * Mängel (leer = in Ordnung) — auch das Ausstellwerkzeug prüft damit, bevor es signiert.
 */
export function inhaltMaengel(inhalt) {
    const m = []
    if (!inhalt || typeof inhalt !== 'object' || Array.isArray(inhalt)) return ['keinObjekt']
    if (inhalt.v !== 1) m.push('version')
    if (typeof inhalt.id !== 'string' || !inhalt.id.trim()) m.push('id')
    if (typeof inhalt.kaeufer !== 'string' || !inhalt.kaeufer.trim()) m.push('kaeufer')
    if (!EDITIONEN.includes(inhalt.edition)) m.push('edition')
    if (!istDatum(inhalt.ausgestellt)) m.push('ausgestellt')
    if (!istDatum(inhalt.updatesBis)) m.push('updatesBis')
    if (inhalt.gueltigBis !== undefined && !istDatum(inhalt.gueltigBis)) m.push('gueltigBis')
    // Ein Testschlüssel ohne Ende wäre eine Vollversion unter falschem Namen.
    if (inhalt.edition === 'test' && inhalt.gueltigBis === undefined) m.push('testOhneEnde')
    if (inhalt.zugang !== undefined) {
        const z = inhalt.zugang
        if (!z || typeof z !== 'object' || typeof z.token !== 'string' || !z.token
            || (z.benutzer !== undefined && typeof z.benutzer !== 'string')) m.push('zugang')
    }
    return m
}

/** Einen Inhalt signieren (nur das Ausstellwerkzeug und der Selbsttest brauchen das). */
export function signiere(inhalt, privaterSchluessel) {
    const maengel = inhaltMaengel(inhalt)
    if (maengel.length) throw new Error('Lizenzinhalt unvollständig: ' + maengel.join(', '))
    const kopf = `${PRAEFIX}.${b64url(JSON.stringify(inhalt))}`
    const signatur = crypto.sign(null, Buffer.from(kopf), privaterSchluessel)
    return `${kopf}.${b64url(signatur)}`
}

/**
 * Text → `{ok, inhalt}` oder `{ok: false, fehler}`. Leerzeichen und Zeilenumbrüche
 * fallen weg (Mailprogramme brechen lange Zeilen um). `fehler` ist ein Code, den die
 * Oberfläche übersetzt: `leer`, `format`, `signatur`, `inhalt`.
 */
export function leseSchluessel(text, oeffentlich = oeffentlicherSchluessel()) {
    const roh = String(text ?? '').replace(/\s+/g, '')
    if (!roh) return { ok: false, fehler: 'leer' }
    const teile = roh.split('.')
    if (teile.length !== 3 || teile[0] !== PRAEFIX || !teile[1] || !teile[2]) return { ok: false, fehler: 'format' }
    let gueltig = false
    try {
        gueltig = crypto.verify(null, Buffer.from(`${teile[0]}.${teile[1]}`), oeffentlich, ausB64url(teile[2]))
    } catch {
        gueltig = false
    }
    if (!gueltig) return { ok: false, fehler: 'signatur' }
    let inhalt
    try {
        inhalt = JSON.parse(ausB64url(teile[1]).toString('utf8'))
    } catch {
        return { ok: false, fehler: 'inhalt' }
    }
    if (inhaltMaengel(inhalt).length) return { ok: false, fehler: 'inhalt' }
    return { ok: true, inhalt, schluessel: roh }
}

/**
 * Der Stand, den Oberfläche und Update-Prüfung sehen. `modus`:
 * - `test`      kein Schlüssel eingetragen
 * - `ungueltig` ein Schlüssel ist eingetragen, aber die Signatur oder der Inhalt stimmt nicht
 * - `abgelaufen` ein befristeter Schlüssel (Test) ist abgelaufen
 * - `voll`      gültig
 * In allen Fällen ausser `voll` gilt der Testmodus — benutzbar bleibt alles.
 * Die Zugangsdaten verlassen den Server nie; `zugang` sagt nur, ob welche da sind.
 */
export function lizenzStand(text, { tag = heute(), oeffentlich } = {}) {
    if (!String(text ?? '').trim()) return { modus: 'test', testmodus: true }
    const gelesen = leseSchluessel(text, oeffentlich)
    if (!gelesen.ok) return { modus: 'ungueltig', testmodus: true, fehler: gelesen.fehler }
    const i = gelesen.inhalt
    const basis = {
        id: i.id,
        kaeufer: i.kaeufer,
        edition: i.edition,
        ausgestellt: i.ausgestellt,
        updatesBis: i.updatesBis,
        gueltigBis: i.gueltigBis ?? null,
        zugang: !!i.zugang,
        updatesAktiv: tag <= i.updatesBis,
    }
    if (i.gueltigBis && tag > i.gueltigBis) return { ...basis, modus: 'abgelaufen', testmodus: true, updatesAktiv: false }
    return { ...basis, modus: 'voll', testmodus: false }
}

/**
 * Darf ein Update dieses Erscheinungsdatums installiert werden? Massgebend ist der Tag,
 * an dem die Fassung ERSCHIENEN ist, nicht der heutige: wer bis zum 31.12. Updates hat,
 * darf die Fassung vom 30.12. auch im März noch installieren.
 * `erschienen` ist ein ISO-Zeitpunkt (GitHub `published_at`) oder `YYYY-MM-DD`.
 */
export function updateErlaubt(stand, erschienen) {
    if (!stand || stand.modus !== 'voll') return { erlaubt: false, grund: stand?.modus === 'test' ? 'keinSchluessel' : 'keineGueltigeLizenz' }
    const tag = erschienen ? heute(new Date(erschienen)) : null
    if (!tag || !istDatum(tag)) return { erlaubt: false, grund: 'datumUnbekannt' }
    if (tag > stand.updatesBis) return { erlaubt: false, grund: 'updatesAbgelaufen', updatesBis: stand.updatesBis }
    return { erlaubt: true }
}

// ── Datenbank ────────────────────────────────────────────────────────────

async function knexHolen() {
    const { getKnex } = await import('./database.js')
    return getKnex()
}

/** Der eingetragene Schlüsseltext ('' ohne). */
export async function ladeSchluesselText(knex) {
    const k = knex || await knexHolen()
    const row = await k('settings').select('lizenzSchluessel').where('id', 1).first()
    return row?.lizenzSchluessel || ''
}

export async function ladeLizenz(knex) {
    return lizenzStand(await ladeSchluesselText(knex))
}

/**
 * Zugangsdaten zur privaten Paketquelle: Umgebung vor Lizenz. `null` ohne.
 * Nur für den Server — nie an die Oberfläche geben.
 */
export async function updateZugang(knex) {
    const { umgebung } = await import('./umgebung.js')
    const token = umgebung('UPDATE_TOKEN')
    if (token) return { benutzer: umgebung('UPDATE_BENUTZER') || 'x-access-token', token }
    const gelesen = leseSchluessel(await ladeSchluesselText(knex))
    const z = gelesen.ok ? gelesen.inhalt.zugang : null
    return z?.token ? { benutzer: z.benutzer || 'x-access-token', token: z.token } : null
}

export function setupLizenzRoutes(app) {
    app.get('/api/lizenz', async (req, res) => {
        try {
            res.json(await ladeLizenz())
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    // Eintragen: nur ein Schlüssel, der die Prüfung besteht — ein Tippfehler soll den
    // bisherigen gültigen nicht überschreiben.
    app.post('/api/lizenz', async (req, res) => {
        try {
            const gelesen = leseSchluessel(req.body?.schluessel)
            if (!gelesen.ok) return res.status(400).json({ fehler: gelesen.fehler })
            const knex = await knexHolen()
            await knex('settings').where('id', 1).update({ lizenzSchluessel: gelesen.schluessel })
            res.json(lizenzStand(gelesen.schluessel))
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.delete('/api/lizenz', async (req, res) => {
        try {
            const knex = await knexHolen()
            await knex('settings').where('id', 1).update({ lizenzSchluessel: '' })
            res.json(lizenzStand(''))
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })
}
