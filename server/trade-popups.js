/**
 * Trade-Bewertungs-Popup: was ist neu, was ist gemeldet (29.10.2026).
 *
 * Bis hier entschied jeder Browser selbst: eine ID-Liste in localStorage, beim
 * ERKENNEN eingetragen. Ein unsichtbarer Tab verbrauchte so die Meldung, ein
 * zweites Gerät meldete alles noch einmal, und ohne Zeitbezug war jeder
 * Altbestand „neu". Jetzt steht beides in `incoming_positions`:
 *
 *   neu (Eröffnung)   status 'open', openingEvalDone 0, skipEvaluation 0,
 *                     openNotifiedAt null, openedAt >= Grenze der Börse
 *   neu (Schliessung) status 'pending_evaluation', closeNotifiedAt null,
 *                     closedAt >= Grenze der Börse
 *   Grenze            max(settings.tradePopupBaseline, Schlüssel-Zeitpunkt
 *                     der Börse aus settings.tradePopupBoersen)
 *   gemeldet          erst wenn das Popup geschlossen wird (×, Esc,
 *                     Hintergrund, „Zu Pendente Trades") — POST /quittieren
 *
 * Massgeblich ist die Börsenzeit (`openedAt`/`closedAt`, beim Anlegen aus den
 * Rohdaten gezogen): Positionen eines neu eingerichteten Kontos und die 24 h,
 * die der erste History-Scan nachholt, liegen vor der Grenze. Eine Zeile ohne
 * Zeit (Altbestand, älterer Codestand) ist nie neu.
 *
 * Der Schalter `showTradePopups` steuert hier nur die Meldung. Dass er aus
 * auch die Datenhaltung ändert (Schliessungen werden direkt übernommen und
 * die Zeile gelöscht statt pendent, `src/utils/incoming.js`), bleibt so.
 */
import { getKnex } from './database.js'
import { setzeGrundstand } from './migrationen/trade-popups.js'

/** Felder der Börsen-Rohdaten, Reihenfolge = Vorrang. */
const OEFFNUNG = ['ctime', 'cTime', 'createTime', 'createdTime']
// Bitunix mtime, Bitget uTime/utime, Pionex-Bots closeTime, Pionex-Futures updateTime
const SCHLUSS = ['mtime', 'uTime', 'utime', 'closeTime', 'updateTime', 'updatedTime']

const BOERSEN = ['bitunix', 'bitget', 'pionex']
const MAX_IDS = 500

/** Zeitstempel in ms aus Rohdaten (Objekt oder JSON-Text); Sekunden werden umgerechnet. */
export function zeitstempel(roh, felder) {
    let o = roh
    if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return null } }
    if (!o || typeof o !== 'object') return null
    for (const f of felder) {
        const n = Number(o[f])
        if (!Number.isFinite(n) || n < 1e9) continue
        return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
    }
    return null
}

/** Zeiten einer neuen `incoming_positions`-Zeile (rein). */
export function felderBeimAnlegen(zeile, jetzt) {
    const z = zeile || {}
    const f = { openedAt: zeitstempel(z.bitunixData, OEFFNUNG) ?? zeitstempel(z.historyData, OEFFNUNG) ?? jetzt }
    // Aus dem History-Scan: schon geschlossen angelegt
    if (z.status === 'pending_evaluation') {
        f.closedAt = zeitstempel(z.historyData, SCHLUSS) ?? zeitstempel(z.bitunixData, SCHLUSS) ?? jetzt
    }
    return f
}

/** Schliesszeit, wenn eine offene Zeile pendent wird (rein). `alt` = gespeicherte Zeile. */
export function felderBeimSchliessen(alt, neu, jetzt) {
    if (neu?.status !== 'pending_evaluation' || !alt) return {}
    if (alt.status === 'pending_evaluation' || alt.closedAt != null) return {}
    return { closedAt: zeitstempel(neu.historyData, SCHLUSS) ?? jetzt }
}

/** Beim Einschalten des Schalters neue Baseline — kein Rückstau (rein). */
export function baselineBeimEinschalten(altWert, neuWert, jetzt) {
    const aus = (v) => v === 0 || v === '0' || v === false
    if (neuWert === undefined || aus(neuWert)) return {}
    return aus(altWert) ? { tradePopupBaseline: jetzt } : {}
}

function leseAnker(text) {
    try {
        const o = JSON.parse(text || '{}')
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
    } catch { return {} }
}

/** Grenze einer Börse: Baseline oder, später, das Einrichten ihres Schlüssels. */
export function grenzeFuer(broker, { baseline, anker }) {
    return Math.max(Number(baseline) || 0, Number(anker?.[broker]) || 0)
}

/** Rein: die neuen Meldungen aus den Zeilen. Ohne Baseline nichts. */
export function waehleNeue(zeilen, stand) {
    if (!Number(stand?.baseline)) return []
    const aus = []
    for (const z of zeilen || []) {
        const broker = z.broker || 'bitunix'
        const grenze = grenzeFuer(broker, stand)
        if (z.status === 'open') {
            if (Number(z.openingEvalDone) || Number(z.skipEvaluation)) continue
            if (z.openNotifiedAt != null || z.openedAt == null || Number(z.openedAt) < grenze) continue
            aus.push({ positionId: String(z.positionId), broker, art: 'open' })
        } else if (z.status === 'pending_evaluation') {
            if (z.closeNotifiedAt != null || z.closedAt == null || Number(z.closedAt) < grenze) continue
            aus.push({ positionId: String(z.positionId), broker, art: 'close' })
        }
    }
    return aus
}

/** Liste aus dem Anfragekörper: nur Texte, ohne Doppelte, begrenzt. */
function idListe(roh) {
    if (!Array.isArray(roh)) return []
    return [...new Set(roh.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).filter(Boolean))].slice(0, MAX_IDS)
}

/** `{ an, meldungen }` — leer, wenn der Schalter aus ist. */
export async function neueMeldungen(knex, jetzt = Date.now()) {
    const s = await knex('settings').select('showTradePopups', 'tradePopupBaseline', 'tradePopupBoersen').where('id', 1).first()
    const v = s?.showTradePopups
    if (v === 0 || v === '0') return { an: false, meldungen: [] }
    // Keine Baseline (etwa nach Rücksicherung einer alten Einstellungszeile):
    // Grundstand nachholen, was jetzt da ist, ist nicht neu.
    if (!Number(s?.tradePopupBaseline)) {
        await setzeGrundstand(knex, jetzt)
        return { an: true, meldungen: [] }
    }
    const zeilen = await knex('incoming_positions')
        .select('positionId', 'broker', 'status', 'openingEvalDone', 'skipEvaluation', 'openedAt', 'closedAt', 'openNotifiedAt', 'closeNotifiedAt')
        .where((q) => q
            .where((o) => o.where('status', 'open').whereNull('openNotifiedAt'))
            .orWhere((c) => c.where('status', 'pending_evaluation').whereNull('closeNotifiedAt')))
    return { an: true, meldungen: waehleNeue(zeilen, { baseline: s.tradePopupBaseline, anker: leseAnker(s.tradePopupBoersen) }) }
}

/** Gezeigte Meldungen als gemeldet markieren. Idempotent: gesetzt wird nur, was noch null ist. */
export async function quittiere(knex, { open, close } = {}, jetzt = Date.now()) {
    const o = idListe(open)
    const c = idListe(close)
    let n = 0
    if (!o.length && !c.length) return 0
    await knex.transaction(async (trx) => {
        if (o.length) n += await trx('incoming_positions').whereIn('positionId', o).whereNull('openNotifiedAt').update({ openNotifiedAt: jetzt })
        if (c.length) n += await trx('incoming_positions').whereIn('positionId', c).whereNull('closeNotifiedAt').update({ closeNotifiedAt: jetzt })
    })
    return n
}

/**
 * Neuer Schlüssel einer Börse: was dieses Konto schon hat, ist nicht neu.
 * Fehler bleiben still — am Schlüssel-Speichern darf das nicht scheitern.
 */
export async function setzeBoersenAnker(broker, jetzt = Date.now()) {
    if (!BOERSEN.includes(broker)) return
    try {
        const knex = getKnex()
        const s = await knex('settings').select('tradePopupBoersen').where('id', 1).first()
        const anker = leseAnker(s?.tradePopupBoersen)
        anker[broker] = jetzt
        await knex('settings').where('id', 1).update({ tradePopupBoersen: JSON.stringify(anker) })
    } catch (e) {
        console.warn(` -> Popup-Grenze für ${broker} nicht gesetzt:`, e.message)
    }
}

export function setupTradePopupRoutes(app) {
    app.get('/api/trade-popups/neu', async (_req, res) => {
        try {
            res.json(await neueMeldungen(getKnex()))
        } catch (e) {
            console.error(' -> Trade-Popups lesen:', e.message)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    /** POST { open: [positionId], close: [positionId] } */
    app.post('/api/trade-popups/quittieren', async (req, res) => {
        try {
            const n = await quittiere(getKnex(), req.body || {})
            res.json({ ok: true, quittiert: n })
        } catch (e) {
            console.error(' -> Trade-Popups quittieren:', e.message)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })
}
