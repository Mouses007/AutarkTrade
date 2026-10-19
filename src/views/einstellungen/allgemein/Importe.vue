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
import { Knopf, Pille, Symbol } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'

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
        alert(t('settings.importLoeschFehler') + error.message)
    }
}

onMounted(loadImports)
</script>

<template>
    <!--=============== IMPORTE ===============-->
    <Abschnitt v-model:offen="importsExpanded" :titel="t('settings.imports')" symbol="eingang">
        <template #kopf>
            <Pille ton="neutral">{{ importsList.length }}</Pille>
        </template>

        <p class="hinweis">{{ t('settings.importsDescription') }}</p>

        <div v-if="importsLoading" class="laedt"><span class="kreisel" role="status"></span></div>

        <p v-else-if="importsList.length === 0" class="gedaempft">{{ t('settings.noImports') }}</p>

        <div v-else>
            <!-- Monat-Gruppen -->
            <div v-for="month in importsGroupedByMonth" :key="month.key" class="monat">
                <!-- Monats-Header -->
                <button type="button" class="kopfzeile monat-kopf" :aria-expanded="expandedMonths.has(month.key)"
                    @click="toggleMonth(month.key)">
                    <Symbol :name="expandedMonths.has(month.key) ? 'runter' : 'ausklappen'" :groesse="16" class="pfeil" />
                    <span class="fett">{{ month.label }}</span>
                    <Pille ton="neutral">{{ month.days.length }} {{ month.days.length === 1 ? t('settings.dayLabel') : t('settings.daysLabel') }}</Pille>
                    <Pille ton="neutral">{{ month.tradeCount }} {{ t('common.trades') }}</Pille>
                    <Pille v-if="month.evaluatedCount === month.tradeCount && month.tradeCount > 0"
                        ton="gut">{{ t('settings.allEvaluated') }}</Pille>
                    <Pille v-else-if="month.evaluatedCount > 0" ton="warn">{{ month.evaluatedCount }}/{{ month.tradeCount }}</Pille>
                </button>

                <!-- Tage innerhalb des Monats -->
                <div v-show="expandedMonths.has(month.key)" class="tage">
                    <div v-for="data in month.days" :key="data.dateUnix" class="import-tag">
                        <!-- Import Day Header -->
                        <div class="tag-kopf">
                            <button type="button" class="kopfzeile" :aria-expanded="expandedImport === data.dateUnix"
                                @click="toggleImportExpand(data.dateUnix)">
                                <Symbol :name="expandedImport === data.dateUnix ? 'runter' : 'ausklappen'" :groesse="16" class="pfeil" />
                                <span class="fett">{{ useDateCalFormat(data.dateUnix) }}</span>
                                <Pille ton="neutral">{{ getTradeCount(data) }} {{ t('common.trades') }}</Pille>
                                <Pille v-if="getEvaluatedCount(data) === getTradeCount(data) && getTradeCount(data) > 0"
                                    ton="gut">{{ t('settings.allEvaluated') }}</Pille>
                                <Pille v-else-if="getEvaluatedCount(data) > 0" ton="warn">
                                    {{ t('settings.xOfYEvaluated', { x: getEvaluatedCount(data), y: getTradeCount(data) }) }}</Pille>
                                <Pille v-else-if="getTradeCount(data) > 0" ton="neutral" class="blass">{{ t('settings.notEvaluated') }}</Pille>
                            </button>
                            <div class="loeschen">
                                <template v-if="deleteConfirm === data.dateUnix">
                                    <span class="frage">{{ t('settings.sure') }}</span>
                                    <Knopf art="gefahr" klein @click="executeDeleteImport(data.dateUnix)">{{ t('common.yes') }}</Knopf>
                                    <Knopf klein @click="cancelDeleteImport">{{ t('common.no') }}</Knopf>
                                </template>
                                <Knopf v-else art="leise" klein nur-symbol symbol="papierkorb" class="weg"
                                    :titel="t('common.delete')" @click="confirmDeleteImport(data.dateUnix)" />
                            </div>
                        </div>

                        <!-- Expanded: Individual Trades -->
                        <div v-if="expandedImport === data.dateUnix" class="trades">
                            <div v-for="trade in getTradesForDay(data)" :key="trade.id" class="trade">
                                <div class="trade-links">
                                    <strong>{{ trade.symbol }}</strong>
                                    <Pille ton="neutral">{{ formatTradeSide(trade) }}</Pille>
                                    <span class="fett zahl" :class="parseFloat(trade.netProceeds || trade.grossProceeds || 0) >= 0 ? 'gewinn' : 'verlust'">
                                        {{ formatTradePnl(trade) }} USDT
                                    </span>
                                </div>
                                <Pille v-if="isTradeEvaluated(trade.id)" ton="gut" symbol="haken">{{ t('settings.importEvaluatedBadge') }}</Pille>
                                <Knopf v-else klein :href="'/playbook?tradeId=' + trade.id">{{ t('settings.importEvaluateLink') }}</Knopf>
                            </div>
                            <p v-if="getTradesForDay(data).length === 0" class="gedaempft klein">
                                {{ t('settings.importNoTradesFound') }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Abschnitt>
</template>

<style scoped>
.hinweis {
    margin: 0 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.88rem;
}
.gedaempft { color: var(--muted); }
.klein { font-size: 0.82rem; margin: 0.3rem 0; }
.fett { font-weight: 600; }
.laedt { text-align: center; color: var(--muted); padding: var(--abstand-2) 0; }
.kreisel {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: dreh 0.8s linear infinite;
}
@keyframes dreh { to { transform: rotate(360deg); } }
.monat { margin-bottom: var(--abstand-2); }
.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.6rem;
    background: none;
    border: 0;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.monat-kopf {
    width: 100%;
    background: var(--panel-soft);
    border-radius: var(--radius-knopf);
}
.monat-kopf:hover { background: var(--panel-hoch); }
.pfeil { flex: none; color: var(--muted); }
.tage { padding-left: var(--abstand-3); margin-top: 0.25rem; }
.import-tag { margin-bottom: 0.25rem; }
.tag-kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding-right: 0.4rem;
}
.tag-kopf:hover { border-color: var(--line-stark); }
.blass { opacity: 0.6; }
.loeschen {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex: none;
}
.frage { font-size: 0.82rem; margin-right: 0.2rem; }
.weg:hover { color: var(--bad); }
.trades { padding: var(--abstand-2) 0.5rem var(--abstand-2) var(--abstand-5); }
.trade {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-2);
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
}
.trade-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}
.zahl { font-variant-numeric: tabular-nums; }
.gewinn { color: var(--good); }
.verlust { color: var(--bad); }
@media (max-width: 575.98px) {
    .tage { padding-left: 0; }
    .trades { padding-left: var(--abstand-2); }
}
</style>
