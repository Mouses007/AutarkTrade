<script setup>
/**
 * Bereich „Chart & Analyse" (Kennung und Adresse bleiben `live`, damit alte
 * Links weiter treffen).
 */
import ChartDarstellung from './live/ChartDarstellung.vue'
import Livetrading from './live/Livetrading.vue'
import LiveAnalyse from './live/LiveAnalyse.vue'
import Marktradar from './live/Marktradar.vue'
import Recorder from './live/Recorder.vue'
</script>

<template>
    <div>
        <ChartDarstellung />
        <Livetrading />
        <LiveAnalyse />
        <Marktradar />
        <Recorder />
    </div>
</template>
