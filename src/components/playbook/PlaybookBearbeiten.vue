<script setup>
/**
 * Offene Karte im Bearbeitungsmodus. Die Eingaben schreiben direkt in den
 * Eintrag (im Speicher); „Abbrechen“ legt die beim Start gehaltene Kopie zurück,
 * „Speichern“ schreibt in die DB. Bilder sind die Ausnahme: Hochladen und
 * Entfernen wirken sofort — das sagt der Hinweis unter den Knöpfen, damit
 * niemand glaubt, „Abbrechen“ hole ein entferntes Bild zurück.
 *
 * Abschluss-Stress, -Emotion, -Gefühle und -Zeitrahmen haben bewusst keine
 * Eingabe; sie werden nur unverändert mitgeschrieben.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Knopf from '@/components/basis/Knopf.vue'
import { allTradeTimeframes, selectedTradeTimeframes } from '@/stores/journal/filter.js'
import { usePlaybook } from './usePlaybook.js'
import { TRADE_TYPEN } from './playbookDaten.js'
import PlaybookEditor from './PlaybookEditor.vue'
import PlaybookTags from './PlaybookTags.vue'
import PlaybookStufen from './PlaybookStufen.vue'
import PlaybookBild from './PlaybookBild.vue'
import PlaybookAblage from './PlaybookAblage.vue'

const props = defineProps({
    eintrag: { type: Object, required: true },
})
const { t } = useI18n()
const pb = usePlaybook()
const e = computed(() => props.eintrag)

const editorEroeffnung = ref(null)
const editorAbschluss = ref(null)

/** Gewählte Zeitrahmen in Katalog-Reihenfolge; ist keiner gewählt, alle. */
const zeitrahmen = computed(() => (selectedTradeTimeframes.length > 0
    ? allTradeTimeframes.value.filter(tf => selectedTradeTimeframes.includes(tf.value))
    : allTradeTimeframes.value))

const umschalten = (feld, wert) => { e.value[feld] = e.value[feld] === wert ? '' : wert }

const ZUFRIEDENHEIT = [{ wert: 1, emoji: '👍' }, { wert: 2, emoji: '✊' }, { wert: 0, emoji: '👎' }]
const zufrieden = (wert) => { e.value.satisfaction = e.value.satisfaction === wert ? null : wert }

const zielEroeffnung = computed(() => pb.eroeffnungsZiel(e.value))
const zielAbschluss = computed(() => (pb.feldBelegt(e.value, 'closing') ? null : 'closing'))
const speichert = computed(() => pb.speichertId.value === e.value.tradeId)

function speichern() {
    pb.speichern(e.value, {
        playbook: editorEroeffnung.value?.html(),
        closingPlaybook: editorAbschluss.value?.html(),
    })
}
</script>

<template>
    <div class="bearbeiten">
        <section class="block gruen">
            <h4>{{ t('incoming.openingEvaluation') }}</h4>

            <div class="feld">
                <span class="at-label">{{ t('incoming.tradeType') }}</span>
                <div class="knoepfe">
                    <button v-for="typ in TRADE_TYPEN" :key="typ.wert" type="button"
                        :class="['wahl', { aktiv: e.tradeType === typ.wert }]" :aria-pressed="e.tradeType === typ.wert"
                        @click="umschalten('tradeType', typ.wert)">{{ t(typ.schluessel) }}</button>
                </div>
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.timeframe') }}</span>
                <div class="knoepfe">
                    <button v-for="tf in zeitrahmen" :key="tf.value" type="button"
                        :class="['wahl', 'klein', { aktiv: e.timeframe === tf.value }]" :aria-pressed="e.timeframe === tf.value"
                        @click="umschalten('timeframe', tf.value)">{{ tf.label }}</button>
                </div>
            </div>

            <div class="zwei">
                <div class="feld">
                    <span class="at-label">{{ t('incoming.stressLevel') }}</span>
                    <PlaybookStufen v-model="e.entryStressLevel" :titel="t('incoming.stressLevel')" />
                </div>
                <div class="feld">
                    <span class="at-label">{{ t('incoming.emotionLevel') }}</span>
                    <PlaybookStufen v-model="e.emotionLevel" :titel="t('incoming.emotionLevel')" />
                </div>
            </div>

            <div class="feld">
                <label class="at-label" :for="`pb-gefuehle-${e.tradeId}`">{{ t('incoming.emotions') }}</label>
                <textarea :id="`pb-gefuehle-${e.tradeId}`" v-model="e.feelings" class="at-feld" rows="2"
                    :placeholder="t('incoming.emotionsPlaceholder')"></textarea>
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.note') }}</span>
                <PlaybookEditor ref="editorEroeffnung" :id="`quillPlaybook-${e.tradeId}-opening`" :anfang="e.playbook" />
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.tags') }}</span>
                <PlaybookTags :liste="e.tags" />
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.screenshot') }}</span>
                <div class="bilder">
                    <PlaybookBild :eintrag="e" feld="entry" :hoehe="150" entfernbar @entfernen="pb.entferne(e, 'entry')" />
                    <PlaybookBild :eintrag="e" feld="trend" :hoehe="150" entfernbar @entfernen="pb.entferne(e, 'trend')" />
                </div>
                <PlaybookAblage :eintrag="e" :ziel="zielEroeffnung" bereich="open" />
            </div>
        </section>

        <section class="block blau">
            <h4>{{ t('incoming.closingEvaluation') }}</h4>

            <div class="feld">
                <span class="at-label">{{ t('incoming.tradeType') }}</span>
                <div class="knoepfe">
                    <button v-for="typ in TRADE_TYPEN" :key="typ.wert" type="button"
                        :class="['wahl', { aktiv: e.closingTradeType === typ.wert }]" :aria-pressed="e.closingTradeType === typ.wert"
                        @click="umschalten('closingTradeType', typ.wert)">{{ t(typ.schluessel) }}</button>
                </div>
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.note') }}</span>
                <PlaybookEditor ref="editorAbschluss" :id="`quillPlaybook-${e.tradeId}-closing`" :anfang="e.closingPlaybook" />
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.tags') }}</span>
                <PlaybookTags :liste="e.closingTags" />
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.screenshot') }}</span>
                <div v-if="pb.feldBelegt(e, 'closing')" class="bilder">
                    <PlaybookBild :eintrag="e" feld="closing" :hoehe="200" />
                    <Knopf klein art="gefahr" symbol="muell" @click="pb.entferne(e, 'closing')">{{ t('common.remove') }}</Knopf>
                </div>
                <PlaybookAblage :eintrag="e" :ziel="zielAbschluss" bereich="closing" />
            </div>

            <div class="feld">
                <span class="at-label">{{ t('incoming.satisfaction') }}</span>
                <div class="knoepfe">
                    <button v-for="z in ZUFRIEDENHEIT" :key="z.wert" type="button"
                        :class="['emoji', { aktiv: e.satisfaction === z.wert }]" :aria-pressed="e.satisfaction === z.wert"
                        @click="zufrieden(z.wert)">{{ z.emoji }}</button>
                </div>
            </div>
        </section>

        <div class="fuss">
            <p class="hinweis">{{ t('playbook.bilderSofort') }}</p>
            <div class="aktionen">
                <Knopf :disabled="speichert" @click="pb.abbrechen()">{{ t('common.cancel') }}</Knopf>
                <Knopf art="haupt" symbol="speichern" :laedt="speichert" @click="speichern">{{ t('common.save') }}</Knopf>
            </div>
        </div>
    </div>
</template>

<style scoped>
.bearbeiten {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
}

.block {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
    padding: var(--abstand-3) var(--abstand-4);
    border: 1px solid var(--line);
    border-left: 3px solid var(--muted);
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
}

.block.gruen { border-left-color: var(--good); }
.block.blau { border-left-color: var(--accent); }

h4 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-1);
    min-width: 0;
}

.zwei {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: var(--abstand-3);
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.wahl {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-pille);
    background: var(--bg);
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
}

.wahl.klein {
    padding: 0.2rem 0.55rem;
    font-size: 0.76rem;
}

.wahl:hover {
    border-color: var(--accent);
    color: var(--text);
}

.wahl.aktiv {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
}

.emoji {
    padding: 0.2rem 0.45rem;
    border: 1px solid transparent;
    border-radius: var(--radius-knopf);
    background: none;
    font-size: 1.4rem;
    line-height: 1;
    filter: grayscale(1);
    opacity: 0.4;
    cursor: pointer;
}

.emoji.aktiv {
    border-color: var(--accent-rand);
    background: var(--accent-flaeche);
    filter: none;
    opacity: 1;
}

.emoji:hover {
    opacity: 0.8;
}

.bilder {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--abstand-2);
}

.fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-3);
}

.hinweis {
    flex: 1 1 14rem;
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
}

.aktionen {
    display: flex;
    gap: var(--abstand-2);
    margin-left: auto;
}
</style>
