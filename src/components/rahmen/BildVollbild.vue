<script setup>
/**
 * Bild-Vollbild, einmal global im Rahmen eingehängt (docs/spec/f3-screenshots.md §9).
 *
 * Ein nativer Dialog; geöffnet nach einem anderen (z. B. dem Trade-Fenster der
 * Tagesansicht) liegt er obenauf, und Schliessen gibt den darunter frei.
 * ← und → blättern, solange der Fokus im Vollbild liegt; Esc schliesst nativ.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from '../basis/Dialog.vue'
import Knopf from '../basis/Knopf.vue'
import BildKarte from '../BildKarte.vue'
import { bilder, vollbildBild, vollbildIndex, vollbildOffen, markierungOffen } from '../../stores/journal/bilder.js'
import { bilderWerdenGeholt } from '../../stores/app/laden.js'
import { blaettereVollbild, schliesseVollbild } from '../../utils/bilder/vollbild.js'
import { formDatumLang } from '../../utils/journal/format.js'

const { t } = useI18n()
const inhaltEl = ref(null)

const hatAuswahl = computed(() => Object.keys(vollbildBild).length > 0)
const titel = computed(() => (vollbildBild.dateUnix != null ? formDatumLang(vollbildBild.dateUnix) : t('nav.screenshots')))

// Abhängig von Index UND Liste, damit ein nachgeladenes Häppchen „weiter" freigibt
const zurueckMoeglich = computed(() => Number.isInteger(vollbildIndex.value) && vollbildIndex.value >= 1)
const weiterMoeglich = computed(() => Number.isInteger(vollbildIndex.value) && vollbildIndex.value >= 0 && !!bilder[vollbildIndex.value + 1])

function taste(e) {
    if (!vollbildOffen.value || markierungOffen.value) return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const dialog = inhaltEl.value?.closest('dialog')
    if (!dialog || !dialog.contains(document.activeElement)) return
    e.preventDefault()
    blaettereVollbild(e.key === 'ArrowLeft' ? -1 : 1)
}

onMounted(() => window.addEventListener('keydown', taste))
onBeforeUnmount(() => window.removeEventListener('keydown', taste))
</script>

<template>
    <Dialog :model-value="vollbildOffen" :titel="titel" breite="100rem" @zu="schliesseVollbild">
        <div ref="inhaltEl" class="vollbild">
            <BildKarte v-if="hatAuswahl" :bild="vollbildBild" herkunft="vollbild" />
        </div>
        <template v-if="zurueckMoeglich || weiterMoeglich" #fuss>
            <div class="blaettern">
                <Knopf v-if="zurueckMoeglich" symbol="einklappen" @click="blaettereVollbild(-1)">{{ t('nav.vorheriges') }}</Knopf>
                <span v-else></span>
                <Knopf v-if="weiterMoeglich" symbol="ausklappen" :laedt="bilderWerdenGeholt" :disabled="bilderWerdenGeholt"
                    @click="blaettereVollbild(1)">{{ t('nav.naechstes') }}</Knopf>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.vollbild {
    display: flex;
    justify-content: center;
    min-width: 0;
}

.blaettern {
    display: flex;
    justify-content: space-between;
    gap: var(--abstand-3);
    width: 100%;
}
</style>
