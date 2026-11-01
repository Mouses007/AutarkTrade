<script setup>
/**
 * Instanzen — was gerade läuft (Papier oder Schatten), Startseite des
 * Strategien-Modus.
 *
 *   /strategien/instanzen               Liste mit Vergleich (Trades, Treffer, Ø R …)
 *   /strategien/instanzen/neu           neue Instanz (?strategie= aus der Bibliothek,
 *                                       ?lauf= aus dem Labor: dessen Parameter und Risiko)
 *   /strategien/instanzen/:id/:reiter?  alles zu einer Instanz (InstanzAnsicht)
 *
 * Bis 01.11.2026 lag das auf drei Seiten (Instanzen, Setups, Auswertung),
 * obwohl alle drei dieselbe Instanz betrafen.
 */
import { ref, computed, watch, onBeforeMount, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import InstanzFormular from '../components/strategien/InstanzFormular.vue'
import InstanzAnsicht from '../components/strategien/InstanzAnsicht.vue'
import { apiFehlerText } from '../utils/apiError.js'
import { logError } from '../utils/logger.js'
import { geld, rText, prozent, tonVon } from '../utils/strategien/format.js'
import { Knopf, Pille, Symbol, Hinweis } from '../components/basis'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {}, modes: [], broker: [] })
const instanzen = ref([])
const engine = ref({ killSwitch: false })
const schwebend = ref({})
// Offene Positionen, deren Instanz es nicht mehr gibt (nach einer Rücksicherung,
// FUN-L3-002) — sie hängen an keiner Instanzansicht, also stehen sie hier.
const waisen = ref([])
const meldung = ref('')
const fehler = ref('')
let takt = null

const ansicht = computed(() => {
    const id = route.params.id
    if (!id) return 'liste'
    return id === 'neu' ? 'neu' : 'instanz'
})

async function laden() {
    try {
        const [reg, inst, status, zw] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/engine/status'),
            axios.get('/api/strategies/positions/zwischenstand').catch(() => ({ data: {} })),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        engine.value = status.data
        schwebend.value = zw.data?.jeInstanz || {}
        waisen.value = (zw.data?.positionen || []).filter((p) => p.ohneInstanz && p.mode !== 'live')
    } catch (e) {
        logError('StrategieInstanzen', 'Laden fehlgeschlagen', e)
        fehler.value = t('strategies.loadFailed')
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    await laden()
    seiteLaedt.value = false
    if (ansicht.value === 'neu') await neuVorbereiten()
    takt = setInterval(() => { if (!document.hidden && ansicht.value === 'liste') laden() }, 30000)
})
onBeforeUnmount(() => clearInterval(takt))

const aktive = computed(() => instanzen.value.filter((i) => !Number(i.archiviert)))
const archiv = computed(() => instanzen.value.filter((i) => Number(i.archiviert)))
const archivOffen = ref(false)

/** Warum eine aktive Instanz nichts tun könnte — steht oben, nicht versteckt im Log. */
const engineHinweis = computed(() => {
    if (engine.value.killSwitch) return t('strategien.liste.notAusAktiv')
    if (engine.value.abgeschaltet) return t('strategien.liste.engineAus')
    if (engine.value.running && engine.value.fuehrung === false) return t('strategien.liste.andererProzess')
    return ''
})

// ── Neue Instanz ─────────────────────────────────────────────────────────
const entwurf = ref(null)
const speichern = ref(false)
// Warnung, wenn der übernommene Lauf mit einer älteren Regelfassung getestet
// wurde, als die Instanz fahren wird (FUN-L5-003).
const laufWarnung = ref('')
async function neuVorbereiten() {
    const q = route.query
    laufWarnung.value = ''
    const s = registry.value.strategies.find((x) => x.id === q.strategie) || registry.value.strategies[0]
    if (!s) return
    const basis = {
        strategyId: s.id, name: '', mode: 'paper',
        broker: registry.value.broker?.[0]?.id || 'bitunix', market: 'futures',
        timeframe: s.supportedTimeframes[0], timeframes: [], symbols: ['BTCUSDT'],
        params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
        risk: { ...registry.value.riskDefaults }, agents: {},
    }
    // Aus dem Labor: Parameter, Risiko, Symbol und Zeiteinheit des Laufs.
    // Bis 31.10.2026 öffnete ein Lauf mit gelöschter Strategie still die
    // erste Strategie mit Vorgaben, und eine geänderte Regelfassung blieb
    // unerwähnt (FUN-L5-003). Jetzt: Fehlermeldung statt Formular bzw. Warnung.
    if (q.lauf) {
        try {
            const { data } = await axios.get(`/api/strategies/backtests/${Number(q.lauf)}`)
            const strat = registry.value.strategies.find((x) => x.id === data.strategyId)
            if (!strat) {
                fehler.value = t('strategien.labor.laufStrategieFehlt', { id: data.id, strategie: data.strategyId })
                entwurf.value = null
                return
            }
            // Erst die Vorgaben DIESER Strategie, dann die Werte des Laufs darüber.
            Object.assign(basis, {
                strategyId: data.strategyId,
                timeframe: data.timeframe, symbols: [data.symbol],
                params: { ...Object.fromEntries(strat.params.map((p) => [p.key, p.default])), ...(data.params || {}) },
                risk: { ...basis.risk, ...(data.risk || {}) },
            })
            if (Number(data.ruleVersion) && Number(data.currentRuleVersion) && Number(data.ruleVersion) !== Number(data.currentRuleVersion)) {
                laufWarnung.value = t('strategien.liste.laufFassungAlt', { id: data.id, getestet: data.ruleVersion, aktuell: data.currentRuleVersion })
            }
        } catch (e) {
            logError('StrategieInstanzen', 'Lauf laden fehlgeschlagen', e)
            fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
            entwurf.value = null
            return
        }
    }
    entwurf.value = basis
}
watch(ansicht, (a) => { if (a === 'neu') neuVorbereiten() })

/** Name aus Strategie, Symbolen und Zeiteinheit — „immer benannt", wie die Hilfe sagt. */
const namensVorschlag = computed(() => {
    const e = entwurf.value
    if (!e) return ''
    const s = registry.value.strategies.find((x) => x.id === e.strategyId)
    const sym = e.symbols.length > 3 ? `${e.symbols.length} Coins` : e.symbols.join(', ')
    return `${s?.name || e.strategyId} · ${sym} · ${[e.timeframe, ...(e.timeframes || [])].join('/')}`
})

async function anlegen() {
    speichern.value = true
    fehler.value = ''
    try {
        const daten = { ...entwurf.value, name: entwurf.value.name?.trim() || namensVorschlag.value }
        const { data } = await axios.post('/api/strategies/instances', daten)
        await laden()
        router.push(`/strategien/instanzen/${data.id}`)
        meldung.value = data.hinweise?.length ? t('strategies.clamped', { keys: data.hinweise.join(', ') }) : t('strategien.liste.angelegt')
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichern.value = false
    }
}

// ── Kopfzeile: Jetzt prüfen, Not-Aus ────────────────────────────────────
async function jetztPruefen() {
    meldung.value = t('strategies.running')
    fehler.value = ''
    try {
        await axios.post('/api/strategies/engine/run')
        meldung.value = t('strategies.runDone')
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.runFailed'), t)
    }
}
const notAus = ref(false)
async function notAusAusloesen(schliessen) {
    try {
        const r = await axios.post('/api/strategies/kill-switch', { closePositions: schliessen })
        meldung.value = t('strategies.killDone', { n: r.data.geschlossen || 0 })
        // Was nicht zu schliessen war, steht sichtbar da (FUN-L3-002) — sonst
        // wiegt der Not-Aus in falscher Sicherheit.
        const offenGeblieben = r.data.fehlgeschlagen || []
        fehler.value = offenGeblieben.length
            ? t('strategien.liste.notAusTeilweise', {
                n: offenGeblieben.length,
                liste: offenGeblieben.map((f) => `#${f.id} ${f.symbol} (${te('strategien.liste.grund.' + f.grund) ? t('strategien.liste.grund.' + f.grund) : f.grund})`).join(', '),
            })
            : ''
        notAus.value = false
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.killFailed'), t)
    }
}

// ── Waisen ausbuchen (ohne Trade, mit Rückfrage) ─────────────────────────
const ausbuchFrage = ref(null)
async function ausbuchen(p) {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/positions/${p.id}/close`, { ausbuchen: true })
        ausbuchFrage.value = null
        meldung.value = t('strategien.liste.ausgebucht', { id: p.id, symbol: p.symbol })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategien.liste.ausbuchenFehler'), t)
    }
}

const strategieName = (id) => registry.value.strategies.find((s) => s.id === id)?.name || id
const zeiteinheiten = (i) => (i.timeframes?.length ? i.timeframes : [i.timeframe]).join(' · ')
const oeffne = (i) => router.push(`/strategien/instanzen/${i.id}`)
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="instanzenSeite">

        <InstanzAnsicht v-if="ansicht === 'instanz'" :key="route.params.id" :id="Number(route.params.id)"
            :registry="registry" @geaendert="laden" />

        <template v-else>
            <div class="kopf">
                <h5 class="seitentitel">{{ ansicht === 'neu' ? t('strategies.newInstance') : t('strategien.liste.titel') }}</h5>
                <Pille ton="neutral" class="satzPille" :title="t('strategies.simulationOnlyHint')">{{ t('strategies.simulationOnly') }}</Pille>
                <span class="platz"></span>
                <template v-if="ansicht === 'liste'">
                    <Knopf klein symbol="aktualisieren" @click="jetztPruefen">{{ t('strategies.runNow') }}</Knopf>
                    <Knopf klein symbol="ein" art="gefahr" @click="notAus = true">{{ t('strategies.killSwitch') }}</Knopf>
                    <Knopf klein symbol="plus" art="haupt" to="/strategien/instanzen/neu">{{ t('strategies.newInstance') }}</Knopf>
                </template>
            </div>

            <Hinweis v-if="engineHinweis" art="warn" class="abstand">{{ engineHinweis }}</Hinweis>
            <Hinweis v-if="meldung" art="info" class="abstand">{{ meldung }}</Hinweis>
            <Hinweis v-if="fehler" art="fehler" class="abstand">{{ fehler }}</Hinweis>

            <div v-if="ansicht === 'liste' && waisen.length" class="journalKarte karte abstand">
                <p><strong>{{ t('strategien.liste.waisenTitel', { n: waisen.length }) }}</strong></p>
                <p class="at-gedaempft klein">{{ t('strategien.liste.waisenHinweis') }}</p>
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <tbody>
                            <tr v-for="p in waisen" :key="p.id">
                                <td>#{{ p.id }} <strong>{{ p.symbol }}</strong> <span class="at-gedaempft klein">{{ p.timeframe }}</span></td>
                                <td>{{ p.direction === 'short' ? 'Short' : 'Long' }}</td>
                                <td class="at-gedaempft klein">{{ t('strategien.liste.waiseInstanz', { id: p.instanceId }) }}</td>
                                <td class="at-rechtsbuendig">
                                    <template v-if="ausbuchFrage === p.id">
                                        <Knopf art="gefahr" klein @click="ausbuchen(p)">{{ t('strategien.liste.jetztAusbuchen') }}</Knopf>
                                        <Knopf art="leise" klein @click="ausbuchFrage = null">{{ t('common.cancel') }}</Knopf>
                                    </template>
                                    <Knopf v-else klein @click="ausbuchFrage = p.id">{{ t('strategien.liste.ausbuchen') }}</Knopf>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div v-if="notAus" class="journalKarte karte abstand gefahrRand">
                <p><strong>{{ t('strategies.killSwitchConfirm') }}</strong></p>
                <p class="at-gedaempft">{{ t('strategies.killSwitchHint') }}</p>
                <div class="knopfzeile">
                    <Knopf art="gefahr" klein @click="notAusAusloesen(true)">{{ t('strategies.killAndClose') }}</Knopf>
                    <Knopf art="gefahr" klein @click="notAusAusloesen(false)">{{ t('strategies.killOnly') }}</Knopf>
                    <Knopf art="leise" klein @click="notAus = false">{{ t('common.cancel') }}</Knopf>
                </div>
            </div>

            <!-- ══ Neue Instanz ══ -->
            <Hinweis v-if="ansicht === 'neu' && entwurf && laufWarnung" art="warn" class="abstand">{{ laufWarnung }}</Hinweis>
            <div v-if="ansicht === 'neu' && entwurf" class="journalKarte karte">
                <InstanzFormular v-model="entwurf" :registry="registry" ist-neu />
                <p class="at-gedaempft klein abstand">{{ t('strategien.liste.nameVorschlag', { name: namensVorschlag }) }}</p>
                <div class="knopfzeile abstand">
                    <Knopf art="haupt" klein symbol="speichern" :disabled="speichern" @click="anlegen">{{ t('strategien.liste.anlegen') }}</Knopf>
                    <Knopf art="leise" klein to="/strategien/instanzen">{{ t('common.cancel') }}</Knopf>
                </div>
                <small class="at-gedaempft">{{ t('strategien.liste.pausiertHinweis') }}</small>
            </div>

            <!-- ══ Liste ══ -->
            <template v-if="ansicht === 'liste'">
                <div v-if="!aktive.length" class="journalKarte karte at-gedaempft">{{ t('strategies.noInstances') }}</div>
                <div v-else class="journalKarte karte">
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead>
                                <tr>
                                    <th>{{ t('strategien.liste.instanz') }}</th>
                                    <th>{{ t('strategies.timeframe') }}</th>
                                    <th class="zahl">{{ t('strategies.trades') }}</th>
                                    <th class="zahl">{{ t('strategies.kpiWinRate') }}</th>
                                    <th class="zahl">Ø R</th>
                                    <th class="zahl">Σ R</th>
                                    <th class="zahl">{{ t('strategien.liste.netto') }}</th>
                                    <th class="zahl">{{ t('strategies.unrealizedShort') }}</th>
                                    <th class="zahl">{{ t('strategien.liste.offen') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="i in aktive" :key="i.id" class="klickZeile" tabindex="0"
                                    @click="oeffne(i)" @keydown.enter="oeffne(i)">
                                    <td>
                                        <span :class="['punkt', i.enabled ? 'an' : 'aus']" :title="i.enabled ? t('strategien.status.laeuft') : t('strategien.status.pausiert')"></span>
                                        <strong>{{ i.name }}</strong>
                                        <Pille v-if="i.mode === 'shadow'" ton="warn" class="klein">{{ t('strategies.mode_shadow') }}</Pille>
                                        <Pille v-if="i.offeneVorschlaege" ton="akzent" class="klein">{{ t('strategien.liste.vorschlaege', { n: i.offeneVorschlaege }) }}</Pille>
                                        <Symbol v-if="i.lastError" name="warnung" class="warnSymbol" :title="i.lastError" />
                                        <div class="at-gedaempft klein">{{ strategieName(i.strategyId) }} · {{ i.symbols.join(', ') }}</div>
                                    </td>
                                    <td>{{ zeiteinheiten(i) }}</td>
                                    <td class="zahl">{{ i.totalTrades }}</td>
                                    <td class="zahl">{{ prozent(i.winRate) }}</td>
                                    <td class="zahl" :class="tonVon(i.avgR)">{{ i.totalTrades ? rText(i.avgR) : '–' }}</td>
                                    <td class="zahl" :class="tonVon(i.summeR)">{{ i.totalTrades ? rText(i.summeR) : '–' }}</td>
                                    <td class="zahl" :class="tonVon(i.totalNetPnl)">{{ geld(i.totalNetPnl) }}</td>
                                    <td class="zahl" :class="tonVon(schwebend[i.id]?.netPnl)">{{ schwebend[i.id] ? geld(schwebend[i.id].netPnl) : '–' }}</td>
                                    <td class="zahl">{{ i.openPositions || '–' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <small class="at-gedaempft">{{ t('strategien.liste.vergleichHinweis') }}</small>
                </div>

                <div v-if="archiv.length" class="journalKarte karte abstand">
                    <button type="button" class="archivKopf" :aria-expanded="archivOffen" @click="archivOffen = !archivOffen">
                        <Symbol :name="archivOffen ? 'runter' : 'pfeilRechts'" />
                        {{ t('strategien.liste.archiv', { n: archiv.length }) }}
                    </button>
                    <div v-if="archivOffen" class="at-tabelle-huelle abstand">
                        <table class="at-tabelle dicht">
                            <tbody>
                                <tr v-for="i in archiv" :key="i.id" class="klickZeile" tabindex="0" @click="oeffne(i)" @keydown.enter="oeffne(i)">
                                    <td><strong>{{ i.name }}</strong> <span class="at-gedaempft klein">#{{ i.id }}</span></td>
                                    <td class="at-gedaempft">{{ t('strategien.liste.archiviertAm', { datum: new Date(Number(i.archiviertAm)).toLocaleDateString() }) }}</td>
                                    <td class="zahl">{{ i.totalTrades }} {{ t('strategies.trades') }}</td>
                                    <td class="zahl" :class="tonVon(i.summeR)">{{ i.totalTrades ? rText(i.summeR) : '–' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
        </template>
    </div>
</template>

<style scoped>
.instanzenSeite { padding: 16px 16px 0; max-width: 1400px; margin: 0 auto; }
.kopf { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.kopf .platz { flex: 1; }
.seitentitel { margin: 0; }
.satzPille { white-space: normal; max-width: 100%; }
.abstand { margin-top: 12px; }
.knopfzeile { display: flex; flex-wrap: wrap; gap: 8px; }
.gefahrRand { border-color: var(--bad); }
.klickZeile { cursor: pointer; }
.klickZeile td:first-child { min-width: 220px; }
.klickZeile:hover td, .klickZeile:focus-visible td { background: var(--panel-soft); }
.punkt { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.punkt.an { background: var(--good); }
.punkt.aus { background: var(--muted); }
.klein { font-size: 0.8rem; }
.warnSymbol { color: var(--warn); margin-left: 4px; }
.archivKopf { background: none; border: 0; color: var(--text); cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 600; padding: 0; }
</style>
