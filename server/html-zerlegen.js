/**
 * HTML und XML aus fremder Hand zerlegen — in LINEARER Zeit.
 *
 * ## Warum eine eigene Datei
 *
 * Bis zum Gesamtaudit vom 26.10.2026 (SEC-SRV-001, SEC-SRV-011) stand an jeder
 * Stelle ein eigener Regex: `<[^>]+>`, `<!--[\s\S]*?-->`, `<item…>[\s\S]*?</item>`.
 * Jeder davon ist auf gutartigem HTML schnell und auf präpariertem quadratisch:
 * Fehlt der Abschluss (`>` , `-->`, `</item>`), sucht der Regex von JEDER
 * Fundstelle aus bis zum Textende und beginnt dann an der nächsten von vorn.
 * Gemessen: 200 kB `<<<…` → 12,6 s, hochgerechnet auf die 2 MB, die net-guard
 * durchlässt, rund 20 Minuten — so lange steht die Event-Loop, also API,
 * Chart-Alarme und Aufzeichnung. Eine Projektseite trägt ein Token-Ersteller
 * ein, ein Feed kann übernommen werden.
 *
 * Die Funktionen hier suchen mit `indexOf` bzw. einem globalen Regex mit
 * `lastIndex` immer nur VORWÄRTS. Fehlt ein Abschluss einmal, fehlt er auch für
 * jede spätere Fundstelle — dann wird abgebrochen statt weitergesucht. Das
 * Ergebnis ist dasselbe wie das der alten Regexe (der Selbsttest prüft das
 * gegen sie), nur ohne den quadratischen Fall.
 */

/** Obergrenze für das, was überhaupt zerlegt wird (Projektseite, Feed). */
export const HTML_MAX = 256 * 1024

/**
 * Wie `s.replace(/<[^>]+>/g, ersatz)` — dasselbe Ergebnis, aber linear.
 *
 * Der Regex nimmt von jedem `<` bis zum nächsten `>` (mindestens ein Zeichen
 * dazwischen, `<` darf darin vorkommen). Gibt es nach einem `<` kein `>` mehr,
 * gibt es auch nach keinem späteren eines: fertig.
 *
 * @param {string} s
 * @param {string} ersatz
 * @param {{leer?: boolean}} [o]  `leer: true` nimmt auch `<>` (wie `<[^>]*>`)
 */
export function ohneTags(s, ersatz = ' ', { leer = false } = {}) {
    const text = String(s ?? '')
    const teile = []
    let pos = 0
    let i = text.indexOf('<')
    while (i !== -1) {
        const j = text.indexOf('>', i + 1)
        if (j === -1) break
        if (j === i + 1 && !leer) {
            i = text.indexOf('<', i + 1)
            continue
        }
        teile.push(text.slice(pos, i), ersatz)
        pos = j + 1
        i = text.indexOf('<', pos)
    }
    teile.push(text.slice(pos))
    return teile.join('')
}

/**
 * Wie `s.replace(/AUF[\s\S]*?ZU/g, …)` für feste Marken (`<!--`/`-->`,
 * `<![CDATA[`/`]]>`), linear.
 *
 * @param {string} s
 * @param {string} auf
 * @param {string} zu
 * @param {(inhalt: string) => string} ersatz  bekommt den Text ZWISCHEN den Marken
 */
export function ersetzeZwischen(s, auf, zu, ersatz) {
    const text = String(s ?? '')
    const teile = []
    let pos = 0
    let i = text.indexOf(auf)
    while (i !== -1) {
        const j = text.indexOf(zu, i + auf.length)
        if (j === -1) break
        teile.push(text.slice(pos, i), ersatz(text.slice(i + auf.length, j)))
        pos = j + zu.length
        i = text.indexOf(auf, pos)
    }
    teile.push(text.slice(pos))
    return teile.join('')
}

const regexText = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Wie `s.replace(/<(a|b|…)\b[\s\S]*?<\/\1>/gi, ersatz)`, linear.
 *
 * Ein Name ohne Abschluss ab Stelle p hat auch ab jeder späteren Stelle
 * keinen — er wird gemerkt und nicht noch einmal bis zum Ende gesucht.
 *
 * @param {string} s
 * @param {string[]} namen  z. B. ['script', 'style']
 * @param {string} ersatz
 */
export function ohneBloecke(s, namen, ersatz = ' ') {
    const text = String(s ?? '')
    const auf = new RegExp(`<(${namen.map(regexText).join('|')})\\b`, 'gi')
    const ohneEnde = new Set()
    const teile = []
    let pos = 0
    let m
    while ((m = auf.exec(text))) {
        const name = m[1].toLowerCase()
        if (ohneEnde.has(name)) continue
        const zu = new RegExp(`</${regexText(name)}>`, 'gi')
        zu.lastIndex = auf.lastIndex
        const ende = zu.exec(text)
        if (!ende) {
            ohneEnde.add(name)
            continue
        }
        teile.push(text.slice(pos, m.index), ersatz)
        pos = ende.index + ende[0].length
        auf.lastIndex = pos
    }
    teile.push(text.slice(pos))
    return teile.join('')
}

/**
 * Inhalt des ersten Elements `<tag …>…</tag>` (Gross-/Kleinschreibung egal)
 * oder `null` — wie `s.match(/<tag(?:\s[^>]*)?>([\s\S]*?)<\/tag>/i)?.[1]`,
 * aber linear. Im Öffnungs-Tag ist `<` nicht erlaubt (`[^<>]`), sonst liefe
 * jede Fundstelle bis zum nächsten `>` quer durch die Seite.
 *
 * @param {string} s
 * @param {string} tag  z. B. 'title', 'media:description'
 */
export function elementInhalt(s, tag) {
    const text = String(s ?? '')
    const t = regexText(tag)
    const auf = new RegExp(`<${t}(?:\\s[^<>]*)?>`, 'i')
    const m = auf.exec(text)
    if (!m) return null
    const zu = new RegExp(`</${t}>`, 'gi')
    zu.lastIndex = m.index + m[0].length
    const ende = zu.exec(text)
    // Ohne Abschluss hinter dem ersten Öffnen gibt es auch hinter keinem
    // späteren einen.
    if (!ende) return null
    return text.slice(m.index + m[0].length, ende.index)
}

/**
 * Alle Blöcke `<tag[\s>]…</tag>` in Reihenfolge, höchstens `max` — wie
 * `s.match(/<tag[\s>][\s\S]*?<\/tag>/gi)`, aber linear und gedeckelt.
 *
 * @param {string} s
 * @param {string} tag  'item' oder 'entry'
 * @param {number} max
 * @returns {string[]}
 */
export function bloeckeVon(s, tag, max = Infinity) {
    const text = String(s ?? '')
    const t = regexText(tag)
    const auf = new RegExp(`<${t}[\\s>]`, 'gi')
    const zu = new RegExp(`</${t}>`, 'gi')
    const raus = []
    let m
    while (raus.length < max && (m = auf.exec(text))) {
        zu.lastIndex = m.index + m[0].length
        const ende = zu.exec(text)
        if (!ende) break
        const bis = ende.index + ende[0].length
        raus.push(text.slice(m.index, bis))
        auf.lastIndex = bis
    }
    return raus
}

/**
 * Zeichen zu einem numerischen Verweis (`&#…;`, `&#x…;`).
 *
 * `String.fromCodePoint` wirft ab 0x110000 einen RangeError — ein einziges
 * `&#x110000;` liess bis zum Audit den ganzen Feed ausfallen. Ausserhalb des
 * Unicode-Bereichs, für einzelne Ersatzhälften (D800–DFFF) und für 0 steht,
 * wie im HTML-Standard, U+FFFD.
 *
 * @param {number} n
 */
export function zeichenAusVerweis(n) {
    if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�'
    return String.fromCodePoint(n)
}
