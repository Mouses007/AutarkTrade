/**
 * Markdown als lesbarer Klartext — für `NOTICE.md` im Dialog „Rechtliches".
 *
 * Lizenz und Drittlizenzen sind reiner Text, NOTICE ist Markdown; der Dialog
 * zeigte es roh (`# NOTICE`, `> -`, Backticks; Audit A4-17). Kein HTML-Rendern
 * (kein v-html, keine Abhängigkeit): nur die Auszeichnung entfernen, Inhalt und
 * Absätze bleiben wortgleich.
 */
export function markdownAlsText(md) {
    return String(md || '')
        .split('\n')
        .map((zeile) => zeile
            .replace(/^\s*>\s?/, '')                       // Zitatblock
            .replace(/^#{1,6}\s+(.*)$/, (_, t) => t.toUpperCase()) // Überschrift
            .replace(/^(\s*)[-*]\s+/, '$1• ')              // Aufzählung
            .replace(/\*\*([^*]+)\*\*/g, '$1')             // fett
            .replace(/`([^`]+)`/g, '$1')                   // Code
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')) // Link
        .join('\n')
}
