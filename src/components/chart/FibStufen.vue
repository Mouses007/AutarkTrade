<script setup>
/**
 * Stufen und Farben eines Fibonacci-Werkzeugs (Retracement und Extension):
 * je Stufe ein Schalter, der Wert und eine Farbe. Gespeichert wird die ganze
 * Liste in `stil.stufen`; ohne sie gelten die Vorgaben des Werkzeugs.
 * Werte als Textfeld, nicht `type=number` — „0,618" mit Komma lehnte ein
 * Zahlenfeld je nach Browsersprache ab (siehe Positionsrechner).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FIB_STUFEN, FIB_EXT_STUFEN, FIB_FARBEN } from '../../utils/chart/zeichnungen/geometrie.js'

const props = defineProps({ zeichnung: { type: Object, required: true } })
const emit = defineEmits(['aendere'])
const { t } = useI18n()

const vorgabe = computed(() => (props.zeichnung.typ === 'fibExt' ? FIB_EXT_STUFEN : FIB_STUFEN))
const werk = () => vorgabe.value.map((w, i) => ({ w, an: true, farbe: FIB_FARBEN[i % FIB_FARBEN.length] }))
const liste = computed(() => {
    const eigene = props.zeichnung.stil?.stufen
    return Array.isArray(eigene) && eigene.length ? eigene : werk()
})

function speichere(neu) {
    emit('aendere', { stil: { ...(props.zeichnung.stil || {}), stufen: neu } })
}
function setze(i, patch) {
    speichere(liste.value.map((e, k) => (k === i ? { ...e, ...patch } : e)))
}
function wert(i, text) {
    const w = Number(String(text).replace(',', '.').trim())
    if (Number.isFinite(w) && w >= -5 && w <= 10) setze(i, { w })
}
function dazu() {
    const hoechste = Math.max(...liste.value.map((e) => Number(e.w) || 0))
    speichere([...liste.value, { w: Math.round((hoechste + 0.5) * 1000) / 1000, an: true, farbe: FIB_FARBEN[liste.value.length % FIB_FARBEN.length] }])
}
function weg(i) {
    if (liste.value.length > 1) speichere(liste.value.filter((_, k) => k !== i))
}
function zuruecksetzen() {
    const { stufen, ...rest } = props.zeichnung.stil || {}
    emit('aendere', { stil: rest })
}
</script>

<template>
    <div class="fibStufen">
        <div v-for="(e, i) in liste" :key="i" class="zeile">
            <input type="checkbox" :checked="e.an !== false" :aria-label="t('chart.fibStufen.an')" @change="setze(i, { an: $event.target.checked })" />
            <input class="wert" type="text" inputmode="decimal" :value="e.w" :aria-label="t('chart.fibStufen.wert')"
                @change="wert(i, $event.target.value)" @keydown.enter="$event.target.blur()" />
            <input class="farbe" type="color" :value="e.farbe || '#787b86'" :aria-label="t('chart.fibStufen.farbe')" @change="setze(i, { farbe: $event.target.value })" />
            <button type="button" class="weg" :title="t('chart.fibStufen.weg')" :aria-label="t('chart.fibStufen.weg')" @click="weg(i)">×</button>
        </div>
        <div class="fuss">
            <button type="button" @click="dazu">{{ t('chart.fibStufen.dazu') }}</button>
            <button type="button" @click="zuruecksetzen">{{ t('chart.fibStufen.zuruecksetzen') }}</button>
        </div>
    </div>
</template>

<style scoped>
.fibStufen {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    box-shadow: var(--schatten);
    font-size: 12px;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 6px;
}

.zeile input[type='checkbox'] {
    accent-color: var(--accent);
    margin: 0;
}

.wert {
    width: 64px;
    padding: 2px 6px;
}

.farbe {
    width: 26px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--line-stark);
    background: transparent;
    cursor: pointer;
}

.weg {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 15px;
}

.weg:hover {
    color: var(--bad);
}

.fuss {
    display: flex;
    gap: 6px;
    margin-top: 4px;
}

.fuss button {
    flex: 1;
    padding: 3px 8px;
    background: var(--panel-soft);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    color: var(--text);
    cursor: pointer;
    font-size: 11px;
}
</style>
