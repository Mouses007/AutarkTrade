<script setup>
/** Bereich „Journal" — die Sektionen in der bisherigen Reihenfolge. */
import Kontostand from './journal/Kontostand.vue'
import BoersenApi from './journal/BoersenApi.vue'
import Bewertung from './journal/Bewertung.vue'
import Esp32 from './journal/Esp32.vue'
import OhlcChart from './journal/OhlcChart.vue'
</script>

<template>
    <div>
        <Kontostand />
        <BoersenApi />
        <Bewertung />
        <Esp32 />
        <OhlcChart />
    </div>
</template>
