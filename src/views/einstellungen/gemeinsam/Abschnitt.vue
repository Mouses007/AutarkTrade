<script setup>
/**
 * Aufklappbarer Abschnitt einer Einstellungsseite.
 *
 * Die Einstellungen sind zu lang, um sie offen untereinander zu lesen; jeder
 * Block klappt deshalb einzeln auf. `v-model:offen` erlaubt dem Aufrufer,
 * den Zustand selbst zu halten (z. B. `?section=api` öffnet die Börsen-API).
 *
 *   <Abschnitt titel="Kontostand" symbol="geldboerse" v-model:offen="kontoOffen">…</Abschnitt>
 *
 * Mit `kennung` ist der Abschnitt ein Sprungziel (`springeZu`, `?abschnitt=`):
 * er klappt auf und rollt sich ins Bild.
 */
import { ref, watch, nextTick, useId } from 'vue'
import Symbol from '@/components/basis/Symbol.vue'
import { sprungZiel } from './sprung.js'

const props = defineProps({
    titel: { type: String, required: true },
    symbol: { type: String, default: '' },
    untertitel: { type: String, default: '' },
    offen: { type: Boolean, default: undefined },
    /** Kleinere Unterüberschrift innerhalb eines Abschnitts. */
    unter: { type: Boolean, default: false },
    /** Sprungziel: eindeutig über alle Einstellungsseiten. */
    kennung: { type: String, default: '' },
})
const emit = defineEmits(['update:offen'])

const id = useId()
const intern = ref(props.offen ?? false)
watch(() => props.offen, (v) => { if (v !== undefined) intern.value = v })
function umschalten() {
    intern.value = !intern.value
    emit('update:offen', intern.value)
}

const wurzel = ref(null)
watch(sprungZiel, (ziel) => {
    if (!props.kennung || ziel !== props.kennung) return
    sprungZiel.value = ''
    intern.value = true
    emit('update:offen', true)
    // Der Reiter darüber wird im selben Takt erst sichtbar (v-show) —
    // vorher hat der Abschnitt keine Lage, an die man rollen könnte.
    nextTick(() => setTimeout(() => wurzel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80))
}, { immediate: true })
</script>

<template>
    <section ref="wurzel" :class="['ein-abschnitt', { unter, offen: intern }]" :data-abschnitt="kennung || undefined">
        <button type="button" class="kopf" :aria-expanded="intern" :aria-controls="id" @click="umschalten">
            <Symbol :name="intern ? 'runter' : 'ausklappen'" class="pfeil" />
            <Symbol v-if="symbol" :name="symbol" class="sym" />
            <span class="titel">{{ titel }}</span>
            <span v-if="untertitel" class="untertitel">{{ untertitel }}</span>
            <slot name="kopf" />
        </button>
        <div v-show="intern" :id="id" class="inhalt">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.ein-abschnitt {
    scroll-margin-top: var(--abstand-5);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    margin-bottom: var(--abstand-3);
}
.ein-abschnitt.unter {
    background: var(--panel-soft);
    border-radius: var(--radius-knopf);
    margin: var(--abstand-3) 0;
}
.kopf {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    width: 100%;
    padding: var(--abstand-3) var(--abstand-4);
    background: none;
    border: 0;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 1.05rem;
    font-weight: 600;
}
.unter .kopf {
    font-size: 0.95rem;
    padding: var(--abstand-2) var(--abstand-3);
}
.kopf:hover .titel { color: var(--accent); }
.pfeil { color: var(--muted); flex: none; }
.sym { color: var(--accent); flex: none; }
.untertitel {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 400;
}
.inhalt {
    padding: 0 var(--abstand-4) var(--abstand-4);
}
.unter .inhalt {
    padding: 0 var(--abstand-3) var(--abstand-3);
}
</style>
