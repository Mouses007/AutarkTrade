<script setup>
/**
 * Einstellungen › KI › Zugang › Spracheingabe: womit das Mikrofon in den
 * KI-Chats den Ton in Text verwandelt. Hintergrund in `server/sprache-kern.js`:
 * Brave, Chromium & Co. haben die Browser-Erkennung, aber keinen Zugang zum
 * Dienst dahinter — für sie nimmt der Browser selbst auf und der Server lässt
 * umschreiben. Gespeichert nur über `PUT /api/sprache/einstellungen` (die
 * Adresse ist ein Ziel, siehe `geheimnisse.js`).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import { appEinstellungen } from '@/stores/settings.js'

const { t, te } = useI18n()

const art = ref('browser')
const url = ref('')
const modell = ref('')
const openaiSchluessel = ref(false)
const vorgabe = ref({ openai: 'gpt-4o-mini-transcribe', eigen: 'whisper-1' })
const geladen = ref(false)
const speichert = ref(false)
const meldung = ref(null)    // {gut, text}

/** Erkennt die eingebaute Erkennung dieses Browsers vermutlich nicht? (Brave meldet sich als Chrome, hat aber navigator.brave) */
const browserOhneDienst = computed(() => {
    if (typeof window === 'undefined') return false
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return true
    return typeof navigator !== 'undefined' && !!navigator.brave
})

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/sprache/einstellungen')
        art.value = data.art || 'browser'
        url.value = data.url || ''
        modell.value = data.modell || ''
        openaiSchluessel.value = !!data.openaiSchluessel
        if (data.vorgabe) vorgabe.value = data.vorgabe
    } catch { /* bleibt bei der Voreinstellung */ }
    geladen.value = true
})

async function speichern() {
    speichert.value = true
    meldung.value = null
    try {
        const { data } = await axios.put('/api/sprache/einstellungen', { art: art.value, url: url.value, modell: modell.value })
        url.value = data.url || ''
        if (appEinstellungen.value) appEinstellungen.value = { ...appEinstellungen.value, spracheArt: data.art }
        meldung.value = { gut: true, text: t('settings.sprache.gespeichert') }
    } catch (e) {
        const code = e?.response?.data?.fehler
        const k = `settings.sprache.fehler.${code}`
        meldung.value = { gut: false, text: code && te(k) ? t(k) : (e?.response?.data?.grund || e?.response?.data?.error || e.message) }
    } finally {
        speichert.value = false
    }
}
</script>

<template>
    <Abschnitt kennung="sprache" :titel="t('settings.sprache.titel')" symbol="mikrofon">
        <p class="leise">{{ t('settings.sprache.einleitung') }}</p>
        <Hinweis v-if="geladen && art === 'browser' && browserOhneDienst" art="warn">{{ t('settings.sprache.browserOhneDienst') }}</Hinweis>

        <Feld :label="t('settings.sprache.art')" fuer="spracheArt">
            <select id="spracheArt" v-model="art">
                <option value="browser">{{ t('settings.sprache.artBrowser') }}</option>
                <option value="openai">{{ t('settings.sprache.artOpenai') }}</option>
                <option value="eigen">{{ t('settings.sprache.artEigen') }}</option>
            </select>
        </Feld>
        <p class="leise klein">{{ t(`settings.sprache.erklaerung.${art}`) }}</p>

        <Hinweis v-if="art === 'openai' && geladen && !openaiSchluessel" art="warn">{{ t('settings.sprache.keinSchluessel') }}</Hinweis>

        <Feld v-if="art === 'eigen'" :label="t('settings.sprache.url')" :hilfe="t('settings.sprache.urlHilfe')" fuer="spracheUrl">
            <input id="spracheUrl" v-model.trim="url" type="url" placeholder="http://192.168.1.10:8000/v1" />
        </Feld>
        <Feld v-if="art !== 'browser'" :label="t('settings.sprache.modell')" :hilfe="t('settings.sprache.modellHilfe', { vorgabe: vorgabe[art] })" fuer="spracheModell">
            <input id="spracheModell" v-model.trim="modell" type="text" :placeholder="vorgabe[art]" />
        </Feld>

        <div class="knoepfe">
            <Knopf :disabled="speichert || !geladen" @click="speichern">{{ t('settings.sprache.speichern') }}</Knopf>
            <span v-if="meldung" :class="meldung.gut ? 'gut' : 'schlecht'">{{ meldung.text }}</span>
        </div>
    </Abschnitt>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.klein { font-size: 0.85rem; margin: 0.25rem 0 0.75rem; }
.knoepfe { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.75rem; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
</style>
