<script setup>
/**
 * Tags einer Bewertung bearbeiten: zugewiesene als Plaketten (Klick entfernt),
 * darunter eine Auswahl nach Katalog-Gruppen. Bereits zugewiesene sind
 * gesperrt, doppelte IDs kommen nicht hinzu.
 */
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'
import { verfuegbareTags } from '@/stores/journal/tagebuch.js'
import { tagAngaben } from '@/utils/journal/tagebuch.js'

const props = defineProps({
    /** Liste `{id, name, color?}` — wird an Ort und Stelle geändert (gehört dem Eintrag). */
    liste: { type: Array, required: true },
})
const { t } = useI18n()

const vergeben = (id) => props.liste.some(x => x.id === id)
const farbe = (tag) => tag.color || tagAngaben(tag.id).farbe

function waehle(ereignis) {
    const id = ereignis.target.value
    ereignis.target.value = '' // zurück auf den Platzhalter
    if (!id || vergeben(id)) return
    for (const g of verfuegbareTags) {
        const tag = (g.tags || []).find(x => String(x.id) === id)
        if (tag) {
            props.liste.push({ id: tag.id, name: tag.name, color: g.color })
            return
        }
    }
}

function entferne(id) {
    const i = props.liste.findIndex(x => x.id === id)
    if (i >= 0) props.liste.splice(i, 1)
}
</script>

<template>
    <div class="tag-wahl">
        <div v-if="liste.length" class="tags">
            <button v-for="tag in liste" :key="tag.id" type="button" class="tag" :style="{ background: farbe(tag) }"
                :title="t('common.remove')" @click="entferne(tag.id)">
                {{ tag.name }} <Symbol name="schliessen" :groesse="11" />
            </button>
        </div>
        <select class="at-feld klein" @change="waehle">
            <option value="">{{ t('incoming.addTag') }}</option>
            <optgroup v-for="g in verfuegbareTags" :key="g.id" :label="g.name">
                <option v-for="tag in g.tags || []" :key="tag.id" :value="tag.id" :disabled="vergeben(tag.id)">{{ tag.name }}</option>
            </optgroup>
        </select>
    </div>
</template>

<style scoped>
.tag-wahl {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
}

.tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.tag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.55rem;
    border: none;
    border-radius: var(--radius-pille);
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
}

.tag:hover {
    filter: brightness(1.2);
}
</style>
