/**
 * Routen des Newcomer-Radars (Aktien-Integration, Phase 4).
 *
 *   GET  /api/newcomer-radar/titel   Rangliste (Filter: kategorie, mitHuerden=1, grenze)
 *   GET  /api/newcomer-radar/stand   Fortschritt des Laufs und Zahlen je Kategorie
 *   POST /api/newcomer-radar/lauf    Lauf starten (202) — fragt die Kursquelle für jeden Titel
 */
import { getKnex } from '../database.js'
import { fordereQuelle } from '../quellen/freigabe.js'
import { sendeWennAus } from '../quellen/aus.js'
import { starteLauf, laufStand, leseTitel, zaehleTitel } from './lauf.js'

export const KATEGORIEN = ['boersengang', 'vorboerslich', 'neuGelistet', 'etabliert', 'unbekannt']
const fehler = (res, e) => res.status(500).json({ ok: false, error: String(e?.message || e) })

export function setupNewcomerRoutes(app) {
    app.get('/api/newcomer-radar/titel', async (req, res) => {
        try {
            const q = req.query
            const titel = await leseTitel(getKnex(), {
                kategorie: KATEGORIEN.includes(q.kategorie) ? q.kategorie : undefined,
                mitHuerden: q.mitHuerden === '1',
                grenze: q.grenze,
            })
            res.json({ ok: true, titel })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/newcomer-radar/stand', async (req, res) => {
        try {
            res.json({ ok: true, lauf: laufStand(), kategorien: await zaehleTitel(getKnex()) })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/newcomer-radar/lauf', async (req, res) => {
        try {
            await fordereQuelle('yahoo')
            const grenze = Number(req.body?.grenze)
            const lauf = await starteLauf({ grenze: grenze > 0 ? Math.min(grenze, 5000) : undefined, alle: req.body?.alle === true })
            res.status(202).json({ ok: true, lauf })
        } catch (e) {
            if (sendeWennAus(res, e)) return
            fehler(res, e)
        }
    })
}
