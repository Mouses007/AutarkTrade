<script setup>
/**
 * Aktien: welcher Titel ist an welchem angebundenen Handelsplatz kaufbar,
 * als Future, als Spot-Token (xStock) oder als Spot bei Bitpanda.
 *
 * Erste sichtbare Seite der Aktien-Integration (`docs/PLAN-AKTIEN.md`). Sie
 * liest den Instrument-Stamm (`/api/aktien/stamm`); der Abgleich holt nur die
 * öffentlichen Symbol-Listen der Handelsplätze.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import Pille from '../components/basis/Pille.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import { useRoute } from 'vue-router'
import TitelAnsicht from '../components/aktien/TitelAnsicht.vue'

const { t } = useI18n()

/* `/aktien?titel=NVDA` zeigt statt der Liste die Titel-Seite — so kommt sie ohne eigenen Menüeintrag aus. */
const route = useRoute()
const gewaehlt = computed(() => String(route.query.titel || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 15))

const GRENZE = 300
const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
/** Filter → Abfrage. */
const FILTER = [
    { id: 'alle', abfrage: {} },
    { id: 'future', abfrage: { art: 'perp' } },
    { id: 'spotToken', abfrage: { art: 'token-spot' } },
    { id: 'bitpanda', abfrage: { handelsplatz: 'bitpanda' } },
]

const titel = ref([])
const zahlen = ref(null)
const letzterLauf = ref(null)
const suche = ref('')
const filter = ref('alle')
const laedt = ref(true)
const gleichtAb = ref(false)
const fehler = ref('')
const meldung = ref('')

async function lade() {
    laedt.value = true
    fehler.value = ''
    try {
        const abfrage = FILTER.find((f) => f.id === filter.value)?.abfrage || {}
        const [liste, stand] = await Promise.all([
            axios.get('/api/aktien/stamm', { params: { anlageklasse: 'aktien', suche: suche.value.trim(), grenze: GRENZE, ...abfrage } }),
            axios.get('/api/aktien/stamm/stand'),
        ])
        titel.value = liste.data?.titel || []
        zahlen.value = stand.data || null
        letzterLauf.value = stand.data?.letzterLauf || null
    } catch (e) {
        fehler.value = `${t('aktien.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

async function gleicheAb() {
    gleichtAb.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const { data } = await axios.post('/api/aktien/stamm/abgleich', {}, { timeout: 120000 })
        if (!data?.ok) throw new Error(t('aktien.abgleichFehler'))
        meldung.value = t('aktien.abgleichFertig', { neu: data.neuAnzahl, weg: data.wegAnzahl })
        await lade()
    } catch (e) {
        fehler.value = `${t('aktien.abgleichFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        gleichtAb.value = false
    }
}

// Suche: erst nach einer kurzen Tipp-Pause abfragen.
let wecker = null
watch(suche, () => {
    clearTimeout(wecker)
    wecker = setTimeout(lade, 300)
})
watch(filter, lade)
onMounted(lade)

const stammLeer = computed(() => !laedt.value && !(zahlen.value?.unterarten || []).length)
const summe = computed(() => {
    const u = zahlen.value?.unterarten || []
    return {
        titel: u.filter((z) => z.anlageklasse === 'aktien').reduce((s, z) => s + z.anzahl, 0),
        future: zahlen.value?.titelFuture ?? 0,
        spot: zahlen.value?.titelSpot ?? 0,
    }
})
/** Stand je Handelsplatz aus dem letzten Lauf dieses Prozesses. */
const standZeilen = computed(() => Object.entries(letzterLauf.value?.stand || {}).map(([platz, s]) => (s.ok
    ? t('aktien.standOk', { platz: PLATZ[platz] || platz, n: s.anzahl })
    : t('aktien.standAus', { platz: PLATZ[platz] || platz, grund: ['nichtGewaehlt', 'leer'].includes(s.grund) ? t('aktien.grund_' + s.grund) : s.grund }))))

const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
/** Listungen in fester Reihenfolge: Future, Spot-Token, Bitpanda. */
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const geordnet = (listungen) => [...listungen].sort((a, b) => RANG[a.art] - RANG[b.art] || a.handelsplatz.localeCompare(b.handelsplatz))
</script>

<template>
    <TitelAnsicht v-if="gewaehlt" :ticker="gewaehlt" />
    <div v-else class="aktien-seite">
        <div class="leiste">
            <input v-model="suche" class="suche" type="search" :placeholder="t('aktien.suche')" :aria-label="t('aktien.suche')" />
            <div class="filter" role="group" :aria-label="t('aktien.handelbarBei')">
                <button v-for="f in FILTER" :key="f.id" type="button" :class="{ aktiv: filter === f.id }"
                    :aria-pressed="filter === f.id" @click="filter = f.id">{{ t('aktien.' + f.id) }}</button>
            </div>
            <Knopf klein symbol="aktualisieren" :laedt="gleichtAb" @click="gleicheAb">{{ t('aktien.abgleichen') }}</Knopf>
        </div>

        <p v-if="!stammLeer && zahlen" class="zahlen">{{ t('aktien.zahlen', summe) }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <p v-if="meldung" class="zahlen">{{ meldung }}</p>
        <ul v-if="standZeilen.length" class="stand">
            <li v-for="z in standZeilen" :key="z">{{ z }}</li>
        </ul>

        <Kreisel v-if="laedt && !titel.length" />
        <Leerzustand v-else-if="stammLeer" :titel="t('aktien.leerTitel')" :text="t('aktien.leerText')" symbol="gebaeude">
            <Knopf art="haupt" symbol="aktualisieren" :laedt="gleichtAb" @click="gleicheAb">{{ t('aktien.abgleichen') }}</Knopf>
        </Leerzustand>
        <Leerzustand v-else-if="!titel.length" :titel="t('aktien.keineTreffer')" :text="t('aktien.keineTrefferText')" symbol="suche" />

        <table v-else class="liste">
            <thead>
                <tr>
                    <th>{{ t('aktien.ticker') }}</th>
                    <th>{{ t('aktien.name') }}</th>
                    <th>{{ t('aktien.unterart') }}</th>
                    <th>{{ t('aktien.handelbarBei') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="z in titel" :key="z.id">
                    <td class="ticker"><router-link :to="{ path: '/aktien', query: { titel: z.ticker } }" :title="t('titel.oeffnen')">{{ z.ticker }}</router-link></td>
                    <td class="name">{{ z.name || '—' }}</td>
                    <td>{{ t('aktien.art_' + (z.unterart || 'aktie')) }}</td>
                    <td class="plaetze">
                        <Pille v-for="l in geordnet(z.listungen)" :key="l.handelsplatz + l.art" :ton="TON[l.art]"
                            :title="l.sicher ? l.symbol : t('aktien.unsicher')">
                            {{ PLATZ[l.handelsplatz] || l.handelsplatz }} · {{ t('aktien.art_' + l.art) }}<template
                                v-if="l.maxHebel"> · {{ t('aktien.hebel', { n: l.maxHebel }) }}</template><template
                                v-if="!l.sicher"> ?</template>
                        </Pille>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="titel.length >= GRENZE" class="zahlen">{{ t('aktien.gekuerzt', { n: GRENZE }) }}</p>
    </div>
</template>

<style scoped>
.ticker a {
    color: inherit;
    text-decoration: none;
}

.ticker a:hover {
    color: var(--accent);
}

.aktien-seite {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem;
}

.suche {
    flex: 1 1 14rem;
    max-width: 22rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel);
    color: var(--text);
    font: inherit;
}

.filter {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    overflow: hidden;
}

.filter button {
    padding: 0.4rem 0.8rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}

.filter button.aktiv {
    background: var(--accent-flaeche);
    color: var(--accent);
    font-weight: 600;
}

.zahlen,
.stand {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
}

.stand {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 1.2rem;
    padding: 0;
    list-style: none;
}

.liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
}

.liste th {
    text-align: left;
    padding: 0.5rem 0.6rem;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--line);
}

.liste td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
}

.ticker {
    font-weight: 700;
    white-space: nowrap;
}

.name {
    color: var(--muted);
}

.plaetze {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

/* Telefon: Name und Art weichen, Ticker und Handelsplätze bleiben. */
@media (max-width: 767.98px) {
    .liste th:nth-child(3),
    .liste td:nth-child(3) {
        display: none;
    }
}
</style>
