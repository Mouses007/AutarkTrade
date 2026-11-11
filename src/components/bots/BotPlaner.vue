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
import { preis, betrag, prozent, zahl, datum, ton } from './format.js'

const props = defineProps({ steuerung: { type: Object, default: null } })
const emit = defineEmits(['gestartet'])
const { t, te, locale } = useI18n()

const SPEICHER = 'at.bots.plan'
const lies = () => { try { return JSON.parse(localStorage.getItem(SPEICHER) || 'null') || {} } catch { return {} } }
const alt = lies()
const eingabe = ref({ coin: alt.coin || 'SOL', coinM: alt.coinM === true, richtung: alt.richtung || 'LONG', einsatz: alt.einsatz || '', hebel: alt.hebel || '3', tage: alt.tage || 30 })
watch(eingabe, (e) => { try { localStorage.setItem(SPEICHER, JSON.stringify(e)) } catch { /* ohne Speicher */ } }, { deep: true })

const coins = ref([])
const coinInfo = computed(() => coins.value.find((c) => c.coin === String(eingabe.value.coin || '').trim().toUpperCase()) || null)
const einheit = computed(() => (eingabe.value.coinM ? String(eingabe.value.coin || '').toUpperCase() || 'Coin' : 'USDT'))
onMounted(async () => {
    try { coins.value = (await axios.get('/api/bots/plan/coins', { timeout: 60_000 })).data?.coins || [] } catch { coins.value = [] }
    try { ki.value = (await axios.get('/api/bots/plan/ki')).data?.ergebnis || null } catch { ki.value = null }
})
// Gibt es die gewählte Art für die Coin nicht, auf die andere wechseln
watch(coinInfo, (c) => {
    if (!c) return
    if (eingabe.value.coinM && !c.coinM && c.linear) eingabe.value.coinM = false
    if (!eingabe.value.coinM && !c.linear && c.coinM) eingabe.value.coinM = true
})

const meldung = (e, ns = 'bots.plan.fehler') => {
    const d = e?.response?.data
    if (d?.code === 'kiWarten') return t('bots.ki.warten', { s: d.sekunden })
    if (d?.code && te(`${ns}.${d.code}`)) return t(`${ns}.${d.code}`)
    if (d?.code && te(`bots.st.fehler.${d.code}`)) return t(`bots.st.fehler.${d.code}`)
    return d?.error || e.message
}
const anfrage = (extra = {}) => ({ ...eingabe.value, coin: String(eingabe.value.coin || '').trim().toUpperCase(), tage: Number(eingabe.value.tage), ...extra })

// ── Rechnen ──────────────────────────────────────────────────────────────
const erg = ref(null)
const laedt = ref(false)
const fehler = ref('')
async function rechnen() {
    laedt.value = true; fehler.value = ''
    try {
        erg.value = (await axios.post('/api/bots/plan/rechnen', anfrage(), { timeout: 180_000 })).data
        eigenErg.value = null
    } catch (e) { fehler.value = meldung(e) } finally { laedt.value = false }
}
const gueltig = computed(() => (erg.value?.kandidaten || []).filter((c) => !c.fehler))
const ergebnisPct = (c) => (c?.rueckblick?.gesamt != null && erg.value?.eingabe?.einsatz ? c.rueckblick.gesamt / erg.value.eingabe.einsatz : null)
const ende = (r) => (!r ? '—' : r.liquidation ? t('bots.sim.liquidiert') : r.ausstieg ? t(`bots.feld.${r.ausstieg.art}`) : t('bots.sim.laeuft'))
const sortierung = ref('id')
const sortiert = computed(() => {
    const l = [...gueltig.value]
    if (sortierung.value === 'ergebnis') l.sort((a, b) => (b.rueckblick?.gesamt ?? -Infinity) - (a.rueckblick?.gesamt ?? -Infinity))
    if (sortierung.value === 'liq') l.sort((a, b) => (b.start?.liqAbstand ?? -1) - (a.start?.liqAbstand ?? -1))
    if (sortierung.value === 'verlust') l.sort((a, b) => (b.rueckblick?.maxVerlust ?? -Infinity) - (a.rueckblick?.maxVerlust ?? -Infinity))
    return l
})

// ── Eigener Plan ─────────────────────────────────────────────────────────
const plan = ref({ unten: '', oben: '', anzahl: '', art: 'arithmetic', stopLoss: '', takeProfit: '' })
const eigenErg = ref(null)
const eigenLaedt = ref(false)
const eigenFehler = ref('')
const planKarte = ref(null)
const textZahl = (v, s = 6) => (v == null ? '' : String(Number(Number(v).toPrecision(s))))
function uebernehmen(v) {
    plan.value = { unten: textZahl(v.unten), oben: textZahl(v.oben), anzahl: String(v.anzahl), art: v.art || 'arithmetic', stopLoss: textZahl(v.stopLoss), takeProfit: textZahl(v.takeProfit) }
    eigenErg.value = null
    planKarte.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
watch(plan, () => { eigenErg.value = null }, { deep: true })
async function eigenRechnen() {
    eigenLaedt.value = true; eigenFehler.value = ''
    try {
        const d = (await axios.post('/api/bots/plan/rechnen', anfrage({ eigene: [plan.value] }), { timeout: 180_000 })).data
        erg.value = erg.value && erg.value.eingabe?.coin === d.eingabe?.coin ? { ...d } : d
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
    id: 'plan', plan: true, coin: String(eingabe.value.coin || '').toUpperCase(), coinM: eingabe.value.coinM,
    marginCoin: einheit.value, typ: eingabe.value.coinM ? 'coinm_grid' : 'futures_grid',
    grid: { unten: Number(plan.value.unten), oben: Number(plan.value.oben), anzahl: Number(plan.value.anzahl) },
    hebel: Number(eingabe.value.hebel), einsatz: { basis: Number(eingabe.value.einsatz) }, stops: {},
}))
const vorgabe = computed(() => ({ unten: plan.value.unten, oben: plan.value.oben, anzahl: plan.value.anzahl, hebel: eingabe.value.hebel, einsatz: eingabe.value.einsatz }))
const feste = computed(() => ({ coin: planBot.value.coin, coinM: eingabe.value.coinM, richtung: eingabe.value.richtung, art: plan.value.art }))

// ── KI ───────────────────────────────────────────────────────────────────
const ki = ref(null)
const kiLaedt = ref(false)
const kiFehler = ref('')
async function kiErzeugen() {
    kiLaedt.value = true; kiFehler.value = ''
    try {
        ki.value = (await axios.post('/api/bots/plan/ki', anfrage({ sprache: locale.value }), { timeout: 180_000 })).data?.ergebnis || null
    } catch (e) {
        // Ohne Antwort (Zeitlimit) kann der Server fertig geworden sein
        if (!e?.response) { try { ki.value = (await axios.get('/api/bots/plan/ki')).data?.ergebnis || null } catch { /* bleibt */ } }
        if (e?.response || !ki.value) kiFehler.value = meldung(e)
    } finally { kiLaedt.value = false }
}
const kiPasst = computed(() => {
    const k = ki.value?.eingabe, e = anfrage()
    return !!k && k.coin === e.coin && k.coinM === e.coinM && k.richtung === e.richtung && Number(k.einsatz) === Number(e.einsatz) && Number(k.hebel) === Number(e.hebel) && Number(k.tage) === e.tage
})
const eingabeOk = computed(() => !!String(eingabe.value.coin || '').trim() && Number(eingabe.value.einsatz) > 0 && Number(eingabe.value.hebel) >= 1)
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
                    <select v-model="eingabe.coinM" class="at-feld">
                        <option :value="false" :disabled="coinInfo && !coinInfo.linear">{{ t('bots.plan.linear') }}</option>
                        <option :value="true" :disabled="coinInfo && !coinInfo.coinM">{{ t('bots.plan.coinM') }}</option>
                    </select>
                </label>
                <label><span>{{ t('bots.plan.richtung') }}</span>
                    <select v-model="eingabe.richtung" class="at-feld">
                        <option value="LONG">{{ t('bots.richtung.LONG') }}</option>
                        <option value="SHORT">{{ t('bots.richtung.SHORT') }}</option>
                        <option value="NEUTRAL">{{ t('bots.richtung.NEUTRAL') }}</option>
                    </select>
                </label>
                <label><span>{{ t('bots.feld.einsatz') }} ({{ einheit }})</span><input v-model="eingabe.einsatz" class="at-feld" inputmode="decimal"></label>
                <label><span>{{ t('bots.feld.hebel') }}</span><input v-model="eingabe.hebel" class="at-feld" inputmode="numeric"></label>
                <label><span>{{ t('bots.plan.zeitraum') }}</span>
                    <select v-model.number="eingabe.tage" class="at-feld">
                        <option v-for="n in [30, 60, 90]" :key="n" :value="n">{{ t('bots.plan.tage', { n }) }}</option>
                    </select>
                </label>
            </div>
            <p v-if="coins.length && eingabe.coin && !coinInfo" class="warn">{{ t('bots.plan.coinUnbekannt') }}</p>
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
                <div><dt>{{ t('bots.plan.tage7') }}</dt><dd :class="ton(erg.markt?.aenderung7)">{{ prozent(erg.markt?.aenderung7, { vorzeichen: true }) }}</dd></div>
                <div><dt>{{ t('bots.plan.tage30') }}</dt><dd :class="ton(erg.markt?.aenderung30)">{{ prozent(erg.markt?.aenderung30, { vorzeichen: true }) }}</dd></div>
                <div><dt>{{ t('bots.plan.spanne30') }}</dt><dd>{{ preis(erg.markt?.tief30) }} – {{ preis(erg.markt?.hoch30) }}</dd></div>
            </dl>
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
        </Karte>

        <Karte v-if="erg" :titel="t('bots.plan.kandidatenTitel', { n: gueltig.length })">
            <p class="leise">{{ t('bots.plan.kandidatenText', { tage: erg.eingabe.tage, tf: erg.zeitrahmen || '—', von: datum(erg.von) }) }}
                {{ erg.fundingSimuliert ? t('bots.sim.mitFunding') : t('bots.sim.ohneFunding') }}</p>
            <div class="sortierung">
                <span class="leise">{{ t('bots.plan.sortieren') }}:</span>
                <button v-for="s in ['id', 'ergebnis', 'verlust', 'liq']" :key="s" type="button" class="chip" :class="{ an: sortierung === s }" @click="sortierung = s">{{ t(`bots.plan.sort.${s}`) }}</button>
            </div>
            <div class="tabelleRahmen">
                <table class="tabelle">
                    <thead><tr>
                        <th>ID</th><th>{{ t('bots.plan.beschreibung') }}</th><th>{{ t('bots.feld.band') }}</th><th>{{ t('bots.feld.grids') }}</th><th>{{ t('bots.feld.nettoZyklus') }}</th>
                        <th>{{ t('bots.plan.rueckblick') }}</th><th>{{ t('bots.sim.maxVerlust') }}</th><th>{{ t('bots.sim.ende') }}</th><th>{{ t('bots.feld.zeitImBand') }}</th>
                        <th>{{ t('bots.plan.liqStart') }}</th><th></th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="c in sortiert" :key="c.id" :class="{ gewaehlt: kiPasst && ki.vorschlaege.some((v) => v.id === c.id) }">
                            <th>{{ c.id }}</th>
                            <td class="text">{{ c.titel }}<span v-for="w in c.warnungen" :key="w" class="warnmarke" :title="t(`bots.plan.warn.${w}`)"> ⚠</span></td>
                            <td>{{ preis(c.variante.unten) }} – {{ preis(c.variante.oben) }}</td>
                            <td>{{ zahl(c.variante.anzahl) }}</td>
                            <td>{{ prozent(c.start?.nettoJeZyklus, { stellen: 2 }) }}</td>
                            <td :class="ton(c.rueckblick?.gesamt)">{{ betrag(c.rueckblick?.gesamt, erg.einheit, { vorzeichen: true }) }} <span class="leise">{{ prozent(ergebnisPct(c), { vorzeichen: true }) }}</span></td>
                            <td :class="ton(c.rueckblick?.maxVerlust)">{{ betrag(c.rueckblick?.maxVerlust, erg.einheit) }}</td>
                            <td :class="{ schlecht: c.rueckblick?.liquidation }">{{ ende(c.rueckblick) }}</td>
                            <td>{{ prozent(c.rueckblick?.zeitImBand, { stellen: 0 }) }}</td>
                            <td>{{ preis(c.start?.liq) }} <span class="leise">{{ prozent(c.start?.liqAbstand, { stellen: 0 }) }}</span></td>
                            <td><Knopf art="leise" klein @click="uebernehmen(c.variante)">{{ t('bots.plan.uebernehmen') }}</Knopf></td>
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
                            <span class="nr">{{ t('bots.ki.vorschlag') }} {{ i + 1 }} · {{ v.id }}</span>
                            <h4>{{ v.titel }}</h4>
                            <span class="code">{{ v.codeTitel }}</span>
                        </header>
                        <dl class="zahlen">
                            <div><dt>{{ t('bots.feld.band') }}</dt><dd>{{ preis(v.variante.unten) }} – {{ preis(v.variante.oben) }}</dd></div>
                            <div><dt>{{ t('bots.feld.grids') }}</dt><dd>{{ zahl(v.variante.anzahl) }}</dd></div>
                            <div v-if="v.variante.stopLoss"><dt>{{ t('bots.feld.stopLoss') }}</dt><dd>{{ preis(v.variante.stopLoss) }}</dd></div>
                            <div><dt>{{ t('bots.plan.liqStart') }}</dt><dd>{{ preis(v.start?.liq) }} <span class="leise">({{ prozent(v.start?.liqAbstand) }})</span></dd></div>
                            <div><dt>{{ t('bots.plan.rueckblick') }}</dt><dd :class="ton(v.rueckblick?.gesamt)">{{ betrag(v.rueckblick?.gesamt, erg.einheit, { vorzeichen: true }) }}</dd></div>
                        </dl>
                        <p>{{ v.begruendung }}</p>
                        <p class="risiko"><strong>{{ t('bots.ki.risiko') }}:</strong> {{ v.risiko }}</p>
                        <p class="risiko"><strong>{{ t('bots.ki.passtNicht') }}:</strong> {{ v.passtNichtWenn }}</p>
                        <p v-if="v.unbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: v.unbelegt.join(', ') }) }}</p>
                        <div class="knoepfe"><Knopf art="leise" symbol="rechner" klein @click="uebernehmen(v.variante)">{{ t('bots.plan.uebernehmen') }}</Knopf></div>
                    </article>
                    <p v-if="ki.hinweis" class="leise">{{ ki.hinweis }}</p>
                </template>
            </div>
        </Karte>

        <Karte ref="planKarte" :titel="t('bots.plan.eigenTitel')">
            <p class="leise">{{ t('bots.plan.eigenText') }}</p>
            <div class="felder">
                <label><span>{{ t('bots.sim.unten') }}</span><input v-model="plan.unten" class="at-feld" inputmode="decimal"></label>
                <label><span>{{ t('bots.sim.oben') }}</span><input v-model="plan.oben" class="at-feld" inputmode="decimal"></label>
                <label><span>{{ t('bots.feld.grids') }}</span><input v-model="plan.anzahl" class="at-feld" inputmode="numeric"></label>
                <label><span>{{ t('bots.feld.art') }}</span>
                    <select v-model="plan.art" class="at-feld">
                        <option value="arithmetic">{{ t('bots.sim.arithmetisch') }}</option>
                        <option value="geometric">{{ t('bots.sim.geometrisch') }}</option>
                    </select>
                </label>
                <label v-if="eingabe.richtung !== 'NEUTRAL'"><span>{{ t('bots.feld.stopLoss') }}</span><input v-model="plan.stopLoss" class="at-feld" inputmode="decimal" :placeholder="t('bots.feld.keiner')"></label>
                <label v-if="eingabe.richtung !== 'NEUTRAL'"><span>{{ t('bots.feld.takeProfit') }}</span><input v-model="plan.takeProfit" class="at-feld" inputmode="decimal" :placeholder="t('bots.feld.keiner')"></label>
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
                <div><dt>{{ t('bots.plan.rueckblick') }}</dt><dd :class="ton(eigenErg.rueckblick?.gesamt)">{{ betrag(eigenErg.rueckblick?.gesamt, erg?.einheit || einheit, { vorzeichen: true }) }} <span class="leise">{{ prozent(ergebnisPct(eigenErg), { vorzeichen: true }) }}</span></dd></div>
                <div><dt>{{ t('bots.sim.maxVerlust') }}</dt><dd :class="ton(eigenErg.rueckblick?.maxVerlust)">{{ betrag(eigenErg.rueckblick?.maxVerlust, erg?.einheit || einheit) }}</dd></div>
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
.felder label { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); min-width: 0; }
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
</style>
