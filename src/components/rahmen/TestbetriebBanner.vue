<script setup>
/**
 * Banner im Testbetrieb (AT_TESTBETRIEB=1, server/testbetrieb.js): die Instanz
 * läuft gegen eine Kopie der Live-Datenbank, ohne Hintergrund-Takte, Mails und
 * Push. Nicht wegklickbar — wer auf diese Instanz schaut, soll es immer wissen.
 */
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import { testbetrieb } from '../../stores/system.js'

const { t } = useI18n()
</script>

<template>
    <div v-if="testbetrieb" class="at-testbetrieb" role="status">
        <Symbol name="test" :groesse="16" />
        <strong>{{ t('app.testbetrieb') }}</strong>
        <span class="text">{{ t('app.testbetriebText') }}</span>
    </div>
</template>

<style scoped>
.at-testbetrieb {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem clamp(0.8rem, 2.4vw, 1.6rem);
    background: repeating-linear-gradient(-45deg, var(--warn-flaeche) 0 12px, transparent 12px 24px), var(--panel);
    border-bottom: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    color: var(--warn);
    font-size: 0.85rem;
}

strong {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78rem;
}

.text {
    color: var(--text);
    opacity: 0.85;
}

@media (max-width: 575.98px) {
    .text {
        font-size: 0.78rem;
    }
}
</style>
