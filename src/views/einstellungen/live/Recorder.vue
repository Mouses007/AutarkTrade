<script setup>
/** Live → Live-Recorder: serverseitige Aufzeichnung von Orderbuch, Liquidationen, Trades. */
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { fmtBytes } from '../gemeinsam/format.js'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Tabelle from '@/components/basis/Tabelle.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'

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

const REC_SPALTEN = [
    { schluessel: 'symbol', titel: 'Symbol' },
    { schluessel: 'verbindung', titel: 'Verbindung' },
    { schluessel: 'aufgezeichnet', titel: 'Aufgezeichnet' },
    { schluessel: 'speicher', titel: 'Speicher', zahl: true },
]

/* Gespeicherte Symbole zuerst, dann die, die gerade erst anlaufen und noch
   nichts in der Datenbank haben. `zustand`: laeuft | gestoppt | synchron. */
const recZeilen = computed(() => {
    const s = recStatus.value
    if (!s) return []
    const gespeichert = s.gespeichert || []
    const laufend = s.laufend || []
    return [
        ...gespeichert.map(r => ({
            schluessel: r.symbol + r.market,
            symbol: r.symbol,
            verbindung: laufend.some(l => l.symbol === r.symbol) ? 'laeuft' : 'gestoppt',
            aufgezeichnet: `${r.stunden} Stunde(n)`,
            speicher: fmtBytes(r.bytes),
        })),
        ...laufend.filter(l => !gespeichert.some(g => g.symbol === l.symbol)).map(l => ({
            schluessel: 'l' + l.symbol,
            symbol: l.symbol,
            verbindung: l.synchron ? 'laeuft' : 'synchron',
            aufgezeichnet: 'läuft an',
            speicher: '—',
        })),
    ]
})
const VERBINDUNG_TEXT = { laeuft: 'läuft', gestoppt: 'gestoppt', synchron: 'synchronisiert…' }

loadRecorderSettings()
onMounted(loadRecorderStatus)
</script>

<template>
    <Abschnitt titel="Live-Aufzeichnung · Orderbuch mitschneiden" symbol="verlauf" v-model:offen="recExpanded">
        <template #kopf>
            <Pille v-if="recStatus?.laufend?.length" ton="gut">{{ recStatus.laufend.length }} aktiv</Pille>
        </template>

        <p class="einleitung">Der Server schneidet das Orderbuch der gewählten Symbole dauerhaft mit, damit du die Heatmap später zu einem abgeschlossenen Trade nochmal ansehen kannst. Läuft unabhängig vom Browser.</p>

        <Hinweis titel="Bevor du es einschaltest" class="vorab">
            <ul class="liste">
                <li><b>Rückwirkend geht nichts.</b> Nur Symbole auf dieser Liste werden aufgezeichnet — für einen Trade in einem anderen Symbol gibt es keine Historie.</li>
                <li>Ein Container-Neustart (z.B. beim Update) reisst ein Loch in die Aufzeichnung.</li>
                <li>Platzbedarf: rund <b>7 MB pro Symbol und Tag</b> in der Datenbank.</li>
                <li>Aufgezeichnet wird immer <b>USDⓈ-M Futures</b>, unabhängig davon, welchen Markt du oben zum Anschauen gewählt hast.</li>
            </ul>
        </Hinweis>

        <Schalter v-model="recEnabled" label="Aufzeichnung aktiv" />

        <Feld label="Symbole" hilfe="Kommagetrennt, max. 10">
            <input class="eingabe" type="text" v-model="recSymbols" placeholder="BTCUSDT,SOLUSDT" />
        </Feld>

        <Feld label="Aufbewahrung">
            <select class="eingabe" v-model.number="recDays">
                <option :value="3">3 Tage</option>
                <option :value="7">7 Tage</option>
                <option :value="14">14 Tage</option>
                <option :value="30">30 Tage</option>
                <option :value="90">90 Tage</option>
            </select>
        </Feld>

        <Feld label="Auflösung" hilfe="Feiner = mehr Speicher">
            <div class="gruppe">
                <select class="eingabe" v-model.number="recFrameMs">
                    <option :value="500">500 ms / Spalte</option>
                    <option :value="1000">1 s / Spalte</option>
                    <option :value="2000">2 s / Spalte</option>
                </select>
                <select class="eingabe" v-model.number="recRows">
                    <option :value="120">120 Zeilen</option>
                    <option :value="200">200 Zeilen</option>
                    <option :value="400">400 Zeilen</option>
                </select>
                <select class="eingabe" v-model.number="recRangePct">
                    <option :value="0.5">± 0.5 %</option>
                    <option :value="1">± 1 %</option>
                    <option :value="2">± 2 %</option>
                </select>
            </div>
        </Feld>

        <h4 class="unterkopf">Zwangsliquidationen sammeln</h4>
        <p class="einleitung klein">
            Schneidet über <b>eine einzige Verbindung</b> die Zwangsliquidationen der
            <b>Top-Symbole</b> mit (BTC, ETH, SOL, XRP, BNB) — unabhängig von der
            Symbolliste oben und unabhängig davon, ob die Orderbuch-Aufzeichnung läuft.
            Binance gibt Liquidationen nicht rückwirkend heraus: was nicht mitgeschrieben
            wird, ist endgültig weg. Sie dienen als Vergleichsmaterial, um berechnete
            Liquidationszonen gegen die Wirklichkeit prüfen zu können.
        </p>
        <p class="einleitung klein">
            Der Speicherbedarf ist winzig (wenige Byte je Ereignis). Weil die Daten so
            klein und nicht nachbestellbar sind, werden sie <b>ein Jahr</b> aufbewahrt
            statt nur den oben eingestellten Zeitraum.
        </p>

        <Schalter v-model="recAllLiq" label="Liquidationen der Top-Symbole mitschneiden" />

        <div v-if="recStatus?.sammelstrom" class="statusfeld">
            <span :class="recStatus.sammelstrom.verbunden ? 'gut' : 'schlecht'">
                {{ recStatus.sammelstrom.verbunden ? 'verbunden' : 'getrennt' }}
            </span>
            · {{ recStatus.sammelstrom.ereignisse }} Ereignisse seit Serverstart
            <span v-if="recStatus.sammelstrom.letztes" class="gedaempft">
                · zuletzt {{ new Date(recStatus.sammelstrom.letztes).toLocaleTimeString() }}
            </span>
        </div>

        <div class="knopfzeile">
            <Knopf art="haupt" :laedt="recSaving" @click="saveRecorderSettings">Speichern &amp; übernehmen</Knopf>
            <Knopf symbol="aktualisieren" @click="loadRecorderStatus">Status aktualisieren</Knopf>
            <span v-if="recResult" :class="recResult.success ? 'gut' : 'schlecht'">
                {{ recResult.message }}
            </span>
        </div>

        <div v-if="recStatus" class="stand">
            <Tabelle :spalten="REC_SPALTEN" :zeilen="recZeilen" schluessel-feld="schluessel" dicht
                leer-text="Noch nichts aufgezeichnet">
                <template #zelle-verbindung="{ wert }">
                    <span :class="{ gut: wert === 'laeuft', gedaempft: wert === 'gestoppt', warn: wert === 'synchron' }">
                        {{ VERBINDUNG_TEXT[wert] }}
                    </span>
                </template>
            </Tabelle>
            <div v-if="recBytesGesamt" class="gesamt">
                Gesamt in der Datenbank: {{ fmtBytes(recBytesGesamt) }}
            </div>
        </div>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.einleitung.klein { font-size: 0.88rem; }
.vorab {
    margin-bottom: var(--abstand-3);
    font-size: 0.85rem;
}
.liste {
    margin: var(--abstand-1) 0 0;
    padding-left: var(--abstand-4);
}
.eingabe {
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.gruppe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
.gruppe .eingabe { flex: 1 1 8rem; width: auto; }
.unterkopf {
    margin: var(--abstand-4) 0 var(--abstand-2);
    padding-top: var(--abstand-4);
    border-top: 1px solid var(--line);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
}
.statusfeld {
    margin: var(--abstand-2) 0;
    padding: var(--abstand-2) var(--abstand-3);
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    font-size: 0.85rem;
}
.knopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.stand { margin-top: var(--abstand-3); }
.gesamt {
    margin-top: var(--abstand-2);
    color: var(--muted);
    font-size: 0.8rem;
}
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.warn { color: var(--warn); }
.gedaempft { color: var(--muted); }
</style>
