/**
 * Die Zeitzone des Journals (`settings.timeZone`) — EIN Rückfall für alle.
 *
 * Bis 10/2026 hatte jede Stelle ihren eigenen: das Journal New York, die
 * ESP32-Anzeige Berlin, die Chart-KI UTC, Agent und Mails gar keinen (dann
 * die Zone des Servers, im Container UTC). Gilt die Einstellung nicht, gilt
 * jetzt überall dieselbe Vorgabe — die der Datenbankspalte.
 *
 * Rein, Browser und Server.
 */

/** Vorgabe der Spalte `settings.timeZone` (server/database.js). */
export const ZEITZONE_VORGABE = 'Europe/Brussels'

/** Kennt die Laufzeit diese IANA-Zone? */
export function zeitzoneGueltig(zone) {
    const z = String(zone ?? '').trim()
    if (!z) return false
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: z })
        return true
    } catch {
        return false
    }
}

/** Die eingestellte Zone, sonst die Vorgabe. */
export function zeitzoneAus(zone) {
    return zeitzoneGueltig(zone) ? String(zone).trim() : ZEITZONE_VORGABE
}

/** Alle Zonen, die die Laufzeit kennt (für die Auswahl); ohne `Intl.supportedValuesOf` nur die Vorgabe. */
export function alleZeitzonen() {
    try {
        const liste = Intl.supportedValuesOf('timeZone')
        return liste.includes(ZEITZONE_VORGABE) ? liste : [ZEITZONE_VORGABE, ...liste]
    } catch {
        return [ZEITZONE_VORGABE]
    }
}
