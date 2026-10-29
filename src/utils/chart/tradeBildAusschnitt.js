/**
 * Ausschnitt des Chartbilds zu einem Trade — rein (Selbsttest:
 * `src/utils/__selftest-trade-bild.mjs`).
 *
 * Bis 28.10.2026 zeigte das Bild die letzten 160 Kerzen und liess die
 * Preisachse automatisch skalieren. Auf 1h waren das knapp sieben Tage, und
 * die Achse reichte bis zu Zonen und VWAP-Linien weit über dem Kurs (SOLUSDT:
 * 97–114 bei einem Trade zwischen 99 und 103) — der Trade war ein Strich am
 * Rand. Jetzt richtet sich der Ausschnitt nach dem EINSTIEG und der
 * Zeiteinheit, und die Preisachse nach den sichtbaren Kerzen und den
 * Marken des Trades (Einstieg, Stop, Ziel).
 */

/*
 * Kerzen VOR dem Einstieg je Zeiteinheit: so viel Vorlauf, dass man die
 * Struktur sieht, aus der der Einstieg kam — kleinere Zeiteinheiten brauchen
 * mehr Kerzen für denselben Zusammenhang, grössere weniger Zeit.
 */
export const VORLAUF = {
    '1m': 90, '3m': 80, '5m': 72, '15m': 64, '30m': 56, '1h': 48, '2h': 48, '4h': 54, '6h': 50, '12h': 50,
    '1d': 60, '3d': 40, '1w': 40, '1M': 24,
}
const VORLAUF_STANDARD = 60
// Platz rechts der letzten Kerze: die Positionsbox reicht ~20 Kerzen weiter, ihre Schilder stehen an der Achse
export const RECHTS = 24
// Höchstens so viele Kerzen NACH dem Einstieg; bei einem lange offenen Trade rückt der Einstieg sonst an den Rand
export const NACHLAUF_MAX = 120
const RAND = 0.08

/**
 * @param {{ zeiten: number[], interval: string, einstiegT?: number|null }} o — Kerzenzeiten (ms, aufsteigend)
 * @returns {{ von: number, bis: number, iE: number }} logischer Bereich für `setVisibleLogicalRange`
 */
export function zeitAusschnitt({ zeiten, interval, einstiegT = null }) {
    const n = zeiten.length
    const letzte = n - 1
    let iE = letzte
    if (Number.isFinite(einstiegT)) {
        iE = 0
        for (let i = 0; i < n; i++) if (zeiten[i] <= einstiegT) iE = i
    }
    const vor = VORLAUF[interval] ?? VORLAUF_STANDARD
    const bisKerze = Math.min(letzte, iE + NACHLAUF_MAX)
    return { von: Math.max(0, iE - vor), bis: bisKerze + RECHTS, iE }
}

/**
 * Preisbereich: Hoch/Tief der sichtbaren Kerzen und die Marken des Trades,
 * mit 8 % Rand. Fernes (Zonen, Monats-VWAP, Liquidationspreis) bestimmt die
 * Achse nicht mehr.
 * @param {{ kerzen: {h:number,l:number}[], von: number, bis: number, marken?: (number|null)[] }} o
 * @returns {{ from: number, to: number } | null}
 */
export function preisAusschnitt({ kerzen, von, bis, marken = [] }) {
    let tief = Infinity, hoch = -Infinity
    for (let i = Math.max(0, Math.floor(von)); i <= Math.min(kerzen.length - 1, Math.floor(bis)); i++) {
        const k = kerzen[i]
        if (k.l < tief) tief = k.l
        if (k.h > hoch) hoch = k.h
    }
    for (const m of marken) {
        if (!(m > 0)) continue
        if (m < tief) tief = m
        if (m > hoch) hoch = m
    }
    if (!Number.isFinite(tief) || !Number.isFinite(hoch) || !(hoch > tief)) return null
    const r = (hoch - tief) * RAND
    return { from: tief - r, to: hoch + r }
}
