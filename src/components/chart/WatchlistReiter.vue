<script setup>
/**
 * Watchlist mit Live-Kursen. Kurse kommen per `miniTicker` direkt von Binance
 * (ein Stream je Markt, nur für die Symbole der Liste); 24h-Veränderung ist
 * Schluss gegen Eröffnung des rollierenden 24h-Fensters — dieselbe Zahl, die
 * Binance selbst anzeigt.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { BinanceStream, buildMiniTickerUrl } from '../../utils/binanceStream.js'
import axios from 'axios'
import SymbolSuche from './SymbolSuche.vue'
import { Symbol } from '../basis'
import { ladeHandelbar, boersenFuerSymbol } from '../../utils/chart/handelbar.js'
import { currentUser } from '../../stores/app/rahmen.js'
import { aktivierteBoersen } from '../../utils/boersenLinks.js'

const props = defineProps({
    watchlists: { type: Array, default: () => [] },
    aktivesSymbol: { type: String, default: '' },
    aktiverMarkt: { type: String, default: 'futures' },
})
const emit = defineEmits(['waehle', 'aendere', 'neu', 'loesche'])
const { t } = useI18n()

const listeId = ref(null)
const kurse = ref({})            // `${markt}|${symbol}` → { c, o }
let streams = []

const liste = computed(() => props.watchlists.find((w) => w.id === listeId.value) || props.watchlists[0] || null)
const symbole = computed(() => liste.value?.symbole || [])
const enthaeltAktives = computed(() => symbole.value.some((s) => s.symbol === props.aktivesSymbol && s.markt === props.aktiverMarkt))

watch(() => props.watchlists, (w) => {
    if (!w.find((x) => x.id === listeId.value)) listeId.value = w[0]?.id ?? null
}, { immediate: true })

function verbinde() {
    for (const s of streams) s.stop()
    streams = []
    for (const markt of ['futures', 'spot']) {
        const syms = symbole.value.filter((s) => s.markt === markt).map((s) => s.symbol)
        const url = buildMiniTickerUrl(syms, markt)
        if (!url) continue
        const st = new BinanceStream({
            url,
            silenceLimitMs: 30_000,
            onMessage: (m) => {
                const d = m?.data
                if (!d?.s) return
                kurse.value = { ...kurse.value, [`${markt}|${d.s}`]: { c: Number(d.c), o: Number(d.o) } }
            },
        })
        st.connect()
        streams.push(st)
        // Startkurse sofort, nicht erst beim ersten Tick — sonst steht „—" da, bis jedes Symbol einmal gehandelt hat.
        axios.get('/api/chart/ticker', { params: { markt, symbole: syms.join(',') } }).then(({ data }) => {
            const neu = { ...kurse.value }
            for (const [sym, k] of Object.entries(data.kurse || {})) if (!neu[`${markt}|${sym}`]) neu[`${markt}|${sym}`] = k
            kurse.value = neu
        }).catch(() => { /* der Stream füllt nach */ })
    }
}

watch(() => symbole.value.map((s) => s.markt + s.symbol).join(','), verbinde, { immediate: true })
onBeforeUnmount(() => { for (const s of streams) s.stop() })

// Börsenlinks je Zeile: nur wo der Coin gelistet ist, und nur die Börsen, die in den
// Einstellungen für Börsenlinks aktiviert sind (dieselbe Einstellung wie im Coin-Radar).
ladeHandelbar()
function boersen(s) {
    const aktiv = aktivierteBoersen(currentUser.value?.boersenLinks)
    return boersenFuerSymbol(s.symbol, s.markt).filter((b) => aktiv.includes(b.id))
}

function kurs(s) {
    return kurse.value[`${s.markt}|${s.symbol}`]
}

function stellen(c) {
    if (!c) return 2
    return c >= 1000 ? 2 : c >= 10 ? 3 : c >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(c)))
}

function aenderung(s) {
    const k = kurs(s)
    return k && k.o ? ((k.c - k.o) / k.o) * 100 : null
}

function fuegeHinzu() {
    if (!liste.value || enthaeltAktives.value) return
    emit('aendere', liste.value.id, [...symbole.value, { symbol: props.aktivesSymbol, markt: props.aktiverMarkt }])
}

/*
 * „+ Coin hinzufügen" unten in der Liste: Suche öffnen, gewählter Coin kommt in
 * die Liste — der Chart wechselt NICHT (dafür ist ein Klick auf die Zeile da).
 */
const suche = ref(null)
const sucheOffen = ref(false)
function oeffneSuche() {
    // Nach der Suche fragen, nicht dem eigenen Merker: Esc schliesst sie von innen.
    if (suche.value?.istOffen()) { suche.value.schliesse(); sucheOffen.value = false; return }
    sucheOffen.value = true
    suche.value?.oeffne()
}
function ausSuche(s) {
    sucheOffen.value = false
    if (!liste.value) return
    if (symbole.value.some((x) => x.symbol === s.symbol && x.markt === s.markt)) return
    emit('aendere', liste.value.id, [...symbole.value, { symbol: s.symbol, markt: s.markt }])
}

function entferne(s) {
    emit('aendere', liste.value.id, symbole.value.filter((x) => !(x.symbol === s.symbol && x.markt === s.markt)))
}

function verschiebe(i, richtung) {
    const neu = [...symbole.value]
    const j = i + richtung
    if (j < 0 || j >= neu.length) return
    ;[neu[i], neu[j]] = [neu[j], neu[i]]
    emit('aendere', liste.value.id, neu)
}

function neueListe() {
    const n = window.prompt(t('chart.watchlistName'), t('chart.watchlistNeuVorgabe'))
    if (n) emit('neu', n)
}

function loescheListe() {
    if (!liste.value || props.watchlists.length <= 1) return
    if (window.confirm(t('chart.watchlistLoeschenFrage', { name: liste.value.name }))) emit('loesche', liste.value.id)
}
</script>

<template>
    <div class="watchlist">
        <div class="kopf">
            <select v-model="listeId" class="at-feld klein">
                <option v-for="w in watchlists" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
            <button type="button" class="mini" :title="t('chart.watchlistNeu')" @click="neueListe" :aria-label="t('chart.watchlistNeu')"><Symbol name="plus" /></button>
            <button type="button" class="mini" :title="t('chart.watchlistLoeschen')" :disabled="watchlists.length <= 1" @click="loescheListe" :aria-label="t('chart.watchlistLoeschen')"><Symbol name="muell" /></button>
        </div>
        <button type="button" class="hinzu" :disabled="enthaeltAktives || !liste" @click="fuegeHinzu">
            <Symbol name="stern" /> {{ t('chart.watchlistHinzu', { symbol: aktivesSymbol }) }}
        </button>
        <div class="zeilen">
            <div v-for="(s, i) in symbole" :key="s.markt + s.symbol" class="zeile"
                :class="{ an: s.symbol === aktivesSymbol && s.markt === aktiverMarkt }" @click="emit('waehle', s)">
                <span class="sym">{{ s.symbol }}<small v-if="s.markt === 'spot'"> Spot</small>
                    <a v-for="b in boersen(s)" :key="b.id" class="boerse" :class="b.id" :href="b.url" target="_blank" rel="noopener"
                        :title="t('chart.watchlistBoerse', { boerse: b.name })" @click.stop>{{ b.kurz }}</a>
                </span>
                <span class="preis">{{ kurs(s) ? kurs(s).c.toFixed(stellen(kurs(s).c)) : '—' }}</span>
                <span class="delta" :class="aenderung(s) == null ? '' : aenderung(s) >= 0 ? 'greenTrade' : 'redTrade'">
                    {{ aenderung(s) == null ? '' : (aenderung(s) >= 0 ? '+' : '') + aenderung(s).toFixed(2) + ' %' }}
                </span>
                <span class="werkzeug" @click.stop>
                    <button type="button" class="mini" @click="verschiebe(i, -1)"><Symbol name="hoch" /></button>
                    <button type="button" class="mini" @click="verschiebe(i, 1)"><Symbol name="runter" /></button>
                    <button type="button" class="mini" @click="entferne(s)"><Symbol name="schliessen" /></button>
                </span>
            </div>
            <div v-if="!symbole.length" class="leer">{{ t('chart.watchlistLeer') }}</div>
            <button type="button" class="coinHinzu" :class="{ an: sucheOffen }" :disabled="!liste" @click="oeffneSuche">
                <Symbol :name="sucheOffen ? 'schliessen' : 'plus'" /> {{ t(sucheOffen ? 'chart.watchlistSucheZu' : 'chart.watchlistCoinHinzu') }}
            </button>
            <SymbolSuche ref="suche" ohne-knopf eingebettet @waehle="ausSuche" />
        </div>
    </div>
</template>

<style scoped>
.coinHinzu {
    width: 100%;
    margin-top: 6px;
    padding: 5px;
    background: transparent;
    border: 1px dashed var(--line-stark);
    border-radius: var(--radius-klein);
    color: var(--muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
}

.coinHinzu:hover:not(:disabled),
.coinHinzu.an {
    color: var(--accent);
    border-color: var(--accent);
}

.watchlist {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
}

.kopf {
    display: flex;
    gap: 4px;
    align-items: center;
}

.mini {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 2px 5px;
    border-radius: var(--radius-klein);
    display: inline-flex;
    align-items: center;
    cursor: pointer;
}

.mini:hover:not(:disabled) {
    color: var(--text);
    background: var(--line);
}

.hinzu {
    background: transparent;
    border: 1px dashed var(--line-stark);
    color: var(--muted);
    font-size: 11px;
    border-radius: var(--radius-klein);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
}

.hinzu:disabled {
    opacity: 0.4;
}

.zeilen {
    overflow-y: auto;
    min-height: 0;
}

.zeile {
    display: grid;
    grid-template-columns: 1fr auto 64px;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    position: relative;
}

.zeile:hover {
    background: var(--line);
}

.zeile.an {
    background: var(--accent-flaeche);
}

.sym {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    white-space: nowrap;
}

.boerse {
    font-size: 8.5px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 3px;
    border-radius: 3px;
    text-decoration: none;
    opacity: 0.75;
    border: 1px solid currentColor;
}

.boerse:hover {
    opacity: 1;
}

/* Abstand Symbol → erstes Börsen-Kürzel deutlich grösser als zwischen den Kürzeln */
.sym > .boerse:first-of-type {
    margin-left: 8px;
}

/* Hausfarben gedämpft: Bitunix Grün, Bitget Türkis, Pionex Orange */
.boerse.bitunix { color: #5fd38d; }
.boerse.bitget { color: #36c2d6; }
.boerse.pionex { color: #f0a04b; }

.sym small {
    color: var(--muted);
}

.preis {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.delta {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
}

.werkzeug {
    display: none;
    position: absolute;
    right: 2px;
    background: var(--panel);
    border-radius: 4px;
}

.zeile:hover .werkzeug {
    display: flex;
}

.leer {
    color: var(--muted);
    font-size: 12px;
    padding: 8px 4px;
}
</style>
