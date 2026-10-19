<script setup>
/**
 * Dialog auf dem nativen <dialog>-Element: Fokusfalle, Esc und Hintergrund
 * bringt der Browser mit. `v-model` öffnet und schliesst.
 *
 *   <Dialog v-model="offen" titel="Instanz löschen?">
 *     Text …
 *     <template #fuss><Knopf @click="offen = false">Abbrechen</Knopf><Knopf art="gefahr">Löschen</Knopf></template>
 *   </Dialog>
 */
import { ref, watch, onMounted } from 'vue'
import Symbol from './Symbol.vue'

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    titel: { type: String, default: '' },
    breite: { type: String, default: '32rem' },
    /** false: Klick neben den Dialog schliesst ihn nicht (z. B. bei Formularen). */
    aussenSchliesst: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue', 'zu'])

const el = ref(null)

function setze(offen) {
    const d = el.value
    if (!d) return
    if (offen && !d.open) d.showModal()
    else if (!offen && d.open) d.close()
}

watch(() => props.modelValue, setze)
onMounted(() => setze(props.modelValue))

function zu() {
    emit('update:modelValue', false)
    emit('zu')
}

function klick(e) {
    if (props.aussenSchliesst && e.target === el.value) zu()
}
</script>

<template>
    <dialog ref="el" class="at-dialog" :style="{ '--dialog-breite': breite }" @close="zu" @click="klick">
        <div class="innen">
            <header class="kopf">
                <h2>{{ titel }}</h2>
                <button type="button" class="zu" :aria-label="'Schliessen'" @click="zu">
                    <Symbol name="schliessen" :groesse="18" />
                </button>
            </header>
            <div class="inhalt"><slot /></div>
            <footer v-if="$slots.fuss" class="fuss"><slot name="fuss" /></footer>
        </div>
    </dialog>
</template>

<style scoped>
.at-dialog {
    width: min(var(--dialog-breite), calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    box-shadow: var(--schatten);
}

.at-dialog::backdrop {
    background: rgba(2, 4, 5, 0.72);
    backdrop-filter: blur(2px);
}

.innen {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 2rem);
}

.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.2rem 0.6rem;
}

h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
}

.zu {
    display: inline-flex;
    padding: 0.35rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.inhalt {
    padding: 0.2rem 1.2rem 1.1rem;
    overflow-y: auto;
}

.fuss {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.8rem 1.2rem;
    border-top: 1px solid var(--line);
}
</style>
