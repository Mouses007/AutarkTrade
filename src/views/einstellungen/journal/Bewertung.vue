<script setup>
/** Journal → Bewertung: Tags, Timeframes, Trade-Typ-Schwellen, Popups. */
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import { allTradeTimeframes, selectedTradeTimeframes } from '@/stores/filters.js'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings, dbGetSettings } from '@/utils/db.js'

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

async function saveTags() {
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
    saveTags()
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
    saveTags()
}

function cancelEditGroup() {
    editingGroup.value = null
}

function removeGroup(groupId) {
    const idx = tagGroups.findIndex(g => g.id === groupId)
    if (idx === 0) return // Erste Gruppe (Strategie) ist nicht löschbar
    if (idx !== -1) {
        tagGroups.splice(idx, 1)
        saveTags()
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
    saveTags()
}

function removeTag(group, tagId) {
    const idx = group.tags.findIndex(t => t.id === tagId)
    if (idx !== -1) {
        group.tags.splice(idx, 1)
        saveTags()
    }
}

/* POPUP SETTING */
async function loadPopupSetting() {
    showTradePopups.value = currentUser.value?.showTradePopups !== 0
}

async function savePopupSetting() {
    try {
        await dbUpdateSettings({ showTradePopups: showTradePopups.value ? 1 : 0 })
        currentUser.value.showTradePopups = showTradePopups.value ? 1 : 0
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
        currentUser.value.scalpMaxMinutes = scalpMaxMinutes.value
        currentUser.value.daytradeMaxHours = daytradeMaxHours.value
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
        currentUser.value.tradeTimeframes = arr
        currentUser.value.customTimeframes = custom
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

/* Stand aus den Einstellungen — Settings.vue hat sie vor dem Mount geladen. */
function ausEinstellungen() {
    const settings = currentUser.value || {}
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
    <div>
        <hr />

        <!--=============== BEWERTUNG ===============-->
        <div class="d-flex align-items-center pointerClass" @click="bewertungExpanded = !bewertungExpanded">
            <i class="uil me-2" :class="bewertungExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.evaluation') }}</p>
        </div>
        <div v-show="bewertungExpanded" class="mt-2 ms-3">

            <!--=============== TAGS (Unterabschnitt) ===============-->
            <div class="d-flex align-items-center pointerClass mb-1" @click="subTagsExpanded = !subTagsExpanded">
                <i class="uil me-1" :class="subTagsExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                <p class="fs-6 fw-bold mb-0">{{ t('settings.tagsSection') }}</p>
            </div>
            <div v-show="subTagsExpanded">
            <p class="fw-lighter">{{ t('settings.tagsDescription') }}</p>

            <!-- Existing groups -->
            <div v-for="group in tagGroups" :key="group.id" class="mb-3 p-3" :style="{ borderLeft: '4px solid ' + group.color, background: 'var(--bg-card)' }">
                <!-- Group header -->
                <div class="d-flex align-items-center mb-2">
                    <template v-if="editingGroup === group.id">
                        <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" v-model="editGroupName" @keyup.enter="saveEditGroup(group)" />
                        <input type="color" class="form-control form-control-color form-control-sm me-2" v-model="editGroupColor" />
                        <button class="btn btn-success btn-sm me-1" @click="saveEditGroup(group)"><i class="uil uil-check"></i></button>
                        <button class="btn btn-outline-secondary btn-sm" @click="cancelEditGroup"><i class="uil uil-times"></i></button>
                    </template>
                    <template v-else>
                        <span class="fw-bold me-2">{{ group.name }}</span>
                        <span class="badge me-2" :style="{ backgroundColor: group.color }">{{ group.tags.length }} {{ t('settings.tagsCountSuffix') }}</span>
                        <button v-if="tagGroups.indexOf(group) !== 0" class="btn btn-outline-secondary btn-sm me-1" @click="startEditGroup(group)"><i class="uil uil-pen"></i></button>
                        <button v-if="tagGroups.indexOf(group) !== 0" class="btn btn-outline-danger btn-sm" @click="removeGroup(group.id)"><i class="uil uil-trash-alt"></i></button>
                        <span v-else class="badge bg-secondary ms-1" style="font-size: 0.65rem;"><i class="uil uil-lock-alt me-1"></i>{{ t('common.mandatory') }}</span>
                    </template>
                </div>

                <!-- Tags in group -->
                <div class="d-flex flex-wrap gap-1 mb-2">
                    <span v-for="tag in group.tags" :key="tag.id" class="badge d-flex align-items-center" :style="{ backgroundColor: group.color }">
                        {{ tag.name }}
                        <i class="uil uil-times ms-1 pointerClass" @click="removeTag(group, tag.id)"></i>
                    </span>
                </div>

                <!-- Add tag input -->
                <div class="d-flex">
                    <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('settings.newTagPlaceholder')" v-model="newTagName[group.id]" @keyup.enter="addTag(group)" />
                    <button class="btn btn-outline-primary btn-sm" @click="addTag(group)">{{ t('settings.addTagBtn') }}</button>
                </div>
            </div>

            <!-- Add new group -->
            <div class="mt-3 p-3" style="border: 1px dashed var(--border-color); background: var(--bg-card);">
                <div class="d-flex align-items-center">
                    <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('settings.newGroupPlaceholder')" v-model="newGroupName" @keyup.enter="addGroup" />
                    <input type="color" class="form-control form-control-color form-control-sm me-2" v-model="newGroupColor" />
                    <button class="btn btn-outline-success btn-sm" @click="addGroup">{{ t('settings.addGroupBtn') }}</button>
                </div>
            </div>

            </div><!-- /subTagsExpanded -->

            <hr />

            <!--=============== TIMEFRAMES (Unterabschnitt) ===============-->
            <div class="d-flex align-items-center pointerClass mb-1" @click="subTimeframesExpanded = !subTimeframesExpanded">
                <i class="uil me-1" :class="subTimeframesExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                <p class="fs-6 fw-bold mb-0">{{ t('settings.timeframesSection') }}</p>
            </div>
            <div v-show="subTimeframesExpanded">
            <p class="fw-lighter">{{ t('settings.timeframesDescription') }}</p>
            <div v-for="group in timeframeGroups" :key="group" class="mb-2">
                <label class="fw-lighter text-uppercase small mb-1">{{ group }}</label>
                <div class="d-flex flex-wrap gap-1">
                    <template v-if="group === t('timeframes.custom')">
                        <span v-for="tf in timeframesByGroup(group)" :key="tf.value"
                            class="tag-badge d-flex align-items-center" :class="{ active: localTimeframes.has(tf.value) }"
                            v-on:click="toggleTimeframe(tf.value)">{{ tf.label }}
                            <i class="uil uil-times ms-1" style="font-size: 0.75rem; cursor: pointer;" @click.stop="removeCustomTimeframe(tf)"></i>
                        </span>
                    </template>
                    <template v-else>
                        <span v-for="tf in timeframesByGroup(group)" :key="tf.value"
                            class="tag-badge" :class="{ active: localTimeframes.has(tf.value) }"
                            v-on:click="toggleTimeframe(tf.value)">{{ tf.label }}</span>
                    </template>
                </div>
            </div>
            <!-- Eigenen Timeframe hinzufügen -->
            <div class="d-flex mt-2 mb-2">
                <input type="text" class="form-control form-control-sm me-2" style="max-width: 200px;" :placeholder="t('timeframes.egCustom')" v-model="newCustomTf" @keyup.enter="addCustomTimeframe" />
                <button class="btn btn-outline-primary btn-sm" @click="addCustomTimeframe">{{ t('timeframes.addCustom') }}</button>
                <InfoTipp schluessel="settings.info.customTimeframe" />
            </div>
            <div class="mt-3 mb-3">
                <button type="button" v-on:click="saveTimeframes" class="btn btn-success">{{ t('common.save') }}</button>
            </div>

            </div><!-- /subTimeframesExpanded -->

            <hr />

            <!--=============== TRADE-TYP AUTO-ERKENNUNG (Unterabschnitt) ===============-->
            <div class="d-flex align-items-center pointerClass mb-1" @click="subTradeTypeExpanded = !subTradeTypeExpanded">
                <i class="uil me-1" :class="subTradeTypeExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                <p class="fs-6 fw-bold mb-0">{{ t('settings.tradeTypeAutoDetection') }}</p>
            </div>
            <div v-show="subTradeTypeExpanded">
            <p class="fw-lighter">{{ t('settings.tradeTypeAutoDetectionDescription') }}</p>
            <div class="row g-2 align-items-end">
                <div class="col-auto">
                    <label class="form-label small mb-0">{{ t('settings.scalpMaxMinutes') }}</label>
                    <input type="number" class="form-control form-control-sm" style="max-width: 100px;"
                        v-model.number="scalpMaxMinutes" min="1" max="1440" />
                </div>
                <div class="col-auto">
                    <label class="form-label small mb-0">{{ t('settings.daytradeMaxHours') }}</label>
                    <input type="number" class="form-control form-control-sm" style="max-width: 100px;"
                        v-model.number="daytradeMaxHours" min="1" max="720" />
                </div>
                <div class="col-auto">
                    <button class="btn btn-success btn-sm" @click="saveTradeTypeThresholds">{{ t('common.save') }}</button>
                </div>
            </div>
            <small class="text-muted">{{ t('settings.tradeTypeThresholdHint') }}</small>

            </div><!-- /subTradeTypeExpanded -->

            <hr />

            <!--=============== POPUPS (Unterabschnitt) ===============-->
            <div class="d-flex align-items-center pointerClass mb-1" @click="subPopupsExpanded = !subPopupsExpanded">
                <i class="uil me-1" :class="subPopupsExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                <p class="fs-6 fw-bold mb-0">{{ t('settings.popupsAndNotifications') }}</p>
            </div>
            <div v-show="subPopupsExpanded">
            <p class="fw-lighter">{{ t('settings.popupsDescription') }}</p>
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="popupToggle" v-model="showTradePopups" @change="savePopupSetting">
                <label class="form-check-label" for="popupToggle">{{ t('settings.enablePopups') }}</label>
            </div>
            <!-- Der Hauptschalter für Benachrichtigungen steht jetzt im
                 eigenen Bereich „Benachrichtigungen", zusammen mit der
                 Kanalwahl je Ereignis und dem E-Mail-Versand. -->
            </div><!-- /subPopupsExpanded -->
        </div>

    </div>
</template>
