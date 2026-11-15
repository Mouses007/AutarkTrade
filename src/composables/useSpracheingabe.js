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

    function stopp() {
        try { erkenner?.stop() } catch { /* schon beendet */ }
        hoert.value = false
    }

    function start() {
        grund.value = spracheingabeGrund()
        if (grund.value || hoert.value) return
        const Klasse = erkennerKlasse()
        erkenner = new Klasse()
        erkenner.lang = sprache()
        erkenner.interimResults = true
        erkenner.continuous = true
        fehler.value = ''
        erkenner.onresult = (e) => {
            let text = ''
            for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript || ''
            beiText?.(text.trim())
        }
        erkenner.onerror = (e) => {
            // `no-speech`/`aborted` sind keine Störung: es wurde nichts gesagt oder selbst beendet.
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fehler.value = 'verweigert'
            else if (e.error !== 'no-speech' && e.error !== 'aborted') fehler.value = String(e.error || 'unbekannt')
        }
        erkenner.onend = () => { hoert.value = false }
        try {
            erkenner.start()
            hoert.value = true
        } catch (e) {
            fehler.value = String(e?.name || 'unbekannt')
            hoert.value = false
        }
    }

    const schalte = () => (hoert.value ? stopp() : start())
    onBeforeUnmount(stopp)

    return { grund, hoert, fehler, start, stopp, schalte }
}
