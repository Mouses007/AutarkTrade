/**
 * Spracheingabe über die Spracherkennung des Browsers.
 *
 * Bewusst die eingebaute Erkennung (`SpeechRecognition`, in Chrome/Edge/Safari
 * als `webkitSpeechRecognition`) und kein eigener Dienst: sofort da, ohne
 * Kosten, ohne Server-Umbau. Zwei Grenzen, die der Aufrufer anzeigen muss:
 *   - Browser geben das Mikrofon nur in einem sicheren Kontext frei (https
 *     oder localhost). Über http://<LAN-Adresse> ist `grund === 'keinHttps'`.
 *   - Firefox hat keine Spracherkennung: `grund === 'keinBrowser'`.
 * Chrome schickt den Ton zur Erkennung an Google — das sagt die Oberfläche
 * dem Nutzer einmal (`kiCoach.mikroHinweis`).
 *
 * @param {object} wahl
 * @param {(text: string) => void} wahl.beiText  bekommt bei jedem Zwischenstand den GANZEN bisher erkannten Text
 * @param {() => string} [wahl.sprache]  BCP-47-Sprache, z. B. 'de-CH'
 */
import { ref, onBeforeUnmount } from 'vue'

function erkennerKlasse() {
    if (typeof window === 'undefined') return null
    return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

/** Warum die Spracheingabe hier nicht geht — oder null, wenn sie geht. */
export function spracheingabeGrund() {
    if (typeof window === 'undefined') return 'keinBrowser'
    if (!window.isSecureContext) return 'keinHttps'
    if (!erkennerKlasse()) return 'keinBrowser'
    return null
}

/** App-Sprache → Sprache der Erkennung. Deutsch als Schweizer Hochdeutsch, wenn der Browser so eingestellt ist. */
export function erkennungsSprache(appSprache, browserSprache = (typeof navigator !== 'undefined' ? navigator.language : '')) {
    const kurz = String(appSprache || 'de').slice(0, 2).toLowerCase()
    if (String(browserSprache || '').toLowerCase().startsWith(kurz + '-')) return browserSprache
    return kurz === 'en' ? 'en-US' : 'de-DE'
}

export function useSpracheingabe({ beiText, sprache = () => 'de-DE' } = {}) {
    const grund = ref(spracheingabeGrund())
    const hoert = ref(false)
    const fehler = ref('')       // '' | 'verweigert' | sonstiger Fehlercode des Browsers
    let erkenner = null

    /**
     * Aufnahme beenden und alles verwerfen, was der Erkenner noch nachliefert (BUG-R-209).
     * Für Senden, Gesprächswechsel und Aushängen: `stop()` liesse den Browser das
     * Endergebnis nachreichen — der eben gesendete Text stünde wieder im Feld.
     */
    function stopp() {
        const alter = erkenner
        erkenner = null       // ab jetzt gehört kein Ereignis des alten Erkenners mehr hierher
        try { alter?.abort() } catch { /* schon beendet */ }
        hoert.value = false
    }

    /** Mikrofon-Knopf aus: der Browser darf das Endergebnis des Gesagten noch liefern. */
    function pause() {
        try { erkenner?.stop() } catch { /* schon beendet */ }
        hoert.value = false
    }

    function start() {
        grund.value = spracheingabeGrund()
        if (grund.value || hoert.value) return
        // Ein noch auslaufender Erkenner (eben pausiert) wird ganz beendet: zwei gleichzeitig
        // wären nicht mehr stoppbar, und sein verspätetes `end` gälte dem neuen.
        try { erkenner?.abort() } catch { /* schon beendet */ }
        const Klasse = erkennerKlasse()
        const dieser = new Klasse()
        erkenner = dieser
        dieser.lang = sprache()
        dieser.interimResults = true
        dieser.continuous = true
        fehler.value = ''
        // BUG-R-209: Ereignisse eines abgelösten oder verworfenen Erkenners wirken nicht mehr.
        const meiner = () => erkenner === dieser
        dieser.onresult = (e) => {
            if (!meiner()) return
            let text = ''
            for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript || ''
            beiText?.(text.trim())
        }
        dieser.onerror = (e) => {
            if (!meiner()) return
            // `no-speech`/`aborted` sind keine Störung: es wurde nichts gesagt oder selbst beendet.
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fehler.value = 'verweigert'
            else if (e.error !== 'no-speech' && e.error !== 'aborted') fehler.value = String(e.error || 'unbekannt')
        }
        dieser.onend = () => {
            if (!meiner()) return
            erkenner = null
            hoert.value = false
        }
        try {
            dieser.start()
            hoert.value = true
        } catch (e) {
            fehler.value = String(e?.name || 'unbekannt')
            erkenner = null
            hoert.value = false
        }
    }

    const schalte = () => (hoert.value ? pause() : start())
    onBeforeUnmount(stopp)

    return { grund, hoert, fehler, start, stopp, schalte }
}
