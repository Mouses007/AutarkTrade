/**
 * Die Overlays eines Panels — eigene Daten im Chart. Schalter stehen je Panel
 * im Layout (`panel.overlays[id]`); fehlt der Eintrag, gilt `vorgabe`.
 *
 * Journal und offene Positionen sind ab Werk an: deretwegen gibt es diesen
 * Chart. Was Netz oder Rechenzeit kostet, ist ab Werk aus.
 */
export const OVERLAYS = [
    { id: 'journal', vorgabe: true },
    { id: 'positionen', vorgabe: true },
    // Nur Datenbank, kein Fremdabruf — deshalb ebenfalls ab Werk an.
    { id: 'strategie', vorgabe: true },
    // Kosten Abrufe (Orderbuch alle 10 s, Gewicht 10) oder sind ein Modell —
    // deshalb ab Werk aus.
    { id: 'liquidationen', vorgabe: false },
    { id: 'hebelzonen', vorgabe: false },
    { id: 'orderbuch', vorgabe: false },
]

export function overlayAn(panel, id) {
    const wert = panel?.overlays?.[id]
    if (wert === true || wert === false) return wert
    return OVERLAYS.find((o) => o.id === id)?.vorgabe ?? false
}
