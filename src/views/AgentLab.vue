<script setup>
/**
 * Labor: Backtest und Verbesserungsvorschläge.
 *
 * Der Backtest ist der Ort, an dem Parameter überhaupt erst beurteilbar werden
 * — ohne ihn sind Werte wie »Retest-Tiefe 25 %« geraten. Dieselbe Engine läuft
 * hier wie im Papierbetrieb, damit die Zahlen übertragbar sind.
 *
 * Vorschläge (auch die der Agenten) werden hier angenommen oder verworfen.
 * Angenommen werden sie ausschliesslich hier, durch den Nutzer — ein Agent kann
 * Parameter nie selbst setzen.
 */
import { ref, computed, onBeforeMount } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { seiteLaedt } from '../stores/ui.js'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../components/basis'
import KiHinweis from '../components/quellen/KiHinweis.vue'
import { formGeldStellen } from '../utils/journal/format.js'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import dayjs from '../utils/journal/zeit.js'

const { t, te } = useI18n()
const router = useRouter()

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {} })
const instanzen = ref([])
const laeufe = ref([])
const vorschlaege = ref([])
const ergebnis = ref(null)
const laueft = ref(false)
const fehler = ref('')

const form = ref({
    strategyId: '', instanceId: '', symbol: 'BTCUSDT', timeframe: '1h',
    // Zeitraum wahlweise als „Tage zurück" (der schnelle Alltagsfall) oder als
    // festes von/bis-Datum — z.B. eine Short-Strategie gezielt ab dem letzten
    // Allzeithoch. Beide Werte bleiben erhalten, der Schalter entscheidet.
    zeitmodus: 'tage',
    tage: 90,
    von: dayjs().subtract(90, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    startEquity: 1000, label: '',
    params: {}, risk: {},
})

/** Zeitraum eines Formulars (Modus Tage oder Datum) → { fromTs, toTs } oder null. */
function zeitraumVon(f) {
    if (f.zeitmodus === 'tage') {
        const toTs = Date.now()
        return { fromTs: toTs - Number(f.tage) * 86400000, toTs }
    }
    const fromTs = dayjs(f.von).valueOf()
    const toTs = Math.min(dayjs(f.bis).endOf('day').valueOf(), Date.now())
    return fromTs < toTs ? { fromTs, toTs } : null
}

// Sucht das Allzeithoch in den Tageskerzen (~3 Jahre) und setzt „von" darauf.
const athLaedt = ref(false)
async function vonAufAth() {
    athLaedt.value = true
    try {
        const r = await axios.get('/api/binance/klines', {
            params: { symbol: form.value.symbol, interval: '1d', market: 'futures', limit: 1000 },
        })
        let hoch = -Infinity
        let hochT = null
        for (const k of r.data) {
            const h = Number(k[2])
            if (h > hoch) { hoch = h; hochT = Number(k[0]) }
        }
        if (hochT) {
            form.value.von = dayjs(hochT).format('YYYY-MM-DD')
            form.value.zeitmodus = 'datum'
            fehler.value = ''
        }
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.athFailed'), t)
    } finally {
        athLaedt.value = false
    }
}

// Mehrfach-Test: derselbe Parametersatz über mehrere Symbole und über zwei
// Zeitfenster. Die Trennung in Optimierungs- und Prüffenster ist der Kern —
// eine Einstellung, die nur dort gut ist, wo sie ausgesucht wurde, taugt nichts.
const matrix = ref({
    symbole: 'BTCUSDT, ETHUSDT',
    zeitmodus: 'tage',
    tage: 360,
    von: dayjs().subtract(360, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    gegenGespeicherte: true,
    laeuft: false,
    fehler: '',
    ergebnis: null,
})

const strategie = computed(() => registry.value.strategies.find((s) => s.id === form.value.strategyId) || null)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
// Ohne Verlust-Trades ist der Profit-Faktor nicht definiert (kommt als null).
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1
const geld = (v) => formGeldStellen(Number(v) || 0, 2)
/** Nur Datum — bei Abdeckungslücken zählt der Tag, nicht die Uhrzeit. */
const datum = (t) => (t ? new Date(Number(t)).toISOString().slice(0, 10) : '–')

async function laden() {
    try {
        const [reg, inst, bt, vs] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/backtests'),
            axios.get('/api/strategies/suggestions'),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        laeufe.value = bt.data
        vorschlaege.value = vs.data

        if (!form.value.strategyId && reg.data.strategies.length) {
            form.value.strategyId = reg.data.strategies[0].id
            strategieGewechselt()
        }
        form.value.risk = { ...reg.data.riskDefaults }
    } catch (e) {
        logError('AgentLab', 'Laden fehlgeschlagen', e)
    }
}

onBeforeMount(async () => {
    seiteLaedt.value = true
    await laden()
    seiteLaedt.value = false
})

function strategieGewechselt() {
    const s = strategie.value
    if (!s) return
    form.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    if (!s.supportedTimeframes.includes(form.value.timeframe)) {
        form.value.timeframe = s.supportedTimeframes[0]
    }
}

/** Parameter einer bestehenden Instanz übernehmen — der häufigste Ausgangspunkt. */
function vonInstanz() {
    const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
    if (!inst) return
    form.value.strategyId = inst.strategyId
    form.value.timeframe = inst.timeframe
    form.value.symbol = inst.symbols?.[0] || form.value.symbol
    form.value.params = { ...inst.params }
    form.value.risk = { ...inst.risk }
    form.value.label = t('strategies.fromInstance', { name: inst.name })
}

async function starten() {
    laueft.value = true
    fehler.value = ''
    ergebnis.value = null
    try {
        const zeitraum = zeitraumVon(form.value)
        if (!zeitraum) {
            fehler.value = t('strategies.rangeInvalid')
            laueft.value = false
            return
        }
        const { fromTs, toTs } = zeitraum
        const r = await axios.post('/api/strategies/backtest', {
            strategyId: form.value.strategyId,
            instanceId: Number(form.value.instanceId) || 0,
            symbol: form.value.symbol,
            timeframe: form.value.timeframe,
            fromTs, toTs,
            startEquity: Number(form.value.startEquity),
            label: form.value.label,
            params: form.value.params,
            risk: form.value.risk,
        })
        ergebnis.value = r.data
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        laueft.value = false
    }
}

// ── Robustheit: Stabilität, Monte Carlo, Walk-forward ───────────────────
// Bewusst am SELBEN Formular wie der Backtest: Strategie, Symbol, Zeitraum und
// Parameter sollen für alle Prüfungen dieselben sein, sonst vergleicht man
// hinterher Äpfel mit Birnen.
const robust = ref({
    paramKey: '', von: 5, bis: 30, schritt: 5,
    laeufe: 1000, fenster: 4,
    laeuft: '', fehler: '',
    // Mehrere Symbole für die Matrix — der Einzellauf verleitet dazu, ein
    // Zufallsplateau für eine Eigenschaft der Strategie zu halten.
    symbole: 'BTCUSDT, ETHUSDT, SOLUSDT',
    stabilitaet: null, montecarlo: null, walkforward: null, matrixStab: null,
})

/** Zahlen-Parameter der gewählten Strategie — nur die lassen sich durchfahren. */
const zahlParameter = computed(() =>
    (strategie.value?.params || []).filter((p) => p.type === 'number' || p.type === 'integer'))

/** Stufenreihe aus von/bis/Schritt. Ganzzahl-Parameter bekommen ganze Stufen. */
const stufen = computed(() => {
    const p = zahlParameter.value.find((x) => x.key === robust.value.paramKey)
    const schritt = Math.abs(Number(robust.value.schritt)) || 1
    const raus = []
    for (let w = Number(robust.value.von); w <= Number(robust.value.bis) + 1e-9; w += schritt) {
        raus.push(p?.type === 'integer' ? Math.round(w) : Number(w.toFixed(4)))
        if (raus.length >= 25) break
    }
    return [...new Set(raus)]
})

function robustBasis() {
    const zeitraum = zeitraumVon(form.value)
    if (!zeitraum) return null
    return {
        strategyId: form.value.strategyId,
        symbol: form.value.symbol,
        timeframe: form.value.timeframe,
        fromTs: zeitraum.fromTs, toTs: zeitraum.toTs,
        startEquity: Number(form.value.startEquity),
        params: form.value.params, risk: form.value.risk,
    }
}

async function robustStarten(art) {
    const basis = robustBasis()
    if (!basis) { robust.value.fehler = t('strategies.rangeInvalid'); return }
    robust.value.laeuft = art
    robust.value.fehler = ''
    try {
        if (art === 'montecarlo') {
            const r = await axios.post('/api/strategies/robustness/montecarlo',
                { ...basis, laeufe: Number(robust.value.laeufe) || 1000 })
            robust.value.montecarlo = r.data
        } else if (art === 'stabilitaet') {
            const r = await axios.post('/api/strategies/robustness/stability',
                { ...basis, paramKey: robust.value.paramKey, werte: stufen.value })
            robust.value.stabilitaet = r.data
        } else if (art === 'matrix') {
            const r = await axios.post('/api/strategies/robustness/stability-matrix', {
                ...basis,
                paramKey: robust.value.paramKey,
                werte: stufen.value,
                symbole: robust.value.symbole.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
            })
            robust.value.matrixStab = r.data
        } else {
            const r = await axios.post('/api/strategies/robustness/walkforward',
                { ...basis, paramKey: robust.value.paramKey, werte: stufen.value, fenster: Number(robust.value.fenster) || 4 })
            robust.value.walkforward = r.data
        }
    } catch (e) {
        robust.value.fehler = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        robust.value.laeuft = ''
    }
}

/**
 * Lesbarer Name eines Parameters. Denselben Pfad benutzt auch das
 * Parameter-Formular (`strategies.<strategie>.<schlüssel>`) — eine zweite
 * Konvention hätte hier rohe Schlüssel angezeigt, während daneben Klartext steht.
 */
function parameterName(p) {
    const key = p.labelKey || `strategies.${form.value.strategyId}.${p.key}`
    return te(key) ? t(key) : p.key
}

/**
 * Entscheidung zu einem Lauf festhalten. Die Notiz ist freiwillig, aber genau
 * sie beantwortet in vier Wochen die Frage „warum eigentlich?" — deshalb wird
 * danach gefragt statt sie wegzulassen.
 */
async function laufEntscheiden(lauf, entscheidung) {
    const notiz = window.prompt(t('strategies.regNotePrompt'), lauf.notiz || '')
    if (notiz === null) return
    try {
        await axios.post(`/api/strategies/backtests/${lauf.id}/decision`, { entscheidung, notiz })
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

/** Ton des Stabilitäts-Urteils (Pille) — Plateau gut, Nadel warnend. */
const urteilKlasse = (u) => (u === 'plateau' ? 'gut'
    : (u === 'nadel' || u === 'schmal' || u === 'uneinig') ? 'warn' : 'neutral')

/**
 * Mehrfach-Test starten.
 *
 * Verglichen wird gegen die GESPEICHERTEN Parameter der gewählten Instanz —
 * nur so beantwortet der Lauf die eigentliche Frage: „ist meine Änderung besser
 * als das, was gerade läuft?" Ohne Instanz gibt es keinen Vergleich, dann zeigt
 * die Matrix nur die Zahlen des aktuellen Satzes.
 */
async function matrixStarten() {
    matrix.value.laeuft = true
    matrix.value.fehler = ''
    matrix.value.ergebnis = null
    try {
        const symbole = matrix.value.symbole.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
        const zeitraum = zeitraumVon(matrix.value)
        if (!zeitraum) {
            matrix.value.fehler = t('strategies.rangeInvalid')
            matrix.value.laeuft = false
            return
        }
        const { fromTs, toTs } = zeitraum
        const r = await axios.post('/api/strategies/backtest-matrix', {
            strategyId: form.value.strategyId,
            timeframe: form.value.timeframe,
            symbols: symbole,
            fromTs,
            toTs,
            startEquity: Number(form.value.startEquity),
            params: form.value.params,
            baselineParams: (matrix.value.gegenGespeicherte && inst) ? inst.params : null,
            risk: form.value.risk,
        })
        matrix.value.ergebnis = r.data
    } catch (e) {
        matrix.value.fehler = apiFehlerText(e, t('strategies.matrixFailed'), t)
    } finally {
        matrix.value.laeuft = false
    }
}

const matrixZahl = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))

/**
 * Übergibt die gewählte Instanz an den KI-Coach. Der `?agentPrompt=`-Deep-Link
 * startet dort automatisch einen Agentenlauf — die Optimizer-Werkzeuge sind
 * dieselben, die auch der Coach im Journal nutzt.
 */
function optimierenLassen() {
    const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
    if (!inst) {
        fehler.value = t('strategies.pickInstanceFirst')
        return
    }
    // Über den Router statt window.location: KiAgent liest `agentPrompt` aus
    // route.query, ein vollständiger Seitenneuaufbau ist dafür unnötig.
    router.push({ path: '/ki-coach', query: {
        agentPrompt: t('strategies.optimizePrompt', { name: inst.name, id: inst.id }),
    } })
}

/**
 * Backtest-Läufe löschen. Zweistufig bestätigt, weil ein Lauf auch als Beleg für
 * einen Optimizer-Vorschlag dienen kann.
 */
const loeschBestaetigung = ref(null)
async function laufLoeschen(l) {
    try {
        await axios.delete(`/api/strategies/backtests/${l.id}`)
        loeschBestaetigung.value = null
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

const alleLoeschenFrage = ref(false)
async function alleLaeufeLoeschen() {
    try {
        await axios.delete('/api/strategies/backtests?confirm=true')
        alleLoeschenFrage.value = false
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function entscheiden(v, wie) {
    try {
        await axios.post(`/api/strategies/suggestions/${v.id}/${wie}`)
        vorschlaege.value = (await axios.get('/api/strategies/suggestions')).data
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.decideFailed'), t)
    }
}

const sortiert = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
const instanzName = (id) => instanzen.value.find((i) => i.id === id)?.name || '–'
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="seite">
        <div class="seiteInnen">
            <h5 class="seitenTitel">{{ t('strategies.labTitle') }}</h5>
            <Hinweis v-if="fehler" art="fehler" class="abstandUnten3">{{ fehler }}</Hinweis>

            <!-- ══ Vorschläge ══ -->
            <div v-if="vorschlaege.filter(v => v.status === 'pending').length" class="journalKarte karte">
                <div class="section-title abstandUnten">
                    <Symbol name="idee" class="vorSymbol" />{{ t('strategies.suggestions') }}
                </div>
                <p class="at-gedaempft fein">{{ t('strategies.suggestionsHint') }}</p>
                <div v-for="v in vorschlaege.filter(v => v.status === 'pending')" :key="v.id"
                    class="vorschlag">
                    <div class="zeileMitSymbol abstandUnten1">
                        <strong class="fein">{{ v.title }}</strong>
                        <Pille ton="neutral">{{ instanzName(v.instanceId) }}</Pille>
                        <Pille ton="neutral">{{ v.source }}</Pille>
                    </div>
                    <p class="fein at-gedaempft abstandUnten" :data-ki-generiert="v.source === 'agent' ? 'true' : null">{{ v.rationale }}</p>
                    <!-- S12: Vorschläge des KI-Agenten tragen das Pflichtlabel. -->
                    <KiHinweis v-if="v.source === 'agent'" klein />
                    <div class="chips abstandUnten">
                        <Pille v-for="(wert, key) in v.proposedParams" :key="key" ton="neutral">
                            {{ key }}: {{ wert }}
                        </Pille>
                    </div>
                    <div class="knopfZeile">
                        <Knopf art="haupt" klein @click="entscheiden(v, 'accept')">
                            {{ t('strategies.acceptSuggestion') }}
                        </Knopf>
                        <Knopf klein @click="entscheiden(v, 'reject')">
                            {{ t('strategies.rejectSuggestion') }}
                        </Knopf>
                    </div>
                </div>
            </div>

            <!-- ══ Backtest ══ -->
            <div class="journalKarte karte">
                <div class="section-title abstandUnten">{{ t('strategies.backtest') }}</div>
                <div class="raster unten abstandUnten3">
                    <div class="b3 m3">
                        <label class="at-label">{{ t('strategies.strategy') }}</label>
                        <select v-model="form.strategyId" class="at-feld klein" @change="strategieGewechselt">
                            <option v-for="s in registry.strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </select>
                    </div>
                    <div class="b3 m3">
                        <label class="at-label">{{ t('strategies.fromInstanceLabel') }}</label>
                        <div class="reihe">
                            <select v-model="form.instanceId" class="at-feld klein">
                                <option value="">–</option>
                                <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                            </select>
                            <Knopf klein nurSymbol symbol="herunterladen" :disabled="!form.instanceId"
                                :titel="t('strategies.copyFromInstance')"
                                @click="vonInstanz" />
                        </div>
                    </div>
                    <div class="b3">
                        <Knopf klein symbol="ki" class="voll" :disabled="!form.instanceId"
                            :titel="t('strategies.optimizeTitle')"
                            @click="optimierenLassen">
                            {{ t('strategies.aiOptimize') }}
                        </Knopf>
                    </div>
                    <div class="b2 m3">
                        <label class="at-label">{{ t('strategies.symbol') }}</label>
                        <input v-model="form.symbol" class="at-feld klein" />
                    </div>
                    <div class="b2 m3">
                        <label class="at-label">{{ t('strategies.timeframe') }}</label>
                        <select v-model="form.timeframe" class="at-feld klein">
                            <option v-for="tf in strategie?.supportedTimeframes || []" :key="tf" :value="tf">{{ tf }}</option>
                        </select>
                    </div>
                    <div class="b1 m3">
                        <label class="at-label">{{ t('strategies.period') }}</label>
                        <select v-model="form.zeitmodus" class="at-feld klein">
                            <option value="tage">{{ t('strategies.days') }}</option>
                            <option value="datum">{{ t('strategies.dateRange') }}</option>
                        </select>
                    </div>
                    <div v-if="form.zeitmodus === 'tage'" class="b1 m3">
                        <label class="at-label">{{ t('strategies.days') }}</label>
                        <input v-model.number="form.tage" type="number" min="7" max="720"
                            class="at-feld klein" />
                    </div>
                    <template v-else>
                        <div class="b2">
                            <label class="at-label">{{ t('strategies.from') }}</label>
                            <div class="reihe">
                                <input v-model="form.von" type="date" class="at-feld klein" />
                                <Knopf klein class="festeBreite"
                                    :disabled="athLaedt" :titel="t('strategies.sinceAthTitle')"
                                    @click="vonAufAth">
                                    <Kreisel v-if="athLaedt" still />
                                    <span v-else>{{ t('strategies.sinceAth') }}</span>
                                </Knopf>
                            </div>
                        </div>
                        <div class="b2">
                            <label class="at-label">{{ t('strategies.to') }}</label>
                            <input v-model="form.bis" type="date" class="at-feld klein" />
                        </div>
                    </template>
                    <div class="b1">
                        <Knopf art="haupt" klein class="voll" :disabled="laueft" @click="starten">
                            <Kreisel v-if="laueft" still />
                            <span v-else>{{ t('strategies.run') }}</span>
                        </Knopf>
                    </div>
                </div>

                <p v-if="form.instanceId" class="fein at-gedaempft abstandUnten">
                    <Symbol name="ki" class="vorSymbol" />{{ t('strategies.optimizeHint') }}
                </p>

                <details>
                    <summary class="fein at-gedaempft klickZiel abstandUnten">{{ t('strategies.showParams') }}</summary>
                    <div class="paramSpalten">
                        <div>
                            <StrategyParamForm v-model="form.params" :schema="strategie?.params || []"
                                :groups="strategie?.paramGroups || []" :i18nPrefix="'strategies.' + form.strategyId" />
                        </div>
                        <div>
                            <StrategyParamForm v-model="form.risk" :schema="registry.riskParams"
                                i18nPrefix="strategies.risk" />
                        </div>
                    </div>
                </details>
            </div>

            <!-- ══ Robustheit ══
                 Drei Stufen zwischen „guter Backtest" und „belastbar". Sie
                 benutzen bewusst dasselbe Formular wie der Backtest darüber. -->
            <div class="journalKarte karte">
                <div class="section-title abstandUnten1">
                    <Symbol name="schildHaken" class="vorSymbol" />{{ t('strategies.robustTitle') }}
                </div>
                <p class="fein at-gedaempft">{{ t('strategies.robustHint') }}</p>

                <div class="raster unten abstandUnten">
                    <div class="b3">
                        <label class="at-label">{{ t('strategies.robustParam') }}</label>
                        <select v-model="robust.paramKey" class="at-feld klein">
                            <option value="">—</option>
                            <option v-for="p in zahlParameter" :key="p.key" :value="p.key">
                                {{ parameterName(p) }}
                            </option>
                        </select>
                    </div>
                    <div class="b2 m2">
                        <label class="at-label">{{ t('strategies.robustFrom') }}</label>
                        <input v-model.number="robust.von" type="number" class="at-feld klein" />
                    </div>
                    <div class="b2 m2">
                        <label class="at-label">{{ t('strategies.robustTo') }}</label>
                        <input v-model.number="robust.bis" type="number" class="at-feld klein" />
                    </div>
                    <div class="b2 m2">
                        <label class="at-label">{{ t('strategies.robustStep') }}</label>
                        <input v-model.number="robust.schritt" type="number" step="0.1" class="at-feld klein" />
                    </div>
                    <div class="b2 m3">
                        <label class="at-label">{{ t('strategies.robustRuns') }}</label>
                        <input v-model.number="robust.laeufe" type="number" min="100" max="5000" step="100"
                            class="at-feld klein" />
                    </div>
                    <div class="b1 m3">
                        <label class="at-label">{{ t('strategies.robustWindows') }}</label>
                        <input v-model.number="robust.fenster" type="number" min="2" max="12"
                            class="at-feld klein" />
                    </div>
                    <div class="b12">
                        <label class="at-label">{{ t('strategies.robustSymbols') }}</label>
                        <input v-model="robust.symbole" class="at-feld klein" placeholder="BTCUSDT, ETHUSDT" />
                    </div>
                    <div class="b12">
                        <div class="stufenLeiste">
                            <span class="stufenTitel">{{ t('strategies.robustSteps', { n: stufen.length }) }}</span>
                            <span v-for="w in stufen" :key="w" class="stufenWert">{{ w }}</span>
                        </div>
                    </div>
                </div>

                <div class="knopfZeile abstandUnten3">
                    <Knopf klein :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('stabilitaet')">
                        <Kreisel v-if="robust.laeuft === 'stabilitaet'" still />
                        {{ t('strategies.robustStability') }}
                    </Knopf>
                    <Knopf klein :disabled="!!robust.laeuft"
                        @click="robustStarten('montecarlo')">
                        <Kreisel v-if="robust.laeuft === 'montecarlo'" still />
                        {{ t('strategies.robustMonteCarlo') }}
                    </Knopf>
                    <Knopf art="haupt" klein :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('matrix')">
                        <Kreisel v-if="robust.laeuft === 'matrix'" still />
                        {{ t('strategies.robustMatrix') }}
                    </Knopf>
                    <Knopf klein :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('walkforward')">
                        <Kreisel v-if="robust.laeuft === 'walkforward'" still />
                        {{ t('strategies.robustWalkForward') }}
                    </Knopf>
                </div>

                <Hinweis v-if="robust.fehler" art="fehler" class="abstandUnten">{{ robust.fehler }}</Hinweis>

                <!-- Stabilität über mehrere Symbole und beide Fenster -->
                <div v-if="robust.matrixStab?.proWert" class="abstandUnten3">
                    <div class="zeileMitSymbol abstandUnten1">
                        <strong class="fein">{{ t('strategies.robustMatrix') }}</strong>
                        <Pille :ton="urteilKlasse(robust.matrixStab.urteil)">
                            {{ t('strategies.mverdict_' + robust.matrixStab.urteil) }}
                        </Pille>
                        <span class="fein at-gedaempft">
                            {{ t('strategies.robustCells', {
                                n: robust.matrixStab.zellen.length,
                                s: robust.matrixStab.symbole.join(', '),
                            }) }}
                        </span>
                        <!-- Datenlücken gehören neben das Urteil, nicht in eine
                             Fussnote: sie erklären, warum eine Zelle schweigt. -->
                        <Pille v-if="robust.matrixStab.unvollstaendig" ton="warn">
                            {{ t('strategies.robustGaps', { n: robust.matrixStab.unvollstaendig }) }}
                        </Pille>
                    </div>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead><tr>
                                <th>{{ t('strategies.robustValue') }}</th>
                                <th class="zahl">{{ t('strategies.mcolHolds') }}</th>
                                <th class="zahl">{{ t('strategies.mcolMedian') }}</th>
                                <th class="zahl">{{ t('strategies.mcolWorst') }}</th>
                                <th class="zahl">{{ t('strategies.mcolBest') }}</th>
                                <th></th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="p in robust.matrixStab.proWert" :key="p.wert">
                                    <td><strong>{{ p.wert }}</strong></td>
                                    <td class="zahl">{{ p.positiv }}/{{ p.zellen }}</td>
                                    <td class="zahl" :class="p.median >= 0 ? 'gewinnWert' : 'verlustWert'">{{ zahl(p.median) }}</td>
                                    <td class="zahl verlustWert">{{ zahl(p.schlechteste) }}</td>
                                    <td class="zahl gewinnWert">{{ zahl(p.beste) }}</td>
                                    <td class="zahl">
                                        <Pille v-if="p.traegt" ton="gut">{{ t('strategies.mHolds') }}</Pille>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="fussnote">{{ t('strategies.robustMatrixHint') }}</p>
                </div>

                <!-- Stabilität -->
                <div v-if="robust.stabilitaet && robust.stabilitaet.punkte" class="abstandUnten3">
                    <div class="zeileMitSymbol abstandUnten1">
                        <strong class="fein">{{ t('strategies.robustStability') }}</strong>
                        <Pille :ton="urteilKlasse(robust.stabilitaet.urteil)">
                            {{ t('strategies.verdict_' + robust.stabilitaet.urteil) }}
                        </Pille>
                        <span v-if="robust.stabilitaet.plateau?.length" class="fein at-gedaempft">
                            {{ t('strategies.robustPlateau', { werte: robust.stabilitaet.plateau.join(', ') }) }}
                        </span>
                    </div>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead><tr>
                                <th>{{ t('strategies.robustValue') }}</th>
                                <th class="zahl">{{ t('strategies.kpiTrades') }}</th>
                                <th class="zahl">{{ t('strategies.kpiExpectancy') }}</th>
                                <th class="zahl">{{ t('strategies.kpiExpectancyOhneTop') }}</th>
                                <th class="zahl">{{ t('strategies.kpiReturn') }}</th>
                                <th class="zahl">{{ t('strategies.kpiMaxDd') }}</th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="p in robust.stabilitaet.punkte" :key="p.wert"
                                    :class="{ besterWert: p.wert === robust.stabilitaet.besterWert }">
                                    <td><strong>{{ p.wert }}</strong></td>
                                    <td class="zahl" :class="{ 'at-gedaempft': !p.belastbar }">{{ p.trades }}</td>
                                    <td class="zahl" :class="p.expectancyR >= 0 ? 'gewinnWert' : 'verlustWert'">{{ zahl(p.expectancyR) }}</td>
                                    <td class="zahl" :class="p.expectancyROhneTop >= 0 ? 'gewinnWert' : 'verlustWert'">{{ zahl(p.expectancyROhneTop) }}</td>
                                    <td class="zahl">{{ zahl(p.returnPct, 1) }} %</td>
                                    <td class="zahl">{{ zahl(p.maxDrawdownPct, 1) }} %</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Monte Carlo -->
                <div v-if="robust.montecarlo?.monteCarlo" class="abstandUnten3">
                    <strong class="fein zeileFuer abstandUnten1">{{ t('strategies.robustMonteCarlo') }}</strong>
                    <div v-if="robust.montecarlo.monteCarlo.hinweis" class="fein at-gedaempft">
                        {{ robust.montecarlo.monteCarlo.hinweis }}
                    </div>
                    <template v-else>
                        <!-- Die wichtigste Zahl zuerst: wie oft ging es schief? -->
                        <Hinweis v-if="robust.montecarlo.monteCarlo.ziehen.anteilVerlust > 0.4" art="warn" class="abstandUnten">
                            {{ t('strategies.robustLossShare', {
                                p: (robust.montecarlo.monteCarlo.ziehen.anteilVerlust * 100).toFixed(0),
                                n: robust.montecarlo.monteCarlo.laeufe,
                            }) }}
                        </Hinweis>
                        <div v-else class="kasten abstandUnten">
                            {{ t('strategies.robustLossShare', {
                                p: (robust.montecarlo.monteCarlo.ziehen.anteilVerlust * 100).toFixed(0),
                                n: robust.montecarlo.monteCarlo.laeufe,
                            }) }}
                        </div>
                        <div class="kpis vier">
                            <div v-for="k in [
                                { l: t('strategies.mcEndP5'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p5) },
                                { l: t('strategies.mcEndP50'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p50) },
                                { l: t('strategies.mcEndP95'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p95) },
                                { l: t('strategies.mcDdP95'), v: zahl(robust.montecarlo.monteCarlo.reihenfolge.maxDrawdownPct.p95, 1) + ' %' },
                            ]" :key="k.l" class="kpi">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value">{{ k.v }}</div>
                            </div>
                        </div>
                    </template>
                </div>

                <!-- Walk-forward -->
                <div v-if="robust.walkforward?.abschnitte">
                    <div class="zeileMitSymbol abstandUnten1">
                        <strong class="fein">{{ t('strategies.robustWalkForward') }}</strong>
                        <Pille :ton="robust.walkforward.auswahlStabil ? 'gut' : 'warn'">
                            {{ robust.walkforward.auswahlStabil ? t('strategies.wfStable') : t('strategies.wfUnstable') }}
                        </Pille>
                    </div>
                    <div class="at-tabelle-huelle abstandUnten">
                        <table class="at-tabelle dicht">
                            <thead><tr>
                                <th>{{ t('strategies.wfSegment') }}</th>
                                <th>{{ t('strategies.wfChosen') }}</th>
                                <th class="zahl">{{ t('strategies.wfOos') }}</th>
                                <th class="zahl">{{ t('strategies.kpiTrades') }}</th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="(a, i) in robust.walkforward.abschnitte" :key="i">
                                    <td class="at-gedaempft">{{ datum(a.pruefVon) }} – {{ datum(a.pruefBis) }}</td>
                                    <td><strong>{{ a.gewaehlt }}</strong></td>
                                    <td class="zahl" :class="a.pruefExpectancyR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                        {{ zahl(a.pruefExpectancyR) }} R
                                    </td>
                                    <td class="zahl">{{ a.pruefTrades }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="kasten">
                        {{ t('strategies.wfTotal', {
                            trades: robust.walkforward.gesamt.trades,
                            expR: zahl(robust.walkforward.gesamt.expectancyR),
                            rendite: zahl(robust.walkforward.gesamt.returnPct, 2),
                            dd: zahl(robust.walkforward.gesamt.maxDrawdownPct, 1),
                        }) }}
                    </div>
                </div>
            </div>

            <!-- ══ Mehrfach-Test ══ -->
            <div class="journalKarte karte">
                <div class="section-title abstandUnten1">
                    <Symbol name="raster" class="vorSymbol" />{{ t('strategies.matrixTitle') }}
                </div>
                <p class="at-gedaempft fein abstandUnten">{{ t('strategies.matrixHint') }}</p>
                <div class="raster unten abstandUnten">
                    <div class="b3">
                        <label class="at-label">{{ t('strategies.matrixSymbols') }}</label>
                        <input v-model="matrix.symbole" type="text" class="at-feld klein"
                               placeholder="BTCUSDT, ETHUSDT" />
                    </div>
                    <div class="b1 m3">
                        <label class="at-label">{{ t('strategies.period') }}</label>
                        <select v-model="matrix.zeitmodus" class="at-feld klein">
                            <option value="tage">{{ t('strategies.days') }}</option>
                            <option value="datum">{{ t('strategies.dateRange') }}</option>
                        </select>
                    </div>
                    <div v-if="matrix.zeitmodus === 'tage'" class="b1 m3">
                        <label class="at-label">{{ t('strategies.days') }}</label>
                        <input v-model.number="matrix.tage" type="number" min="14" max="720"
                            class="at-feld klein" />
                    </div>
                    <template v-else>
                        <div class="b2 m3">
                            <label class="at-label">{{ t('strategies.from') }}</label>
                            <input v-model="matrix.von" type="date" class="at-feld klein" />
                        </div>
                        <div class="b2 m3">
                            <label class="at-label">{{ t('strategies.to') }}</label>
                            <input v-model="matrix.bis" type="date" class="at-feld klein" />
                        </div>
                    </template>
                    <div class="b3">
                        <label class="at-check fein" for="matrixVergleich">
                            <input id="matrixVergleich" v-model="matrix.gegenGespeicherte" type="checkbox" />
                            {{ t('strategies.matrixCompare') }}
                        </label>
                    </div>
                    <div class="b2">
                        <Knopf art="haupt" klein class="voll" :disabled="matrix.laeuft || !form.strategyId"
                                @click="matrixStarten">
                            {{ matrix.laeuft ? t('strategies.running') : t('strategies.matrixStart') }}
                        </Knopf>
                    </div>
                </div>

                <div v-if="matrix.fehler" class="at-schlecht fein abstandUnten">{{ matrix.fehler }}</div>

                <template v-if="matrix.ergebnis">
                    <div v-if="matrix.ergebnis.urteil?.identisch" class="kasten abstandUnten">
                        {{ t('strategies.matrixIdentical') }}
                    </div>
                    <Hinweis v-else-if="matrix.ergebnis.urteil" class="abstandUnten"
                         :art="matrix.ergebnis.urteil.bestanden ? 'gut' : 'warn'">
                        <strong>{{ matrix.ergebnis.urteil.bestanden
                            ? t('strategies.matrixPassed') : t('strategies.matrixFailedVerdict') }}</strong>
                        —
                        {{ t('strategies.matrixScore', {
                            besser: matrix.ergebnis.urteil.besser,
                            felder: matrix.ergebnis.urteil.felder,
                        }) }}
                    </Hinweis>
                    <div class="at-tabelle-huelle">
                        <table class="at-tabelle dicht">
                            <thead>
                                <tr>
                                    <th>{{ t('strategies.symbol') }}</th>
                                    <th>{{ t('strategies.matrixWindow') }}</th>
                                    <th class="zahl">{{ t('strategies.kpiTrades') }}</th>
                                    <th class="zahl" v-if="matrix.ergebnis.urteil">{{ t('strategies.matrixBase') }}</th>
                                    <th class="zahl">{{ t('strategies.matrixCandidate') }}</th>
                                    <th class="zahl" v-if="matrix.ergebnis.urteil">Δ</th>
                                    <th class="zahl">{{ t('strategies.matrixWithoutBest') }}</th>
                                    <th class="zahl">{{ t('strategies.kpiMaxDd') }}</th>
                                    <th class="zahl" :title="t('strategies.baselineHint')">{{ t('strategies.kpiBuyHold') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(z, i) in matrix.ergebnis.zeilen" :key="i">
                                    <td>{{ z.symbol }}</td>
                                    <td>{{ z.fenster === 'optimierung'
                                        ? t('strategies.matrixWindowOpt') : t('strategies.matrixWindowCheck') }}</td>
                                    <td class="zahl" :class="{ 'at-warn': z.kandidat.trades < 30 }">
                                        {{ z.kandidat.trades }}
                                    </td>
                                    <td class="zahl" v-if="matrix.ergebnis.urteil">
                                        {{ matrixZahl(z.basis?.expectancyR) }}
                                    </td>
                                    <td class="zahl">{{ matrixZahl(z.kandidat.expectancyR) }}</td>
                                    <td class="zahl" v-if="matrix.ergebnis.urteil"
                                        :class="z.deltaR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                        {{ z.deltaR >= 0 ? '+' : '' }}{{ matrixZahl(z.deltaR) }}
                                    </td>
                                    <td class="zahl">{{ matrixZahl(z.kandidat.ohneBestenR) }}</td>
                                    <td class="zahl">{{ matrixZahl(z.kandidat.maxDrawdownPct, 2) }} %</td>
                                    <td class="zahl at-gedaempft">
                                        {{ z.kandidat.baselineBuyHoldReturnPct === null ? '–'
                                            : matrixZahl(z.kandidat.baselineBuyHoldReturnPct, 1) + ' %' }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="fussnote">{{ t('strategies.matrixFootnote') }}</p>
                </template>
            </div>

            <!-- ══ Ergebnis ══ -->
            <div v-if="ergebnis" class="journalKarte karte">
                <div class="section-title abstandUnten">{{ t('strategies.result') }}</div>
                <div v-if="!ergebnis.stats.trades" class="at-gedaempft fein">
                    {{ ergebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                </div>
                <template v-else>
                    <!-- Zwei Warnungen, die vor jeder Zahl kommen müssen: zu
                         wenige Trades machen jede Kennzahl zum Zufall, und ein
                         unvollständiger Zeitraum misst still etwas anderes. -->
                    <Hinweis v-if="!ergebnis.stats.belastbar" art="warn" class="abstandUnten">
                        {{ t('strategies.nichtBelastbar', {
                            trades: ergebnis.stats.trades,
                            mindest: ergebnis.stats.mindestTrades,
                        }) }}
                    </Hinweis>
                    <Hinweis v-if="ergebnis.stats.abdeckung && !ergebnis.stats.abdeckung.vollstaendig"
                        art="fehler" class="abstandUnten">
                        {{ t('strategies.abdeckungLuecke', {
                            prozent: zahl(ergebnis.stats.abdeckung.prozent, 0),
                            vorhanden: ergebnis.stats.abdeckung.vorhanden,
                            erwartet: ergebnis.stats.abdeckung.erwartet,
                        }) }}
                        <template v-if="ergebnis.stats.abdeckung.fehlend.length">
                            — {{ t('strategies.abdeckungFehlt', { rand: ergebnis.stats.abdeckung.fehlend.join(' + ') }) }}
                            ({{ datum(ergebnis.stats.abdeckung.von) }} – {{ datum(ergebnis.stats.abdeckung.bis) }})
                        </template>
                    </Hinweis>

                    <!-- Ein Lauf, der wie ein gefilterter aussieht, aber keiner
                         war, ist die gefährlichste Sorte Ergebnis: man vergleicht
                         ihn mit gefilterten Läufen und zieht den falschen Schluss. -->
                    <Hinweis v-if="ergebnis.stats.htfFilter?.verlangt && !ergebnis.stats.htfFilter.aktiv"
                        art="fehler" class="abstandUnten">
                        {{ t('strategies.htfFilterInaktiv', {
                            tf: ergebnis.stats.htfFilter.timeframe,
                            kerzen: ergebnis.stats.htfFilter.kerzen,
                        }) }}
                    </Hinweis>

                    <!-- Der Hebel im Formular ist nicht zwingend der, mit dem
                         gerechnet wurde: der Betrieb kappt global, und das Labor
                         tut es seit dem Audit auch. Wer das nicht sieht,
                         vergleicht ein Laborergebnis mit einem Papierlauf, der
                         andere Positionsgrössen hatte. -->
                    <Hinweis v-if="ergebnis.stats.leverageGekappt" art="warn" class="abstandUnten">
                        {{ t('strategies.hebelGekappt', { hebel: ergebnis.stats.leverageEffektiv }) }}
                    </Hinweis>

                    <!-- Ein Lauf ohne Finanzierungskosten ist nicht dasselbe wie
                         einer, in dem sie nichts gekostet haben. Deshalb steht die
                         Annahme dabei — in beide Richtungen. -->
                    <div v-if="ergebnis.stats.trades" class="fein at-gedaempft abstandUnten">
                        <template v-if="ergebnis.stats.fundingModelliert">
                            <Symbol name="prozent" class="vorSymbol" />
                            {{ t('strategies.fundingKosten', {
                                bps: ergebnis.stats.fundingBpsPer8h,
                                betrag: geld(ergebnis.stats.funding),
                            }) }}
                        </template>
                        <template v-else>
                            <Symbol name="info" class="vorSymbol" />
                            {{ t('strategies.fundingNichtModelliert') }}
                        </template>
                    </div>

                    <!-- Am Stichtag noch offene Positionen zählen in KEINER
                         Kennzahl mit — weder in Trefferquote und Erwartung noch
                         in Rendite und Rückgang. Was sie wert wären, steht
                         deshalb hier daneben statt still in der Rendite. -->
                    <div v-if="ergebnis.stats.nochOffen" class="kasten abstandUnten">
                        <Symbol name="uhr" class="vorSymbol" />
                        {{ t('strategies.offenAmEnde', {
                            anzahl: ergebnis.stats.nochOffen,
                            wert: zahl(ergebnis.stats.unrealisiertPnl, 2),
                        }) }}
                    </div>

                    <!-- Sharpe ist `null`, wenn er nicht messbar ist (zu kurzer
                         Zeitraum oder eine Kurve ganz ohne Schwankung). Dann steht
                         hier ein Strich — eine 0 wäre an dieser Stelle keine
                         fehlende Zahl, sondern eine falsche Behauptung. -->
                    <div class="kpis abstandUnten3">
                        <div v-for="k in [
                            { l: t('strategies.kpiTrades'), v: ergebnis.stats.trades },
                            { l: t('strategies.kpiWinRate'), v: zahl(ergebnis.stats.winRate, 1) + ' %' },
                            { l: t('strategies.kpiExpectancy'), v: zahl(ergebnis.stats.expectancyR) + ' R',
                              farbe: ergebnis.stats.expectancyR >= 0 },
                            { l: t('strategies.kpiExpectancyOhneTop'), v: zahl(ergebnis.stats.expectancyROhneTop) + ' R',
                              farbe: ergebnis.stats.expectancyROhneTop >= 0 },
                            { l: t('strategies.kpiProfitFactor'),
                              v: profitFaktor(ergebnis.stats.profitFactor, ergebnis.stats.trades),
                              farbe: profitFaktorGut(ergebnis.stats.profitFactor) },
                            { l: t('strategies.kpiNetPnl'), v: geld(ergebnis.stats.netPnl),
                              farbe: ergebnis.stats.netPnl >= 0 },
                            { l: t('strategies.kpiMaxDd'), v: zahl(ergebnis.stats.maxDrawdownPct, 1) + ' %' },
                            { l: t('strategies.kpiFloatingDd'), v: zahl(ergebnis.stats.maxFloatingDrawdownPct, 1) + ' %' },
                            { l: t('strategies.kpiSharpe'),
                              v: ergebnis.stats.sharpe === null || ergebnis.stats.sharpe === undefined
                                  ? '—' : zahl(ergebnis.stats.sharpe, 2),
                              farbe: ergebnis.stats.sharpe === null || ergebnis.stats.sharpe === undefined
                                  ? undefined : ergebnis.stats.sharpe >= 1 },
                        ]" :key="k.l" class="kpi">
                            <div class="kpi-label">{{ k.l }}</div>
                            <div class="kpi-value"
                                :class="k.farbe === undefined ? '' : (k.farbe ? 'gewinnWert' : 'verlustWert')">
                                {{ k.v }}
                            </div>
                        </div>
                    </div>

                    <!-- Kontrollgruppe: schlägt die Strategie reines Halten? Ohne
                         sie ist eine positive Rendite bedeutungslos. -->
                    <p v-if="ergebnis.stats.baselineBuyHoldReturnPct !== null && ergebnis.stats.baselineBuyHoldReturnPct !== undefined"
                        class="fein abstandUnten3"
                        :class="ergebnis.stats.baselineDiffPct > 0 ? 'gewinnWert' : (ergebnis.stats.baselineDiffPct < 0 ? 'verlustWert' : 'at-gedaempft')">
                        <Symbol name="waage" class="vorSymbol" />
                        {{ ergebnis.stats.baselineDiffPct > 0
                            ? t('strategies.baselineBeats', { diff: zahl(Math.abs(ergebnis.stats.baselineDiffPct), 1) })
                            : ergebnis.stats.baselineDiffPct < 0
                                ? t('strategies.baselineMisses', { diff: zahl(Math.abs(ergebnis.stats.baselineDiffPct), 1) })
                                : t('strategies.baselineTie') }}
                        <span class="at-gedaempft">
                            ({{ t('strategies.returnPct') }} {{ zahl(ergebnis.stats.returnPct, 1) }} % ·
                            {{ t('strategies.kpiBuyHold') }} {{ zahl(ergebnis.stats.baselineBuyHoldReturnPct, 1) }} %)
                        </span>
                    </p>

                    <div class="zweiSpalten">
                        <div>
                            <div class="section-title abstandUnten1">{{ t('strategies.funnel') }}</div>
                            <table class="at-tabelle dicht">
                                <tbody>
                                    <tr v-for="k in ['setupsDetected', 'triggered', 'executed']" :key="k">
                                        <td>{{ t('strategies.bt_' + k) }}</td>
                                        <td class="zahl"><strong>{{ ergebnis.funnel[k] }}</strong></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <div class="section-title abstandUnten1">{{ t('strategies.whyLost') }}</div>
                            <table class="at-tabelle dicht">
                                <tbody>
                                    <tr v-for="[g, n] in sortiert(ergebnis.funnel.invalidated)" :key="g">
                                        <td>{{ t('strategies.reason_' + g) }}</td>
                                        <td class="zahl">{{ n }}</td>
                                    </tr>
                                    <tr v-for="[g, n] in sortiert(ergebnis.funnel.riskRejected)" :key="'r' + g">
                                        <td class="at-warn">{{ t('strategies.reason_' + g) }}</td>
                                        <td class="zahl">{{ n }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </template>
            </div>

            <!-- ══ Frühere Läufe ══ -->
            <div v-if="laeufe.length" class="journalKarte karte">
                <div class="laeufeKopf abstandUnten">
                    <div class="section-title">{{ t('strategies.previousRuns') }}</div>
                    <span class="titelKnoepfe">
                        <template v-if="alleLoeschenFrage">
                            <span class="fein at-gedaempft">{{ t('strategies.deleteAllRunsConfirm') }}</span>
                            <Knopf art="gefahr" klein @click="alleLaeufeLoeschen">
                                {{ t('common.yes') }}
                            </Knopf>
                            <Knopf klein
                                @click="alleLoeschenFrage = false">{{ t('common.no') }}</Knopf>
                        </template>
                        <Knopf v-else art="gefahr" klein symbol="muell"
                            @click="alleLoeschenFrage = true">
                            {{ t('strategies.deleteAllRuns') }}
                        </Knopf>
                    </span>
                </div>
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <thead>
                            <tr>
                                <th>{{ t('strategies.label') }}</th>
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.timeframe') }}</th>
                                <th class="zahl">{{ t('strategies.kpiTrades') }}</th>
                                <th class="zahl">{{ t('strategies.kpiWinRate') }}</th>
                                <th class="zahl">{{ t('strategies.kpiExpectancy') }}</th>
                                <th class="zahl">{{ t('strategies.kpiProfitFactor') }}</th>
                                <th>{{ t('strategies.period') }}</th>
                                <th :title="t('strategies.regCostsHint')">{{ t('strategies.regCosts') }}</th>
                                <th>{{ t('strategies.regDecision') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="l in laeufe" :key="l.id">
                                <td>{{ l.label || '–' }}</td>
                                <td>{{ l.symbol }}</td>
                                <td>{{ l.timeframe }}</td>
                                <td class="zahl">{{ l.stats.trades ?? 0 }}</td>
                                <td class="zahl">{{ zahl(l.stats.winRate, 1) }}</td>
                                <td class="zahl"
                                    :class="(l.stats.expectancyR || 0) >= 0 ? 'gewinnWert' : 'verlustWert'">
                                    {{ zahl(l.stats.expectancyR) }}
                                </td>
                                <td class="zahl">
                                    {{ profitFaktor(l.stats.profitFactor, l.stats.trades) }}
                                </td>
                                <td class="at-gedaempft keinUmbruch">
                                    {{ dayjs(Number(l.fromTs)).format('DD.MM.YY') }} –
                                    {{ dayjs(Number(l.toTs)).format('DD.MM.YY') }}
                                </td>
                                <!-- Kostenmodell und Regelfassung: ohne beides ist
                                     ein alter Lauf nicht nachstellbar. -->
                                <td class="at-gedaempft keinUmbruch">
                                    <!-- Läufe von vor der Maker/Taker-Aufteilung tragen
                                         nur einen Satz — der wird als solcher gezeigt,
                                         nicht in zwei erfundene Zahlen aufgeteilt. -->
                                    <template v-if="l.risk && l.risk.feeTakerBps !== undefined">
                                        {{ l.risk.feeMakerBps }}/{{ l.risk.feeTakerBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else-if="l.risk && l.risk.feeBps !== undefined">
                                        {{ l.risk.feeBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else>–</template>
                                    <Pille v-if="l.ruleVersion" ton="neutral" class="nebenan">v{{ l.ruleVersion }}</Pille>
                                    <Pille v-if="l.variantenGeprueft > 1" ton="warn" class="nebenan"
                                        :title="t('strategies.regVariantsHint')">
                                        {{ t('strategies.regVariants', { n: l.variantenGeprueft }) }}
                                    </Pille>
                                </td>
                                <td class="aktionen">
                                    <Pille v-if="l.entscheidung && l.entscheidung !== 'offen'"
                                        :ton="l.entscheidung === 'uebernommen' ? 'gut' : 'neutral'"
                                        :title="l.notiz || ''">
                                        {{ t('strategies.dec_' + l.entscheidung) }}
                                    </Pille>
                                    <Knopf klein nurSymbol symbol="haken"
                                        :titel="t('strategies.dec_uebernommen')"
                                        @click="laufEntscheiden(l, 'uebernommen')" />
                                    <Knopf klein nurSymbol symbol="schliessen"
                                        :titel="t('strategies.dec_verworfen')"
                                        @click="laufEntscheiden(l, 'verworfen')" />
                                </td>
                                <td class="zahl aktionen">
                                    <template v-if="loeschBestaetigung === l.id">
                                        <Knopf art="gefahr" klein
                                            @click="laufLoeschen(l)">{{ t('common.yes') }}</Knopf>
                                        <Knopf klein
                                            @click="loeschBestaetigung = null">{{ t('common.no') }}</Knopf>
                                    </template>
                                    <Knopf v-else art="gefahr" klein nurSymbol symbol="muell"
                                        :titel="t('strategies.deleteRun')"
                                        @click="loeschBestaetigung = l.id" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* ── Seitenrahmen ── */
.seite {
    padding: var(--abstand-4) var(--abstand-4) var(--abstand-5);
}

.seiteInnen {
    max-width: 1500px;
}

.karte {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

/* `.journalKarte` setzt global `height: 100%`. Hier stehen die Karten gestapelt
   untereinander — dort zieht die Regel jede einzelne Karte auf die Höhe der
   GESAMTEN Spalte und erzeugt riesige Leerräume. */
.journalKarte {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
}

.fein {
    font-size: 0.85rem;
}

.vorSymbol {
    margin-right: var(--abstand-1);
    vertical-align: -0.125em;
}

.abstandUnten1 { margin-bottom: var(--abstand-1); }
.abstandUnten { margin-bottom: var(--abstand-2); }
.abstandUnten3 { margin-bottom: var(--abstand-4); }
.abstandOben { margin-top: var(--abstand-2); }
.abstandOben3 { margin-top: var(--abstand-4); }

.rechts {
    margin-left: auto;
}

.zeileMitSymbol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.knopfZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

/* Neutraler Kasten (früher alert-secondary): eine Aussage, keine Warnung. */
.kasten {
    padding: var(--abstand-2) var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    font-size: 0.85rem;
}

.kastenZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.punkte {
    margin: 0;
    padding-left: var(--abstand-4);
}

/* ── Raster: 12 Spalten ab Tablet, auf dem Telefon 6 Spalten mit
   Vorgabe „ganze Breite" — wo zwei oder drei Felder nebeneinander
   lesbar bleiben, tragen sie m3 bzw. m2. ── */
.raster {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.raster.eng {
    gap: var(--abstand-1);
}

.raster.unten {
    align-items: end;
}

.raster.mittig {
    align-items: center;
}

.b1 { grid-column: span 1; }
.b2 { grid-column: span 2; }
.b3 { grid-column: span 3; }
.b4 { grid-column: span 4; }
.b5 { grid-column: span 5; }
.b6 { grid-column: span 6; }
.b8 { grid-column: span 8; }
.b12 { grid-column: 1 / -1; }
.ab5 { grid-column: 5 / span 4; }

.reihe {
    display: flex;
    gap: var(--abstand-1);
    min-width: 0;
}

.reihe > .at-feld {
    min-width: 0;
}

.voll {
    width: 100%;
}

.kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--abstand-2);
}

.kpi {
    text-align: center;
    padding: var(--abstand-2);
}

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
}

.kpi-value {
    font-size: 1.1rem;
    font-weight: 600;
}

.zweiSpalten {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--abstand-4);
}

.aktionen {
    white-space: nowrap;
}

.aktionen > * + * {
    margin-left: var(--abstand-1);
}

@media (max-width: 767.98px) {
    .seite {
        padding: var(--abstand-3) var(--abstand-4) var(--abstand-5);
    }

    .karte {
        padding: var(--abstand-3);
    }

    .raster {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    .raster > * {
        grid-column: 1 / -1;
    }

    .raster > .m3 { grid-column: span 3; }
    .raster > .m2 { grid-column: span 2; }

    .kpis {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .zweiSpalten {
        grid-template-columns: 1fr;
    }
}

/* ── Labor ── */
.seitenTitel {
    margin: 0 0 var(--abstand-4);
}

.vorschlag {
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
    margin-bottom: var(--abstand-2);
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.festeBreite {
    flex: 0 0 auto;
}

.paramSpalten {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: var(--abstand-4);
}

.zeileFuer {
    display: block;
}

.fussnote {
    margin: var(--abstand-1) 0 0;
    font-size: 0.85rem;
    color: var(--muted);
}

.stufenLeiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
}

.stufenTitel {
    font-size: 0.8rem;
    color: var(--muted);
    margin-right: 0.15rem;
}

.stufenWert {
    font-size: 0.8rem;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
    border: 1px solid var(--line);
}

tr.besterWert {
    background: var(--accent-flaeche);
}

.kpis.vier {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.laeufeKopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.titelKnoepfe {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
    margin-left: auto;
}

.keinUmbruch {
    white-space: nowrap;
}

.nebenan {
    margin-left: var(--abstand-1);
}

/* Breiter als lg: Parameter 7/5 nebeneinander, darunter untereinander
   (wie zuvor col-lg-7 / col-lg-5). */
@media (max-width: 991.98px) {
    .paramSpalten {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 767.98px) {
    .kpis.vier {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
