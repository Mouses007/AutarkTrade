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
    // `nurKrypto`: bei einem Aktien-Future nicht angeboten und nicht gezeichnet. Die
    // Liquidations-Aufzeichnung führt nur Coins, und geschätzte Hebelzonen sagen bei
    // Aktien nichts (`docs/RECHERCHE-AKTIEN.md`) — Aktien sind keine umetikettierten Coins.
    { id: 'liquidationen', vorgabe: false, nurKrypto: true },
    { id: 'hebelzonen', vorgabe: false, nurKrypto: true },
    { id: 'orderbuch', vorgabe: false },
    // Nur Datenbank, kein Fremdabruf — deshalb ab Werk an.
    // Nur bei Aktien-Futures angeboten (`overlaysFuer`): Quartalszahlen als Marker,
    // die Zeiten ausserhalb der regulären US-Sitzung hinterlegt. Bei Coins gibt es sie nicht.
    { id: 'zahlen', vorgabe: true, nurAktien: true },
    { id: 'sitzungen', vorgabe: true, nurAktien: true },
]

/** Die Overlays, die ein Panel anbietet: die Aktien-Ebenen nur bei einem Aktien-Future, die Krypto-Ebenen nur bei einem Coin. */
export function overlaysFuer(istAktie) {
    return OVERLAYS.filter((o) => (istAktie ? !o.nurKrypto : !o.nurAktien))
}

/** Gilt dieses Overlay nur für Coins? Ein gespeichertes «an» zählt dann bei einem Aktien-Future nicht. */
export function istNurKrypto(id) {
    return OVERLAYS.find((o) => o.id === id)?.nurKrypto === true
}

export function overlayAn(panel, id) {
    const wert = panel?.overlays?.[id]
    if (wert === true || wert === false) return wert
    return OVERLAYS.find((o) => o.id === id)?.vorgabe ?? false
}
