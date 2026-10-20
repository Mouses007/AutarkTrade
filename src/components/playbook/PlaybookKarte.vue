<script setup>
/**
 * Eine Bewertungskarte: Kopf (Klick klappt auf/zu), im zugeklappten Zustand
 * eine Zusammenfassung, offen die Ansicht oder die Bearbeitung.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'
import Pille from '@/components/basis/Pille.vue'
import { formDatumLang } from '@/utils/journal/format.js'
import { tagAngaben } from '@/utils/journal/tagebuch.js'
import { usePlaybook } from './usePlaybook.js'
import { hatDaten, seite } from './playbookDaten.js'
import PlaybookTyp from './PlaybookTyp.vue'
import PlaybookAnsicht from './PlaybookAnsicht.vue'
import PlaybookBearbeiten from './PlaybookBearbeiten.vue'

const props = defineProps({
    eintrag: { type: Object, required: true },
})
const { t, te } = useI18n()
const pb = usePlaybook()
const e = computed(() => props.eintrag)

const offen = computed(() => pb.offenId.value === e.value.tradeId)
const bearbeitet = computed(() => pb.bearbeitenId.value === e.value.tradeId)
const plakette = computed(() => seite(e.value.side))
const emoji = computed(() => ({ 1: '👍', 2: '✊', 0: '👎' })[e.value.satisfaction] || '')
const pnlText = computed(() => (e.value.pnl >= 0 ? '+' : '') + e.value.pnl.toFixed(2))
const zeitrahmen = (wert) => (te(`timeframes.${wert}`) ? t(`timeframes.${wert}`) : wert)
const tagFarbe = (tag) => tag.color || tagAngaben(tag.id).farbe
</script>

<template>
    <article :id="`playbook-${e.tradeId}`" :class="['pb-karte', { offen, bearbeitet }]">
        <div class="kopf" role="button" tabindex="0" :aria-expanded="offen"
            @click="pb.umschalten(e)" @keydown.enter.self.prevent="pb.umschalten(e)" @keydown.space.self.prevent="pb.umschalten(e)">
            <div class="links">
                <strong class="symbol">{{ e.symbol }}</strong>
                <span v-if="e.side" :class="['seite', plakette.long ? 'long' : 'short']">{{ plakette.text }}</span>
                <button v-if="offen && !bearbeitet" type="button" class="stift" :title="t('common.edit')" :aria-label="t('common.edit')"
                    @click.stop="pb.bearbeiten(e)">
                    <Symbol name="stift" :groesse="15" />
                </button>
                <span class="datum">{{ formDatumLang(e.dateUnix) }}</span>
            </div>
            <div class="rechts">
                <span v-if="emoji" class="emoji">{{ emoji }}</span>
                <span v-if="e.pnl !== 0" :class="['pnl', e.pnl >= 0 ? 'gewinn' : 'verlust']">{{ pnlText }}</span>
                <Symbol :name="offen ? 'hoch' : 'runter'" :groesse="16" class="pfeil" />
            </div>
        </div>

        <div v-if="!offen && hatDaten(e)" class="zusammenfassung">
            <PlaybookTyp v-if="e.tradeType || e.closingTradeType" :eroeffnung="e.tradeType" :abschluss="e.closingTradeType" />
            <Pille v-if="e.entryStressLevel > 0" ton="neutral">{{ t('incoming.stress') }} {{ e.entryStressLevel }}/10</Pille>
            <Pille v-if="e.timeframe" ton="neutral">{{ zeitrahmen(e.timeframe) }}</Pille>
            <span v-for="tag in e.tags" :key="'o' + tag.id" class="tag" :style="{ background: tag.color || 'transparent' }">{{ tag.name }}</span>
            <span v-for="tag in e.closingTags" :key="'c' + tag.id" class="tag abschluss" :style="{ background: tagFarbe(tag) }">{{ tag.name }}</span>
        </div>

        <div v-if="offen" class="inhalt">
            <PlaybookBearbeiten v-if="bearbeitet" :eintrag="e" />
            <PlaybookAnsicht v-else :eintrag="e" />
        </div>
    </article>
</template>

<style scoped>
.pb-karte {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    transition: border-color 0.15s;
}

.pb-karte.offen {
    border-color: var(--line-stark);
}

.pb-karte.bearbeitet {
    border-color: var(--accent-rand);
}

.kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-2) var(--abstand-3);
    padding: var(--abstand-3) var(--abstand-4);
    cursor: pointer;
    border-radius: var(--radius);
}

.kopf:hover {
    background: var(--panel-soft);
}

.kopf:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}

.links,
.rechts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    min-width: 0;
}

.rechts {
    margin-left: auto;
}

.symbol {
    font-size: 1.05rem;
    overflow-wrap: anywhere;
}

.seite {
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-pille);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.03em;
}

.seite.long { background: var(--good-flaeche); color: var(--good); }
.seite.short { background: var(--bad-flaeche); color: var(--bad); }

.stift {
    display: inline-flex;
    padding: 0.25rem;
    border: none;
    border-radius: var(--radius-klein);
    background: none;
    color: var(--muted);
    cursor: pointer;
}

.stift:hover {
    background: var(--panel-hoch);
    color: var(--accent);
}

.datum {
    color: var(--muted);
    font-size: 0.82rem;
}

.emoji {
    font-size: 1.05rem;
}

.pnl {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.pnl.gewinn { color: var(--good); }
.pnl.verlust { color: var(--bad); }

.pfeil {
    color: var(--muted);
}

.zusammenfassung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1) var(--abstand-2);
    padding: 0 var(--abstand-4) var(--abstand-3);
}

/* Tag-Farbe kommt aus dem Katalog des Nutzers, daher inline. Frisch
   hinzugefügte Tags haben bis zum Speichern noch keine Farbe. */
.tag {
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pille);
    color: var(--text);
    font-size: 0.74rem;
    font-weight: 600;
}

.tag.abschluss {
    opacity: 0.7;
}

.inhalt {
    padding: 0 var(--abstand-4) var(--abstand-4);
}

@media (max-width: 480px) {
    .kopf,
    .zusammenfassung,
    .inhalt {
        padding-left: var(--abstand-3);
        padding-right: var(--abstand-3);
    }
}
</style>
