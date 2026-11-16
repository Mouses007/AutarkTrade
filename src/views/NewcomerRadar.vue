<script setup>
/**
 * Newcomer-Radar: junge Börsenfirmen und frisch handelbare Titel, nach
 * Neuheit, Kursstärke und Volumen sortiert (`server/newcomer-radar/`).
 *
 * Gegenstück zum Hype-Radar im Markt «Aktien». Die Seite liest nur; der Lauf
 * (Knopf oder Tagestakt) fragt die Kursquelle für jeden Titel des Stamms.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { haltefrist } from '../../shared/aktien-newcomer.js'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import FavoritStern from '../components/aktien/FavoritStern.vue'
import Pille from '../components/basis/Pille.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import Quellenhinweis from '../components/basis/Quellenhinweis.vue'

const { t, locale } = useI18n()

/* Übliche Haltefrist nach dem Börsengang (180 Tage), gerechnet aus dem Alter — eine Schätzung, kein Prospektdatum. */
const fristVon = (z) => (z.kennzahlen?.alterTage == null ? null : haltefrist(Date.now() - z.kennzahlen.alterTage * 86_400_000))

/* Deckel der Note bei dünn gemessenem Momentum — derselbe Wert wie `DECKEL_DUENN` in `server/newcomer-radar/bewertung.js`. */
const DECKEL_DUENN = 49
const KATEGORIEN = ['boersengang', 'vorboerslich', 'neuGelistet', 'etabliert', 'unbekannt']
const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }

const kategorie = ref('boersengang')
const mitHuerden = ref(false)
const titel = ref([])
const zahlen = ref({})
const lauf = ref({ laeuft: false })
const laedt = ref(true)
const fehler = ref('')
const quelleAus = ref(false)

async function ladeStand() {
    const { data } = await axios.get('/api/newcomer-radar/stand')
    zahlen.value = data?.kategorien || {}
    lauf.value = data?.lauf || { laeuft: false }
}

async function lade() {
    fehler.value = ''
    try {
        const [liste] = await Promise.all([
            axios.get('/api/newcomer-radar/titel', { params: { kategorie: kategorie.value, mitHuerden: mitHuerden.value ? 1 : 0, grenze: 200 } }),
            ladeStand(),
        ])
        titel.value = liste.data?.titel || []
    } catch (e) {
        fehler.value = `${t('newcomer.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

async function starteLauf() {
    fehler.value = ''
    quelleAus.value = false
    try {
        const { data } = await axios.post('/api/newcomer-radar/lauf', {})
        if (data?.aus) { quelleAus.value = true; return }
        lauf.value = data?.lauf || lauf.value
        takte()
    } catch (e) {
        fehler.value = `${t('newcomer.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    }
}

// Solange ein Lauf läuft: alle 4 s den Fortschritt, alle 20 s die Liste.
let wecker = null
let runde = 0
function takte() {
    clearTimeout(wecker)
    if (!lauf.value?.laeuft) return
    wecker = setTimeout(async () => {
        try {
            runde++
            if (runde % 5 === 0) await lade()
            else await ladeStand()
            if (!lauf.value?.laeuft) await lade()
        } catch { /* nächster Takt versucht es wieder */ }
        takte()
    }, 4000)
}

watch([kategorie, mitHuerden], lade)
onMounted(async () => { await lade(); takte() })
onBeforeUnmount(() => clearTimeout(wecker))

const nieGelaufen = computed(() => !laedt.value && !Object.keys(zahlen.value).length && !lauf.value?.laeuft)
const anzahl = (k) => (k === 'vorboerslich' || mitHuerden.value ? zahlen.value[k]?.gesamt : zahlen.value[k]?.zugelassen) ?? 0

const zahl = (x, stellen = 1) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x))
const prozent = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${zahl(x, 1)} %`)
const richtung = (x) => (x == null ? '' : x > 0 ? 'auf' : x < 0 ? 'ab' : '')
function alter(tage) {
    if (tage == null) return '—'
    if (tage < 60) return t('newcomer.alter_tage', { n: tage })
    if (tage < 730) return t('newcomer.alter_monate', { n: Math.round(tage / 30.4) })
    return t('newcomer.alter_jahre', { n: zahl(tage / 365, 1) })
}
const geordnet = (listungen) => [...listungen].sort((a, b) => RANG[a.art] - RANG[b.art] || a.handelsplatz.localeCompare(b.handelsplatz))
const notenText = (n) => t('newcomer.teilnoten', { neuheit: n?.neuheit ?? '—', momentum: n?.momentum ?? '—', beteiligung: n?.beteiligung ?? '—' })
</script>

<template>
    <div class="newcomer-seite">
        <div class="leiste">
            <div class="reiter" role="group" :aria-label="t('nav.newcomerRadar')">
                <button v-for="k in KATEGORIEN" :key="k" type="button" :class="{ aktiv: kategorie === k }" :aria-pressed="kategorie === k"
                    :title="t('newcomer.katInfo_' + k)" @click="kategorie = k">
                    {{ t('newcomer.kat_' + k) }} <span class="anzahl">{{ anzahl(k) }}</span>
                </button>
            </div>
            <label class="haken"><input v-model="mitHuerden" type="checkbox" /> {{ t('newcomer.mitHuerden') }}</label>
            <Knopf klein symbol="aktualisieren" :laedt="!!lauf.laeuft" @click="starteLauf">{{ t('newcomer.lauf') }}</Knopf>
        </div>

        <p class="leise">{{ t('newcomer.katInfo_' + kategorie) }}</p>
        <p v-if="lauf.laeuft" class="leise" role="status">{{ t('newcomer.laufLaeuft', { fertig: lauf.fertig, gesamt: lauf.gesamt }) }}</p>
        <p v-else-if="lauf.ende" class="leise">{{ t('newcomer.laufFertig', { bewertet: lauf.bewertet, ohneKurse: lauf.ohneKurse, fehler: lauf.fehler }) }}</p>
        <Hinweis v-if="lauf.abbruch" art="warn">{{ t('newcomer.abbruch_' + lauf.abbruch) }}</Hinweis>
        <Hinweis v-if="quelleAus" art="warn">{{ t('newcomer.quelleAus') }}</Hinweis>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Kreisel v-if="laedt" />
        <Leerzustand v-else-if="nieGelaufen" :titel="t('newcomer.leerTitel')" :text="t('newcomer.leerText') + ' ' + t('newcomer.stammFehlt')" symbol="entdecken">
            <Knopf art="haupt" symbol="aktualisieren" @click="starteLauf">{{ t('newcomer.lauf') }}</Knopf>
        </Leerzustand>
        <Leerzustand v-else-if="!titel.length" :titel="t('newcomer.keineTitel')" :text="t('newcomer.keineTitelText')" symbol="suche" />

        <div v-else class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th class="rechts">{{ t('newcomer.note') }}</th>
                        <th>{{ t('newcomer.ticker') }}</th>
                        <th>{{ t('newcomer.name') }}</th>
                        <th>{{ t('newcomer.boersengang') }}</th>
                        <th class="rechts">{{ t('newcomer.kurs') }}</th>
                        <th class="rechts">{{ t('newcomer.vomHoch') }}</th>
                        <th class="rechts">{{ t('newcomer.perf3m') }}</th>
                        <th class="rechts">{{ t('newcomer.gegenIndex') }}</th>
                        <th class="rechts">{{ t('newcomer.rvol') }}</th>
                        <th>{{ t('newcomer.handelbar') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="z in titel" :key="z.id">
                        <td class="rechts note" :title="notenText(z.noten)">{{ z.kennzahlen.gedeckelt ? '≤ ' : '' }}{{ z.note == null ? '—' : zahl(z.note, 0) }}</td>
                        <td class="ticker">
                            <FavoritStern :ticker="z.ticker" @fehler="fehler = $event" />
                            <router-link :to="{ path: '/aktien', query: { titel: z.ticker } }" :title="t('titel.oeffnen')">{{ z.ticker }}</router-link>
                            <span v-if="z.zuordnung === 'sucheFremd'" class="frage" :title="t('newcomer.zuordnung_sucheFremd')">?</span>
                        </td>
                        <td class="name">
                            {{ z.name || '—' }}
                            <div v-if="z.kennzahlen.gedeckelt" class="vermerk warn" :title="t('newcomer.gedeckeltInfo', { deckel: DECKEL_DUENN })">{{ t('newcomer.gedeckelt') }}</div>
                            <div v-if="z.huerden.length || z.grund" class="vermerk">
                                <span v-for="h in z.huerden" :key="h">{{ t('newcomer.huerde_' + h) }}</span>
                                <span v-if="z.grund">{{ t('newcomer.grund_' + z.grund) }}</span>
                            </div>
                        </td>
                        <td>
                            {{ alter(z.kennzahlen.alterTage) }}
                            <div v-if="fristVon(z)" class="vermerk" :class="{ warn: fristVon(z).status !== 'laeuft' }" :title="t('newcomer.haltefristInfo')">
                                {{ t('newcomer.haltefrist_' + fristVon(z).status, { n: Math.abs(fristVon(z).tage) }) }}
                            </div>
                            <div v-if="z.kennzahlen.listungVorTagen != null && z.kennzahlen.listungVorTagen <= 45" class="vermerk">
                                {{ t('newcomer.gelistetVor', { n: z.kennzahlen.listungVorTagen }) }}
                            </div>
                        </td>
                        <td class="rechts">{{ z.kennzahlen.kurs == null ? '—' : zahl(z.kennzahlen.kurs, 2) }} <span class="leise">{{ z.kennzahlen.waehrung }}</span></td>
                        <td class="rechts">{{ prozent(z.kennzahlen.abstandHochPct) }}</td>
                        <td :class="['rechts', richtung(z.kennzahlen.perf3m)]">{{ prozent(z.kennzahlen.perf3m) }}</td>
                        <td :class="['rechts', richtung(z.kennzahlen.relStaerke3m)]">{{ prozent(z.kennzahlen.relStaerke3m) }}</td>
                        <td class="rechts">{{ z.kennzahlen.rvol == null ? '—' : zahl(z.kennzahlen.rvol, 1) + '×' }}</td>
                        <td class="plaetze">
                            <Pille v-for="l in geordnet(z.listungen)" :key="l.handelsplatz + l.art" :ton="TON[l.art]" :title="l.symbol">
                                {{ PLATZ[l.handelsplatz] || l.handelsplatz }} · {{ t('aktien.art_' + l.art) }}
                            </Pille>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="leise">{{ t('newcomer.hinweis') }}</p>
        <Quellenhinweis :quellen="[{ name: 'Yahoo Finance', art: 'daten' }]" />
    </div>
</template>

<style scoped>
.vermerk.warn {
    color: var(--warn);
}

.ticker .stern {
    margin-right: 0.3rem;
    vertical-align: -0.15em;
}

.ticker a {
    color: inherit;
    text-decoration: none;
}

.ticker a:hover {
    color: var(--accent);
}

.newcomer-seite {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem 1rem;
}

.reiter {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    overflow: hidden;
}

.reiter button {
    padding: 0.4rem 0.8rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}

.reiter button.aktiv {
    background: var(--accent-flaeche);
    color: var(--accent);
    font-weight: 600;
}

.anzahl {
    opacity: 0.7;
    font-size: 0.78rem;
}

.haken {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.88rem;
    cursor: pointer;
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
    cursor: help;
}

.ticker {
    font-weight: 700;
}

.frage {
    color: var(--muted);
    font-weight: 400;
    cursor: help;
}

.liste td.name {
    color: var(--muted);
    white-space: normal;
    min-width: 9rem;
}

.vermerk {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.6rem;
    color: var(--muted);
    font-size: 0.78rem;
}

.auf {
    color: var(--good);
}

.ab {
    color: var(--bad);
}

.liste td.plaetze {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    white-space: normal;
    min-width: 12rem;
}
</style>
