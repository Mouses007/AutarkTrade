<script setup>
/**
 * Offene Karte im Ansichtsmodus: Eröffnungsbewertung, Füllungen,
 * Abschlussbewertung — jeder Block nur, wenn er etwas zu zeigen hat.
 * Alles HTML läuft vor `v-html` durch `sanitizeHtml`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Knopf from '@/components/basis/Knopf.vue'
import { sanitizeHtml } from '@/utils/sanitize.js'
import { tagAngaben } from '@/utils/journal/tagebuch.js'
import { usePlaybook } from './usePlaybook.js'
import { hatDaten, hatText, hatMetadaten } from './playbookDaten.js'
import PlaybookBild from './PlaybookBild.vue'
import PlaybookFuellungen from './PlaybookFuellungen.vue'
import PlaybookTyp from './PlaybookTyp.vue'

const props = defineProps({
    eintrag: { type: Object, required: true },
})
const { t, te } = useI18n()
const zeitrahmen = (wert) => (te(`timeframes.${wert}`) ? t(`timeframes.${wert}`) : wert)
const pb = usePlaybook()
const e = computed(() => props.eintrag)

const bildEroeffnung = computed(() => !!pb.bildQuelle(e.value, 'entry'))
const bildTrend = computed(() => !!pb.bildQuelle(e.value, 'trend'))
const bildAbschluss = computed(() => !!pb.bildQuelle(e.value, 'closing'))

const zeigeEroeffnung = computed(() => {
    const x = e.value
    return !!(x.tradeType || x.entryStressLevel > 0 || x.tags.length || x.timeframe || x.emotionLevel > 0
        || x.feelings || hatText(x.playbook) || bildEroeffnung.value || bildTrend.value)
})
const zeigeAbschluss = computed(() => {
    const x = e.value
    return !!(x.closingTags.length || hatText(x.closingPlaybook) || x.closingNote
        || x.satisfaction !== null || bildAbschluss.value)
})
const zeigeFuellungen = computed(() => hatMetadaten(e.value.tradingMetadata))

/** Niedrig/mittel/hoch; beim Emotionslevel umgekehrt gefärbt (hoch = gut). */
function stufe(n, umgekehrt = false) {
    const s = n <= 3 ? 'niedrig' : n <= 6 ? 'mittel' : 'hoch'
    if (!umgekehrt) return s
    return s === 'niedrig' ? 'hoch' : s === 'hoch' ? 'niedrig' : s
}

const tagFarbe = (tag) => tag.color || tagAngaben(tag.id).farbe
const zufriedenheitEmoji = (s) => (s === 1 ? '👍' : s === 2 ? '✊' : '👎')
</script>

<template>
    <div class="ansicht">
        <template v-if="hatDaten(e) || zeigeEroeffnung || zeigeAbschluss || zeigeFuellungen">
            <section v-if="zeigeEroeffnung" class="block gruen">
                <h4>{{ t('incoming.openingEvaluation') }}</h4>
                <div class="raster">
                    <div v-if="e.tradeType || e.closingTradeType" class="feld">
                        <span class="at-label">{{ t('incoming.tradeType') }}</span>
                        <PlaybookTyp :eroeffnung="e.tradeType" :abschluss="e.closingTradeType" />
                    </div>
                    <div v-if="e.timeframe" class="feld">
                        <span class="at-label">{{ t('incoming.timeframe') }}</span>
                        <span>{{ zeitrahmen(e.timeframe) }}</span>
                    </div>
                    <div v-if="e.entryStressLevel > 0" class="feld">
                        <span class="at-label">{{ t('incoming.stressLevel') }}</span>
                        <div class="balken-zeile">
                            <span class="balken"><span :class="['fuellung', stufe(e.entryStressLevel)]" :style="{ width: e.entryStressLevel * 10 + '%' }"></span></span>
                            <span>{{ e.entryStressLevel }}/10</span>
                        </div>
                    </div>
                    <div v-if="e.emotionLevel > 0" class="feld">
                        <span class="at-label">{{ t('incoming.emotionLevel') }}</span>
                        <div class="balken-zeile">
                            <span class="balken"><span :class="['fuellung', stufe(e.emotionLevel, true)]" :style="{ width: e.emotionLevel * 10 + '%' }"></span></span>
                            <span>{{ e.emotionLevel }}/10</span>
                        </div>
                    </div>
                    <div v-if="e.feelings" class="feld">
                        <span class="at-label">{{ t('incoming.emotions') }}</span>
                        <span class="vorformatiert">{{ e.feelings }}</span>
                    </div>
                    <div v-if="hatText(e.playbook)" class="feld breit">
                        <span class="at-label">{{ t('incoming.note') }}</span>
                        <div class="notiz" v-html="sanitizeHtml(e.playbook)"></div>
                    </div>
                    <div v-if="e.tags.length" class="feld breit">
                        <span class="at-label">{{ t('incoming.tags') }}</span>
                        <div class="tags">
                            <span v-for="tag in e.tags" :key="tag.id" class="tag" :style="{ background: tagFarbe(tag) }">{{ tag.name }}</span>
                        </div>
                    </div>
                    <div v-if="bildEroeffnung || bildTrend" class="feld breit">
                        <span class="at-label">{{ t('incoming.screenshot') }}</span>
                        <div class="bilder">
                            <PlaybookBild :eintrag="e" feld="entry" :hoehe="200" />
                            <PlaybookBild :eintrag="e" feld="trend" :hoehe="200" />
                        </div>
                    </div>
                </div>
            </section>

            <PlaybookFuellungen v-if="zeigeFuellungen" :eintrag="e" />

            <section v-if="zeigeAbschluss" class="block blau">
                <h4>{{ t('incoming.closingEvaluation') }}</h4>
                <div class="raster">
                    <div v-if="hatText(e.closingPlaybook)" class="feld breit">
                        <span class="at-label">{{ t('incoming.note') }}</span>
                        <div class="notiz" v-html="sanitizeHtml(e.closingPlaybook)"></div>
                    </div>
                    <div v-else-if="e.closingNote" class="feld breit">
                        <span class="at-label">{{ t('incoming.closingNote') }}</span>
                        <div class="notiz" v-html="sanitizeHtml(e.closingNote)"></div>
                    </div>
                    <div v-if="e.closingTags.length" class="feld breit">
                        <span class="at-label">{{ t('incoming.tags') }}</span>
                        <div class="tags">
                            <span v-for="tag in e.closingTags" :key="tag.id" class="tag" :style="{ background: tagFarbe(tag) }">{{ tag.name }}</span>
                        </div>
                    </div>
                    <div v-if="e.satisfaction !== null" class="feld">
                        <span class="at-label">{{ t('incoming.satisfaction') }}</span>
                        <span class="emoji">{{ zufriedenheitEmoji(e.satisfaction) }}</span>
                    </div>
                    <div v-if="bildAbschluss" class="feld breit">
                        <span class="at-label">{{ t('incoming.screenshot') }}</span>
                        <PlaybookBild :eintrag="e" feld="closing" :hoehe="200" />
                    </div>
                </div>
            </section>
        </template>

        <div v-if="!hatDaten(e)" class="keine">
            <p>{{ t('playbook.noEvaluation') }}</p>
            <Knopf art="haupt" klein symbol="stift" @click="pb.bearbeiten(e)">{{ t('playbook.evaluateNow') }}</Knopf>
        </div>
    </div>
</template>

<style scoped>
.ansicht {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-3);
}

.block {
    padding: var(--abstand-3) var(--abstand-4);
    border: 1px solid var(--line);
    border-left: 3px solid var(--muted);
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
}

.block.gruen { border-left-color: var(--good); }
.block.blau { border-left-color: var(--accent); }

h4 {
    margin: 0 0 var(--abstand-3);
    font-size: 0.9rem;
    font-weight: 700;
}

.raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
    gap: var(--abstand-3) var(--abstand-4);
}

.feld {
    min-width: 0;
}

.feld.breit {
    grid-column: 1 / -1;
}

.feld .at-label {
    margin-bottom: 0.2rem;
}

.balken-zeile {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    font-size: 0.85rem;
}

.balken {
    flex: 1 1 auto;
    max-width: 8rem;
    height: 6px;
    border-radius: var(--radius-pille);
    background: var(--line);
    overflow: hidden;
}

.fuellung {
    display: block;
    height: 100%;
    border-radius: inherit;
}

.fuellung.niedrig { background: var(--good); }
.fuellung.mittel { background: var(--warn); }
.fuellung.hoch { background: var(--bad); }

.vorformatiert {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.notiz {
    font-size: 0.9rem;
    overflow-wrap: anywhere;
}

.notiz :deep(p) {
    margin: 0 0 0.4rem;
}

.notiz :deep(img) {
    max-width: 100%;
}

.tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

/* Tag-Farbe kommt aus dem Katalog des Nutzers, daher inline. */
.tag {
    padding: 0.1rem 0.55rem;
    border-radius: var(--radius-pille);
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 600;
}

.bilder {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}

.emoji {
    font-size: 1.3rem;
}

.keine {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-3);
    color: var(--muted);
}

.keine p {
    margin: 0;
}
</style>
