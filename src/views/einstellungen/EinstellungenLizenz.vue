<script setup>
/**
 * Bereich „Lizenz": Stand des Lizenzschlüssels, neuen Schlüssel eingeben,
 * Laufzeit der Update-Berechtigung. Der Inhalt ist S10s `LizenzEinstellung`
 * (`server/lizenz.js`); der Menüfuss verweist bei gesperrtem Update hierher.
 */
import { useI18n } from 'vue-i18n'
import { Seitenkopf } from '@/components/basis/index.js'
import LizenzEinstellung from '@/components/rechtliches/LizenzEinstellung.vue'

const { t } = useI18n()
</script>

<template>
    <div>
        <Seitenkopf :titel="t('settings.area_lizenz')" :unter="t('settings.lizenzUnter')" />
        <LizenzEinstellung />
    </div>
</template>
