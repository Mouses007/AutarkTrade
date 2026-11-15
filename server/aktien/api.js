/**
 * Routen des Instrument-Stamms (Aktien-Integration, Phase 2).
 *
 *   GET  /api/aktien/stamm            Titel mit Listungen (Filter: anlageklasse, suche,
 *                                     handelsplatz, art, nurKryptoBoersen, grenze)
 *   GET  /api/aktien/stamm/stand      Zahlen und letzter Lauf dieses Prozesses
 *   POST /api/aktien/stamm/abgleich   jetzt abgleichen (liest nur öffentliche Listen)
 *   GET  /api/aktien/chart-symbole    Aktien, deren Kerzen der Chart laden kann (Symbol je Börse)
 */
import { getKnex } from '../database.js'
import { gleicheAb, letzterLauf, leseStamm, stammZahlen, HANDELSPLAETZE } from './stamm.js'
import { chartSymboleAus } from './chart-symbole.js'

const ARTEN = ['perp', 'token-spot', 'broker-spot']
const KLASSEN = ['aktien', 'sonstige']
const fehler = (res, e) => res.status(500).json({ ok: false, error: String(e?.message || e) })

export function setupAktienRoutes(app) {
    app.get('/api/aktien/stamm', async (req, res) => {
        try {
            const q = req.query
            const titel = await leseStamm(getKnex(), {
                anlageklasse: KLASSEN.includes(q.anlageklasse) ? q.anlageklasse : 'aktien',
                suche: typeof q.suche === 'string' ? q.suche.slice(0, 40) : '',
                handelsplatz: HANDELSPLAETZE.includes(q.handelsplatz) ? q.handelsplatz : undefined,
                art: ARTEN.includes(q.art) ? q.art : undefined,
                nurKryptoBoersen: q.nurKryptoBoersen === '1',
                grenze: q.grenze,
            })
            res.json({ ok: true, titel })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/aktien/stamm/stand', async (req, res) => {
        try {
            res.json({ ok: true, ...(await stammZahlen(getKnex())), letzterLauf: letzterLauf() })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/aktien/chart-symbole', async (req, res) => {
        try {
            const titel = await leseStamm(getKnex(), { anlageklasse: 'aktien', art: 'perp', grenze: 5000 })
            res.json({ ok: true, titel: chartSymboleAus(titel) })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/aktien/stamm/abgleich', async (req, res) => {
        try {
            const r = await gleicheAb()
            // Die Listen der neuen/entfallenen Listungen können lang sein — die Seite braucht nur Zahlen.
            res.json({ ok: r.ok, zeit: r.zeit, stand: r.stand, titel: r.titel, listungen: r.listungen,
                neu: r.neu?.slice(0, 50) || [], neuAnzahl: r.neu?.length || 0, wegAnzahl: r.weg?.length || 0, gebremst: r.gebremst || [] })
        } catch (e) { fehler(res, e) }
    })
}
