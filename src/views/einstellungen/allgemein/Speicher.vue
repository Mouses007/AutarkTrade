<script setup>
/** Allgemein → Speicherverbrauch je Modul, mit Aufräumen. */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '@/components/InfoTipp.vue'
import { fmtBytes } from '../gemeinsam/format.js'

const { t } = useI18n()

/* SPEICHERVERBRAUCH JE MODUL (Allgemein) — reine Info, lazy geladen */
let speicherExpanded = ref(false)
let speicherLoading = ref(false)
let speicherDaten = ref(null)
let speicherFehler = ref('')
const speicherOffen = ref({})   // modulId -> Tabellen-Details aufgeklappt

async function ladeSpeicher(force = false) {
    speicherLoading.value = true
    speicherFehler.value = ''
    try {
        const { data } = await axios.get('/api/system/speicher' + (force ? '?force=1' : ''))
        speicherDaten.value = data
    } catch (e) {
        speicherFehler.value = t('settings.speicherFehler') + (e.response?.data?.error || e.message)
    } finally {
        speicherLoading.value = false
    }
}
function speicherToggle() {
    speicherExpanded.value = !speicherExpanded.value
    // Erst beim Aufklappen messen — die Abfrage soll nicht an jedem
    // Seitenaufruf der Einstellungen hängen.
    if (speicherExpanded.value && !speicherDaten.value && !speicherLoading.value) ladeSpeicher()
}
// Balkenbreite relativ zum grössten Modul: so bleibt auch ein 5-MB-Modul
// neben 2 GB Aufzeichnungen sichtbar von null unterscheidbar.
const speicherMax = computed(() => Math.max(1, ...(speicherDaten.value?.module || []).map((m) => m.bytes || 0)))
const speicherAnteil = (m) => Math.max(m.bytes ? 1 : 0, Math.round(((m.bytes || 0) / speicherMax.value) * 100))
const fmtZahl = (n) => new Intl.NumberFormat().format(Number(n) || 0)

/*
 * Aufräumen je Modul — Katalog spiegelt AUFRAEUM_AKTIONEN in
 * server/speicher-api.js. Zweistufig: „Prüfen" ist ein Trockenlauf und zeigt
 * die Trefferzahl; erst der rote Knopf löscht, und der nennt dieselbe Zahl.
 * Ändert man das Alter, verfällt die Vorschau — der rote Knopf darf nie
 * etwas anderes löschen, als geprüft wurde.
 */
const AUFRAEUMEN_JE_MODUL = { research: 'coinradarZeilen', nachrichten: 'newsItems', liveAnalyse: 'liveRecordings' }
const aufraeumTage = ref({ research: 60, nachrichten: 90, liveAnalyse: 90 })
const aufraeumVorschau = ref({})   // modulId -> Trefferzahl des Trockenlaufs
const aufraeumLoading = ref({})
const aufraeumMeldung = ref({})    // modulId -> { ok, text }

async function aufraeumPruefen(modulId) {
    aufraeumLoading.value[modulId] = true
    aufraeumMeldung.value[modulId] = null
    try {
        const { data } = await axios.post('/api/system/speicher/aufraeumen', {
            aktion: AUFRAEUMEN_JE_MODUL[modulId], tage: aufraeumTage.value[modulId], trocken: true,
        })
        aufraeumVorschau.value[modulId] = data.zeilen
    } catch (e) {
        aufraeumMeldung.value[modulId] = { ok: false, text: e.response?.data?.error || e.message }
    } finally {
        aufraeumLoading.value[modulId] = false
    }
}

async function aufraeumLoeschen(modulId) {
    aufraeumLoading.value[modulId] = true
    aufraeumMeldung.value[modulId] = null
    try {
        const { data } = await axios.post('/api/system/speicher/aufraeumen', {
            aktion: AUFRAEUMEN_JE_MODUL[modulId], tage: aufraeumTage.value[modulId],
        })
        aufraeumMeldung.value[modulId] = {
            ok: true,
            text: t('settings.aufraeumenFertig', { n: fmtZahl(data.geloescht) }) + ' ' + t('settings.aufraeumenPlatzHinweis'),
        }
        aufraeumVorschau.value[modulId] = undefined
        ladeSpeicher(true)   // neue Messung zeigt den Effekt
    } catch (e) {
        aufraeumMeldung.value[modulId] = { ok: false, text: e.response?.data?.error || e.message }
    } finally {
        aufraeumLoading.value[modulId] = false
    }
}
</script>

<template>
    <div>
        <hr />

        <!--=============== SPEICHERVERBRAUCH JE MODUL ===============-->
        <div class="d-flex align-items-center pointerClass" @click="speicherToggle">
            <i class="uil me-2" :class="speicherExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.speicherTitle') }}</p>
            <InfoTipp schluessel="settings.info.speicher" />
            <span v-if="speicherDaten?.gesamtBytes" class="badge bg-secondary ms-2">{{ fmtBytes(speicherDaten.gesamtBytes) }}</span>
        </div>
        <div v-show="speicherExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.speicherHint') }}</p>

            <div v-if="speicherLoading"><span class="spinner-border spinner-border-sm"></span></div>
            <div v-else-if="speicherFehler" class="small text-danger">{{ speicherFehler }}</div>
            <template v-else-if="speicherDaten">
                <div v-for="m in speicherDaten.module" :key="m.id" class="mb-1">
                    <div class="d-flex align-items-center pointerClass"
                        @click="speicherOffen[m.id] = !speicherOffen[m.id]">
                        <i class="uil me-1" :class="speicherOffen[m.id] ? 'uil-angle-down' : 'uil-angle-right'"></i>
                        <span class="small" style="min-width: 105px;">{{ t('settings.speicherModul.' + m.id) }}</span>
                        <div class="flex-grow-1 mx-2" style="height: 6px; background: var(--black-bg-2); border-radius: 3px; overflow: hidden;">
                            <div :style="{ width: speicherAnteil(m) + '%', height: '100%', background: 'var(--blue-color)' }"></div>
                        </div>
                        <span class="small" style="min-width: 72px; text-align: right;">{{ m.bytes != null ? fmtBytes(m.bytes) : '—' }}</span>
                        <span class="small text-muted ms-2 d-none d-sm-inline" style="min-width: 120px; text-align: right;">
                            {{ fmtZahl(m.zeilen) }} {{ t('settings.speicherZeilen') }}</span>
                    </div>
                    <div v-show="speicherOffen[m.id]" class="ms-4 mb-2">
                        <div v-for="tb in m.tabellen" :key="tb.name"
                            class="d-flex justify-content-between small fw-lighter" style="max-width: 460px;">
                            <span>{{ tb.name }}</span>
                            <span>{{ tb.bytes != null ? fmtBytes(tb.bytes) : '—' }} · {{ fmtZahl(tb.zeilen) }} {{ t('settings.speicherZeilen') }}</span>
                        </div>

                        <!-- Aufräumen (nur Module mit begründeter Regel; zweistufig) -->
                        <template v-if="AUFRAEUMEN_JE_MODUL[m.id]">
                            <p class="small fw-lighter mb-1 mt-2">{{ t('settings.aufraeumenAktion.' + AUFRAEUMEN_JE_MODUL[m.id]) }}</p>
                            <div class="d-flex align-items-center gap-2 flex-wrap">
                                <span class="small">{{ t('settings.aufraeumenAelterAls') }}</span>
                                <input type="text" inputmode="numeric" class="form-control form-control-sm" style="width: 70px;"
                                    v-model="aufraeumTage[m.id]" @input="aufraeumVorschau[m.id] = undefined" />
                                <span class="small">{{ t('settings.aufraeumenTage') }}</span>
                                <button type="button" class="btn btn-outline-secondary btn-sm"
                                    :disabled="aufraeumLoading[m.id]" @click="aufraeumPruefen(m.id)">
                                    <span v-if="aufraeumLoading[m.id]" class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.aufraeumenPruefen') }}
                                </button>
                                <span v-if="aufraeumVorschau[m.id] === 0" class="small text-muted">{{ t('settings.aufraeumenNichts') }}</span>
                                <button v-else-if="aufraeumVorschau[m.id] > 0" type="button" class="btn btn-outline-danger btn-sm"
                                    :disabled="aufraeumLoading[m.id]" @click="aufraeumLoeschen(m.id)">
                                    <i class="uil uil-trash-alt me-1"></i>{{ t('settings.aufraeumenLoeschen', { n: fmtZahl(aufraeumVorschau[m.id]) }) }}
                                </button>
                            </div>
                            <p v-if="aufraeumMeldung[m.id]" class="small mb-0 mt-1"
                                :class="aufraeumMeldung[m.id].ok ? 'text-success' : 'text-danger'">{{ aufraeumMeldung[m.id].text }}</p>
                        </template>
                    </div>
                </div>

                <div class="d-flex align-items-center mt-2 gap-3 flex-wrap">
                    <span class="small">{{ t('settings.speicherGesamt') }}:
                        <strong>{{ speicherDaten.gesamtBytes ? fmtBytes(speicherDaten.gesamtBytes) : '—' }}</strong>
                        <span class="text-muted"> ({{ speicherDaten.db === 'postgresql' ? 'PostgreSQL' : 'SQLite' }})</span>
                    </span>
                    <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="speicherLoading"
                        @click="ladeSpeicher(true)">
                        <i class="uil uil-refresh me-1"></i>{{ t('settings.speicherAktualisieren') }}
                    </button>
                </div>
                <p v-if="speicherDaten.zeilenGeschaetzt" class="fw-lighter small mb-0 mt-1">{{ t('settings.speicherZeilenGeschaetzt') }}</p>
            </template>
        </div>

    </div>
</template>
