<script setup>
/**
 * Karte „Gebühren" (Spezifikation B.5.3): Summe, Anteil am Bruttogewinn,
 * Aufschlüsselung und die Brücke von Brutto zu Netto. Kein
 * Brutto/Netto-Kennzeichen — Gebühren sind in beiden Sichten dieselben.
 *
 * `otherFees` erscheint in der Aufschlüsselung, nicht in der Brücke (offener
 * Punkt der Spezifikation, so nachgebildet).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { totals } from '../../stores/trades.js'
import { formGeld2 } from '../../utils/journal/format.js'
import InfoTipp from '@/components/InfoTipp.vue'
import TitelKarte from './TitelKarte.vue'
import { gebuehren } from './rechnung.js'

const { t } = useI18n()
const g = computed(() => gebuehren(totals))
const geld = formGeld2
</script>

<template>
    <TitelKarte :titel="t('dashboard.fees')">
        <div class="kg-kopf">
            <div class="kg-gross zahl at-warn">{{ geld(g.gesamt) }}</div>
            <div class="kg-unter">{{ t('dashboard.totalFees') }}</div>
        </div>

        <div v-if="g.anteil > 0" class="kg-anteil">
            <div class="kg-anteil-zeile">
                <span>{{ t('dashboard.feeShareOfGross') }}</span>
                <span class="zahl">{{ g.anteil.toFixed(1) }}%</span>
            </div>
            <div class="kg-balken"><div :style="{ width: Math.min(g.anteil, 100) + '%' }"></div></div>
        </div>

        <table class="kg">
            <tbody>
                <tr class="trenner"><td colspan="2"></td></tr>
                <tr>
                    <td>{{ t('dashboard.avgPerTrade') }}</td>
                    <td class="zahl at-fett">{{ geld(g.jeTrade) }}</td>
                </tr>
                <tr>
                    <td>{{ t('dashboard.tradingFees') }} <InfoTipp schluessel="dashboard.tradingFeesTooltip" /></td>
                    <td class="zahl">{{ geld(g.handel) }}</td>
                </tr>
                <tr v-if="g.fundingPaid > 0">
                    <td>{{ t('dashboard.fundingPaid') }} <InfoTipp schluessel="dashboard.fundingFeesTooltip" /></td>
                    <td class="zahl">{{ geld(g.fundingPaid) }}</td>
                </tr>
                <tr v-if="g.fundingReceived > 0">
                    <td>{{ t('dashboard.fundingReceived') }} <InfoTipp schluessel="dashboard.fundingFeesTooltip" /></td>
                    <td class="zahl at-gut">-{{ geld(g.fundingReceived) }}</td>
                </tr>
                <tr v-if="g.otherFees > 0">
                    <td>{{ t('dashboard.otherFees') }}</td>
                    <td class="zahl">{{ geld(g.otherFees) }}</td>
                </tr>

                <tr class="trenner"><td colspan="2"></td></tr>
                <tr>
                    <td>{{ t('dashboard.grossPnl') }}</td>
                    <td class="zahl at-fett" :class="g.brutto >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(g.brutto) }}</td>
                </tr>
                <tr>
                    <td class="leise">− {{ t('dashboard.tradingFees') }}</td>
                    <td class="zahl at-warn">{{ geld(g.handel) }}</td>
                </tr>
                <tr v-if="g.fundingNetto !== 0">
                    <td class="leise">{{ g.fundingNetto >= 0 ? '−' : '+' }} {{ t('dashboard.fundingNet') }}</td>
                    <td class="zahl" :class="g.fundingNetto >= 0 ? 'at-warn' : 'at-gut'">{{ geld(Math.abs(g.fundingNetto)) }}</td>
                </tr>
                <tr class="summe">
                    <td>{{ t('dashboard.netPnl') }}</td>
                    <td class="zahl at-fett" :class="g.netto >= 0 ? 'at-gut' : 'at-schlecht'">{{ geld(g.netto) }}</td>
                </tr>
            </tbody>
        </table>
    </TitelKarte>
</template>

<style scoped>
.kg-kopf {
    text-align: center;
}

.kg-gross {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.15;
}

.kg-unter {
    font-size: 0.78rem;
    color: var(--muted);
}

.kg-anteil {
    margin-top: 0.6rem;
    font-size: 0.82rem;
}

.kg-anteil-zeile {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--muted);
}

.kg-anteil-zeile .zahl {
    color: var(--text);
}

.kg-balken {
    height: 6px;
    margin-top: 0.25rem;
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    overflow: hidden;
}

.kg-balken > div {
    height: 100%;
    background: var(--warn);
}

.kg {
    width: 100%;
    margin-top: 0.3rem;
    border-collapse: collapse;
    font-size: 0.85rem;
}

.kg td {
    padding: 0.2rem 0;
    vertical-align: middle;
}

.kg td:first-child {
    color: var(--muted);
}

.kg td.leise {
    color: var(--leise);
    padding-left: 0.6rem;
}

.kg td.zahl {
    text-align: right;
    white-space: nowrap;
    padding-left: 0.6rem;
}

.kg .trenner td {
    padding: 0.3rem 0 0;
    border-bottom: 1px solid var(--line);
}

.kg .trenner + tr td {
    padding-top: 0.4rem;
}

.kg .summe td {
    border-top: 1px dashed var(--line-stark);
    padding-top: 0.3rem;
}

.kg .summe td:first-child {
    color: var(--text);
    font-weight: 600;
}
</style>
