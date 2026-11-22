<script setup>
/**
 * Umschalter der Anzeigewährung im Portfolio: die Standardwährung der
 * Einstellungen, dazu USD und CHF. Die Wahl gilt für alle Portfolio-Seiten
 * ausser dem Steuerbericht und wird pro Gerät gemerkt (`stores/portfolio.js`).
 */
import { useI18n } from 'vue-i18n'
import { waehrung, waehrungAuswahl, standardWaehrung, setzeWaehrung } from '../../stores/portfolio.js'

const { t } = useI18n()
</script>

<template>
    <div v-if="waehrungAuswahl.length > 1" class="ws" role="group" :aria-label="t('portfolio.waehrungWahl')" :title="t('portfolio.waehrungInfo', { s: standardWaehrung })">
        <button v-for="w in waehrungAuswahl" :key="w" type="button" :class="{ aktiv: w === waehrung }" :aria-pressed="w === waehrung" @click="setzeWaehrung(w)">{{ w }}</button>
    </div>
</template>

<style scoped>
.ws { display: inline-flex; border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); overflow: hidden; }
.ws button { background: transparent; border: 0; color: var(--muted); font: inherit; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.03em; padding: 0.3rem 0.55rem; cursor: pointer; }
.ws button + button { border-left: 1px solid var(--line-stark); }
.ws button:hover { color: var(--text); }
.ws button.aktiv { background: var(--accent-flaeche); color: var(--accent); }
</style>
