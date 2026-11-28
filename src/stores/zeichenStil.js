/**
 * Zuletzt benutzter Stil je Zeichenwerkzeug (Farbe, Breite, Strich, Zeilen
 * des Volumenprofils …). Eine neue Zeichnung startet damit statt mit den
 * Werksfarben — wer eine Trendlinie einmal gelb und dick gemacht hat, will
 * die nächste nicht wieder umstellen. Im Browser gemerkt, je Werkzeugtyp.
 * Der Text einer Notiz gehört nicht dazu, ebenso wenig Fenster und Skala: Sie
 * sagen, WO eine Zeichnung liegt (Indikator-Fenster, Log-Skala), nicht wie sie
 * aussieht. Gemerkt landete sonst jede neue Trendlinie im RSI-Fenster und blieb
 * im Kerzen-Chart unsichtbar.
 */
const SCHLUESSEL = 'at.chart.zeichenStil'
const NICHT_MERKEN = new Set(['text', 'fenster', 'skala'])

function alle() {
    try { return JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}') || {} } catch { return {} }
}

export function letzterStil(typ) {
    // Alte Einträge (vor dieser Regel gemerkt) können Fenster/Skala noch tragen.
    return Object.fromEntries(Object.entries(alle()[typ] || {}).filter(([k]) => !NICHT_MERKEN.has(k)))
}

export function merkeStil(typ, stil) {
    if (!typ || !stil) return
    const a = alle()
    a[typ] = Object.fromEntries(Object.entries({ ...(a[typ] || {}), ...stil }).filter(([k]) => !NICHT_MERKEN.has(k)))
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(a)) } catch { /* privat */ }
}
