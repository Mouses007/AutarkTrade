<script setup>
/** Allgemein → Importe: importierte Handelstage je Monat, einzeln löschbar. */
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { useDateCalFormat } from '@/utils/formatters.js'
import { selectedBroker } from '@/stores/filters.js'
import { dbFind, dbFirst, dbDelete, dbDeleteWhere } from '@/utils/db.js'
import { refreshAccountBalance } from '@/stores/accountBalance.js'
import { logWarn } from '@/utils/logger.js'

const { t } = useI18n()

let importsExpanded = ref(false)

/* IMPORTS MANAGEMENT */
let importsList = reactive([])
let importsLoading = ref(true)
let deleteConfirm = ref(null) // dateUnix of item being confirmed for deletion
let expandedImport = ref(null) // dateUnix of expanded import row
let importsNotes = reactive([]) // all notes for evaluated check

async function loadImports() {
    importsLoading.value = true
    try {
        const results = await dbFind('trades', { descending: 'dateUnix', limit: 10000 })
        importsList.length = 0

        const broker = selectedBroker.value
        results.forEach(r => {
            if (broker && r.trades && Array.isArray(r.trades)) {
                // Filter trades within the day to only the selected broker
                const brokerTrades = r.trades.filter(t => t.broker === broker)
                if (brokerTrades.length === 0) return // skip days with no trades for this broker
                // Clone and replace trades array with filtered version
                const filtered = { ...r, trades: brokerTrades }
                importsList.push(filtered)
            } else {
                importsList.push(r)
            }
        })

        // Load notes to check which trades have evaluations
        const notes = await dbFind('notes', { limit: 10000 })
        importsNotes.length = 0
        notes.forEach(n => importsNotes.push(n))
    } catch (error) {
        console.log(' -> Error loading imports: ' + error)
    }
    importsLoading.value = false
}

// Importe nach Monat gruppieren
const expandedMonths = reactive(new Set())
const importsGroupedByMonth = computed(() => {
    const groups = {}
    importsList.forEach(data => {
        const d = dayjs.unix(data.dateUnix)
        const monthKey = d.format('YYYY-MM')
        if (!groups[monthKey]) {
            groups[monthKey] = { key: monthKey, label: d.format('MMMM YYYY'), days: [], tradeCount: 0, evaluatedCount: 0 }
        }
        const tc = getTradeCount(data)
        groups[monthKey].days.push(data)
        groups[monthKey].tradeCount += tc
        groups[monthKey].evaluatedCount += getEvaluatedCount(data)
    })
    return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key))
})

function toggleMonth(monthKey) {
    if (expandedMonths.has(monthKey)) expandedMonths.delete(monthKey)
    else expandedMonths.add(monthKey)
}

function toggleImportExpand(dateUnix) {
    expandedImport.value = expandedImport.value === dateUnix ? null : dateUnix
}

function getTradesForDay(data) {
    if (!data.trades || !Array.isArray(data.trades)) return []
    return data.trades
}

function isTradeEvaluated(tradeId) {
    return importsNotes.some(n => n.tradeId === tradeId)
}

function getTradeCount(data) {
    return data.trades && Array.isArray(data.trades) ? data.trades.length : 0
}

function getEvaluatedCount(data) {
    if (!data.trades || !Array.isArray(data.trades)) return 0
    return data.trades.filter(t => isTradeEvaluated(t.id)).length
}

function formatTradePnl(trade) {
    const pnl = parseFloat(trade.netProceeds || trade.grossProceeds || 0)
    return (pnl >= 0 ? '+' : '') + pnl.toFixed(2)
}

function formatTradeSide(trade) {
    if (trade.strategy === 'long' || trade.side === 'B') return 'LONG'
    if (trade.strategy === 'short' || trade.side === 'SS') return 'SHORT'
    return trade.side || ''
}

async function confirmDeleteImport(dateUnix) {
    deleteConfirm.value = dateUnix
}

async function cancelDeleteImport() {
    deleteConfirm.value = null
}

async function executeDeleteImport(dateUnix) {
    try {
        const broker = selectedBroker.value || 'bitunix'
        // Find and delete trade (broker-aware)
        const existing = await dbFirst('trades', { equalTo: { dateUnix: dateUnix, broker: broker } })
        if (existing) {
            await dbDelete('trades', existing.objectId)
            console.log(' -> Deleted trade for dateUnix ' + dateUnix + ' (broker: ' + broker + ')')

            // Reset lastApiImport so deleted trades can be re-imported
            try {
                await axios.post(`/api/${broker}/last-import`, { timestamp: 0 })
                console.log(` -> Reset ${broker} lastApiImport for re-import`)
            } catch (e) {
                console.log(' -> Could not reset lastApiImport:', e.message)
            }
        }
        // Delete related excursions
        try {
            await dbDeleteWhere('excursions', { equalTo: { dateUnix: dateUnix } })
        } catch (e) {
            logWarn('settings-view', 'Excursions konnten nicht gelöscht werden', e)
        }

        // Kontostand-Cache aktualisieren nach Trade-Loeschung
        try {
            const broker = selectedBroker.value || 'bitunix'
            await refreshAccountBalance({ broker, force: true })
        } catch (e) {
            logWarn('settings-view', 'refreshAccountBalance nach Delete fehlgeschlagen', e)
        }

        deleteConfirm.value = null
        await loadImports()
    } catch (error) {
        alert('Fehler beim Löschen: ' + error.message)
    }
}

onMounted(loadImports)
</script>

<template>
    <div>
        <hr />

        <!--=============== IMPORTE ===============-->
        <div class="d-flex align-items-center pointerClass" @click="importsExpanded = !importsExpanded">
            <i class="uil me-2" :class="importsExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.imports') }}</p>
            <span class="badge bg-secondary ms-2">{{ importsList.length }}</span>
        </div>
        <div v-show="importsExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.importsDescription') }}</p>

            <div>
                <div v-if="importsLoading" class="text-center">
                    <div class="spinner-border spinner-border-sm" role="status"></div>
                </div>

                <div v-else-if="importsList.length === 0">
                    <p class="text-muted">{{ t('settings.noImports') }}</p>
                </div>

                <div v-else>
                    <!-- Monat-Gruppen -->
                    <div v-for="month in importsGroupedByMonth" :key="month.key" class="mb-2">
                        <!-- Monats-Header -->
                        <div class="d-flex align-items-center gap-2 p-2 pointerClass"
                            style="background: var(--black-bg-5, #141422); border-radius: var(--border-radius, 6px);"
                            @click="toggleMonth(month.key)">
                            <i class="uil" :class="expandedMonths.has(month.key) ? 'uil-angle-down' : 'uil-angle-right'"></i>
                            <span class="fw-bold">{{ month.label }}</span>
                            <span class="badge bg-secondary">{{ month.days.length }} {{ month.days.length === 1 ? t('settings.dayLabel') : t('settings.daysLabel') }}</span>
                            <span class="badge bg-secondary">{{ month.tradeCount }} {{ t('common.trades') }}</span>
                            <span v-if="month.evaluatedCount === month.tradeCount && month.tradeCount > 0"
                                class="badge bg-success">{{ t('settings.allEvaluated') }}</span>
                            <span v-else-if="month.evaluatedCount > 0"
                                class="badge bg-warning text-dark">{{ month.evaluatedCount }}/{{ month.tradeCount }}</span>
                        </div>

                        <!-- Tage innerhalb des Monats -->
                        <div v-show="expandedMonths.has(month.key)" class="ps-3 mt-1">
                            <div v-for="data in month.days" :key="data.dateUnix" class="import-row mb-1">
                                <!-- Import Day Header -->
                                <div class="d-flex align-items-center justify-content-between p-2 pointerClass"
                                    style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px);"
                                    @click="toggleImportExpand(data.dateUnix)">
                                    <div class="d-flex align-items-center gap-2">
                                        <i class="uil" :class="expandedImport === data.dateUnix ? 'uil-angle-down' : 'uil-angle-right'"></i>
                                        <span class="fw-bold">{{ useDateCalFormat(data.dateUnix) }}</span>
                                        <span class="badge bg-secondary">{{ getTradeCount(data) }} {{ t('common.trades') }}</span>
                                        <span v-if="getEvaluatedCount(data) === getTradeCount(data) && getTradeCount(data) > 0"
                                            class="badge bg-success">{{ t('settings.allEvaluated') }}</span>
                                        <span v-else-if="getEvaluatedCount(data) > 0"
                                            class="badge bg-warning text-dark">{{ t('settings.xOfYEvaluated', { x: getEvaluatedCount(data), y: getTradeCount(data) }) }}</span>
                                        <span v-else-if="getTradeCount(data) > 0"
                                            class="badge bg-secondary" style="opacity: 0.6;">{{ t('settings.notEvaluated') }}</span>
                                    </div>
                                    <div>
                                        <span v-if="deleteConfirm === data.dateUnix" @click.stop>
                                            <span class="me-2 small">{{ t('settings.sure') }}</span>
                                            <button class="btn btn-danger btn-sm me-1" @click.stop="executeDeleteImport(data.dateUnix)">{{ t('common.yes') }}</button>
                                            <button class="btn btn-outline-secondary btn-sm" @click.stop="cancelDeleteImport">{{ t('common.no') }}</button>
                                        </span>
                                        <i v-else class="uil uil-trash-alt pointerClass text-danger" @click.stop="confirmDeleteImport(data.dateUnix)"></i>
                                    </div>
                                </div>

                                <!-- Expanded: Individual Trades -->
                                <div v-if="expandedImport === data.dateUnix" class="ps-4 pe-2 py-2">
                                    <div v-for="trade in getTradesForDay(data)" :key="trade.id"
                                        class="d-flex align-items-center justify-content-between py-1"
                                        style="border-bottom: 1px solid var(--white-10, rgba(255,255,255,0.05));">
                                        <div class="d-flex align-items-center gap-2">
                                            <strong>{{ trade.symbol }}</strong>
                                            <span class="badge" :class="trade.strategy === 'long' || trade.side === 'B' ? 'bg-success' : 'bg-danger'">
                                                {{ formatTradeSide(trade) }}
                                            </span>
                                            <span class="fw-bold" :class="parseFloat(trade.netProceeds || trade.grossProceeds || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                                                {{ formatTradePnl(trade) }} USDT
                                            </span>
                                        </div>
                                        <div class="d-flex align-items-center gap-2">
                                            <span v-if="isTradeEvaluated(trade.id)" class="badge bg-success">
                                                <i class="uil uil-check me-1"></i>{{ t('settings.importEvaluatedBadge') }}
                                            </span>
                                            <a v-else :href="'/playbook?tradeId=' + trade.id" class="btn btn-sm btn-outline-primary py-0 px-2">
                                                <i class="uil uil-pen me-1"></i>{{ t('settings.importEvaluateLink') }}
                                            </a>
                                        </div>
                                    </div>
                                    <div v-if="getTradesForDay(data).length === 0" class="text-muted small py-1">
                                        {{ t('settings.importNoTradesFound') }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
