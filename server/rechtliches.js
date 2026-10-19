/**
 * Die Lizenzbedingungen, denen man zustimmen muss (Auftrag S10, Muster AutarkDarts
 * `game_server/rechtliches.py`).
 *
 * Beim ersten Start und bei jeder neuen FASSUNG von `LICENSE` zeigt die Oberfläche den
 * Dialog „Rechtliches" (`src/components/rechtliches/Rechtliches.vue`) über allem, bis
 * zugestimmt ist. Die Fassung steht in der zweiten Zeile: `Fassung X.Y vom …` — ein
 * Tippfehler, der sie nicht ändert, verlangt keine neue Zustimmung; eine neue Fassung
 * schon (Ziffer 15 der Bedingungen).
 *
 * Gespeichert in `settings.rechtlichesZustimmung` (JSON): die zugestimmte Fassung, Zeit,
 * Prüfsummen der Texte (der Nachweis, welcher Wortlaut bestätigt wurde) und die letzten
 * Zustimmungen als `verlauf`. Bewusst KEINE Sperre auf dem Server: die Software ist ein
 * Einzelplatz-Programm, der Dialog liegt über jeder Seite, und eine Sperre der API
 * träfe auch laufende Takte (Stop-Wächter!) — eine Sperre, die einen Stop verhindert,
 * wäre schlimmer als jede fehlende Zustimmung. `AT_BEDINGUNGEN=aus` schaltet die
 * Pflicht ab (Entwicklung, Prüfskripte).
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { umgebung } from './umgebung.js'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Name in der Oberfläche → Datei neben dem Code. Zugestimmt wird `lizenz`. */
export const DOKUMENTE = {
    lizenz: 'LICENSE',
    hinweise: 'NOTICE.md',
    drittsoftware: 'THIRD-PARTY-NOTICES',
}
const FASSUNG = /^Fassung\s+(\d+(?:\.\d+)*)\s+vom\s+(.+?)\s*$/
const VERLAUF_MAX = 20

/** Zum Testen umlenkbar. */
let wurzel = WURZEL
export function setzeWurzel(p) { wurzel = p }

export function text(name) {
    const datei = DOKUMENTE[name]
    if (!datei) throw new Error('unbekanntes Dokument')
    return fs.readFileSync(path.join(wurzel, datei), 'utf8')
}

/** `{fassung: '0.1', datum: '19. Oktober 2026'}` aus den ersten Zeilen — `null` ohne. */
export function fassungAus(inhalt) {
    for (const zeile of String(inhalt ?? '').split('\n').slice(0, 5)) {
        const t = FASSUNG.exec(zeile.trim())
        if (t) return { fassung: t[1], datum: t[2] }
    }
    return null
}

export function fassung(name = 'lizenz') {
    try { return fassungAus(text(name)) } catch { return null }
}

export function pflicht() {
    return umgebung('BEDINGUNGEN') !== 'aus'
}

function pruefsumme(name) {
    try { return crypto.createHash('sha256').update(text(name)).digest('hex') } catch { return null }
}

/** Gespeicherte Zustimmung lesen; `null`, wenn keine oder unlesbar. */
export function zustimmungAus(roh) {
    if (!roh) return null
    try {
        const z = typeof roh === 'string' ? JSON.parse(roh) : roh
        return z && typeof z === 'object' && z.fassung ? z : null
    } catch {
        return null
    }
}

/** Rein: Stand aus gespeicherter Zustimmung und heutiger Fassung. */
export function standAus(zustimmung, aktuell, istPflicht = true) {
    const noetig = istPflicht && (!aktuell || !zustimmung || zustimmung.fassung !== aktuell.fassung)
    return {
        pflicht: istPflicht,
        noetig,
        neueFassung: noetig && !!zustimmung,
        fassung: aktuell,
        akzeptiert: zustimmung ? { fassung: zustimmung.fassung, datum: zustimmung.datum, zeit: zustimmung.zeit } : null,
        // Ziffer 4 der Bedingungen: unfertige Software, sichtbar so bezeichnet
        // (Art. 4 Abs. 3 Cyber Resilience Act). Fällt mit dem Ende der Beta weg.
        beta: true,
        dokumente: Object.fromEntries(Object.entries(DOKUMENTE).map(([n, d]) => [n, { datei: d }])),
    }
}

async function knexHolen() {
    const { getKnex } = await import('./database.js')
    return getKnex()
}

export async function stand(knex) {
    const k = knex || await knexHolen()
    const row = await k('settings').select('rechtlichesZustimmung').where('id', 1).first()
    return standAus(zustimmungAus(row?.rechtlichesZustimmung), fassung('lizenz'), pflicht())
}

/**
 * Zustimmung zur Fassung speichern, die die Oberfläche GEZEIGT hat. Gilt inzwischen
 * eine andere (Update zwischen Anzeigen und Klicken), wird abgelehnt — bestätigt wird
 * nur ein Wortlaut, den man gesehen hat.
 */
export async function akzeptieren(gesehen, knex) {
    const aktuell = fassung('lizenz')
    if (!aktuell) throw Object.assign(new Error('Die Lizenzbedingungen fehlen oder nennen keine Fassung'), { status: 500 })
    if (String(gesehen) !== aktuell.fassung) {
        throw Object.assign(new Error(`Gezeigt wurde Fassung ${gesehen}, es gilt aber ${aktuell.fassung} — bitte neu laden`), { status: 409 })
    }
    const k = knex || await knexHolen()
    const row = await k('settings').select('rechtlichesZustimmung').where('id', 1).first()
    const bisher = zustimmungAus(row?.rechtlichesZustimmung)
    const eintrag = {
        fassung: aktuell.fassung,
        datum: aktuell.datum,
        zeit: new Date().toISOString(),
        sha256: Object.fromEntries(Object.keys(DOKUMENTE).map((n) => [n, pruefsumme(n)])),
    }
    const verlauf = [...(Array.isArray(bisher?.verlauf) ? bisher.verlauf : []), eintrag].slice(-VERLAUF_MAX)
    await k('settings').where('id', 1).update({ rechtlichesZustimmung: JSON.stringify({ ...eintrag, verlauf }) })
    return stand(k)
}

export function setupRechtlichesRoutes(app) {
    app.get('/api/rechtliches', async (req, res) => {
        try {
            res.json(await stand())
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.get('/api/rechtliches/text/:name', (req, res) => {
        if (!DOKUMENTE[req.params.name]) return res.status(404).json({ error: 'unbekanntes Dokument' })
        try {
            res.type('text/plain; charset=utf-8').send(text(req.params.name))
        } catch {
            res.status(404).json({ error: `${DOKUMENTE[req.params.name]} fehlt in dieser Installation` })
        }
    })

    app.post('/api/rechtliches/akzeptieren', async (req, res) => {
        try {
            res.json(await akzeptieren(req.body?.fassung))
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message })
        }
    })
}
