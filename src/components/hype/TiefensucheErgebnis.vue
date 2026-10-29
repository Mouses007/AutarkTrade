<script setup>
import { sichereUrl } from '@/utils/sanitize.js'
/**
 * Ergebnis einer Tiefensuche (`GET /api/coin-radar/tiefensuche`): Verträge,
 * Vertrags- und Halterprüfung, Projektprüfung.
 *
 * Steht an zwei Stellen — in der Einzelprüfung des Coin-Radars (gesucht nach
 * Symbol) und in der Frühphase auf der Karte eines Tokens, auf den ein Alarm
 * zeigt (gesucht nach Vertrag). Beide Antworten haben dieselbe Form.
 *
 * S12: Ohne CoinGecko-Schlüssel antwortet die Suche nach Symbol mit
 * `{aus: true, …}` — dann steht hier der Grund. Kein Coin-Logo (Initialen) —
 * ausser mit dem Schalter „Quellen mit eingeschränkten Nutzungsbedingungen" (S15, ID
 * `tokenbilder`), und unten die Quellenzeile mit den Pflicht-Attributionen.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProjektPruefung from './ProjektPruefung.vue'
import TickerZeichen from './TickerZeichen.vue'
import RadarQuellen from './RadarQuellen.vue'
import QuelleAus from '../quellen/QuelleAus.vue'

const props = defineProps({
    daten: { type: Object, required: true },
    /** Kopf mit dem gefundenen Coin — in der Einzelprüfung steht er schon darüber. */
    mitKopf: { type: Boolean, default: false },
})
const { t } = useI18n()

const pct = (w) => (w === null || w === undefined || !Number.isFinite(Number(w)) ? '—' : `${Number(w).toFixed(Number(w) < 10 ? 1 : 0)} %`)
const zahlKurz = (w) => (w === null || w === undefined || !Number.isFinite(Number(w)) ? '—'
    : (Number(w) >= 1e6 ? `${(Number(w) / 1e6).toFixed(1)} Mio` : (Number(w) >= 1e3 ? `${(Number(w) / 1e3).toFixed(0)} k` : String(Number(w)))))
const geldKurz = (w) => `${zahlKurz(w)} USD`
/** Woher die Angaben stammen: CoinGecko nur bei der Suche nach Symbol, Prüfdienst je nach Antwort. */
const quellen = computed(() => {
    const d = props.daten || {}
    const q = []
    if (d.coin?.coingeckoUrl) q.push('coingecko')
    q.push('dexscreener')
    const rq = String(d.risiko?.quelle || '')
    if (rq === 'rugcheck') q.push('rugcheck')
    if (d.gewaehlt && rq !== 'rugcheck') q.push('goplus')
    return q
})
const devText = (r) => (r.devPct !== null && r.devPct !== undefined ? pct(r.devPct) : (r.devUnterPct ? '< ' + pct(r.devUnterPct) : '—'))
</script>

<template>
    <div class="tsErgebnis">
        <QuelleAus v-if="daten.aus" :aus="daten" klein />
        <p v-else-if="!daten.gefunden" class="at-klein at-mu-0">{{ t('coinradar.tsNichtGefunden') }}</p>
        <template v-else>
            <!-- Welcher Coin gefunden wurde: bei Suche über das Kürzel kann es ein anderer sein als gemeint. -->
            <div v-if="mitKopf && (daten.coin?.name || daten.coin?.symbol)" class="tsKopf">
                <!-- Logo nur mit Schalter „Quellen mit eingeschränkten Nutzungsbedingungen" (S15, ID `tokenbilder`), sonst Initialen. -->
                <TickerZeichen :symbol="daten.coin.symbol || daten.coin.name" :bild="daten.coin.bild || ''" klein />
                <strong>{{ daten.coin.name || daten.coin.symbol }}</strong>
                <span v-if="daten.coin.symbol" class="tsGrau">{{ daten.coin.symbol }}</span>
                <span v-if="daten.coin.rang" class="tsGrau">#{{ daten.coin.rang }}</span>
                <a v-if="daten.coin.coingeckoUrl" :href="daten.coin.coingeckoUrl" target="_blank" rel="noopener noreferrer">CoinGecko ↗</a>
            </div>
            <div class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsVertrag') }}</div>
                <div v-if="!daten.gewaehlt" class="at-klein">{{ t('coinradar.tsNichtPruefbar') }}</div>
                <div v-for="v in daten.vertraege" :key="v.chain + v.contract" class="tsZeile"
                    :class="{ gewaehlt: daten.gewaehlt && v.contract === daten.gewaehlt.contract }">
                    <span class="tsKette">{{ v.chain }}</span>
                    <code>{{ v.contract }}</code>
                    <span v-if="v.liquiditaetUsd" class="tsGrau">{{ t('coinradar.tsLiq') }} {{ geldKurz(v.liquiditaetUsd) }}<template v-if="v.dex"> · {{ v.dex }}</template></span>
                    <span v-else-if="!v.pruefbar" class="tsGrau">{{ t('coinradar.tsKetteNichtPruefbar') }}</span>
                    <a v-if="sichereUrl(v.url)" :href="sichereUrl(v.url)" target="_blank" rel="noopener noreferrer">DexScreener ↗</a>
                </div>
            </div>
            <div v-if="daten.gewaehlt" class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsRisiko') }}</div>
                <p v-if="daten.risikoFehler" class="at-klein at-mu-1">{{ daten.risikoFehler }}</p>
                <template v-else-if="daten.risiko">
                    <p class="at-klein at-mu-1" :class="daten.risiko.ko ? 'at-schlecht' : 'tsGut'">
                        {{ daten.risiko.ko ? t('coinradar.tsKo', { g: daten.risiko.ko.text }) : t('coinradar.tsOk') }}
                    </p>
                    <p class="at-klein at-mu-1 tsGrau">
                        {{ t('coinradar.tsHalter') }} {{ zahlKurz(daten.risiko.halter) }}
                        · {{ t('coinradar.tsTop10') }} {{ pct(daten.risiko.top10Pct) }}
                        · {{ t('coinradar.tsInsider') }} {{ pct(daten.risiko.insiderPct) }}
                        · {{ t('coinradar.tsDev') }} {{ devText(daten.risiko) }}
                    </p>
                    <ul class="tsBefunde">
                        <li v-for="(b, i) in daten.risiko.befunde" :key="i" :class="b.art">{{ b.art === 'minus' ? '−' : (b.art === 'plus' ? '+' : 'i') }} {{ b.text }}</li>
                    </ul>
                </template>
            </div>
            <div class="tsBlock">
                <div class="tsTitel">{{ t('coinradar.tsProjekt') }}</div>
                <ProjektPruefung v-if="daten.projekt" :projekt="daten.projekt" />
                <p v-else class="at-klein at-mu-0">—</p>
            </div>
            <RadarQuellen :quellen="quellen" />
        </template>
    </div>
</template>

<style scoped>
.tsErgebnis { margin-top: .6rem; padding-top: .6rem; border-top: 1px solid var(--line); display: grid; gap: .75rem; }
.tsKopf { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .9rem; }
.tsTitel { font-size: .75rem; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-bottom: .3rem; }
.tsZeile { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; font-size: .85rem; padding: .1rem 0; opacity: .7; }
.tsZeile.gewaehlt { opacity: 1; }
.tsZeile code { font-size: .8rem; word-break: break-all; }
.tsKette { min-width: 5.5rem; font-weight: 600; }
.tsGrau { color: var(--muted); }
.tsGut { color: var(--good); }
.tsBefunde { list-style: none; padding: 0; margin: 0; font-size: .85rem; }
.tsBefunde li.minus { color: var(--bad); }
.tsBefunde li.info { color: var(--muted); }
</style>
