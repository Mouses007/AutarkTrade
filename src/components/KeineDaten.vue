<script setup>
/**
 * „Keine Daten" der Journal-Seiten (Dashboard, Auswertung, Kalender): eine
 * zentrierte Karte über die volle Breite.
 */
import { useI18n } from 'vue-i18n'
import Karte from '@/components/basis/Karte.vue'

const { t } = useI18n()
</script>

<template>
    <Karte class="nodata">
        <div>{{ t('common.noData') }}</div>
    </Karte>
</template>

<style scoped>
.nodata {
    width: 100%;
    text-align: center;
    color: var(--muted);
}
</style>
