/**
 * Marktdaten-Anbieter Bitget (öffentliche REST-Schnittstelle v2).
 *
 * Der Grundbedarf: Kerzen (Futures und Spot), Ticker mit bestem Geld/Brief,
 * Orderbuch-Momentaufnahme, Funding, Kontraktregeln. Was Binance darüber
 * hinaus liefert — Open-Interest-HISTORIE, Taker-Volumen, Long/Short-Konten,
 * Liquidationsstrom, Orderbuch-Diffs für Bookmap und Rekorder — ist hier
 * nicht angebunden; die betroffenen Funktionen sagen das, statt still mit
 * halben Daten zu laufen.
 *
 * Gemessen 19.10.2026 gegen die Live-API:
 *   /api/v2/mix/market/candles        aufsteigend, bis 1000, mit laufender Kerze;
 *                                     mit `endTime` die Kerzen VOR dem Ende.
 *                                     Reicht nur wenige Wochen zurück.
 *   /api/v2/mix/market/history-candles  ältere, höchstens 200 je Seite, ebenfalls
 *                                     rückwärts ab `endTime` (BTC 1D bis 2020).
 *   Futures-Zeiteinheiten: 1m 3m 5m 15m 30m 1H 2H 4H, ab 6h nur `…utc`
 *   (`1D` ohne utc schneidet um 16:00 UTC). Kein 8h.
 *   Spot: 1min 3min 5min 15min 30min 1h 4h 6h 12h 1day 1week 1M, UTC-Varianten
 *   6Hutc 12Hutc 1Dutc 3Dutc 1Wutc; kein 2h.
 *   /api/v2/mix/market/tickers        lastPr, bidPr/askPr, bidSz/askSz, high24h,
 *                                     low24h, open24h, change24h (Bruchteil!),
 *                                     quoteVolume, fundingRate, holdingAmount.
 *   /api/v2/mix/market/merge-depth    Orderbuch, höchstens 100 Stufen je Seite.
 *   /api/v2/mix/market/contracts      pricePlace, volumePlace, minTradeNum,
 *                                     sizeMultiplier, minTradeUSDT, fundInterval.
 */

import axios from 'axios'

export const id = 'bitget'
export const name = 'Bitget'
export const REST = 'https://api.bitget.com'

export const faehigkeiten = ['kerzen', 'spot', 'ticker', 'orderbuch', 'funding', 'symbole']

const ZEIT = 10000
const PRODUKT = 'usdt-futures'
const markt = (m) => (m === 'spot' ? 'spot' : 'futures')

export const KERZEN_MAX = { spot: 1000, futures: 1000 }
const HISTORIE_MAX = 200

const GRAN_FUTURES = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H',
    '6h': '6Hutc', '12h': '12Hutc', '1d': '1Dutc', '3d': '3Dutc', '1w': '1Wutc', '1M': '1Mutc',
}
const GRAN_SPOT = {
    '1m': '1min', '3m': '3min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h',
    '6h': '6Hutc', '12h': '12Hutc', '1d': '1Dutc', '3d': '3Dutc', '1w': '1Wutc', '1M': '1M',
}

const IV_MS = {
    '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5,
    '6h': 216e5, '12h': 432e5, '1d': 864e5, '3d': 2592e5, '1w': 6048e5,
}

/** Zeiteinheiten, die Bitget im jeweiligen Markt kennt. */
export function kenntIntervall(interval, m) {
    return Boolean((markt(m) === 'spot' ? GRAN_SPOT : GRAN_FUTURES)[interval])
}

class BitgetFehler extends Error {
    constructor(msg, status = 502) { super(msg); this.status = status; this.response = { status } }
}

async function hole(pfad, params = {}, opts = {}) {
    const { data } = await axios.get(`${REST}${pfad}`, { params, timeout: opts.timeout || ZEIT })
    if (data?.code !== '00000') throw new BitgetFehler(`Bitget: ${data?.msg || 'unbekannter Fehler'}`, 400)
    return data.data
}

/** `[ts, o, h, l, c, baseVol, quoteVol]` → `{t,o,h,l,c,v,closeTime}` aufsteigend. */
export function kerzenAus(rows, intervalMs = 0) {
    const out = []
    for (const k of Array.isArray(rows) ? rows : []) {
        if (!Array.isArray(k)) continue
        const t = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4])
        if (![t, o, h, l, c].every(Number.isFinite)) continue
        out.push({ t, o, h, l, c, v: Number(k[5]) || 0, closeTime: intervalMs ? t + intervalMs - 1 : 0 })
    }
    return out.sort((a, b) => a.t - b.t)
}

/**
 * Kerzen inklusive der laufenden, aufsteigend.
 *
 * Bitget liefert immer die Kerzen VOR `endTime`. Ein Fenster `[start, ende)`
 * wird deshalb rückwärts geblättert: erst `candles` (jung), dann
 * `history-candles` (alt, 200 je Seite), bis `start` erreicht ist oder die
 * Börse nichts Älteres mehr hat.
 */
export async function kerzen(symbol, interval, { markt: m, limit = 500, start, ende, intervalMs = IV_MS[interval] || 0 } = {}) {
    const mk = markt(m)
    const gran = (mk === 'spot' ? GRAN_SPOT : GRAN_FUTURES)[interval]
    if (!gran) throw new BitgetFehler(`Bitget kennt die Zeiteinheit ${interval} im Markt ${mk} nicht`, 400)
    const basis = mk === 'spot' ? '/api/v2/spot/market' : '/api/v2/mix/market'
    const fest = mk === 'spot' ? { symbol, granularity: gran } : { symbol, productType: PRODUKT, granularity: gran }

    let nurLetzte = 0
    if (start === undefined) {
        const params = { ...fest, limit: Math.min(limit, KERZEN_MAX[mk]) }
        if (ende !== undefined) params.endTime = ende
        const jung = kerzenAus(await hole(`${basis}/candles`, params), intervalMs)
        /*
         * `candles` reicht je Zeiteinheit nur begrenzt zurück (1D: 90 Kerzen,
         * gemessen 19.10.2026) — eine Anfrage über 92 Tageskerzen kam mit 90
         * zurück, und der Altcoin-Saison-Index meldete „BTC-Kerzen
         * unvollständig". Fehlt etwas, wird der Rest rückwärts über
         * `history-candles` nachgeholt (Fensterweg unten).
         */
        if (jung.length >= limit || !jung.length || !intervalMs) return jung
        start = (ende ?? Date.now()) - (limit + 1) * intervalMs
        nurLetzte = limit
    }

    const alle = new Map()
    let bis = ende ?? Date.now()
    let jung = true
    for (let runde = 0; runde < 400 && bis > start; runde++) {
        const pfad = jung ? 'candles' : 'history-candles'
        const seite = jung ? KERZEN_MAX[mk] : HISTORIE_MAX
        let rows = kerzenAus(await hole(`${basis}/${pfad}`, { ...fest, limit: seite, endTime: bis }), intervalMs)
        if (!rows.length && jung) { jung = false; continue }
        if (!rows.length) break
        for (const k of rows) if (k.t >= start && k.t < (ende ?? Infinity)) alle.set(k.t, k)
        const aeltest = rows[0].t
        if (aeltest >= bis) break
        bis = aeltest
        if (alle.size >= limit) break
    }
    const sortiert = [...alle.values()].sort((a, b) => a.t - b.t)
    return nurLetzte ? sortiert.slice(-nurLetzte) : sortiert
}

async function tickerRoh(m) {
    return markt(m) === 'spot'
        ? hole('/api/v2/spot/market/tickers', {}, { timeout: 15000 })
        : hole('/api/v2/mix/market/tickers', { productType: PRODUKT }, { timeout: 15000 })
}

export async function preis(symbol, { markt: m } = {}) {
    const d = markt(m) === 'spot'
        ? await hole('/api/v2/spot/market/tickers', { symbol })
        : await hole('/api/v2/mix/market/ticker', { symbol, productType: PRODUKT })
    return Number((Array.isArray(d) ? d[0] : d)?.lastPr)
}

export async function preise({ markt: m } = {}) {
    const aus = new Map()
    for (const z of (await tickerRoh(m)) || []) {
        const p = Number(z?.lastPr)
        if (z?.symbol && Number.isFinite(p)) aus.set(z.symbol, p)
    }
    return aus
}

/** Eine Bitget-Tickerzeile → gemeinsame Form. `change24h` ist ein Bruchteil → ×100. */
export function tickerAus(z) {
    return {
        symbol: z.symbol,
        preis: Number(z.lastPr),
        hoch: Number(z.high24h),
        tief: Number(z.low24h),
        eroeffnung: Number(z.open24h ?? z.open),
        aenderungPct: Number(z.change24h) * 100,
        umsatzQuote: Number(z.quoteVolume ?? z.usdtVolume),
        umsatzBasis: Number(z.baseVolume),
        bid: Number(z.bidPr), ask: Number(z.askPr),
        bidMenge: Number(z.bidSz), askMenge: Number(z.askSz),
        funding: z.fundingRate !== undefined ? Number(z.fundingRate) : undefined,
        offenePositionen: z.holdingAmount !== undefined ? Number(z.holdingAmount) : undefined,
    }
}

/** 24h-Ticker aller Symbole in der gemeinsamen Form. */
/*
 * Tokenisierte Wertpapiere und Rohstoffe (Aktien, ETFs, Gold) stehen bei
 * Bitget in derselben Futures-Liste wie die Kryptowährungen — 376 von 842
 * Kontrakten am 19.10.2026, kenntlich an `isRwa: "YES"`. Binance trennt sie
 * über `underlyingType`; ohne Filter standen SOXS und MINIMAX in Funding- und
 * RSI-Kacheln. Die Liste kommt aus `contracts` und wird 6 h gehalten.
 */
let rwaGemerkt = { ts: 0, menge: null }
async function rwaSymbole() {
    if (rwaGemerkt.menge && Date.now() - rwaGemerkt.ts < 6 * 3600e3) return rwaGemerkt.menge
    const d = await hole('/api/v2/mix/market/contracts', { productType: PRODUKT }, { timeout: 15000 })
    const menge = new Set((d || []).filter((c) => c.isRwa === 'YES').map((c) => c.symbol))
    rwaGemerkt = { ts: Date.now(), menge }
    return menge
}

export async function ticker24h({ markt: m } = {}) {
    const zeilen = ((await tickerRoh(m)) || []).map(tickerAus)
    if (markt(m) === 'spot') return zeilen
    let rwa = new Set()
    try { rwa = await rwaSymbole() } catch { /* ohne Liste lieber ungefiltert als gar nichts */ }
    return zeilen.filter((z) => !rwa.has(z.symbol))
}

/** 24h-Ticker EINES Symbols (Watchlist). */
export async function ticker24hEinzeln(symbol, { markt: m } = {}) {
    const d = markt(m) === 'spot'
        ? await hole('/api/v2/spot/market/tickers', { symbol })
        : await hole('/api/v2/mix/market/ticker', { symbol, productType: PRODUKT })
    const z = Array.isArray(d) ? d[0] : d
    if (!z) throw new BitgetFehler(`Bitget kennt ${symbol} nicht`, 400)
    return tickerAus(z)
}

/** Orderbuch-Momentaufnahme. Bitget gibt höchstens 100 (Futures) bzw. 150 (Spot) Stufen. */
export async function orderbuch(symbol, { markt: m, tiefe = 100 } = {}) {
    const d = markt(m) === 'spot'
        ? await hole('/api/v2/spot/market/orderbook', { symbol, type: 'step0', limit: Math.min(tiefe, 150) })
        : await hole('/api/v2/mix/market/merge-depth', { symbol, productType: PRODUKT, limit: tiefe <= 5 ? 5 : tiefe <= 15 ? 15 : tiefe <= 50 ? 50 : 100 })
    const zahl = (l) => (Array.isArray(l) ? l : []).map(([p, q]) => [Number(p), Number(q)])
    return { bids: zahl(d?.bids), asks: zahl(d?.asks), ts: Number(d?.ts) || Date.now() }
}

export async function funding(symbol) {
    const d = await hole('/api/v2/mix/market/current-fund-rate', { symbol, productType: PRODUKT })
    const z = Array.isArray(d) ? d[0] : d
    const rate = Number(z?.fundingRate)
    return Number.isFinite(rate)
        ? { rate, naechste: Number(z?.nextUpdate) || 0, intervallH: Number(z?.fundingRateInterval) || undefined }
        : null
}

/** Abgerechnete Funding-Sätze, älteste zuerst (Bitget blättert seitenweise rückwärts). */
export async function fundingVerlauf(symbol, von, bis) {
    const out = []
    for (let seite = 1; seite <= 20; seite++) {
        const d = await hole('/api/v2/mix/market/history-fund-rate', { symbol, productType: PRODUKT, pageSize: 100, pageNo: seite })
        if (!Array.isArray(d) || !d.length) break
        for (const e of d) {
            const t = Number(e.fundingTime)
            if (t >= von && t <= bis) out.push({ t, rate: Number(e.fundingRate), markPrice: 0 })
        }
        if (Number(d[d.length - 1].fundingTime) < von || d.length < 100) break
    }
    return out.sort((a, b) => a.t - b.t)
}

/** Kontraktregeln in der Form von `getSymbolMeta` (tickSize aus `pricePlace`, nicht geraten). */
export async function symbole({ markt: m } = {}) {
    const map = new Map()
    if (markt(m) === 'spot') {
        for (const s of (await hole('/api/v2/spot/public/symbols', {}, { timeout: 15000 })) || []) {
            if (s.status !== 'online') continue
            map.set(s.symbol, {
                symbol: s.symbol, basis: s.baseCoin, quote: s.quoteCoin,
                tickSize: 10 ** -Number(s.pricePrecision || 0),
                stepSize: 10 ** -Number(s.quantityPrecision || 0),
                minQty: Number(s.minTradeAmount) || 0,
                minNotional: Number(s.minTradeUSDT) || 0,
            })
        }
        return map
    }
    for (const s of (await hole('/api/v2/mix/market/contracts', { productType: PRODUKT }, { timeout: 15000 })) || []) {
        if (s.symbolStatus !== 'normal') continue
        if (s.isRwa === 'YES') continue   // Aktien/Rohstoffe, siehe rwaSymbole
        map.set(s.symbol, {
            symbol: s.symbol, basis: s.baseCoin, quote: s.quoteCoin,
            tickSize: Number(s.priceEndStep || 1) * 10 ** -Number(s.pricePlace || 0),
            stepSize: Number(s.sizeMultiplier) || 10 ** -Number(s.volumePlace || 0),
            minQty: Number(s.minTradeNum) || 0,
            minNotional: Number(s.minTradeUSDT) || 0,
            fundingIntervallH: Number(s.fundInterval) || undefined,
        })
    }
    return map
}
