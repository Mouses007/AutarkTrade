/**
 * Spenden: Menüeintrag, Dialog mit QR-Codes (BTC, PayPal) und „Buy me a coffee".
 *
 * Zwei Nachfragen, danach nie wieder:
 *   Stufe 0 → 1  ab 50 bewerteten Trades   (Knöpfe: Spenden · Später)
 *   Stufe 1 → 2  ab 200 bewerteten Trades  (Knöpfe: Spenden · Ich habe schon · Ich will definitiv nicht)
 * Wer beim ersten Mal schon über 200 lag, bekommt die zweite Frage erst
 * ABSTAND_ZWEITE Bewertungen später — sonst kämen beide gleich hintereinander.
 *
 * „Bewertet" = ein Trade mit Zufriedenheit (Daumen) in `satisfactions`.
 * Der Schalter `spendenAn` (Vorgabe an) blendet Menüeintrag und Nachfragen aus.
 */
import { getKnex } from './database.js'

export const ERSTE_AB = 50
export const ZWEITE_AB = 200
export const ABSTAND_ZWEITE = 150

/** Rein: welche Nachfrage ist fällig? 1, 2 oder null. */
export function faelligeFrage({ an = true, stufe = 0, bewertet = 0, bei = 0 }) {
    if (!an) return null
    if (stufe <= 0) return bewertet >= ERSTE_AB ? 1 : null
    if (stufe === 1) return bewertet >= ((bei || 0) >= ZWEITE_AB ? bei + ABSTAND_ZWEITE : ZWEITE_AB) ? 2 : null
    return null
}

async function zaehleBewertete(knex) {
    const r = await knex('satisfactions').whereNot('tradeId', '').whereNotNull('tradeId')
        .countDistinct({ n: 'tradeId' }).first()
    return Number(r?.n) || 0
}

async function lies(knex) {
    const s = await knex('settings').select('spendenAn', 'spendenStufe', 'spendenBei').where('id', 1).first()
    return { an: Number(s?.spendenAn ?? 1) === 1, stufe: Number(s?.spendenStufe) || 0, bei: Number(s?.spendenBei) || 0 }
}

export function setupSpendenRoutes(app) {
    app.get('/api/spenden/stand', async (_req, res) => {
        try {
            const knex = getKnex()
            const s = await lies(knex)
            const bewertet = await zaehleBewertete(knex)
            res.json({ ...s, bewertet, faellig: faelligeFrage({ ...s, bewertet }) })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    /** POST { frage: 1|2 } — Nachfrage beantwortet (egal wie): Stufe weiterschalten. */
    app.post('/api/spenden/beantwortet', async (req, res) => {
        try {
            const frage = Number(req.body?.frage)
            if (frage !== 1 && frage !== 2) return res.status(400).json({ error: 'frage muss 1 oder 2 sein' })
            const knex = getKnex()
            const s = await lies(knex)
            if (s.stufe >= frage) return res.json({ stufe: s.stufe })
            const bewertet = await zaehleBewertete(knex)
            await knex('settings').where('id', 1).update({ spendenStufe: frage, spendenBei: bewertet })
            res.json({ stufe: frage })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })
}
