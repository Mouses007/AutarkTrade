<script setup>
/**
 * Bitpanda in den API-Einstellungen (Spot-Portfolio).
 *
 * Ein Schlüssel, Kopfzeile `X-Api-Key`. Bitpanda vergibt Scopes; der
 * Portfolio-Abruf braucht nur „Read". Beim Speichern prüft der Server den
 * Schlüssel gegen `/v1/portfolio` — ein falscher wird gar nicht erst abgelegt.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Abschnitt from '@/views/einstellungen/gemeinsam/Abschnitt.vue'
import { Knopf, Pille, Eingabe, Hinweis } from '../basis/index.js'
import MarktWahl from './MarktWahl.vue'
import { setzeBoersenMarkt } from '../../stores/portfolio.js'

const { t } = useI18n()
const offen = ref(false)
const hat = ref(false)
const wert = ref('')
const fehler = ref('')
const speichert = ref(false)

async function lade() {
    try { hat.value = !!(await axios.get('/api/portfolio/schluessel')).data.schluessel.bitpanda } catch { hat.value = false }
}
async function speichere() {
    fehler.value = ''
    speichert.value = true
    try {
        await axios.post('/api/portfolio/schluessel', { name: 'bitpanda', wert: wert.value })
        wert.value = ''
        // Ohne Spot hätte ein Bitpanda-Schlüssel keinen Zweck.
        await setzeBoersenMarkt('bitpanda', 'spot', true)
        await lade()
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally { speichert.value = false }
}
async function entferne() {
    await axios.delete('/api/portfolio/schluessel/bitpanda')
    await lade()
}
onMounted(lade)
</script>

<template>
    <Abschnitt titel="Bitpanda" unter v-model:offen="offen">
        <template #kopf>
            <Pille v-if="hat" ton="gut">{{ t('common.configured') }}</Pille>
            <Pille ton="warn">Test</Pille>
        </template>
        <MarktWahl boerse="bitpanda" />
        <p class="bp-text">{{ t('portfolio.bitpandaText') }}</p>
        <div v-if="!hat" class="bp-zeile">
            <Eingabe v-model="wert" art="password" :label="t('settings.apiKeyLabel')" :platzhalter="t('settings.apiKeyPlaceholder')" />
            <Knopf art="haupt" :laedt="speichert" :disabled="!wert" @click="speichere">{{ t('common.save') }}</Knopf>
        </div>
        <Knopf v-else art="leise" symbol="muell" @click="entferne">{{ t('portfolio.schluesselEntfernen') }}</Knopf>
        <Hinweis v-if="fehler" art="fehler" class="bp-fehler">{{ fehler }}</Hinweis>
    </Abschnitt>
</template>

<style scoped>
.bp-text { font-size: 0.85rem; color: var(--muted); margin: 0 0 var(--abstand-3); }
.bp-zeile { display: flex; gap: var(--abstand-2); align-items: flex-end; flex-wrap: wrap; }
.bp-zeile > :first-child { flex: 1 1 18rem; }
.bp-fehler { margin-top: var(--abstand-3); }
</style>
