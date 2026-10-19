/**
 * Zwischenstand der Journal-Kette zwischen den Schritten (Modulzustand).
 *
 * - `tageszeilen`: zuletzt geladene Tageszeilen (`ladeTrades`)
 * - `tradeListe`:  flache Liste aller gefilterten Trades in Tagesreihenfolge
 *                  von `journalTage` (L), gebildet von `summiereTrades`
 * - `tagesSummen`: `td` → Tagessumme, dieselben Objekte wie `summenJeTag`
 *
 * `gruppiereTrades` und `berechneGewinnAnalyse` setzen voraus, dass
 * `summiereTrades` vorher lief.
 */
export const kette = {
    tageszeilen: [],
    tradeListe: [],
    tagesSummen: {},
}
