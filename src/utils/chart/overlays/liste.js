/**
 * Die Overlays eines Panels — eigene Daten im Chart. Schalter stehen je Panel
 * im Layout (`panel.overlays[id]`); fehlt der Eintrag, gilt `vorgabe`.
 *
 * Journal und offene Positionen sind ab Werk an: deretwegen gibt es diesen
 * Chart. Was Netz oder Rechenzeit kostet, ist ab Werk aus.
 */
// Reihenfolge = Anzeige (Kopfleiste und Handy-Schublade): offene Positionen
// zuoberst, die Strategie-Schicht zuunterst (Wunsch 23.10.2026).
export const OVERLAYS = [
    { id: 'positionen', vorgabe: true },
    { id: 'journal', vorgabe: true },
    // Kosten Abrufe (Orderbuch alle 10 s, Gewicht 10) oder sind ein Modell —
    // deshalb ab Werk aus.
    { id: 'liquidationen', vorgabe: false },
    { id: 'hebelzonen', vorgabe: false },
    { id: 'orderbuch', vorgabe: false },
    // Nur Datenbank, kein Fremdabruf — deshalb ab Werk an.
    // Nur bei Aktien-Futures angeboten (`overlaysFuer`): Quartalszahlen als Marker,
    // die Zeiten ausserhalb der regulären US-Sitzung hinterlegt. Bei Coins gibt es sie nicht.
    { id: 'zahlen', vorgabe: true, nurAktien: true },
    { id: 'sitzungen', vorgabe: true, nurAktien: true },
]

/** Die Overlays, die ein Panel anbietet: die Aktien-Ebenen nur, wenn sein Symbol ein Aktien-Future ist. */
export function overlaysFuer(istAktie) {
    return OVERLAYS.filter((o) => !o.nurAktien || istAktie)
}

export function overlayAn(panel, id) {
    const wert = panel?.overlays?.[id]
    if (wert === true || wert === false) return wert
    return OVERLAYS.find((o) => o.id === id)?.vorgabe ?? false
}
