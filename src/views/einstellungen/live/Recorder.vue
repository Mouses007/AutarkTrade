<script setup>
/** Live → Live-Recorder: serverseitige Aufzeichnung von Orderbuch, Liquidationen, Trades. */
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { fmtBytes } from '../gemeinsam/format.js'

/* LIVE-RECORDER — serverseitige Aufzeichnung, deshalb eigene Felder mit
   explizitem Speichern (der Server übernimmt sie erst beim Neuabgleich). */
let recExpanded = ref(false)
let recEnabled = ref(false)
let recSymbols = ref('')
let recDays = ref(14)
let recFrameMs = ref(1000)
let recRows = ref(200)
let recRangePct = ref(1)
let recAllLiq = ref(false)
let recSaving = ref(false)
let recResult = ref(null)
let recStatus = ref(null)

function loadRecorderSettings() {
    const s = currentUser.value || {}
    recEnabled.value = !!Number(s.liveRecordEnabled)
    recSymbols.value = s.liveRecordSymbols || ''
    recDays.value = Number(s.liveRecordDays) || 14
    recFrameMs.value = Number(s.liveRecordFrameMs) || 1000
    recRows.value = Number(s.liveRecordRows) || 200
    recRangePct.value = Number(s.liveRecordRangePct) || 1
    recAllLiq.value = !!Number(s.liveRecordAllLiq)
}

async function loadRecorderStatus() {
    try {
        const { data } = await axios.get('/api/live/recorder/status')
        recStatus.value = data
    } catch (e) {
        recStatus.value = null
    }
}

async function saveRecorderSettings() {
    recSaving.value = true
    recResult.value = null
    try {
        await dbUpdateSettings({
            liveRecordEnabled: recEnabled.value ? 1 : 0,
            liveRecordSymbols: recSymbols.value.toUpperCase().replace(/\s+/g, ''),
            liveRecordDays: recDays.value,
            liveRecordFrameMs: recFrameMs.value,
            liveRecordRows: recRows.value,
            liveRecordRangePct: recRangePct.value,
            liveRecordAllLiq: recAllLiq.value ? 1 : 0,
        })
        const { data } = await axios.post('/api/live/recorder/reload')
        await loadRecorderStatus()
        recResult.value = { success: true, message: `Gespeichert — ${data.laufend} Symbol(e) werden aufgezeichnet.` }
    } catch (e) {
        recResult.value = { success: false, message: e.response?.data?.error || e.message }
    } finally {
        recSaving.value = false
        setTimeout(() => recResult.value = null, 6000)
    }
}

const recBytesGesamt = computed(() =>
    (recStatus.value?.gespeichert || []).reduce((sum, r) => sum + (r.bytes || 0), 0))

loadRecorderSettings()
onMounted(loadRecorderStatus)
</script>

<template>
    <div>
        <hr />

        <!--=============== LIVE-RECORDER ===============-->
        <div class="d-flex align-items-center pointerClass" @click="recExpanded = !recExpanded">
            <i class="uil me-2" :class="recExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">Live-Aufzeichnung · Orderbuch mitschneiden</p>
            <span v-if="recStatus?.laufend?.length" class="badge bg-success ms-2">
                {{ recStatus.laufend.length }} aktiv
            </span>
        </div>
        <div v-show="recExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">Der Server schneidet das Orderbuch der gewählten Symbole dauerhaft mit, damit du die Heatmap später zu einem abgeschlossenen Trade nochmal ansehen kannst. Läuft unabhängig vom Browser.</p>

            <div class="mb-3 p-2" style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                <div class="fw-semibold mb-1" style="color: var(--white-75);">Bevor du es einschaltest</div>
                <ul class="mb-0 ps-3">
                    <li><b>Rückwirkend geht nichts.</b> Nur Symbole auf dieser Liste werden aufgezeichnet — für einen Trade in einem anderen Symbol gibt es keine Historie.</li>
                    <li>Ein Container-Neustart (z.B. beim Update) reisst ein Loch in die Aufzeichnung.</li>
                    <li>Platzbedarf: rund <b>7 MB pro Symbol und Tag</b> in der Datenbank.</li>
                    <li>Aufgezeichnet wird immer <b>USDⓈ-M Futures</b>, unabhängig davon, welchen Markt du oben zum Anschauen gewählt hast.</li>
                </ul>
            </div>

            <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="recEnabledChk" v-model="recEnabled" />
                <label class="form-check-label" for="recEnabledChk">Aufzeichnung aktiv</label>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Symbole
                    <small class="d-block text-muted" style="font-size:0.78rem;">Kommagetrennt, max. 10</small>
                </div>
                <div class="col-12 col-md-8">
                    <input class="form-control" type="text" v-model="recSymbols" placeholder="BTCUSDT,SOLUSDT" />
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">Aufbewahrung</div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model.number="recDays">
                        <option :value="3">3 Tage</option>
                        <option :value="7">7 Tage</option>
                        <option :value="14">14 Tage</option>
                        <option :value="30">30 Tage</option>
                        <option :value="90">90 Tage</option>
                    </select>
                </div>
            </div>

            <div class="row align-items-center mt-2">
                <div class="col-12 col-md-4">
                    Auflösung
                    <small class="d-block text-muted" style="font-size:0.78rem;">Feiner = mehr Speicher</small>
                </div>
                <div class="col-12 col-md-8">
                    <div class="input-group">
                        <select class="form-select" v-model.number="recFrameMs">
                            <option :value="500">500 ms / Spalte</option>
                            <option :value="1000">1 s / Spalte</option>
                            <option :value="2000">2 s / Spalte</option>
                        </select>
                        <select class="form-select" v-model.number="recRows">
                            <option :value="120">120 Zeilen</option>
                            <option :value="200">200 Zeilen</option>
                            <option :value="400">400 Zeilen</option>
                        </select>
                        <select class="form-select" v-model.number="recRangePct">
                            <option :value="0.5">± 0.5 %</option>
                            <option :value="1">± 1 %</option>
                            <option :value="2">± 2 %</option>
                        </select>
                    </div>
                </div>
            </div>

            <hr class="my-3" style="border-color: var(--black-bg-3, #1a1a2e);" />

            <p class="fw-bold mb-1">Zwangsliquidationen sammeln</p>
            <p class="fw-lighter mb-2" style="font-size: 0.88rem;">
                Schneidet über <b>eine einzige Verbindung</b> die Zwangsliquidationen der
                <b>Top-Symbole</b> mit (BTC, ETH, SOL, XRP, BNB) — unabhängig von der
                Symbolliste oben und unabhängig davon, ob die Orderbuch-Aufzeichnung läuft.
                Binance gibt Liquidationen nicht rückwirkend heraus: was nicht mitgeschrieben
                wird, ist endgültig weg. Sie dienen als Vergleichsmaterial, um berechnete
                Liquidationszonen gegen die Wirklichkeit prüfen zu können.
            </p>
            <p class="fw-lighter mb-2" style="font-size: 0.88rem;">
                Der Speicherbedarf ist winzig (wenige Byte je Ereignis). Weil die Daten so
                klein und nicht nachbestellbar sind, werden sie <b>ein Jahr</b> aufbewahrt
                statt nur den oben eingestellten Zeitraum.
            </p>

            <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="recAllLiqChk" v-model="recAllLiq" />
                <label class="form-check-label" for="recAllLiqChk">Liquidationen der Top-Symbole mitschneiden</label>
            </div>

            <div v-if="recStatus?.sammelstrom" class="mb-2 p-2"
                 style="background: var(--black-bg-3, #1a1a2e); border-radius: var(--border-radius, 6px); font-size: 0.85rem;">
                <span :class="recStatus.sammelstrom.verbunden ? 'text-success' : 'text-danger'">
                    {{ recStatus.sammelstrom.verbunden ? 'verbunden' : 'getrennt' }}
                </span>
                · {{ recStatus.sammelstrom.ereignisse }} Ereignisse seit Serverstart
                <span v-if="recStatus.sammelstrom.letztes" class="text-muted">
                    · zuletzt {{ new Date(recStatus.sammelstrom.letztes).toLocaleTimeString() }}
                </span>
            </div>

            <div class="mt-3 d-flex gap-2 align-items-center">
                <button class="btn btn-primary" @click="saveRecorderSettings" :disabled="recSaving">
                    <span v-if="recSaving" class="spinner-border spinner-border-sm me-1"></span>
                    Speichern &amp; übernehmen
                </button>
                <button class="btn btn-outline-secondary" @click="loadRecorderStatus">Status aktualisieren</button>
                <span v-if="recResult" :class="recResult.success ? 'text-success' : 'text-danger'">
                    {{ recResult.message }}
                </span>
            </div>

            <div v-if="recStatus" class="mt-3">
                <table class="table table-dark table-sm" style="font-size:0.82rem;">
                    <thead>
                        <tr><th>Symbol</th><th>Verbindung</th><th>Aufgezeichnet</th><th>Speicher</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in recStatus.gespeichert" :key="r.symbol + r.market">
                            <td>{{ r.symbol }}</td>
                            <td>
                                <span v-if="recStatus.laufend.some(l => l.symbol === r.symbol)" class="text-success">läuft</span>
                                <span v-else class="text-muted">gestoppt</span>
                            </td>
                            <td>{{ r.stunden }} Stunde(n)</td>
                            <td>{{ fmtBytes(r.bytes) }}</td>
                        </tr>
                        <tr v-for="l in recStatus.laufend.filter(l => !recStatus.gespeichert.some(g => g.symbol === l.symbol))" :key="'l' + l.symbol">
                            <td>{{ l.symbol }}</td>
                            <td><span :class="l.synchron ? 'text-success' : 'text-warning'">{{ l.synchron ? 'läuft' : 'synchronisiert…' }}</span></td>
                            <td>läuft an</td>
                            <td>—</td>
                        </tr>
                        <tr v-if="!recStatus.gespeichert.length && !recStatus.laufend.length">
                            <td colspan="4" class="text-muted">Noch nichts aufgezeichnet</td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="recBytesGesamt" class="text-muted" style="font-size:0.8rem;">
                    Gesamt in der Datenbank: {{ fmtBytes(recBytesGesamt) }}
                </div>
            </div>
        </div>

    </div>
</template>
