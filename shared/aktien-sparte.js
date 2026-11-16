/**
 * Sparte einer Aktie (Sektor und Branche) — der Filter, rein und ohne Netz.
 *
 * Die Angabe kommt von der Kursquelle (Yahoo `assetProfile`: `sector` und
 * `industry`) und steht im Titel-Stamm (`instrumente.sektor` / `.branche`).
 * Der Server liefert sie je Zeile als `sparte: {sektor, branche}` oder `null`.
 * `null` heisst UNBEKANNT — nie geraten: kein Kurssymbol, die Quelle nennt
 * keine Sparte (ETF), oder der Name der Quelle passt nicht zum Namen im Stamm
 * (`server/aktien/sparte-kern.js`).
 *
 * «KI» ist keine Branche der Quelle: solche Firmen stehen im Sektor
 * `Technology` (Branchen `Semiconductors`, `Software - Infrastructure` …).
 * Eine eigene Themenliste gibt es bewusst nicht (Entscheid 16.11.2026).
 */

/** Die elf Sektoren der Quelle → Schlüssel der Übersetzung (`sparte.sektor_<schluessel>`). */
export const SEKTOR_SCHLUESSEL = {
    'Technology': 'technologie',
    'Communication Services': 'kommunikation',
    'Consumer Cyclical': 'konsumZyklisch',
    'Consumer Defensive': 'konsumBasis',
    'Financial Services': 'finanzen',
    'Healthcare': 'gesundheit',
    'Industrials': 'industrie',
    'Energy': 'energie',
    'Basic Materials': 'grundstoffe',
    'Utilities': 'versorger',
    'Real Estate': 'immobilien',
}

/** Wert des Filters für «Sparte unbekannt» — kein Sektorname der Quelle. */
export const UNBEKANNT = '?'

/** Übersetzungsschlüssel eines Sektors, oder `null` (dann zeigt die Seite den Namen der Quelle). */
export function sektorSchluessel(sektor) {
    return SEKTOR_SCHLUESSEL[sektor] || null
}

/**
 * Was der Filter anbietet: Sektoren mit ihren Branchen und der Zahl der Titel,
 * dazu wie viele Titel keine Sparte tragen. Nur was in den Zeilen vorkommt.
 *
 * @param {{sparte?: {sektor?: string|null, branche?: string|null}|null}[]} zeilen
 * @returns {{sektoren: {sektor: string, anzahl: number, branchen: {branche: string, anzahl: number}[]}[], unbekannt: number}}
 */
export function spartenAuswahl(zeilen = []) {
    const je = new Map()
    let unbekannt = 0
    for (const z of zeilen) {
        const sektor = z?.sparte?.sektor
        if (!sektor) { unbekannt++; continue }
        if (!je.has(sektor)) je.set(sektor, { sektor, anzahl: 0, branchen: new Map() })
        const s = je.get(sektor)
        s.anzahl++
        const branche = z.sparte.branche
        if (branche) s.branchen.set(branche, (s.branchen.get(branche) || 0) + 1)
    }
    const sektoren = [...je.values()]
        .map((s) => ({
            sektor: s.sektor, anzahl: s.anzahl,
            branchen: [...s.branchen].map(([branche, anzahl]) => ({ branche, anzahl })).sort((a, b) => a.branche.localeCompare(b.branche)),
        }))
        .sort((a, b) => a.sektor.localeCompare(b.sektor))
    return { sektoren, unbekannt }
}

/**
 * Passt die Zeile zum Filter? Leerer Filter = alles. `sektor: UNBEKANNT`
 * zeigt genau die Titel ohne Sparte; ein gewählter Sektor zeigt NIE einen
 * Titel ohne Sparte.
 *
 * @param {{sparte?: object|null}} zeile
 * @param {{sektor?: string, branche?: string}} filter
 */
export function passtSparte(zeile, filter = {}) {
    const sektor = filter.sektor || ''
    if (!sektor) return true
    const s = zeile?.sparte
    if (sektor === UNBEKANNT) return !s?.sektor
    if (s?.sektor !== sektor) return false
    return !filter.branche || s.branche === filter.branche
}

/**
 * Den gewählten Filter auf das bringen, was die Auswahl noch hergibt — nach
 * einem neuen Lauf oder dem Entfernen eines Favoriten kann die Branche fehlen.
 */
export function bereinigeFilter(filter = {}, auswahl = { sektoren: [], unbekannt: 0 }) {
    const sektor = filter.sektor || ''
    if (!sektor) return { sektor: '', branche: '' }
    if (sektor === UNBEKANNT) return auswahl.unbekannt ? { sektor, branche: '' } : { sektor: '', branche: '' }
    const s = auswahl.sektoren.find((x) => x.sektor === sektor)
    if (!s) return { sektor: '', branche: '' }
    return { sektor, branche: s.branchen.some((b) => b.branche === filter.branche) ? filter.branche : '' }
}
