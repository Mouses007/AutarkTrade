<script setup>
/**
 * Knopf. Drei Arten: `haupt` (türkis, eine pro Bereich), `normal` (Fläche),
 * `leise` (nur Text). `gefahr` für Löschen und Ähnliches.
 * Mit `href` oder `to` wird es ein Link im Knopf-Kleid.
 *
 *   <Knopf art="haupt" @click="speichern">Speichern</Knopf>
 *   <Knopf symbol="plus" klein>Neu</Knopf>
 */
import { computed } from 'vue'
import Symbol from './Symbol.vue'

const props = defineProps({
    art: { type: String, default: 'normal' }, // haupt | normal | leise | gefahr
    klein: { type: Boolean, default: false },
    symbol: { type: String, default: '' },
    nurSymbol: { type: Boolean, default: false },
    laedt: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    type: { type: String, default: 'button' },
    href: { type: String, default: '' },
    to: { type: [String, Object], default: '' },
    titel: { type: String, default: '' },
})

const tag = computed(() => (props.to ? 'router-link' : props.href ? 'a' : 'button'))
</script>

<template>
    <component :is="tag" :class="['at-knopf', art, { klein, nurSymbol, laedt }]"
        :type="tag === 'button' ? type : undefined" :href="href || undefined" :to="to || undefined"
        :disabled="tag === 'button' ? (disabled || laedt) : undefined" :aria-disabled="disabled || undefined"
        :title="titel || undefined" :aria-label="nurSymbol ? titel : undefined">
        <span v-if="laedt" class="kreisel" aria-hidden="true"></span>
        <Symbol v-else-if="symbol" :name="symbol" />
        <span v-if="!nurSymbol" class="text"><slot /></span>
    </component>
</template>

<style scoped>
.at-knopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.55rem 0.95rem;
    border-radius: var(--radius-knopf);
    border: 1px solid var(--line);
    background: var(--panel-soft);
    color: var(--text);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.2;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    touch-action: manipulation;
}

.at-knopf:hover {
    border-color: var(--line-stark);
    background: var(--panel-hoch);
    color: var(--text);
}

.at-knopf:active {
    transform: translateY(1px);
}

.at-knopf.haupt {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}

.at-knopf.haupt:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--on-accent);
}

.at-knopf.leise {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
}

.at-knopf.leise:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.at-knopf.gefahr {
    color: var(--bad);
    border-color: color-mix(in srgb, var(--bad) 40%, transparent);
    background: transparent;
}

.at-knopf.gefahr:hover {
    background: var(--bad-flaeche);
}

.at-knopf.klein {
    padding: 0.32rem 0.65rem;
    font-size: 0.82rem;
    border-radius: 8px;
}

.at-knopf.nurSymbol {
    padding: 0.5rem;
    aspect-ratio: 1;
}

.at-knopf.klein.nurSymbol {
    padding: 0.35rem;
}

.at-knopf:disabled,
.at-knopf[aria-disabled='true'] {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
}

.kreisel {
    width: 1em;
    height: 1em;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: at-dreh 0.8s linear infinite;
}

@keyframes at-dreh {
    to { transform: rotate(360deg); }
}
</style>
