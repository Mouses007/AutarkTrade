<script setup>
/**
 * Totalverluste: Coins, die als tot markiert sind — raus aus Portfolio und
 * (ab ihrem Steuerjahr) aus dem Steuerbericht, hier mit dem, was sie gekostet
 * haben. Verlust = Einstand der noch gehaltenen Lose (FIFO). Im Privatvermögen
 * ist er nicht abziehbar; die Seite zeigt ihn nur.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { chf, menge, prozent, farbeVon, ladeUebersicht } from '../../stores/portfolio.js'
import { Karte, Knopf, Hinweis, Kreisel, Leerzustand } from '../basis/index.js'

const { t } = useI18n()
const daten = ref(null)
const laedt = ref(false)
const fehler = ref('')
const jahre = (() => { const j = new Date().getFullYear(); return Array.from({ length: 8 }, (_, i) => j - i) })()

async function lade() {
    laedt.value = true
    fehler.value = ''
    try { daten.value = (await axios.get('/api/portfolio/totalverluste')).data } catch (e) { fehler.value = e.response?.data?.error || e.message } finally { laedt.value = false }
}
async function setze(asset, an, abJahr) {
    await axios.put('/api/portfolio/totalverlust', { asset, an, abJahr })
    await Promise.all([lade(), ladeUebersicht()])
}
onMounted(lade)

const st = computed(() => daten.value?.statistik)
const jeJahr = computed(() => Object.entries(st.value?.jeJahr || {}).sort((a, b) => b[0] - a[0]))
const maxJahr = computed(() => Math.max(1, ...jeJahr.value.map(([, v]) => v)))
const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }) : '—')
const kurs = (v) => (v == null ? '—' : `CHF ${Number(v).toLocaleString('de-CH', { maximumSignificantDigits: 6 })}`)
</script>

<template>
    <div class="tv">
        <p class="tv-erkl">{{ t('portfolio.tvErkl') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <div v-if="laedt && !daten" class="at-mittig at-py-5"><Kreisel /></div>

        <Leerzustand v-else-if="daten && !daten.zeilen.length" class="at-mo-4" symbol="archiv" :titel="t('portfolio.tvLeerTitel')" :text="t('portfolio.tvLeerText')" />

        <template v-else-if="daten">
            <div class="tv-kacheln">
                <Karte class="tv-kachel">
                    <span class="tv-etikett">{{ t('portfolio.tvVerloren') }}</span>
                    <b class="tv-zahl at-schlecht">{{ chf(st.verlorenChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.tvCoins', { n: st.anzahl }) }}<template v-if="st.ohneEinstand"> · {{ t('portfolio.tvOhneEinstand', { n: st.ohneEinstand }) }}</template></small>
                </Karte>
                <Karte class="tv-kachel">
                    <span class="tv-etikett">{{ t('portfolio.tvAnteil') }}</span>
                    <b class="tv-zahl">{{ st.anteilAmEinstand != null ? prozent(st.anteilAmEinstand) : '—' }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.tvAnteilInfo') }}</small>
                </Karte>
                <Karte class="tv-kachel">
                    <span class="tv-etikett">{{ t('portfolio.tvGroesster') }}</span>
                    <b class="tv-zahl">{{ st.groesster ? st.groesster.asset : '—' }}</b>
                    <small class="at-gedaempft">{{ st.groesster ? chf(st.groesster.chf) : '' }}</small>
                </Karte>
            </div>

            <section v-if="jeJahr.length" class="tv-abschnitt">
                <h3>{{ t('portfolio.tvJeJahr') }}</h3>
                <div v-for="[j, v] in jeJahr" :key="j" class="tv-balken">
                    <span>{{ t('portfolio.tvAbJahrKurz', { j }) }}</span>
                    <span class="tv-balken-spur"><span :style="{ width: (v / maxJahr) * 100 + '%' }" /></span>
                    <b>{{ chf(v) }}</b>
                </div>
            </section>

            <section class="tv-abschnitt">
                <h3>{{ t('portfolio.tvCoinsTitel') }}</h3>
                <div class="tv-tabelle">
                    <div class="tv-zeile kopf">
                        <span>Coin</span><span>{{ t('portfolio.stMenge') }}</span><span>{{ t('portfolio.kaufkursSchnitt') }}</span>
                        <span>{{ t('portfolio.tvVerloren') }}</span><span>{{ t('portfolio.tvAbSteuerjahr') }}</span><span></span>
                    </div>
                    <div v-for="z in daten.zeilen" :key="z.asset" class="tv-zeile">
                        <span class="tv-coin">
                            <span class="punkt" :style="{ background: farbeVon(z.asset) }" /><b>{{ z.asset }}</b>
                            <small class="at-gedaempft">{{ t('portfolio.tvGekauft', { d: datum(z.ersterKauf) }) }} · {{ t('portfolio.tvMarkiert', { d: datum(z.am) }) }}</small>
                        </span>
                        <span>{{ menge(z.menge) }}</span>
                        <span>{{ kurs(z.kaufkurs) }}<small v-if="z.letzterKurs" class="at-gedaempft tv-klein">{{ t('portfolio.tvLetzterKurs', { k: kurs(z.letzterKurs.kursChf), d: datum(z.letzterKurs.zeit) }) }}</small></span>
                        <span><b v-if="z.einstandChf != null" class="at-schlecht">{{ chf(z.einstandChf) }}</b><span v-else class="at-gedaempft" :title="t('portfolio.tvOhneEinstandInfo')">{{ t('portfolio.kaufkursUnbekannt') }}</span><small v-if="z.einstandTeilweise" class="at-warn"> *</small></span>
                        <span>
                            <select class="tv-jahr" :value="z.abJahr" :aria-label="t('portfolio.tvAbSteuerjahr')" @change="setze(z.asset, true, Number($event.target.value))">
                                <option v-for="j in jahre" :key="j" :value="j">{{ j }}</option>
                            </select>
                        </span>
                        <span><Knopf art="leise" klein @click="setze(z.asset, false)">{{ t('portfolio.totalverlustAufheben') }}</Knopf></span>
                    </div>
                </div>
                <p class="tv-fuss">{{ t('portfolio.tvFuss') }}</p>
            </section>
        </template>
    </div>
</template>

<style scoped>
.tv-erkl { font-size: 0.85rem; color: var(--muted); max-width: 62rem; margin: 0.5rem 0 1rem; }
.tv-kacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.75rem; }
.tv-kachel { display: flex; flex-direction: column; gap: 0.2rem; }
.tv-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.tv-zahl { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.tv-abschnitt { margin-top: 1.25rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.tv-abschnitt h3 { font-size: 1rem; margin: 0 0 0.6rem; }
.tv-balken { display: grid; grid-template-columns: 9rem 1fr 7rem; gap: 0.75rem; align-items: center; font-size: 0.85rem; padding: 0.2rem 0; }
.tv-balken b { text-align: right; font-variant-numeric: tabular-nums; }
.tv-balken-spur { height: 8px; background: var(--panel-soft); border-radius: 4px; overflow: hidden; }
.tv-balken-spur span { display: block; height: 100%; background: var(--bad); }
.tv-tabelle { display: flex; flex-direction: column; }
.tv-zeile { display: grid; grid-template-columns: minmax(10rem, 1.6fr) minmax(5rem, 1fr) minmax(8rem, 1.2fr) minmax(7rem, 1fr) 6rem auto; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px dashed var(--line); font-size: 0.86rem; font-variant-numeric: tabular-nums; }
.tv-zeile.kopf { font-size: 0.72rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--line); }
.tv-coin { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.4rem; }
.tv-coin small, .tv-klein { display: block; width: 100%; font-size: 0.72rem; }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.tv-jahr { background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); color: var(--text); padding: 0.2rem 0.4rem; font: inherit; font-size: 0.82rem; }
.tv-fuss { font-size: 0.78rem; color: var(--leise); margin-top: 0.75rem; max-width: 62rem; }
@media (max-width: 640px) {
    .tv-zeile { grid-template-columns: 1fr 1fr; }
    .tv-zeile.kopf { display: none; }
}
</style>
