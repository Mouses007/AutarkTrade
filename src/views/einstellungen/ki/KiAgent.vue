<script setup>
/** KI → Agent: Anbieter/Modell und Token-Budget des KI-Agenten, Wahl je Aufgabe. */
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Feld from '../gemeinsam/Feld.vue'
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
        <h3 class="zwischentitel oben">{{ t('settings.ki.tab_agent') }}</h3>
        <p class="einleitung">{{ t('settings.ki.agentHint') }}</p>

        <Feld :label="t('settings.ki.providerFor')" :hilfe="t('settings.ki.agentProviderHint')">
            <div class="stapel">
                <AnbieterWahl :provider="aiAgentProvider" :modell="aiAgentModell"
                    :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                    @update:provider="w => { aiAgentProvider = w; aiAgentModell = ''; kiSpeichern('aiAgentProvider', w); kiSpeichern('aiAgentModell', '') }"
                    @update:modell="w => { aiAgentModell = w; kiSpeichern('aiAgentModell', w) }" />
                <div>
                    <Knopf to="/ki-agent" symbol="agent" klein>{{ t('settings.ki.openAgent') }}</Knopf>
                </div>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.agentBudget')" :hilfe="t('settings.ki.agentBudgetHint')" fuer="kiAgentBudget">
            <input id="kiAgentBudget" type="number" class="mittel"
                min="10000" step="10000" v-model.number="aiAgentTokenBudget"
                @change="kiSpeichern('aiAgentTokenBudget', Math.max(10000, Number(aiAgentTokenBudget) || 80000))" />
        </Feld>

        <Feld :label="t('settings.ki.modelOptimization')" :hilfe="t('settings.ki.modelOptimizationHint')">
            <div class="reihe">
                <Knopf symbol="agent" klein :laedt="modelAnalysisRunning" @click="runModelAnalysisAgent">
                    {{ t('settings.ki.analysisStart') }}
                </Knopf>
                <span v-if="modelAnalysisRunning" class="leise">{{ t('settings.ki.analysisRunning') }}</span>
                <span v-else-if="modelAnalysisResult?.error" class="leise schlecht">{{ modelAnalysisResult.error }}</span>
                <span v-else-if="modelAnalysisResult" class="leise gut">
                    <Symbol name="haken" :groesse="14" />
                    {{ t('settings.ki.analysisDone', { n: modelAnalysisResult.count }) }}
                </span>
            </div>
        </Feld>

        <h3 class="zwischentitel">{{ t('settings.ki.taskModelsTitle') }}</h3>
        <p class="leise">{{ t('settings.ki.taskModelsHint') }}</p>
        <div class="liste">
            <div class="liste-zeile kopfzeile">
                <span class="liste-name">{{ t('settings.ki.taskCol') }}</span>
                <span class="liste-mitte">{{ t('settings.ki.taskCurrentCol') }}</span>
                <span class="aendern">{{ t('settings.ki.taskChangeCol') }}</span>
            </div>
            <div v-for="a in aufgabenListe" :key="a.id" class="liste-zeile">
                <span class="liste-name">
                    <span :title="a.beschreibung">{{ a.name }}</span>
                    <span v-if="a.nur && a.nur.length === 1" class="leise">· {{ t('settings.ki.taskOnly', { was: a.nur[0] }) }}</span>
                </span>
                <span class="liste-mitte"><code>{{ aiTaskProviders[a.id] || (a.rueckfall ? '(' + a.rueckfall + ')' : '(global)') }}</code></span>
                <span class="aendern">
                    <input type="text" :aria-label="t('settings.ki.taskChangeCol') + ': ' + a.name"
                        :placeholder="a.empfohlen || 'anbieter/modell'" v-model="aiTaskProviders[a.id]"
                        @blur="kiSpeichern('aiTaskProviders', JSON.stringify(aiTaskProviders))" />
                </span>
            </div>
        </div>

        <div class="flaeche kosten">
            <h3 class="zwischentitel oben">{{ t('settings.ki.costTitle') }}</h3>
            <p class="leise">
                <strong>{{ t('settings.ki.costEstimate') }}</strong><br />
                <code>Claude Opus: $50–150</code> · <code>GPT-4o: $30–100</code> · <code>Llama 70B: $5–20</code>
            </p>
            <p class="leise hinweiszeile">
                <Symbol name="info" :groesse="14" />
                <span>{{ t('settings.ki.costHint') }}</span>
            </p>
        </div>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.oben { margin-top: 0; }
.kopfzeile {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
    background: var(--panel-soft);
}
.liste-zeile { font-size: 0.85rem; }
.aendern {
    flex: 0 1 16rem;
    min-width: 0;
}
.aendern input { font-size: 0.82rem; padding: 0.3rem 0.55rem; }
@media (max-width: 575.98px) {
    .kopfzeile { display: none; }
    .aendern { flex-basis: 100%; }
}
.kosten { margin-top: var(--abstand-5); }
.hinweiszeile {
    display: flex;
    gap: var(--abstand-1);
    align-items: flex-start;
    margin-bottom: 0;
}
.hinweiszeile :deep(svg) { flex: none; margin-top: 0.15rem; }
</style>
