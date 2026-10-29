<script setup>
/** Journal → Bewertung: Tags, Timeframes, Trade-Typ-Schwellen, Popups. */
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { allTradeTimeframes, selectedTradeTimeframes } from '@/stores/filters.js'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings, dbGetSettings } from '@/utils/db.js'
import { meldeSchalter } from '@/utils/tradePopups.js'

const { t } = useI18n()

let bewertungExpanded = ref(false)
let subTagsExpanded = ref(false)
let subTimeframesExpanded = ref(false)
let subTradeTypeExpanded = ref(false)
let subPopupsExpanded = ref(false)

let showTradePopups = ref(true)
let scalpMaxMinutes = ref(15)
let daytradeMaxHours = ref(24)

let localTimeframes = reactive(new Set())
let customTimeframes = reactive([])
let newCustomTf = ref('')

/* TAGS */
let tagGroups = reactive([])
let newGroupName = ref('')
let newGroupColor = ref('#6c757d')
let newTagName = ref({}) // keyed by group id
let editingGroup = ref(null)
let editGroupName = ref('')
let editGroupColor = ref('')

/* TAGS MANAGEMENT */
let nextGroupId = 1
let nextTagId = 1

async function loadTags() {
    try {
        const settings = await dbGetSettings()
        const saved = settings.tags
        tagGroups.length = 0
        if (Array.isArray(saved) && saved.length > 0) {
            saved.forEach(g => tagGroups.push(g))
        }
        // Calculate next IDs from existing data
        tagGroups.forEach(g => {
            const gNum = parseInt(g.id.replace('group_', ''))
            if (gNum >= nextGroupId) nextGroupId = gNum + 1
            g.tags.forEach(t => {
                const tNum = parseInt(t.id.replace('tag_', ''))
                if (tNum >= nextTagId) nextTagId = tNum + 1
            })
        })
    } catch (error) {
        console.log(' -> Error loading tags: ' + error)
    }
}

async function speichereKatalog() {
    try {
        await dbUpdateSettings({ tags: JSON.parse(JSON.stringify(tagGroups)) })
        console.log(' -> Tags saved')
    } catch (error) {
        alert('Fehler beim Speichern der Tags: ' + error.message)
    }
}

function addGroup() {
    const name = newGroupName.value.trim()
    if (!name) return
    tagGroups.push({
        id: 'group_' + nextGroupId++,
        name: name,
        color: newGroupColor.value,
        tags: []
    })
    newGroupName.value = ''
    newGroupColor.value = '#6c757d'
    speichereKatalog()
}

function startEditGroup(group) {
    editingGroup.value = group.id
    editGroupName.value = group.name
    editGroupColor.value = group.color
}

function saveEditGroup(group) {
    group.name = editGroupName.value.trim() || group.name
    group.color = editGroupColor.value
    editingGroup.value = null
    speichereKatalog()
}

function cancelEditGroup() {
    editingGroup.value = null
}

function removeGroup(groupId) {
    const idx = tagGroups.findIndex(g => g.id === groupId)
    if (idx === 0) return // Erste Gruppe (Strategie) ist nicht löschbar
    if (idx !== -1) {
        tagGroups.splice(idx, 1)
        speichereKatalog()
    }
}

function addTag(group) {
    const name = (newTagName.value[group.id] || '').trim()
    if (!name) return
    group.tags.push({
        id: 'tag_' + nextTagId++,
        name: name
    })
    newTagName.value[group.id] = ''
    speichereKatalog()
}

function removeTag(group, tagId) {
    const idx = group.tags.findIndex(t => t.id === tagId)
    if (idx !== -1) {
        group.tags.splice(idx, 1)
        speichereKatalog()
    }
}

/* REIHENFOLGE: einen Tag ziehen (Maus, Finger, Stift) und innerhalb seiner Gruppe
   ablegen; gespeichert wird beim Loslassen. Erst ab 6 px Weg zählt es als Ziehen,
   damit ein Klick auf das × nicht verschiebt. Tastatur: Alt + Pfeil links/rechts. */
const ziehen = ref(null)   // { gruppe, id, x, y, aktiv, geaendert }

function tagGreifen(e, group, tag) {
    if (e.button !== 0 || e.target.closest('.tag-weg')) return
    ziehen.value = { gruppe: group.id, id: tag.id, x: e.clientX, y: e.clientY, aktiv: false, geaendert: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
}

function tagZiehen(e, group) {
    const z = ziehen.value
    if (!z || z.gruppe !== group.id) return
    if (!z.aktiv && Math.hypot(e.clientX - z.x, e.clientY - z.y) < 6) return
    z.aktiv = true
    const ziel = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tag-id]')
    if (!ziel || ziel.dataset.gruppe !== group.id || ziel.dataset.tagId === z.id) return
    const von = group.tags.findIndex(t => t.id === z.id)
    const nach = group.tags.findIndex(t => t.id === ziel.dataset.tagId)
    if (von < 0 || nach < 0) return
    group.tags.splice(nach, 0, ...group.tags.splice(von, 1))
    z.geaendert = true
}

function tagLoslassen() {
    const z = ziehen.value
    ziehen.value = null
    if (z?.geaendert) speichereKatalog()
}

function tagVerschieben(group, tag, schritt) {
    const von = group.tags.findIndex(t => t.id === tag.id)
    const nach = von + schritt
    if (von < 0 || nach < 0 || nach >= group.tags.length) return
    group.tags.splice(nach, 0, ...group.tags.splice(von, 1))
    speichereKatalog()
}

/* POPUP SETTING */
async function loadPopupSetting() {
    showTradePopups.value = appEinstellungen.value?.showTradePopups !== 0
}

/*
 * Wirkt sofort: der Rahmen beobachtet `appEinstellungen.showTradePopups`
 * (Polling an/aus), andere Tabs hören über `meldeSchalter`. Beim Einschalten
 * setzt der Server die Grenze neu — gemeldet wird nur, was ab jetzt kommt.
 * Aus heisst zudem: Schliessungen gehen ohne Abschlussbewertung direkt ins
 * Journal (utils/incoming.js) — das steht so im Beschreibungstext.
 */
async function savePopupSetting() {
    try {
        await dbUpdateSettings({ showTradePopups: showTradePopups.value ? 1 : 0 })
        appEinstellungen.value.showTradePopups = showTradePopups.value ? 1 : 0
        meldeSchalter(showTradePopups.value)
        console.log(' -> Popup-Einstellung gespeichert:', showTradePopups.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Popup-Einstellung:', error)
    }
}

/* TRADE TYPE THRESHOLDS */
async function saveTradeTypeThresholds() {
    try {
        await dbUpdateSettings({
            scalpMaxMinutes: scalpMaxMinutes.value,
            daytradeMaxHours: daytradeMaxHours.value
        })
        appEinstellungen.value.scalpMaxMinutes = scalpMaxMinutes.value
        appEinstellungen.value.daytradeMaxHours = daytradeMaxHours.value
        console.log(' -> Trade-Typ-Schwellwerte gespeichert')
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Trade-Typ-Schwellwerte:', error)
    }
}

/* TIMEFRAMES */
function toggleTimeframe(value) {
    if (localTimeframes.has(value)) {
        localTimeframes.delete(value)
    } else {
        localTimeframes.add(value)
    }
}

async function saveTimeframes() {
    try {
        const arr = [...localTimeframes]
        const custom = customTimeframes.map(tf => ({ value: tf.value, label: tf.label }))
        await dbUpdateSettings({ tradeTimeframes: arr, customTimeframes: custom })
        appEinstellungen.value.tradeTimeframes = arr
        appEinstellungen.value.customTimeframes = custom
        // Globales reactive Array aktualisieren
        selectedTradeTimeframes.splice(0)
        arr.forEach(v => selectedTradeTimeframes.push(v))
        console.log(' -> Timeframes gespeichert:', arr, 'custom:', custom)
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
    }
}

// Timeframe-Gruppen für die Anzeige
const timeframeGroups = computed(() => {
    const groups = [t('timeframes.minutes'), t('timeframes.hours'), t('timeframes.days')]
    if (customTimeframes.length > 0) groups.push(t('timeframes.custom'))
    return groups
})
function timeframesByGroup(group) {
    if (group === t('timeframes.custom')) return customTimeframes
    return allTradeTimeframes.value.filter(tf => tf.group === group)
}
function addCustomTimeframe() {
    const label = newCustomTf.value.trim()
    if (!label) return
    const value = 'custom_' + label.replace(/\s+/g, '_').toLowerCase()
    if (allTradeTimeframes.value.some(tf => tf.value === value) || customTimeframes.some(tf => tf.value === value)) return
    customTimeframes.push({ value, label, group: 'custom' })
    localTimeframes.add(value)
    newCustomTf.value = ''
    saveTimeframes()
}
function removeCustomTimeframe(tf) {
    const idx = customTimeframes.findIndex(c => c.value === tf.value)
    if (idx !== -1) customTimeframes.splice(idx, 1)
    localTimeframes.delete(tf.value)
    saveTimeframes()
}

/* Stand aus den Einstellungen — Einstellungen.vue hat sie vor dem Mount geladen. */
function ausEinstellungen() {
    const settings = appEinstellungen.value || {}
    scalpMaxMinutes.value = settings.scalpMaxMinutes ?? 15
    daytradeMaxHours.value = settings.daytradeMaxHours ?? 24
        // Timeframes laden
        const saved = settings.tradeTimeframes || []
        localTimeframes.clear()
        if (Array.isArray(saved)) {
            saved.forEach(v => localTimeframes.add(v))
        }
        // Custom Timeframes laden
        customTimeframes.splice(0)
        const savedCustom = settings.customTimeframes || []
        if (Array.isArray(savedCustom)) {
            savedCustom.forEach(tf => customTimeframes.push({ value: tf.value, label: tf.label, group: 'custom' }))
        }
    loadPopupSetting()
}
ausEinstellungen()

onMounted(loadTags)
</script>

<template>
    <Abschnitt :titel="t('settings.evaluation')" symbol="liste" v-model:offen="bewertungExpanded">

        <!-- Tags: Gruppen mit eigener Farbe, darin die einzelnen Tags. Die
             erste Gruppe (Strategie) ist Pflicht und bleibt unveränderbar. -->
        <Abschnitt :titel="t('settings.tagsSection')" unter v-model:offen="subTagsExpanded">
            <p class="beschreibung">{{ t('settings.tagsDescription') }}</p>

            <ul class="gruppen">
                <li v-for="(group, gi) in tagGroups" :key="group.id" class="gruppe" :style="{ '--gruppe': group.color }">
                    <div v-if="editingGroup === group.id" class="gruppe-kopf">
                        <input type="text" class="eingabe schmal" v-model="editGroupName"
                            :aria-label="t('common.edit')" @keyup.enter="saveEditGroup(group)" />
                        <input type="color" class="farbe" v-model="editGroupColor" :aria-label="t('common.edit')" />
                        <Knopf art="haupt" klein symbol="haken" nurSymbol :titel="t('common.save')" @click="saveEditGroup(group)" />
                        <Knopf art="leise" klein symbol="schliessen" nurSymbol :titel="t('common.cancel')" @click="cancelEditGroup" />
                    </div>
                    <div v-else class="gruppe-kopf">
                        <span class="punkt" aria-hidden="true"></span>
                        <span class="gruppe-name">{{ group.name }}</span>
                        <Pille ton="neutral">{{ group.tags.length }} {{ t('settings.tagsCountSuffix') }}</Pille>
                        <span class="gruppe-aktionen">
                            <template v-if="gi !== 0">
                                <Knopf art="leise" klein @click="startEditGroup(group)">{{ t('common.edit') }}</Knopf>
                                <Knopf art="gefahr" klein @click="removeGroup(group.id)">{{ t('common.delete') }}</Knopf>
                            </template>
                            <Pille v-else ton="neutral">{{ t('common.mandatory') }}</Pille>
                        </span>
                    </div>

                    <ul v-if="group.tags.length" class="tags">
                        <li v-for="tag in group.tags" :key="tag.id"
                            :class="['tag', { zieht: ziehen?.aktiv && ziehen.id === tag.id }]"
                            :data-tag-id="tag.id" :data-gruppe="group.id" tabindex="0"
                            :title="t('settings.tagZiehen')"
                            @pointerdown="tagGreifen($event, group, tag)" @pointermove="tagZiehen($event, group)"
                            @pointerup="tagLoslassen" @pointercancel="tagLoslassen"
                            @keydown.alt.left.prevent="tagVerschieben(group, tag, -1)"
                            @keydown.alt.right.prevent="tagVerschieben(group, tag, 1)">
                            <span>{{ tag.name }}</span>
                            <button type="button" class="tag-weg" :title="t('common.remove')" :aria-label="t('common.remove') + ': ' + tag.name"
                                @click="removeTag(group, tag.id)">
                                <Symbol name="schliessen" :groesse="12" />
                            </button>
                        </li>
                    </ul>

                    <form class="neu" @submit.prevent="addTag(group)">
                        <input type="text" class="eingabe schmal" v-model="newTagName[group.id]"
                            :placeholder="t('settings.newTagPlaceholder')" :aria-label="t('settings.newTagPlaceholder')" />
                        <Knopf type="submit" klein symbol="plus">{{ t('settings.addTagBtn') }}</Knopf>
                    </form>
                </li>
            </ul>

            <form class="neue-gruppe" @submit.prevent="addGroup">
                <input type="text" class="eingabe schmal" v-model="newGroupName"
                    :placeholder="t('settings.newGroupPlaceholder')" :aria-label="t('settings.newGroupPlaceholder')" />
                <input type="color" class="farbe" v-model="newGroupColor" :aria-label="t('settings.newGroupPlaceholder')" />
                <Knopf type="submit" klein symbol="plus">{{ t('settings.addGroupBtn') }}</Knopf>
            </form>
        </Abschnitt>

        <!-- Timeframes: Auswahl als Umschalt-Pillen, je Gruppe eine Zeile. -->
        <Abschnitt :titel="t('settings.timeframesSection')" unter v-model:offen="subTimeframesExpanded">
            <p class="beschreibung">{{ t('settings.timeframesDescription') }}</p>

            <fieldset v-for="group in timeframeGroups" :key="group" class="tf-gruppe">
                <legend>{{ group }}</legend>
                <div class="tf-liste">
                    <span v-for="tf in timeframesByGroup(group)" :key="tf.value" class="tf">
                        <button type="button" :class="['tf-wahl', { gewaehlt: localTimeframes.has(tf.value) }]"
                            :aria-pressed="localTimeframes.has(tf.value)" @click="toggleTimeframe(tf.value)">{{ tf.label }}</button>
                        <button v-if="group === t('timeframes.custom')" type="button" class="tf-weg"
                            :title="t('common.remove')" :aria-label="t('common.remove') + ': ' + tf.label"
                            @click="removeCustomTimeframe(tf)">
                            <Symbol name="schliessen" :groesse="12" />
                        </button>
                    </span>
                </div>
            </fieldset>

            <form class="neu" @submit.prevent="addCustomTimeframe">
                <input type="text" class="eingabe schmal" v-model="newCustomTf"
                    :placeholder="t('timeframes.egCustom')" :aria-label="t('timeframes.addCustom')" />
                <Knopf type="submit" klein symbol="plus">{{ t('timeframes.addCustom') }}</Knopf>
                <InfoTipp schluessel="settings.info.customTimeframe" />
            </form>
            <div class="aktionen">
                <Knopf art="haupt" @click="saveTimeframes">{{ t('common.save') }}</Knopf>
            </div>
        </Abschnitt>

        <!-- Trade-Typ: Haltedauer-Grenzen für Scalp und Daytrade. -->
        <Abschnitt :titel="t('settings.tradeTypeAutoDetection')" unter v-model:offen="subTradeTypeExpanded">
            <p class="beschreibung">{{ t('settings.tradeTypeAutoDetectionDescription') }}</p>
            <div class="schwellen">
                <label class="schwelle">
                    <span>{{ t('settings.scalpMaxMinutes') }}</span>
                    <input type="number" class="eingabe zahl" v-model.number="scalpMaxMinutes" min="1" max="1440" />
                </label>
                <label class="schwelle">
                    <span>{{ t('settings.daytradeMaxHours') }}</span>
                    <input type="number" class="eingabe zahl" v-model.number="daytradeMaxHours" min="1" max="720" />
                </label>
                <Knopf art="haupt" @click="saveTradeTypeThresholds">{{ t('common.save') }}</Knopf>
            </div>
            <p class="notiz">{{ t('settings.tradeTypeThresholdHint') }}</p>
        </Abschnitt>

        <!-- Popups. Der Hauptschalter für Benachrichtigungen steht im eigenen
             Bereich „Benachrichtigungen", zusammen mit der Kanalwahl je
             Ereignis und dem E-Mail-Versand. -->
        <Abschnitt :titel="t('settings.bewertungsPopups')" unter v-model:offen="subPopupsExpanded">
            <p class="beschreibung">{{ t('settings.popupsDescription') }}</p>
            <Schalter v-model="showTradePopups" :label="t('settings.enablePopups')" @change="savePopupSetting" />
        </Abschnitt>
    </Abschnitt>
</template>

<style scoped>
.beschreibung { color: var(--muted); margin: 0 0 var(--abstand-3); }
.notiz { margin: var(--abstand-2) 0 0; color: var(--muted); font-size: 0.82rem; }
.aktionen { margin-top: var(--abstand-3); }

/* Eingaben (nativ, weil Farbwähler und Enter-zum-Hinzufügen gebraucht werden) */
.eingabe {
    min-width: 0;
    padding: 0.4rem 0.65rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.88rem;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.eingabe.schmal { flex: 1 1 8rem; max-width: 14rem; }
.eingabe.zahl { width: 7rem; font-variant-numeric: tabular-nums; }
.farbe {
    flex: none;
    width: 2.2rem;
    height: 2rem;
    padding: 0.15rem;
    background: var(--bg);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    cursor: pointer;
}

/* Tag-Gruppen */
.gruppen, .tags { list-style: none; margin: 0; padding: 0; }
.gruppe {
    position: relative;
    margin-bottom: var(--abstand-3);
    padding: var(--abstand-3);
    padding-left: calc(var(--abstand-3) + 4px);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    overflow: hidden;
}
.gruppe::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: var(--gruppe);
}
.gruppe-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}
.punkt {
    flex: none;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--gruppe);
}
.gruppe-name { font-weight: 600; overflow-wrap: anywhere; }
.gruppe-aktionen {
    display: inline-flex;
    gap: var(--abstand-1);
    margin-left: auto;
}
.tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
    margin-top: var(--abstand-2);
}
.tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.15rem 0.25rem 0.15rem 0.6rem;
    border: 1px solid var(--gruppe);
    border-radius: var(--radius-pille);
    background: var(--panel-soft);
    font-size: 0.82rem;
    cursor: grab;
    user-select: none;
    touch-action: none;
}
.tag.zieht {
    cursor: grabbing;
    opacity: 0.6;
    outline: 1px dashed var(--gruppe);
}
.tag-weg, .tf-weg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 50%;
    color: var(--muted);
    cursor: pointer;
}
.tag-weg:hover, .tf-weg:hover { color: var(--bad); background: var(--bad-flaeche); }
.neu, .neue-gruppe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}
.neue-gruppe {
    padding: var(--abstand-3);
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius-knopf);
}

/* Timeframes */
.tf-gruppe {
    margin: 0 0 var(--abstand-3);
    padding: 0;
    border: 0;
    min-width: 0;
}
.tf-gruppe legend {
    margin-bottom: 0.35rem;
    padding: 0;
    color: var(--muted);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.tf-liste { display: flex; flex-wrap: wrap; gap: var(--abstand-1); }
.tf { display: inline-flex; align-items: center; }
.tf-wahl {
    padding: 0.2rem 0.7rem;
    background: transparent;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-pille);
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
}
.tf-wahl:hover { color: var(--text); }
.tf-wahl.gewaehlt {
    background: var(--accent-flaeche);
    border-color: var(--accent-rand);
    color: var(--accent);
}
.tf-wahl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Trade-Typ-Schwellen */
.schwellen {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--abstand-3);
}
.schwelle {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.82rem;
}
</style>
