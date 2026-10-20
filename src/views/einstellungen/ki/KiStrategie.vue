<script setup>
/** KI → Strategie: Anbieter/Modell der Strategie-KI und globale Schalter der (simulierten) Strategie-Agenten. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { modusStrategieAn } from '../gemeinsam/useModi.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'

const { t } = useI18n()

const { aiModel, aiProvider, aiStrategieModell, aiStrategieProvider, modellListen } = useKiAnbieter()

/* STRATEGIE-AGENTEN — globale Schutzschalter. Bewusst hier und nicht in der
   Instanz-Konfiguration: sie stehen ÜBER jeder einzelnen Strategie, damit eine
   fehlkonfigurierte Instanz sie nicht umgehen kann. */
let agentExpanded = ref(true) // eigener Unter-Reiter: offen starten
let agentKillSwitch = ref(false)
let agentMaxLeverage = ref(10)
let agentLlmBudget = ref(1)
let agentSaving = ref(false)
let agentResult = ref(null)

function loadAgentSettings() {
    const s = appEinstellungen.value || {}
    agentKillSwitch.value = !!Number(s.strategyKillSwitch)
    agentMaxLeverage.value = Number(s.strategyMaxLeverage) || 10
    agentLlmBudget.value = Number(s.strategyLlmBudgetUsd) || 1
}

async function saveAgentSettings() {
    agentSaving.value = true
    agentResult.value = null
    try {
        const daten = {
            strategyKillSwitch: agentKillSwitch.value ? 1 : 0,
            strategyMaxLeverage: Math.min(Math.max(1, agentMaxLeverage.value || 1), 125),
            strategyLlmBudgetUsd: Math.max(0, agentLlmBudget.value || 0),
        }
        await dbUpdateSettings(daten)
        Object.assign(appEinstellungen.value, daten)
        agentResult.value = { success: true, message: 'Gespeichert.' }
    } catch (e) {
        agentResult.value = { success: false, message: e.response?.data?.error || e.message }
    } finally {
        agentSaving.value = false
        setTimeout(() => agentResult.value = null, 6000)
    }
}

loadAgentSettings()
</script>

<template>
    <div>

        <Feld :label="t('settings.ki.providerFor')" :hilfe="t('settings.ki.strategieProviderHint')">
            <AnbieterWahl :provider="aiStrategieProvider" :modell="aiStrategieModell"
                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                @update:provider="w => { aiStrategieProvider = w; aiStrategieModell = ''; kiSpeichern('aiStrategieProvider', w); kiSpeichern('aiStrategieModell', '') }"
                @update:modell="w => { aiStrategieModell = w; kiSpeichern('aiStrategieModell', w) }" />
        </Feld>

        <!--=============== STRATEGIE-AGENTEN ===============-->
        <Abschnitt class="abstand-oben" :titel="t('settings.ki.strat.title')" symbol="agent" v-model:offen="agentExpanded">
            <template #kopf>
                <Pille v-if="agentKillSwitch" ton="schlecht">{{ t('settings.ki.strat.killActive') }}</Pille>
            </template>

            <p class="einleitung">
                <!-- Link nur, wenn der Strategien-Modus an ist — sonst führt er auf
                     eine Route, die die Wache im Layout sofort wieder abprallen lässt. -->
                {{ t('settings.ki.strat.intro') }} <a v-if="modusStrategieAn" href="/agent/strategies">{{ t('settings.ki.strat.link') }}</a><span v-else>{{ t('settings.ki.strat.link') }}</span>. {{ t('settings.ki.strat.intro2') }}
            </p>

            <Feld :label="t('settings.ki.strat.kill')">
                <Schalter v-model="agentKillSwitch" :hilfe="t('settings.ki.strat.killHint')" />
            </Feld>

            <Feld :label="t('settings.ki.strat.maxLev')" :hilfe="t('settings.ki.strat.maxLevHint')" fuer="kiStratHebel">
                <input id="kiStratHebel" type="number" min="1" max="125" class="schmal"
                    v-model.number="agentMaxLeverage" />
            </Feld>

            <Feld :label="t('settings.ki.strat.budget')" :hilfe="t('settings.ki.strat.budgetHint')" fuer="kiStratBudget">
                <input id="kiStratBudget" type="number" min="0" step="0.1" class="schmal"
                    v-model.number="agentLlmBudget" />
            </Feld>

            <div class="knoepfe">
                <Knopf art="haupt" :laedt="agentSaving" @click="saveAgentSettings">
                    {{ t('common.save') }}
                </Knopf>
                <span v-if="agentResult" :class="agentResult.success ? 'gut' : 'schlecht'">
                    {{ agentResult.message }}
                </span>
            </div>
        </Abschnitt>

    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.abstand-oben { margin-top: var(--abstand-4); }
</style>
