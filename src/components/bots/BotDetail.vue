<script setup>
/**
 * Detailansicht eines Bots: alle Werte von Pionex, die Kennzahlen der App,
 * der Kurs über die Laufzeit mit Grid-Band und Liquidation, und das Wissen
 * über den Bot-Typ (GET /api/bots/wissen).
 *
 * Kerzen kommen aus der eingestellten Marktdaten-Quelle (GET /api/bots/:id/markt),
 * nicht von Pionex — der Chart sagt das.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import * as echarts from 'echarts'
import Karte from '@/components/basis/Karte.vue'
import Pille from '@/components/basis/Pille.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { palette, mitDeckkraft, tooltipStil, schrift, grundOption, wertAchse } from '@/utils/journal/diagramme/gestaltung.js'
import { preis, betrag, prozent, zahl, datum, dauer, ton } from './format.js'
import BotSimulation from './BotSimulation.vue'
import BotKi from './BotKi.vue'
import BotAktionen from './BotAktionen.vue'

// Typen mit festem Band, die die Simulation rechnen kann (wie SIMULIERBAR im Server)
const SIMULIERBAR = ['futures_grid', 'coinm_grid', 'spot_grid', 'leveraged_grid']

const props = defineProps({
    bot: { type: Object, required: true },
    steuerung: { type: Object, default: null },
    wissen: { type: Object, default: null },   // TYPEN-Eintrag
    wissenStand: { type: String, default: '' },
})
const { t, te } = useI18n()
const emit = defineEmits(['gesendet'])
const steuerungAktiv = computed(() => !!(props.steuerung?.schluessel && props.steuerung?.freigeschaltet && ['futures_grid', 'coinm_grid'].includes(props.bot.typ)))
const vorschlag = ref(null)
const aktKarte = ref(null)
function umsetzen(v) {
    vorschlag.value = { ...v }
    nextTick(() => aktKarte.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
}
const simulation = ref(null)
const simKarte = ref(null)
function inSimulation(v) {
    simulation.value?.uebernehme(v)
    simKarte.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

const markt = ref(null)
const marktFehler = ref('')
const marktAus = ref(false)
const laedt = ref(false)
const chartEl = ref(null)
let chart = null
const verlauf = ref([])
const verlaufEl = ref(null)
let verlaufChart = null

const k = computed(() => markt.value?.kennzahlen || props.bot.kennzahlen || {})
const mc = computed(() => props.bot.marginCoin)
const text = (pfad, wert) => (wert && te(`${pfad}.${wert}`) ? t(`${pfad}.${wert}`) : (wert || '—'))

function stopText(s) {
    if (!s || s.wert == null) return t('bots.feld.keiner')
    if (/price/.test(s.art || '')) return preis(s.wert)
    if (s.art === 'profit_ratio') return prozent(s.wert)
    return `${zahl(s.wert, 4)} (${s.art})`
}

async function ladeMarkt() {
    laedt.value = true
    marktFehler.value = ''
    marktAus.value = false
    try {
        const { data } = await axios.get(`/api/bots/${encodeURIComponent(props.bot.id)}/markt`)
        if (data?.aus) { marktAus.value = true; return }
        markt.value = data
        await nextTick()
        zeichne()
    } catch (e) {
        marktFehler.value = e?.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

function zeichne() {
    if (!chartEl.value || !markt.value?.kerzen?.length) return
    const p = palette()
    if (!chart) chart = echarts.init(chartEl.value)
    const b = props.bot
    const kerzen = markt.value.kerzen
    const x = kerzen.map((kz) => datum(kz[0]))
    const linien = []
    const linie = (wert, name, farbe, typ = 'dashed') => {
        if (wert != null) linien.push({ yAxis: wert, name, lineStyle: { color: farbe, type: typ }, label: { formatter: `${name} ${preis(wert)}`, color: farbe, position: 'insideEndTop' } })
    }
    linie(b.liquidation?.unten, 'Liq', p.bad)
    linie(b.liquidation?.oben, 'Liq', p.bad)
    linie(b.position?.einstieg, t('bots.feld.einstieg'), p.accent, 'dotted')
    if (b.stops?.stopLoss && /price/.test(b.stops.stopLoss.art || '')) linie(b.stops.stopLoss.wert, 'SL', p.warn)
    if (b.stops?.takeProfit && /price/.test(b.stops.takeProfit.art || '')) linie(b.stops.takeProfit.wert, 'TP', p.good)
    // Achse: Kerzen plus alle Linien; ein Band-Ende nur, wenn es nahe liegt —
    // ein Band bis 200 bei Kursen um 90 drückte die Kerzen sonst zum Strich.
    const preise = kerzen.flatMap((kz) => [kz[2], kz[3]])
    let lo = Math.min(...preise, ...linien.map((l) => l.yAxis))
    let hi = Math.max(...preise, ...linien.map((l) => l.yAxis))
    const spanne = hi - lo || hi * 0.05
    for (const r of [b.grid?.unten, b.grid?.oben]) {
        if (r != null && r >= lo - 0.3 * spanne && r <= hi + 0.3 * spanne) { lo = Math.min(lo, r); hi = Math.max(hi, r) }
    }
    const rand = (hi - lo) * 0.04
    chart.setOption({
        ...grundOption(p),
        grid: { left: 8, right: 70, top: 16, bottom: 28, containLabel: true },
        tooltip: { trigger: 'axis', ...tooltipStil(p), valueFormatter: (v) => preis(v) },
        xAxis: { type: 'category', data: x, axisLabel: { ...schrift(p) }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: { ...wertAchse(p), scale: true, position: 'right', min: lo - rand, max: hi + rand, axisLabel: { ...schrift(p), formatter: (v) => preis(v) } },
        dataZoom: [{ type: 'inside' }],
        series: [{
            type: 'candlestick',
            // ECharts: [open, close, low, high]
            data: kerzen.map((kz) => [kz[1], kz[4], kz[3], kz[2]]),
            itemStyle: { color: p.good, color0: p.bad, borderColor: p.good, borderColor0: p.bad },
            markArea: b.grid?.unten != null ? {
                silent: true,
                itemStyle: { color: mitDeckkraft(p.accent, 0.08), borderColor: mitDeckkraft(p.accent, 0.5), borderWidth: 1 },
                data: [[{ yAxis: b.grid.unten }, { yAxis: b.grid.oben }]],
            } : undefined,
            markLine: { symbol: 'none', silent: true, data: linien },
        }],
    }, true)
}

async function ladeVerlauf() {
    try {
        const { data } = await axios.get(`/api/bots/${encodeURIComponent(props.bot.id)}/verlauf`)
        verlauf.value = data?.punkte || []
        await nextTick()
        zeichneVerlauf()
    } catch { verlauf.value = [] }
}

function zeichneVerlauf() {
    if (!verlaufEl.value || verlauf.value.length < 2) return
    const p = palette()
    if (!verlaufChart) verlaufChart = echarts.init(verlaufEl.value)
    const reihe = (feld) => verlauf.value.map((v) => [Number(v.t), v[feld]])
    verlaufChart.setOption({
        ...grundOption(p),
        grid: { left: 8, right: 16, top: 28, bottom: 24, containLabel: true },
        legend: { top: 0, textStyle: schrift(p) },
        tooltip: { trigger: 'axis', ...tooltipStil(p), valueFormatter: (v) => betrag(v, mc.value) },
        xAxis: { type: 'time', axisLabel: { ...schrift(p) }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: { ...wertAchse(p), scale: true },
        series: [
            { name: t('bots.feld.gewinn'), type: 'line', showSymbol: false, data: reihe('gesamt'), lineStyle: { color: p.accent }, itemStyle: { color: p.accent } },
            { name: t('bots.feld.gridGewinn'), type: 'line', showSymbol: false, data: reihe('gridGewinn'), lineStyle: { color: p.good }, itemStyle: { color: p.good } },
            { name: t('bots.feld.funding'), type: 'line', showSymbol: false, data: reihe('funding'), lineStyle: { color: p.warn, type: 'dashed' }, itemStyle: { color: p.warn } },
        ],
    }, true)
}

function groesse() { chart?.resize(); verlaufChart?.resize() }
onMounted(() => { ladeMarkt(); ladeVerlauf(); window.addEventListener('resize', groesse) })
onBeforeUnmount(() => {
    window.removeEventListener('resize', groesse)
    chart?.dispose(); chart = null
    verlaufChart?.dispose(); verlaufChart = null
})
watch(() => props.bot.id, () => { markt.value = null; chart?.clear(); verlaufChart?.clear(); ladeMarkt(); ladeVerlauf() })

const rohZeilen = computed(() => Object.entries(props.bot.roh || {})
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .sort(([a], [b]) => a.localeCompare(b)))
</script>

<template>
    <div class="botDetail">
        <div class="kopf">
            <h2>{{ bot.coin }}</h2>
            <Pille ton="neutral">{{ bot.typName }}</Pille>
            <Pille v-if="bot.richtung" :ton="{ LONG: 'gut', SHORT: 'schlecht' }[bot.richtung] || 'neutral'">{{ t(`bots.richtung.${bot.richtung}`) }}</Pille>
            <Pille v-if="bot.hebel" ton="neutral">{{ bot.hebel }}x</Pille>
            <span class="status">{{ text('bots.status', bot.status) }}<template v-if="bot.endGrund"> · {{ text('bots.grund', bot.endGrund) }}</template></span>
        </div>

        <ul v-if="k.hinweise?.length" class="hinweise">
            <li v-for="h in k.hinweise" :key="h"><Symbol name="warnung" :groesse="14" /> {{ t(`bots.hinweis.${h}`) }}</li>
        </ul>

        <div class="raster">
            <Karte :titel="t('bots.abschnitt.grid')">
                <dl class="liste">
                    <dt>{{ t('bots.feld.band') }}</dt><dd>{{ preis(bot.grid?.unten) }} – {{ preis(bot.grid?.oben) }}</dd>
                    <dt>{{ t('bots.feld.grids') }}</dt><dd>{{ zahl(bot.grid?.anzahl) }} · {{ bot.grid?.art || '—' }}</dd>
                    <dt>{{ t('bots.feld.abstand') }}</dt>
                    <dd>
                        <template v-if="bot.grid?.abstand">{{ prozent(bot.grid.abstand.unten, { stellen: 2 }) }} – {{ prozent(bot.grid.abstand.oben, { stellen: 2 }) }}</template>
                        <template v-else>—</template>
                    </dd>
                    <dt>{{ t('bots.feld.nettoZyklus') }}</dt><dd>{{ prozent(bot.grid?.nettoJeZyklus, { stellen: 3 }) }}</dd>
                    <dt>{{ t('bots.feld.mengeJeGrid') }}</dt><dd>{{ zahl(bot.grid?.mengeJeGrid, 6) }}</dd>
                    <dt>{{ t('bots.feld.bandInAtr') }}</dt><dd>{{ k.bandInAtr != null ? t('bots.feld.inAtr', { n: zahl(k.bandInAtr, 1) }) : '—' }}</dd>
                    <dt>{{ t('bots.feld.zeitImBand') }}</dt>
                    <dd>{{ k.zeitImBand ? t('bots.zeitImBandText', { innen: prozent(k.zeitImBand.innen, { stellen: 0 }), darunter: prozent(k.zeitImBand.darunter, { stellen: 0 }), darueber: prozent(k.zeitImBand.darueber, { stellen: 0 }) }) : '—' }}</dd>
                    <dt>{{ t('bots.feld.trigger') }}</dt><dd>{{ bot.trigger ? preis(bot.trigger.preis) : t('bots.feld.keiner') }}</dd>
                    <dt>{{ t('bots.feld.trailing') }}</dt><dd>{{ bot.trailing ? `${bot.trailing.art} ${preis(bot.trailing.unten)} – ${preis(bot.trailing.oben)}` : t('bots.feld.keiner') }}</dd>
                </dl>
            </Karte>

            <Karte :titel="t('bots.abschnitt.ergebnis')">
                <dl class="liste">
                    <dt>{{ t('bots.feld.gewinn') }}</dt>
                    <dd :class="ton(k.gewinn?.gesamt)">{{ betrag(k.gewinn?.gesamt, mc, { vorzeichen: true }) }} <span class="leise">{{ prozent(k.rendite?.gesamt, { vorzeichen: true }) }}</span></dd>
                    <template v-if="bot.laufend">
                        <dt class="ein">{{ t('bots.feld.realisiert') }}</dt><dd>{{ betrag(k.gewinn?.realisiert, mc, { vorzeichen: true }) }}</dd>
                        <dt class="ein">{{ t('bots.feld.schwebend') }}</dt><dd>{{ betrag(k.gewinn?.schwebend, mc, { vorzeichen: true }) }}</dd>
                    </template>
                    <dt>{{ t('bots.feld.gridGewinn') }}</dt><dd :class="ton(bot.ergebnis?.gridGewinn)">{{ betrag(bot.ergebnis?.gridGewinn, mc, { vorzeichen: true }) }}</dd>
                    <dt>{{ t('bots.feld.gridGewinn24h') }}</dt><dd>{{ betrag(bot.ergebnis?.gridGewinn24h, mc, { vorzeichen: true }) }}</dd>
                    <dt>{{ t('bots.feld.funding') }}</dt><dd :class="ton(bot.ergebnis?.funding)">{{ betrag(bot.ergebnis?.funding, mc, { vorzeichen: true }) }}</dd>
                    <dt>{{ t('bots.feld.gebuehren') }}</dt><dd>{{ betrag(bot.ergebnis?.gebuehren, mc) }}</dd>
                    <dt>{{ t('bots.feld.renditeJahr') }}</dt><dd>{{ prozent(k.rendite?.jahr, { vorzeichen: true }) }}</dd>
                    <dt>{{ t('bots.feld.gridRenditeJahr') }}</dt><dd>{{ prozent(k.gridRendite?.jahr, { vorzeichen: true }) }}</dd>
                    <dt>{{ t('bots.feld.zyklen') }}</dt><dd>{{ zahl(bot.ergebnis?.zyklen) }} <span class="leise">({{ zahl(k.zyklenProTag, 1) }} / d)</span></dd>
                    <dt>{{ t('bots.feld.trades24h') }}</dt><dd>{{ zahl(bot.ergebnis?.trades24h) }}</dd>
                    <dt>{{ t('bots.feld.einsatz') }}</dt><dd>{{ betrag(k.gewinn?.basis, mc) }}</dd>
                    <dt>{{ t('bots.feld.laufzeit') }}</dt><dd>{{ dauer(k.tage) }} <span class="leise">{{ datum(bot.erstellt) }}<template v-if="bot.beendet"> – {{ datum(bot.beendet) }}</template></span></dd>
                </dl>
            </Karte>

            <Karte :titel="t('bots.abschnitt.risiko')">
                <dl class="liste">
                    <dt>{{ t('bots.feld.kurs') }}</dt>
                    <dd>{{ bot.laufend ? preis(bot.kurs) : '—' }} <span v-if="k.band" class="leise">{{ t(`bots.lage.${k.band.lage}`) }}</span></dd>
                    <dt>{{ t('bots.feld.position') }}</dt><dd>{{ zahl(bot.position?.menge, 4) }}</dd>
                    <dt>{{ t('bots.feld.einstieg') }}</dt><dd>{{ preis(bot.position?.einstieg) }}</dd>
                    <dt>{{ t('bots.feld.startPreis') }}</dt><dd>{{ preis(bot.position?.startPreis) }}</dd>
                    <dt v-if="!bot.laufend">{{ t('bots.feld.schlussPreis') }}</dt><dd v-if="!bot.laufend">{{ preis(bot.position?.schlussPreis) }}</dd>
                    <dt>{{ t('bots.feld.liquidation') }}</dt>
                    <dd>
                        <template v-if="bot.liquidation?.unten != null || bot.liquidation?.oben != null || bot.liquidation?.preis != null">
                            {{ [bot.liquidation.unten, bot.liquidation.preis, bot.liquidation.oben].filter((v) => v != null).map(preis).join(' / ') }}
                        </template>
                        <template v-else>—</template>
                    </dd>
                    <dt>{{ t('bots.feld.liqAbstand') }}</dt>
                    <dd>{{ k.liquidation ? prozent(k.liquidation.abstand) : '—' }}<span v-if="k.liquidation?.inAtr != null" class="leise"> · {{ t('bots.feld.inAtr', { n: zahl(k.liquidation.inAtr, 1) }) }}</span></dd>
                    <dt>{{ t('bots.feld.stopLoss') }}</dt><dd>{{ stopText(bot.stops?.stopLoss) }}</dd>
                    <dt>{{ t('bots.feld.takeProfit') }}</dt><dd>{{ stopText(bot.stops?.takeProfit) }}</dd>
                    <dt>{{ t('bots.feld.marge') }}</dt><dd>{{ betrag(bot.einsatz?.marge, mc) }}</dd>
                    <dt>{{ t('bots.feld.extraMarge') }}</dt><dd>{{ betrag(bot.einsatz?.extraMarge, mc) }}</dd>
                    <template v-if="bot.laufend"><dt>{{ t('bots.feld.risiko') }}</dt><dd>{{ bot.risikoStatus || '—' }}</dd></template>
                    <dt>{{ t('bots.feld.atrTag') }}</dt><dd>{{ preis(markt?.atrTag) }}</dd>
                </dl>
            </Karte>
        </div>

        <Karte :titel="t('bots.abschnitt.markt')">
            <div v-if="laedt" class="mitte"><Kreisel :groesse="24" /></div>
            <Hinweis v-else-if="marktAus" art="info">{{ t('bots.marktAus') }}</Hinweis>
            <Hinweis v-else-if="marktFehler" art="fehler">{{ marktFehler }}</Hinweis>
            <div v-show="markt?.kerzen?.length" ref="chartEl" class="chart"></div>
            <p v-if="markt?.zeitrahmen" class="fuss">{{ t('bots.chartHinweis', { tf: markt.zeitrahmen }) }}</p>
        </Karte>

        <Karte v-if="steuerungAktiv" ref="aktKarte" :titel="t('bots.abschnitt.aktionen')">
            <BotAktionen :bot="bot" :steuerung="steuerung" :vorschlag="vorschlag" @gesendet="emit('gesendet')" @vorschlag-weg="vorschlag = null" />
        </Karte>

        <Karte v-if="bot.laufend && ['futures_grid', 'coinm_grid', 'spot_grid'].includes(bot.typ)" :titel="t('bots.abschnitt.ki')">
            <BotKi :bot="bot" :steuerung-aktiv="steuerungAktiv" @in-simulation="inSimulation" @umsetzen="umsetzen" />
        </Karte>

        <Karte v-if="SIMULIERBAR.includes(bot.typ)" ref="simKarte" :titel="t('bots.abschnitt.simulation')">
            <BotSimulation ref="simulation" :bot="bot" :steuerung-aktiv="steuerungAktiv && bot.laufend" @umsetzen="umsetzen" />
        </Karte>

        <Karte v-if="bot.laufend || verlauf.length" :titel="t('bots.abschnitt.verlauf')">
            <div v-show="verlauf.length >= 2" ref="verlaufEl" class="chart klein"></div>
            <p v-if="verlauf.length < 2" class="fuss">{{ t('bots.verlaufLeer') }}</p>
        </Karte>

        <Karte v-if="wissen" :titel="t('bots.abschnitt.wissen')">
            <div class="wissen">
                <h4>{{ wissen.name }}</h4>
                <p>{{ wissen.funktion }}</p>
                <dl class="liste breit">
                    <dt>{{ t('bots.wissen.gutBei') }}</dt><dd>{{ wissen.gutBei }}</dd>
                    <dt>{{ t('bots.wissen.schlechtBei') }}</dt><dd>{{ wissen.schlechtBei }}</dd>
                    <dt>{{ t('bots.wissen.gewinn') }}</dt><dd>{{ wissen.gewinn }}</dd>
                    <template v-if="wissen.aenderbar?.length"><dt>{{ t('bots.wissen.aenderbar') }}</dt><dd>{{ wissen.aenderbar.join(', ') }}</dd></template>
                    <template v-if="wissen.risiken?.length"><dt>{{ t('bots.wissen.risiken') }}</dt><dd>{{ wissen.risiken.join(', ') }}</dd></template>
                </dl>
                <template v-if="wissen.rat?.length">
                    <h5>{{ t('bots.wissen.rat') }}</h5>
                    <ul><li v-for="r in wissen.rat" :key="r">{{ r }}</li></ul>
                </template>
                <template v-if="wissen.unsicher?.length">
                    <h5>{{ t('bots.wissen.unsicher') }}</h5>
                    <ul><li v-for="u in wissen.unsicher" :key="u">{{ u }}</li></ul>
                </template>
                <p class="fuss">
                    {{ t('bots.wissen.quellen') }}:
                    <a v-for="(q, i) in wissen.quellen" :key="q" :href="q" target="_blank" rel="noopener noreferrer">[{{ i + 1 }}]</a>
                    · {{ t('bots.wissen.stand', { datum: wissenStand }) }}
                </p>
            </div>
        </Karte>

        <details class="roh">
            <summary>{{ t('bots.abschnitt.roh') }}</summary>
            <dl class="liste roh-liste">
                <template v-for="[f, v] in rohZeilen" :key="f"><dt>{{ f }}</dt><dd>{{ v }}</dd></template>
            </dl>
        </details>
    </div>
</template>

<style scoped>
.botDetail { display: flex; flex-direction: column; gap: var(--abstand-3); }
.kopf { display: flex; flex-wrap: wrap; align-items: center; gap: var(--abstand-2); }
.kopf h2 { margin: 0; font-size: 1.4rem; }
.status { margin-left: auto; color: var(--muted); }
.hinweise { list-style: none; margin: 0; padding: var(--abstand-2) var(--abstand-3); border-radius: var(--radius); background: var(--warn-flaeche); display: flex; flex-direction: column; gap: 3px; }
.hinweise li { color: var(--warn); display: flex; align-items: center; gap: 0.4em; font-size: 0.9rem; }
.raster { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--abstand-3); }
.liste { display: grid; grid-template-columns: max-content 1fr; gap: 4px var(--abstand-3); margin: 0; font-size: 0.9rem; }
.liste dt { color: var(--muted); }
.liste dt.ein { padding-left: 0.8em; }
.liste dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.liste.breit { grid-template-columns: minmax(90px, max-content) 1fr; }
.leise { color: var(--muted); font-size: 0.8rem; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.chart { width: 100%; height: 360px; }
.chart.klein { height: 240px; }
.mitte { display: flex; justify-content: center; padding: var(--abstand-4); }
.fuss { color: var(--muted); font-size: 0.8rem; margin: var(--abstand-2) 0 0; }
.fuss a { margin-left: 0.25em; color: var(--accent); }
.wissen h4 { margin: 0 0 var(--abstand-2); }
.wissen h5 { margin: var(--abstand-3) 0 var(--abstand-1); color: var(--muted); font-weight: 600; }
.wissen p { margin: 0 0 var(--abstand-2); }
.wissen ul { margin: 0; padding-left: 1.2em; }
.roh summary { cursor: pointer; color: var(--muted); }
.roh-liste { margin-top: var(--abstand-2); font-family: var(--schrift-mono); font-size: 0.78rem; }
</style>
