/**
 * Beschriftung → Bedienelement verknüpfen, wo die Vorlage es nicht tut.
 *
 * Das Projekt setzt Beschriftungen fast überall als
 * `<label class="at-label">Text</label>` direkt VOR das Feld, ohne `for`.
 * Sichtbar ist das eindeutig, für Screenreader ist das Feld namenlos — die
 * Laufprüfung zählte auf den Agent-Seiten und in den Einstellungen Dutzende
 * solcher Felder (Audit A4-22). Statt jede Stelle einzeln mit ids zu versehen,
 * verknüpft diese Hilfe genau dieses Muster: Label ohne `for`, das nächste
 * Geschwister ist (oder enthält als erstes) ein Feld ohne eigenen Namen → das
 * Feld bekommt `aria-labelledby` auf das Label. Läuft einmal beim Start und
 * danach entprellt bei jeder DOM-Änderung.
 */
const FELD = 'input:not([type=hidden]), select, textarea'
let zaehler = 0

function hatNamen(feld) {
    if (feld.hasAttribute('aria-label') || feld.hasAttribute('aria-labelledby')) return true
    if (feld.closest('label')) return true
    return !!(feld.id && document.querySelector(`label[for="${CSS.escape(feld.id)}"]`))
}

/** Ein Durchgang über `wurzel`; gibt die Zahl neu verknüpfter Felder zurück. */
export function verknuepfeLabels(wurzel = document) {
    let n = 0
    for (const label of wurzel.querySelectorAll('label.at-label:not([for])')) {
        const nachbar = label.nextElementSibling
        if (!nachbar) continue
        const feld = nachbar.matches(FELD) ? nachbar : nachbar.querySelector(FELD)
        if (!feld || hatNamen(feld)) continue
        if (!label.id) label.id = `at-label-${++zaehler}`
        feld.setAttribute('aria-labelledby', label.id)
        n++
    }
    return n
}

/** Beim App-Start einmal aufrufen. */
export function starteLabelVerknuepfung() {
    if (typeof MutationObserver === 'undefined') return
    let geplant = false
    const lauf = () => { geplant = false; verknuepfeLabels() }
    new MutationObserver(() => {
        if (geplant) return
        geplant = true
        requestAnimationFrame(lauf)
    }).observe(document.body, { childList: true, subtree: true })
    lauf()
}
