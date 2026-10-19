<script setup>
/** Live → Live-Trading-Fenster: Seite ein-/ausschalten. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { modusLiveAn } from '../gemeinsam/useModi.js'
import { livetradingAn, useRadarEinstellungen } from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { radarSpeichern } = useRadarEinstellungen()

let livetradingExpanded = ref(false)
</script>

<template>
    <div>
        <hr />

        <!--=============== LIVE-TRADING-FENSTER ===============-->
        <div class="d-flex align-items-center pointerClass" @click="livetradingExpanded = !livetradingExpanded">
            <i class="uil me-2" :class="livetradingExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">Live-Trading-Fenster</p>
        </div>
        <div v-show="livetradingExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">Ein eigener Arbeitsplatz für die Stunden, in denen du tatsächlich handelst — Kachelraster mit eigenem Layout, unabhängig vom Marktradar. Wer nur beobachtet, schaltet die Seite hier ab; dann verschwinden auch der Startknopf auf dem Marktradar und der Menüeintrag.</p>

            <div class="form-check form-switch mt-2">
                <input class="form-check-input" type="checkbox" id="livetradingToggle"
                    :disabled="!modusLiveAn"
                    v-model="livetradingAn" @change="radarSpeichern('livetradingAn')">
                <label class="form-check-label" for="livetradingToggle">Live-Trading-Fenster anzeigen</label>
            </div>
            <!-- Der Modus steht über der Seite: ist er aus, ist auch diese Seite
                 weg. Der Schalter behält seinen Wert und kommt unverändert
                 zurück, sobald der Modus wieder an ist — deshalb ausgrauen und
                 nicht heimlich mit umschalten. -->
            <p v-if="!modusLiveAn" class="fw-lighter small mb-0 mt-1 text-warning">{{ t('settings.livetradingModeOffHint') }}</p>
        </div>

    </div>
</template>
