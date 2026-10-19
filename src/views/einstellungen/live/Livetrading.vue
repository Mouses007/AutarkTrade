<script setup>
/** Live → Live-Trading-Fenster: Seite ein-/ausschalten. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { modusLiveAn } from '../gemeinsam/useModi.js'
import { livetradingAn, useRadarEinstellungen } from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

let livetradingExpanded = ref(false)
</script>

<template>
    <Abschnitt titel="Live-Trading-Fenster" symbol="live" v-model:offen="livetradingExpanded">
        <p class="einleitung">Ein eigener Arbeitsplatz für die Stunden, in denen du tatsächlich handelst — Kachelraster mit eigenem Layout, unabhängig vom Marktradar. Wer nur beobachtet, schaltet die Seite hier ab; dann verschwinden auch der Startknopf auf dem Marktradar und der Menüeintrag.</p>

        <Schalter v-model="livetradingAn" :disabled="!modusLiveAn"
            label="Live-Trading-Fenster anzeigen" @change="radarSpeichern('livetradingAn')" />
        <!-- Der Modus steht über der Seite: ist er aus, ist auch diese Seite
             weg. Der Schalter behält seinen Wert und kommt unverändert
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
