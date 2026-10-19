<script setup>
/**
 * Erkannte Setups mit Chart.
 *
 * Der Chart ist hier kein Beiwerk: ein LSOB lässt sich ohne eingezeichnete
 * Order-Block-Zone und Sweep-Level nicht beurteilen. Wer prüfen will, ob der
 * Detector die Regeln des Referenz-PDFs richtig anwendet, braucht genau dieses
 * Bild — deshalb liegt es direkt an der Setup-Liste.
 */
import { ref, computed, onBeforeMount, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import { useSetupChart } from '../utils/journal/diagramme/index.js'
import { useBotTradeChart } from '../utils/botChart.js'
import { useXDecCurrencyFormat } from '../utils/journal/format.js'
import { logError } from '../utils/logger.js'
import dayjs from '../utils/journal/zeit.js'
import InfoTipp from '../components/InfoTipp.vue'
import { Knopf, Pille, Symbol } from '../components/basis'

const { t } = useI18n()

const instanzen = ref([])
const setups = ref([])
const positionen = ref([])
const gewaehlt = ref(null)
const chartFehler = ref('')
const chartGross = ref(false)
const gezeigterTrade = ref(null)
const filter = ref({ instanceId: '', status: '' })
let chart = null
let pollTimer = null

const zahl = (v, n = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '–')
const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
const zeit = (t) => (t ? dayjs(Number(t)).format('DD.MM.YY HH:mm') : '–')
// Kurse brauchen je nach Coin mehr Stellen: XRP mit zwei Nachkommastellen
// macht 1,4768 und 1,5384 zu 1,48 und 1,54 — der Zwischenstand wäre unlesbar.
const kurs = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n === 0) return '–'
    const a = Math.abs(n)
    return n.toFixed(a >= 100 ? 2 : a >= 1 ? 4 : 6)
}
// Vorzeichen immer zeigen — ein schwebender Betrag ohne + liest sich wie ein Saldo
const geldMitVz = (v) => (Number(v) > 0 ? '+' : '') + geld(v)
const pnlKlasse = (v) => (Number(v) > 0 ? 'greenTrade' : Number(v) < 0 ? 'redTrade' : '')
const dauer = (ms) => {
    const min = Math.floor((Number(ms) || 0) / 60000)
    const d = Math.floor(min / 1440)
    const h = Math.floor((min % 1440) / 60)
    return d > 0 ? t('strategies.durationDays', { d, h }) : t('strategies.durationHours', { h, m: min % 60 })
}

// Ton der Pille je Status (Baustein `Pille`)
const statusFarbe = (s) => ({
    open: 'akzent', closed: 'neutral', triggered: 'akzent',
    waiting_retest: 'warn', armed: 'warn',
    invalidated: 'schlecht', expired: 'neutral', rejected: 'schlecht',
}[s] || 'neutral')

const instanzVon = (id) => instanzen.value.find((i) => i.id === id) || null

async function laden() {
    try {
        const p = { limit: 300 }
        if (filter.value.instanceId) p.instanceId = filter.value.instanceId
        if (filter.value.status) p.status = filter.value.status
        const [s, pos] = await Promise.all([
            axios.get('/api/strategies/setups', { params: p }),
            axios.get('/api/strategies/positions/zwischenstand'),
        ])
        setups.value = s.data
        positionen.value = pos.data?.positionen || []
    } catch (e) {
        logError('AgentSetups', 'Laden fehlgeschlagen', e)
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    try {
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) { /* Filter ist optional */ }
    await laden()
    seiteLaedt.value = false
    pollTimer = setInterval(laden, 30000)
})

onBeforeUnmount(() => {
    if (pollTimer) clearInterval(pollTimer)
    chart?.dispose()
})

/**
 * Kerzen rund um das Setup holen und zeichnen. Der Ausschnitt beginnt bewusst
 * einige Kerzen vor dem Sweep, damit das gesweepte Swing-Level sichtbar ist.
 */
async function anzeigen(setup) {
    gewaehlt.value = setup
    chartFehler.value = ''
    await nextTick()

    try {
        const inst = instanzVon(setup.instanceId)
        const markt = inst?.market || 'futures'
        const r = await axios.get('/api/binance/klines', {
            params: {
                symbol: setup.symbol, interval: setup.timeframe,
                market: markt, limit: 200,
            },
        })
        const candles = r.data.map((k) => ({
            t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4],
        }))
        // Ist das Setup schon zu einem Trade geworden, zeigt der Journal-Chart
        // mehr: Ein- und Ausstieg, SL/TP und den Höchststand dazwischen. Die
        // Order-Block-Zone kommt aus dem Setup obendrauf.
        let trade = null
        if (setup.status === 'closed' || setup.status === 'open') {
            try {
                const tr = await axios.get('/api/db/strategy_trades', {
                    params: { equalTo: JSON.stringify({ setupId: setup.objectId ?? setup.id }), limit: 1 },
                })
                trade = tr.data?.[0] || null
            } catch (e) { /* ohne Trade bleibt der Setup-Chart */ }
        }
        gezeigterTrade.value = trade

        chart?.dispose()
        chart = trade
            ? await useBotTradeChart('setupChart', candles, trade, setup)
            : useSetupChart('setupChart', candles, setup)
        if (!chart) chartFehler.value = t('strategies.chartFailed')
    } catch (e) {
        logError('AgentSetups', 'Kerzen laden fehlgeschlagen', e)
        chartFehler.value = t('strategies.chartFailed')
    }
}

/** Chart zwischen Normal- und Grossansicht umschalten; ECharts braucht danach ein resize. */
async function chartVergroessern() {
    chartGross.value = !chartGross.value
    await nextTick()
    chart?.resize()
}

async function positionSchliessen(pos) {
    try {
        await axios.post(`/api/strategies/positions/${pos.id}/close`)
        await laden()
    } catch (e) {
        logError('AgentSetups', 'Position schliessen fehlgeschlagen', e)
    }
}

const gruende = computed(() => {
    const m = {}
    for (const s of setups.value) {
        const g = s.invalidReason || s.rejectReason
        if (g) m[g] = (m[g] || 0) + 1
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
})
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="setups-seite">
        <div class="setups-inhalt">

            <div class="kopfzeile">
                <h5 class="seitentitel">{{ t('strategies.setupsTitle') }}</h5>
                <select v-model="filter.instanceId" class="at-feld klein filter-feld" @change="laden">
                    <option value="">{{ t('strategies.allInstances') }}</option>
                    <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                </select>
                <select v-model="filter.status" class="at-feld klein filter-feld" @change="laden">
                    <option value="">{{ t('strategies.allStatus') }}</option>
                    <option value="waiting_retest,armed">{{ t('strategies.statusWaiting') }}</option>
                    <option value="open">{{ t('strategies.statusOpen') }}</option>
                    <option value="closed">{{ t('strategies.statusClosed') }}</option>
                    <option value="invalidated,expired,rejected">{{ t('strategies.statusDead') }}</option>
                </select>
            </div>

            <!-- Offene Positionen -->
            <div v-if="positionen.length" class="dailyCard karte">
                <div class="section-title">{{ t('strategies.openPositions') }}</div>
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <thead>
                            <tr>
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.direction') }}</th>
                                <th class="zahl">{{ t('strategies.qty') }}</th>
                                <th class="zahl">{{ t('strategies.entry') }}</th>
                                <th class="zahl">{{ t('strategies.markPrice') }}</th>
                                <th class="zahl">{{ t('strategies.stop') }}</th>
                                <th class="zahl">{{ t('strategies.target') }}</th>
                                <th class="zahl">{{ t('strategies.notional') }}</th>
                                <th class="zahl">{{ t('strategies.grossShort') }}</th>
                                <th class="zahl">{{ t('strategies.fees') }}</th>
                                <th class="zahl">{{ t('strategies.funding') }}</th>
                                <th class="zahl">
                                    {{ t('strategies.unrealizedNet') }}<InfoTipp schluessel="strategies.unrealizedHint" breit />
                                </th>
                                <th class="zahl">{{ t('strategies.heldSince') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in positionen" :key="p.id">
                                <td>
                                    {{ p.symbol }}
                                    <div class="at-gedaempft unterzeile">{{ p.instanz }}</div>
                                </td>
                                <td :class="p.direction === 'long' ? 'greenTrade' : 'redTrade'">
                                    {{ p.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </td>
                                <td class="zahl">{{ p.qty }}</td>
                                <td class="zahl">{{ kurs(p.entryPrice) }}</td>
                                <td class="zahl">
                                    <template v-if="p.stand">{{ kurs(p.stand.markPrice) }}</template>
                                    <span v-else class="at-gedaempft" :title="p.fehler">{{ t('strategies.priceUnavailable') }}</span>
                                </td>
                                <td class="zahl">{{ kurs(p.stopLoss) }}</td>
                                <td class="zahl">{{ p.takeProfit ? kurs(p.takeProfit) : '–' }}</td>
                                <td class="zahl">{{ geld(p.notionalUsdt) }}</td>
                                <template v-if="p.stand">
                                    <td class="zahl" :class="pnlKlasse(p.stand.grossPnl)">{{ geldMitVz(p.stand.grossPnl) }}</td>
                                    <td class="zahl redTrade">
                                        −{{ geld(p.stand.fees) }}<InfoTipp :text="t('strategies.feesHint', {
                                            open: geld(p.stand.feeOpen + p.stand.feePartial), close: geld(p.stand.feeClose) })" />
                                    </td>
                                    <td class="zahl" :class="pnlKlasse(p.stand.funding)">
                                        <template v-if="p.stand.funding !== null">
                                            {{ geldMitVz(p.stand.funding) }}<InfoTipp breit
                                                :text="t('strategies.fundingHint', { bps: p.fundingBpsAnnahme })" />
                                        </template>
                                        <span v-else class="at-gedaempft" :title="t('strategies.fundingUnknown')">?</span>
                                    </td>
                                    <td class="zahl fett" :class="pnlKlasse(p.stand.netPnl)">
                                        {{ geldMitVz(p.stand.netPnl) }}
                                        <div class="normal unterzeile">{{ (p.stand.rMultiple > 0 ? '+' : '') + zahl(p.stand.rMultiple) }} R</div>
                                    </td>
                                    <td class="zahl">{{ dauer(p.stand.heldMs) }}</td>
                                </template>
                                <td v-else colspan="5"></td>
                                <td class="zahl">
                                    <Knopf art="gefahr" klein @click="positionSchliessen(p)">
                                        {{ t('strategies.close') }}
                                    </Knopf>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Chart des gewählten Setups -->
            <div v-if="gewaehlt" class="dailyCard karte">
                <div class="chart-kopf">
                    <strong>{{ gewaehlt.symbol }}</strong>
                    <Pille ton="neutral">{{ gewaehlt.timeframe }}</Pille>
                    <Pille :ton="gewaehlt.direction === 'long' ? 'gut' : 'schlecht'">
                        {{ gewaehlt.direction === 'long' ? 'LONG' : 'SHORT' }}
                    </Pille>
                    <Pille :ton="statusFarbe(gewaehlt.status)">
                        {{ t('strategies.status_' + gewaehlt.status) }}
                    </Pille>
                    <Pille v-if="gewaehlt.invalidReason" ton="neutral">
                        {{ t('strategies.reason_' + gewaehlt.invalidReason) }}
                    </Pille>
                    <Knopf class="rechts" art="leise" klein nurSymbol
                        :symbol="chartGross ? 'verkleinern' : 'vergroessern'"
                        :titel="t('strategies.chartEnlarge')" @click="chartVergroessern()" />
                    <Knopf art="leise" klein nurSymbol symbol="schliessen" @click="gewaehlt = null" />
                </div>
                <div id="setupChart" :style="{ height: chartGross ? '78vh' : '340px' }"></div>
                <div v-if="chartFehler" class="at-gedaempft klein-text oben">{{ chartFehler }}</div>
                <div class="eckdaten at-gedaempft klein-text">
                    <span>{{ t('strategies.zone') }}: {{ zahl(gewaehlt.obLow) }} – {{ zahl(gewaehlt.obHigh) }}</span>
                    <span>{{ t('strategies.entry') }}: {{ zahl(gewaehlt.entry) }}</span>
                    <span>{{ t('strategies.stop') }}: {{ zahl(gewaehlt.stopLoss) }}</span>
                    <span>{{ t('strategies.target') }}: {{ gewaehlt.takeProfit ? zahl(gewaehlt.takeProfit) : '–' }}</span>
                    <span>RR: {{ zahl(gewaehlt.rr) }}</span>
                    <span>{{ t('strategies.sweepAt') }}: {{ zeit(gewaehlt.sweepCandleTime) }}</span>
                </div>
            </div>

            <!-- Gründeübersicht -->
            <div v-if="gruende.length" class="dailyCard karte">
                <div class="section-title">{{ t('strategies.whyLost') }}</div>
                <div class="pillen">
                    <Pille v-for="[g, n] in gruende" :key="g" ton="neutral">
                        {{ t('strategies.reason_' + g) }}: {{ n }}
                    </Pille>
                </div>
            </div>

            <!-- Setup-Liste -->
            <div v-if="!setups.length" class="dailyCard karte leer at-gedaempft">
                {{ t('strategies.noSetups') }}
            </div>
            <div v-else class="dailyCard karte">
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <thead>
                            <tr>
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.direction') }}</th>
                                <th>{{ t('strategies.statusLabel') }}</th>
                                <th class="zahl">{{ t('strategies.entry') }}</th>
                                <th class="zahl">{{ t('strategies.stop') }}</th>
                                <th class="zahl">RR</th>
                                <th>{{ t('strategies.sweepAt') }}</th>
                                <th>{{ t('strategies.reasonLabel') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in setups" :key="s.id" class="pointerClass"
                                :class="gewaehlt?.id === s.id ? 'gewaehlt' : ''" @click="anzeigen(s)">
                                <td>{{ s.symbol }}</td>
                                <td :class="s.direction === 'long' ? 'greenTrade' : 'redTrade'">
                                    {{ s.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </td>
                                <td><Pille :ton="statusFarbe(s.status)">
                                    {{ t('strategies.status_' + s.status) }}</Pille></td>
                                <td class="zahl">{{ zahl(s.entry) }}</td>
                                <td class="zahl">{{ zahl(s.stopLoss) }}</td>
                                <td class="zahl">{{ zahl(s.rr) }}</td>
                                <td>{{ zeit(s.sweepCandleTime) }}</td>
                                <td class="at-gedaempft">
                                    {{ s.invalidReason || s.rejectReason
                                        ? t('strategies.reason_' + (s.invalidReason || s.rejectReason)) : '' }}
                                </td>
                                <td class="zahl"><Symbol name="linie" class="at-gedaempft" /></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.setups-seite {
    padding: var(--abstand-4) var(--abstand-4) 0;
}

.setups-inhalt {
    max-width: 1500px;
}

/* `.dailyCard` setzt global `height: 100%`. Das passt für Raster mit einer Karte
   je Spalte, hier stehen die Karten aber gestapelt untereinander — dort zieht die
   Regel jede einzelne Karte auf die Höhe der GESAMTEN Spalte und erzeugt riesige
   Leerräume. */
.dailyCard {
    height: auto;
}

.karte {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

.karte.leer {
    padding: var(--abstand-5);
    text-align: center;
}

.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}

.seitentitel {
    margin: 0 auto 0 0;
}

.filter-feld {
    width: auto;
    max-width: 100%;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: var(--abstand-2);
}

.at-tabelle {
    font-size: 0.85rem;
    margin: 0;
}

.unterzeile {
    font-size: 0.75em;
}

.fett {
    font-weight: 700;
}

.normal {
    font-weight: 400;
}

tr.gewaehlt td {
    background: var(--accent-flaeche);
}

.chart-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.chart-kopf .rechts {
    margin-left: auto;
}

.klein-text {
    font-size: 0.85rem;
}

.oben {
    margin-top: var(--abstand-2);
}

.eckdaten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2) var(--abstand-4);
    margin-top: var(--abstand-2);
}

.pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1) var(--abstand-2);
}

@media (max-width: 767.98px) {
    .setups-seite {
        padding: var(--abstand-3) var(--abstand-3) 0;
    }

    .karte {
        padding: var(--abstand-3);
    }

    .seitentitel {
        flex-basis: 100%;
    }

    .filter-feld {
        flex: 1 1 10rem;
    }
}
</style>
