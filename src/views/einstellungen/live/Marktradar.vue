<script setup>
/**
 * Chart & Analyse → Marktradar · Kacheln: serverseitig gerechnete Kachelwerte,
 * Wirtschaftskalender und die Börsen-Verlinkung (Coin-Radar, Hype-Radar,
 * Marktradar — vorher unter Allgemein › Bedienung). Die Grenzlinie des
 * Momentum Radars steht im Abschnitt „Chart" (sie gilt für Chart, Kachel und
 * Alarme), der CryptoQuant-Schlüssel der ETF-Kachel unter Datenquellen.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import Knopf from '@/components/basis/Knopf.vue'
import InfoTipp from '@/components/InfoTipp.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import {
    boersenLinks, radarRsiSymbols, radarKalenderLaender, radarKalenderImpact, useRadarEinstellungen,
} from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

let radarExpanded = ref(false)
let radarHolt = ref(false)

/* Börsen, deren Handelsseite neben einem Coin verlinkt wird */
const BOERSEN = [
    { key: 'bitunix', label: 'Bitunix' },
    { key: 'bitget', label: 'Bitget' },
    { key: 'pionex', label: 'Pionex' },
    { key: 'tradingview', label: 'Chart (AutarkTrade)' },   // Schlüssel historisch, führt in den eigenen Chart
]

/* Stand des Kalenderabrufs. Der Abruf laeuft von selbst (Serverstart, danach
   alle zwei Stunden, gedrosselt auf hoechstens alle sechs) — hier steht
   deshalb, WANN er zuletzt lief, nicht ein Knopf, der so tut, als muesste man
   ihn druecken. Die Laender- und Wirkungsfelder darueber sind reine
   Anzeigefilter und haben mit dem Abruf nichts zu tun. */
let kalenderStand = ref(null)
let kalenderMeldung = ref('')

/* Nur lesen: der GET erzeugt keinen Abruf, er zeigt den Bestand der eigenen
   Datenbank und den Zeitpunkt des letzten Feed-Laufs. */
async function kalenderStandLaden() {
    try {
        const { data } = await axios.get('/api/marktradar/kalender')
        kalenderStand.value = {
            letzterAbruf: data.letzterAbruf || null,
            letzterFehler: data.letzterFehler || '',
            gesamt: Number(data.gesamtImZeitraum) || 0,
        }
    } catch (e) {
        kalenderStand.value = null
        kalenderMeldung.value = e.response?.data?.error || e.message
    }
}

async function kalenderHolen() {
    radarHolt.value = true
    kalenderMeldung.value = ''
    try {
        const { data } = await axios.post('/api/marktradar/kalender/holen')
        kalenderMeldung.value = data.uebersprungen
            // Der Feed ist gedrosselt — ein „zu früh" ist kein Fehler
            ? t('settings.live.radar.kalenderZuFrueh')
            : t('settings.live.radar.kalenderGeholt', { gesehen: data.gesehen, neu: data.neu })
        await kalenderStandLaden()
    } catch (e) {
        kalenderMeldung.value = e.response?.data?.error || e.message
    } finally {
        radarHolt.value = false
    }
}

// Erst beim Aufklappen fragen — wer die Marktradar-Einstellungen nie öffnet,
// braucht den Abruf auch nicht.
watch(radarExpanded, offen => {
    if (offen && !kalenderStand.value) kalenderStandLaden()
})
</script>

<template>
    <Abschnitt :titel="t('settings.live.radar.titel')" symbol="raster" v-model:offen="radarExpanded">
        <p class="einleitung">{{ t('settings.live.radar.einleitung') }}</p>

        <Feld :label="t('settings.live.radar.rsiSymbole')">
            <template #label>
                <p class="hilfe">{{ t('settings.live.radar.rsiHilfe') }}</p>
            </template>
            <input type="text" class="eingabe" v-model="radarRsiSymbols"
                placeholder="BTCUSDT, ETHUSDT, SOLUSDT" @change="radarSpeichern('radarRsiSymbols')" />
        </Feld>

        <!-- Börsen-Verlinkung (Coin-Radar, Hype-Radar, Marktradar-Kacheln) -->
        <Feld :hilfe="t('settings.boersenLinksHint')">
            <template #label><span class="beschriftung">{{ t('settings.boersenLinks') }}<InfoTipp schluessel="settings.info.boersenLinks" /></span></template>
            <div class="haken-liste">
                <label v-for="b in BOERSEN" :key="b.key" class="haken">
                    <input type="checkbox" :value="b.key" v-model="boersenLinks"
                        @change="radarSpeichern('boersenLinks')">
                    <span>{{ b.label }}</span>
                </label>
            </div>
        </Feld>

        <!-- Pi-Cycle- und Funding-Divergenz-Alarm stehen unter
             Einstellungen → Benachrichtigungen, zusammen mit allen
             übrigen Meldungen und der Wahl zwischen Browser und E-Mail. -->

        <Feld :label="t('settings.live.radar.kalenderLaender')">
            <template #label>
                <p class="hilfe">{{ t('settings.live.radar.kalenderLaenderHilfe') }}</p>
            </template>
            <input type="text" class="eingabe" v-model="radarKalenderLaender"
                placeholder="USD, JPY" @change="radarSpeichern('radarKalenderLaender')" />
        </Feld>

        <Feld :label="t('settings.live.radar.kalenderWirkung')" :hilfe="t('settings.live.radar.kalenderWirkungHilfe')">
            <select class="eingabe" v-model="radarKalenderImpact" @change="radarSpeichern('radarKalenderImpact')">
                <option value="all">{{ t('settings.live.radar.wirkungAlle') }}</option>
                <option value="medium">{{ t('settings.live.radar.wirkungMittel') }}</option>
                <option value="high">{{ t('settings.live.radar.wirkungHoch') }}</option>
            </select>
        </Feld>

        <!-- Kein „jetzt holen" als Hauptsache: der Kalender wird ohnehin
             regelmässig nachgeführt. Die Zeile sagt, ob das geklappt hat;
             der Knopf ist der Ausweg, wenn nicht. -->
        <div class="kalender-stand">
            <div class="zeile">
                <span v-if="kalenderStand">
                    {{ t('settings.live.radar.kalenderStand', {
                        wann: kalenderStand.letzterAbruf ? dayjs(kalenderStand.letzterAbruf).format('DD.MM. HH:mm') : t('settings.live.radar.nochNie'),
                        n: kalenderStand.gesamt,
                    }) }}
                </span>
                <span v-else>{{ t('settings.live.radar.standLaedt') }}</span>
                <Knopf klein symbol="aktualisieren" :laedt="radarHolt" @click="kalenderHolen">{{ t('settings.live.radar.erneutHolen') }}</Knopf>
            </div>
            <div v-if="kalenderStand && kalenderStand.letzterFehler" class="warnung">
                {{ t('settings.live.radar.letzterFehler', { fehler: kalenderStand.letzterFehler }) }}
            </div>
            <div v-if="kalenderMeldung">{{ kalenderMeldung }}</div>
        </div>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.beschriftung { color: var(--text); }
.haken-liste {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2) var(--abstand-4);
}
.haken {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-1);
    margin: 0;
    cursor: pointer;
}
.haken input { accent-color: var(--accent); }
.hilfe {
    margin: 0.15rem 0 0;
    color: var(--muted);
    font-size: 0.82rem;
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
.kalender-stand {
    margin-top: var(--abstand-3);
    color: var(--muted);
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: var(--abstand-1);
}
.kalender-stand .zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}
.warnung { color: var(--warn); }
</style>
