<script setup>
/**
 * Filterleiste des Journals in der Seitenleiste (Spezifikation
 * journal-kern.md §4.9). Ändert die Auswahl-Stores sofort, gespeichert und neu
 * geladen wird erst mit „Anwenden".
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/journal/zeit.js'
import Symbol from '../basis/Symbol.vue'
import Knopf from '../basis/Knopf.vue'
import InfoTipp from '../InfoTipp.vue'
import { pageId, timeZoneTrade, hasData } from '../../stores/app/rahmen.js'
import {
    periodRange, positions, timeFrames, ratios, grossNet, plSatisfaction, selectedPositions, selectedTimeFrame,
    selectedRatio, selectedAccounts, selectedGrossNet, selectedPlSatisfaction, selectedDateRange, selectedMonth,
    selectedMonthPreset, selectedPeriodRange, tempSelectedPlSatisfaction, amountCase, amountCapital, selectedTags,
} from '../../stores/journal/filter.js'
import { availableTags } from '../../stores/journal/tagebuch.js'
import { useDateCalFormat, useDateCalFormatMonth, useCapitalizeFirstLetter } from '../../utils/journal/format.js'
import { useMountCalendar, useMountDashboard, useMountDaily, useMountAuswertung, useCheckVisibleScreen } from '../../utils/journal/ablauf.js'
import { useCloseMobileMenu } from '../../utils/journal/app.js'
import { ladeDiagramme } from '../../utils/journal/diagrammLader.js'
import { useRefreshScreenshot } from '../../utils/screenshots.js'

const { t } = useI18n()

const OHNE_TAG = 't000t'
const ZEILEN = {
    dashboard: ['periodRange', 'grossNet', 'positions', 'timeFrame', 'ratio', 'tags'],
    calendar: ['month', 'grossNet', 'plSatisfaction'],
    daily: ['month', 'grossNet', 'positions', 'tags'],
    screenshots: ['grossNet', 'positions', 'tags'],
    auswertung: ['periodRange', 'positions', 'tags'],
}
const zeilen = computed(() => ZEILEN[pageId.value] || [])
const zeigt = (zeile) => zeilen.value.includes(zeile)

const offen = ref(false)
const positionenOffen = ref(false)
const tagsOffen = ref(false)

// ── Zeitraum ───────────────────────────────────────────────────────────────
const periodeWert = computed(() => selectedPeriodRange.value?.value)
function waehlePeriode(wert) {
    const p = periodRange.find(x => x.value === wert)
    if (!p) return
    selectedPeriodRange.value = p
    selectedDateRange.value = { start: p.start, end: p.end }
}
function passendePeriode() {
    const r = selectedDateRange.value
    selectedPeriodRange.value = periodRange.find(p => p.start === r.start && p.end === r.end)
        || periodRange.find(p => p.value === 'custom')
}
function setzeStart(datum) {
    if (!datum) return
    selectedDateRange.value.start = dayjs.tz(datum, timeZoneTrade.value).startOf('day').unix()
    passendePeriode()
}
function setzeEnde(datum) {
    if (!datum) return
    selectedDateRange.value.end = dayjs.tz(datum, timeZoneTrade.value).endOf('day').unix()
    passendePeriode()
}

// ── Monat ──────────────────────────────────────────────────────────────────
const monatWert = computed(() => (selectedMonth.value ? useDateCalFormatMonth(selectedMonth.value.start) : ''))
function setzeMonat(wert) {
    if (!wert) return
    const tag = dayjs.tz(`${wert}-01`, timeZoneTrade.value)
    const start = tag.startOf('month').unix()
    selectedMonth.value = { start, end: tag.endOf('month').unix() }
    const jetzt = dayjs().tz(timeZoneTrade.value).startOf('month').unix()
    selectedMonthPreset.value = start === jetzt ? 'current' : 'custom'
}

// ── Richtung ───────────────────────────────────────────────────────────────
const positionenText = computed(() => {
    const gewaehlt = selectedPositions.value || []
    if (gewaehlt.length === positions.value.length) return t('common.all')
    if (gewaehlt.length === 0) return t('common.none')
    return positions.value.filter(p => gewaehlt.includes(p.value)).map(p => p.label).join(', ')
})

// ── Tags ───────────────────────────────────────────────────────────────────
const alleTagIds = computed(() => availableTags.flatMap(g => (g.tags || []).map(x => x.id)))
/** Dashboard: alles ausser der Gruppe „Trade Abschluss". */
const angeboteneTags = computed(() => availableTags.filter(g => g.name !== 'Trade Abschluss').flatMap(g => g.tags || []))
const dashboardTagWert = computed(() => {
    const gewaehlt = selectedTags.value || []
    const ids = angeboteneTags.value.map(x => x.id)
    if (ids.length > 0 && gewaehlt.includes(OHNE_TAG) && ids.every(id => gewaehlt.includes(id))) return 'all'
    if (gewaehlt.length === 1) return gewaehlt[0]
    return 'all'
})
function waehleDashboardTag(wert) {
    if (wert === 'all') selectedTags.value = [OHNE_TAG, ...angeboteneTags.value.map(x => x.id)]
    else selectedTags.value = [wert]
}
const alleTagsMarkiert = ref(false)
const markiereAlleTags = () => { alleTagsMarkiert.value = alleTagIds.value.length + 1 === (selectedTags.value || []).length }
function schalteAlleTags() {
    selectedTags.value = []
    if (alleTagsMarkiert.value) {
        alleTagsMarkiert.value = false
    } else {
        selectedTags.value = [OHNE_TAG, ...alleTagIds.value]
        alleTagsMarkiert.value = true
    }
}

// ── Anwenden ───────────────────────────────────────────────────────────────
const endeVorStart = () => {
    const r = selectedDateRange.value
    return !!r && r.end < r.start
}
const speichere = (k, v) => { try { localStorage.setItem(k, v) } catch { /* egal */ } }

async function speichern() {
    if (endeVorStart()) {
        alert(t('filters.endBeforeStart'))
        return
    }
    speichere('selectedDateRange', JSON.stringify(selectedDateRange.value))
    if (pageId.value === 'dashboard' && hasData.value) (await ladeDiagramme()).useECharts('clear')
    speichere('selectedPeriodRange', JSON.stringify(selectedPeriodRange.value))
    speichere('selectedAccounts', selectedAccounts.value)
    speichere('selectedGrossNet', selectedGrossNet.value)
    amountCase.value = selectedGrossNet.value
    amountCapital.value = selectedGrossNet.value ? useCapitalizeFirstLetter(selectedGrossNet.value) : selectedGrossNet.value
    speichere('selectedPositions', selectedPositions.value)
    speichere('selectedTimeFrame', selectedTimeFrame.value)
    speichere('selectedRatio', selectedRatio.value)
    if (pageId.value === 'daily' || pageId.value === 'calendar') {
        speichere('selectedMonth', JSON.stringify(selectedMonth.value))
        speichere('selectedMonthPreset', selectedMonthPreset.value)
    }
    speichere('selectedTags', selectedTags.value)
    markiereAlleTags()
    if (tempSelectedPlSatisfaction.value != null) {
        selectedPlSatisfaction.value = tempSelectedPlSatisfaction.value
        speichere('selectedPlSatisfaction', selectedPlSatisfaction.value)
        tempSelectedPlSatisfaction.value = null
    }

    if (pageId.value === 'dashboard') {
        useMountDashboard()
    } else if (pageId.value === 'daily') {
        await useMountDaily()
        useCheckVisibleScreen()
    } else if (pageId.value === 'screenshots') {
        await useRefreshScreenshot()
        useCheckVisibleScreen()
    } else if (pageId.value === 'calendar') {
        useMountCalendar(true)
    } else if (pageId.value === 'auswertung') {
        useMountAuswertung()
    }
}

function anwenden() {
    if (endeVorStart()) {
        alert(t('filters.endBeforeStart'))
        return
    }
    offen.value = false
    speichern()
    useCloseMobileMenu()
}

onMounted(() => {
    markiereAlleTags()
})
</script>

<template>
    <div v-if="zeilen.length" class="filterLeiste">
        <button type="button" class="filterKopf" :aria-expanded="offen" @click="offen = !offen">
            <Symbol name="suche" />
            <span>{{ t('common.filter') }}</span>
            <Symbol :name="offen ? 'hoch' : 'runter'" class="at-ml-auto" />
        </button>

        <div v-show="offen" class="filterInhalt">
            <!-- Zeitraum -->
            <div v-if="zeigt('periodRange')" class="filterZeile">
                <div class="filterSteuer">
                    <select class="at-feld klein" :value="periodeWert" @change="waehlePeriode($event.target.value)">
                        <option v-for="p in periodRange" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                    <div v-if="periodeWert !== 'all' && selectedDateRange" class="filterDaten">
                        <input type="date" class="at-feld klein" :value="useDateCalFormat(selectedDateRange.start)" @change="setzeStart($event.target.value)">
                        <input type="date" class="at-feld klein" :value="useDateCalFormat(selectedDateRange.end)" @change="setzeEnde($event.target.value)">
                    </div>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.periodRange" /></span>
            </div>

            <!-- Monat -->
            <div v-if="zeigt('month')" class="filterZeile">
                <div class="filterSteuer">
                    <input type="month" class="at-feld klein" :aria-label="t('filters.monthLabel')" :value="monatWert" @input="setzeMonat($event.target.value)">
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.month" /></span>
            </div>

            <!-- Brutto/Netto -->
            <div v-if="zeigt('grossNet')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="selectedGrossNet" class="at-feld klein">
                        <option v-for="g in grossNet" :key="g.value" :value="g.value">{{ g.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.grossNet" /></span>
            </div>

            <!-- Richtung -->
            <div v-if="zeigt('positions')" class="filterZeile">
                <div class="filterSteuer">
                    <button type="button" class="at-feld klein filterAufklapp" @click="positionenOffen = !positionenOffen"><span class="at-kuerzen">{{ positionenText }}</span><Symbol name="runter" /></button>
                    <div v-show="positionenOffen" class="filterListe">
                        <label v-for="p in positions" :key="p.value" class="filterHaken">
                            <input v-model="selectedPositions" type="checkbox" :value="p.value">
                            {{ p.label }}
                        </label>
                    </div>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.positions" /></span>
            </div>

            <!-- Balken je Zeitraum -->
            <div v-if="zeigt('timeFrame')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="selectedTimeFrame" class="at-feld klein">
                        <option v-for="f in timeFrames" :key="f.value" :value="f.value">{{ f.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.timeFrame" /></span>
            </div>

            <!-- Kennzahl -->
            <div v-if="zeigt('ratio')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="selectedRatio" class="at-feld klein">
                        <option v-for="r in ratios" :key="r.value" :value="r.value">{{ r.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.ratio" /></span>
            </div>

            <!-- PnL oder Zufriedenheit -->
            <div v-if="zeigt('plSatisfaction')" class="filterZeile">
                <div class="filterSteuer">
                    <select class="at-feld klein" :value="selectedPlSatisfaction" @change="tempSelectedPlSatisfaction = $event.target.value">
                        <option v-for="p in plSatisfaction" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.plSatisfaction" /></span>
            </div>

            <!-- Tags -->
            <div v-if="zeigt('tags')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-if="pageId === 'dashboard'" class="at-feld klein" :value="dashboardTagWert" @change="waehleDashboardTag($event.target.value)">
                        <option value="all">{{ t('filters.allTags') }}</option>
                        <option :value="OHNE_TAG">{{ t('filters.noTag') }}</option>
                        <option v-for="tag in angeboteneTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
                    </select>
                    <template v-else>
                        <button type="button" class="at-feld klein filterAufklapp" @click="tagsOffen = !tagsOffen">
                            <span class="at-kuerzen">Tags ({{ (selectedTags || []).length }})</span><Symbol name="runter" />
                        </button>
                        <div v-show="tagsOffen" class="filterListe">
                            <button type="button" class="filterUmschalter" @click="schalteAlleTags">
                                {{ alleTagsMarkiert ? t('common.none') : t('common.all') }}
                            </button>
                            <label class="filterHaken">
                                <input v-model="selectedTags" type="checkbox" :value="OHNE_TAG">
                                {{ t('filters.noTag') }}
                            </label>
                            <div v-for="gruppe in availableTags" :key="gruppe.id" class="filterGruppe">
                                <div class="filterGruppenKopf" :style="{ color: gruppe.color }">{{ gruppe.name }}</div>
                                <label v-for="tag in gruppe.tags || []" :key="tag.id" class="filterHaken">
                                    <input v-model="selectedTags" type="checkbox" :value="tag.id">
                                    {{ tag.name }}
                                </label>
                            </div>
                        </div>
                    </template>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.tags" /></span>
            </div>

            <Knopf art="haupt" klein class="filterAnwenden" @click="anwenden">{{ t('common.apply') }}</Knopf>
        </div>
    </div>
</template>

<style scoped>
.filterLeiste {
    margin-top: 0.4rem;
}
.filterKopf {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.3rem 0;
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 0.85rem;
}
.filterKopf:hover {
    color: var(--text);
}
.filterInhalt {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0 0.5rem;
}
.filterZeile {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
}
.filterSteuer {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.filterDaten {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.filterInfo {
    color: var(--muted);
    padding-top: 0.3rem;
    cursor: help;
}
.filterListe {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    max-height: 18rem;
    overflow-y: auto;
}
.filterHaken {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--text);
}
.filterGruppenKopf {
    font-size: 0.75rem;
    font-weight: 600;
    margin-top: 0.3rem;
}
.filterUmschalter {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-pille);
    color: var(--muted);
    font-size: 0.75rem;
    padding: 0.1rem 0.6rem;
}
.filterAufklapp {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    text-align: left;
}
.filterAufklapp :deep(.at-symbol) {
    color: var(--muted);
}
.filterHaken input {
    accent-color: var(--accent);
}
.filterAnwenden {
    align-self: flex-start;
}
</style>
