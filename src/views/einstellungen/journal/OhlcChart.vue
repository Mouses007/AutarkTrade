<script setup>
/** Journal → OHLC-Chart: Binance-Kerzen in der Trade-Ansicht. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'

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
    <div>
        <hr />

        <!--=============== OHLC-CHART ===============-->
        <div class="d-flex align-items-center pointerClass" @click="chartExpanded = !chartExpanded">
            <i class="uil me-2" :class="chartExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.ohlcChart') }}</p>
        </div>
        <div v-show="chartExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.ohlcDescription') }}</p>
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="binanceToggle" v-model="enableBinanceChart" @change="saveBinanceSetting">
                <label class="form-check-label" for="binanceToggle">{{ t('settings.enableBinanceChart') }}</label>
            </div>
        </div>

    </div>
</template>
