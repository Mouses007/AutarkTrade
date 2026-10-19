<script setup>
/**
 * Bereich „Lizenz" — Einhängepunkt für Sitzung S10 (Lizenz & Vertrieb).
 *
 * S10 setzt hier die Lizenzeingabe ein (Schlüssel eingeben, Stand und
 * Laufzeit anzeigen). Bis dahin nur Kopf und Hinweis, damit der Reiter und
 * die Route `/settings/lizenz` schon stehen.
 */
import { useI18n } from 'vue-i18n'
import { Seitenkopf, Hinweis } from '@/components/basis/index.js'

const { t } = useI18n()
</script>

<template>
    <div>
        <Seitenkopf :titel="t('settings.area_lizenz')" :unter="t('settings.lizenzUnter')" />
        <Hinweis art="info">{{ t('settings.folgtMitS10') }}</Hinweis>
    </div>
</template>
