<script setup>
/**
 * DCA-Portfolio: nur die regelmässigen Käufe — Bitpanda-Sparpläne und als DCA
 * markierte Käufe (Crypto.com-Karte) — als eigenes kleines Portfolio. Die
 * Rechnung macht der Server (`server/portfolio/dca.js`), hier wird gezeichnet.
 *
 * Gezählt wird alles so Gekaufte, auch wenn es später auf den Ledger verschoben
 * oder verkauft wurde: die Seite misst die Strategie. Wo der Coin heute liegt,
 * steht je Coin darunter (aus der Übersicht, für den ganzen Bestand des Coins).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { chf, menge, prozent, farbeVon } from '../../stores/portfolio.js'
import { Karte, Hinweis, Kreisel, Leerzustand, Symbol } from '../basis/index.js'

const { t } = useI18n()
const daten = ref(null)
const verlauf = ref(null)
const laedt = ref(false)
const fehler = ref('')
const offen = ref(new Set())

async function lade() {
    laedt.value = true
    fehler.value = ''
    try { daten.value = (await axios.get('/api/portfolio/dca')).data } catch (e) { fehler.value = e.response?.data?.error || e.message } finally { laedt.value = false }
    // Der Verlauf holt beim ersten Mal Monatskerzen je Coin — eigener Abruf mit mehr Zeit, die Seite wartet nicht darauf.
    try { verlauf.value = (await axios.get('/api/portfolio/dca/verlauf', { timeout: 90000 })).data } catch { verlauf.value = { punkte: [] } }
}
onMounted(lade)

const summe = computed(() => daten.value?.summe)
const coins = computed(() => daten.value?.coins || [])
function klappe(a) { const s = new Set(offen.value); s.has(a) ? s.delete(a) : s.add(a); offen.value = s }

const datum = (ms) => (ms ? new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }) : '—')
const monatText = (m) => { const [j, mo] = m.split('-'); return `${mo}.${j}` }
// Ab 1 CHF zwei Rappen, darunter vier signifikante Stellen (ALGO, FET kosten Rappen).
const chfKurs = (v) => (v == null ? '—' : `CHF ${Number(v).toLocaleString('de-CH', Math.abs(v) >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 })}`)
const ton = (v) => (v == null ? '' : v >= 0 ? 'at-gut' : 'at-schlecht')
function rhythmus(tage) {
    if (tage == null) return ''
    if (tage < 1.5) return t('portfolio.stkTaeglich')
    if (tage >= 6 && tage <= 8) return t('portfolio.stkWoechentlich')
    if (tage >= 13 && tage <= 15) return t('portfolio.dcaZweiWochen')
    if (tage >= 27 && tage <= 32) return t('portfolio.stkMonatlich')
    return t('portfolio.stkAlleTage', { n: Math.round(tage) })
}
const betragText = (p) => (p.betrag == null ? '' : `${Number(p.betrag).toLocaleString('de-CH', { maximumFractionDigits: 2 })} ${p.waehrung || ''}`)
// Die Marke nennt den Ort oft schon („Crypto.com Karte“) — der steht davor.
const artText = (p) => (p.art === 'sparplan' ? t('portfolio.dcaSparplan') : p.art.replace(p.quelleName, '').trim() || t('portfolio.dca'))

// ── Verlauf: eingesetzt (gestrichelt) gegen Wert ──
const kurve = computed(() => {
    const v = verlauf.value?.punkte || []
    if (v.length < 2) return null
    const w = 600, h = 150, oben = 8, unten = 6
    const max = Math.max(...v.map((x) => Math.max(x.eingesetztChf, x.wertChf))) || 1
    const xy = (i, wert) => [(i / (v.length - 1)) * w, h - unten - (wert / max) * (h - oben - unten)]
    const pfad = (feld) => v.map((x, i) => xy(i, x[feld])).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    const letzter = v.at(-1)
    return {
        w, h, eingesetzt: pfad('eingesetztChf'), wert: pfad('wertChf'),
        flaeche: `${pfad('wertChf')} L${w},${h} L0,${h} Z`,
        von: monatText(v[0].monat), bis: monatText(letzter.monat), max,
        im_plus: letzter.wertChf >= letzter.eingesetztChf,
        geschaetzt: [...new Set(v.flatMap((x) => x.geschaetzt))],
    }
})
</script>

<template>
    <div class="dca">
        <p class="dca-erkl">{{ t('portfolio.dcaErkl') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <div v-if="laedt && !daten" class="at-mittig at-py-5"><Kreisel /></div>

        <Leerzustand v-else-if="daten && !coins.length" class="at-mo-4" symbol="wiederholen" :titel="t('portfolio.dcaLeerTitel')" :text="t('portfolio.dcaLeerText')" />

        <template v-else-if="daten">
            <div class="dca-kacheln">
                <Karte class="dca-kachel">
                    <span class="dca-etikett">{{ t('portfolio.dcaEingesetzt') }}</span>
                    <b class="dca-zahl">{{ chf(summe.investiertChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.dcaKaeufeSeit', { n: summe.kaeufe, d: datum(summe.von) }) }}<template v-if="summe.ohneChf"> · {{ t('portfolio.dcaOhneChf', { n: summe.ohneChf }) }}</template></small>
                </Karte>
                <Karte class="dca-kachel">
                    <span class="dca-etikett">{{ t('portfolio.dcaWertHeute') }}</span>
                    <b class="dca-zahl">{{ chf(summe.wertHeuteChf) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.dcaWertHeuteInfo') }}<template v-if="summe.ohneKurs.length"> · {{ t('portfolio.dcaOhneKurs', { c: summe.ohneKurs.join(', ') }) }}</template></small>
                </Karte>
                <Karte class="dca-kachel">
                    <span class="dca-etikett">{{ t('portfolio.dcaGewinn') }}</span>
                    <b class="dca-zahl" :class="ton(summe.gewinnChf)">{{ chf(summe.gewinnChf, { vorzeichen: true }) }}</b>
                    <small :class="ton(summe.gewinnPct)">{{ summe.gewinnPct != null ? (summe.gewinnPct >= 0 ? '+' : '') + prozent(summe.gewinnPct) : '—' }}</small>
                </Karte>
                <Karte class="dca-kachel">
                    <span class="dca-etikett">{{ t('portfolio.dcaPlaene') }}</span>
                    <b class="dca-zahl">{{ summe.aktivePlaene }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.dcaPlaeneInfo', { n: coins.length }) }}</small>
                </Karte>
            </div>

            <section class="dca-abschnitt">
                <h3>{{ t('portfolio.dcaVerlauf') }}</h3>
                <div v-if="!verlauf" class="at-gedaempft dca-klein"><Kreisel :groesse="14" /> {{ t('portfolio.dcaVerlaufLaedt') }}</div>
                <template v-else-if="kurve">
                    <svg class="dca-kurve" :viewBox="`0 0 ${kurve.w} ${kurve.h}`" preserveAspectRatio="none" role="img" :aria-label="t('portfolio.dcaVerlauf')">
                        <path :d="kurve.flaeche" class="flaeche" :class="{ minus: !kurve.im_plus }" />
                        <path :d="kurve.wert" class="wert" :class="{ minus: !kurve.im_plus }" vector-effect="non-scaling-stroke" />
                        <path :d="kurve.eingesetzt" class="eingesetzt" vector-effect="non-scaling-stroke" />
                    </svg>
                    <div class="dca-achse at-gedaempft"><span>{{ kurve.von }}</span><span>max. {{ chf(kurve.max) }}</span><span>{{ kurve.bis }}</span></div>
                    <div class="dca-legende">
                        <span><i class="strich wert" :class="{ minus: !kurve.im_plus }" />{{ t('portfolio.dcaWert') }}</span>
                        <span><i class="strich eingesetzt" />{{ t('portfolio.dcaEingesetzt') }}</span>
                        <span v-if="kurve.geschaetzt.length" class="at-gedaempft">{{ t('portfolio.dcaGeschaetzt', { c: kurve.geschaetzt.join(', ') }) }}</span>
                    </div>
                </template>
                <p v-else class="at-gedaempft dca-klein">{{ t('portfolio.dcaVerlaufFehlt') }}</p>
            </section>

            <section class="dca-abschnitt">
                <h3>{{ t('portfolio.dcaJeCoin') }}</h3>
                <div class="dca-tabelle">
                    <div class="dca-zeile kopf">
                        <span>Coin</span><span>{{ t('portfolio.dcaEingesetzt') }}</span><span>{{ t('portfolio.stMenge') }}</span>
                        <span>{{ t('portfolio.dcaSchnitt') }}</span><span>{{ t('portfolio.dcaWertHeute') }}</span><span>{{ t('portfolio.dcaGewinn') }}</span>
                    </div>
                    <template v-for="c in coins" :key="c.asset">
                        <button type="button" class="dca-zeile" :class="{ beendet: !c.aktiv, auf: offen.has(c.asset) }" :aria-expanded="offen.has(c.asset)" @click="klappe(c.asset)">
                            <span class="dca-coin">
                                <Symbol :name="offen.has(c.asset) ? 'runter' : 'pfeilRechts'" :groesse="12" class="at-gedaempft" />
                                <span class="punkt" :style="{ background: farbeVon(c.asset) }" /><b>{{ c.asset }}</b>
                                <span v-if="c.aktiv" class="dca-marke">{{ t('portfolio.dcaLaeuft') }}</span>
                                <small class="at-gedaempft">{{ t('portfolio.dcaKaeufeZeitraum', { n: c.anzahl, von: datum(c.von), bis: datum(c.bis) }) }}</small>
                            </span>
                            <span :data-titel="t('portfolio.dcaEingesetzt')">{{ chf(c.investiertChf) }}<small v-if="c.ohneChf" class="at-warn">{{ t('portfolio.dcaOhneChf', { n: c.ohneChf }) }}</small></span>
                            <span :data-titel="t('portfolio.stMenge')">{{ menge(c.menge) }}<small v-if="c.umgestellt" class="at-gedaempft">= {{ menge(c.menge * c.faktor) }} {{ c.heuteAsset }}</small></span>
                            <span :data-titel="t('portfolio.dcaSchnitt')">{{ chfKurs(c.schnittChf) }}<small class="at-gedaempft">{{ t('portfolio.dcaKursHeute', { k: chfKurs(c.kursChf != null ? c.kursChf * c.faktor : null) }) }}</small></span>
                            <span :data-titel="t('portfolio.dcaWertHeute')">{{ chf(c.wertHeuteChf) }}</span>
                            <span :data-titel="t('portfolio.dcaGewinn')" :class="ton(c.gewinnChf)">
                                {{ chf(c.gewinnChf, { vorzeichen: true }) }}<small>{{ c.gewinnPct != null ? (c.gewinnPct >= 0 ? '+' : '') + prozent(c.gewinnPct) : '' }}</small>
                            </span>
                        </button>
                        <div v-if="offen.has(c.asset)" class="dca-detail">
                            <h4>{{ t('portfolio.dcaPlaeneTitel') }}</h4>
                            <div v-for="p in c.plaene" :key="`${p.quelle}|${p.waehrung}`" class="dca-plan" :class="{ beendet: !p.aktiv }">
                                <span><b>{{ p.quelleName }}</b> · {{ artText(p) }}<span v-if="p.aktiv" class="dca-marke">{{ t('portfolio.dcaLaeuft') }}</span></span>
                                <span>{{ betragText(p) }}<template v-if="rhythmus(p.intervallTage)"> · {{ rhythmus(p.intervallTage) }}</template></span>
                                <span class="at-gedaempft">{{ datum(p.von) }} – {{ p.aktiv ? t('portfolio.dcaHeute') : datum(p.bis) }} · {{ p.anzahl === 1 ? t('portfolio.dcaEinKauf') : t('portfolio.dcaKaeufe', { n: p.anzahl }) }}</span>
                                <span>{{ chf(p.investiertChf) }} → {{ menge(p.menge) }} {{ c.asset }}</span>
                            </div>
                            <h4>{{ t('portfolio.dcaHeuteImPortfolio', { c: c.heuteAsset }) }}</h4>
                            <p v-if="c.heuteImPortfolio" class="dca-orte">
                                <b>{{ menge(c.heuteImPortfolio.menge) }} {{ c.heuteAsset }}</b> <span class="at-gedaempft">({{ chf(c.heuteImPortfolio.chf) }})</span>:
                                <template v-for="(o, i) in c.heuteImPortfolio.orte" :key="i"><span v-if="i"> · </span>{{ o.name }} {{ menge(o.menge) }}</template>
                            </p>
                            <p v-else class="at-gedaempft dca-orte">{{ t('portfolio.dcaNichtMehrGehalten', { c: c.heuteAsset }) }}</p>
                            <p class="at-gedaempft dca-klein">{{ t('portfolio.dcaOrteInfo') }}</p>
                        </div>
                    </template>
                </div>
            </section>
            <p class="dca-fuss"><Symbol name="info" :groesse="13" /> {{ t('portfolio.dcaFuss') }}</p>
        </template>
    </div>
</template>

<style scoped>
.dca-erkl { font-size: 0.85rem; color: var(--muted); max-width: 62rem; margin: 0.5rem 0 1rem; }
.dca-kacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: 0.75rem; }
.dca-kachel { display: flex; flex-direction: column; gap: 0.2rem; }
.dca-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.dca-zahl { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.dca-abschnitt { margin-top: 1.25rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.dca-abschnitt h3 { font-size: 1rem; margin: 0 0 0.6rem; }
.dca-klein { font-size: 0.78rem; }
.dca-kurve { width: 100%; height: 150px; display: block; }
.dca-kurve .wert { fill: none; stroke: var(--good); stroke-width: 2; }
.dca-kurve .wert.minus { stroke: var(--bad); }
.dca-kurve .flaeche { fill: var(--good-flaeche); stroke: none; }
.dca-kurve .flaeche.minus { fill: var(--bad-flaeche); }
.dca-kurve .eingesetzt { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 5 4; }
.dca-achse { display: flex; justify-content: space-between; font-size: 0.72rem; margin-top: 0.2rem; }
.dca-legende { display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; font-size: 0.78rem; margin-top: 0.4rem; align-items: center; }
.strich { display: inline-block; width: 18px; height: 0; border-top: 2px solid var(--good); margin-right: 0.4rem; vertical-align: middle; }
.strich.minus { border-top-color: var(--bad); }
.strich.eingesetzt { border-top: 2px dashed var(--muted); }
.dca-tabelle { display: flex; flex-direction: column; }
.dca-zeile {
    display: grid; grid-template-columns: minmax(10rem, 1.6fr) repeat(5, minmax(0, 1fr)); gap: 0.6rem; align-items: start;
    padding: 0.55rem 0; border: 0; border-bottom: 1px dashed var(--line); background: none; color: inherit; font: inherit;
    font-size: 0.86rem; font-variant-numeric: tabular-nums; text-align: left; width: 100%; cursor: pointer;
}
.dca-zeile:hover { background: var(--panel-soft); }
.dca-zeile.kopf { font-size: 0.72rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--line); cursor: default; }
.dca-zeile.kopf:hover { background: none; }
.dca-zeile.beendet { opacity: 0.8; }
.dca-zeile > span:not(.dca-coin) small { display: block; font-size: 0.72rem; }
.dca-coin { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.4rem; }
.dca-coin small { display: block; width: 100%; font-size: 0.72rem; padding-left: 1.2rem; }
.dca-marke { font-size: 0.68rem; color: var(--accent); border: 1px solid var(--accent-schwach); border-radius: var(--radius-pille); padding: 0 0.45rem; margin-left: 0.35rem; }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dca-detail { padding: 0.5rem 0 0.9rem 1.2rem; border-bottom: 1px dashed var(--line); font-size: 0.84rem; }
.dca-detail h4 { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--leise); margin: 0.4rem 0 0.35rem; font-weight: 600; }
.dca-plan { display: grid; grid-template-columns: minmax(10rem, 1.3fr) minmax(8rem, 1fr) minmax(10rem, 1.3fr) minmax(8rem, 1fr); gap: 0.6rem; padding: 0.3rem 0; font-variant-numeric: tabular-nums; }
.dca-plan.beendet { opacity: 0.75; }
.dca-orte { margin: 0.2rem 0; }
.dca-fuss { font-size: 0.78rem; color: var(--leise); margin-top: 0.9rem; max-width: 62rem; display: flex; gap: 0.35rem; align-items: baseline; }
@media (max-width: 1000px) {
    .dca-zeile { grid-template-columns: 1fr 1fr; }
    .dca-zeile .dca-coin { grid-column: 1 / -1; }
    .dca-zeile.kopf { display: none; }
    .dca-zeile > span[data-titel]::before { content: attr(data-titel); display: block; font-size: 0.68rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; }
    .dca-plan { grid-template-columns: 1fr; gap: 0.1rem; padding: 0.4rem 0; border-bottom: 1px dotted var(--line); }
}
</style>
