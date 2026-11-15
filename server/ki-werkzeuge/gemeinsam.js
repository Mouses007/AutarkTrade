/**
 * Gemeinsame Helfer der Coach-Werkzeuge in diesem Ordner.
 *
 * Muster wie `toolQueryCoinRadar` in `ai-agent-tools.js`: kurze Textzeilen
 * statt roher Tabellenzeilen (die Einheiten stehen gleich dabei, und hundert
 * Zeilen mit allen Spalten sprengen die Ergebnisgrenze), dazu `stand` und ein
 * `hinweis`, der dem Modell sagt, was die Zahlen NICHT bedeuten.
 */

/** Zahl mit festen Nachkommastellen, `?` wenn unbekannt — unbekannt ist nie 0. */
export function zahl(w, stellen = 2) {
    if (w === null || w === undefined || w === '' || !Number.isFinite(Number(w))) return '?'
    return Number(w).toFixed(stellen)
}

/** Betrag kurz: 1.2 Mrd, 3.4 Mio, 56k, 780. */
export function kurzBetrag(w) {
    if (w === null || w === undefined || w === '' || !Number.isFinite(Number(w))) return '?'
    const n = Number(w)
    const a = Math.abs(n)
    if (a >= 1e9) return (n / 1e9).toFixed(2) + ' Mrd'
    if (a >= 1e6) return (n / 1e6).toFixed(2) + ' Mio'
    if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k'
    return n.toFixed(a >= 100 ? 0 : 2)
}

/** Zeitpunkt (ms) als ISO-Minute, `?` wenn unbekannt. */
export function zeit(ms) {
    const n = Number(ms)
    return n > 0 ? new Date(n).toISOString().slice(0, 16) + 'Z' : '?'
}

/** Alter in Stunden seit `ms`, eine Nachkommastelle. */
export function alterStunden(ms, jetzt = Date.now()) {
    const n = Number(ms)
    return n > 0 ? ((jetzt - n) / 3600e3).toFixed(1) : '?'
}

/** Grenze je Aufruf: Vorgabe, Mindest- und Höchstwert. */
export function grenze(w, vorgabe, max) {
    const n = Math.round(Number(w))
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : vorgabe
}

/** JSON aus einer TEXT-Spalte, nie werfend. */
export function lies(text, rueckfall) {
    if (text && typeof text === 'object') return text
    try { return JSON.parse(text) ?? rueckfall } catch { return rueckfall }
}

/** Suchbegriff des Modells für ein LIKE: einzeilig, kurz, Platzhalter entschärft. */
export function likeMuster(text, max = 40) {
    const s = String(text ?? '').replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, max)
    return s ? '%' + s.toLowerCase().replace(/[\\%_]/g, (z) => '\\' + z) + '%' : null
}
