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
import Symbol from '@/components/basis/Symbol.vue'
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
const rechte = ref(null)

const meldung = (e) => {
    const d = e?.response?.data
    return d?.code && te(`bots.st.fehler.${d.code}`) ? t(`bots.st.fehler.${d.code}`) + (d.error ? ` (${d.error})` : '') : (d?.error || e.message)
}
async function lauf(fn) {
    laedt.value = true; fehler.value = ''
    try { await fn(); emit('geaendert') } catch (e) { fehler.value = meldung(e) } finally { laedt.value = false }
}
const speichern = () => lauf(async () => {
    const { data } = await axios.put('/api/bots/steuerung/schluessel', { apiKey: apiKey.value, secretKey: secretKey.value })
    rechte.value = data
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
        <p class="leise">{{ t('bots.st.erklaerung') }}</p>
        <Hinweis v-if="steuerung.testbetrieb" art="info">{{ t('bots.st.testbetrieb') }}</Hinweis>

        <ol class="schritte">
            <!-- Schritt 1: Schlüssel -->
            <li class="schritt" :class="{ fertig: steuerung.schluessel }">
                <div class="kopf">
                    <span class="nr"><Symbol v-if="steuerung.schluessel" name="haken" /><template v-else>1</template></span>
                    <h4>{{ t('bots.st.schritt1') }}</h4>
                    <span v-if="steuerung.schluessel" class="stand">{{ steuerung.schluesselMaske }}</span>
                    <Knopf v-if="steuerung.schluessel" class="rechts" art="leise" symbol="muell" klein :laedt="laedt" @click="entfernen">{{ t('bots.st.entfernen') }}</Knopf>
                </div>
                <div v-if="!steuerung.schluessel" class="inhalt">
                    <p class="satz">{{ t('bots.st.schluesselTitel') }}</p>
                    <ul class="bedingungen">
                        <li><Symbol name="haken" /> {{ t('bots.st.schluesselP1') }}</li>
                        <li><Symbol name="haken" /> {{ t('bots.st.schluesselP2') }}</li>
                        <li><Symbol name="haken" /> {{ t('bots.st.schluesselP3') }}</li>
                    </ul>
                    <div class="felder">
                        <label><span>API-Key</span><input v-model="apiKey" class="at-feld" type="password" autocomplete="off" spellcheck="false"></label>
                        <label><span>Secret</span><input v-model="secretKey" class="at-feld" type="password" autocomplete="off" spellcheck="false"></label>
                    </div>
                    <p class="leise">{{ t('bots.st.schluesselHinweis') }}</p>
                    <div class="knoepfe"><Knopf art="haupt" symbol="speichern" :laedt="laedt" :disabled="!apiKey || !secretKey" @click="speichern">{{ t('bots.st.speichern') }}</Knopf></div>
                </div>
            </li>

            <!-- Schritt 2: Einwilligung -->
            <li class="schritt" :class="{ fertig: steuerung.freigeschaltet }">
                <div class="kopf">
                    <span class="nr"><Symbol v-if="steuerung.freigeschaltet" name="haken" /><template v-else>2</template></span>
                    <h4>{{ t('bots.st.schritt2') }}</h4>
                    <span v-if="steuerung.freigeschaltet" class="stand">{{ t('bots.st.frei', { zeit: datum(steuerung.zustimmung?.zeit) }) }}</span>
                    <span v-else-if="!steuerung.schluessel" class="stand">{{ t('bots.st.zuerstSchluessel') }}</span>
                    <div v-if="steuerung.freigeschaltet" class="rechts knoepfe">
                        <Knopf art="leise" klein @click="zeigeText = !zeigeText">{{ zeigeText ? t('bots.st.textVerbergen') : t('bots.st.textZeigen') }}</Knopf>
                        <Knopf art="leise" symbol="schloss" klein :laedt="laedt" @click="sperren">{{ t('bots.st.sperren') }}</Knopf>
                    </div>
                </div>
                <div v-if="(!steuerung.freigeschaltet && steuerung.schluessel) || zeigeText" class="inhalt">
                    <template v-if="steuerung.teile">
                        <p class="satz">{{ steuerung.teile.einleitung }}</p>
                        <ul class="punkte">
                            <li v-for="p in steuerung.teile.punkte" :key="p.titel">
                                <span class="sym"><Symbol :name="p.symbol" :groesse="18" /></span>
                                <div><strong>{{ p.titel }}</strong><span>{{ p.text }}</span></div>
                            </li>
                        </ul>
                    </template>
                    <pre v-else class="text">{{ steuerung.text }}</pre>
                    <template v-if="!steuerung.freigeschaltet">
                        <label class="haken">
                            <input v-model="gelesen" type="checkbox">
                            <span>{{ t('bots.st.gelesen', { fassung: steuerung.fassung }) }}</span>
                        </label>
                        <div class="knoepfe"><Knopf art="haupt" symbol="schlossOffen" :laedt="laedt" :disabled="!gelesen" @click="freischalten">{{ t('bots.st.freischalten') }}</Knopf></div>
                    </template>
                </div>
            </li>
        </ol>

        <Hinweis v-if="rechte?.rechte === 'ok'" art="gut">{{ t('bots.st.rechteOk') }}</Hinweis>
        <Hinweis v-else-if="rechte?.rechte === 'fehlt'" art="fehler">{{ t('bots.st.rechteFehlt') }} {{ rechte.rechteText }}</Hinweis>
        <Hinweis v-else-if="rechte" art="info">{{ t('bots.st.rechteUnbekannt') }} {{ rechte.rechteText }}</Hinweis>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
    </div>
</template>

<style scoped>
.einr { display: flex; flex-direction: column; gap: var(--abstand-3); }
.leise { color: var(--muted); font-size: 0.85rem; line-height: 1.5; margin: 0; }
.satz { margin: 0; font-size: 0.9rem; line-height: 1.5; }
.schritte { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--abstand-2); }
.schritt { border: 1px solid var(--line); border-radius: var(--radius); padding: var(--abstand-3); display: flex; flex-direction: column; gap: var(--abstand-3); }
.kopf { display: flex; align-items: center; gap: var(--abstand-2); flex-wrap: wrap; }
.kopf h4 { margin: 0; font-size: 0.95rem; }
.nr { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 600; background: var(--panel-soft); color: var(--muted); flex: none; }
.fertig .nr { background: var(--good-flaeche); color: var(--good); }
.stand { color: var(--muted); font-size: 0.82rem; }
.rechts { margin-left: auto; }
.inhalt { display: flex; flex-direction: column; gap: var(--abstand-3); padding-left: calc(1.6rem + var(--abstand-2)); }
.bedingungen { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; }
.bedingungen li { display: flex; align-items: center; gap: var(--abstand-2); }
.bedingungen :deep(svg) { color: var(--good); flex: none; }
.punkte { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--abstand-2); }
.punkte li { display: flex; gap: var(--abstand-3); align-items: flex-start; background: var(--panel-soft); border-radius: var(--radius-klein); padding: var(--abstand-2) var(--abstand-3); }
.punkte .sym { color: var(--accent); padding-top: 2px; flex: none; }
.punkte li div { display: flex; flex-direction: column; gap: 2px; font-size: 0.88rem; line-height: 1.45; }
.punkte strong { font-size: 0.9rem; }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--abstand-2) var(--abstand-3); }
.felder label { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; flex-wrap: wrap; }
.text { white-space: pre-wrap; font-family: var(--schrift); font-size: 0.85rem; line-height: 1.5; background: var(--panel-soft); border-radius: var(--radius-klein); padding: var(--abstand-3); margin: 0; }
.haken { display: flex; gap: var(--abstand-2); align-items: center; font-size: 0.9rem; cursor: pointer; font-weight: 500; }
@media (max-width: 560px) { .inhalt { padding-left: 0; } }
</style>
