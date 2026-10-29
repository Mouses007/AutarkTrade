<script setup>
/**
 * Chart & Analyse → Heatmap / Bookmap. Die Werte liegen im Live-Store und
 * speichern sich dort selbst in die settings-Tabelle.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import {
    liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp, liveShowProfile,
    livePauseInBackground, liveColorMode, liveColorRef, liveAutoFollow, liveThreshold, liveDotStep,
    liveShowLiquidations, livePrefillMin,
    VIEW_PCT_OPTIONS, FRAME_MS_OPTIONS, HISTORY_MIN_OPTIONS,
} from '@/stores/live.js'

const { t } = useI18n()

let liveExpanded = ref(false)
</script>

<template>
    <Abschnitt :titel="t('settings.live.heatmap.titel')" symbol="flamme" v-model:offen="liveExpanded">
        <p class="einleitung">{{ t('settings.live.heatmap.einleitung') }}</p>

        <Feld :label="t('settings.live.heatmap.markt')">
            <select class="eingabe" v-model="liveMarket">
                <option value="futures">{{ t('settings.live.heatmap.marktFutures') }}</option>
                <option value="spot">{{ t('settings.live.heatmap.marktSpot') }}</option>
            </select>
        </Feld>

        <Feld :label="t('settings.live.heatmap.preisband')" :hilfe="t('settings.live.heatmap.preisbandHilfe')">
            <select class="eingabe" v-model.number="liveViewPct">
                <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
            </select>
        </Feld>

        <Feld :label="t('settings.live.heatmap.spaltentakt')" :hilfe="t('settings.live.heatmap.spaltentaktHilfe')">
            <select class="eingabe" v-model.number="liveFrameMs">
                <option v-for="f in FRAME_MS_OPTIONS" :key="f" :value="f">{{ f }} ms</option>
            </select>
        </Feld>

        <Feld :label="t('settings.live.heatmap.historie')" :hilfe="t('settings.live.heatmap.historieHilfe')">
            <select class="eingabe" v-model.number="liveHistoryMin">
                <option v-for="h in HISTORY_MIN_OPTIONS" :key="h" :value="h">{{ h ? t('settings.live.heatmap.minuten', { n: h }) : t('settings.live.heatmap.historieAuto') }}</option>
            </select>
        </Feld>

        <Feld>
            <template #label><span class="beschriftung">{{ t('settings.live.heatmap.farbrampe') }}<InfoTipp schluessel="settings.info.liveRamp" /></span></template>
            <select class="eingabe" v-model="liveRamp">
                <option value="viridis">{{ t('settings.live.heatmap.rampeViridis') }}</option>
                <option value="bookmap">{{ t('settings.live.heatmap.rampeKlassisch') }}</option>
                <option value="journal">{{ t('settings.live.heatmap.rampeJournal') }}</option>
            </select>
        </Feld>

        <Feld :label="t('settings.live.heatmap.farbskala')" :hilfe="t('settings.live.heatmap.farbskalaHilfe')">
            <div class="gruppe">
                <select class="eingabe" v-model="liveColorMode">
                    <option value="auto">{{ t('settings.live.heatmap.skalaAuto') }}</option>
                    <option value="fixed">{{ t('settings.live.heatmap.skalaFest') }}</option>
                </select>
                <input v-if="liveColorMode === 'fixed'" class="eingabe" type="number" min="0"
                    step="0.1" v-model.number="liveColorRef" :placeholder="t('settings.live.heatmap.skalaPlatzhalter')" />
            </div>
        </Feld>

        <Feld :label="t('settings.live.heatmap.vorlauf')" :hilfe="t('settings.live.heatmap.vorlaufHilfe')">
            <select class="eingabe" v-model.number="livePrefillMin">
                <option :value="0">{{ t('settings.live.heatmap.vorlaufAus') }}</option>
                <option v-for="m in [5, 15, 30, 60]" :key="m" :value="m">{{ t('settings.live.heatmap.minuten', { n: m }) }}</option>
            </select>
        </Feld>

        <Feld :label="t('settings.live.heatmap.schwelle')" :hilfe="t('settings.live.heatmap.schwelleHilfe')">
            <div class="regler">
                <input type="range" min="0" max="0.9" step="0.05" v-model.number="liveThreshold" />
                <span class="wert">{{ Math.round(liveThreshold * 100) }} %</span>
            </div>
        </Feld>

        <Feld :label="t('settings.live.heatmap.punkte')" :hilfe="t('settings.live.heatmap.punkteHilfe')">
            <div class="regler">
                <input type="range" min="1" max="30" step="1" v-model.number="liveDotStep" />
                <span class="wert">{{ liveDotStep === 1 ? t('settings.live.heatmap.punkteAus') : liveDotStep + ' px' }}</span>
            </div>
        </Feld>

        <Feld :label="t('settings.live.heatmap.verhalten')">
            <Schalter v-model="liveAutoFollow" :label="t('settings.live.heatmap.folgen')"
                :hilfe="t('settings.live.heatmap.folgenHilfe')" />
            <Schalter v-model="liveShowProfile" :label="t('settings.live.heatmap.profil')" />
            <Schalter v-model="liveShowLiquidations" :label="t('settings.live.heatmap.liquidationen')"
                :hilfe="t('settings.live.heatmap.liquidationenHilfe')" />
            <Schalter v-model="livePauseInBackground" :label="t('settings.live.heatmap.pause')"
                :hilfe="t('settings.live.heatmap.pauseHilfe')" />
        </Feld>
    </Abschnitt>
</template>

<style scoped>
.einleitung {
    color: var(--muted);
    margin: 0 0 var(--abstand-3);
}
.beschriftung { color: var(--text); }
.eingabe {
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.gruppe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}
.gruppe .eingabe { flex: 1 1 10rem; width: auto; }
.regler {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
}
.regler input[type="range"] {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
}
.wert {
    min-width: 4rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}
</style>
