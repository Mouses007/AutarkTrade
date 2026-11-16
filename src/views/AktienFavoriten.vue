<script setup>
/**
 * Favoriten Aktien: die eigene Merkliste mit dem Stand des letzten
 * Aktien-Radar-Laufs (`server/aktien/favoriten.js`).
 *
 * Der Aktien-Radar ist ein Momentum-Sieb; ein eingebrochener Titel fällt dort
 * an einer Hürde oder aus der Rangliste. Hier bleibt er stehen und sagt, wie
 * er im letzten Lauf stand. Eine Merkliste, kein Kaufsignal — die Seite reiht
 * nichts, was der Radar nicht schon gereiht hat, und empfiehlt nichts.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import Pille from '../components/basis/Pille.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import SpartenFilter from '../components/aktien/SpartenFilter.vue'
import { passtSparte, sektorSchluessel } from '../../shared/aktien-sparte.js'
import { aktienFavoritenStand, schalteAktienFavorit, ladeAktienFavoriten } from '../stores/aktienFavoriten.js'
import { marktdaten, ladeMarktdaten } from '../utils/marktdaten.js'
import { symbolBei, vorzug } from '../utils/chart/aktienSymbole.js'
import { vorgabeBoerse, waehlbareBoersen } from '../utils/chart/kerzenQuelle.js'

const { t, te, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const STATUS_TON = { bewertet: 'gut', huerde: 'warn', nichtImLauf: 'neutral', ohneFuture: 'neutral', keinLauf: 'neutral', nichtImStamm: 'schlecht' }

const favoriten = ref([])
const lauf = ref(null)
const laedt = ref(true)
const fehler = ref('')
const sparte = ref({ sektor: '', branche: '' })
const neu = ref('')
const fuegtHinzu = ref(false)

async function lade() {
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/aktien/favoriten')
        favoriten.value = data?.favoriten || []
        lauf.value = data?.lauf || null
        spartenLaeuft.value = data?.spartenLaeuft === true
    } catch (e) {
        fehler.value = `${t('favoriten.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

async function entferne(f) {
    fehler.value = ''
    try {
        await schalteAktienFavorit(f.ticker)
    } catch (e) {
        fehler.value = t('favoriten.schaltFehler', { fehler: e?.response?.data?.error || e.message })
    }
}

/* Von Hand anheften: genau der Ticker, wie er im Stamm steht. Der Server lehnt ab, was der Stamm nicht kennt. */
async function fuegeHinzu() {
    const ticker = neu.value.trim().toUpperCase()
    if (!ticker || fuegtHinzu.value) return
    fuegtHinzu.value = true
    fehler.value = ''
    try {
        await axios.post('/api/aktien/favoriten', { ticker })
        neu.value = ''
        await ladeAktienFavoriten(true)
        await lade()
    } catch (e) {
        const grund = e?.response?.data?.grund
        fehler.value = grund === 'nichtImStamm' ? t('favoriten.nichtImStammFehler', { ticker })
            : grund === 'voll' ? t('favoriten.voll', { max: e.response.data.max })
                : t('favoriten.schaltFehler', { fehler: e?.response?.data?.error || e.message })
    } finally {
        fuegtHinzu.value = false
    }
}

ladeMarktdaten()
function chartZiel(f) {
    void marktdaten.value
    const ziel = f.chart ? symbolBei({ symbole: f.chart }, vorzug(vorgabeBoerse(), waehlbareBoersen())) : null
    return ziel ? { path: '/chart', query: { symbol: ziel.symbol, boerse: ziel.boerse } } : null
}

// Solange der Server Sparten nachfüllt, alle 20 s neu lesen.
const spartenLaeuft = ref(false)
let spartenWecker = null
watch(spartenLaeuft, (an) => {
    clearInterval(spartenWecker)
    if (an) spartenWecker = setInterval(lade, 20_000)
})
onBeforeUnmount(() => clearInterval(spartenWecker))

// Ein Stern, der anderswo gesetzt oder hier genommen wurde, lädt die Liste neu.
watch(aktienFavoritenStand, lade)
onMounted(lade)

const sichtbar = computed(() => favoriten.value.filter((f) => passtSparte(f, sparte.value)))

const zahl = (x, stellen = 1) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x))
const zeit = (ms) => (ms ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(ms))) : '—')
const tag = (ms) => (ms ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short' }).format(new Date(Number(ms))) : '—')
const rund = (x) => (x == null ? '—' : Math.round(x))
const geordnet = (liste = []) => [...liste].sort((a, b) => RANG[a.art] - RANG[b.art] || a.handelsplatz.localeCompare(b.handelsplatz))
const teilText = (n) => (n && 'staerke' in n
    ? t('aktienradar.teilnotenNeu', { staerke: rund(n.staerke), hochNaehe: rund(n.hochNaehe), imSpiel: rund(n.imSpiel), bewegung: rund(n.bewegung), trend: rund(n.trend) })
    : '')
const sektorName = (s) => {
    const k = sektorSchluessel(s)
    return k && te('sparte.sektor_' + k) ? t('sparte.sektor_' + k) : s
}
const statusText = (f) => (f.status === 'bewertet' ? t('favoriten.status_bewertet', { rang: f.rang ?? '—' })
    : f.status === 'huerde' ? t('favoriten.status_huerde', { grund: t('aktienradar.huerde_' + (te('aktienradar.huerde_' + f.huerdeGrund) ? f.huerdeGrund : 'unbekannt')) })
        : t('favoriten.status_' + f.status))
const zahlenText = (f) => (f.zahlenZeit ? t(f.zahlenGeschaetzt ? 'aktienradar.zahlenAmGeschaetzt' : 'aktienradar.zahlenAm', { zeit: zeit(f.zahlenZeit) }) : '')
const hochText = (f) => (f.abstandHochQuelle === 'tagesstand' ? t('favoriten.hochAusTagesstand', { zeit: tag(f.tagesstand?.stand) }) : '')
</script>

<template>
    <div class="favoriten-seite">
        <div class="leiste">
            <SpartenFilter v-model="sparte" :zeilen="favoriten" />
            <form class="hinzu" @submit.prevent="fuegeHinzu">
                <label for="fav-neu">{{ t('favoriten.hinzuLabel') }}</label>
                <input id="fav-neu" v-model="neu" type="text" maxlength="15" autocomplete="off" spellcheck="false" :placeholder="t('favoriten.hinzuPlatzhalter')" />
                <Knopf klein type="submit" symbol="stern" :laedt="fuegtHinzu" :disabled="!neu.trim()">{{ t('favoriten.hinzuKnopf') }}</Knopf>
            </form>
        </div>

        <p v-if="lauf" class="leise">{{ t('favoriten.stand', { zeit: zeit(lauf.zeit) }) }}</p>
        <p v-else-if="!laedt && favoriten.length" class="leise">{{ t('favoriten.keinLauf') }}</p>
        <p v-if="spartenLaeuft" class="leise" role="status">{{ t('sparte.laeuft') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Kreisel v-if="laedt" />
        <Leerzustand v-else-if="!favoriten.length" :titel="t('favoriten.leerTitel')" :text="t('favoriten.leerText')" symbol="stern">
            <Knopf art="haupt" symbol="listeNummer" :to="{ path: '/aktien-radar' }">{{ t('nav.aktienRadar') }}</Knopf>
        </Leerzustand>
        <Leerzustand v-else-if="!sichtbar.length" :titel="t('sparte.keineTreffer')" :text="t('sparte.keineTrefferText')" symbol="suche" />

        <div v-else class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th>{{ t('aktienradar.ticker') }}</th>
                        <th>{{ t('aktienradar.name') }}</th>
                        <th :title="t('sparte.info')">{{ t('sparte.spalte') }}</th>
                        <th :title="t('favoriten.standInfo')">{{ t('favoriten.letzterLauf') }}</th>
                        <th class="rechts" :title="t('aktienradar.noteInfo')">{{ t('aktienradar.note') }}</th>
                        <th class="rechts" :title="t('aktienradar.staerkeInfo')">{{ t('aktienradar.staerke') }}</th>
                        <th class="rechts" :title="t('aktienradar.hochInfo')">{{ t('aktienradar.hoch') }}</th>
                        <th class="rechts" :title="t('aktienradar.zahlenInfo')">{{ t('aktienradar.zahlen') }}</th>
                        <th :aria-label="t('favoriten.aktionen')"></th>
                        <th>{{ t('aktienradar.handelbar') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="f in sichtbar" :key="f.ticker">
                        <td class="ticker">
                            <router-link v-if="f.status !== 'nichtImStamm'" :to="{ path: '/aktien', query: { titel: f.ticker } }" :title="t('titel.oeffnen')">{{ f.ticker }}</router-link>
                            <template v-else>{{ f.ticker }}</template>
                            <span v-if="f.unterart && f.unterart !== 'aktie'" class="art">{{ t('aktien.art_' + f.unterart) }}</span>
                        </td>
                        <td class="name">{{ f.name || '—' }}</td>
                        <td class="sparte">
                            <template v-if="f.sparte">
                                {{ sektorName(f.sparte.sektor) }}
                                <div v-if="f.sparte.branche" class="vermerk">{{ f.sparte.branche }}</div>
                            </template>
                            <span v-else class="leise" :title="t('sparte.unbekanntInfo')">{{ t('sparte.unbekannt') }}</span>
                        </td>
                        <td><Pille :ton="STATUS_TON[f.status]" :title="t('favoriten.statusInfo_' + f.status)">{{ statusText(f) }}</Pille></td>
                        <td class="rechts note" :title="teilText(f.teilnoten)">{{ f.note == null ? '—' : zahl(f.note, 0) }}</td>
                        <td class="rechts">{{ rund(f.staerkeRang) }}</td>
                        <td class="rechts" :title="hochText(f)">
                            {{ f.abstandHochPct == null ? '—' : zahl(f.abstandHochPct, 0) + ' %' }}<span v-if="f.abstandHochQuelle === 'tagesstand'" class="leise"> *</span>
                        </td>
                        <td class="rechts" :class="{ bald: f.zahlenIn != null && f.zahlenIn <= 2 }" :title="zahlenText(f)">
                            {{ f.zahlenIn == null ? '—' : f.zahlenIn === 0 ? t('aktienradar.zahlenHeute') : t('aktienradar.zahlenTage', { n: f.zahlenIn }) }}
                        </td>
                        <td class="aktionen">
                            <Knopf v-if="chartZiel(f)" klein nur-symbol art="leise" symbol="chart" :titel="t('favoriten.zumChart', { ticker: f.ticker })" :to="chartZiel(f)" />
                            <Knopf klein nur-symbol art="leise" symbol="papierkorb" :titel="t('favoriten.entfernenTitel', { ticker: f.ticker })" @click="entferne(f)" />
                        </td>
                        <td class="plaetze">
                            <Pille v-for="l in geordnet(f.listungen)" :key="l.handelsplatz + l.art + l.symbol" :ton="TON[l.art]" :title="l.symbol">
                                {{ PLATZ[l.handelsplatz] || l.handelsplatz }} · {{ t('aktien.art_' + l.art) }}
                            </Pille>
                            <span v-if="!f.listungen.length" class="leise">—</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="favoriten.some((f) => f.abstandHochQuelle === 'tagesstand')" class="leise">{{ t('favoriten.sternchen') }}</p>
        <p class="leise">{{ t('favoriten.hinweis') }}</p>
    </div>
</template>

<style scoped>
.favoriten-seite {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem 1rem;
}

.hinzu {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--muted);
    font-size: 0.88rem;
}

.hinzu input {
    width: 8.5rem;
    padding-block: 0.3rem;
    font-size: 0.88rem;
    text-transform: uppercase;
}

.leise {
    margin: 0;
    color: var(--muted);
    font-size: 0.86rem;
}

.rolle {
    overflow-x: auto;
}

.liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}

.liste th {
    text-align: left;
    padding: 0.5rem 0.6rem;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
}

.liste th[title] {
    cursor: help;
}

.liste td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    white-space: nowrap;
}

.liste .rechts {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.note {
    font-weight: 700;
    color: var(--accent);
}

.note[title]:not([title='']) {
    cursor: help;
}

.bald {
    color: var(--warn);
    font-weight: 600;
}

.ticker {
    font-weight: 700;
}

.ticker a {
    color: inherit;
    text-decoration: none;
}

.ticker a:hover {
    color: var(--accent);
}

.art {
    margin-left: 0.3rem;
    color: var(--muted);
    font-weight: 400;
    font-size: 0.78rem;
}

.liste td.name {
    color: var(--muted);
    white-space: normal;
    min-width: 9rem;
}

.vermerk {
    color: var(--muted);
    font-size: 0.78rem;
}

.liste td.plaetze {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.3rem;
    white-space: nowrap;
}

/* Kein `display: flex` an dieser Zelle: zwei Flex-Zellen nebeneinander fallen in EINE Tabellenzelle und stapeln sich. */
.liste td.aktionen > * + * {
    margin-left: 0.3rem;
}
</style>
