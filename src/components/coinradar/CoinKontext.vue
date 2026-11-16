<script setup>
/**
 * Coin-Ansicht, Karte «Im Haus»: wo dieser Coin in AutarkTrade sonst steht.
 *
 * Liest nur die eigene Datenbank (`/api/coin-radar/ansicht/kontext`) — kein
 * Abruf nach aussen, nichts wird angestossen: Rang in den letzten Läufen des
 * Coin-Radars, Stand der Abverkaufs-Wache, neue Listungen aus dem Börsen-
 * Beobachter, Favorit und Wachhund, aktive Chart-Alarme, eigene Trades.
 *
 * Jede Zeile nennt, was gemessen ist. Ein Teil, der sich nicht lesen liess,
 * fehlt — er steht nicht als «nein» da. Nichts davon ist ein Signal.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '../basis/Karte.vue'
import Kreisel from '../basis/Kreisel.vue'
import Symbol from '../basis/Symbol.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'

const props = defineProps({
    symbol: { type: String, required: true },
    /** Wechselt, wenn der Stern umgelegt wurde — dann neu lesen. */
    favorit: { type: Boolean, default: false },
})
const { t, te } = useI18n()
const { zahl, zeit, tagMonat, datum, richtung } = useCoinFormat()

const k = ref(null)
const laedt = ref(true)
const fehler = ref('')
let lauf = 0

async function lade() {
    const eigener = ++lauf
    laedt.value = k.value?.symbol !== props.symbol
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/coin-radar/ansicht/kontext', { params: { symbol: props.symbol } })
        if (eigener === lauf) k.value = data
    } catch (e) {
        if (eigener === lauf) { k.value = null; fehler.value = e.response?.data?.error || e.message }
    } finally {
        if (eigener === lauf) laedt.value = false
    }
}
watch(() => [props.symbol, props.favorit], lade, { immediate: true })

const grund = (g) => (te('coinradar.grund_' + g) ? t('coinradar.grund_' + g) : g)
const boerse = (b) => String(b || '').replace(/^./, (c) => c.toUpperCase())

const radar = computed(() => k.value?.coinRadar || null)
const radarText = computed(() => {
    const r = radar.value
    if (!r) return ''
    if (!r.laeufe) return t('coinAnsicht.radarKeinLauf')
    const l = r.letzter
    if (l.status === 'bewertet') return t(l.gesamt ? 'coinAnsicht.radarRangVon' : 'coinAnsicht.radarRang', { rang: l.rang, von: l.gesamt, note: l.note ?? '—', zeit: zeit(l.zeit) })
    if (l.status === 'huerde') return t('coinAnsicht.radarHuerde', { grund: grund(l.huerdeGrund), zeit: zeit(l.zeit) })
    return t('coinAnsicht.radarFehlt', { zeit: zeit(l.zeit) })
})
/** Kleine Säulen: je Lauf die Note (Höhe), Top 10 in Türkis; Hürde und Fehlen als Strich. */
const saeulen = computed(() => (radar.value?.punkte || []).map((p) => ({
    id: p.laufId,
    hoehe: p.status === 'bewertet' ? Math.max(8, Math.min(100, p.note ?? 0)) : 4,
    klasse: p.status === 'bewertet' ? (p.rang <= 10 ? 'top' : 'drin') : 'aus',
    titel: p.status === 'bewertet' ? t('coinAnsicht.radarSaeule', { zeit: zeit(p.zeit), rang: p.rang, note: p.note ?? '—' })
        : t(p.status === 'huerde' ? 'coinAnsicht.radarSaeuleHuerde' : 'coinAnsicht.radarSaeuleFehlt', { zeit: zeit(p.zeit) }),
})))
const leer = computed(() => k.value && !['coinRadar', 'abverkauf', 'listungen', 'favorit', 'chartAlarme', 'trades'].some((f) => k.value[f]))
</script>

<template>
    <Karte :titel="t('coinAnsicht.kontext')" :unter="t('coinAnsicht.kontextUnter')">
        <div v-if="laedt" class="ca-laedt"><Kreisel :groesse="22" :titel="t('coinAnsicht.laedt')" /></div>
        <p v-else-if="fehler || leer" class="ca-klein">{{ fehler || t('coinAnsicht.kontextLeer') }}</p>
        <ul v-else-if="k" class="zeilen">
            <li v-if="radar">
                <Symbol name="rangliste" :groesse="17" />
                <div>
                    <b>{{ t('coinAnsicht.radarTitel') }}</b>
                    <span>{{ radarText }}</span>
                    <template v-if="radar.laeufe > 1">
                        <div class="saeulen" role="img" :aria-label="t('coinAnsicht.radarTop10', { n: radar.top10, laeufe: radar.laeufe })">
                            <i v-for="s in saeulen" :key="s.id" :class="s.klasse" :style="{ height: s.hoehe + '%' }" :title="s.titel"></i>
                        </div>
                        <span class="ca-klein">{{ t('coinAnsicht.radarTop10', { n: radar.top10, laeufe: radar.laeufe }) }}</span>
                    </template>
                </div>
            </li>
            <li v-if="k.abverkauf">
                <Symbol name="abwaerts" :groesse="17" />
                <div>
                    <b>{{ t('coinAnsicht.abverkaufTitel') }}</b>
                    <span v-if="!k.abverkauf.beobachtet">{{ t('coinAnsicht.abverkaufNicht') }}</span>
                    <span v-else>
                        {{ t('abverkauf.phase_' + k.abverkauf.phase) }}<template
                            v-if="k.abverkauf.phase !== 'keine'"> · {{ t('coinAnsicht.abverkaufNote', { n: k.abverkauf.note, seit: zeit(k.abverkauf.phaseSeit) }) }}</template>
                        <router-link to="/coin-radar/abverkauf" class="ca-link">{{ t('coinAnsicht.zurWache') }}</router-link>
                    </span>
                </div>
            </li>
            <li v-if="k.listungen?.length">
                <Symbol name="megafon" :groesse="17" />
                <div>
                    <b>{{ t('coinAnsicht.listungenTitel') }}</b>
                    <span>{{ k.listungen.map((l) => `${boerse(l.boerse)} (${tagMonat(l.gesehenAm)})`).join(', ') }}</span>
                    <span class="ca-klein">{{ t('coinAnsicht.listungenHinweis') }}</span>
                </div>
            </li>
            <li v-if="k.favorit">
                <Symbol name="stern" :groesse="17" :gefuellt="k.favorit.an" />
                <div>
                    <b>{{ t('coinAnsicht.favoritTitel') }}</b>
                    <span v-if="!k.favorit.an">{{ t('coinAnsicht.favoritNein') }}</span>
                    <span v-else>
                        {{ t('coinAnsicht.favoritJa', { datum: datum(k.favorit.seit) }) }}<template
                            v-if="k.favorit.stumm"> · {{ t('coinFavoriten.stumm') }}</template><template
                            v-if="k.favorit.alarmeUngelesen"> · {{ t('coinFavoriten.alarme', { n: k.favorit.alarmeUngelesen }) }}</template>
                        <router-link to="/coin-radar/favoriten" class="ca-link">{{ t('coinAnsicht.zurListe') }}</router-link>
                    </span>
                </div>
            </li>
            <li v-if="k.chartAlarme">
                <Symbol name="glocke" :groesse="17" />
                <div>
                    <b>{{ t('coinAnsicht.alarmeTitel') }}</b>
                    <span>{{ k.chartAlarme.aktiv ? t('coinAnsicht.alarmeAktiv', { n: k.chartAlarme.aktiv }, k.chartAlarme.aktiv) : t('coinAnsicht.alarmeKeine') }}</span>
                </div>
            </li>
            <li v-if="k.trades">
                <Symbol name="journal" :groesse="17" />
                <div>
                    <b>{{ t('coinAnsicht.tradesTitel', { tage: k.trades.tage }) }}</b>
                    <span v-if="!k.trades.anzahl">{{ t('coinAnsicht.tradesKeine') }}</span>
                    <span v-else>
                        {{ t('coinAnsicht.tradesAnzahl', { n: k.trades.anzahl, datum: datum(k.trades.letzter) }, k.trades.anzahl) }}<template
                            v-if="k.trades.netto != null"> · {{ t('coinAnsicht.tradesNetto') }} <span :class="'ca-' + richtung(k.trades.netto)">{{ zahl(k.trades.netto) }}</span></template>
                    </span>
                </div>
            </li>
        </ul>
        <p v-if="k && !laedt && !leer" class="ca-klein ca-fuss">{{ t('coinAnsicht.kontextHinweis') }}</p>
    </Karte>
</template>

<style scoped>
.zeilen {
    list-style: none;
    margin: 0;
    padding: 0;
}

.zeilen li {
    display: grid;
    grid-template-columns: 1.3rem minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.55rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.86rem;
    color: var(--muted);
}

.zeilen li:first-child {
    border-top: 0;
    padding-top: 0;
}

.zeilen li > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
}

.zeilen b {
    font-weight: 600;
    color: var(--text);
}

.zeilen span {
    color: var(--text);
}

.saeulen {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 34px;
    margin: 0.3rem 0 0.1rem;
}

.saeulen i {
    flex: 1 1 0;
    max-width: 10px;
    min-height: 2px;
    border-radius: 1px;
    background: var(--line-stark);
}

.saeulen .drin {
    background: var(--muted);
}

.saeulen .top {
    background: var(--accent);
}
</style>
