<script setup>
/**
 * Trade-Typ als Pille. Weicht der Abschlusstyp vom Eröffnungstyp ab, zeigt sie
 * beides: Eröffnung (Warnfarbe) → Abschluss (grün) — die Änderung ist die
 * Aussage, nicht der Endstand.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Pille from '@/components/basis/Pille.vue'
import { typSchluessel } from './playbookDaten.js'

const props = defineProps({
    eroeffnung: { type: String, default: '' },
    abschluss: { type: String, default: '' },
})
const { t } = useI18n()
const name = (wert) => {
    const k = typSchluessel(wert)
    return k ? t(k) : wert
}
const gewechselt = computed(() => !!(props.eroeffnung && props.abschluss && props.abschluss !== props.eroeffnung))
</script>

<template>
    <span v-if="gewechselt" class="wechsel">
        <Pille ton="warn">{{ name(eroeffnung) }}</Pille>
        <span aria-hidden="true">→</span>
        <Pille ton="gut">{{ name(abschluss) }}</Pille>
    </span>
    <Pille v-else-if="abschluss || eroeffnung" ton="neutral">{{ name(abschluss || eroeffnung) }}</Pille>
</template>

<style scoped>
.wechsel {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-1);
    color: var(--muted);
}
</style>
