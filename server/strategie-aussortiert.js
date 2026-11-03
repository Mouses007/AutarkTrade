/**
 * Aussortierte Signale: was ein Detector gesehen und schon am Filter
 * verworfen hat, BEVOR daraus ein Setup wurde (Gegentrend, Wochenende,
 * zu schwacher Docht …).
 *
 * Bis 03.11.2026 landeten diese Fälle nur in `diagnostics.rejections` von
 * `detect()` — der Backtest zählte sie, die Engine warf sie weg. Eine
 * Instanz, deren Signale alle am Tagestrend scheiterten (#24/#25/#30, drei
 * Tage im fallenden Markt), zeigte darum „keine Setups" und sah aus wie eine
 * stehende Engine.
 *
 * Rein — keine Datenbank, kein Netz (Selbsttest `__selftest-aussortiert.mjs`).
 */

/** So lange bleiben aussortierte Signale liegen (nach ihrer Kerze). */
export const AUFBEWAHRUNG_TAGE = 180

/**
 * `diagnostics.rejections` → Zeilen für `strategy_aussortiert`.
 *
 * - Ein Schlüssel (`richtung|kerzenzeit`) zählt einmal, mit dem ersten Grund —
 *   wie im Backtest (`gezaehlteAblehnungen`).
 * - Schlüssel, zu denen ein Setup existiert, fallen weg: Set and Forget meldet
 *   auch Ablehnungen bestehender Setups, und die stehen schon am Setup selbst.
 * - Signale, deren Kerze vor dem Start der Instanz schloss, fallen weg: das
 *   Suchfenster des ersten Takts reicht in die Zeit davor, und diese Signale
 *   hat die Instanz nie „live" gesehen.
 *
 * @param {Array<{reason: string, key: string}>} rejections
 * @param {object} o
 * @param {number} o.instanceId
 * @param {string} o.symbol
 * @param {string} o.timeframe
 * @param {number} [o.paramsVersion]
 * @param {number} [o.abT]      Start der Instanz (ms); 0 = alles
 * @param {number} [o.tfMs]     Kerzenlänge, für den Schluss der Signalkerze
 * @param {Iterable<string>} [o.setupSchluessel]  bekannte `richtung|zeit` der Setups
 */
export function aussortierteZeilen(rejections, {
    instanceId, symbol, timeframe, paramsVersion = 1, abT = 0, tfMs = 0, setupSchluessel = [],
} = {}) {
    const setups = new Set(setupSchluessel)
    const je = new Map()
    for (const r of rejections || []) {
        const teile = String(r?.key ?? '').split('|')
        if (teile.length !== 2) continue
        const [richtung, zeitText] = teile
        const zeit = Number(zeitText)
        if (richtung !== 'long' && richtung !== 'short') continue
        if (!Number.isFinite(zeit) || zeit <= 0) continue
        if (!r.reason) continue
        const schluessel = `${richtung}|${zeit}`
        if (setups.has(schluessel) || je.has(schluessel)) continue
        if (abT > 0 && zeit + (tfMs > 0 ? tfMs : 0) < abT) continue
        je.set(schluessel, {
            instanceId,
            symbol,
            timeframe,
            direction: richtung,
            candleTime: zeit,
            grund: String(r.reason).slice(0, 80),
            paramsVersion,
        })
    }
    return [...je.values()]
}
