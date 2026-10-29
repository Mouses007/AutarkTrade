<script setup>
/** Geräte → ESP32-Display: API-Schlüssel, Zeitraum-Filter der Anzeige und eingetragene Push-Geräte. */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Tabelle from '@/components/basis/Tabelle.vue'
import Symbol from '@/components/basis/Symbol.vue'
import dayjs from 'dayjs'

const { t } = useI18n()

/* ESP32 DISPLAY SETTINGS */
let esp32Expanded = ref(false)
let esp32KeySet = ref(false)
let esp32ApiKeyDisplay = ref('')
let esp32SaveLoading = ref(false)
let esp32SaveResult = ref(null)
let esp32Filter = ref('month')

/* Unterstützte Boards — Firmware liegt im Repo. */
const boardSpalten = computed(() => [
    { schluessel: 'board', titel: t('settings.esp32SpalteBoard') },
    { schluessel: 'display', titel: t('settings.esp32SpalteDisplay') },
    { schluessel: 'touch', titel: t('settings.esp32SpalteTouch') },
    { schluessel: 'mcu', titel: t('settings.esp32SpalteMcu') },
    { schluessel: 'ordner', titel: t('settings.esp32SpalteOrdner') },
])
const boardZeilen = computed(() => [
    { board: 'ESP32-2432S028', zusatz: 'Cheap Yellow Display', display: 'ILI9341 2.8"', touch: t('settings.esp32Resistiv') + ' (XPT2046)', mcu: 'ESP32', ordner: 'ESP32-2432S028/' },
    { board: 'Waveshare ESP32-S3', zusatz: 'Touch-LCD-2.8', display: 'ST7789T3 2.8"', touch: t('settings.esp32Kapazitiv') + ' (CST328)', mcu: 'ESP32-S3', ordner: 'ESP32-Waveshare/' },
])

/* Klartext-Key ist nur direkt nach dem Erzeugen sichtbar, sonst Punkte. */
const keySichtbar = computed(() => !!esp32ApiKeyDisplay.value && !esp32ApiKeyDisplay.value.startsWith('•'))

/*
 * Nur-Anzeige-Schlüssel (Audit SEC-GER-001): öffnet NUR /api/esp32/display.
 * ESP32-Displays bekommen ihn, die Handy-App den Hauptschlüssel (Alarme, Push).
 */
const anzeigeKeySet = ref(false)
const anzeigeKeyAnzeige = ref('')
const anzeigeLaedt = ref(false)
const anzeigeSichtbar = computed(() => !!anzeigeKeyAnzeige.value && !anzeigeKeyAnzeige.value.startsWith('•'))

async function erzeugeAnzeigeKey() {
    anzeigeLaedt.value = true
    esp32SaveResult.value = null
    try {
        const res = await axios.post('/api/esp32/settings', { regenerate: true, art: 'anzeige' })
        anzeigeKeyAnzeige.value = res.data.plainKey || ''
        anzeigeKeySet.value = true
        esp32SaveResult.value = { success: true, message: t('settings.esp32KeyNeuHinweis') }
        setTimeout(() => esp32SaveResult.value = null, 10000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    anzeigeLaedt.value = false
}

async function kopiereAnzeigeKey() {
    try {
        await navigator.clipboard.writeText(anzeigeKeyAnzeige.value)
        esp32SaveResult.value = { success: true, message: t('settings.esp32Kopiert') }
        setTimeout(() => esp32SaveResult.value = null, 3000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
}

async function loescheAnzeigeKey() {
    try {
        await axios.delete('/api/esp32/key', { params: { art: 'anzeige' } })
        anzeigeKeySet.value = false
        anzeigeKeyAnzeige.value = ''
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
}

async function loadEsp32Settings() {
    try {
        const res = await axios.get('/api/esp32/settings')
        esp32KeySet.value = res.data.esp32ApiKeySet || false
        anzeigeKeySet.value = res.data.esp32AnzeigeKeySet || false
        if (anzeigeKeySet.value && !anzeigeKeyAnzeige.value) anzeigeKeyAnzeige.value = '••••••••••••••••••••••••••••••••'
        if (esp32KeySet.value && !esp32ApiKeyDisplay.value) {
            esp32ApiKeyDisplay.value = '••••••••••••••••••••••••••••••••'
        }
    } catch (e) {
        console.error('ESP32 settings load error:', e)
    }
}

async function saveEsp32Filter() {
    try {
        await dbUpdateSettings({ esp32Filter: esp32Filter.value })
        esp32SaveResult.value = { success: true, message: t('settings.esp32FilterGespeichert') }
        setTimeout(() => esp32SaveResult.value = null, 5000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
}

async function generateEsp32Key() {
    esp32SaveLoading.value = true
    esp32SaveResult.value = null
    try {
        const res = await axios.post('/api/esp32/settings', { regenerate: true })
        esp32ApiKeyDisplay.value = res.data.plainKey || ''
        esp32KeySet.value = true
        esp32SaveResult.value = { success: true, message: t('settings.esp32KeyNeuHinweis') }
        setTimeout(() => esp32SaveResult.value = null, 10000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
    esp32SaveLoading.value = false
}

/* Im Template ist `navigator` kein erlaubtes Global — deshalb hier. */
async function kopiereKey() {
    try {
        await navigator.clipboard.writeText(esp32ApiKeyDisplay.value)
        esp32SaveResult.value = { success: true, message: t('settings.esp32Kopiert') }
        setTimeout(() => esp32SaveResult.value = null, 3000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
}

async function clearEsp32Key() {
    try {
        await axios.delete('/api/esp32/key')
        esp32KeySet.value = false
        esp32ApiKeyDisplay.value = ''
    } catch (e) {
        alert('Fehler: ' + e.message)
    }
}

/*
 * Push-Geräte (Audit SEC-SRV-003): wer sich mit dem ESP32-Schlüssel für die
 * Sofort-Zustellung eingetragen hat. Der Server liefert nur Name, Host und
 * Datum; ist die Liste voll, nimmt er kein neues Gerät mehr an — hier wird
 * Platz geschaffen.
 */
const pushGeraete = ref([])
const pushMax = ref(5)
const pushFehler = ref('')
const pushSpalten = computed(() => [
    { schluessel: 'geraet', titel: t('settings.esp32PushSpalteGeraet') },
    { schluessel: 'host', titel: t('settings.esp32PushSpalteHost') },
    { schluessel: 'seit', titel: t('settings.esp32PushSpalteSeit') },
    { schluessel: 'aktion', titel: '' },
])
const pushZeilen = computed(() => pushGeraete.value.map((g) => ({
    ...g,
    geraet: g.geraet || t('settings.esp32PushOhneName'),
    seit: g.seit ? dayjs(g.seit).format('DD.MM.YYYY HH:mm') : '—',
})))

async function ladePushGeraete() {
    pushFehler.value = ''
    try {
        const { data } = await axios.get('/api/esp32/geraete')
        pushGeraete.value = Array.isArray(data?.geraete) ? data.geraete : []
        pushMax.value = data?.max || 5
    } catch (e) {
        pushFehler.value = e.response?.data?.error || e.message
    }
}

async function entfernePushGeraet(zeile) {
    if (!confirm(t('settings.esp32PushEntfernenFrage', { name: zeile.geraet }))) return
    pushFehler.value = ''
    try {
        const { data } = await axios.delete('/api/esp32/geraete/' + encodeURIComponent(zeile.id))
        pushGeraete.value = Array.isArray(data?.geraete) ? data.geraete : []
    } catch (e) {
        pushFehler.value = e.response?.data?.error || e.message
    }
}

esp32Filter.value = appEinstellungen.value?.esp32Filter || 'month'
onMounted(() => { loadEsp32Settings(); ladePushGeraete() })
</script>

<template>
    <Abschnitt :titel="t('settings.esp32Titel')" symbol="bildschirm" v-model:offen="esp32Expanded">
        <template #kopf>
            <Pille v-if="esp32KeySet" ton="gut">{{ t('settings.esp32Aktiv') }}</Pille>
        </template>

        <p class="beschreibung">{{ t('settings.esp32Beschreibung') }}</p>

        <!-- Hardware-Übersicht -->
        <div class="kasten">
            <h4 class="kasten-titel">{{ t('settings.esp32Boards') }}</h4>
            <Tabelle :spalten="boardSpalten" :zeilen="boardZeilen" schluessel-feld="board" dicht>
                <template #zelle-board="{ zeile }">
                    <strong>{{ zeile.board }}</strong>
                    <span class="zusatz">{{ zeile.zusatz }}</span>
                </template>
                <template #zelle-ordner="{ wert }"><code>{{ wert }}</code></template>
            </Tabelle>
            <p class="leise">
                {{ t('settings.esp32Flash') }}
                <code>cd &lt;firmware-ordner&gt;</code> → <code>pio run -e esp32dev --target upload</code>
            </p>
            <div class="clients">
                <p class="clients-titel">{{ t('settings.esp32WeitereClients') }}</p>
                <ul>
                    <li><strong>Android-Widget</strong> — {{ t('settings.esp32AndroidWidget') }} (<code>android-widget/</code>)</li>
                    <li><strong>Linux-Desklet</strong> — {{ t('settings.esp32Desklet') }} (<code>desklet/</code>)</li>
                </ul>
            </div>
        </div>

        <!-- API-Info -->
        <dl class="kasten api-info">
            <dt>Endpoint</dt><dd><code>GET /api/esp32/display</code></dd>
            <dt>Header</dt><dd><code>X-ESP32-Key: &lt;key&gt;</code></dd>
            <dt>{{ t('settings.esp32LiefertTitel') }}</dt><dd>{{ t('settings.esp32Liefert') }}</dd>
        </dl>

        <Feld :label="t('settings.esp32HauptLabel')" fuer="esp32-key">
            <div class="reihe">
                <input id="esp32-key" type="text" class="eingabe mono"
                    :value="esp32ApiKeyDisplay"
                    readonly
                    :placeholder="esp32KeySet ? t('settings.esp32KeyGesetzt') : t('settings.esp32KeinKey')" />
                <Knopf v-if="keySichtbar" @click="kopiereKey">{{ t('settings.esp32Kopieren') }}</Knopf>
            </div>
        </Feld>

        <!-- Zeitraum-Filter -->
        <Feld :label="t('settings.esp32Zeitraum')" :hilfe="t('settings.esp32ZeitraumHilfe')" fuer="esp32-filter">
            <div class="reihe">
                <select id="esp32-filter" class="eingabe" v-model="esp32Filter">
                    <option value="month">{{ t('settings.esp32Monat') }}</option>
                    <option value="week">{{ t('settings.esp32Woche') }}</option>
                    <option value="year">{{ t('settings.esp32Jahr') }}</option>
                    <option value="all">{{ t('settings.esp32Gesamt') }}</option>
                </select>
                <Knopf @click="saveEsp32Filter">{{ t('common.save') }}</Knopf>
            </div>
        </Feld>

        <div class="aktionen">
            <Knopf art="haupt" :laedt="esp32SaveLoading" @click="generateEsp32Key">
                {{ esp32KeySet ? t('settings.esp32KeyNeu') : t('settings.esp32KeyErzeugen') }}
            </Knopf>
            <Knopf v-if="esp32KeySet" art="gefahr" @click="clearEsp32Key">{{ t('settings.esp32KeyLoeschen') }}</Knopf>
        </div>

        <!-- Nur-Anzeige-Schlüssel für ESP32-Displays (SEC-GER-001) -->
        <div class="kasten anzeige">
            <h4 class="kasten-titel">{{ t('settings.esp32Anzeige.titel') }}</h4>
            <p class="leise anzeige-text">{{ t('settings.esp32Anzeige.text') }}</p>
            <Feld :label="t('settings.esp32Anzeige.label')" fuer="esp32-anzeige-key">
                <div class="reihe">
                    <input id="esp32-anzeige-key" type="text" class="eingabe mono"
                        :value="anzeigeKeyAnzeige"
                        readonly
                        :placeholder="anzeigeKeySet ? t('settings.esp32KeyGesetzt') : t('settings.esp32KeinKey')" />
                    <Knopf v-if="anzeigeSichtbar" @click="kopiereAnzeigeKey">{{ t('settings.esp32Kopieren') }}</Knopf>
                </div>
            </Feld>
            <div class="aktionen">
                <Knopf :laedt="anzeigeLaedt" @click="erzeugeAnzeigeKey">
                    {{ anzeigeKeySet ? t('settings.esp32Anzeige.neu') : t('settings.esp32Anzeige.erzeugen') }}
                </Knopf>
                <Knopf v-if="anzeigeKeySet" art="gefahr" @click="loescheAnzeigeKey">{{ t('settings.esp32Anzeige.loeschen') }}</Knopf>
            </div>
        </div>

        <p v-if="esp32SaveResult" :class="['ergebnis', esp32SaveResult.success ? 'gut' : 'schlecht']" role="status">
            <Symbol :name="esp32SaveResult.success ? 'haken' : 'warnung'" :groesse="16" />
            {{ esp32SaveResult.message }}
        </p>

        <!-- Push-Geräte der Sofort-Zustellung (Android-Widget) -->
        <div class="kasten push">
            <h4 class="kasten-titel">{{ t('settings.esp32PushTitel', { anzahl: pushGeraete.length, max: pushMax }) }}</h4>
            <p class="leise push-text">{{ t('settings.esp32PushBeschreibung', { max: pushMax }) }}</p>
            <Tabelle :spalten="pushSpalten" :zeilen="pushZeilen" schluessel-feld="id" dicht :leer-text="t('settings.esp32PushLeer')">
                <template #zelle-host="{ wert }"><code>{{ wert || '—' }}</code></template>
                <template #zelle-aktion="{ zeile }">
                    <Knopf art="gefahr" klein @click="entfernePushGeraet(zeile)">{{ t('settings.esp32PushEntfernen') }}</Knopf>
                </template>
            </Tabelle>
            <p v-if="pushFehler" class="ergebnis schlecht" role="status">
                <Symbol name="warnung" :groesse="16" /> {{ pushFehler }}
            </p>
        </div>
    </Abschnitt>
</template>

<style scoped>
.beschreibung { color: var(--muted); margin: 0 0 var(--abstand-3); }
.kasten {
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
    margin: 0 0 var(--abstand-3);
    font-size: 0.85rem;
}
.kasten-titel {
    margin: 0 0 var(--abstand-2);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
}
.zusatz { display: block; color: var(--muted); font-size: 0.78rem; }
.leise { color: var(--muted); margin: var(--abstand-2) 0 0; overflow-wrap: anywhere; }
.clients {
    margin-top: var(--abstand-2);
    padding-top: var(--abstand-2);
    border-top: 1px solid var(--line);
}
.clients-titel { margin: 0 0 0.25rem; color: var(--text); }
.push { margin-top: var(--abstand-3); }
.anzeige { margin-top: var(--abstand-3); }
.anzeige-text { margin: 0 0 var(--abstand-2); }
.push-text { margin: 0 0 var(--abstand-2); }
.clients ul { margin: 0; padding-left: 1.1rem; color: var(--muted); }
.api-info {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.25rem var(--abstand-3);
}
.api-info dt { color: var(--muted); font-weight: 400; }
.api-info dd { margin: 0; overflow-wrap: anywhere; }
.reihe {
    display: flex;
    gap: var(--abstand-2);
    align-items: center;
}
.eingabe {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.mono { font-family: var(--schrift-mono); }
.aktionen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.ergebnis {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
}
.ergebnis.gut { color: var(--good); }
.ergebnis.schlecht { color: var(--bad); }
</style>
