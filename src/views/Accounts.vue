<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from '../utils/journal/zeit.js'
import { brokers } from '../stores/filters.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import { seiteLaedt } from '../stores/ui.js'
import { Karte, Knopf, Kreisel, Hinweis, Symbol } from '../components/basis/index.js'

const { t } = useI18n()

// Börsen-Akzentfarben (dark theme)
const BROKER_COLORS = { bitunix: '#3b82f6', bitget: '#06b6d4', pionex: '#a855f7' }
const colorOf = (b) => BROKER_COLORS[b] || '#64748b'

// Hübsche Labels für die börsen-spezifischen Wallet-Felder
const FIELD_LABELS = {
    available: 'Verfügbar', locked: 'Gebunden', margin: 'Marge',
    unrealizedPL: 'Unrealisiert', bonus: 'Bonus'
}

const cards = ref([])   // [{ broker, label, color, loading, error, data }]

const totalEquity = computed(() => cards.value.reduce((s, c) => s + (c.data?.totalUsd || 0), 0))
const fundedCards = computed(() => cards.value.filter(c => c.data && c.data.totalUsd > 0))

function fmtUsd(v) { return '$ ' + Number(v || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtAmt(v) { return Number(v || 0).toLocaleString('de-CH', { maximumFractionDigits: 6 }) }
function fmtTime(ts) { return ts ? dayjs(Number(ts)).format('DD.MM.YY HH:mm') : '' }
function pct(c) { return totalEquity.value > 0 ? (c.data.totalUsd / totalEquity.value * 100) : 0 }
function fieldLabel(k) { return FIELD_LABELS[k] || k }

async function load() {
    seiteLaedt.value = true
    // Konfigurierte Börsen ermitteln (API hinterlegt) — analog Nav.vue
    const configured = []
    for (const b of brokers) {
        try {
            const { data } = await axios.get(`/api/${b.value}/config`)
            if (data && (data.apiKey || data.hasSecret)) configured.push(b)
        } catch (_) { /* keine Config → überspringen */ }
    }
    cards.value = configured.map(b => ({ broker: b.value, label: b.label, color: colorOf(b.value), loading: true, error: null, data: null }))
    seiteLaedt.value = false

    await Promise.all(cards.value.map(async (card) => {
        try {
            const { data } = await axios.get(`/api/${card.broker}/account-overview`)
            if (data && data.ok) card.data = data
            else card.error = data?.error || t('common.errorLoading')
        } catch (e) {
            card.error = e.response?.data?.error || e.message
        } finally {
            card.loading = false
        }
    }))
}

onMounted(load)
</script>

<template>
    <div class="acc-seite">
        <SeiteLaedt />

        <div v-show="!seiteLaedt">
            <!-- Gesamt-Equity + Allokationsbalken -->
            <Karte class="acc-summary at-mu-3">
                <div class="at-flex at-verteilt at-unten at-umbruch at-luecke-2">
                    <div>
                        <div class="acc-summary-label">{{ t('accounts.totalEquity') }}</div>
                        <div class="acc-summary-value">{{ fmtUsd(totalEquity) }}</div>
                    </div>
                    <Knopf klein symbol="aktualisieren" @click="load">{{ t('accounts.refresh') }}</Knopf>
                </div>
                <div v-if="fundedCards.length" class="acc-alloc-bar at-mo-3">
                    <div v-for="c in fundedCards" :key="c.broker" class="acc-alloc-seg"
                        :style="{ width: pct(c) + '%', background: c.color }" :title="c.label + ' ' + pct(c).toFixed(1) + '%'"></div>
                </div>
                <div v-if="fundedCards.length" class="acc-legend at-mo-2">
                    <span v-for="c in fundedCards" :key="c.broker" class="acc-legend-item">
                        <span class="acc-dot" :style="{ background: c.color }"></span>{{ c.label }}
                        <span class="at-gedaempft at-ml-1">{{ pct(c).toFixed(1) }}%</span>
                    </span>
                </div>
            </Karte>

            <!-- Hinweis, wenn keine Börse konfiguriert -->
            <div v-if="!cards.length" class="at-gedaempft at-mittig at-py-5">
                {{ t('accounts.noBrokers') }}
            </div>

            <!-- Börsen-Karten -->
            <div class="acc-raster">
                <Karte v-for="card in cards" :key="card.broker" class="acc-card" :style="{ '--acc': card.color }">
                    <!-- Header -->
                    <div class="at-flex at-verteilt at-mitte acc-card-head">
                        <span class="acc-card-title"><span class="acc-dot" :style="{ background: card.color }"></span>{{ card.label }}</span>
                        <span v-if="card.data" class="acc-card-total">{{ fmtUsd(card.data.totalUsd) }}</span>
                    </div>

                    <!-- Loading / Error -->
                    <div v-if="card.loading" class="at-gedaempft at-klein at-py-3">
                        <Kreisel class="at-mr-2" />{{ t('accounts.loading') }}
                    </div>
                    <Hinweis v-else-if="card.error" art="fehler" class="at-mo-2 at-mu-2">{{ card.error }}</Hinweis>

                    <template v-else-if="card.data">
                        <!-- Wallets -->
                        <div v-for="w in card.data.wallets" :key="w.key" class="acc-wallet at-mo-2">
                            <div class="at-flex at-verteilt acc-wallet-head">
                                <span class="acc-wallet-label">{{ w.label }}</span>
                                <span class="acc-wallet-usd">{{ fmtUsd(w.usd) }}</span>
                            </div>
                            <!-- Bot-Zähler -->
                            <div v-if="w.key === 'bots'" class="acc-sub at-gedaempft">
                                {{ w.count }} {{ t('accounts.runningBots') }}
                            </div>
                            <!-- Futures-Felder -->
                            <div v-if="w.fields" class="acc-fields">
                                <span v-for="(val, k) in w.fields" :key="k" class="acc-field">
                                    <span class="at-gedaempft">{{ fieldLabel(k) }}:</span> {{ fmtUsd(val) }}
                                </span>
                            </div>
                            <!-- Spot-Assets -->
                            <table v-if="w.assets && w.assets.length" class="acc-assets">
                                <tr v-for="a in w.assets.slice(0, 12)" :key="a.coin">
                                    <td class="acc-coin">{{ a.coin }}</td>
                                    <td class="at-rechtsbuendig at-gedaempft">{{ fmtAmt(a.amount) }}</td>
                                    <td class="at-rechtsbuendig">{{ a.usd ? fmtUsd(a.usd) : '—' }}</td>
                                </tr>
                                <tr v-if="w.assets.length > 12">
                                    <td colspan="3" class="at-gedaempft at-mittig acc-more">+ {{ w.assets.length - 12 }} {{ t('accounts.more') }}</td>
                                </tr>
                            </table>
                            <div v-else-if="w.assets" class="acc-sub at-gedaempft">{{ t('accounts.empty') }}</div>
                        </div>

                        <!-- Moneyflow -->
                        <div class="acc-flow at-mo-3">
                            <div class="acc-wallet-label at-mu-1">{{ t('accounts.moneyFlow') }}</div>
                            <div v-if="!card.data.moneyFlow.supported" class="acc-sub at-gedaempft">
                                <Symbol name="info" class="at-mr-1" />{{ card.data.moneyFlow.reason || t('accounts.flowUnavailable') }}
                            </div>
                            <template v-else>
                                <div v-if="!card.data.moneyFlow.deposits.length && !card.data.moneyFlow.withdrawals.length"
                                    class="acc-sub at-gedaempft">{{ t('accounts.noFlow') }}</div>
                                <div v-else class="acc-flow-lists">
                                    <div v-for="d in card.data.moneyFlow.deposits.slice(0, 8)" :key="'d' + d.time + d.coin" class="acc-flow-row">
                                        <span class="at-gut"><Symbol name="pfeilSchraegAb" /> {{ t('accounts.deposit') }}</span>
                                        <span>{{ fmtAmt(d.amount) }} {{ d.coin }}</span>
                                        <span class="at-gedaempft">{{ fmtTime(d.time) }}</span>
                                    </div>
                                    <div v-for="w in card.data.moneyFlow.withdrawals.slice(0, 8)" :key="'w' + w.time + w.coin" class="acc-flow-row">
                                        <span class="at-schlecht"><Symbol name="pfeilHochRechts" /> {{ t('accounts.withdrawal') }}</span>
                                        <span>{{ fmtAmt(w.amount) }} {{ w.coin }}</span>
                                        <span class="at-gedaempft">{{ fmtTime(w.time) }}</span>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </template>
                </Karte>
            </div>
        </div>
    </div>
</template>

<style scoped>
.acc-seite { padding: 0 1rem 3rem; }
@media (min-width: 768px) { .acc-seite { padding: 0 1.5rem 3rem; } }
.acc-raster { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
@media (min-width: 1200px) { .acc-raster { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.acc-summary { border-left: 3px solid var(--accent); }
.acc-summary-label { font-size: 0.8rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.04em; }
.acc-summary-value { font-size: 2rem; font-weight: 700; color: var(--text); }
.acc-alloc-bar { display: flex; height: 12px; border-radius: 999px; overflow: hidden; background: var(--panel); }
.acc-alloc-seg { height: 100%; transition: width 0.3s ease; }
.acc-legend { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.82rem; }
.acc-legend-item { display: inline-flex; align-items: center; }
.acc-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 0.4rem; }

.acc-card { border-top: 3px solid var(--acc, var(--line)); }
.acc-card-head { padding-bottom: 0.5rem; border-bottom: 1px solid var(--line); }
.acc-card-title { font-size: 1.1rem; font-weight: 700; display: inline-flex; align-items: center; }
.acc-card-total { font-size: 1.15rem; font-weight: 700; color: var(--text); }

.acc-wallet { padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
.acc-wallet-label { font-weight: 600; font-size: 0.92rem; }
.acc-wallet-usd { font-weight: 600; }
.acc-sub { font-size: 0.8rem; margin-top: 0.2rem; }
.acc-fields { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.78rem; margin-top: 0.25rem; }
.acc-assets { width: 100%; font-size: 0.8rem; margin-top: 0.4rem; border-collapse: collapse; }
.acc-assets td { padding: 0.15rem 0; }
.acc-coin { font-weight: 600; }
.acc-more { font-size: 0.75rem; padding-top: 0.3rem; }

.acc-flow-lists { display: flex; flex-direction: column; gap: 0.25rem; }
.acc-flow-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.75rem; font-size: 0.8rem; align-items: center; }
</style>
