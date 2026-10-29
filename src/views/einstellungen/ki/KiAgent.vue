<script setup>
/**
 * KI → Agent: Anbieter/Modell und Token-Budget des KI-Agenten. Das Modell je
 * Aufgabe stand bis 29.10.2026 hier, obwohl es fast nur Aufgaben ausserhalb
 * des Agenten betrifft — jetzt unter KI › Zugang (KiZugang.vue).
 */
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Feld from '../gemeinsam/Feld.vue'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'
import { kiBereichWechseln } from '../gemeinsam/useKiBereich.js'

const { t } = useI18n()

const {
    aiAgentModell, aiAgentProvider, aiAgentTokenBudget, aiModel, aiProvider, modellListen,
} = useKiAnbieter()
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
                    <Knopf to="/ki-coach" symbol="agent" klein>{{ t('settings.ki.openAgent') }}</Knopf>
                </div>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.agentBudget')" :hilfe="t('settings.ki.agentBudgetHint')" fuer="kiAgentBudget">
            <input id="kiAgentBudget" type="number" class="mittel"
                min="10000" step="10000" v-model.number="aiAgentTokenBudget"
                @change="kiSpeichern('aiAgentTokenBudget', Math.max(10000, Number(aiAgentTokenBudget) || 80000))" />
        </Feld>

        <!-- Was das kostet, steht gemessen in der Übersicht — hier keine Schätzung -->
        <p class="leise kosten">
            {{ t('settings.ki.kostenVerweis') }}
            <Knopf klein symbol="auge" @click="kiBereichWechseln('uebersicht')">{{ t('settings.ki.tab_uebersicht') }}</Knopf>
        </p>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.oben { margin-top: 0; }
.kosten {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-5);
}
</style>
