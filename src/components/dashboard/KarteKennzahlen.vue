<script setup>
/**
 * Karte „Kennzahlen" (Spezifikation B.5.2). F = `amountCase`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { amountCase } from '../../stores/filters.js'
import { totals, profitAnalysis } from '../../stores/trades.js'
import { useThousandCurrencyFormat, useTwoDecCurrencyFormat, useThousandFormat } from '../../utils/journal/format.js'
import InfoTipp from '@/components/InfoTipp.vue'
import TitelKarte from './TitelKarte.vue'

const props = defineProps({
    titel: { type: String, required: true },
    /** Ergebnis aus `ratioAnzeige` der Seite: { kurz, wert, info } oder leer. */
    ratio: { type: Object, default: () => ({}) },
})
const { t } = useI18n()

const F = computed(() => amountCase.value)
const pa = (feld) => profitAnalysis[F.value + feld]

/** NaN, null und undefined zeigen „-" (null warf früher beim Formatieren). */
const leer = (x) => x === null || x === undefined || Number.isNaN(Number(x))
const zwei = (x) => (leer(x) ? '-' : Number(x).toFixed(2))
const waehrung = (x) => (leer(x) ? '-' : useTwoDecCurrencyFormat(x))
const nurPositiv = (x) => (Number(x) > 0 ? useTwoDecCurrencyFormat(x) : '-')

const kumuliert = computed(() => totals[F.value + 'Proceeds'])
const mfeR = computed(() => pa('MfeR'))
</script>

<template>
    <TitelKarte :titel="props.titel">
        <table class="kk">
            <tbody>
                <tr>
                    <td>{{ t('dashboard.cumulativePnl') }} <InfoTipp schluessel="dashboard.cumulativePnlTooltip" /></td>
                    <td class="zahl at-fett" :class="kumuliert >= 0 ? 'at-gut' : 'at-schlecht'">{{ useThousandCurrencyFormat(kumuliert) }}</td>
                </tr>
                <tr>
                    <td>{{ ratio.kurz }} <InfoTipp v-if="ratio.info" :text="ratio.info" /></td>
                    <td class="zahl at-fett">{{ ratio.wert }}</td>
                </tr>
                <tr>
                    <td>{{ t('dashboard.plRatio') }} <InfoTipp schluessel="dashboard.plRatioTooltip" /></td>
                    <td class="zahl at-fett">{{ zwei(pa('R')) }}</td>
                </tr>
                <tr v-if="mfeR !== null && mfeR !== undefined">
                    <td>{{ t('dashboard.mfePlRatio') }} <InfoTipp schluessel="dashboard.mfePlRatioTooltip" /></td>
                    <td class="zahl at-fett">{{ zwei(mfeR) }}</td>
                </tr>
                <tr class="trenner"><td colspan="2"></td></tr>
                <tr>
                    <td class="at-gut">{{ t('dashboard.avgWinPerTrade') }}</td>
                    <td class="zahl">{{ waehrung(pa('AvWinPerShare')) }}</td>
                </tr>
                <tr>
                    <td class="at-schlecht">{{ t('dashboard.avgLossPerTrade') }}</td>
                    <td class="zahl">{{ waehrung(pa('AvLossPerShare')) }}</td>
                </tr>
                <tr>
                    <td class="at-gut">{{ t('dashboard.maxWin') }}</td>
                    <td class="zahl">{{ nurPositiv(pa('HighWinPerShare')) }}</td>
                </tr>
                <tr>
                    <td class="at-schlecht">{{ t('dashboard.maxLoss') }}</td>
                    <td class="zahl">{{ nurPositiv(pa('HighLossPerShare')) }}</td>
                </tr>
                <tr class="trenner"><td colspan="2"></td></tr>
                <tr>
                    <td>{{ t('common.trades') }}</td>
                    <td class="zahl at-fett">{{ useThousandFormat(totals.trades) }}</td>
                </tr>
                <tr>
                    <td class="at-gut">{{ t('dashboard.winTrades') }}</td>
                    <td class="zahl">{{ totals[F + 'WinsCount'] }}</td>
                </tr>
                <tr>
                    <td class="at-schlecht">{{ t('dashboard.lossTrades') }}</td>
                    <td class="zahl">{{ totals[F + 'LossCount'] }}</td>
                </tr>
            </tbody>
        </table>
    </TitelKarte>
</template>

<style scoped>
.kk {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
}

.kk td {
    padding: 0.2rem 0;
    vertical-align: middle;
}

.kk td:first-child {
    color: var(--muted);
}

.kk td:first-child.at-gut { color: var(--good); }
.kk td:first-child.at-schlecht { color: var(--bad); }

.kk td.zahl {
    text-align: right;
    padding-left: 0.6rem;
    white-space: nowrap;
}

.kk .trenner td {
    padding: 0.3rem 0 0;
    border-bottom: 1px solid var(--line);
}

.kk .trenner + tr td {
    padding-top: 0.4rem;
}
</style>
