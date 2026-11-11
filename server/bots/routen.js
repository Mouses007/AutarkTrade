/**
 * Routen der Bot-Seite (nur lesend).
 *
 *   GET /api/bots          laufende und beendete Pionex-Bots, normalisiert, mit aktuellem Kurs
 *   GET /api/bots/wissen   das Wissen über die Bot-Typen (pionex-wissen.js)
 *
 * Ein Fehler beim Abruf wird gemeldet (ok: false + Text) und bei der Börse
 * vermerkt — nie als leere Liste mit ok: true (14.09.2026: ein abgelaufener
 * Pionex-Schlüssel liess den laufenden Bot still verschwinden).
 */
import { getDecryptedPionexConfig, getBotOrders, fetchTickerPrice } from '../pionex-api.js'
import { merkeBoersenStatus, fehlerText, nichtEingerichtet } from '../boersen-status.js'
import { normalisiereBot, holeAlleSeiten } from './pionex-bots.js'
import { TYPEN, GEBUEHREN, STAND } from './pionex-wissen.js'
import { logWarn } from '../logger.js'

const CACHE_MS = 60_000
let cache = null          // { zeit, antwort }
let laufend = null        // gemeinsame Abfrage gleichzeitiger Aufrufe

async function holeKurse(bots) {
    const kurse = {}
    for (const b of bots) {
        if (!b.laufend || kurse[b.coin] !== undefined) continue
        const p = await fetchTickerPrice(`${b.coin}_USDT_PERP`) || await fetchTickerPrice(`${b.coin}_USDT`)
        kurse[b.coin] = p > 0 ? p : null
    }
    return kurse
}

async function baueAntwort() {
    const cfg = await getDecryptedPionexConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) return { ...nichtEingerichtet('pionex'), bots: [] }
    const seite = (opt) => getBotOrders(cfg.apiKey, cfg.secretKey, opt)
    const [lauf, fertig] = await Promise.all([
        holeAlleSeiten(seite, 'running', 2),
        holeAlleSeiten(seite, 'finished', 20),
    ])
    const bots = [...lauf, ...fertig].map(normalisiereBot).filter(Boolean)
    const kurse = await holeKurse(bots)
    for (const b of bots) b.kurs = b.laufend ? (kurse[b.coin] ?? null) : null
    merkeBoersenStatus('pionex').catch(() => { })
    return { ok: true, bots, stand: Date.now() }
}

export async function holeBots({ frisch = false } = {}) {
    if (!frisch && cache && Date.now() - cache.zeit < CACHE_MS) return cache.antwort
    if (!laufend) {
        laufend = baueAntwort()
            .then((antwort) => { if (antwort.ok) cache = { zeit: Date.now(), antwort }; return antwort })
            .finally(() => { laufend = null })
    }
    return laufend
}

export function setupBotRoutes(app) {
    app.get('/api/bots', async (req, res) => {
        try {
            res.json(await holeBots({ frisch: req.query.frisch === '1' }))
        } catch (e) {
            const text = fehlerText(e)
            logWarn('bots', `Abruf der Pionex-Bots fehlgeschlagen: ${text}`)
            merkeBoersenStatus('pionex', text).catch(() => { })
            res.status(502).json({ ok: false, error: text, bots: [] })
        }
    })

    app.get('/api/bots/wissen', (req, res) => {
        res.json({ stand: STAND, gebuehren: GEBUEHREN, typen: TYPEN })
    })
}
