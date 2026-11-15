/**
 * Ein Gespräch mit dem KI-Coach — der gemeinsame Kern aller Chat-Flächen.
 *
 * Die Seitenleiste (`components/ki/KiCoachLeiste.vue`) und der Chat im
 * Chart-Arbeitsplatz (`components/chart/KiChat.vue`) sprechen mit derselben
 * Route `POST /api/ai/agent/chat` und lesen denselben Ereignisstrom. Bis zum
 * Umbau hatte jede Fläche ihre eigene Kopie von Senden, Zeilenleser und
 * Fehlerbehandlung — und die der KI-Coach-Seite prüfte `response.ok` nicht:
 * ein 429 (anderer Lauf noch nicht fertig) blieb ohne jede Meldung.
 *
 * Jeder Aufruf liefert einen EIGENEN Zustand; zwei Flächen teilen sich nichts
 * ausser dem Server, der ohnehin nur einen Lauf gleichzeitig zulässt.
 *
 * @param {object} wahl
 * @param {() => object} [wahl.kontext]  Zusatz zum Anfragekörper (Seite, Chart), beim Senden gelesen
 * @param {(schluessel: string) => string} wahl.t  Übersetzer
 * @param {(id: number|null) => void} [wahl.beiSitzung]  wird gerufen, wenn sich die Gesprächs-ID ändert
 * @param {() => void} [wahl.beiFertig]  nach einem abgeschlossenen Lauf
 */
import { ref } from 'vue'
import axios from 'axios'

export function useKiGespraech({ kontext = () => ({}), t, beiSitzung = null, beiFertig = null } = {}) {
    const nachrichten = ref([])     // [{ role: 'user'|'assistant'|'tool', content, toolName? }]
    const schritte = ref([])        // Werkzeugschritte des laufenden Laufs
    const eingabe = ref('')
    const laeuft = ref(false)
    const fehler = ref('')
    const sitzungId = ref(null)
    let abbruch = null
    // Zählt Gesprächswechsel: eine Antwort, die nach „Neuer Chat" oder einem
    // Wechsel des Gesprächs eintrifft, gehört nicht mehr in die Ansicht.
    let lauf = 0

    function setzeSitzung(id) {
        if (sitzungId.value === id) return
        sitzungId.value = id
        beiSitzung?.(id)
    }

    function verarbeite(e) {
        switch (e.type) {
            case 'session': setzeSitzung(e.sessionId); break
            case 'thinking': schritte.value.push({ type: 'thinking', iteration: e.iteration }); break
            case 'tool_call': schritte.value.push({ type: 'tool_call', name: e.name, params: e.params }); break
            case 'tool_result': schritte.value.push({ type: 'tool_result', name: e.name, resultPreview: e.resultPreview }); break
            case 'warning': schritte.value.push({ type: 'warning', content: e.content }); break
            case 'answer': nachrichten.value.push({ role: 'assistant', content: e.content, createdAt: new Date().toISOString() }); break
            case 'error': fehler.value = e.content; break
            case 'done': beiFertig?.(); break
        }
    }

    /** Sendet `text` (oder das Eingabefeld). Tut nichts, solange ein Lauf offen ist. */
    async function sende(text) {
        const frage = String(text ?? eingabe.value).trim()
        if (!frage || laeuft.value) return
        eingabe.value = ''
        fehler.value = ''
        schritte.value = []
        nachrichten.value.push({ role: 'user', content: frage, createdAt: new Date().toISOString() })
        laeuft.value = true
        const meinLauf = ++lauf
        abbruch = new AbortController()
        try {
            let zusatz = {}
            try { zusatz = kontext() || {} } catch { zusatz = {} }
            const antwort = await fetch('/api/ai/agent/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abbruch.signal,
                body: JSON.stringify({ sessionId: sitzungId.value, message: frage, ...zusatz }),
            })
            // 429: ein anderer Lauf (zweites Fenster, Chart-Chat) ist noch nicht fertig.
            if (!antwort.ok) {
                const j = await antwort.json().catch(() => ({}))
                fehler.value = antwort.status === 429 ? t('kiCoach.belegt') : (j.error || `HTTP ${antwort.status}`)
                return
            }
            const leser = antwort.body.getReader()
            const dekoder = new TextDecoder()
            let puffer = ''
            for (;;) {
                const { done, value } = await leser.read()
                if (done) break
                puffer += dekoder.decode(value, { stream: true })
                const zeilen = puffer.split('\n')
                puffer = zeilen.pop()
                for (const z of zeilen) {
                    if (!z.startsWith('data: ')) continue
                    let e
                    try { e = JSON.parse(z.slice(6)) } catch { continue }
                    if (meinLauf !== lauf) return
                    verarbeite(e)
                }
            }
        } catch (e) {
            // Ein Abbruch (Seitenwechsel, neues Gespräch) ist kein Fehler.
            if (e.name !== 'AbortError' && meinLauf === lauf) fehler.value = e.message
        } finally {
            if (meinLauf === lauf) {
                laeuft.value = false
                schritte.value = []
            }
            abbruch = null
        }
    }

    /** Bricht einen offenen Lauf ab; der Server beendet ihn dann ebenfalls. */
    function abbrechen() {
        abbruch?.abort()
        lauf++
        laeuft.value = false
        schritte.value = []
    }

    /** Leeres Gespräch; der Server legt es erst mit der ersten Nachricht an. */
    function neu() {
        abbrechen()
        setzeSitzung(null)
        nachrichten.value = []
        fehler.value = ''
        eingabe.value = ''
    }

    /** Lädt ein gespeichertes Gespräch. `false`, wenn es das nicht mehr gibt. */
    async function lade(id) {
        abbrechen()
        try {
            const { data } = await axios.get(`/api/ai/agent/sessions/${id}`)
            nachrichten.value = data.messages || []
            fehler.value = ''
            setzeSitzung(id)
            return true
        } catch (e) {
            if (e.response?.status === 404) { neu(); return false }
            fehler.value = t('kiCoach.ladeFehler')
            return false
        }
    }

    return { nachrichten, schritte, eingabe, laeuft, fehler, sitzungId, sende, abbrechen, neu, lade }
}
