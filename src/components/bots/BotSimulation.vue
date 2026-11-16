<script setup>
/**
 * Simulation in der Bot-Detailansicht: heutige Einstellung gegen bis zu drei
 * Varianten über die Laufzeit (POST /api/bots/:id/simulation), mit Eichung
 * gegen die echten Zahlen von Pionex und dem, was ein Umstellen zum heutigen
 * Kurs an Position und geschätzter Liquidation ändern würde. Ein Rückblick —
 * keine Vorhersage, kein Vorschlag; die Seite sagt das neben dem Ergebnis
 * (rechtliche Recherche 11.11.2026: Hinweis direkt beim Ergebnis).
 *
 * Felder je Variante: Band, Grids, Art, Hebel, Einsatz, Stop-Loss, Take-Profit.
 * Leer = heutiger Wert; die Platzhalter zeigen ihn.
 */
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import * as echarts from 'echarts'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import { palette, tooltipStil, schrift, grundOption, wertAchse } from '@/utils/journal/diagramme/gestaltung.js'
import { preis, betrag, prozent, zahl, menge, mengenEinheit, datum, ton } from './format.js'

const props = defineProps({
    bot: { type: Object, required: true },
    steuerungAktiv: { type: Boolean, default: false },
})
const emit = defineEmits(['umsetzen'])
// Die zuletzt gerechneten Varianten: {index: Nummer der Eingabekarte, felder: nur gesetzte Felder}.
// Der Server lässt leere Varianten weg — ohne den Index träfe «Variante 1 umsetzen» die Eingabe 2 (Audit UI-10).
const gerechnet = ref([])
const feldFehler = ref([])   // je Eingabekarte die Felder mit ungültigem Text
const ergKurs = ref(null)    // Kurs, mit dem «Wenn jetzt …» gerechnet wurde (nicht der laufende)
const { t, te } = useI18n()

const neu = () => ({ unten: '', oben: '', anzahl: '', art: '', hebel: '', einsatz: '', extraMarge: '', stopLoss: '', takeProfit: '' })
const zeilen = ref([neu()])
const laedt = ref(false)
const fehler = ref('')
const erg = ref(null)
const chartEl = ref(null)
let chart = null

const b = computed(() => props.bot)
const mc = computed(() => erg.value?.einheit || b.value.marginCoin)
const neutral = computed(() => b.value.richtung === 'NEUTRAL')
const istSpot = computed(() => b.value.typ === 'spot_grid')
const einheit = computed(() => mengenEinheit(b.value))
const einsatzHeute = computed(() => b.value.einsatz?.basis ?? b.value.einsatz?.aktuell ?? null)
const stopHeute = (s) => (s && /price/.test(s.art || '') ? s.wert : null)
const platzhalter = computed(() => ({
    unten: preis(b.value.grid?.unten), oben: preis(b.value.grid?.oben), anzahl: String(b.value.grid?.anzahl ?? ''),
    hebel: b.value.hebel ? String(b.value.hebel) : '', einsatz: einsatzHeute.value != null ? String(Number(einsatzHeute.value.toPrecision(6))) : '',
    stopLoss: stopHeute(b.value.stops?.stopLoss) != null ? preis(stopHeute(b.value.stops.stopLoss)) : t('bots.feld.keiner'),
    takeProfit: stopHeute(b.value.stops?.takeProfit) != null ? preis(stopHeute(b.value.stops.takeProfit)) : t('bots.feld.keiner'),
}))
const FELDER = ['unten', 'oben', 'anzahl', 'hebel', 'einsatz', 'extraMarge', 'stopLoss', 'takeProfit']
const zahlAus = (s) => (s === '' || s == null ? '' : Number(String(s).replace(/['\s]/g, '').replace(',', '.')))

// Spot kennt weder Hebel noch Extra-Marge: die Felder fehlen dort und gehen nicht mit
const felderAktiv = computed(() => (istSpot.value ? FELDER.filter((f) => f !== 'hebel' && f !== 'extraMarge') : FELDER))

function plus() { if (zeilen.value.length < 3) zeilen.value.push(neu()) }
function weg(i) { zeilen.value.splice(i, 1); feldFehler.value = [] }
const hatFehler = (i, f) => !!feldFehler.value[i]?.includes(f)
function fehlerWeg(i, f) { if (hatFehler(i, f)) feldFehler.value[i] = feldFehler.value[i].filter((x) => x !== f) }

async function rechne() {
    fehler.value = ''
    // Ungültiger Text («abc», «0.9x») wurde zu NaN → null → der Server nahm still den heutigen Wert
    const eingaben = zeilen.value.map((z) => {
        const v = {}, falsch = []
        for (const f of felderAktiv.value) {
            const x = zahlAus(z[f])
            if (x === '') continue
            if (Number.isFinite(x)) v[f] = x
            else falsch.push(f)
        }
        if (z.art) v.art = z.art
        return { v, falsch }
    })
    feldFehler.value = eingaben.map((x) => x.falsch)
    if (eingaben.some((x) => x.falsch.length)) { fehler.value = t('bots.sim.fehler.keineZahl'); return }
    // Nur gefüllte Karten senden (wie der Server zählt: «Extra-Marge 0» allein ist leer) und ihre Nummer merken
    const gesendet = eingaben.map((x, index) => ({ index, felder: x.v }))
        .filter((x) => Object.entries(x.felder).some(([f, w]) => !(f === 'extraMarge' && w === 0)))
    const kurs = b.value.kurs
    laedt.value = true
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(b.value.id)}/simulation`, { varianten: gesendet.map((x) => x.felder) }, { timeout: 180_000 })
        if (data?.aus) { fehler.value = t('bots.marktAus'); return }
        // Passt die Zahl der Ergebnisse nicht zur Zahl der gesendeten Karten, ist die Zuordnung unbekannt:
        // dann lieber kein «umsetzen» als das falsche
        gerechnet.value = (data?.varianten?.length ?? 0) === gesendet.length ? gesendet : []
        ergKurs.value = kurs
        erg.value = data
        await nextTick()
        zeichne()
        chart?.resize()
    } catch (e) {
        const d = e?.response?.data
        fehler.value = d?.code && te(`bots.sim.fehler.${d.code}`)
            ? t(`bots.sim.fehler.${d.code}`, { n: (gesendet[d.variante ?? 0]?.index ?? d.variante ?? 0) + 1 })
            : (d?.error || e.message)
    } finally {
        laedt.value = false
    }
}
/** Nummer der Eingabekarte zum j-ten Ergebnis (1-basiert); ohne sichere Zuordnung die Position. */
const nummer = (j) => (gerechnet.value[j]?.index ?? j) + 1

/** Kurzbeschreibung einer Einstellung; Hebel/Einsatz nur, wenn anders als heute. */
function name(e, basis = false) {
    const teile = [`${preis(e.unten)} – ${preis(e.oben)}`, `${e.anzahl}${e.art === 'geometric' ? ` ${t('bots.sim.geoKurz')}` : ''}`]
    if (basis || e.hebel !== b.value.hebel) teile.push(`${zahl(e.hebel, 1)}x`)
    if (!basis && e.einsatz != null && einsatzHeute.value != null && Math.abs(e.einsatz - einsatzHeute.value) > 1e-9) teile.push(betrag(e.einsatz, mc.value))
    if (e.extraMarge > 0) teile.push(`+${betrag(e.extraMarge, mc.value)} ${t('bots.sim.margeKurz')}`)
    if (e.stopLoss != null) teile.push(`SL ${preis(e.stopLoss)}`)
    if (e.takeProfit != null) teile.push(`TP ${preis(e.takeProfit)}`)
    return teile.join(' · ')
}
const liqRisiko = (l) => (!l ? null : b.value.richtung === 'SHORT' ? l.oben : (l.unten ?? l.oben))
const reihen = computed(() => {
    if (!erg.value) return []
    return [
        { titel: t('bots.sim.heute'), r: erg.value.basis, basis: true },
        ...erg.value.varianten.map((r, i) => ({ titel: `${t('bots.sim.variante')} ${nummer(i)}`, r })),
    ].filter((x) => x.r)
})
function endeText(r) {
    if (r.liquidation) return `${t('bots.sim.liquidiert')} ${datum(r.liquidation.t)} @ ${preis(r.liquidation.preis)}`
    if (r.ausstieg) return `${t(`bots.feld.${r.ausstieg.art}`)} ${datum(r.ausstieg.t)} @ ${preis(r.ausstieg.preis)}`
    return t('bots.sim.laeuft')
}

function zeichne() {
    if (!chartEl.value || !erg.value) return
    const p = palette()
    if (!chart) chart = echarts.init(chartEl.value)
    // Heute grau gestrichelt, Varianten in drei klar verschiedenen Farben
    const farben = [p.muted, p.accent, p.warn, p.text]
    chart.setOption({
        ...grundOption(p),
        grid: { left: 8, right: 16, top: 30, bottom: 24, containLabel: true },
        legend: { top: 0, type: 'scroll', textStyle: schrift(p) },
        tooltip: { trigger: 'axis', ...tooltipStil(p), valueFormatter: (v) => betrag(v, mc.value) },
        xAxis: { type: 'time', axisLabel: { ...schrift(p) }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: { ...wertAchse(p), scale: true },
        series: reihen.value.map((x, i) => ({
            name: x.titel, type: 'line', showSymbol: false, data: x.r.kurve,
            lineStyle: { color: farben[i % farben.length], width: x.basis ? 1.5 : 2, type: x.basis ? 'dashed' : 'solid' },
            itemStyle: { color: farben[i % farben.length] },
        })),
    }, true)
}
/** Eine Variante von aussen übernehmen (KI-Vorschlag) und gleich rechnen. */
function uebernehme(v) {
    const z = neu()
    for (const f of FELDER) if (v?.[f] != null) z[f] = String(v[f])
    if (v?.art) z.art = v.art
    zeilen.value = [z]
    feldFehler.value = []
    rechne()
}
defineExpose({ uebernehme })

const groesse = () => chart?.resize()
window.addEventListener('resize', groesse)
onBeforeUnmount(() => { window.removeEventListener('resize', groesse); chart?.dispose(); chart = null })
</script>

<template>
    <div class="sim">
        <p class="erklaerung">{{ t('bots.sim.erklaerung') }}</p>

        <div v-for="(z, i) in zeilen" :key="i" class="variante">
            <div class="varKopf">
                <span>{{ t('bots.sim.variante') }} {{ i + 1 }}</span>
                <Knopf v-if="zeilen.length > 1" art="leise" symbol="schliessen" nur-symbol klein :titel="t('bots.sim.entfernen')" @click="weg(i)" />
            </div>
            <div class="felder">
                <label><span>{{ t('bots.sim.unten') }}</span><input v-model="z.unten" class="at-feld" :class="{ falsch: hatFehler(i, 'unten') }" :aria-invalid="hatFehler(i, 'unten')" @input="fehlerWeg(i, 'unten')" inputmode="decimal" :placeholder="platzhalter.unten"></label>
                <label><span>{{ t('bots.sim.oben') }}</span><input v-model="z.oben" class="at-feld" :class="{ falsch: hatFehler(i, 'oben') }" :aria-invalid="hatFehler(i, 'oben')" @input="fehlerWeg(i, 'oben')" inputmode="decimal" :placeholder="platzhalter.oben"></label>
                <label><span>{{ t('bots.feld.grids') }}</span><input v-model="z.anzahl" class="at-feld" :class="{ falsch: hatFehler(i, 'anzahl') }" :aria-invalid="hatFehler(i, 'anzahl')" @input="fehlerWeg(i, 'anzahl')" inputmode="numeric" :placeholder="platzhalter.anzahl"></label>
                <label><span>{{ t('bots.feld.art') }}</span>
                    <select v-model="z.art" class="at-feld">
                        <option value="">{{ t('bots.sim.wieHeute') }}</option>
                        <option value="arithmetic">{{ t('bots.sim.arithmetisch') }}</option>
                        <option value="geometric">{{ t('bots.sim.geometrisch') }}</option>
                    </select>
                </label>
                <label v-if="!istSpot"><span>{{ t('bots.feld.hebel') }}</span><input v-model="z.hebel" class="at-feld" :class="{ falsch: hatFehler(i, 'hebel') }" :aria-invalid="hatFehler(i, 'hebel')" @input="fehlerWeg(i, 'hebel')" inputmode="decimal" :placeholder="platzhalter.hebel"></label>
                <label><span>{{ t('bots.feld.einsatz') }} ({{ b.marginCoin }})</span><input v-model="z.einsatz" class="at-feld" :class="{ falsch: hatFehler(i, 'einsatz') }" :aria-invalid="hatFehler(i, 'einsatz')" @input="fehlerWeg(i, 'einsatz')" inputmode="decimal" :placeholder="platzhalter.einsatz"></label>
                <label v-if="!istSpot"><span>{{ t('bots.sim.extraMargePlus') }} ({{ b.marginCoin }})</span><input v-model="z.extraMarge" class="at-feld" :class="{ falsch: hatFehler(i, 'extraMarge') }" :aria-invalid="hatFehler(i, 'extraMarge')" @input="fehlerWeg(i, 'extraMarge')" inputmode="decimal" placeholder="0"></label>
                <label><span>{{ t('bots.feld.stopLoss') }}</span><input v-model="z.stopLoss" class="at-feld" :class="{ falsch: hatFehler(i, 'stopLoss') }" :aria-invalid="hatFehler(i, 'stopLoss')" @input="fehlerWeg(i, 'stopLoss')" inputmode="decimal" :placeholder="platzhalter.stopLoss" :disabled="neutral"></label>
                <label><span>{{ t('bots.feld.takeProfit') }}</span><input v-model="z.takeProfit" class="at-feld" :class="{ falsch: hatFehler(i, 'takeProfit') }" :aria-invalid="hatFehler(i, 'takeProfit')" @input="fehlerWeg(i, 'takeProfit')" inputmode="decimal" :placeholder="platzhalter.takeProfit" :disabled="neutral"></label>
            </div>
            <p v-if="feldFehler[i]?.length" class="feldFehler" role="alert">{{ t('bots.sim.keineZahl') }}</p>
        </div>
        <div class="knoepfe">
            <Knopf v-if="zeilen.length < 3" art="leise" symbol="plus" klein @click="plus">{{ t('bots.sim.weitere') }}</Knopf>
            <Knopf art="haupt" symbol="play" :laedt="laedt" @click="rechne">{{ t('bots.sim.rechnen') }}</Knopf>
        </div>
        <p v-if="laedt" class="leise laedt">{{ t('bots.sim.laedtKerzen') }}</p>
        <p class="leise">{{ t(istSpot ? 'bots.sim.mengeHinweisSpot' : 'bots.sim.mengeHinweis') }}</p>

        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <template v-if="erg">
            <Hinweis art="warn" :titel="t('bots.sim.rueckblickTitel')">{{ t('bots.sim.rueckblick') }}</Hinweis>

            <p class="leise">
                {{ t('bots.sim.zeitraum', { von: datum(erg.von), bis: datum(erg.bis), tf: erg.zeitrahmen, n: zahl(erg.kerzenAnzahl) }) }}
                <template v-if="!istSpot">· {{ erg.hinweise.fundingSimuliert ? t('bots.sim.mitFunding') : t('bots.sim.ohneFunding') }}<template v-if="erg.hinweise.fundingSimuliert && b.coinM"> {{ t('bots.sim.fundingGenaehert') }}</template>
                · {{ t('bots.sim.mmr', { mmr: prozent(erg.mmr, { stellen: 2 }), quelle: t(`bots.sim.mmrQuelle.${erg.mmrQuelle || 'pauschal'}`) }) }}</template>
            </p>

            <div class="tabelleRahmen">
                <table class="tabelle stapelbar">
                    <thead>
                        <tr>
                            <th></th><th>{{ t('bots.sim.einstellung') }}</th><th>{{ t('bots.sim.ergebnis') }}</th><th>{{ t('bots.feld.gridGewinn') }}</th>
                            <th v-if="!istSpot">{{ t('bots.feld.funding') }}</th><th>{{ t('bots.feld.zyklen') }}</th><th>{{ t('bots.feld.zeitImBand') }}</th>
                            <th>{{ t('bots.sim.maxVerlust') }}</th><th>{{ t('bots.sim.positionEnde') }}</th><th v-if="!istSpot">{{ t('bots.sim.liqEnde') }}</th><th>{{ t('bots.sim.ende') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="x in reihen" :key="x.titel" :class="{ basis: x.basis }">
                            <th>{{ x.titel }}</th>
                            <td :data-label="t('bots.sim.einstellung')">{{ name(x.r.einstellung, x.basis) }}</td>
                            <td :data-label="t('bots.sim.ergebnis')" :class="ton(x.r.gesamt, mc)">{{ betrag(x.r.gesamt, mc, { vorzeichen: true }) }}</td>
                            <td :data-label="t('bots.feld.gridGewinn')">{{ betrag(x.r.gridGewinn, mc, { vorzeichen: true }) }}</td>
                            <td v-if="!istSpot" :data-label="t('bots.feld.funding')" :class="ton(x.r.funding, mc)">{{ erg.hinweise.fundingSimuliert ? betrag(x.r.funding, mc, { vorzeichen: true }) : '—' }}</td>
                            <td :data-label="t('bots.feld.zyklen')">{{ zahl(x.r.zyklen) }}</td>
                            <td :data-label="t('bots.feld.zeitImBand')">{{ prozent(x.r.zeitImBand, { stellen: 0 }) }}</td>
                            <td :data-label="t('bots.sim.maxVerlust')">{{ betrag(x.r.maxVerlust, mc) }}</td>
                            <td :data-label="t('bots.sim.positionEnde')">{{ menge(x.r.position, einheit) }}</td>
                            <td v-if="!istSpot" :data-label="t('bots.sim.liqEnde')">{{ preis(liqRisiko(x.r.liqSchaetzung)) }}</td>
                            <td :data-label="t('bots.sim.ende')" :class="{ schlecht: x.r.liquidation }">{{ endeText(x.r) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="steuerungAktiv && gerechnet.length" class="knoepfe">
                <Knopf v-for="g in gerechnet" :key="g.index" klein symbol="hochladen" @click="emit('umsetzen', { ...g.felder })">{{ t('bots.sim.umsetzen', { n: g.index + 1 }) }}</Knopf>
            </div>

            <div ref="chartEl" class="chart"></div>

            <div class="eichung" :class="{ unsicher: erg.eichung.unsicher }">
                <h4>{{ t('bots.sim.eichungTitel') }}</h4>
                <p>
                    {{ t(erg.hinweise.fundingSimuliert ? 'bots.sim.eichungTextMitFunding' : 'bots.sim.eichungText', {
                        sim: betrag(erg.eichung.simuliert, mc, { vorzeichen: true }),
                        echt: betrag(erg.eichung.echt, mc, { vorzeichen: true }),
                        diff: betrag(erg.eichung.abweichung, mc, { vorzeichen: true }),
                        anteil: prozent(erg.eichung.abweichungAnteil),
                    }) }}
                </p>
                <div class="tabelleRahmen">
                    <table class="tabelle klein stapelbar">
                        <thead><tr><th></th><th>{{ t('bots.sim.simuliert') }}</th><th>Pionex</th></tr></thead>
                        <tbody>
                            <tr><th>{{ t('bots.feld.zyklen') }}</th><td :data-label="t('bots.sim.simuliert')">{{ zahl(erg.eichung.zyklenSim) }}</td><td data-label="Pionex">{{ zahl(erg.eichung.zyklenEcht) }}</td></tr>
                            <tr><th>{{ t('bots.feld.gridGewinn') }}</th><td :data-label="t('bots.sim.simuliert')">{{ betrag(erg.eichung.gridSim, mc) }}</td><td data-label="Pionex">{{ betrag(erg.eichung.gridEcht, mc) }}</td></tr>
                            <tr v-if="erg.eichung.fundingSim != null"><th>{{ t('bots.feld.funding') }}</th><td :data-label="t('bots.sim.simuliert')">{{ betrag(erg.eichung.fundingSim, mc) }}</td><td data-label="Pionex">{{ betrag(erg.eichung.fundingEcht, mc) }}</td></tr>
                            <tr v-if="erg.eichung.positionEcht != null"><th>{{ t('bots.feld.position') }}</th><td :data-label="t('bots.sim.simuliert')">{{ menge(erg.eichung.positionSim, einheit) }}</td><td data-label="Pionex">{{ menge(erg.eichung.positionEcht, einheit) }}</td></tr>
                            <tr v-if="!istSpot && erg.eichung.liqEcht != null"><th>{{ t('bots.feld.liquidation') }}</th><td :data-label="t('bots.sim.simuliert')">{{ preis(erg.eichung.liqSim) }}</td><td data-label="Pionex">{{ preis(erg.eichung.liqEcht) }}</td></tr>
                        </tbody>
                    </table>
                </div>
                <p class="leise">{{ t('bots.sim.eichungMessung') }}</p>
                <p v-if="erg.eichung.unsicher" class="warnung">{{ t('bots.sim.eichungUnsicher') }}</p>
            </div>

            <div v-if="erg.abJetzt?.length" class="abJetzt">
                <h4>{{ t('bots.sim.abJetztTitel', { kurs: preis(ergKurs ?? b.kurs) }) }}</h4>
                <div class="tabelleRahmen">
                    <table class="tabelle stapelbar">
                        <thead><tr>
                            <th></th><th>{{ t('bots.sim.positionJetzt') }}</th><th>{{ t('bots.sim.positionNeu') }}</th><th>{{ t('bots.sim.geschlossen') }}</th>
                            <th>{{ t('bots.sim.realisiertCa') }}</th><template v-if="!istSpot"><th>{{ t('bots.sim.liqHeute') }}</th><th>{{ t('bots.sim.liqNeu') }}</th></template>
                        </tr></thead>
                        <tbody>
                            <tr v-for="(a, i) in erg.abJetzt" :key="i">
                                <th>{{ t('bots.sim.variante') }} {{ nummer(i) }}</th>
                                <td :data-label="t('bots.sim.positionJetzt')">{{ menge(a.aktuell, einheit) }}</td>
                                <td :data-label="t('bots.sim.positionNeu')">{{ menge(a.ziel, einheit) }}</td>
                                <td :data-label="t('bots.sim.geschlossen')">{{ prozent(a.geschlossenAnteil, { stellen: 0 }) }}</td>
                                <td :data-label="t('bots.sim.realisiertCa')" :class="ton(a.realisiertCa, mc)">{{ betrag(a.realisiertCa, mc, { vorzeichen: true }) }}</td>
                                <template v-if="!istSpot">
                                <td :data-label="t('bots.sim.liqHeute')">{{ preis(a.liqHeute) }}</td>
                                <td :data-label="t('bots.sim.liqNeu')">{{ preis(a.liqNeu) }}</td>
                                </template>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="leise">{{ t(istSpot ? 'bots.sim.abJetztHinweisSpot' : 'bots.sim.abJetztHinweis') }}</p>
            </div>
        </template>
    </div>
</template>

<style scoped>
.sim { display: flex; flex-direction: column; gap: var(--abstand-3); min-width: 0; }
.sim > * { min-width: 0; max-width: 100%; }
.erklaerung { margin: 0; color: var(--muted); font-size: 0.9rem; }
.variante { border: 1px solid var(--line); border-radius: var(--radius); padding: var(--abstand-2) var(--abstand-3) var(--abstand-3); }
.varKopf { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--muted); font-weight: 600; margin-bottom: var(--abstand-2); min-height: 28px; }
.felder { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--abstand-2) var(--abstand-3); }
.felder label { display: flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--muted); min-width: 0; }
.felder .at-feld { width: 100%; min-width: 0; }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; flex-wrap: wrap; }
.leise { color: var(--muted); font-size: 0.8rem; margin: 0; }
.tabelleRahmen { overflow-x: auto; }
.tabelle { width: 100%; border-collapse: collapse; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.tabelle.klein { width: auto; min-width: 60%; }
.tabelle th, .tabelle td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.tabelle th:first-child, .tabelle td:nth-child(2) { text-align: left; }
.tabelle.klein td:nth-child(2) { text-align: right; }
.tabelle thead th { color: var(--muted); font-weight: 500; font-size: 0.75rem; }
.tabelle tr.basis { color: var(--muted); }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.chart { width: 100%; height: 260px; }
.eichung, .abJetzt { padding: var(--abstand-3); border-radius: var(--radius); background: var(--panel-soft); display: flex; flex-direction: column; gap: var(--abstand-2); }
.eichung h4, .abJetzt h4 { margin: 0; font-size: 0.9rem; }
.eichung p { margin: 0; font-size: 0.88rem; }
.eichung.unsicher { border: 1px solid var(--warn); }
.warnung { color: var(--warn); }
.laedt { text-align: right; color: var(--accent); }
.felder .at-feld.falsch { border-color: var(--bad); }
.feldFehler { margin: var(--abstand-2) 0 0; color: var(--bad); font-size: 0.8rem; }
.felder .at-feld::placeholder { color: var(--leise); font-style: italic; opacity: 1; }
@media (max-width: 700px) {
    .felder { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    /* Tabellen am Telefon als gestapelte Karten: eine Zeile = ein Block, Spaltenname links */
    .tabelle.stapelbar thead { display: none; }
    .tabelle.stapelbar, .tabelle.stapelbar tbody, .tabelle.stapelbar tr { display: block; width: 100%; min-width: 0; }
    .tabelle.stapelbar tr { padding: var(--abstand-2) 0; border-bottom: 1px solid var(--line-stark); }
    .tabelle.stapelbar th { display: block; text-align: left; border: 0; padding: 2px 0 4px; }
    .tabelle.stapelbar td { display: flex; justify-content: space-between; gap: var(--abstand-3); border: 0; padding: 2px 0; white-space: normal; text-align: right; }
    .tabelle.stapelbar td::before { content: attr(data-label); color: var(--muted); text-align: left; flex: 0 0 auto; }
    .tabelle.stapelbar td:nth-child(2) { text-align: right; }
}
</style>
