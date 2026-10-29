<script setup>
/** Chart & Analyse → Live-Trading-Fenster: Seite ein-/ausschalten, auch auf dem Handy. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { appEinstellungen } from '@/stores/settings.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { modusLiveAn } from '../gemeinsam/useModi.js'
import { livetradingAn, useRadarEinstellungen } from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

let livetradingExpanded = ref(false)
// Live-Trading-Fenster auch am Telefon zeigen
const livetradingMobil = ref(Number(appEinstellungen.value?.livetradingMobil ?? 0) === 1)
</script>

<template>
    <Abschnitt :titel="t('settings.live.fensterTitel')" symbol="live" v-model:offen="livetradingExpanded">
        <p class="einleitung">{{ t('settings.live.fensterEinleitung') }}</p>

        <Schalter v-model="livetradingAn" :disabled="!modusLiveAn"
            :label="t('settings.live.fensterAnzeigen')" @change="radarSpeichern('livetradingAn')" />
        <Schalter v-model="livetradingMobil" :disabled="!modusLiveAn" :label="t('settings.livetradingMobile')"
            :hilfe="t('settings.livetradingMobileHint')"
            @change="(v) => kiSpeichern('livetradingMobil', v ? 1 : 0)" />
        <!-- Der Modus steht über der Seite: ist er aus, ist auch diese Seite
             weg. Die Schalter behalten ihren Wert und kommen unverändert
             zurück, sobald der Modus wieder an ist — deshalb ausgrauen und
             nicht heimlich mit umschalten. -->
        <p v-if="!modusLiveAn" class="warnung">{{ t('settings.livetradingModeOffHint') }}</p>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.warnung {
    color: var(--warn);
    font-size: 0.85rem;
    margin: var(--abstand-1) 0 0;
}
</style>
