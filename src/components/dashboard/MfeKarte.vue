<script setup>
/**
 * MFE-Analyse (Spezifikation B.10): Verlust-Trades, die zwischenzeitlich im
 * Gewinn waren. Die Seite zeigt die Karte nur, wenn es mindestens einen gibt.
 *
 * Datum: `td` ist der Tagesanfang, die Uhrzeit zeigt darum fast immer den
 * Tagesbeginn statt des Einstiegs — Altverhalten, so nachgebildet.
 */
import { useI18n } from 'vue-i18n'
import { timeZoneTrade } from '../../stores/ui.js'
import { useTwoDecCurrencyFormat, useXDecFormat } from '../../utils/journal/format.js'
import dayjs from '../../utils/journal/zeit.js'
import TitelKarte from './TitelKarte.vue'

defineProps({
    titel: { type: String, required: true },
    analyse: { type: Object, required: true },
})
const { t } = useI18n()
const datum = (s) => dayjs.unix(s).tz(timeZoneTrade.value || 'Europe/Brussels').format('DD.MM.YY HH:mm')
const preis = (x) => useXDecFormat(x, 4)
</script>

<template>
    <TitelKarte :titel="titel" info="dashboard.mfeAnalysisTooltip">
        <div class="mfe-summe">
            <span>{{ t('dashboard.lossTradesInProfit') }}:
                <b class="at-schlecht">{{ analyse.treffer }} / {{ analyse.verlustTrades }} ({{ analyse.quote.toFixed(0) }}%)</b></span>
            <span>{{ t('dashboard.givenBackProfit') }}: <b class="at-gut">{{ useTwoDecCurrencyFormat(analyse.verschenkt) }}</b></span>
            <span>{{ t('dashboard.realizedLoss') }}: <b class="at-schlecht">-{{ useTwoDecCurrencyFormat(analyse.verlust) }}</b></span>
        </div>
        <div class="at-tabelle-huelle mfe-huelle">
            <table class="at-tabelle dicht mfe">
                <thead>
                    <tr>
                        <th>{{ t('dashboard.symbol') }}</th>
                        <th>{{ t('dashboard.date') }}</th>
                        <th class="at-mittig">{{ t('dashboard.side') }}</th>
                        <th class="zahl">Entry</th>
                        <th class="zahl">MFE</th>
                        <th class="zahl">Exit</th>
                        <th class="zahl">{{ t('dashboard.maxReachedProfit') }}</th>
                        <th class="zahl">{{ t('dashboard.realizedLoss') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(z, i) in analyse.zeilen" :key="z.id ?? i">
                        <td>{{ z.symbol }}</td>
                        <td>{{ datum(z.datum) }}</td>
                        <td class="at-mittig"><span :class="['mfe-seite', z.long ? 'long' : 'short']">{{ z.long ? 'Long' : 'Short' }}</span></td>
                        <td class="zahl">{{ preis(z.einstieg) }}</td>
                        <td class="zahl at-gut">{{ preis(z.mfe) }}</td>
                        <td class="zahl at-schlecht">{{ preis(z.ausstieg) }}</td>
                        <td class="zahl at-gut at-fett">{{ useTwoDecCurrencyFormat(z.verschenkt) }}</td>
                        <td class="zahl at-schlecht at-fett">-{{ useTwoDecCurrencyFormat(z.verlust) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </TitelKarte>
</template>

<style scoped>
.mfe-summe {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    margin-bottom: 0.6rem;
    font-size: 0.85rem;
    color: var(--muted);
}

.mfe-huelle {
    max-height: 420px;
    overflow-y: auto;
}

.mfe td {
    white-space: nowrap;
}

.mfe-seite {
    display: inline-block;
    padding: 0.08rem 0.5rem;
    border-radius: var(--radius-pille);
    font-size: 0.74rem;
    font-weight: 600;
}

.mfe-seite.long {
    color: var(--good);
    background: var(--good-flaeche);
}

.mfe-seite.short {
    color: var(--bad);
    background: var(--bad-flaeche);
}
</style>
