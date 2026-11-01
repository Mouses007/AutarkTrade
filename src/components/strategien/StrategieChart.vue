<script setup>
/**
 * Chart im Strategien-Modus: derselbe Chart wie im Arbeitsplatz (ChartPanel in
 * der Ansicht), darüber die Setups, Positionen und Trades einer Instanz oder
 * eines Testlaufs (InstanzEbene).
 *
 * Indikatoren lassen sich hinzufügen; sie bleiben je `merkSchluessel` im
 * Browser gemerkt, damit z. B. die EMAs einer EMA-Strategie beim nächsten
 * Öffnen wieder da sind. Gezeichnet wird im Arbeitsplatz — „Im Chart öffnen".
 */
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import ChartPanel from '../chart/ChartPanel.vue'
import IndikatorDialog from '../chart/IndikatorDialog.vue'
import { neueInstanz } from '../../utils/chart/indikatorRegister.js'
import { Knopf } from '../basis'

const props = defineProps({
    symbol: { type: String, required: true },
    interval: { type: String, required: true },
    markt: { type: String, default: 'futures' },
    daten: { type: Object, default: null },          // { setups, positionen, trades } — shared/strategieChart.js
    merkSchluessel: { type: String, default: '' },   // Indikatoren je Strategie merken
    hoehe: { type: Number, default: 440 },
})
const emit = defineEmits(['klick'])
const { t } = useI18n()
const router = useRouter()

const SPEICHER = 'at.strategieChart.indikatoren.'
function gemerkteIndikatoren() {
    if (!props.merkSchluessel) return []
    try { return JSON.parse(localStorage.getItem(SPEICHER + props.merkSchluessel) || '[]') } catch { return [] }
}
function merke() {
    if (!props.merkSchluessel) return
    try { localStorage.setItem(SPEICHER + props.merkSchluessel, JSON.stringify(panel.indikatoren)) } catch { /* nur Komfort */ }
}

const panel = reactive({
    symbol: props.symbol, markt: props.markt, interval: props.interval, skala: 'normal',
    indikatoren: gemerkteIndikatoren(),
    // Journal-Trades und Börsenpositionen gehören nicht in die Strategie-Ansicht.
    overlays: { journal: false, positionen: false },
})
watch(() => [props.symbol, props.interval, props.markt], ([s, i, m]) => { panel.symbol = s; panel.interval = i; panel.markt = m })
watch(() => props.merkSchluessel, () => { panel.indikatoren = gemerkteIndikatoren() })

// ── Indikatoren ─────────────────────────────────────────────────────────
const dialog = ref(null)    // null | { instanz: null (hinzufügen) | Objekt (einstellen) }
function hinzu(typ) { panel.indikatoren = [...panel.indikatoren, neueInstanz(typ)]; dialog.value = null; merke() }
function speichere(instanz) { panel.indikatoren = panel.indikatoren.map((x) => (x.id === instanz.id ? instanz : x)); dialog.value = null; merke() }
function aktion({ aktion: was, id }) {
    if (was === 'volumen') { panel.volumen = panel.volumen === false; return }
    const inst = panel.indikatoren.find((x) => x.id === id)
    if (!inst) return
    if (was === 'entfernen') panel.indikatoren = panel.indikatoren.filter((x) => x.id !== id)
    else if (was === 'umschalten') inst.sichtbar = inst.sichtbar === false
    else if (was === 'bearbeiten') { dialog.value = { instanz: inst }; return }
    merke()
}

// ── Von aussen: hervorheben und hinspringen ──────────────────────────────
const chartRef = ref(null)
/** Hebt ein Setup/einen Trade hervor und rückt ihn ins Bild. */
function zeige({ art, id, t: zeit, intervalMs }) {
    chartRef.value?.hebeStrategieHervor(art + ':' + id)
    if (zeit > 0 && intervalMs > 0) chartRef.value?.setzeZeitraum(zeit - 60 * intervalMs, zeit + 30 * intervalMs)
}
defineExpose({ zeige })

function imArbeitsplatz() {
    router.push({ path: '/chart', query: { symbol: props.symbol, markt: props.markt } })
}
</script>

<template>
    <div class="strategieChart">
        <div class="leiste">
            <Knopf klein symbol="plus" @click="dialog = { instanz: null }">{{ t('strategien.chart.indikator') }}</Knopf>
            <Knopf klein symbol="chart" @click="imArbeitsplatz">{{ t('strategien.chart.imArbeitsplatz') }}</Knopf>
            <span class="at-gedaempft klein">{{ t('strategien.chart.hinweis') }}</span>
        </div>
        <div class="flaeche" :style="{ height: hoehe + 'px' }">
            <ChartPanel ref="chartRef" :panel="panel" ansicht :strategie-daten="daten" aktiv
                @indikator="aktion" @strategie-klick="(st) => emit('klick', st)" />
        </div>
        <IndikatorDialog v-if="dialog" :key="dialog.instanz?.id || 'neu'" :instanz="dialog.instanz"
            :aktive="panel.indikatoren" @hinzu="hinzu" @speichere="speichere"
            @bearbeite="(id) => aktion({ aktion: 'bearbeiten', id })"
            @entferne="(id) => aktion({ aktion: 'entfernen', id })"
            @umschalten="(id) => aktion({ aktion: 'umschalten', id })"
            @schliesse="dialog = null" />
    </div>
</template>

<style scoped>
.strategieChart { display: flex; flex-direction: column; gap: 8px; }
.leiste { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.leiste .klein { font-size: 0.8rem; }
.flaeche { position: relative; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.flaeche :deep(.chartPanel) { position: absolute; inset: 0; }
</style>
