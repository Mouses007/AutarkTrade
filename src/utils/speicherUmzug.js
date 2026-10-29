/**
 * Einmalige Übernahme alter localStorage-Schlüssel (F3, 20.10.2026).
 *
 * Die Filter des Journals lagen bis F3 unter Schlüsseln aus der Zeit vor
 * AutarkTrade (`selected…`). Die Stores lesen ihren Anfangswert beim Laden des
 * Moduls; deshalb muss diese Datei als ERSTES in `main.js` stehen, vor jedem
 * Store. Ein vorhandener neuer Schlüssel gewinnt, der alte wird danach
 * entfernt — ein zweiter Lauf ändert nichts.
 *
 * Kann entfallen, sobald keine Installation mehr Browser mit den alten
 * Schlüsseln hat.
 */
export const SPEICHER_UMZUG = {
    selectedBroker: 'at.journal.boerse',
    selectedAccount: 'at.journal.konto',
    selectedAccounts: 'at.journal.konten',
    selectedPositions: 'at.journal.richtungen',
    selectedTimeFrame: 'at.journal.zeitrahmen',
    selectedRatio: 'at.journal.kennzahl',
    selectedGrossNet: 'at.journal.bruttoNetto',
    selectedPlSatisfaction: 'at.journal.plZufriedenheit',
    selectedTags: 'at.journal.tags',
    selectedDateRange: 'at.journal.datumsBereich',
    selectedPeriodRange: 'at.journal.zeitraum',
    selectedMonth: 'at.journal.monat',
    selectedDashTab: 'at.journal.dashReiter',
}

export function zieheSpeicherUm(speicher) {
    let n = 0
    for (const [alt, neu] of Object.entries(SPEICHER_UMZUG)) {
        const wert = speicher.getItem(alt)
        if (wert === null) continue
        if (speicher.getItem(neu) === null) speicher.setItem(neu, wert)
        speicher.removeItem(alt)
        n++
    }
    return n
}

/**
 * Schlüssel, die nichts mehr bedeuten und einmal weggeräumt werden.
 * `evalNotifiedPositionIds`: gemeldete Trades stehen seit 29.10.2026 in der
 * Datenbank (`server/trade-popups.js`).
 */
export const SPEICHER_ENTFALLEN = ['evalNotifiedPositionIds']

export function raeumeSpeicherAuf(speicher) {
    let n = 0
    for (const k of SPEICHER_ENTFALLEN) {
        if (speicher.getItem(k) === null) continue
        speicher.removeItem(k)
        n++
    }
    return n
}

try {
    if (typeof localStorage !== 'undefined') {
        zieheSpeicherUm(localStorage)
        raeumeSpeicherAuf(localStorage)
    }
} catch { /* privater Modus */ }
