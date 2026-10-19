<script setup>
import { spinnerLoadingPage, spinnerLoadingPageText } from '../stores/ui.js';
import Kreisel from '@/components/basis/Kreisel.vue'
</script>
<template>
    <div v-show="spinnerLoadingPage" class="at-mittig overlay">
        <div class="at-flex at-zentriert">
            <Kreisel :groesse="28" />
        </div>
        {{ spinnerLoadingPageText }}
    </div>
</template>
<style scoped>
/* Lade-Overlay: über allem, klickt aber nicht weg. */
.overlay {
    position: fixed;
    inset: 0;
    z-index: 1040;
    display: flex;
    justify-content: center;
    padding-top: 40vh;
    pointer-events: none;
}
</style>
