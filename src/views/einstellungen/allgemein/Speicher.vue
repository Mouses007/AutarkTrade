<script setup>
/** Allgemein → Speicherverbrauch je Modul, mit Aufräumen. */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '@/components/InfoTipp.vue'
import { Knopf, Pille, Symbol } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
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
function speicherToggle(offen = !speicherExpanded.value) {
    speicherExpanded.value = offen
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
    <!--=============== SPEICHERVERBRAUCH JE MODUL ===============-->
    <Abschnitt :offen="speicherExpanded" :titel="t('settings.speicherTitle')" symbol="balken"
        @update:offen="speicherToggle">
        <template #kopf>
            <Pille v-if="speicherDaten?.gesamtBytes" ton="neutral">{{ fmtBytes(speicherDaten.gesamtBytes) }}</Pille>
        </template>

        <p class="hinweis">{{ t('settings.speicherHint') }}<InfoTipp schluessel="settings.info.speicher" /></p>

        <div v-if="speicherLoading" class="laedt"><span class="kreisel" aria-hidden="true"></span></div>
        <p v-else-if="speicherFehler" class="meldung schlecht">{{ speicherFehler }}</p>
        <template v-else-if="speicherDaten">
            <div v-for="m in speicherDaten.module" :key="m.id" class="modul">
                <button type="button" class="modul-kopf" :aria-expanded="!!speicherOffen[m.id]"
                    @click="speicherOffen[m.id] = !speicherOffen[m.id]">
                    <Symbol :name="speicherOffen[m.id] ? 'runter' : 'ausklappen'" :groesse="16" class="pfeil" />
                    <span class="name">{{ t('settings.speicherModul.' + m.id) }}</span>
                    <span class="balken"><span class="fuellung" :style="{ width: speicherAnteil(m) + '%' }"></span></span>
                    <span class="groesse">{{ m.bytes != null ? fmtBytes(m.bytes) : '—' }}</span>
                    <span class="zeilen">{{ fmtZahl(m.zeilen) }} {{ t('settings.speicherZeilen') }}</span>
                </button>
                <div v-show="speicherOffen[m.id]" class="modul-inhalt">
                    <div v-for="tb in m.tabellen" :key="tb.name" class="tabelle-zeile">
                        <span class="tb-name">{{ tb.name }}</span>
                        <span>{{ tb.bytes != null ? fmtBytes(tb.bytes) : '—' }} · {{ fmtZahl(tb.zeilen) }} {{ t('settings.speicherZeilen') }}</span>
                    </div>

                    <!-- Aufräumen (nur Module mit begründeter Regel; zweistufig) -->
                    <template v-if="AUFRAEUMEN_JE_MODUL[m.id]">
                        <p class="hinweis aufraeumen">{{ t('settings.aufraeumenAktion.' + AUFRAEUMEN_JE_MODUL[m.id]) }}</p>
                        <div class="aufraeum-zeile">
                            <span>{{ t('settings.aufraeumenAelterAls') }}</span>
                            <input type="text" inputmode="numeric" class="tage"
                                v-model="aufraeumTage[m.id]" @input="aufraeumVorschau[m.id] = undefined" />
                            <span>{{ t('settings.aufraeumenTage') }}</span>
                            <Knopf klein :laedt="aufraeumLoading[m.id]" @click="aufraeumPruefen(m.id)">
                                {{ t('settings.aufraeumenPruefen') }}
                            </Knopf>
                            <span v-if="aufraeumVorschau[m.id] === 0" class="gedaempft">{{ t('settings.aufraeumenNichts') }}</span>
                            <Knopf v-else-if="aufraeumVorschau[m.id] > 0" art="gefahr" klein
                                :disabled="aufraeumLoading[m.id]" @click="aufraeumLoeschen(m.id)">
                                {{ t('settings.aufraeumenLoeschen', { n: fmtZahl(aufraeumVorschau[m.id]) }) }}
                            </Knopf>
                        </div>
                        <p v-if="aufraeumMeldung[m.id]" class="meldung"
                            :class="aufraeumMeldung[m.id].ok ? 'gut' : 'schlecht'">{{ aufraeumMeldung[m.id].text }}</p>
                    </template>
                </div>
            </div>

            <div class="gesamt">
                <span>{{ t('settings.speicherGesamt') }}:
                    <strong>{{ speicherDaten.gesamtBytes ? fmtBytes(speicherDaten.gesamtBytes) : '—' }}</strong>
                    <span class="gedaempft"> ({{ speicherDaten.db === 'postgresql' ? 'PostgreSQL' : 'SQLite' }})</span>
                </span>
                <Knopf klein symbol="aktualisieren" :disabled="speicherLoading" @click="ladeSpeicher(true)">
                    {{ t('settings.speicherAktualisieren') }}
                </Knopf>
            </div>
            <p v-if="speicherDaten.zeilenGeschaetzt" class="hinweis">{{ t('settings.speicherZeilenGeschaetzt') }}</p>
        </template>
    </Abschnitt>
</template>

<style scoped>
.hinweis {
    margin: 0 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.88rem;
}
.hinweis.aufraeumen { margin: var(--abstand-2) 0 0.3rem; font-size: 0.82rem; }
.gedaempft { color: var(--muted); }
.laedt { padding: var(--abstand-2) 0; color: var(--muted); }
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
.modul { margin-bottom: 0.2rem; }
.modul-kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    width: 100%;
    padding: 0.35rem 0.4rem;
    background: none;
    border: 0;
    border-radius: var(--radius-klein);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
}
.modul-kopf:hover { background: var(--panel-soft); }
.pfeil { flex: none; color: var(--muted); }
.name { flex: none; min-width: 105px; }
.balken {
    flex: 1;
    min-width: 2rem;
    height: 6px;
    background: var(--panel-hoch);
    border-radius: var(--radius-pille);
    overflow: hidden;
}
.fuellung {
    display: block;
    height: 100%;
    background: var(--accent);
}
.groesse {
    flex: none;
    min-width: 72px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}
.zeilen {
    flex: none;
    min-width: 120px;
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}
.modul-inhalt {
    margin: 0.2rem 0 var(--abstand-2) 1.9rem;
    font-size: 0.82rem;
}
.tabelle-zeile {
    display: flex;
    justify-content: space-between;
    gap: var(--abstand-3);
    max-width: 460px;
    color: var(--muted);
}
.tb-name { min-width: 0; overflow-wrap: anywhere; }
.aufraeum-zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}
.tage {
    width: 70px;
    padding: 0.3rem 0.5rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-klein);
    font: inherit;
}
.tage:focus { outline: none; border-color: var(--accent); }
.meldung { margin: 0.3rem 0 0; font-size: 0.82rem; }
.meldung.gut { color: var(--good); }
.meldung.schlecht { color: var(--bad); }
.gesamt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-3);
    margin: var(--abstand-3) 0 var(--abstand-2);
    font-size: 0.88rem;
}
@media (max-width: 575.98px) {
    .zeilen { display: none; }
    .name { min-width: 80px; }
    .modul-inhalt { margin-left: 0.5rem; }
}
</style>
