<script setup>
/**
 * Steuern (Schweiz): ein Jahr, drei Zahlen, darunter die Belege.
 *
 * Oben Vermögen am 31.12., Einkommen aus Staking/Airdrops/Belohnungen und
 * die (privat steuerfreien) Veräusserungen. Darunter aufklappbar: das
 * Wertschriftenverzeichnis (jeder Kurs nachtragbar, z. B. aus der
 * ESTV-Kursliste), die Zuflüsse, die Abgänge mit FIFO-Einstand und die fünf
 * Kriterien zur Gewerbsmässigkeit als Ampel. Futures (aus dem Journal):
 * Guthaben am Stichtag (rückgerechnet oder laut Auszug) und Jahresergebnis. CSV und Druckansicht für die
 * Steuererklärung bzw. den Treuhänder.
 *
 * Keine Steuerberatung — das steht auch auf der Seite.
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { chf, menge, farbeVon } from '../../stores/portfolio.js'
import { Karte, Knopf, Hinweis, Kreisel, Symbol, Pille } from '../basis/index.js'

const { t } = useI18n()
const jahre = ref([])
const jahr = ref(null)
const daten = ref(null)
const laedt = ref(false)
const fehler = ref('')
const offen = ref(new Set(['vermoegen']))
const bearbeite = ref(null)       // Asset, dessen Kurs gerade eingetragen wird
const kursEingabe = ref('')
const kursQuelle = ref('estv')
const alleZufluesse = ref(false)
const alleAbgaenge = ref(false)

function klappe(id) { const s = new Set(offen.value); s.has(id) ? s.delete(id) : s.add(id); offen.value = s }

async function ladeJahre() {
    const { data } = await axios.get('/api/portfolio/steuer/jahre')
    jahre.value = data.jahre
    const vorjahr = new Date().getFullYear() - 1
    jahr.value = data.jahre.includes(vorjahr) ? vorjahr : data.jahre[0]
}
async function lade() {
    if (!jahr.value) return
    laedt.value = true
    fehler.value = ''
    try {
        daten.value = (await axios.get('/api/portfolio/steuer', { params: { jahr: jahr.value } })).data
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally { laedt.value = false }
}
watch(jahr, lade)
onMounted(async () => { await ladeJahre(); })

function starteKurs(p) {
    bearbeite.value = p.asset
    kursEingabe.value = p.kursChf != null ? String(Number(p.kursChf.toPrecision(8))) : ''
    kursQuelle.value = 'estv'
    nextTick(() => document.querySelector('.ps-kursform input')?.focus())
}
async function speichereKurs(asset, loeschen = false) {
    await axios.put('/api/portfolio/steuerkurs', { jahr: jahr.value, asset, chf: loeschen ? null : kursEingabe.value.replace(/['\s]/g, '').replace(',', '.'), quelle: kursQuelle.value })
    bearbeite.value = null
    await lade()
}

const csvLink = computed(() => `/api/portfolio/steuer.csv?jahr=${jahr.value}`)
const drucke = () => window.print()
const datum = (ms) => new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })
const zufluesse = computed(() => (alleZufluesse.value ? daten.value?.einkommen.zeilen : daten.value?.einkommen.zeilen.slice(-25).reverse()) || [])
const einkommenJeAsset = computed(() => Object.entries(daten.value?.einkommen.jeAsset || {}).sort((a, b) => b[1] - a[1]))
const abgaenge = computed(() => {
    const l = [...(daten.value?.veraeusserungen.abgaenge || [])].sort((a, b) => b.zeit - a.zeit)
    return alleAbgaenge.value ? l : l.slice(0, 25)
})
const ampel = (e) => (e === true ? 'gut' : e === false ? 'schlecht' : 'neutral')
const ampelSymbol = (e) => (e === true ? 'hakenKreis' : e === false ? 'warnung' : 'frage')
function kriteriumWert(k) {
    if (k.id === 'haltedauer') return t('portfolio.stKritHaltedauerWert', { p: (k.wert * 100).toFixed(0) })
    if (k.id === 'volumen') {
        const text = k.wert != null ? t('portfolio.stKritVolumenWert', { x: k.wert.toFixed(1), v: chf(k.volumen), a: chf(k.vermoegenAnfang) }) : t('portfolio.stKritVolumenOhne')
        return k.volumenFutures ? `${text} ${t('portfolio.stKritVolumenTeile', { s: chf(k.volumenSpot), f: chf(k.volumenFutures) })}` : text
    }
    if (k.id === 'derivate') return k.wert ? t('portfolio.stKritDerivateWert', { n: k.wert }) : t('portfolio.stKritDerivateKeine')
    return t('portfolio.stKritSelbst')
}
// ── Futures-Guthaben am Stichtag von Hand (Kontoauszug der Börse) ──
const futBearbeite = ref(null)
const futEingabe = ref('')
function starteFutures(g) {
    futBearbeite.value = g.boerse
    futEingabe.value = g.usd != null ? String(Math.round(g.usd * 100) / 100) : ''
    nextTick(() => document.querySelector('.ps-futform input')?.focus())
}
async function speichereFutures(boerse, loeschen = false) {
    await axios.put('/api/portfolio/futures-stichtag', { jahr: jahr.value, boerse, usd: loeschen ? null : futEingabe.value.replace(/['\s]/g, '').replace(',', '.'), quelle: 'Kontoauszug' })
    futBearbeite.value = null
    await lade()
}
const usd = (v) => (v == null ? '—' : `${v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`)
const fut = computed(() => (daten.value?.futures && !daten.value.futures.fehler ? daten.value.futures : null))
const futSichtbar = computed(() => fut.value && (fut.value.boersen.length || fut.value.guthaben.some((g) => g.usd != null || !fut.value.vorJournal)))
const futGrund = (g) => t('portfolio.stFutGrund_' + (g.grund || 'heute'))

const ARTNAME = { staking: 'Staking', airdrop: 'Airdrop', belohnung: 'Belohnung', eingeordnet: 'eingeordnet' }
</script>

<template>
    <div class="ps">
        <!-- ── Jahr + Aktionen ── -->
        <div class="ps-leiste">
            <div class="ps-jahre" role="tablist">
                <button v-for="j in jahre" :key="j" type="button" role="tab" :aria-selected="jahr === j" class="ps-jahr" :class="{ aktiv: jahr === j }" @click="jahr = j">{{ j }}</button>
            </div>
            <div class="ps-aktionen">
                <Knopf klein symbol="herunterladen" :href="csvLink" :disabled="!daten">CSV</Knopf>
                <Knopf klein symbol="dokument" :disabled="!daten" @click="drucke">{{ t('portfolio.stDrucken') }}</Knopf>
            </div>
        </div>
        <p class="ps-recht"><Symbol name="info" :groesse="14" />{{ t('portfolio.stRecht') }}</p>

        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <div v-if="laedt && !daten" class="at-mittig at-py-5"><Kreisel /><p class="at-gedaempft">{{ t('portfolio.stRechnet') }}</p></div>

        <template v-if="daten">
            <div class="ps-druckkopf">{{ t('portfolio.stDruckTitel', { j: daten.jahr }) }}</div>
            <!-- ── Drei Zahlen ── -->
            <div class="ps-kacheln" :class="{ laedt }">
                <Karte class="ps-kachel">
                    <span class="ps-etikett">{{ t('portfolio.stVermoegen', { j: daten.jahr }) }}</span>
                    <b class="ps-zahl">{{ chf(daten.vermoegenGesamt ?? daten.vermoegenSumme) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stVermoegenUnter', { n: daten.vermoegen.length }) }}<template v-if="fut?.guthabenChf"> · {{ t('portfolio.stDavonFutures', { v: chf(fut.guthabenChf) }) }}</template><template v-if="daten.ohneKurs.length"> · <span class="at-warn">{{ t('portfolio.stOhneKurs', { n: daten.ohneKurs.length }) }}</span></template></small>
                </Karte>
                <Karte class="ps-kachel">
                    <span class="ps-etikett">{{ t('portfolio.stEinkommen') }}</span>
                    <b class="ps-zahl">{{ chf(daten.einkommen.summe) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stEinkommenUnter', { n: daten.einkommen.zeilen.length }) }}<template v-if="daten.einkommen.ohneWert"> · <span class="at-warn">{{ t('portfolio.stOhneWert', { n: daten.einkommen.ohneWert }) }}</span></template></small>
                </Karte>
                <Karte class="ps-kachel">
                    <span class="ps-etikett">{{ t('portfolio.stVeraeusserungen') }}</span>
                    <b class="ps-zahl">{{ chf(daten.veraeusserungen.erloes) }}</b>
                    <small class="at-gedaempft">{{ t('portfolio.stGewinn') }} <span :class="daten.veraeusserungen.gewinn >= 0 ? 'at-gut' : 'at-schlecht'">{{ chf(daten.veraeusserungen.gewinn, { vorzeichen: true }) }}</span> · {{ t('portfolio.stSteuerfrei') }}</small>
                </Karte>
            </div>

            <Hinweis v-for="(h, i) in daten.hinweise" :key="i" :art="h.art === 'laufend' ? 'info' : 'warn'" class="at-mo-3">
                {{ h.text }}
                <span v-if="h.quellen" class="ps-liste">{{ h.quellen.join(' · ') }}</span>
                <span v-if="h.liste" class="ps-liste">{{ h.liste.map((x) => `${x.quelle}: ${x.asset} ${menge(x.menge)}`).join(' · ') }}</span>
            </Hinweis>

            <!-- ── Vermögen ── -->
            <section class="ps-abschnitt">
                <button type="button" class="ps-kopf" @click="klappe('vermoegen')">
                    <Symbol name="runter" :groesse="16" :class="{ zu: !offen.has('vermoegen') }" />
                    <h3>{{ t('portfolio.stWertschriften') }}</h3>
                    <span class="at-gedaempft">{{ chf(daten.vermoegenSumme) }}</span>
                </button>
                <div v-if="offen.has('vermoegen')" class="ps-inhalt">
                    <p class="ps-erkl">{{ t('portfolio.stWertschriftenErkl') }}</p>
                    <div class="ps-tabelle">
                        <div class="ps-zeile kopf"><span>Coin</span><span>{{ t('portfolio.stMenge') }}</span><span>{{ t('portfolio.stKurs') }}</span><span>{{ t('portfolio.stWert') }}</span></div>
                        <div v-for="p in daten.vermoegen" :key="p.asset" class="ps-posten">
                            <div class="ps-zeile" :class="{ ohne: p.chf == null }">
                                <span class="ps-coin"><span class="punkt" :style="{ background: farbeVon(p.asset) }" />{{ p.asset }}</span>
                                <span>{{ menge(p.menge) }}</span>
                                <span>
                                    <button type="button" class="ps-kurs" :title="t('portfolio.stKursAendern')" @click="starteKurs(p)">
                                        {{ p.kursChf != null ? p.kursChf.toLocaleString('de-CH', { maximumSignificantDigits: 6 }) : t('portfolio.stKursEintragen') }}
                                    </button>
                                    <small class="ps-kursquelle">{{ p.kursQuelle }}</small>
                                </span>
                                <span><b v-if="p.chf != null">{{ chf(p.chf) }}</b><span v-else class="at-warn">—</span></span>
                            </div>
                            <div v-if="bearbeite === p.asset" class="ps-kursform">
                                <input v-model="kursEingabe" inputmode="decimal" :placeholder="t('portfolio.stKursPlatzhalter')" @keydown.enter="speichereKurs(p.asset)" @keydown.esc="bearbeite = null" />
                                <select v-model="kursQuelle"><option value="estv">ESTV-Kursliste</option><option value="manuell">{{ t('portfolio.stVonHand') }}</option></select>
                                <Knopf art="haupt" klein @click="speichereKurs(p.asset)">{{ t('common.save') }}</Knopf>
                                <Knopf v-if="/ESTV|von Hand/.test(p.kursQuelle)" art="leise" klein @click="speichereKurs(p.asset, true)">{{ t('portfolio.stKursZurueck') }}</Knopf>
                                <Knopf art="leise" klein @click="bearbeite = null">{{ t('common.cancel') }}</Knopf>
                            </div>
                            <div class="ps-orte">
                                <span v-for="o in p.orte" :key="o.quelle" class="ps-ort">
                                    {{ o.name }} {{ menge(o.menge) }}
                                    <Pille v-if="o.sicherheit !== 'beleg'" :ton="o.sicherheit === 'offen' || o.sicherheit === 'abweichung' ? 'schlecht' : 'warn'"
                                        :title="o.sicherheit === 'abweichung' ? t('portfolio.stAbweichungInfo') : ''">{{ o.sicherheit }}</Pille>
                                </span>
                            </div>
                        </div>
                        <div class="ps-zeile summe"><span>Total</span><span></span><span></span><span>{{ chf(daten.vermoegenSumme) }}</span></div>
                    </div>
                </div>
            </section>

            <!-- ── Einkommen ── -->
            <section class="ps-abschnitt">
                <button type="button" class="ps-kopf" @click="klappe('einkommen')">
                    <Symbol name="runter" :groesse="16" :class="{ zu: !offen.has('einkommen') }" />
                    <h3>{{ t('portfolio.stEinkommenTitel') }}</h3>
                    <span class="at-gedaempft">{{ chf(daten.einkommen.summe) }}</span>
                </button>
                <div v-if="offen.has('einkommen')" class="ps-inhalt">
                    <p class="ps-erkl">{{ t('portfolio.stEinkommenErkl') }}</p>
                    <div class="ps-chips">
                        <span v-for="(v, art) in daten.einkommen.jeArt" :key="art" class="ps-chip">{{ ARTNAME[art] || art }} <b>{{ chf(v) }}</b></span>
                    </div>
                    <div class="ps-tabelle schmal">
                        <div v-for="[asset, v] in einkommenJeAsset" :key="asset" class="ps-zeile zwei"><span class="ps-coin"><span class="punkt" :style="{ background: farbeVon(asset) }" />{{ asset }}</span><span>{{ chf(v) }}</span></div>
                    </div>
                    <details class="ps-details">
                        <summary>{{ t('portfolio.stZufluesse', { n: daten.einkommen.zeilen.length }) }}</summary>
                        <div class="ps-tabelle">
                            <div v-for="z in zufluesse" :key="z.id" class="ps-zeile vier">
                                <span>{{ datum(z.zeit) }}</span><span>{{ z.quelle }} · {{ ARTNAME[z.art] || z.art }}</span>
                                <span>{{ menge(z.menge) }} {{ z.asset }}<Pille v-if="z.sicherheit && z.sicherheit !== 'beleg'" ton="warn">{{ z.sicherheit }}</Pille></span>
                                <span>{{ z.chfWert != null ? chf(z.chfWert) : '—' }}</span>
                            </div>
                            <button v-if="!alleZufluesse && daten.einkommen.zeilen.length > 25" type="button" class="ps-mehr" @click="alleZufluesse = true">{{ t('portfolio.stAlleZeigen', { n: daten.einkommen.zeilen.length }) }}</button>
                        </div>
                    </details>
                </div>
            </section>

            <!-- ── Veräusserungen ── -->
            <section class="ps-abschnitt">
                <button type="button" class="ps-kopf" @click="klappe('abgaenge')">
                    <Symbol name="runter" :groesse="16" :class="{ zu: !offen.has('abgaenge') }" />
                    <h3>{{ t('portfolio.stAbgaengeTitel') }}</h3>
                    <span class="at-gedaempft">{{ daten.veraeusserungen.anzahl }} · {{ chf(daten.veraeusserungen.erloes) }}</span>
                </button>
                <div v-if="offen.has('abgaenge')" class="ps-inhalt">
                    <p class="ps-erkl">{{ t('portfolio.stAbgaengeErkl') }}</p>
                    <div class="ps-chips">
                        <span class="ps-chip">{{ t('portfolio.stErloes') }} <b>{{ chf(daten.veraeusserungen.erloes) }}</b></span>
                        <span class="ps-chip">{{ t('portfolio.stEinstand') }} <b>{{ chf(daten.veraeusserungen.kosten) }}</b></span>
                        <span class="ps-chip">{{ t('portfolio.stGewinn') }} <b>{{ chf(daten.veraeusserungen.gewinn, { vorzeichen: true }) }}</b></span>
                        <span v-if="daten.veraeusserungen.ohneEinstand" class="ps-chip warn">{{ t('portfolio.stOhneEinstand', { n: daten.veraeusserungen.ohneEinstand }) }}</span>
                    </div>
                    <div class="ps-tabelle">
                        <div class="ps-zeile fuenf kopf"><span>{{ t('portfolio.stDatum') }}</span><span>Coin</span><span>{{ t('portfolio.stErloes') }}</span><span>{{ t('portfolio.stEinstand') }}</span><span>{{ t('portfolio.stGewinn') }}</span></div>
                        <div v-for="a in abgaenge" :key="a.id + a.asset" class="ps-zeile fuenf">
                            <span>{{ datum(a.zeit) }}<small class="at-gedaempft"> {{ a.quelle }}</small></span>
                            <span>{{ menge(a.menge) }} {{ a.asset }}<Pille v-if="a.kurzfristigAnteil > 0" ton="warn" :title="t('portfolio.stKurzInfo')">&lt; 6 M</Pille></span>
                            <span>{{ a.erloes != null ? chf(a.erloes) : '—' }}</span>
                            <span>{{ a.kosten != null ? chf(a.kosten) : '—' }}</span>
                            <span :class="a.gewinn > 0 ? 'at-gut' : a.gewinn < 0 ? 'at-schlecht' : ''">{{ a.gewinn != null ? chf(a.gewinn, { vorzeichen: true }) : '—' }}</span>
                        </div>
                        <button v-if="!alleAbgaenge && daten.veraeusserungen.abgaenge.length > 25" type="button" class="ps-mehr" @click="alleAbgaenge = true">{{ t('portfolio.stAlleZeigen', { n: daten.veraeusserungen.abgaenge.length }) }}</button>
                    </div>
                </div>
            </section>

            <!-- ── Futures ── -->
            <section v-if="futSichtbar" class="ps-abschnitt">
                <button type="button" class="ps-kopf" @click="klappe('futures')">
                    <Symbol name="runter" :groesse="16" :class="{ zu: !offen.has('futures') }" />
                    <h3>{{ t('portfolio.stFuturesTitel') }}</h3>
                    <span class="at-gedaempft">{{ chf(fut.guthabenChf) }} · {{ t('portfolio.stFutTrades', { n: fut.summe.n }) }}</span>
                </button>
                <div v-if="offen.has('futures')" class="ps-inhalt">
                    <p class="ps-erkl">{{ t('portfolio.stFuturesErkl') }}</p>
                    <h4 class="ps-unter">{{ t('portfolio.stFutGuthaben', { j: daten.jahr }) }}</h4>
                    <div class="ps-tabelle">
                        <div v-for="g in fut.guthaben" :key="g.boerse" class="ps-posten">
                            <div class="ps-zeile" :class="{ ohne: g.usd == null }">
                                <span class="ps-coin">{{ g.name }}</span>
                                <span>
                                    <button type="button" class="ps-kurs" :title="t('portfolio.stFutEintragen')" @click="starteFutures(g)">{{ g.usd != null ? usd(g.usd) : t('portfolio.stKursEintragen') }}</button>
                                </span>
                                <span>
                                    <Pille :ton="g.sicherheit === 'beleg' ? 'gut' : g.sicherheit === 'abgeleitet' ? 'warn' : 'schlecht'">{{ g.sicherheit === 'beleg' ? t('portfolio.stFutAuszug') : g.sicherheit }}</Pille>
                                    <small v-if="g.sicherheit === 'abgeleitet'" class="ps-kursquelle">{{ t('portfolio.stFutRechnung', { h: usd(g.heuteUsd), n: usd(g.nachUsd) }) }}</small>
                                    <small v-else-if="g.sicherheit === 'unbekannt'" class="ps-kursquelle">{{ futGrund(g) }}</small>
                                </span>
                                <span><b v-if="g.chf != null">{{ chf(g.chf) }}</b><span v-else class="at-warn">—</span></span>
                            </div>
                            <div v-if="futBearbeite === g.boerse" class="ps-kursform ps-futform">
                                <input v-model="futEingabe" inputmode="decimal" placeholder="USDT" @keydown.enter="speichereFutures(g.boerse)" @keydown.esc="futBearbeite = null" />
                                <Knopf art="haupt" klein @click="speichereFutures(g.boerse)">{{ t('common.save') }}</Knopf>
                                <Knopf v-if="g.sicherheit === 'beleg'" art="leise" klein @click="speichereFutures(g.boerse, true)">{{ t('portfolio.stFutZurueck') }}</Knopf>
                                <Knopf art="leise" klein @click="futBearbeite = null">{{ t('common.cancel') }}</Knopf>
                            </div>
                        </div>
                        <div class="ps-zeile summe"><span>Total</span><span></span><span><small v-if="fut.stichtagKurs" class="at-gedaempft">USD/CHF {{ fut.stichtagKurs.toFixed(4) }}</small></span><span>{{ chf(fut.guthabenChf) }}</span></div>
                    </div>
                    <template v-if="fut.boersen.length">
                        <h4 class="ps-unter">{{ t('portfolio.stFutErgebnis') }}</h4>
                        <div class="ps-tabelle">
                            <div class="ps-zeile fuenf kopf"><span>{{ t('portfolio.stFutBoerse') }}</span><span>Trades</span><span>{{ t('portfolio.stFutGebuehren') }}</span><span>{{ t('portfolio.stFutVolumen') }}</span><span>{{ t('portfolio.stFutNetto') }}</span></div>
                            <div v-for="b in fut.boersen" :key="b.boerse" class="ps-zeile fuenf">
                                <span class="ps-coin">{{ b.name }}</span>
                                <span>{{ b.n }}<small v-if="b.bots" class="at-gedaempft"> · {{ t('portfolio.stFutBots', { n: b.bots }) }}</small></span>
                                <span>{{ usd(b.gebuehrUsd) }}<small v-if="b.fundingUsd" class="ps-kursquelle">Funding {{ usd(b.fundingUsd) }}</small></span>
                                <span>{{ chf(b.volumenChf) }}</span>
                                <span :class="b.nettoChf >= 0 ? 'at-gut' : 'at-schlecht'">{{ chf(b.nettoChf, { vorzeichen: true }) }}</span>
                            </div>
                            <div class="ps-zeile fuenf summe"><span>Total</span><span>{{ fut.summe.n }}</span><span>{{ usd(fut.summe.gebuehrUsd) }}</span><span>{{ chf(fut.summe.volumenChf) }}</span><span>{{ chf(fut.summe.nettoChf, { vorzeichen: true }) }}</span></div>
                        </div>
                    </template>
                </div>
            </section>

            <!-- ── Gewerbsmässigkeit ── -->
            <section class="ps-abschnitt">
                <button type="button" class="ps-kopf" @click="klappe('kriterien')">
                    <Symbol name="runter" :groesse="16" :class="{ zu: !offen.has('kriterien') }" />
                    <h3>{{ t('portfolio.stKriterienTitel') }}</h3>
                    <span class="ps-ampeln">
                        <Symbol v-for="k in daten.kriterien" :key="k.id" :name="ampelSymbol(k.erfuellt)" :groesse="15" :class="ampel(k.erfuellt)" />
                    </span>
                </button>
                <div v-if="offen.has('kriterien')" class="ps-inhalt">
                    <p class="ps-erkl">{{ t('portfolio.stKriterienErkl') }}</p>
                    <div v-for="k in daten.kriterien" :key="k.id" class="ps-krit">
                        <Symbol :name="ampelSymbol(k.erfuellt)" :groesse="18" :class="ampel(k.erfuellt)" />
                        <div>
                            <b>{{ t('portfolio.stKrit_' + k.id) }}</b>
                            <p>{{ kriteriumWert(k) }}</p>
                        </div>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.ps-leiste { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: center; }
.ps-jahre { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.ps-jahr { border: 1px solid var(--line-stark); background: var(--panel); color: var(--muted); border-radius: var(--radius-pille); padding: 0.3rem 0.85rem; font: inherit; font-size: 0.85rem; cursor: pointer; font-variant-numeric: tabular-nums; }
.ps-jahr.aktiv { border-color: var(--accent); color: var(--accent); background: var(--accent-flaeche); font-weight: 700; }
.ps-aktionen { display: flex; gap: 0.4rem; }
.ps-recht { font-size: 0.78rem; color: var(--leise); display: flex; gap: 0.35rem; align-items: center; margin: 0.6rem 0 0; }
.ps-druckkopf { display: none; }

.ps-kacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.75rem; margin-top: 1rem; transition: opacity 0.2s; }
.ps-kacheln.laedt { opacity: 0.5; }
.ps-kachel { display: flex; flex-direction: column; gap: 0.2rem; }
.ps-etikett { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--leise); }
.ps-zahl { font-size: 1.6rem; font-variant-numeric: tabular-nums; }
.ps-liste { display: block; font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }

.ps-abschnitt { margin-top: 1rem; border-top: 1px solid var(--line); }
.ps-kopf { width: 100%; display: flex; align-items: center; gap: 0.5rem; background: none; border: 0; color: var(--text); padding: 0.8rem 0; cursor: pointer; font: inherit; text-align: left; }
.ps-kopf h3 { margin: 0; font-size: 1rem; flex: 1; }
.ps-kopf svg.zu { transform: rotate(-90deg); }
.ps-kopf svg { transition: transform 0.2s; color: var(--leise); }
.ps-inhalt { padding-bottom: 0.5rem; }
.ps-unter { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--leise); margin: 1rem 0 0.25rem; }
.ps-erkl { font-size: 0.82rem; color: var(--muted); margin: 0 0 0.75rem; max-width: 62rem; }

.ps-tabelle { display: flex; flex-direction: column; }
.ps-zeile { display: grid; grid-template-columns: minmax(6rem, 1fr) minmax(6rem, 1fr) minmax(8rem, 1.2fr) minmax(7rem, 1fr); gap: 0.75rem; padding: 0.45rem 0; font-size: 0.86rem; align-items: center; font-variant-numeric: tabular-nums; }
.ps-zeile > span:last-child { text-align: right; }
.ps-zeile.kopf { font-size: 0.72rem; color: var(--leise); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--line); }
.ps-zeile.summe { border-top: 2px solid var(--line-stark); font-weight: 700; }
.ps-zeile.ohne { color: var(--muted); }
.ps-zeile.zwei { grid-template-columns: 1fr auto; border-bottom: 1px dashed var(--line); }
.ps-zeile.vier { grid-template-columns: 6rem minmax(0, 1.4fr) minmax(0, 1fr) 7rem; border-bottom: 1px dashed var(--line); }
.ps-zeile.fuenf { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.2fr) 7rem 7rem 7rem; border-bottom: 1px dashed var(--line); }
.ps-tabelle.schmal { max-width: 26rem; }
.ps-posten { border-bottom: 1px solid var(--line); }
.ps-coin { display: inline-flex; align-items: center; font-weight: 700; }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.45rem; }
.ps-kurs { background: none; border: 0; border-bottom: 1px dashed var(--line-stark); color: var(--text); font: inherit; cursor: pointer; padding: 0; }
.ps-kurs:hover { color: var(--accent); border-color: var(--accent); }
.ps-zeile.ohne .ps-kurs { color: var(--warn); border-color: var(--warn); }
.ps-kursquelle { display: block; font-size: 0.7rem; color: var(--leise); }
.ps-kursform { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; padding: 0 0 0.6rem; }
.ps-kursform input, .ps-kursform select { background: var(--bg); border: 1px solid var(--accent-rand); border-radius: var(--radius-knopf); color: var(--text); padding: 0.3rem 0.55rem; font: inherit; font-size: 0.85rem; }
.ps-kursform input { width: 10rem; }
.ps-orte { display: flex; flex-wrap: wrap; gap: 0.25rem 0.9rem; padding: 0 0 0.5rem 1rem; font-size: 0.75rem; color: var(--muted); }
.ps-ort { display: inline-flex; gap: 0.3rem; align-items: center; }
.ps-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
.ps-chip { background: var(--panel-soft); border-radius: var(--radius-pille); padding: 0.25rem 0.75rem; font-size: 0.8rem; color: var(--muted); }
.ps-chip b { color: var(--text); margin-left: 0.25rem; }
.ps-chip.warn { color: var(--warn); background: var(--warn-flaeche); }
.ps-details { margin-top: 0.75rem; }
.ps-details summary { cursor: pointer; font-size: 0.85rem; color: var(--accent); }
.ps-mehr { background: none; border: 0; color: var(--accent); font: inherit; font-size: 0.82rem; cursor: pointer; padding: 0.6rem 0; text-align: left; }
.ps-ampeln { display: inline-flex; gap: 0.2rem; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.neutral { color: var(--leise); }
.ps-krit { display: flex; gap: 0.75rem; padding: 0.55rem 0; border-bottom: 1px dashed var(--line); align-items: flex-start; }
.ps-krit p { margin: 0.15rem 0 0; font-size: 0.82rem; color: var(--muted); }
@media (max-width: 640px) {
    .ps-zeile { grid-template-columns: 1fr 1fr; }
    .ps-zeile.kopf { display: none; }
    .ps-zeile.vier, .ps-zeile.fuenf { grid-template-columns: 1fr 1fr; }
}
@media print {
    .ps-leiste, .ps-mehr, .ps-kursform { display: none !important; }
    .ps-druckkopf { display: block; font-size: 1.3rem; font-weight: 700; margin-bottom: 0.5rem; }
    .ps * { color: #000 !important; }
}
</style>
