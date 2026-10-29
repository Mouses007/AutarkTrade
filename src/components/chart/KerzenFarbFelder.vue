<script setup>
/**
 * Die zwei Kerzenfarben (steigend/fallend) mit „Standard" — dieselben Felder im
 * Chart (Doppelklick auf eine Kerze, Rechtsklick „Kerzenfarben …") und unter
 * Einstellungen › Allgemein › Layout & Stil. Gespeichert wird nur eine Abweichung
 * von der Vorgabe; `appEinstellungen` zieht sofort nach, die Panels färben live um.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Knopf } from '@/components/basis/index.js'
import FarbWahl from './FarbWahl.vue'
import { KERZEN_STANDARD, kerzenFarben } from '@/utils/chart/kerzenFarben.js'
import { appEinstellungen } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'

const { t } = useI18n()
const kerzen = computed(() => kerzenFarben(appEinstellungen.value))
const sindVorgabe = computed(() => kerzen.value.steigend === KERZEN_STANDARD.steigend && kerzen.value.fallend === KERZEN_STANDARD.fallend)

async function speichere(werte) {
    if (appEinstellungen.value) Object.assign(appEinstellungen.value, werte)
    await dbUpdateSettings(werte)
}
function setze(feld, farbe, vorgabe) { speichere({ [feld]: farbe.toLowerCase() === vorgabe ? null : farbe }) }
function vorgabe() { speichere({ chartKerzeSteigend: null, chartKerzeFallend: null }) }
</script>

<template>
    <div class="kerzenFelder">
        <label>{{ t('settings.kerzeSteigend') }}
            <FarbWahl :model-value="kerzen.steigend" :titel="t('settings.kerzeSteigend')"
                @update:model-value="(f) => setze('chartKerzeSteigend', f, KERZEN_STANDARD.steigend)" /></label>
        <label>{{ t('settings.kerzeFallend') }}
            <FarbWahl :model-value="kerzen.fallend" :titel="t('settings.kerzeFallend')"
                @update:model-value="(f) => setze('chartKerzeFallend', f, KERZEN_STANDARD.fallend)" /></label>
        <Knopf klein :disabled="sindVorgabe" @click="vorgabe">{{ t('settings.kerzenVorgabe') }}</Knopf>
    </div>
</template>

<style scoped>
.kerzenFelder {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
}

.kerzenFelder label {
    display: flex;
    align-items: center;
    gap: 6px;
}
</style>
