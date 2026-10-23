<script setup>
/**
 * Quellen: woher das Portfolio seine Zahlen hat.
 *
 * Börsen — ein Schalter „Spot ins Portfolio" je Börse (derselbe wie in den
 * API-Einstellungen), Stand des letzten Abrufs, Abgleich.
 * Wallets — gruppiert nach Gerät/App mit eigenem Namen; darunter die Ketten.
 * Neue Wallet: Typ antippen, Namen bestätigen, Adresse einfügen — fertig.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { uebersicht, ladeUebersicht, starteAbruf, abrufLaeuft, BOERSEN, boersenMaerkte, setzeBoersenMarkt, chf, vorZeit } from '../../stores/portfolio.js'
import { appEinstellungen } from '../../stores/settings.js'
import { dbUpdateSettings } from '../../utils/db.js'
import { Karte, Knopf, Pille, Symbol, Hinweis } from '../basis/index.js'
import AdressEingabe from './AdressEingabe.vue'
import ImportKarte from './ImportKarte.vue'

const { t } = useI18n()

const maerkte = computed(() => boersenMaerkte(appEinstellungen.value))
const stand = (q) => (uebersicht.value?.quellen || []).find((x) => x.quelle === q)
const statusTon = (s) => (s === 'ok' ? 'gut' : s === 'fehler' ? 'schlecht' : s === 'nichtEingerichtet' ? 'warn' : 'neutral')

async function schalteSpot(b, an) {
    await setzeBoersenMarkt(b, 'spot', an)
    if (an) starteAbruf(b)
    else ladeUebersicht()
}

// ── Zusätzliche Paare (Bitunix/Pionex) ──
const paare = ref(appEinstellungen.value?.portfolioPaare || '')
const paareGespeichert = ref(false)
async function speicherePaare() {
    await dbUpdateSettings({ portfolioPaare: paare.value })
    if (appEinstellungen.value) appEinstellungen.value.portfolioPaare = paare.value
    paareGespeichert.value = true
    setTimeout(() => { paareGespeichert.value = false }, 2000)
}

// ── Wallets ──
const wallets = ref([])
const typen = ref({})
const netzNamen = ref({})
const neuOffen = ref(false)
const neuTyp = ref('')
const neuName = ref('')
const adressFuer = ref(null)       // walletId mit offenem Adressfeld
const umbenennen = ref(null)
const loeschFrage = ref(null)

async function ladeWallets() {
    const { data } = await axios.get('/api/portfolio/wallets')
    wallets.value = data.wallets
    typen.value = data.typen
    netzNamen.value = Object.fromEntries(data.netze.map((n) => [n.id, n.name]))
}
onMounted(() => { ladeWallets(); ladeSchluessel() })

function waehleTyp(typ) {
    neuTyp.value = typ
    const gleiche = wallets.value.filter((w) => w.typ === typ).length
    neuName.value = typen.value[typ].name + (gleiche ? ` ${gleiche + 1}` : '')
}
async function legeWalletAn() {
    const { data } = await axios.post('/api/portfolio/wallets', { typ: neuTyp.value, name: neuName.value })
    neuOffen.value = false
    neuTyp.value = ''
    await ladeWallets()
    adressFuer.value = data.id
}
async function benenneUm(w, name) {
    umbenennen.value = null
    if (!name.trim() || name === w.name) return
    await axios.put(`/api/portfolio/wallets/${w.id}`, { name })
    await ladeWallets(); ladeUebersicht()
}
async function loescheWallet(w) {
    if (loeschFrage.value !== 'w' + w.id) { loeschFrage.value = 'w' + w.id; setTimeout(() => { if (loeschFrage.value === 'w' + w.id) loeschFrage.value = null }, 4000); return }
    await axios.delete(`/api/portfolio/wallets/${w.id}`)
    loeschFrage.value = null
    await ladeWallets(); ladeUebersicht()
}
async function loescheAdresse(a) {
    if (loeschFrage.value !== 'a' + a.id) { loeschFrage.value = 'a' + a.id; setTimeout(() => { if (loeschFrage.value === 'a' + a.id) loeschFrage.value = null }, 4000); return }
    await axios.delete(`/api/portfolio/adressen/${a.id}`)
    loeschFrage.value = null
    await ladeWallets(); ladeUebersicht()
}
async function schalteNetz(a, id) {
    const netze = a.netze.includes(id) ? a.netze.filter((n) => n !== id) : [...a.netze, id]
    if (!netze.length) return
    a.netze = netze
    await axios.put(`/api/portfolio/adressen/${a.id}`, { netze })
}
async function adresseFertig() {
    adressFuer.value = null
    await ladeWallets()
    await ladeUebersicht()
    starteAbruf()   // die neue Adresse wird ohnehin gelesen; so pollt die Seite mit
}
const kettenName = (k) => ({ btc: 'Bitcoin', evm: 'EVM', sol: 'Solana' }[k] || k)
const kettenSymbol = (k) => ({ btc: 'muenzen', evm: 'ebenen', sol: 'blitz' }[k] || 'kreis')

// ── Zugänge (Etherscan, Bitpanda steht in den API-Einstellungen) ──
const schluessel = ref({})
const ethKey = ref('')
const ethFehler = ref('')
async function ladeSchluessel() {
    const { data } = await axios.get('/api/portfolio/schluessel')
    schluessel.value = data.schluessel
}
async function speichereEth() {
    ethFehler.value = ''
    try {
        await axios.post('/api/portfolio/schluessel', { name: 'etherscan', wert: ethKey.value })
        ethKey.value = ''
        await ladeSchluessel()
        starteAbruf()
    } catch (e) { ethFehler.value = e.response?.data?.error || e.message }
}
async function entferneEth() {
    await axios.delete('/api/portfolio/schluessel/etherscan')
    await ladeSchluessel()
}
const hatEvm = computed(() => wallets.value.some((w) => w.adressen.some((a) => a.kette === 'evm')))
</script>

<template>
    <div class="pq">
        <!-- ── Börsen ── -->
        <section>
            <h3 class="pq-gruppe">{{ t('portfolio.boersen') }}</h3>
            <Karte dicht>
                <div v-for="b in BOERSEN" :key="b.id" class="pq-boerse">
                    <div class="pq-boerse-name">
                        <b>{{ b.name }}</b>
                        <template v-if="maerkte[b.id].spot && stand(b.id)">
                            <Pille :ton="statusTon(stand(b.id).status)" :title="stand(b.id).meldung || ''">
                                {{ stand(b.id).status === 'ok' ? vorZeit(stand(b.id).letzterAbruf) : (abrufLaeuft && stand(b.id).status === 'neu' ? t('portfolio.wirdGelesen') : t('portfolio.status_' + stand(b.id).status)) }}
                            </Pille>
                            <span v-if="stand(b.id).letzterAbruf" class="at-gedaempft pq-wert">{{ chf(stand(b.id).chf) }}</span>
                        </template>
                    </div>
                    <label class="pq-schalter">
                        <input type="checkbox" :checked="maerkte[b.id].spot" @change="schalteSpot(b.id, $event.target.checked)" />
                        <span>{{ t('portfolio.spotInsPortfolio') }}</span>
                    </label>
                    <p v-if="maerkte[b.id].spot && stand(b.id)?.status === 'nichtEingerichtet'" class="pq-hinweis">
                        {{ t('portfolio.schluesselFehlt') }} <router-link to="/einstellungen/journal">{{ t('portfolio.zuDenApiEinstellungen') }} →</router-link>
                    </p>
                    <p v-else-if="maerkte[b.id].spot && stand(b.id)?.status === 'fehler'" class="pq-hinweis schlecht">{{ stand(b.id).meldung }}</p>
                </div>
                <div class="pq-paare">
                    <label for="pq-paare">{{ t('portfolio.paareTitel') }}</label>
                    <div class="at-flex at-luecke-2 at-mitte">
                        <input id="pq-paare" v-model="paare" type="text" :placeholder="t('portfolio.paarePlatzhalter')" @keydown.enter="speicherePaare" />
                        <Knopf klein @click="speicherePaare">{{ paareGespeichert ? '✓' : t('common.save') }}</Knopf>
                    </div>
                    <small class="at-gedaempft">{{ t('portfolio.paareHilfe') }}</small>
                </div>
            </Karte>
            <ImportKarte />
        </section>

        <!-- ── Wallets ── -->
        <section>
            <div class="pq-kopf">
                <h3 class="pq-gruppe">{{ t('portfolio.wallets') }}</h3>
                <Knopf v-if="!neuOffen" klein symbol="plus" @click="neuOffen = true">{{ t('portfolio.walletNeu') }}</Knopf>
            </div>

            <Karte v-if="neuOffen" dicht class="pq-neu">
                <p class="at-gedaempft pq-klein">{{ t('portfolio.walletTypWaehlen') }}</p>
                <div class="pq-typen">
                    <button v-for="(ty, id) in typen" :key="id" type="button" class="pq-typ" :class="[id, { an: neuTyp === id }]" @click="waehleTyp(id)">
                        <span class="pq-typ-mark">{{ ty.name.slice(0, 1) }}</span>{{ ty.name }}
                    </button>
                </div>
                <div v-if="neuTyp" class="at-flex at-luecke-2 at-mitte at-mo-3 at-umbruch">
                    <input v-model="neuName" type="text" maxlength="60" class="pq-name" :placeholder="t('portfolio.walletName')" @keydown.enter="legeWalletAn" />
                    <Knopf art="haupt" klein @click="legeWalletAn">{{ t('portfolio.walletAnlegen') }}</Knopf>
                    <Knopf art="leise" klein @click="neuOffen = false; neuTyp = ''">{{ t('common.cancel') }}</Knopf>
                </div>
                <p class="pq-sicher"><Symbol name="schildHaken" :groesse="15" />{{ t('portfolio.nurOeffentlich') }}</p>
            </Karte>

            <p v-if="!wallets.length && !neuOffen" class="at-gedaempft pq-klein">{{ t('portfolio.keineWallets') }}</p>

            <Karte v-for="w in wallets" :key="w.id" dicht class="pq-wallet">
                <div class="pq-wallet-kopf">
                    <span class="pq-typ-mark" :class="w.typ">{{ (typen[w.typ]?.name || '?').slice(0, 1) }}</span>
                    <input v-if="umbenennen === w.id" :value="w.name" class="pq-name" autofocus @keydown.enter="benenneUm(w, $event.target.value)" @blur="benenneUm(w, $event.target.value)" />
                    <button v-else type="button" class="pq-wallet-name" :title="t('portfolio.umbenennen')" @click="umbenennen = w.id">
                        {{ w.name }} <Symbol name="stift" :groesse="13" />
                    </button>
                    <span class="at-gedaempft pq-klein">{{ typen[w.typ]?.name }}</span>
                    <Knopf art="leise" klein nur-symbol :symbol="loeschFrage === 'w' + w.id ? 'warnung' : 'muell'"
                        :titel="loeschFrage === 'w' + w.id ? t('portfolio.nochmalLoeschen') : t('portfolio.walletLoeschen')" class="at-ml-auto" @click="loescheWallet(w)" />
                </div>

                <div v-for="a in w.adressen" :key="a.id" class="pq-adresse">
                    <span class="pq-kette"><Symbol :name="kettenSymbol(a.kette)" :groesse="15" /></span>
                    <div class="pq-adr-text">
                        <div><b>{{ a.label || kettenName(a.kette) }}</b> <code>{{ a.anzeige }}</code>
                            <span v-if="a.art !== 'adresse'" class="pq-art">{{ a.art }}</span></div>
                        <div v-if="a.kette === 'evm'" class="pq-netze">
                            <button v-for="(name, id) in netzNamen" :key="id" type="button" class="pq-netz" :class="{ an: a.netze.includes(Number(id)) }" @click="schalteNetz(a, Number(id))">{{ name }}</button>
                        </div>
                        <small v-if="stand('a' + a.id)?.meldung" class="pq-hinweis" :class="{ schlecht: stand('a' + a.id)?.status === 'fehler' }">{{ stand('a' + a.id).meldung }}</small>
                    </div>
                    <div class="pq-adr-rechts">
                        <span v-if="stand('a' + a.id)?.letzterAbruf">{{ chf(stand('a' + a.id).chf) }}</span>
                        <Pille v-if="stand('a' + a.id)" :ton="statusTon(stand('a' + a.id).status)">{{ stand('a' + a.id).status === 'ok' ? vorZeit(stand('a' + a.id).letzterAbruf) : (abrufLaeuft && stand('a' + a.id).status === 'neu' ? t('portfolio.wirdGelesen') : t('portfolio.status_' + stand('a' + a.id).status)) }}</Pille>
                        <Pille v-else-if="abrufLaeuft" ton="neutral">{{ t('portfolio.wirdGelesen') }}</Pille>
                        <Knopf art="leise" klein nur-symbol :symbol="loeschFrage === 'a' + a.id ? 'warnung' : 'muell'"
                            :titel="loeschFrage === 'a' + a.id ? t('portfolio.nochmalLoeschen') : t('portfolio.adresseLoeschen')" @click="loescheAdresse(a)" />
                    </div>
                </div>

                <AdressEingabe v-if="adressFuer === w.id" :wallet-id="w.id" fokus @fertig="adresseFertig" @abbrechen="adressFuer = null" />
                <button v-else type="button" class="pq-plus" @click="adressFuer = w.id">
                    <Symbol name="plus" :groesse="14" />{{ w.adressen.length ? t('portfolio.weitereAdresse') : t('portfolio.ersteAdresse', { typ: typen[w.typ]?.name }) }}
                </button>
            </Karte>

            <!-- Etherscan: nur nötig, wenn eine EVM-Adresse da ist -->
            <Karte v-if="hatEvm || schluessel.etherscan" dicht class="pq-eth">
                <div class="pq-eth-kopf">
                    <b>{{ t('portfolio.etherscanTitel') }}</b>
                    <Pille :ton="schluessel.etherscan ? 'gut' : 'warn'">{{ schluessel.etherscan ? t('common.configured') : t('portfolio.fehlt') }}</Pille>
                </div>
                <p class="at-gedaempft pq-klein">{{ t('portfolio.etherscanText') }}</p>
                <div v-if="!schluessel.etherscan" class="at-flex at-luecke-2 at-mitte at-umbruch">
                    <input v-model.trim="ethKey" type="password" class="pq-name" :placeholder="t('portfolio.etherscanPlatzhalter')" @keydown.enter="speichereEth" />
                    <Knopf klein art="haupt" :disabled="!ethKey" @click="speichereEth">{{ t('common.save') }}</Knopf>
                    <a href="https://etherscan.io/myapikey" target="_blank" rel="noopener" class="pq-link">{{ t('portfolio.etherscanHolen') }} ↗</a>
                </div>
                <Knopf v-else art="leise" klein symbol="muell" @click="entferneEth">{{ t('portfolio.schluesselEntfernen') }}</Knopf>
                <Hinweis v-if="ethFehler" art="fehler" class="at-mo-2">{{ ethFehler }}</Hinweis>
            </Karte>
        </section>
    </div>
</template>

<style scoped>
.pq { display: grid; gap: 1.5rem; }
@media (min-width: 1100px) { .pq { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); align-items: start; } }
.pq-gruppe { font-size: 0.75rem; letter-spacing: 0.08em; color: var(--leise); margin: 0 0 0.5rem; font-weight: 600; text-transform: uppercase; }
.pq-kopf { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.pq-kopf .pq-gruppe { margin: 0; }
.pq-klein { font-size: 0.82rem; margin: 0 0 0.5rem; }

.pq-boerse { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.25rem 1rem; padding: 0.65rem 0; border-bottom: 1px solid var(--line); align-items: center; }
.pq-boerse-name { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.pq-wert { font-size: 0.85rem; }
.pq-schalter { display: inline-flex; gap: 0.45rem; align-items: center; font-size: 0.85rem; cursor: pointer; color: var(--muted); }
.pq-schalter input { accent-color: var(--accent); width: 1rem; height: 1rem; }
.pq-hinweis { grid-column: 1 / -1; font-size: 0.78rem; color: var(--leise); margin: 0; }
.pq-hinweis a { color: var(--accent); }
.pq-hinweis.schlecht { color: var(--bad); }
.pq-paare { padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; }
.pq-paare label { font-size: 0.85rem; font-weight: 600; }
.pq-paare input, .pq-name {
    flex: 1 1 12rem; background: var(--bg); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf);
    color: var(--text); padding: 0.4rem 0.65rem; font: inherit; font-size: 0.85rem; min-width: 0;
}

.pq-neu { margin-bottom: 0.75rem; border: 1px solid var(--accent-rand); }
.pq-typen { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: 0.5rem; }
.pq-typ {
    display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding: 0.8rem 0.5rem;
    background: var(--panel-soft); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf); color: var(--text);
    font: inherit; font-size: 0.85rem; cursor: pointer; transition: border-color 0.15s, transform 0.15s;
}
.pq-typ:hover { transform: translateY(-1px); border-color: var(--accent-rand); }
.pq-typ.an { border-color: var(--accent); background: var(--accent-flaeche); }
.pq-typ-mark {
    width: 2rem; height: 2rem; border-radius: 0.6rem; display: grid; place-items: center; font-weight: 800;
    background: var(--panel-hoch); color: var(--muted); flex-shrink: 0;
}
.ledger .pq-typ-mark, .pq-typ-mark.ledger { background: #e8f4f6; color: #05080a; }
.safepal .pq-typ-mark, .pq-typ-mark.safepal { background: #4a5be0; color: #fff; }
.metamask .pq-typ-mark, .pq-typ-mark.metamask { background: #f0a04b; color: #2a1603; }
.pq-sicher { font-size: 0.78rem; color: var(--good); display: flex; gap: 0.35rem; align-items: center; margin: 0.75rem 0 0; }

.pq-wallet { margin-bottom: 0.75rem; }
.pq-wallet-kopf { display: flex; align-items: center; gap: 0.6rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--line); }
.pq-wallet-name { background: none; border: 0; color: var(--text); font: inherit; font-weight: 700; font-size: 1rem; cursor: pointer; display: inline-flex; gap: 0.35rem; align-items: center; padding: 0; }
.pq-wallet-name svg { color: var(--leise); opacity: 0; transition: opacity 0.15s; }
.pq-wallet-name:hover svg { opacity: 1; }
.pq-adresse { display: grid; grid-template-columns: 1.8rem minmax(0, 1fr) auto; gap: 0.6rem; padding: 0.6rem 0; border-bottom: 1px dashed var(--line); align-items: start; }
.pq-kette { width: 1.8rem; height: 1.8rem; border-radius: 50%; background: var(--panel-hoch); display: grid; place-items: center; color: var(--accent); }
.pq-adr-text { font-size: 0.85rem; min-width: 0; }
.pq-adr-text code { font-size: 0.75rem; color: var(--muted); }
.pq-art { font-size: 0.68rem; text-transform: uppercase; background: var(--panel-hoch); border-radius: var(--radius-klein); padding: 0.05rem 0.35rem; color: var(--muted); margin-left: 0.25rem; }
.pq-netze { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.35rem; }
.pq-netz { border: 1px solid var(--line); background: none; color: var(--leise); border-radius: var(--radius-pille); padding: 0.05rem 0.5rem; font: inherit; font-size: 0.7rem; cursor: pointer; }
.pq-netz.an { border-color: var(--accent-rand); color: var(--accent); }
.pq-adr-rechts { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.pq-plus { margin-top: 0.6rem; background: none; border: 1px dashed var(--line-stark); color: var(--muted); border-radius: var(--radius-knopf); padding: 0.55rem; width: 100%; font: inherit; font-size: 0.85rem; cursor: pointer; display: flex; gap: 0.4rem; justify-content: center; align-items: center; }
.pq-plus:hover { border-color: var(--accent); color: var(--accent); }
.pq-eth-kopf { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem; }
.pq-link { color: var(--accent); font-size: 0.82rem; }
@media (max-width: 560px) {
    .pq-adresse { grid-template-columns: 1.6rem minmax(0, 1fr); }
    .pq-adr-rechts { grid-column: 2; }
}
</style>
