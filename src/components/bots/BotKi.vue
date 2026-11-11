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
})
const emit = defineEmits(['inSimulation', 'umsetzen'])
const { t, locale } = useI18n()

const erg = ref(null)
const laedt = ref(false)
const fehler = ref('')
const mc = computed(() => props.bot.marginCoin)
const heute = computed(() => erg.value?.eichung?.simuliert ?? null)

async function ladeCache() {
    try { erg.value = (await axios.get(`/api/bots/${encodeURIComponent(props.bot.id)}/ki`)).data?.ergebnis || null } catch { erg.value = null }
}
async function erzeuge() {
    laedt.value = true
    fehler.value = ''
    try {
        const { data } = await axios.post(`/api/bots/${encodeURIComponent(props.bot.id)}/ki`, { sprache: locale.value }, { timeout: 180_000 })
        if (data?.aus) { fehler.value = t('bots.marktAus'); return }
        erg.value = data.ergebnis
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
watch(() => props.bot.id, () => { erg.value = null; ladeCache() })

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
        <div class="knoepfe">
            <span v-if="erg" class="leise">{{ t('bots.ki.stand', { zeit: datum(erg.zeit), modell: erg.modell || erg.anbieter }) }}</span>
            <Knopf art="haupt" symbol="ki" :laedt="laedt" @click="erzeuge">{{ erg ? t('bots.ki.neu') : t('bots.ki.erzeugen') }}</Knopf>
        </div>
        <p v-if="laedt" class="leise laedt">{{ t('bots.ki.laedt') }}</p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <template v-if="erg">
            <div class="kopf">
                <Pille ton="akzent" symbol="ki">{{ t('bots.ki.kennzeichnung') }}</Pille>
                <span v-if="erg.kurs" class="leise">{{ t('bots.ki.kursStand', { kurs: preis(erg.kurs) }) }}</span>
            </div>
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
                    <div><dt>{{ t('bots.sim.liqNeu') }}</dt><dd>{{ preis(v.abJetzt?.liqNeu) }} <span class="leise">({{ prozent(abstand(v.abJetzt)) }})</span></dd></div>
                    <div><dt>{{ t('bots.sim.geschlossen') }}</dt><dd>{{ prozent(v.abJetzt?.geschlossenAnteil, { stellen: 0 }) }}</dd></div>
                    <div><dt>{{ t('bots.sim.realisiertCa') }}</dt><dd :class="ton(v.abJetzt?.realisiertCa)">{{ betrag(v.abJetzt?.realisiertCa, mc, { vorzeichen: true }) }}</dd></div>
                    <div><dt>{{ t('bots.ki.rueckblick') }}</dt><dd :class="ton(v.rueckblick?.gesamt)">{{ betrag(v.rueckblick?.gesamt, mc, { vorzeichen: true }) }} <span class="leise">{{ t('bots.ki.stattHeute', { wert: betrag(heute, mc, { vorzeichen: true }) }) }}</span></dd></div>
                </dl>
                <p>{{ v.begruendung }}</p>
                <p class="risiko"><strong>{{ t('bots.ki.risiko') }}:</strong> {{ v.risiko }}</p>
                <p class="risiko"><strong>{{ t('bots.ki.passtNicht') }}:</strong> {{ v.passtNichtWenn }}</p>
                <p v-if="v.unbelegt?.length" class="unbelegt">⚠ {{ t('bots.ki.unbelegt', { zahlen: v.unbelegt.join(', ') }) }}</p>
                <div class="knoepfe">
                    <Knopf art="leise" symbol="rechner" klein @click="emit('inSimulation', v.variante)">{{ t('bots.ki.inSimulation') }}</Knopf>
                    <Knopf v-if="steuerungAktiv" symbol="hochladen" klein @click="emit('umsetzen', v.variante)">{{ t('bots.ki.umsetzen') }}</Knopf>
                </div>
            </article>
            <p v-if="erg.hinweis" class="leise">{{ erg.hinweis }}</p>

            <details class="alle">
                <summary>{{ t('bots.ki.alleKandidaten', { n: erg.kandidaten.length }) }}</summary>
                <div class="tabelleRahmen">
                    <table class="tabelle">
                        <thead><tr><th>ID</th><th>{{ t('bots.sim.einstellung') }}</th><th>{{ t('bots.ki.rueckblick') }}</th><th>{{ t('bots.ki.nachschiessen') }}</th><th>{{ t('bots.sim.realisiertCa') }}</th><th>{{ t('bots.sim.liqNeu') }}</th></tr></thead>
                        <tbody>
                            <tr v-for="c in erg.kandidaten" :key="c.id" :class="{ gewaehlt: erg.vorschlaege.some((v) => v.id === c.id) }">
                                <th>{{ c.id }}</th><td>{{ c.titel }}</td>
                                <td :class="ton(c.rueckblick?.gesamt)">{{ betrag(c.rueckblick?.gesamt, mc, { vorzeichen: true }) }}</td>
                                <td>{{ c.abJetzt?.zusatz > 0 ? betrag(c.abJetzt.zusatz, mc) : '—' }}</td>
                                <td>{{ betrag(c.abJetzt?.realisiertCa, mc, { vorzeichen: true }) }}</td>
                                <td>{{ preis(c.abJetzt?.liqNeu) }}</td>
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
.tabelle tr.gewaehlt { background: var(--accent-flaeche); }
</style>
