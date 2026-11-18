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
// `versucht`: nach JEDEM Sendeversuch (auch abgelehnt) — das Protokoll hat dann einen neuen Eintrag
const emit = defineEmits(['update:modelValue', 'gesendet', 'versucht'])
const { t, te } = useI18n()

const FELDER = {
    band: ['unten', 'oben', 'anzahl'],
    investieren: ['betrag'],
    margeDazu: ['betrag'],
    margeWeg: ['betrag'],
    stops: ['stopLoss', 'takeProfit'],
    reduzieren: ['anteil'],
    pausieren: [], fortsetzen: [], beenden: [],
    starten: ['unten', 'oben', 'anzahl', 'hebel', 'einsatz', 'stopLoss', 'takeProfit', 'trigger'],
}
const eingabe = ref({})
const pruefung = ref(null)
const ergebnis = ref(null)
const haken = ref(false)
const laedt = ref(false)
const fehler = ref('')
const stufenInfo = ref(null)   // Reduzieren: {schritt, hoechstens} in % aus der letzten Prüfung
// Spot-Grid hat keinen Hebel
// Reduzieren: Eingabe wahlweise in % der Position oder als Betrag; die Wahl bleibt gemerkt
const EINHEIT_SCHLUESSEL = 'at.bots.reduzierenEinheit'
const einheit = ref((() => { try { return localStorage.getItem(EINHEIT_SCHLUESSEL) === 'betrag' ? 'betrag' : 'anteil' } catch { return 'anteil' } })())
function waehleEinheit(e) {
    if (einheit.value === e) return
    einheit.value = e
    try { localStorage.setItem(EINHEIT_SCHLUESSEL, e) } catch { /* privater Modus */ }
    delete eingabe.value.anteil; delete eingabe.value.betrag
    pruefung.value = null; ergebnis.value = null; haken.value = false; fehler.value = ''
}
const felderFuer = computed(() => {
    if (props.aktion === 'reduzieren') return [einheit.value === 'betrag' ? 'betrag' : 'anteil']
    // Spot-Grid hat keinen Hebel; Stops beim Start gibt es nur gerichtet und nur für Futures-Grids
    const ohneStops = props.aktion === 'starten' && (props.bot.typ === 'spot_grid' || props.bot.richtung === 'NEUTRAL')
    return (FELDER[props.aktion] || []).filter((f) => !(f === 'hebel' && props.bot.typ === 'spot_grid') && !(ohneStops && (f === 'stopLoss' || f === 'takeProfit')))
})
const offen = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const mc = computed(() => props.bot.marginCoin)
const istSpot = computed(() => props.bot.typ === 'spot_grid')
const aktionTextSchluessel = computed(() => {
    const k = props.bot.plan ? 'planStarten' : props.aktion
    return istSpot.value && te(`bots.st.aktionText.${k}Spot`) ? `${k}Spot` : k
})

function zuruecksetzen() {
    // ein KI-Vorschlag bringt den Anteil in % mit
    if (props.aktion === 'reduzieren' && props.vorgabe?.anteil != null) einheit.value = 'anteil'
    const e = {}
    for (const f of felderFuer.value) e[f] = props.vorgabe?.[f] != null ? String(props.vorgabe[f]) : ''
    if (props.aktion === 'stops') { e.stopLossWeg = false; e.takeProfitWeg = false }
    eingabe.value = e
    pruefung.value = null; ergebnis.value = null; haken.value = false; fehler.value = ''; stufenInfo.value = null
    pruefLauf++   // eine noch laufende Prüfung gehört zum alten Dialog
}
watch(() => [props.modelValue, props.aktion], ([auf]) => { if (auf) zuruecksetzen() }, { immediate: true })
// Jede Änderung an der Eingabe macht eine frühere Prüfung ungültig
watch(eingabe, () => { pruefung.value = null; haken.value = false }, { deep: true })

const platzhalter = computed(() => ({
    unten: preis(props.bot.grid?.unten), oben: preis(props.bot.grid?.oben), anzahl: String(props.bot.grid?.anzahl ?? ''),
    hebel: String(props.bot.hebel ?? ''), einsatz: String(props.bot.einsatz?.basis ?? props.bot.einsatz?.aktuell ?? ''), betrag: '0',
    // Neuer Bot: leer heisst «keiner» — die Stops des alten Bots werden nicht übernommen
    stopLoss: props.aktion === 'starten' ? t('bots.feld.keiner') : stopPlatzhalter(props.bot.stops?.stopLoss),
    takeProfit: props.aktion === 'starten' ? t('bots.feld.keiner') : stopPlatzhalter(props.bot.stops?.takeProfit),
    trigger: t('bots.st.triggerSofort'),
}))
// Nur Preis-Stops als Preis zeigen: ein Stop nach Gewinnquote (`profit_ratio`, Wert −0.2) stand sonst
// als «Preis −0.20» im Feld (Audit STG-11)
function stopPlatzhalter(s) {
    if (!s || s.wert == null) return t('bots.feld.keiner')
    return /price/.test(s.art || '') ? preis(s.wert) : `${s.wert} (${s.art || '?'})`
}
const feldName = (f) => ({ unten: t('bots.sim.unten'), oben: t('bots.sim.oben'), anzahl: t('bots.feld.grids'), hebel: t('bots.feld.hebel'), einsatz: `${t('bots.feld.einsatz')} (${mc.value})`, betrag: props.aktion === 'reduzieren' ? `${t('bots.st.redBetrag')} (${mc.value})` : `${t('bots.st.betrag')} (${mc.value})`, anteil: t('bots.st.anteil'), stopLoss: t('bots.feld.stopLoss'), takeProfit: t('bots.feld.takeProfit'), trigger: t('bots.st.triggerFeld') }[f])

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
    if (props.aktion === 'reduzieren') e.einheit = einheit.value
    return props.feste ? { ...e, ...props.feste } : e
}
const meldung = (e) => {
    const d = e?.response?.data
    // Platzhalter (z. B. {schritt} bei anteilZuKlein) kommen aus der Antwort des Servers
    if (!(d?.code && te(`bots.st.fehler.${d.code}`))) return d?.error || e.message
    // Der Server nennt Beträge als nackte Zahl: die Margin-Münze gehört dazu (Audit UI-15)
    const werte = { ...d }
    if (d.code === 'betragZuGross' || d.code === 'betragZuKlein') for (const f of ['max', 'schritt']) if (typeof d[f] === 'number') werte[f] = `${d[f]} ${mc.value}`
    return t(`bots.st.fehler.${d.code}`, werte)
}
// FUN-R-105: Pionex reduziert nur in ganzen Schritten — weicht der tatsächliche Anteil vom gewünschten ab, sagen
const anteilAbweichung = computed(() => {
    const a = pruefung.value?.anteil
    if (!a) return null
    const tatsaechlich = a.tatsaechlich == null ? '—' : zahl(a.tatsaechlich, 1)
    if (a.betragGewuenscht != null && a.betragTatsaechlich != null) {
        if (Math.abs(a.betragTatsaechlich - a.betragGewuenscht) <= 0.02 * a.betragGewuenscht) return null
        return { text: t('bots.st.betragTatsaechlich', { gewuenscht: betrag(a.betragGewuenscht, mc.value), tatsaechlich: betrag(a.betragTatsaechlich, mc.value), anteil: tatsaechlich, schritt: zahl(a.schritt, 1) }) }
    }
    if (a.gewuenscht == null || a.tatsaechlich == null) return null
    const gewuenscht = zahl(a.gewuenscht, 1)
    return gewuenscht === tatsaechlich ? null : { text: t('bots.st.anteilTatsaechlich', { gewuenscht, tatsaechlich, schritt: zahl(a.schritt, 1) }) }
})

// Position reduzieren: Pionex nimmt nur ganze Schritte. Nach der ersten Prüfung ist bekannt, wie gross
// einer ist und wie viele gehen — die möglichen Anteile stehen dann als Knöpfe unter dem Feld.
// Bleibt über Eingaben hinweg stehen (die Prüfung selbst wird bei jeder Änderung verworfen).
const stufen = computed(() => {
    const a = stufenInfo.value
    if (props.aktion !== 'reduzieren' || !(a?.schritt > 0) || !(a?.hoechstens > 0)) return []
    const n = Math.min(200, Math.round(a.hoechstens / a.schritt))
    if (n < 1) return []
    const alle = Array.from({ length: n }, (_, i) => (i + 1 === n ? a.hoechstens : (i + 1) * a.schritt))
    // höchstens 6 Knöpfe: die ersten fünf und der grösste
    const gezeigt = alle.length > 6 ? [...alle.slice(0, 5), alle[alle.length - 1]] : alle
    // ganze Prozent, wenn das die Stufen noch unterscheidet («33 %», «67 %»), sonst eine Stelle
    const ganz = new Set(alle.map((x) => Math.round(x))).size === alle.length
    return gezeigt.map((wert, i) => ({ wert, text: `${zahl(wert, ganz ? 0 : 1)} %`, luecke: alle.length > 6 && i === 5 }))
})
const istStufe = (wert) => einheit.value === 'anteil' && Math.abs(Number(String(eingabe.value.anteil ?? '').replace(',', '.')) - wert) < 0.05
function waehleStufe(wert) {
    if (laedt.value) return
    einheit.value = 'anteil'
    try { localStorage.setItem(EINHEIT_SCHLUESSEL, 'anteil') } catch { /* privater Modus */ }
    eingabe.value = { anteil: String(Number(wert.toFixed(2))) }
    ergebnis.value = null
    pruefen()
}

// Zwei Anfragen, zwei Merker: «Prüfen» darf nicht laufen, während gesendet wird, und umgekehrt
const prueft = ref(false)
const sendet = ref(false)
let pruefLauf = 0
async function pruefen() {
    if (sendet.value) return
    const lauf = ++pruefLauf
    const gefragt = eingabeFuerServer()
    const gefragtText = JSON.stringify(gefragt)
    prueft.value = true; laedt.value = true; fehler.value = ''; ergebnis.value = null
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/aktion/pruefen`, { aktion: props.aktion, eingabe: gefragt }, { timeout: 60_000 })
        // Die Antwort gilt nur für die Eingabe, die gefragt wurde: wer während der Abfrage das Feld ändert
        // (oder neu prüft, den Dialog neu öffnet), bekäme sonst eine Prüfung der ALTEN Eingabe mit aktivem
        // «Senden» — bei «Position reduzieren» ginge dann der alte Wert zum Marktpreis raus (Audit UI-01).
        if (lauf !== pruefLauf || JSON.stringify(eingabeFuerServer()) !== gefragtText) return
        pruefung.value = data
        haken.value = false
        if (data?.anteil?.schritt > 0 && data.anteil.hoechstens > 0) stufenInfo.value = { schritt: data.anteil.schritt, hoechstens: data.anteil.hoechstens }
    } catch (e) { if (lauf === pruefLauf) fehler.value = meldung(e) } finally { if (lauf === pruefLauf) { prueft.value = false; laedt.value = sendet.value } }
}
async function senden() {
    if (!haken.value || !pruefung.value?.token || sendet.value || prueft.value) return
    sendet.value = true; laedt.value = true; fehler.value = ''
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/aktion/senden`, {
            // Reduzieren: genau die vom Server umgerechnete Menge senden (an sie ist der Token gebunden)
            aktion: props.aktion, eingabe: { ...eingabeFuerServer(), ...(pruefung.value.eingabe || {}) }, token: pruefung.value.token, haken: true, hakenText: props.steuerung?.haken,
        }, { timeout: 120_000 })
        ergebnis.value = data
        // Auch bei „unklar" neu laden: Pionex kann ausgeführt haben
        if (data.zustand !== 'abgelehnt') emit('gesendet')
    } catch (e) {
        // Keine Antwort (Zeitlimit, Netz): der Server kann gesendet haben → wie „unklar", nie erneut senden
        if (!e?.response) { ergebnis.value = { ok: false, zustand: 'unklar', antwort: { message: e.message } }; emit('gesendet') }
        else fehler.value = meldung(e)
    } finally { sendet.value = false; laedt.value = prueft.value; emit('versucht') }
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
    zeile(t('bots.feld.trigger'), v.trigger, n.trigger, preis)
    if (p.reduzieren) {
        const r = p.reduzieren
        const zeig = (titel, wert, f) => { if (wert != null) z.push({ titel, vorher: '', nachher: f(wert), pionex: true }) }
        const teil = p.anteil?.tatsaechlich
        zeig(t('bots.st.redStueck'), r.stueck, (x) => `${zahl(x, 4)} ${props.bot.coinM ? 'USD' : (props.bot.coin || '')}${teil != null ? ` (${zahl(teil, 1)} %)` : ''}`.trim())
        zeig(t('bots.st.redMenge'), r.menge, (x) => betrag(x, mc.value))
        zeig(t('bots.st.redPnl'), r.pnl, (x) => betrag(x, mc.value, { vorzeichen: true }))
        zeig(t('bots.st.redGrid'), r.gridGewinn, (x) => betrag(x, mc.value, { vorzeichen: true }))
        zeig(t('bots.st.redEinsatz'), r.einsatz, (x) => betrag(x, mc.value))
        zeig(t('bots.st.redGebuehr'), r.gebuehr, (x) => betrag(x, mc.value))
    }
    // Ein Spot-Grid hat keine Liquidation — die Zeile stand dort mit zwei Strichen
    if (!istSpot.value && (p.liq?.vorher || p.liq?.nachher)) {
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
// Pionex meldet ein Spot-Grid direkt nach dem Beenden als `destroy_grid` (wird abgebaut), danach als beendet
const ENDE = ['canceled', 'closed', 'destroy_grid']
const istZeilen = computed(() => {
    const r = ergebnis.value
    if (!r?.ist || r.ist.fehler || r.ist.status === 'nichtMehrLaufend' || r.ist.status === 'nichtGefunden') return []
    const soll = r.soll || {}
    const felder = [['unten', t('bots.sim.unten'), preis], ['oben', t('bots.sim.oben'), preis], ['anzahl', t('bots.feld.grids'), (x) => zahl(x)], ['einsatz', t('bots.feld.einsatz'), (x) => betrag(x, mc.value)], ['extraMarge', t('bots.feld.extraMarge'), (x) => betrag(x, mc.value)], ['stopLoss', t('bots.feld.stopLoss'), preis], ['takeProfit', t('bots.feld.takeProfit'), preis], ['trigger', t('bots.feld.trigger'), preis], ['status', t('bots.feld.status'), (x) => (te(`bots.status.${x}`) ? t(`bots.status.${x}`) : x)]]
    return felder.filter(([k]) => soll[k] !== undefined).map(([k, titel, f]) => {
        const s = soll[k], i = r.ist[k]
        const gleich = k === 'status' && ENDE.includes(String(s)) && ENDE.includes(String(i)) ? true : s == null ? i == null : (typeof s === 'number' && typeof i === 'number' ? Math.abs(s - i) <= Math.abs(s) * 0.001 : String(s) === String(i))
        return { titel, soll: s == null ? '—' : f(s), ist: i == null ? '—' : f(i), gleich }
    })
})
</script>

<template>
    <Dialog v-model="offen" :titel="t(`bots.st.aktion.${aktion}`)" breite="40rem" :aussen-schliesst="false" :gesperrt="sendet">
        <div class="dlg">
            <p class="leise">{{ t(`bots.st.aktionText.${aktionTextSchluessel}`) }}</p>

            <div v-if="aktion === 'reduzieren'" class="einheit" role="group" :aria-label="t('bots.st.redEinheit')">
                <span class="leise">{{ t('bots.st.redEinheit') }}</span>
                <button type="button" class="pille" :class="{ aktiv: einheit === 'anteil' }" :aria-pressed="einheit === 'anteil'" :disabled="laedt" @click="waehleEinheit('anteil')">%</button>
                <button type="button" class="pille" :class="{ aktiv: einheit === 'betrag' }" :aria-pressed="einheit === 'betrag'" :disabled="laedt" @click="waehleEinheit('betrag')">{{ mc }}</button>
            </div>
            <div v-if="felderFuer.length" class="felder">
                <label v-for="f in felderFuer" :key="f"><span>{{ feldName(f) }}</span>
                    <input v-model="eingabe[f]" class="at-feld" inputmode="decimal" :placeholder="platzhalter[f]" :disabled="laedt">
                </label>
            </div>
            <div v-if="stufen.length" class="stufen" role="group" :aria-label="t('bots.st.stufen')">
                <span class="leise">{{ t('bots.st.stufen') }}</span>
                <template v-for="s in stufen" :key="s.wert">
                    <span v-if="s.luecke" class="leise" aria-hidden="true">…</span>
                    <button type="button" class="pille" :class="{ aktiv: istStufe(s.wert) }" :aria-pressed="istStufe(s.wert)" :disabled="laedt" @click="waehleStufe(s.wert)">{{ s.text }}</button>
                </template>
            </div>
            <p v-if="aktion === 'starten'" class="leise">{{ t('bots.st.triggerHinweis') }}</p>
            <div v-if="aktion === 'stops'" class="wegs">
                <label v-if="bot.stops?.stopLoss"><input v-model="eingabe.stopLossWeg" type="checkbox" :disabled="laedt"> {{ t('bots.st.slEntfernen') }}</label>
                <label v-if="bot.stops?.takeProfit"><input v-model="eingabe.takeProfitWeg" type="checkbox" :disabled="laedt"> {{ t('bots.st.tpEntfernen') }}</label>
                <p class="leise">{{ t('bots.st.stopsHinweis') }}</p>
            </div>

            <div class="knoepfe">
                <Knopf art="normal" symbol="suche" :laedt="prueft" :disabled="sendet" @click="pruefen">{{ t('bots.st.pruefen') }}</Knopf>
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

                <Hinweis v-if="anteilAbweichung" art="warn">{{ anteilAbweichung.text }}</Hinweis>

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
                    <input v-model="haken" type="checkbox" :disabled="laedt">
                    <span>{{ steuerung?.haken }}</span>
                </label>

                <div class="knoepfe">
                    <Knopf art="leise" :disabled="sendet" @click="offen = false">{{ t('bots.st.abbrechen') }}</Knopf>
                    <Knopf art="gefahr" symbol="hochladen" :laedt="sendet" :disabled="!kannSenden || prueft" @click="senden">{{ t('bots.st.senden') }}</Knopf>
                </div>
            </template>

            <Hinweis v-if="ergebnis?.zustand === 'ausgefuehrt'" art="gut" :titel="t('bots.st.gesendet')">{{ t('bots.st.gesendetText') }}</Hinweis>
            <Hinweis v-else-if="ergebnis?.zustand === 'unklar'" art="warn" :titel="t('bots.st.unklarTitel')">{{ t('bots.st.unklarText') }} {{ ergebnis.antwort?.message || '' }}</Hinweis>
            <Hinweis v-else-if="ergebnis" art="fehler" :titel="t('bots.st.nichtAusgefuehrt')">{{ ergebnis.antwort?.message || '' }} {{ t('bots.st.neuPruefenText') }}</Hinweis>
            <Hinweis v-if="ergebnis?.protokollFehler" art="warn" :titel="t('bots.st.protokollFehlerTitel')">{{ t('bots.st.protokollFehlerText') }}</Hinweis>
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
.einheit, .stufen { display: flex; align-items: center; gap: var(--abstand-2); flex-wrap: wrap; }
.einheit .pille, .stufen .pille { border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: 999px; padding: 2px 12px; cursor: pointer; font: inherit; font-size: 0.85rem; }
.einheit .pille:disabled, .stufen .pille:disabled { opacity: 0.5; cursor: default; }
.einheit .pille.aktiv, .stufen .pille.aktiv { border-color: var(--accent); background: var(--accent-flaeche); color: var(--accent); }
</style>
