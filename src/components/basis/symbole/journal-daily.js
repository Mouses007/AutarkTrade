/**
 * Zusätzliche Symbole der Journal-Ansichten (S8, Gruppe daily).
 * Gleiche Regeln wie in `Symbol.vue`: 24er-Raster, nur Striche, selbst gezeichnet.
 */
const kreis = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const SYMBOLE_DAILY = {
    // Teilen: drei Knoten, zwei Verbindungen (Share-Karte)
    teilen: [kreis(17.5, 5.5, 2.5), kreis(6.5, 12, 2.5), kreis(17.5, 18.5, 2.5), 'M8.7 10.7l6.6-3.9', 'M8.7 13.3l6.6 3.9'],
}
