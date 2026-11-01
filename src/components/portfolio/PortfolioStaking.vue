<script setup>
/**
 * Staking: was an einem Ort laufend Ertrag abwirft — je Coin und Produkt
 * (Bitpanda: Staking, Passive Earn; Importe: Ertrag). Die Rechnung macht der
 * Server (`server/portfolio/staking.js`), hier wird nur gezeichnet.
 *
 * Laufende Produkte zeigen Einsatz, Bestand, Erträge und die GEMESSENE Rendite;
 * beendete nur, was sie eingebracht haben. Der Wert bei Erhalt ist das, was im
 * Steuerbericht als Einkommen steht.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { chf, menge, prozent, farbeVon } from '../../stores/portfolio.js'
import { Karte, Hinweis, Kreisel, Leerzustand, Symbol } from '../basis/index.js'

const { t } = useI18n()
const daten = ref(null)
const laedt = ref(false)
const fehler = ref('')

async function lade() {
    laedt.value = true
    fehler.value = ''
    try { daten.value = (await axios.get('/api/portfolio/staking')).data } catch (e) { fehler.value = e.response?.data?.error || e.message } finally { laedt.value = false }
}
onMounted(lade)

const laufend = computed(() => (daten.value?.produkte || []).filter((p) => p.aktiv))
const beendet = computed(() => (daten.value?.produkte || []).filter((p) => !p.aktiv))
const summe = computed(() => daten.value?.summe)

const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }) : '—')
function rhythmus(tage) {
    if (tage == null) return ''
    if (tage < 1.5) return t('portfolio.stkTaeglich')
    if (tage >= 6 && tage <= 8) return t('portfolio.stkWoechentlich')
    if (tage >= 27 && tage <= 32) return t('portfolio.stkMonatlich')
    return t('portfolio.stkAlleTage', { n: Math.round(tage) })
}
const auszahlungen = (p) => [p.anzahl === 1 ? t('portfolio.stkAuszahlung') : t('portfolio.stkAuszahlungen', { n: p.anzahl }), rhythmus(p.intervallTage)].filter(Boolean).join(' · ')
const zuBewegungen = (p) => ({ path: '/portfolio/bewegungen', query: { quelle: p.quelle, asset: p.asset } })
</script>

<template>
    <div class="stk">
        <p class="stk-erkl">{{ t('portfolio.stkErkl') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <div v-if="laedt && !daten" class="at-mittig at-py-5"><Kreisel /></div>

        <Leerzustand v-else-if="daten && !daten.produkte.length" class="at-mo-4" symbol="schloss" :titel="t('portfolio.stkLeerTitel')" :text="t('portfolio.stkLeerText')" />

        <template v-else-if="daten">
            <div class="stk-kacheln">
                <Karte class="stk-kachel">
                    <span class="stk-etikett">{{ t('portfolio.stkImStaking') }}</span>
                    <b class="stk-zahl">{{ chf(summe.bestandChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stkLaufendeAnzahl', { n: summe.aktiv }) }}</small>
                </Karte>
                <Karte class="stk-kachel">
                    <span class="stk-etikett">{{ t('portfolio.stkErtragErhalt') }}</span>
                    <b class="stk-zahl at-gut">{{ chf(summe.ertragChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stkErtragErhaltInfo') }}<template v-if="summe.ertragOhneChf"> · {{ t('portfolio.stkOhneKurs', { n: summe.ertragOhneChf }) }}</template></small>
                </Karte>
                <Karte class="stk-kachel">
                    <span class="stk-etikett">{{ t('portfolio.stkErtragHeute') }}</span>
                    <b class="stk-zahl">{{ chf(summe.laufendErtragHeuteChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stkErtragHeuteInfo', { w: chf(summe.laufendErtragChf) }) }}</small>
                </Karte>
            </div>

            <section v-if="laufend.length" class="stk-abschnitt">
                <h3>{{ t('portfolio.stkLaufend') }}</h3>
                <div class="stk-tabelle">
                    <div class="stk-zeile kopf">
                        <span>Coin</span><span>{{ t('portfolio.stkEinsatz') }}</span><span>{{ t('portfolio.stkBestand') }}</span>
                        <span>{{ t('portfolio.stkErtraege') }}</span><span>{{ t('portfolio.stkWert') }}</span><span>{{ t('portfolio.stkRendite') }}</span>
                    </div>
                    <div v-for="p in laufend" :key="`${p.quelle}|${p.asset}|${p.produkt}`" class="stk-zeile">
                        <span class="stk-coin">
                            <span class="punkt" :style="{ background: farbeVon(p.asset) }" /><b>{{ p.asset }}</b>
                            <span class="stk-produkt">{{ t('portfolio.produkt_' + p.produkt) }}</span>
                            <small class="at-gedaempft">{{ p.ortName }} · {{ t('portfolio.stkSeit', { d: datum(p.seit) }) }}</small>
                        </span>
                        <span :data-titel="t('portfolio.stkEinsatz')" :title="t('portfolio.stkEinsatzInfo')">{{ p.eingesetzt != null ? menge(p.eingesetzt) : '—' }}</span>
                        <span :data-titel="t('portfolio.stkBestand')">{{ menge(p.bestandMenge) }}<small class="at-gedaempft">{{ chf(p.bestandChf) }}</small></span>
                        <span :data-titel="t('portfolio.stkErtraege')">
                            <router-link :to="zuBewegungen(p)" class="stk-link at-gut">+{{ menge(p.ertragMenge) }}</router-link>
                            <small class="at-gedaempft">{{ auszahlungen(p) }}</small>
                        </span>
                        <span :data-titel="t('portfolio.stkWert')">
                            {{ chf(p.ertragChf) }}
                            <small class="at-gedaempft">{{ t('portfolio.stkHeute', { w: chf(p.ertragHeuteChf) }) }}<template v-if="p.ertragOhneChf"> · {{ t('portfolio.stkOhneKurs', { n: p.ertragOhneChf }) }}</template></small>
                        </span>
                        <span :data-titel="t('portfolio.stkRendite')" :title="p.renditeTage ? t('portfolio.stkRenditeInfo', { n: p.renditeTage }) : t('portfolio.stkRenditeFehlt')">
                            <b>{{ prozent(p.renditePa) }}</b>
                        </span>
                    </div>
                </div>
            </section>

            <section v-if="beendet.length" class="stk-abschnitt">
                <h3>{{ t('portfolio.stkBeendet') }}</h3>
                <div class="stk-tabelle">
                    <div v-for="p in beendet" :key="`${p.quelle}|${p.asset}|${p.produkt}`" class="stk-zeile beendet">
                        <span class="stk-coin">
                            <span class="punkt" :style="{ background: farbeVon(p.asset) }" /><b>{{ p.asset }}</b>
                            <span class="stk-produkt">{{ t('portfolio.produkt_' + p.produkt) }}</span>
                            <small class="at-gedaempft">{{ p.ortName }} · {{ datum(p.seit) }} – {{ datum(p.letzte) }}</small>
                        </span>
                        <span>
                            <router-link :to="zuBewegungen(p)" class="stk-link">+{{ menge(p.ertragMenge) }} {{ p.asset }}</router-link>
                            <small class="at-gedaempft">{{ auszahlungen(p) }}</small>
                        </span>
                        <span>
                            {{ chf(p.ertragChf) }}
                            <small class="at-gedaempft">{{ t('portfolio.stkBeiErhalt') }}<template v-if="p.ertragOhneChf"> · {{ t('portfolio.stkOhneKurs', { n: p.ertragOhneChf }) }}</template></small>
                        </span>
                    </div>
                </div>
            </section>
            <p class="stk-fuss"><Symbol name="info" :groesse="13" /> {{ t('portfolio.stkFuss') }}</p>
        </template>
    </div>
</template>

<style scoped>
.stk-erkl { font-size: 0.85rem; color: var(--muted); max-width: 62rem; margin: 0.5rem 0 1rem; }
.stk-kacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.75rem; }
.stk-kachel { display: flex; flex-direction: column; gap: 0.2rem; }
.stk-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.stk-zahl { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.stk-abschnitt { margin-top: 1.25rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.stk-abschnitt h3 { font-size: 1rem; margin: 0 0 0.6rem; }
.stk-tabelle { display: flex; flex-direction: column; }
.stk-zeile {
    display: grid; grid-template-columns: minmax(9.5rem, 1.5fr) repeat(4, minmax(0, 1fr)) 4.5rem;
    gap: 0.6rem; align-items: start; padding: 0.55rem 0; border-bottom: 1px dashed var(--line); font-size: 0.86rem; font-variant-numeric: tabular-nums;
}
.stk-zeile.beendet { grid-template-columns: minmax(9.5rem, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); }
.stk-zeile.kopf { font-size: 0.72rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--line); }
.stk-zeile > span:not(.stk-coin) small { display: block; font-size: 0.72rem; }
.stk-coin { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.45rem; }
.stk-coin small { display: block; width: 100%; font-size: 0.72rem; }
.stk-produkt { font-size: 0.7rem; color: var(--accent); border: 1px solid var(--accent-schwach); border-radius: var(--radius-pille); padding: 0 0.45rem; }
.stk-link { color: inherit; text-decoration: none; }
.stk-link:hover { text-decoration: underline; }
.stk-link.at-gut { color: var(--good); }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.stk-fuss { font-size: 0.78rem; color: var(--leise); margin-top: 0.9rem; max-width: 62rem; display: flex; gap: 0.35rem; align-items: baseline; }
/* Mit Seitenmenü bleibt unter ~1000 px zu wenig Platz für sechs Spalten. */
@media (max-width: 1000px) {
    .stk-zeile, .stk-zeile.beendet { grid-template-columns: 1fr 1fr; }
    .stk-zeile .stk-coin { grid-column: 1 / -1; }
    .stk-zeile.kopf { display: none; }
    .stk-zeile > span[data-titel]::before { content: attr(data-titel); display: block; font-size: 0.68rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; }
}
</style>
