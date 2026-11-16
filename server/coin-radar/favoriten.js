/**
 * Favoriten Coins: die Seite «Favoriten» im Coin-Radar.
 *
 *   GET /api/coin-radar/favoriten   die bestehende Favoritenliste (`hype_favoriten`) mit dem
 *                                   Stand des letzten Coin-Radar-Laufs bzw. der letzten Hype-Prüfung
 *
 * Liest nur. Anheften, Entfernen und Stummschalten bleiben die Routen des
 * Hype-Radars (`/api/hype-radar/favoriten`), der Wachhund läuft unverändert.
 * Warum diese Tabelle und keine neue: `favoriten-kern.js`.
 */
import { getKnex } from '../database.js'
import { coinFavoritenZeilen, istBoersenFavorit } from './favoriten-kern.js'
import { logWarn } from '../logger.js'

const json = (text, sonst) => { try { return JSON.parse(text) ?? sonst } catch { return sonst } }

export async function leseCoinFavoriten(knex) {
    const favoriten = await knex('hype_favoriten').orderBy('erstelltAm', 'desc')
    const lauf = await knex('coinradar_laeufe').where({ status: 'fertig', anlageklasse: 'krypto' }).orderBy('id', 'desc').first()
    const kopf = lauf ? { id: lauf.id, zeit: Number(lauf.beendetAm || lauf.erstelltAm) || null } : null
    if (!favoriten.length) return { lauf: kopf, favoriten: [] }

    const boerse = favoriten.filter(istBoersenFavorit)
    const dex = favoriten.filter((f) => !istBoersenFavorit(f))
    const zeilen = lauf && boerse.length
        ? (await knex('coinradar_zeilen').where('laufId', lauf.id).whereIn('symbol', boerse.map((f) => f.symbol)))
            .map((z) => ({ ...z, teilnoten: json(z.teilnoten, {}), boersen: json(z.boersen, {}) }))
        : []
    // Je DEX-Favorit die jüngste Prüfung — eine Abfrage je Favorit, es sind eine Handvoll.
    const pruefungen = []
    for (const f of dex) {
        const p = await knex('hype_candidates').where({ symbol: f.symbol, chain: f.chain || '' }).orderBy('erstelltAm', 'desc')
            .first('symbol', 'chain', 'hypeScore', 'safetyScore', 'status', 'verworfenGrund', 'erstelltAm')
        if (p) pruefungen.push(p)
    }
    const ungelesen = new Map((await knex('hype_alarme').where('gelesen', 0).whereIn('favoritId', favoriten.map((f) => f.id))
        .select('favoritId').count({ n: '*' }).groupBy('favoritId')).map((z) => [z.favoritId, Number(z.n) || 0]))
    return { lauf: kopf, favoriten: coinFavoritenZeilen(favoriten, { lauf, zeilen, pruefungen, ungelesen }) }
}

export function setupCoinFavoritenRoutes(app) {
    app.get('/api/coin-radar/favoriten', async (req, res) => {
        try {
            res.json({ ok: true, ...(await leseCoinFavoriten(getKnex())) })
        } catch (e) {
            logWarn('coin-radar', `Favoriten lesen: ${e.message}`)
            res.status(500).json({ ok: false, error: 'Favoriten konnten nicht geladen werden' })
        }
    })
}
