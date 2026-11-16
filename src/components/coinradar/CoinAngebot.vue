<script setup>
/**
 * Coin-Ansicht, Karte «Token-Angebot»: wie viel es von dem Coin gibt und wie
 * viel davon im Umlauf ist.
 *
 * Mengen von CoinGecko (bis zu einem Tag alt — sie ändern sich langsam).
 * Marktkapitalisierung und voll verwässerte Bewertung (FDV) rechnet
 * `marktwerte` aus diesen Mengen und dem Börsenkurs von eben, wenn beide
 * sichtlich denselben Coin meinen; sonst stehen die Werte von CoinGecko da.
 * Die Fusszeile sagt, welcher Fall gilt.
 *
 * Der Satz zur Verwässerung ordnet ein Verhältnis ein. Ob und wann die
 * übrige Menge in den Umlauf kommt, steht nicht in diesen Zahlen — kein
 * Freigabeplan, keine Prognose.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Karte from '../basis/Karte.vue'
import Kreisel from '../basis/Kreisel.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import RadarQuellen from '../hype/RadarQuellen.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { verwaesserung, mengenBalken } from '../../utils/coinAnsicht.js'

const props = defineProps({
    info: { type: Object, default: undefined },
    /** Ergebnis von `marktwerte(info.markt, stueckPreis)`. */
    werte: { type: Object, default: null },
    laedt: { type: Boolean, default: false },
    aus: { type: Object, default: null },
})
const { t } = useI18n()
const { zahl, gross, usd, anteil, zeit } = useCoinFormat()

const markt = computed(() => props.info?.markt || null)
const balken = computed(() => mengenBalken(markt.value))
const dilution = computed(() => verwaesserung(props.werte?.marktkap, props.werte?.fdv))
const kapAnteil = computed(() => (dilution.value ? 100 / dilution.value.faktor : null))
const mengenSatz = computed(() => [
    props.werte?.umlaufAnteilPct != null ? t('coinAnsicht.umlaufAnteil_' + props.werte.deckeArt, { n: zahl(props.werte.umlaufAnteilPct, 1) }) : '',
    markt.value?.hoechstUnbegrenzt ? t('coinAnsicht.hoechstUnbegrenzt') : markt.value?.hoechst == null ? t('coinAnsicht.hoechstFehlt') : '',
].filter(Boolean).join(' '))
const hatEtwas = computed(() => balken.value.length || props.werte?.marktkap != null || props.werte?.fdv != null)
</script>

<template>
    <Karte :titel="t('coinAnsicht.angebot')" :unter="info ? t('coinAnsicht.angebotUnter') : ''">
        <div v-if="laedt" class="ca-laedt"><Kreisel :groesse="22" :titel="t('coinAnsicht.laedt')" /></div>
        <QuelleAus v-else-if="aus" :aus="aus" klein />
        <p v-else-if="!info || !hatEtwas" class="ca-klein">{{ t('coinAnsicht.angebotFehlt') }}</p>
        <template v-else>
            <ul v-if="balken.length" class="ca-balken breit">
                <li v-for="z in balken" :key="z.id">
                    <span class="name">{{ t('coinAnsicht.menge_' + z.id) }}</span>
                    <span class="spur"><i :style="{ width: z.pct + '%' }"></i></span>
                    <b>{{ gross(z.menge) }}</b>
                </li>
            </ul>
            <p class="ca-klein ca-fuss">{{ mengenSatz }}</p>

            <template v-if="dilution">
                <h4 class="ca-h4">{{ t('coinAnsicht.bewertung') }}</h4>
                <div class="teilung" role="img" :aria-label="t('coinAnsicht.bewertungAria', { n: zahl(kapAnteil, 0) })">
                    <i :style="{ width: kapAnteil + '%' }"></i>
                </div>
            </template>
            <dl class="ca-profil">
                <div><dt>{{ t('coinAnsicht.marktkap') }}</dt><dd>{{ usd(werte?.marktkap) }}</dd></div>
                <div><dt>{{ t('coinAnsicht.fdv') }}</dt><dd>{{ usd(werte?.fdv) }}<span v-if="dilution" class="ca-klein"> · ×{{ zahl(dilution.faktor, 2) }}</span></dd></div>
                <div v-if="dilution"><dt>{{ t('coinAnsicht.nochOffen') }}</dt><dd>{{ anteil(dilution.offenPct, 0) }}</dd></div>
            </dl>
            <p v-if="dilution" class="einordnung">{{ t('coinAnsicht.verwaesserung_' + dilution.stufe, { n: zahl(dilution.offenPct, 0) }) }}</p>

            <p class="ca-klein ca-fuss">
                {{ t(werte?.frisch ? 'coinAnsicht.angebotFrisch' : 'coinAnsicht.angebotCoingecko', { zeit: zeit(markt.stand) }) }}
            </p>
            <RadarQuellen :quellen="['coingecko']" />
        </template>
    </Karte>
</template>

<style scoped>
.teilung {
    height: 10px;
    border-radius: 2px;
    background: var(--line-stark);
    overflow: hidden;
}

.teilung i {
    display: block;
    height: 100%;
    min-width: 2px;
    background: var(--accent);
}

.einordnung {
    margin: 0.7rem 0 0;
    font-size: 0.86rem;
    line-height: 1.45;
}
</style>
