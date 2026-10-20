<script setup>
/**
 * Journal-Dashboard (Spezifikation ansichten.md „Dashboard", B.1–B.14).
 *
 * Die Seite lädt nicht selbst: `starteDashboard` füllt die Stores und
 * zeichnet die Diagramme; hier stehen Aufbau, Reiter, Karten-Menü und die
 * Kennzeichen. Gezeichnet wird über Element-IDs — `zeichneDiagramme` sucht sie per
 * Präfix und zeichnet nur sichtbare Knoten. Darum nach jedem Reiterwechsel
 * und nach dem Wiedereinblenden einer Karte neu zeichnen.
 */
import { computed, ref, nextTick, onBeforeMount, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { seiteLaedt, dashboardBereit, zeichenZaehler, journalHatDaten } from '../stores/ui.js'
import { dashReiter, betragArt, betragGross, selectedTradeCategory, gewaehlteKennzahl } from '../stores/filters.js'
import { totals, verfuegbareTags, groups, gefilterteTradesFlach, excursions } from '../stores/trades.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import { useFetchOpenPositions } from '../utils/incoming.js'
import { starteDashboard, useDisposeJournalCharts } from '../utils/journal/ablauf.js'
import { ladeDiagramme } from '../utils/journal/diagrammLader.js'
import { formGeld2, formGeld0, formZahl0, formZahlStellen } from '../utils/journal/format.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import NoData from '../components/NoData.vue'
import BotDashboard from '../components/BotDashboard.vue'
import Reiter from '@/components/basis/Reiter.vue'
import KartenMenue from '../components/dashboard/KartenMenue.vue'
import DiagrammKarte from '../components/dashboard/DiagrammKarte.vue'
import KarteKontostand from '../components/dashboard/KarteKontostand.vue'
import KarteKennzahlen from '../components/dashboard/KarteKennzahlen.vue'
import KarteGebuehren from '../components/dashboard/KarteGebuehren.vue'
import RentabilitaetKarte from '../components/dashboard/RentabilitaetKarte.vue'
import MfeKarte from '../components/dashboard/MfeKarte.vue'
import { ratio, mfeAnalyse, typStatistik, strategieStatistik } from '../components/dashboard/rechnung.js'

const { t } = useI18n()

// Einmal beim Anlegen; sonst liest diese Datei betragGross nicht.
betragGross.value = betragArt.value ? betragArt.value.charAt(0).toUpperCase() + betragArt.value.slice(1) : ''

// ── Reiter ───────────────────────────────────────────────────────────────
const REITER = ['overviewTab', 'tradesTab', 'timeTab', 'setupsTab', 'financialsTab']
const reiterListe = computed(() => [
    { id: 'overviewTab', titel: t('dashboard.overview') },
    { id: 'tradesTab', titel: t('dashboard.performance') },
    { id: 'timeTab', titel: t('dashboard.timeAndDate') },
    { id: 'setupsTab', titel: t('dashboard.setups') },
    { id: 'financialsTab', titel: t('dashboard.finances') },
])
// Ein unbekannter gespeicherter Wert liess früher die Seite leer; jetzt gilt
// die Übersicht.
const aktiverReiter = computed(() => (REITER.includes(dashReiter.value) ? dashReiter.value : 'overviewTab'))

async function neuZeichnen() {
    // Alte Instanzen freigeben, solange ihre Knoten noch hängen — der neue
    // Schlüssel ersetzt die Knoten gleich.
    useDisposeJournalCharts()
    zeichenZaehler.value += 1
    await nextTick()
    ;(await ladeDiagramme()).zeichneDiagramme('init')
}

async function reiterWechsel(id) {
    dashReiter.value = id
    try { localStorage.setItem('at.journal.dashReiter', id) } catch { /* privater Modus */ }
    await neuZeichnen()
}

// ── Karten-Menü ──────────────────────────────────────────────────────────
function leseVerborgen() {
    try {
        const liste = JSON.parse(localStorage.getItem('dashboard_hidden_cards') || '[]')
        return Array.isArray(liste) ? liste : []
    } catch {
        return []
    }
}
const verborgen = ref(leseVerborgen())
const zeige = (k) => !verborgen.value.includes(k)

async function umschalten(k) {
    const warVerborgen = verborgen.value.includes(k)
    verborgen.value = warVerborgen ? verborgen.value.filter(x => x !== k) : [...verborgen.value, k]
    try { localStorage.setItem('dashboard_hidden_cards', JSON.stringify(verborgen.value)) } catch { /* privater Modus */ }
    // Eine wieder eingeblendete Diagrammkarte stand früher leer bis zum
    // nächsten Reiterwechsel.
    if (warVerborgen) await neuZeichnen()
}

/** Titel ohne „({metric})" fürs Menü. */
const ohneMetrik = (schluessel) => t(schluessel, { metric: '' }).replace(/[()]/g, '').trim()
const kartenListe = computed(() => [
    { schluessel: 'accountBalance', titel: t('dashboard.accountBalance') },
    { schluessel: 'metrics', titel: t('dashboard.metrics') },
    { schluessel: 'fees', titel: t('dashboard.fees') },
    { schluessel: 'cumulativePnl', titel: t('dashboard.cumulativePnlChart') },
    { schluessel: 'appt', titel: 'APPT' },
    { schluessel: 'winRate', titel: t('dashboard.winRate') },
    { schluessel: 'tradingPerformance', titel: t('dashboard.tradingPerformance') },
    { schluessel: 'byWeekday', titel: ohneMetrik('dashboard.byWeekday') },
    { schluessel: 'byEntryTime', titel: ohneMetrik('dashboard.byEntryTime') },
    { schluessel: 'byDuration', titel: ohneMetrik('dashboard.byDuration') },
    { schluessel: 'heatmap', titel: t('dashboard.heatmapTitle') },
    { schluessel: 'byPosition', titel: ohneMetrik('dashboard.byPosition') },
    { schluessel: 'byStrategy', titel: ohneMetrik('dashboard.byStrategy') },
    { schluessel: 'tradeTypeStats', titel: t('dashboard.tradeTypeStats') },
    { schluessel: 'strategyTagStats', titel: t('dashboard.strategyTagStats') },
    { schluessel: 'bySymbol', titel: ohneMetrik('dashboard.bySymbol') },
    { schluessel: 'feesBySymbol', titel: t('dashboard.feesBySymbol') },
    { schluessel: 'mfeAnalysis', titel: t('dashboard.mfeAnalysis') },
])

// ── Kennzeichen und Ratio ────────────────────────────────────────────────
const kennzeichen = computed(() => {
    if (betragArt.value === 'gross') return ` (${t('options.gross')})`
    if (betragArt.value === 'net') return ` (${t('options.net')})`
    return ''
})

/*
 * Der Store `gewaehlteKennzahl` statt `localStorage` direkt: gleicher Wert
 * (setzeFilterwerte schreibt beide), aber reaktiv.
 */
const ratioAnzeige = computed(() => {
    const r = ratio(gewaehlteKennzahl.value, totals, betragArt.value)
    if (!r) return {}
    if (r.art === 'appt') {
        return {
            kurz: 'APPT',
            name: t('dashboard.avgProfitPerTrade'),
            wert: formGeld2(r.wert),
            info: [
                t('dashboard.avgProfitPerTrade'),
                t('dashboard.apptFormula'),
                `${t('dashboard.proceeds')}: ${formGeld0(r.erloes)}`,
                `Trades: ${formZahl0(r.anzahl)}`,
            ].join('\n'),
        }
    }
    return {
        kurz: t('options.profitFactor'),
        name: t('options.profitFactor'),
        wert: r.wert === Infinity ? '∞' : formZahlStellen(r.wert, 2),
        info: [
            t('dashboard.profitFactorFormula'),
            `${t('dashboard.gains')}: ${formGeld0(r.gewinne)}`,
            `${t('dashboard.losses')}: ${formGeld0(r.verluste)}`,
        ].join('\n'),
    }
})
const metrik = computed(() => ratioAnzeige.value.kurz)
const titelMitMetrik = (schluessel) => t(schluessel, { metric: metrik.value }) + kennzeichen.value
const apptTitel = computed(() => {
    const r = ratioAnzeige.value
    return (r.name || '') + (r.kurz === 'APPT' ? ' (APPT)' : '') + kennzeichen.value
})

// ── Tabellen-Karten ──────────────────────────────────────────────────────
const mfe = computed(() => mfeAnalyse(gefilterteTradesFlach, excursions, betragArt.value))
const typZeilen = computed(() => typStatistik(groups.tradeType))
const strategieZeilen = computed(() => strategieStatistik(verfuegbareTags, groups.tags))
// Die beiden Rentabilitäts-Tabellen rechnen immer netto (Rechenregel B.11);
// das Kennzeichen sagt deshalb fest „Netto", nicht den gewählten Fall.
const nettoKennzeichen = computed(() => ` (${t('options.net')})`)

// ── Lebenszyklus ─────────────────────────────────────────────────────────
onBeforeMount(async () => {
    await refreshAccountBalance({ force: true })
    // Nicht abwarten: das unrealisierte P&L soll sofort in den Kontostand,
    // ein Fehler hier holt das globale Polling nach.
    useFetchOpenPositions().catch(() => {})
    await starteDashboard()
})

onBeforeUnmount(() => {
    // Solange die Diagrammknoten noch im Dokument hängen.
    useDisposeJournalCharts()
})
</script>

<template>
    <div>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="db">
        <NoData v-if="!journalHatDaten" />

        <BotDashboard v-else-if="selectedTradeCategory === 'bot'" />

        <template v-else>
            <div class="db-leiste">
                <Reiter class="db-reiter" :model-value="aktiverReiter" :reiter="reiterListe" @update:model-value="reiterWechsel" />
                <KartenMenue :karten="kartenListe" :verborgen="verborgen" @umschalten="umschalten" />
            </div>

            <!-- Übersicht -->
            <div v-show="aktiverReiter === 'overviewTab'" class="db-raster">
                <template v-if="dashboardBereit">
                    <div v-if="zeige('accountBalance')" class="drittel">
                        <KarteKontostand />
                    </div>
                    <div v-if="zeige('metrics')" class="drittel">
                        <KarteKennzahlen :titel="t('dashboard.metrics') + kennzeichen" :ratio="ratioAnzeige" />
                    </div>
                    <div v-if="zeige('fees')" class="drittel">
                        <KarteGebuehren />
                    </div>
                </template>
                <div v-if="zeige('cumulativePnl')" class="voll">
                    <DiagrammKarte diagramm-id="lineBarChart1" :titel="t('dashboard.cumulativePnlChart') + kennzeichen"
                        info="dashboard.cumulativePnlChartTooltip" />
                </div>
                <div v-if="zeige('appt')" class="halb">
                    <DiagrammKarte diagramm-id="barChart1" :titel="apptTitel" />
                </div>
                <div v-if="zeige('winRate')" class="halb">
                    <DiagrammKarte diagramm-id="barChart2" :titel="t('dashboard.winRate') + kennzeichen" info="dashboard.winRateTooltip" />
                </div>
            </div>

            <!-- Performance -->
            <div v-show="aktiverReiter === 'tradesTab'" class="db-raster">
                <div v-if="zeige('tradingPerformance')" class="voll">
                    <DiagrammKarte diagramm-id="perfChart1" :hoehe="550" :titel="t('dashboard.tradingPerformance') + kennzeichen"
                        info="dashboard.tradingPerformanceTooltip" />
                </div>
                <div v-if="zeige('mfeAnalysis') && mfe.treffer > 0" class="voll">
                    <MfeKarte :titel="t('dashboard.mfeAnalysis') + kennzeichen" :analyse="mfe" />
                </div>
            </div>

            <!-- Zeit & Datum -->
            <div v-show="aktiverReiter === 'timeTab'" class="db-raster">
                <div v-if="zeige('byWeekday')" class="drittel">
                    <DiagrammKarte diagramm-id="weekdayChart1" :titel="titelMitMetrik('dashboard.byWeekday')" info="dashboard.byWeekdayTooltip" />
                </div>
                <div v-if="zeige('byEntryTime')" class="drittel">
                    <DiagrammKarte diagramm-id="entryTimeChart1" :titel="titelMitMetrik('dashboard.byEntryTime')" info="dashboard.byEntryTimeTooltip" />
                </div>
                <div v-if="zeige('byDuration')" class="drittel">
                    <DiagrammKarte diagramm-id="durationChart1" :titel="titelMitMetrik('dashboard.byDuration')" info="dashboard.byDurationTooltip" />
                </div>
                <div v-if="zeige('heatmap')" class="voll">
                    <DiagrammKarte diagramm-id="heatmapChart1" :hoehe="280" :titel="t('dashboard.heatmapTitle') + kennzeichen"
                        info="dashboard.heatmapTooltip" />
                </div>
            </div>

            <!-- Setups -->
            <div v-show="aktiverReiter === 'setupsTab'" class="db-raster">
                <div v-if="zeige('byPosition')" class="halb">
                    <DiagrammKarte diagramm-id="positionChart1" :hoehe="160" :titel="titelMitMetrik('dashboard.byPosition')" info="dashboard.byPositionTooltip" />
                </div>
                <div v-if="zeige('byStrategy')" class="halb">
                    <DiagrammKarte diagramm-id="strategyChart1" :hoehe="160" :titel="titelMitMetrik('dashboard.byStrategy')" info="dashboard.byStrategyTooltip" />
                </div>
                <div v-if="zeige('tradeTypeStats') && typZeilen.length" class="voll">
                    <RentabilitaetKarte :titel="t('dashboard.tradeTypeStats') + nettoKennzeichen" info="dashboard.tradeTypeStatsTooltip"
                        :spalte="t('dashboard.tradeType')" :zeilen="typZeilen" />
                </div>
                <div v-if="zeige('strategyTagStats') && strategieZeilen.length" class="voll">
                    <RentabilitaetKarte :titel="t('dashboard.strategyTagStats') + nettoKennzeichen" info="dashboard.strategyTagStatsTooltip"
                        :spalte="t('dashboard.strategy')" :zeilen="strategieZeilen" />
                </div>
            </div>

            <!-- Finanzen -->
            <div v-show="aktiverReiter === 'financialsTab'" class="db-raster">
                <div v-if="zeige('bySymbol')" class="halb">
                    <DiagrammKarte diagramm-id="symbolChart1" :titel="titelMitMetrik('dashboard.bySymbol')" info="dashboard.bySymbolTooltip" />
                </div>
                <div v-if="zeige('feesBySymbol')" class="halb">
                    <DiagrammKarte diagramm-id="feesChart1" :titel="t('dashboard.feesBySymbol')" info="dashboard.feesBySymbolTooltip" />
                </div>
            </div>
        </template>
    </div>
    </div>
</template>

<style scoped>
.db {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
}

.db-leiste {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.db-reiter {
    flex: 1 1 auto;
    min-width: 0;
}

/*
 * Kartenraster: Telefon eine Spalte; Tablet Drittel-Karten zu zweit;
 * ab Desktop Drittel und Hälften wie gewohnt.
 */
.db-raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.75rem;
}

.db-raster > * {
    grid-column: span 12;
    min-width: 0;
}

@media (min-width: 768px) {
    .db-raster > .drittel { grid-column: span 6; }
}

@media (min-width: 1200px) {
    .db-raster > .drittel { grid-column: span 4; }
    .db-raster > .halb { grid-column: span 6; }
}
</style>
