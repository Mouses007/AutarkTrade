<script setup>
/**
 * Filter nach Sparte: Sektor und, eine Stufe feiner, Branche — so wie die
 * Kursquelle sie nennt (`shared/aktien-sparte.js`). Angeboten wird nur, was in
 * den Zeilen vorkommt; Titel ohne sichere Angabe stehen unter «unbekannt».
 *
 * `v-model` ist `{sektor, branche}`; leer = alles.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { spartenAuswahl, bereinigeFilter, sektorSchluessel, UNBEKANNT } from '../../../shared/aktien-sparte.js'

const props = defineProps({
    modelValue: { type: Object, default: () => ({ sektor: '', branche: '' }) },
    zeilen: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
const { t, te } = useI18n()

const auswahl = computed(() => spartenAuswahl(props.zeilen))
const gewaehlt = computed(() => auswahl.value.sektoren.find((s) => s.sektor === props.modelValue.sektor) || null)
const sektorName = (s) => {
    const k = sektorSchluessel(s)
    return k && te('sparte.sektor_' + k) ? t('sparte.sektor_' + k) : s
}
// In der Reihenfolge der angezeigten (übersetzten) Namen, nicht der englischen der Quelle.
const sektoren = computed(() => [...auswahl.value.sektoren].sort((a, b) => sektorName(a.sektor).localeCompare(sektorName(b.sektor))))
const setze = (teil) => emit('update:modelValue', { ...props.modelValue, ...teil })

// Fällt die gewählte Sparte aus den Zeilen (neuer Lauf, Favorit entfernt), springt der Filter zurück statt leer zu filtern.
watch(auswahl, (a) => {
    const sauber = bereinigeFilter(props.modelValue, a)
    if (sauber.sektor !== (props.modelValue.sektor || '') || sauber.branche !== (props.modelValue.branche || '')) emit('update:modelValue', sauber)
})
</script>

<template>
    <div class="sparten" role="group" :aria-label="t('sparte.filter')">
        <label>
            <span>{{ t('sparte.sektor') }}</span>
            <select :value="modelValue.sektor || ''" :title="t('sparte.info')" @change="setze({ sektor: $event.target.value, branche: '' })">
                <option value="">{{ t('sparte.alle') }}</option>
                <option v-for="s in sektoren" :key="s.sektor" :value="s.sektor">{{ sektorName(s.sektor) }} ({{ s.anzahl }})</option>
                <option v-if="auswahl.unbekannt" :value="UNBEKANNT">{{ t('sparte.unbekannt') }} ({{ auswahl.unbekannt }})</option>
            </select>
        </label>
        <label v-if="gewaehlt && gewaehlt.branchen.length > 1">
            <span>{{ t('sparte.branche') }}</span>
            <select :value="modelValue.branche || ''" @change="setze({ branche: $event.target.value })">
                <option value="">{{ t('sparte.alleBranchen') }}</option>
                <option v-for="b in gewaehlt.branchen" :key="b.branche" :value="b.branche">{{ b.branche }} ({{ b.anzahl }})</option>
            </select>
        </label>
    </div>
</template>

<style scoped>
.sparten {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
}

label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.88rem;
}

select {
    width: auto;
    max-width: 18rem;
    padding-block: 0.3rem;
    font-size: 0.88rem;
}
</style>
