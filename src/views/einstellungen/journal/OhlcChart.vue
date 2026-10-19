<script setup>
/** Journal → OHLC-Chart: Binance-Kerzen in der Trade-Ansicht. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Schalter from '../gemeinsam/Schalter.vue'

const { t } = useI18n()

let chartExpanded = ref(false)
let enableBinanceChart = ref(false)

/* BINANCE CHART SETTING */
async function saveBinanceSetting() {
    try {
        await dbUpdateSettings({ enableBinanceChart: enableBinanceChart.value ? 1 : 0 })
        currentUser.value.enableBinanceChart = enableBinanceChart.value ? 1 : 0
        console.log(' -> Binance-Chart-Einstellung gespeichert:', enableBinanceChart.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Binance-Chart-Einstellung:', error)
    }
}

enableBinanceChart.value = currentUser.value?.enableBinanceChart === 1
</script>

<template>
    <Abschnitt :titel="t('settings.ohlcChart')" symbol="chart" v-model:offen="chartExpanded">
        <p class="beschreibung">{{ t('settings.ohlcDescription') }}</p>
        <Schalter v-model="enableBinanceChart" :label="t('settings.enableBinanceChart')" @change="saveBinanceSetting" />
    </Abschnitt>
</template>

<style scoped>
.beschreibung { color: var(--muted); margin: 0 0 var(--abstand-2); }
</style>
