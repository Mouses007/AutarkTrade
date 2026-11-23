<script setup>
/**
 * KI-Vorschläge für einen laufenden Grid-Bot (POST /api/bots/:id/ki, bot-ki.js).
 * Der Code rechnet die Kandidaten, die KI wählt höchstens drei und begründet.
 * Jede Zahl hier stammt aus der Simulation, nicht von der KI.
 *
 * Warnblock im Wortlaut des Entwicklers (11.11.2026) und „Vorschlag" statt
 * „Empfehlung" (rechtliche Recherche). Kennzeichnung data-ki-generiert.
 */
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Pille from '@/components/basis/Pille.vue'
import { preis, betrag, prozent, datum, ton } from './format.js'

const props = defineProps({
    bot: { type: Object, required: true },
    steuerungAktiv: { type: Boolean, default: false },
    stand: { type: String, default: '' },   // ändert sich, wenn der Bot anders eingestellt ist (BotDetail `einstellungStand`)
})
const emit = defineEmits(['inSimulation', 'umsetzen'])
const { t, locale } = useI18n()

const erg = ref(null)
const laedt = ref(false)
const fehler = ref('')
const mc = computed(() => props.bot.marginCoin)
const heute = computed(() => erg.value?.eichung?.simuliert ?? null)
// Die Vorschläge wurden für einen anderen Stand des Bots gerechnet (nach einer Aktion verwirft der Server
// seinen Cache, die Karte zeigte sie weiter — mit «Umsetzen»): kennzeichnen und nicht mehr umsetzen lassen
const veraltet = ref(false)

// Ziel und Idee (21.11.2026): der Code baut die Kandidaten für das gewählte Ziel, die Idee geht in den Auftrag
// an die KI. Das Ziel gilt für alle Bots (gemerkt), die Idee je Bot.
const ZIELE = ['offen', 'absichern', 'aufstocken', 'verlust', 'ertrag', 'abwarten', 'aussteigen']
const merk = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch { /* ohne Speicher */ } return null }
const ziel = ref(ZIELE.includes(merk('at.bots.kiZiel')) ? merk('at.bots.kiZiel') : 'offen')
const ideeSchluessel = () => `at.bots.kiIdee.${props.bot.id}`
const idee = ref(merk(ideeSchluessel()) || '')
watch(ziel, (z) => merk('at.bots.kiZiel', z))
watch(idee, (i) => merk(ideeSchluessel(), i.slice(0, 400)))

async function ladeCache() {
    try { erg.value = (await axios.get(`/api/bots/${encodeURIComponent(props.bot.id)}/ki`)).data?.ergebnis || null } catch { erg.value = null }
}
async function erzeuge() {
    laedt.value = true
    fehler.value = ''
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/ki`, { sprache: locale.value, ziel: ziel.value, idee: idee.value }, { timeout: 180_000 })
        if (data?.aus) { fehler.value = t('bots.marktAus'); return }
        erg.value = data.ergebnis
        veraltet.value = false
    } catch (e) {
        // Ohne Antwort (Zeitlimit) kann der Server trotzdem fertig geworden sein: Cache lesen
        if (!e?.response) { await ladeCache(); if (erg.value) return }
        const d = e?.response?.data
        fehler.value = d?.code === 'kiWarten' ? t('bots.ki.warten', { s: d.sekunden }) : (d?.error || e.message)
    } finally {
        laedt.value = false
    }
}
onMounted(ladeCache)
watch(() => props.bot.id, () => { erg.value = null; veraltet.value = false; idee.value = merk(ideeSchluessel()) || ''; ladeCache() })
watch(() => props.stand, (neu, alt) => { if (erg.value && alt && neu !== alt) veraltet.value = true })

// Was der Code aus der Idee gerechnet hat — steht da, auch wenn die KI es nicht aufgreift
const ideeZeilen = computed(() => (erg.value?.kandidaten || []).filter((c) => c.gruppe === 'idee'))
const liqHeute = computed(() => (erg.value?.kandidaten || []).find((c) => c.abJetzt?.liqHeute != null)?.abJetzt.liqHeute ?? null)
const nachschuss = (c) => (c.abJetzt?.zusatz || 0) + (c.variante.extraMarge || 0)
const beiKursText = (b) => (!b ? '—' : `${betrag(b.aenderung, mc.value, { vorzeichen: true })}${b.liquidiert ? ` · ${t('bots.ki.ideeLiquidiert')}` : b.ausstieg ? ` · ${t('bots.ki.ideeBeendet')}` : ''}`)
const abstand = (a) => (a?.liqNeu != null && props.bot.kurs ? Math.abs(props.bot.kurs - a.liqNeu) / props.bot.kurs : null)
</script>

<template>
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

        <p class="leise">{{ t('bots.ki.erklaerung') }}</p>
        <p class="leise">{{ t('bots.ki.zrErklaerung') }}</p>
        <div class="zielWahl">
            <h5 id="kiZielTitel">{{ t('bots.ki.zielTitel') }}</h5>
            <div class="wahl" role="group" aria-labelledby="kiZielTitel">
                <button v-for="z in ZIELE" :key="z" type="button" :class="{ an: ziel === z }" :aria-pressed="ziel === z" :disabled="laedt" @click="ziel = z">{{ t(`bots.ki.ziel.${z}`) }}</button>
            </div>
            <p class="leise">{{ t(`bots.ki.zielText.${ziel}`) }}</p>
            <label class="idee"><span>{{ t('bots.ki.ideeTitel') }}</span>
                <textarea v-model="idee" class="at-feld" rows="2" maxlength="400" :placeholder="t('bots.ki.ideePlatz')" :disabled="laedt"></textarea>
                <small class="leise">{{ t('bots.ki.ideeText') }}</small>
            </label>
        </div>

        <div class="knoepfe">
            <span v-if="erg" class="leise">{{ t('bots.ki.stand', { zeit: datum(erg.zeit), modell: erg.modell || erg.anbieter }) }}</span>
            <Knopf art="haupt" symbol="ki" :laedt="laedt" @click="erzeuge">{{ erg ? t('bots.ki.neu') : t('bots.ki.erzeugen') }}</Knopf>
        </div>
        <p v-if="laedt" class="leise laedt">{{ t('bots.ki.laedt') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <template v-if="erg">
            <Hinweis v-if="veraltet" art="warn">{{ t('bots.ki.veraltet') }}</Hinweis>
            <div class="kopf">
                <Pille ton="akzent" symbol="ki">{{ t('bots.ki.kennzeichnung') }}</Pille>
                <span v-if="erg.kurs" class="leise">{{ t('bots.ki.kursStand', { kurs: preis(erg.kurs) }) }}</span>
            </div>
            <p v-if="erg.ziel" class="leise zielStand"><span>{{ t('bots.ki.zielStand', { ziel: t(`bots.ki.ziel.${erg.ziel}`) }) }}</span><span v-if="erg.idee">{{ t('bots.ki.ideeStand', { idee: erg.idee }) }}</span></p>
            <section v-if="erg.idee" class="ideeBlock" data-ki-generiert="true">
                <h5>{{ t('bots.ki.ideeAntwort') }}</h5>
                <p v-if="erg.antwort" class="lage">{{ erg.antwort }}</p>
                <p v-if="erg.antwortUnbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: erg.antwortUnbelegt.join(', ') }) }}</p>
                <template v-if="ideeZeilen.length || erg.szenario">
                    <h6>{{ t('bots.ki.ideeGerechnet') }}</h6>
                    <div class="tabelleRahmen">
                        <table class="tabelle">
                            <thead><tr>
                                <th>{{ t('bots.sim.einstellung') }}</th><th>{{ t('bots.ki.nachschiessen') }}</th><th>{{ t('bots.sim.liqNeu') }}</th>
                                <th v-for="k in erg.szenario?.kurse || []" :key="k">{{ t('bots.ki.ideeBeiKurs', { kurs: preis(k) }) }}</th><th></th>
                            </tr></thead>
                            <tbody>
                                <tr v-if="erg.szenario?.heute">
                                    <td>{{ t('bots.ki.ideeHeute') }}</td><td>—</td><td>{{ preis(liqHeute) }}</td>
                                    <td v-for="(b, i) in erg.szenario.heute" :key="i" :class="ton(b.aenderung, mc)">{{ beiKursText(b) }}</td><td></td>
                                </tr>
                                <tr v-for="c in ideeZeilen" :key="c.id">
                                    <td>{{ c.titel.replace(/^Deine Idee: /, '') }}</td>
                                    <td>{{ nachschuss(c) > 0 ? betrag(nachschuss(c), mc) : '—' }}</td>
                                    <td>{{ preis(c.abJetzt?.liqNeu) }} <span v-if="c.abJetzt?.liqNeu != null" class="leise">({{ prozent(abstand(c.abJetzt)) }})</span></td>
                                    <td v-for="(k, i) in erg.szenario?.kurse || []" :key="k" :class="ton(c.abJetzt?.beiKurs?.[i]?.aenderung, mc)">{{ beiKursText(c.abJetzt?.beiKurs?.[i]) }}</td>
                                    <td class="zeilenKnoepfe">
                                        <Knopf v-if="!c.variante.aktion" art="leise" symbol="rechner" klein nurSymbol :titel="t('bots.ki.inSimulation')" @click="emit('inSimulation', c.variante)" />
                                        <Knopf v-if="steuerungAktiv && !veraltet" art="leise" symbol="hochladen" klein nurSymbol :titel="t('bots.ki.umsetzen')" @click="emit('umsetzen', c.variante)" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p v-if="erg.szenario" class="leise">{{ t('bots.ki.ideeSzenarioHinweis') }}</p>
                </template>
                <ul v-if="erg.ideeNicht?.length" class="leise nicht">
                    <li v-for="(n, i) in erg.ideeNicht" :key="i">{{ t('bots.ki.ideeNicht', { was: n.was, grund: n.text }) }}</li>
                </ul>
                <p v-if="erg.ideeGelesen === false" class="leise">{{ t('bots.ki.ideeUngelesen') }}</p>
                <p v-else-if="!ideeZeilen.length && !erg.szenario && !erg.ideeNicht?.length" class="leise">{{ t('bots.ki.ideeNichts') }}</p>
            </section>
            <p v-if="erg.lage" class="lage">{{ erg.lage }}</p>
            <p v-if="erg.lageUnbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: erg.lageUnbelegt.join(', ') }) }}</p>

            <div v-if="erg.zeitrahmen" class="zr">
                <h5>{{ t('bots.ki.zrTitel') }}</h5>
                <div class="tabelleRahmen">
                    <table class="tabelle">
                        <thead><tr><th></th><th>{{ t('chart.ki.spalteStruktur') }}</th><th>{{ t('bots.ki.zrBruch') }}</th><th>{{ t('chart.ki.spalteLage') }}</th><th>{{ t('chart.ki.spalteMomentum') }}</th></tr></thead>
                        <tbody>
                            <tr v-for="z in erg.zeitrahmen.tabelle" :key="z.tf">
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
                <p v-if="erg.zeitrahmen.marken.length" class="leise niveaus">
                    {{ t('bots.ki.zrNiveaus') }}:
                    <span v-for="m in erg.zeitrahmen.marken" :key="m.id" :class="{ treffen: erg.zeitrahmen.treffen.some((c) => c.ids.includes(m.id)) }">{{ m.id }} {{ m.tf }} {{ preis(m.preis) }}</span>
                </p>
                <p v-if="erg.zeitrahmen.treffen.length" class="leise niveaus">
                    {{ t('bots.ki.zrTreffen') }}:
                    <span v-for="c in erg.zeitrahmen.treffen" :key="c.id" class="treffen">{{ c.id }} {{ preis(c.preis) }} ({{ c.quellen.join(' + ') }})</span>
                </p>
            </div>

            <p v-if="!erg.vorschlaege.length" class="leise">{{ t('bots.ki.keine') }}</p>
            <article v-for="(v, i) in erg.vorschlaege" :key="v.id" class="vorschlag">
                <header>
                    <span class="nr">{{ t('bots.ki.vorschlag') }} {{ i + 1 }}</span>
                    <h4>{{ v.titel }}</h4>
                    <span class="code">{{ v.codeTitel }}</span>
                </header>
                <dl class="zahlen">
                    <div v-if="v.abJetzt?.zusatz > 0"><dt>{{ t('bots.ki.nachschiessen') }}</dt><dd>{{ betrag(v.abJetzt.zusatz, mc) }}</dd></div>
                    <div v-if="v.variante.extraMarge"><dt>{{ t('bots.sim.extraMargePlus') }}</dt><dd>{{ betrag(v.variante.extraMarge, mc) }}</dd></div>
                    <div v-if="v.variante.aktion"><dt>{{ t('bots.ki.eingriff') }}</dt><dd>{{ v.codeTitel }}</dd></div>
                    <div><dt>{{ t('bots.sim.liqNeu') }}</dt><dd>{{ preis(v.abJetzt?.liqNeu) }} <span v-if="v.abJetzt?.liqNeu != null" class="leise">({{ prozent(abstand(v.abJetzt)) }})</span></dd></div>
                    <div><dt>{{ t('bots.sim.geschlossen') }}</dt><dd>{{ prozent(v.abJetzt?.geschlossenAnteil, { stellen: 0 }) }}</dd></div>
                    <div><dt>{{ t('bots.sim.realisiertCa') }}</dt><dd :class="ton(v.abJetzt?.realisiertCa, mc)">{{ betrag(v.abJetzt?.realisiertCa, mc, { vorzeichen: true }) }}</dd></div>
                    <div><dt>{{ t('bots.ki.rueckblick') }}</dt><dd :class="ton(v.rueckblick?.gesamt, mc)">{{ betrag(v.rueckblick?.gesamt, mc, { vorzeichen: true }) }} <span class="leise">{{ t('bots.ki.stattHeute', { wert: betrag(heute, mc, { vorzeichen: true }) }) }}</span></dd></div>
                </dl>
                <p>{{ v.begruendung }}</p>
                <p class="risiko"><strong>{{ t('bots.ki.risiko') }}:</strong> {{ v.risiko }}</p>
                <p class="risiko"><strong>{{ t('bots.ki.passtNicht') }}:</strong> {{ v.passtNichtWenn }}</p>
                <p v-if="v.unbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: v.unbelegt.join(', ') }) }}</p>
                <div class="knoepfe">
                    <Knopf v-if="!v.variante.aktion" art="leise" symbol="rechner" klein @click="emit('inSimulation', v.variante)">{{ t('bots.ki.inSimulation') }}</Knopf>
                    <Knopf v-if="steuerungAktiv && !veraltet && v.variante.aktion !== 'nichts'" symbol="hochladen" klein @click="emit('umsetzen', v.variante)">{{ t('bots.ki.umsetzen') }}</Knopf>
                </div>
            </article>
            <p v-if="erg.hinweis" class="leise">{{ erg.hinweis }}</p>

            <details class="alle">
                <summary>{{ t('bots.ki.alleKandidaten', { n: erg.kandidaten.length }) }}</summary>
                <div class="tabelleRahmen">
                    <table class="tabelle">
                        <thead><tr><th>ID</th><th>{{ t('bots.sim.einstellung') }}</th><th>{{ t('bots.ki.rueckblick') }}</th><th>{{ t('bots.ki.nachschiessen') }}</th><th>{{ t('bots.sim.realisiertCa') }}</th><th>{{ t('bots.sim.liqNeu') }}</th><th></th></tr></thead>
                        <tbody>
                            <tr v-for="c in erg.kandidaten" :key="c.id" :class="{ gewaehlt: erg.vorschlaege.some((v) => v.id === c.id) }">
                                <th>{{ c.id }}</th><td>{{ c.titel }}</td>
                                <td :class="ton(c.rueckblick?.gesamt, mc)">{{ betrag(c.rueckblick?.gesamt, mc, { vorzeichen: true }) }}</td>
                                <td>{{ c.abJetzt?.zusatz > 0 ? betrag(c.abJetzt.zusatz, mc) : '—' }}</td>
                                <td>{{ betrag(c.abJetzt?.realisiertCa, mc, { vorzeichen: true }) }}</td>
                                <td>{{ preis(c.abJetzt?.liqNeu) }}</td>
                                <td class="zeilenKnoepfe">
                                    <template v-if="c.variante">
                                        <Knopf v-if="!c.variante.aktion" art="leise" symbol="rechner" klein nurSymbol :titel="t('bots.ki.inSimulation')" @click="emit('inSimulation', c.variante)" />
                                        <Knopf v-if="steuerungAktiv && !veraltet && c.variante.aktion !== 'nichts'" art="leise" symbol="hochladen" klein nurSymbol :titel="t('bots.ki.umsetzen')" @click="emit('umsetzen', c.variante)" />
                                    </template>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
        </template>
    </div>
</template>

<style scoped>
.ki { display: flex; flex-direction: column; gap: var(--abstand-3); min-width: 0; }
.zielWahl { display: flex; flex-direction: column; gap: var(--abstand-2); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--abstand-3); }
.zielWahl h5 { margin: 0; font-size: 0.9rem; }
.wahl { display: flex; gap: 4px; flex-wrap: wrap; }
.wahl button { flex: 1 1 auto; border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: var(--radius-klein); padding: 7px 10px; font: inherit; font-size: 0.85rem; cursor: pointer; white-space: nowrap; }
.wahl button:hover:not(:disabled):not(.an) { border-color: var(--muted); }
.wahl button:disabled { opacity: 0.5; cursor: default; }
.wahl button.an { border-color: var(--accent); background: var(--accent-flaeche); color: var(--accent); font-weight: 600; }
.ideeBlock { display: flex; flex-direction: column; gap: var(--abstand-2); border: 1px solid var(--accent); border-radius: var(--radius); padding: var(--abstand-3); min-width: 0; }
.ideeBlock h5, .ideeBlock h6 { margin: 0; font-size: 0.9rem; }
.ideeBlock h6 { font-size: 0.8rem; color: var(--muted); }
.ideeBlock .nicht { margin: 0; padding-left: 1.1rem; }
.zielStand { display: flex; flex-wrap: wrap; gap: 0 0.5em; }
.idee { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--muted); }
.idee textarea { resize: vertical; font-size: 0.9rem; min-height: 3.2rem; }
.ki > * { min-width: 0; max-width: 100%; }
.warnliste { margin: 0; padding-left: 1.1em; }
.warnfuss { margin: var(--abstand-1) 0 0; }
.leise { color: var(--muted); font-size: 0.8rem; margin: 0; }
.laedt { text-align: right; color: var(--accent); }
.knoepfe { display: flex; gap: var(--abstand-2); justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.kopf { display: flex; gap: var(--abstand-2); align-items: center; flex-wrap: wrap; }
.lage { margin: 0; line-height: 1.5; }
.zr { display: flex; flex-direction: column; gap: var(--abstand-2); }
.zr h5 { margin: 0; color: var(--muted); font-size: 0.8rem; font-weight: 600; }
.niveaus { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.niveaus .treffen { color: var(--accent); }
.vorschlag { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--radius); padding: var(--abstand-3); display: flex; flex-direction: column; gap: var(--abstand-2); }
.vorschlag header { display: flex; flex-direction: column; gap: 2px; }
.vorschlag .nr { color: var(--muted); font-size: 0.75rem; font-weight: 600; }
.vorschlag h4 { margin: 0; font-size: 1rem; }
.vorschlag .code { color: var(--muted); font-size: 0.8rem; }
.vorschlag p { margin: 0; font-size: 0.9rem; line-height: 1.5; }
.risiko { color: var(--muted); }
.unbelegt { color: var(--warn); font-size: 0.82rem; margin: 0; }
.zahlen { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--abstand-2) var(--abstand-3); margin: 0; }
.zahlen dt { color: var(--muted); font-size: 0.75rem; }
.zahlen dd { margin: 0; font-variant-numeric: tabular-nums; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.alle summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
.tabelleRahmen { overflow-x: auto; margin-top: var(--abstand-2); }
.tabelle { width: 100%; border-collapse: collapse; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.tabelle th, .tabelle td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.tabelle th:first-child, .tabelle td:nth-child(2) { text-align: left; }
.tabelle thead th { color: var(--muted); font-weight: 500; }
.tabelle td.zeilenKnoepfe { padding-top: 2px; padding-bottom: 2px; }
.tabelle td.zeilenKnoepfe > * + * { margin-left: 4px; }
.tabelle tr.gewaehlt { background: var(--accent-flaeche); }
</style>
