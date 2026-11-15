/**
 * ai-agent-kern.js — reine Teile des KI-Coach-Laufs (ohne Netz, ohne Datenbank).
 *
 * Herausgelöst, damit sie sich prüfen lassen: `ai-agent.js` hängt an
 * Datenbank, Anbietern und Express.
 */

/** Untergrenze der Antwortlänge für den Coach. Bezahlt wird nur, was verbraucht wird. */
export const AGENT_MIN_TOKENS = 8000
/**
 * Antwortlänge für die eine automatische Wiederholung, wenn eine Antwort leer
 * zurückkam. 16 000 statt mehr, weil einzelne Modelle (gpt-4o: 16 384) keine
 * längere Ausgabe annehmen.
 */
export const AGENT_WIEDERHOLUNG_TOKENS = 16000

/**
 * Antwortlänge je Modellaufruf des Coachs.
 *
 * Die denkenden Modelle rechnen Denken UND Antwort gegen `max_tokens`. Mit
 * einem kleinen Wert aus den allgemeinen KI-Einstellungen (1500 für kurze
 * Berichte) blieb für die Antwort nichts übrig, und der Nutzer wurde in die
 * Einstellungen geschickt.
 *
 * @param {number|string|null} eingestellt `settings.aiMaxTokens`
 */
export function agentMaxTokens(eingestellt) {
    return Math.max(Number(eingestellt) || 4000, AGENT_MIN_TOKENS)
}

/** Grenze je Werkzeug-Ergebnis in Zeichen. */
export const ERGEBNIS_MAX = 15000

/**
 * Werkzeug-Ergebnis als JSON-Text für die Modell-Historie, gedeckelt.
 *
 * Bis zum Umbau wurde der JSON-Text bei 15 000 Zeichen einfach abgeschnitten
 * und `... [truncated]` angehängt — das Ergebnis war dann kein JSON mehr, und
 * der Gemini-Zweig (`JSON.parse` auf dem Inhalt) warf. Jetzt bleibt auch ein
 * gekürztes Ergebnis gültiges JSON und sagt dem Modell, dass etwas fehlt.
 *
 * @param {unknown} ergebnis
 * @param {number} [max]
 * @returns {string}
 */
export function kuerzeErgebnis(ergebnis, max = ERGEBNIS_MAX) {
    const text = JSON.stringify(ergebnis ?? null)
    if (text.length <= max) return text
    return JSON.stringify({
        abgeschnitten: true,
        hinweis: 'Das Ergebnis war zu lang und ist abgeschnitten. Fehlt etwas, frage enger (limit, Filter, Zeitraum).',
        anfang: text.slice(0, max),
    })
}

/**
 * Gespeicherten Werkzeug-Inhalt zurück in ein Objekt — nie werfend.
 * Alte Sitzungen enthalten noch abgeschnittene, ungültige Texte.
 *
 * @param {string} inhalt
 * @returns {object}
 */
export function leseErgebnis(inhalt) {
    if (!inhalt) return {}
    try {
        const wert = JSON.parse(inhalt)
        return wert && typeof wert === 'object' ? wert : { wert }
    } catch {
        return { text: String(inhalt) }
    }
}
