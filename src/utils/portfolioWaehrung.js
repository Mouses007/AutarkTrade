/**
 * Anzeigewährung des Portfolios, reiner Teil (ohne Vue): der Server rechnet
 * in CHF, angezeigt wird in CHF, USD oder EUR. Selbsttest
 * `__selftest-portfolio-waehrung.mjs`.
 */
export const WAEHRUNGEN = ['CHF', 'USD', 'EUR']

/** Gespeicherter Code → einer aus WAEHRUNGEN oder null. */
export function normWaehrung(code) {
    const w = String(code || '').trim().toUpperCase()
    return WAEHRUNGEN.includes(w) ? w : null
}

/**
 * Faktor CHF → Währung; null, wenn dafür kein Kurs da ist (dann bleibt die
 * Anzeige in CHF — nie eine Zahl mit erfundenem Kurs).
 * @param {{chf?: number, eur?: number|null}|null} fx  je 1 USD
 */
export function faktorAusChf(code, fx) {
    if (code === 'CHF') return 1
    const chfJeUsd = Number(fx?.chf)
    if (!(chfJeUsd > 0)) return null
    if (code === 'USD') return 1 / chfJeUsd
    if (code === 'EUR') return Number(fx?.eur) > 0 ? Number(fx.eur) / chfJeUsd : null
    return null
}

/** Wirksame Währung: die Wahl des Geräts, sonst der Standard; ohne Kurs CHF. */
export function wirksameWaehrung(wahl, standard, fx) {
    const w = normWaehrung(wahl) || normWaehrung(standard) || 'CHF'
    return faktorAusChf(w, fx) != null ? w : 'CHF'
}

/** Was der Umschalter anbietet: Standard, CHF, USD — nur mit Kurs. */
export function waehrungsAuswahl(standard, fx) {
    return [...new Set([normWaehrung(standard) || 'CHF', 'CHF', 'USD'])].filter((w) => faktorAusChf(w, fx) != null)
}
