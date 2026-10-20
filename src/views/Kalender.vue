<script setup>
/**
 * Kalenderseite (Spezifikation ansichten.md K.1). Lädt über
 * `starteKalender` (Bereich: Jahresanfang bis Ende des gewählten Monats).
 *
 * Ist der Bereich leer, bleibt die Monatsnavigation trotzdem stehen — früher
 * verschwand sie mit, und zurück ging es nur über die Filterleiste.
 */
import { onBeforeMount } from 'vue'
import { seiteLaedt } from '../stores/ui.js'
import { journalTage } from '../stores/trades.js'
import { starteKalender } from '../utils/journal/ablauf.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import KeineDaten from '../components/KeineDaten.vue'
import KalenderMonat from '../components/KalenderMonat.vue'
import Karte from '@/components/basis/Karte.vue'

onBeforeMount(async () => {
    await starteKalender()
})
</script>

<template>
    <div class="kal-seite">
        <SeiteLaedt />
        <div v-show="!seiteLaedt" class="kal-inhalt">
            <KeineDaten v-if="!journalTage.length" />
            <Karte dicht>
                <KalenderMonat />
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
