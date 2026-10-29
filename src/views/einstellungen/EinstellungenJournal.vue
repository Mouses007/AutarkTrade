<script setup>
/** Bereich „Journal" — Kontostand, Börsen-Konten, Importe, Bewertung. */
import Kontostand from './journal/Kontostand.vue'
import BoersenApi from './journal/BoersenApi.vue'
import Importe from './journal/Importe.vue'
import Bewertung from './journal/Bewertung.vue'
</script>

<template>
    <div>
        <Kontostand />
        <BoersenApi />
        <Importe />
        <Bewertung />
    </div>
</template>
