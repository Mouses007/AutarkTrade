<script setup>
/**
 * Labor › Läufe: was schon gerechnet wurde.
 *
 *   Backtests   gespeicherte Einzeltests mit Entscheidung (übernommen/verworfen)
 *               und Notiz — die beantwortet in vier Wochen „warum eigentlich?"
 *   Ranglisten  Läufe über viele Coins; öffnen führt in „Viele Coins"
 *
 * Bis 01.11.2026 fragte die Entscheidung die Notiz mit `window.prompt` ab, und
 * eine Rangliste liess sich ohne Rückfrage löschen.
 */
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { Knopf, Pille, Hinweis } from '../../basis'
import { apiFehlerText } from '../../../utils/apiError.js'
import dayjs from '../../../utils/journal/zeit.js'

const props = defineProps({
    registry: { type: Object, required: true },
    instanzen: { type: Array, default: () => [] },
})
const { t } = useI18n()

const laeufe = ref([])
const ranglisten = ref([])
const fehler = ref('')
const loeschFrage = ref('')
const alleLoeschenFrage = ref(false)
// Offene Entscheidung: { id, entscheidung, notiz }
const entscheidung = ref(null)

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const datum = (ms) => (ms ? dayjs(Number(ms)).format('DD.MM.YY') : '–')
const strategieName = (id) => props.registry.strategies.find((s) => s.id === id)?.name || id
const instanzName = (id) => props.instanzen.find((i) => i.id === Number(id))?.name || ''
// Gelöschte Strategie: weder neu testen noch als Instanz starten (FUN-L5-003).
const strategieDa = (l) => l.strategieBekannt !== false && props.registry.strategies.some((s) => s.id === l.strategyId)
// Regeln seit dem Lauf geändert — der Lauf gilt nicht mehr für die heutige Fassung.
const veraltet = (l) => Number(l.ruleVersion) > 0 && Number(l.currentRuleVersion) > 0
    && Number(l.ruleVersion) !== Number(l.currentRuleVersion)

async function laden() {
    try {
        const [bt, rl] = await Promise.all([
            axios.get('/api/strategies/backtests', { params: { limit: 200 } }),
            axios.get('/api/rangliste/laeufe').catch(() => ({ data: [] })),
        ])
        laeufe.value = bt.data
        ranglisten.value = rl.data || []
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}
onMounted(laden)

function entscheidungBeginnen(l, wie) {
    entscheidung.value = { id: l.id, entscheidung: wie, notiz: l.notiz || '' }
}

async function entscheidungSpeichern() {
    const e = entscheidung.value
    try {
        await axios.post(`/api/strategies/backtests/${e.id}/decision`, { entscheidung: e.entscheidung, notiz: e.notiz })
        entscheidung.value = null
        await laden()
    } catch (err) {
        fehler.value = apiFehlerText(err, t('strategies.saveFailed'), t)
    }
}

async function laufLoeschen(l) {
    try {
        await axios.delete(`/api/strategies/backtests/${l.id}`)
        loeschFrage.value = ''
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function alleLaeufeLoeschen() {
    try {
        await axios.delete('/api/strategies/backtests?confirm=true')
        alleLoeschenFrage.value = false
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function ranglisteLoeschen(r) {
    try {
        await axios.delete(`/api/rangliste/laeufe/${r.id}`)
        loeschFrage.value = ''
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}
</script>

<template>
    <div class="laeufeReiter">
        <Hinweis v-if="fehler" art="fehler" class="abstand">{{ fehler }}</Hinweis>

        <!-- ══ Backtests ══ -->
        <div class="journalKarte karte">
            <div class="kopfZeile">
                <div class="abschnittTitel">{{ t('strategien.labor.backtests') }}</div>
                <span class="platz"></span>
                <template v-if="laeufe.length">
                    <template v-if="alleLoeschenFrage">
                        <span class="fein at-gedaempft">{{ t('strategies.deleteAllRunsConfirm') }}</span>
                        <Knopf art="gefahr" klein @click="alleLaeufeLoeschen">{{ t('common.yes') }}</Knopf>
                        <Knopf klein @click="alleLoeschenFrage = false">{{ t('common.no') }}</Knopf>
                    </template>
                    <Knopf v-else art="gefahr" klein symbol="muell" @click="alleLoeschenFrage = true">{{ t('strategies.deleteAllRuns') }}</Knopf>
                </template>
            </div>
            <p v-if="!laeufe.length" class="at-gedaempft fein">{{ t('strategien.labor.keineBacktests') }}</p>
            <div v-else class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <thead>
                        <tr>
                            <th>{{ t('strategies.label') }}</th>
                            <th>{{ t('strategies.symbol') }}</th>
                            <th class="zahl">{{ t('strategies.kpiTrades') }}</th>
                            <th class="zahl">{{ t('strategies.kpiWinRate') }}</th>
                            <th class="zahl">{{ t('strategies.kpiExpectancy') }}</th>
                            <th class="zahl">{{ t('strategies.kpiProfitFactor') }}</th>
                            <th :title="t('strategies.regCostsHint')">{{ t('strategies.regCosts') }}</th>
                            <th>{{ t('strategies.regDecision') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="l in laeufe" :key="l.id">
                            <tr>
                                <td class="nameZelle">
                                    <strong>{{ strategieName(l.strategyId) }}</strong>
                                    <div class="at-gedaempft klein">
                                        <template v-if="l.label && l.label !== strategieName(l.strategyId)">{{ l.label }} · </template>
                                        <template v-if="instanzName(l.instanceId)">{{ instanzName(l.instanceId) }} · </template>
                                        {{ datum(l.fromTs) }} – {{ datum(l.toTs) }}
                                    </div>
                                </td>
                                <td>{{ l.symbol }} <span class="at-gedaempft">{{ l.timeframe }}</span></td>
                                <td class="zahl">{{ l.stats.trades ?? 0 }}</td>
                                <td class="zahl">{{ zahl(l.stats.winRate, 1) }}</td>
                                <td class="zahl" :class="(l.stats.expectancyR || 0) >= 0 ? 'gewinnWert' : 'verlustWert'">{{ zahl(l.stats.expectancyR) }}</td>
                                <td class="zahl">{{ profitFaktor(l.stats.profitFactor, l.stats.trades) }}</td>
                                <!-- Kostenmodell und Regelfassung: ohne beides ist
                                     ein alter Lauf nicht nachstellbar. -->
                                <td class="at-gedaempft keinUmbruch">
                                    <template v-if="l.risk && l.risk.feeTakerBps !== undefined">
                                        {{ l.risk.feeMakerBps }}/{{ l.risk.feeTakerBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else-if="l.risk && l.risk.feeBps !== undefined">
                                        {{ l.risk.feeBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else>–</template>
                                    <Pille v-if="l.ruleVersion" ton="neutral" class="nebenan">v{{ l.ruleVersion }}</Pille>
                                    <Pille v-if="veraltet(l)" ton="warn" class="nebenan"
                                        :title="t('strategien.labor.veraltetTitel', { getestet: l.ruleVersion, aktuell: l.currentRuleVersion })">
                                        {{ t('strategien.labor.veraltet') }}
                                    </Pille>
                                    <Pille v-if="l.variantenGeprueft > 1" ton="warn" class="nebenan" :title="t('strategies.regVariantsHint')">
                                        {{ t('strategies.regVariants', { n: l.variantenGeprueft }) }}
                                    </Pille>
                                </td>
                                <td class="aktionen">
                                    <Pille v-if="l.entscheidung && l.entscheidung !== 'offen'"
                                        :ton="l.entscheidung === 'uebernommen' ? 'gut' : 'neutral'" :title="l.notiz || ''">
                                        {{ t('strategies.dec_' + l.entscheidung) }}
                                    </Pille>
                                    <Knopf klein nurSymbol symbol="haken" :titel="t('strategies.dec_uebernommen')" @click="entscheidungBeginnen(l, 'uebernommen')" />
                                    <Knopf klein nurSymbol symbol="schliessen" :titel="t('strategies.dec_verworfen')" @click="entscheidungBeginnen(l, 'verworfen')" />
                                </td>
                                <td class="zahl aktionen">
                                    <template v-if="strategieDa(l)">
                                        <Knopf klein :to="`/strategien/labor/test?lauf=${l.id}`">{{ t('strategien.labor.erneutTesten') }}</Knopf>
                                        <Knopf klein :to="`/strategien/instanzen/neu?lauf=${l.id}`">{{ t('strategien.labor.alsInstanz') }}</Knopf>
                                    </template>
                                    <Pille v-else ton="neutral">{{ t('strategien.labor.strategieGeloescht') }}</Pille>
                                    <template v-if="loeschFrage === 'bt' + l.id">
                                        <Knopf art="gefahr" klein @click="laufLoeschen(l)">{{ t('common.yes') }}</Knopf>
                                        <Knopf klein @click="loeschFrage = ''">{{ t('common.no') }}</Knopf>
                                    </template>
                                    <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" :titel="t('strategies.deleteRun')" @click="loeschFrage = 'bt' + l.id" />
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <!-- Entscheidung mit Notiz: freiwillig, aber genau sie beantwortet
                 später „warum eigentlich?". Unter der Tabelle, nicht als Zeile
                 darin — die Tabelle rollt seitwärts, eine Zeile läge ausser Sicht. -->
            <div v-if="entscheidung" class="entscheidungKasten">
                <label class="at-label" for="laufNotiz">
                    {{ t('strategien.labor.notiz', { entscheidung: t('strategies.dec_' + entscheidung.entscheidung) }) }}
                    <span class="at-gedaempft">#{{ entscheidung.id }}</span>
                </label>
                <textarea id="laufNotiz" v-model="entscheidung.notiz" rows="2" class="at-feld klein"
                    :placeholder="t('strategies.regNotePrompt')"></textarea>
                <div class="knopfZeile">
                    <Knopf art="haupt" klein @click="entscheidungSpeichern">{{ t('strategien.labor.notizSpeichern') }}</Knopf>
                    <Knopf klein @click="entscheidung = null">{{ t('common.cancel') }}</Knopf>
                </div>
            </div>
        </div>

        <!-- ══ Ranglisten ══ -->
        <div class="journalKarte karte abstand">
            <div class="abschnittTitel">{{ t('strategien.labor.ranglisten') }}</div>
            <p v-if="!ranglisten.length" class="at-gedaempft fein">{{ t('rangliste.keineLaeufe') }}</p>
            <div v-else class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <tbody>
                        <tr v-for="r in ranglisten" :key="r.id">
                            <td><strong>{{ r.universumName }}</strong>
                                <div class="at-gedaempft klein">{{ strategieName(r.strategyId) }} · {{ r.timeframe }} · {{ datum(r.fromTs) }} – {{ datum(r.toTs) }}</div></td>
                            <td>{{ t('rangliste.st_' + r.status) }}</td>
                            <td class="at-gedaempft">{{ r.fortschritt }}/{{ r.gesamt }}</td>
                            <td class="zahl aktionen">
                                <Knopf klein :to="`/strategien/labor/viele?rangliste=${r.id}`">{{ t('strategien.bibliothek.oeffnen') }}</Knopf>
                                <template v-if="loeschFrage === 'rl' + r.id">
                                    <Knopf art="gefahr" klein @click="ranglisteLoeschen(r)">{{ t('common.yes') }}</Knopf>
                                    <Knopf klein @click="loeschFrage = ''">{{ t('common.no') }}</Knopf>
                                </template>
                                <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" :titel="t('common.delete')" @click="loeschFrage = 'rl' + r.id" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<style scoped>
.laeufeReiter { margin-top: 16px; }
.karte { padding: 16px; height: auto; }
.abstand { margin-top: 12px; }
.abschnittTitel { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
.kopfZeile { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
.kopfZeile .abschnittTitel { margin-bottom: 0; }
.platz { flex: 1; }
.fein { font-size: 0.85rem; }
.klein { font-size: 0.78rem; }
.keinUmbruch { white-space: nowrap; }
.nameZelle { min-width: 200px; }
.nebenan { margin-left: 4px; }
.aktionen { white-space: nowrap; }
.aktionen > * + * { margin-left: 4px; }
.knopfZeile { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.entscheidungKasten { margin-top: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius-knopf); }
.entscheidungKasten textarea { width: 100%; }
</style>
