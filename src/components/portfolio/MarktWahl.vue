<script setup>
/**
 * Zwei Kästchen je Börse in den API-Einstellungen: Futures (Journal) und
 * Spot (Portfolio). Futures aus = die Börse verschwindet aus dem Journal und
 * wird nicht mehr nach Positionen gefragt; der Schlüssel bleibt. Börsen ohne
 * Futures (Bitpanda) zeigen das Kästchen ausgegraut.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { boersenMaerkte, setzeBoersenMarkt, BOERSEN } from '../../stores/portfolio.js'
import { appEinstellungen } from '../../stores/settings.js'
import { vergissBoersenZugang } from '../../utils/boersenZugang.js'

const props = defineProps({ boerse: { type: String, required: true } })
const { t } = useI18n()
const w = computed(() => boersenMaerkte(appEinstellungen.value)[props.boerse])
const hatFutures = computed(() => BOERSEN.find((b) => b.id === props.boerse)?.futures)
const portfolioAn = computed(() => Number(appEinstellungen.value?.modusPortfolioAn ?? 1) === 1)

async function setze(markt, an) {
    await setzeBoersenMarkt(props.boerse, markt, an)
    if (markt === 'futures') vergissBoersenZugang()
}
</script>

<template>
    <div class="mw">
        <label :class="{ aus: !hatFutures }" :title="hatFutures ? '' : t('portfolio.keineFutures')">
            <input type="checkbox" :checked="w.futures" :disabled="!hatFutures" @change="setze('futures', $event.target.checked)" />
            <span>{{ t('portfolio.marktFutures') }}</span>
        </label>
        <label v-if="portfolioAn">
            <input type="checkbox" :checked="w.spot" @change="setze('spot', $event.target.checked)" />
            <span>{{ t('portfolio.marktSpot') }}</span>
        </label>
    </div>
</template>

<style scoped>
.mw { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; margin-bottom: var(--abstand-3); padding: 0.55rem 0.75rem; background: var(--panel-soft); border-radius: var(--radius-knopf); }
.mw label { display: inline-flex; gap: 0.45rem; align-items: center; font-size: 0.88rem; cursor: pointer; }
.mw label.aus { opacity: 0.45; cursor: not-allowed; }
.mw input { accent-color: var(--accent); width: 1rem; height: 1rem; }
</style>
