/**
 * Marktdaten für die Strategie-Engine.
 *
 * Zentrale Zusage dieses Moduls: **es gibt nur geschlossene Kerzen zurück.**
 * Die laufende Kerze wird immer verworfen. Ohne diese Regel würde ein Detector
 * auf einer Kerze anschlagen, die sich danach noch ändert (Repainting) — die
 * Signale wären weder reproduzierbar noch backtestbar.
 *
 * Zweite Zusage: Provider-Abstraktion. Der Detector kennt nur `getClosedCandles`;
 * woher die Kerzen kommen, entscheidet die Marktdatenquelle des Kunden
 * (`server/marktdaten/index.js`, Einstellung `marktdatenQuelle`): Binance oder
 * Bitget, bei `aus` wirft jeder Abruf `MarktdatenAus`.
 *
 * ACHTUNG Backtests: Die bisherigen Freigaben (Robustheit, Live-Gates) beruhen
 * auf Binance-Historie. Bitget reicht je nach Zeiteinheit deutlich weniger weit
 * zurück (`history-candles`, 200 je Seite; BTC 1D bis 2020, kleine Coins und
 * kurze Zeiteinheiten weniger) und kennt kein 8h — ein Backtest über Bitget ist
 * ein anderer Datensatz, keine Wiederholung. `getHistoricalCandles` meldet es,
 * wenn die Historie später beginnt als verlangt.
 *
 * Die Gewichtsbremse (`binance-takt.js`) gilt nur für Binance: sie rechnet in
 * Binance-Gewicht und liest Binance-Antwortköpfe.
 *
 * Kerzenformat (Zahlen, nicht Strings wie bei Binance):
 *   { t, o, h, l, c, v, closeTime }
 */

import { logWarn } from './logger.js'
import { warteAufGewicht, istWiederholbar, WIEDERHOLUNGEN } from './binance-takt.js'
import * as marktdaten from './marktdaten/index.js'

/** Von Binance unterstützte Intervalle → Länge in Millisekunden. */
export const TIMEFRAME_MS = {
    '1m': 60000,
    '3m': 180000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '2h': 7200000,
    '4h': 14400000,
    '6h': 21600000,
    '8h': 28800000,
    '12h': 43200000,
    '1d': 86400000,
    '3d': 259200000,
    '1w': 604800000,
}

export function timeframeMs(tf) {
    return TIMEFRAME_MS[tf] || 0
}

export function isValidTimeframe(tf) {
    return Boolean(TIMEFRAME_MS[tf])
}

/**
 * Beginn der aktuell laufenden Kerze. Alles davor ist abgeschlossen.
 * (Gilt für alle Intervalle bis 1d, weil Binance-Buckets auf UTC-Epoch rasten.)
 */
export function currentCandleOpen(tf, now = Date.now()) {
    const ms = timeframeMs(tf)
    if (!ms) return 0
    // Binance-Wochenkerzen beginnen Montag 00:00 UTC. Der Unix-Epoch war ein
    // DONNERSTAG — ohne Versatz gälte die laufende Wochenkerze ab Donnerstag
    // als geschlossen, und Wochenregeln handelten auf einem repaintenden Wert.
    if (tf === '1w') {
        const MONTAG = 345600000   // Mo, 5. Jan 1970 00:00 UTC
        return Math.floor((now - MONTAG) / ms) * ms + MONTAG
    }
    return Math.floor(now / ms) * ms
}

// ── Cache ────────────────────────────────────────────────────────────────
// Ein Eintrag je symbol|market|interval. Die TTL ist bewusst an die
// Kerzenlänge gekoppelt: innerhalb einer laufenden Kerze kann sich am Satz
// geschlossener Kerzen nichts ändern, also ist ein erneuter Abruf sinnlos.
const cache = new Map()      // key -> { candles, fetchedAt, lastOpen }
const inFlight = new Map()   // key -> Promise (Dedup paralleler Abrufe)

// Die Wahl gehört in den Schlüssel: nach einem Wechsel der Marktdatenquelle
// darf der Cache keine Kerzen der alten Börse weiterreichen.
const cacheKey = (symbol, interval, market, quelle) => `${quelle}|${symbol}|${market}|${interval}`

/**
 * Ein Kerzenabruf beim gewählten Anbieter. Binance zählt sein Gewicht in
 * `marktdaten/binance.js` selbst an der Bremse mit (auch die Abrufe des
 * Livebetriebs zahlen auf die IP ein — ohne Notiz kennte die Bremse nur ihren
 * eigenen Anteil) und meldet 429/418 dorthin.
 */
async function fetchKlines({ symbol, interval, market, limit, startTime, endTime }) {
    const a = await marktdaten.fordere('kerzen', { markt: market })
    const opts = { markt: market, limit: Math.min(limit, a.KERZEN_MAX[market]), intervalMs: timeframeMs(interval) }
    if (startTime !== undefined && endTime !== undefined) {
        opts.start = startTime
        opts.ende = endTime
    }
    return a.kerzen(symbol, interval, opts)
}

/**
 * Prüft, ob die Kerzenreihe lückenlos ist. Lücken entstehen bei Börsen-
 * Ausfällen oder illiquiden Symbolen und würden Swing-/Sweep-Erkennung
 * verfälschen (zwei Kerzen wären dann nicht mehr benachbart).
 *
 * @returns {{ ok: boolean, gaps: Array<{after: number, missing: number}> }}
 */
export function checkGaps(candles, interval) {
    const step = timeframeMs(interval)
    const gaps = []
    if (!step || candles.length < 2) return { ok: true, gaps }
    for (let i = 1; i < candles.length; i++) {
        const delta = candles[i].t - candles[i - 1].t
        if (delta > step) {
            gaps.push({ after: candles[i - 1].t, missing: Math.round(delta / step) - 1 })
        }
    }
    return { ok: gaps.length === 0, gaps }
}

/**
 * Geschlossene Kerzen, jüngste zuletzt.
 *
 * @param {string} symbol    z.B. 'BTCUSDT'
 * @param {string} interval  z.B. '15m'
 * @param {number} limit     gewünschte Anzahl geschlossener Kerzen
 * @param {object} [opts]    { market='futures', force=false, now=Date.now() }
 * @returns {Promise<Array<{t,o,h,l,c,v,closeTime}>>}
 */
export async function getClosedCandles(symbol, interval, limit = 300, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    if (!sym) throw new Error('getClosedCandles: symbol fehlt')
    if (!isValidTimeframe(interval)) throw new Error(`getClosedCandles: unbekanntes Intervall ${interval}`)

    const now = opts.now || Date.now()
    const openOfRunning = currentCandleOpen(interval, now)
    // `fordere` vor dem Cache: mit `aus` darf auch ein warmer Cache nichts
    // mehr ausliefern, sonst lebte eine abgeschaltete Quelle stundenlang weiter.
    const anbieter = await marktdaten.fordere('kerzen', { markt: market })
    const key = cacheKey(sym, interval, market, anbieter.id)

    const cached = cache.get(key)
    if (!opts.force && cached && cached.lastOpen === openOfRunning && cached.candles.length >= limit) {
        return cached.candles.slice(-limit)
    }

    // Paralleler Abruf desselben Schlüssels wird zusammengelegt — bei mehreren
    // Instanzen auf demselben Symbol sonst n identische Requests pro Takt.
    if (inFlight.has(key)) {
        const shared = await inFlight.get(key)
        return shared.slice(-limit)
    }

    // +1, weil die laufende Kerze mitkommt und gleich wieder wegfällt
    const promise = (async () => {
        const rows = await fetchKlines({
            symbol: sym, interval, market,
            limit: Math.min(limit + 1, anbieter.KERZEN_MAX[market]),
        })
        const closed = rows.filter((k) => k.t < openOfRunning)
        cache.set(key, { candles: closed, fetchedAt: now, lastOpen: openOfRunning })

        const { ok, gaps } = checkGaps(closed, interval)
        if (!ok) {
            logWarn('market-data', `${sym} ${interval}: ${gaps.length} Lücke(n) in den Kerzen`)
        }
        return closed
    })()

    inFlight.set(key, promise)
    try {
        const closed = await promise
        return closed.slice(-limit)
    } finally {
        inFlight.delete(key)
    }
}

/**
 * Einen Historienabruf wiederholen, wenn es sich lohnt.
 *
 * Ein Zeitüberschritt oder ein 5xx ist vorübergehend — beim nächsten Versuch
 * klappt es meistens. Ein 400 („Invalid symbol") dagegen ist endgültig, und ihn
 * dreimal zu erfragen hält nur die 99 anderen Coins auf.
 *
 * Ohne diese Schleife schrieb ein einziger 10-Sekunden-Zeitüberschritt einen
 * Coin als Fehlerzeile ab (gesehen bei ONDOUSDT am 16.08.2026) — obwohl der
 * Abruf eine Sekunde später fehlerfrei durchlief.
 */
async function mitWiederholung(abruf, was, bremse = true) {
    let letzter
    for (let versuch = 0; versuch <= WIEDERHOLUNGEN.length; versuch++) {
        try {
            return await abruf()
        } catch (e) {
            letzter = e
            const status = e?.response?.status
            if (!istWiederholbar(status) || versuch === WIEDERHOLUNGEN.length) throw e
            const pause = WIEDERHOLUNGEN[versuch]
            logWarn('market-data', `${was}: ${e.message} — Versuch ${versuch + 2} in ${pause / 1000}s`)
            await new Promise((f) => setTimeout(f, pause))
            // Nach der Pause erneut anstehen: die Bremse könnte inzwischen
            // wegen einer Strafe zugemacht haben (nur Binance, siehe oben).
            if (bremse) await warteAufGewicht()
        }
    }
    throw letzter
}

/** Einmal je Symbol/Zeiteinheit/Quelle melden, dass die Historie kürzer ist als verlangt. */
const kurzGemeldet = new Set()

/**
 * Historische geschlossene Kerzen über ein Zeitfenster — für den Backtest.
 * Paginiert automatisch über das Seitenlimit des Anbieters hinaus.
 *
 * Binance blättert VORWÄRTS ab `startTime` (gebremst über `binance-takt.js`),
 * Bitget nur RÜCKWÄRTS vor `endTime` — `marktdaten/bitget.js` blättert das
 * ganze Fenster selbst und bekommt hier einen einzigen Aufruf. Bitgets
 * `history-candles` reicht weniger weit zurück als Binance; beginnt die Reihe
 * später als `fromTs`, steht das einmal im Log. Backtest-Freigaben, die auf
 * Binance-Historie beruhen, gelten für eine Bitget-Reihe nicht ungeprüft.
 *
 * @returns {Promise<Array>} lückenlos aufsteigend sortiert, ohne laufende Kerze
 */
export async function getHistoricalCandles(symbol, interval, fromTs, toTs, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    if (!isValidTimeframe(interval)) throw new Error(`getHistoricalCandles: unbekanntes Intervall ${interval}`)

    const step = timeframeMs(interval)
    const now = opts.now || Date.now()
    const end = Math.min(Number(toTs) || now, currentCandleOpen(interval, now))
    let cursor = Number(fromTs) || 0
    if (!cursor || cursor >= end) return []

    const anbieter = await marktdaten.fordere('kerzen', { markt: market })
    const maxCandles = Math.min(opts.maxCandles || 20000, 200000)
    if (anbieter.id !== 'binance') {
        const rows = await mitWiederholung(() => anbieter.kerzen(sym, interval, {
            markt: market, start: cursor, ende: end, limit: maxCandles, intervalMs: step,
        }), `${sym} ${interval}`, false)
        const out = rows.filter((k) => k.t >= cursor && k.t < end).slice(0, maxCandles)
        const merk = `${anbieter.id}|${sym}|${market}|${interval}`
        if ((!out.length || out[0].t > cursor + step) && !kurzGemeldet.has(merk)) {
            kurzGemeldet.add(merk)
            logWarn('market-data', `${sym} ${interval}: ${anbieter.name} liefert Historie erst ab `
                + `${out.length ? new Date(out[0].t).toISOString() : '—'} (verlangt ${new Date(cursor).toISOString()}) — `
                + 'Backtest-Freigaben beruhen auf Binance-Historie und gelten für diese Reihe nicht ungeprüft')
        }
        return out
    }

    /*
     * Wer nur ein paar Dutzend Kerzen braucht, fragt kleine Seiten an: Binance
     * staffelt das Gewicht nach dem angefragten `limit`, nicht nach der Zahl
     * der gelieferten Kerzen — sechzig Minutenkerzen über eine 1500er-Seite
     * kosten zehn Einheiten statt einer.
     */
    const pageSize = Math.max(1, Math.min(anbieter.KERZEN_MAX[market], Number(opts.seite) || anbieter.KERZEN_MAX[market]))
    const gewicht = anbieter.seitenGewicht(market, pageSize)
    const out = []
    let guard = 0

    while (cursor < end && out.length < maxCandles) {
        if (++guard > 500) break   // Sicherheitsnetz gegen Endlosschleifen
        // NUR hier wird gewartet: Historie ist Laborarbeit und darf sich
        // gedulden. `getClosedCandles` — der Weg des Livebetriebs — bleibt
        // ungebremst und überholt jederzeit.
        await warteAufGewicht(gewicht)
        const rows = await mitWiederholung(() => fetchKlines({
            symbol: sym, interval, market,
            limit: pageSize, startTime: cursor, endTime: end,
        }), `${sym} ${interval}`)
        if (!rows.length) break

        for (const k of rows) {
            if (k.t >= end) break                       // laufende Kerze raus
            if (out.length && k.t <= out[out.length - 1].t) continue  // Überlappung
            out.push(k)
        }

        const last = rows[rows.length - 1].t
        if (last <= cursor) break
        cursor = last + step
    }

    return out
}

/**
 * Letzter gehandelter Preis. Für Paper-Trading und für den Abgleich zwischen
 * Signalquelle und Handelsbörse.
 */
export async function getLastPrice(symbol, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    return marktdaten.preis(String(symbol || '').toUpperCase(), { markt: market })
}

/**
 * Aktuelle Funding-Rate (nur Futures) — Eingabe für den Sentiment-Agenten.
 * Gibt null zurück statt zu werfen: fehlendes Sentiment darf keinen Lauf killen.
 * Ohne Funding-Fähigkeit (Marktdaten aus) still null — das ist ein Zustand,
 * kein Fehler, und stünde sonst bei jedem Lauf im Log.
 */
export async function getFundingRate(symbol) {
    try {
        const f = await marktdaten.funding(String(symbol || '').toUpperCase())
        return f ? { rate: f.rate, nextFundingTime: f.naechste || 0 } : null
    } catch (e) {
        if (!marktdaten.istAus(e)) logWarn('market-data', `Funding-Rate für ${symbol} nicht abrufbar: ${e.message}`)
        return null
    }
}

/**
 * Abgerechnete Funding-Sätze eines Zeitraums (nur Futures), älteste zuerst.
 * `markPrice` ist der Kurs, zu dem die Börse die Zahlung bemessen hat (Bitget
 * liefert keinen → 0, der Aufrufer nimmt dann den Kerzenkurs).
 * Wirft bei Fehlern — ein fehlender Verlauf darf nicht als „0 Funding" enden.
 */
export async function getFundingHistory(symbol, fromTs, toTs) {
    return marktdaten.fundingVerlauf(String(symbol || '').toUpperCase(), Number(fromTs) || 0, Number(toTs) || Date.now())
}

// ── Symbol-Metadaten (tickSize/stepSize) für korrektes Runden von Orders ──
const metaCache = new Map()   // quelle|market -> { ts, map }
const META_TTL = 6 * 60 * 60 * 1000

export async function getSymbolMeta(symbol, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    const anbieter = await marktdaten.fordere('symbole', { markt: market })
    const key = `${anbieter.id}|${market}`

    const cached = metaCache.get(key)
    if (!cached || (Date.now() - cached.ts) > META_TTL) {
        const roh = await anbieter.symbole({ markt: market })
        // Nur die Felder, die `computePositionSize` liest — wie bisher.
        const map = new Map()
        for (const [s, m] of roh) {
            map.set(s, { symbol: s, tickSize: m.tickSize, stepSize: m.stepSize, minQty: m.minQty, minNotional: m.minNotional })
        }
        metaCache.set(key, { ts: Date.now(), map })
    }

    return metaCache.get(key).map.get(sym) || null
}
