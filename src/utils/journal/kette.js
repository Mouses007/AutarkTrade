/**
 * Zwischenstand der Journal-Kette zwischen den Schritten (Modulzustand).
 *
 * - `tageszeilen`: zuletzt geladene Tageszeilen (`useGetTrades`)
 * - `tradeListe`:  flache Liste aller gefilterten Trades in Tagesreihenfolge
 *                  von `filteredTrades` (L), gebildet von `useTotalTrades`
 * - `tagesSummen`: `td` → Tagessumme, dieselben Objekte wie `totalsByDate`
 *
 * `useGroupTrades` und `useCalculateProfitAnalysis` setzen voraus, dass
 * `useTotalTrades` vorher lief.
 */
export const kette = {
    tageszeilen: [],
    tradeListe: [],
    tagesSummen: {},
}
