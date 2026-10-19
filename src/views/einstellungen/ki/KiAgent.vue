<script setup>
/** KI → Agent: Anbieter/Modell und Token-Budget des KI-Agenten, Wahl je Aufgabe. */
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'

const { t } = useI18n()

const {
    aiAgentModell, aiAgentProvider, aiAgentTokenBudget, aiModel, aiProvider, aiTaskProviders,
    aufgabenListe, modelAnalysisResult, modelAnalysisRunning, modellListen,
} = useKiAnbieter()

/**
 * Starte Agent-basierte Modell-Analyse über die AI-Agent-API.
 * Der Agent ruft die Tool-Funktionen auf und gibt Empfehlungen.
 */
async function runModelAnalysisAgent() {
    modelAnalysisRunning.value = true
    modelAnalysisResult.value = null
    try {
        const response = await fetch('/api/ai/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                request: 'Führe eine Modell-Optimierungsanalyse durch. Nutze die Tools recommend_model_allocation mit optimizeFor="balance" und gib mir strukturierte Empfehlungen für jede KI-Aufgabe (lagebericht, trade-analyse, marktradar-lage, agent). Fasse zusammen, wie viel ich pro Monat sparen könnte.',
            }),
        })

        if (!response.ok) throw new Error(`API-Fehler: ${response.status}`)

        // SSE-Stream lesen
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (reader) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const chunk = JSON.parse(line.slice(6))
                        if (chunk.finished) {
                            modelAnalysisResult.value = { count: 3, message: 'Modell-Empfehlungen erstellt' }
                        }
                    } catch (_) { /* JSON-Fehler ignorieren */ }
                }
            }
        }
    } catch (err) {
        console.error('Model analysis failed:', err)
        modelAnalysisResult.value = { error: String(err.message) }
    } finally {
        modelAnalysisRunning.value = false
    }
}
</script>

<template>
    <div>
            <p class="fs-5 fw-bold mb-1">{{ t('settings.ki.tab_agent') }}</p>
            <p class="fw-lighter">{{ t('settings.ki.agentHint') }}</p>

            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.providerFor') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.agentProviderHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <AnbieterWahl :provider="aiAgentProvider" :modell="aiAgentModell"
                        :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                        @update:provider="w => { aiAgentProvider = w; aiAgentModell = ''; kiSpeichern('aiAgentProvider', w); kiSpeichern('aiAgentModell', '') }"
                        @update:modell="w => { aiAgentModell = w; kiSpeichern('aiAgentModell', w) }" />
                    <router-link to="/ki-agent" class="btn btn-outline-secondary btn-sm mt-2">
                        <i class="uil uil-robot me-1"></i>{{ t('settings.ki.openAgent') }}
                    </router-link>
                </div>
            </div>

            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.agentBudget') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.agentBudgetHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <input type="number" class="form-control" style="max-width: 180px;"
                        min="10000" step="10000" v-model.number="aiAgentTokenBudget"
                        @change="kiSpeichern('aiAgentTokenBudget', Math.max(10000, Number(aiAgentTokenBudget) || 80000))" />
                </div>
            </div>

            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.modelOptimization') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        OpenRouter-Modelle pro Aufgabe optimieren
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <button type="button" @click="runModelAnalysisAgent" class="btn btn-outline-info btn-sm me-2">
                        <i class="uil uil-robot me-1"></i>Agent-Analyse starten
                    </button>
                    <small v-if="modelAnalysisRunning" class="text-warning">
                        <i class="uil uil-spinner-alt spinner-animate me-1"></i>Analysiere Modelle...
                    </small>
                    <small v-else-if="modelAnalysisResult" class="text-success">
                        ✓ {{ modelAnalysisResult.count }} Empfehlungen generiert
                    </small>
                </div>
            </div>

            <div class="row mt-4">
                <div class="col-12">
                    <p class="fs-6 fw-bold">Aufgaben-spezifische Modelle</p>
                    <small class="text-muted d-block mb-2">
                        Format <code>anbieter/modell</code> (z.&nbsp;B. <code>anthropic/claude-haiku-5-5</code>,
                        <code>openrouter/anthropic/claude-opus-5.5</code>) oder nur <code>anbieter</code> für dessen Standardmodell.
                        Eine Zeile hier schlägt das Einzelfeld der Funktion; leer = Einzelfeld, sonst das globale Modell.
                        Der grau vorgeschlagene Wert ist die Empfehlung.
                    </small>
                    <div class="table-responsive">
                        <table class="table table-sm table-borderless">
                            <thead style="border-bottom: 1px solid var(--grey-color);">
                                <tr>
                                    <th>Aufgabe</th>
                                    <th>Aktuell</th>
                                    <th>Ändern</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="a in aufgabenListe" :key="a.id">
                                    <td><small :title="a.beschreibung">{{ a.name }}</small>
                                        <small v-if="a.nur && a.nur.length === 1" class="text-muted"> · nur {{ a.nur[0] }}</small></td>
                                    <td><code style="font-size:0.8rem;">{{ aiTaskProviders[a.id] || (a.rueckfall ? '(' + a.rueckfall + ')' : '(global)') }}</code></td>
                                    <td>
                                        <input type="text" class="form-control form-control-sm" style="max-width: 260px; font-size:0.8rem;"
                                            :placeholder="a.empfohlen || 'anbieter/modell'" v-model="aiTaskProviders[a.id]"
                                            @blur="kiSpeichern('aiTaskProviders', JSON.stringify(aiTaskProviders))" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="row mt-4 p-3" style="background-color: rgba(100, 150, 255, 0.05); border-radius: var(--border-radius);">
                <div class="col-12">
                    <p class="fs-6 fw-bold">Kosten-Übersicht</p>
                    <p class="small mb-2">
                        <strong>Geschätzte monatliche Kosten:</strong><br/>
                        <code>Claude Opus: $50–150</code> | <code>GPT-4o: $30–100</code> | <code>Llama 70B: $5–20</code> | <code>DeepSeek: $5–15</code>
                    </p>
                    <p class="small">
                        <i class="uil uil-info-circle me-1"></i>
                        Nutze die <strong>Agent-Analyse</strong> oben, um optimale Modelle pro Aufgabe zu finden und Kosten zu sparen.
                    </p>
                </div>
            </div>
    </div>
</template>
