/**
 * Wie viel höhere Zeiteinheit eine Strategie sieht — im Backtest und im
 * Betrieb GENAU gleich viel.
 *
 * Bis 01.11.2026 bekam der Backtest die ganze HTF-Historie seines Zeitraums,
 * die Engine dagegen nur `htfEmaPeriod + 20` Kerzen. Eine EMA 50 aus 70
 * Kerzen ist kaum eingeschwungen, und Set and Forget baute seine Wochenebene
 * live aus neun Wochenkerzen (Trend in 240 von 240 Proben „keiner") — das
 * Labor mass also eine andere Strategie als die, die auf Papier lief.
 *
 * Jetzt schneidet jede Strategie ihre HTF-Kerzen selbst auf ein festes
 * Fenster zu, und das Manifest-Feld `htfKerzen(p)` sagt der Engine, wie viele
 * sie holen muss. Dann rechnen beide auf derselben Datenlage.
 */

/** Fenster einer EMA-Trendprüfung: das Sechsfache der Periode ist eingeschwungen (Rest < e⁻¹⁰). */
export function htfFensterEma(periode) {
    return Math.max(300, 6 * (Number(periode) || 50))
}

/** Die letzten `n` HTF-Kerzen — oder alle, wenn es weniger sind. */
export function htfAusschnitt(htfCandles, n) {
    if (!Array.isArray(htfCandles)) return htfCandles
    return htfCandles.length > n ? htfCandles.slice(-n) : htfCandles
}
