<script setup>
/**
 * Bewegungen: eine Zeitachse über alle Quellen, nach Tagen gruppiert.
 *
 * „Zu prüfen" ist der eigentliche Arbeitsplatz: Ein- und Auszahlungen ohne
 * erkannten Partner, Airdrops und Unbekanntes. Ein Klick ordnet ein —
 * eigener Transfer (zählt nicht), Kauf extern, Einkommen, ignorieren. Das ist
 * steuerlich der wichtigste Handgriff: ohne ihn wird ein Umzug vom Börsen-
 * konto auf den Ledger zum Einkommen.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { uebersicht, chf, menge, farbeVon } from '../../stores/portfolio.js'
import { Knopf, Kreisel, Leerzustand, Symbol, Pille } from '../basis/index.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const zeilen = ref([])
const offen = ref(0)
const weitere = ref(false)
const laedt = ref(false)
const filter = ref(route.query.offen === '1' ? 'offen' : 'alle')
const quelle = ref(String(route.query.quelle || ''))
const asset = ref(String(route.query.asset || ''))

const FILTER = computed(() => [
    { id: 'alle', text: t('portfolio.filterAlle') },
    { id: 'offen', text: t('portfolio.filterOffen'), zahl: offen.value },
    { id: 'handel', text: t('portfolio.filterHandel') },
    { id: 'transfer', text: t('portfolio.filterTransfer') },
    { id: 'ertrag', text: t('portfolio.filterErtrag') },
])
const ARTEN_JE_FILTER = { handel: ['kauf', 'verkauf', 'tausch'], transfer: ['einzahlung', 'auszahlung', 'umbuchung'], ertrag: ['staking', 'airdrop', 'belohnung'] }

const quellenListe = computed(() => {
    const u = uebersicht.value
    if (!u) return []
    return u.quellen.map((q) => ({ wert: q.quelle, text: q.gruppe === 'boerse' ? q.name : `${u.wallets.find((w) => w.id === q.walletId)?.name || ''} · ${q.name}` }))
})
const quellenName = (q) => quellenListe.value.find((x) => x.wert === q)?.text || q

async function lade(mehr = false) {
    laedt.value = true
    try {
        const params = { limit: 150 }
        if (filter.value === 'offen') params.offen = '1'
        if (quelle.value) params.quelle = quelle.value
        if (asset.value) params.asset = asset.value
        if (ARTEN_JE_FILTER[filter.value]) params.arten = ARTEN_JE_FILTER[filter.value].join(',')
        if (mehr && zeilen.value.length) params.vor = zeilen.value.at(-1).zeit
        const { data } = await axios.get('/api/portfolio/bewegungen', { params })
        zeilen.value = mehr ? [...zeilen.value, ...data.zeilen] : data.zeilen
        offen.value = data.offen
        weitere.value = data.weitere
    } finally {
        laedt.value = false
    }
}
watch([filter, quelle, asset], () => {
    router.replace({ query: { ...(filter.value === 'offen' ? { offen: '1' } : {}), ...(quelle.value ? { quelle: quelle.value } : {}), ...(asset.value ? { asset: asset.value } : {}) } })
    lade()
})
onMounted(() => lade())

const tage = computed(() => {
    const m = new Map()
    for (const z of zeilen.value) {
        const d = new Date(Number(z.zeit)).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })
        if (!m.has(d)) m.set(d, [])
        m.get(d).push(z)
    }
    return [...m.entries()]
})

const SYMBOL = { kauf: 'plus', verkauf: 'minus', tausch: 'tausch', einzahlung: 'pfeilSchraegAb', auszahlung: 'pfeilHochRechts', umbuchung: 'pfeilKreisRechts', staking: 'wachstum', airdrop: 'stern', belohnung: 'stern', gebuehr: 'prozent', sonstiges: 'frage' }
const istOffen = (z) => !z.einordnung && !z.transferMit && ['einzahlung', 'auszahlung', 'sonstiges'].includes(z.art)
// In „Alle" stehen die Knöpfe hinter einem kleinen „Einordnen" — sonst trägt jede zweite Zeile vier Knöpfe.
const aufgeklappt = ref(new Set())
const knoepfeSichtbar = (z) => filter.value === 'offen' || aufgeklappt.value.has(z.id)
function klappeAuf(z) { const s = new Set(aufgeklappt.value); s.has(z.id) ? s.delete(z.id) : s.add(z.id); aufgeklappt.value = s }
const partner = (z) => (z.transferMit ? zeilen.value.find((x) => x.id === z.transferMit) : null)

async function ordneEin(z, einordnung) {
    const alt = z.einordnung
    z.einordnung = einordnung
    try {
        await axios.put(`/api/portfolio/bewegungen/${z.id}`, { einordnung })
        offen.value = Math.max(0, offen.value + (einordnung && !alt ? -1 : !einordnung && alt ? 1 : 0))
        if (filter.value === 'offen' && einordnung) setTimeout(() => { zeilen.value = zeilen.value.filter((x) => x.id !== z.id) }, 450)
    } catch { z.einordnung = alt }
}
const EINORDNUNG = computed(() => [
    { id: 'transfer', text: t('portfolio.einTransfer'), symbol: 'pfeilKreisRechts' },
    { id: 'kauf', text: t('portfolio.einKauf'), symbol: 'plus' },
    { id: 'einkommen', text: t('portfolio.einEinkommen'), symbol: 'wachstum' },
    { id: 'ignorieren', text: t('portfolio.einIgnorieren'), symbol: 'augeAus' },
])
async function sammel(einordnung) {
    if (!window.confirm(t('portfolio.sammelFrage', { q: quellenName(quelle.value), e: EINORDNUNG.value.find((x) => x.id === einordnung)?.text }))) return
    await axios.post('/api/portfolio/bewegungen/sammel', { quelle: quelle.value, einordnung })
    lade()
}
const vz = (v) => (Number(v) > 0 ? '+' : '')
const zeitText = (ms) => new Date(Number(ms)).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
    <div>
        <div class="pb-leiste">
            <div class="pb-filter" role="tablist">
                <button v-for="f in FILTER" :key="f.id" type="button" role="tab" :aria-selected="filter === f.id"
                    class="pb-chip" :class="{ aktiv: filter === f.id, warn: f.id === 'offen' && f.zahl }" @click="filter = f.id">
                    {{ f.text }}<span v-if="f.zahl" class="zahl">{{ f.zahl }}</span>
                </button>
            </div>
            <div class="pb-wahl">
                <select v-model="quelle" :aria-label="t('portfolio.quelleWaehlen')">
                    <option value="">{{ t('portfolio.alleQuellen') }}</option>
                    <option v-for="q in quellenListe" :key="q.wert" :value="q.wert">{{ q.text }}</option>
                </select>
                <input v-model.lazy="asset" type="search" :placeholder="t('portfolio.coinSuchen')" class="pb-suche" />
            </div>
        </div>

        <p v-if="filter === 'offen'" class="pb-erklaerung">{{ t('portfolio.offenErklaerung') }}</p>
        <div v-if="filter === 'offen' && quelle && zeilen.length" class="pb-sammel">
            <span>{{ t('portfolio.sammelText', { q: quellenName(quelle) }) }}</span>
            <button v-for="e in EINORDNUNG" :key="e.id" type="button" @click="sammel(e.id)"><Symbol :name="e.symbol" :groesse="13" />{{ e.text }}</button>
        </div>

        <div v-if="laedt && !zeilen.length" class="at-mittig at-py-5"><Kreisel /></div>
        <Leerzustand v-else-if="!zeilen.length" :symbol="filter === 'offen' ? 'hakenKreis' : 'verlauf'"
            :titel="filter === 'offen' ? t('portfolio.nichtsOffen') : t('portfolio.keineBewegungen')"
            :text="filter === 'offen' ? '' : t('portfolio.keineBewegungenText')" />

        <div v-for="[tag, liste] in tage" :key="tag" class="pb-tag">
            <h4>{{ tag }}</h4>
            <div v-for="z in liste" :key="z.id" class="pb-zeile" :class="{ erledigt: z.einordnung }">
                <span class="pb-symbol" :class="z.art"><Symbol :name="SYMBOL[z.art] || 'frage'" :groesse="16" /></span>
                <div class="pb-text">
                    <div class="pb-titel">
                        <b>{{ t('portfolio.art_' + z.art) }}</b>
                        <span class="pb-coin"><span class="punkt" :style="{ background: farbeVon(z.asset) }" />{{ z.asset }}</span>
                        <Pille v-if="z.transferMit" ton="neutral" symbol="pfeilKreisRechts" :title="partner(z) ? quellenName(partner(z).quelle) : ''">
                            {{ z.transferSicher ? t('portfolio.transferSicher') : t('portfolio.transferVermutet') }}
                        </Pille>
                        <Pille v-if="z.einordnung" ton="akzent">{{ t('portfolio.ein_' + z.einordnung) }}</Pille>
                    </div>
                    <div class="pb-unter at-gedaempft">
                        {{ zeitText(z.zeit) }} · {{ quellenName(z.quelle) }}
                        <template v-if="z.gebuehrMenge"> · {{ t('portfolio.gebuehr') }} {{ menge(z.gebuehrMenge) }} {{ z.gebuehrAsset }}</template>
                        <code v-if="z.txHash" :title="z.txHash">{{ z.txHash.slice(0, 10) }}…</code>
                    </div>
                    <button v-if="istOffen(z) && !knoepfeSichtbar(z)" type="button" class="pb-offen" @click="klappeAuf(z)">
                        <Symbol name="frage" :groesse="12" />{{ t('portfolio.einordnen') }}
                    </button>
                    <div v-else-if="istOffen(z)" class="pb-einordnen">
                        <button v-for="e in EINORDNUNG" :key="e.id" type="button" @click="ordneEin(z, e.id)">
                            <Symbol :name="e.symbol" :groesse="13" />{{ e.text }}
                        </button>
                    </div>
                    <button v-else-if="z.einordnung" type="button" class="pb-zurueck" @click="ordneEin(z, null)">{{ t('portfolio.einordnungAufheben') }}</button>
                </div>
                <div class="pb-betraege">
                    <span :class="Number(z.menge) >= 0 ? 'at-gut' : 'at-schlecht'">{{ vz(z.menge) }}{{ menge(z.menge) }} {{ z.asset }}</span>
                    <span v-if="z.gegenAsset" class="at-gedaempft">{{ vz(z.gegenMenge) }}{{ menge(z.gegenMenge) }} {{ z.gegenAsset }}</span>
                    <span v-if="z.chfWert != null" class="pb-chf" :title="z.chfQuelle">{{ chf(z.chfWert) }}</span>
                </div>
            </div>
        </div>

        <div v-if="weitere" class="at-mittig at-mo-3">
            <Knopf :laedt="laedt" @click="lade(true)">{{ t('portfolio.mehrLaden') }}</Knopf>
        </div>
    </div>
</template>

<style scoped>
.pb-leiste { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: center; }
.pb-filter { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.pb-chip {
    border: 1px solid var(--line-stark); background: var(--panel); color: var(--muted); border-radius: var(--radius-pille);
    padding: 0.3rem 0.8rem; font: inherit; font-size: 0.82rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;
}
.pb-chip.aktiv { border-color: var(--accent); color: var(--accent); background: var(--accent-flaeche); }
.pb-chip .zahl { background: var(--panel-hoch); color: var(--text); border-radius: var(--radius-pille); padding: 0 0.45rem; font-size: 0.75rem; }
.pb-chip.warn .zahl { background: var(--warn); color: #1d1405; }
.pb-wahl { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.pb-wahl select, .pb-suche {
    background: var(--panel); color: var(--text); border: 1px solid var(--line-stark); border-radius: var(--radius-knopf);
    padding: 0.35rem 0.6rem; font: inherit; font-size: 0.85rem;
}
.pb-suche { width: 9rem; text-transform: uppercase; }
.pb-erklaerung { font-size: 0.85rem; color: var(--muted); margin: 0.75rem 0 0; max-width: 60rem; }

.pb-tag h4 { font-size: 0.75rem; letter-spacing: 0.05em; color: var(--leise); text-transform: uppercase; margin: 1.25rem 0 0.25rem; font-weight: 600; }
.pb-zeile { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid var(--line); align-items: start; transition: opacity 0.4s; }
.pb-zeile.erledigt { opacity: 0.75; }
.pb-symbol { width: 2rem; height: 2rem; border-radius: 50%; display: grid; place-items: center; background: var(--panel-hoch); color: var(--muted); }
.pb-symbol.kauf, .pb-symbol.einzahlung, .pb-symbol.staking, .pb-symbol.airdrop, .pb-symbol.belohnung { color: var(--good); background: var(--good-flaeche); }
.pb-symbol.verkauf, .pb-symbol.auszahlung { color: var(--bad); background: var(--bad-flaeche); }
.pb-symbol.tausch, .pb-symbol.umbuchung { color: var(--accent); background: var(--accent-flaeche); }
.pb-titel { display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; align-items: center; }
.pb-coin { display: inline-flex; align-items: center; font-weight: 600; }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.35rem; }
.pb-unter { font-size: 0.78rem; margin-top: 0.15rem; display: flex; flex-wrap: wrap; gap: 0 0.4rem; align-items: center; }
.pb-unter code { font-size: 0.72rem; }
.pb-betraege { display: flex; flex-direction: column; align-items: flex-end; font-size: 0.85rem; font-variant-numeric: tabular-nums; text-align: right; }
.pb-chf { color: var(--text); font-weight: 600; }
.pb-einordnen { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.45rem; }
.pb-einordnen button {
    border: 1px dashed var(--line-stark); background: none; color: var(--muted); border-radius: var(--radius-pille);
    padding: 0.2rem 0.65rem; font: inherit; font-size: 0.75rem; cursor: pointer; display: inline-flex; gap: 0.3rem; align-items: center;
}
.pb-einordnen button:hover { border-style: solid; border-color: var(--accent); color: var(--accent); }
.pb-offen { margin-top: 0.35rem; background: var(--warn-flaeche); border: 0; color: var(--warn); border-radius: var(--radius-pille); padding: 0.1rem 0.6rem; font: inherit; font-size: 0.72rem; cursor: pointer; display: inline-flex; gap: 0.3rem; align-items: center; }
.pb-sammel { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.75rem; padding: 0.6rem 0.75rem; background: var(--panel-soft); border-radius: var(--radius-knopf); font-size: 0.82rem; }
.pb-sammel span { margin-right: 0.4rem; color: var(--muted); }
.pb-sammel button { border: 1px solid var(--line-stark); background: var(--panel); color: var(--text); border-radius: var(--radius-pille); padding: 0.2rem 0.65rem; font: inherit; font-size: 0.75rem; cursor: pointer; display: inline-flex; gap: 0.3rem; align-items: center; }
.pb-sammel button:hover { border-color: var(--accent); color: var(--accent); }
.pb-zurueck { background: none; border: 0; color: var(--leise); font: inherit; font-size: 0.72rem; cursor: pointer; padding: 0.2rem 0 0; text-decoration: underline; }
@media (max-width: 560px) {
    .pb-zeile { grid-template-columns: 1.6rem minmax(0, 1fr); }
    .pb-betraege { grid-column: 2; align-items: flex-start; flex-direction: row; gap: 0.6rem; flex-wrap: wrap; }
    .pb-symbol { width: 1.6rem; height: 1.6rem; }
}
</style>
