/**
 * Lade-Haken für den Engine-Selbsttest (`__selftest-engine-takt.mjs`) und den
 * Vorrats-Selbsttest der Robustheit (`__selftest-robustheit-vorrat.mjs`).
 *
 * Die Strategie-Engine holt Kerzen und Kontraktdaten über `market-data.js` —
 * also übers Netz. Dieser Haken ersetzt genau dieses eine Modul durch eine
 * Attrappe, die alles Echte weiterreicht und nur `getClosedCandles`,
 * `getSymbolMeta` und `getLastPrice` aus `globalThis.__engineMarkt` bedient —
 * dazu `getHistoricalCandles` und `getFundingHistory`, aber nur, wenn
 * `__engineMarkt.historie` bzw. `.funding` gesetzt ist (sonst die echten).
 * Engine, Risk-Engine, Papierbuchung und Datenbank bleiben echt.
 *
 * Keine `__selftest`-Datei, damit der Läufer sie nicht als Test startet.
 */

const ECHT = new URL('./market-data.js', import.meta.url).href
const ATTRAPPE = 'attrappe:marktdaten'

const QUELLE = `
export * from '${ECHT}?echt'
import * as echt from '${ECHT}?echt'
export async function getHistoricalCandles(...a) {
    const m = globalThis.__engineMarkt
    return m?.historie ? m.historie(...a) : echt.getHistoricalCandles(...a)
}
export async function getFundingHistory(...a) {
    const m = globalThis.__engineMarkt
    return m?.funding ? m.funding(...a) : echt.getFundingHistory(...a)
}
export async function getClosedCandles(symbol, tf, limit = 300, opts = {}) {
    return globalThis.__engineMarkt.kerzen(symbol, tf, limit, opts)
}
export async function getSymbolMeta() { return globalThis.__engineMarkt.meta ?? null }
export async function getLastPrice() { return globalThis.__engineMarkt.preis ?? 0 }
`

export async function resolve(spec, ctx, next) {
    if (ctx.parentURL === ATTRAPPE) return next(spec, { ...ctx, parentURL: ECHT })
    const r = await next(spec, ctx)
    if (r.url === ECHT) return { url: ATTRAPPE, shortCircuit: true }
    return r
}

export async function load(url, ctx, next) {
    if (url === ATTRAPPE) return { format: 'module', source: QUELLE, shortCircuit: true }
    return next(url, ctx)
}
