<script setup>
/**
 * Leerzustand: was eine Liste zeigt, wenn sie nichts zu zeigen hat — mit einem
 * Satz, warum, und optional dem Knopf, der das ändert (Slot).
 *
 *   <Leerzustand titel="Noch keine Trades" text="Verbinde eine Börse unter Einstellungen.">
 *     <Knopf art="haupt" to="/einstellungen">Börse verbinden</Knopf>
 *   </Leerzustand>
 */
import Symbol from './Symbol.vue'

defineProps({
    titel: { type: String, required: true },
    text: { type: String, default: '' },
    symbol: { type: String, default: 'leer' },
})
</script>

<template>
    <div class="at-leer">
        <span class="kreis"><Symbol :name="symbol" :groesse="26" /></span>
        <h3>{{ titel }}</h3>
        <p v-if="text">{{ text }}</p>
        <div v-if="$slots.default" class="aktion"><slot /></div>
    </div>
</template>

<style scoped>
.at-leer {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.4rem;
    padding: 2.4rem 1.2rem;
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius);
    color: var(--muted);
}

.kreis {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    margin-bottom: 0.4rem;
    border-radius: 50%;
    background: var(--accent-flaeche);
    color: var(--accent);
}

h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
}

p {
    margin: 0;
    max-width: 32rem;
}

.aktion {
    margin-top: 0.8rem;
}
</style>
