/**
 * Spenden: Menüeintrag, Kaffee-Knopf in der Kopfleiste, Dialog mit QR-Codes
 * (BTC, PayPal) und „Buy me a coffee" — und seltene Nachfragen an guten Momenten.
 *
 * Wann gefragt wird (`naechsteNachfrage`, rein und im Selbsttest):
 *   update      nach einem Update auf eine neue Fassung (einmal je Fassung)
 *   meilenstein bei 50, 200, 500, 1000 bewerteten Trades (mehrere auf einmal → nur der höchste)
 *   zeit        30 Tage nach der ersten Nutzung, danach alle 90 Tage
 *   dank        wer „schon gespendet" hat: einmal im Jahr ein leiser Dank, sonst nichts
 * Grenzen:
 *   - höchstens eine Nachfrage je 30 Tage, egal welcher Anlass;
 *   - „Ich will definitiv nicht" → nie wieder ein Popup (Menüeintrag bleibt);
 *   - „Später" → der Anlass gilt als erledigt, der nächste kommt frühestens in 30 Tagen;
 *   - wo nicht gefragt wird (Live-Trading, Vollbild), entscheidet die Oberfläche.
 *
 * „Bewertet" = ein Trade mit Zufriedenheit (Daumen) in `satisfactions`.
 * Der Schalter `spendenAn` (Vorgabe an) blendet Menüeintrag, Knopf und Nachfragen aus.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getKnex } from './database.js'

const TAG = 24 * 60 * 60 * 1000
export const MEILENSTEINE = [50, 200, 500, 1000]
export const SPERRE_MS = 30 * TAG
export const ERSTE_ZEIT_MS = 30 * TAG
export const ZEIT_ABSTAND_MS = 90 * TAG
export const DANK_ABSTAND_MS = 365 * TAG

/** Rein: welche Nachfrage ist fällig? `null` oder `{ art, wert? }`. */
export function naechsteNachfrage({
    an = true, status = '', bewertet = 0, meilenstein = 0, seit = 0, letzte = 0,
    version = '', letzteVersion = '', dank = 0, jetzt = Date.now(),
}) {
    if (!an || status === 'nein') return null
    if (letzte && jetzt - letzte < SPERRE_MS) return null
    if (status === 'gespendet') {
        return jetzt - (dank || 0) >= DANK_ABSTAND_MS ? { art: 'dank' } : null
    }
    if (version && letzteVersion && version !== letzteVersion) return { art: 'update', wert: version }
    const m = MEILENSTEINE.filter((x) => bewertet >= x && x > (meilenstein || 0)).pop()
    if (m) return { art: 'meilenstein', wert: m }
    if (seit && jetzt - seit >= ERSTE_ZEIT_MS && (!letzte || jetzt - letzte >= ZEIT_ABSTAND_MS)) {
        return { art: 'zeit', wert: Math.floor((jetzt - seit) / TAG) }
    }
    return null
}

/** Rein: was sich nach einer Antwort am Stand ändert. */
export function nachAntwort(stand, { art, wert, antwort }, jetzt = Date.now()) {
    const neu = { letzte: jetzt }
    if (art === 'meilenstein') neu.meilenstein = Math.max(Number(stand.meilenstein) || 0, Number(wert) || 0)
    if (art === 'update') neu.letzteVersion = String(wert || stand.version || '')
    if (art === 'dank') neu.dank = jetzt
    if (antwort === 'gespendet') { neu.status = 'gespendet'; neu.dank = jetzt }
    if (antwort === 'nein') neu.status = 'nein'
    return neu
}

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let versionCache = null
function aktuelleVersion() {
    if (versionCache === null) {
        try { versionCache = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8')).version || '' } catch { versionCache = '' }
    }
    return versionCache
}

async function zaehleBewertete(knex) {
    const r = await knex('satisfactions').whereNot('tradeId', '').whereNotNull('tradeId')
        .countDistinct({ n: 'tradeId' }).first()
    return Number(r?.n) || 0
}

const SPALTEN = ['spendenAn', 'spendenStatus', 'spendenMeilenstein', 'spendenSeit', 'spendenLetzte', 'spendenVersion', 'spendenDank', 'spendenStufe']

async function lies(knex) {
    const s = await knex('settings').select(SPALTEN).where('id', 1).first()
    // Übernahme aus der ersten Fassung (Stufe 1 = nach 50 gefragt, 2 = nach 200)
    const altMeilenstein = Number(s?.spendenStufe) >= 2 ? 200 : Number(s?.spendenStufe) === 1 ? 50 : 0
    return {
        an: Number(s?.spendenAn ?? 1) === 1,
        status: s?.spendenStatus || '',
        meilenstein: Math.max(Number(s?.spendenMeilenstein) || 0, altMeilenstein),
        seit: Number(s?.spendenSeit) || 0,
        letzte: Number(s?.spendenLetzte) || 0,
        letzteVersion: s?.spendenVersion || '',
        dank: Number(s?.spendenDank) || 0,
    }
}

async function schreibe(knex, felder) {
    const z = {}
    if ('status' in felder) z.spendenStatus = felder.status
    if ('meilenstein' in felder) z.spendenMeilenstein = felder.meilenstein
    if ('seit' in felder) z.spendenSeit = felder.seit
    if ('letzte' in felder) z.spendenLetzte = felder.letzte
    if ('letzteVersion' in felder) z.spendenVersion = felder.letzteVersion
    if ('dank' in felder) z.spendenDank = felder.dank
    if (Object.keys(z).length) await knex('settings').where('id', 1).update(z)
}

export function setupSpendenRoutes(app) {
    app.get('/api/spenden/stand', async (_req, res) => {
        try {
            const knex = getKnex()
            const s = await lies(knex)
            const version = aktuelleVersion()
            // Erste Nutzung und erste Fassung still merken — beides ist noch kein Anlass.
            const still = {}
            if (!s.seit) still.seit = Date.now()
            if (!s.letzteVersion && version) still.letzteVersion = version
            if (Object.keys(still).length) { await schreibe(knex, still); Object.assign(s, still) }
            const bewertet = await zaehleBewertete(knex)
            res.json({ ...s, version, bewertet, faellig: naechsteNachfrage({ ...s, version, bewertet }) })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    /** POST { art, wert?, antwort: 'spaeter'|'gespendet'|'nein'|'zu' } — Nachfrage beantwortet. */
    app.post('/api/spenden/antwort', async (req, res) => {
        try {
            const art = String(req.body?.art || '')
            if (!['update', 'meilenstein', 'zeit', 'dank', 'menue'].includes(art)) return res.status(400).json({ error: 'art unbekannt' })
            const antwort = String(req.body?.antwort || 'zu')
            const knex = getKnex()
            const s = await lies(knex)
            // Aus dem Menü geöffnet: nur die Antwort zählt, kein Anlass verbraucht
            const neu = art === 'menue'
                ? (antwort === 'gespendet' ? { status: 'gespendet', dank: Date.now() } : antwort === 'nein' ? { status: 'nein' } : {})
                : nachAntwort({ ...s, version: aktuelleVersion() }, { art, wert: req.body?.wert, antwort })
            await schreibe(knex, neu)
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })
}
