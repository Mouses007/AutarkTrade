/**
 * Routen der Bot-Seite (nur lesend).
 *
 *   GET /api/bots          laufende und beendete Pionex-Bots, normalisiert, mit aktuellem Kurs
 *   GET /api/bots/wissen   das Wissen über die Bot-Typen (pionex-wissen.js)
 *   GET /api/bots/:id/verlauf eigene Schnappschüsse (bot_verlauf, Takt in verlauf.js)
 *   GET /api/bots/:id/markt Kerzen der Laufzeit (Marktdaten-Quelle), Zeit im Band,
 *                          ATR des Tages und die Kennzahlen damit
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
import { kennzahlen, atrTag } from './kennzahlen.js'
import { kerzen as holeKerzen } from '../marktdaten/index.js'
import { sendeWennAus } from '../quellen/aus.js'

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
    for (const b of bots) {
        b.kurs = b.laufend ? (kurse[b.coin] ?? null) : null
        b.kennzahlen = kennzahlen(b, { kurs: b.kurs })
    }
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

const MARKT_MS = 5 * 60_000
const marktCache = new Map()   // id → { zeit, daten }

/** Zeitrahmen, mit dem die ganze Laufzeit in höchstens ~1000 Kerzen passt. */
function zeitrahmenFuer(ms) {
    const h = ms / 3_600_000
    if (h <= 1000 / 4) return ['15m', 15 * 60_000]
    if (h <= 1000) return ['1h', 3_600_000]
    if (h <= 4000) return ['4h', 4 * 3_600_000]
    return ['1d', 86_400_000]
}

async function marktFuer(bot) {
    const c = marktCache.get(bot.id)
    if (c && Date.now() - c.zeit < MARKT_MS) return c.daten
    const ende = bot.beendet || Date.now()
    const start = bot.erstellt || ende - 30 * 86_400_000
    const [tf, schritt] = zeitrahmenFuer(ende - start)
    const limit = Math.min(1000, Math.ceil((ende - start) / schritt) + 2)
    const kerzen = await holeKerzen(bot.symbol, tf, { markt: 'futures', start, limit })
    const tag = await holeKerzen(bot.symbol, '1d', { markt: 'futures', ende, limit: 30 })
    const atr = atrTag(tag)
    const daten = {
        zeitrahmen: tf,
        kerzen: kerzen.map((k) => [k.t, k.o, k.h, k.l, k.c]),
        atrTag: atr,
        kennzahlen: kennzahlen(bot, { kurs: bot.kurs, atrTag: atr, kerzen }),
    }
    marktCache.set(bot.id, { zeit: Date.now(), daten })
    return daten
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

    app.get('/api/bots/:id/markt', async (req, res) => {
        try {
            const alle = await holeBots()
            const bot = alle.bots?.find((b) => b.id === String(req.params.id))
            if (!bot) return res.status(404).json({ ok: false, error: 'Bot nicht gefunden' })
            res.json({ ok: true, ...(await marktFuer(bot)) })
        } catch (e) {
            if (sendeWennAus(res, e)) return
            res.status(502).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.get('/api/bots/:id/verlauf', async (req, res) => {
        try {
            const { leseVerlauf } = await import('./verlauf.js')
            res.json({ ok: true, punkte: await leseVerlauf(req.params.id) })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.get('/api/bots/wissen', (req, res) => {
        res.json({ stand: STAND, gebuehren: GEBUEHREN, typen: TYPEN })
    })
}
