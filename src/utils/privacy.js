/**
 * Sichtschutz für das Journal (bis Audit B „Datenschutz-/Zensur-Modus").
 *
 * NUR ANZEIGE: die Werte werden verwischt, sie stehen weiter im DOM und in den
 * API-Antworten (Audit SEC-WEB-007 / PRIV-01). Gegen einen Blick über die
 * Schulter oder eine Bildschirmfreigabe, nicht gegen jemanden am Gerät — darum
 * heisst er in der Oberfläche „Sichtschutz (nur Anzeige)".
 *
 * Zahlen und Geldwerte tragen im Journal keine gemeinsame CSS-Klasse (Mischung
 * aus gewinnWert/verlustWert/text-warning und Bootstrap-Utilities). Statt jede
 * Stelle zu markieren, erkennen wir Zahlen-Blätter am Textinhalt: ein Blatt
 * (Element ohne Kind-Elemente), dessen Text mindestens eine Ziffer und KEINEN
 * Buchstaben enthält, ist ein Wert — Beschriftungen haben immer Buchstaben.
 *
 * So werden „$ 573.62", „-57.9%", „215", „$ 16'610", „1:1.2" verwischt, aber
 * „Kontostand" oder „P/L Ratio" bleiben lesbar.
 *
 * Seit Audit B zusätzlich Blätter MIT Buchstaben, wenn sie einen Geld- oder
 * Prozentwert tragen („Gross: 12$", „Net 1'200 USDT", „Win rate 57 %") — die
 * blieben vorher lesbar, weil sie eine Beschriftung enthalten.
 *
 * Ein MutationObserver markiert nach jedem Vue-Re-Render nach. Er beobachtet nur
 * childList/characterData (nicht Attribute), damit das Setzen unserer Klasse ihn
 * nicht selbst auslöst.
 */

const CENSOR_CLASS = 'tj-censor'
const HAT_ZIFFER = /\d/
const HAT_BUCHSTABE = /[A-Za-zÀ-ÖØ-öø-ÿ]/
/** Ein Betrag mit Währung oder Prozent, davor oder dahinter: „$ 12", „12$", „-3,5 %", „1'200 USDT". */
const GELD_ODER_PROZENT = /(?:[$€£]|\b(?:USDT?|USDC|CHF|EUR)\b)\s*[-−+]?\d|\d[\d'’.,]*\s*(?:[$€£%]|\b(?:USDT?|USDC|CHF|EUR)\b)/

/**
 * Ist dieser Text (eines Blattes) ein Wert, der verwischt wird?
 * Ohne DOM, damit der Selbsttest ihn prüfen kann.
 *
 * @param {string} text
 */
export function istZensurText(text) {
    const t = String(text ?? '').trim()
    if (!t || !HAT_ZIFFER.test(t)) return false
    if (!HAT_BUCHSTABE.test(t)) return t.length <= 24
    // Beschriftung mit Betrag: nur wenn wirklich ein Geld-/Prozentwert drinsteht
    return t.length <= 60 && GELD_ODER_PROZENT.test(t)
}

function istZahlenBlatt(el) {
    if (el.children.length) return false
    return istZensurText(el.textContent)
}

function markiere(root) {
    root.querySelectorAll('*').forEach(el => {
        if (istZahlenBlatt(el)) el.classList.add(CENSOR_CLASS)
        else if (el.classList.contains(CENSOR_CLASS)) el.classList.remove(CENSOR_CLASS)
    })
}

function entferne(root) {
    root.querySelectorAll('.' + CENSOR_CLASS).forEach(el => el.classList.remove(CENSOR_CLASS))
}

/**
 * Startet die Zensur auf `root`. Gibt eine Funktion zurück, die alles wieder
 * aufräumt (Observer trennen, Klassen entfernen, body-Klasse zurücknehmen).
 */
export function starteZensur(root) {
    if (!root) return () => {}
    document.body.classList.add('privacy-on')
    markiere(root)

    let geplant = false
    const observer = new MutationObserver(() => {
        if (geplant) return
        geplant = true
        requestAnimationFrame(() => { geplant = false; markiere(root) })
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
        observer.disconnect()
        document.body.classList.remove('privacy-on')
        entferne(root)
    }
}
