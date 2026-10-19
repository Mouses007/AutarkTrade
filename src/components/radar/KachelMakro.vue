<script setup>
/**
 * Kachel „Makro-Umfeld" — was ausserhalb der Kurse gerade passiert.
 *
 * Seit S12 nur noch der Geldfluss: Stablecoin-Menge (USDT + USDC) und die in
 * Menge und Kurseffekt zerlegte Stablecoin-Dominanz, beides von CoinGecko mit
 * dem Schlüssel des Kunden. Aktien-Futures, Dollar-Index und die Kopplung
 * BTC↔Nasdaq kamen aus Yahoo Finance und sind entfernt (Verkaufs-Prüfung
 * Z. 28) — die Kachel sagt das in einer Zeile, damit niemand die Indizes
 * für gestört hält.
 *
 * Die Farbe zeigt Zu- oder Abfluss, nicht die Kursrichtung.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'
const GRAU = 'rgba(255, 255, 255, 0.45)'

const stable = computed(() => props.daten?.stablecoins || {})

const pct = (v) => (!Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)} %`)
const mrd = (v) => (!Number.isFinite(v) ? '—'
    : `${v > 0 ? '+' : v < 0 ? '−' : ''}${(Math.abs(v) / 1e9).toFixed(1)} Mrd`)

const stableFarbe = computed(() => {
    const d = stable.value.deltaUsd
    if (!Number.isFinite(d) || d === 0) return GRAU
    return d > 0 ? GRUEN : ROT
})

// Die Dominanz wird NUR zerlegt gezeigt: als blosse Zahl wäre sie nicht
// deutbar, weil sie schon steigt, wenn allein die Kurse fallen.
const dom = computed(() => props.daten?.dominanz || null)
const punkte = (v) => (!Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`)
</script>

<template>
    <div v-if="daten" class="mkWrap" :class="{ gross }">
        <div class="mkListe">
            <div class="mkZeile mkStable">
                <span class="mkName">{{ t('marktradar.makro.stableFlow', { tage: stable.tage || 30 }) }}</span>
                <span v-if="!stable.verfuegbar" class="mkFehlt">—</span>
                <span v-else class="mkWert" :style="{ color: stableFarbe }">
                    {{ mrd(stable.deltaUsd) }} $
                    <span class="mkStablePct">({{ pct(stable.deltaPct) }})</span>
                </span>
            </div>
            <div v-if="stable.verfuegbar" class="mkZeile">
                <span class="mkName">{{ t('marktradar.makro.stableTotal') }}</span>
                <span class="mkWert">{{ (stable.jetztUsd / 1e9).toFixed(0) }} Mrd $</span>
            </div>
        </div>

        <!-- Dominanz nur zerlegt: ein Anstieg kann reiner Kurseffekt sein -->
        <div v-if="dom" class="mkDom">
            <div class="mkDomKopf">
                {{ t('marktradar.makro.domTitle', { tage: dom.tage }) }}
            </div>
            <div class="mkDomZeile">
                <span>{{ dom.vorherPct.toFixed(2) }} % → {{ dom.jetztPct.toFixed(2) }} %</span>
                <b>{{ punkte(dom.deltaPunkte) }} {{ t('marktradar.makro.domPoints') }}</b>
            </div>
            <div class="mkDomAufteilung">
                <span>
                    {{ t('marktradar.makro.domFromSupply') }}
                    <b>{{ punkte(dom.mengePunkte) }}</b>
                </span>
                <span>
                    {{ t('marktradar.makro.domFromPrice') }}
                    <b>{{ punkte(dom.kursPunkte) }}</b>
                </span>
            </div>
            <p v-if="gross" class="mkDomHinweis">{{ t('marktradar.makro.domHint') }}</p>
        </div>
        <p v-else class="mkDomHinweis">{{ t('marktradar.makro.domWaechst') }}</p>

        <p v-if="daten.indizesEntfernt" class="mkLegende">
            <span class="mkLegendeNote">{{ t('marktradar.makro.indizesEntfernt') }}</span>
        </p>

        <p v-if="gross" class="mkQuelle">{{ t('marktradar.makro.source') }}</p>
    </div>
</template>

<style scoped>
.mkWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.mkKopplung {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
}

.mkKopplungText {
    font-size: 0.98rem;
    font-weight: 600;
    color: var(--text);
}

.mkWrap.gross .mkKopplungText {
    font-size: 1.15rem;
}

.mkR {
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}

.mkListe {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.mkZeile {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.86rem;
    padding: 0.1rem 0;
}

.mkStable {
    margin-top: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--line);
}

.mkName {
    color: var(--muted);
}

.mkZu {
    margin-left: 0.3rem;
    padding: 0 0.28rem;
    border-radius: 3px;
    background: var(--panel-soft);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: help;
}

.mkWert {
    display: flex;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
    color: var(--text);
}

.mkPreis {
    color: var(--text);
}

.mkStablePct {
    opacity: 0.75;
}

.mkFehlt {
    color: var(--muted);
}

.mkLegende {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem 0.4rem;
    margin: 0.5rem 0 0;
    font-size: 0.72rem;
    color: var(--muted);
    opacity: 0.85;
}

.mkPunkt {
    font-size: 0.6rem;
    line-height: 1;
}

.mkLegendeNote {
    opacity: 0.75;
}

.mkLegendeNote::before {
    content: '· ';
}

.mkDetails {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.mkDetailZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.84rem;
    color: var(--muted);
}

.mkDetailZeile b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
}

.mkDom {
    margin-top: 0.9rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
}

.mkDomKopf {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 0.25rem;
}

.mkDomZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.9rem;
    color: var(--text);
    font-variant-numeric: tabular-nums;
}

.mkDomAufteilung {
    display: flex;
    gap: 1.2rem;
    margin-top: 0.25rem;
    font-size: 0.84rem;
    color: var(--muted);
    flex-wrap: wrap;
}

.mkDomAufteilung b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
}

.mkDomHinweis {
    margin: 0.35rem 0 0;
    font-size: 0.76rem;
    color: var(--muted);
}

.mkQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--muted);
}
</style>
