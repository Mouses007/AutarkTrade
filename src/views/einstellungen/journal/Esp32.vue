<script setup>
/** Journal → ESP32-Display: API-Schlüssel und Zeitraum-Filter der Anzeige. */
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'

/* ESP32 DISPLAY SETTINGS */
let esp32Expanded = ref(false)
let esp32KeySet = ref(false)
let esp32ApiKeyDisplay = ref('')
let esp32SaveLoading = ref(false)
let esp32SaveResult = ref(null)
let esp32Filter = ref('month')

async function loadEsp32Settings() {
    try {
        const res = await axios.get('/api/esp32/settings')
        esp32KeySet.value = res.data.esp32ApiKeySet || false
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
        esp32SaveResult.value = { success: true, message: 'Filter gespeichert — Anzeigen übernehmen beim nächsten Abruf.' }
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
        esp32SaveResult.value = { success: true, message: 'Neuer Key generiert — einmalig sichtbar. Jetzt kopieren!' }
        setTimeout(() => esp32SaveResult.value = null, 10000)
    } catch (e) {
        esp32SaveResult.value = { success: false, message: e.message }
    }
    esp32SaveLoading.value = false
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

esp32Filter.value = currentUser.value?.esp32Filter || 'month'
onMounted(loadEsp32Settings)
</script>

<template>
    <div>
        <hr />

        <!--=============== ESP32 DISPLAY ===============-->
        <div class="d-flex align-items-center pointerClass" @click="esp32Expanded = !esp32Expanded">
            <i class="uil me-2" :class="esp32Expanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">Externe Anzeigen · ESP32 / Widget / Desklet</p>
            <span v-if="esp32KeySet" class="badge bg-success ms-2">aktiv</span>
        </div>
        <div v-show="esp32Expanded" class="mt-2 ms-3">
            <p class="fw-lighter">Zeige deine Trading-Daten auf externen Anzeigen: ESP32-TFT-Displays, dem Android-Homescreen-Widget und dem Linux-Desklet. Alle nutzen denselben read-only Endpoint mit dem API-Key unten — sie funktionieren auch bei aktivem Passwortschutz.</p>

            <!-- Hardware-Übersicht -->
            <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                <div class="fw-semibold mb-2" style="color: var(--white-75);">ESP32-Boards (Firmware im Repo)</div>
                <table class="table table-dark table-sm mb-0" style="font-size:0.8rem;">
                    <thead>
                        <tr>
                            <th>Board</th>
                            <th>Display</th>
                            <th>Touch</th>
                            <th>MCU</th>
                            <th>Firmware-Ordner</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>ESP32-2432S028</strong><br><small class="text-muted">Cheap Yellow Display</small></td>
                            <td>ILI9341 2.8"</td>
                            <td>Resistiv (XPT2046)</td>
                            <td>ESP32</td>
                            <td><code>ESP32-2432S028/</code></td>
                        </tr>
                        <tr>
                            <td><strong>Waveshare ESP32-S3</strong><br><small class="text-muted">Touch-LCD-2.8</small></td>
                            <td>ST7789T3 2.8"</td>
                            <td>Kapazitiv (CST328)</td>
                            <td>ESP32-S3</td>
                            <td><code>ESP32-Waveshare/</code></td>
                        </tr>
                    </tbody>
                </table>
                <div class="mt-2" style="color: var(--white-50);">
                    Flash-Anleitung: <code>cd &lt;firmware-ordner&gt;</code> → <code>pio run -e esp32dev --target upload</code>
                </div>
                <div class="mt-2 pt-2" style="color: var(--white-75); border-top: 1px solid var(--black-bg-1, #2a2a3e);">
                    Weitere Clients (gleicher Key):
                    <span class="d-block mt-1" style="color: var(--white-50);">
                        · <strong>Android-Widget</strong> — Homescreen-Widget (<code>android-widget/</code>)<br>
                        · <strong>Linux-Desklet</strong> — Cinnamon-Desklet (<code>desklet/</code>)
                    </span>
                </div>
            </div>

            <!-- API-Info -->
            <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                <div><span style="color: var(--white-50);">Endpoint:</span> <code>GET /api/esp32/display</code></div>
                <div><span style="color: var(--white-50);">Header:</span> <code>X-ESP32-Key: &lt;key&gt;</code></div>
                <div class="mt-1" style="color: var(--white-50);">Liefert: heutiger PnL, Gesamt-PnL, Win-Rate, offene Positionen, laufende Bots</div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">API-Key</div>
                <div class="col-12 col-md-8">
                    <div class="input-group">
                        <input type="text" class="form-control font-monospace"
                            :value="esp32ApiKeyDisplay"
                            readonly
                            :placeholder="esp32KeySet ? '(gesetzt — neu generieren zum Anzeigen)' : '(kein Key gesetzt)'" />
                        <button v-if="esp32ApiKeyDisplay && !esp32ApiKeyDisplay.startsWith('•')"
                            class="btn btn-outline-secondary" type="button"
                            @click="navigator.clipboard.writeText(esp32ApiKeyDisplay)"
                            title="Kopieren">
                            <i class="uil uil-copy"></i>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Zeitraum-Filter -->
            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Zeitraum
                    <small class="d-block text-muted" style="font-size:0.78rem;">Anzeigen übernehmen automatisch</small>
                </div>
                <div class="col-12 col-md-8">
                    <div class="input-group">
                        <select class="form-select" v-model="esp32Filter">
                            <option value="month">Aktueller Monat</option>
                            <option value="week">Aktuelle Woche</option>
                            <option value="year">Aktuelles Jahr</option>
                            <option value="all">Gesamtzeitraum</option>
                        </select>
                        <button class="btn btn-outline-primary" type="button" @click="saveEsp32Filter">
                            Speichern
                        </button>
                    </div>
                </div>
            </div>

            <div class="mt-3 d-flex gap-2">
                <button class="btn btn-primary" @click="generateEsp32Key" :disabled="esp32SaveLoading">
                    <span v-if="esp32SaveLoading" class="spinner-border spinner-border-sm me-1"></span>
                    {{ esp32KeySet ? 'Key neu generieren' : 'Key generieren' }}
                </button>
                <button v-if="esp32KeySet" class="btn btn-outline-danger" @click="clearEsp32Key">
                    Key löschen
                </button>
            </div>

            <div v-if="esp32SaveResult" class="mt-2">
                <small :class="esp32SaveResult.success ? 'text-success' : 'text-danger'">
                    <i class="uil me-1" :class="esp32SaveResult.success ? 'uil-check' : 'uil-exclamation-triangle'"></i>
                    {{ esp32SaveResult.message }}
                </small>
            </div>
        </div>

    </div>
</template>
