/**
 * Wochentage des Lageberichts im Rhythmus „an bestimmten Tagen".
 *
 * Gespeichert als CSV in `settings.radarNewsTage`, 1 = Montag … 7 = Sonntag —
 * dieselbe Zählung wie `radarNewsWochentag` beim wöchentlichen Bericht. Geteilt
 * zwischen Browser (Pillen) und Server (Prüfung, Takt), damit beide dieselbe
 * Liste lesen.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */

/** Vorgabe, wenn jemand die Option zum ersten Mal wählt: Montag bis Freitag. */
export const TAGE_VORGABE = '1,2,3,4,5'

/** „3,1,x,1,9" → [1, 3]: sortiert, ohne Dubletten, nur 1–7. */
export function leseTage(text) {
    const tage = String(text ?? '').split(',')
        .map(x => x.trim())
        // Erst auf Leere prüfen: `Number('')` ist 0 — hier zwar ohnehin
        // ausserhalb 1–7, aber so bleibt die Absicht lesbar.
        .filter(x => x !== '')
        .map(Number)
        .filter(x => Number.isInteger(x) && x >= 1 && x <= 7)
    return [...new Set(tage)].sort((a, b) => a - b)
}

/** [5, 1, 3] → „1,3,5" */
export function tageText(tage) {
    return leseTage((Array.isArray(tage) ? tage : []).join(',')).join(',')
}

/** Wochentag eines (bereits in die Journal-Zeitzone verschobenen) Datums, 1 = Mo … 7 = So. */
export function wochentagNr(datumLokal) {
    return ((datumLokal.getDay() + 6) % 7) + 1
}

/**
 * Wie viele Tage liegt der vorige gewählte Tag zurück? 1 … 7.
 *
 * Bestimmt das Fenster des Berichts: Bei Mo–Fr deckt der Montagsbericht das
 * Wochenende mit ab (3 Tage), bei Mo/Mi/Fr der Mittwoch zwei Tage. Ist nur
 * ein Tag gewählt, ist es eine Woche. Ohne gültige Tage: 1.
 */
export function tageSeitVorigem(tage, heute) {
    const liste = leseTage(Array.isArray(tage) ? tage.join(',') : tage)
    if (!liste.length) return 1
    for (let abstand = 1; abstand <= 7; abstand++) {
        const tag = ((heute - 1 - abstand + 7 * 2) % 7) + 1
        if (liste.includes(tag)) return abstand
    }
    return 7
}
