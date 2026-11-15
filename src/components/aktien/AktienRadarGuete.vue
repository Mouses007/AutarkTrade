<script setup>
/**
 * Erfolgskontrolle des Aktien-Radars: hat die Spitze der Rangliste den Index
 * geschlagen? Gemessen wird die Mehrrendite gegen die Referenz des Laufs (SPY)
 * über einen Tag, eine Woche und vier Wochen — und gegen eine Zufallsauswahl
 * aus der unteren Hälfte desselben Laufs (`server/coin-radar/aktien-erfolg.js`).
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Kreisel from '../basis/Kreisel.vue'
import Hinweis from '../basis/Hinweis.vue'

const { t, locale } = useI18n()
const laedt = ref(true)
const fehler = ref('')
const daten = ref(null)

onMounted(async () => {
    try {
        daten.value = (await axios.get('/api/coin-radar/guete', { params: { markt: 'aktien' } })).data
    } catch (e) {
        fehler.value = `${t('aktienAlltag.guete.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
})

const prozent = (x, stellen = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x)} %`)
const anteil = (a) => (a?.wert == null ? '—' : `${Math.round(a.wert * 100)} % (${a.k}/${a.n})`)
const pWert = (p) => (p == null ? '—' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }).format(p))
</script>

<template>
    <section class="guete" :aria-label="t('aktienAlltag.guete.titel')">
        <h2>{{ t('aktienAlltag.guete.titel') }}</h2>
        <p class="leise">{{ t('aktienAlltag.guete.text') }}</p>
        <Kreisel v-if="laedt" />
        <Hinweis v-else-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <p v-else-if="!daten?.gesamt" class="leise">{{ t('aktienAlltag.guete.leer') }}</p>
        <div v-else class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th>{{ t('aktienAlltag.guete.horizont') }}</th>
                        <th class="rechts" :title="t('aktienAlltag.guete.laeufeInfo')">{{ t('aktienAlltag.guete.laeufe') }}</th>
                        <th class="rechts" :title="t('aktienAlltag.guete.mehrrenditeInfo')">{{ t('aktienAlltag.guete.mehrrendite') }}</th>
                        <th class="rechts" :title="t('aktienAlltag.guete.vorIndexInfo')">{{ t('aktienAlltag.guete.vorIndex') }}</th>
                        <th class="rechts" :title="t('aktienAlltag.guete.abstandInfo')">{{ t('aktienAlltag.guete.abstand') }}</th>
                        <th class="rechts" :title="t('aktienAlltag.guete.pInfo')">p</th>
                        <th>{{ t('aktienAlltag.guete.urteil') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="h in daten.jeHorizont" :key="h.horizont">
                        <td>{{ t('aktienAlltag.guete.horizont_' + h.horizont) }}</td>
                        <td class="rechts">{{ h.laeufeMitReferenz }}<span v-if="h.offen" class="leise"> · {{ t('aktienAlltag.guete.offen', { n: h.offen }) }}</span></td>
                        <td class="rechts">{{ prozent(h.mehrrenditeMedian) }}</td>
                        <td class="rechts">{{ anteil(h.vorIndex) }}</td>
                        <td class="rechts">{{ prozent(h.abstandMedian) }}</td>
                        <td class="rechts">{{ pWert(h.vorzeichenP) }}</td>
                        <td>{{ t('aktienAlltag.guete.urteil_' + h.urteil) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="leise">{{ t('aktienAlltag.guete.grenzen') }}</p>
    </section>
</template>

<style scoped>
.guete {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--line);
    border-radius: 10px;
}

h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
}

.leise {
    margin: 0;
    color: var(--muted);
    font-size: 0.84rem;
}

.rolle {
    overflow-x: auto;
}

.liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
}

.liste th {
    text-align: left;
    padding: 0.4rem 0.6rem;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.76rem;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
}

.liste th[title] {
    cursor: help;
}

.liste td {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--line);
}

.liste .rechts {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
</style>
