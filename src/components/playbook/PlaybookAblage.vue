<script setup>
/**
 * Ablagezone eines Bereichs: Klick öffnet die Dateiauswahl, Ziehen-und-Ablegen
 * nimmt die erste Bilddatei, daneben „Kopiertes Bild einfügen“, wenn auf einer
 * anderen Seite ein Bild gemerkt wurde. Alle Wege laufen auf denselben Kern
 * (`ladeDateiHoch` bzw. `kopiertesEinfuegen`) mit demselben Zielfeld.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Knopf from '@/components/basis/Knopf.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { usePlaybook } from './usePlaybook.js'

const props = defineProps({
    eintrag: { type: Object, required: true },
    /** Zielfeld (`entry`/`trend`/`closing`); null = alle belegt, dann nichts zeigen. */
    ziel: { type: String, default: null },
    /** `open` oder `closing` — für die Hervorhebung beim Darüberziehen. */
    bereich: { type: String, required: true },
})
const { t } = useI18n()
const pb = usePlaybook()

const merker = computed(() => `${props.eintrag.tradeId}:${props.bereich}`)
const hervorgehoben = computed(() => pb.ziehMerker.value === merker.value)

function gewaehlt(ereignis) {
    const datei = ereignis.target.files?.[0]
    ereignis.target.value = '' // dieselbe Datei soll ein zweites Mal wählbar sein
    if (datei) pb.ladeDateiHoch(props.eintrag, props.ziel, datei)
}

function abgelegt(ereignis) {
    pb.ziehMerker.value = ''
    const datei = [...(ereignis.dataTransfer?.files || [])].find(f => String(f.type).startsWith('image/'))
    if (datei) pb.ladeDateiHoch(props.eintrag, props.ziel, datei)
}

function verlassen() {
    if (pb.ziehMerker.value === merker.value) pb.ziehMerker.value = ''
}
</script>

<template>
    <div v-if="ziel" class="ablage-reihe">
        <label :class="['ablage', { hervorgehoben }]"
            @dragover.prevent="pb.ziehMerker.value = merker" @dragenter.prevent="pb.ziehMerker.value = merker"
            @dragleave="verlassen" @drop.prevent="abgelegt">
            <input type="file" accept="image/*" class="versteckt" @change="gewaehlt" />
            <Symbol name="bildPlus" :groesse="18" />
            <span>{{ t('playbook.bildAblage') }}</span>
        </label>
        <Knopf v-if="pb.kopiertesBild.value?.objectId" klein symbol="zwischenablage"
            @click="pb.kopiertesEinfuegen(eintrag, ziel)">
            {{ t('playbook.kopiertesBildEinfuegen') }}
        </Knopf>
    </div>
</template>

<style scoped>
.ablage-reihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.ablage {
    position: relative;
    display: inline-flex;
    flex: 1 1 14rem;
    align-items: center;
    gap: var(--abstand-2);
    min-width: 0;
    padding: var(--abstand-3) var(--abstand-4);
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius-knopf);
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
}

.ablage:hover,
.ablage.hervorgehoben {
    border-color: var(--accent);
    background: var(--accent-flaeche);
    color: var(--text);
}

.versteckt {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}
</style>
