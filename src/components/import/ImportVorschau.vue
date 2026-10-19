<script setup>
/**
 * Vorschau eines API-Imports vor dem Absenden: je neuem Handelstag eine
 * Tabelle aus dem Blotter (je Symbol) mit der Tagessumme aus `pAndL` als
 * letzter Zeile.
 *
 * Liest die Import-Stores direkt — dieselben, die `useUploadTrades` später
 * speichert. So zeigt die Vorschau genau das, was geschrieben wird, und nicht
 * eine zweite Rechnung, die davon abweichen könnte.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Tabelle from '../basis/Tabelle.vue'
import { blotter, pAndL, executions } from '../../stores/journal/import.js'
import { useCreatedDateFormat } from '../../utils/journal/format.js'

const { t } = useI18n()

const spalten = computed(() => [
    { schluessel: 'symbol', titel: t('addTrades.spalteSymbol') },
    { schluessel: 'grossProceeds', titel: t('addTrades.spalteBrutto'), zahl: true },
    { schluessel: 'fees', titel: t('addTrades.spalteGebuehren'), zahl: true },
    { schluessel: 'netProceeds', titel: t('addTrades.spalteNetto'), zahl: true },
    { schluessel: 'grossWinsCount', titel: t('addTrades.spalteGewinne'), zahl: true },
    { schluessel: 'grossLossCount', titel: t('addTrades.spalteVerluste'), zahl: true },
    { schluessel: 'trades', titel: t('addTrades.spalteTrades'), zahl: true },
])

/** Zeile aus einem Blotter- oder P&L-Posten. Gewinne/Verluste sind immer die Brutto-Zähler. */
function zeile(symbol, p, summe = false) {
    return {
        symbol,
        summe,
        grossProceeds: p.grossProceeds,
        fees: p.fees,
        netProceeds: p.netProceeds,
        grossWinsCount: p.grossWinsCount,
        grossLossCount: p.grossLossCount,
        trades: p.trades,
    }
}

const tage = computed(() => {
    if (!Object.keys(blotter).length || !Object.keys(pAndL).length) return []
    return Object.keys(executions)
        .filter(td => blotter[td])
        .map(td => {
            const zeilen = Object.entries(blotter[td]).map(([symbol, b]) => zeile(symbol, b))
            if (pAndL[td]) zeilen.push(zeile(t('common.total'), pAndL[td], true))
            return { td, titel: useCreatedDateFormat(Number(td)), zeilen }
        })
})

const zwei = (x) => Number(x ?? 0).toFixed(2)
</script>

<template>
    <div v-for="tag in tage" :key="tag.td" class="vorschau-tag">
        <h3 class="vorschau-titel">{{ tag.titel }}</h3>
        <Tabelle :spalten="spalten" :zeilen="tag.zeilen" schluessel-feld="symbol" dicht>
            <template #zelle-symbol="{ zeile: z, wert }">
                <span :class="{ 'at-fett': z.summe }">{{ wert }}</span>
            </template>
            <template #zelle-grossProceeds="{ zeile: z, wert }">
                <span :class="[wert >= 0 ? 'at-gut' : 'at-schlecht', { 'at-fett': z.summe }]">{{ zwei(wert) }}</span>
            </template>
            <template #zelle-fees="{ zeile: z, wert }">
                <span :class="{ 'at-fett': z.summe }">{{ zwei(wert) }}</span>
            </template>
            <template #zelle-netProceeds="{ zeile: z, wert }">
                <span :class="[wert >= 0 ? 'at-gut' : 'at-schlecht', { 'at-fett': z.summe }]">{{ zwei(wert) }}</span>
            </template>
            <template #zelle-grossWinsCount="{ zeile: z, wert }">
                <span :class="{ 'at-fett': z.summe }">{{ wert }}</span>
            </template>
            <template #zelle-grossLossCount="{ zeile: z, wert }">
                <span :class="{ 'at-fett': z.summe }">{{ wert }}</span>
            </template>
            <template #zelle-trades="{ zeile: z, wert }">
                <span :class="{ 'at-fett': z.summe }">{{ wert }}</span>
            </template>
        </Tabelle>
    </div>
</template>

<style scoped>
.vorschau-tag {
    margin-top: var(--abstand-5);
}

.vorschau-titel {
    margin: 0 0 var(--abstand-2);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
}
</style>
