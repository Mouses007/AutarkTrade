<script setup>
/** Bereich „Live-Analyse" — die Sektionen in der bisherigen Reihenfolge. */
import Livetrading from './live/Livetrading.vue'
import LiveAnalyse from './live/LiveAnalyse.vue'
import Marktradar from './live/Marktradar.vue'
import Recorder from './live/Recorder.vue'
</script>

<template>
    <div>
        <Livetrading />
        <LiveAnalyse />
        <Marktradar />
        <Recorder />
    </div>
</template>
