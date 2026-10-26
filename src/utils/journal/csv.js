/**
 * CSV für den Journal-Export (Titelzeile → Export → CSV).
 *
 * Audit SEC-WEB-004: vorher `spalten.join(';')` ohne Quoting und ohne
 * Formel-Entschärfung. Ein Symbol oder eine Notiz wie `=HYPERLINK(…)` lief in
 * Excel als Formel, ein `;` im Text verschob die Spalten, `tags` kam als
 * „[object Object]" an, und die Spalten stammten nur aus dem ERSTEN Trade —
 * Felder, die erst spätere Trades haben, fehlten.
 *
 * Jetzt nach RFC 4180 (Trenner bleibt `;` wie bisher, weil Excel im
 * deutschsprachigen Raum das erwartet):
 *  - Text immer in `"…"`, ein `"` darin verdoppelt; Zeilenende CRLF
 *  - Text, der mit `= + - @`, Tab oder CR beginnt und KEINE reine Zahl ist,
 *    bekommt ein `'` davor (wie `steuerCsv` in `server/portfolio/steuer.js`) —
 *    `-12.5` bleibt eine Zahl, `-1+A1` nicht
 *  - Zahlen ohne Anführungszeichen
 *  - Spalten = Vereinigung aller Schlüssel in der Reihenfolge des Auftretens
 *  - Listen als „a, b", Objekte in Listen mit ihrem Namen (`name`/`label`)
 *
 * Ohne DOM, damit der Selbsttest sie prüfen kann; den Download macht
 * `exportiereDaten` in `app.js`.
 */

const TRENNER = ';'
const ZEILENENDE = '\r\n'
/** Byte-Order-Mark: sonst liest Excel UTF-8 (Umlaute, „—") als Latin-1. */
export const CSV_BOM = '﻿'

const REINE_ZAHL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const GEFAEHRLICH = /^[=+\-@\t\r]/

/** Ein Wert als Text für die Zelle (ohne Quoting). */
function alsText(v) {
    if (v == null) return ''
    if (Array.isArray(v)) return v.map((e) => (e && typeof e === 'object' ? (e.name ?? e.label ?? JSON.stringify(e)) : String(e ?? ''))).join(', ')
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
}

/**
 * Eine Zelle: Zahl roh, alles andere gequotet und gegen Formeln entschärft.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function csvZelle(v) {
    if (v == null || v === '') return ''
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    let s = alsText(v)
    if (GEFAEHRLICH.test(s) && !REINE_ZAHL.test(s)) s = "'" + s
    return `"${s.replace(/"/g, '""')}"`
}

/**
 * Zeilen (Objekte) → CSV-Text, ohne BOM.
 *
 * @param {Array<Record<string, unknown>>} daten
 * @returns {string}
 */
export function csvAusZeilen(daten) {
    const liste = Array.isArray(daten) ? daten : []
    const spalten = []
    const gesehen = new Set()
    for (const o of liste) {
        for (const k of Object.keys(o || {})) {
            if (!gesehen.has(k)) { gesehen.add(k); spalten.push(k) }
        }
    }
    const zeilen = [spalten.map(csvZelle).join(TRENNER)]
    for (const o of liste) zeilen.push(spalten.map((s) => csvZelle(o?.[s])).join(TRENNER))
    return zeilen.join(ZEILENENDE)
}
