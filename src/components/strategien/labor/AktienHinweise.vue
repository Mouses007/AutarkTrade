<script setup>
/**
 * Was ein Backtest auf einem Aktien-Future anders gerechnet hat und worauf
 * sein Ergebnis steht (`stats.aktien` aus `server/strategy-backtest.js`):
 * Börsensitzungen statt UTC-Tagen, umgerechnete Splits, Stichtage der Börse —
 * und das Ergebnis je Sitzung des Einstiegs. Ohne `aktien` (Coin) zeigt die
 * Komponente nichts.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Hinweis } from '../../basis'

const props = defineProps({
    aktien: { type: Object, default: null },
    /** Geldbetrag formatieren, wie der Rest des Labors. */
    geld: { type: Function, default: (v) => Number(v).toFixed(2) },
})
const { t } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix' }
const datum = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : '–')
const zahl = (v, n = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '–')
const faktor = (f) => (f >= 1 ? `${zahl(f, f % 1 ? 2 : 0)}:1` : `1:${zahl(1 / f, (1 / f) % 1 ? 2 : 0)}`)

const boerse = computed(() => PLATZ[props.aktien?.boerse] || props.aktien?.boerse || '–')
const angewendet = computed(() => (props.aktien?.splits || []).filter((s) => s.angewendet))
const offen = computed(() => (props.aktien?.splits || []).filter((s) => !s.angewendet))
const splitText = (liste) => liste.map((s) => `${s.text || faktor(s.faktor)} (${datum(s.t)})`).join(', ')
const summeTrades = computed(() => (props.aktien?.sitzungen || []).reduce((n, s) => n + s.trades, 0))
</script>

<template>
    <div v-if="aktien" class="aktienHinweise">
        <Hinweis art="info" class="abstandUnten">
            {{ t('strategies.aktien.kopf', { ticker: aktien.ticker, boerse }) }}
            <template v-if="aktien.nurRegulaer"> {{ t('strategies.aktien.nurRegulaer') }}</template>
        </Hinweis>

        <Hinweis v-if="angewendet.length" art="info" class="abstandUnten">
            {{ t('strategies.aktien.splitAngewendet', { splits: splitText(angewendet) }) }}
        </Hinweis>
        <Hinweis v-if="offen.length" art="warn" class="abstandUnten">
            {{ t('strategies.aktien.splitOffen', { splits: splitText(offen) }) }}
        </Hinweis>
        <Hinweis v-if="!aktien.splitsBekannt" :art="aktien.sprungVerdacht?.length ? 'fehler' : 'warn'" class="abstandUnten">
            {{ t('strategies.aktien.splitUnbekannt_' + (aktien.splitsGrund || 'abrufFehlgeschlagen')) }}
            <template v-if="aktien.sprungVerdacht?.length">
                {{ t('strategies.aktien.sprungVerdacht', { tage: aktien.sprungVerdacht.map((s) => datum(s.t)).join(', ') }) }}
            </template>
        </Hinweis>

        <Hinweis v-if="aktien.regime" art="warn" class="abstandUnten">
            {{ t(aktien.regime.ganzDavor ? 'strategies.aktien.regimeDavor' : 'strategies.aktien.regimeUeber', { boerse, tag: datum(aktien.regime.stichtag) }) }}
        </Hinweis>

        <div v-if="aktien.sitzungen?.length" class="sitzungen abstandUnten">
            <h4>{{ t('strategies.aktien.jeSitzung') }}</h4>
            <table>
                <thead>
                    <tr>
                        <th>{{ t('strategies.aktien.sitzung') }}</th>
                        <th class="rechts">{{ t('strategies.aktien.trades') }}</th>
                        <th class="rechts">{{ t('strategies.aktien.anteil') }}</th>
                        <th class="rechts">{{ t('strategies.aktien.treffer') }}</th>
                        <th class="rechts">{{ t('strategies.aktien.summeR') }}</th>
                        <th class="rechts">{{ t('strategies.aktien.netto') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="s in aktien.sitzungen" :key="s.sitzung">
                        <td>{{ t('strategies.aktien.sitzung_' + s.sitzung) }}</td>
                        <td class="rechts">{{ s.trades }}</td>
                        <td class="rechts">{{ zahl(summeTrades ? s.trades / summeTrades * 100 : 0, 0) }} %</td>
                        <td class="rechts">{{ zahl(s.gewinner / s.trades * 100, 0) }} %</td>
                        <td class="rechts" :class="s.summeR > 0 ? 'gut' : s.summeR < 0 ? 'schlecht' : ''">{{ zahl(s.summeR) }} R</td>
                        <td class="rechts" :class="s.netPnl > 0 ? 'gut' : s.netPnl < 0 ? 'schlecht' : ''">{{ geld(s.netPnl) }}</td>
                    </tr>
                </tbody>
            </table>
            <p class="klein">{{ t('strategies.aktien.jeSitzungHinweis') }}</p>
        </div>
    </div>
</template>

<style scoped>
.abstandUnten {
    margin-bottom: 0.7rem;
}

.sitzungen h4 {
    margin: 0 0 0.4rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--muted);
}

table {
    width: 100%;
    max-width: 44rem;
    border-collapse: collapse;
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
}

th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--line);
}

td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--line);
}

.rechts {
    text-align: right;
}

.gut {
    color: var(--good);
}

.schlecht {
    color: var(--bad);
}

.klein {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.8rem;
}
</style>
