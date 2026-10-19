/**
 * Wartungsmargen (Maintenance Margin Rate) je Symbol.
 *
 * Die Liquidationskarte rechnet ihre Zonen aus dieser Rate. Bisher war sie eine
 * einzige, von Hand gepflegte Zahl für ALLE Coins — voreingestellt auf 0,004,
 * die Stufe 1 von BTCUSDT. Das stimmt für acht von rund tausend Binance-
 * Symbolen; der Rest liegt bei 0,01 bis 0,05. Mit der Vorgabe lagen dort alle
 * Zonen um ein Vielfaches zu nah am Kurs.
 *
 * Quelle (S12, Verkaufs-Prüfung Zeile 34/35):
 *
 *  - Bybit veröffentlicht die Risikolimits als reguläre, dokumentierte
 *    v5-API (`/v5/market/risk-limit`, ohne Schlüssel). Urteil gelb (Bybit-
 *    Bedingungen unklar), bleibt.
 *  - Schweigt Bybit oder kennt das Symbol nicht, gilt die feste Vorgabe
 *    `MMR_VORGABE` — und die Antwort sagt das (`quelle: 'vorgabe'`).
 *
 * ENTFERNT 19.10.2026: die Binance-Klammertabelle aus dem undokumentierten
 * Web-Backend (`bapi/futures/…/brackets`). Die Prüfung stuft ihn rot ein
 * (Crawler/Skripte für nicht vorgesehene Informationen verboten). Der
 * dokumentierte `/fapi/v1/leverageBracket` braucht einen Binance-Konto-
 * schlüssel, den das Programm nicht hat — darum kein Ersatz über Binance.
 * Ein alter Stand `binance_brackets` in `api_cache` wird nicht mehr gelesen.
 *
 * Die Werte sind NICHT austauschbar: BTCUSDT stand bei Binance auf 0,004 und
 * steht bei Bybit auf 0,005, 1000PEPEUSDT auf 0,0065 gegen 0,01. Die Karte
 * rechnet mit der Bybit-Stufe 1 — für einen Binance-Chart eine Näherung, die
 * die Oberfläche als Quelle nennt.
 */

import axios from 'axios'
import { logWarn } from './logger.js'

const HTTP_TIMEOUT = 12000
/** Risikolimits ändern sich in Wochen, nicht in Stunden. */
const CACHE_MS = 24 * 60 * 60 * 1000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

const BYBIT_URL = 'https://api.bybit.com/v5/market/risk-limit'

/** Was gilt, wenn Bybit schweigt — die alte, feste Vorgabe (BTCUSDT-Stufe 1 bei Binance). */
export const MMR_VORGABE = 0.004

/**
 * Stufe 1 aus einer Bybit-Risikolimit-Liste ziehen.
 *
 * `isLowestRisk` markiert sie; fehlt die Markierung, gilt die kleinste
 * Obergrenze. Bybit sortiert zwar aufsteigend, aber darauf verlässt sich diese
 * Funktion nicht — ein stillschweigend anders sortierter Tag wäre sonst eine
 * viel zu hohe Rate und damit Zonen weit weg vom Kurs.
 */
export function parseBybitRisikolimit(rohdaten) {
    const liste = rohdaten?.result?.list || []
    if (!liste.length) return null
    const erste = liste.find(s => Number(s.isLowestRisk) === 1)
        || [...liste].sort((a, b) => Number(a.riskLimitValue) - Number(b.riskLimitValue))[0]
    const mmr = Number(erste?.maintenanceMargin)
    if (!(mmr > 0)) return null
    return {
        mmr,
        obergrenze: Number(erste.riskLimitValue) || 0,
        maxHebel: Number(erste.maxLeverage) || 0,
        stufen: liste.length,
    }
}

// ── Bybit: je Symbol ein Abruf ──────────────────────────────────────────
// Die Sammelabfrage blättert in Seiten zu 15 Symbolen — für ein einzelnes
// Symbol wären das bis zu siebzig Anfragen statt einer.
const bybitCache = new Map()  // symbol -> { ts, wert }

async function ausBybit(symbol) {
    const gecacht = bybitCache.get(symbol)
    if (gecacht && (Date.now() - gecacht.ts) < CACHE_MS) {
        return gecacht.wert ? { ...gecacht.wert, quelle: 'bybit', veraltet: false } : null
    }
    try {
        const { data } = await axios.get(BYBIT_URL, {
            params: { category: 'linear', symbol },
            timeout: HTTP_TIMEOUT,
        })
        const wert = parseBybitRisikolimit(data)
        bybitCache.set(symbol, { ts: Date.now(), wert })
        return wert ? { ...wert, quelle: 'bybit', veraltet: false } : null
    } catch (fehler) {
        logWarn('margin-rates', `Bybit-Risikolimit ${symbol} nicht abrufbar: ${fehler.message}`)
        if (gecacht?.wert) return { ...gecacht.wert, quelle: 'bybit', veraltet: true }
        return null
    }
}

/**
 * Rate für ein Symbol besorgen (Bybit-Stufe 1), oder null, wenn Bybit
 * schweigt. `quelle` ist der Wunsch der Oberfläche; der frühere Wunsch
 * 'binance' wird seit S12 von Bybit bedient und als `ersatz` gekennzeichnet —
 * die Karte soll nicht so tun, als käme die Zahl von der Börse, auf die man
 * gerade schaut.
 */
export async function holeMarginRate(symbol, quelle = 'bybit') {
    const gross = String(symbol || '').toUpperCase()
    if (!SYMBOL_RE.test(gross)) return null
    const treffer = await ausBybit(gross)
    if (!treffer) return null
    return { symbol: gross, gewuenscht: quelle, ersatz: quelle !== 'bybit', ...treffer }
}

/**
 * Wartungsmarge in PROZENT für Backtest und Paper-Handel.
 *
 * `override` (aus `risk.maintenanceMarginPct`) schlägt alles: wer bewusst eine
 * Zahl einträgt, bekommt sie. Sonst die echte Stufe-1-Rate (Bybit), und erst
 * wenn Bybit schweigt, die Vorgabe. Vor dem Audit vom 19.08.2026 stand
 * hier pauschal 0,5 % für jedes Symbol — bei einem Alt-Coin mit 1 % liess der
 * Backtest die Position rund 50 % weiter laufen als die Börse.
 *
 * Prozent, nicht Bruch: die Schnittstelle zum Simulator rechnet in Prozent
 * (siehe Einheiten-Kanon in `shared/liquidation.js`).
 */
export async function wartungsmargePctFuer(symbol, override = 0) {
    const eigen = Number(override)
    if (Number.isFinite(eigen) && eigen > 0) return eigen
    try {
        const treffer = await holeMarginRate(symbol)
        if (treffer?.mmr > 0) return treffer.mmr * 100
    } catch (fehler) {
        logWarn('margin-rates', `Wartungsmarge ${symbol} nicht abrufbar: ${fehler.message}`)
    }
    return MMR_VORGABE * 100
}

export function setupMarginRateRoutes(app) {
    /**
     * GET /api/margin-rate
     * Query: symbol (required), quelle ('bybit'; 'binance' = Altwunsch, von Bybit bedient)
     *
     * Antwort: { symbol, mmr, quelle, gewuenscht, ersatz, veraltet,
     *            obergrenze, maxHebel, stufen }
     * `obergrenze` ist das Nominalvolumen, bis zu dem Stufe 1 gilt — darüber
     * steigt die Rate. Die Karte kennt keine Positionsgrössen und rechnet
     * deshalb durchgängig mit Stufe 1; der Wert steht in der Antwort, damit die
     * Oberfläche sagen kann, ab wann die Annahme nicht mehr trägt.
     */
    app.get('/api/margin-rate', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) {
            return res.status(400).json({ error: 'symbol fehlt oder ist ungültig' })
        }
        // 'binance' ist ein gespeicherter Altwunsch (vor S12) — Bybit bedient ihn.
        const quelle = req.query.quelle === 'binance' ? 'binance' : 'bybit'

        const treffer = await holeMarginRate(symbol, quelle)
        res.setHeader('Cache-Control', 'private, max-age=3600')
        if (!treffer) {
            // Statt 404 die Vorgabe MIT Herkunft: sonst bliebe in der Karte
            // still die Rate des vorigen Symbols stehen.
            return res.json({
                symbol, mmr: MMR_VORGABE, quelle: 'vorgabe', gewuenscht: quelle, ersatz: true, veraltet: false,
                obergrenze: 0, maxHebel: 0, stufen: 0,
                hinweis: `Bybit kennt ${symbol} nicht oder antwortet nicht — feste Vorgabe ${MMR_VORGABE}`,
            })
        }
        res.json(treffer)
    })
}
