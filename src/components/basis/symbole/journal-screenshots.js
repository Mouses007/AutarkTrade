/**
 * Zusätzliche Symbole der Journal-Ansichten (S8, Gruppe screenshots).
 * Gleiche Regeln wie in `Symbol.vue`: 24er-Raster, nur Striche, selbst gezeichnet.
 * Präfix `mk` = Werkzeugleiste der Bildmarkierung.
 */
export const SYMBOLE_SCREENSHOTS = {
    // Auswahlpfeil (Mauszeiger)
    mkAuswahl: ['M6 3.5v15l4-4 3 6.5 2.5-1.2-3-6.3H18z'],
    // Schräger Pfeil mit Spitze oben rechts
    mkPfeil: ['M5 19 19 5', 'M10 5h9v9'],
    // Schräge Linie mit Endpunkten
    mkLinie: ['M6 18 18 6', 'M4.5 19.5h.1M19.5 4.5h.1'],
    // Freihand-Schwung
    mkFreihand: ['M3.5 16c2.5-5 4.5-8 6.5-8s1 6 3 6 3-7 5.5-7c1.2 0 2 1 2 2.5'],
    // Rückgängig / Wiederholen
    mkRueckgaengig: ['M9 5 4.5 9.5 9 14', 'M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3'],
    mkWiederholen: ['M15 5l4.5 4.5L15 14', 'M19.5 9.5H9a4.5 4.5 0 0 0 0 9h3'],
}
