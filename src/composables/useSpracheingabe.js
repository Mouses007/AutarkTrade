/**
 * Spracheingabe — zwei Wege, gewählt unter Einstellungen › KI › Zugang › Spracheingabe
 * (`settings.spracheArt`):
 *
 * `browser` (Voreinstellung): die eingebaute Erkennung (`SpeechRecognition`, in
 * Chrome/Edge/Safari als `webkitSpeechRecognition`). Sofort da, ohne Kosten.
 * Chrome schickt den Ton dafür an Google — das sagt die Oberfläche dem Nutzer
 * einmal (`kiCoach.mikroHinweis`). Brave, Chromium aus der Paketquelle, Vivaldi
 * und Opera haben die Schnittstelle, aber keinen Zugang zum Dienst: sie melden
 * nur `network` (16.11.2026). Firefox hat sie gar nicht.
 *
 * `openai` | `eigen`: der Browser nimmt selbst auf (`MediaRecorder`), beim
 * Ausschalten geht die Aufnahme an `POST /api/sprache/umschrift`, und der
 * Server lässt sie umschreiben (OpenAI oder ein eigener Whisper-Dienst, siehe
 * `server/sprache-kern.js`). Geht in jedem Browser mit Mikrofon; der Text kommt
 * erst nach dem Ausschalten, nicht Wort für Wort.
 *
 * Beide brauchen einen sicheren Kontext (https oder localhost): über
 * http://<LAN-Adresse> ist `grund === 'keinHttps'`.
 *
 * @param {object} wahl
 * @param {(text: string) => void} wahl.beiText  bekommt bei jedem Zwischenstand den GANZEN bisher erkannten Text
 * @param {() => string} [wahl.sprache]  BCP-47-Sprache, z. B. 'de-CH'
 * @param {() => string} [wahl.art]  'browser' | 'server' — Vorgabe aus den Einstellungen
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { appEinstellungen } from '../stores/app/rahmen.js'

/** Längste Aufnahme für den Server: danach endet sie von selbst (≈ 1–2 MB Opus). */
const MAX_AUFNAHME_MS = 5 * 60_000

function erkennerKlasse() {
    if (typeof window === 'undefined') return null
    return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

/** 'server', wenn in den Einstellungen OpenAI oder ein eigener Dienst gewählt ist, sonst 'browser'. */
export function eingestellteArt() {
    const a = appEinstellungen.value?.spracheArt
    return a === 'openai' || a === 'eigen' ? 'server' : 'browser'
}

function kannAufnehmen() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
        && typeof globalThis.MediaRecorder !== 'undefined'
}

/** Warum die Spracheingabe hier nicht geht — oder null, wenn sie geht. */
export function spracheingabeGrund(art = 'browser') {
    if (typeof window === 'undefined') return 'keinBrowser'
    if (!window.isSecureContext) return 'keinHttps'
    if (art === 'server') return kannAufnehmen() ? null : 'keinAufnahme'
    if (!erkennerKlasse()) return 'keinBrowser'
    return null
}

/** Titel des Mikrofon-Knopfs (für beide Chats gleich). */
export function mikroTitelText(s, t) {
    if (s.grund.value === 'keinHttps') return t('kiCoach.mikroKeinHttps')
    if (s.grund.value === 'keinBrowser') return t('kiCoach.mikroKeinBrowser')
    if (s.grund.value === 'keinAufnahme') return t('kiCoach.mikroKeinAufnahme')
    if (s.arbeitet.value) return t('kiCoach.mikroArbeitet')
    return s.hoert.value ? t('kiCoach.mikroStopp') : t('kiCoach.mikroStart')
}

/** Fehlermeldung unter dem Chat, '' = keine. */
export function mikroFehlerText(code, t, te) {
    if (!code) return ''
    if (code === 'verweigert') return t('kiCoach.mikroVerweigert')
    // Brave & Co.: Schnittstelle da, Dienst nicht erreichbar → auf den Server-Weg zeigen
    if (code === 'network') return t('kiCoach.mikroNetz')
    if (code === 'keinMikrofon') return t('kiCoach.mikroKeinMikrofon')
    if (code.startsWith('server_')) {
        const k = `kiCoach.mikroServer.${code.slice(7)}`
        return te(k) ? t(k) : t('kiCoach.mikroServer.unbekannt', { grund: code.slice(7) })
    }
    return t('kiCoach.mikroFehler', { grund: code })
}

/** App-Sprache → Sprache der Erkennung. Deutsch als Schweizer Hochdeutsch, wenn der Browser so eingestellt ist. */
export function erkennungsSprache(appSprache, browserSprache = (typeof navigator !== 'undefined' ? navigator.language : '')) {
    const kurz = String(appSprache || 'de').slice(0, 2).toLowerCase()
    if (String(browserSprache || '').toLowerCase().startsWith(kurz + '-')) return browserSprache
    return kurz === 'en' ? 'en-US' : 'de-DE'
}

export function useSpracheingabe({ beiText, sprache = () => 'de-DE', art = eingestellteArt } = {}) {
    // berechnet, nicht einmalig: die Einstellungen kommen oft erst nach dem Einhängen an
    const grund = computed(() => spracheingabeGrund(art()))
    const hoert = ref(false)
    const arbeitet = ref(false)  // Server-Weg: Aufnahme ist unterwegs zur Umschrift
    const fehler = ref('')       // '' | 'verweigert' | 'keinMikrofon' | 'server_<code>' | sonstiger Fehlercode des Browsers
    let erkenner = null

    /**
     * Aufnahme beenden und alles verwerfen, was der Erkenner noch nachliefert (BUG-R-209).
     * Für Senden, Gesprächswechsel und Aushängen: `stop()` liesse den Browser das
     * Endergebnis nachreichen — der eben gesendete Text stünde wieder im Feld.
     */
    function stoppBrowser() {
        const alter = erkenner
        erkenner = null       // ab jetzt gehört kein Ereignis des alten Erkenners mehr hierher
        try { alter?.abort() } catch { /* schon beendet */ }
        hoert.value = false
    }

    /** Mikrofon-Knopf aus: der Browser darf das Endergebnis des Gesagten noch liefern. */
    function pauseBrowser() {
        try { erkenner?.stop() } catch { /* schon beendet */ }
        hoert.value = false
    }

    function startBrowser() {
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

    // ── Server-Weg: selbst aufnehmen, beim Ausschalten umschreiben lassen ──────
    // `gen` zählt jeden Abbruch (stopp): eine Aufnahme oder Antwort aus einer
    // älteren Generation wirkt nicht mehr (wie BUG-R-209 beim Browser-Weg).
    let gen = 0
    let aufnahme = null
    let anfrage = null

    async function startServer() {
        const meine = ++gen
        hoert.value = true
        fehler.value = ''
        let strom
        try {
            strom = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (e) {
            if (meine !== gen) return
            hoert.value = false
            fehler.value = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'verweigert' : 'keinMikrofon'
            return
        }
        // Inzwischen abgebrochen oder schon wieder ausgeschaltet: Mikrofon gleich wieder frei
        if (meine !== gen || !hoert.value) { strom.getTracks().forEach((t) => t.stop()); return }
        const MR = globalThis.MediaRecorder
        const typ = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
            .find((x) => MR.isTypeSupported?.(x)) || ''
        let rec
        try {
            rec = new MR(strom, typ ? { mimeType: typ } : undefined)
        } catch (e) {
            strom.getTracks().forEach((t) => t.stop())
            hoert.value = false
            fehler.value = String(e?.name || 'unbekannt')
            return
        }
        const diese = { rec, teile: [], beginn: Date.now(), verworfen: false, uhr: null, typ: rec.mimeType || typ }
        aufnahme = diese
        rec.ondataavailable = (e) => { if (e.data?.size) diese.teile.push(e.data) }
        rec.onstop = () => {
            clearTimeout(diese.uhr)
            strom.getTracks().forEach((t) => t.stop())
            if (aufnahme === diese) aufnahme = null
            if (!diese.verworfen) schicke(diese, meine)
        }
        rec.start(1000)
        diese.uhr = setTimeout(() => pauseServer(), MAX_AUFNAHME_MS)
    }

    function pauseServer() {
        hoert.value = false
        const a = aufnahme
        if (a && a.rec.state !== 'inactive') { try { a.rec.stop() } catch { /* schon beendet */ } }
    }

    function stoppServer() {
        gen++
        const a = aufnahme
        aufnahme = null
        if (a) {
            a.verworfen = true
            try { if (a.rec.state !== 'inactive') a.rec.stop() } catch { /* schon beendet */ }
        }
        try { anfrage?.abort() } catch { /* egal */ }
        anfrage = null
        hoert.value = false
        arbeitet.value = false
    }

    async function schicke(diese, meine) {
        const blob = new Blob(diese.teile, { type: diese.typ || 'audio/webm' })
        if (blob.size < 200) return             // nichts aufgenommen
        const sekunden = ((Date.now() - diese.beginn) / 1000).toFixed(1)
        const kontrolle = new AbortController()
        anfrage = kontrolle
        arbeitet.value = true
        try {
            const r = await fetch(`/api/sprache/umschrift?sprache=${encodeURIComponent(sprache())}&sekunden=${sekunden}`, {
                method: 'POST',
                body: blob,
                headers: { 'Content-Type': blob.type || 'audio/webm' },
                credentials: 'same-origin',
                signal: kontrolle.signal,
            })
            const j = await r.json().catch(() => ({}))
            if (meine !== gen) return
            if (!r.ok) { fehler.value = `server_${j.fehler || r.status}`; return }
            const text = String(j.text || '').trim()
            if (text) beiText?.(text)
        } catch (e) {
            if (meine !== gen || e?.name === 'AbortError') return
            fehler.value = 'server_nichtErreichbar'
        } finally {
            if (anfrage === kontrolle) anfrage = null
            if (meine === gen) arbeitet.value = false
        }
    }

    // ── gemeinsame Schnittstelle ────────────────────────────────────────────
    const istServer = () => art() === 'server'

    /** Aufnahme beenden und alles verwerfen, was noch nachkommt (Senden, Gesprächswechsel, Aushängen). */
    function stopp() {
        stoppBrowser()
        stoppServer()
    }

    /** Mikrofon-Knopf aus: das Gesagte wird noch fertig erkannt bzw. umgeschrieben. */
    function pause() {
        if (aufnahme || (istServer() && hoert.value)) pauseServer()
        else pauseBrowser()
    }

    function start() {
        const a = art()
        if (spracheingabeGrund(a) || hoert.value || arbeitet.value) return
        if (a === 'server') startServer()
        else startBrowser()
    }

    const schalte = () => (hoert.value ? pause() : start())
    onBeforeUnmount(stopp)

    return { grund, hoert, arbeitet, fehler, start, stopp, schalte }
}
