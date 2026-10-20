<script setup>
/**
 * Vollbild-Ansicht eines Screenshots mit Blättern (zurück/weiter).
 *
 * Geöffnet wird sie von aussen über `useSelectedScreenshotFunction(index,
 * quelle, daten)` aus `utils/screenshots.js`: die Funktion setzt die Auswahl
 * UND öffnet das Vollbild (`screenshotVollbildOffen`). Wer ohne neue Auswahl
 * öffnen oder schliessen will: `useOeffneScreenshotVollbild()` /
 * `useSchliesseScreenshotVollbild()`. Das Bootstrap-Modal `#fullScreenModal`
 * gibt es nicht mehr.
 *
 * Ein nativer Dialog liegt in der obersten Ebene über allem — auch über dem
 * Daily-Detailfenster, das darunter offen bleibt. Der Rückweg dorthin ist
 * deshalb einfach Schliessen.
 *
 * Hier hängt auch der Markierungseditor: diese Komponente ist einmal global
 * im Layout eingehängt, so kann jede Ansicht `useSetupMarkerArea` rufen,
 * ohne den Editor selbst einzubinden.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from '../basis/Dialog.vue'
import Symbol from '../basis/Symbol.vue'
import Kreisel from '../basis/Kreisel.vue'
import Screenshot from '../Screenshot.vue'
import BildMarkierung from '../bildmarkierung/BildMarkierung.vue'
import { selectedScreenshotIndex } from '../../stores/ui.js'
import { screenshots, gewaehltesBild } from '../../stores/trades.js'
import { holtWeitere } from '../../stores/filters.js'
import {
    useSelectedScreenshotFunction, screenshotVollbildOffen, useSchliesseScreenshotVollbild,
} from '../../utils/screenshots.js'
import { formDatumLang } from '../../utils/journal/format.js'

const { t } = useI18n()

const index = computed(() => selectedScreenshotIndex.value)
const hatBild = computed(() => Object.keys(gewaehltesBild).length > 0)
const mitZurueck = computed(() => Number.isInteger(index.value) && index.value - 1 >= 0)
const mitWeiter = computed(() => Number.isInteger(index.value) && index.value + 1 > 0 && !!screenshots[index.value + 1])
const titel = computed(() => (gewaehltesBild.dateUnix ? formDatumLang(gewaehltesBild.dateUnix) : t('nav.screenshots')))

function blaettere(schritt) {
    useSelectedScreenshotFunction(index.value + schritt, 'fullScreen')
}

function offenSetzen(wert) {
    if (!wert) useSchliesseScreenshotVollbild()
}

/** Pfeiltasten blättern, solange das Vollbild den Fokus hat. */
function taste(e) {
    if (e.key === 'ArrowLeft' && mitZurueck.value) blaettere(-1)
    else if (e.key === 'ArrowRight' && mitWeiter.value && !holtWeitere.value) blaettere(1)
}
</script>

<template>
    <Dialog :model-value="screenshotVollbildOffen" :titel="titel" breite="100rem" @update:model-value="offenSetzen" @keydown="taste">
        <div class="inhalt">
            <Screenshot v-if="hatBild" :index="index" source="fullScreen" :screenshot-data="gewaehltesBild" />
        </div>
        <template v-if="mitZurueck || mitWeiter" #fuss>
            <div class="blaetterleiste">
                <button v-if="mitZurueck" type="button" class="blaettern" :title="t('nav.vorheriges')"
                    :aria-label="t('nav.vorheriges')" @click="blaettere(-1)">
                    <Symbol name="einklappen" :groesse="22" />
                </button>
                <span v-else></span>
                <button v-if="mitWeiter" type="button" class="blaettern" :disabled="holtWeitere" :title="t('nav.naechstes')"
                    :aria-label="t('nav.naechstes')" @click="blaettere(1)">
                    <Kreisel v-if="holtWeitere" :groesse="18" />
                    <Symbol v-else name="ausklappen" :groesse="22" />
                </button>
            </div>
        </template>
    </Dialog>
    <BildMarkierung />
</template>

<style scoped>
.inhalt {
    min-height: 0;
}

.blaetterleiste {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.blaettern {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
}

.blaettern:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent-rand);
}

.blaettern:disabled {
    cursor: wait;
}
</style>
