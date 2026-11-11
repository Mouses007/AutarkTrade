<script setup>
/**
 * Einrichtung der Bot-Steuerung (Bot-Seite, Übersicht): zweiter Pionex-Schlüssel
 * mit „Bot Trading" und die eigene Einwilligung (Fassung + Hash, nie
 * vorausgefüllt). Ohne beides gibt es keine Aktionen. Server: steuerung-routen.js.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Pille from '@/components/basis/Pille.vue'
import { datum } from './format.js'

const props = defineProps({ steuerung: { type: Object, default: null } })
const emit = defineEmits(['geaendert'])
const { t, te } = useI18n()

const apiKey = ref('')
const secretKey = ref('')
const gelesen = ref(false)
const laedt = ref(false)
const fehler = ref('')
const zeigeText = ref(false)

const meldung = (e) => {
    const d = e?.response?.data
    return d?.code && te(`bots.st.fehler.${d.code}`) ? t(`bots.st.fehler.${d.code}`) + (d.error ? ` (${d.error})` : '') : (d?.error || e.message)
}
async function lauf(fn) {
    laedt.value = true; fehler.value = ''
    try { await fn(); emit('geaendert') } catch (e) { fehler.value = meldung(e) } finally { laedt.value = false }
}
const speichern = () => lauf(async () => {
    await axios.put('/api/bots/steuerung/schluessel', { apiKey: apiKey.value, secretKey: secretKey.value })
    apiKey.value = ''; secretKey.value = ''
})
const entfernen = () => lauf(() => axios.delete('/api/bots/steuerung/schluessel'))
const freischalten = () => lauf(async () => {
    await axios.post('/api/bots/steuerung/freischalten', { fassung: props.steuerung.fassung, hash: props.steuerung.hash, bestaetigt: gelesen.value === true })
    gelesen.value = false
})
const sperren = () => lauf(() => axios.post('/api/bots/steuerung/sperren', {}))
</script>

<template>
    <div v-if="steuerung" class="einr">
        <div class="status">
            <Pille :ton="steuerung.schluessel ? 'gut' : 'neutral'" symbol="schluessel">{{ steuerung.schluessel ? t('bots.st.schluesselDa', { maske: steuerung.schluesselMaske }) : t('bots.st.keinSchluessel') }}</Pille>
            <Pille :ton="steuerung.freigeschaltet ? 'gut' : 'neutral'" :symbol="steuerung.freigeschaltet ? 'schlossOffen' : 'schloss'">
                {{ steuerung.freigeschaltet ? t('bots.st.frei', { zeit: datum(steuerung.zustimmung?.zeit), fassung: steuerung.fassung }) : t('bots.st.gesperrt') }}
            </Pille>
        </div>
        <Hinweis v-if="steuerung.testbetrieb" art="info">{{ t('bots.st.testbetrieb') }}</Hinweis>
        <p class="leise">{{ t('bots.st.erklaerung') }}</p>

        <section v-if="!steuerung.schluessel" class="block">
            <h4>{{ t('bots.st.schluesselTitel') }}</h4>
            <p class="leise">{{ t('bots.st.schluesselHinweis') }}</p>
            <div class="felder">
                <label><span>API-Key</span><input v-model="apiKey" class="at-feld" type="password" autocomplete="off" spellcheck="false"></label>
                <label><span>Secret</span><input v-model="secretKey" class="at-feld" type="password" autocomplete="off" spellcheck="false"></label>
            </div>
            <div class="knoepfe"><Knopf art="haupt" symbol="speichern" :laedt="laedt" :disabled="!apiKey || !secretKey" @click="speichern">{{ t('bots.st.speichern') }}</Knopf></div>
        </section>
        <div v-else class="knoepfe"><Knopf art="leise" symbol="muell" klein :laedt="laedt" @click="entfernen">{{ t('bots.st.entfernen') }}</Knopf></div>

        <section v-if="!steuerung.freigeschaltet" class="block">
            <h4>{{ t('bots.st.einwilligungTitel') }}</h4>
            <pre class="text">{{ steuerung.text }}</pre>
            <label class="haken">
                <input v-model="gelesen" type="checkbox">
                <span>{{ t('bots.st.gelesen', { fassung: steuerung.fassung }) }}</span>
            </label>
            <div class="knoepfe"><Knopf art="haupt" symbol="schlossOffen" :laedt="laedt" :disabled="!gelesen" @click="freischalten">{{ t('bots.st.freischalten') }}</Knopf></div>
        </section>
        <div v-else class="knoepfe">
            <Knopf art="leise" klein @click="zeigeText = !zeigeText">{{ t('bots.st.textZeigen') }}</Knopf>
            <Knopf art="leise" symbol="schloss" klein :laedt="laedt" @click="sperren">{{ t('bots.st.sperren') }}</Knopf>
        </div>
        <pre v-if="zeigeText && steuerung.freigeschaltet" class="text">{{ steuerung.text }}</pre>

        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
    </div>
</template>

<style scoped>
.einr { display: flex; flex-direction: column; gap: var(--abstand-3); }
.status { display: flex; gap: var(--abstand-2); flex-wrap: wrap; }
.leise { color: var(--muted); font-size: 0.85rem; margin: 0; }
.block { display: flex; flex-direction: column; gap: var(--abstand-2); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--abstand-3); }
.block h4 { margin: 0; font-size: 0.95rem; }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--abstand-2) var(--abstand-3); }
.felder label { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; flex-wrap: wrap; }
.text { white-space: pre-wrap; font-family: var(--schrift); font-size: 0.85rem; line-height: 1.5; background: var(--panel-soft); border-radius: var(--radius-klein); padding: var(--abstand-3); margin: 0; max-height: 22rem; overflow: auto; }
.haken { display: flex; gap: var(--abstand-2); align-items: flex-start; font-size: 0.9rem; cursor: pointer; }
.haken input { margin-top: 3px; }
</style>
