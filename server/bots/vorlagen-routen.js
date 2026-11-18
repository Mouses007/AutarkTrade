/**
 * Routen der Bot-Vorlagen (18.11.2026). Hinter der Sitzung; ändernde Aufrufe zusätzlich
 * hinter `herkunftMiddleware`. Vor setupBotRoutes einzuhängen.
 *
 *   GET    /api/bots/vorlagen        alle Vorlagen, neueste zuerst
 *   POST   /api/bots/vorlagen        neue Vorlage — entweder schon relativ ({unter, ueber, …}) oder
 *                                    als Plan mit festen Preisen und dem Kurs dazu ({plan, kurs})
 *   DELETE /api/bots/vorlagen/:id
 *
 * Eine Vorlage sendet nichts an Pionex: gestartet wird wie immer über die Steuerung
 * (Prüfen → Haken → Senden). Form und Rechnung in shared/botVorlage.js.
 */
import { getKnex } from '../database.js'
import { fehlerText } from '../boersen-status.js'
import { pruefeVorlage, vorlageAusPlan, MAX_VORLAGEN } from '../../shared/botVorlage.js'

const lies = (z) => {
    try {
        const v = pruefeVorlage({ ...JSON.parse(z.daten || '{}'), name: z.name })
        return v.fehler ? null : { id: z.id, erstelltAm: Number(z.erstelltAm), ...v }
    } catch { return null }
}

export function setupBotVorlagenRoutes(app) {
    app.get('/api/bots/vorlagen', async (req, res) => {
        try {
            const zeilen = await getKnex()('bot_vorlagen').orderBy('erstelltAm', 'desc').orderBy('id', 'desc').limit(MAX_VORLAGEN)
            res.json({ ok: true, vorlagen: zeilen.map(lies).filter(Boolean) })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.post('/api/bots/vorlagen', async (req, res) => {
        try {
            const b = req.body || {}
            const v = b.plan ? vorlageAusPlan({ ...b.plan, name: b.name ?? b.plan.name }, b.kurs) : pruefeVorlage(b)
            if (v.fehler) return res.status(400).json({ ok: false, code: v.fehler })
            const knex = getKnex()
            const [{ n }] = await knex('bot_vorlagen').count({ n: '*' })
            if (Number(n) >= MAX_VORLAGEN) return res.status(400).json({ ok: false, code: 'zuViele' })
            const { name, ...daten } = v
            const zeile = { name, daten: JSON.stringify(daten), erstelltAm: Date.now() }
            const [id] = await knex('bot_vorlagen').insert(zeile).returning('id')
            res.json({ ok: true, vorlage: { id: typeof id === 'object' ? id.id : id, erstelltAm: zeile.erstelltAm, ...v } })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.delete('/api/bots/vorlagen/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, code: 'id' })
            const n = await getKnex()('bot_vorlagen').where('id', id).del()
            res.json({ ok: true, geloescht: n })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })
}
