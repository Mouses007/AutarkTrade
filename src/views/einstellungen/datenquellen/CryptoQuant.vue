<script setup>
/**
 * Datenquellen › CryptoQuant: Schlüssel der ETF-Kachel (vorher unter
 * Analyse › Marktradar).
 *
 * Eigener Endpunkt statt der allgemeinen Einstellungs-Route: Zugangsdaten
 * gehen nie über `/api/db/settings`, die gibt sie weder heraus noch schreibt
 * sie. Angezeigt wird deshalb nur, OB einer hinterlegt ist — der Wert selbst
 * kommt nicht zurück.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { Knopf, Hinweis, Pille } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'

const { t } = useI18n()

const cqKey = ref('')
const cqStatus = ref(null)
const cqMeldung = ref(null)   // { ok, text }
const cqLaeuft = ref(false)

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
            text: t('datenquellen.cq.gueltig', {
                btc: Number(data.bestand).toLocaleString('de-CH'),
                tag: dayjs(data.tag).format('DD.MM.YYYY'),
            }),
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
 * die Seite verlässt. Sieben Fonds mit sieben Sekunden Abstand dauern knapp
 * eine Minute, und was in dieser Minute zwischen Browser und Server passiert,
 * landete als „Network Error" beim Nutzer, obwohl der Lauf sauber durchlief.
 * Also wird der Fortschritt abgefragt, statt die Verbindung offen zu halten.
 */
async function cqHolen() {
    cqLaeuft.value = true
    cqMeldung.value = null
    try {
        const { data } = await axios.post('/api/cryptoquant/aktualisieren')
        if (data.uebersprungen) {
            cqMeldung.value = { ok: false, text: t('datenquellen.cq.uebersprungen', { grund: data.uebersprungen }) }
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
                : { ok: true, text: t('datenquellen.cq.fertig', { tage: cqStatus.value?.tage || 0 }) }
            cqLaeuft.value = false
            return
        }
    }
    // Kein Fehler, nur keine Geduld mehr: der Lauf arbeitet weiter
    cqMeldung.value = { ok: true, text: t('datenquellen.cq.laeuftWeiter') }
    cqLaeuft.value = false
}

// Nur der Zustand (Schlüssel gesetzt? wie viele Tage eingelagert?) — der
// Schlüssel selbst kommt nie zurück
onMounted(cqLaden)
</script>

<template>
    <!-- Sprungziel der ETF-Kachel (`?abschnitt=cryptoquant`) -->
    <Abschnitt kennung="cryptoquant" :titel="t('datenquellen.cq.titel')" symbol="balken">
        <p class="leise unter">{{ t('datenquellen.cq.unter') }}</p>
        <p class="status">
            <Pille v-if="cqStatus?.schluesselGesetzt" ton="gut">{{ t('datenquellen.cq.hinterlegt') }}</Pille>
            <Pille v-else ton="neutral">{{ t('datenquellen.cq.keiner') }}</Pille>
        </p>
        <p class="leise">{{ t('datenquellen.cq.tarif') }}</p>

        <label class="feld">
            <span class="at-label">{{ t('datenquellen.cq.schluessel') }}</span>
            <input v-model="cqKey" class="at-feld" type="password" autocomplete="off"
                placeholder="CryptoQuant API Key">
        </label>

        <div class="knoepfe">
            <Knopf art="haupt" :laedt="cqLaeuft" @click="cqSpeichern">{{ t('datenquellen.cq.speichern') }}</Knopf>
            <Knopf :disabled="cqLaeuft" @click="cqPruefen">{{ t('datenquellen.cq.pruefen') }}</Knopf>
            <Knopf :laedt="!!cqStatus?.laeuft" :disabled="cqLaeuft || !cqStatus?.schluesselGesetzt" @click="cqHolen">
                <template v-if="cqStatus?.fortschritt">
                    {{ t('datenquellen.cq.fortschritt', { fertig: cqStatus.fortschritt.fertig, gesamt: cqStatus.fortschritt.gesamt }) }}
                </template>
                <template v-else>{{ t('datenquellen.cq.nachfuehren') }}</template>
            </Knopf>
            <a class="extern" href="https://cryptoquant.com/settings/api" target="_blank" rel="noopener noreferrer">
                {{ t('datenquellen.cq.holen') }}
            </a>
        </div>
        <Hinweis v-if="cqMeldung" :art="cqMeldung.ok ? 'gut' : 'fehler'">{{ cqMeldung.text }}</Hinweis>

        <p v-if="cqStatus" class="leise">
            <template v-if="cqStatus.tage">
                {{ t('datenquellen.cq.bestand', {
                    tage: cqStatus.tage,
                    tag: cqStatus.letzterTag ? dayjs(cqStatus.letzterTag).format('DD.MM.YYYY') : '—',
                }) }}
            </template>
            <template v-else-if="cqStatus.schluesselGesetzt">{{ t('datenquellen.cq.nochNichts') }}</template>
            <template v-else>{{ t('datenquellen.cq.ohneSchluessel') }}</template>
            <span v-if="cqStatus.fehler" class="schlecht">
                {{ t('datenquellen.cq.letzterFehler', { fonds: cqStatus.fehler.fonds, text: cqStatus.fehler.text }) }}
            </span>
        </p>
    </Abschnitt>
</template>

<style scoped>
.status { margin: 0 0 0.3rem; }
.unter { margin: 0 0 0.6rem; }
.leise {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0.4rem 0 0;
    line-height: 1.45;
}
.feld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.7rem;
}
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.75rem 0 0.5rem;
}
.extern {
    color: var(--accent);
    font-size: 0.85rem;
    text-decoration: none;
}
.extern:hover { text-decoration: underline; }
.schlecht { color: var(--bad); margin-left: var(--abstand-1); }
</style>
