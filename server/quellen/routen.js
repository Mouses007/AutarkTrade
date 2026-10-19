/**
 * Einstellungen › Datenquellen: Marktdatenquelle und die Schlüssel der
 * Quellen, die nur mit Kundenschlüssel laufen (Verkaufs-Prüfung S12).
 *
 *   GET  /api/quellen               Wahl + was die Quelle kann, CoinGecko-Status
 *   PUT  /api/marktdaten/quelle     { wahl }               (marktdaten/index.js)
 *   PUT  /api/quellen/coingecko     { schluessel?, tarif? } leer = löschen
 *   POST /api/quellen/coingecko/test                        prüft /ping mit Schlüssel
 *
 * Schlüssel verlassen den Server nie im Klartext; die Antwort nennt nur, ob
 * einer hinterlegt ist, und seine letzten vier Zeichen.
 */

import axios from 'axios'
import { getKnex } from '../database.js'
import { encrypt } from '../crypto.js'
import { beschreibung, setupMarktdatenRoutes } from '../marktdaten/index.js'
import * as coingecko from './coingecko.js'

async function cgStatus() {
    const z = await coingecko.zugang()
    return z ? { hinterlegt: true, tarif: z.tarif, ende: z.schluessel.slice(-4) } : { hinterlegt: false, tarif: 'demo' }
}

export function setupQuellenRoutes(app) {
    setupMarktdatenRoutes(app)

    app.get('/api/quellen', async (req, res) => {
        res.json({ marktdaten: await beschreibung(), coingecko: await cgStatus() })
    })

    app.put('/api/quellen/coingecko', async (req, res) => {
        try {
            const neu = {}
            if (req.body?.schluessel !== undefined) {
                const s = String(req.body.schluessel || '').trim()
                if (s.length > 200) return res.status(400).json({ error: 'Schlüssel zu lang' })
                neu.hypeKeyCoingecko = s ? encrypt(s) : ''
            }
            if (req.body?.tarif !== undefined) neu.coingeckoTarif = req.body.tarif === 'pro' ? 'pro' : 'demo'
            if (Object.keys(neu).length) await getKnex()('settings').where('id', 1).update(neu)
            coingecko.vergiss()
            res.json(await cgStatus())
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.post('/api/quellen/coingecko/test', async (req, res) => {
        try {
            const roh = String(req.body?.schluessel || '').trim()
            const tarif = req.body?.tarif === 'pro' ? 'pro' : (req.body?.tarif === 'demo' ? 'demo' : null)
            let anfrage
            if (roh) {
                const t = tarif || 'demo'
                anfrage = {
                    url: `${t === 'pro' ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com'}/api/v3/ping`,
                    kopf: { [t === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: roh },
                }
            } else {
                anfrage = await coingecko.cgAnfrage('/ping')
            }
            await axios.get(anfrage.url, { headers: anfrage.kopf, timeout: 10000 })
            res.json({ ok: true })
        } catch (e) {
            const status = e?.response?.status
            res.json({ ok: false, fehler: status ? `HTTP ${status}` : e.message })
        }
    })
}
