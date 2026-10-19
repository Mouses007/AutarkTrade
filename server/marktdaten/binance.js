/**
 * Marktdaten-Anbieter Binance (öffentliche REST- und WebSocket-Schnittstellen).
 *
 * Der einzige Ort, an dem die Binance-Adressen der Marktdaten stehen. Wer
 * Binance-Daten braucht, fragt `server/marktdaten/index.js` — nie direkt hier,
 * sonst liefe die Funktion weiter, wenn der Kunde Binance abgewählt hat.
 *
 * Binance ist der volle Anbieter: Kerzen, Ticker, Orderbuch, Funding, dazu
 * die Futures-Statistik (Open-Interest-Historie, Taker-Volumen, Long/Short),
 * Liquidationen und die Streams (Orderbuch-Diffs, Trades), auf denen Bookmap,
 * Rekorder und Replay stehen. Ob der Kunde diese Daten in seinem Land und für
 * seinen Zweck nutzen darf, ist laut Verkaufs-Prüfung (Zeile 10) unklar — die
 * Einstellung sagt das, und der Kunde entscheidet.
 */

import axios from 'axios'
import { notiereGewicht, melde429 } from '../binance-takt.js'

export const id = 'binance'
export const name = 'Binance'

/** REST-Wurzeln. `futures` = USDⓈ-M. */
export const REST = {
    spot: 'https://api.binance.com',
    futures: 'https://fapi.binance.com',
}

/**
 * WebSocket-Wurzeln. Futures seit 23.04.2026 mit gerouteten Pfaden:
 * `/public` (Orderbuch, Trades, bookTicker), `/market` (aggTrade, kline,
 * miniTicker, forceOrder). Spot behält den alten Pfad.
 */
export const WS = {
    futures: 'wss://fstream.binance.com',
    spot: 'wss://stream.binance.com:9443',
}

export const faehigkeiten = [
    'kerzen', 'spot', 'ticker', 'orderbuch', 'funding', 'symbole',
    'oiHistorie', 'takerVolumen', 'longShort', 'liquidationen', 'streams', 'listungen',
]

const PFADE = {
    kerzen: { spot: '/api/v3/klines', futures: '/fapi/v1/klines' },
    preis: { spot: '/api/v3/ticker/price', futures: '/fapi/v1/ticker/price' },
    ticker24h: { spot: '/api/v3/ticker/24hr', futures: '/fapi/v1/ticker/24hr' },
    buch: { spot: '/api/v3/ticker/bookTicker', futures: '/fapi/v1/ticker/bookTicker' },
    tiefe: { spot: '/api/v3/depth', futures: '/fapi/v1/depth' },
    info: { spot: '/api/v3/exchangeInfo', futures: '/fapi/v1/exchangeInfo' },
}
export const KERZEN_MAX = { spot: 1000, futures: 1500 }
const ZEIT = 10000

const markt = (m) => (m === 'spot' ? 'spot' : 'futures')

/**
 * GET gegen Binance mit Gewichtsbuchhaltung. Binance meldet den Verbrauch der
 * GANZEN IP im Antwortkopf; die Bremse in `binance-takt.js` muss jeden
 * Abruf sehen, nicht nur den des Historienpfads.
 *
 * Nur FUTURES zählt an der Bremse: sie führt das USDⓈ-M-Budget der IP
 * (Engine, Ranglisten, Radar). Spot hat ein eigenes, viel grösseres — ein
 * Spot-429 sperrte früher 30 s alle Futures-Abrufe, und Spot-Köpfe
 * überschrieben die Futures-Zählung (Befund im Chart, siehe `chart-api.js`).
 */
export async function hole(m, pfad, params = {}, opts = {}) {
    const futures = markt(m) === 'futures'
    try {
        const antwort = await axios.get(`${REST[markt(m)]}${pfad}`, { params, timeout: opts.timeout || ZEIT })
        if (futures) notiereGewicht(antwort.headers)
        return antwort.data
    } catch (e) {
        const status = e?.response?.status
        if (futures && (status === 429 || status === 418)) melde429(status, e.response.headers)
        throw e
    }
}

/** Rohe Binance-Zeilen → `{t,o,h,l,c,v,closeTime}`; defekte Zeilen fallen weg. */
export function kerzenAus(rows) {
    const out = []
    for (const k of Array.isArray(rows) ? rows : []) {
        const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4])
        if (![t, o, h, l, c].every(Number.isFinite)) continue
        out.push({ t, o, h, l, c, v: Number(k[5]) || 0, closeTime: Number(k[6]) || 0 })
    }
    return out
}

/** Kerzen inklusive der laufenden, aufsteigend. */
export async function kerzen(symbol, interval, { markt: m, limit = 500, start, ende } = {}) {
    const params = { symbol, interval, limit: Math.min(limit, KERZEN_MAX[markt(m)]) }
    if (start !== undefined) params.startTime = start
    if (ende !== undefined) params.endTime = ende
    return kerzenAus(await hole(m, PFADE.kerzen[markt(m)], params))
}

export async function preis(symbol, { markt: m } = {}) {
    const d = await hole(m, PFADE.preis[markt(m)], { symbol })
    return Number(d?.price)
}

/** Alle Preise eines Marktes: Map Symbol → Preis. */
export async function preise({ markt: m } = {}) {
    const d = await hole(m, PFADE.preis[markt(m)])
    const aus = new Map()
    for (const z of Array.isArray(d) ? d : []) {
        const p = Number(z?.price)
        if (z?.symbol && Number.isFinite(p)) aus.set(z.symbol, p)
    }
    return aus
}

/**
 * 24h-Ticker aller Symbole eines Marktes, mit bestem Geld/Brief, in der
 * gemeinsamen Form (siehe `index.js`). Zwei Abrufe, weil Binance Ticker und
 * Buch trennt.
 */
export async function ticker24h({ markt: m } = {}) {
    const [t, b] = await Promise.all([
        hole(m, PFADE.ticker24h[markt(m)], {}, { timeout: 15000 }),
        hole(m, PFADE.buch[markt(m)], {}, { timeout: 15000 }).catch(() => []),
    ])
    const buch = new Map((Array.isArray(b) ? b : []).map((z) => [z.symbol, z]))
    return (Array.isArray(t) ? t : []).map((z) => {
        const q = buch.get(z.symbol) || {}
        return {
            symbol: z.symbol,
            preis: Number(z.lastPrice),
            hoch: Number(z.highPrice),
            tief: Number(z.lowPrice),
            eroeffnung: Number(z.openPrice),
            aenderungPct: Number(z.priceChangePercent),
            umsatzQuote: Number(z.quoteVolume),
            umsatzBasis: Number(z.volume),
            bid: Number(q.bidPrice), ask: Number(q.askPrice),
            bidMenge: Number(q.bidQty), askMenge: Number(q.askQty),
        }
    })
}

/**
 * 24h-Ticker EINES Symbols in der gemeinsamen Form (ohne Geld/Brief).
 * Gewicht 1 statt 40 für den Sammelabruf — die Watchlist fragt ihre paar
 * Symbole einzeln.
 */
export async function ticker24hEinzeln(symbol, { markt: m } = {}) {
    const z = await hole(m, PFADE.ticker24h[markt(m)], { symbol })
    return {
        symbol: z?.symbol || symbol,
        preis: Number(z?.lastPrice),
        hoch: Number(z?.highPrice),
        tief: Number(z?.lowPrice),
        eroeffnung: Number(z?.openPrice),
        aenderungPct: Number(z?.priceChangePercent),
        umsatzQuote: Number(z?.quoteVolume),
        umsatzBasis: Number(z?.volume),
    }
}

/** Orderbuch-Momentaufnahme: `{ bids:[[p,q]], asks:[[p,q]], ts, lastUpdateId }`. */
export async function orderbuch(symbol, { markt: m, tiefe = 1000 } = {}) {
    const d = await hole(m, PFADE.tiefe[markt(m)], { symbol, limit: tiefe }, { timeout: 15000 })
    const zahl = (l) => (Array.isArray(l) ? l : []).map(([p, q]) => [Number(p), Number(q)])
    return { bids: zahl(d?.bids), asks: zahl(d?.asks), ts: Number(d?.T || d?.E) || Date.now(), lastUpdateId: d?.lastUpdateId }
}

export async function funding(symbol) {
    const d = await hole('futures', '/fapi/v1/premiumIndex', { symbol })
    const rate = Number(d?.lastFundingRate)
    return Number.isFinite(rate) ? { rate, naechste: Number(d?.nextFundingTime) || 0 } : null
}

export async function fundingVerlauf(symbol, von, bis) {
    const out = []
    let ab = Number(von) || 0
    for (let runde = 0; runde < 10 && ab <= bis; runde++) {
        const d = await hole('futures', '/fapi/v1/fundingRate', { symbol, startTime: ab, endTime: bis, limit: 1000 })
        if (!Array.isArray(d)) throw new Error(`Kein Funding-Verlauf für ${symbol}`)
        for (const e of d) out.push({ t: Number(e.fundingTime), rate: Number(e.fundingRate), markPrice: Number(e.markPrice) || 0 })
        if (d.length < 1000) break
        ab = Number(d[d.length - 1].fundingTime) + 1
    }
    return out
}

/** Handelbare Symbole mit Rundungsregeln: Map Symbol → { tickSize, stepSize, minQty, minNotional }. */
export async function symbole({ markt: m } = {}) {
    const d = await hole(m, PFADE.info[markt(m)], {}, { timeout: 15000 })
    const map = new Map()
    for (const s of d?.symbols || []) {
        if (s.status !== 'TRADING') continue
        const pf = (s.filters || []).find((f) => f.filterType === 'PRICE_FILTER')
        const lf = (s.filters || []).find((f) => f.filterType === 'LOT_SIZE')
        const mn = (s.filters || []).find((f) => f.filterType === 'MIN_NOTIONAL')
        map.set(s.symbol, {
            symbol: s.symbol,
            basis: s.baseAsset, quote: s.quoteAsset,
            tickSize: pf ? Number(pf.tickSize) : 0,
            stepSize: lf ? Number(lf.stepSize) : 0,
            minQty: lf ? Number(lf.minQty) : 0,
            minNotional: mn ? Number(mn.notional ?? mn.minNotional) : 0,
            underlyingType: s.underlyingType,
            onboardDate: s.onboardDate,
            // Quartalskontrakte haben eigene Symbole; Listen für Perpetuals
            // (Live-Symbolwahl) filtern darauf.
            contractType: s.contractType,
        })
    }
    return map
}

/** Kerzen-Seitengrösse und Gewicht je Seite (Binance staffelt nach `limit`). */
export function seitenGewicht(m, seite) {
    if (markt(m) === 'spot') return 2
    return seite < 100 ? 1 : seite < 500 ? 2 : seite <= 1000 ? 5 : 10
}
