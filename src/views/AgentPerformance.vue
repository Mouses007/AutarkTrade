<script setup>
/**
 * Auswertung der Agent-Trades.
 *
 * Wertet ausschliesslich `strategy_trades` aus — die echten Journal-Kennzahlen
 * bleiben unberührt, Paper-Ergebnisse verfälschen also weder Dashboard noch
 * Kontostand.
 *
 * Kernstück ist der Setup-Trichter: er zeigt nicht nur WIE GUT, sondern WO
 * Setups verloren gehen. Genau diese Daten lesen später auch die Agenten, um
 * Parameter-Verbesserungen vorzuschlagen.
 */
import { ref, computed, watch, onBeforeMount, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import { useXDecCurrencyFormat } from '../utils/journal/format.js'
import { useAgentTimelineChart, cssColor87, cssColor60, cssColor38, blackbg5, greenColor, redColor } from '../utils/journal/diagramme/index.js'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import dayjs from '../utils/journal/zeit.js'
import { Knopf, Pille, Symbol, Reiter } from '../components/basis'

const { t } = useI18n()
const route = useRoute()
const TAB_SCHLUESSEL = ['uebersicht', 'performance', 'trades', 'risiko', 'liste']

const instanzen = ref([])
const daten = ref(null)
const laden = ref(false)
const activeTab = ref('uebersicht')
const filter = ref({ instanceId: '', mode: '', symbol: '', paramsVersion: '', from: '', to: '' })
let equityChart = null
let rChart = null
let zeitstrahlChart = null

// Zeitstrahl: was der Agent im Kursverlauf gesehen und getan hat
const zsSymbol = ref('')
const zsTage = ref(7)
const zsMeldung = ref('')
const zsLaedt = ref(false)

const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))

/**
 * Der Profit-Faktor ist ohne Verlust-Trades nicht definiert. Er kommt dann als
 * `null` — das darf nicht als 0 durchgehen, sonst liest sich ein makelloser
 * Verlauf wie ein Totalausfall.
 */
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1

const kpi = computed(() => daten.value?.kpis || {})

// ── Brücke: vom Trade zurück zur Fassung, unter der er entstand ────────
// `paramsVersion` steht am Trade, die Werte dazu in der Historie. Ohne diesen
// Weg zeigt ein alter Trade auf eine Strategie, deren Einstellungen inzwischen
// andere sind — und niemand kann mehr sagen, wonach gehandelt wurde.
const kontextFuer = ref(null)
const kontext = ref(null)
const kontextLaedt = ref(false)

async function kontextZeigen(tr) {
    if (kontextFuer.value === tr.id) { kontextFuer.value = null; kontext.value = null; return }
    kontextFuer.value = tr.id
    kontext.value = null
    kontextLaedt.value = true
    try {
        const r = await axios.get(`/api/strategies/trades/${tr.id}/context`)
        kontext.value = r.data
    } catch (e) {
        logError('AgentPerformance', 'Kontext laden fehlgeschlagen', e)
    } finally {
        kontextLaedt.value = false
    }
}

/** Die letzten Trades, neueste zuerst. */
// ── Mehrfachauswahl: spiegeln und wieder entfernen ──────────────────────
const gewaehlt = ref(new Set())
const spiegelLaeuft = ref(false)
const spiegelMeldung = ref('')

const alleGewaehlt = computed(() =>
    letzteTrades.value.length > 0 && letzteTrades.value.every((t) => gewaehlt.value.has(t.id)))

function auswahlUmschalten(tr) {
    const neu = new Set(gewaehlt.value)
    if (neu.has(tr.id)) neu.delete(tr.id); else neu.add(tr.id)
    gewaehlt.value = neu
}

function alleUmschalten() {
    gewaehlt.value = alleGewaehlt.value ? new Set() : new Set(letzteTrades.value.map((t) => t.id))
}

/** Gewählte Trades ins Journal spiegeln — je Instanz, weil der Endpunkt daran hängt. */
async function gewaehlteSpiegeln() {
    const ids = [...gewaehlt.value]
    if (!ids.length) return
    spiegelLaeuft.value = true
    spiegelMeldung.value = ''
    try {
        // Nach Instanz gruppieren: ein Trade gehört immer genau einer.
        const proInstanz = new Map()
        for (const tr of letzteTrades.value) {
            if (!gewaehlt.value.has(tr.id)) continue
            if (!proInstanz.has(tr.instanceId)) proInstanz.set(tr.instanceId, [])
            proInstanz.get(tr.instanceId).push(tr.id)
        }
        let gespiegelt = 0
        let uebersprungen = 0
        for (const [instanceId, tradeIds] of proInstanz) {
            const r = await axios.post(`/api/strategies/instances/${instanceId}/mirror-journal`, { tradeIds })
            gespiegelt += r.data.gespiegelt || 0
            uebersprungen += r.data.uebersprungen || 0
        }
        spiegelMeldung.value = t('strategies.mirrorDone', { n: gespiegelt, u: uebersprungen })
    } catch (e) {
        spiegelMeldung.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        spiegelLaeuft.value = false
    }
}

/** Gewählte wieder aus dem Journal nehmen. */
async function gewaehlteEntfernen() {
    const ids = [...gewaehlt.value]
    if (!ids.length) return
    spiegelLaeuft.value = true
    spiegelMeldung.value = ''
    try {
        const r = await axios.post('/api/strategies/journal/unmirror', { tradeIds: ids })
        spiegelMeldung.value = t('strategies.unmirrorDone', { n: r.data.entfernt || 0 })
    } catch (e) {
        spiegelMeldung.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        spiegelLaeuft.value = false
    }
}

const letzteTrades = computed(() => [...(daten.value?.trades || [])]
    .sort((a, b) => Number(b.exitTime) - Number(a.exitTime)).slice(0, 60))
const trichter = computed(() => daten.value?.funnel || {})

/** Symbole aus den geladenen Instanzen — spart einen eigenen Endpunkt. */
const symbole = computed(() => [...new Set(instanzen.value.flatMap((i) => i.symbols || []))])
const versionen = computed(() =>
    (daten.value?.byGroup?.paramsVersion || []).map((g) => g.key).sort((a, b) => a - b))

async function holen() {
    laden.value = true
    try {
        const p = {}
        for (const [k, v] of Object.entries(filter.value)) {
            if (v !== '' && v !== null) p[k] = v
        }
        if (p.from) p.from = dayjs(p.from).valueOf()
        if (p.to) p.to = dayjs(p.to).endOf('day').valueOf()

        const r = await axios.get('/api/strategies/performance', { params: p })
        daten.value = r.data
        await nextTick()
        zeichne()
        await zeitstrahlLaden()
    } catch (e) {
        logError('AgentPerformance', 'Auswertung laden fehlgeschlagen', e)
    } finally {
        laden.value = false
    }
}

/** Zeiteinheit einer Instanz ('1h', '15m', '4h') in Minuten. */
function tfMinuten(tf) {
    const m = String(tf || '1h').match(/^(\d+)([mhd])$/)
    if (!m) return 60
    return Number(m[1]) * (m[2] === 'm' ? 1 : m[2] === 'h' ? 60 : 1440)
}

/**
 * Kurs, Zonen und Trades eines Symbols zusammenführen.
 *
 * Bewusst NICHT an `kpi.trades` gebunden: gerade solange noch kein Trade
 * abgeschlossen ist, ist die Frage »sieht der Agent überhaupt etwas?« am
 * wichtigsten — dann zeigt der Chart eben nur Zonen.
 */
async function zeitstrahlLaden() {
    const symbol = zsSymbol.value || filter.value.symbol || symbole.value[0] || ''
    zsSymbol.value = symbol
    zsMeldung.value = ''
    if (!symbol) return

    // Instanz, die dieses Symbol handelt — sie bestimmt Zeiteinheit und Markt.
    const inst = instanzen.value.find((i) => (i.symbols || []).includes(symbol)) || instanzen.value[0]
    const timeframe = inst?.timeframe || '1h'
    const limit = Math.min(1000, Math.ceil((zsTage.value * 1440) / tfMinuten(timeframe)) + 5)

    zsLaedt.value = true
    try {
        const [k, s] = await Promise.all([
            axios.get('/api/binance/klines', {
                params: { symbol, interval: timeframe, market: inst?.market || 'futures', limit },
            }),
            axios.get('/api/strategies/setups', {
                params: { symbol, limit: 500, ...(filter.value.instanceId ? { instanceId: filter.value.instanceId } : {}) },
            }),
        ])
        const candles = k.data.map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4] }))
        if (!candles.length) { zsMeldung.value = t('strategies.timelineNoData'); return }

        const trades = (daten.value?.trades || []).filter((x) => x.symbol === symbol)
        if (!s.data.length && !trades.length) zsMeldung.value = t('strategies.timelineNoSetups', { symbol })

        await nextTick()
        zeitstrahlChart?.dispose()
        zeitstrahlChart = useAgentTimelineChart('agentZeitstrahl', candles, s.data, trades)
    } catch (e) {
        logError('AgentPerformance', 'Zeitstrahl laden fehlgeschlagen', e)
        zsMeldung.value = t('strategies.chartFailed')
    } finally {
        zsLaedt.value = false
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    try {
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) { /* Filterliste ist optional */ }
    // Sprung von der Instanzenliste (AgentStrategies.vue): Coin anklicken →
    // Trades ansehen → "Zur Zwischenauswertung" landet hier bereits gefiltert,
    // gleiches Vorbild wie `tradeId` in Playbook.vue.
    if (route.query.instanceId) filter.value.instanceId = String(route.query.instanceId)
    if (route.query.symbol) filter.value.symbol = String(route.query.symbol).toUpperCase()
    if (TAB_SCHLUESSEL.includes(route.query.tab)) activeTab.value = route.query.tab
    await holen()
    seiteLaedt.value = false
    // Gezeichnet wird noch hinter dem Ladebalken — der Inhalt hängt dort an
    // `v-show`, ist also `display:none`, und ECharts misst dann eine Breite von
    // null. Erst nach dem Einblenden stimmen die Masse.
    await nextTick()
    groesseAnpassen()
    window.addEventListener('resize', groesseAnpassen)
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', groesseAnpassen)
    equityChart?.dispose()
    rChart?.dispose()
    zeitstrahlChart?.dispose()
})

function groesseAnpassen() {
    equityChart?.resize()
    rChart?.resize()
    zeitstrahlChart?.resize()
}

// Dieselben Konstanten wie AgentEditor.vue/AgentSetups.vue (aus journal/diagramme, Design-Tokens) —
// vorher hatte diese Datei ihre eigene, zufällig übereinstimmende Kopie.
const achse = { axisLine: { lineStyle: { color: cssColor38 } },
                axisLabel: { color: cssColor60, fontSize: 10 } }
const tooltipStil = { trigger: 'axis', backgroundColor: blackbg5, borderColor: 'rgba(255,255,255,0.15)',
                       textStyle: { color: cssColor87, fontSize: 11 } }
const gitterlinie = { splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } }

function zeichne() {
    const kurve = daten.value?.equityCurve || []
    const el = document.getElementById('agentEquityChart')
    if (el && kurve.length) {
        equityChart?.dispose()
        equityChart = echarts.init(el)
        equityChart.setOption({
            backgroundColor: 'transparent',
            grid: { left: 8, right: 12, top: 16, bottom: 20, containLabel: true },
            tooltip: tooltipStil,
            xAxis: { type: 'category', ...achse,
                     data: kurve.map((p) => dayjs(p.t).format('DD.MM')), splitLine: { show: false } },
            yAxis: { type: 'value', scale: true, ...achse, ...gitterlinie },
            series: [{
                type: 'line', smooth: true, showSymbol: false,
                data: kurve.map((p) => p.equity),
                lineStyle: { color: '#1fd6c4', width: 2 },
                areaStyle: { color: 'rgba(1,180,255,0.12)' },
            }],
        })
    }

    const r = daten.value?.rVerteilung || []
    const el2 = document.getElementById('agentRChart')
    if (el2 && r.length) {
        rChart?.dispose()
        rChart = echarts.init(el2)
        rChart.setOption({
            backgroundColor: 'transparent',
            grid: { left: 8, right: 12, top: 16, bottom: 20, containLabel: true },
            tooltip: tooltipStil,
            xAxis: { type: 'category', ...achse, splitLine: { show: false },
                     data: r.map((b) => (b.bis === null || !Number.isFinite(b.bis) ? `≥${b.von}R` : `${b.von}…${b.bis}R`)) },
            yAxis: { type: 'value', ...achse, ...gitterlinie },
            series: [{
                type: 'bar',
                data: r.map((b) => ({
                    value: b.n,
                    itemStyle: { color: b.von < 0 ? redColor : greenColor },
                })),
            }],
        })
    }
}

// Reiterwechsel entfernt/erzeugt die Chart-Container (v-if) — ohne diesen
// Watcher bliebe der Container der Performance-/Übersicht-Kachel beim ersten
// Aufruf leer, weil `zeichne()` sonst nur einmal nach dem Laden liefe.
watch(activeTab, async () => {
    await nextTick()
    zeichne()
})

/** Anteil in Prozent für die Trichter-Balken. */
function anteil(wert) {
    const basis = trichter.value.erkannt || 0
    return basis > 0 ? Math.min(100, (wert / basis) * 100) : 0
}

const trichterStufen = computed(() => [
    { key: 'erkannt', wert: trichter.value.erkannt || 0 },
    { key: 'getriggert', wert: trichter.value.getriggert || 0 },
    { key: 'ausgefuehrt', wert: trichter.value.ausgefuehrt || 0 },
    { key: 'gewonnen', wert: trichter.value.gewonnen || 0 },
])

const sortiert = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
const wochentag = (n) => t('strategies.weekday' + n)

/** Reiter-Liste für den Baustein `Reiter` (gleiche Schlüssel wie TAB_SCHLUESSEL). */
const reiterListe = computed(() => [
    { id: 'uebersicht', titel: t('strategies.tabOverview') },
    { id: 'performance', titel: t('strategies.tabPerformance') },
    { id: 'trades', titel: t('strategies.tabTradesAnalysis') },
    { id: 'risiko', titel: t('strategies.tabRisk') },
    { id: 'liste', titel: t('strategies.tabTradeList') },
])
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="perf-seite">
        <div class="perf-inhalt">

            <h5 class="seitentitel">{{ t('strategies.performanceTitle') }}</h5>

            <!-- Filter -->
            <div class="dailyCard karte abstand">
                <div class="filter-raster">
                    <div class="f-3">
                        <label class="at-label">{{ t('strategies.instance') }}</label>
                        <select v-model="filter.instanceId" class="at-feld klein" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                        </select>
                    </div>
                    <div class="f-2">
                        <label class="at-label">{{ t('strategies.modeLabel') }}</label>
                        <select v-model="filter.mode" class="at-feld klein" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option value="paper">{{ t('strategies.mode_paper') }}</option>
                            <option value="shadow">{{ t('strategies.mode_shadow') }}</option>
                            <option value="live">{{ t('strategies.mode_live') }}</option>
                        </select>
                    </div>
                    <div class="f-2">
                        <label class="at-label">{{ t('strategies.symbol') }}</label>
                        <select v-model="filter.symbol" class="at-feld klein" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="s in symbole" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                    <div class="f-2">
                        <label class="at-label">{{ t('strategies.paramsVersion') }}</label>
                        <select v-model="filter.paramsVersion" class="at-feld klein" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="v in versionen" :key="v" :value="v">v{{ v }}</option>
                        </select>
                    </div>
                    <div class="f-3 datum-paar">
                        <div>
                            <label class="at-label">{{ t('strategies.from') }}</label>
                            <input v-model="filter.from" type="date" class="at-feld klein" @change="holen" />
                        </div>
                        <div>
                            <label class="at-label">{{ t('strategies.to') }}</label>
                            <input v-model="filter.to" type="date" class="at-feld klein" @change="holen" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Zeitstrahl: Zonen und Trades des Agenten im Kursverlauf -->
            <div class="dailyCard karte abstand">
                <div class="zs-kopf">
                    <span class="section-title titel-zeile ohne-rand">
                        <Symbol name="linie" class="vor" />{{ t('strategies.timelineTitle') }}
                    </span>
                    <div class="zs-wahl">
                        <select v-model="zsSymbol" class="at-feld klein" @change="zeitstrahlLaden">
                            <option v-for="s in symbole" :key="s" :value="s">{{ s }}</option>
                        </select>
                        <select v-model.number="zsTage" class="at-feld klein" @change="zeitstrahlLaden">
                            <option :value="3">3 {{ t('strategies.days') }}</option>
                            <option :value="7">7 {{ t('strategies.days') }}</option>
                            <option :value="14">14 {{ t('strategies.days') }}</option>
                            <option :value="30">30 {{ t('strategies.days') }}</option>
                        </select>
                    </div>
                </div>
                <p class="at-gedaempft klein-text abstand-klein">{{ t('strategies.timelineHint') }}</p>
                <div v-if="zsMeldung" class="at-gedaempft klein-text abstand-klein">{{ zsMeldung }}</div>
                <div id="agentZeitstrahl" class="chartClass" style="height: 380px;"></div>
            </div>

            <div v-if="!kpi.trades" class="dailyCard karte leer at-gedaempft abstand">
                {{ t('strategies.noTrades') }}
            </div>

            <template v-else>
                <!-- ══ Reiter ══
                     Vorher eine einzige durchlaufende Seite mit acht Blöcken
                     nacheinander — kein Überblick vor dem Detail. Fünf Reiter
                     nach dem Schema, das TradingViews Strategy Report benutzt:
                     Übersicht → Performance → Trades-Analyse → Risiko → Liste. -->
                <Reiter v-model="activeTab" :reiter="reiterListe" class="abstand" />

                <!-- ══ Übersicht ══ -->
                <div v-if="activeTab === 'uebersicht'">
                    <div class="kpi-raster abstand">
                        <div v-for="k in [
                            { l: t('strategies.kpiNetPnl'), v: geld(kpi.netPnl), farbe: kpi.netPnl >= 0 },
                            { l: t('strategies.kpiWinRate'), v: zahl(kpi.winRate, 1) + ' %' },
                            { l: t('strategies.kpiProfitFactor'), v: profitFaktor(kpi.profitFactor, kpi.trades),
                              farbe: profitFaktorGut(kpi.profitFactor) },
                            { l: t('strategies.kpiMaxDd'), v: zahl(kpi.maxDrawdownPct, 1) + ' %' },
                        ]" :key="k.l">
                            <div class="dailyCard kpi-karte">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value"
                                    :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">
                                    {{ k.v }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Hinweise aus den Daten -->
                    <div v-if="daten.hinweise?.length" class="dailyCard karte abstand">
                        <div class="section-title titel-zeile">
                            <Symbol name="idee" class="vor" />{{ t('strategies.observations') }}
                        </div>
                        <ul class="liste">
                            <li v-for="(h, i) in daten.hinweise" :key="i" class="klein-text">{{ h.text }}</li>
                        </ul>
                    </div>

                    <div class="dailyCard karte abstand">
                        <div class="section-title">{{ t('strategies.equityCurve') }}</div>
                        <div id="agentEquityChart" style="height: 260px;"></div>
                    </div>

                    <!-- Kontrollgruppe: was hätte reines Halten gebracht? Ohne sie
                         ist eine positive Rendite bedeutungslos, an einem Tag, an
                         dem der Coin ohnehin durchmarschiert, sieht jede Strategie
                         gut aus (dasselbe Prinzip wie in radar-guete.js). -->
                    <div v-if="kpi.baselineBuyHoldReturnPct !== null && kpi.baselineBuyHoldReturnPct !== undefined"
                        class="dailyCard karte">
                        <div class="section-title">{{ t('strategies.baselineTitle') }}</div>
                        <p class="at-gedaempft klein-text abstand-klein">{{ t('strategies.baselineHint') }}</p>
                        <div class="zwei-raster abstand-klein">
                            <div class="dailyCard kpi-karte">
                                <div class="kpi-label">{{ t('strategies.returnPct') }}</div>
                                <div class="kpi-value" :class="kpi.returnPct >= 0 ? 'greenTrade' : 'redTrade'">
                                    {{ zahl(kpi.returnPct, 1) }} %
                                </div>
                            </div>
                            <div class="dailyCard kpi-karte">
                                <div class="kpi-label">{{ t('strategies.kpiBuyHold') }}</div>
                                <div class="kpi-value"
                                    :class="kpi.baselineBuyHoldReturnPct >= 0 ? 'greenTrade' : 'redTrade'">
                                    {{ zahl(kpi.baselineBuyHoldReturnPct, 1) }} %
                                </div>
                            </div>
                        </div>
                        <p class="klein-text ohne-rand" :class="kpi.baselineDiffPct > 0 ? 'greenTrade' : (kpi.baselineDiffPct < 0 ? 'redTrade' : 'at-gedaempft')">
                            {{ kpi.baselineDiffPct > 0
                                ? t('strategies.baselineBeats', { diff: zahl(Math.abs(kpi.baselineDiffPct), 1) })
                                : kpi.baselineDiffPct < 0
                                    ? t('strategies.baselineMisses', { diff: zahl(Math.abs(kpi.baselineDiffPct), 1) })
                                    : t('strategies.baselineTie') }}
                        </p>
                    </div>
                </div>

                <!-- ══ Performance ══ -->
                <div v-if="activeTab === 'performance'">
                    <div class="kpi-raster abstand">
                        <div v-for="k in [
                            { l: t('strategies.kpiTrades'), v: kpi.trades },
                            // Die Verliererseite gehört gleichberechtigt daneben: eine
                            // Trefferquote allein sagt nichts darüber, wie die Verluste
                            // aussahen — und genau dort entscheidet sich das Ergebnis.
                            { l: t('strategies.kpiWinsLosses'), v: (kpi.wins ?? 0) + ' / ' + (kpi.losses ?? 0) },
                            { l: t('strategies.kpiAvgWinLoss'),
                              v: zahl(kpi.avgWinR) + ' / ' + zahl(kpi.avgLossR) + ' R' },
                            { l: t('strategies.kpiExpectancy'), v: zahl(kpi.expectancyR) + ' R', farbe: kpi.expectancyR >= 0 },
                        ]" :key="k.l">
                            <div class="dailyCard kpi-karte">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value"
                                    :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">
                                    {{ k.v }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="dailyCard karte">
                        <div class="section-title">{{ t('strategies.rDistribution') }}</div>
                        <div id="agentRChart" style="height: 260px;"></div>
                    </div>
                </div>

                <!-- ══ Trades-Analyse ══ -->
                <div v-if="activeTab === 'trades'">
                    <div class="halb-raster abstand">
                        <div class="dailyCard karte hoch">
                            <div class="section-title">{{ t('strategies.funnel') }}</div>
                            <p class="at-gedaempft klein-text">{{ t('strategies.funnelHint') }}</p>
                            <div v-for="s in trichterStufen" :key="s.key" class="funnel-zeile">
                                <div class="funnel-kopf klein-text">
                                    <span>{{ t('strategies.funnel_' + s.key) }}</span>
                                    <strong>{{ s.wert }}</strong>
                                </div>
                                <div class="funnel-bar">
                                    <div class="funnel-fill" :style="{ width: anteil(s.wert) + '%' }"></div>
                                </div>
                            </div>
                        </div>

                        <div class="dailyCard karte hoch">
                            <div class="section-title">{{ t('strategies.whyLost') }}</div>
                            <p class="at-gedaempft klein-text">{{ t('strategies.whyLostHint') }}</p>

                            <div class="at-tabelle-huelle">
                                <table class="at-tabelle dicht">
                                    <tbody>
                                        <tr v-for="[grund, n] in sortiert(trichter.byInvalidReason)" :key="'i' + grund">
                                            <td>{{ t('strategies.reason_' + grund) }}</td>
                                            <td class="zahl"><strong>{{ n }}</strong></td>
                                            <td class="zahl at-gedaempft" style="width: 4rem;">
                                                {{ zahl(anteil(n), 0) }} %
                                            </td>
                                        </tr>
                                        <tr v-for="[grund, n] in sortiert(trichter.byRejectReason)" :key="'r' + grund">
                                            <td class="at-warn">{{ t('strategies.reason_' + grund) }}</td>
                                            <td class="zahl"><strong>{{ n }}</strong></td>
                                            <td class="zahl at-gedaempft">{{ zahl(anteil(n), 0) }} %</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="gruppen-raster">
                        <div class="gruppe"
                            v-for="g in [
                                { titel: t('strategies.bySymbol'), rows: daten.byGroup.symbol },
                                { titel: t('strategies.byDirection'), rows: daten.byGroup.direction },
                                { titel: t('strategies.byExitReason'), rows: daten.byGroup.exitReason },
                                { titel: t('strategies.byParamsVersion'), rows: daten.byGroup.paramsVersion },
                            ]" :key="g.titel">
                            <div class="dailyCard karte hoch">
                                <div class="section-title">{{ g.titel }}</div>
                                <div class="at-tabelle-huelle">
                                    <table class="at-tabelle dicht">
                                        <thead>
                                            <tr>
                                                <th></th>
                                                <th class="zahl">n</th>
                                                <th class="zahl" :title="t('strategies.kpiWinsLosses')">G/V</th>
                                                <th class="zahl">Ø R</th>
                                                <th class="zahl">PnL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="row in g.rows" :key="row.key">
                                                <td>{{ row.key }}</td>
                                                <td class="zahl">{{ row.trades }}</td>
                                                <td class="zahl">
                                                    <span class="greenTrade">{{ row.wins }}</span><span class="at-gedaempft">/</span><span class="redTrade">{{ row.trades - row.wins }}</span>
                                                </td>
                                                <td class="zahl" :class="row.avgR >= 0 ? 'greenTrade' : 'redTrade'">
                                                    {{ zahl(row.avgR) }}
                                                </td>
                                                <td class="zahl" :class="row.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                    {{ geld(row.netPnl) }}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="gruppe breit">
                            <div class="dailyCard karte">
                                <div class="section-title">{{ t('strategies.byWeekday') }}</div>
                                <div class="at-tabelle-huelle">
                                    <table class="at-tabelle dicht">
                                        <tbody>
                                            <tr v-for="row in daten.byGroup.weekday" :key="row.key">
                                                <td>{{ wochentag(row.key) }}</td>
                                                <td class="zahl">{{ row.trades }}</td>
                                                <td class="zahl">{{ zahl(row.winRate, 0) }} %</td>
                                                <td class="zahl" :class="row.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                                    {{ geld(row.netPnl) }}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ══ Risiko ══ -->
                <div v-if="activeTab === 'risiko'">
                    <div class="kpi-raster abstand">
                        <div v-for="k in [
                            { l: t('strategies.kpiSharpe'), v: zahl(kpi.sharpe) },
                            { l: t('strategies.kpiMaxDd'), v: zahl(kpi.maxDrawdownPct, 1) + ' %' },
                            { l: t('strategies.kpiFloatingDd'), v: zahl(kpi.maxFloatingDrawdownPct, 1) + ' %' },
                        ]" :key="k.l">
                            <div class="dailyCard kpi-karte">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value">{{ k.v }}</div>
                            </div>
                        </div>
                    </div>
                    <p class="at-gedaempft klein-text">{{ t('strategies.kpiFloatingDdHint') }}</p>

                    <div class="dailyCard karte">
                        <div class="section-title">{{ t('strategies.mfeReached') }}</div>
                        <p class="at-gedaempft klein-text">{{ t('strategies.mfeHint') }}</p>
                        <div class="mfe-zeile">
                            <div v-for="(n, stufe) in kpi.mfeReached" :key="stufe" class="mfe-stufe">
                                <div class="kpi-value">{{ n }}</div>
                                <div class="kpi-label">≥ {{ stufe }}</div>
                                <div class="kpi-label">{{ zahl((n / kpi.trades) * 100, 0) }} %</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ══ Trade-Liste ══
                     Bisher zeigte die Auswertung nur Summen. Ein Trade, den man
                     nicht anschauen kann, lässt sich auch nicht beurteilen. -->
                <div v-if="activeTab === 'liste' && letzteTrades.length" class="dailyCard karte">
                    <div class="liste-kopf">
                        <div class="section-title ohne-rand">{{ t('strategies.tradeList') }}</div>
                        <template v-if="gewaehlt.size">
                            <Pille>{{ t('strategies.selected', { n: gewaehlt.size }) }}</Pille>
                            <Knopf klein symbol="herunterladen" :disabled="spiegelLaeuft"
                                @click="gewaehlteSpiegeln">
                                {{ t('strategies.mirrorJournal') }}
                            </Knopf>
                            <Knopf art="leise" klein symbol="schliessen" :disabled="spiegelLaeuft"
                                @click="gewaehlteEntfernen">
                                {{ t('strategies.unmirrorJournal') }}
                            </Knopf>
                        </template>
                        <span v-if="spiegelMeldung" class="klein-text at-gedaempft rechts">{{ spiegelMeldung }}</span>
                    </div>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead>
                                <tr>
                                    <th style="width:2rem">
                                        <input type="checkbox" class="auswahl" :checked="alleGewaehlt"
                                            :title="t('strategies.selectAll')" @change="alleUmschalten" />
                                    </th>
                                    <th>{{ t('strategies.exitTime') }}</th>
                                    <th>{{ t('strategies.symbol') }}</th>
                                    <th>{{ t('strategies.timeframe') }}</th>
                                    <th>{{ t('strategies.direction') }}</th>
                                    <th class="zahl">R</th>
                                    <th class="zahl">PnL</th>
                                    <th>{{ t('strategies.byExitReason') }}</th>
                                    <th class="zahl">{{ t('strategies.paramsVersion') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <template v-for="tr in letzteTrades" :key="tr.id">
                                    <tr class="pointerClass" @click="kontextZeigen(tr)">
                                        <td @click.stop>
                                            <input type="checkbox" class="auswahl"
                                                :checked="gewaehlt.has(tr.id)" @change="auswahlUmschalten(tr)" />
                                        </td>
                                        <td class="at-gedaempft">{{ dayjs(Number(tr.exitTime)).format('DD.MM. HH:mm') }}</td>
                                        <td>{{ tr.symbol }}</td>
                                        <td>{{ tr.timeframe }}</td>
                                        <td>{{ tr.direction }}</td>
                                        <td class="zahl" :class="tr.rMultiple >= 0 ? 'greenTrade' : 'redTrade'">
                                            {{ zahl(tr.rMultiple) }}
                                        </td>
                                        <td class="zahl" :class="tr.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                            {{ geld(tr.netPnl) }}
                                        </td>
                                        <td class="at-gedaempft">{{ tr.exitReason }}</td>
                                        <td class="zahl">
                                            <Pille ton="neutral">v{{ tr.paramsVersion }}</Pille>
                                        </td>
                                    </tr>
                                    <tr v-if="kontextFuer === tr.id">
                                        <td colspan="9" class="kontextZelle">
                                            <div v-if="kontextLaedt" class="klein-text at-gedaempft">…</div>
                                            <div v-else-if="kontext">
                                                <div class="klein-text abstand-klein">
                                                    <strong>{{ t('strategies.contextTitle') }}</strong>
                                                    <span class="at-gedaempft">
                                                        — {{ kontext.instanz?.name }},
                                                        {{ t('strategies.paramsVersion') }} {{ kontext.paramsVersion }}
                                                        <template v-if="kontext.ruleVersion">· {{ t('strategies.ruleVersion') }} {{ kontext.ruleVersion }}</template>
                                                    </span>
                                                </div>
                                                <div v-if="kontext.saetze?.length" class="abstand-klein">
                                                    <div v-for="s in kontext.saetze" :key="s.titel" class="klein-text">
                                                        <span class="at-gedaempft">{{ s.titel }}:</span> {{ s.text }}
                                                    </div>
                                                </div>
                                                <div v-if="kontext.params" class="klein-text">
                                                    <span class="at-gedaempft">{{ t('strategies.contextParams') }}:</span>
                                                    <span v-for="(v, k) in kontext.params" :key="k" class="paramChip">{{ k }}={{ v }}</span>
                                                </div>
                                                <div v-else class="klein-text at-gedaempft">{{ t('strategies.contextNoHistory') }}</div>
                                            </div>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.perf-seite {
    padding: var(--abstand-4) var(--abstand-4) 0;
}

.perf-inhalt {
    max-width: 1500px;
}

.seitentitel {
    margin: 0 0 var(--abstand-4);
}

/* `.dailyCard` setzt global `height: 100%`. Das passt für Raster mit einer Karte
   je Spalte, hier stehen die Karten aber gestapelt untereinander — dort zieht die
   Regel jede einzelne Karte auf die Höhe der GESAMTEN Spalte und erzeugt riesige
   Leerräume. Karten, die bewusst mitwachsen sollen, tragen `hoch`. */
.dailyCard {
    height: auto;
}

.dailyCard.hoch,
.dailyCard.kpi-karte {
    height: 100%;
}

.karte {
    padding: var(--abstand-4);
}

.karte.leer {
    padding: var(--abstand-5);
    text-align: center;
}

.abstand {
    margin-bottom: var(--abstand-4);
}

.abstand-klein {
    margin-bottom: var(--abstand-2);
}

.ohne-rand {
    margin: 0;
}

.klein-text {
    font-size: 0.85rem;
}

.vor {
    margin-right: var(--abstand-1);
}

.rechts {
    margin-left: auto;
}

.titel-zeile {
    display: flex;
    align-items: center;
}

.filter-raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--abstand-2);
    align-items: end;
}

.filter-raster > * {
    grid-column: span 6;
    min-width: 0;
}

.datum-paar {
    display: flex;
    gap: var(--abstand-2);
}

.datum-paar > * {
    flex: 1 1 0;
    min-width: 0;
}

.at-label {
    margin-bottom: var(--abstand-1);
}

.zs-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-1);
}

.zs-wahl {
    display: flex;
    gap: var(--abstand-2);
    margin-left: auto;
}

.zs-wahl .at-feld {
    width: auto;
}

.kpi-raster {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.zwei-raster {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.kpi-karte {
    padding: var(--abstand-2);
    text-align: center;
}

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
}

.kpi-value {
    font-size: 1.15rem;
    font-weight: 600;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: var(--abstand-2);
}

.liste {
    margin: 0;
    padding-left: var(--abstand-4);
}

.liste li {
    margin-bottom: var(--abstand-1);
}

.halb-raster {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--abstand-4);
}

.halb-raster > *,
.gruppe {
    min-width: 0;
}

.gruppen-raster {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--abstand-4);
}

.gruppe.breit {
    grid-column: span 2;
}

.at-tabelle {
    font-size: 0.85rem;
    margin: 0;
}

.funnel-zeile {
    margin-bottom: 0.55rem;
}

.funnel-kopf {
    display: flex;
    justify-content: space-between;
}

.funnel-bar {
    height: 8px;
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    overflow: hidden;
}

.funnel-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
}

.mfe-zeile {
    display: flex;
    gap: var(--abstand-4);
}

.mfe-stufe {
    flex: 1 1 0;
    text-align: center;
}

.liste-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.auswahl {
    accent-color: var(--accent);
    cursor: pointer;
}

.kontextZelle {
    background: var(--panel-soft);
}

.paramChip {
    display: inline-block;
    margin: 0 0 var(--abstand-1) var(--abstand-1);
    padding: 0 var(--abstand-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    font-family: var(--schrift-mono);
    font-size: 0.75rem;
}

@media (min-width: 768px) {
    .filter-raster > .f-2 { grid-column: span 2; }
    .filter-raster > .f-3 { grid-column: span 3; }
}

@media (max-width: 1199.98px) {
    .gruppen-raster {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 991.98px) {
    .halb-raster {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 767.98px) {
    .perf-seite {
        padding: var(--abstand-3) var(--abstand-3) 0;
    }

    .karte {
        padding: var(--abstand-3);
    }

    .kpi-raster {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .gruppen-raster {
        grid-template-columns: 1fr;
    }

    .gruppe.breit {
        grid-column: auto;
    }

    .zs-wahl {
        margin-left: 0;
        width: 100%;
    }

    .zs-wahl .at-feld {
        flex: 1 1 0;
    }
}
</style>
