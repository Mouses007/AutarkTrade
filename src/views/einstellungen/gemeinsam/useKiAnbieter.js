/**
 * KI-Zugang, Anbieter- und Modelllisten, Wahl je KI-Funktion.
 *
 * Modul-Singleton: Zugang (KI → Allgemein), Berichte, Agent, Strategie,
 * Nachrichten und Bilder lesen dieselben Refs. Geladen wird beim Öffnen des
 * KI-Bereichs (`ladeKiGrundlagen` in EinstellungenKi.vue) — vorher lief das
 * bei jedem Aufruf der Einstellungen mit, auch wenn niemand den Bereich ansah.
 *
 * Funktionen, die übersetzen, stecken in `useKiAnbieter()` (braucht
 * `useI18n()` aus einem setup); der Zustand liegt auf Modulebene.
 */
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { dbUpdateSettings } from '@/utils/db.js'
import { appEinstellungen } from '@/stores/settings.js'

/* KI-AGENT SETTINGS */
export let aiProvider = ref('ollama')
export let aiModel = ref('')
// Schlüssel je Anbieter — die Schlüssel selbst kommen maskiert vom Server und
// werden nur zurückgeschickt, wenn sie tatsächlich geändert wurden.
export let aiKeys = reactive({})
export let aiOllamaUrl = ref('http://localhost:11434')
export let aiCustomUrl = ref('')
export let aiQwenUrl = ref('')
// Zweiter OpenAI-kompatibler Endpunkt (interne ID `deepseek`, S12).
export let aiDeepseekUrl = ref('')
export let aiTemperature = ref(0.7)
export let aiMaxTokens = ref(1500)
export let aiScreenshots = ref(false)
export let aiChatEnabled = ref(true)
export let aiReportPrompt = ref('')
export let aiReportPromptPreset = ref('standard')
export let aiTestLoading = ref(false)
export let aiTestResult = ref(null)
export let ollamaModels = ref([])

// Modell-Listen kommen vom Server (Tabelle `settings`), damit neue Modelle
// nachgetragen werden können, ohne den Quelltext anzufassen.
export const modellListen = ref({})
export const bildModellListen = ref({})
export const bildStandardListen = ref({})

/**
 * Anbieterliste vom Server — Name, Schlüssel-Bezugsquelle und ob der Anbieter
 * ein eigenes Adressfeld braucht. Vorher stand all das ein zweites Mal fest im
 * Template; die beiden Listen sind dabei zuverlässig auseinandergelaufen.
 * Die Rückfallliste greift nur, wenn der Aufruf scheitert — ohne sie stünde
 * die Auswahl leer da.
 */
export const anbieterListe = ref([
    { id: 'ollama', name: 'Ollama (lokal)', keyUrl: '', brauchtKey: false, urlSpalte: '' },
    { id: 'anthropic', name: 'Anthropic (Claude)', keyUrl: '', brauchtKey: true, urlSpalte: '' },
])

/** Modelle, die keine Sampling-Parameter annehmen (Server ist die Quelle). */
export const ohneSampling = ref([])

/* Anbieter und Modell je KI-Funktion. Leer = der global eingestellte Anbieter.
   Gespeichert wird feldweise wie im Marktradar — ein Sammel-Speichern hat dort
   schon einmal einen Schalter mit veraltetem Stand überschrieben. */
export let aiBerichtProvider = ref('')
export let aiBerichtModell = ref('')
export let aiAgentProvider = ref('')
export let aiAgentModell = ref('')
export let aiAgentTokenBudget = ref(80000)
export let modelAnalysisRunning = ref(false)
export let modelAnalysisResult = ref(null)
export let aiTaskProviders = ref({})
/** Zeilen der Aufgaben-Tabelle — vom Server (`AI_TASKS`), nicht von Hand gepflegt. */
export const aufgabenListe = ref([])
export let aiStrategieProvider = ref('')
export let aiStrategieModell = ref('')
export let radarNewsRechercheModell = ref('sonar')

/* Guthaben-Status je Anbieter. Die Anbieter verraten ihr Restguthaben nicht
   über den API-Key — gezeigt wird, was der Server weiss: hinterlegter
   Schlüssel, letzter Guthaben-Fehler, letzter Erfolg. */
export let guthabenListe = ref([])

export function useKiAnbieter() {
    const { t, te, locale } = useI18n()

    /* Beschriftung UND Prompt-Text kommen aus der Übersetzung. Vorher war nur die
       Beschriftung übersetzt, der Prompt selbst stand als deutscher Klartext da —
       ein englischer Nutzer wählte „Strict coach" und bekam eine deutsche
       Anweisung an die KI geschickt. */
    const promptPresets = computed(() => [
        { value: 'custom', label: t('settings.promptCustom'), prompt: '' },
        { value: 'kurz', label: t('settings.promptShort'), prompt: t('settings.promptTextShort') },
        { value: 'standard', label: t('settings.promptStandard'), prompt: t('settings.promptTextStandard') },
        { value: 'coach', label: t('settings.promptCoach'), prompt: t('settings.promptTextCoach') },
        { value: 'psychologie', label: t('settings.promptPsychology'), prompt: t('settings.promptTextPsychology') },
    ])

    function onPromptPresetChange() {
        const preset = promptPresets.value.find(p => p.value === aiReportPromptPreset.value)
        if (preset && preset.value !== 'custom') {
            aiReportPrompt.value = preset.prompt
        }
    }

    // Aktueller Key für den gewählten Provider
    const currentApiKey = computed({
        get: () => aiKeys[aiProvider.value] || '',
        set: (val) => { aiKeys[aiProvider.value] = val }
    })

    async function loadModelLists() {
        try {
            const r = await axios.get('/api/ai/models')
            modellListen.value = r.data.modelle || {}
            aufgabenListe.value = r.data.aufgaben || []
            // Getrennt gehalten: `bildModelle` (FLUX/Gemini-Bild) landet NICHT in
            // `modellListen` — das speist u.a. `AnbieterWahl.vue`, die ihre
            // Anbieter-Auswahl per `Object.keys(modellListen)` bildet. Ein
            // Bild-Anbieter dort tauchte sonst in der Auswahl für Berichte/Agent/
            // Strategie/Radar auf, obwohl er dort nichts beitragen kann.
            bildModellListen.value = r.data.bildModelle || {}
            bildStandardListen.value = r.data.bildStandard || {}
            ohneSampling.value = r.data.ohneSampling || []
            if (Array.isArray(r.data.anbieter) && r.data.anbieter.length) {
                anbieterListe.value = r.data.anbieter
            }
        } catch (e) {
            modellListen.value = {}
            bildModellListen.value = {}
        }
    }

    /** Angaben zum gewählten Anbieter (Name, Key-Quelle, Adressfeld). */
    const aktuellerAnbieter = computed(
        () => anbieterListe.value.find((a) => a.id === aiProvider.value) || null,
    )

    /**
     * Adressfeld des gewählten Anbieters. Zwei Anbieter haben eines: der eigene
     * (dort Pflicht) und Qwen (dort nur eine Vorbelegung, weil Alibaba
     * internationalen Konten arbeitsbereichs-eigene Hosts vergibt).
     */
    const anbieterUrl = computed({
        get() {
            const feld = aktuellerAnbieter.value?.urlSpalte
            if (feld === 'aiQwenUrl') return aiQwenUrl.value
            if (feld === 'aiDeepseekUrl') return aiDeepseekUrl.value
            if (feld === 'aiCustomUrl') return aiCustomUrl.value
            return ''
        },
        set(wert) {
            const feld = aktuellerAnbieter.value?.urlSpalte
            if (feld === 'aiQwenUrl') aiQwenUrl.value = wert
            else if (feld === 'aiDeepseekUrl') aiDeepseekUrl.value = wert
            else if (feld === 'aiCustomUrl') aiCustomUrl.value = wert
        },
    })

    /** Die Liste des Anbieters, ohne Zutaten. */
    function providerListe() {
        return aiProvider.value === 'ollama'
            ? ollamaModels.value
            : (modellListen.value[aiProvider.value] || [])
    }

    function getModelsForProvider() {
        const liste = providerListe()
        // Ein gespeichertes Modell, das nicht (mehr) in der Liste steht, würde das
        // Auswahlfeld leer erscheinen lassen — und beim nächsten Speichern still
        // verschwinden. Also mit anzeigen, statt es zu verlieren.
        if (aiModel.value && !liste.includes(aiModel.value)) return [aiModel.value, ...liste]
        return liste
    }

    const modellOhneTemperatur = computed(
        () => ohneSampling.value.some((p) => String(aiModel.value || '').startsWith(p)),
    )

    /** Nach dem Bearbeiten der Liste: die Auswahl gültig halten. */
    /*
     * `anbieter` kommt seit dem Umbau des ModelManagers mit: Dort laesst sich
     * jetzt die Liste JEDES Anbieters ansehen und bearbeiten, ohne den
     * Hauptanbieter zu wechseln. Ohne das zweite Argument landete die Liste des
     * gerade angesehenen Anbieters unter dem Hauptanbieter.
     *
     * Das Modell darunter wird nur nachgezogen, wenn tatsaechlich die Liste des
     * HAUPTANBIETERS bearbeitet wurde -- sonst spraenge die Auswahl um, weil
     * jemand bei einem ganz anderen Anbieter aufgeraeumt hat.
     */
    function modelleGeaendert(liste, anbieter = aiProvider.value) {
        if (anbieter === 'ollama') ollamaModels.value = liste
        else modellListen.value = { ...modellListen.value, [anbieter]: liste }
        if (anbieter === aiProvider.value && !liste.includes(aiModel.value)) aiModel.value = liste[0] || ''
    }

    async function loadOllamaModels() {
        try {
            const res = await axios.get('/api/ollama/status', { params: { url: aiOllamaUrl.value } })
            ollamaModels.value = res.data.models || []
        } catch (e) {
            ollamaModels.value = []
        }
    }

    async function toggleAiEnabled(enabled) {
        try {
            const val = enabled ? 1 : 0
            await dbUpdateSettings({ aiEnabled: val })
            appEinstellungen.value.aiEnabled = val
        } catch (error) {
            console.error('Fehler beim Speichern der KI-Einstellung:', error)
        }
    }

    async function saveAiSettings() {
        try {
            const antwort = await axios.post('/api/ai/settings', {
                aiProvider: aiProvider.value,
                aiModel: aiModel.value,
                aiOllamaUrl: aiOllamaUrl.value || 'http://localhost:11434',
                aiCustomUrl: aiCustomUrl.value.trim(),
                aiQwenUrl: aiQwenUrl.value.trim(),
                aiDeepseekUrl: aiDeepseekUrl.value.trim(),
                aiTemperature: parseFloat(aiTemperature.value) || 0.7,
                aiMaxTokens: parseInt(aiMaxTokens.value) || 1500,
                aiScreenshots: aiScreenshots.value,
                aiChatEnabled: aiChatEnabled.value,
                aiReportPrompt: aiReportPrompt.value,
                // Alle bekannten Anbieter mitschicken — der Server ignoriert
                // maskierte Werte. Vorher war die Liste hier fest verdrahtet, und
                // der Schlüssel des eigenen Anbieters kam nie an.
                keys: { ...aiKeys },
            })
            appEinstellungen.value.aiProvider = aiProvider.value
            appEinstellungen.value.aiModel = aiModel.value
            appEinstellungen.value.aiOllamaUrl = aiOllamaUrl.value
            appEinstellungen.value.aiTemperature = aiTemperature.value
            appEinstellungen.value.aiMaxTokens = aiMaxTokens.value
            console.log(' -> KI-Einstellungen gespeichert')
            // Adresse geändert ohne neuen Schlüssel: der Server hat den alten
            // geleert (er ginge sonst an die neue Adresse, Audit A2-05).
            aiTestResult.value = antwort.data?.schluesselGeleert?.length
                ? { success: false, message: t('settings.schluesselGeleert') }
                : { success: true, message: t('common.saved') }
            setTimeout(() => aiTestResult.value = null, 3000)
            // Maskierte Keys neu laden
            await loadAiSettings()
        } catch (error) {
            alert(t('common.errorSaving') + error.message)
        }
    }

    async function testAiConnection() {
        aiTestLoading.value = true
        aiTestResult.value = null
        try {
            const res = await axios.post('/api/ai/test', {
                provider: aiProvider.value,
                apiKey: currentApiKey.value,
                model: aiModel.value,
                ollamaUrl: aiOllamaUrl.value,
                // Erlaubt den Test einer noch nicht gespeicherten Adresse.
                basisUrl: anbieterUrl.value.trim(),
            })
            aiTestResult.value = res.data
            // Nach erfolgreichem Ollama-Test Modelle neu laden
            if (aiProvider.value === 'ollama' && res.data.success) {
                await loadOllamaModels()
                if (!aiModel.value && ollamaModels.value.length > 0) {
                    aiModel.value = ollamaModels.value[0]
                }
            }
        } catch (e) {
            aiTestResult.value = { success: false, message: e.message }
        }
        aiTestLoading.value = false
    }

    function onProviderChange() {
        // Bewusst die rohe Liste: `getModelsForProvider()` stellt das gespeicherte
        // Modell voran, und das gehört zum ALTEN Anbieter — sonst stünde nach dem
        // Wechsel auf DeepSeek weiterhin ein Claude-Modell im Feld.
        const models = providerListe()
        aiModel.value = models.length > 0 ? models[0] : ''
        aiTestResult.value = null
        if (aiProvider.value === 'ollama') {
            loadOllamaModels()
            loadModelLists()
        }
    }

    /* Anbietername in der Sprache der Oberfläche. Die Namen kommen aus dem
       Anbieter-Register des Servers und sind dort deutsch beschriftet; nur die
       zwei generischen Einträge brauchen eine Übersetzung — „Anthropic (Claude)"
       heisst überall gleich. */
    function anbieterName(a) {
        if (a?.id === 'ollama') return t('settings.ki.provOllama')
        if (a?.id === 'custom') return t('settings.ki.provCustom')
        if (a?.id === 'deepseek') return t('kiHinweis.namen.endpunkt2')
        return a?.name || ''
    }

    /* Zeitpunkt in der Sprache der Oberfläche. Vorher stand hier fest 'de-CH' —
       auf Englisch gestellt blieb das Datum trotzdem schweizerdeutsch formatiert. */
    function zeitpunkt(ms) {
        return new Date(ms).toLocaleString(locale.value === 'en' ? 'en-GB' : 'de-CH',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    }
    async function ladeGuthaben() {
        try {
            const { data } = await axios.get('/api/ai/guthaben')
            guthabenListe.value = data.anbieter || []
        } catch (e) {
            guthabenListe.value = []
        }
    }

    /*
     * Einen Guthaben-Vermerk verwerfen.
     *
     * Nötig, weil ein Vermerk sonst nur durch einen GELUNGENEN Aufruf desselben
     * Anbieters verschwindet — bei einem, den man nicht mehr benutzt, also nie.
     * Danach steht der Anbieter auf „kein Vermerk", nicht auf „ok": Zurücknehmen
     * ist keine Zusage.
     */
    async function guthabenZuruecksetzen(id) {
        try {
            await axios.post('/api/ai/guthaben/zuruecksetzen', { provider: id })
            await ladeGuthaben()
            aiTestResult.value = { success: true, message: t('settings.ki.quotaResetDone') }
        } catch (e) {
            aiTestResult.value = { success: false, message: e.response?.data?.error || e.message }
        }
        setTimeout(() => { aiTestResult.value = null }, 4000)
    }

    /* Bereichsnamen der Unter-Reiter — dieselben Beschriftungen wie die Reiterreihe
       der KI-Einstellungen, damit „betrifft: Strategie" auch dorthin zeigt. */
    function bereichsNamen(g) {
        // `te()` vor `t()`: Ein Bereich ohne Reiter (etwa „allgemein" für die
        // Radar-Kacheln) darf keinen rohen Schlüssel auf die Seite schreiben.
        return (g?.bereiche || [])
            .map(b => (te('settings.ki.tab_' + b) ? t('settings.ki.tab_' + b) : b))
            .join(', ')
    }

    async function loadAiSettings() {
        try {
            const res = await axios.get('/api/ai/settings')
            const s = res.data
            aiProvider.value = s.aiProvider || 'ollama'
            aiModel.value = s.aiModel || ''
            aiOllamaUrl.value = s.aiOllamaUrl || 'http://localhost:11434'
            aiCustomUrl.value = s.aiCustomUrl || ''
            aiQwenUrl.value = s.aiQwenUrl || ''
            aiDeepseekUrl.value = s.aiDeepseekUrl || ''
            aiTemperature.value = s.aiTemperature ?? 0.7
            aiMaxTokens.value = s.aiMaxTokens || 1500
            aiScreenshots.value = s.aiScreenshots || false
            aiChatEnabled.value = s.aiChatEnabled !== false
            aiReportPrompt.value = s.aiReportPrompt || ''
            // Preset erkennen — Standard wenn kein Prompt gespeichert
            const matchedPreset = promptPresets.value.find(p => p.value !== 'custom' && p.prompt === aiReportPrompt.value)
            if (matchedPreset) {
                aiReportPromptPreset.value = matchedPreset.value
            } else if (!aiReportPrompt.value) {
                aiReportPromptPreset.value = 'standard'
                aiReportPrompt.value = promptPresets.value.find(p => p.value === 'standard').prompt
            } else {
                aiReportPromptPreset.value = 'custom'
            }
            // Anbieter-unabhängig: der Server bestimmt, welche Schlüssel es gibt.
            if (s.keys) {
                for (const [id, wert] of Object.entries(s.keys)) aiKeys[id] = wert || ''
            }
            // Wahl je Funktion kommt aus den allgemeinen Einstellungen, nicht aus
            // /api/ai/settings — dort liegen nur Zugang und globale Vorgaben.
            const cu = appEinstellungen.value || {}
            aiBerichtProvider.value = cu.aiBerichtProvider || ''
            aiBerichtModell.value = cu.aiBerichtModell || ''
            aiAgentProvider.value = cu.aiAgentProvider || ''
            aiAgentModell.value = cu.aiAgentModell || ''
            aiAgentTokenBudget.value = Number(cu.aiAgentTokenBudget) || 80000
            try {
                aiTaskProviders.value = cu.aiTaskProviders ? JSON.parse(cu.aiTaskProviders) : {}
            } catch (_) {
                aiTaskProviders.value = {}
            }
            aiStrategieProvider.value = cu.aiStrategieProvider || ''
            aiStrategieModell.value = cu.aiStrategieModell || ''
            radarNewsRechercheModell.value = cu.radarNewsRechercheModell || 'sonar'
            ladeGuthaben()
        } catch (e) {
            console.error('Fehler beim Laden der KI-Settings:', e)
        }
    }

    /** Was Settings.vue früher in onBeforeMount tat — jetzt beim Öffnen des KI-Bereichs. */
    async function ladeKiGrundlagen() {
        // KI-Settings über verschlüsselten Endpoint laden.
        // `loadModelLists()` MUSS hier mitlaufen: ohne die Listen zeigt das
        // Auswahlfeld nur das gespeicherte Modell, und die Auswahl ist praktisch
        // tot (Anbieter wechseln half nicht — die Listen wurden nur für Ollama
        // nachgeladen).
        await Promise.all([loadAiSettings(), loadModelLists()])
        if (aiProvider.value === 'ollama') {
            await loadOllamaModels()
        }
        // Falls kein Modell gesetzt, Default setzen
        if (!aiModel.value) {
            const models = getModelsForProvider()
            aiModel.value = models.length > 0 ? models[0] : ''
        }
    }

    return {
        // Zustand
        aiProvider, aiModel, aiKeys, aiOllamaUrl, aiCustomUrl, aiQwenUrl, aiDeepseekUrl, aiTemperature, aiMaxTokens,
        aiScreenshots, aiChatEnabled, aiReportPrompt, aiReportPromptPreset, aiTestLoading, aiTestResult,
        ollamaModels, modellListen, bildModellListen, bildStandardListen, anbieterListe, ohneSampling,
        aiBerichtProvider, aiBerichtModell, aiAgentProvider, aiAgentModell, aiAgentTokenBudget,
        modelAnalysisRunning, modelAnalysisResult, aiTaskProviders, aufgabenListe,
        aiStrategieProvider, aiStrategieModell, radarNewsRechercheModell, guthabenListe,
        // Abgeleitetes und Funktionen
        promptPresets, onPromptPresetChange, currentApiKey, loadModelLists, aktuellerAnbieter, anbieterUrl,
        providerListe, getModelsForProvider, modellOhneTemperatur, modelleGeaendert, loadOllamaModels,
        toggleAiEnabled, saveAiSettings, testAiConnection, onProviderChange, anbieterName, zeitpunkt,
        ladeGuthaben, guthabenZuruecksetzen, bereichsNamen, loadAiSettings, ladeKiGrundlagen,
    }
}
