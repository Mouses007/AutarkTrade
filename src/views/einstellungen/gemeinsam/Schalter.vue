<script setup>
/**
 * Ein-/Aus-Schalter mit Beschriftung. `v-model` ist ein Boolean; `@change`
 * feuert nach dem Umschalten mit dem neuen Wert (für sofortiges Speichern).
 * Optional `info` = i18n-Schlüssel für das kleine „i" (InfoTipp).
 *
 *   <Schalter v-model="an" label="Live-Trading" info="settings.liveInfo" @change="speichern" />
 */
import { useId } from 'vue'
import InfoTipp from '@/components/InfoTipp.vue'

const props = defineProps({
    modelValue: { type: [Boolean, Number], default: false },
    label: { type: String, default: '' },
    hilfe: { type: String, default: '' },
    info: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])
const id = useId()
function wechsel(e) {
    const v = e.target.checked
    emit('update:modelValue', v)
    emit('change', v)
}
</script>

<template>
    <div class="ein-schalter">
        <label class="zeile" :for="id">
            <input :id="id" type="checkbox" role="switch" :checked="!!props.modelValue" :disabled="disabled" @change="wechsel" />
            <span class="bahn" aria-hidden="true"><span class="knopf"></span></span>
            <span class="text">{{ label }}<slot /></span>
        </label>
        <InfoTipp v-if="info" :schluessel="info" />
        <p v-if="hilfe" class="hilfe">{{ hilfe }}</p>
    </div>
</template>

<style scoped>
.ein-schalter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--abstand-2);
    padding: 0.3rem 0;
}
.zeile {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    cursor: pointer;
}
input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
}
.bahn {
    flex: none;
    width: 2.1rem;
    height: 1.2rem;
    border-radius: var(--radius-pille);
    background: var(--panel-hoch);
    border: 1px solid var(--line-stark);
    position: relative;
    transition: background 0.15s;
}
.knopf {
    position: absolute;
    top: 50%;
    left: 0.15rem;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--muted);
    transform: translateY(-50%);
    transition: left 0.15s, background 0.15s;
}
input:checked + .bahn {
    background: var(--accent-flaeche);
    border-color: var(--accent-rand);
}
input:checked + .bahn .knopf {
    left: calc(100% - 0.95rem);
    background: var(--accent);
}
input:focus-visible + .bahn {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
input:disabled ~ * { opacity: 0.5; cursor: not-allowed; }
.hilfe {
    flex-basis: 100%;
    margin: 0.1rem 0 0 2.6rem;
    color: var(--muted);
    font-size: 0.82rem;
}
</style>
