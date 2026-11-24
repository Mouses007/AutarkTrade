<script setup>
/*
 * Schnellschalter des Momentum Radars als eigene Zeile — am Handy stehen sie unter den
 * Momentum-Infos (Schublade rechts unten und Box unter dem Chart) statt neben dem
 * Fenstertitel im Chart, wo sie auf dem schmalen Schirm abgeschnitten waren.
 * Dieselben Schalter wie im Panel (MOMENTUM_SCHNELL); ohne Radar im Chart zeigt sie nichts.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MOMENTUM_SCHNELL, saubereParams } from '../../utils/chart/indikatorRegister.js'

const props = defineProps({ panel: { type: Object, required: true } })
const emit = defineEmits(['schalte'])   // { id, patch }
const { t } = useI18n()

const radar = computed(() => (props.panel.indikatoren || []).find((x) => x.typ === 'momentum' && x.sichtbar !== false))
const schalter = computed(() => {
    if (!radar.value) return []
    const p = saubereParams('momentum', radar.value.params)
    return MOMENTUM_SCHNELL.map((s) => ({ ...s, an: s.keys.some((k) => p[k]) }))
})
function schalte(s) {
    emit('schalte', { id: radar.value.id, patch: Object.fromEntries(s.keys.map((k) => [k, !s.an])) })
}
</script>

<template>
    <div v-if="schalter.length" class="radarSchnell" role="group" :aria-label="t('chart.radarSchnell.titel')">
        <div class="titel">{{ t('chart.radarSchnell.titel') }}</div>
        <div class="knoepfe">
            <button v-for="s in schalter" :key="s.id" type="button" :class="{ an: s.an }" :aria-pressed="s.an"
                :title="t(s.an ? 'chart.ausblenden' : 'chart.einblenden') + ': ' + t('chart.radarSchnell.' + s.id)"
                @click="schalte(s)">{{ t('chart.radarSchnell.' + s.id) }}</button>
        </div>
    </div>
</template>

<style scoped>
.radarSchnell {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
}

.titel {
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 12px;
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

button {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
}

button.an {
    color: var(--text);
    border-color: var(--accent-rand);
    background: var(--accent-flaeche);
}
</style>
