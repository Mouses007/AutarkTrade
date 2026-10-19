<script setup>
/**
 * Strategie-Editor.
 *
 * Hier entstehen Strategien ohne eine Zeile Code: Bausteine zusammenstellen,
 * prüfen lassen, backtesten. Der Server führt die Beschreibung mit einem festen
 * Interpreter aus — es wird nichts erzeugt und nichts ausgewertet, was von hier
 * kommt.
 *
 * Der Aufbau folgt dem Lebenslauf eines Setups, weil Strategien so gedacht
 * werden: Was löst aus? Was muss dabei stimmen? Wann steige ich ein? Was bricht
 * ab? Wo liegen Stop und Ziel?
 */
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import ZahlOderParam from '../components/ZahlOderParam.vue'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../components/basis'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import { useAgentTimelineChart } from '../utils/charts.js'

const { t } = useI18n()

const bausteine = ref({ indikatoren: [], signale: [], einstieg: [], vergleiche: [], anker: [], ziele: [],
    vwapAnker: [], muster: [] })

/** VWAP-Anker als Klartext. Schlüssel: vwapAnchorSession, vwapAnchorSwingHigh, … */
const ankerLabel = (a) => t('strategies.vwapAnchor' + a.charAt(0).toUpperCase() + a.slice(1))
const vorlagen = ref([])
const liste = ref([])
const meldung = ref('')
const fehler = ref('')
const pruefung = ref(null)

const entwurf = ref(null)
const istNeu = ref(false)
const speichert = ref(false)

// ── Backtest direkt aus dem Editor ──────────────────────────────────────
const test = ref({ symbol: 'BTCUSDT', timeframe: '1h', tage: 180 })
const testLaeuft = ref(false)
const testErgebnis = ref(null)

const ZEITEINHEITEN = ['5m', '15m', '30m', '1h', '4h', '1d']

// ── Im Gespräch bauen, direkt im Editor ─────────────────────────────────
// Derselbe Endpunkt wie die Seite „Neue Strategie", aber die Antwort landet
// im offenen Regelwerk statt in einem eigenen Entwurf. Der Gewinn ist nicht
// der Chat — den gab es schon —, sondern dass man SIEHT, welches Feld ein
// Satz verändert hat.
// Einfach- vs. Expertenmodus. Im Einfachmodus stehen die Sätze und die
// einstellbaren Werte — alles, was man zum Beurteilen und Nachjustieren
// braucht. Die Bausteine selbst sind Expertensache.
const einfach = ref(true)
const chatOffen = ref(true)
const chatVerlauf = ref([])
const chatEingabe = ref('')
const chatLaeuft = ref(false)
const chatFehler = ref('')
const chatFragen = ref([])
const chatNichtUmsetzbar = ref([])
const chatGeaendert = ref([])
const chatDraftId = ref(0)
const saetze = ref([])

/** Welche Abschnitte des Regelwerks hat die Antwort angefasst? */
function abschnitteDiff(alt, neu) {
    const schluessel = new Set([...Object.keys(alt || {}), ...Object.keys(neu || {})])
    const raus = []
    for (const k of schluessel) {
        if (JSON.stringify(alt?.[k]) !== JSON.stringify(neu?.[k])) raus.push(k)
    }
    return raus
}

/** Hebt einen Formularblock hervor, wenn die letzte Antwort ihn angefasst hat. */
function chatBetrifft(schluessel) {
    const liste = Array.isArray(schluessel) ? schluessel : [schluessel]
    return liste.some((k) => chatGeaendert.value.includes(k))
}

/** Beim Wechsel des Regelwerks gehoert das Gespraech zurueckgesetzt — sonst
 *  bezieht sich der Verlauf auf eine andere Strategie als die offene. */
function chatZuruecksetzen() {
    chatVerlauf.value = []
    chatFragen.value = []
    chatNichtUmsetzbar.value = []
    chatGeaendert.value = []
    chatFehler.value = ''
    chatEingabe.value = ''
    chatDraftId.value = 0
}

function frageUebernehmen(frage) {
    chatEingabe.value = chatEingabe.value ? `${chatEingabe.value}\n${frage} ` : `${frage} `
}

async function chatSenden() {
    const text = chatEingabe.value.trim()
    if (!text || chatLaeuft.value) return
    chatLaeuft.value = true
    chatFehler.value = ''
    chatVerlauf.value.push({ role: 'user', content: text })
    const gesendet = text
    chatEingabe.value = ''

    try {
        const r = await axios.post('/api/strategies/builder/rules/chat', {
            draftId: chatDraftId.value,
            message: gesendet,
            // Der aktuelle Stand geht mit, sonst überschreibt die Antwort
            // stillschweigend, was gerade von Hand geändert wurde.
            rules: entwurf.value?.rules || null,
        })
        chatVerlauf.value.push({ role: 'assistant', content: r.data.antwort })
        chatFragen.value = r.data.offeneFragen || []
        chatNichtUmsetzbar.value = r.data.nichtUmsetzbar || []
        chatDraftId.value = r.data.draftId || chatDraftId.value

        if (r.data.regeln) {
            const alt = entwurf.value.rules
            const neu = r.data.regeln
            chatGeaendert.value = abschnitteDiff(alt, neu)
            // Name und Kurzname gehören dem Nutzer — die überschreibt der Chat
            // nicht, sonst heisst die Strategie nach jeder Rückfrage anders.
            entwurf.value.rules = neu
            await pruefen()
        } else {
            chatGeaendert.value = []
        }
    } catch (e) {
        chatFehler.value = apiFehlerText(e, t('strategies.builderFailed'), t)
        chatVerlauf.value.pop()
        chatEingabe.value = gesendet
    } finally {
        chatLaeuft.value = false
    }
}

// ── Weitergeben: Export, Import, Vorlagen aufräumen ─────────────────────
const importFeld = ref(null)
const versteckteVorlagen = ref([])

/** Strategie als Datei sichern — reine Beschreibung, kein Handelsverlauf. */
async function exportieren(row) {
    fehler.value = ''
    try {
        const r = await axios.get(`/api/strategies/rules/${row.id}/export`)
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `strategie-${row.strategyId}-v${r.data.strategie?.version || 1}.json`
        a.click()
        URL.revokeObjectURL(url)
        meldung.value = t('strategies.exported', { name: row.name })
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.exportFailed'), t)
    }
}

async function importDatei(ereignis) {
    const datei = ereignis.target.files?.[0]
    // Feld sofort leeren, sonst löst dieselbe Datei beim zweiten Mal nichts aus.
    ereignis.target.value = ''
    if (!datei) return
    fehler.value = ''
    meldung.value = ''
    try {
        const text = await datei.text()
        let paket
        try { paket = JSON.parse(text) } catch { throw new Error(t('strategies.importNoJson')) }
        const r = await axios.post('/api/strategies/rules/import', { paket })
        await laden()
        meldung.value = r.data.umbenannt
            ? t('strategies.importedRenamed', { id: r.data.strategyId })
            : t('strategies.imported', { id: r.data.strategyId })
    } catch (e) {
        fehler.value = e.response ? apiFehlerText(e, t('strategies.importFailed'), t) : e.message
    }
}

/**
 * Vorlage aus der Auswahl nehmen. Sie steht im Code und wird nicht gelöscht —
 * das ist Absicht: eine Vorlage, die jemand ausblendet, soll später wieder
 * auftauchen können, ohne dass sie jemand neu schreiben muss.
 */
async function vorlageAusblenden(v) {
    const neu = [...new Set([...versteckteVorlagen.value, v.key])]
    await vorlagenSpeichern(neu)
}

async function vorlagenZurueckholen() {
    await vorlagenSpeichern([])
}

async function vorlagenSpeichern(liste2) {
    try {
        await axios.put('/api/db/settings', { strategyHiddenTemplates: liste2 })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

async function laden() {
    try {
        const [b, l] = await Promise.all([
            axios.get('/api/strategies/rules/blocks'),
            axios.get('/api/strategies/rules'),
        ])
        bausteine.value = b.data.bausteine
        vorlagen.value = b.data.vorlagen
        versteckteVorlagen.value = b.data.versteckteVorlagen || []
        liste.value = l.data
    } catch (e) {
        logError('AgentEditor', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

/** Alle Referenzen, die in einem Vergleich stehen dürfen. */
const referenzen = computed(() => [
    ...(bausteine.value.anker || []),
    ...(entwurf.value?.rules.indicators || []).map((i) => i.id),
])

const parameterNamen = computed(() => (entwurf.value?.rules.params || []).map((p) => p.key))

/** Farbe der Marktphasen-Badge: Trend blau, Seitwärts gelb, Rest neutral. */
function marktKlasse(markt) {
    const m = String(markt || '').toLowerCase()
    if (m.startsWith('seitwärts')) return 'marktSeitwaerts'
    if (m.startsWith('trend') || m.startsWith('bullentrend')) return 'marktTrend'
    return 'marktNeutral'
}

function ausVorlage(v) {
    istNeu.value = true
    entwurf.value = {
        strategyId: v.key,
        name: v.titel,
        description: v.beschreibung,
        rules: JSON.parse(JSON.stringify(v.rules)),
    }
    testErgebnis.value = null
    chatZuruecksetzen()
    pruefen()
}

function leer() {
    istNeu.value = true
    entwurf.value = {
        strategyId: '', name: '', description: '',
        rules: {
            timeframes: ['1h'], direction: 'long', warmupCandles: 300,
            params: [], indicators: [], signal: { type: 'pivotHigh', left: 5, right: 2 },
            // `signalPrice` als Vorgabe: ein frisches Regelwerk soll LAUFFÄHIG
            // starten — ein leerer Anker begrüsste den Nutzer sonst mit einem
            // kryptischen Validierungsfehler, bevor er irgendetwas getan hat.
            signalFilters: [], entry: { type: 'touch', anchor: 'signalPrice', from: 'above' },
            invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
            stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
            takeProfit: { mode: 'rr', rr: 2 },
            breakEvenAtR: 1,
        },
    }
    testErgebnis.value = null
    pruefung.value = null
    chatZuruecksetzen()
}

function bearbeiten(row) {
    istNeu.value = false
    entwurf.value = {
        id: row.id, strategyId: row.strategyId, name: row.name,
        description: row.description, rules: JSON.parse(JSON.stringify(row.rules)),
    }
    testErgebnis.value = null
    chatZuruecksetzen()
    pruefen()
}

/** Prüfung ohne Speichern — zeigt Fehler, während man baut. */
async function pruefen() {
    if (!entwurf.value) return
    try {
        const r = await axios.post('/api/strategies/rules/validate', {
            rules: { ...entwurf.value.rules, id: entwurf.value.strategyId || 'entwurf', name: entwurf.value.name },
        })
        pruefung.value = r.data
        saetze.value = r.data.saetze || []
    } catch (e) {
        pruefung.value = null
        saetze.value = []
    }
}

// ── Bausteine hinzufügen und entfernen ──────────────────────────────────
const r = () => entwurf.value.rules

function indikatorHinzu() {
    const n = r().indicators.length + 1
    r().indicators.push({ id: `ema${n}`, type: 'ema', period: 20 })
    pruefen()
}
const indikatorWeg = (i) => { r().indicators.splice(i, 1); pruefen() }

function paramHinzu() {
    r().params.push({ key: `wert${r().params.length + 1}`, type: 'number', label: '', default: 1, min: 0, max: 100, step: 0.1 })
    pruefen()
}
const paramWeg = (i) => { r().params.splice(i, 1); pruefen() }

function bedingungHinzu(liste) {
    r()[liste].push({ left: 'close', op: 'gt', right: referenzen.value[0] || 'close', code: '' })
    pruefen()
}
const bedingungWeg = (l, i) => { r()[l].splice(i, 1); pruefen() }

function abbruchHinzu(typ) {
    if (typ === 'timeout') r().invalidations.push({ type: 'timeout', code: 'zu_lang', candles: 20 })
    else r().invalidations.push({ type: 'condition', code: 'abbruch', when: { op: 'isBullish' } })
    pruefen()
}
const abbruchWeg = (i) => { r().invalidations.splice(i, 1); pruefen() }

const zeiteinheitAn = (tf) => {
    const l = r().timeframes
    const i = l.indexOf(tf)
    if (i >= 0) l.splice(i, 1); else l.push(tf)
    pruefen()
}

/** Referenz kann Text (Anker/Indikator) oder Parameter sein. */
function refText(ref) {
    if (ref && typeof ref === 'object') return ref.param ? `param:${ref.param}` : String(ref.value ?? '')
    return String(ref ?? '')
}
function refSetzen(obj, feld, wert) {
    obj[feld] = wert.startsWith('param:') ? { param: wert.slice(6) } : wert
    pruefen()
}

// ── Speichern, Kopieren, Löschen ────────────────────────────────────────
async function sichern() {
    speichert.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = {
            strategyId: entwurf.value.strategyId,
            name: entwurf.value.name,
            description: entwurf.value.description,
            rules: entwurf.value.rules,
        }
        if (istNeu.value) {
            const a = await axios.post('/api/strategies/rules', daten)
            entwurf.value.id = a.data.id
            istNeu.value = false
            meldung.value = t('strategies.editorSaved', { id: a.data.strategyId })
        } else {
            await axios.put(`/api/strategies/rules/${entwurf.value.id}`, daten)
            meldung.value = t('strategies.saved')
        }
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichert.value = false
    }
}

const loeschFrage = ref(null)
async function loeschen(row) {
    try {
        await axios.delete(`/api/strategies/rules/${row.id}`)
        loeschFrage.value = null
        if (entwurf.value?.id === row.id) entwurf.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function kopieren(row) {
    try {
        await axios.post(`/api/strategies/rules/${row.id}/duplicate`)
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

// ── Test ────────────────────────────────────────────────────────────────
// ── Chart zum Testlauf ──────────────────────────────────────────────────
// Der Wert liegt nicht in den gehandelten Trades, sondern in den VERWORFENEN
// Setups: sie zeigen, wo die Regel angesprungen ist und warum daraus nichts
// wurde. Eine Zahl im Trichter sagt „12 mal zone_broken" — der Chart zeigt wo.
let editorChart = null
const chartMeldung = ref('')

async function chartZeichnen() {
    chartMeldung.value = ''
    const erg = testErgebnis.value
    if (!erg) return
    try {
        // Kerzen so viele, wie der getestete Zeitraum umfasst — gedeckelt, sonst
        // wird der Chart unlesbar und der Abruf unnötig gross.
        const proTag = { '5m': 288, '15m': 96, '30m': 48, '1h': 24, '4h': 6, '1d': 1 }[test.value.timeframe] || 24
        const limit = Math.min(1000, Math.max(120, Math.round(proTag * Number(test.value.tage))))
        const k = await axios.get('/api/binance/klines', {
            params: { symbol: test.value.symbol.toUpperCase(), interval: test.value.timeframe, market: 'futures', limit },
        })
        const candles = k.data.map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4] }))
        if (!candles.length) { chartMeldung.value = t('strategies.timelineNoData'); return }

        await nextTick()
        editorChart?.dispose()
        editorChart = useAgentTimelineChart('editorChart', candles, erg.setups || [], erg.trades || [])
        if (!erg.setups?.length && !erg.trades?.length) {
            chartMeldung.value = t('strategies.chartNothingFound')
        }
    } catch (e) {
        logError('AgentEditor', 'Chart fehlgeschlagen', e)
        chartMeldung.value = t('strategies.chartFailed')
    }
}

async function testen() {
    if (!entwurf.value?.id) {
        fehler.value = t('strategies.saveBeforeTest')
        return
    }
    testLaeuft.value = true
    fehler.value = ''
    testErgebnis.value = null
    try {
        const toTs = Date.now()
        const a = await axios.post('/api/strategies/backtest', {
            strategyId: entwurf.value.strategyId,
            symbol: test.value.symbol.toUpperCase(),
            timeframe: test.value.timeframe,
            fromTs: toTs - Number(test.value.tage) * 86400000,
            toTs,
            startEquity: 1000,
            label: entwurf.value.name,
            risk: { cooldownMinutes: 0, minRR: 0 },
            save: false,
        })
        testErgebnis.value = a.data
        await chartZeichnen()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        testLaeuft.value = false
    }
}

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
const sortiert = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="seite">
        <div class="seiteInnen">

            <div class="kopf">
                <h5 class="seitenTitel">{{ t('strategies.editorTitle') }}</h5>
                <button type="button" class="ctl-pill" @click="leer">
                    <Symbol name="plus" class="vorSymbol" />{{ t('strategies.emptyStrategy') }}
                </button>
                <!-- Import über ein verstecktes Dateifeld: ein Klick, kein Dialog. -->
                <input ref="importFeld" type="file" accept="application/json,.json"
                    class="versteckt" @change="importDatei" />
                <button type="button" class="ctl-pill" @click="importFeld?.click()">
                    <Symbol name="hochladen" class="vorSymbol" />{{ t('strategies.importStrategy') }}
                </button>
            </div>

            <div class="kasten abstandUnten">
                <Symbol name="info" class="vorSymbol" />{{ t('strategies.editorIntro') }}
            </div>
            <Hinweis v-if="meldung" art="info" class="abstandUnten">{{ meldung }}</Hinweis>
            <Hinweis v-if="fehler" art="fehler" class="abstandUnten">{{ fehler }}</Hinweis>

            <!-- ══ Vorlagen ══ -->
            <div v-if="!entwurf && versteckteVorlagen.length" class="kasten kastenZeile abstandUnten">
                <span>{{ t('strategies.templatesHidden', { n: versteckteVorlagen.length }) }}</span>
                <Knopf klein class="rechts" @click="vorlagenZurueckholen">
                    {{ t('strategies.templatesRestore') }}
                </Knopf>
            </div>
            <div v-if="!entwurf" class="vorlagen">
                <div v-for="v in vorlagen" :key="v.key" class="vorlagenZelle">
                    <div class="dailyCard vorlage">
                        <Knopf art="leise" klein nurSymbol symbol="schliessen" class="vorlageWeg"
                            :titel="t('strategies.templateHide')"
                            @click="vorlageAusblenden(v)" />
                        <strong>{{ v.titel }}</strong>
                        <div v-if="v.markt" class="vorlageMarkt">
                            <span class="marktBadge" :class="marktKlasse(v.markt)">
                                <Symbol name="linie" class="vorSymbol" />{{ v.markt }}
                            </span>
                        </div>
                        <p class="vorlageText">{{ v.beschreibung }}</p>
                        <Knopf klein @click="ausVorlage(v)">
                            {{ t('strategies.useTemplate') }}
                        </Knopf>
                    </div>
                </div>
            </div>

            <!-- ══ Editor ══ -->
            <template v-if="entwurf">
                <div class="dailyCard karte">
                    <div class="raster abstandUnten3">
                        <div class="b3">
                            <label class="at-label">{{ t('strategies.shortName') }}</label>
                            <input v-model="entwurf.strategyId" class="at-feld klein"
                                :disabled="!istNeu" placeholder="meine_strategie" @change="pruefen" />
                        </div>
                        <div class="b4">
                            <label class="at-label">{{ t('strategies.name') }}</label>
                            <input v-model="entwurf.name" class="at-feld klein" @change="pruefen" />
                        </div>
                        <div class="b5">
                            <label class="at-label">{{ t('strategies.descriptionLabel') }}</label>
                            <input v-model="entwurf.description" class="at-feld klein" />
                        </div>
                        <div class="b6">
                            <label class="at-label">{{ t('strategies.timeframes') }}</label>
                            <div class="chips">
                                <button v-for="tf in ZEITEINHEITEN" :key="tf" type="button"
                                    :class="['tfChip', { an: entwurf.rules.timeframes.includes(tf) }]"
                                    @click="zeiteinheitAn(tf)">{{ tf }}</button>
                            </div>
                        </div>
                        <div class="b3">
                            <label class="at-label">{{ t('strategies.direction') }}</label>
                            <select v-model="entwurf.rules.direction" class="at-feld klein" @change="pruefen">
                                <option value="long">Long</option>
                                <option value="short">Short</option>
                                <!-- Beide: die Erkennung läuft je Richtung einmal.
                                     Kostet doppelte Rechenzeit, spart die
                                     Zwillingsstrategie. -->
                                <option value="both">{{ t('strategies.directionBoth') }}</option>
                            </select>
                        </div>
                    </div>

                    <!-- ══ Einfach oder Experte ══
                         Im Einfachmodus stehen die Sätze und die einstellbaren
                         Werte; die Bausteine selbst bleiben verborgen. Wer eine
                         Strategie beurteilen will, muss sie lesen können — nicht
                         entziffern. -->
                    <div class="modusZeile">
                        <div class="umschalter" role="group">
                            <button type="button" :class="{ an: einfach }"
                                @click="einfach = true">{{ t('strategies.modeSimple') }}</button>
                            <button type="button" :class="{ an: !einfach }"
                                @click="einfach = false">{{ t('strategies.modeExpert') }}</button>
                        </div>
                        <small class="at-gedaempft">{{ einfach ? t('strategies.modeSimpleHint') : t('strategies.modeExpertHint') }}</small>
                    </div>

                    <!-- ══ Was diese Strategie tut ══ -->
                    <div v-if="saetze.length" class="saetzeKarte abstandUnten3">
                        <div class="zeileMitSymbol">
                            <Symbol name="buch" />
                            <strong class="fein">{{ t('strategies.rulesInWords') }}</strong>
                        </div>
                        <div v-for="s in saetze" :key="s.titel" class="satzZeile">
                            <span class="satzTitel">{{ s.titel }}</span>
                            <span>{{ s.text }}</span>
                        </div>
                        <p class="fussnote">{{ t('strategies.rulesInWordsHint') }}</p>
                    </div>

                    <!-- ══ Im Gespräch bauen ══
                         Der Chat sitzt bewusst IM Editor: er schreibt in
                         dasselbe Regelwerk, das die Felder darunter zeigen.
                         Vorher lagen Gespräch und Formular auf zwei Seiten —
                         man sah nie, was ein Satz eigentlich verändert hat. -->
                    <div class="chatPanel abstandUnten3">
                        <div class="zeileMitSymbol">
                            <Symbol name="nachricht" class="chatIcon" />
                            <strong>{{ t('strategies.chatTitle') }}</strong>
                            <Pille v-if="chatGeaendert.length" ton="akzent">
                                {{ t('strategies.chatChanged', { n: chatGeaendert.length }) }}
                            </Pille>
                            <Knopf klein class="rechts" @click="chatOffen = !chatOffen">
                                {{ chatOffen ? t('strategies.chatHide') : t('strategies.chatShow') }}
                            </Knopf>
                        </div>

                        <template v-if="chatOffen">
                            <p class="block-hint">{{ t('strategies.chatHint') }}</p>

                            <div v-if="chatVerlauf.length" class="chatVerlauf abstandUnten">
                                <div v-for="(m, i) in chatVerlauf" :key="i"
                                    :class="['chatZeile', m.role === 'user' ? 'chatNutzer' : 'chatModell']">
                                    {{ m.content }}
                                </div>
                            </div>

                            <!-- Rückfragen: anklickbar, damit man sie direkt beantwortet
                                 statt sie abzutippen. -->
                            <div v-if="chatFragen.length" class="abstandUnten">
                                <div class="fein at-gedaempft abstandUnten1">{{ t('strategies.chatOpenQuestions') }}</div>
                                <div class="fragen">
                                    <Knopf v-for="(f, i) in chatFragen" :key="i" klein class="frageKnopf"
                                        @click="frageUebernehmen(f)">{{ f }}</Knopf>
                                </div>
                            </div>

                            <!-- Was sich mit den Bausteinen nicht ausdrücken lässt.
                                 Muss stehen bleiben: sonst hält man eine Lücke für
                                 umgesetzt. -->
                            <Hinweis v-if="chatNichtUmsetzbar.length" art="warn" class="abstandUnten"
                                :titel="t('strategies.chatNotExpressible')">
                                <ul class="punkte">
                                    <li v-for="(n, i) in chatNichtUmsetzbar" :key="i">{{ n }}</li>
                                </ul>
                            </Hinweis>

                            <Hinweis v-if="chatFehler" art="fehler" class="abstandUnten">{{ chatFehler }}</Hinweis>

                            <div class="chatEingabe">
                                <textarea v-model="chatEingabe" class="at-feld klein" rows="2"
                                    :placeholder="t('strategies.chatPlaceholder')"
                                    :disabled="chatLaeuft"
                                    @keydown.enter.exact.prevent="chatSenden"></textarea>
                                <Knopf art="haupt" klein :disabled="chatLaeuft || !chatEingabe.trim()"
                                    @click="chatSenden">
                                    <Kreisel v-if="chatLaeuft" still />
                                    <span v-else>{{ t('strategies.chatSend') }}</span>
                                </Knopf>
                            </div>
                        </template>
                    </div>

                    <!-- Prüfung -->
                    <Hinweis v-if="pruefung && !pruefung.ok" art="warn" class="abstandUnten3"
                        :titel="t('strategies.notYetValid')">
                        <ul class="punkte">
                            <li v-for="(f, i) in pruefung.fehler" :key="i">{{ f }}</li>
                        </ul>
                    </Hinweis>
                    <div v-else-if="pruefung?.hinweise?.length" class="kasten abstandUnten3">
                        <ul class="punkte"><li v-for="(h, i) in pruefung.hinweise" :key="i">{{ h }}</li></ul>
                    </div>

                    <!-- ── 1. Parameter ── -->
                    <div class="block" :class="{ blockGeaendert: chatBetrifft('params') }">
                        <div class="block-title">
                            <span class="nr">1</span>{{ t('strategies.blockParams') }}
                            <Knopf klein class="rechts" @click="paramHinzu">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockParamsHint') }}</p>
                        <div v-for="(p, i) in entwurf.rules.params" :key="i" class="raster eng eintrag mittig">
                            <div class="b3 m3"><input v-model="p.key" class="at-feld klein" placeholder="name" @change="pruefen" /></div>
                            <div class="b4 m3"><input v-model="p.label" class="at-feld klein" :placeholder="t('strategies.labelPlaceholder')" /></div>
                            <div class="b2">
                                <select v-model="p.type" class="at-feld klein" @change="pruefen">
                                    <option value="number">{{ t('strategies.typeNumber') }}</option>
                                    <option value="integer">{{ t('strategies.typeInteger') }}</option>
                                    <option value="boolean">{{ t('strategies.typeBoolean') }}</option>
                                </select>
                            </div>
                            <div class="b1 m2"><input v-model.number="p.default" type="number" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b1 m2"><input v-model.number="p.min" type="number" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b1 m2 reihe">
                                <input v-model.number="p.max" type="number" class="at-feld klein" @change="pruefen" />
                                <Knopf art="gefahr" klein nurSymbol symbol="schliessen" @click="paramWeg(i)" />
                            </div>
                        </div>
                    </div>

                    <!-- ── 2. Indikatoren ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('indicators') }">
                        <div class="block-title">
                            <span class="nr">2</span>{{ t('strategies.blockIndicators') }}
                            <Knopf klein class="rechts" @click="indikatorHinzu">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockIndicatorsHint') }}</p>
                        <div v-for="(ind, i) in entwurf.rules.indicators" :key="i" class="raster eng eintrag">
                            <div class="b4 m3"><input v-model="ind.id" class="at-feld klein" @change="pruefen" /></div>
                            <div class="b3 m3">
                                <select v-model="ind.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="x in bausteine.indikatoren" :key="x" :value="x">{{ t('strategies.ind_' + x) }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <!-- VWAP braucht statt einer Periode einen Anker; das Band
                                     zusätzlich den Faktor der Standardabweichung. -->
                                <template v-if="['vwap','vwapBand'].includes(ind.type)">
                                    <div class="reihe">
                                        <select v-model="ind.anchor" class="at-feld klein" @change="pruefen">
                                            <option v-for="a in (bausteine.vwapAnker || [])" :key="a" :value="a">
                                                {{ ankerLabel(a) }}
                                            </option>
                                        </select>
                                        <input v-if="ind.anchor === 'rolling'" v-model.number="ind.period" type="number" min="2"
                                            class="at-feld klein" style="max-width:5rem" @change="pruefen" />
                                        <!-- Swing-Anker: Pivot-Stärke und welche Fächerlinie gemeint ist.
                                             Ohne diese Felder hinge die Linie stumm auf ihren Vorgaben. -->
                                        <template v-if="['swingHigh','swingLow'].includes(ind.anchor)">
                                            <ZahlOderParam :ziel="ind" feld="pivot" :standard="20"
                                                :titel="t('strategies.vwapPivot')" :params="parameterNamen" @aendern="pruefen" />
                                            <select v-model.number="ind.nth" class="at-feld klein"
                                                style="max-width:5rem" :title="t('strategies.vwapNth')" @change="pruefen">
                                                <option v-for="n in [1,2,3]" :key="n" :value="n">{{ n }}.</option>
                                            </select>
                                        </template>
                                        <select v-if="ind.type === 'vwapBand'" class="at-feld klein"
                                            style="max-width:7rem" :value="refText(ind.mult)"
                                            :title="t('strategies.vwapMultHint')"
                                            @change="refSetzen(ind, 'mult', $event.target.value)">
                                            <option v-for="m in [1,1.5,2,2.5,3,-1,-1.5,-2,-2.5,-3]" :key="m" :value="String(m)">{{ m }}σ</option>
                                            <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                        </select>
                                    </div>
                                </template>
                                <!-- Die Tageseröffnung hat keine Einstellung — ein
                                     Periodenfeld daneben wäre eine Lüge. -->
                                <template v-else-if="ind.type === 'dayOpen'">
                                    <span class="at-gedaempft fein">{{ t('strategies.noSetting') }}</span>
                                </template>
                                <!-- MACD, Bollinger und Stochastik haben eigene
                                     Kennzahlen. Die Engine liest sie längst
                                     (rule-engine.js baueIndikatoren) — ohne
                                     Felder blieben sie stumm auf ihren
                                     Standardwerten stehen, ohne dass man es
                                     sieht. -->
                                <template v-else-if="['macd','macdSignal','macdHist'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="fast" :standard="12"
                                            :titel="t('strategies.macdFast')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="slow" :standard="26"
                                            :titel="t('strategies.macdSlow')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="signal" :standard="9"
                                            :titel="t('strategies.macdSignalP')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <template v-else-if="['bollUpper','bollMiddle','bollLower'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="20"
                                            :titel="t('strategies.bollPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="mult" :standard="2" :schritt="0.1"
                                            :titel="t('strategies.bollMult')" :params="parameterNamen" @aendern="pruefen" />
                                        <select v-model="ind.basis" class="at-feld klein"
                                            style="max-width:5.5rem" :title="t('strategies.bollBasis')" @change="pruefen">
                                            <option value="sma">SMA</option>
                                            <option value="ema">EMA</option>
                                        </select>
                                    </div>
                                </template>
                                <template v-else-if="['stochK','stochD'].includes(ind.type)">
                                    <div class="reihe">
                                        <ZahlOderParam :ziel="ind" feld="period" :standard="14"
                                            :titel="t('strategies.stochPeriod')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothK" :standard="3"
                                            :titel="t('strategies.stochSmoothK')" :params="parameterNamen" @aendern="pruefen" />
                                        <ZahlOderParam :ziel="ind" feld="smoothD" :standard="3"
                                            :titel="t('strategies.stochSmoothD')" :params="parameterNamen" @aendern="pruefen" />
                                    </div>
                                </template>
                                <!-- Alle übrigen: eine Periode, aber frei
                                     wählbar statt sieben fester Stufen. -->
                                <ZahlOderParam v-else :ziel="ind" feld="period" :standard="14"
                                    :titel="t('strategies.periodLabel')" :params="parameterNamen" @aendern="pruefen" />
                            </div>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" @click="indikatorWeg(i)" /></div>
                        </div>
                    </div>

                    <!-- ── 3. Signal ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('signal') }">
                        <div class="block-title"><span class="nr">3</span>{{ t('strategies.blockSignal') }}</div>
                        <p class="block-hint">{{ t('strategies.blockSignalHint') }}</p>
                        <div class="raster eng">
                            <div class="b4">
                                <select v-model="entwurf.rules.signal.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="s in bausteine.signale" :key="s" :value="s">{{ t('strategies.signal_' + s) }}</option>
                                </select>
                            </div>
                            <template v-if="['pivotHigh','pivotLow'].includes(entwurf.rules.signal.type)">
                                <div class="b4 m3">
                                    <input v-model.number="entwurf.rules.signal.left" type="number" min="1" class="at-feld klein"
                                        :placeholder="t('strategies.leftBars')" @change="pruefen" />
                                </div>
                                <div class="b4 m3">
                                    <input v-model.number="entwurf.rules.signal.right" type="number" min="1" class="at-feld klein"
                                        :placeholder="t('strategies.rightBars')" @change="pruefen" />
                                </div>
                            </template>
                            <!-- Berührung einer Linie, die vorher schon gehalten hat:
                                 Linie + wie oft vorher. „2" heisst dritte Berührung. -->
                            <template v-else-if="entwurf.rules.signal.type === 'levelTouch'">
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.line)"
                                        :title="t('strategies.touchLine')"
                                        @change="refSetzen(entwurf.rules.signal, 'line', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="minPrevTouches" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                                <div class="b4 ab5 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <!-- Kerzenmuster als Auslöser: Muster + Gegenkerzen davor.
                                 Die Engine liest beides längst, im Formular fehlten sie. -->
                            <template v-else-if="entwurf.rules.signal.type === 'pattern'">
                                <div class="b4">
                                    <select v-model="entwurf.rules.signal.pattern" class="at-feld klein" @change="pruefen">
                                        <option v-for="m in (bausteine.muster || [])" :key="m" :value="m">
                                            {{ t('strategies.muster_' + m) }}
                                        </option>
                                    </select>
                                </div>
                                <div class="b4 reihe">
                                    <ZahlOderParam :ziel="entwurf.rules.signal" feld="prevOpposite" :standard="0"
                                        :titel="t('strategies.prevOpposite')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </template>
                            <template v-else>
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.a)"
                                        @change="refSetzen(entwurf.rules.signal, 'a', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.signal.b)"
                                        @change="refSetzen(entwurf.rules.signal, 'b', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 4. Signalfilter ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('signalFilters') }">
                        <div class="block-title">
                            <span class="nr">4</span>{{ t('strategies.blockFilters') }}
                            <Knopf klein class="rechts" @click="bedingungHinzu('signalFilters')">+</Knopf>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockFiltersHint') }}</p>
                        <div v-for="(b, i) in entwurf.rules.signalFilters" :key="i" class="raster eng eintrag">
                            <div class="b3 m3">
                                <select class="at-feld klein" :value="refText(b.left)"
                                    @change="refSetzen(b, 'left', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b3 m3">
                                <select v-model="b.op" class="at-feld klein" @change="pruefen">
                                    <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                </select>
                            </div>
                            <div class="b3">
                                <!-- Der Berührungszähler hat keine rechte Seite — nur die Linie links. -->
                                <select v-if="b.op !== 'priorTouchesGte'" class="at-feld klein" :value="refText(b.right)"
                                    @change="refSetzen(b, 'right', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <div v-else class="reihe">
                                    <ZahlOderParam :ziel="b" feld="separation" :standard="3"
                                        :titel="t('strategies.touchSeparation')" :params="parameterNamen" @aendern="pruefen" />
                                    <ZahlOderParam :ziel="b" feld="window" :standard="200"
                                        :titel="t('strategies.touchWindow')" :params="parameterNamen" @aendern="pruefen" />
                                </div>
                            </div>
                            <div class="b2 reihe">
                                <ZahlOderParam v-if="b.op === 'priorTouchesGte'" :ziel="b" feld="value" :standard="2"
                                    :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                <select v-else-if="['distancePctGt','distancePctLt','isBullish','isBearish'].includes(b.op)"
                                    class="at-feld klein" :value="refText(b.value)"
                                    @change="refSetzen(b, 'value', $event.target.value)">
                                    <option v-for="n in [0,0.5,1,2,2.5,5,10]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                </select>
                            </div>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" @click="bedingungWeg('signalFilters', i)" /></div>
                        </div>
                    </div>

                    <!-- ── 5. Einstieg ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('entry') }">
                        <div class="block-title"><span class="nr">5</span>{{ t('strategies.blockEntry') }}</div>
                        <p class="block-hint">{{ t('strategies.blockEntryHint') }}</p>
                        <div class="raster eng">
                            <div class="b4">
                                <select v-model="entwurf.rules.entry.type" class="at-feld klein" @change="pruefen">
                                    <option v-for="e in bausteine.einstieg" :key="e" :value="e">{{ t('strategies.entry_' + e) }}</option>
                                </select>
                            </div>
                            <template v-if="entwurf.rules.entry.type === 'touch'">
                                <div class="b4 m3">
                                    <select class="at-feld klein" :value="refText(entwurf.rules.entry.anchor)"
                                        @change="refSetzen(entwurf.rules.entry, 'anchor', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b4 m3">
                                    <select v-model="entwurf.rules.entry.from" class="at-feld klein" @change="pruefen">
                                        <option value="above">{{ t('strategies.fromAbove') }}</option>
                                        <option value="below">{{ t('strategies.fromBelow') }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 6. Abbruchgründe ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft('invalidations') }">
                        <div class="block-title">
                            <span class="nr">6</span>{{ t('strategies.blockInvalidations') }}
                            <span class="titelKnoepfe">
                                <Knopf klein @click="abbruchHinzu('condition')">
                                    + {{ t('strategies.condition') }}
                                </Knopf>
                                <Knopf klein @click="abbruchHinzu('timeout')">
                                    + {{ t('strategies.timeout') }}
                                </Knopf>
                            </span>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockInvalidationsHint') }}</p>
                        <div v-for="(v, i) in entwurf.rules.invalidations" :key="i" class="raster eng eintrag">
                            <div class="b3"><input v-model="v.code" class="at-feld klein" :placeholder="t('strategies.reasonCode')" @change="pruefen" /></div>
                            <template v-if="v.type === 'timeout'">
                                <div class="b8">
                                    <select class="at-feld klein" :value="refText(v.candles)"
                                        @change="refSetzen(v, 'candles', $event.target.value)">
                                        <option v-for="n in [3,5,10,15,20,30,50]" :key="n" :value="String(n)">{{ t('strategies.afterCandles', { n }) }}</option>
                                        <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                    </select>
                                </div>
                            </template>
                            <template v-else>
                                <div class="b3 m3">
                                    <select class="at-feld klein" :value="refText(v.when.left)"
                                        @change="refSetzen(v.when, 'left', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="b3 m3">
                                    <select v-model="v.when.op" class="at-feld klein" @change="pruefen">
                                        <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                    </select>
                                </div>
                                <div class="b2 reihe">
                                    <ZahlOderParam v-if="v.when.op === 'priorTouchesGte'" :ziel="v.when" feld="value" :standard="2"
                                        :titel="t('strategies.touchPrev')" :params="parameterNamen" @aendern="pruefen" />
                                    <select v-else class="at-feld klein" :value="refText(v.when.right)"
                                        @change="refSetzen(v.when, 'right', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                            <div class="b1 wegZelle"><Knopf art="gefahr" klein nurSymbol symbol="schliessen" @click="abbruchWeg(i)" /></div>
                        </div>
                    </div>

                    <!-- ── 7. Stop und Ziel ── -->
                    <div v-if="!einfach" class="block" :class="{ blockGeaendert: chatBetrifft(['stopLoss','takeProfit','breakEvenAtR']) }">
                        <div class="block-title"><span class="nr">7</span>{{ t('strategies.blockExit') }}</div>
                        <div class="raster eng abstandUnten">
                            <div class="b2 zeilenTitel">{{ t('strategies.stop') }}</div>
                            <div class="b4">
                                <select class="at-feld klein" :value="refText(entwurf.rules.stopLoss.anchor)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <select class="at-feld klein" :value="refText(entwurf.rules.stopLoss.offsetPct)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'offsetPct', $event.target.value)">
                                    <option v-for="n in [0,0.1,0.2,0.3,0.5,1,2]" :key="n" :value="String(n)">{{ n }} % {{ t('strategies.beyond') }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="raster eng">
                            <div class="b2 zeilenTitel">{{ t('strategies.target') }}</div>
                            <div class="b4">
                                <select v-model="entwurf.rules.takeProfit.mode" class="at-feld klein" @change="pruefen">
                                    <option v-for="z in bausteine.ziele" :key="z" :value="z">{{ t('strategies.tp_' + z) }}</option>
                                </select>
                            </div>
                            <div class="b4">
                                <select v-if="entwurf.rules.takeProfit.mode === 'rr'" class="at-feld klein"
                                    :value="refText(entwurf.rules.takeProfit.rr)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'rr', $event.target.value)">
                                    <option v-for="n in [1,1.5,2,2.5,3,4,5]" :key="n" :value="String(n)">{{ n }} R</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <select v-else-if="entwurf.rules.takeProfit.mode === 'anchor'" class="at-feld klein"
                                    :value="refText(entwurf.rules.takeProfit.anchor)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="b2">
                                <input v-model.number="entwurf.rules.breakEvenAtR" type="number" step="0.5" min="0"
                                    class="at-feld klein" :title="t('strategies.breakEvenTitle')" @change="pruefen" />
                            </div>
                        </div>
                    </div>

                    <div class="knopfZeile abstandOben3">
                        <Knopf art="haupt" klein symbol="speichern" :disabled="speichert || (pruefung && !pruefung.ok)" @click="sichern">
                            {{ t('common.save') }}
                        </Knopf>
                        <Knopf klein @click="entwurf = null">{{ t('common.cancel') }}</Knopf>
                    </div>
                </div>

                <!-- ══ Test ══ -->
                <div class="dailyCard karte">
                    <div class="section-title abstandUnten">{{ t('strategies.testNow') }}</div>
                    <div class="raster unten">
                        <div class="b3 m2">
                            <label class="at-label">{{ t('strategies.symbol') }}</label>
                            <input v-model="test.symbol" class="at-feld klein" />
                        </div>
                        <div class="b2 m2">
                            <label class="at-label">{{ t('strategies.timeframe') }}</label>
                            <select v-model="test.timeframe" class="at-feld klein">
                                <option v-for="tf in entwurf.rules.timeframes" :key="tf" :value="tf">{{ tf }}</option>
                            </select>
                        </div>
                        <div class="b2 m2">
                            <label class="at-label">{{ t('strategies.days') }}</label>
                            <input v-model.number="test.tage" type="number" min="30" max="720" class="at-feld klein" />
                        </div>
                        <div class="b2">
                            <Knopf art="haupt" klein class="voll" :disabled="testLaeuft" @click="testen">
                                <Kreisel v-if="testLaeuft" still />
                                <span v-else>{{ t('strategies.run') }}</span>
                            </Knopf>
                        </div>
                    </div>

                    <div v-if="testErgebnis" class="abstandOben3">
                        <!-- Der Chart zum Testlauf. Kräftig = gehandelt, blass
                             gestrichelt = erkannt und verworfen. -->
                        <div class="abstandUnten">
                            <div class="zeileMitSymbol abstandUnten1">
                                <Symbol name="linie" />
                                <strong class="fein">{{ t('strategies.chartTitle') }}</strong>
                                <Pille v-if="testErgebnis.setups?.length" ton="neutral">
                                    {{ t('strategies.chartSetups', { n: testErgebnis.setups.length }) }}
                                </Pille>
                            </div>
                            <p class="fein at-gedaempft abstandUnten1">{{ t('strategies.chartHint') }}</p>
                            <div id="editorChart" class="editorChart"></div>
                            <div v-if="chartMeldung" class="fein at-gedaempft">{{ chartMeldung }}</div>
                        </div>

                        <div v-if="!testErgebnis.stats.trades" class="at-gedaempft fein">
                            {{ testErgebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                        </div>
                        <div v-else class="kpis">
                            <div v-for="k in [
                                { l: t('strategies.kpiTrades'), v: testErgebnis.stats.trades },
                                { l: t('strategies.kpiWinRate'), v: zahl(testErgebnis.stats.winRate, 1) + ' %' },
                                { l: t('strategies.kpiExpectancy'), v: zahl(testErgebnis.stats.expectancyR) + ' R',
                                  farbe: testErgebnis.stats.expectancyR >= 0 },
                                { l: t('strategies.kpiProfitFactor'), v: zahl(testErgebnis.stats.profitFactor) },
                                { l: t('strategies.kpiNetPnl'), v: zahl(testErgebnis.stats.netPnl), farbe: testErgebnis.stats.netPnl >= 0 },
                                { l: t('strategies.kpiMaxDd'), v: zahl(testErgebnis.stats.maxDrawdownPct, 1) + ' %' },
                            ]" :key="k.l" class="kpi">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value" :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">{{ k.v }}</div>
                            </div>
                        </div>
                        <div v-if="testErgebnis.funnel" class="zweiSpalten abstandOben">
                            <div>
                                <div class="section-title abstandUnten1">{{ t('strategies.funnel') }}</div>
                                <table class="at-tabelle dicht">
                                    <tbody>
                                        <tr v-for="k in ['setupsDetected','triggered','executed']" :key="k">
                                            <td>{{ t('strategies.bt_' + k) }}</td>
                                            <td class="zahl"><strong>{{ testErgebnis.funnel[k] }}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <div class="section-title abstandUnten1">{{ t('strategies.whyLost') }}</div>
                                <table class="at-tabelle dicht">
                                    <tbody>
                                        <tr v-for="[g, n] in sortiert(testErgebnis.funnel.invalidated)" :key="g">
                                            <td>{{ g }}</td>
                                            <td class="zahl">{{ n }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ══ Eigene Strategien ══ -->
            <div v-if="liste.length" class="dailyCard karte">
                <div class="section-title abstandUnten">{{ t('strategies.myStrategies') }}</div>
                <div class="at-tabelle-huelle">
                    <table class="at-tabelle dicht">
                        <tbody>
                            <tr v-for="s in liste" :key="s.id">
                                <td class="pointerClass" @click="bearbeiten(s)"><strong>{{ s.name }}</strong></td>
                                <td class="at-gedaempft">{{ s.strategyId }}</td>
                                <td>
                                    <Pille :ton="s.geladen ? 'gut' : 'schlecht'">
                                        {{ s.geladen ? t('strategies.loaded') : t('strategies.notLoaded') }}
                                    </Pille>
                                </td>
                                <td class="at-gedaempft">{{ (s.rules.timeframes || []).join(', ') }}</td>
                                <td class="zahl aktionen">
                                    <Knopf klein nurSymbol symbol="herunterladen" :titel="t('strategies.exportTitle')"
                                        @click="exportieren(s)" />
                                    <Knopf klein nurSymbol symbol="kopieren" :titel="t('strategies.duplicate')"
                                        @click="kopieren(s)" />
                                    <template v-if="loeschFrage === s.id">
                                        <Knopf art="gefahr" klein @click="loeschen(s)">{{ t('common.yes') }}</Knopf>
                                        <Knopf klein @click="loeschFrage = null">{{ t('common.no') }}</Knopf>
                                    </template>
                                    <Knopf v-else art="gefahr" klein nurSymbol symbol="muell" @click="loeschFrage = s.id" />
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

/* `.dailyCard` setzt global `height: 100%`. Hier stehen die Karten gestapelt
   untereinander — dort zieht die Regel jede einzelne Karte auf die Höhe der
   GESAMTEN Spalte und erzeugt riesige Leerräume. */
.dailyCard {
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

/* ── Strategie-Editor ── */
.kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-4);
}

.seitenTitel {
    margin: 0 auto 0 0;
}

.versteckt {
    display: none;
}

.vorlagen {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

.vorlage {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: var(--abstand-4);
}

.vorlage > strong {
    padding-right: var(--abstand-5);
}

.vorlageWeg {
    position: absolute;
    top: var(--abstand-1);
    right: var(--abstand-1);
}

.vorlageMarkt {
    margin-top: var(--abstand-1);
}

.vorlageText {
    flex-grow: 1;
    margin: var(--abstand-1) 0 var(--abstand-3);
    font-size: 0.85rem;
    color: var(--muted);
}

/* Marktphasen-Marke auf den Vorlagen-Karten */
.marktBadge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-pille);
    font-size: 0.75rem;
    font-weight: 500;
    white-space: normal;
    text-align: left;
}
.marktTrend {
    background: var(--accent-flaeche);
    border: 1px solid var(--accent-rand);
    color: var(--accent);
}
.marktSeitwaerts {
    background: var(--warn-flaeche);
    border: 1px solid var(--warn);
    color: var(--warn);
}
.marktNeutral {
    background: var(--panel-soft);
    border: 1px solid var(--line-stark);
    color: var(--muted);
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.tfChip {
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-klein);
    border: 1px solid var(--line);
    background: var(--panel-soft);
    color: var(--muted);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
}

.tfChip:hover {
    color: var(--text);
}

.tfChip.an {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}

.modusZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.umschalter {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    overflow: hidden;
}

.umschalter button {
    padding: 0.3rem 0.75rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
}

.umschalter button + button {
    border-left: 1px solid var(--line);
}

.umschalter button.an {
    background: var(--accent);
    color: var(--on-accent);
}

.block {
    border-top: 1px solid var(--line);
    padding-top: var(--abstand-3);
    margin-top: var(--abstand-3);
}

/* Vom letzten Chat-Vorschlag angefasst. Bewusst eine Kante statt einer Füllung:
   sie zeigt den Ort, ohne die Werte darin schwerer lesbar zu machen. */
.block.blockGeaendert {
    border-left: 3px solid var(--accent);
    padding-left: 0.6rem;
    margin-left: -0.6rem;
    background: var(--accent-flaeche);
    border-radius: var(--radius-klein);
}

.block-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-1);
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
}

.block-title .nr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    margin-right: var(--abstand-1);
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.7rem;
}

.titelKnoepfe {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
    margin-left: auto;
}

.block-hint {
    font-size: 0.74rem;
    color: var(--muted);
    margin-bottom: var(--abstand-2);
}

.eintrag + .eintrag {
    margin-top: var(--abstand-1);
}

.wegZelle {
    display: flex;
}

.wegZelle > * {
    flex: 1 1 auto;
}

.zeilenTitel {
    font-size: 0.85rem;
    padding-top: var(--abstand-1);
}

.editorChart {
    width: 100%;
    height: 340px;
}

.saetzeKarte {
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
}

.satzZeile {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.15rem 0;
    font-size: 0.88rem;
}

.satzTitel {
    flex: 0 0 6.5rem;
    color: var(--muted);
    font-size: 0.8rem;
}

.fussnote {
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
    color: var(--muted);
}

/* Der Chat ist ein Werkzeug, kein Anhängsel — er bekommt eine eigene Fläche,
   damit er nicht als weitere Formularzeile gelesen wird. */
.chatPanel {
    border: 1px solid var(--accent-rand);
    background: var(--panel-soft);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
    margin-top: var(--abstand-3);
}

.chatIcon {
    color: var(--accent);
    font-size: 1.1rem;
}

.chatVerlauf {
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    padding: var(--abstand-2);
}

.chatZeile {
    font-size: 0.85rem;
    padding: 0.35rem 0.55rem;
    margin-bottom: 0.35rem;
    border-radius: var(--radius-klein);
    white-space: pre-wrap;
}

.chatNutzer {
    background: var(--accent-flaeche);
    margin-left: 2rem;
}

.chatModell {
    background: var(--panel-hoch);
    margin-right: 2rem;
}

.fragen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-1);
}

.frageKnopf {
    text-align: left;
    justify-content: flex-start;
}

.chatEingabe {
    display: flex;
    gap: var(--abstand-2);
    align-items: stretch;
}

.chatEingabe .at-feld {
    flex: 1 1 auto;
    min-width: 0;
}

.chatEingabe > :last-child {
    flex: 0 0 auto;
}

@media (max-width: 767.98px) {
    .vorlagen {
        grid-template-columns: 1fr;
    }

    /* Mehrere Einträge untereinander: eine feine Trennlinie, sonst verschwimmen
       die Felder eines Eintrags mit denen des nächsten. */
    .eintrag + .eintrag {
        margin-top: var(--abstand-2);
        padding-top: var(--abstand-2);
        border-top: 1px dashed var(--line);
    }

    .wegZelle {
        justify-content: flex-end;
    }

    .wegZelle > * {
        flex: 0 0 auto;
    }

    .zeilenTitel {
        padding-top: 0;
    }

    .satzZeile {
        flex-direction: column;
        gap: 0;
    }

    .satzTitel {
        flex-basis: auto;
    }

    .chatNutzer {
        margin-left: var(--abstand-4);
    }

    .chatModell {
        margin-right: var(--abstand-4);
    }
}
</style>
