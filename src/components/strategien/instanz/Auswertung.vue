<script setup>
/**
 * Auswertung einer Instanz: R-Verteilung, Risiko, Gruppen. Die Daten kommen
 * aus `ladePerformance` mit `instanceId` — dieselbe Rechnung wie im Backtest
 * (`berechneStatistik`), und dieselbe, die der KI-Coach liest.
 *
 * Bis 01.11.2026 war das eine eigene Seite über alle Instanzen gemischt; die
 * Gruppe „nach Version" warf dort v3 von A und v3 von B zusammen.
 */
import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import Diagramm from '../Diagramm.vue'
import InfoTipp from '../../InfoTipp.vue'
import { rVerteilung } from '../../../utils/strategien/diagramme.js'
import { geld, zahl, rText, prozent, tonVon } from '../../../utils/strategien/format.js'

const props = defineProps({
    instanz: { type: Object, required: true },
    perf: { type: Object, default: null },
})
const { t } = useI18n()

// Buy & Hold gibt es nur für EIN Symbol — mit mehreren gibt es kein „das hätte man gehalten".
const symbol = ref('')
const mitSymbol = ref(null)
watch(symbol, async (s) => {
    mitSymbol.value = null
    if (!s) return
    const { data } = await axios.get('/api/strategies/performance', { params: { instanceId: props.instanz.id, symbol: s } })
    mitSymbol.value = data
})
const daten = computed(() => mitSymbol.value || props.perf)
const kpi = computed(() => daten.value?.kpis || {})
const verteilung = computed(() => rVerteilung(daten.value?.rVerteilung))

const GRUPPEN = ['symbol', 'direction', 'exitReason', 'timeframe', 'weekday', 'hour', 'paramsVersion']
const gruppenName = (g, key) => (g === 'weekday' ? t('strategies.weekday' + key)
    : g === 'hour' ? `${String(key).padStart(2, '0')}:00 UTC`
    : g === 'paramsVersion' ? `v${key}` : key)
const gruppen = computed(() => GRUPPEN
    .map((g) => ({ g, zeilen: daten.value?.byGroup?.[g] || [] }))
    .filter(({ g, zeilen }) => zeilen.length > 1 || (g === 'symbol' && zeilen.length)))

const profitFaktor = (v, n) => (v === null || v === undefined ? (n > 0 ? '∞' : '–') : zahl(v))
</script>

<template>
    <div class="auswertung">
        <div class="werkzeug">
            <select v-model="symbol" class="at-feld klein" :aria-label="t('strategies.symbol')">
                <option value="">{{ t('strategien.auswertung.alleSymbole') }}</option>
                <option v-for="s in instanz.symbols" :key="s" :value="s">{{ s }}</option>
            </select>
            <span class="at-gedaempft klein">{{ t('strategien.auswertung.symbolHinweis') }}</span>
        </div>

        <p v-if="!kpi.trades" class="journalKarte karte at-gedaempft">{{ t('strategien.ueberblick.nochKeineTrades') }}</p>

        <template v-else>
            <div class="zwei">
                <div class="journalKarte karte">
                    <div class="abschnittTitel">{{ t('strategies.rDistribution') }}</div>
                    <Diagramm v-if="verteilung" :option="verteilung" :hoehe="200" />
                    <dl class="werte">
                        <dt>{{ t('strategies.kpiExpectancy') }}</dt><dd :class="tonVon(kpi.expectancyR)">{{ rText(kpi.expectancyR) }}</dd>
                        <dt>{{ t('strategien.auswertung.ohneTop') }} <InfoTipp :text="t('strategien.auswertung.ohneTopInfo')" /></dt>
                        <dd :class="tonVon(kpi.expectancyROhneTop)">{{ rText(kpi.expectancyROhneTop) }}</dd>
                        <dt>{{ t('strategies.kpiProfitFactor') }}</dt><dd>{{ profitFaktor(kpi.profitFactor, kpi.trades) }}</dd>
                        <dt>Ø {{ t('strategien.auswertung.gewinn') }} / Ø {{ t('strategien.auswertung.verlust') }}</dt>
                        <dd>{{ rText(kpi.avgWinR) }} / {{ rText(kpi.avgLossR) }}</dd>
                    </dl>
                </div>

                <div class="journalKarte karte">
                    <div class="abschnittTitel">{{ t('strategien.auswertung.risiko') }}</div>
                    <dl class="werte">
                        <dt>{{ t('strategien.ueberblick.maxDd') }}</dt><dd>{{ zahl(kpi.maxDrawdownPct, 1) }} %</dd>
                        <dt>{{ t('strategien.auswertung.schwebendDd') }} <InfoTipp :text="t('strategien.auswertung.schwebendDdInfo')" /></dt>
                        <dd>{{ zahl(kpi.maxFloatingDrawdownPct, 1) }} %</dd>
                        <dt>Sharpe <InfoTipp :text="t('strategien.auswertung.sharpeInfo')" /></dt><dd>{{ zahl(kpi.sharpe) }}</dd>
                        <dt>{{ t('strategien.auswertung.gebuehren') }}</dt><dd>{{ geld(-kpi.fees) }}</dd>
                        <dt>Funding</dt><dd :class="tonVon(kpi.funding)">{{ geld(kpi.funding) }}</dd>
                        <dt>{{ t('strategien.auswertung.mfe') }} <InfoTipp :text="t('strategien.auswertung.mfeInfo')" /></dt>
                        <dd>
                            <span v-for="(n, stufe) in kpi.mfeReached || {}" :key="stufe" class="mfe">{{ stufe }}: {{ prozent(kpi.trades ? n / kpi.trades * 100 : null) }}</span>
                        </dd>
                        <template v-if="kpi.baselineBuyHoldReturnPct !== null && kpi.baselineBuyHoldReturnPct !== undefined">
                            <dt>{{ t('strategien.auswertung.buyHold') }}</dt>
                            <dd>{{ zahl(kpi.baselineBuyHoldReturnPct, 1) }} % ({{ t('strategien.auswertung.strategie') }} {{ zahl(kpi.returnPct, 1) }} %)</dd>
                        </template>
                    </dl>
                </div>
            </div>

            <div class="gruppen">
                <div v-for="{ g, zeilen } in gruppen" :key="g" class="journalKarte karte">
                    <div class="abschnittTitel">{{ t('strategien.auswertung.nach.' + g) }}</div>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead>
                                <tr><th></th><th class="zahl">{{ t('strategies.trades') }}</th><th class="zahl">{{ t('strategies.kpiWinRate') }}</th><th class="zahl">Ø R</th><th class="zahl">{{ t('strategien.liste.netto') }}</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="z in zeilen" :key="z.key">
                                    <td>{{ gruppenName(g, z.key) }}</td>
                                    <td class="zahl">{{ z.trades }}</td>
                                    <td class="zahl">{{ prozent(z.winRate) }}</td>
                                    <td class="zahl" :class="tonVon(z.avgR)">{{ rText(z.avgR) }}</td>
                                    <td class="zahl" :class="tonVon(z.netPnl)">{{ geld(z.netPnl) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <small class="at-gedaempft">{{ t('strategien.auswertung.duennHinweis') }}</small>
        </template>
    </div>
</template>

<style scoped>
.auswertung { display: flex; flex-direction: column; gap: 12px; }
.werkzeug { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.klein { font-size: 0.8rem; }
.abschnittTitel { font-weight: 600; margin-bottom: 8px; }
.zwei { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.gruppen { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.werte { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 8px 0 0; }
.werte dt { color: var(--muted); display: flex; align-items: center; gap: 4px; }
.werte dd { margin: 0; text-align: right; }
.mfe { margin-left: 8px; }
</style>
