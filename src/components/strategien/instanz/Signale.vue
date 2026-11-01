<script setup>
/**
 * Signale einer Instanz — EINE Liste für den ganzen Lebenslauf: erkanntes
 * Setup → wartet → ausgelöst → Trade mit Ergebnis, oder verworfen mit Grund.
 * Oben die offenen Positionen mit ihrem Zwischenstand.
 *
 * Ersetzt die Seite „Setups", die Tabelle offener Positionen, den Coin-Ausblick
 * und die Trade-Liste der früheren Auswertung (bis 01.11.2026 vier Orte).
 */
import { ref, computed, onMounted, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InfoTipp from '../../InfoTipp.vue'
import { geld, zahl, rText, zeit, tonVon, statusText, grundText } from '../../../utils/strategien/format.js'
import { apiFehlerText } from '../../../utils/apiError.js'
import { logError } from '../../../utils/logger.js'
import { Knopf, Hinweis, Kreisel, Symbol } from '../../basis'

const props = defineProps({
    instanz: { type: Object, required: true },
    positionen: { type: Array, default: () => [] },
})
const emit = defineEmits(['zumChart', 'geaendert'])
const { t, te } = useI18n()

const setups = ref([])
const trades = ref([])
const laedt = ref(false)
const fehler = ref('')
const filter = ref('')   // '' | wartend | offen | geschlossen | verworfen

const STATUS = {
    wartend: 'waiting_retest,armed',
    offen: 'open',
    geschlossen: 'closed',
    verworfen: 'invalidated,expired,rejected',
}

async function laden() {
    laedt.value = true
    try {
        const [s, tr] = await Promise.all([
            axios.get('/api/strategies/setups', { params: { instanceId: props.instanz.id, status: STATUS[filter.value] || undefined, limit: 500 } }),
            axios.get('/api/strategies/trades', { params: { instanceId: props.instanz.id, limit: 2000 } }),
        ])
        setups.value = s.data
        trades.value = tr.data
        fehler.value = ''
    } catch (e) {
        logError('Signale', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    } finally {
        laedt.value = false
    }
}
onMounted(laden)
watch(filter, laden)

const zeilen = computed(() => {
    const je = new Map(trades.value.map((tr) => [Number(tr.setupId), tr]))
    // Jüngstes Signal zuerst — nach seiner Kerze, nicht nach der Reihenfolge des Anlegens.
    return setups.value.map((s) => ({ ...s, trade: je.get(Number(s.id)) || null }))
        .sort((a, b) => Number(b.obCandleTime) - Number(a.obCandleTime))
})

function zumChart(s) {
    emit('zumChart', s.trade
        ? { symbol: s.symbol, timeframe: s.timeframe, art: 'trade', id: s.trade.id, t: Number(s.trade.entryTime) }
        : { symbol: s.symbol, timeframe: s.timeframe, art: 'setup', id: s.id, t: Number(s.triggeredAt) || Number(s.obCandleTime) })
}

// ── Kontext eines Trades: nach welcher Fassung er entstand ──────────────
const offen = ref(null)       // Trade-ID
const kontext = ref(null)
async function kontextUmschalten(tr) {
    if (offen.value === tr.id) { offen.value = null; return }
    offen.value = tr.id
    kontext.value = null
    try {
        const { data } = await axios.get(`/api/strategies/trades/${tr.id}/context`)
        kontext.value = data
    } catch (e) {
        kontext.value = { fehler: apiFehlerText(e, t('strategies.loadFailed'), t) }
    }
}

// ── Offene Position schliessen (Kurs vom Kursfeed, mit Rückfrage) ───────
const schliessFrage = ref(null)
async function schliessen(p) {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/positions/${p.id}/close`)
        schliessFrage.value = null
        emit('geaendert')
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategien.signale.schliessenFehler'), t)
    }
}

const dauer = (ms) => {
    const h = Math.floor((Number(ms) || 0) / 3600000)
    return h >= 48 ? `${Math.floor(h / 24)} d` : `${h} h`
}
</script>

<template>
    <div class="signale">
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <div v-if="positionen.length" class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategies.openPositions') }}</div>
            <div class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <thead>
                        <tr>
                            <th>{{ t('strategies.symbol') }}</th>
                            <th>{{ t('strategies.direction') }}</th>
                            <th class="zahl">{{ t('strategies.entry') }}</th>
                            <th class="zahl">{{ t('strategies.markPrice') }}</th>
                            <th class="zahl">{{ t('strategien.signale.netto') }} <InfoTipp :text="t('strategien.signale.nettoInfo')" /></th>
                            <th class="zahl">{{ t('strategien.signale.dauer') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="p in positionen" :key="p.id">
                            <td>
                                <button type="button" class="linkKnopf" @click="emit('zumChart', { symbol: p.symbol, timeframe: p.timeframe })">{{ p.symbol }}</button>
                                <span class="at-gedaempft klein"> {{ p.timeframe }}</span>
                            </td>
                            <td :class="p.direction === 'short' ? 'verlustWert' : 'gewinnWert'">{{ p.direction === 'short' ? 'Short' : 'Long' }}</td>
                            <td class="zahl">{{ zahl(p.entryPrice, 4) }}</td>
                            <td class="zahl">{{ p.stand ? zahl(p.stand.markPrice, 4) : (p.fehler || '–') }}</td>
                            <td class="zahl" :class="tonVon(p.stand?.netPnl)">
                                <template v-if="p.stand">{{ geld(p.stand.netPnl) }} <span class="at-gedaempft klein">{{ rText(p.stand.rMultiple) }}</span></template>
                                <template v-else>–</template>
                            </td>
                            <td class="zahl">{{ p.stand ? dauer(p.stand.heldMs) : '–' }}</td>
                            <td class="rechts">
                                <template v-if="p.mode === 'live'"><span class="at-gedaempft klein" :title="t('strategies.liveAusgelagertHint')">{{ t('strategies.mode_live') }}</span></template>
                                <template v-else-if="schliessFrage === p.id">
                                    <Knopf art="gefahr" klein @click="schliessen(p)">{{ t('strategien.signale.jetztSchliessen') }}</Knopf>
                                    <Knopf art="leise" klein @click="schliessFrage = null">{{ t('common.cancel') }}</Knopf>
                                </template>
                                <Knopf v-else klein @click="schliessFrage = p.id">{{ t('strategien.signale.schliessen') }}</Knopf>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="journalKarte karte">
            <div class="kopf">
                <div class="abschnittTitel">{{ t('strategien.reiter.signale') }}</div>
                <select v-model="filter" class="at-feld klein" :aria-label="t('strategies.statusFilter')">
                    <option value="">{{ t('strategies.allStatus') }}</option>
                    <option value="wartend">{{ t('strategien.status.wartend') }}</option>
                    <option value="offen">{{ t('strategien.status.offen') }}</option>
                    <option value="geschlossen">{{ t('strategien.status.geschlossen') }}</option>
                    <option value="verworfen">{{ t('strategien.status.verworfen') }}</option>
                </select>
                <Kreisel v-if="laedt" />
            </div>
            <p v-if="!laedt && !zeilen.length" class="at-gedaempft">{{ t('strategien.chart.keineSignale') }}</p>
            <div v-else class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <thead>
                        <tr>
                            <th>{{ t('strategien.signale.erkannt') }}</th>
                            <th>{{ t('strategies.symbol') }}</th>
                            <th>{{ t('strategies.direction') }}</th>
                            <th>{{ t('strategien.signale.status') }}</th>
                            <th>{{ t('strategien.signale.grund') }}</th>
                            <th class="zahl">R</th>
                            <th class="zahl">{{ t('strategien.liste.netto') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="s in zeilen" :key="s.id">
                            <tr class="klickZeile" tabindex="0" @click="zumChart(s)" @keydown.enter="zumChart(s)">
                                <td class="at-gedaempft">{{ zeit(s.obCandleTime) }}</td>
                                <td>{{ s.symbol }} <span class="at-gedaempft klein">{{ s.timeframe }}</span></td>
                                <td :class="s.direction === 'short' ? 'verlustWert' : 'gewinnWert'">{{ s.direction === 'short' ? 'Short' : 'Long' }}</td>
                                <td>{{ statusText(t, s.status) }}</td>
                                <td class="at-gedaempft">{{ grundText(t, te, s.invalidReason || s.rejectReason) }}</td>
                                <td class="zahl" :class="tonVon(s.trade?.rMultiple)">{{ s.trade ? rText(s.trade.rMultiple) : '' }}</td>
                                <td class="zahl" :class="tonVon(s.trade?.netPnl)">{{ s.trade ? geld(s.trade.netPnl) : '' }}</td>
                                <td class="rechts">
                                    <Knopf v-if="s.trade" klein nurSymbol :symbol="offen === s.trade.id ? 'hoch' : 'runter'"
                                        :titel="t('strategien.signale.kontext')" @click.stop="kontextUmschalten(s.trade)" />
                                </td>
                            </tr>
                            <tr v-if="s.trade && offen === s.trade.id" class="kontextZeile">
                                <td colspan="8">
                                    <Kreisel v-if="!kontext" />
                                    <span v-else-if="kontext.fehler" class="verlustWert">{{ kontext.fehler }}</span>
                                    <div v-else class="kontext">
                                        <div class="at-gedaempft">
                                            {{ t('strategien.signale.fassung', { v: kontext.paramsVersion }) }}
                                            <template v-if="kontext.ruleVersion">
                                                · {{ t(kontext.ruleVersionUnsicher ? 'strategien.signale.regelFassungUnsicher' : 'strategien.signale.regelFassung', { v: kontext.ruleVersion }) }}
                                            </template>
                                            · {{ t('strategies.byExitReason') }}: {{ s.trade.exitReason }}
                                            · {{ zeit(s.trade.entryTime) }} → {{ zeit(s.trade.exitTime) }}
                                        </div>
                                        <ul v-if="kontext.saetze?.length">
                                            <li v-for="(satz, i) in kontext.saetze" :key="i">{{ satz.text || satz }}</li>
                                        </ul>
                                    </div>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <small class="at-gedaempft">{{ t('strategien.signale.klickHinweis') }}</small>
        </div>
    </div>
</template>

<style scoped>
.signale { display: flex; flex-direction: column; gap: 12px; }
.abschnittTitel { font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 4px; }
.kopf { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.kopf .abschnittTitel { margin: 0; flex: 1; }
.klein { font-size: 0.8rem; }
.rechts { text-align: right; white-space: nowrap; }
.klickZeile { cursor: pointer; }
.klickZeile:hover td, .klickZeile:focus-visible td { background: var(--panel-soft); }
.kontextZeile td { background: var(--panel-soft); }
.kontext ul { margin: 6px 0 0 18px; }
.linkKnopf { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
</style>
