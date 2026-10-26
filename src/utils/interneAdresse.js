/**
 * Prüfungen, ob eine Adresse in der eigenen App bleibt (Audit SEC-WEB-001/-003).
 *
 * Beide Lücken hatten dieselbe Ursache: ein „beginnt mit /"-Test auf dem
 * Rohtext. Der Browser normalisiert nach WHATWG aber `\` zu `/` und entfernt
 * Tab und Zeilenumbruch — aus `/\evil.com` wird `//evil.com`, ein fremder
 * Server. Darum prüfen beide Funktionen den Rohtext streng UND die aufgelöste
 * URL.
 */

/**
 * Darf ein Bild in einer KI-Ausgabe geladen werden? Nur von der eigenen App.
 *
 * Audit SEC-WEB-001: die alte Prüfung `/^\/(?!\/)/` liess `/\evil.com/x` und
 * `/<TAB>/evil.com/x` durch — der Browser löst beide nach WHATWG zu
 * `//evil.com/x` auf, also zu einem fremden Server. Darum jetzt zweistufig:
 *
 *  1. der Rohtext muss ein schlichter Pfad sein: beginnt mit EINEM `/`, kein
 *     `\` irgendwo, keine Steuer- oder Leerzeichen (Tab, Zeilenumbruch, die der
 *     URL-Parser stillschweigend entfernt), kein Schema davor
 *  2. aufgelöst mit `new URL(src, origin)` muss die Origin gleich bleiben
 *
 * `/api/` ist ausgenommen: ein Bild-Abruf wäre ein GET mit der Sitzung — das
 * braucht keine KI-Antwort, und so löst sie auch keinen API-Aufruf aus.
 *
 * Ohne DOM (eigene Datei, nicht in `sanitize.js`), damit der Selbsttest sie in
 * Node prüfen kann.
 *
 * @param {unknown} src
 * @param {string} origin  z. B. `window.location.origin`
 * @returns {boolean}
 */
export function istEigenesBild(src, origin) {
    const roh = String(src ?? '')
    if (!/^\/(?![\/\\])/.test(roh)) return false
    if (/[\\\s\u0000-\u001F\u007F]/.test(roh)) return false
    let url
    try {
        url = new URL(roh, origin)
    } catch {
        return false
    }
    if (url.origin !== new URL(origin).origin) return false
    let pfad = url.pathname
    try { pfad = decodeURIComponent(pfad) } catch { return false }
    if (/^\/api(\/|$)/i.test(url.pathname) || /^\/api(\/|$)/i.test(pfad)) return false
    return true
}

/**
 * Rücksprung-Ziel aus einer Query (`?rueckkehr=`) — nur ein interner Pfad.
 *
 * Audit SEC-WEB-003: der Update-Assistent setzte `window.location.href` auf
 * den ungeprüften Parameter; ein präparierter Link schickte nach „Fertig" auf
 * eine fremde Seite (Phishing). Erlaubt ist nur, was mit EINEM `/` beginnt,
 * kein `\`, keine Steuer-/Leerzeichen enthält und aufgelöst die Origin nicht
 * verlässt. Alles andere ergibt `null` — der Aufrufer nimmt dann seine Vorgabe.
 *
 * @param {unknown} ziel
 * @param {string} [origin]  nur für den Selbsttest; im Browser die eigene Origin
 * @returns {string|null} Pfad samt Query/Hash, oder `null`
 */
export function internerPfad(ziel, origin = 'http://app.invalid') {
    const roh = Array.isArray(ziel) ? ziel[0] : ziel
    if (typeof roh !== 'string') return null
    if (!/^\/(?![\/\\])/.test(roh)) return null
    if (/[\\\s\u0000-\u001F\u007F]/.test(roh)) return null
    let url
    try {
        url = new URL(roh, origin)
    } catch {
        return null
    }
    if (url.origin !== new URL(origin).origin) return null
    return url.pathname + url.search + url.hash
}
