<script setup>
/**
 * Bereich „Rechtliches" — Einhängepunkt für Sitzung S10 (Lizenz & Vertrieb).
 *
 * S10 hängt hier die Lizenztexte ein: die eigene Lizenz, THIRD-PARTY-NOTICES
 * der mitgelieferten Bibliotheken und den NOTICE-Text von TradingView
 * (Lightweight Charts, Apache-2.0). Bis dahin nur Kopf und Hinweis.
 */
import { useI18n } from 'vue-i18n'
import { Seitenkopf, Hinweis } from '@/components/basis/index.js'

const { t } = useI18n()
</script>

<template>
    <div>
        <Seitenkopf :titel="t('settings.area_rechtliches')" :unter="t('settings.rechtlichesUnter')" />
        <Hinweis art="info">{{ t('settings.folgtMitS10') }}</Hinweis>
    </div>
</template>
