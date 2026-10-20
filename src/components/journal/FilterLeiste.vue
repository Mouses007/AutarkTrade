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
import { seitenId, tradeZeitzone, journalHatDaten } from '../../stores/app/rahmen.js'
import {
    zeitraumListe, richtungsOptionen, zeitrahmenOptionen, kennzahlOptionen, bruttoNettoOptionen, plZufriedenheitOptionen, gewaehlteRichtungen, gewaehlterZeitrahmen,
    gewaehlteKennzahl, gewaehlteKonten, gewaehltBruttoNetto, gewaehltPlOderZufriedenheit, datumsBereich, gewaehlterMonat,
    selectedMonthPreset, gewaehlterZeitraum, plOderZufriedenheitEntwurf, betragArt, betragGross, tagAuswahl,
} from '../../stores/journal/filter.js'
import { verfuegbareTags } from '../../stores/journal/tagebuch.js'
import { formDatum, formMonat, formGrossAnfang } from '../../utils/journal/format.js'
import { starteKalender, starteDashboard, starteTagesansicht, useMountAuswertung, pruefeSichtbarkeit } from '../../utils/journal/ablauf.js'
import { schliesseMobilMenue } from '../../utils/journal/app.js'
import { ladeDiagramme } from '../../utils/journal/diagrammLader.js'
import { baueBilderNeu } from '../../utils/bilder/laden.js'

const { t } = useI18n()

const OHNE_TAG = 't000t'
const ZEILEN = {
    dashboard: ['zeitraum', 'bruttoNetto', 'richtung', 'zeitrahmen', 'kennzahl', 'tags'],
    calendar: ['monat', 'bruttoNetto', 'plZufriedenheit'],
    daily: ['monat', 'bruttoNetto', 'richtung', 'tags'],
    screenshots: ['bruttoNetto', 'richtung', 'tags'],
    auswertung: ['zeitraum', 'richtung', 'tags'],
}
const zeilen = computed(() => ZEILEN[seitenId.value] || [])
const zeigt = (zeile) => zeilen.value.includes(zeile)

const offen = ref(false)
const positionenOffen = ref(false)
const tagsOffen = ref(false)

// ── Zeitraum ───────────────────────────────────────────────────────────────
const periodeWert = computed(() => gewaehlterZeitraum.value?.value)
function waehlePeriode(wert) {
    const p = zeitraumListe.find(x => x.value === wert)
    if (!p) return
    gewaehlterZeitraum.value = p
    datumsBereich.value = { start: p.start, end: p.end }
}
function passendePeriode() {
    const r = datumsBereich.value
    gewaehlterZeitraum.value = zeitraumListe.find(p => p.start === r.start && p.end === r.end)
        || zeitraumListe.find(p => p.value === 'custom')
}
function setzeStart(datum) {
    if (!datum) return
    datumsBereich.value.start = dayjs.tz(datum, tradeZeitzone.value).startOf('day').unix()
    passendePeriode()
}
function setzeEnde(datum) {
    if (!datum) return
    datumsBereich.value.end = dayjs.tz(datum, tradeZeitzone.value).endOf('day').unix()
    passendePeriode()
}

// ── Monat ──────────────────────────────────────────────────────────────────
const monatWert = computed(() => (gewaehlterMonat.value ? formMonat(gewaehlterMonat.value.start) : ''))
function setzeMonat(wert) {
    if (!wert) return
    const tag = dayjs.tz(`${wert}-01`, tradeZeitzone.value)
    const start = tag.startOf('monat').unix()
    gewaehlterMonat.value = { start, end: tag.endOf('monat').unix() }
    const jetzt = dayjs().tz(tradeZeitzone.value).startOf('monat').unix()
    selectedMonthPreset.value = start === jetzt ? 'current' : 'custom'
}

// ── Richtung ───────────────────────────────────────────────────────────────
const positionenText = computed(() => {
    const gewaehlt = gewaehlteRichtungen.value || []
    if (gewaehlt.length === richtungsOptionen.value.length) return t('common.all')
    if (gewaehlt.length === 0) return t('common.none')
    return richtungsOptionen.value.filter(p => gewaehlt.includes(p.value)).map(p => p.label).join(', ')
})

// ── Tags ───────────────────────────────────────────────────────────────────
const alleTagIds = computed(() => verfuegbareTags.flatMap(g => (g.tags || []).map(x => x.id)))
/** Dashboard: alles ausser der Gruppe „Trade Abschluss". */
const angeboteneTags = computed(() => verfuegbareTags.filter(g => g.name !== 'Trade Abschluss').flatMap(g => g.tags || []))
const dashboardTagWert = computed(() => {
    const gewaehlt = tagAuswahl.value || []
    const ids = angeboteneTags.value.map(x => x.id)
    if (ids.length > 0 && gewaehlt.includes(OHNE_TAG) && ids.every(id => gewaehlt.includes(id))) return 'all'
    if (gewaehlt.length === 1) return gewaehlt[0]
    return 'all'
})
function waehleDashboardTag(wert) {
    if (wert === 'all') tagAuswahl.value = [OHNE_TAG, ...angeboteneTags.value.map(x => x.id)]
    else tagAuswahl.value = [wert]
}
const alleTagsMarkiert = ref(false)
const markiereAlleTags = () => { alleTagsMarkiert.value = alleTagIds.value.length + 1 === (tagAuswahl.value || []).length }
function schalteAlleTags() {
    tagAuswahl.value = []
    if (alleTagsMarkiert.value) {
        alleTagsMarkiert.value = false
    } else {
        tagAuswahl.value = [OHNE_TAG, ...alleTagIds.value]
        alleTagsMarkiert.value = true
    }
}

// ── Anwenden ───────────────────────────────────────────────────────────────
const endeVorStart = () => {
    const r = datumsBereich.value
    return !!r && r.end < r.start
}
const speichere = (k, v) => { try { localStorage.setItem(k, v) } catch { /* egal */ } }

async function speichern() {
    if (endeVorStart()) {
        alert(t('filters.endBeforeStart'))
        return
    }
    speichere('at.journal.datumsBereich', JSON.stringify(datumsBereich.value))
    if (seitenId.value === 'journalUebersicht' && journalHatDaten.value) (await ladeDiagramme()).zeichneDiagramme('clear')
    speichere('at.journal.zeitraum', JSON.stringify(gewaehlterZeitraum.value))
    speichere('at.journal.konten', gewaehlteKonten.value)
    speichere('at.journal.bruttoNetto', gewaehltBruttoNetto.value)
    betragArt.value = gewaehltBruttoNetto.value
    betragGross.value = gewaehltBruttoNetto.value ? formGrossAnfang(gewaehltBruttoNetto.value) : gewaehltBruttoNetto.value
    speichere('at.journal.richtungen', gewaehlteRichtungen.value)
    speichere('at.journal.zeitrahmen', gewaehlterZeitrahmen.value)
    speichere('at.journal.kennzahl', gewaehlteKennzahl.value)
    if (seitenId.value === 'tagesansicht' || seitenId.value === 'kalender') {
        speichere('at.journal.monat', JSON.stringify(gewaehlterMonat.value))
        speichere('selectedMonthPreset', selectedMonthPreset.value)
    }
    speichere('at.journal.tags', tagAuswahl.value)
    markiereAlleTags()
    if (plOderZufriedenheitEntwurf.value != null) {
        gewaehltPlOderZufriedenheit.value = plOderZufriedenheitEntwurf.value
        speichere('at.journal.plZufriedenheit', gewaehltPlOderZufriedenheit.value)
        plOderZufriedenheitEntwurf.value = null
    }

    if (seitenId.value === 'journalUebersicht') {
        starteDashboard()
    } else if (seitenId.value === 'tagesansicht') {
        await starteTagesansicht()
        pruefeSichtbarkeit()
    } else if (seitenId.value === 'bilder') {
        await baueBilderNeu()
        pruefeSichtbarkeit()
    } else if (seitenId.value === 'kalender') {
        starteKalender(true)
    } else if (seitenId.value === 'auswertung') {
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
    schliesseMobilMenue()
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
            <div v-if="zeigt('zeitraum')" class="filterZeile">
                <div class="filterSteuer">
                    <select class="at-feld klein" :value="periodeWert" @change="waehlePeriode($event.target.value)">
                        <option v-for="p in zeitraumListe" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                    <div v-if="periodeWert !== 'all' && datumsBereich" class="filterDaten">
                        <input type="date" class="at-feld klein" :value="formDatum(datumsBereich.start)" @change="setzeStart($event.target.value)">
                        <input type="date" class="at-feld klein" :value="formDatum(datumsBereich.end)" @change="setzeEnde($event.target.value)">
                    </div>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.zeitraum" /></span>
            </div>

            <!-- Monat -->
            <div v-if="zeigt('monat')" class="filterZeile">
                <div class="filterSteuer">
                    <input type="month" class="at-feld klein" :aria-label="t('filters.monthLabel')" :value="monatWert" @input="setzeMonat($event.target.value)">
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.monat" /></span>
            </div>

            <!-- Brutto/Netto -->
            <div v-if="zeigt('bruttoNetto')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="gewaehltBruttoNetto" class="at-feld klein">
                        <option v-for="g in bruttoNettoOptionen" :key="g.value" :value="g.value">{{ g.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.bruttoNetto" /></span>
            </div>

            <!-- Richtung -->
            <div v-if="zeigt('richtung')" class="filterZeile">
                <div class="filterSteuer">
                    <button type="button" class="at-feld klein filterAufklapp" @click="positionenOffen = !positionenOffen"><span class="at-kuerzen">{{ positionenText }}</span><Symbol name="runter" /></button>
                    <div v-show="positionenOffen" class="filterListe">
                        <label v-for="p in richtungsOptionen" :key="p.value" class="filterHaken">
                            <input v-model="gewaehlteRichtungen" type="checkbox" :value="p.value">
                            {{ p.label }}
                        </label>
                    </div>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.richtung" /></span>
            </div>

            <!-- Balken je Zeitraum -->
            <div v-if="zeigt('zeitrahmen')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="gewaehlterZeitrahmen" class="at-feld klein">
                        <option v-for="f in zeitrahmenOptionen" :key="f.value" :value="f.value">{{ f.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.zeitrahmen" /></span>
            </div>

            <!-- Kennzahl -->
            <div v-if="zeigt('kennzahl')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-model="gewaehlteKennzahl" class="at-feld klein">
                        <option v-for="r in kennzahlOptionen" :key="r.value" :value="r.value">{{ r.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.kennzahl" /></span>
            </div>

            <!-- PnL oder Zufriedenheit -->
            <div v-if="zeigt('plZufriedenheit')" class="filterZeile">
                <div class="filterSteuer">
                    <select class="at-feld klein" :value="gewaehltPlOderZufriedenheit" @change="plOderZufriedenheitEntwurf = $event.target.value">
                        <option v-for="p in plZufriedenheitOptionen" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                </div>
                <span class="filterInfo"><InfoTipp schluessel="filters.plZufriedenheit" /></span>
            </div>

            <!-- Tags -->
            <div v-if="zeigt('tags')" class="filterZeile">
                <div class="filterSteuer">
                    <select v-if="seitenId === 'journalUebersicht'" class="at-feld klein" :value="dashboardTagWert" @change="waehleDashboardTag($event.target.value)">
                        <option value="all">{{ t('filters.allTags') }}</option>
                        <option :value="OHNE_TAG">{{ t('filters.noTag') }}</option>
                        <option v-for="tag in angeboteneTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
                    </select>
                    <template v-else>
                        <button type="button" class="at-feld klein filterAufklapp" @click="tagsOffen = !tagsOffen">
                            <span class="at-kuerzen">Tags ({{ (tagAuswahl || []).length }})</span><Symbol name="runter" />
                        </button>
                        <div v-show="tagsOffen" class="filterListe">
                            <button type="button" class="filterUmschalter" @click="schalteAlleTags">
                                {{ alleTagsMarkiert ? t('common.none') : t('common.all') }}
                            </button>
                            <label class="filterHaken">
                                <input v-model="tagAuswahl" type="checkbox" :value="OHNE_TAG">
                                {{ t('filters.noTag') }}
                            </label>
                            <div v-for="gruppe in verfuegbareTags" :key="gruppe.id" class="filterGruppe">
                                <div class="filterGruppenKopf" :style="{ color: gruppe.color }">{{ gruppe.name }}</div>
                                <label v-for="tag in gruppe.tags || []" :key="tag.id" class="filterHaken">
                                    <input v-model="tagAuswahl" type="checkbox" :value="tag.id">
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
