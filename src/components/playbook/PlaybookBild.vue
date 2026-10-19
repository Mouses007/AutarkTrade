<script setup>
/**
 * Ein Bildfeld einer Bewertung (Eröffnung, Trend oder Abschluss). Holt die
 * Bilddaten erst, wenn es gezeichnet wird — also beim Aufklappen der Karte
 * (A-P8: die Liste kommt ohne Base64).
 */
import { computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import Kreisel from '@/components/basis/Kreisel.vue'
import Pille from '@/components/basis/Pille.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { usePlaybook } from './usePlaybook.js'
import { ID_FELD } from './playbookDaten.js'

const props = defineProps({
    eintrag: { type: Object, required: true },
    feld: { type: String, required: true },
    hoehe: { type: Number, default: 200 },
    /** Kreuz oben rechts zum Entfernen (Bearbeitungsmodus). */
    entfernbar: { type: Boolean, default: false },
})
const emit = defineEmits(['entfernen'])
const { t } = useI18n()
const pb = usePlaybook()

const treffer = computed(() => pb.bildTreffer(props.eintrag, props.feld))
watchEffect(() => {
    const id = treffer.value?.bild?.objectId
    if (id && !pb.bildDaten[id]) pb.holeBild(id)
})
const quelle = computed(() => pb.bildQuelle(props.eintrag, props.feld))
/** ID gesetzt, aber kein Bild in der Liste (älter als die 500 geladenen, andere Börse …). */
const nurVerknuepft = computed(() => !quelle.value && !!props.eintrag[ID_FELD[props.feld]])
</script>

<template>
    <div v-if="quelle" class="bild" :style="{ '--hoehe': hoehe + 'px' }">
        <span v-if="quelle.laedt" class="laedt"><Kreisel /></span>
        <button v-else type="button" class="zeigen" :title="t('incoming.screenshot')"
            @click="pb.zeigeVollbild(quelle)">
            <img :src="quelle.basis" alt="" />
            <img v-if="quelle.ebene" :src="quelle.ebene" alt="" class="ebene" />
        </button>
        <button v-if="entfernbar" type="button" class="weg" :title="t('common.remove')" :aria-label="t('common.remove')"
            @click.stop="emit('entfernen')">
            <Symbol name="schliessen" :groesse="14" />
        </button>
    </div>
    <Pille v-else-if="nurVerknuepft" ton="neutral" symbol="verknuepfung">{{ t('incoming.screenshotLinked') }}</Pille>
</template>

<style scoped>
.bild {
    position: relative;
    display: inline-block;
    max-width: 100%;
}

.zeigen {
    position: relative;
    display: block;
    max-width: 100%;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--bg);
    overflow: hidden;
    cursor: zoom-in;
}

.zeigen img {
    display: block;
    max-width: 100%;
    max-height: var(--hoehe);
    object-fit: contain;
}

/* Altzeilen: Markierungsebene genau über dem Original. */
.zeigen img.ebene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.laedt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 6rem;
    height: 4rem;
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius-klein);
}

.weg {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    display: inline-flex;
    padding: 0.25rem;
    border: none;
    border-radius: var(--radius-pille);
    background: color-mix(in srgb, var(--bg) 75%, transparent);
    color: var(--text);
    cursor: pointer;
}

.weg:hover {
    background: var(--bad);
}
</style>
