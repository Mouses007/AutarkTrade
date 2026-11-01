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
 *  - `chartTeilenAn` — Mail-Empfänger des Teilen-Dialogs (der Dialog füllte sie
 *    nach einer neuen Anmeldung vor, Audit SEC-S6-001)
 *  - in `at.chart.zeichenStil` nur der Kontostand des Positionsrechners
 *    (`<werkzeug>.rechner.konto`): der Rest sind Stil-Vorlieben, und die
 *    Rechner-Vorgabe einer neuen Position (`ChartPanel.vue` `oeffneRechner`)
 *    braucht Modus, Betrag und Hebel weiter (Audit SEC-S6-001)
 *
 * Bewusst NICHT gelöscht (Einstellungen dieses Bildschirms, keine Beträge):
 * Layout, Kachelreihenfolge, Filter wie `at.journal.konten` (nur Börsennamen),
 * `ctj.chart.positionenAus` (nur ausgeblendete Positions-IDs), Sprache,
 * Sichtschutz. (Welche Trades schon gemeldet sind, steht seit 29.10.2026 in
 * der Datenbank, nicht mehr hier.)
 */

export const FINANZ_SCHLUESSEL = ['chartKiMarken', 'positionsWarnungWeg', 'chartTeilenAn']
export const FINANZ_PRAEFIXE = ['tpsl_history_']
/** Schlüssel, aus denen nur ein Teil geht: Schlüssel → Funktion (Text → Text oder null = nichts zu tun). */
export const FINANZ_TEILE = { 'at.chart.zeichenStil': ohneKontostand }

/**
 * Gemerkte Zeichenstile ohne Kontostand des Positionsrechners.
 * @param {string} text  JSON `{ <werkzeug>: { …, rechner: { konto, … } } }`
 * @returns {string|null} der bereinigte Text, oder null, wenn kein Kontostand darin stand
 */
export function ohneKontostand(text) {
    let a
    try { a = JSON.parse(text) } catch { return null }
    if (!a || typeof a !== 'object') return null
    let geaendert = false
    for (const stil of Object.values(a)) {
        if (stil?.rechner && typeof stil.rechner === 'object' && 'konto' in stil.rechner) {
            delete stil.rechner.konto
            geaendert = true
        }
    }
    return geaendert ? JSON.stringify(a) : null
}

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
 * @returns {string[]} die gelöschten (bzw. um den Kontostand bereinigten) Schlüssel
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
            } else if (k != null && FINANZ_TEILE[k]) {
                const neu = FINANZ_TEILE[k](speicher.getItem(k))
                if (neu != null) { speicher.setItem(k, neu); weg.push(k) }
            }
        }
    } catch { /* kein Speicher (privater Modus) — dann liegt auch nichts darin */ }
    return weg
}
