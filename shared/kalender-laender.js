/**
 * Vorgabe der Länderauswahl des Wirtschaftskalenders — eine Regel für Server
 * und Browser (bis 10/2026 stand der Server auf `USD,EUR`, die Einstellungs-
 * seite auf `USD,JPY`).
 *
 * Mit Schalter `quellenOhneFreigabe` an liefert ForexFactory wieder Japan —
 * dann `USD,JPY` wie vor S12 (die S15-Migration hat gespeicherte `USD,EUR`
 * einmal so zurückgestellt). Ohne den Schalter gibt es für Japan keine Quelle,
 * für den Euroraum Eurostat: `USD,EUR` (Stand S12, auch die Spaltenvorgabe).
 *
 * Gilt nur, wenn nichts gespeichert ist (null/undefined). Eine gespeicherte
 * leere Liste ist eine Wahl („alle Länder") und bleibt.
 */
export function kalenderLaenderVorgabe(ohneFreigabeAn) {
    return ohneFreigabeAn ? 'USD,JPY' : 'USD,EUR'
}
