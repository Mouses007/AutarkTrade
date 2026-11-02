<script setup>
/**
 * Labor › Test: ein Coin, ein Zeitraum — Backtest mit Chart, darunter die
 * Robustheit auf denselben Eingaben.
 *
 * Der Backtest ist der Ort, an dem Parameter überhaupt erst beurteilbar werden
 * — ohne ihn sind Werte wie „Retest-Tiefe 25 %" geraten. Dieselbe Engine läuft
 * hier wie im Papierbetrieb, damit die Zahlen übertragbar sind. Strategie und
 * Werte kommen aus dem gemeinsamen Formular der Labor-Seite (`form`).
 *
 * Darunter die Ausstiegs-Prüfung (`AusstiegsPruefung.vue`): dieselben
 * Einstiege mit anderen Ausstiegen neu gespielt.
 *
 * Robustheit bewusst am SELBEN Formular: Strategie, Symbol, Zeitraum und
 * Parameter sollen für alle Prüfungen dieselben sein, sonst vergleicht man
 * hinterher Äpfel mit Birnen.
 */
import { ref, computed } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import StrategieChart from '../StrategieChart.vue'
import AusstiegsPruefung from './AusstiegsPruefung.vue'
import QuelleAus from '../../quellen/QuelleAus.vue'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../../basis'
import { formGeldStellen } from '../../../utils/journal/format.js'
import { apiFehlerText } from '../../../utils/apiError.js'
import dayjs from '../../../utils/journal/zeit.js'
import { zeitraumVon } from '../../../utils/strategien/format.js'
import { ausBacktest } from '../../../../shared/strategieChart.js'

const props = defineProps({
    // Gemeinsames Formular der Labor-Seite (Strategie, Werte, Symbol, Zeitraum)
    form: { type: Object, required: true },
    strategie: { type: Object, default: null },
})
const { t, te } = useI18n()

const ergebnis = ref(null)
const laeuft = ref(false)
const fehler = ref('')
// Marktdaten abgeschaltet (Einstellungen › Datenquellen): die Route antwortet
// mit { aus: true, … } — das sagt QuelleAus, nicht eine Fehlermeldung.
const aus = ref(null)

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
// Ohne Verlust-Trades ist der Profit-Faktor nicht definiert (kommt als null).
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1
const geld = (v) => formGeldStellen(Number(v) || 0, 2)
/** Nur Datum — bei Abdeckungslücken zählt der Tag, nicht die Uhrzeit. */
const datum = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : '–')
const sortiert = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])

const chartDaten = computed(() => (ergebnis.value ? ausBacktest(ergebnis.value) : null))

// Sucht das Allzeithoch in den Tageskerzen (~3 Jahre) und setzt „von" darauf.
const athLaedt = ref(false)
async function vonAufAth() {
    athLaedt.value = true
    try {
        const r = await axios.get('/api/binance/klines', {
            params: { symbol: props.form.symbol, interval: '1d', market: 'futures', limit: 1000 },
        })
        let hoch = -Infinity
        let hochT = null
        for (const k of r.data) {
            const h = Number(k[2])
            if (h > hoch) { hoch = h; hochT = Number(k[0]) }
        }
        if (hochT) {
            props.form.von = dayjs(hochT).format('YYYY-MM-DD')
            props.form.zeitmodus = 'datum'
            fehler.value = ''
        }
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.athFailed'), t)
    } finally {
        athLaedt.value = false
    }
}

async function starten() {
    const zeitraum = zeitraumVon(props.form)
    if (!zeitraum) { fehler.value = t('strategies.rangeInvalid'); return }
    laeuft.value = true
    fehler.value = ''
    aus.value = null
    ergebnis.value = null
    try {
        const f = props.form
        const r = await axios.post('/api/strategies/backtest', {
            strategyId: f.strategyId,
            instanceId: Number(f.instanceId) || 0,
            symbol: f.symbol.toUpperCase(),
            timeframe: f.timeframe,
            ...zeitraum,
            // Kein eigenes `startEquity`: der Server rechnet mit `risk.startEquityUsdt`.
            label: f.label || props.strategie?.name || f.strategyId,
            params: f.params,
            risk: f.risk,
        })
        if (r.data?.aus) aus.value = r.data
        else ergebnis.value = r.data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        laeuft.value = false
    }
}

// ── Robustheit: Stabilität, Monte Carlo, Walk-forward ───────────────────
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
    (props.strategie?.params || []).filter((p) => p.type === 'number' || p.type === 'integer'))

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
    const zeitraum = zeitraumVon(props.form)
    if (!zeitraum) return null
    const f = props.form
    return {
        strategyId: f.strategyId, symbol: f.symbol.toUpperCase(), timeframe: f.timeframe,
        ...zeitraum, params: f.params, risk: f.risk,
    }
}

async function robustStarten(art) {
    const basis = robustBasis()
    if (!basis) { robust.value.fehler = t('strategies.rangeInvalid'); return }
    robust.value.laeuft = art
    robust.value.fehler = ''
    aus.value = null
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
        for (const k of ['montecarlo', 'stabilitaet', 'matrixStab', 'walkforward']) {
            if (robust.value[k]?.aus) { aus.value = robust.value[k]; robust.value[k] = null }
        }
    } catch (e) {
        robust.value.fehler = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        robust.value.laeuft = ''
    }
}

/**
 * Lesbarer Name eines Parameters. Denselben Pfad benutzt auch das
 * Parameter-Formular (`strategies.<strategie>.<schlüssel>`).
 */
function parameterName(p) {
    const key = p.labelKey || `strategies.${props.form.strategyId}.${p.key}`
    return te(key) ? t(key) : p.key
}

/** Ton des Stabilitäts-Urteils (Pille) — Plateau gut, Nadel warnend. */
const urteilKlasse = (u) => (u === 'plateau' ? 'gut'
    : (u === 'nadel' || u === 'schmal' || u === 'uneinig') ? 'warn' : 'neutral')
</script>

<template>
    <div class="testReiter">
        <!-- ══ Backtest ══ -->
        <div class="journalKarte karte">
            <div class="section-title abstandUnten">{{ t('strategies.backtest') }}</div>
            <div class="raster unten">
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
                <div class="b2 m3">
                    <label class="at-label">{{ t('strategies.period') }}</label>
                    <select v-model="form.zeitmodus" class="at-feld klein">
                        <option value="tage">{{ t('strategies.days') }}</option>
                        <option value="datum">{{ t('strategies.dateRange') }}</option>
                    </select>
                </div>
                <div v-if="form.zeitmodus === 'tage'" class="b1 m3">
                    <label class="at-label">{{ t('strategies.days') }}</label>
                    <input v-model.number="form.tage" type="number" min="7" max="720" class="at-feld klein" />
                </div>
                <template v-else>
                    <div class="b3">
                        <label class="at-label">{{ t('strategies.from') }}</label>
                        <div class="reihe">
                            <input v-model="form.von" type="date" class="at-feld klein" />
                            <Knopf klein class="festeBreite" :disabled="athLaedt" :titel="t('strategies.sinceAthTitle')"
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
                <div class="b2">
                    <Knopf art="haupt" klein class="voll" :disabled="laeuft || !form.strategyId" @click="starten">
                        <Kreisel v-if="laeuft" still />
                        <span v-else>{{ t('strategies.run') }}</span>
                    </Knopf>
                </div>
            </div>
            <Hinweis v-if="fehler" art="fehler" class="abstandOben">{{ fehler }}</Hinweis>
            <QuelleAus v-if="aus" :aus="aus" class="abstandOben" />
        </div>

        <!-- ══ Ergebnis ══ -->
        <div v-if="ergebnis" class="journalKarte karte">
            <div class="section-title abstandUnten">{{ t('strategies.result') }}</div>
            <StrategieChart :symbol="ergebnis.meta?.symbol || form.symbol" :interval="ergebnis.meta?.timeframe || form.timeframe"
                :daten="chartDaten" :merk-schluessel="'labor.' + form.strategyId" :hoehe="420" class="abstandUnten3" />
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
                <!-- Gegriffen, aber mit zu kurzem Vorlauf: die ersten Wochen
                     sah die Strategie ihr HTF-Fenster nicht vollständig. -->
                <Hinweis v-else-if="ergebnis.stats.htfFilter?.vorlaufFehlt" art="warn" class="abstandUnten">
                    {{ t('strategies.htfVorlaufFehlt', {
                        tf: ergebnis.stats.htfFilter.timeframe,
                        ab: datum(ergebnis.stats.htfFilter.vorlaufAb),
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

                <!-- Mit welchem Kapital gerechnet wurde — Prozentwerte und
                     absolute Grenzen (Deckel, Tageslimit) hängen daran. -->
                <div v-if="ergebnis.stats.startEquity" class="fein at-gedaempft abstandUnten">
                    <Symbol name="info" class="vorSymbol" />
                    {{ t('strategien.labor.startkapital', { betrag: geld(ergebnis.stats.startEquity) }) }}
                </div>

                <!-- Ein Lauf ohne Finanzierungskosten ist nicht dasselbe wie
                     einer, in dem sie nichts gekostet haben. Deshalb steht die
                     Annahme dabei — in beide Richtungen. -->
                <div v-if="ergebnis.stats.trades" class="fein at-gedaempft abstandUnten">
                    <!-- Seit 01.11.2026 aus der echten Funding-Historie; die
                         Annahme in bp gilt nur noch, wenn keine Daten da sind. -->
                    <template v-if="ergebnis.stats.fundingQuelle === 'verlauf'">
                        <Symbol name="prozent" class="vorSymbol" />
                        {{ t('strategien.labor.fundingVerlauf', { betrag: geld(ergebnis.stats.funding) }) }}
                    </template>
                    <!-- Der Verlauf reicht nicht bis zum Laufbeginn (Bitget hält
                         nur rund 90 Tage vor): davor gilt die Annahme. -->
                    <template v-else-if="ergebnis.stats.fundingQuelle === 'teilweise'">
                        <Symbol name="info" class="vorSymbol" />
                        {{ t('strategien.labor.fundingTeilweise', {
                            ab: datum(ergebnis.stats.fundingAbdeckungAb),
                            bps: ergebnis.stats.fundingBpsPer8h,
                            betrag: geld(ergebnis.stats.funding),
                        }) }}
                    </template>
                    <template v-else-if="ergebnis.stats.fundingModelliert">
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

                <div class="knopfZeile abstandUnten3">
                    <Knopf art="haupt" klein symbol="play" :disabled="!ergebnis.backtestId"
                        :to="`/strategien/instanzen/neu?lauf=${ergebnis.backtestId}`">{{ t('strategien.labor.alsInstanz') }}</Knopf>
                    <span class="fein at-gedaempft">{{ t('strategien.labor.alsInstanzHinweis') }}</span>
                </div>

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

        <!-- ══ Ausstiegs-Prüfung ══
             Dieselben Einstiege, andere Ausstiege — liegt es am Einstieg
             oder am Ausstieg? Gleiches Formular wie der Backtest. -->
        <AusstiegsPruefung :form="form" />

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
                    <!-- Drei Urteile: stabil, springt — oder zu wenige Abschnitte
                         mit einer Auswahl, um überhaupt etwas zu sagen. -->
                    <Pille :ton="robust.walkforward.auswahlStabil ? 'gut' : 'warn'">
                        {{ robust.walkforward.auswahlStabil ? t('strategies.wfStable')
                            : robust.walkforward.auswahlUrteil === 'zu_wenige' ? t('strategies.wfZuWenige')
                                : t('strategies.wfUnstable') }}
                    </Pille>
                </div>
                <div v-if="robust.walkforward.ohneAuswahl" class="fein at-gedaempft abstandUnten1">
                    {{ t('strategies.wfOhneAuswahl', {
                        n: robust.walkforward.ohneAuswahl,
                        von: robust.walkforward.abschnitte.length,
                        min: robust.walkforward.minTrades,
                    }) }}
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
                                <!-- Ohne Auswahl wurde nichts geprüft: kein „0.00 R“ in
                                     Gewinnfarbe, sondern ein Strich und der Grund. -->
                                <td v-if="a.keineAuswahl" class="at-gedaempft">
                                    {{ t('strategies.wfKeineAuswahl', { min: robust.walkforward.minTrades }) }}
                                </td>
                                <td v-else><strong>{{ a.gewaehlt }}</strong></td>
                                <td v-if="a.pruefExpectancyR == null" class="zahl at-gedaempft">–</td>
                                <td v-else class="zahl" :class="a.pruefExpectancyR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                    {{ zahl(a.pruefExpectancyR) }} R
                                </td>
                                <td class="zahl">{{ a.keineAuswahl ? '–' : a.pruefTrades }}</td>
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

    </div>
</template>

<style scoped>
.testReiter {
    margin-top: var(--abstand-4);
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

.raster.unten {
    align-items: end;
}

.b1 { grid-column: span 1; }
.b2 { grid-column: span 2; }
.b3 { grid-column: span 3; }
.b12 { grid-column: 1 / -1; }

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

@media (max-width: 767.98px) {
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

.festeBreite {
    flex: 0 0 auto;
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

/* Breiter als lg: Parameter 7/5 nebeneinander, darunter untereinander
   (wie zuvor col-lg-7 / col-lg-5). */
@media (max-width: 767.98px) {
    .kpis.vier {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
