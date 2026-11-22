<script setup>
/**
 * Frühphase: Hochrisiko-Coins, die man von Hand auf eine Liste setzt (über
 * die Vertragsadresse) und deren Kurs man verfolgt. Gerechnet wird auf dem
 * Server (`server/portfolio/fruehphase-liste.js`); Kurs, Kapitalisierung und
 * Liquidität kommen von DexScreener. Nichts von hier fliesst in die Übersicht
 * oder den Steuerbericht.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { geld, menge, verborgen, vorZeit, waehrung } from '../../stores/portfolio.js'
import { Karte, Knopf, Hinweis, Kreisel, Leerzustand, Symbol } from '../basis/index.js'

const { t } = useI18n()
const daten = ref(null)
const laedt = ref(false)
const fehler = ref('')
const neu = ref({ adresse: '', einsatzUsd: '', menge: '', notiz: '' })
const nimmtAuf = ref(false)
const aufnahmeFehler = ref('')
const offen = ref(null)       // id der Zeile, die gerade bearbeitet wird
const entwurf = ref({ einsatzUsd: '', menge: '', notiz: '' })

async function lade({ still = false } = {}) {
    if (!still) laedt.value = true
    try {
        daten.value = (await axios.get('/api/portfolio/fruehphase')).data
        fehler.value = ''
    } catch (e) { if (!still) fehler.value = e.response?.data?.error || e.message } finally { laedt.value = false }
}

// Eingaben als Text: «0,05» und «1'000» gelten wie 0.05 und 1000.
const zahl = (s) => { const n = Number(String(s ?? '').replace(/['’\s]/g, '').replace(',', '.')); return String(s ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? n : null }

async function aufnehmen(adresse = neu.value.adresse, felder = neu.value) {
    if (!String(adresse).trim() || nimmtAuf.value) return
    nimmtAuf.value = true
    aufnahmeFehler.value = ''
    try {
        await axios.post('/api/portfolio/fruehphase', { adresse, einsatzUsd: zahl(felder.einsatzUsd), menge: zahl(felder.menge), notiz: felder.notiz || '' })
        neu.value = { adresse: '', einsatzUsd: '', menge: '', notiz: '' }
        await lade({ still: true })
    } catch (e) { aufnahmeFehler.value = e.response?.data?.error || e.message } finally { nimmtAuf.value = false }
}

function bearbeite(z) {
    if (offen.value === z.id) { offen.value = null; return }
    offen.value = z.id
    entwurf.value = { einsatzUsd: z.einsatzUsd ?? '', menge: z.mengeVonHand ? z.menge : '', notiz: z.notiz || '' }
}
async function speichere(z) {
    try {
        await axios.put(`/api/portfolio/fruehphase/${z.id}`, { einsatzUsd: zahl(entwurf.value.einsatzUsd), menge: zahl(entwurf.value.menge), notiz: entwurf.value.notiz })
        offen.value = null
        await lade({ still: true })
    } catch (e) { fehler.value = e.response?.data?.error || e.message }
}
async function entferne(z) {
    if (!window.confirm(t('portfolio.fpEntfernenFrage', { s: z.symbol }))) return
    await axios.delete(`/api/portfolio/fruehphase/${z.id}`)
    offen.value = null
    await lade({ still: true })
}

// Kurse einer Frühphase-Liste ändern sich im Minutentakt: solange die Seite offen und sichtbar ist, nachladen.
let takt = null
onMounted(() => {
    lade()
    takt = setInterval(() => { if (!document.hidden && daten.value?.zeilen?.length && offen.value == null) lade({ still: true }) }, 60e3)
})
onBeforeUnmount(() => clearInterval(takt))

const zeilen = computed(() => daten.value?.zeilen || [])
const summe = computed(() => daten.value?.summe)

const KETTEN = { sol: 'Solana', 'evm:1': 'Ethereum', 'evm:56': 'BNB Chain', 'evm:8453': 'Base', 'evm:42161': 'Arbitrum', 'evm:10': 'Optimism', 'evm:137': 'Polygon', 'evm:43114': 'Avalanche' }
const DEX = { sol: 'solana', 'evm:1': 'ethereum', 'evm:56': 'bsc', 'evm:8453': 'base', 'evm:42161': 'arbitrum', 'evm:10': 'optimism', 'evm:137': 'polygon', 'evm:43114': 'avalanche' }
const dexLink = (z) => `https://dexscreener.com/${DEX[z.kette]}/${z.kontrakt}`
const kurzAdresse = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`

function kurs(v) {
    if (v == null) return '—'
    return `$${Number(v).toLocaleString('de-CH', { maximumSignificantDigits: 4, maximumFractionDigits: 12 })}`
}
function gross(v) {
    if (v == null) return '—'
    const a = Math.abs(v)
    if (a >= 1e9) return `$${(v / 1e9).toLocaleString('de-CH', { maximumFractionDigits: 2 })} Mrd.`
    if (a >= 1e6) return `$${(v / 1e6).toLocaleString('de-CH', { maximumFractionDigits: 2 })} Mio.`
    if (a >= 1e3) return `$${(v / 1e3).toLocaleString('de-CH', { maximumFractionDigits: 1 })}K`
    return `$${v.toLocaleString('de-CH', { maximumFractionDigits: 0 })}`
}
function usd(v, { vorzeichen = false } = {}) {
    if (v == null) return '—'
    if (verborgen.value) return '$ ••••'
    const z = vorzeichen ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '')
    return `${z}$${Math.abs(v).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
// `anteil` als Bruch (0.25), DexScreener-Änderungen kommen schon in Prozent.
function pct(v, { istProzent = false } = {}) {
    if (v == null) return '—'
    const p = istProzent ? v : v * 100
    return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('de-CH', { maximumFractionDigits: Math.abs(p) >= 100 ? 0 : 1 })} %`
}
const ton = (v) => (v == null || v === 0 ? '' : v > 0 ? 'at-gut' : 'at-schlecht')
const datum = (ms) => (ms ? new Date(ms).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

/** Verlauf als Linie in einem 120 × 32-Feld; unter zwei Punkten gibt es keine. */
function linie(v) {
    if (!v || v.length < 2) return null
    const t0 = v[0][0], t1 = v[v.length - 1][0]
    const werte = v.map((p) => p[1])
    const lo = Math.min(...werte), hi = Math.max(...werte)
    const x = (z) => (t1 > t0 ? ((z - t0) / (t1 - t0)) * 118 + 1 : 60)
    const y = (w) => (hi > lo ? 30 - ((w - lo) / (hi - lo)) * 28 : 16)
    return { punkte: v.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' '), steigt: werte[werte.length - 1] >= werte[0] }
}
</script>

<template>
    <div class="fp">
        <p class="fp-erkl">{{ t('portfolio.fpErkl') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Karte class="fp-neu">
            <form class="fp-form" @submit.prevent="aufnehmen()">
                <label class="fp-feld breit">
                    <span>{{ t('portfolio.fpAdresse') }}</span>
                    <input v-model="neu.adresse" type="text" autocomplete="off" spellcheck="false" :placeholder="t('portfolio.fpAdressePlatz')" />
                </label>
                <label class="fp-feld">
                    <span>{{ t('portfolio.fpEinsatz') }}</span>
                    <input v-model="neu.einsatzUsd" type="text" inputmode="decimal" autocomplete="off" :placeholder="t('portfolio.fpFreiwillig')" />
                </label>
                <label class="fp-feld">
                    <span>{{ t('portfolio.fpMenge') }}</span>
                    <input v-model="neu.menge" type="text" inputmode="decimal" autocomplete="off" :placeholder="t('portfolio.fpMengePlatz')" />
                </label>
                <Knopf type="submit" :disabled="!neu.adresse.trim() || nimmtAuf">{{ nimmtAuf ? t('portfolio.fpSucht') : t('portfolio.fpAufnehmen') }}</Knopf>
            </form>
            <Hinweis v-if="aufnahmeFehler" art="fehler" class="at-mo-2">{{ aufnahmeFehler }}</Hinweis>
            <div v-if="daten?.vorschlaege?.length" class="fp-vorschlaege">
                <span class="at-gedaempft">{{ t('portfolio.fpVorschlaege') }}</span>
                <button v-for="v in daten.vorschlaege" :key="v.kontrakt" type="button" class="fp-vorschlag" :disabled="nimmtAuf" :title="v.kontrakt" @click="aufnehmen(v.kontrakt, {})">
                    <b>{{ v.symbol }}</b> <small>{{ usd(v.wertUsd) }}</small> <Symbol name="plus" :groesse="12" />
                </button>
            </div>
        </Karte>

        <div v-if="laedt && !daten" class="at-mittig at-py-5"><Kreisel /></div>

        <Leerzustand v-else-if="daten && !zeilen.length" class="at-mo-4" symbol="rakete" :titel="t('portfolio.fpLeerTitel')" :text="t('portfolio.fpLeerText')" />

        <template v-else-if="daten">
            <Hinweis v-if="daten.kursFehler" art="warn" class="at-mo-3">{{ t('portfolio.fpKursFehler') }}</Hinweis>

            <div class="fp-kacheln">
                <Karte class="fp-kachel">
                    <span class="fp-etikett">{{ t('portfolio.fpWert') }}</span>
                    <b class="fp-zahl">{{ usd(summe.wertUsd) }}</b>
                    <small class="at-gedaempft"><template v-if="waehrung !== 'USD'">{{ geld(summe.wertChf) }} · </template>{{ t('portfolio.fpCoins', { n: summe.anzahl }, summe.anzahl) }}</small>
                </Karte>
                <Karte class="fp-kachel">
                    <span class="fp-etikett">{{ t('portfolio.fpEingesetzt') }}</span>
                    <b class="fp-zahl">{{ usd(summe.einsatzUsd) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.fpEingesetztInfo') }}</small>
                </Karte>
                <Karte class="fp-kachel">
                    <span class="fp-etikett">{{ t('portfolio.fpErgebnis') }}</span>
                    <b :class="['fp-zahl', ton(summe.gewinnUsd)]">{{ usd(summe.gewinnUsd, { vorzeichen: true }) }}</b>
                    <small :class="ton(summe.gewinnAnteil)">{{ pct(summe.gewinnAnteil) }}</small>
                </Karte>
            </div>

            <section class="fp-liste">
                <article v-for="z in zeilen" :key="z.id" class="fp-coin">
                    <header class="fp-kopf">
                        <div class="fp-name">
                            <b>{{ z.symbol }}</b>
                            <span v-if="z.name && z.name !== z.symbol" class="at-gedaempft">{{ z.name }}</span>
                            <small class="at-gedaempft">{{ KETTEN[z.kette] || z.kette }} · <span :title="z.kontrakt">{{ kurzAdresse(z.kontrakt) }}</span><template v-if="z.dex"> · {{ z.dex }}</template></small>
                        </div>
                        <div class="fp-kurs">
                            <b>{{ kurs(z.usd) }}</b>
                            <small v-if="z.aenderung" class="fp-aend">
                                <span :class="ton(z.aenderung.m5)">5m {{ pct(z.aenderung.m5, { istProzent: true }) }}</span>
                                <span :class="ton(z.aenderung.h1)">1h {{ pct(z.aenderung.h1, { istProzent: true }) }}</span>
                                <span :class="ton(z.aenderung.h6)">6h {{ pct(z.aenderung.h6, { istProzent: true }) }}</span>
                                <span :class="ton(z.aenderung.h24)">24h {{ pct(z.aenderung.h24, { istProzent: true }) }}</span>
                            </small>
                            <small v-else-if="z.ohneKurs" class="at-warn">{{ t('portfolio.fpOhneKurs') }}</small>
                        </div>
                        <svg v-if="linie(z.verlauf)" class="fp-linie" viewBox="0 0 120 32" preserveAspectRatio="none" role="img" :aria-label="t('portfolio.fpVerlauf')">
                            <polyline :points="linie(z.verlauf).punkte" fill="none" :stroke="linie(z.verlauf).steigt ? 'var(--good)' : 'var(--bad)'" stroke-width="1.5" vector-effect="non-scaling-stroke" />
                        </svg>
                        <span v-else class="fp-linie leer at-gedaempft">{{ t('portfolio.fpVerlaufFehlt') }}</span>
                        <div class="fp-knoepfe">
                            <a class="fp-link" :href="dexLink(z)" target="_blank" rel="noopener noreferrer" :title="t('portfolio.fpChartOeffnen')">DexScreener ↗</a>
                            <Knopf art="leise" klein @click="bearbeite(z)">{{ offen === z.id ? t('portfolio.fpSchliessen') : t('portfolio.fpBearbeiten') }}</Knopf>
                        </div>
                    </header>

                    <dl class="fp-werte">
                        <div><dt>{{ t('portfolio.fpMc') }}</dt><dd>{{ gross(z.mc) }}</dd></div>
                        <div>
                            <dt>{{ t('portfolio.fpLiq') }}</dt>
                            <dd :class="{ 'at-warn': z.duenn }">{{ z.liqBekannt ? gross(z.liq) : '—' }}<small v-if="z.duenn && z.liqBekannt"> {{ t('portfolio.fpDuenn') }}</small></dd>
                        </div>
                        <div><dt>{{ t('portfolio.fpVol24') }}</dt><dd>{{ gross(z.volumen24) }}</dd></div>
                        <div>
                            <dt>{{ t('portfolio.stMenge') }}</dt>
                            <dd>{{ menge(z.menge) }}<small class="at-gedaempft"> {{ z.menge == null ? '' : z.mengeVonHand ? t('portfolio.fpVonHand') : t('portfolio.fpAusWallet') }}</small></dd>
                        </div>
                        <div><dt>{{ t('portfolio.fpWertJetzt') }}</dt><dd>{{ usd(z.wertUsd) }}<small class="at-gedaempft"> {{ z.wertChf != null && waehrung !== 'USD' ? geld(z.wertChf) : '' }}</small></dd></div>
                        <div><dt>{{ t('portfolio.fpEinsatzKurz') }}</dt><dd>{{ usd(z.einsatzUsd) }}<small v-if="z.einstiegUsd" class="at-gedaempft"> @ {{ kurs(z.einstiegUsd) }}</small></dd></div>
                        <div>
                            <dt>{{ t('portfolio.fpErgebnis') }}</dt>
                            <dd :class="ton(z.gewinnUsd)">{{ usd(z.gewinnUsd, { vorzeichen: true }) }}<small v-if="z.gewinnAnteil != null"> {{ pct(z.gewinnAnteil) }}</small></dd>
                        </div>
                        <div>
                            <dt>{{ t('portfolio.fpSeitAufnahme') }}</dt>
                            <dd :class="ton(z.seitAufnahme)">{{ pct(z.seitAufnahme) }}<small class="at-gedaempft"> {{ vorZeit(z.seit) }}</small></dd>
                        </div>
                    </dl>
                    <p v-if="z.notiz && offen !== z.id" class="fp-notiz">{{ z.notiz }}</p>

                    <form v-if="offen === z.id" class="fp-form fp-bearb" @submit.prevent="speichere(z)">
                        <label class="fp-feld">
                            <span>{{ t('portfolio.fpEinsatz') }}</span>
                            <input v-model="entwurf.einsatzUsd" type="text" inputmode="decimal" autocomplete="off" />
                        </label>
                        <label class="fp-feld">
                            <span>{{ t('portfolio.fpMenge') }}</span>
                            <input v-model="entwurf.menge" type="text" inputmode="decimal" autocomplete="off" :placeholder="z.walletMenge ? t('portfolio.fpMengeWallet', { m: menge(z.walletMenge) }) : t('portfolio.fpMengePlatz')" />
                        </label>
                        <label class="fp-feld breit">
                            <span>{{ t('portfolio.fpNotiz') }}</span>
                            <input v-model="entwurf.notiz" type="text" maxlength="200" autocomplete="off" />
                        </label>
                        <Knopf type="submit" klein>{{ t('portfolio.fpSpeichern') }}</Knopf>
                        <Knopf art="leise" klein @click="entferne(z)">{{ t('portfolio.fpEntfernen') }}</Knopf>
                        <small class="at-gedaempft fp-aufnahme">{{ t('portfolio.fpAufgenommen', { d: datum(z.seit), k: kurs(z.kursBeiAufnahme), mc: gross(z.mcBeiAufnahme) }) }}</small>
                    </form>
                </article>
            </section>

            <p class="fp-fuss">{{ t('portfolio.fpFuss', { d: datum(daten.stand) }) }}</p>
        </template>
    </div>
</template>

<style scoped>
.fp-erkl { font-size: 0.85rem; color: var(--muted); max-width: 62rem; margin: 0.5rem 0 1rem; }
.fp-form { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
.fp-feld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: var(--leise); flex: 1 1 9rem; min-width: 0; }
.fp-feld.breit { flex: 3 1 18rem; }
.fp-feld input { background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); color: var(--text); padding: 0.45rem 0.6rem; font: inherit; font-size: 0.88rem; min-width: 0; }
.fp-vorschlaege { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.75rem; font-size: 0.8rem; }
.fp-vorschlag { display: inline-flex; align-items: center; gap: 0.35rem; background: var(--panel-soft); border: 1px solid var(--line); border-radius: 999px; color: var(--text); padding: 0.2rem 0.6rem; font: inherit; font-size: 0.8rem; cursor: pointer; }
.fp-vorschlag:hover:not(:disabled) { border-color: var(--line-stark); }
.fp-vorschlag small { color: var(--muted); }
.fp-kacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.75rem; margin-top: 1rem; }
.fp-kachel { display: flex; flex-direction: column; gap: 0.2rem; }
.fp-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.fp-zahl { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.fp-liste { margin-top: 1.25rem; display: flex; flex-direction: column; }
.fp-coin { border-top: 1px solid var(--line); padding: 0.9rem 0; }
.fp-kopf { display: grid; grid-template-columns: minmax(9rem, 1.4fr) minmax(11rem, 1.4fr) minmax(6rem, 1fr) auto; gap: 1rem; align-items: center; }
.fp-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.5rem; min-width: 0; }
.fp-name b { font-size: 1.05rem; }
.fp-name small { width: 100%; font-size: 0.72rem; }
.fp-kurs { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
.fp-kurs b { font-size: 1.05rem; }
.fp-aend { display: flex; flex-wrap: wrap; gap: 0 0.6rem; font-size: 0.72rem; color: var(--muted); }
.fp-linie { width: 100%; height: 32px; }
.fp-linie.leer { font-size: 0.7rem; display: flex; align-items: center; }
.fp-knoepfe { display: flex; align-items: center; gap: 0.6rem; justify-content: flex-end; }
.fp-link { font-size: 0.78rem; color: var(--muted); text-decoration: none; white-space: nowrap; }
.fp-link:hover { color: var(--text); }
.fp-werte { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: 0.5rem 1rem; margin: 0.7rem 0 0; font-variant-numeric: tabular-nums; }
.fp-werte dt { font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--leise); }
.fp-werte dd { margin: 0; font-size: 0.88rem; }
.fp-werte small { font-size: 0.72rem; margin-left: 0.3rem; }
.fp-notiz { font-size: 0.8rem; color: var(--muted); margin: 0.5rem 0 0; }
.fp-bearb { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--line); }
.fp-aufnahme { width: 100%; font-size: 0.72rem; }
.fp-fuss { font-size: 0.78rem; color: var(--leise); margin-top: 0.75rem; max-width: 62rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
@media (max-width: 760px) {
    .fp-kopf { grid-template-columns: 1fr 1fr; }
    .fp-knoepfe { justify-content: flex-start; }
}
</style>
