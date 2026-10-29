<script setup>
/**
 * Chart & Analyse → Chart: Kerzenfarben des Chart-Arbeitsplatzes (und des
 * Trade-Bilds), die Grenzlinie des Momentum Radars (Chart, Live-Trading-Kachel,
 * Momentum-Alarme; vorher bei den Marktradar-Kacheln) und der OHLC-Chart im
 * Trade-Detail des Journals.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Eingabe from '@/components/basis/Eingabe.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import KerzenFarbFelder from '@/components/chart/KerzenFarbFelder.vue'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'

const { t } = useI18n()

const offen = ref(false)

// Grenzlinie des Momentum Radars (Chart, Kachel, Momentum-Alarme) — leer = 50
const MOMENTUM_GRENZEN = [30, 35, 40, 45, 50, 55, 60, 70, 80].map((w) => ({ wert: w, text: w === 50 ? `±50 (${t('settings.kerzenVorgabe')})` : `±${w}` }))
const momentumGrenze = ref(Number(appEinstellungen.value?.momentumGrenze) || 50)
function momentumGrenzeSpeichern(w) { kiSpeichern('momentumGrenze', Number(w) === 50 ? null : Number(w)) }

// OHLC-Chart (Binance-Kerzen) im Trade-Detail
const enableBinanceChart = ref(appEinstellungen.value?.enableBinanceChart === 1)
async function saveBinanceSetting() {
    try {
        await dbUpdateSettings({ enableBinanceChart: enableBinanceChart.value ? 1 : 0 })
        appEinstellungen.value.enableBinanceChart = enableBinanceChart.value ? 1 : 0
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Binance-Chart-Einstellung:', error)
    }
}
</script>

<template>
    <Abschnitt v-model:offen="offen" :titel="t('settings.chartAbschnitt')" symbol="chart">
        <!-- Kerzenfarben des Charts (Chart-Arbeitsplatz und Trade-Bild) -->
        <h3 class="zwischentitel">{{ t('settings.kerzenFarben') }}</h3>
        <p class="hinweis">{{ t('settings.kerzenFarbenHint') }}</p>
        <KerzenFarbFelder />

        <!-- Grenzlinie des Momentum Radars -->
        <div class="block">
            <Feld :label="t('settings.momentumGrenze')" :hilfe="t('settings.momentumGrenzeHint')">
                <Eingabe v-model="momentumGrenze" art="auswahl" :optionen="MOMENTUM_GRENZEN"
                    @update:model-value="momentumGrenzeSpeichern" />
            </Feld>
        </div>

        <!-- OHLC-Chart im Trade-Detail des Journals -->
        <div class="block">
            <h3 class="zwischentitel">{{ t('settings.ohlcChart') }}</h3>
            <p class="hinweis">{{ t('settings.ohlcDescription') }}</p>
            <Schalter v-model="enableBinanceChart" :label="t('settings.enableBinanceChart')" @change="saveBinanceSetting" />
        </div>
    </Abschnitt>
</template>

<style scoped>
.block { margin-top: var(--abstand-4); }
.zwischentitel {
    margin: 0 0 0.2rem;
    font-size: 0.95rem;
    font-weight: 600;
}
.hinweis {
    margin: 0.2rem 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.82rem;
}
</style>
