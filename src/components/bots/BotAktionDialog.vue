<script setup>
/**
 * Eine Änderung an einem Pionex-Bot: Eingabe → Prüfung bei Pionex → Vergleich
 * vorher/nachher, Warnungen, Warnblock, Haken (nie vorausgefüllt) → Senden.
 * Ohne bestandene Prüfung (wo Pionex eine anbietet) und ohne Haken bleibt der
 * Senden-Knopf gesperrt; der Server prüft dasselbe noch einmal.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Dialog from '@/components/basis/Dialog.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import { preis, betrag, zahl } from './format.js'

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    bot: { type: Object, required: true },
    aktion: { type: String, default: '' },
    vorgabe: { type: Object, default: () => ({}) },
    steuerung: { type: Object, default: null },
    // Bot-Planer: feste Planwerte (Coin, Coin-M, Richtung, Art), gehen mit jeder Anfrage mit
    feste: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'gesendet'])
const { t, te } = useI18n()

const FELDER = {
    band: ['unten', 'oben', 'anzahl'],
    investieren: ['betrag'],
    margeDazu: ['betrag'],
    margeWeg: ['betrag'],
    stops: ['stopLoss', 'takeProfit'],
    pausieren: [], fortsetzen: [], beenden: [],
    starten: ['unten', 'oben', 'anzahl', 'hebel', 'einsatz'],
}
const eingabe = ref({})
const pruefung = ref(null)
const ergebnis = ref(null)
const haken = ref(false)
const laedt = ref(false)
const fehler = ref('')
// Spot-Grid hat keinen Hebel
const felderFuer = computed(() => (FELDER[props.aktion] || []).filter((f) => !(f === 'hebel' && props.bot.typ === 'spot_grid')))
const offen = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const mc = computed(() => props.bot.marginCoin)

function zuruecksetzen() {
    const e = {}
    for (const f of felderFuer.value) e[f] = props.vorgabe?.[f] != null ? String(props.vorgabe[f]) : ''
    if (props.aktion === 'stops') { e.stopLossWeg = false; e.takeProfitWeg = false }
    eingabe.value = e
    pruefung.value = null; ergebnis.value = null; haken.value = false; fehler.value = ''
}
watch(() => [props.modelValue, props.aktion], ([auf]) => { if (auf) zuruecksetzen() }, { immediate: true })
// Jede Änderung an der Eingabe macht eine frühere Prüfung ungültig
watch(eingabe, () => { pruefung.value = null; haken.value = false }, { deep: true })

const platzhalter = computed(() => ({
    unten: preis(props.bot.grid?.unten), oben: preis(props.bot.grid?.oben), anzahl: String(props.bot.grid?.anzahl ?? ''),
    hebel: String(props.bot.hebel ?? ''), einsatz: String(props.bot.einsatz?.basis ?? props.bot.einsatz?.aktuell ?? ''), betrag: '0',
    stopLoss: props.bot.stops?.stopLoss?.wert != null ? preis(props.bot.stops.stopLoss.wert) : t('bots.feld.keiner'),
    takeProfit: props.bot.stops?.takeProfit?.wert != null ? preis(props.bot.stops.takeProfit.wert) : t('bots.feld.keiner'),
}))
const feldName = (f) => ({ unten: t('bots.sim.unten'), oben: t('bots.sim.oben'), anzahl: t('bots.feld.grids'), hebel: t('bots.feld.hebel'), einsatz: `${t('bots.feld.einsatz')} (${mc.value})`, betrag: `${t('bots.st.betrag')} (${mc.value})`, stopLoss: t('bots.feld.stopLoss'), takeProfit: t('bots.feld.takeProfit') }[f])

/** Eingabe für den Server: Stops „leer" heisst entfernen nur, wenn das Feld angefasst wurde. */
function eingabeFuerServer() {
    const e = {}
    if (eingabe.value.stopLossWeg) e.stopLoss = ''
    if (eingabe.value.takeProfitWeg) e.takeProfit = ''
    for (const [k, v] of Object.entries(eingabe.value)) {
        if ((k === 'stopLoss' && eingabe.value.stopLossWeg) || (k === 'takeProfit' && eingabe.value.takeProfitWeg)) continue
        if (k === 'stopLossWeg' || k === 'takeProfitWeg') continue
        if (v !== '') e[k] = v
    }
    return props.feste ? { ...e, ...props.feste } : e
}
const meldung = (e) => {
    const d = e?.response?.data
    return d?.code && te(`bots.st.fehler.${d.code}`) ? t(`bots.st.fehler.${d.code}`) : (d?.error || e.message)
}

async function pruefen() {
    laedt.value = true; fehler.value = ''; ergebnis.value = null
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/aktion/pruefen`, { aktion: props.aktion, eingabe: eingabeFuerServer() }, { timeout: 60_000 })
        pruefung.value = data
        haken.value = false
    } catch (e) { fehler.value = meldung(e) } finally { laedt.value = false }
}
async function senden() {
    if (!haken.value || !pruefung.value?.token) return
    laedt.value = true; fehler.value = ''
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/aktion/senden`, {
            aktion: props.aktion, eingabe: eingabeFuerServer(), token: pruefung.value.token, haken: true, hakenText: props.steuerung?.haken,
        }, { timeout: 120_000 })
        ergebnis.value = data
        // Auch bei „unklar" neu laden: Pionex kann ausgeführt haben
        if (data.zustand !== 'abgelehnt') emit('gesendet')
    } catch (e) {
        // Keine Antwort (Zeitlimit, Netz): der Server kann gesendet haben → wie „unklar", nie erneut senden
        if (!e?.response) { ergebnis.value = { ok: false, zustand: 'unklar', antwort: { message: e.message } }; emit('gesendet') }
        else fehler.value = meldung(e)
    } finally { laedt.value = false }
}

const vergleich = computed(() => {
    const p = pruefung.value
    if (!p) return []
    const z = []
    const v = p.vorher || {}, n = p.nachher || {}
    const zeile = (titel, a, b, f = (x) => x) => { if (b !== undefined) z.push({ titel, vorher: a == null ? '—' : f(a), nachher: b == null ? (titel.includes('Stop') || titel.includes('Take') ? t('bots.st.entfernt') : '—') : f(b) }) }
    zeile(t('bots.sim.unten'), v.unten, n.unten, preis)
    zeile(t('bots.sim.oben'), v.oben, n.oben, preis)
    zeile(t('bots.feld.grids'), v.anzahl, n.anzahl, (x) => zahl(x))
    zeile(t('bots.feld.hebel'), v.hebel, n.hebel, (x) => `${x}x`)
    zeile(t('bots.feld.einsatz'), v.einsatz, n.einsatz, (x) => betrag(x, mc.value))
    zeile(t('bots.feld.extraMarge'), v.extraMarge, n.extraMarge, (x) => betrag(x, mc.value))
    zeile(t('bots.feld.stopLoss'), v.stopLoss, n.stopLoss, preis)
    zeile(t('bots.feld.takeProfit'), v.takeProfit, n.takeProfit, preis)
    if (p.liq?.vorher || p.liq?.nachher) {
        const l = (x) => preis(x?.unten ?? x?.oben)
        // Neuer Bot: Pionex' checkParams nennt nur EINE Schätzung (ohne Before/After) — die gehört zum neuen
        // Bot, also unter „Nachher" (gesehen 14.11.2026 beim ersten echten Start: stand unter „Vorher")
        if (props.aktion === 'starten') z.push({ titel: t('bots.st.liqPionex'), vorher: '—', nachher: l(p.liq.nachher) || l(p.liq.vorher), pionex: true })
        else z.push({ titel: t('bots.st.liqPionex'), vorher: l(p.liq.vorher) || preis(v.liquidation), nachher: l(p.liq.nachher), pionex: true })
    }
    return z
})
// Nach einem Sendeversuch (egal welcher Ausgang) nie mit demselben Token erneut — Audit SEC-02
const kannSenden = computed(() => pruefung.value?.bestanden && pruefung.value?.token && haken.value && !pruefung.value?.testbetrieb && !ergebnis.value)
const istZeilen = computed(() => {
    const r = ergebnis.value
    if (!r?.ist || r.ist.fehler || r.ist.status === 'nichtMehrLaufend' || r.ist.status === 'nichtGefunden') return []
    const soll = r.soll || {}
    const felder = [['unten', t('bots.sim.unten'), preis], ['oben', t('bots.sim.oben'), preis], ['anzahl', t('bots.feld.grids'), (x) => zahl(x)], ['einsatz', t('bots.feld.einsatz'), (x) => betrag(x, mc.value)], ['extraMarge', t('bots.feld.extraMarge'), (x) => betrag(x, mc.value)], ['stopLoss', t('bots.feld.stopLoss'), preis], ['takeProfit', t('bots.feld.takeProfit'), preis], ['status', 'Status', (x) => x]]
    return felder.filter(([k]) => soll[k] !== undefined).map(([k, titel, f]) => {
        const s = soll[k], i = r.ist[k]
        const gleich = s == null ? i == null : (typeof s === 'number' && typeof i === 'number' ? Math.abs(s - i) <= Math.abs(s) * 0.001 : String(s) === String(i))
        return { titel, soll: s == null ? '—' : f(s), ist: i == null ? '—' : f(i), gleich }
    })
})
</script>

<template>
    <Dialog v-model="offen" :titel="t(`bots.st.aktion.${aktion}`)" breite="40rem">
        <div class="dlg">
            <p class="leise">{{ t(`bots.st.aktionText.${bot.plan ? 'planStarten' : aktion}`) }}</p>

            <div v-if="felderFuer.length" class="felder">
                <label v-for="f in felderFuer" :key="f"><span>{{ feldName(f) }}</span>
                    <input v-model="eingabe[f]" class="at-feld" inputmode="decimal" :placeholder="platzhalter[f]">
                </label>
            </div>
            <div v-if="aktion === 'stops'" class="wegs">
                <label v-if="bot.stops?.stopLoss"><input v-model="eingabe.stopLossWeg" type="checkbox"> {{ t('bots.st.slEntfernen') }}</label>
                <label v-if="bot.stops?.takeProfit"><input v-model="eingabe.takeProfitWeg" type="checkbox"> {{ t('bots.st.tpEntfernen') }}</label>
                <p class="leise">{{ t('bots.st.stopsHinweis') }}</p>
            </div>

            <div class="knoepfe">
                <Knopf art="normal" symbol="suche" :laedt="laedt && !pruefung" @click="pruefen">{{ t('bots.st.pruefen') }}</Knopf>
            </div>

            <template v-if="pruefung">
                <Hinweis v-if="pruefung.ohnePruefung" art="warn">{{ t('bots.st.ohnePruefung') }}</Hinweis>
                <Hinweis v-else-if="pruefung.bestanden" art="gut" :titel="t('bots.st.bestanden')">{{ pruefung.pruefung?.data?.reason || '' }}</Hinweis>
                <Hinweis v-else-if="pruefung.grund === 'einsatzZuKlein'" art="fehler" :titel="t('bots.st.abgelehnt')">
                    <p class="grund">{{ pruefung.minEinsatz ? t('bots.st.grund.einsatzZuKleinMin', { betrag: betrag(pruefung.minEinsatz, mc) }) : t('bots.st.grund.einsatzZuKlein') }}</p>
                    <Knopf v-if="pruefung.minEinsatz && felderFuer.includes('einsatz')" art="normal" klein @click="eingabe.einsatz = String(pruefung.minEinsatz)">{{ t('bots.st.minUebernehmen', { betrag: betrag(pruefung.minEinsatz, mc) }) }}</Knopf>
                    <p class="leise klein">Pionex: {{ pruefung.pruefung?.message || '' }}</p>
                </Hinweis>
                <Hinweis v-else art="fehler" :titel="t('bots.st.abgelehnt')">{{ pruefung.pruefung?.data?.reason || pruefung.pruefung?.message || '' }}</Hinweis>

                <table v-if="vergleich.length" class="tabelle">
                    <thead><tr><th></th><th>{{ t('bots.st.vorher') }}</th><th>{{ t('bots.st.nachher') }}</th></tr></thead>
                    <tbody><tr v-for="z in vergleich" :key="z.titel" :class="{ pionex: z.pionex }"><th>{{ z.titel }}</th><td>{{ z.vorher }}</td><td>{{ z.nachher }}</td></tr></tbody>
                </table>

                <ul v-if="pruefung.warnungen?.length" class="warnungen">
                    <li v-for="w in pruefung.warnungen" :key="w">⚠ {{ t(`bots.st.warn.${w}`) }}</li>
                </ul>

                <details class="anfrage">
                    <summary>{{ t('bots.st.anfrageZeigen') }}</summary>
                    <pre>{{ JSON.stringify(pruefung.anfrage, null, 2) }}</pre>
                    <pre v-if="pruefung.pruefung?.data">{{ JSON.stringify(pruefung.pruefung.data, null, 2) }}</pre>
                </details>

                <Hinweis art="warn" :titel="t('bots.ki.warnTitel')">
                    <ul class="warnliste"><li v-for="w in steuerung?.warnung || []" :key="w">{{ w }}</li></ul>
                </Hinweis>

                <Hinweis v-if="pruefung.testbetrieb" art="info">{{ t('bots.st.testbetriebSenden') }}</Hinweis>
                <label v-else-if="pruefung.bestanden" class="haken">
                    <input v-model="haken" type="checkbox">
                    <span>{{ steuerung?.haken }}</span>
                </label>

                <div class="knoepfe">
                    <Knopf art="leise" @click="offen = false">{{ t('bots.st.abbrechen') }}</Knopf>
                    <Knopf art="gefahr" symbol="hochladen" :laedt="laedt && !!pruefung" :disabled="!kannSenden" @click="senden">{{ t('bots.st.senden') }}</Knopf>
                </div>
            </template>

            <Hinweis v-if="ergebnis?.zustand === 'ausgefuehrt'" art="gut" :titel="t('bots.st.gesendet')">{{ t('bots.st.gesendetText') }}</Hinweis>
            <Hinweis v-else-if="ergebnis?.zustand === 'unklar'" art="warn" :titel="t('bots.st.unklarTitel')">{{ t('bots.st.unklarText') }} {{ ergebnis.antwort?.message || '' }}</Hinweis>
            <Hinweis v-else-if="ergebnis" art="fehler" :titel="t('bots.st.nichtAusgefuehrt')">{{ ergebnis.antwort?.message || '' }} {{ t('bots.st.neuPruefenText') }}</Hinweis>
            <template v-if="ergebnis?.ist">
                <p class="leise">{{ ergebnis.ist.status === 'nichtMehrLaufend' ? t('bots.st.istBeendet') : ergebnis.ist.status === 'nichtGefunden' ? t('bots.st.istNeuFehlt') : ergebnis.ist.fehler ? t('bots.st.istFehler') : ergebnis.ist.neueId ? t('bots.st.istNeu', { id: ergebnis.ist.neueId }) : t('bots.st.istTitel') }}</p>
                <table v-if="istZeilen.length" class="tabelle">
                    <thead><tr><th></th><th>{{ t('bots.st.soll') }}</th><th>{{ t('bots.st.ist') }}</th></tr></thead>
                    <tbody><tr v-for="z in istZeilen" :key="z.titel" :class="{ abweichung: !z.gleich }"><th>{{ z.titel }}</th><td>{{ z.soll }}</td><td>{{ z.ist }}{{ z.gleich ? '' : ' ⚠' }}</td></tr></tbody>
                </table>
            </template>
            <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        </div>
    </Dialog>
</template>

<style scoped>
.dlg { display: flex; flex-direction: column; gap: var(--abstand-3); }
.leise { color: var(--muted); font-size: 0.85rem; margin: 0; }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--abstand-2) var(--abstand-3); }
.felder label { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); }
.felder .at-feld::placeholder { color: var(--leise); font-style: italic; opacity: 1; }
.wegs { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; flex-wrap: wrap; }
.tabelle { width: 100%; border-collapse: collapse; font-size: 0.88rem; font-variant-numeric: tabular-nums; }
.tabelle th, .tabelle td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: right; }
.tabelle th:first-child { text-align: left; color: var(--muted); font-weight: 500; }
.tabelle thead th { color: var(--muted); font-weight: 500; font-size: 0.75rem; }
.tabelle tr.pionex td { font-weight: 600; }
.tabelle tr.abweichung td { color: var(--warn); }
.warnungen { margin: 0; padding-left: 0; list-style: none; color: var(--warn); font-size: 0.88rem; display: flex; flex-direction: column; gap: 3px; }
.warnliste { margin: 0; padding-left: 1.1em; }
.anfrage summary { cursor: pointer; color: var(--muted); font-size: 0.8rem; }
.anfrage pre { font-family: var(--schrift-mono); font-size: 0.75rem; background: var(--panel-soft); padding: var(--abstand-2); border-radius: var(--radius-klein); overflow: auto; margin: var(--abstand-1) 0 0; }
.haken { display: flex; gap: var(--abstand-2); align-items: flex-start; font-size: 0.9rem; cursor: pointer; padding: var(--abstand-2); border: 1px solid var(--warn); border-radius: var(--radius); }
.haken input { margin-top: 3px; }
.grund { margin: 0 0 var(--abstand-2); }
.klein { font-size: 0.75rem; margin: var(--abstand-2) 0 0; }
</style>
