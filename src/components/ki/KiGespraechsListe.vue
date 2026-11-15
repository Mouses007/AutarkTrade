<script setup>
/**
 * Verlauf der KI-Coach-Gespräche: wählen, löschen, archivieren.
 *
 * Archivierte Gespräche verschwinden aus der Standardansicht, bleiben aber
 * erhalten — Löschen ist endgültig und braucht deshalb zwei Klicks. Die Liste
 * kommt gefiltert vom Server, sonst teilten sich beide Ansichten dessen
 * 50er-Grenze.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { anzeige } from '@/utils/journal/zeit.js'
import { logWarn } from '@/utils/logger.js'
import { Symbol, Knopf } from '@/components/basis'

const props = defineProps({
    // ID des gerade offenen Gesprächs (hervorgehoben)
    aktiv: { type: [Number, String], default: null },
})
const emit = defineEmits(['waehle', 'geloescht'])
const { t } = useI18n()

const sitzungen = ref([])
const zeigeArchiv = ref(false)
const auswahlModus = ref(false)
const gewaehlt = ref(new Set())
const loeschFrage = ref(null)        // ID, deren Löschen bestätigt werden will
const sammelLoeschFrage = ref(false)
const fehler = ref('')

const sichtbar = computed(() => sitzungen.value.filter((s) => !!s.archiviert === zeigeArchiv.value))

async function lade() {
    try {
        const { data } = await axios.get('/api/ai/agent/sessions', { params: { archiviert: zeigeArchiv.value ? 1 : 0 } })
        sitzungen.value = data
    } catch (e) {
        logWarn('KiCoach', 'Gespräche laden: ' + e.message)
    }
}

function leereAuswahl() {
    gewaehlt.value = new Set()
    sammelLoeschFrage.value = false
}

function schalteAuswahlModus() {
    auswahlModus.value = !auswahlModus.value
    leereAuswahl()
}

function schalteAuswahl(id) {
    const s = new Set(gewaehlt.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    gewaehlt.value = s
    sammelLoeschFrage.value = false
}

async function wechsleArchiv() {
    zeigeArchiv.value = !zeigeArchiv.value
    leereAuswahl()
    await lade()
}

async function loesche(id) {
    try {
        await axios.delete(`/api/ai/agent/sessions/${id}`)
        sitzungen.value = sitzungen.value.filter((s) => s.id !== id)
        emit('geloescht', id)
    } catch (e) {
        fehler.value = t('kiCoach.loeschFehler')
    }
    loeschFrage.value = null
}

async function loescheGewaehlte() {
    if (!sammelLoeschFrage.value) { sammelLoeschFrage.value = true; return }
    for (const id of [...gewaehlt.value]) await loesche(id)
    leereAuswahl()
}

async function archiviereGewaehlte() {
    // In der Archiv-Ansicht kehrt derselbe Knopf die Richtung um.
    const ziel = zeigeArchiv.value ? 0 : 1
    for (const id of [...gewaehlt.value]) {
        try { await axios.post(`/api/ai/agent/sessions/${id}/archiv`, { archiviert: ziel }) } catch { fehler.value = t('kiCoach.archivFehler') }
    }
    leereAuswahl()
    await lade()
}

function datum(wert) {
    return wert ? anzeige(wert).format('DD.MM.YYYY HH:mm') : ''
}

onMounted(lade)
defineExpose({ lade })
</script>

<template>
    <div class="kiListe">
        <div class="kopf">
            <span class="at-klein at-fett"><Symbol name="verlauf" class="at-mr-1" />{{ t('kiCoach.gespraeche') }}</span>
            <span class="at-flex at-luecke-1">
                <button type="button" class="listenKnopf" :class="{ an: auswahlModus }" :aria-pressed="auswahlModus"
                    :title="t('kiCoach.auswahl')" :aria-label="t('kiCoach.auswahl')" @click="schalteAuswahlModus">
                    <Symbol name="hakenKasten" />
                </button>
                <button type="button" class="listenKnopf" :class="{ an: zeigeArchiv }" :aria-pressed="zeigeArchiv"
                    :title="t('kiCoach.archivAnzeigen')" :aria-label="t('kiCoach.archivAnzeigen')" @click="wechsleArchiv">
                    <Symbol name="archiv" />
                </button>
            </span>
        </div>

        <div v-if="!sichtbar.length" class="at-gedaempft at-klein at-mittig at-py-2">
            {{ zeigeArchiv ? t('kiCoach.archivLeer') : t('kiCoach.keineGespraeche') }}
        </div>

        <div v-for="s in sichtbar" :key="s.id" class="eintrag klickZiel" :class="{ aktiv: aktiv === s.id }"
            @click="auswahlModus ? schalteAuswahl(s.id) : emit('waehle', s.id)">
            <div class="at-flex at-mitte at-luecke-2">
                <input v-if="auswahlModus" type="checkbox" class="at-mo-0 at-fest" :checked="gewaehlt.has(s.id)"
                    :aria-label="s.title || String(s.id)" @click.stop="schalteAuswahl(s.id)" />
                <div class="at-klein at-fett at-kuerzen titel">{{ s.title || '#' + s.id }}</div>
            </div>
            <div class="at-flex at-verteilt at-mitte">
                <span class="zeit">{{ datum(s.updatedAt || s.createdAt) }}</span>
                <template v-if="!auswahlModus">
                    <button v-if="loeschFrage !== s.id" type="button" class="listenKnopf gefahr" :title="t('kiCoach.loeschen')"
                        :aria-label="t('kiCoach.loeschen')" @click.stop="loeschFrage = s.id">
                        <Symbol name="muell" />
                    </button>
                    <span v-else class="at-flex at-luecke-1" @click.stop>
                        <Knopf art="gefahr" klein class="winzig" @click="loesche(s.id)">{{ t('common.yes') }}</Knopf>
                        <Knopf klein class="winzig" @click="loeschFrage = null">{{ t('common.no') }}</Knopf>
                    </span>
                </template>
            </div>
        </div>

        <div v-if="auswahlModus" class="at-flex at-spalte at-luecke-1 at-mo-2">
            <Knopf klein symbol="archiv" :disabled="!gewaehlt.size" @click="archiviereGewaehlte">
                {{ zeigeArchiv ? t('kiCoach.wiederherstellen') : t('kiCoach.archivieren') }} ({{ gewaehlt.size }})
            </Knopf>
            <Knopf klein art="gefahr" symbol="muell" :disabled="!gewaehlt.size" @click="loescheGewaehlte">
                {{ sammelLoeschFrage ? t('kiCoach.wirklichLoeschen') : t('kiCoach.loeschen') }} ({{ gewaehlt.size }})
            </Knopf>
        </div>
        <div v-if="fehler" class="at-schlecht at-klein at-mo-1">{{ fehler }}</div>
    </div>
</template>

<style scoped>
.kiListe {
    overflow-y: auto;
    min-height: 0;
}

.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
}

.eintrag {
    padding: 0.4rem 0.5rem;
    margin-bottom: 0.2rem;
    border: 1px solid transparent;
    border-radius: var(--radius-klein);
    transition: background 0.15s, border-color 0.15s;
}

.eintrag:hover {
    background: var(--panel-soft);
    border-color: var(--line);
}

.eintrag.aktiv {
    background: var(--accent-flaeche);
    border-color: var(--accent);
}

.titel {
    min-width: 0;
}

.zeit {
    font-size: 0.65rem;
    color: var(--muted);
}

.listenKnopf {
    background: none;
    border: none;
    padding: 0 0.2rem;
    font: inherit;
    font-size: 0.9rem;
    color: var(--leise);
    cursor: pointer;
    transition: color 0.15s;
}

.listenKnopf:hover {
    color: var(--text);
}

.listenKnopf.an {
    color: var(--accent);
}

.listenKnopf.gefahr {
    font-size: 0.75rem;
    color: var(--bad);
}

.winzig {
    font-size: 0.65rem;
    padding: 0.1rem 0.4rem;
}
</style>
