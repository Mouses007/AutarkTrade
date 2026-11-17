<script setup>
/**
 * Favoriten Coins: die bestehende Favoritenliste beider Radare auf einer
 * Seite (`server/coin-radar/favoriten.js`).
 *
 * Kein neuer Favoritenbegriff: es ist die Liste, an der die Sterne von
 * Coin-Radar und Hype-Radar schon hängen und die der Wachhund überwacht.
 * Die Seite liest; Entfernen geht über dieselbe Route wie der Stern.
 * Eine Merkliste, kein Kaufsignal.
 */
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../basis/Knopf.vue'
import Pille from '../basis/Pille.vue'
import Hinweis from '../basis/Hinweis.vue'
import Leerzustand from '../basis/Leerzustand.vue'
import Kreisel from '../basis/Kreisel.vue'

const props = defineProps({ aktiv: { type: Boolean, default: true } })
const emit = defineEmits(['geaendert'])
const { t, te, locale } = useI18n()

const STATUS_TON = { bewertet: 'gut', huerde: 'warn', nichtImLauf: 'neutral', keinLauf: 'neutral', geprueft: 'akzent', ohnePruefung: 'neutral' }

const favoriten = ref([])
const lauf = ref(null)
const laedt = ref(true)
const fehler = ref('')

async function lade() {
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/coin-radar/favoriten')
        favoriten.value = data?.favoriten || []
        lauf.value = data?.lauf || null
    } catch (e) {
        fehler.value = `${t('coinFavoriten.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

async function entferne(f) {
    fehler.value = ''
    try {
        await axios.delete(`/api/hype-radar/favoriten/${f.id}`)
        emit('geaendert')
        await lade()
    } catch (e) {
        fehler.value = `${t('coinFavoriten.entfernenFehler')}: ${e?.response?.data?.error || e.message}`
    }
}

// Der Reiter bleibt beim Wechsel im Speicher: beim Zurückkommen neu lesen (ein Stern kann dazugekommen sein).
watch(() => props.aktiv, (an) => { if (an) lade() })
onMounted(lade)

const zahl = (x, stellen = 1) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x))
const zeit = (ms) => (ms ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(ms))) : '—')
const teilText = (n) => (n ? Object.entries(n).map(([k, v]) => `${te('coinradar.note_' + k) ? t('coinradar.note_' + k) : k} ${v}`).join(' · ') : '')
const grund = (g) => (te('coinradar.grund_' + g) ? t('coinradar.grund_' + g) : g || t('coinFavoriten.grundUnbekannt'))
const statusText = (f) => (f.status === 'bewertet' ? t('coinFavoriten.status_bewertet', { rang: f.rang ?? '—' })
    : f.status === 'huerde' ? t('coinFavoriten.status_huerde', { grund: grund(f.huerdeGrund) })
        : t('coinFavoriten.status_' + f.status))
const chartZiel = (f) => ({ path: '/chart', query: { symbol: f.symbol } })
/*
 * Wohin ein Klick führt. Hype-Funde (DEX-Token) haben keinen Chart und keine
 * Coin-Ansicht; sie öffnen in der Frühphase — dort steht der Token, oder, wenn
 * die Frühphase ihn nicht mehr führt, seine Karte mit Alarmen, Verlauf, dem
 * Markt jetzt und der Tiefensuche. Bis 17.11.2026 liess sich ein Hype-Fund
 * hier gar nicht anklicken.
 */
const hypeZiel = (f) => (f.contractAddress ? { path: '/hype-radar/fruehphase', query: { token: f.contractAddress } } : { path: '/hype-radar/favoriten' })
const ansichtZiel = (f) => ({ path: '/coin-radar', query: { symbol: f.symbol } })
</script>

<template>
    <div class="coinfav">
        <p v-if="lauf" class="leise">{{ t('coinFavoriten.stand', { zeit: zeit(lauf.zeit) }) }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Kreisel v-if="laedt" />
        <Leerzustand v-else-if="!favoriten.length" :titel="t('coinFavoriten.leerTitel')" :text="t('coinFavoriten.leerText')" symbol="stern">
            <Knopf art="haupt" symbol="listeNummer" :to="{ path: '/coin-radar' }">{{ t('coinradar.tab_rangliste') }}</Knopf>
        </Leerzustand>

        <div v-else class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th>{{ t('coinradar.spalteSymbol') }}</th>
                        <th>{{ t('coinFavoriten.herkunft') }}</th>
                        <th :title="t('coinFavoriten.standInfo')">{{ t('coinFavoriten.letzterStand') }}</th>
                        <th class="rechts" :title="t('coinradar.spalteNoteHilfe')">{{ t('coinradar.spalteNote') }}</th>
                        <th class="rechts" :title="t('coinradar.spalteAtrHilfe')">{{ t('coinradar.spalteAtr') }}</th>
                        <th class="rechts" :title="t('coinradar.spalteRvolHilfe')">{{ t('coinradar.spalteRvol') }}</th>
                        <th class="rechts" :title="t('coinradar.spalteAdxHilfe')">{{ t('coinradar.spalteAdx') }}</th>
                        <th class="rechts" :title="t('coinradar.spalteFundingHilfe')">{{ t('coinradar.spalteFunding') }}</th>
                        <th :title="t('coinFavoriten.wacheInfo')">{{ t('coinFavoriten.wache') }}</th>
                        <th :aria-label="t('coinFavoriten.aktionen')"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="f in favoriten" :key="f.id">
                        <td class="symbol">
                            <router-link v-if="f.art === 'boerse'" :to="ansichtZiel(f)" :title="t('coinFavoriten.zurAnsicht', { symbol: f.symbol })">{{ f.symbol }}</router-link>
                            <router-link v-else :to="hypeZiel(f)" :title="t('coinFavoriten.zumHype', { symbol: f.symbol })">{{ f.symbol }}</router-link>
                            <div v-if="f.name" class="vermerk">{{ f.name }}</div>
                        </td>
                        <td>
                            {{ t('coinFavoriten.art_' + f.art) }}
                            <div v-if="f.art === 'dex' && f.chain" class="vermerk">{{ f.chain }}</div>
                        </td>
                        <td>
                            <Pille :ton="STATUS_TON[f.status]" :title="t('coinFavoriten.statusInfo_' + f.status)">{{ statusText(f) }}</Pille>
                            <div v-if="f.pruefung" class="vermerk">
                                {{ t('coinFavoriten.pruefung', { hype: f.pruefung.hypeScore ?? '—', sicherheit: f.pruefung.safetyScore ?? '—', zeit: zeit(f.pruefung.zeit) }) }}
                            </div>
                        </td>
                        <td class="rechts note" :title="teilText(f.teilnoten)">{{ f.note == null ? '—' : zahl(f.note, 0) }}</td>
                        <td class="rechts">{{ f.atrPct == null ? '—' : zahl(f.atrPct, 2) }}</td>
                        <td class="rechts">{{ f.rvol == null ? '—' : zahl(f.rvol, 1) + '×' }}</td>
                        <td class="rechts">{{ f.adx == null ? '—' : zahl(f.adx, 0) }}</td>
                        <td class="rechts">{{ f.fundingJahresRate == null ? '—' : zahl(f.fundingJahresRate, 0) + ' %' }}</td>
                        <td>
                            <Pille v-if="f.stumm" ton="neutral">{{ t('coinFavoriten.stumm') }}</Pille>
                            <Pille v-else-if="f.alarmeUngelesen" ton="warn">{{ t('coinFavoriten.alarme', { n: f.alarmeUngelesen }) }}</Pille>
                            <span v-else class="leise">{{ t('coinFavoriten.ruhig') }}</span>
                        </td>
                        <td class="aktionen">
                            <Knopf v-if="f.art === 'boerse'" klein nur-symbol art="leise" symbol="suche" :titel="t('coinFavoriten.zurAnsicht', { symbol: f.symbol })" :to="ansichtZiel(f)" />
                            <Knopf v-if="f.art === 'boerse'" klein nur-symbol art="leise" symbol="chart" :titel="t('coinFavoriten.zumChart', { symbol: f.symbol })" :to="chartZiel(f)" />
                            <Knopf v-else klein nur-symbol art="leise" symbol="suche" :titel="t('coinFavoriten.zumHype', { symbol: f.symbol })" :to="hypeZiel(f)" />
                            <Knopf klein nur-symbol art="leise" symbol="papierkorb" :titel="t('coinFavoriten.entfernenTitel', { symbol: f.symbol })" @click="entferne(f)" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="leise">{{ t('coinFavoriten.hinweis') }}</p>
    </div>
</template>

<style scoped>
.coinfav {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
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

.symbol {
    font-weight: 700;
}

.symbol a {
    color: inherit;
    text-decoration: none;
}

.symbol a:hover {
    color: var(--accent);
}

.vermerk {
    color: var(--muted);
    font-weight: 400;
    font-size: 0.78rem;
}

.liste td.aktionen {
    display: flex;
    gap: 0.3rem;
}
</style>
