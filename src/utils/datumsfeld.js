/**
 * Datumsfelder: ein Klick irgendwo ins Feld öffnet den Kalender.
 *
 * Der Browser öffnet ihn sonst nur über das kleine Symbol rechts; ein Klick
 * in den Text wählt Tag, Monat oder Jahr zum Tippen aus. Im Labor fand der
 * Owner das Symbol nicht (01.11.2026) — es war zudem unsichtbar, siehe
 * basis.css. Tippen geht weiter: Tastatur und Fokus bleiben, wie sie sind.
 */
const ARTEN = new Set(['date', 'month', 'datetime-local'])

/** Soll ein Klick auf dieses Element den Kalender öffnen? Rein. */
export function oeffnetKalender(el) {
    return !!el && el.tagName === 'INPUT' && ARTEN.has(el.type) && !el.disabled && !el.readOnly
}

/** Beim App-Start einmal aufrufen. */
export function starteDatumsfelder() {
    document.addEventListener('click', (e) => {
        if (!oeffnetKalender(e.target)) return
        // showPicker fehlt in alten Browsern und wirft, wenn das Feld schon
        // offen ist oder die Geste nicht zählt — dann bleibt es beim Symbol.
        try { e.target.showPicker?.() } catch { /* siehe oben */ }
    })
}
