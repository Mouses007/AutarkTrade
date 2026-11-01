<script setup>
/**
 * Einstellungen einer Instanz — dasselbe Formular für „Neue Instanz" und den
 * Reiter „Einstellungen" der Instanz-Ansicht.
 *
 * Es kennt keine einzige Strategie: Parameter und Risiko rendert
 * StrategyParamForm aus dem Schema, das der Server im Manifest mitliefert.
 * Dazu die Veto-Agenten (KI prüft vor jedem Einstieg, darf ablehnen oder
 * verkleinern) — bis 01.11.2026 liessen sie sich nirgends einschalten.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import StrategyParamForm from '../StrategyParamForm.vue'
import { Knopf, Pille, Symbol, Hinweis, Reiter } from '../basis'

const entwurf = defineModel({ type: Object, required: true })
const props = defineProps({
    registry: { type: Object, required: true },
    istNeu: { type: Boolean, default: false },
})
const { t } = useI18n()

const strategie = computed(() => props.registry.strategies.find((s) => s.id === entwurf.value.strategyId) || null)

/** Strategiewechsel: Parameter auf die Vorgaben der neuen, Zeiteinheiten auf ihre. */
function strategieGewechselt() {
    const s = strategie.value
    if (!s) return
    entwurf.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    if (!s.supportedTimeframes.includes(entwurf.value.timeframe)) entwurf.value.timeframe = s.supportedTimeframes[0]
    entwurf.value.timeframes = (entwurf.value.timeframes || [])
        .filter((tf) => s.supportedTimeframes.includes(tf) && tf !== entwurf.value.timeframe)
}

// Mehrere Zeiteinheiten: die Haupt-Zeiteinheit ist immer dabei.
const tfListe = () => (Array.isArray(entwurf.value.timeframes) ? entwurf.value.timeframes : [])
const tfAktiv = (tf) => tf === entwurf.value.timeframe || tfListe().includes(tf)
function tfUmschalten(tf) {
    if (tf === entwurf.value.timeframe) return
    const liste = tfListe().filter((x) => x !== entwurf.value.timeframe)
    entwurf.value.timeframes = liste.includes(tf) ? liste.filter((x) => x !== tf) : [...liste, tf]
}
function tfHauptGewechselt() { entwurf.value.timeframes = tfListe().filter((x) => x !== entwurf.value.timeframe) }

const symbolEingabe = ref('')
function symbolHinzu() {
    const roh = symbolEingabe.value.toUpperCase().trim()
    if (!/^[A-Z0-9]{2,20}$/.test(roh)) return
    if (!entwurf.value.symbols.includes(roh)) entwurf.value.symbols.push(roh)
    symbolEingabe.value = ''
}
const symbolWeg = (s) => { entwurf.value.symbols = entwurf.value.symbols.filter((x) => x !== s) }

// Veto-Agenten: zwei Rollen, je ein Schalter. Anbieter und Tagesbudget stehen
// zentral in Einstellungen › KI › Strategie.
function agentAn(rolle) { return Boolean(entwurf.value.agents?.[rolle]?.enabled) }
function agentSchalten(rolle, an) {
    const agents = { ...(entwurf.value.agents || {}) }
    agents[rolle] = { ...(agents[rolle] || {}), enabled: an }
    entwurf.value.agents = agents
}

const reiter = ref('params')
const reiterListe = computed(() => [
    { id: 'params', titel: t('strategies.strategyParams') },
    { id: 'risk', titel: t('strategies.riskParams') },
    { id: 'veto', titel: t('strategien.formular.veto') },
])
</script>

<template>
    <div class="instanzFormular">
        <div class="raster">
            <label class="feld breit">
                <span class="at-label">{{ t('strategies.strategy') }}</span>
                <select v-model="entwurf.strategyId" class="at-feld klein" :disabled="!istNeu" @change="strategieGewechselt">
                    <option v-for="s in registry.strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
                <small v-if="strategie" class="at-gedaempft">{{ strategie.description }}</small>
            </label>
            <label class="feld breit">
                <span class="at-label">{{ t('strategies.name') }}</span>
                <input v-model="entwurf.name" class="at-feld klein" />
            </label>
            <label class="feld">
                <span class="at-label">{{ t('strategies.modeLabel') }}</span>
                <select v-model="entwurf.mode" class="at-feld klein">
                    <option v-for="m in registry.modes" :key="m" :value="m">{{ t('strategies.mode_' + m) }}</option>
                </select>
            </label>
            <label class="feld">
                <span class="at-label">{{ t('strategies.brokerLabel') }}</span>
                <select v-model="entwurf.broker" class="at-feld klein">
                    <option v-for="b in registry.broker || []" :key="b.id" :value="b.id">{{ b.label }}</option>
                </select>
            </label>
            <label class="feld">
                <span class="at-label">{{ t('strategies.timeframe') }}</span>
                <select v-model="entwurf.timeframe" class="at-feld klein" @change="tfHauptGewechselt">
                    <option v-for="tf in strategie?.supportedTimeframes || []" :key="tf" :value="tf">{{ tf }}</option>
                </select>
            </label>
            <div v-if="(strategie?.supportedTimeframes || []).length > 1" class="feld breit">
                <span class="at-label">{{ t('strategies.extraTimeframes') }}</span>
                <div class="tfZeile">
                    <button v-for="tf in strategie?.supportedTimeframes || []" :key="tf" type="button" class="tfKnopf"
                        :class="{ aktiv: tfAktiv(tf) }" :disabled="tf === entwurf.timeframe" @click="tfUmschalten(tf)">{{ tf }}</button>
                </div>
                <small class="at-gedaempft">{{ t('strategies.extraTimeframesHint') }}</small>
            </div>
            <div class="feld breit">
                <span class="at-label">{{ t('strategies.symbols') }}</span>
                <div class="symbolZeile">
                    <input v-model="symbolEingabe" class="at-feld klein" placeholder="BTCUSDT"
                        :aria-label="t('strategies.symbols')" @keydown.enter.prevent="symbolHinzu" />
                    <Knopf klein nurSymbol symbol="plus" :titel="t('common.hinzufuegen')" @click="symbolHinzu" />
                </div>
                <div class="pillen">
                    <Pille v-for="s in entwurf.symbols" :key="s" ton="neutral" class="klickZiel" @click="symbolWeg(s)">
                        {{ s }} <Symbol name="schliessen" />
                    </Pille>
                </div>
            </div>
        </div>

        <Hinweis v-if="entwurf.mode === 'shadow'" art="info" class="abstand">{{ t('strategies.shadowModeHint') }}</Hinweis>

        <Reiter v-model="reiter" :reiter="reiterListe" class="abstand" />
        <div v-show="reiter === 'params'">
            <StrategyParamForm v-model="entwurf.params" :schema="strategie?.params || []"
                :groups="strategie?.paramGroups || []" :i18nPrefix="'strategies.' + entwurf.strategyId" />
        </div>
        <div v-show="reiter === 'risk'">
            <StrategyParamForm v-model="entwurf.risk" :schema="registry.riskParams" i18nPrefix="strategies.risk" />
        </div>
        <div v-show="reiter === 'veto'" class="veto">
            <p class="at-gedaempft">{{ t('strategien.formular.vetoText') }}</p>
            <label class="schalter">
                <input type="checkbox" :checked="agentAn('sentiment')" @change="agentSchalten('sentiment', $event.target.checked)" />
                <span><strong>{{ t('strategien.formular.vetoStimmung') }}</strong> — {{ t('strategien.formular.vetoStimmungText') }}</span>
            </label>
            <label class="schalter">
                <input type="checkbox" :checked="agentAn('portfolio')" @change="agentSchalten('portfolio', $event.target.checked)" />
                <span><strong>{{ t('strategien.formular.vetoPortfolio') }}</strong> — {{ t('strategien.formular.vetoPortfolioText') }}</span>
            </label>
            <small class="at-gedaempft">{{ t('strategien.formular.vetoHinweis') }}</small>
        </div>
    </div>
</template>

<style scoped>
.raster { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.feld { display: flex; flex-direction: column; gap: 4px; }
.feld.breit { grid-column: 1 / -1; }
.tfZeile, .pillen, .symbolZeile { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tfKnopf { border: 1px solid var(--line); background: var(--panel-soft); color: var(--text); border-radius: var(--radius-pille); padding: 3px 10px; cursor: pointer; }
.tfKnopf.aktiv { border-color: var(--accent); color: var(--accent); }
.tfKnopf:disabled { opacity: 0.8; cursor: default; }
.abstand { margin-top: 12px; }
.klickZiel { cursor: pointer; }
.veto { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; }
.schalter { display: flex; gap: 8px; align-items: flex-start; }
</style>
