<script setup>
/**
 * Marktlage für Aktien: das Umfeld, in dem man Einzeltitel handelt — Index
 * gegen die 200-Tage-Linie, Schwankung (VIX), Sektoren gegen den Index,
 * Zinsen, Dollar und die Breite im eigenen Feld.
 *
 * Gegenstück zum Krypto-Marktradar, dessen Kacheln (Fear & Greed, Dominanz,
 * Altseason, Funding) für Aktien nichts bedeuten. Alles ist eine Beschreibung
 * aus Tageskursen; das Urteil oben ist regelbasiert und nennt seine Gründe
 * (`server/aktien/marktlage-kern.js`). Keine Vorhersage, keine Empfehlung.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import Pille from '../components/basis/Pille.vue'
import Karte from '../components/basis/Karte.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import QuelleAus from '../components/quellen/QuelleAus.vue'

const { t, locale } = useI18n()

const lage = ref(null)
const aus = ref(null)
const laedt = ref(true)
const fehler = ref('')

async function lade(neu = false) {
    laedt.value = true
    fehler.value = ''
    aus.value = null
    try {
        const { data } = await axios.get('/api/aktien/marktlage', { params: neu ? { neu: 1 } : {}, timeout: 60000 })
        if (data?.aus) { aus.value = data; lage.value = null }
        else if (data?.ok) lage.value = data
        else fehler.value = t('marktlage.grund_' + (data?.grund || 'abrufFehlgeschlagen'))
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}
onMounted(() => lade())

const zahl = (v, n = 2) => (v == null ? '—' : Number(v).toLocaleString(locale.value, { minimumFractionDigits: n, maximumFractionDigits: n }))
const prozent = (v, n = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${zahl(v, n)} %`)
const zeit = (ms) => (ms ? new Date(ms).toLocaleString(locale.value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const richtung = (v) => (v == null || v === 0 ? '' : v > 0 ? 'auf' : 'ab')

const indizes = computed(() => Object.entries(lage.value?.index || {}).filter(([, v]) => v).map(([id, v]) => ({ id, ...v })))
/** Breite der Balken: Stärke über drei Monate relativ zum grössten Ausschlag. */
const sektoren = computed(() => {
    const liste = lage.value?.sektoren || []
    const max = Math.max(...liste.map((s) => Math.abs(s.rs3m ?? 0)), 0.01)
    return liste.map((s) => ({ ...s, breite: (Math.abs(s.rs3m ?? 0) / max) * 50 }))
})
</script>

<template>
    <div class="marktlage-seite">
        <div class="leiste">
            <p class="klein">{{ lage ? t('marktlage.stand', { zeit: zeit(lage.stand) }) : '' }}</p>
            <Knopf klein symbol="aktualisieren" :laedt="laedt" @click="lade(true)">{{ t('marktlage.aktualisieren') }}</Knopf>
        </div>

        <QuelleAus v-if="aus" :aus="aus" />
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <Kreisel v-if="laedt && !lage" />

        <template v-if="lage">
            <!-- Urteil und seine Gründe -->
            <section class="urteil" :class="lage.urteil">
                <div class="kopf">
                    <span class="marke">{{ t('marktlage.urteil_' + lage.urteil) }}</span>
                    <p>{{ t('marktlage.urteilText_' + lage.urteil) }}</p>
                </div>
                <div v-if="lage.gruende.length" class="gruende">
                    <Pille v-for="g in lage.gruende" :key="g.id" :ton="g.ton === 'gut' ? 'gut' : g.ton === 'schlecht' ? 'schlecht' : 'neutral'">{{ t('marktlage.grund.' + g.id) }}</Pille>
                </div>
            </section>
            <Hinweis v-if="lage.fehlend?.length" art="warn">{{ t('marktlage.fehlend', { liste: lage.fehlend.join(', ') }) }}</Hinweis>

            <div class="reihe">
                <!-- Index -->
                <Karte :titel="t('marktlage.index')" :unter="t('marktlage.indexUnter')">
                    <table v-if="indizes.length" class="tabelle">
                        <thead>
                            <tr>
                                <th></th>
                                <th class="rechts">{{ t('marktlage.kurs') }}</th>
                                <th class="rechts">{{ t('marktlage.zur200') }}</th>
                                <th>{{ t('marktlage.linie') }}</th>
                                <th class="rechts">{{ t('marktlage.m1') }}</th>
                                <th class="rechts">{{ t('marktlage.m3') }}</th>
                                <th class="rechts">{{ t('marktlage.vomHoch') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="i in indizes" :key="i.id">
                                <td><b>{{ i.id }}</b> <span class="klein">{{ t('marktlage.name.' + i.id) }}</span></td>
                                <td class="rechts">{{ zahl(i.kurs) }}</td>
                                <td class="rechts" :class="richtung(i.abstand200Pct)">{{ prozent(i.abstand200Pct) }}</td>
                                <td>{{ i.linie200 ? t('marktlage.linie_' + i.linie200) : '—' }}</td>
                                <td class="rechts" :class="richtung(i.perf1m)">{{ prozent(i.perf1m) }}</td>
                                <td class="rechts" :class="richtung(i.perf3m)">{{ prozent(i.perf3m) }}</td>
                                <td class="rechts">{{ prozent(i.abstandHochPct) }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <p v-else class="klein">—</p>
                </Karte>

                <!-- Schwankung, Zinsen, Dollar, Breite -->
                <Karte :titel="t('marktlage.umfeld')">
                    <dl class="werte">
                        <div v-if="lage.schwankung">
                            <dt>{{ t('marktlage.vix') }}</dt>
                            <dd>
                                <b>{{ zahl(lage.schwankung.vix, 1) }}</b>
                                <span class="klein">{{ t('marktlage.vix_' + lage.schwankung.zone) }}<template v-if="lage.schwankung.rangPct != null"> · {{ t('marktlage.vixRang', { n: zahl(lage.schwankung.rangPct, 0) }) }}</template></span>
                            </dd>
                        </div>
                        <div v-if="lage.schwankung?.vix3m != null">
                            <dt>{{ t('marktlage.vix3m') }}</dt>
                            <dd>
                                <b>{{ zahl(lage.schwankung.vix3m, 1) }}</b>
                                <span class="klein" :class="{ ab: lage.schwankung.struktur === 'umgekehrt' }">{{ t('marktlage.struktur_' + lage.schwankung.struktur) }}</span>
                            </dd>
                        </div>
                        <div v-if="lage.zins">
                            <dt>{{ t('marktlage.zins') }}</dt>
                            <dd><b>{{ zahl(lage.zins.stand, 2) }} %</b> <span v-if="lage.zins.aenderung1m != null" class="klein">{{ t('marktlage.zinsMonat', { n: (lage.zins.aenderung1m > 0 ? '+' : '') + zahl(lage.zins.aenderung1m * 100, 0) }) }}</span></dd>
                        </div>
                        <div v-if="lage.dollar">
                            <dt>{{ t('marktlage.dollar') }}</dt>
                            <dd><b>{{ zahl(lage.dollar.stand, 1) }}</b> <span v-if="lage.dollar.aenderung1m != null" class="klein">{{ t('marktlage.monat', { n: prozent(lage.dollar.aenderung1m) }) }}</span></dd>
                        </div>
                        <div>
                            <dt>{{ t('marktlage.breite') }}</dt>
                            <dd v-if="lage.breite"><b>{{ zahl(lage.breite.anteilPct, 0) }} %</b> <span class="klein">{{ t('marktlage.breiteText', { ueber: lage.breite.ueber, gezaehlt: lage.breite.gezaehlt, datum: datum(lage.breite.stand) }) }}</span></dd>
                            <dd v-else><span class="klein">{{ t('marktlage.breiteFehlt') }}</span></dd>
                        </div>
                    </dl>
                    <p class="klein fuss">{{ t('marktlage.umfeldHinweis') }}</p>
                </Karte>
            </div>

            <!-- Sektoren -->
            <Karte :titel="t('marktlage.sektoren')" :unter="t('marktlage.sektorenUnter')">
                <ul v-if="sektoren.length" class="sektoren">
                    <li v-for="s in sektoren" :key="s.id">
                        <span class="name"><b>{{ s.id }}</b> {{ t('marktlage.sektor.' + s.id) }}</span>
                        <span class="spur">
                            <i :class="s.rs3m >= 0 ? 'plus' : 'minus'" :style="{ width: s.breite + '%' }"></i>
                        </span>
                        <span class="zahl" :class="richtung(s.rs3m)">{{ prozent(s.rs3m) }}</span>
                        <span class="zahl klein" :class="richtung(s.rs1m)" :title="t('marktlage.m1')">{{ prozent(s.rs1m) }}</span>
                        <span class="klein">{{ s.ueber50 == null ? '' : t(s.ueber50 ? 'marktlage.ueber50' : 'marktlage.unter50') }}</span>
                    </li>
                </ul>
                <p v-else class="klein">—</p>
            </Karte>

            <p class="klein">{{ t('marktlage.quelle') }}</p>
        </template>
    </div>
</template>

<style scoped>
.marktlage-seite {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

p {
    margin: 0;
}

.klein {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
}

.auf {
    color: var(--good);
}

.ab {
    color: var(--bad);
}

.leiste {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
}

/* Urteil: ein Band mit farbigem linkem Rand */
.urteil {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--line);
    border-left: 4px solid var(--muted);
    border-radius: var(--radius);
    background: var(--panel);
}

.urteil.rueckenwind {
    border-left-color: var(--good);
}

.urteil.gegenwind {
    border-left-color: var(--bad);
}

.urteil.gemischt {
    border-left-color: var(--warn);
}

.urteil .kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 1rem;
}

.urteil .marke {
    font-size: 1.25rem;
    font-weight: 600;
}

.urteil .kopf p {
    color: var(--muted);
    font-size: 0.9rem;
}

.gruende {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.reihe {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 0.9rem;
    align-items: start;
}

@media (max-width: 999.98px) {
    .reihe {
        grid-template-columns: minmax(0, 1fr);
    }
}

.tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
}

.tabelle th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
}

.tabelle td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--line);
}

.rechts {
    text-align: right;
}

.werte {
    margin: 0;
}

.werte div {
    display: grid;
    grid-template-columns: 9.5rem minmax(0, 1fr);
    gap: 0.8rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.88rem;
}

dt {
    color: var(--muted);
}

dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.6rem;
    font-variant-numeric: tabular-nums;
}

.fuss {
    margin-top: 0.7rem;
}

/* Sektoren: Balken von der Mitte nach links (schwächer) und rechts (stärker als der Index) */
.sektoren {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.sektoren li {
    display: grid;
    grid-template-columns: minmax(9rem, 15rem) minmax(4rem, 1fr) 4.5rem 4.5rem minmax(0, 9rem);
    align-items: center;
    gap: 0.7rem;
    font-size: 0.86rem;
}

.sektoren .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sektoren .zahl {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.spur {
    position: relative;
    height: 10px;
    border-radius: 2px;
    background: var(--panel-soft);
}

.spur::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--line);
}

.spur i {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
}

.spur .plus {
    left: 50%;
    background: var(--good);
    border-radius: 0 2px 2px 0;
}

.spur .minus {
    right: 50%;
    background: var(--bad);
    border-radius: 2px 0 0 2px;
}

@media (max-width: 699.98px) {
    .sektoren li {
        grid-template-columns: minmax(0, 1fr) 4.5rem 4.5rem;
    }

    .sektoren .spur,
    .sektoren li > .klein:last-child {
        display: none;
    }
}
</style>
