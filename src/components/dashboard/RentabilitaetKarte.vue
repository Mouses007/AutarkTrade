<script setup>
/**
 * Rentabilität je Trade-Typ oder je Strategie-Tag (Spezifikation B.11).
 * Die Zeilen rechnet `rechnung.js`; hier wird nur gezeichnet.
 */
import { useI18n } from 'vue-i18n'
import { useTwoDecCurrencyFormat } from '../../utils/journal/format.js'
import TitelKarte from './TitelKarte.vue'

defineProps({
    titel: { type: String, required: true },
    info: { type: String, default: '' },
    /** Überschrift der ersten Spalte. */
    spalte: { type: String, required: true },
    /** Zeilen aus typStatistik/strategieStatistik. */
    zeilen: { type: Array, required: true },
})
const { t } = useI18n()
const faktor = (f) => (f === Infinity ? '∞' : f.toFixed(2))
</script>

<template>
    <TitelKarte :titel="titel" :info="info">
        <div class="at-tabelle-huelle">
            <table class="at-tabelle dicht rt">
                <thead>
                    <tr>
                        <th>{{ spalte }}</th>
                        <th class="zahl">Trades</th>
                        <th>{{ t('dashboard.winRate') }}</th>
                        <th class="zahl">∅ P&amp;L</th>
                        <th class="zahl">{{ t('dashboard.netPnl') }}</th>
                        <th class="zahl">{{ t('options.profitFactor') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="z in zeilen" :key="z.schluessel">
                        <td>
                            <span v-if="z.farbe" class="rt-marke" :style="{ '--ton': z.farbe }">{{ z.name }}</span>
                            <span v-else :class="['rt-marke', 'ton-' + z.ton]">{{ z.name }}</span>
                        </td>
                        <td class="zahl">
                            <span class="at-gedaempft">{{ z.anzahl }}</span>
                            <small class="rt-wl">({{ z.gewinner }}W / {{ z.verlierer }}L)</small>
                        </td>
                        <td>
                            <div class="rt-quote">
                                <span class="rt-balken"><span :style="{ width: z.quote + '%' }" :class="z.quote >= 50 ? 'gut' : 'schlecht'"></span></span>
                                <span class="zahl" :class="z.quote >= 50 ? 'at-gut' : 'at-schlecht'">{{ z.quote.toFixed(0) }}%</span>
                            </div>
                        </td>
                        <td class="zahl" :class="z.schnitt >= 0 ? 'at-gut' : 'at-schlecht'">{{ useTwoDecCurrencyFormat(z.schnitt) }}</td>
                        <td class="zahl at-fett" :class="z.summe >= 0 ? 'at-gut' : 'at-schlecht'">{{ useTwoDecCurrencyFormat(z.summe) }}</td>
                        <td class="zahl" :class="z.faktor >= 1 ? 'at-gut' : 'at-schlecht'">{{ faktor(z.faktor) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </TitelKarte>
</template>

<style scoped>
.rt td {
    white-space: nowrap;
}

/*
 * Marke in Typ- bzw. Tagfarbe. Tagfarben kommen aus den Einstellungen des
 * Nutzers (Daten, nicht Gestaltung) und werden deshalb als Wert gesetzt;
 * die Typfarben stammen aus den Token.
 */
.rt-marke {
    --ton: var(--muted);
    display: inline-block;
    padding: 0.12rem 0.55rem;
    border-radius: var(--radius-pille);
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ton);
    background: color-mix(in srgb, var(--ton) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--ton) 35%, transparent);
}

.rt-marke.ton-warn { --ton: var(--warn); }
.rt-marke.ton-blau { --ton: var(--accent); }
.rt-marke.ton-violett { --ton: var(--text); }
.rt-marke.ton-grau { --ton: var(--muted); }

.rt-wl {
    margin-left: 0.3rem;
    color: var(--leise);
    font-size: 0.72rem;
}

.rt-quote {
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.rt-balken {
    display: inline-block;
    width: 3rem;
    height: 5px;
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    overflow: hidden;
}

.rt-balken > span {
    display: block;
    height: 100%;
}

.rt-balken > span.gut { background: var(--good); }
.rt-balken > span.schlecht { background: var(--bad); }
</style>
