<script setup>
/**
 * Live → Marktradar: serverseitig gerechnete Kachelwerte, Börsen-Links,
 * Wirtschaftskalender und CryptoQuant-Schlüssel der ETF-Kachel.
 */
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import InfoTipp from '@/components/InfoTipp.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import {
    radarRsiSymbols, boersenLinks, radarKalenderLaender, radarKalenderImpact, useRadarEinstellungen,
} from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

let radarExpanded = ref(false)
let radarHolt = ref(false)

const BOERSEN = [
    { key: 'bitunix', label: 'Bitunix' },
    { key: 'bitget', label: 'Bitget' },
    { key: 'pionex', label: 'Pionex' },
    { key: 'tradingview', label: 'TradingView' },
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
            ? 'Zuletzt vor Kurzem geholt — häufiger als alle paar Minuten fragt der Feed nicht.'
            : `${data.gesehen} Termine gesehen, ${data.neu} neu.`
        await kalenderStandLaden()
    } catch (e) {
        kalenderMeldung.value = e.response?.data?.error || e.message
    } finally {
        radarHolt.value = false
    }
}

// Erst beim Aufklappen fragen — der Abschnitt steht zwar im DOM (v-show), aber
// wer die Marktradar-Einstellungen nie öffnet, braucht den Abruf auch nicht.
watch(radarExpanded, offen => {
    if (offen && !kalenderStand.value) kalenderStandLaden()
})

/* CRYPTOQUANT — Schlüssel für die ETF-Kachel.

   Eigener Endpunkt statt `radarSpeichern`: Zugangsdaten gehen nie über die
   allgemeine Einstellungs-Route, die gibt sie weder heraus noch schreibt sie.
   Angezeigt wird deshalb nur, OB einer hinterlegt ist — der Wert selbst kommt
   nicht zurück. */
let cqKey = ref('')
let cqStatus = ref(null)
let cqMeldung = ref(null)
let cqLaeuft = ref(false)

async function cqLaden() {
    try {
        const { data } = await axios.get('/api/cryptoquant/status')
        cqStatus.value = data
        // Platzhalter statt Klartext: der Server gibt den Schlüssel nicht her
        cqKey.value = data.schluesselGesetzt ? '••••••••••••••••' : ''
    } catch (e) {
        cqStatus.value = null
    }
}

async function cqSpeichern() {
    cqLaeuft.value = true
    cqMeldung.value = null
    try {
        await axios.post('/api/cryptoquant/settings', { cryptoquantApiKey: cqKey.value })
        cqMeldung.value = { ok: true, text: t('common.saved') }
        await cqLaden()
    } catch (e) {
        cqMeldung.value = { ok: false, text: e.response?.data?.error || e.message }
    } finally {
        cqLaeuft.value = false
    }
}

/** Ein einziger Abruf mit limit=1 — der billigste Weg, den Schlüssel zu prüfen. */
async function cqPruefen() {
    cqLaeuft.value = true
    cqMeldung.value = null
    try {
        const { data } = await axios.post('/api/cryptoquant/test', { cryptoquantApiKey: cqKey.value })
        cqMeldung.value = {
            ok: true,
            text: `Schlüssel gültig — ${Number(data.bestand).toLocaleString('de-CH')} BTC in allen Fonds `
                + `(${dayjs(data.tag).format('DD.MM.YYYY')}).`,
        }
    } catch (e) {
        cqMeldung.value = { ok: false, text: e.response?.data?.error || e.message }
    } finally {
        cqLaeuft.value = false
    }
}

/**
 * Von Hand nachführen.
 *
 * Der Knopf STARTET nur; gearbeitet wird auf dem Server weiter, auch wenn man
 * die Seite verlässt. Auf die Antwort zu warten war der erste Entwurf und ein
 * Fehler: sieben Fonds mit sieben Sekunden Abstand dauern knapp eine Minute,
 * und was in dieser Minute zwischen Browser und Server passiert — ein
 * Serverneustart, ein Gegenstück mit kurzem Zeitlimit — landet als „Network
 * Error" beim Nutzer, obwohl der Lauf sauber durchläuft. Also fragen wir den
 * Fortschritt ab, statt die Verbindung offen zu halten.
 */
async function cqHolen() {
    cqLaeuft.value = true
    cqMeldung.value = null
    try {
        const { data } = await axios.post('/api/cryptoquant/aktualisieren')
        if (data.uebersprungen) {
            cqMeldung.value = { ok: false, text: `Übersprungen: ${data.uebersprungen}` }
            cqLaeuft.value = false
            return
        }
        await cqVerfolgen()
    } catch (e) {
        cqMeldung.value = { ok: false, text: e.response?.data?.error || e.message }
        cqLaeuft.value = false
    }
}

/** Fortschritt abfragen, bis der Lauf steht. Abbruch nach drei Minuten. */
async function cqVerfolgen() {
    const ende = Date.now() + 3 * 60 * 1000
    while (Date.now() < ende) {
        await new Promise(r => setTimeout(r, 2500))
        await cqLaden()
        if (!cqStatus.value?.laeuft) {
            cqMeldung.value = cqStatus.value?.fehler
                ? { ok: false, text: cqStatus.value.fehler.text }
                : { ok: true, text: `Fertig — ${cqStatus.value?.tage || 0} Tage eingelagert.` }
            cqLaeuft.value = false
            return
        }
    }
    // Kein Fehler, nur keine Geduld mehr: der Lauf arbeitet weiter
    cqMeldung.value = { ok: true, text: 'Läuft weiter im Hintergrund — Seite später neu laden.' }
    cqLaeuft.value = false
}

// Nur der Zustand (Schlüssel gesetzt? wie viele Tage eingelagert?) — der
// Schlüssel selbst kommt nie zurück
onMounted(cqLaden)
</script>

<template>
    <Abschnitt titel="Marktradar · Kacheln" symbol="raster" v-model:offen="radarExpanded">
        <p class="einleitung">Betrifft die Kacheln auf der Seite „Marktradar". Was sichtbar ist, wie gross und in welcher Reihenfolge, stellst du direkt dort ein — das bleibt je Gerät gespeichert.</p>

        <Feld label="RSI-Symbole">
            <template #label>
                <p class="hilfe">
                    Leer lassen: die Kachel nimmt die umsatzstärksten Märkte oder deine eigenen Trades.
                    Eine Liste hier (z.B. <code>BTCUSDT, ETHUSDT</code>) sticht beides.
                </p>
            </template>
            <input type="text" class="eingabe" v-model="radarRsiSymbols"
                placeholder="BTCUSDT, ETHUSDT, SOLUSDT" @change="radarSpeichern('radarRsiSymbols')" />
        </Feld>

        <Feld hilfe="Welche Handelsseiten neben einem Coin angezeigt werden — in Coin-Radar, Hype-Radar und den Marktradar-Kacheln RSI/Marktübersicht.">
            <template #label><span class="beschriftung">Börsen-Verlinkung<InfoTipp schluessel="settings.info.boersenLinks" /></span></template>
            <div class="haken-liste">
                <label v-for="b in BOERSEN" :key="b.key" class="haken">
                    <input type="checkbox" :value="b.key" v-model="boersenLinks"
                        @change="radarSpeichern('boersenLinks')">
                    <span>{{ b.label }}</span>
                </label>
            </div>
        </Feld>

        <!-- Pi-Cycle- und Funding-Divergenz-Alarm stehen jetzt unter
             Einstellungen → Benachrichtigungen, zusammen mit allen
             übrigen Meldungen und der Wahl zwischen Browser und E-Mail. -->

        <Feld label="Kalender · Länder">
            <template #label>
                <p class="hilfe">Währungskürzel des Wirtschaftskalenders, z.B. <code>USD, JPY, EUR</code>.</p>
            </template>
            <input type="text" class="eingabe" v-model="radarKalenderLaender"
                placeholder="USD, JPY" @change="radarSpeichern('radarKalenderLaender')" />
        </Feld>

        <Feld label="Kalender · ab welcher Wirkung" hilfe='„Mittel" schliesst hohe Wirkung mit ein — es ist eine Untergrenze.'>
            <select class="eingabe" v-model="radarKalenderImpact" @change="radarSpeichern('radarKalenderImpact')">
                <option value="all">Alle Termine</option>
                <option value="medium">Mittel und hoch</option>
                <option value="high">Nur hohe Wirkung</option>
            </select>
        </Feld>

        <!-- Kein „jetzt holen" als Hauptsache: der Kalender wird ohnehin
             regelmässig nachgeführt. Die Zeile sagt, ob das geklappt hat;
             der Knopf ist der Ausweg, wenn nicht. -->
        <div class="kalender-stand">
            <div class="zeile">
                <span v-if="kalenderStand">
                    Zuletzt geholt:
                    {{ kalenderStand.letzterAbruf ? dayjs(kalenderStand.letzterAbruf).format('DD.MM. HH:mm') : 'noch nie' }}
                    · {{ kalenderStand.gesamt }} Termine im Bestand (−3 bis +14 Tage)
                </span>
                <span v-else>Stand wird geladen …</span>
                <Knopf klein symbol="aktualisieren" :laedt="radarHolt" @click="kalenderHolen">Erneut holen</Knopf>
            </div>
            <div v-if="kalenderStand && kalenderStand.letzterFehler" class="warnung">
                Letzter Fehler: {{ kalenderStand.letzterFehler }}
            </div>
            <div v-if="kalenderMeldung">{{ kalenderMeldung }}</div>
        </div>

        <!--=============== ETF-KACHEL (CRYPTOQUANT) ===============-->
        <h4 class="unterkopf">ETF-Fluss · CryptoQuant-Schlüssel</h4>
        <p class="einleitung">
            Für die Kachel „ETF-Fluss": wie viele Bitcoin die Spot-ETFs halten und wie sich das
            täglich ändert. Den <strong>Gratis-Tarif</strong> („Basic") reicht dafür — die Fondsdaten
            zählen bei CryptoQuant als Marktdaten und sind auf jedem Tarif offen. Schlüssel holen
            unter <code>cryptoquant.com/settings/api</code>.
        </p>
        <p class="einleitung klein">
            Der Gratis-Tarif gibt nur <strong>30 Tage</strong> Rückblick her und erlaubt 10 Anfragen je
            Minute. Geholt wird deshalb im Hintergrund, höchstens alle sechs Stunden, und alles
            Geholte bleibt hier gespeichert — die Kurve wächst mit der Zeit über die 30 Tage hinaus.
            Die Kachel selbst fragt nie bei CryptoQuant nach, sie liest nur den eigenen Bestand.
        </p>

        <Feld label="API-Schlüssel" hilfe="Verschlüsselt gespeichert. Angezeigt wird nur, ob einer hinterlegt ist.">
            <input type="password" class="eingabe" v-model="cqKey"
                placeholder="CryptoQuant API Key" autocomplete="off" />
        </Feld>

        <div class="knopfzeile">
            <Knopf art="haupt" klein :laedt="cqLaeuft" @click="cqSpeichern">Speichern</Knopf>
            <Knopf klein :disabled="cqLaeuft" @click="cqPruefen">Schlüssel prüfen</Knopf>
            <Knopf klein :laedt="!!cqStatus?.laeuft" :disabled="cqLaeuft || !cqStatus?.schluesselGesetzt"
                @click="cqHolen">
                <template v-if="cqStatus?.fortschritt">
                    {{ cqStatus.fortschritt.fertig }} von {{ cqStatus.fortschritt.gesamt }} Fonds
                </template>
                <template v-else>Jetzt nachführen</template>
            </Knopf>
            <span v-if="cqMeldung" :class="['meldung', cqMeldung.ok ? 'gut' : 'schlecht']">
                {{ cqMeldung.text }}
            </span>
        </div>

        <p v-if="cqStatus" class="einleitung klein stand">
            <template v-if="cqStatus.tage">
                {{ cqStatus.tage }} Tage eingelagert, letzter Stand
                {{ cqStatus.letzterTag ? dayjs(cqStatus.letzterTag).format('DD.MM.YYYY') : '—' }}.
            </template>
            <template v-else-if="cqStatus.schluesselGesetzt">
                Noch nichts eingelagert — der erste Lauf holt 30 Tage.
            </template>
            <template v-else>Kein Schlüssel hinterlegt, die Kachel bleibt leer.</template>
            <span v-if="cqStatus.fehler" class="schlecht">
                Letzter Fehler ({{ cqStatus.fehler.fonds }}): {{ cqStatus.fehler.text }}
            </span>
        </p>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.einleitung.klein { font-size: 0.82rem; }
.beschriftung { color: var(--text); }
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
.unterkopf {
    margin: var(--abstand-5) 0 var(--abstand-2);
    padding-top: var(--abstand-4);
    border-top: 1px solid var(--line);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
}
.knopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}
.meldung { font-size: 0.85rem; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.stand { margin: var(--abstand-2) 0 0; }
.stand .schlecht { margin-left: var(--abstand-1); }
</style>
