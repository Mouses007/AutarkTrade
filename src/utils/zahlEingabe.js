/**
 * Zahl aus einem Textfeld lesen — für Felder, die bewusst KEIN `type="number"` sind.
 *
 * Ein Zahlenfeld nimmt je nach Browser-Sprache kein Komma an („0,05" oder
 * „150,5" wird leer), Tausender wie „1'000" ebenso, und das Mausrad bzw. die
 * Pfeiltasten verstellen den Wert nebenbei. Aus einem leeren `value` wurde dann
 * mit `Number(v) || 0` still eine 0 gespeichert (Audit FUN-LIV-001: eine
 * Sitzung ohne Verlustgrenze, eine verschwundene Kontostand-Karte).
 *
 * Darum hier selbst:
 *  - Komma zählt wie Punkt (nur EIN Dezimaltrenner, „1,000.5" ist ungültig)
 *  - Leerzeichen und Tausender-Apostroph (' und ’) fallen weg
 *  - leer → `null` („nicht angegeben"), NIE 0
 *  - alles andere als eine schlichte Dezimalzahl → `NaN` (kein „1e3", kein
 *    „0x10", kein „Infinity" — das tippt niemand absichtlich in ein Geldfeld)
 *
 * Ursprünglich im Positionsrechner (`PositionsRechner.vue`), seit Audit B hier
 * für alle Textfelder mit Zahlen.
 *
 * @param {unknown} text
 * @returns {number|null} Zahl, `null` für leer, `NaN` für ungültig
 */
export function zahlAus(text) {
    const s = String(text ?? '').replace(/[\s'’]/g, '').replace(',', '.')
    if (s === '') return null
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN
    return Number(s)
}

/**
 * Wie `zahlAus`, aber mit einer Aussage, ob der Wert für das Feld taugt.
 *
 * @param {unknown} text
 * @param {{ min?: number, ganz?: boolean, leerErlaubt?: boolean }} [regeln]
 * @returns {{ wert: number|null, ok: boolean }}
 */
export function pruefeZahl(text, { min = -Infinity, ganz = false, leerErlaubt = true } = {}) {
    const wert = zahlAus(text)
    if (wert == null) return { wert: null, ok: leerErlaubt }
    const ok = Number.isFinite(wert) && wert >= min && (!ganz || Number.isInteger(wert))
    return { wert, ok }
}
