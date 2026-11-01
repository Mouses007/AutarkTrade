<script setup>
/**
 * Überblick einer Instanz: Kennzahlen, Kapitalkurve, Trichter („wo gehen
 * Setups verloren") und je Symbol ein Kurzstand — ein Klick führt in den Chart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Diagramm from '../Diagramm.vue'
import InfoTipp from '../../InfoTipp.vue'
import { kapitalkurve } from '../../../utils/strategien/diagramme.js'
import { geld, rText, prozent, zahl, tonVon, grundText } from '../../../utils/strategien/format.js'
import { Hinweis } from '../../basis'

const props = defineProps({
    instanz: { type: Object, required: true },
    perf: { type: Object, default: null },
    positionen: { type: Array, default: () => [] },
})
const emit = defineEmits(['zumChart'])
const { t, te } = useI18n()

const kpi = computed(() => props.perf?.kpis || {})
const schwebend = computed(() => props.positionen.reduce((s, p) => s + (Number(p.stand?.netPnl) || 0), 0))
const kurve = computed(() => kapitalkurve(props.perf?.equityCurve))

const trichter = computed(() => props.perf?.funnel || {})
const stufen = computed(() => [
    { key: 'erkannt', wert: trichter.value.erkannt || 0 },
    { key: 'getriggert', wert: trichter.value.getriggert || 0 },
    { key: 'ausgefuehrt', wert: trichter.value.ausgefuehrt || 0 },
    { key: 'gewonnen', wert: trichter.value.gewonnen || 0 },
])
const anteil = (w) => (trichter.value.erkannt > 0 ? Math.min(100, (w / trichter.value.erkannt) * 100) : 0)
/** Die häufigsten Gründe, warum aus einem Setup kein Trade wurde — beide Quellen zusammen. */
const gruende = computed(() => {
    const alle = { ...(trichter.value.byInvalidReason || {}) }
    for (const [k, n] of Object.entries(trichter.value.byRejectReason || {})) alle[k] = (alle[k] || 0) + n
    return Object.entries(alle).sort((a, b) => b[1] - a[1]).slice(0, 6)
})

const symbole = computed(() => {
    const je = new Map((props.perf?.byGroup?.symbol || []).map((g) => [g.key, g]))
    return props.instanz.symbols.map((s) => ({ symbol: s, ...(je.get(s) || { trades: 0, sumR: 0, winRate: 0 }) }))
})
</script>

<template>
    <div class="ueberblick">
        <div class="kacheln">
            <div class="kachel"><span>{{ t('strategies.trades') }}</span><strong>{{ kpi.trades ?? 0 }}</strong></div>
            <div class="kachel"><span>{{ t('strategies.kpiWinRate') }}</span><strong>{{ kpi.trades ? prozent(kpi.winRate) : '–' }}</strong></div>
            <div class="kachel"><span>{{ t('strategies.kpiExpectancy') }}</span><strong :class="tonVon(kpi.expectancyR)">{{ kpi.trades ? rText(kpi.expectancyR) : '–' }}</strong></div>
            <div class="kachel"><span>Σ R</span><strong :class="tonVon(instanz.summeR)">{{ kpi.trades ? rText(instanz.summeR) : '–' }}</strong></div>
            <div class="kachel"><span>{{ t('strategien.liste.netto') }}</span><strong :class="tonVon(kpi.netPnl)">{{ geld(kpi.netPnl) }}</strong></div>
            <div class="kachel"><span>{{ t('strategien.ueberblick.maxDd') }}</span><strong>{{ kpi.trades ? zahl(kpi.maxDrawdownPct, 1) + ' %' : '–' }}</strong></div>
            <div class="kachel">
                <span>{{ t('strategies.unrealizedShort') }} <InfoTipp :text="t('strategien.ueberblick.schwebendInfo')" /></span>
                <strong :class="tonVon(schwebend)">{{ positionen.length ? geld(schwebend) : '–' }}</strong>
            </div>
        </div>

        <Hinweis v-if="kpi.trades && !kpi.belastbar" art="info">
            {{ t('strategien.ueberblick.zuWenig', { n: kpi.trades, mindestens: kpi.mindestTrades || 30 }) }}
        </Hinweis>

        <div class="zwei">
            <div class="journalKarte karte">
                <div class="abschnittTitel">{{ t('strategien.ueberblick.kapitalkurve') }}</div>
                <Diagramm v-if="kurve" :option="kurve" :hoehe="220" />
                <p v-else class="at-gedaempft">{{ t('strategien.ueberblick.nochKeineTrades') }}</p>
            </div>

            <div class="journalKarte karte">
                <div class="abschnittTitel">{{ t('strategien.ueberblick.trichter') }} <InfoTipp :text="t('strategien.ueberblick.trichterInfo')" /></div>
                <div v-for="s in stufen" :key="s.key" class="stufe">
                    <span class="name">{{ t('strategies.funnel_' + s.key) }}</span>
                    <span class="balken"><span :style="{ width: anteil(s.wert) + '%' }"></span></span>
                    <span class="wert">{{ s.wert }}</span>
                </div>
                <template v-if="gruende.length">
                    <div class="untertitel">{{ t('strategien.ueberblick.warumNicht') }}</div>
                    <div v-for="[code, n] in gruende" :key="code" class="grund">
                        <span>{{ grundText(t, te, code) }}</span><span class="at-gedaempft">{{ n }}</span>
                    </div>
                </template>
            </div>
        </div>

        <div class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategies.symbols') }}</div>
            <div class="symbole">
                <button v-for="s in symbole" :key="s.symbol" type="button" class="symbol"
                    @click="emit('zumChart', { symbol: s.symbol, timeframe: instanz.timeframe })">
                    <strong>{{ s.symbol }}</strong>
                    <span class="at-gedaempft">{{ s.trades }} {{ t('strategies.trades') }}</span>
                    <span v-if="s.trades" :class="tonVon(s.sumR)">{{ rText(s.sumR) }}</span>
                </button>
            </div>
            <small class="at-gedaempft">{{ t('strategien.ueberblick.symbolHinweis') }}</small>
        </div>
    </div>
</template>

<style scoped>
.ueberblick { display: flex; flex-direction: column; gap: 12px; }
.abschnittTitel { font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 4px; }
.kacheln { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.kachel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.kachel span { color: var(--muted); font-size: 0.8rem; }
.kachel strong { font-size: 1.15rem; }
.zwei { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.stufe { display: grid; grid-template-columns: 110px 1fr 48px; gap: 8px; align-items: center; margin: 6px 0; }
.balken { background: var(--panel-soft); border-radius: 4px; height: 10px; overflow: hidden; }
.balken span { display: block; height: 100%; background: var(--accent); }
.wert { text-align: right; }
.untertitel { margin-top: 12px; font-weight: 600; font-size: 0.85rem; }
.grund { display: flex; justify-content: space-between; gap: 8px; font-size: 0.85rem; padding: 2px 0; }
.symbole { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.symbol { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; background: var(--panel-soft); border: 1px solid var(--line); border-radius: var(--radius-knopf); color: var(--text); padding: 8px 12px; cursor: pointer; min-width: 110px; }
.symbol:hover, .symbol:focus-visible { border-color: var(--accent); }
</style>
