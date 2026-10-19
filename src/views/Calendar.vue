<script setup>
/**
 * Kalenderseite (Spezifikation ansichten.md K.1). Lädt über
 * `useMountCalendar` (Bereich: Jahresanfang bis Ende des gewählten Monats).
 *
 * Ist der Bereich leer, bleibt die Monatsnavigation trotzdem stehen — früher
 * verschwand sie mit, und zurück ging es nur über die Filterleiste.
 */
import { onBeforeMount } from 'vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { filteredTrades } from '../stores/trades.js'
import { useMountCalendar } from '../utils/journal/ablauf.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import Calendar from '../components/Calendar.vue'
import Karte from '@/components/basis/Karte.vue'

onBeforeMount(async () => {
    await useMountCalendar()
})
</script>

<template>
    <div class="kal-seite">
        <SpinnerLoadingPage />
        <div v-show="!spinnerLoadingPage" class="kal-inhalt">
            <NoData v-if="!filteredTrades.length" />
            <Karte dicht>
                <Calendar />
            </Karte>
        </div>
    </div>
</template>

<style scoped>
.kal-inhalt {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
</style>
