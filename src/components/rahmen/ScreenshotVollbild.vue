<script setup>
/**
 * Vollbild-Ansicht eines Screenshots mit Blättern (zurück/weiter).
 *
 * Geöffnet wird sie von aussen: `components/Screenshot.vue` und
 * `views/Daily.vue` setzen per `useSelectedScreenshotFunction(index, quelle,
 * daten)` die Auswahl und öffnen das Fenster über
 * `data-bs-toggle="modal" data-bs-target="#fullScreenModal"`.
 *
 * S9-Teil2: Das Markup ist deshalb noch ein Bootstrap-Modal mit der festen ID
 * `fullScreenModal`. Fällt Bootstrap weg, wird es ein `basis/Dialog.vue`, und
 * die beiden Öffner rufen statt des data-Attributs eine Funktion auf.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import Screenshot from '../Screenshot.vue'
import { selectedScreenshotIndex } from '../../stores/ui.js'
import { screenshots, selectedScreenshot } from '../../stores/trades.js'
import { getMore } from '../../stores/filters.js'
import { useSelectedScreenshotFunction } from '../../utils/screenshots.js'

const { t } = useI18n()

const index = computed(() => selectedScreenshotIndex.value)
const hatBild = computed(() => Object.keys(selectedScreenshot).length > 0)
const mitZurueck = computed(() => Number.isInteger(index.value) && index.value - 1 >= 0)
const mitWeiter = computed(() => Number.isInteger(index.value) && index.value + 1 > 0 && !!screenshots[index.value + 1])

function blaettere(schritt) {
    useSelectedScreenshotFunction(index.value + schritt, 'fullScreen')
}
</script>

<template>
    <!-- S9-Teil2: Bootstrap-Modal (Klassen modal/modal-dialog/modal-content), bis die Öffner umgestellt sind. -->
    <div id="fullScreenModal" class="modal fade" tabindex="-1" aria-hidden="true" :aria-label="t('nav.screenshots')">
        <div class="modal-dialog modal-fullscreen">
            <div class="modal-content at-vollbild">
                <div class="inhalt">
                    <Screenshot v-if="hatBild" :index="index" source="fullScreen" :screenshot-data="selectedScreenshot" />
                </div>
                <div class="fuss">
                    <button v-if="mitZurueck" type="button" class="blaettern" :title="t('nav.vorheriges')"
                        :aria-label="t('nav.vorheriges')" @click="blaettere(-1)">
                        <Symbol name="einklappen" :groesse="22" />
                    </button>
                    <span v-else></span>
                    <button v-if="mitWeiter" type="button" class="blaettern" :disabled="getMore" :title="t('nav.naechstes')"
                        :aria-label="t('nav.naechstes')" @click="blaettere(1)">
                        <span v-if="getMore" class="kreisel" aria-hidden="true"></span>
                        <Symbol v-else name="ausklappen" :groesse="22" />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.at-vollbild {
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 0;
    border-radius: 0;
}

.inhalt {
    flex: 1 1 auto;
    overflow: auto;
    padding: var(--abstand-3);
}

.fuss {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--abstand-2) var(--abstand-4);
    border-top: 1px solid var(--line);
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

.kreisel {
    width: 18px;
    height: 18px;
    border: 2px solid var(--line-stark);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: at-dreh 0.8s linear infinite;
}

@keyframes at-dreh {
    to { transform: rotate(360deg); }
}
</style>
