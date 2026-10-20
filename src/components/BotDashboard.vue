<script setup>
/**
 * Bot-Dashboard — dedizierte Übersicht für Grid-/Bot-Trades (aktuell Pionex).
 *
 * Wird in JournalUebersicht.vue gerendert, wenn der ART-Filter auf "Bot" steht.
 * Konsumiert `gefilterteTradesFlach` (bereits auf Bots gefiltert via Kategorie-
 * Filter in trades.js) und berechnet bot-spezifische KPIs eigenständig —
 * unabhängig von der Futures-Totals-Pipeline.
 *
 * Relevante Bot-Felder pro Trade (aus createPionexTradeObj / pionex-api.js):
 *   botType (futures_grid | spot_grid | smart_copy), symbol, leverage,
 *   investment (initQuoteInvestment), netSharePL (= totalRealizedProfit, echter
 *   Wallet-Delta), grossSharePL (Grid-Profit vor Gebühren), tradingFee,
 *   fundingFee (signiert: + erhalten / − bezahlt), entryTime/exitTime, strategy.
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import axios from 'axios'
import { gefilterteTradesFlach } from '../stores/trades.js'
import { betragArt, gewaehlteBoerse } from '../stores/filters.js'
import {
    formGeld2, formGeld0, formZahl0,
    formZahlStellen, formZahl2
} from '../utils/journal/format.js'
import dayjs from '../utils/journal/zeit.js'
import { useI18n } from 'vue-i18n'
import { palette, mitDeckkraft, tooltipStil, schrift } from '../utils/journal/diagramme/gestaltung.js'
import Karte from '@/components/basis/Karte.vue'
import Symbol from '@/components/basis/Symbol.vue'

const { t } = useI18n()

// ===== Helpers =====

// Symbol-Inversion korrigieren: Pionex liefert teils USDT als base
// (z.B. "USDTSOL" statt "SOLUSDT"). .PERP-Suffix strippen.
function displaySymbol(s) {
    if (!s) return '—'
    let out = String(s).replace('.PERP', '').replace('.perp', '')
    if (out.startsWith('USDT') && out.length > 4) out = out.slice(4) + 'USDT'
    return out
}

const BOT_TYPE_LABEL = {
    futures_grid: 'Futures-Grid',
    spot_grid: 'Spot-Grid',
    smart_copy: 'Smart-Copy',
    grid: 'Grid',
}
function botTypeLabel(t) {
    return BOT_TYPE_LABEL[t] || (t || 'Bot')
}

// PnL eines laufenden Bots einheiten-bewusst: USDT → Währungsformat, Coin-M
// (margined in z.B. SOL) → nativ in der Coin mit Vorzeichen.
function fmtBotPnL(p) {
    const v = p.unrealizedPNL || 0
    if (p.marginCoin && p.marginCoin !== 'USDT') {
        return `${v >= 0 ? '+' : ''}${v.toFixed(4)} ${p.marginCoin}`
    }
    return formGeld2(v)
}

function fmtDuration(seconds) {
    if (!seconds || seconds < 0) return '—'
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    if (d > 0) return `${d}d ${h}h`
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
}

// Coin-M-Bot (coin-margined, invers) erkennen + gehandelte Coin ableiten.
//  - Bestehende Importe: invertiertes Symbol "USDTSOL"/"USDTBTC" (Symbol beginnt mit USDT).
//  - Neue Importe (nach Server-Fix): coinM/marginCoin-Feld am Trade.
// PnL ist bei Coin-M in der Coin (SOL/BTC), NICHT USDT → eigene Sektion, aus den
// USDT-Summen herausgehalten.
function botCoin(t) {
    if (!t) return null
    if (t.coinM || (t.marginCoin && t.marginCoin !== 'USDT')) {
        return (t.marginCoin || String(t.symbol || '').replace(/USDT/i, '')) || null
    }
    const s = String(t.symbol || '').toUpperCase()
    if (s.startsWith('USDT') && s.length > 4) return s.slice(4)
    return null
}
function isCoinM(t) { return botCoin(t) !== null }

// Börsen mit Bot-Unterstützung. Bitunix/Bitget bieten (noch) keine Bots →
// eigene "Coming soon"-Ansicht statt leerer Tabelle.
const BOT_BROKERS = ['pionex']
const BROKER_LABEL = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const comingSoon = computed(() => {
    const b = gewaehlteBoerse.value
    return !!b && !BOT_BROKERS.includes(b)
})
const comingSoonLabel = computed(() => BROKER_LABEL[gewaehlteBoerse.value] || gewaehlteBoerse.value)

// ===== Datenbasis =====
const allBots = computed(() => gefilterteTradesFlach.filter(t => t && t.botType))
// USDT-margined Bots → $-Stats. Coin-M separat (Coin-Einheiten).
const bots = computed(() => allBots.value.filter(t => !isCoinM(t)))
const coinMBots = computed(() => allBots.value.filter(t => isCoinM(t)))

// Netto vs. Brutto je nach betragArt-Filter (net/gross)
const isNet = computed(() => betragArt.value !== 'gross')
function pl(t) {
    return isNet.value ? (t.netSharePL ?? 0) : (t.grossSharePL ?? 0)
}

// ===== USD-Sicht (für die zusammengefassten Statistiken) =====
// Coin-M-Bots werden mit ihrem echten USD-Wert eingerechnet (pnlUsdt invers
// gerechnet; SOL-Komponenten via Schlusskurs quoteCloseP). USDT-Bots: nativ.
function netUsd(t)    { return isCoinM(t) ? parseFloat(t.pnlUsdt ?? 0) : (t.netSharePL ?? 0) }
function investUsd(t) { return isCoinM(t) ? parseFloat(t.investUsdt ?? 0) : (t.investment ?? 0) }
function feeUsd(t)    { const f = t.tradingFee ?? 0; return isCoinM(t) ? f * (parseFloat(t.quoteCloseP) || 0) : f }
function fundUsd(t)   { const f = t.fundingFee ?? 0; return isCoinM(t) ? f * (parseFloat(t.quoteCloseP) || 0) : f }
function grossUsd(t)  { return isCoinM(t) ? (netUsd(t) + feeUsd(t) - fundUsd(t)) : (t.grossSharePL ?? 0) }
function plUsd(t)     { return isNet.value ? netUsd(t) : grossUsd(t) }

// Coin-M-Bots je Coin (SOL/BTC) nativ aggregieren
const coinMGroups = computed(() => {
    const map = new Map()
    for (const t of coinMBots.value) {
        const coin = botCoin(t) || '?'
        const e = map.get(coin) || { coin, count: 0, net: 0, gross: 0, fees: 0, funding: 0, usdt: 0, wins: 0, losses: 0 }
        e.count++
        e.net += t.netSharePL ?? 0
        e.gross += t.grossSharePL ?? 0
        e.fees += t.tradingFee ?? 0
        e.funding += t.fundingFee ?? 0
        e.usdt += parseFloat(t.pnlUsdt ?? 0)   // echter USD-Wert (invers gerechnet)
        const p = pl(t)
        if (p > 0) e.wins++; else if (p < 0) e.losses++
        map.set(coin, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
})
function fmtCoin(v, coin) {
    return `${v >= 0 ? '+' : ''}${(v ?? 0).toFixed(4)} ${coin}`
}

// ===== Geschlossene Bots: Einzelliste mit Pionex-artigem PnL-Breakdown =====
const expandedBotIds = ref(new Set())
function toggleBotExpand(id) {
    const s = new Set(expandedBotIds.value)
    if (s.has(id)) s.delete(id); else s.add(id)
    expandedBotIds.value = s
}
// Einheiten-bewusstes Format: USDT → Währung, Coin-M → nativ (z.B. SOL).
function fmtBotAmt(v, unit) {
    return unit === 'USDT' ? formGeld2(v ?? 0) : fmtCoin(v, unit)
}
const closedBotsList = computed(() => {
    return [...allBots.value]
        .sort((a, b) => (b.exitTime ?? 0) - (a.exitTime ?? 0))
        .map(t => {
            const coin = botCoin(t)            // null ⇒ USDT-margined
            const net = t.netSharePL ?? 0
            const grid = t.gridProfit          // undefined bei Alt-Importen (kein Backfill)
            const funding = t.fundingFee ?? 0
            return {
                id: t.id,
                symbol: displaySymbol(t.symbol),
                typeLabel: botTypeLabel(t.botType),
                unit: coin || 'USDT',
                net,
                grid: grid ?? 0,
                funding,
                tradingFee: t.tradingFee ?? 0,
                trend: net - (grid ?? 0) - funding,   // Pionex-Definition (inkl. Trading-Fee)
                hasGrid: grid !== undefined,
                // USDT-Sekundärwert (nur Coin-M); sonst == net
                pnlUsdt: parseFloat(t.pnlUsdt ?? 0),
                showUsdt: !!coin && t.pnlUsdt != null,
                leverage: t.leverage || 0,
                investment: t.investment || 0,
                runtime: fmtDuration((t.exitTime ?? 0) - (t.entryTime ?? 0)),
            }
        })
})

// ===== Aggregierte KPIs (ALLE Bots, Coin-M mit USD-Wert eingerechnet) =====
const stats = computed(() => {
    const list = allBots.value
    let net = 0, gross = 0, tradingFee = 0, fundingFee = 0, investment = 0
    let fundingPaid = 0, fundingReceived = 0
    let wins = 0, losses = 0, levSum = 0, levCount = 0, durSum = 0, durCount = 0
    let best = null, worst = null
    const symbols = new Set()
    for (const t of list) {
        const p = plUsd(t)
        net += netUsd(t)
        gross += grossUsd(t)
        tradingFee += feeUsd(t)
        const f = fundUsd(t)
        fundingFee += f
        if (f >= 0) fundingReceived += f; else fundingPaid += f
        investment += investUsd(t)
        if (p > 0) wins++; else if (p < 0) losses++
        if (t.leverage > 0) { levSum += t.leverage; levCount++ }
        const dur = (t.exitTime ?? 0) - (t.entryTime ?? 0)
        if (dur > 0) { durSum += dur; durCount++ }
        symbols.add(displaySymbol(t.symbol))
        if (!best || p > plUsd(best)) best = t
        if (!worst || p < plUsd(worst)) worst = t
    }
    const count = list.length
    const profit = isNet.value ? net : gross
    return {
        count,
        symbols: symbols.size,
        net, gross, tradingFee, fundingFee, fundingPaid, fundingReceived, investment,
        profit,
        roi: investment > 0 ? (net / investment) * 100 : 0,
        winRate: count > 0 ? (wins / count) * 100 : 0,
        wins, losses,
        avgLeverage: levCount > 0 ? levSum / levCount : 0,
        avgDuration: durCount > 0 ? durSum / durCount : 0,
        avgProfit: count > 0 ? profit / count : 0,
        best, worst,
    }
})

// Bester/Schlechtester Bot — USD-Profit fürs Anzeige-Format
function plUsdDisplay(t) { return t ? plUsd(t) : 0 }

// ===== Gruppierung nach Bot-Typ (alle Bots, USD) =====
const byType = computed(() => {
    const map = new Map()
    for (const t of allBots.value) {
        const key = t.botType || 'grid'
        const e = map.get(key) || { key, label: botTypeLabel(key), unit: 'USDT', count: 0, profit: 0, fees: 0, investment: 0 }
        e.count++
        e.profit += plUsd(t)
        e.fees += feeUsd(t)
        e.investment += investUsd(t)
        map.set(key, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
})

// ===== Gruppierung nach Symbol (alle Bots, USD) =====
const bySymbol = computed(() => {
    const map = new Map()
    for (const t of allBots.value) {
        const key = displaySymbol(t.symbol)
        const e = map.get(key) || { symbol: key, count: 0, profit: 0, fees: 0, funding: 0 }
        e.count++
        e.profit += plUsd(t)
        e.fees += feeUsd(t)
        e.funding += fundUsd(t)
        map.set(key, e)
    }
    return [...map.values()].sort((a, b) => b.profit - a.profit)
})

// ===== Laufende Bots (offene Positionen) =====
// Pro Börse eigene Bot-Seite: offene Bots der AKTUELL gewählten Börse holen.
// Der globale incomingPositions-Store taugt nicht — er enthält nur reguläre
// Futures-Positionen, keine Bot-Metadaten. Aktuell liefert nur Pionex Bots;
// andere Börsen geben hier (gefiltert auf isBot) eine leere Liste zurück.
const runningBots = ref([])
async function fetchRunningBots() {
    const broker = gewaehlteBoerse.value || 'pionex'
    try {
        const { data } = await axios.get(`/api/${broker}/open-positions`)
        const list = (data?.positions || []).filter(p => p && (p.isBot || p.botType))
        runningBots.value = list
    } catch (_) { runningBots.value = [] }
}

// ===== Charts =====
const cumChartEl = ref(null)
const symbolChartEl = ref(null)
let cumChart = null
let symbolChart = null

function renderCumChart() {
    if (!cumChartEl.value) return
    if (!cumChart) cumChart = echarts.init(cumChartEl.value)
    const sorted = [...allBots.value].sort((a, b) => (a.exitTime || a.td) - (b.exitTime || b.td))
    let acc = 0
    const data = sorted.map(t => {
        acc += plUsd(t)
        return [dayjs.unix(t.exitTime || t.td).valueOf(), +acc.toFixed(2)]
    })
    // Farben aus den Token (tokens.css), nicht als Literale: so trägt das
    // Diagramm dieselbe Signalfarbe wie der Rest der Seite.
    const p = palette()
    cumChart.setOption({
        backgroundColor: 'transparent',
        textStyle: { fontFamily: p.schrift },
        grid: { left: 55, right: 20, top: 20, bottom: 30 },
        tooltip: {
            trigger: 'axis',
            ...tooltipStil(p),
            valueFormatter: v => formGeld2(v),
        },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: p.line } },
            axisLabel: { ...schrift(p) },
        },
        yAxis: {
            type: 'value',
            axisLabel: { ...schrift(p), formatter: v => formZahl0(v) },
            splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } },
        },
        series: [{
            type: 'line', data, showSymbol: false, smooth: true,
            lineStyle: { width: 2, color: p.accent },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: mitDeckkraft(p.accent, 0.3) },
                    { offset: 1, color: mitDeckkraft(p.accent, 0.02) },
                ])
            },
        }],
    })
}

function renderSymbolChart() {
    if (!symbolChartEl.value) return
    if (!symbolChart) symbolChart = echarts.init(symbolChartEl.value)
    const top = bySymbol.value.slice(0, 12)
    const p = palette()
    symbolChart.setOption({
        backgroundColor: 'transparent',
        textStyle: { fontFamily: p.schrift },
        grid: { left: 80, right: 20, top: 10, bottom: 25 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltipStil(p), valueFormatter: v => formGeld2(v) },
        xAxis: {
            type: 'value',
            axisLabel: { ...schrift(p), formatter: v => formZahl0(v) },
            splitLine: { lineStyle: { color: p.gitter, type: 'dashed' } },
        },
        yAxis: {
            type: 'category',
            inverse: true,
            data: top.map(s => s.symbol),
            axisLabel: { ...schrift(p), color: p.text },
            axisLine: { lineStyle: { color: p.line } },
        },
        series: [{
            type: 'bar',
            data: top.map(s => ({
                value: +s.profit.toFixed(2),
                itemStyle: { color: s.profit >= 0 ? p.goodBalken : p.badBalken, borderRadius: 3 },
            })),
            barMaxWidth: 18,
        }],
    })
}

function renderAll() {
    nextTick(() => { renderCumChart(); renderSymbolChart() })
}

function onResize() {
    cumChart?.resize()
    symbolChart?.resize()
}

// ECharts liest die Container-Breite beim init(); steht das Layout zu diesem
// Zeitpunkt noch nicht (Tab-Pane/Flex), rendert der Chart zu schmal. Ein
// ResizeObserver korrigiert die Breite, sobald der Container sie erhält.
let ro = null
let pollTimer = null
onMounted(() => {
    renderAll()
    fetchRunningBots()
    // Live-Update der laufenden Bots (uPnL/Profit) alle 30s
    pollTimer = setInterval(fetchRunningBots, 30000)
    window.addEventListener('resize', onResize)
    ro = new ResizeObserver(onResize)
    if (cumChartEl.value) ro.observe(cumChartEl.value)
    if (symbolChartEl.value) ro.observe(symbolChartEl.value)
})
onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    ro?.disconnect()
    if (pollTimer) clearInterval(pollTimer)
    cumChart?.dispose(); symbolChart?.dispose()
})
watch([allBots, betragArt], renderAll, { deep: false })
</script>

<template>
    <div class="bot">
        <!-- Börse ohne Bot-Unterstützung → kommt bald -->
        <Karte v-if="comingSoon" class="bot-leer">
            <Symbol name="agent" :groesse="36" class="bot-leer-symbol" />
            <div class="bot-leer-titel">{{ t('dashboard.bot.comingSoon', { broker: comingSoonLabel }) }}</div>
            <div class="bot-leise">{{ t('dashboard.bot.nurPionex') }}</div>
            <span class="bot-marke akzent">{{ t('dashboard.bot.comingSoonMarke') }}</span>
        </Karte>

        <Karte v-else-if="stats.count === 0 && coinMGroups.length === 0" class="bot-leer">
            <Symbol name="agent" :groesse="36" class="bot-leer-symbol" />
            <div class="bot-leise">{{ t('dashboard.bot.keine') }}</div>
        </Karte>

        <template v-else>
            <!-- ===== Kennzahlen-Kacheln ===== -->
            <div class="bot-raster">
                <Karte dicht class="viertel bot-kpi">
                    <div class="bot-kpi-titel">{{ isNet ? t('dashboard.bot.nettoProfit') : t('dashboard.bot.bruttoProfit') }}</div>
                    <div class="bot-kpi-wert zahl" :class="stats.profit >= 0 ? 'at-gut' : 'at-schlecht'">
                        {{ formGeld2(stats.profit) }}
                    </div>
                    <div class="bot-kpi-unter">{{ t('dashboard.bot.botsSymbole', { bots: stats.count, symbole: stats.symbols }) }}</div>
                </Karte>
                <Karte dicht class="viertel bot-kpi">
                    <div class="bot-kpi-titel">{{ t('dashboard.bot.roi') }}</div>
                    <div class="bot-kpi-wert zahl" :class="stats.roi >= 0 ? 'at-gut' : 'at-schlecht'">
                        {{ formZahl2(stats.roi) }}%
                    </div>
                    <div class="bot-kpi-unter">{{ t('dashboard.bot.investment') }} {{ formGeld0(stats.investment) }}</div>
                </Karte>
                <Karte dicht class="viertel bot-kpi">
                    <div class="bot-kpi-titel">{{ t('dashboard.bot.winRate') }}</div>
                    <div class="bot-kpi-wert zahl">{{ formZahl2(stats.winRate) }}%</div>
                    <div class="bot-kpi-unter"><span class="at-gut">{{ stats.wins }}W</span> / <span class="at-schlecht">{{ stats.losses }}L</span></div>
                </Karte>
                <Karte dicht class="viertel bot-kpi">
                    <div class="bot-kpi-titel">{{ t('dashboard.bot.hebelLaufzeit') }}</div>
                    <div class="bot-kpi-wert zahl">{{ formZahlStellen(stats.avgLeverage, 1) }}×</div>
                    <div class="bot-kpi-unter">{{ t('dashboard.bot.laufzeitSchnitt', { dauer: fmtDuration(stats.avgDuration) }) }}</div>
                </Karte>

                <!-- ===== Profit-Aufschlüsselung ===== -->
                <Karte dicht class="drittel" :titel="t('dashboard.bot.aufschluesselung')">
                    <table class="bot-tabelle">
                        <tbody>
                            <tr>
                                <td>{{ t('dashboard.bot.gridBrutto') }}</td>
                                <td class="zahl" :class="stats.gross >= 0 ? 'at-gut' : 'at-schlecht'">{{ formGeld2(stats.gross) }}</td>
                            </tr>
                            <tr>
                                <td>{{ t('dashboard.bot.tradingGebuehren') }}</td>
                                <td class="zahl at-schlecht">−{{ formGeld2(stats.tradingFee) }}</td>
                            </tr>
                            <tr>
                                <td>{{ t('dashboard.bot.fundingErhalten') }}</td>
                                <td class="zahl at-gut">{{ formGeld2(stats.fundingReceived) }}</td>
                            </tr>
                            <tr>
                                <td>{{ t('dashboard.bot.fundingBezahlt') }}</td>
                                <td class="zahl at-schlecht">{{ formGeld2(stats.fundingPaid) }}</td>
                            </tr>
                            <tr class="summe">
                                <td><strong>{{ t('dashboard.bot.nettoProfit') }}</strong></td>
                                <td class="zahl" :class="stats.net >= 0 ? 'at-gut' : 'at-schlecht'"><strong>{{ formGeld2(stats.net) }}</strong></td>
                            </tr>
                            <tr>
                                <td>{{ t('dashboard.bot.proBot') }}</td>
                                <td class="zahl" :class="stats.avgProfit >= 0 ? 'at-gut' : 'at-schlecht'">{{ formGeld2(stats.avgProfit) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-if="stats.best || stats.worst" class="bot-bestwert">
                        <div v-if="stats.best" class="bot-bestwert-zeile">
                            <span class="at-gedaempft">{{ t('dashboard.bot.besterBot') }}</span>
                            <span><strong>{{ displaySymbol(stats.best.symbol) }}</strong>
                                <span class="at-gut"> {{ formGeld2(plUsd(stats.best)) }}</span></span>
                        </div>
                        <div v-if="stats.worst" class="bot-bestwert-zeile">
                            <span class="at-gedaempft">{{ t('dashboard.bot.schlechtesterBot') }}</span>
                            <span><strong>{{ displaySymbol(stats.worst.symbol) }}</strong>
                                <span class="at-schlecht"> {{ formGeld2(plUsd(stats.worst)) }}</span></span>
                        </div>
                    </div>
                </Karte>

                <!-- ===== Nach Bot-Typ ===== -->
                <Karte dicht class="drittel" :titel="t('dashboard.bot.nachTyp')">
                    <table class="bot-tabelle">
                        <thead>
                            <tr><th>{{ t('dashboard.bot.typ') }}</th><th class="zahl">{{ t('dashboard.bot.anz') }}</th><th class="zahl">{{ t('dashboard.bot.profit') }}</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in byType" :key="row.key">
                                <td>{{ row.label }}
                                    <span v-if="row.coinM" class="bot-marke warn">COIN-M</span>
                                </td>
                                <td class="zahl">{{ row.count }}</td>
                                <td class="zahl" :class="row.profit >= 0 ? 'at-gut' : 'at-schlecht'">
                                    {{ row.unit === 'USDT' ? formGeld2(row.profit) : fmtCoin(row.profit, row.unit) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </Karte>

                <!-- ===== Laufende Bots ===== -->
                <Karte dicht class="drittel" :titel="`${t('dashboard.bot.laufend')} (${runningBots.length})`">
                    <div v-if="runningBots.length === 0" class="bot-leise">{{ t('dashboard.bot.keineLaufend') }}</div>
                    <div v-else class="at-tabelle-huelle">
                        <table class="bot-tabelle">
                            <thead>
                                <tr><th>{{ t('dashboard.bot.symbol') }}</th><th class="zahl">{{ t('dashboard.bot.hebel') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.markt') }}</th><th class="zahl">{{ t('dashboard.bot.pnl') }}</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in runningBots" :key="p.positionId">
                                    <td>{{ displaySymbol(p.symbol) }}
                                        <span v-if="p.coinM" class="bot-marke warn">COIN-M</span>
                                        <span class="bot-unterzeile">{{ botTypeLabel(p.botType) }} · {{ p.side }}</span>
                                    </td>
                                    <td class="zahl">{{ p.leverage ? formZahlStellen(p.leverage, 0) + '×' : '—' }}</td>
                                    <td class="zahl at-gedaempft">{{ p.markPrice ? formZahlStellen(p.markPrice, p.markPrice < 1 ? 4 : 2) : '—' }}</td>
                                    <td class="zahl" :class="(p.unrealizedPNL || 0) >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtBotPnL(p) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Karte>

                <!-- ===== Coin-M Bots (Coin-margined, PnL in Coin-Einheiten) ===== -->
                <Karte v-if="coinMGroups.length" dicht class="voll">
                    <div class="bot-titel">
                        {{ t('dashboard.bot.coinMTitel') }} <span class="bot-marke warn">COIN-M</span>
                        <span class="bot-titel-hinweis">{{ t('dashboard.bot.coinMHinweis') }}</span>
                    </div>
                    <div class="at-tabelle-huelle">
                        <table class="bot-tabelle">
                            <thead>
                                <tr>
                                    <th>{{ t('dashboard.bot.coin') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.bots') }}</th>
                                    <th class="zahl">W/L</th>
                                    <th class="zahl">{{ t('dashboard.bot.grid') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.gebuehren') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.funding') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.netto') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.nettoUsd') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="g in coinMGroups" :key="g.coin">
                                    <td><strong>{{ g.coin }}</strong></td>
                                    <td class="zahl">{{ g.count }}</td>
                                    <td class="zahl"><span class="at-gut">{{ g.wins }}</span>/<span class="at-schlecht">{{ g.losses }}</span></td>
                                    <td class="zahl" :class="g.gross >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtCoin(g.gross, g.coin) }}</td>
                                    <td class="zahl at-gedaempft">{{ fmtCoin(-Math.abs(g.fees), g.coin) }}</td>
                                    <td class="zahl" :class="g.funding >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtCoin(g.funding, g.coin) }}</td>
                                    <td class="zahl" :class="g.net >= 0 ? 'at-gut' : 'at-schlecht'"><strong>{{ fmtCoin(g.net, g.coin) }}</strong></td>
                                    <td class="zahl at-gedaempft">{{ formGeld2(g.usdt) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Karte>

                <!-- ===== Kumulierter Profit ===== -->
                <Karte dicht class="voll" :titel="t('dashboard.bot.kumuliert', { art: isNet ? t('dashboard.bot.artNetto') : t('dashboard.bot.artBrutto') })">
                    <div ref="cumChartEl" class="bot-diagramm" style="height:300px;"></div>
                </Karte>

                <!-- ===== Profit je Symbol ===== -->
                <Karte dicht class="halb" :titel="t('dashboard.bot.jeSymbol')">
                    <div ref="symbolChartEl" class="bot-diagramm" style="height:340px;"></div>
                </Karte>
                <Karte dicht class="halb" :titel="t('dashboard.bot.symbolDetails')">
                    <div class="bot-scroll">
                        <table class="bot-tabelle">
                            <thead>
                                <tr><th>{{ t('dashboard.bot.symbol') }}</th><th class="zahl">{{ t('dashboard.bot.bots') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.profit') }}</th>
                                    <th class="zahl">{{ t('dashboard.bot.gebuehren') }}</th><th class="zahl">{{ t('dashboard.bot.funding') }}</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="s in bySymbol" :key="s.symbol">
                                    <td>{{ s.symbol }}</td>
                                    <td class="zahl">{{ s.count }}</td>
                                    <td class="zahl" :class="s.profit >= 0 ? 'at-gut' : 'at-schlecht'">{{ formGeld2(s.profit) }}</td>
                                    <td class="zahl at-gedaempft">{{ formGeld2(s.fees) }}</td>
                                    <td class="zahl" :class="s.funding >= 0 ? 'at-gut' : 'at-schlecht'">{{ formGeld2(s.funding) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Karte>

                <!-- ===== Geschlossene Bots: Einzelliste mit PnL-Aufschlüsselung ===== -->
                <Karte v-if="closedBotsList.length" dicht class="voll" :titel="t('dashboard.bot.geschlossen', { n: closedBotsList.length })">
                    <div class="cbot-liste">
                        <div v-for="b in closedBotsList" :key="b.id" class="cbot">
                            <button type="button" class="cbot-kopf" :aria-expanded="expandedBotIds.has(b.id)" @click="toggleBotExpand(b.id)">
                                <Symbol :name="expandedBotIds.has(b.id) ? 'runter' : 'ausklappen'" />
                                <span class="cbot-sym">{{ b.symbol }}</span>
                                <span class="cbot-neben">{{ b.typeLabel }}</span>
                                <span v-if="b.leverage" class="cbot-neben">{{ b.leverage }}x</span>
                                <span v-if="b.unit !== 'USDT'" class="bot-marke warn">COIN-M</span>
                                <span class="cbot-pnl zahl" :class="b.net >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtBotAmt(b.net, b.unit) }}</span>
                                <span v-if="b.showUsdt" class="cbot-neben">(≈ {{ formGeld2(b.pnlUsdt) }})</span>
                            </button>
                            <div v-if="expandedBotIds.has(b.id)" class="cbot-rumpf">
                                <template v-if="b.hasGrid">
                                    <div class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.trendPnl') }}</span><span :class="b.trend >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtBotAmt(b.trend, b.unit) }}</span></div>
                                    <div class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.gridGewinn') }}</span><span :class="b.grid >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtBotAmt(b.grid, b.unit) }}</span></div>
                                </template>
                                <div class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.funding') }}</span><span :class="b.funding >= 0 ? 'at-gut' : 'at-schlecht'">{{ fmtBotAmt(b.funding, b.unit) }}</span></div>
                                <div class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.tradingGebuehr') }}</span><span class="at-gedaempft">{{ fmtBotAmt(b.tradingFee, b.unit) }}</span></div>
                                <div v-if="b.investment" class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.investment') }}</span><span>{{ fmtBotAmt(b.investment, b.unit) }}</span></div>
                                <div class="cbot-zelle"><span class="cbot-lbl">{{ t('dashboard.bot.laufzeit') }}</span><span>{{ b.runtime }}</span></div>
                                <div v-if="!b.hasGrid" class="cbot-hinweis">{{ t('dashboard.bot.gridSpaeter') }}</div>
                            </div>
                        </div>
                    </div>
                </Karte>
            </div>
        </template>
    </div>
</template>

<style scoped>
.bot-raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.75rem;
}

.bot-raster > * {
    grid-column: span 12;
    min-width: 0;
}

.bot-raster > .viertel { grid-column: span 6; }

@media (min-width: 768px) {
    .bot-raster > .viertel { grid-column: span 3; }
}

@media (min-width: 992px) {
    .bot-raster > .drittel { grid-column: span 4; }
    .bot-raster > .halb { grid-column: span 6; }
}

.bot-leer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 2.5rem 1rem;
    text-align: center;
}

.bot-leer-symbol {
    color: var(--leise);
}

.bot-leer-titel {
    font-weight: 700;
}

.bot-leise {
    font-size: 0.85rem;
    color: var(--muted);
}

.bot-marke {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius-pille);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    vertical-align: middle;
}

.bot-marke.warn {
    background: var(--warn-flaeche);
    color: var(--warn);
}

.bot-marke.akzent {
    margin-top: 0.4rem;
    background: var(--accent-flaeche);
    color: var(--accent);
}

.bot-kpi-titel {
    font-size: 0.74rem;
    color: var(--muted);
    margin-bottom: 0.25rem;
}

.bot-kpi-wert {
    font-size: 1.45rem;
    font-weight: 700;
    line-height: 1.1;
}

.bot-kpi-unter {
    margin-top: 0.15rem;
    font-size: 0.72rem;
    color: var(--muted);
}

.bot-titel {
    margin-bottom: 0.7rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
}

.bot-titel-hinweis {
    margin-left: 0.3rem;
    font-size: 0.76rem;
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
    color: var(--leise);
}

.bot-tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.83rem;
}

.bot-tabelle th {
    padding-bottom: 0.35rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: left;
    color: var(--muted);
    white-space: nowrap;
}

.bot-tabelle td {
    padding: 0.28rem 0;
    border-bottom: 1px solid var(--line);
}

.bot-tabelle .zahl,
.bot-tabelle th.zahl {
    text-align: right;
    padding-left: 0.5rem;
    white-space: nowrap;
}

.bot-tabelle .summe td {
    border-top: 1px solid var(--line-stark);
    padding-top: 0.5rem;
}

.bot-unterzeile {
    display: block;
    font-size: 0.7rem;
    color: var(--muted);
}

.bot-bestwert {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line);
    font-size: 0.82rem;
}

.bot-bestwert-zeile {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
}

.bot-bestwert-zeile + .bot-bestwert-zeile {
    margin-top: 0.25rem;
}

.bot-scroll {
    max-height: 340px;
    overflow: auto;
}

.bot-diagramm {
    width: 100%;
}

/* Geschlossene Bots — Einzelliste mit Aufschlüsselung */
.cbot {
    margin-bottom: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    overflow: hidden;
}

.cbot-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.cbot-kopf:hover {
    background: var(--panel-soft);
}

.cbot-sym {
    font-weight: 700;
}

.cbot-neben {
    font-size: 0.74rem;
    color: var(--muted);
}

.cbot-pnl {
    margin-left: auto;
    font-weight: 700;
}

.cbot-rumpf {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--line);
}

.cbot-zelle {
    display: flex;
    flex-direction: column;
    min-width: 110px;
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
    font-size: 0.85rem;
}

.cbot-lbl {
    font-size: 0.68rem;
    color: var(--muted);
}

.cbot-hinweis {
    flex-basis: 100%;
    font-size: 0.72rem;
    color: var(--muted);
}
</style>
