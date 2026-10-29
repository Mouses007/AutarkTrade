/**
 * Beim Abmelden die app-eigenen localStorage-Schlüssel mit Positions- und
 * Kontodaten löschen (Audit SEC-WEB-005).
 *
 * In einem geteilten Browserprofil waren Positionsgrössen und Stop-Verläufe
 * nach dem Abmelden weiter lesbar. Tokens und Schlüssel liegen ohnehin nicht im
 * Browser-Speicher (im Audit geprüft), es geht nur um diese Schlüssel:
 *
 *  - `tpsl_history_<positionId>` — Menge, SL/TP, RRR je Position. Wird seit
 *    FUN-TRD-002 nicht mehr geschrieben (die DB ist die Quelle), alte Einträge
 *    liegen aber noch in jedem Browser
 *  - `chartKiMarken` — Symbol, Intervall und übernommene/verworfene Marken der
 *    KI-Chartanalyse
 *  - `positionsWarnungWeg` — weggeklickte Warnungen, je Position und Art
 *
 * Bewusst NICHT gelöscht (Einstellungen dieses Bildschirms, keine Beträge):
 * Layout, Kachelreihenfolge, Filter wie `at.journal.konten` (nur Börsennamen),
 * `ctj.chart.positionenAus` (nur ausgeblendete Positions-IDs), Sprache,
 * Sichtschutz. (Welche Trades schon gemeldet sind, steht seit 29.10.2026 in
 * der Datenbank, nicht mehr hier.)
 */

export const FINANZ_SCHLUESSEL = ['chartKiMarken', 'positionsWarnungWeg']
export const FINANZ_PRAEFIXE = ['tpsl_history_']

/**
 * Gehört der Schlüssel zu den Finanzdaten, die beim Abmelden gehen?
 * @param {string} k
 */
export function istFinanzSchluessel(k) {
    return FINANZ_SCHLUESSEL.includes(k) || FINANZ_PRAEFIXE.some((p) => String(k).startsWith(p))
}

/**
 * Finanz-Schlüssel aus einem Storage löschen.
 *
 * @param {Storage} [speicher]  Vorgabe `localStorage`; der Selbsttest gibt einen Ersatz
 * @returns {string[]} die gelöschten Schlüssel
 */
export function loescheFinanzdaten(speicher = globalThis.localStorage) {
    const weg = []
    try {
        const alle = []
        for (let i = 0; i < speicher.length; i++) alle.push(speicher.key(i))
        for (const k of alle) {
            if (k != null && istFinanzSchluessel(k)) {
                speicher.removeItem(k)
                weg.push(k)
            }
        }
    } catch { /* kein Speicher (privater Modus) — dann liegt auch nichts darin */ }
    return weg
}
