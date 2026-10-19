/**
 * Orderbücher anderer Börsen — zum VERGLEICH, nicht zum Zusammenzählen.
 *
 * Warum nicht summieren (gemessen am 07.09.2026, BTCUSDT):
 *
 *   – Die Mittelkurse laufen auseinander: Bybit lag 5,5 USD, OKX 6,4 USD unter
 *     Binance. Unsere Preiszone ist 4 USD breit, dieselbe Wand landete also
 *     ein bis zwei Zonen daneben. Summiert verschmiert sie, statt sich zu
 *     verstärken — und der Abstand wandert mit der Terminprämie.
 *   – Die Snapshot-Reichweiten sind verschieden (Binance ±0,191 %, Bybit
 *     ±0,120 %, OKX ±0,074 %). Eine vollständige Summe gäbe es nur im
 *     kleinsten Schnitt; darüber fielen erst OKX, dann Bybit weg und die Karte
 *     bekäme waagerechte Stufen, die wie Marktstruktur aussehen und reines
 *     API-Limit sind.
 *
 * Deshalb liefert dieses Modul die fremden Bücher SEPARAT.
 *
 * OKX ist seit S12 entfernt (Verkaufs-Prüfung Zeile 38, rot): OKX erlaubt
 * Marktdaten nur „solely for your own personal, non-commercial trading“ und
 * keine API-Dienste als Teil kommerzieller Produkte. Bybit bleibt (Zeile 37,
 * gelb) — die Liste `boersen` hat damit höchstens einen Eintrag. Die Karte bleibt
 * Binance; die Leiter zeigt daneben, ob eine Wand auch anderswo steht. Verglichen
 * wird auf ABSOLUTEN Preisen — eine Order bei 79180 liegt bei 79180, egal auf
 * welcher Börse, und Arbitrage verbindet die Bücher genau dort.
 */
import axios from 'axios'
import { logWarn } from './logger.js'

const CACHE_MS = 5000
const TIMEOUT = 6000
/** Nur der Ausschnitt um den Mid, den die Karte überhaupt zeigen kann. */
const BAND_PCT = 1.0

const cache = new Map()     // symbol → { zeit, daten }
const laeuft = new Map()    // symbol → Promise (Doppelabrufe bündeln)
const imBand = (stufen, mid) => {
    const spanne = mid * (BAND_PCT / 100)
    return stufen.filter(([p]) => Math.abs(p - mid) <= spanne)
}

async function holeBybit(symbol, midRef) {
    const { data } = await axios.get('https://api.bybit.com/v5/market/orderbook', {
        params: { category: 'linear', symbol, limit: 500 }, timeout: TIMEOUT,
    })
    const r = data?.result
    if (!r?.b?.length || !r?.a?.length) return null
    const bids = r.b.map(([p, q]) => [+p, +q])
    const asks = r.a.map(([p, q]) => [+p, +q])
    const mid = (bids[0][0] + asks[0][0]) / 2
    return {
        name: 'Bybit', mid,
        bids: imBand(bids, midRef), asks: imBand(asks, midRef),
        reichweite: { lo: Math.min(...bids.map(([p]) => p)), hi: Math.max(...asks.map(([p]) => p)) },
    }
}

/**
 * @param {string} symbol   Binance-Schreibweise, z.B. BTCUSDT
 * @param {number} midRef   Mittelkurs von Binance — Bezug fürs Band
 */
export async function holeFremdbuecher(symbol, midRef) {
    const key = `${symbol}|${Math.round(midRef)}`
    const treffer = cache.get(symbol)
    if (treffer && Date.now() - treffer.zeit < CACHE_MS) return treffer.daten
    if (laeuft.has(symbol)) return laeuft.get(symbol)

    const p = (async () => {
        // Einzeln abgesichert: fällt eine Börse aus, fehlt sie, der Rest bleibt.
        const ergebnisse = await Promise.allSettled([
            holeBybit(symbol, midRef),
        ])
        const boersen = []
        for (const e of ergebnisse) {
            if (e.status === 'fulfilled' && e.value) boersen.push(e.value)
            else if (e.status === 'rejected') logWarn('fremdbuch', symbol, e.reason?.message || e.reason)
        }
        const daten = { symbol, stand: Date.now(), boersen }
        cache.set(symbol, { zeit: Date.now(), daten })
        return daten
    })().finally(() => laeuft.delete(symbol))

    laeuft.set(symbol, p)
    return p
}

export function setupFremdbuchRoute(app) {
    app.get('/api/live/fremdbuch', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        const mid = Number(req.query.mid)
        if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !(mid > 0)) {
            return res.status(400).json({ error: 'symbol und mid nötig' })
        }
        // Fremdbücher gibt es hier nur für USDT-Perpetuals; Spot hat andere
        // Endpunkte und eine andere Frage („wo kann ich kaufen" statt „wo
        // liegt Widerstand"), das wäre eine eigene Ansicht.
        if (String(req.query.market || 'futures') !== 'futures') {
            return res.json({ symbol, stand: Date.now(), boersen: [] })
        }
        try {
            res.json(await holeFremdbuecher(symbol, mid))
        } catch (e) {
            logWarn('fremdbuch', 'Abruf fehlgeschlagen', e?.message)
            res.json({ symbol, stand: Date.now(), boersen: [], fehler: e?.message })
        }
    })
}
