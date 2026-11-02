<script setup>
/**
 * Labor — eine Strategie gegen Marktdaten prüfen (Strategien-Modus, zweiter
 * Schritt: Strategie → prüfen → laufen lassen).
 *
 *   /strategien/labor/test     ein Coin: Backtest mit Chart, darunter Robustheit
 *   /strategien/labor/viele    viele Coins: Rangliste oder Parameter vergleichen
 *   /strategien/labor/laeufe   gespeicherte Läufe mit Entscheidung
 *
 * Direktlinks: ?strategie=<id> (aus der Bibliothek), ?instanz=<id> (Werte einer
 * Instanz), ?lauf=<backtestId> (einen gespeicherten Lauf neu aufsetzen).
 *
 * Bis 01.11.2026 zwei Seiten (Labor, Coin-Rangliste), die beide eine Strategie
 * gegen Marktdaten prüften, mit je eigenem Formular. Hier gibt es EIN
 * Strategie-Formular oben; die Reiter rechnen damit.
 */
import { ref, computed, watch, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import TestReiter from '../components/strategien/labor/TestReiter.vue'
import VieleCoins from '../components/strategien/labor/VieleCoins.vue'
import LaeufeReiter from '../components/strategien/labor/LaeufeReiter.vue'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import dayjs from '../utils/journal/zeit.js'
import { Hinweis, Reiter } from '../components/basis'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const REITER = ['test', 'viele', 'laeufe']
const reiter = computed({
    get: () => (REITER.includes(route.params.reiter) ? route.params.reiter : 'test'),
    set: (r) => router.replace({ path: `/strategien/labor/${r}` }),
})
const reiterListe = computed(() => [
    { id: 'test', titel: t('strategien.labor.reiter.test'), symbol: 'test' },
    { id: 'viele', titel: t('strategien.labor.reiter.viele'), symbol: 'listeNummer' },
    { id: 'laeufe', titel: t('strategien.labor.reiter.laeufe'), symbol: 'verlauf' },
])

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {} })
const instanzen = ref([])
const meldung = ref('')
const warnung = ref('')
const fehler = ref('')

/** Das gemeinsame Formular: Strategie und Werte für alle Reiter, dazu der Einzeltest. */
const form = ref({
    strategyId: '', instanceId: '', params: {}, risk: {},
    symbol: 'BTCUSDT', timeframe: '1h',
    // Zeitraum wahlweise als „Tage zurück" oder festes von/bis — z. B. eine
    // Short-Strategie gezielt ab dem letzten Allzeithoch.
    zeitmodus: 'tage', tage: 90,
    von: dayjs().subtract(90, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    // Das Startkapital ist das Risikofeld „Startkapital (USDT)" (`risk.startEquityUsdt`)
    // — damit rechnet der Server, und das übernimmt eine Instanz aus dem Lauf.
    // Bis 31.10.2026 stand hier ein eigenes `startEquity: 1000` ohne Eingabefeld,
    // gerechnet wurde damit, angezeigt und übergeben das Risikofeld (FUN-L5-001).
    label: '',
})

const strategie = computed(() => registry.value.strategies.find((s) => s.id === form.value.strategyId) || null)
const eigene = computed(() => registry.value.strategies.filter((s) => !s.eingebaut))
const eingebaute = computed(() => registry.value.strategies.filter((s) => s.eingebaut))
const aktiveInstanzen = computed(() => instanzen.value.filter((i) => !Number(i.archiviert)))

function strategieGewechselt() {
    const s = strategie.value
    if (!s) return
    form.value.instanceId = ''
    form.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    form.value.risk = { ...registry.value.riskDefaults }
    form.value.label = ''
    if (!s.supportedTimeframes.includes(form.value.timeframe)) form.value.timeframe = s.supportedTimeframes[0]
}

/** Werte einer Instanz übernehmen — der häufigste Ausgangspunkt. */
function vonInstanz(id) {
    const inst = instanzen.value.find((i) => i.id === Number(id))
    if (!inst) return
    form.value.strategyId = inst.strategyId
    form.value.instanceId = inst.id
    form.value.timeframe = inst.timeframe
    form.value.symbol = inst.symbols?.[0] || form.value.symbol
    form.value.params = { ...inst.params }
    form.value.risk = { ...registry.value.riskDefaults, ...inst.risk }
    form.value.label = t('strategies.fromInstance', { name: inst.name })
    meldung.value = t('strategien.labor.instanzGeladen', { name: inst.name })
}

function instanzGewaehlt() {
    if (form.value.instanceId) vonInstanz(form.value.instanceId)
    else strategieGewechselt()
}

/** Gespeicherten Lauf neu aufsetzen: Strategie, Werte, Symbol, Zeiteinheit und Zeitraum. */
async function vonLauf(id) {
    try {
        const { data } = await axios.get(`/api/strategies/backtests/${Number(id)}`)
        // Gelöschte Strategie: sagen statt still nichts laden (FUN-L5-003).
        if (!registry.value.strategies.some((s) => s.id === data.strategyId)) {
            fehler.value = t('strategien.labor.laufStrategieFehlt', { id: data.id, strategie: data.strategyId })
            return
        }
        form.value.strategyId = data.strategyId
        strategieGewechselt()
        Object.assign(form.value, {
            instanceId: data.instanceId || '',
            symbol: data.symbol, timeframe: data.timeframe,
            params: { ...form.value.params, ...(data.params || {}) },
            risk: { ...form.value.risk, ...(data.risk || {}) },
            zeitmodus: 'datum',
            von: dayjs(Number(data.fromTs)).format('YYYY-MM-DD'),
            bis: dayjs(Number(data.toTs)).format('YYYY-MM-DD'),
            label: data.label || '',
        })
        meldung.value = t('strategien.labor.laufGeladen', { id: data.id })
        // Gerechnet wird die HEUTIGE Regelfassung — steht der Lauf auf einer
        // älteren, ist „Werte übernommen" allein irreführend.
        if (Number(data.ruleVersion) && Number(data.currentRuleVersion) && Number(data.ruleVersion) !== Number(data.currentRuleVersion)) {
            warnung.value = t('strategien.labor.laufFassungAlt', { id: data.id, getestet: data.ruleVersion, aktuell: data.currentRuleVersion })
        }
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

async function direktlinks() {
    const q = route.query
    meldung.value = ''
    warnung.value = ''
    if (q.lauf) await vonLauf(q.lauf)
    else if (q.instanz) vonInstanz(q.instanz)
    else if (q.strategie && registry.value.strategies.some((s) => s.id === q.strategie)) {
        form.value.strategyId = String(q.strategie)
        strategieGewechselt()
    }
}

async function laden() {
    try {
        const [reg, inst] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        if (!form.value.strategyId && reg.data.strategies.length) {
            form.value.strategyId = reg.data.strategies[0].id
            strategieGewechselt()
        }
    } catch (e) {
        logError('StrategieLabor', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    await laden()
    await direktlinks()
    seiteLaedt.value = false
})
// Ein Direktlink, während das Labor schon offen ist (z. B. „Erneut testen" aus den Läufen).
watch(() => [route.query.lauf, route.query.instanz, route.query.strategie].join('|'), (neu, alt) => {
    if (neu !== alt && neu !== '||') direktlinks()
})
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="laborSeite">
        <div class="kopf">
            <h5 class="seitentitel">{{ t('strategien.labor.titel') }}</h5>
        </div>
        <Hinweis v-if="fehler" art="fehler" class="abstand">{{ fehler }}</Hinweis>
        <Hinweis v-if="meldung" art="info" class="abstand">{{ meldung }}</Hinweis>
        <Hinweis v-if="warnung" art="warn" class="abstand">{{ warnung }}</Hinweis>

        <Reiter v-model="reiter" :reiter="reiterListe" class="abstand" />

        <!-- ══ Strategie und Werte — gilt für Test und Viele Coins ══ -->
        <div v-if="reiter !== 'laeufe'" class="journalKarte karte abstand">
            <div class="raster">
                <div class="b4">
                    <label class="at-label">{{ t('strategies.strategy') }}</label>
                    <select v-model="form.strategyId" class="at-feld klein" @change="strategieGewechselt">
                        <optgroup v-if="eigene.length" :label="t('strategien.bibliothek.eigene')">
                            <option v-for="s in eigene" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </optgroup>
                        <optgroup :label="t('strategien.bibliothek.eingebaut')">
                            <option v-for="s in eingebaute" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </optgroup>
                    </select>
                </div>
                <div class="b4">
                    <label class="at-label">{{ t('strategien.labor.werteVon') }}</label>
                    <select v-model="form.instanceId" class="at-feld klein" @change="instanzGewaehlt">
                        <option value="">{{ t('strategien.labor.vorgaben') }}</option>
                        <option v-for="i in aktiveInstanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                    </select>
                </div>
            </div>
            <details class="abstand">
                <summary class="fein at-gedaempft klickZiel">{{ t('strategies.showParams') }}</summary>
                <div class="paramSpalten">
                    <StrategyParamForm v-model="form.params" :schema="strategie?.params || []"
                        :groups="strategie?.paramGroups || []" :i18n-prefix="'strategies.' + form.strategyId" />
                    <StrategyParamForm v-model="form.risk" :schema="registry.riskParams" i18n-prefix="strategies.risk" />
                </div>
            </details>
        </div>

        <TestReiter v-if="reiter === 'test'" :form="form" :strategie="strategie" />
        <VieleCoins v-else-if="reiter === 'viele'" :form="form" :strategie="strategie" :instanzen="instanzen" />
        <LaeufeReiter v-else :registry="registry" :instanzen="instanzen" />
    </div>
</template>

<style scoped>
.laborSeite { padding: 16px 16px 24px; max-width: 1500px; margin: 0; }   /* linksbündig wie Instanzen */
.kopf { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
.seitentitel { margin: 0; }
.abstand { margin-top: 12px; }
.karte { padding: 16px; height: auto; }
.fein { font-size: 0.85rem; }
.raster { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; align-items: end; }
.b4 { grid-column: span 4; }
.paramSpalten { display: grid; grid-template-columns: 7fr 5fr; gap: 16px; margin-top: 8px; }
@media (max-width: 991.98px) { .paramSpalten { grid-template-columns: 1fr; } }
@media (max-width: 767.98px) {
    .laborSeite { padding: 12px 12px 24px; }
    .raster > * { grid-column: 1 / -1; }
}
</style>
