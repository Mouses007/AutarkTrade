/**
 * Markdown einer KI-Antwort → HTML.
 *
 * Die eine Umwandlung für alle Chat-Flächen (KI-Coach-Leiste, Chart-Chat,
 * Berichte). Bis zum Umbau zur Seitenleiste hatten `KiAgent.vue` und
 * `chart/KiChat.vue` je eine eigene, leicht abweichende Fassung.
 *
 * Bewusst klein gehalten: Überschriften, fett/kursiv, Listen, Absätze — was
 * die Modelle tatsächlich liefern. Das Ergebnis läuft immer durch
 * `sanitizeKiHtml`; ein Modell kann also kein Skript in die Seite schreiben.
 *
 * @param {string} md
 * @param {{kompakt?: boolean}} [wahl] kompakt: Überschriften nur fett (schmale Leisten)
 * @returns {string}
 */
import { sanitizeKiHtml } from './sanitize'

export function kiMarkdown(md, { kompakt = false } = {}) {
    if (!md) return ''
    const kopf = kompakt
        ? ['<b>$1</b>', '<b>$1</b>', '<b>$1</b>']
        : ['<h5 class="at-mo-2 at-mu-1">$1</h5>', '<h4 class="report-section-title at-mo-3 at-mu-1">$1</h4>', '<h3 class="at-mo-3 at-mu-2">$1</h3>']
    let html = String(md)
        .replace(/^### (.+)$/gm, kopf[0])
        .replace(/^## (.+)$/gm, kopf[1])
        .replace(/^# (.+)$/gm, kopf[2])
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (treffer) => `<ul class="at-mu-1">${treffer}</ul>`)

    html = html.split('\n\n').map((absatz) => {
        const s = absatz.trim()
        if (!s) return ''
        if (s.startsWith('<h') || s.startsWith('<ul') || s.startsWith('<b>')) return s
        return `<p>${s}</p>`
    }).filter(Boolean).join('\n')

    return sanitizeKiHtml(html)
}
