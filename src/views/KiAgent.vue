<script setup>
import { ref, reactive, onBeforeMount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import { seiteLaedt } from '../stores/ui.js'
import { aiReportGenerating, aiReportError, aiReportLastSavedId, aiReportLabel, aiReportCountBefore } from '../stores/settings.js'
import { gewaehlteBoerse } from '../stores/filters.js'
import axios from 'axios'
import { useExportReportPdf } from '../utils/pdfExport'
import { kiMarkdown } from '../utils/kiMarkdown.js'
import { oeffneKiCoach } from '../stores/app/kiCoach.js'
import { logError, logWarn } from '../utils/logger.js'
import dayjs, { anzeige } from '../utils/journal/zeit.js'
import { sendNotification } from '../utils/notify'
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import Hinweis from '@/components/basis/Hinweis.vue'

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
const gewaehlterMonat = ref(dayjs().format('YYYY-MM'))
const selectedWeekStart = ref(dayjs().startOf('week').format('YYYY-MM-DD'))
const customStart = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const customEnd = ref(dayjs().format('YYYY-MM-DD'))

// Gespeicherte Berichte
const savedReports = reactive([])
const expandedReports = reactive(new Set())
const deleteConfirmId = ref(null)

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
        const start = dayjs(gewaehlterMonat.value + '-01').startOf('day')
        const end = start.endOf('month')
        return {
            startDate: start.unix(),
            endDate: end.unix(),
            label: anzeige(start).format('MMMM YYYY')
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
        if (gewaehlteBoerse.value) params.broker = gewaehlteBoerse.value
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
            broker: gewaehlteBoerse.value || null,
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

const markdownToHtml = kiMarkdown

const route = useRoute()
const vueRouter = useRouter()

// Alte Aufrufe der Seite (`?agentPrompt=`, `?tab=agent`, `?sourcePage=`) meinten
// den Chat, der bis 15.11.2026 hier als Reiter „Agent" stand. Er ist jetzt die
// KI-Coach-Leiste — solche Aufrufe öffnen sie.
const alteFrage = route.query.agentPrompt || null
const alterChatAufruf = route.query.tab === 'agent' || Boolean(route.query.sourcePage)

onBeforeMount(async () => {
    seiteLaedt.value = false

    if (alteFrage) oeffneKiCoach({ frage: String(alteFrage), neu: true })
    else if (alterChatAufruf) oeffneKiCoach()
    if (route.query.agentPrompt || route.query.tab || route.query.sourcePage) {
        vueRouter.replace({ path: route.path })
    }

    // Eine Sperre des Seitenscrollens, die eine vorherige Seite hinterlassen hat, lösen
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('padding-right')

    await Promise.all([checkStatus(), loadChatSetting()])
    await Promise.all([loadReports(), loadGlobalTokenStats(), ladePreise()])

})
</script>

<template>
    <SeiteLaedt />
    <div class="at-mo-2">
        <div v-show="!seiteLaedt">

            <div>

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
            <div v-if="!aiOnline" class="journalKarte at-mittig at-py-4 at-mu-3">
                <Symbol style="font-size: 2rem;" name="warnung" class="at-warn" />
                <p class="at-mo-2 at-mu-1">{{ t('kiAgent.providerNotReachable') }}</p>
                <small v-if="aiProvider === 'ollama'" class="at-gedaempft">
                    {{ t('kiAgent.ollamaDockerHint') }} <code>docker start ollama</code>
                </small>
                <small v-else class="at-gedaempft" v-html="t('kiAgent.checkApiKey', { link: '<a href=\'/einstellungen/ki\'>' + t('nav.settings') + '</a>' })">
                </small>
            </div>

            <!-- Konfiguration -->
            <div v-if="aiOnline" class="journalKarte at-mu-3" style="height: auto; padding: 0.6em 1em;">
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
                        <input type="month" v-model="gewaehlterMonat" class="at-feld klein">
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
            <div v-if="loading" class="journalKarte at-mittig at-py-5">
                <Kreisel :groesse="48" class="at-mu-3" />
                <p class="at-gedaempft">{{ t('kiAgent.analyzing') }}</p>
                <small class="at-gedaempft">{{ t('kiAgent.analyzeHint') }}</small>
            </div>

            <!-- Fehler -->
            <Hinweis v-if="errorMsg" art="fehler">
                {{ errorMsg }}
            </Hinweis>

            <!-- Gespeicherte Berichte -->
            <div v-if="savedReports.length === 0 && !loading" class="journalKarte at-mittig at-py-4">
                <Symbol style="font-size: 2rem;" name="dokumentSuche" class="at-gedaempft" />
                <p class="at-gedaempft at-mo-2 at-mu-0">{{ t('kiAgent.noReports') }}</p>
            </div>

            <div v-for="report in savedReports" :key="report.id" class="journalKarte at-mu-2" style="height: auto;">
                <!-- Klickbarer Header -->
                <div class="at-flex at-verteilt at-mitte klickZiel" @click="toggleReport(report.id)">
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
                            <span :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'gewinnWert' : 'verlustWert'">
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
                            <div class="at-fett" :class="parseFloat(report.reportData.totalNetProceeds) >= 0 ? 'gewinnWert' : 'verlustWert'">
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

            </div>

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

</style>
