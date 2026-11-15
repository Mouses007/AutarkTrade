/**
 * Eingabeprüfung der Aktien-Radar-Einstellungen im Browser (rein).
 *
 * Dieselben Regeln wie `zahlAus` in `server/coin-radar/aktien-einstellungen.js`:
 * Komma gilt als Dezimaltrenner, Tausender-Apostrophe und Leerzeichen fallen
 * weg, ein leeres Feld ist KEINE Null. Die Grenzen liefert der Server mit.
 */

/** Text → Zahl oder null. */
export function zahlAus(w) {
    if (typeof w === 'number') return Number.isFinite(w) ? w : null
    if (typeof w !== 'string') return null
    const s = w.trim().replace(/['’\s]/g, '').replace(',', '.')
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null
    return Number(s)
}

/**
 * @param {string|number} eingabe
 * @param {{min?: number, max?: number, ganz?: boolean}} [grenzen]
 * @returns {{wert: number|null, fehler: null|'leer'|'keineZahl'|'bereich'|'ganzzahl'}}
 */
export function pruefeZahl(eingabe, grenzen = {}) {
    if (eingabe === '' || eingabe === null || eingabe === undefined || (typeof eingabe === 'string' && !eingabe.trim())) {
        return { wert: null, fehler: 'leer' }
    }
    const n = zahlAus(eingabe)
    if (n === null) return { wert: null, fehler: 'keineZahl' }
    const g = grenzen || {}
    if ((g.min != null && n < g.min) || (g.max != null && n > g.max)) return { wert: null, fehler: 'bereich' }
    if (g.ganz && !Number.isInteger(n)) return { wert: null, fehler: 'ganzzahl' }
    return { wert: n, fehler: null }
}
