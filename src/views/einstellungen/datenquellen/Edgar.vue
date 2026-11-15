<script setup>
/**
 * Datenquellen › SEC EDGAR: die Kontaktangabe, mit der sich die App bei der
 * US-Börsenaufsicht ausweist (`server/aktien/edgar.js`).
 *
 * Kein Schlüssel, sondern Name und Mailadresse des Nutzers — er trägt sie
 * selbst ein, und sie steht offen im Feld: er soll sehen, was hinausgeht.
 * Ohne Eintrag bleibt EDGAR aus, es gibt keinen Rückfall auf einen
 * erfundenen Absender. Eigene Route statt der allgemeinen Einstellungs-Route,
 * weil der Server die Form prüft (Kopfzeile: kein Zeilenumbruch, eine Adresse).
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Knopf, Hinweis, Pille } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'

const { t, te } = useI18n()

const kontakt = ref('')
const stand = ref(null)
const meldung = ref(null)   // { art, text }
const laeuft = ref(false)

async function lade() {
    try {
        const { data } = await axios.get('/api/quellen')
        stand.value = data.edgar || null
        kontakt.value = data.edgar?.kontakt || ''
    } catch (_) { stand.value = null }
}
onMounted(lade)

const grundText = (grund, fehler) => (grund && te(`edgar.einstellung.grund_${grund}`) ? t(`edgar.einstellung.grund_${grund}`) : (fehler || grund || ''))

async function speichern(loeschen = false) {
    laeuft.value = true
    meldung.value = null
    try {
        const { data } = await axios.put('/api/quellen/edgar', { kontakt: loeschen ? '' : kontakt.value })
        stand.value = data
        kontakt.value = data.kontakt || ''
        meldung.value = { art: 'gut', text: t(data.hinterlegt ? 'edgar.einstellung.gespeichert' : 'edgar.einstellung.geloescht') }
    } catch (e) {
        meldung.value = { art: 'fehler', text: grundText(e?.response?.data?.grund, e?.response?.data?.error || e.message) }
    } finally {
        laeuft.value = false
    }
}

/** Ein einziger Abruf der Ticker-Liste mit der GESPEICHERTEN Angabe. */
async function testen() {
    laeuft.value = true
    meldung.value = null
    try {
        const { data } = await axios.post('/api/quellen/edgar/test', {}, { timeout: 40000 })
        meldung.value = data.ok
            ? { art: 'gut', text: t('edgar.einstellung.testOk', { n: data.titel }) }
            : { art: 'fehler', text: grundText(data.grund, data.fehler) }
    } catch (e) {
        meldung.value = { art: 'fehler', text: e.message }
    } finally {
        laeuft.value = false
    }
}
</script>

<template>
    <Abschnitt kennung="edgar" :titel="t('edgar.einstellung.titel')" symbol="gebaeude">
        <p class="leise unter">{{ t('edgar.einstellung.unter') }}</p>
        <p class="status">
            <Pille v-if="stand?.hinterlegt" ton="gut">{{ t('edgar.einstellung.an') }}</Pille>
            <Pille v-else ton="neutral">{{ t('edgar.einstellung.aus') }}</Pille>
        </p>
        <label class="feld">
            <span class="at-label">{{ t('edgar.einstellung.feld') }}</span>
            <input v-model="kontakt" class="at-feld" type="text" autocomplete="off" spellcheck="false" maxlength="120"
                :placeholder="t('edgar.einstellung.platzhalter')" @keyup.enter="speichern(false)">
        </label>
        <p v-if="stand?.userAgent && stand.userAgent !== stand.kontakt" class="leise">
            {{ t('edgar.einstellung.gesendetAls', { ua: stand.userAgent }) }}
        </p>
        <div class="knoepfe">
            <Knopf art="haupt" :laedt="laeuft" @click="speichern(false)">{{ t('edgar.einstellung.speichern') }}</Knopf>
            <Knopf v-if="stand?.hinterlegt" :disabled="laeuft" @click="testen">{{ t('edgar.einstellung.testen') }}</Knopf>
            <Knopf v-if="stand?.hinterlegt" art="gefahr" :disabled="laeuft" @click="speichern(true)">{{ t('edgar.einstellung.loeschen') }}</Knopf>
            <a class="extern" href="https://www.sec.gov/os/accessing-edgar-data" target="_blank" rel="noopener noreferrer">
                {{ t('edgar.einstellung.regeln') }}
            </a>
        </div>
        <Hinweis v-if="meldung" :art="meldung.art">{{ meldung.text }}</Hinweis>
        <p class="leise">{{ t('edgar.einstellung.wofuer') }}</p>
    </Abschnitt>
</template>

<style scoped>
.unter { margin: 0 0 0.6rem; }
.leise {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0.4rem 0 0;
    line-height: 1.45;
}
.status { margin: 0 0 0.3rem; }
.feld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 34rem;
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
</style>
