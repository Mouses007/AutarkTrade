<script setup>
/**
 * Chart einer Instanz: Symbol und Zeiteinheit aus der Instanz, darüber ihre
 * Setups, offenen Positionen und Trades. Darunter die Signale dieses Symbols —
 * ein Klick rückt das Signal im Chart ins Bild, ein Klick im Chart wählt es in
 * der Liste.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import StrategieChart from '../StrategieChart.vue'
import { rText, zeit, tonVon, statusText, grundText, TF_MS } from '../../../utils/strategien/format.js'
import { logError } from '../../../utils/logger.js'

const props = defineProps({
    instanz: { type: Object, required: true },
    fokus: { type: Object, default: null },    // { symbol, timeframe, art?, id?, t? }
})
const { t, te } = useI18n()

const zeiteinheiten = computed(() => (props.instanz.timeframes?.length ? props.instanz.timeframes : [props.instanz.timeframe]))
const symbol = ref(props.fokus?.symbol || props.instanz.symbols[0])
const timeframe = ref(props.fokus?.timeframe && zeiteinheiten.value.includes(props.fokus.timeframe) ? props.fokus.timeframe : props.instanz.timeframe)

const daten = ref({ setups: [], positionen: [], trades: [] })
const gewaehlt = ref(null)    // 'setup:<id>' | 'trade:<id>'
const chart = ref(null)
let takt = null

async function laden() {
    const tfMs = TF_MS[timeframe.value] || 3600000
    try {
        const { data } = await axios.get(`/api/strategies/instances/${props.instanz.id}/chart`, {
            params: { symbol: symbol.value, timeframe: timeframe.value, von: Date.now() - 1500 * tfMs },
        })
        // Der Status steht im Chart in Worten, nicht als Code.
        daten.value = { ...data, setups: data.setups.map((s) => ({ ...s, statusText: statusText(t, s.status) })) }
    } catch (e) {
        logError('ChartReiter', 'Chart-Daten laden fehlgeschlagen', e)
    }
}
onMounted(async () => {
    await laden()
    await fokusAnwenden()
    takt = setInterval(() => { if (!document.hidden) laden() }, 60000)
})
onBeforeUnmount(() => clearInterval(takt))
watch([symbol, timeframe], laden)

async function fokusAnwenden() {
    const f = props.fokus
    if (!f) return
    if (f.symbol && f.symbol !== symbol.value) symbol.value = f.symbol
    if (f.timeframe && zeiteinheiten.value.includes(f.timeframe) && f.timeframe !== timeframe.value) timeframe.value = f.timeframe
    if (f.art && f.id != null) {
        await laden()
        await nextTick()
        zeige({ art: f.art, id: f.id, t: f.t })
    }
}
watch(() => props.fokus?.n, fokusAnwenden)

/** Signale dieses Symbols: Setups mit ihrem Ausgang, jüngste zuerst. */
const signale = computed(() => {
    const trades = new Map(daten.value.trades.filter((tr) => tr.setupId != null).map((tr) => [tr.setupId, tr]))
    return [...daten.value.setups].sort((a, b) => (b.obT || 0) - (a.obT || 0)).map((s) => ({ ...s, trade: trades.get(s.id) || null }))
})

function zeige({ art, id, t: zeitpunkt }) {
    gewaehlt.value = art + ':' + id
    let ziel = zeitpunkt
    if (!ziel) {
        const s = art === 'setup' ? daten.value.setups.find((x) => x.id === id) : daten.value.trades.find((x) => x.id === id)
        ziel = art === 'setup' ? (s?.ausgeloestT || s?.obT) : s?.einstieg?.t
    }
    chart.value?.zeige({ art, id, t: ziel, intervalMs: TF_MS[timeframe.value] || 3600000 })
}
function imChartGeklickt(st) {
    gewaehlt.value = st.art + ':' + st.id
    // In der Liste sichtbar machen: ein Trade gehört zu seinem Setup.
    const id = st.art === 'trade' ? daten.value.trades.find((x) => x.id === st.id)?.setupId : st.id
    nextTick(() => document.getElementById('signal-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
const istGewaehlt = (s) => gewaehlt.value === 'setup:' + s.id || (s.trade && gewaehlt.value === 'trade:' + s.trade.id)
</script>

<template>
    <div class="chartReiter">
        <div class="wahl">
            <select v-model="symbol" class="at-feld klein" :aria-label="t('strategies.symbol')">
                <option v-for="s in instanz.symbols" :key="s" :value="s">{{ s }}</option>
            </select>
            <select v-if="zeiteinheiten.length > 1" v-model="timeframe" class="at-feld klein" :aria-label="t('strategies.timeframe')">
                <option v-for="tf in zeiteinheiten" :key="tf" :value="tf">{{ tf }}</option>
            </select>
            <span class="at-gedaempft klein">{{ t('strategien.chart.legende') }}</span>
        </div>

        <StrategieChart ref="chart" :symbol="symbol" :interval="timeframe" :markt="instanz.market || 'futures'"
            :daten="daten" :merk-schluessel="instanz.strategyId" @klick="imChartGeklickt" />

        <div class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategien.chart.signale', { symbol }) }}</div>
            <p v-if="!signale.length" class="at-gedaempft">{{ t('strategien.chart.keineSignale') }}</p>
            <div v-else class="at-tabelle-huelle liste">
                <table class="at-tabelle dicht">
                    <tbody>
                        <tr v-for="s in signale" :id="'signal-' + s.id" :key="s.id" class="klickZeile" :class="{ gewaehlt: istGewaehlt(s) }"
                            tabindex="0" @click="zeige({ art: s.trade ? 'trade' : 'setup', id: s.trade ? s.trade.id : s.id })"
                            @keydown.enter="zeige({ art: s.trade ? 'trade' : 'setup', id: s.trade ? s.trade.id : s.id })">
                            <td class="at-gedaempft">{{ zeit(s.obT) }}</td>
                            <td :class="s.richtung === 'short' ? 'verlustWert' : 'gewinnWert'">{{ s.richtung === 'short' ? 'Short' : 'Long' }}</td>
                            <td>{{ statusText(t, s.status) }}</td>
                            <td class="at-gedaempft">{{ s.grund ? grundText(t, te, s.grund) : '' }}</td>
                            <td class="zahl" :class="tonVon(s.trade?.r)">{{ s.trade ? rText(s.trade.r) : '' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<style scoped>
.chartReiter { display: flex; flex-direction: column; gap: 12px; }
.wahl { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.klein { font-size: 0.8rem; }
.abschnittTitel { font-weight: 600; margin-bottom: 8px; }
.liste { max-height: 320px; overflow-y: auto; }
.klickZeile { cursor: pointer; }
.klickZeile:hover td, .klickZeile:focus-visible td { background: var(--panel-soft); }
.gewaehlt td { background: var(--accent-schwach); }
</style>
