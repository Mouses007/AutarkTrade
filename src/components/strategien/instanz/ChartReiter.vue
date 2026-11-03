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

const daten = ref({ setups: [], positionen: [], trades: [], aussortiert: [] })
const gewaehlt = ref(null)    // 'setup:<id>' | 'trade:<id>' | 'aussortiert:<id>'
const chart = ref(null)
let takt = null

async function laden() {
    const tfMs = TF_MS[timeframe.value] || 3600000
    try {
        const { data } = await axios.get(`/api/strategies/instances/${props.instanz.id}/chart`, {
            params: { symbol: symbol.value, timeframe: timeframe.value, von: Date.now() - 1500 * tfMs },
        })
        // Status und Grund stehen im Chart in Worten, nicht als Code.
        daten.value = {
            ...data,
            setups: data.setups.map((s) => ({ ...s, statusText: statusText(t, s.status) })),
            aussortiert: (data.aussortiert || []).map((a) => ({ ...a, grundText: grundText(t, te, a.grund) })),
        }
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
    // Nach einem Wechsel lädt der Chart neue Kerzen — erst danach hinspringen.
    let nachLaden = false
    if (f.symbol && f.symbol !== symbol.value) { symbol.value = f.symbol; nachLaden = true }
    if (f.timeframe && zeiteinheiten.value.includes(f.timeframe) && f.timeframe !== timeframe.value) { timeframe.value = f.timeframe; nachLaden = true }
    if (f.art && f.id != null) {
        await laden()
        await nextTick()
        zeige({ art: f.art, id: f.id, t: f.t, nachLaden })
    }
}
watch(() => props.fokus?.n, fokusAnwenden)

/** Signale dieses Symbols: Setups mit ihrem Ausgang und aussortierte Signale, jüngste zuerst. */
const signale = computed(() => {
    const trades = new Map(daten.value.trades.filter((tr) => tr.setupId != null).map((tr) => [tr.setupId, tr]))
    const setups = daten.value.setups.map((s) => ({ ...s, schluessel: String(s.id), trade: trades.get(s.id) || null }))
    const aussortiert = (daten.value.aussortiert || []).map((a) => ({
        ...a, schluessel: 'a' + a.id, aussortiert: true, obT: a.t, status: 'aussortiert', trade: null,
    }))
    return [...setups, ...aussortiert].sort((a, b) => (b.obT || 0) - (a.obT || 0))
})
/** Was ein Klick auf die Zeile im Chart zeigt. */
const ziel = (s) => (s.aussortiert ? { art: 'aussortiert', id: s.id, t: s.t }
    : s.trade ? { art: 'trade', id: s.trade.id } : { art: 'setup', id: s.id })

function zeige({ art, id, t: zeitpunkt, nachLaden = false }) {
    gewaehlt.value = art + ':' + id
    let ziel = zeitpunkt
    if (!ziel && art === 'aussortiert') {
        ziel = daten.value.aussortiert.find((x) => x.id === id)?.t
    } else if (!ziel) {
        const s = art === 'setup' ? daten.value.setups.find((x) => x.id === id) : daten.value.trades.find((x) => x.id === id)
        ziel = art === 'setup' ? (s?.ausgeloestT || s?.obT) : s?.einstieg?.t
    }
    chart.value?.zeige({ art, id, t: ziel, intervalMs: TF_MS[timeframe.value] || 3600000, nachLaden })
}
function imChartGeklickt(st) {
    gewaehlt.value = st.art + ':' + st.id
    // In der Liste sichtbar machen: ein Trade gehört zu seinem Setup.
    const schluessel = st.art === 'trade' ? daten.value.trades.find((x) => x.id === st.id)?.setupId
        : st.art === 'aussortiert' ? 'a' + st.id : st.id
    nextTick(() => document.getElementById('signal-' + schluessel)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
const istGewaehlt = (s) => (s.aussortiert ? gewaehlt.value === 'aussortiert:' + s.id
    : gewaehlt.value === 'setup:' + s.id || (s.trade && gewaehlt.value === 'trade:' + s.trade.id))
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
                        <tr v-for="s in signale" :id="'signal-' + s.schluessel" :key="s.schluessel" class="klickZeile" :class="{ gewaehlt: istGewaehlt(s) }"
                            tabindex="0" @click="zeige(ziel(s))" @keydown.enter="zeige(ziel(s))">
                            <td class="at-gedaempft">{{ zeit(s.obT) }}</td>
                            <td :class="s.richtung === 'short' ? 'verlustWert' : 'gewinnWert'">{{ s.richtung === 'short' ? 'Short' : 'Long' }}</td>
                            <td :class="{ 'at-gedaempft': s.aussortiert }">{{ s.aussortiert ? t('strategien.status.aussortiert') : statusText(t, s.status) }}</td>
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
