/**
 * Text für HTML-Zeichenketten (ECharts-Tooltips u. ä.) unschädlich machen.
 *
 * Seit F2 (Audit A2-17/A2-18): Coin-Namen von CoinGecko und Tag-/Timeframe-
 * Namen gingen ungefiltert in Tooltip-HTML. Mit einem fremden Backup (Tags)
 * oder einem Coin mit HTML im Namen lief dort Script im App-Ursprung.
 * Absichtlich ohne Abhängigkeit: läuft auch im Golden Master ohne DOM.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
