<script setup>
/**
 * Eingabefeld mit Beschriftung, Hilfe- und Fehlertext. `v-model` wie gewohnt.
 * `art="auswahl"` mit `optionen` ergibt ein Auswahlfeld, `art="text"` ein
 * mehrzeiliges Feld; sonst ist `art` der HTML-Typ (text, number, password …).
 *
 *   <Eingabe v-model="name" label="Name" hilfe="Wie die Instanz heissen soll" />
 *   <Eingabe v-model="markt" art="auswahl" label="Markt"
 *            :optionen="[{ wert: 'futures', text: 'Futures' }, { wert: 'spot', text: 'Spot' }]" />
 */
import { computed, useId } from 'vue'

const props = defineProps({
    modelValue: { type: [String, Number, null], default: '' },
    label: { type: String, default: '' },
    art: { type: String, default: 'text' },
    optionen: { type: Array, default: () => [] }, // [{ wert, text }]
    hilfe: { type: String, default: '' },
    fehler: { type: String, default: '' },
    platzhalter: { type: String, default: '' },
    einheit: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    zeilen: { type: Number, default: 3 },
})
const emit = defineEmits(['update:modelValue'])

const id = useId()
const wert = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', props.art === 'number' && v !== '' ? Number(v) : v),
})
const beschreibung = computed(() => (props.fehler || props.hilfe ? `${id}-hilfe` : undefined))
</script>

<template>
    <div :class="['at-eingabe', { hatFehler: !!fehler }]">
        <label v-if="label" :for="id">{{ label }}</label>
        <div class="feld">
            <select v-if="art === 'auswahl'" :id="id" v-model="wert" :disabled="disabled" :aria-describedby="beschreibung">
                <option v-for="o in optionen" :key="o.wert" :value="o.wert">{{ o.text }}</option>
            </select>
            <textarea v-else-if="art === 'mehrzeilig'" :id="id" v-model="wert" :rows="zeilen" :placeholder="platzhalter"
                :disabled="disabled" :aria-describedby="beschreibung"></textarea>
            <input v-else :id="id" v-model="wert" :type="art" :placeholder="platzhalter" :disabled="disabled"
                :aria-invalid="!!fehler || undefined" :aria-describedby="beschreibung" />
            <span v-if="einheit" class="einheit">{{ einheit }}</span>
        </div>
        <p v-if="fehler || hilfe" :id="`${id}-hilfe`" class="hilfe">{{ fehler || hilfe }}</p>
    </div>
</template>

<style scoped>
.at-eingabe {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
}

label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
}

.feld {
    position: relative;
    display: flex;
    align-items: center;
}

input,
select,
textarea {
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
    transition: border-color 0.15s, box-shadow 0.15s;
}

input:focus,
select:focus,
textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}

input:disabled,
select:disabled,
textarea:disabled {
    opacity: 0.55;
}

.einheit {
    position: absolute;
    right: 0.75rem;
    color: var(--muted);
    font-size: 0.85rem;
    pointer-events: none;
}

.feld:has(.einheit) input {
    padding-right: 3rem;
}

.hilfe {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
}

.hatFehler input,
.hatFehler select,
.hatFehler textarea {
    border-color: var(--bad);
}

.hatFehler .hilfe {
    color: var(--bad);
}
</style>
