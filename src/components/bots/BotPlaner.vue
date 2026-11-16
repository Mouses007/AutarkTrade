<script setup>
/**
 * Bot-Planer (/bots/plan): einen neuen Futures-Grid-Bot von Grund auf planen.
 * Der Code misst die Lage und rechnet Kandidaten (Rückblick relativ zum Kurs
 * und Start heute), die KI wählt auf Wunsch höchstens drei, gestartet wird
 * über die Steuerung mit Prüfung bei Pionex. Server: server/bots/planer*.js.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '@/components/basis/Karte.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Pille from '@/components/basis/Pille.vue'
import BotAktionDialog from './BotAktionDialog.vue'
import { preis, betrag, prozent, zahl, datum, ton, tonProzent } from './format.js'

const props = defineProps({ steuerung: { type: Object, default: null } })
const emit = defineEmits(['gestartet'])
const { t, te, locale } = useI18n()

const SPEICHER = 'at.bots.plan'
const lies = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || 'null') || {} } catch { return {} } }
const alt = lies()
// Ab Fassung 2 ist „Alle Richtungen" die Vorgabe; eine früher gespeicherte Richtung gilt nicht mehr
const eingabe = ref({ coin: alt.coin || 'SOL', coinM: alt.coinM === true, spot: alt.spot === true, richtung: (alt.v === 2 && alt.richtung) || 'ALLE', einsatz: alt.einsatz || '', hebel: alt.hebel || '3', tage: alt.tage || 30 })
watch(eingabe, (e) => { try { localStorage.setItem(SPEICHER, JSON.stringify({ ...e, v: 2 })) } catch { /* ohne Speicher */ } }, { deep: true })
const alle = computed(() => eingabe.value.richtung === 'ALLE')

const coins = ref([])
const coinInfo = computed(() => coins.value.find((c) => c.coin === String(eingabe.value.coin || '').trim().toUpperCase()) || null)
const einheit = computed(() => (eingabe.value.coinM && !eingabe.value.spot ? String(eingabe.value.coin || '').toUpperCase() || 'Coin' : 'USDT'))
// «Max»: freies Guthaben bei Pionex in der Einsatz-Münze holen, eintragen und gleich rechnen
const maxLaedt = ref(false)
const maxHinweis = ref(null)
async function setzeMax() {
    maxLaedt.value = true; maxHinweis.value = null
    const e = einheit.value
    try {
        const { data } = await axios.get('/api/bots/plan/guthaben', { params: { coin: e }, timeout: 20_000 })
        if (einheit.value !== e) return   // Art oder Coin inzwischen gewechselt: der Betrag gehört zur alten Münze
        if (!data?.ok) maxHinweis.value = { warn: true, text: t(data?.code === 'keinSchluessel' ? 'bots.plan.maxOhneSchluessel' : 'bots.plan.maxFehler') }
        else if (!(data.frei > 0)) maxHinweis.value = { warn: true, text: t('bots.plan.maxLeer', { einheit: e }) }
        else {
            eingabe.value.einsatz = String(data.frei)
            maxHinweis.value = { text: t('bots.plan.maxFrei', { betrag: betrag(data.frei, e) }) }
            if (eingabeOk.value) rechnen()
        }
    } catch (err) {
        maxHinweis.value = { warn: true, text: err?.response?.data?.error || t('bots.plan.maxFehler') }
    } finally { maxLaedt.value = false }
}
watch(einheit, () => { maxHinweis.value = null })
// Art als ein Feld: USDT-M, Coin-M oder Spot (Spot-Grid: ohne Hebel, nur Long, ohne Stop-Loss beim Start)
const artWahl = computed({
    get: () => (eingabe.value.spot ? 'spot' : eingabe.value.coinM ? 'coinM' : 'linear'),
    set: (v) => { eingabe.value.spot = v === 'spot'; eingabe.value.coinM = v === 'coinM' },
})
const spot = computed(() => eingabe.value.spot === true)
onMounted(async () => {
    try { coins.value = (await axios.get('/api/bots/plan/coins', { timeout: 60_000 })).data?.coins || [] } catch { coins.value = [] }
    try { ki.value = (await axios.get('/api/bots/plan/ki')).data?.ergebnis || null } catch { ki.value = null }
})
// Gibt es die gewählte Art für die Coin nicht, auf die andere wechseln
watch(coinInfo, (c) => {
    if (!c) return
    const geht = { linear: c.linear, coinM: c.coinM, spot: c.spot }
    if (geht[artWahl.value]) return
    artWahl.value = c.linear ? 'linear' : c.coinM ? 'coinM' : 'spot'
})

const meldung = (e, ns = 'bots.plan.fehler') => {
    const d = e?.response?.data
    if (d?.code === 'kiWarten') return t('bots.ki.warten', { s: d.sekunden })
    if (d?.code && te(`${ns}.${d.code}`)) return t(`${ns}.${d.code}`)
    if (d?.code && te(`bots.st.fehler.${d.code}`)) return t(`bots.st.fehler.${d.code}`)
    return d?.error || e.message
}
const anfrage = (extra = {}) => ({ ...eingabe.value, coin: String(eingabe.value.coin || '').trim().toUpperCase(), tage: Number(eingabe.value.tage), ...(eingabe.value.spot ? { hebel: '1', richtung: 'LONG' } : {}), ...extra })

// ── Rechnen ──────────────────────────────────────────────────────────────
const erg = ref(null)
const laedt = ref(false)
const fehler = ref('')
async function rechnen() {
    laedt.value = true; fehler.value = ''
    try {
        erg.value = (await axios.post('/api/bots/plan/rechnen', anfrage(), { timeout: 180_000 })).data
        eigenErg.value = null
        richtungFilter.value = ''
        pruefeMindest()
    } catch (e) { fehler.value = meldung(e) } finally { laedt.value = false }
}
const gueltig = computed(() => (erg.value?.kandidaten || []).filter((c) => !c.fehler))
const ergebnisPct = (c) => (c?.rueckblick?.gesamt != null && erg.value?.eingabe?.einsatz ? c.rueckblick.gesamt / erg.value.eingabe.einsatz : null)
const ende = (r) => (!r ? '—' : r.liquidation ? t('bots.sim.liquidiert') : r.ausstieg ? t(`bots.feld.${r.ausstieg.art}`) : t('bots.sim.laeuft'))
const sortierung = ref('id')
const richtungFilter = ref('')
const imErgAlle = computed(() => erg.value?.eingabe?.richtung === 'ALLE')
const sortiert = computed(() => {
    const l = gueltig.value.filter((c) => !richtungFilter.value || c.richtung === richtungFilter.value)
    if (sortierung.value === 'ergebnis') l.sort((a, b) => (b.rueckblick?.gesamt ?? -Infinity) - (a.rueckblick?.gesamt ?? -Infinity))
    if (sortierung.value === 'liq') l.sort((a, b) => (b.start?.liqAbstand ?? -1) - (a.start?.liqAbstand ?? -1))
    if (sortierung.value === 'verlust') l.sort((a, b) => (b.rueckblick?.maxVerlust ?? -Infinity) - (a.rueckblick?.maxVerlust ?? -Infinity))
    return l
})

// ── Zu wenig Grids (Einsatz unter der Mindestmenge) ─────────────────────
const median = (l) => { const a = l.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null }
const mittelGrids = computed(() => median(gueltig.value.map((c) => c.variante.anzahl)))
const zuWenigGrids = computed(() => mittelGrids.value != null && mittelGrids.value < (erg.value?.grids?.wenig ?? 10))
// Nötiger Einsatz für ein echtes Grid, aufgerundet auf zwei Stellen
const aufrunden = (x) => { if (!(x > 0)) return null; const f = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.ceil(x / f) * f }
const noetigerEinsatz = computed(() => aufrunden(median(gueltig.value.map((c) => c.start?.einsatzFuerGrids))))
function einsatzAufNoetig() { eingabe.value.einsatz = String(noetigerEinsatz.value); rechnen() }

// ── Kurzfassung je Richtung ──────────────────────────────────────────────
const besteJeRichtung = computed(() => {
    const reihe = erg.value?.trend ? [erg.value.trend.passend, ...['LONG', 'SHORT', 'NEUTRAL'].filter((r) => r !== erg.value.trend.passend)] : ['LONG', 'SHORT', 'NEUTRAL']
    return reihe.map((r) => {
        const l = gueltig.value.filter((c) => (c.richtung || erg.value?.eingabe?.richtung) === r)
        if (!l.length) return null
        const ohneLiq = l.filter((c) => !c.rueckblick?.liquidation && c.rueckblick?.gesamt != null)
        const beste = ohneLiq.sort((a, b) => b.rueckblick.gesamt - a.rueckblick.gesamt)[0] || null
        const zumTrend = !erg.value?.trend ? null : r === erg.value.trend.passend ? 'passt' : r === 'NEUTRAL' ? 'neutral' : (r === 'LONG' && erg.value.trend.richtung === 'ab') || (r === 'SHORT' && erg.value.trend.richtung === 'auf') ? 'gegen' : 'neutral'
        return { richtung: r, anzahl: l.length, beste, zumTrend }
    }).filter(Boolean)
})
const rueckblickVorn = computed(() => {
    const l = besteJeRichtung.value.filter((x) => x.beste)
    if (l.length < 2) return null
    return l.reduce((a, b) => (b.beste.rueckblick.gesamt > a.beste.rueckblick.gesamt ? b : a)).richtung
})

// ── Mindesteinsatz bei Pionex ────────────────────────────────────────────
// Pionex nennt ihn nicht; der Server grenzt ihn mit Prüfabfragen ein (sendet
// nichts). Eine Variante nach der anderen, die nächste startet beim Wert der
// vorigen, umgerechnet auf ihre Grids.
const mindest = ref({})
let mindestLauf = 0
const variantenEingabe = (v, e, richtung) => ({
    coin: e.coin, coinM: e.coinM, spot: !!e.spot, richtung: richtung || e.richtung, hebel: String(e.hebel), einsatz: String(e.einsatz),
    unten: textZahl(v.unten), oben: textZahl(v.oben), anzahl: String(v.anzahl), art: v.art || 'arithmetic',
})
async function pruefeMindest() {
    const lauf = ++mindestLauf
    mindest.value = {}
    if (!props.steuerung?.schluessel || !erg.value) return
    const e = erg.value.eingabe
    let letzte = null
    for (const c of [...gueltig.value]) {
        if (lauf !== mindestLauf) return
        mindest.value = { ...mindest.value, [c.id]: { laedt: true } }
        const schaetzung = letzte ? Number((letzte.min * c.variante.anzahl / letzte.anzahl).toPrecision(4)) : undefined
        let r = null
        for (let versuch = 0; versuch < 3 && !r; versuch++) {
            try {
                r = (await axios.post('/api/bots/plan/mindesteinsatz', { eingabe: variantenEingabe(c.variante, e, c.richtung), schaetzung }, { timeout: 60_000 })).data
            } catch (err) {
                if (err?.response?.status === 429) { await new Promise((w) => setTimeout(w, 1500)); continue }
                r = { fehler: meldung(err) }
            }
        }
        if (lauf !== mindestLauf) return
        mindest.value = { ...mindest.value, [c.id]: r || { fehler: t('bots.plan.minZuViele') } }
        if (r?.min) letzte = { min: r.min, anzahl: c.variante.anzahl }
    }
}
const mindestFertig = computed(() => gueltig.value.length > 0 && gueltig.value.every((c) => mindest.value[c.id] && !mindest.value[c.id].laedt))
const mindestGeprueft = computed(() => gueltig.value.filter((c) => mindest.value[c.id] && !mindest.value[c.id].laedt).length)
const keineReicht = computed(() => mindestFertig.value && gueltig.value.every((c) => mindest.value[c.id]?.reichtAus === false))
const kleinstesMin = computed(() => {
    const l = gueltig.value.map((c) => mindest.value[c.id]?.min).filter((x) => x > 0)
    return l.length ? Math.min(...l) : null
})
function einsatzAufMin() { eingabe.value.einsatz = String(kleinstesMin.value); rechnen() }

// ── Eigener Plan ─────────────────────────────────────────────────────────
const plan = ref({ unten: '', oben: '', anzahl: '', art: 'arithmetic', stopLoss: '', takeProfit: '', richtung: 'LONG' })
// Richtung des Plans: bei „Alle Richtungen" die der übernommenen Variante (oder selbst gewählt)
const planRichtung = computed(() => (spot.value ? 'LONG' : alle.value ? plan.value.richtung : eingabe.value.richtung))
const eigenErg = ref(null)
const eigenLaedt = ref(false)
const eigenFehler = ref('')
const planKarte = ref(null)
const textZahl = (v, s = 6) => (v == null ? '' : String(Number(Number(v).toPrecision(s))))
function uebernehmen(v, richtung) {
    plan.value = { unten: textZahl(v.unten), oben: textZahl(v.oben), anzahl: String(v.anzahl), art: v.art || 'arithmetic', stopLoss: textZahl(v.stopLoss), takeProfit: textZahl(v.takeProfit), richtung: richtung || plan.value.richtung }
    eigenErg.value = null
    planKarte.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
watch(plan, () => { eigenErg.value = null }, { deep: true })
// Liquidation und Menge je Grid des eigenen Plans hängen auch an Coin, Art, Einsatz und Hebel (Audit UI-08)
watch(() => [eingabe.value.coin, eingabe.value.coinM, eingabe.value.spot, eingabe.value.einsatz, eingabe.value.hebel], () => { eigenErg.value = null })
async function eigenRechnen() {
    eigenLaedt.value = true; eigenFehler.value = ''
    try {
        const d = (await axios.post('/api/bots/plan/rechnen', anfrage({ eigene: [{ ...plan.value, richtung: planRichtung.value }] }), { timeout: 180_000 })).data
        erg.value = d
        // Die Kandidaten sind neu gerechnet (andere IDs möglich): die Pionex-Prüfung der alten gilt nicht mehr (Audit PLN-02)
        pruefeMindest()
        const e = d.eigene?.[0]
        if (e?.fehler) eigenFehler.value = te(`bots.plan.fehler.${e.fehler}`) ? t(`bots.plan.fehler.${e.fehler}`) : t(`bots.st.fehler.${e.fehler}`)
        else eigenErg.value = e || null
    } catch (e) { eigenFehler.value = meldung(e) } finally { eigenLaedt.value = false }
}
const planVollstaendig = computed(() => plan.value.unten !== '' && plan.value.oben !== '' && plan.value.anzahl !== '')

// ── Starten ──────────────────────────────────────────────────────────────
const steuerungAktiv = computed(() => !!(props.steuerung?.schluessel && props.steuerung?.freigeschaltet))
const dialogOffen = ref(false)
const planBot = computed(() => ({
    id: 'plan', plan: true, richtung: planRichtung.value, coin: String(eingabe.value.coin || '').toUpperCase(), coinM: eingabe.value.coinM && !spot.value,
    marginCoin: einheit.value, typ: spot.value ? 'spot_grid' : eingabe.value.coinM ? 'coinm_grid' : 'futures_grid',
    grid: { unten: Number(plan.value.unten), oben: Number(plan.value.oben), anzahl: Number(plan.value.anzahl) },
    hebel: spot.value ? 1 : Number(eingabe.value.hebel), einsatz: { basis: Number(eingabe.value.einsatz) }, stops: {},
}))
const vorgabe = computed(() => ({ unten: plan.value.unten, oben: plan.value.oben, anzahl: plan.value.anzahl, hebel: eingabe.value.hebel, einsatz: eingabe.value.einsatz }))
const feste = computed(() => ({ coin: planBot.value.coin, coinM: eingabe.value.coinM && !spot.value, spot: spot.value, richtung: planRichtung.value, art: plan.value.art, ...(spot.value ? { hebel: '1' } : {}) }))

// ── KI ───────────────────────────────────────────────────────────────────
const ki = ref(null)
const kiLaedt = ref(false)
const kiFehler = ref('')
async function kiErzeugen() {
    kiLaedt.value = true; kiFehler.value = ''
    try {
        // Die schon geprüften Mindesteinsätze gehen mit, damit die KI sie nennen kann
        const geprueft = Object.fromEntries(Object.entries(mindest.value).filter(([, m]) => m && !m.laedt && !m.fehler).map(([id, m]) => [id, { min: m.min ?? null, reichtAus: m.reichtAus ?? null }]))
        ki.value = (await axios.post('/api/bots/plan/ki', anfrage({ sprache: locale.value, mindest: geprueft }), { timeout: 180_000 })).data?.ergebnis || null
    } catch (e) {
        // Ohne Antwort (Zeitlimit) kann der Server fertig geworden sein
        if (!e?.response) { try { ki.value = (await axios.get('/api/bots/plan/ki')).data?.ergebnis || null } catch { /* bleibt */ } }
        if (e?.response || !ki.value) kiFehler.value = meldung(e)
    } finally { kiLaedt.value = false }
}
const kiPasst = computed(() => {
    const k = ki.value?.eingabe, e = anfrage()
    return !!k && k.coin === e.coin && k.coinM === e.coinM && !!k.spot === !!e.spot && k.richtung === e.richtung && Number(k.einsatz) === Number(e.einsatz) && Number(k.hebel) === Number(e.hebel) && Number(k.tage) === e.tage
})
// Gibt es die Coin in der gewählten Art nicht bei Pionex, gar nicht erst rechnen (sonst „Invalid symbol")
const artGeht = computed(() => !coins.value.length || !!(coinInfo.value && { linear: coinInfo.value.linear, coinM: coinInfo.value.coinM, spot: coinInfo.value.spot }[artWahl.value]))
const eingabeOk = computed(() => !!String(eingabe.value.coin || '').trim() && Number(eingabe.value.einsatz) > 0 && (spot.value || Number(eingabe.value.hebel) >= 1) && artGeht.value)
</script>

<template>
    <div class="planer">
        <Karte :titel="t('bots.plan.titel')">
            <p class="leise">{{ t('bots.plan.erklaerung') }}</p>
            <div class="felder">
                <label><span>{{ t('bots.plan.coin') }}</span>
                    <input v-model="eingabe.coin" class="at-feld" list="planCoins" autocomplete="off" spellcheck="false">
                    <datalist id="planCoins"><option v-for="c in coins" :key="c.coin" :value="c.coin" /></datalist>
                </label>
                <label><span>{{ t('bots.plan.art') }}</span>
                    <select v-model="artWahl" class="at-feld">
                        <option value="linear" :disabled="coinInfo && !coinInfo.linear">{{ t('bots.plan.linear') }}</option>
                        <option value="coinM" :disabled="coinInfo && !coinInfo.coinM">{{ t('bots.plan.coinM') }}</option>
                        <option value="spot" :disabled="coinInfo && !coinInfo.spot">{{ t('bots.plan.spot') }}</option>
                    </select>
                </label>
                <label><span>{{ t('bots.plan.richtung') }}</span>
                    <select v-if="spot" class="at-feld" disabled><option>{{ t('bots.richtung.LONG') }}</option></select>
                    <select v-else v-model="eingabe.richtung" class="at-feld">
                        <option value="ALLE">{{ t('bots.plan.alleRichtungen') }}</option>
                        <option value="LONG">{{ t('bots.richtung.LONG') }}</option>
                        <option value="SHORT">{{ t('bots.richtung.SHORT') }}</option>
                        <option value="NEUTRAL">{{ t('bots.richtung.NEUTRAL') }}</option>
                    </select>
                </label>
                <div class="feldMitMax">
                    <span class="mitMax"><label for="planEinsatz">{{ t('bots.feld.einsatz') }} ({{ einheit }})</label>
                        <button type="button" class="max" :disabled="maxLaedt" :title="t('bots.plan.maxTitel', { einheit })" @click="setzeMax">{{ t('bots.plan.max') }}</button></span>
                    <input id="planEinsatz" v-model="eingabe.einsatz" class="at-feld" inputmode="decimal">
                    <small v-if="maxHinweis" class="maxHinweis" :class="{ warn: maxHinweis.warn }">{{ maxHinweis.text }}</small>
                </div>
                <label><span>{{ t('bots.feld.hebel') }}</span><input v-if="spot" class="at-feld" value="1" disabled><input v-else v-model="eingabe.hebel" class="at-feld" inputmode="numeric"></label>
                <label><span>{{ t('bots.plan.zeitraum') }}</span>
                    <select v-model.number="eingabe.tage" class="at-feld">
                        <option v-for="n in [30, 60, 90]" :key="n" :value="n">{{ t('bots.plan.tage', { n }) }}</option>
                    </select>
                </label>
            </div>
            <p v-if="coins.length && eingabe.coin && !coinInfo" class="warn">{{ t('bots.plan.coinUnbekannt') }}</p>
            <p v-else-if="coinInfo && coinInfo.spot && !coinInfo.linear && !coinInfo.coinM" class="leise">{{ t('bots.plan.nurSpot') }}</p>
            <p v-if="spot" class="leise">{{ t('bots.plan.spotHinweis') }}</p>
            <div class="knoepfe">
                <Knopf art="haupt" symbol="rechner" :laedt="laedt" :disabled="!eingabeOk" @click="rechnen">{{ t('bots.plan.rechnen') }}</Knopf>
            </div>
            <p v-if="laedt" class="leise laedt">{{ t('bots.plan.laedt') }}</p>
            <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        </Karte>

        <Karte v-if="erg" :titel="t('bots.plan.lageTitel', { coin: erg.eingabe.coin })">
            <dl class="zahlen">
                <div><dt>{{ t('bots.feld.kurs') }}</dt><dd>{{ preis(erg.kurs) }}</dd></div>
                <div><dt>{{ t('bots.feld.atrTag') }}</dt><dd>{{ preis(erg.markt?.atr) }} <span class="leise">({{ prozent(erg.markt?.atr && erg.kurs ? erg.markt.atr / erg.kurs : null) }})</span></dd></div>
                <div><dt>{{ t('bots.plan.tage7') }}</dt><dd :class="tonProzent(erg.markt?.aenderung7)">{{ prozent(erg.markt?.aenderung7, { vorzeichen: true }) }}</dd></div>
                <div><dt>{{ t('bots.plan.tage30') }}</dt><dd :class="tonProzent(erg.markt?.aenderung30)">{{ prozent(erg.markt?.aenderung30, { vorzeichen: true }) }}</dd></div>
                <div><dt>{{ t('bots.plan.spanne30') }}</dt><dd>{{ preis(erg.markt?.tief30) }} – {{ preis(erg.markt?.hoch30) }}</dd></div>
            </dl>
            <div class="trend">
                <h4>{{ t('bots.plan.trendTitel') }}</h4>
                <template v-if="erg.trend">
                    <p class="trendKopf">
                        <strong :class="erg.trend.richtung === 'auf' ? 'gut' : erg.trend.richtung === 'ab' ? 'schlecht' : ''">{{ t(`bots.plan.trend.${erg.trend.richtung}`) }}</strong>
                        <span class="leise">{{ t('bots.plan.trendPunkte', { p: erg.trend.punkte, max: erg.trend.max }) }} · {{ t('bots.plan.trendPasst', { r: t(`bots.richtung.${erg.trend.passend}`) }) }}</span>
                    </p>
                    <ul class="trendZeichen">
                        <li v-for="z in erg.trend.zeichen" :key="z.id">
                            <span>{{ t(`bots.plan.trendZeichen.${z.id}`) }}</span>
                            <span :class="z.wert > 0 ? 'gut' : z.wert < 0 ? 'schlecht' : 'leise'">{{ t(`bots.plan.trendWert.${z.wert > 0 ? 'auf' : z.wert < 0 ? 'ab' : 'offen'}`) }}<template v-if="z.sma200"> · {{ preis(z.sma200) }}</template></span>
                        </li>
                    </ul>
                    <p class="leise">{{ t('bots.plan.trendErklaerung') }}</p>
                </template>
                <p v-else class="leise">{{ t('bots.plan.trendUnbekannt') }}</p>
            </div>
            <div v-if="erg.hohe" class="tabelleRahmen">
                <table class="tabelle">
                    <thead><tr><th></th><th>{{ t('chart.ki.spalteStruktur') }}</th><th>{{ t('bots.ki.zrBruch') }}</th><th>{{ t('chart.ki.spalteLage') }}</th><th>{{ t('chart.ki.spalteMomentum') }}</th></tr></thead>
                    <tbody>
                        <tr v-for="z in erg.hohe.tabelle" :key="z.tf">
                            <th>{{ z.tf }}</th>
                            <template v-if="z.unbekannt"><td colspan="4" class="leise">{{ t('chart.ki.unbekannt') }}</td></template>
                            <template v-else>
                                <td :class="z.zustand === 1 ? 'gut' : z.zustand === -1 ? 'schlecht' : ''">{{ t('chart.ki.richtung.' + (z.zustand === 1 ? 'auf' : z.zustand === -1 ? 'ab' : 'offen')) }}</td>
                                <td>{{ z.bruchRichtung ? `${z.bruchRichtung === 'auf' ? '↑' : '↓'} ${preis(z.bruchMarke)}` : '—' }}</td>
                                <td>{{ z.lagePct == null ? '—' : z.lagePct.toFixed(0) + ' %' }}</td>
                                <td>{{ z.momentum ? t('chart.ki.momentum.' + z.momentum) : '—' }}</td>
                            </template>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="erg.hohe?.marken?.length" class="leise niveaus">
                {{ t('bots.ki.zrNiveaus') }}:
                <span v-for="m in erg.hohe.marken" :key="m.id" :class="{ treffen: erg.hohe.treffen.some((c) => c.ids.includes(m.id)) }">{{ m.id }} {{ m.tf }} {{ preis(m.preis) }}</span>
            </p>
            <div v-if="erg.chart" class="trend">
                <h4>{{ t('bots.plan.chartNiveaus') }}</h4>
                <ul v-if="erg.chart.length" class="trendZeichen">
                    <li v-for="n in [...erg.chart].sort((x, y) => y.preis - x.preis)" :key="n.id">
                        <span :class="{ eigen: n.quelle === 'zeichnung' }">{{ n.id }} · {{ n.name }}</span>
                        <span :class="n.preis < erg.kurs ? 'gut' : 'schlecht'">{{ preis(n.preis) }}</span>
                    </li>
                </ul>
                <p class="leise">{{ erg.chart.length ? t('bots.plan.chartErklaerung') : t('bots.plan.chartKeine') }}</p>
            </div>
        </Karte>

        <Karte v-if="erg && gueltig.length" :titel="t('bots.plan.kurzTitel')">
            <Hinweis v-if="zuWenigGrids" art="warn" :titel="t('bots.plan.wenigTitel')">
                <p class="grund">{{ t('bots.plan.wenigText', { n: mittelGrids }) }}<template v-if="noetigerEinsatz"> {{ t('bots.plan.wenigNoetig', { g: erg.grids?.sinnvoll ?? 20, betrag: betrag(noetigerEinsatz, erg.einheit) }) }}</template></p>
                <Knopf v-if="noetigerEinsatz" art="normal" klein @click="einsatzAufNoetig">{{ t('bots.plan.wenigSetzen', { betrag: betrag(noetigerEinsatz, erg.einheit) }) }}</Knopf>
            </Hinweis>
            <p class="kurzTrend">
                <template v-if="erg.trend">{{ t('bots.plan.kurzTrend', { trend: t(`bots.plan.trend.${erg.trend.richtung}`), r: t(`bots.richtung.${erg.trend.passend}`) }) }}</template>
                <template v-else>{{ t('bots.plan.kurzOhneTrend') }}</template>
            </p>
            <div class="tabelleRahmen" :class="{ blass: zuWenigGrids }">
                <table class="tabelle">
                    <thead><tr>
                        <th>{{ t('bots.plan.spalteRichtung') }}</th><th>{{ t('bots.plan.kurzVarianten') }}</th><th class="links">{{ t('bots.plan.kurzBestes') }}</th>
                        <th>{{ t('bots.plan.rueckblick') }}</th><th>{{ t('bots.sim.maxVerlust') }}</th><th>{{ t('bots.plan.liqStart') }}</th><th v-if="erg.trend">{{ t('bots.plan.kurzTrendSpalte') }}</th><th></th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="z in besteJeRichtung" :key="z.richtung">
                            <th class="richtung" :class="z.richtung">{{ t(`bots.richtung.${z.richtung}`) }}</th>
                            <td>{{ z.anzahl }}</td>
                            <template v-if="z.beste">
                                <td class="text">{{ z.beste.id }} · {{ z.beste.titel }}</td>
                                <td :class="ton(z.beste.rueckblick.gesamt, erg.einheit)">{{ betrag(z.beste.rueckblick.gesamt, erg.einheit, { vorzeichen: true }) }} <span class="leise">{{ prozent(ergebnisPct(z.beste), { vorzeichen: true }) }}</span></td>
                                <td :class="ton(z.beste.rueckblick.maxVerlust, erg.einheit)">{{ betrag(z.beste.rueckblick.maxVerlust, erg.einheit) }}</td>
                                <td>{{ prozent(z.beste.start?.liqAbstand, { stellen: 0 }) }}</td>
                            </template>
                            <td v-else colspan="4" class="leise text">{{ t('bots.plan.kurzKeine') }}</td>
                            <td v-if="erg.trend" :class="{ gut: z.zumTrend === 'passt', warnText: z.zumTrend === 'gegen' }">{{ t(`bots.plan.kurz${z.zumTrend === 'passt' ? 'Passt' : z.zumTrend === 'gegen' ? 'Gegen' : 'Neutral'}`) }}</td>
                            <td><Knopf v-if="z.beste" art="leise" klein @click="uebernehmen(z.beste.variante, z.beste.richtung || erg.eingabe.richtung)">{{ t('bots.plan.uebernehmen') }}</Knopf></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="erg.trend && rueckblickVorn && rueckblickVorn !== erg.trend.passend" class="spannung">{{ t('bots.plan.kurzSpannung', { a: t(`bots.richtung.${rueckblickVorn}`), b: t(`bots.richtung.${erg.trend.passend}`), tage: erg.eingabe.tage }) }}</p>
            <p v-else-if="erg.trend && rueckblickVorn" class="leise">{{ t('bots.plan.kurzEinig', { r: t(`bots.richtung.${rueckblickVorn}`) }) }}</p>
            <p class="leise">{{ t('bots.plan.kurzHinweis') }}</p>
        </Karte>

        <Karte v-if="erg" :titel="t('bots.plan.kandidatenTitel', { n: gueltig.length })">
            <p class="leise">{{ t('bots.plan.kandidatenText', { tage: erg.eingabe.tage, tf: erg.zeitrahmen || '—', von: datum(erg.von) }) }}
                {{ erg.fundingSimuliert ? t('bots.sim.mitFunding') : t('bots.sim.ohneFunding') }}</p>
            <p v-if="erg.kerzenQuelle === 'pionex'" class="leise">{{ t('bots.plan.kerzenPionex') }}</p>
            <div class="sortierung">
                <span class="leise">{{ t('bots.plan.sortieren') }}:</span>
                <button v-for="s in ['id', 'ergebnis', 'verlust', 'liq']" :key="s" type="button" class="chip" :class="{ an: sortierung === s }" @click="sortierung = s">{{ t(`bots.plan.sort.${s}`) }}</button>
            </div>
            <div v-if="imErgAlle" class="sortierung">
                <span class="leise">{{ t('bots.plan.spalteRichtung') }}:</span>
                <button v-for="r in ['', 'LONG', 'SHORT', 'NEUTRAL']" :key="r" type="button" class="chip" :class="{ an: richtungFilter === r }" @click="richtungFilter = r">{{ r ? t(`bots.richtung.${r}`) : t('bots.plan.filterAlle') }}</button>
            </div>
            <p v-if="steuerung?.schluessel && gueltig.length && !mindestFertig" class="leise laedt">{{ t('bots.plan.minLaeuft', { n: mindestGeprueft, von: gueltig.length }) }}</p>
            <p v-else-if="!steuerung?.schluessel" class="leise">{{ t('bots.plan.minOhneSchluessel') }}</p>
            <Hinweis v-if="keineReicht" art="warn" :titel="t('bots.plan.minKeineTitel')">
                <p class="grund">{{ kleinstesMin ? t('bots.plan.minKeine', { betrag: betrag(kleinstesMin, erg.einheit) }) : t('bots.plan.minKeineOhne') }}</p>
                <Knopf v-if="kleinstesMin" art="normal" klein @click="einsatzAufMin">{{ t('bots.plan.minSetzen', { betrag: betrag(kleinstesMin, erg.einheit) }) }}</Knopf>
            </Hinweis>
            <div class="tabelleRahmen" :class="{ blass: zuWenigGrids }">
                <table class="tabelle">
                    <thead><tr>
                        <th>ID</th><th v-if="imErgAlle">{{ t('bots.plan.spalteRichtung') }}</th><th>{{ t('bots.plan.beschreibung') }}</th><th>{{ t('bots.feld.band') }}</th><th>{{ t('bots.feld.grids') }}</th><th>{{ t('bots.feld.nettoZyklus') }}</th>
                        <th>{{ t('bots.plan.rueckblick') }}</th><th>{{ t('bots.sim.maxVerlust') }}</th><th>{{ t('bots.sim.ende') }}</th><th>{{ t('bots.feld.zeitImBand') }}</th>
                        <th>{{ t('bots.plan.liqStart') }}</th><th :title="t('bots.plan.randTitel')">{{ t('bots.plan.randSpalte') }}</th><th v-if="steuerung?.schluessel">{{ t('bots.plan.minSpalte') }}</th><th></th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="c in sortiert" :key="c.id" :class="{ gewaehlt: kiPasst && ki.vorschlaege.some((v) => v.id === c.id) }">
                            <th>{{ c.id }}</th>
                            <td v-if="imErgAlle" class="richtung" :class="c.richtung">{{ t(`bots.richtung.${c.richtung}`) }}</td>
                            <td class="text">{{ c.titel }}<span v-for="w in c.warnungen" :key="w" class="warnmarke" :title="t(`bots.plan.warn.${w}`)"> ⚠</span></td>
                            <td>{{ preis(c.variante.unten) }} – {{ preis(c.variante.oben) }}</td>
                            <td>{{ zahl(c.variante.anzahl) }}</td>
                            <td>{{ prozent(c.start?.nettoJeZyklus, { stellen: 2 }) }}</td>
                            <td :class="ton(c.rueckblick?.gesamt, erg.einheit)">{{ betrag(c.rueckblick?.gesamt, erg.einheit, { vorzeichen: true }) }} <span class="leise">{{ prozent(ergebnisPct(c), { vorzeichen: true }) }}</span></td>
                            <td :class="ton(c.rueckblick?.maxVerlust, erg.einheit)">{{ betrag(c.rueckblick?.maxVerlust, erg.einheit) }}</td>
                            <td :class="{ schlecht: c.rueckblick?.liquidation }">{{ ende(c.rueckblick) }}</td>
                            <td>{{ prozent(c.rueckblick?.zeitImBand, { stellen: 0 }) }}</td>
                            <td>{{ preis(c.start?.liq) }} <span class="leise">{{ prozent(c.start?.liqAbstand, { stellen: 0 }) }}</span></td>
                            <td :class="c.start?.verlustRand?.liquidiert ? 'schlecht' : ton(c.start?.verlustRand?.betrag, erg.einheit)" :title="c.start?.verlustRand ? t('bots.plan.randZeile', { preis: preis(c.start.verlustRand.preis) }) : ''">
                                <template v-if="c.start?.verlustRand">{{ betrag(c.start.verlustRand.betrag, erg.einheit, { vorzeichen: true }) }} <span class="leise">{{ c.start.verlustRand.liquidiert ? t('bots.sim.liquidiert') : '@ ' + preis(c.start.verlustRand.preis) }}</span></template>
                                <span v-else class="leise">—</span>
                            </td>
                            <td v-if="steuerung?.schluessel" class="min" :title="mindest[c.id]?.fehler || mindest[c.id]?.text || ''">
                                <span v-if="mindest[c.id]?.laedt" class="leise">…</span>
                                <span v-else-if="mindest[c.id]?.reichtAus === true" class="gut">✓</span>
                                <span v-else-if="mindest[c.id]?.reichtAus === false" class="schlecht">{{ mindest[c.id].min ? t('bots.plan.minAb', { betrag: betrag(mindest[c.id].min, erg.einheit) }) : t('bots.plan.minZuKlein') }}</span>
                                <span v-else class="leise">—</span>
                                <!-- der Grund stand nur im title und war per Touch nicht erreichbar (Audit UI-16) -->
                                <span v-if="mindest[c.id]?.fehler" class="minFehler">{{ t('bots.plan.minFehler', { grund: mindest[c.id].fehler }) }}</span>
                            </td>
                            <td><Knopf art="leise" klein @click="uebernehmen(c.variante, c.richtung)">{{ t('bots.plan.uebernehmen') }}</Knopf></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <ul v-if="sortiert.some((c) => c.warnungen?.length)" class="legende">
                <li v-for="w in [...new Set(sortiert.flatMap((c) => c.warnungen || []))]" :key="w">⚠ {{ t(`bots.plan.warn.${w}`) }}</li>
            </ul>
            <p class="leise">{{ t('bots.plan.rueckblickHinweis') }}</p>
        </Karte>

        <Karte v-if="erg" :titel="t('bots.ki.titelPlan')">
            <div class="ki" data-ki-generiert="true">
                <Hinweis art="warn" :titel="t('bots.ki.warnTitel')">
                    <ul class="warnliste">
                        <li>{{ t('bots.ki.warn1') }}</li>
                        <li>{{ t('bots.ki.warn2') }}</li>
                        <li>{{ t('bots.ki.warn3') }}</li>
                        <li>{{ t('bots.ki.warn4') }}</li>
                    </ul>
                    <p class="warnfuss">{{ t('bots.ki.warnFuss') }}</p>
                </Hinweis>
                <p class="leise">{{ t('bots.plan.kiErklaerung') }}</p>
                <div class="knoepfe">
                    <span v-if="ki && kiPasst" class="leise">{{ t('bots.ki.stand', { zeit: datum(ki.zeit), modell: ki.modell || ki.anbieter }) }}</span>
                    <Knopf art="haupt" symbol="ki" :laedt="kiLaedt" @click="kiErzeugen">{{ ki && kiPasst ? t('bots.ki.neu') : t('bots.ki.erzeugen') }}</Knopf>
                </div>
                <p v-if="kiLaedt" class="leise laedt">{{ t('bots.ki.laedt') }}</p>
                <Hinweis v-if="kiFehler" art="fehler">{{ kiFehler }}</Hinweis>
                <template v-if="ki && kiPasst">
                    <div class="kopf">
                        <Pille ton="akzent" symbol="ki">{{ t('bots.ki.kennzeichnung') }}</Pille>
                        <span class="leise">{{ t('bots.ki.kursStand', { kurs: preis(ki.kurs) }) }}</span>
                    </div>
                    <p v-if="ki.lage" class="lage">{{ ki.lage }}</p>
                    <p v-if="ki.lageUnbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: ki.lageUnbelegt.join(', ') }) }}</p>
                    <p v-if="!ki.vorschlaege.length" class="leise">{{ t('bots.ki.keine') }}</p>
                    <article v-for="(v, i) in ki.vorschlaege" :key="v.id" class="vorschlag">
                        <header>
                            <span class="nr">{{ t('bots.ki.vorschlag') }} {{ i + 1 }} · {{ v.id }}<template v-if="v.richtung"> · <span class="richtung" :class="v.richtung">{{ t(`bots.richtung.${v.richtung}`) }}</span></template></span>
                            <h4>{{ v.titel }}</h4>
                            <span class="code">{{ v.codeTitel }}</span>
                        </header>
                        <dl class="zahlen">
                            <div><dt>{{ t('bots.feld.band') }}</dt><dd>{{ preis(v.variante.unten) }} – {{ preis(v.variante.oben) }}</dd></div>
                            <div><dt>{{ t('bots.feld.grids') }}</dt><dd>{{ zahl(v.variante.anzahl) }}</dd></div>
                            <div v-if="v.variante.stopLoss"><dt>{{ t('bots.feld.stopLoss') }}</dt><dd>{{ preis(v.variante.stopLoss) }}</dd></div>
                            <div><dt>{{ t('bots.plan.liqStart') }}</dt><dd>{{ preis(v.start?.liq) }} <span class="leise">({{ prozent(v.start?.liqAbstand) }})</span></dd></div>
                            <div v-if="steuerung?.schluessel"><dt>{{ t('bots.plan.minKarte') }}</dt>
                                <dd v-if="mindest[v.id]?.laedt" class="leise">{{ t('bots.plan.minPruefe') }}</dd>
                                <dd v-else-if="mindest[v.id]?.reichtAus === true" class="gut">✓ {{ t('bots.plan.minReicht', { betrag: betrag(Number(erg.eingabe.einsatz), erg.einheit) }) }}</dd>
                                <dd v-else-if="mindest[v.id]?.min" class="schlecht">{{ t('bots.plan.minAb', { betrag: betrag(mindest[v.id].min, erg.einheit) }) }}</dd>
                                <dd v-else class="leise">—</dd>
                            </div>
                            <div v-if="v.start?.verlustRand"><dt>{{ t('bots.plan.randSpalte') }}</dt><dd :class="ton(v.start.verlustRand.betrag, erg.einheit)">{{ betrag(v.start.verlustRand.betrag, erg.einheit, { vorzeichen: true }) }} <span class="leise">@ {{ preis(v.start.verlustRand.preis) }}</span></dd></div>
                            <div><dt>{{ t('bots.plan.rueckblick') }}</dt><dd :class="ton(v.rueckblick?.gesamt, erg.einheit)">{{ betrag(v.rueckblick?.gesamt, erg.einheit, { vorzeichen: true }) }}</dd></div>
                        </dl>
                        <p>{{ v.begruendung }}</p>
                        <p class="risiko"><strong>{{ t('bots.ki.risiko') }}:</strong> {{ v.risiko }}</p>
                        <p class="risiko"><strong>{{ t('bots.ki.passtNicht') }}:</strong> {{ v.passtNichtWenn }}</p>
                        <p v-if="v.unbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: v.unbelegt.join(', ') }) }}</p>
                        <div class="knoepfe">
                            <Knopf v-if="mindest[v.id]?.min && mindest[v.id]?.reichtAus === false" art="leise" klein @click="eingabe.einsatz = String(mindest[v.id].min); rechnen()">{{ t('bots.plan.minSetzen', { betrag: betrag(mindest[v.id].min, erg.einheit) }) }}</Knopf>
                            <Knopf art="leise" symbol="rechner" klein @click="uebernehmen(v.variante, v.richtung)">{{ t('bots.plan.uebernehmen') }}</Knopf>
                        </div>
                    </article>
                    <p v-if="ki.hinweis" class="leise">{{ ki.hinweis }}</p>
                </template>
            </div>
        </Karte>

        <Karte ref="planKarte" :titel="t('bots.plan.eigenTitel')">
            <p class="leise">{{ t('bots.plan.eigenText') }}</p>
            <div class="felder">
                <label v-if="alle && !spot"><span>{{ t('bots.plan.planRichtung') }}</span>
                    <select v-model="plan.richtung" class="at-feld">
                        <option value="LONG">{{ t('bots.richtung.LONG') }}</option>
                        <option value="SHORT">{{ t('bots.richtung.SHORT') }}</option>
                        <option value="NEUTRAL">{{ t('bots.richtung.NEUTRAL') }}</option>
                    </select>
                </label>
                <label><span>{{ t('bots.sim.unten') }}</span><input v-model="plan.unten" class="at-feld" inputmode="decimal"></label>
                <label><span>{{ t('bots.sim.oben') }}</span><input v-model="plan.oben" class="at-feld" inputmode="decimal"></label>
                <label><span>{{ t('bots.feld.grids') }}</span><input v-model="plan.anzahl" class="at-feld" inputmode="numeric"></label>
                <label><span>{{ t('bots.feld.art') }}</span>
                    <select v-model="plan.art" class="at-feld">
                        <option value="arithmetic">{{ t('bots.sim.arithmetisch') }}</option>
                        <option value="geometric">{{ t('bots.sim.geometrisch') }}</option>
                    </select>
                </label>
                <label v-if="planRichtung !== 'NEUTRAL' && !spot"><span>{{ t('bots.feld.stopLoss') }}</span><input v-model="plan.stopLoss" class="at-feld" inputmode="decimal" :placeholder="t('bots.feld.keiner')"></label>
                <label v-if="planRichtung !== 'NEUTRAL' && !spot"><span>{{ t('bots.feld.takeProfit') }}</span><input v-model="plan.takeProfit" class="at-feld" inputmode="decimal" :placeholder="t('bots.feld.keiner')"></label>
            </div>
            <div class="knoepfe">
                <Knopf art="normal" symbol="rechner" :laedt="eigenLaedt" :disabled="!planVollstaendig || !eingabeOk" @click="eigenRechnen">{{ t('bots.plan.eigenRechnen') }}</Knopf>
                <Knopf v-if="steuerungAktiv" art="haupt" symbol="hochladen" :disabled="!planVollstaendig || !eingabeOk" @click="dialogOffen = true">{{ t('bots.plan.starten') }}</Knopf>
            </div>
            <p v-if="!steuerungAktiv" class="leise">{{ t('bots.plan.ohneSteuerung') }}</p>
            <p v-else-if="plan.stopLoss || plan.takeProfit" class="warn">{{ t('bots.plan.stopsNachStart') }}</p>
            <Hinweis v-if="eigenFehler" art="fehler">{{ eigenFehler }}</Hinweis>
            <dl v-if="eigenErg" class="zahlen">
                <div><dt>{{ t('bots.feld.grids') }}</dt><dd>{{ zahl(eigenErg.variante.anzahl) }}</dd></div>
                <div><dt>{{ t('bots.feld.nettoZyklus') }}</dt><dd>{{ prozent(eigenErg.start?.nettoJeZyklus, { stellen: 2 }) }}</dd></div>
                <div><dt>{{ t('bots.feld.mengeJeGrid') }}</dt><dd>{{ zahl(eigenErg.start?.menge, 4) }}</dd></div>
                <div><dt>{{ t('bots.plan.startPosition') }}</dt><dd>{{ zahl(eigenErg.start?.nominalUsd, 0) }} USD</dd></div>
                <div><dt>{{ t('bots.plan.liqStart') }}</dt><dd>{{ preis(eigenErg.start?.liq) }} <span class="leise">({{ prozent(eigenErg.start?.liqAbstand) }})</span></dd></div>
                <div><dt>{{ t('bots.plan.rueckblick') }}</dt><dd :class="ton(eigenErg.rueckblick?.gesamt, erg?.einheit || einheit)">{{ betrag(eigenErg.rueckblick?.gesamt, erg?.einheit || einheit, { vorzeichen: true }) }} <span class="leise">{{ prozent(ergebnisPct(eigenErg), { vorzeichen: true }) }}</span></dd></div>
                <div><dt>{{ t('bots.sim.maxVerlust') }}</dt><dd :class="ton(eigenErg.rueckblick?.maxVerlust, erg?.einheit || einheit)">{{ betrag(eigenErg.rueckblick?.maxVerlust, erg?.einheit || einheit) }}</dd></div>
                <div><dt>{{ t('bots.sim.ende') }}</dt><dd>{{ ende(eigenErg.rueckblick) }}</dd></div>
                <div><dt>{{ t('bots.feld.zeitImBand') }}</dt><dd>{{ prozent(eigenErg.rueckblick?.zeitImBand, { stellen: 0 }) }}</dd></div>
                <div><dt>{{ t('bots.feld.zyklen') }}</dt><dd>{{ zahl(eigenErg.rueckblick?.zyklen) }}</dd></div>
            </dl>
            <ul v-if="eigenErg?.warnungen?.length" class="legende">
                <li v-for="w in eigenErg.warnungen" :key="w">⚠ {{ t(`bots.plan.warn.${w}`) }}</li>
            </ul>
        </Karte>

        <BotAktionDialog v-if="steuerungAktiv" v-model="dialogOffen" :bot="planBot" aktion="starten" :vorgabe="vorgabe" :feste="feste" :steuerung="steuerung" @gesendet="emit('gestartet')" />
    </div>
</template>

<style scoped>
.planer { display: flex; flex-direction: column; gap: var(--abstand-3); min-width: 0; }
.planer > * { min-width: 0; max-width: 100%; }
.leise { color: var(--muted); font-size: 0.8rem; margin: 0; }
.warn { color: var(--warn); font-size: 0.85rem; margin: 0; }
.laedt { text-align: right; color: var(--accent); }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--abstand-2) var(--abstand-3); margin: var(--abstand-2) 0; }
.felder label, .felder .feldMitMax { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); min-width: 0; }
.felder .feldMitMax label { display: inline; }
.felder .at-feld::placeholder { color: var(--leise); font-style: italic; opacity: 1; }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.zahlen { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--abstand-2) var(--abstand-3); margin: var(--abstand-2) 0; }
.zahlen dt { color: var(--muted); font-size: 0.75rem; }
.zahlen dd { margin: 0; font-variant-numeric: tabular-nums; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.niveaus { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: var(--abstand-2); }
.niveaus .treffen { color: var(--accent); }
.sortierung { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: var(--abstand-2) 0; }
.chip { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 2px 10px; font-size: 0.78rem; cursor: pointer; }
.chip.an { border-color: var(--accent); color: var(--accent); }
.tabelleRahmen { overflow-x: auto; max-width: 100%; }
.tabelle { width: 100%; border-collapse: collapse; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.tabelle th, .tabelle td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.tabelle th:first-child, .tabelle td.text { text-align: left; }
.tabelle td.text { white-space: normal; min-width: 14rem; }
.tabelle thead th { color: var(--muted); font-weight: 500; }
.tabelle tr.gewaehlt { background: var(--accent-flaeche); }
.warnmarke { color: var(--warn); cursor: help; }
.legende { margin: var(--abstand-2) 0 0; padding: 0; list-style: none; color: var(--warn); font-size: 0.8rem; display: flex; flex-direction: column; gap: 2px; }
.ki { display: flex; flex-direction: column; gap: var(--abstand-3); min-width: 0; }
.warnliste { margin: 0; padding-left: 1.1em; }
.warnfuss { margin: var(--abstand-1) 0 0; }
.kopf { display: flex; gap: var(--abstand-2); align-items: center; flex-wrap: wrap; }
.lage { margin: 0; line-height: 1.5; }
.unbelegt { color: var(--warn); font-size: 0.82rem; margin: 0; }
.vorschlag { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--radius); padding: var(--abstand-3); display: flex; flex-direction: column; gap: var(--abstand-2); }
.vorschlag header { display: flex; flex-direction: column; gap: 2px; }
.vorschlag .nr { color: var(--muted); font-size: 0.75rem; font-weight: 600; }
.vorschlag h4 { margin: 0; font-size: 1rem; }
.vorschlag .code { color: var(--muted); font-size: 0.8rem; }
.vorschlag p { margin: 0; font-size: 0.9rem; line-height: 1.5; }
.risiko { color: var(--muted); }
.min { white-space: nowrap; }
.minFehler { display: block; color: var(--warn); font-size: 0.72rem; white-space: normal; max-width: 12rem; }
.blass { opacity: 0.5; }
.kurzTrend { margin: 0 0 var(--abstand-2); font-weight: 600; }
.spannung { margin: var(--abstand-2) 0 0; color: var(--warn); font-size: 0.88rem; line-height: 1.5; }
.warnText { color: var(--warn); }
.eigen { color: var(--accent); }
.tabelle th.links { text-align: left; }
.trend { margin-top: var(--abstand-3); display: flex; flex-direction: column; gap: var(--abstand-1); }
.trend h4 { margin: 0; font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.trendKopf { margin: 0; display: flex; gap: var(--abstand-2); align-items: baseline; flex-wrap: wrap; }
.trendKopf strong { font-size: 1.05rem; }
.trendZeichen { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2px var(--abstand-3); font-size: 0.82rem; }
.trendZeichen li { display: flex; justify-content: space-between; gap: var(--abstand-2); border-bottom: 1px dashed var(--line); padding: 2px 0; }
.richtung.LONG { color: var(--good); }
.richtung.SHORT { color: var(--bad); }
.richtung.NEUTRAL { color: var(--muted); }
td.richtung { text-align: left; }
.grund { margin: 0 0 var(--abstand-2); }
.mitMax { display: flex; align-items: baseline; justify-content: space-between; gap: var(--abstand-2); }
.max { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 0.78rem; padding: 0; }
.max:disabled { opacity: 0.5; cursor: default; }
.max:hover:not(:disabled) { text-decoration: underline; }
.maxHinweis { color: var(--muted); font-size: 0.75rem; }
.maxHinweis.warn { color: var(--warn); }
</style>
