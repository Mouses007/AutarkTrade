<script setup>
import { ref, reactive, onBeforeMount, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { aiReportGenerating, aiReportError, aiReportLastSavedId, aiReportLabel, aiReportCountBefore } from '../stores/settings.js'
import { selectedBroker } from '../stores/filters.js'
import axios from 'axios'
import { useExportReportPdf } from '../utils/pdfExport'
import { sanitizeHtml } from '../utils/sanitize'
import { logError, logWarn } from '../utils/logger.js'
import dayjs from '../utils/journal/zeit.js'
import { sendNotification } from '../utils/notify'
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Reiter from '@/components/basis/Reiter.vue'
import KiHinweis from '@/components/quellen/KiHinweis.vue'

const { t } = useI18n()

// Status
const aiOnline = ref(false)
const aiProvider = ref('ollama')
const aiModel = ref('')
// loading und errorMsg sind global (überleben Tab-Wechsel im SPA)
const loading = aiReportGenerating
const errorMsg = aiReportError

// Zeitraum
const periodType = ref('month')
const selectedMonth = ref(dayjs().format('YYYY-MM'))
const selectedWeekStart = ref(dayjs().startOf('week').format('YYYY-MM-DD'))
const customStart = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const customEnd = ref(dayjs().format('YYYY-MM-DD'))

// Gespeicherte Berichte
const savedReports = reactive([])
const expandedReports = reactive(new Set())
const deleteConfirmId = ref(null)

// Tabs
const currentTab = ref('reports') // 'reports' | 'agent'

// Report-Stil Quick-Selection (alle außer 'custom')
const reportStylePresets = [
    { value: 'kurz', icon: 'blitz', prompt: 'Halte den Bericht kurz und prägnant. Maximal 3-4 Sätze pro Abschnitt. Fokussiere dich auf die wichtigsten Erkenntnisse.' },
    { value: 'standard', icon: 'dokument', prompt: 'Erstelle einen ausgewogenen Trading-Bericht mit allen wichtigen Kennzahlen, Stärken, Schwächen und konkreten Verbesserungsvorschlägen. Nutze eine sachliche, professionelle Sprache.' },
    { value: 'coach', icon: 'schildWarnung', prompt: 'Sei sehr direkt und kritisch. Beschönige nichts. Sprich Schwächen und Fehler klar an. Gib konkrete Verbesserungsvorschläge wie ein strenger Trading-Coach.' },
    { value: 'psychologie', icon: 'gehirn', prompt: 'Lege besonderen Fokus auf die psychologischen Aspekte: Stress, Emotionen, Disziplin, Overtrading. Analysiere Verhaltensmuster und emotionale Trigger.' }
]
const selectedReportStyle = ref('standard')

// Chat
const chatEnabled = ref(true)
const chatMessages = reactive({}) // { reportId: [{ id, role, content, createdAt }] }
const chatInput = reactive({}) // { reportId: 'text' }
const chatLoading = reactive({}) // { reportId: true/false }
const chatError = reactive({}) // { reportId: 'error msg' }

// ==================== AGENT STATE ====================
const agentSessions = reactive([])
const agentCurrentSessionId = ref(null)
// Seite, von der aus der Agent geöffnet wurde (Roboter-Button in Nav.vue,
// ?sourcePage=…) — bleibt für den ganzen Seitenbesuch gültig, auch über
// „+ Neuer Chat" hinweg, und geht mit jeder Nachricht an den Server.
const agentPageContext = ref(null)
const agentMessages = reactive([]) // Current session messages
const agentInput = ref('')
const agentLoading = ref(false)
const agentError = ref('')
const agentSteps = reactive([]) // Live SSE steps during agent run
const agentExpandedTools = reactive(new Set())
const agentDeleteConfirmId = ref(null)

// Mehrfachauswahl + Archiv der Session-Liste. Archivierte Chats verschwinden
// aus der Standardansicht, bleiben aber erhalten — Löschen ist endgültig.
const auswahlModus = ref(false)
const zeigeArchiv = ref(false)
const ausgewaehlteSessions = reactive(new Set())
const bulkLoeschBestaetigung = ref(false)

const sichtbareSessions = computed(() => agentSessions.filter(s => !!s.archiviert === zeigeArchiv.value))

function toggleAuswahlModus() {
    auswahlModus.value = !auswahlModus.value
    ausgewaehlteSessions.clear()
    bulkLoeschBestaetigung.value = false
}

function toggleAuswahl(id) {
    if (ausgewaehlteSessions.has(id)) ausgewaehlteSessions.delete(id)
    else ausgewaehlteSessions.add(id)
    bulkLoeschBestaetigung.value = false
}

// Zwei Klicks wie beim Einzel-Löschen: der erste macht aus dem Knopf die
// Rückfrage, erst der zweite löscht wirklich.
async function loescheAusgewaehlte() {
    if (!bulkLoeschBestaetigung.value) {
        bulkLoeschBestaetigung.value = true
        return
    }
    for (const id of [...ausgewaehlteSessions]) {
        try {
            await axios.delete(`/api/ai/agent/sessions/${id}`)
            const idx = agentSessions.findIndex(s => s.id === id)
            if (idx >= 0) agentSessions.splice(idx, 1)
            if (agentCurrentSessionId.value === id) startNewAgentSession()
        } catch (err) {
            agentError.value = 'Löschen fehlgeschlagen: ' + err.message
        }
    }
    ausgewaehlteSessions.clear()
    bulkLoeschBestaetigung.value = false
}

// Ansicht wechseln heisst neu laden: die Liste kommt gefiltert vom Server.
async function wechsleArchivAnsicht() {
    zeigeArchiv.value = !zeigeArchiv.value
    ausgewaehlteSessions.clear()
    bulkLoeschBestaetigung.value = false
    await loadAgentSessions()
}

async function archiviereAusgewaehlte() {
    // In der Archiv-Ansicht kehrt derselbe Knopf die Richtung um (wiederherstellen).
    const ziel = zeigeArchiv.value ? 0 : 1
    for (const id of [...ausgewaehlteSessions]) {
        try {
            await axios.post(`/api/ai/agent/sessions/${id}/archiv`, { archiviert: ziel })
            const s = agentSessions.find(x => x.id === id)
            if (s) s.archiviert = ziel
        } catch (err) {
            agentError.value = 'Archivieren fehlgeschlagen: ' + err.message
        }
    }
    ausgewaehlteSessions.clear()
    // Die verschobenen Chats gehören jetzt in die andere Ansicht
    await loadAgentSessions()
}

// Chat-Verlauf ans Ende scrollen, sobald etwas dazukommt (eigene Eingabe,
// Werkzeugschritte während des Laufs, Antwort, Sessionwechsel). Ohne das
// verschwindet die Antwort unterhalb des sichtbaren Bereichs und man scrollt
// nach jeder Frage von Hand hinterher.
const agentChatEl = ref(null)
watch(
    [() => agentMessages.length, () => agentSteps.length, agentCurrentSessionId, agentLoading],
    async () => {
        await nextTick()
        if (agentChatEl.value) agentChatEl.value.scrollTop = agentChatEl.value.scrollHeight
    }
)

// Token-Verbrauch pro Provider (nur Reports auf dieser Seite)
const tokensByProvider = computed(() => {
    const result = {}
    for (const r of savedReports) {
        const p = r.provider || 'unknown'
        if (r.totalTokens > 0) {
            result[p] = (result[p] || 0) + (r.totalTokens || 0)
        }
    }
    return result
})

// Globale Token-Statistik (alle Quellen: Reports + Chat + Trade-Reviews + Screenshot-Reviews)
const globalTokenStats = ref(null)

async function loadGlobalTokenStats() {
    try {
        const res = await axios.get('/api/ai/token-stats')
        globalTokenStats.value = res.data
    } catch (e) {
        logWarn('ki-agent', 'Token-Stats konnten nicht geladen werden', e)
    }
}

/*
 * Preise kommen vom Server.
 *
 * Hier stand eine zweite Preistabelle neben der in `server/ai-preise.js` — und
 * die beiden widersprachen sich: DeepSeek und Grok waren hier anders
 * ausgezeichnet als dort, das Journal nannte also je nach Blickwinkel zwei
 * verschiedene Kosten für denselben Lauf. Eine Liste, ein Preis.
 */
const preise = ref({})

async function ladePreise() {
    try {
        const res = await axios.get('/api/ai/preise')
        preise.value = res.data?.preise || {}
    } catch (e) {
        logWarn('ki-agent', 'Preisliste konnte nicht geladen werden', e)
    }
}

/**
 * Preis eines Modells, gleiche Regel wie auf dem Server: Treffer über
 * `includes`, längere Schlüssel zuerst. Unbekannt heisst 0 und nicht
 * „irgendwas" — vorher stand hier ein Rückfall auf 5/15 $, der jedem lokal
 * gerechneten Ollama-Modell Kosten andichtete, die es nie gab.
 */
function modellPreis(model) {
    const m = String(model || '')
    const treffer = Object.keys(preise.value).find((k) => m.includes(k))
    return treffer ? preise.value[treffer] : null
}

// Gesamtkosten berechnen (aus globalTokenStats — alle Quellen inkl. Agent)
const estimatedCostByProvider = computed(() => {
    const result = {}
    const bp = globalTokenStats.value?.byProvider || {}
    for (const [provider, data] of Object.entries(bp)) {
        let cost = 0
        for (const [model, mData] of Object.entries(data.models || {})) {
            const price = modellPreis(model)
            if (!price) continue
            cost += (mData.promptTokens || 0) / 1_000_000 * price[0]
            cost += (mData.completionTokens || 0) / 1_000_000 * price[1]
        }
        if (cost > 0) result[provider] = cost
    }
    return result
})

/*
 * Ohne Aufschlag. Hier lagen pauschal 58 000 Token und 0,50 $ obendrauf —
 * gedacht als Nachtrag für die Zeit vor der Zählung, in der Wirkung aber ein
 * Betrag, den niemand mehr zuordnen konnte und der jede kleine Rechnung
 * verfälschte. Gezeigt wird, was gemessen wurde.
 */
const totalEstimatedCost = computed(() => {
    return Object.values(estimatedCostByProvider.value).reduce((sum, c) => sum + c, 0)
})

// Zeitraum als Unix berechnen
const dateRange = computed(() => {
    const type = periodType.value
    if (type === 'week') {
        const start = dayjs(selectedWeekStart.value).startOf('day')
        const end = start.add(6, 'day').endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: t('kiAgent.weekLabel', { range: `${start.format('DD.MM.')} – ${end.format('DD.MM.YYYY')}` })
        }
    } else if (type === 'month') {
        const start = dayjs(selectedMonth.value + '-01').startOf('day')
        const end = start.endOf('month')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: start.format('MMMM YYYY')
        }
    } else if (type === 'halfyear') {
        const now = dayjs()
        const start = now.subtract(6, 'month').startOf('day')
        const end = now.endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: `${start.format('DD.MM.YYYY')} – ${end.format('DD.MM.YYYY')}`
        }
    } else if (type === 'year') {
        const start = dayjs().startOf('year')
        const end = dayjs().endOf('day')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: t('kiAgent.yearLabel', { year: start.format('YYYY') })
        }
    } else {
        return {
            startDate: dayjs(customStart.value).startOf('day').unix(),
            endDate: dayjs(customEnd.value).endOf('day').unix(),
            label: `${dayjs(customStart.value).format('DD.MM.YYYY')} – ${dayjs(customEnd.value).format('DD.MM.YYYY')}`
        }
    }
})

// Provider-Label. Die ID `deepseek` ist seit S12 der neutrale „OpenAI-kompatible
// Endpunkt 2" (Verkaufs-Prüfung 89d: kein Name ohne Erlaubnis) — alte Berichte
// tragen die ID weiter, angezeigt wird der neutrale Name.
const PROVIDER_LABELS = {
    ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini',
    mistral: 'Mistral', xai: 'Grok (xAI)', qwen: 'Qwen', custom: 'Eigener Anbieter',
    deepseek: 'OpenAI-kompatibler Endpunkt 2',
}
const providerLabel = computed(() => PROVIDER_LABELS[aiProvider.value] || aiProvider.value)

// Modell-Label (kurzer Name für Badge)
const modelLabel = computed(() => {
    if (!aiModel.value) return providerLabel.value
    // Kürze lange Modellnamen: "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"
    let name = aiModel.value
    name = name.replace(/[-:]\d{8,}$/, '') // Entferne Datums-Suffixe
    return name
})

// KI Status prüfen
async function checkStatus() {
    try {
        const res = await axios.get('/api/ai/status')
        aiOnline.value = res.data.online
        aiProvider.value = res.data.provider || 'ollama'
        aiModel.value = res.data.model || ''
    } catch (e) {
        aiOnline.value = false
    }
}

// Gespeicherte Berichte laden (gefiltert nach gewählter Börse)
async function loadReports() {
    try {
        const params = {}
        if (selectedBroker.value) params.broker = selectedBroker.value
        const res = await axios.get('/api/ai/reports', { params })
        savedReports.splice(0, savedReports.length, ...res.data)
    } catch (e) {
        logError('ki-agent', 'Fehler beim Laden der Berichte', e)
    }
}

// Bericht generieren (Server speichert automatisch)
async function generateReport() {
    if (loading.value) return // Doppelklick verhindern

    loading.value = true
    errorMsg.value = ''
    const label = dateRange.value.label
    aiReportLabel.value = label
    aiReportCountBefore.value = savedReports.length

    try {
        // Stil-Prompt für Quick-Selection mitschicken
        const stylePreset = reportStylePresets.find(p => p.value === selectedReportStyle.value)
        const res = await axios.post('/api/ai/report', {
            startDate: dateRange.value.startDate,
            endDate: dateRange.value.endDate,
            label,
            broker: selectedBroker.value || null,
            promptOverride: stylePreset?.prompt || null
        }, { timeout: 600000 })

        // Berichte neu laden und neuen aufklappen
        await loadReports()
        if (res.data.savedId) {
            expandedReports.add(res.data.savedId)
        }

        // Browser-Benachrichtigung
        sendNotification('kiBerichtFertig', t('kiAgent.reportReady'), t('kiAgent.reportCreated', { label }))
    } catch (e) {
        // Server hat evtl. schon gespeichert bevor der Frontend-Request abbrach
        try {
            await loadReports()
        } catch (reloadError) {
            logWarn('ki-agent', 'Berichte konnten nach Fehler nicht neu geladen werden', reloadError)
        }
        errorMsg.value = e.response?.data?.error || e.message || t('kiAgent.errorGenerating')
    }

    loading.value = false
}

// Bericht löschen
async function deleteReport(id) {
    try {
        await axios.delete(`/api/ai/reports/${id}`)
        expandedReports.delete(id)
        deleteConfirmId.value = null
        await loadReports()
    } catch (e) {
        logError('ki-agent', 'Fehler beim Löschen', e)
    }
}

// Bericht auf-/zuklappen
function toggleReport(id) {
    if (expandedReports.has(id)) {
        expandedReports.delete(id)
    } else {
        expandedReports.add(id)
        // Chat-Nachrichten laden wenn noch nicht vorhanden
        if (chatEnabled.value && !chatMessages[id]) {
            loadChatMessages(id)
        }
    }
}

// PDF Export
function downloadPdf(report) {
    if (!report.report) return
    useExportReportPdf(report.report, report.label, report.reportData || null)
}

// Datum formatieren
function formatDate(dateStr) {
    return dayjs(dateStr).format('DD.MM.YYYY HH:mm')
}

// Chat-Nachrichten laden
async function loadChatMessages(reportId) {
    try {
        const res = await axios.get(`/api/ai/reports/${reportId}/messages`)
        chatMessages[reportId] = res.data
    } catch (e) {
        chatMessages[reportId] = []
    }
}

// Chat-Nachricht senden
async function sendChatMessage(reportId) {
    const msg = (chatInput[reportId] || '').trim()
    if (!msg) return

    chatLoading[reportId] = true
    chatError[reportId] = ''

    try {
        const res = await axios.post(`/api/ai/reports/${reportId}/chat`, {
            message: msg
        }, { timeout: 600000 })

        chatInput[reportId] = ''
        // Nachrichten neu laden
        await loadChatMessages(reportId)
    } catch (e) {
        chatError[reportId] = e.response?.data?.error || e.message || t('kiAgent.chatRequestFailed')
    }

    chatLoading[reportId] = false
}

// Chat-Verlauf löschen
async function clearChat(reportId) {
    try {
        await axios.delete(`/api/ai/reports/${reportId}/messages`)
        chatMessages[reportId] = []
    } catch (e) {
        logError('ki-agent', 'Chat löschen fehlgeschlagen', e)
    }
}

// Chat-Setting laden
async function loadChatSetting() {
    try {
        const res = await axios.get('/api/ai/settings')
        chatEnabled.value = res.data.aiChatEnabled !== false
    } catch (e) {
        chatEnabled.value = true
    }
}

// Markdown → HTML (verbesserter Parser)
function markdownToHtml(md) {
    if (!md) return ''
    let html = md
        .replace(/^### (.+)$/gm, '<h5 class="at-mo-2 at-mu-1">$1</h5>')
        .replace(/^## (.+)$/gm, '<h4 class="report-section-title at-mo-3 at-mu-1">$1</h4>')
        .replace(/^# (.+)$/gm, '<h3 class="at-mo-3 at-mu-2">$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul class="at-mu-1">${match}</ul>`)

    // Absätze (leere Blöcke filtern)
    html = html.split('\n\n').map(p => {
        const trimmed = p.trim()
        if (!trimmed) return ''
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul')) return trimmed
        return `<p>${trimmed}</p>`
    }).filter(Boolean).join('\n')

    return sanitizeHtml(html)
}

// ==================== AGENT FUNCTIONS ====================

async function loadAgentSessions() {
    try {
        // Der Server filtert nach Archiv-Zustand, sonst teilen sich beide
        // Ansichten dasselbe 50er-Limit.
        const { data } = await axios.get('/api/ai/agent/sessions', { params: { archiviert: zeigeArchiv.value ? 1 : 0 } })
        agentSessions.splice(0, agentSessions.length, ...data)
    } catch (err) {
        logWarn('KiAgent', 'Failed to load agent sessions: ' + err.message)
    }
}

async function loadAgentSession(sessionId) {
    try {
        const { data } = await axios.get(`/api/ai/agent/sessions/${sessionId}`)
        agentCurrentSessionId.value = sessionId
        agentMessages.splice(0, agentMessages.length, ...(data.messages || []))
        agentSteps.splice(0)
        agentError.value = ''
    } catch (err) {
        agentError.value = 'Session konnte nicht geladen werden: ' + err.message
    }
}

function startNewAgentSession() {
    agentCurrentSessionId.value = null
    agentMessages.splice(0)
    agentSteps.splice(0)
    agentError.value = ''
    agentInput.value = ''
}

async function deleteAgentSession(sessionId) {
    try {
        await axios.delete(`/api/ai/agent/sessions/${sessionId}`)
        const idx = agentSessions.findIndex(s => s.id === sessionId)
        if (idx >= 0) agentSessions.splice(idx, 1)
        if (agentCurrentSessionId.value === sessionId) {
            startNewAgentSession()
        }
        agentDeleteConfirmId.value = null
    } catch (err) {
        agentError.value = 'Löschen fehlgeschlagen: ' + err.message
    }
}

// Läuft gerade ein Agentenlauf, hängt daran ein offener Datenstrom. Verlässt
// man die Seite, muss er abgebrochen werden — sonst liest der Reader in eine
// Ansicht, die es nicht mehr gibt, und der Server schreibt in eine tote
// Verbindung, während der Lauf (und die Modellkosten) weiterlaufen.
let agentAbbruch = null

onBeforeUnmount(() => {
    if (agentAbbruch) agentAbbruch.abort()
})

async function sendAgentMessage() {
    const msg = agentInput.value.trim()
    if (!msg || agentLoading.value) return

    agentInput.value = ''
    agentLoading.value = true
    agentError.value = ''
    agentSteps.splice(0)

    // Add user message to UI immediately
    agentMessages.push({ role: 'user', content: msg, createdAt: new Date().toISOString() })

    agentAbbruch = new AbortController()
    try {
        const response = await fetch('/api/ai/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: agentAbbruch.signal,
            body: JSON.stringify({
                sessionId: agentCurrentSessionId.value,
                message: msg,
                ...(agentPageContext.value ? { pageId: agentPageContext.value } : {})
            })
        })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() // Keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                try {
                    const event = JSON.parse(line.slice(6))
                    handleAgentSSE(event)
                } catch { /* ignore parse errors */ }
            }
        }
    } catch (err) {
        // Ein Abbruch beim Seitenwechsel ist kein Fehler, den man melden müsste.
        if (err.name !== 'AbortError') agentError.value = 'Agent-Fehler: ' + err.message
    } finally {
        agentLoading.value = false
        agentAbbruch = null
    }
}

function handleAgentSSE(event) {
    switch (event.type) {
        case 'session':
            agentCurrentSessionId.value = event.sessionId
            break
        case 'thinking':
            agentSteps.push({ type: 'thinking', iteration: event.iteration })
            break
        case 'tool_call':
            agentSteps.push({ type: 'tool_call', name: event.name, params: event.params })
            break
        case 'tool_result':
            agentSteps.push({ type: 'tool_result', name: event.name, resultPreview: event.resultPreview })
            break
        case 'answer':
            agentMessages.push({ role: 'assistant', content: event.content, createdAt: new Date().toISOString() })
            break
        case 'warning':
            agentSteps.push({ type: 'warning', content: event.content })
            break
        case 'error':
            agentError.value = event.content
            break
        case 'done':
            // Refresh sessions list
            loadAgentSessions()
            break
    }
}

function toggleAgentTool(index) {
    if (agentExpandedTools.has(index)) {
        agentExpandedTools.delete(index)
    } else {
        agentExpandedTools.add(index)
    }
}

function formatToolParams(params) {
    if (!params) return ''
    return Object.entries(params)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ')
}

const route = useRoute()
const vueRouter = useRouter()

// Capture agent prompt from query param BEFORE any async work
const pendingAgentPrompt = route.query.agentPrompt || null
// ?tab=agent: Schnellzugriff aus der Navigationsleiste landet direkt im Chat.
const pendingTab = route.query.tab || null
// ?sourcePage=…: von welcher Seite aus der Roboter-Button gedrückt wurde.
const pendingSourcePage = route.query.sourcePage || null

onBeforeMount(async () => {
    spinnerLoadingPage.value = false

    // Switch tab immediately if agent prompt is pending
    if (pendingAgentPrompt || pendingTab === 'agent') {
        currentTab.value = 'agent'
    }
    if (pendingSourcePage) agentPageContext.value = pendingSourcePage

    // Clean URL immediately (remove query param so it doesn't retrigger)
    if (route.query.agentPrompt || route.query.tab || route.query.sourcePage) {
        vueRouter.replace({ path: route.path })
    }

    // Eine Sperre des Seitenscrollens, die eine vorherige Seite hinterlassen hat, lösen
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('padding-right')

    await Promise.all([checkStatus(), loadChatSetting()])
    await Promise.all([loadReports(), loadGlobalTokenStats(), loadAgentSessions(), ladePreise()])

    // Auto-start agent after data is loaded (use setTimeout for DOM readiness)
    if (pendingAgentPrompt) {
        startNewAgentSession()
        agentInput.value = pendingAgentPrompt
        setTimeout(() => sendAgentMessage(), 150)
    }
})
</script>

<template>
    <SpinnerLoadingPage />
    <div class="at-mo-2">
        <div v-show="!spinnerLoadingPage">

            <!-- Tab-Switcher -->
            <Reiter v-model="currentTab" class="at-mu-3" :reiter="[
                { id: 'reports', titel: t('kiAgent.tabReports'), symbol: 'dokument' },
                { id: 'agent', titel: t('kiAgent.tabAgent'), symbol: 'gehirn' },
            ]" />

            <!-- ==================== REPORTS TAB ==================== -->
            <div v-show="currentTab === 'reports'">

            <!-- Header -->
            <div class="at-flex at-verteilt at-mitte at-mu-3">
                <h5 class="at-mu-0">
                    <Symbol name="dokument" class="at-mr-2" />{{ t('kiAgent.createReport') }}
                </h5>
                <div class="at-flex at-mitte at-luecke-2">
                    <span class="at-gedaempft at-klein" :title="t('kiAgent.totalTokensHint')">
                        <Symbol name="prozessor" class="at-mr-1" />{{ (globalTokenStats?.total?.totalTokens || Object.values(tokensByProvider).reduce((s, v) => s + v, 0) || 0).toLocaleString() }} {{ t('kiAgent.tokens') }}
                    </span>
                    <span v-if="totalEstimatedCost > 0" class="ki-cost-badge" :title="t('kiAgent.estimatedCostTitle', { cost: totalEstimatedCost.toFixed(4) })">
                        <Symbol name="dollar" />~{{ totalEstimatedCost < 0.01 ? totalEstimatedCost.toFixed(4) : totalEstimatedCost.toFixed(2) }}
                        <span class="ki-cost-hint">{{ t('kiAgent.estimated') }}</span>
                    </span>
                    <Pille :ton="aiOnline ? 'gut' : 'schlecht'">
                        {{ aiOnline ? modelLabel + ' ' + t('kiAgent.online') : providerLabel + ' ' + t('kiAgent.offline') }}
                    </Pille>
                    <Knopf klein @click="checkStatus" :title="t('kiAgent.checkStatus')">
                        <Symbol name="aktualisieren" />
                    </Knopf>
                </div>
            </div>

            <!-- Offline Warnung -->
            <div v-if="!aiOnline" class="dailyCard at-mittig at-py-4 at-mu-3">
                <Symbol style="font-size: 2rem;" name="warnung" class="at-warn" />
                <p class="at-mo-2 at-mu-1">{{ t('kiAgent.providerNotReachable') }}</p>
                <small v-if="aiProvider === 'ollama'" class="at-gedaempft">
                    {{ t('kiAgent.ollamaDockerHint') }} <code>docker start ollama</code>
                </small>
                <small v-else class="at-gedaempft" v-html="t('kiAgent.checkApiKey', { link: '<a href=\'/settings/ki\'>' + t('nav.settings') + '</a>' })">
                </small>
            </div>

            <!-- Konfiguration -->
            <div v-if="aiOnline" class="dailyCard at-mu-3" style="height: auto; padding: 0.6em 1em;">
                <div class="at-formzeile eng">

                    <!-- Zeitraum-Typ -->
                    <div>
                        <label class="at-label">{{ t('kiAgent.period') }}</label>
                        <select v-model="periodType" class="at-feld klein">
                            <option value="week">{{ t('kiAgent.periodWeek') }}</option>
                            <option value="month">{{ t('kiAgent.periodMonth') }}</option>
                            <option value="halfyear">{{ t('kiAgent.periodHalfYear') }}</option>
                            <option value="year">{{ t('kiAgent.periodYear') }}</option>
                            <option value="custom">{{ t('options.custom') }}</option>
                        </select>
                    </div>

                    <!-- Woche -->
                    <div v-if="periodType === 'week'">
                        <label class="at-label">{{ t('kiAgent.weekOf') }}</label>
                        <input type="date" v-model="selectedWeekStart" class="at-feld klein">
                    </div>

                    <!-- Monat -->
                    <div v-if="periodType === 'month'">
                        <label class="at-label">{{ t('kiAgent.periodMonth') }}</label>
                        <input type="month" v-model="selectedMonth" class="at-feld klein">
                    </div>

                    <!-- Custom Range -->
                    <div v-if="periodType === 'custom'">
                        <label class="at-label">{{ t('kiAgent.from') }}</label>
                        <input type="date" v-model="customStart" class="at-feld klein">
                    </div>
                    <div v-if="periodType === 'custom'">
                        <label class="at-label">{{ t('kiAgent.to') }}</label>
                        <input type="date" v-model="customEnd" class="at-feld klein">
                    </div>

                    <!-- Button -->
                    <div>
                        <Knopf art="haupt" klein symbol="dokument" :laedt="loading" @click="generateReport">
                            {{ loading ? t('kiAgent.generating') : t('kiAgent.generate') }}
                        </Knopf>
                    </div>
                </div>

                <!-- Stil Quick-Selection -->
                <div class="at-flex at-mitte at-luecke-2 at-mo-2 at-po-2" style="border-top: 1px solid var(--line);">
                    <span class="at-gedaempft at-klein at-mr-1"><Symbol name="palette" class="at-mr-1" />{{ t('kiAgent.reportStyle') }}:</span>
                    <button v-for="preset in reportStylePresets" :key="preset.value"
                        class="report-style-btn"
                        :class="{ active: selectedReportStyle === preset.value }"
                        @click="selectedReportStyle = preset.value"
                        :disabled="loading">
                        <Symbol class="at-mr-1" :name="preset.icon" />{{ t('settings.prompt_' + preset.value) }}
                    </button>
                </div>
            </div>

            <!-- Lade-Animation -->
            <div v-if="loading" class="dailyCard at-mittig at-py-5">
                <Kreisel :groesse="48" class="at-mu-3" />
                <p class="at-gedaempft">{{ t('kiAgent.analyzing') }}</p>
                <small class="at-gedaempft">{{ t('kiAgent.analyzeHint') }}</small>
            </div>

            <!-- Fehler -->
            <Hinweis v-if="errorMsg" art="fehler">
                {{ errorMsg }}
            </Hinweis>

            <!-- Gespeicherte Berichte -->
            <div v-if="savedReports.length === 0 && !loading" class="dailyCard at-mittig at-py-4">
                <Symbol style="font-size: 2rem;" name="dokumentSuche" class="at-gedaempft" />
                <p class="at-gedaempft at-mo-2 at-mu-0">{{ t('kiAgent.noReports') }}</p>
            </div>

            <div v-for="report in savedReports" :key="report.id" class="dailyCard at-mu-2" style="height: auto;">
                <!-- Klickbarer Header -->
                <div class="at-flex at-verteilt at-mitte pointerClass" @click="toggleReport(report.id)">
                    <div class="at-flex at-mitte">
                        <Symbol class="at-mr-1" :name="expandedReports.has(report.id) ? 'runter' : 'ausklappen'" />
                        <Symbol name="dokumentHaken" class="at-mr-1" />
                        <span class="at-fett at-mr-2">{{ report.label }}</span>
                        <Pille ton="neutral" class="at-mr-2" style="font-size: 0.7rem;">{{ PROVIDER_LABELS[report.provider] || report.provider }}</Pille>
                        <Pille class="at-mr-2" v-if="report.promptPreset" style="font-size: 0.65rem;">{{ report.promptPreset }}</Pille>
                        <span class="at-gedaempft at-klein">{{ formatDate(report.createdAt) }}</span>
                    </div>
                    <div class="at-flex at-mitte at-luecke-1">
                        <!-- Kompakte Stats wenn zugeklappt -->
                        <span v-if="report.reportData && !expandedReports.has(report.id)" class="at-gedaempft at-klein at-mr-2 kiNurBreit">
                            {{ report.reportData.tradeCount }} {{ t('common.trades') }} · {{ report.reportData.winRate }}% WR ·
                            <span :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </span>
                        </span>
                        <Knopf klein @click.stop="downloadPdf(report)" title="PDF">
                            <Symbol name="herunterladen" />
                        </Knopf>
                        <!-- Löschen -->
                        <Knopf art="gefahr" klein v-if="deleteConfirmId !== report.id" @click.stop="deleteConfirmId = report.id" :title="t('kiAgent.deleteReport')">
                            <Symbol name="muell" />
                        </Knopf>
                        <span v-else class="at-flex at-mitte at-luecke-1" @click.stop>
                            <Knopf art="gefahr" klein @click="deleteReport(report.id)">{{ t('common.yes') }}</Knopf>
                            <Knopf klein @click="deleteConfirmId = null">{{ t('common.no') }}</Knopf>
                        </span>
                    </div>
                </div>

                <!-- Ausklappbarer Inhalt -->
                <div v-show="expandedReports.has(report.id)">
                    <!-- Datenbasis -->
                    <div v-if="report.reportData && report.reportData.tradeCount" class="kiKennzahlen at-mo-2 at-mu-2 at-py-2">
                        <div class="at-mittig">
                            <div class="at-gedaempft at-klein">{{ t('common.trades') }}</div>
                            <div class="at-fett">{{ report.reportData.tradeCount }}</div>
                        </div>
                        <div class="at-mittig">
                            <div class="at-gedaempft at-klein">{{ t('dashboard.winRate') }}</div>
                            <div class="at-fett">{{ report.reportData.winRate }}%</div>
                        </div>
                        <div class="at-mittig">
                            <div class="at-gedaempft at-klein">{{ t('dashboard.netPnl') }}</div>
                            <div class="at-fett" :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ report.reportData.totalNetProceeds }} USDT
                            </div>
                        </div>
                        <div class="at-mittig">
                            <div class="at-gedaempft at-klein">{{ t('options.profitFactor') }}</div>
                            <div class="at-fett">{{ report.reportData.profitFactor }}</div>
                        </div>
                    </div>

                    <!-- Bericht-Text -->
                    <div class="report-content" data-ki-generiert="true" v-html="markdownToHtml(report.report)"></div>
                    <!-- S12: Pflichtlabel an jedem KI-Bericht. -->
                    <KiHinweis :anbieter="report.provider" :modell="report.model" />

                    <!-- Token-Verbrauch -->
                    <div class="at-flex at-mitte at-luecke-3 at-mo-2 at-po-2 at-gedaempft at-klein" style="border-top: 1px solid var(--line);">
                        <span><Symbol name="prozessor" class="at-mr-1" />{{ report.model || '—' }}</span>
                        <span>{{ t('kiAgent.prompt') }}: {{ report.totalTokens > 0 ? report.promptTokens?.toLocaleString() : '—' }}</span>
                        <span>{{ t('kiAgent.response') }}: {{ report.totalTokens > 0 ? report.completionTokens?.toLocaleString() : '—' }}</span>
                        <span class="at-fett">{{ t('kiAgent.total') }}: {{ report.totalTokens > 0 ? report.totalTokens?.toLocaleString() + ' ' + t('kiAgent.tokens') : '—' }}</span>
                    </div>

                    <!-- Chat / Rückfragen -->
                    <div v-if="chatEnabled && aiOnline" class="chat-section at-mo-3 at-po-3" style="border-top: 1px solid var(--line);">
                        <div class="at-flex at-verteilt at-mitte at-mu-2">
                            <span class="at-klein at-fett"><Symbol name="nachricht" class="at-mr-1" />{{ t('kiAgent.followUp') }}</span>
                            <Knopf v-if="chatMessages[report.id]?.length > 0" klein symbol="muell" @click="clearChat(report.id)" :title="t('kiAgent.clearChat')">
                                {{ t('kiAgent.clearChat') }}
                            </Knopf>
                        </div>

                        <!-- Chat-Verlauf -->
                        <div v-if="chatMessages[report.id]?.length > 0" class="chat-messages at-mu-2">
                            <div v-for="msg in chatMessages[report.id]" :key="msg.id" class="chat-msg at-mu-2" :class="'chat-msg-' + msg.role">
                                <div class="at-flex at-mitte at-luecke-1 at-mu-1">
                                    <Symbol :name="msg.role === 'user' ? 'person' : 'ki'" />
                                    <span class="at-klein at-fett">{{ msg.role === 'user' ? t('kiAgent.you') : t('kiAgent.ai') }}</span>
                                    <span class="at-gedaempft at-klein at-ml-1">{{ formatDate(msg.createdAt) }}</span>
                                    <span v-if="msg.role === 'assistant' && msg.totalTokens > 0" class="at-gedaempft at-klein at-ml-auto">{{ msg.totalTokens }} {{ t('kiAgent.tokens') }}</span>
                                </div>
                                <div v-if="msg.role === 'user'" class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                <template v-else>
                                    <div class="chat-bubble chat-bubble-ai report-content" data-ki-generiert="true" v-html="markdownToHtml(msg.content)"></div>
                                    <KiHinweis klein />
                                </template>
                            </div>
                        </div>

                        <!-- Loading -->
                        <div v-if="chatLoading[report.id]" class="at-mittig at-py-3">
                            <Kreisel still class="at-mr-1" />
                            <span class="at-gedaempft at-klein">{{ t('kiAgent.aiThinking') }}</span>
                        </div>

                        <!-- Error -->
                        <Hinweis v-if="chatError[report.id]" class="at-mu-2" art="fehler">
                            {{ chatError[report.id] }}
                        </Hinweis>

                        <!-- Input -->
                        <div class="at-flex at-luecke-2 at-unten">
                            <textarea class="at-feld klein chat-input" rows="3" :placeholder="t('kiAgent.askFollowUp')"
                                v-model="chatInput[report.id]"
                                @keydown.enter.exact.prevent="sendChatMessage(report.id)"
                                :disabled="chatLoading[report.id]"></textarea>
                            <Knopf art="haupt" klein style="height: 2.4rem;" @click="sendChatMessage(report.id)" :disabled="chatLoading[report.id] || !(chatInput[report.id] || '').trim()">
                                <Symbol name="nachricht" />
                            </Knopf>
                        </div>
                        <small class="at-gedaempft at-mo-1">{{ t('kiAgent.chatInputHint') }}</small>
                    </div>
                </div>
            </div>

        </div> <!-- end reports tab -->

            <!-- ==================== AGENT TAB ==================== -->
            <div v-show="currentTab === 'agent'">

                <!-- Header -->
                <div class="at-flex at-verteilt at-mitte at-mu-3">
                    <h5 class="at-mu-0">
                        <Symbol name="gehirn" class="at-mr-2" />{{ t('kiAgent.agentTitle') }}
                    </h5>
                    <div class="at-flex at-mitte at-luecke-2">
                        <Pille :ton="aiOnline ? 'gut' : 'schlecht'">
                            {{ aiOnline ? modelLabel + ' ' + t('kiAgent.online') : providerLabel + ' ' + t('kiAgent.offline') }}
                        </Pille>
                        <Knopf klein @click="startNewAgentSession" :title="t('kiAgent.newSession')">
                            <Symbol name="plus" class="at-mr-1" />{{ t('kiAgent.newSession') }}
                        </Knopf>
                    </div>
                </div>

                <!-- Offline -->
                <div v-if="!aiOnline" class="dailyCard at-mittig at-py-4 at-mu-3">
                    <Symbol style="font-size: 2rem;" name="warnung" class="at-warn" />
                    <p class="at-mo-2 at-mu-1">{{ t('kiAgent.providerNotReachable') }}</p>
                </div>

                <div v-if="aiOnline" class="kiAgentRaster">
                    <!-- Session-Liste (links) -->
                    <div>
                        <div class="dailyCard" style="height: auto; max-height: 70vh; overflow-y: auto; padding: 0.5em;">
                            <div class="at-flex at-mitte at-verteilt at-mu-2">
                                <div class="at-klein at-fett"><Symbol name="verlauf" class="at-mr-1" />{{ t('kiAgent.sessions') }}</div>
                                <div class="at-flex at-luecke-1">
                                    <span class="agent-list-btn" :class="{ active: auswahlModus }"
                                        :title="t('kiAgent.auswahl')" @click="toggleAuswahlModus">
                                        <Symbol name="hakenKasten" />
                                    </span>
                                    <span class="agent-list-btn" :class="{ active: zeigeArchiv }"
                                        :title="t('kiAgent.archivAnzeigen')" @click="wechsleArchivAnsicht">
                                        <Symbol name="archiv" />
                                    </span>
                                </div>
                            </div>
                            <div v-if="sichtbareSessions.length === 0" class="at-gedaempft at-klein at-mittig at-py-2">
                                {{ zeigeArchiv ? t('kiAgent.archivLeer') : t('kiAgent.noSessions') }}
                            </div>
                            <div v-for="s in sichtbareSessions" :key="s.id"
                                class="agent-session-item at-p-2 at-mu-1 pointerClass"
                                :class="{ 'agent-session-active': agentCurrentSessionId === s.id }"
                                @click="auswahlModus ? toggleAuswahl(s.id) : loadAgentSession(s.id)">
                                <div class="at-flex at-mitte at-luecke-2">
                                    <input v-if="auswahlModus" type="checkbox" class="at-mo-0 at-fest"
                                        :checked="ausgewaehlteSessions.has(s.id)" @click.stop="toggleAuswahl(s.id)" />
                                    <div class="at-klein at-fett at-kuerzen" style="min-width: 0;">{{ s.title || 'Session ' + s.id }}</div>
                                </div>
                                <div class="at-flex at-verteilt at-mitte">
                                    <span class="at-gedaempft" style="font-size: 0.65rem;">{{ formatDate(s.updatedAt || s.createdAt) }}</span>
                                    <template v-if="!auswahlModus">
                                        <span v-if="agentDeleteConfirmId !== s.id"
                                            class="at-schlecht" style="font-size: 0.7rem; cursor: pointer;"
                                            @click.stop="agentDeleteConfirmId = s.id">
                                            <Symbol name="muell" />
                                        </span>
                                        <span v-else class="at-flex at-luecke-1" @click.stop>
                                            <Knopf art="gefahr" style="font-size: 0.6rem; padding: 0 0.3rem;" @click="deleteAgentSession(s.id)">{{ t('common.yes') }}</Knopf>
                                            <Knopf style="font-size: 0.6rem; padding: 0 0.3rem;" @click="agentDeleteConfirmId = null">{{ t('common.no') }}</Knopf>
                                        </span>
                                    </template>
                                </div>
                            </div>
                            <!-- Aktionen auf die Auswahl -->
                            <div v-if="auswahlModus" class="at-flex at-spalte at-luecke-1 at-mo-2">
                                <Knopf klein :disabled="ausgewaehlteSessions.size === 0"
                                    @click="archiviereAusgewaehlte">
                                    <Symbol name="archiv" class="at-mr-1" />{{ zeigeArchiv ? t('kiAgent.wiederherstellen') : t('kiAgent.archivieren') }} ({{ ausgewaehlteSessions.size }})
                                </Knopf>
                                <Knopf klein art="gefahr"
                                    :disabled="ausgewaehlteSessions.size === 0" @click="loescheAusgewaehlte">
                                    <Symbol name="muell" class="at-mr-1" />{{ bulkLoeschBestaetigung ? t('kiAgent.wirklichLoeschen') : t('kiAgent.loeschen') }} ({{ ausgewaehlteSessions.size }})
                                </Knopf>
                            </div>
                        </div>
                    </div>

                    <!-- Chat-Bereich (rechts) -->
                    <div class="kiAgentChat">
                        <div class="dailyCard" style="height: auto; min-height: 50vh; display: flex; flex-direction: column; padding: 0.8em;">

                            <!-- Chat-Verlauf -->
                            <div ref="agentChatEl" class="agent-chat-messages at-wachsen at-mu-3" style="overflow-y: auto; max-height: 60vh;">
                                <div v-if="agentMessages.length === 0 && !agentLoading" class="at-mittig at-gedaempft at-py-5">
                                    <Symbol style="font-size: 3rem; opacity: 0.3;" name="gehirn" />
                                    <p class="at-mo-2 at-mu-0">{{ t('kiAgent.agentWelcome') }}</p>
                                    <small>{{ t('kiAgent.agentHint') }}</small>
                                </div>

                                <template v-for="(msg, idx) in agentMessages" :key="idx">
                                    <!-- User Message -->
                                    <div v-if="msg.role === 'user'" class="chat-msg at-mu-2">
                                        <div class="at-flex at-mitte at-luecke-1 at-mu-1">
                                            <Symbol name="person" />
                                            <span class="at-klein at-fett">{{ t('kiAgent.you') }}</span>
                                        </div>
                                        <div class="chat-bubble chat-bubble-user">{{ msg.content }}</div>
                                    </div>

                                    <!-- Tool Messages -->
                                    <div v-if="msg.role === 'tool'" class="agent-tool-step at-mu-1 at-ml-3">
                                        <div class="at-flex at-mitte at-luecke-1 pointerClass" @click="toggleAgentTool(idx)">
                                            <Symbol class="agentWerkzeug" name="einstellungen" />
                                            <span class="at-klein agentWerkzeug">{{ msg.toolName }}</span>
                                            <Symbol :name="agentExpandedTools.has(idx) ? 'runter' : 'ausklappen'" style="font-size: 0.7rem;" />
                                        </div>
                                        <div v-if="agentExpandedTools.has(idx)" class="agent-tool-detail at-mo-1 at-p-2" style="background: var(--panel-soft); font-size: 0.75rem; max-height: 200px; overflow-y: auto;">
                                            <pre style="white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--muted);">{{ msg.content?.substring(0, 2000) }}</pre>
                                        </div>
                                    </div>

                                    <!-- Assistant Message -->
                                    <div v-if="msg.role === 'assistant'" class="chat-msg at-mu-2">
                                        <div class="at-flex at-mitte at-luecke-1 at-mu-1">
                                            <Symbol name="ki" />
                                            <span class="at-klein at-fett">{{ t('kiAgent.agent') }}</span>
                                        </div>
                                        <div class="chat-bubble chat-bubble-ai report-content" data-ki-generiert="true" v-html="markdownToHtml(msg.content)"></div>
                                        <!-- S12: jede KI-Antwort trägt das Pflichtlabel. -->
                                        <KiHinweis klein />
                                    </div>
                                </template>

                                <!-- Live Steps (during agent run) -->
                                <div v-if="agentLoading" class="at-ml-3 at-mu-2">
                                    <div v-for="(step, si) in agentSteps" :key="si" class="agent-live-step at-mu-1">
                                        <template v-if="step.type === 'thinking'">
                                            <Kreisel still class="at-mr-1" groesse="0.7rem" />
                                            <span class="at-gedaempft at-klein">{{ t('kiAgent.agentThinking') }} ({{ step.iteration }})</span>
                                        </template>
                                        <template v-if="step.type === 'tool_call'">
                                            <Symbol name="einstellungen" class="at-mr-1 agentWerkzeug" />
                                            <span class="at-klein agentWerkzeug">{{ step.name }}</span>
                                            <span class="at-gedaempft at-klein at-ml-1">({{ formatToolParams(step.params) }})</span>
                                        </template>
                                        <template v-if="step.type === 'tool_result'">
                                            <Symbol name="hakenKreis" class="at-mr-1 at-gut" />
                                            <span class="at-klein at-gut">{{ step.name }}: {{ step.resultPreview }}</span>
                                        </template>
                                        <template v-if="step.type === 'warning'">
                                            <Symbol name="warnung" class="at-mr-1 at-warn" />
                                            <span class="at-klein at-warn">{{ step.content }}</span>
                                        </template>
                                    </div>
                                    <div class="at-mittig at-py-2">
                                        <Kreisel still class="at-mr-1" />
                                        <span class="at-gedaempft at-klein">{{ t('kiAgent.agentWorking') }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Error -->
                            <Hinweis v-if="agentError" class="at-mu-2" art="fehler">
                                {{ agentError }}
                            </Hinweis>

                            <!-- Input -->
                            <div class="at-flex at-luecke-2 at-unten at-mo-auto">
                                <textarea class="at-feld klein chat-input" rows="2"
                                    :placeholder="t('kiAgent.agentPlaceholder')"
                                    v-model="agentInput"
                                    @keydown.enter.exact.prevent="sendAgentMessage"
                                    :disabled="agentLoading || !aiOnline"></textarea>
                                <Knopf art="haupt" klein style="height: 2.4rem;"
                                    @click="sendAgentMessage"
                                    :disabled="agentLoading || !agentInput.trim() || !aiOnline">
                                    <Symbol name="nachricht" />
                                </Knopf>
                            </div>
                        </div>
                    </div>
                </div>
            </div> <!-- end agent tab -->

        </div>
    </div>
</template>

<style scoped>
/* Kennzahlen eines Berichts: zwei Spalten am Telefon, vier ab Tablet. */
.kiKennzahlen {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
}

@media (min-width: 768px) {
    .kiKennzahlen { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

/* Kurzwerte im zugeklappten Bericht nur, wo Platz ist. */
.kiNurBreit { display: none; }

@media (min-width: 768px) {
    .kiNurBreit { display: inline; }
}

/* Agent: Sitzungsliste links (ein Viertel), Chat rechts; am Telefon untereinander. */
.kiAgentRaster {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
}

@media (min-width: 768px) {
    .kiAgentRaster { grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); }
}

.agent-session-item {
    border-radius: var(--radius-klein);
}

/* Report-Style Quick-Selection */
.report-style-btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-pille);
    color: var(--muted);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}
.report-style-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
}
.report-style-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-flaeche);
}
.report-style-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

/* Kosten-Badge */
.ki-cost-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius-pille);
    color: var(--warn);
    background: var(--warn-flaeche);
    cursor: default;
}

.ki-cost-hint {
    font-size: 0.6rem;
    opacity: 0.6;
    font-style: italic;
}

.report-content :deep(h3) {
    color: var(--text);
    font-size: 1.1rem;
    margin-top: 0.8rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(h4.report-section-title) {
    font-size: 1rem;
    color: var(--accent);
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.3rem;
    margin-top: 1rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(h4) {
    font-size: 1rem;
    margin-top: 0.8rem;
    margin-bottom: 0.3rem;
}
.report-content :deep(h5) {
    font-size: 0.9rem;
    color: var(--muted);
    margin-top: 0.5rem;
    margin-bottom: 0.2rem;
}
.report-content :deep(p) {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text);
    margin-bottom: 0.4rem;
}
.report-content :deep(ul) {
    padding-left: 1.2rem;
    margin-bottom: 0.4rem;
}
.report-content :deep(li) {
    font-size: 0.85rem;
    color: var(--text);
    margin-bottom: 0.15rem;
}
.report-content :deep(strong) {
    color: var(--text);
}
/* Chat-Blasen (.chat-bubble …) stehen global in design/journal.css */

/* Agent Session List */
.agent-session-item {
    border: 1px solid transparent;
    transition: all 0.15s;
}
.agent-session-item:hover {
    background: var(--panel-soft);
    border-color: var(--line);
}
.agent-session-active {
    background: var(--accent-flaeche) !important;
    border-color: var(--accent) !important;
}

/* Kopfzeilen-Knöpfe der Session-Liste (Auswahlmodus, Archiv) */
.agent-list-btn {
    cursor: pointer;
    color: var(--leise);
    font-size: 0.9rem;
    padding: 0 0.2rem;
    transition: color 0.15s;
}
.agent-list-btn:hover {
    color: var(--text);
}
.agent-list-btn.active {
    color: var(--accent);
}

/* Agent Tool Steps */
.agent-live-step {
    display: flex;
    align-items: center;
    padding: 0.15rem 0;
}
.agent-tool-step {
    border-left: 2px solid var(--line-stark);
    padding-left: 0.5rem;
}

/* Werkzeugschritte des Agenten: zurückgenommen, sie sind Begleittext. */
.agentWerkzeug {
    color: var(--muted);
}
</style>
