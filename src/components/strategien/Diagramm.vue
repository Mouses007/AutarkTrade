<script setup>
/**
 * Ein ECharts-Diagramm, das sich selbst einrichtet, mitwächst und aufräumt.
 * Für Kapitalkurve und R-Verteilung im Strategien-Modus; die Optionen baut
 * `src/utils/strategien/diagramme.js`.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
    option: { type: Object, default: null },
    hoehe: { type: Number, default: 220 },
})
const el = ref(null)
let chart = null
let beobachter = null

function zeichne() {
    if (!el.value || !props.option) return
    if (!chart) chart = echarts.init(el.value)
    chart.setOption(props.option, true)
}
onMounted(async () => {
    await nextTick()
    zeichne()
    // Ein Reiter, der eben noch display:none war, misst sonst eine Breite von null.
    beobachter = new ResizeObserver(() => chart?.resize())
    beobachter.observe(el.value)
})
watch(() => props.option, zeichne)
onBeforeUnmount(() => { beobachter?.disconnect(); chart?.dispose(); chart = null })
</script>

<template>
    <div ref="el" class="diagramm" :style="{ height: hoehe + 'px' }"></div>
</template>

<style scoped>
.diagramm { width: 100%; }
</style>
