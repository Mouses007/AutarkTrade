<script setup>
/**
 * Strategie-Instanzen: anlegen, einstellen, starten, stoppen.
 *
 * Das Formular kennt keine einzige Strategie — es rendert das Schema, das der
 * Server im Manifest mitliefert (StrategyParamForm). Eine weitere Strategie
 * erscheint hier deshalb automatisch, sobald sie serverseitig registriert ist.
 */
import { ref, computed, watch, onBeforeMount, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import InfoTipp from '../components/InfoTipp.vue'
import { formGeldStellen } from '../utils/journal/format.js'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import dayjs from '../utils/journal/zeit.js'
import { Knopf, Pille, Symbol, Hinweis, Kreisel, Reiter } from '../components/basis'

const { t } = useI18n()
const router = useRouter()

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {}, agentDefaults: {}, modes: [] })
const instanzen = ref([])
const engine = ref({ killSwitch: false, running: false })
const meldung = ref('')
const fehler = ref('')
let pollTimer = null

// ── Editor ──────────────────────────────────────────────────────────────
const bearbeite = ref(null)          // null = Liste, sonst der Entwurf
const istNeu = ref(false)
const speichern = ref(false)
const symbolEingabe = ref('')

const gewaehlteStrategie = computed(
    () => registry.value.strategies.find((s) => s.id === bearbeite.value?.strategyId) || null,
)

async function laden() {
    try {
        const [reg, inst, status] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/engine/status'),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        engine.value = status.data
        schwebendLaden()
    } catch (e) {
        logError('AgentStrategies', 'Laden fehlgeschlagen', e)
        fehler.value = t('strategies.loadFailed')
    }
}

// Schwebender Stand offener Positionen je Instanz — NEBEN dem realisierten
// Ergebnis, nie dazugerechnet: ein Buchgewinn ist noch kein Ergebnis.
const schwebend = ref({})
async function schwebendLaden() {
    try {
        const r = await axios.get('/api/strategies/positions/zwischenstand')
        schwebend.value = r.data?.jeInstanz || {}
    } catch (e) {
        schwebend.value = {}
    }
}
const schwebendHinweis = (s) => t('strategies.unrealizedInstanceHint', {
    n: s.n, gross: geld(s.grossPnl), fees: geld(-s.fees),
    funding: s.fundingUnbekannt ? '?' : geld(s.funding),
})

onBeforeMount(async () => {
    seiteLaedt.value = true
    await laden()
    seiteLaedt.value = false
    pollTimer = setInterval(laden, 30000)
})
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

// ── Parameter-Verlauf ────────────────────────────────────────────────────
// Je Instanz aufklappbar: welche Version galt wann, WAS wurde geändert
// (Diff zur Vorgängerversion) und was hat sie gebracht (Trades, ΣR).
const verlaufOffen = ref(null)          // instanceId oder null
const verlaufDaten = ref([])
const verlaufLaedt = ref(false)

// ── Coin-Ausblick ─────────────────────────────────────────────────────────
// Welche Trades hat DIESE Instanz auf DIESEM Coin gemacht? Ein blosser
// Ausblick beim Durchklicken — deshalb der schlanke Endpunkt statt der vollen
// Auswertung (Trichter, Gruppierungen, Buy&Hold-Kerzenabruf wären hier
// unnötiger Ballast).
const coinOffen = ref({ instanceId: null, symbol: '' })
const coinTrades = ref([])
const coinLaedt = ref(false)

async function coinAnzeigen(inst, symbol) {
    if (coinOffen.value.instanceId === inst.id && coinOffen.value.symbol === symbol) {
        coinOffen.value = { instanceId: null, symbol: '' }
        return
    }
    coinOffen.value = { instanceId: inst.id, symbol }
    coinLaedt.value = true
    coinTrades.value = []
    try {
        const r = await axios.get('/api/strategies/trades', { params: { instanceId: inst.id, symbol } })
        coinTrades.value = r.data
    } catch (e) {
        logError('AgentStrategies', 'Coin-Trades laden fehlgeschlagen', e)
    } finally {
        coinLaedt.value = false
    }
}

/** Sprung zur vollen Auswertung, vorgefiltert auf genau diese Instanz+diesen Coin. */
function zurZwischenauswertung() {
    router.push({
        path: '/agent/performance',
        query: { instanceId: coinOffen.value.instanceId, symbol: coinOffen.value.symbol, tab: 'liste' },
    })
}

async function verlaufAnzeigen(inst) {
    if (verlaufOffen.value === inst.id) { verlaufOffen.value = null; return }
    verlaufOffen.value = inst.id
    verlaufLaedt.value = true
    verlaufDaten.value = []
    try {
        const r = await axios.get(`/api/strategies/instances/${inst.id}/history`)
        const zeilen = r.data
        // Diff gegen die jeweils ÄLTERE Version (Liste kommt absteigend)
        for (let i = 0; i < zeilen.length; i++) {
            const aelter = zeilen[i + 1]
            zeilen[i].diff = aelter ? parameterDiff(aelter, zeilen[i]) : []
        }
        verlaufDaten.value = zeilen
    } catch (e) {
        logError('AgentStrategies', 'Verlauf laden fehlgeschlagen', e)
    } finally {
        verlaufLaedt.value = false
    }
}

/** Geänderte Schlüssel zweier Versionen als lesbare "key: alt → neu"-Liste. */
function parameterDiff(alt, neu) {
    const aus = []
    for (const [bereich, a, b] of [['', alt.params, neu.params], ['risk.', alt.risk, neu.risk]]) {
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
        for (const k of keys) {
            if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) {
                aus.push({ key: bereich + k, alt: a?.[k] ?? '–', neu: b?.[k] ?? '–' })
            }
        }
    }
    return aus
}

const verlaufQuelle = (q) => {
    if (q === 'angelegt') return t('strategies.historySourceCreated')
    if (q === 'manuell') return t('strategies.historySourceManual')
    if (q === 'bestand') return t('strategies.historySourceBackfill')
    if (String(q).startsWith('vorschlag')) return t('strategies.historySourceSuggestion') + ' ' + String(q).replace('vorschlag ', '')
    return q
}

/**
 * Übergibt die Instanz an den KI-Coach — derselbe Weg wie im Labor. Der Knopf
 * steht bewusst auch hier: auf der Startseite des Modus war der Agent bisher
 * unsichtbar, obwohl er das zentrale Werkzeug zur Verbesserung ist.
 */
function kiOptimieren(inst) {
    router.push({ path: '/ki-coach', query: {
        agentPrompt: t('strategies.optimizePrompt', { name: inst.name, id: inst.id }),
    } })
}

function neu() {
    const s = registry.value.strategies[0]
    if (!s) return
    istNeu.value = true
    bearbeite.value = {
        strategyId: s.id,
        name: `${s.name} ${s.supportedTimeframes[1] || s.supportedTimeframes[0]}`,
        mode: 'paper',
        broker: registry.value.broker?.[0]?.id || 'bitunix',
        market: 'futures',
        timeframe: s.supportedTimeframes[1] || s.supportedTimeframes[0],
        timeframes: [],
        symbols: ['BTCUSDT'],
        params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
        risk: { ...registry.value.riskDefaults },
    }
}

// ── Börse: deren Rundungsregeln der Schattenbetrieb anlegt ──────────────
function brokerName(id) {
    const b = (registry.value.broker || []).find((x) => x.id === (id || 'bitunix'))
    return b?.label || id || 'bitunix'
}

function bearbeiten(inst) {
    istNeu.value = false
    bearbeite.value = JSON.parse(JSON.stringify(inst))
}

/** Strategiewechsel im Editor: Parameter auf die Defaults der neuen Strategie. */
function strategieGewechselt() {
    const s = gewaehlteStrategie.value
    if (!s) return
    bearbeite.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    if (!s.supportedTimeframes.includes(bearbeite.value.timeframe)) {
        bearbeite.value.timeframe = s.supportedTimeframes[0]
    }
    // Zeiteinheiten, welche die neue Strategie nicht kann, fallen weg — sonst
    // würde die Instanz mit einer Einstellung gespeichert, die der Server
    // ohnehin zurückweist.
    bearbeite.value.timeframes = tfListe()
        .filter((tf) => s.supportedTimeframes.includes(tf) && tf !== bearbeite.value.timeframe)
}

/**
 * Zeiteinheiten der Instanz. Die Haupt-Zeiteinheit ist immer dabei und lässt
 * sich nicht abwählen — sie bestimmt, was Auswertung und Backtest als
 * Ausgangspunkt nehmen. Alle weiteren laufen gleichberechtigt daneben.
 */
const tfListe = () => (Array.isArray(bearbeite.value.timeframes) ? bearbeite.value.timeframes : [])
const tfAktiv = (tf) => tf === bearbeite.value.timeframe || tfListe().includes(tf)

function tfUmschalten(tf) {
    if (tf === bearbeite.value.timeframe) return
    const liste = tfListe().filter((x) => x !== bearbeite.value.timeframe)
    bearbeite.value.timeframes = liste.includes(tf)
        ? liste.filter((x) => x !== tf)
        : [...liste, tf]
}

/** Wechselt die Haupt-Zeiteinheit, fliegt sie aus der Zusatzliste. */
function tfHauptGewechselt() {
    bearbeite.value.timeframes = tfListe().filter((x) => x !== bearbeite.value.timeframe)
}

function symbolHinzu() {
    const roh = symbolEingabe.value.toUpperCase().trim()
    if (!/^[A-Z0-9]{2,20}$/.test(roh)) return
    if (!bearbeite.value.symbols.includes(roh)) bearbeite.value.symbols.push(roh)
    symbolEingabe.value = ''
}
const symbolWeg = (s) => { bearbeite.value.symbols = bearbeite.value.symbols.filter((x) => x !== s) }

async function sichern() {
    speichern.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = bearbeite.value
        const antwort = istNeu.value
            ? await axios.post('/api/strategies/instances', daten)
            : await axios.put(`/api/strategies/instances/${daten.id}`, daten)

        if (antwort.data.hinweise?.length) {
            meldung.value = t('strategies.clamped', { keys: antwort.data.hinweise.join(', ') })
        } else if (antwort.data.paramsVersionErhoeht) {
            meldung.value = t('strategies.newParamsVersion', { v: antwort.data.paramsVersion })
        } else {
            meldung.value = t('strategies.saved')
        }
        bearbeite.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichern.value = false
    }
}

async function umschalten(inst) {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/instances/${inst.id}/enabled`, { enabled: !inst.enabled })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.toggleFailed'), t)
    }
}

const loeschBestaetigung = ref(null)
async function loeschen(inst) {
    try {
        await axios.delete(`/api/strategies/instances/${inst.id}`)
        loeschBestaetigung.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function jetztPruefen() {
    meldung.value = t('strategies.running')
    try {
        await axios.post('/api/strategies/engine/run')
        meldung.value = t('strategies.runDone')
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.runFailed'), t)
    }
}

const notAus = ref(false)
async function notAusAusloesen(positionenSchliessen) {
    try {
        const r = await axios.post('/api/strategies/kill-switch', { closePositions: positionenSchliessen })
        meldung.value = t('strategies.killDone', { n: r.data.geschlossen || 0 })
        notAus.value = false
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.killFailed'), t)
    }
}

// Ton der Pille je Modus (Baustein `Pille`)
const modusFarbe = (m) => (m === 'shadow' ? 'warn' : 'neutral')

// Reiter im Editor (ersetzt die Bootstrap-Pills). Jeder neu geöffnete Editor
// beginnt wie vorher bei den Strategie-Parametern.
const editorReiter = ref('params')
const editorReiterListe = computed(() => [
    { id: 'params', titel: t('strategies.strategyParams') },
    { id: 'risk', titel: t('strategies.riskParams') },
])
watch(() => !!bearbeite.value, (offen) => { if (offen) editorReiter.value = 'params' })
const geld = (v) => formGeldStellen(Number(v) || 0, 2)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="instanzen-seite">
        <div class="instanzen-inhalt">

            <!-- Kopfzeile -->
            <div class="kopfzeile">
                <h5 class="seitentitel">{{ t('strategies.title') }}</h5>
                <Pille v-if="engine.killSwitch" ton="schlecht" symbol="stopp" class="satzPille">
                    {{ t('strategies.killSwitchActive') }}
                </Pille>
                <Pille ton="neutral" class="satzPille" :title="t('strategies.simulationOnlyHint')">{{ t('strategies.simulationOnly') }}</Pille>
                <button type="button" class="ctl-pill" @click="jetztPruefen">
                    <Symbol name="aktualisieren" class="vor" />{{ t('strategies.runNow') }}
                </button>
                <button type="button" class="ctl-pill warn" @click="notAus = true">
                    <Symbol name="ein" class="vor" />{{ t('strategies.killSwitch') }}
                </button>
                <button v-if="!bearbeite" type="button" class="ctl-pill accent" @click="neu">
                    <Symbol name="plus" class="vor" />{{ t('strategies.newInstance') }}
                </button>
            </div>

            <Hinweis v-if="meldung" art="info" class="abstand">{{ meldung }}</Hinweis>
            <Hinweis v-if="fehler" art="fehler" class="abstand">{{ fehler }}</Hinweis>

            <!-- Not-Aus -->
            <div v-if="notAus" class="journalKarte karte abstand gefahr-rand">
                <p class="abstand-klein"><strong>{{ t('strategies.killSwitchConfirm') }}</strong></p>
                <p class="at-gedaempft klein-text">{{ t('strategies.killSwitchHint') }}</p>
                <div class="knopfzeile">
                    <Knopf art="gefahr" klein @click="notAusAusloesen(true)">
                        {{ t('strategies.killAndClose') }}
                    </Knopf>
                    <Knopf art="gefahr" klein @click="notAusAusloesen(false)">
                        {{ t('strategies.killOnly') }}
                    </Knopf>
                    <Knopf art="leise" klein @click="notAus = false">{{ t('common.cancel') }}</Knopf>
                </div>
            </div>

            <!-- ══ Liste ══ -->
            <template v-if="!bearbeite">
                <div v-if="!instanzen.length" class="journalKarte karte leer at-gedaempft">
                    {{ t('strategies.noInstances') }}
                </div>

                <div v-for="inst in instanzen" :key="inst.id" class="journalKarte karte abstand-klein">
                    <div class="zeile">
                        <span :class="['status-dot', inst.enabled ? 'on' : 'off']"></span>
                        <strong>{{ inst.name }}</strong>
                        <Pille :ton="modusFarbe(inst.mode)">{{ t('strategies.mode_' + inst.mode) }}</Pille>
                        <Pille ton="neutral">{{ brokerName(inst.broker) }}</Pille>
                        <Pille ton="neutral">{{ (inst.timeframes?.length ? inst.timeframes : [inst.timeframe]).join(' · ') }}</Pille>
                        <Pille ton="neutral">v{{ inst.paramsVersion }}</Pille>
                        <Pille v-for="s in inst.symbols" :key="s" class="klickZiel"
                            :ton="coinOffen.instanceId === inst.id && coinOffen.symbol === s ? 'akzent' : 'neutral'"
                            :title="t('strategies.coinTradesHint')"
                            @click="coinAnzeigen(inst, s)">{{ s }}</Pille>

                        <div class="kennzahlen">
                            <small class="at-gedaempft">
                                {{ t('strategies.openPositions') }}: <strong>{{ inst.openPositions }}</strong>
                            </small>
                            <small class="at-gedaempft">
                                {{ t('strategies.trades') }}: <strong>{{ inst.totalTrades }}</strong>
                            </small>
                            <small :class="inst.totalNetPnl >= 0 ? 'gewinnWert' : 'verlustWert'">
                                {{ geld(inst.totalNetPnl) }}
                            </small>
                            <small v-if="schwebend[inst.id]" class="at-gedaempft">
                                {{ t('strategies.unrealizedShort') }}:
                                <strong :class="schwebend[inst.id].netPnl > 0 ? 'gewinnWert' : schwebend[inst.id].netPnl < 0 ? 'verlustWert' : ''">
                                    {{ (schwebend[inst.id].netPnl > 0 ? '+' : '') + geld(schwebend[inst.id].netPnl) }}
                                </strong><InfoTipp :text="schwebendHinweis(schwebend[inst.id])" />
                            </small>
                        </div>
                    </div>

                    <Hinweis v-if="inst.lastError" art="warn" class="oben klein-text">
                        {{ inst.lastError }}
                    </Hinweis>

                    <div v-if="verlaufOffen === inst.id" class="oben verlaufBox">
                        <div v-if="verlaufLaedt" class="at-gedaempft klein-text">
                            <Kreisel class="vor" />{{ t('strategies.historyLoading') }}
                        </div>
                        <template v-else>
                            <div v-for="z in verlaufDaten" :key="z.paramsVersion" class="verlaufZeile">
                                <div class="zeile">
                                    <Pille :ton="z.paramsVersion === inst.paramsVersion ? 'akzent' : 'neutral'">
                                        v{{ z.paramsVersion }}
                                    </Pille>
                                    <small class="at-gedaempft">{{ new Date(z.createdAt).toLocaleString() }}</small>
                                    <small class="at-gedaempft">· {{ verlaufQuelle(z.source) }}</small>
                                    <span class="kennzahlen">
                                        <small class="at-gedaempft">{{ t('strategies.trades') }}: <strong>{{ z.trades }}</strong></small>
                                        <small v-if="z.trades" :class="z.summeR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                            {{ z.summeR >= 0 ? '+' : '' }}{{ z.summeR.toFixed(2) }}R
                                        </small>
                                        <small v-if="z.trades" class="at-gedaempft">
                                            {{ t('strategies.kpiWinRate') }} {{ z.winRate?.toFixed(0) }}%
                                        </small>
                                    </span>
                                </div>
                                <div v-if="z.diff?.length" class="diff-zeile">
                                    <span v-for="d in z.diff" :key="d.key" class="diffBadge">
                                        {{ d.key }}: {{ d.alt }} → {{ d.neu }}
                                    </span>
                                </div>
                                <div v-else-if="z.diff" class="oben-klein">
                                    <small class="at-gedaempft kursiv">{{ t('strategies.historyNoDiff') }}</small>
                                </div>
                            </div>
                            <div v-if="!verlaufDaten.length" class="at-gedaempft klein-text">{{ t('strategies.historyEmpty') }}</div>
                        </template>
                    </div>

                    <!-- ══ Coin-Ausblick ══
                         Klick auf ein Symbol-Badge oben klappt hier die Trades
                         dieser Instanz auf genau diesem Coin auf. -->
                    <div v-if="coinOffen.instanceId === inst.id" class="oben verlaufBox">
                        <div v-if="coinLaedt" class="at-gedaempft klein-text">
                            <Kreisel class="vor" />{{ t('common.loading') }}
                        </div>
                        <template v-else>
                            <div v-if="!coinTrades.length" class="at-gedaempft klein-text">
                                {{ t('strategies.coinTradesEmpty', { symbol: coinOffen.symbol }) }}
                            </div>
                            <template v-else>
                                <div class="at-tabelle-huelle">
                                    <table class="at-tabelle dicht">
                                        <thead>
                                            <tr>
                                                <th>{{ t('strategies.exitTime') }}</th>
                                                <th>{{ t('strategies.direction') }}</th>
                                                <th class="zahl">R</th>
                                                <th class="zahl">PnL</th>
                                                <th>{{ t('strategies.byExitReason') }}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="tr in coinTrades" :key="tr.id">
                                                <td class="at-gedaempft">{{ dayjs(Number(tr.exitTime)).format('DD.MM. HH:mm') }}</td>
                                                <td>{{ tr.direction }}</td>
                                                <td class="zahl" :class="tr.rMultiple >= 0 ? 'gewinnWert' : 'verlustWert'">
                                                    {{ zahl(tr.rMultiple) }}
                                                </td>
                                                <td class="zahl" :class="tr.netPnl >= 0 ? 'gewinnWert' : 'verlustWert'">
                                                    {{ geld(tr.netPnl) }}
                                                </td>
                                                <td class="at-gedaempft">{{ tr.exitReason }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <Knopf klein symbol="linie" class="oben" @click="zurZwischenauswertung">
                                    {{ t('strategies.toInterimReview') }}
                                </Knopf>
                            </template>
                        </template>
                    </div>

                    <div class="knopfzeile oben">
                        <Knopf klein :symbol="inst.enabled ? 'pause' : 'play'" @click="umschalten(inst)">
                            {{ inst.enabled ? t('strategies.stop') : t('strategies.start') }}
                        </Knopf>
                        <Knopf klein symbol="stift" @click="bearbeiten(inst)">
                            {{ t('common.edit') }}
                        </Knopf>
                        <Knopf klein symbol="ki" :titel="t('strategies.optimizeTitle')"
                            @click="kiOptimieren(inst)">
                            {{ t('strategies.aiOptimize') }}
                        </Knopf>
                        <Knopf klein symbol="verlauf"
                            :class="{ aktiv: verlaufOffen === inst.id }"
                            @click="verlaufAnzeigen(inst)">
                            {{ t('strategies.historyBtn') }} (v{{ inst.paramsVersion }})
                        </Knopf>
                        <template v-if="loeschBestaetigung === inst.id">
                            <Knopf art="gefahr" klein @click="loeschen(inst)">{{ t('common.yes') }}</Knopf>
                            <Knopf art="leise" klein
                                @click="loeschBestaetigung = null">{{ t('common.no') }}</Knopf>
                        </template>
                        <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" class="rechts" :titel="t('common.delete')"
                            @click="loeschBestaetigung = inst.id" />
                    </div>

                </div>
            </template>

            <!-- ══ Editor ══ -->
            <template v-else>
                <div class="journalKarte karte">
                    <div class="editor-raster">
                        <div class="e-6">
                            <label class="at-label">{{ t('strategies.strategy') }}</label>
                            <select v-model="bearbeite.strategyId" class="at-feld klein"
                                :disabled="!istNeu" @change="strategieGewechselt">
                                <option v-for="s in registry.strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
                            </select>
                            <small v-if="gewaehlteStrategie" class="at-gedaempft">{{ gewaehlteStrategie.description }}</small>
                        </div>
                        <div class="e-6">
                            <label class="at-label">{{ t('strategies.name') }}</label>
                            <input v-model="bearbeite.name" class="at-feld klein" />
                        </div>
                        <div class="e-3 m-halb">
                            <label class="at-label">{{ t('strategies.modeLabel') }}</label>
                            <select v-model="bearbeite.mode" class="at-feld klein">
                                <option v-for="m in registry.modes" :key="m" :value="m">{{ t('strategies.mode_' + m) }}</option>
                            </select>
                        </div>
                        <div class="e-3 m-halb">
                            <label class="at-label">{{ t('strategies.brokerLabel') }}</label>
                            <select v-model="bearbeite.broker" class="at-feld klein">
                                <option v-for="b in registry.broker || []" :key="b.id" :value="b.id">{{ b.label }}</option>
                            </select>
                            <small class="at-gedaempft">{{ t('strategies.brokerHint') }}</small>
                        </div>
                        <div class="e-3 m-halb">
                            <label class="at-label">{{ t('strategies.timeframe') }}</label>
                            <select v-model="bearbeite.timeframe" class="at-feld klein"
                                @change="tfHauptGewechselt">
                                <option v-for="tf in gewaehlteStrategie?.supportedTimeframes || []" :key="tf" :value="tf">
                                    {{ tf }}
                                </option>
                            </select>
                        </div>
                        <div class="e-12">
                            <label class="at-label">
                                {{ t('strategies.extraTimeframes') }}
                                <span class="at-gedaempft" :title="t('strategies.extraTimeframesHint')"><Symbol name="info" /></span>
                            </label>
                            <div class="tf-zeile">
                                <button v-for="tf in gewaehlteStrategie?.supportedTimeframes || []" :key="tf"
                                    type="button"
                                    class="tf-knopf"
                                    :class="{ aktiv: tfAktiv(tf) }"
                                    :disabled="tf === bearbeite.timeframe"
                                    @click="tfUmschalten(tf)">
                                    {{ tf }}
                                </button>
                            </div>
                            <small class="at-gedaempft">{{ t('strategies.extraTimeframesHint') }}</small>
                        </div>
                        <div class="e-6">
                            <label class="at-label">{{ t('strategies.symbols') }}</label>
                            <div class="symbol-zeile">
                                <input v-model="symbolEingabe" class="at-feld klein"
                                    placeholder="BTCUSDT" @keydown.enter.prevent="symbolHinzu" />
                                <Knopf klein nurSymbol symbol="plus" :titel="t('common.hinzufuegen')" @click="symbolHinzu" />
                            </div>
                            <div class="pillen">
                                <Pille v-for="s in bearbeite.symbols" :key="s" ton="neutral"
                                    class="klickZiel" @click="symbolWeg(s)">
                                    {{ s }} <Symbol name="schliessen" />
                                </Pille>
                            </div>
                        </div>
                    </div>

                    <Hinweis v-if="bearbeite.mode === 'shadow'" art="info" class="abstand klein-text">
                        {{ t('strategies.shadowModeHint') }}
                    </Hinweis>

                    <Reiter v-model="editorReiter" :reiter="editorReiterListe" class="abstand" />
                    <div>
                        <div v-show="editorReiter === 'params'">
                            <StrategyParamForm v-model="bearbeite.params"
                                :schema="gewaehlteStrategie?.params || []"
                                :groups="gewaehlteStrategie?.paramGroups || []"
                                :i18nPrefix="'strategies.' + bearbeite.strategyId" />
                        </div>
                        <div v-show="editorReiter === 'risk'">
                            <StrategyParamForm v-model="bearbeite.risk"
                                :schema="registry.riskParams" i18nPrefix="strategies.risk" />
                        </div>
                    </div>

                    <div class="knopfzeile oben-gross">
                        <Knopf art="haupt" klein symbol="speichern" :disabled="speichern" @click="sichern">
                            {{ t('common.save') }}
                        </Knopf>
                        <Knopf art="leise" klein @click="bearbeite = null">
                            {{ t('common.cancel') }}
                        </Knopf>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
/* Pillen mit ganzem Satz dürfen umbrechen, sonst sprengen sie am Telefon die Breite. */
.satzPille {
    white-space: normal;
    max-width: 100%;
}

.instanzen-seite {
    padding: var(--abstand-4) var(--abstand-4) 0;
}

.instanzen-inhalt {
    max-width: 1500px;
}

/* `.journalKarte` setzt global `height: 100%`. Das passt für Raster mit einer Karte
   je Spalte, hier stehen die Karten aber gestapelt untereinander — dort zieht die
   Regel jede einzelne Karte auf die Höhe der GESAMTEN Spalte und erzeugt riesige
   Leerräume. */
.journalKarte {
    height: auto;
}

.karte {
    padding: var(--abstand-4);
}

.karte.leer {
    padding: var(--abstand-5);
    text-align: center;
}

.gefahr-rand {
    border: 1px solid var(--bad);
}

.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}

.seitentitel {
    margin: 0 auto 0 0;
}

.abstand {
    margin-bottom: var(--abstand-4);
}

.abstand-mittel {
    margin-bottom: var(--abstand-3);
}

.abstand-klein {
    margin: 0 0 var(--abstand-2);
}

.oben {
    margin-top: var(--abstand-2);
}

.oben-klein {
    margin-top: var(--abstand-1);
}

.oben-gross {
    margin-top: var(--abstand-4);
}

.klein-text {
    font-size: 0.85rem;
}

.kursiv {
    font-style: italic;
}

.vor {
    margin-right: var(--abstand-1);
}

.rechts {
    margin-left: auto;
}

.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.kennzahlen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2) var(--abstand-4);
    margin-left: auto;
}

.knopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.knopfzeile .aktiv {
    border-color: var(--accent);
    color: var(--accent);
}

.verlaufBox {
    padding: var(--abstand-2);
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
}

.verlaufZeile {
    padding: var(--abstand-2) 0;
}

.verlaufZeile + .verlaufZeile {
    border-top: 1px solid var(--line);
}

.diff-zeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
    margin-top: var(--abstand-1);
}

.diffBadge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-pille);
    background: var(--accent-flaeche);
    border: 1px solid var(--accent-rand);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 500;
}

.at-tabelle {
    font-size: 0.85rem;
    margin: 0;
}

.symbol-zeile {
    display: flex;
    gap: var(--abstand-2);
}

.symbol-zeile .at-feld {
    flex: 1 1 auto;
    min-width: 0;
}

.symbol-zeile {
    margin-bottom: var(--abstand-1);
}

.status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
}

.status-dot.on {
    background: var(--good);
    box-shadow: 0 0 6px var(--good);
}

.status-dot.off {
    background: var(--line-stark);
}

/* Editor: 12er-Raster wie vorher, Telefon einspaltig
   (Modus, Broker, Zeiteinheit teilen sich halbe Breiten). */
.editor-raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--abstand-2) var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

.editor-raster > * {
    grid-column: span 12;
    min-width: 0;
}

.at-label {
    margin-bottom: var(--abstand-1);
}

.tf-zeile,
.pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
}

.pillen {
    gap: var(--abstand-1);
}

.tf-knopf {
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-knopf);
    border: 1px solid var(--line);
    background: var(--panel-soft);
    color: var(--muted);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.tf-knopf:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--line-stark);
}

.tf-knopf.aktiv {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}

.tf-knopf:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}

@media (min-width: 768px) {
    .editor-raster > .e-3 { grid-column: span 3; }
    .editor-raster > .e-6 { grid-column: span 6; }
}

@media (max-width: 767.98px) {
    .instanzen-seite {
        padding: var(--abstand-3) var(--abstand-3) 0;
    }

    .karte {
        padding: var(--abstand-3);
    }

    .editor-raster > .m-halb {
        grid-column: span 6;
    }

    .kennzahlen {
        margin-left: 0;
        width: 100%;
    }
}
</style>
