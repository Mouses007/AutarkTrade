/**
 * Routen der Bot-Seite (nur lesend).
 *
 *   GET /api/bots          laufende und beendete Pionex-Bots, normalisiert, mit aktuellem Kurs
 *   GET /api/bots/wissen   das Wissen über die Bot-Typen (pionex-wissen.js)
 *   GET /api/bots/:id/verlauf eigene Schnappschüsse (bot_verlauf, Takt in verlauf.js)
 *   POST /api/bots/:id/simulation {varianten:[{unten,oben,anzahl,art}]} — Rückblick
 *                          heutige Einstellung gegen Varianten (simulation.js)
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
import { kerzen as holeKerzen, fundingVerlauf } from '../marktdaten/index.js'
import { wartungsmargeMitQuelle } from '../margin-rates.js'
import { sendeWennAus } from '../quellen/aus.js'
import { vergleiche, pruefeVariante, SIMULIERBAR, MAX_VARIANTEN } from './simulation.js'

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

// ── Simulation: feine Kerzen der ganzen Laufzeit ─────────────────────────
const SIM_MS = 10 * 60_000
const MAX_SIM_KERZEN = 60_000
const simCache = new Map()   // id → { zeit, tf, kerzen }
const TF_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }

/** Feinster Zeitrahmen, mit dem die Laufzeit in MAX_SIM_KERZEN passt (1m wäre am genausten). */
export function simZeitrahmen(ms) {
    for (const tf of ['1m', '5m', '15m', '1h']) if (ms / TF_MS[tf] <= MAX_SIM_KERZEN) return tf
    return '1h'
}

async function simKerzen(bot) {
    const c = simCache.get(bot.id)
    if (c && Date.now() - c.zeit < SIM_MS) return c
    const ende = bot.beendet || Date.now()
    const start = bot.erstellt
    if (!start) return { tf: null, kerzen: [] }
    const tf = simZeitrahmen(ende - start)
    const schritt = TF_MS[tf]
    const kerzen = []
    for (let von = Math.floor(start / schritt) * schritt, runde = 0; von < ende && runde < 80; runde++) {
        const bis = Math.min(ende, von + 1000 * schritt)
        const teil = await holeKerzen(bot.symbol, tf, { markt: 'futures', start: von, ende: bis, limit: 1000 })
        for (const k of teil) if (k.t >= start - schritt && k.t <= ende && (!kerzen.length || k.t > kerzen.at(-1).t)) kerzen.push({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c })
        von = bis
    }
    // Funding-Verlauf der Marktdatenquelle (Pionex veröffentlicht keinen); fehlt er, rechnet die Simulation ohne
    let funding = null
    if (bot.typ !== 'spot_grid') {
        try { funding = await fundingVerlauf(bot.symbol, start, ende) } catch { funding = null }
    }
    const daten = { zeit: Date.now(), tf, kerzen, funding }
    simCache.set(bot.id, daten)
    return daten
}

export function setupBotRoutes(app) {
    app.post('/api/bots/:id/simulation', async (req, res) => {
        try {
            const alle = await holeBots()
            const bot = alle.bots?.find((b) => b.id === String(req.params.id))
            if (!bot) return res.status(404).json({ ok: false, error: 'Bot nicht gefunden' })
            if (!SIMULIERBAR.has(bot.typ)) return res.status(400).json({ ok: false, code: 'typ' })
            const roh = Array.isArray(req.body?.varianten) ? req.body.varianten.slice(0, MAX_VARIANTEN) : []
            const varianten = []
            for (const [i, v] of roh.entries()) {
                const g = pruefeVariante(v, bot)
                if (g.fehler === 'leer') continue
                if (g.fehler) return res.status(400).json({ ok: false, code: g.fehler, variante: i })
                varianten.push(g)
            }
            const { tf, kerzen, funding } = await simKerzen(bot)
            const marge = await wartungsmargeMitQuelle(bot.symbol).catch(() => null)
            const mmr = marge?.pct > 0 ? marge.pct / 100 : undefined
            const ergebnis = vergleiche(bot, kerzen, varianten, { funding, mmr })
            if (ergebnis.fehler) return res.status(400).json({ ok: false, code: ergebnis.fehler })
            res.json({ ok: true, zeitrahmen: tf, mmrQuelle: marge?.quelle || 'pauschal', ...ergebnis })
        } catch (e) {
            if (sendeWennAus(res, e)) return
            res.status(502).json({ ok: false, error: fehlerText(e) })
        }
    })

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
