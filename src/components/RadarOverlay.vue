<script setup>
/**
 * Gross-Ansicht einer Kachel.
 *
 * Gleiches Muster wie `PageInfo.vue`: Teleport an den Body, damit weder das
 * Kachelraster noch ein `overflow` der Kopfzeile den Kasten beschneidet.
 * Bewusst kein Bootstrap-Modal — dessen Einblend-Animation ändert die Breite
 * nachträglich, und ein ECharts-Chart darin wäre beim ersten Zeichnen zu schmal.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ebeneAuf, ebeneZu } from '../composables/useZurueckGeste.js'
import InfoTipp from './InfoTipp.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Quellenhinweis from '@/components/basis/Quellenhinweis.vue'

defineProps({
    titel: { type: String, default: '' },
    /** Erklärtext-Schlüssel wie bei `RadarKachel` — sonst wäre ausgerechnet
     *  die Gross-Ansicht die einzige Stelle ohne Erklärung. */
    infoKey: { type: String, default: '' },
    /**
     * Herkunft der Daten, klein in der Fusszeile. Heute ein Text aus der
     * Registry; S12 kann Quellen-Objekte (`[{ name, url, art }]`, siehe
     * `basis/Quellenhinweis.vue`) übergeben, dann stehen Pflicht-Attributionen
     * mit Link und vorgegebenem Wortlaut da.
     */
    quelle: { type: [String, Array], default: '' },
})

const emit = defineEmits(['schliessen'])

const { t } = useI18n()
const boxEl = ref(null)

function beiTaste(e) {
    if (e.key === 'Escape') emit('schliessen')
}

/**
 * Am Handy gibt es kein Esc — dort ist die Zurück-Geste der übliche Weg
 * hinaus. Ohne das hier verliesse sie die ganze Seite.
 */
const schliesseDurchGeste = () => emit('schliessen')

onMounted(() => {
    boxEl.value?.focus()
    ebeneAuf(schliesseDurchGeste)
})

// Läuft auch, wenn über Knopf, Hintergrund oder Esc geschlossen wurde —
// dann wird der eigene Verlaufseintrag wieder abgeräumt.
onBeforeUnmount(() => ebeneZu(schliesseDurchGeste))
</script>

<template>
    <Teleport to="body">
        <div class="radarOverlay" tabindex="0" ref="boxEl" @click.self="emit('schliessen')" @keydown="beiTaste">
            <div class="radarOverlayBox">
                <div class="radarOverlayHead">
                    <h5>{{ titel }}<InfoTipp v-if="infoKey" :schluessel="infoKey" /></h5>
                    <button type="button" class="radarOverlayClose" :title="t('common.close')"
                        @click="emit('schliessen')">
                        <Symbol name="schliessen" />
                    </button>
                </div>

                <div class="radarOverlayBody">
                    <slot></slot>
                </div>

                <div v-if="quelle && quelle.length" class="radarOverlayFuss">
                    <Quellenhinweis :quellen="Array.isArray(quelle) ? quelle : [{ name: quelle }]" class="at-m-0" />
                </div>
            </div>
        </div>
    </Teleport>
</template>
