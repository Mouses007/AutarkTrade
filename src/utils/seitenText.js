/**
 * Sichtbarer Inhalt der offenen Seite als Text — für den KI-Coach.
 *
 * Bis 16.11.2026 kannte der Coach von einer Seite nur, was ein eigens dafür
 * gebautes Werkzeug las. Wo keines bestand (Bots, Heatmap, jede neue Seite),
 * antwortete er „ich sehe die Seite nicht". Jetzt geht mit jeder Frage mit,
 * was im Inhaltsbereich steht: der Text wie angezeigt (Tabellenzellen mit
 * „ | " getrennt) und die Werte der Eingabefelder. Damit kennt er jede Seite,
 * auch eine, die es beim Schreiben dieser Datei noch nicht gab.
 *
 * Nicht enthalten: Diagramme (Canvas hat keinen Text), ausgeblendete Reiter,
 * Passwortfelder und — auf den Einstellungs- und Einrichtungsseiten — alle
 * Eingabefelder, weil dort Schlüssel stehen können.
 *
 * Der Server prüft und kürzt noch einmal (`pruefeSeitenText` in
 * `server/ki-seitenstand.js`) und legt den Text als Zitat in den Auftrag.
 */

export const SEITENTEXT_MAX = 12000
const FELDER_MAX = 40
const HEIKEL = /pass|kennwort|secret|geheim|schl(ue|ü)ssel|token|api.?key|\bkey\b/i

/** Rein: Zeilen säubern, Leerzeilen weg, Tabulatoren zu Spaltentrennern, kürzen. */
export function bereinigeSeitenText(roh, max = SEITENTEXT_MAX) {
    const zeilen = String(roh ?? '').split(/\r?\n/)
        .map((z) => z.split('\t').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '))
        .filter(Boolean)
    const text = zeilen.join('\n')
    return text.length > max ? `${text.slice(0, max)}\n(abgeschnitten)` : text
}

/** Text eines Etiketts ohne die Felder, die darin stecken (sonst zählten alle Auswahlwerte mit). */
function etikettText(label) {
    if (!label) return ''
    const kopie = label.cloneNode(true)
    for (const f of kopie.querySelectorAll('input, select, textarea, button')) f.remove()
    return kopie.textContent || ''
}

function beschriftung(el) {
    const direkt = el.getAttribute('aria-label')
        || etikettText(el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null)
        || etikettText(el.closest('label'))
    if (direkt.trim()) return direkt
    // Üblicher Aufbau der App: Etikett und Feld als Geschwister in einem Kästchen.
    const nachbar = el.parentElement?.querySelector('label, .label, .beschriftung')
    return etikettText(nachbar) || el.getAttribute('placeholder') || el.getAttribute('name') || ''
}

function feldZeilen(wurzel) {
    const aus = []
    for (const el of wurzel.querySelectorAll('input, select, textarea')) {
        if (aus.length >= FELDER_MAX) break
        const typ = (el.getAttribute('type') || '').toLowerCase()
        if (['password', 'hidden', 'file', 'button', 'submit', 'range', 'color'].includes(typ)) continue
        if (!el.getClientRects().length) continue   // unsichtbar
        const name = beschriftung(el).replace(/\s+/g, ' ').trim().slice(0, 60)
        if (!name || HEIKEL.test(name) || HEIKEL.test(el.getAttribute('autocomplete') || '')) continue
        let wert
        if (typ === 'checkbox' || typ === 'radio') wert = el.checked ? 'ja' : 'nein'
        else if (el.tagName === 'SELECT') wert = el.selectedOptions?.[0]?.textContent || ''
        else wert = el.value || ''
        wert = String(wert).replace(/\s+/g, ' ').trim().slice(0, 80)
        if (typ === 'radio' && wert === 'nein') continue
        aus.push(`${name} = ${wert || '(leer)'}`)
    }
    return aus
}

/**
 * @param {{mitFeldern?: boolean}} [opt]  `mitFeldern: false` auf Seiten mit Schlüsselfeldern
 * @returns {string}  '' wenn es keinen Inhaltsbereich gibt
 */
export function leseSeitenText({ mitFeldern = true } = {}) {
    const wurzel = typeof document !== 'undefined' ? document.querySelector('main') : null
    if (!wurzel) return ''
    let felder = []
    if (mitFeldern) { try { felder = feldZeilen(wurzel) } catch { felder = [] } }
    const kopf = felder.length ? `EINGABEFELDER:\n${felder.join('\n')}\n\nTEXT DER SEITE:\n` : ''
    return bereinigeSeitenText(kopf + (wurzel.innerText || ''))
}
