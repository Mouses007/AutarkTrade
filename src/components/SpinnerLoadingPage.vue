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