/**
 * ntfy-Topic: Vorgabe und Warnung — geteilt zwischen Server und Oberfläche.
 *
 * Auf ntfy.sh ist ein Topic ohne Zugriffstoken öffentlich: wer den Namen kennt,
 * liest mit (Symbol, Preisniveau, Zeichnungstext, Alarm-Notiz) und kann
 * eigene „Alarme" mit Priorität 5 schicken. Bis zum Gesamtaudit vom 26.10.2026
 * (SEC-SRV-013) war die Vorgabe `hype-radar` — dasselbe Topic für jede
 * Installation, und ein leeres Feld fiel still darauf zurück.
 *
 * Jetzt: neue Installationen bekommen ein zufälliges Topic (`neuesNtfyTopic`),
 * ein leeres Topic sendet nicht (die Zustellung meldet einen Fehler), und die
 * Oberfläche warnt bei ntfy.sh mit kurzem oder dem alten Vorgabe-Topic
 * (`ntfyTopicSchwach`). Gespeicherte Topics bleiben, wie sie sind — ein
 * stilles Umbenennen hiesse, dass das Handy nichts mehr bekommt.
 */

/** Die frühere Vorgabe. Bleibt bestehen, wo sie gespeichert ist; die Oberfläche warnt. */
export const NTFY_ALTES_TOPIC = 'hype-radar'

/** Kürzer gilt auf einem öffentlichen Server als erratbar. */
export const NTFY_MIN_LAENGE = 20

/** `autarktrade-` + 24 Hex-Zeichen (96 Bit Zufall). */
export function neuesNtfyTopic() {
    const bytes = new Uint8Array(12)
    globalThis.crypto.getRandomValues(bytes)
    return `autarktrade-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Läuft die Adresse auf dem öffentlichen ntfy.sh? */
export function istNtfySh(url) {
    try {
        const host = new URL(String(url || '').trim()).hostname.toLowerCase().replace(/\.$/, '')
        return host === 'ntfy.sh' || host.endsWith('.ntfy.sh')
    } catch {
        return false
    }
}

/**
 * Ist das Topic auf diesem Server leicht zu erraten?
 * Nur für ntfy.sh — ein eigener Server hat eigene Zugriffsregeln.
 *
 * @param {{url?: string, topic?: string}} kanal
 */
export function ntfyTopicSchwach(kanal) {
    if (!istNtfySh(kanal?.url)) return false
    const topic = String(kanal?.topic || '').trim()
    return topic.length < NTFY_MIN_LAENGE || topic.toLowerCase() === NTFY_ALTES_TOPIC
}
