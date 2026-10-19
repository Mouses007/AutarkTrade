<script setup>
/** KI → Strategie: Anbieter/Modell der Strategie-KI und globale Schutzschalter der Strategie-Agenten. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import { currentUser } from '@/stores/settings.js'
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
let agentLiveEnabled = ref(false)
let agentMaxLeverage = ref(10)
let agentMinPaperTrades = ref(20)
let agentLlmBudget = ref(1)
let agentSaving = ref(false)
let agentResult = ref(null)

function loadAgentSettings() {
    const s = currentUser.value || {}
    agentKillSwitch.value = !!Number(s.strategyKillSwitch)
    agentLiveEnabled.value = !!Number(s.strategyLiveEnabled)
    agentMaxLeverage.value = Number(s.strategyMaxLeverage) || 10
    agentMinPaperTrades.value = Number(s.strategyMinPaperTrades) ?? 20
    agentLlmBudget.value = Number(s.strategyLlmBudgetUsd) || 1
}

async function saveAgentSettings() {
    agentSaving.value = true
    agentResult.value = null
    try {
        const daten = {
            strategyKillSwitch: agentKillSwitch.value ? 1 : 0,
            strategyLiveEnabled: agentLiveEnabled.value ? 1 : 0,
            strategyMaxLeverage: Math.min(Math.max(1, agentMaxLeverage.value || 1), 125),
            strategyMinPaperTrades: Math.max(0, agentMinPaperTrades.value || 0),
            strategyLlmBudgetUsd: Math.max(0, agentLlmBudget.value || 0),
        }
        await dbUpdateSettings(daten)
        Object.assign(currentUser.value, daten)
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

        <div class="row mb-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.providerFor') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.strategieProviderHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <AnbieterWahl :provider="aiStrategieProvider" :modell="aiStrategieModell"
                    :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                    @update:provider="w => { aiStrategieProvider = w; aiStrategieModell = ''; kiSpeichern('aiStrategieProvider', w); kiSpeichern('aiStrategieModell', '') }"
                    @update:modell="w => { aiStrategieModell = w; kiSpeichern('aiStrategieModell', w) }" />
            </div>
        </div>

        <!--=============== STRATEGIE-AGENTEN ===============-->
        <div class="d-flex align-items-center pointerClass" @click="agentExpanded = !agentExpanded">
            <i class="uil me-2" :class="agentExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.ki.strat.title') }}</p>
            <span v-if="agentKillSwitch" class="ms-2 badge bg-danger" style="font-size: 0.65rem;">{{ t('settings.ki.strat.killActive') }}</span>
            <span v-else-if="agentLiveEnabled" class="ms-2 badge bg-warning text-dark" style="font-size: 0.65rem;">{{ t('settings.ki.strat.liveOn') }}</span>
        </div>
        <div v-show="agentExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">
                <!-- Link nur, wenn der Strategien-Modus an ist — sonst führt er auf
                     eine Route, die die Wache im Layout sofort wieder abprallen lässt. -->
                {{ t('settings.ki.strat.intro') }} <a v-if="modusStrategieAn" href="/agent/strategies">{{ t('settings.ki.strat.link') }}</a><span v-else>{{ t('settings.ki.strat.link') }}</span>. {{ t('settings.ki.strat.intro2') }}
            </p>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">{{ t('settings.ki.strat.kill') }}</div>
                <div class="col-12 col-md-8">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" v-model="agentKillSwitch" />
                    </div>
                    <small class="text-muted">{{ t('settings.ki.strat.killHint') }}</small>
                </div>
            </div>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">{{ t('settings.ki.strat.allowLive') }}</div>
                <div class="col-12 col-md-8">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" v-model="agentLiveEnabled" />
                    </div>
                    <small class="text-muted">
                        {{ t('settings.ki.strat.allowLiveHint') }}
                    </small>
                </div>
            </div>

            <div v-if="agentLiveEnabled" class="alert alert-danger py-2 mt-2">
                <i class="uil uil-exclamation-triangle me-1"></i>
                {{ t('settings.ki.strat.liveWarn') }}
            </div>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">{{ t('settings.ki.strat.maxLev') }}</div>
                <div class="col-12 col-md-8">
                    <input type="number" min="1" max="125" class="form-control" style="max-width: 10rem;"
                        v-model.number="agentMaxLeverage" />
                    <small class="text-muted">
                        {{ t('settings.ki.strat.maxLevHint') }}
                    </small>
                </div>
            </div>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">{{ t('settings.ki.strat.minPaper') }}</div>
                <div class="col-12 col-md-8">
                    <input type="number" min="0" max="1000" class="form-control" style="max-width: 10rem;"
                        v-model.number="agentMinPaperTrades" />
                    <small class="text-muted">
                        {{ t('settings.ki.strat.minPaperHint') }}
                    </small>
                </div>
            </div>

            <div class="row align-items-center mt-3">
                <div class="col-12 col-md-4">{{ t('settings.ki.strat.budget') }}</div>
                <div class="col-12 col-md-8">
                    <input type="number" min="0" step="0.1" class="form-control" style="max-width: 10rem;"
                        v-model.number="agentLlmBudget" />
                    <small class="text-muted">
                        {{ t('settings.ki.strat.budgetHint') }}
                    </small>
                </div>
            </div>

            <div class="row mt-3">
                <div class="col-12">
                    <button class="btn btn-success" :disabled="agentSaving" @click="saveAgentSettings">
                        {{ t('common.save') }}
                    </button>
                    <span v-if="agentResult" class="ms-3"
                        :class="agentResult.success ? 'text-success' : 'text-danger'">
                        {{ agentResult.message }}
                    </span>
                </div>
            </div>
        </div>

    </div>
</template>
