<script setup>
/**
 * Hinweis-Kasten für eine Aussage, die man nicht übersehen soll.
 * Arten: info (türkis), warn, fehler, gut.
 *
 *   <Hinweis art="warn" titel="Testbetrieb">Keine Mails, kein Push.</Hinweis>
 */
import { computed } from 'vue'
import Symbol from './Symbol.vue'

const props = defineProps({
    art: { type: String, default: 'info' }, // info | warn | fehler | gut
    titel: { type: String, default: '' },
    schliessbar: { type: Boolean, default: false },
})
const emit = defineEmits(['zu'])
const symbol = computed(() => ({ info: 'info', warn: 'warnung', fehler: 'fehler', gut: 'haken' })[props.art] || 'info')
</script>

<template>
    <div :class="['at-hinweis', art]" :role="art === 'fehler' ? 'alert' : 'status'">
        <Symbol :name="symbol" :groesse="18" class="zeichen" />
        <div class="text">
            <strong v-if="titel" class="titel">{{ titel }}</strong>
            <slot />
        </div>
        <button v-if="schliessbar" type="button" class="zu" aria-label="Schliessen" @click="emit('zu')">
            <Symbol name="schliessen" :groesse="16" />
        </button>
    </div>
</template>

<style scoped>
.at-hinweis {
    --ton: var(--accent);
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius-knopf);
    border: 1px solid color-mix(in srgb, var(--ton) 35%, transparent);
    background: color-mix(in srgb, var(--ton) 10%, var(--panel));
    color: var(--text);
    font-size: 0.9rem;
}

.at-hinweis.warn { --ton: var(--warn); }
.at-hinweis.fehler { --ton: var(--bad); }
.at-hinweis.gut { --ton: var(--good); }

.zeichen {
    color: var(--ton);
    margin-top: 0.1rem;
}

.text {
    flex: 1;
    min-width: 0;
}

.titel {
    display: block;
    margin-bottom: 0.15rem;
    color: var(--ton);
}

.zu {
    display: inline-flex;
    padding: 0.2rem;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
}
</style>
