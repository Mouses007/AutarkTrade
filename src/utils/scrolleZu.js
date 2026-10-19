/**
 * Scrollt den Inhaltsbereich zu einem Element — und nur ihn.
 *
 * `scrollIntoView` scrollt JEDEN Vorfahren, auch das Dokument. Das Layout
 * scrollt aber im Inhaltsbereich unter Kopfleiste und Testbetrieb-Banner;
 * das Dokument ist nur so hoch wie das Fenster plus Banner. Mit
 * `scrollIntoView` rutschte die Seite deshalb um die Bannerhöhe und mehr nach
 * oben und liess unten eine schwarze Fläche stehen (Playbook-Deep-Link,
 * 19.10.2026). Hier wird der nächste scrollbare Vorfahr gesucht und nur er
 * bewegt.
 *
 * @param {Element|null} el
 * @param {'start'|'center'} block
 */
export function scrolleZu(el, block = 'start') {
    if (!el) return
    let huelle = el.parentElement
    while (huelle && huelle !== document.body) {
        const y = getComputedStyle(huelle).overflowY
        if ((y === 'auto' || y === 'scroll') && huelle.scrollHeight > huelle.clientHeight) break
        huelle = huelle.parentElement
    }
    if (!huelle || huelle === document.body) {
        // Kein eigener Scrollbereich (z. B. Telefon): dann scrollt das Dokument richtig.
        el.scrollIntoView({ behavior: 'smooth', block })
        return
    }
    const r = el.getBoundingClientRect()
    const h = huelle.getBoundingClientRect()
    const versatz = block === 'center' ? (h.height - r.height) / 2 : 8
    huelle.scrollBy({ top: r.top - h.top - versatz, behavior: 'smooth' })
}
