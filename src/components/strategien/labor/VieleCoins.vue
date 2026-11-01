<script setup>
/**
 * Labor › Viele Coins: eine Strategie über viele Märkte statt über einen.
 *
 *   Rangliste            dieselben Werte über ein ganzes Coin-Universum, Ränge
 *                        aus der ersten Hälfte, geprüft in der zweiten
 *   Parameter vergleichen  die Werte oben gegen die der gewählten Instanz, über
 *                        mehrere Symbole und zwei Zeitfenster (bis 01.11.2026
 *                        „Mehrfach-Test" im Labor)
 *
 * Strategie und Werte kommen aus dem gemeinsamen Formular der Labor-Seite.
 *
 * Die Rangliste fragt den Fortschritt ab, statt an einem Ereignisstrom zu
 * hängen: ein Lauf dauert Minuten, und ein Seitenwechsel darf ihn nicht töten.
 * Die wichtigste Anzeige ist nicht die Tabelle, sondern der Satz darüber: bei
 * hundert getesteten Coins sieht immer irgendeiner hervorragend aus. Ohne die
 * Nullverteilung daneben wäre die Rangliste eine Einladung, Rauschen zu handeln.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { Knopf, Pille, Symbol, Hinweis, Kreisel } from '../../basis'
import QuelleAus from '../../quellen/QuelleAus.vue'
import { apiFehlerText } from '../../../utils/apiError.js'
import { zeitraumVon } from '../../../utils/strategien/format.js'
import dayjs from '../../../utils/journal/zeit.js'

const props = defineProps({
    form: { type: Object, required: true },
    strategie: { type: Object, default: null },
    instanzen: { type: Array, default: () => [] },
})
const { t } = useI18n()
const route = useRoute()

const modus = ref(route.query.modus === 'vergleich' ? 'vergleich' : 'rangliste')

// ── Rangliste ───────────────────────────────────────────────────────────
const rl = ref({
    timeframe: '',
    // 360 Tage als Vorgabe, nicht 180: weil der Zeitraum geteilt wird, braucht
    // JEDE Hälfte für sich 30 Trades. Auf 1h liefern 180 Tage nur gut 20.
    tage: 360,
    art: 'top', n: 100, symbole: '', nurHandelbar: true, thema: '',
})
const quellen = ref(null)
const vorschlag = ref(null)
const probe = ref(null)
const fehler = ref('')
const laden = ref(false)
const lauf = ref(null)
const zeilen = ref([])
let pollTimer = null

const belastbare = computed(() => zeilen.value.filter((z) => z.klasse === 'belastbar'))
const uebrige = computed(() => zeilen.value.filter((z) => z.klasse !== 'belastbar'))
const laeuftGerade = computed(() => ['wartet', 'laeuft', 'pausiert'].includes(lauf.value?.status))

const zahl = (v, n = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '—')
const datum = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString() : '—')

/** Ampel der Prüfhälfte — grün bestätigt, gelb zu dünn, rot gekippt. */
function ampel(z) {
    if (z.bestaetigt) return { farbe: 'gewinnWert', text: t('rangliste.bestaetigt') }
    if (Number(z.bTrades) < 30) return { farbe: 'at-warn', text: t('rangliste.duenn') }
    return { farbe: 'verlustWert', text: t('rangliste.gekippt') }
}

async function holeVorschlag() {
    vorschlag.value = null
    if (!props.form.strategyId) return
    try {
        const r = await axios.get('/api/rangliste/zeiteinheit', {
            params: { strategyId: props.form.strategyId, tage: rl.value.tage },
        })
        vorschlag.value = r.data
        if (r.data.timeframe) rl.value.timeframe = r.data.timeframe
    } catch { /* ohne Vorschlag wählt der Nutzer selbst */ }
}
watch(() => props.form.strategyId, holeVorschlag)

const kiLaeuft = ref(false)
const kiErgebnis = ref(null)

/**
 * Die KI schlägt vor, entscheidet aber nichts: das Ergebnis landet im
 * Symbolfeld, wo der Nutzer es sieht und ändern kann.
 */
async function kiVorschlag() {
    kiErgebnis.value = null
    fehler.value = ''
    kiLaeuft.value = true
    try {
        const r = await axios.post('/api/rangliste/ki-vorschlag', { thema: rl.value.thema })
        kiErgebnis.value = r.data
        rl.value.symbole = r.data.symbole.join(', ')
        probe.value = null
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    } finally {
        kiLaeuft.value = false
    }
}

async function pruefeUniversum() {
    probe.value = null
    fehler.value = ''
    try {
        const r = await axios.post('/api/rangliste/universen/aufloesen', {
            art: rl.value.art, n: rl.value.n, symbole: rl.value.symbole, nurHandelbar: rl.value.nurHandelbar,
        })
        probe.value = r.data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

async function starten() {
    fehler.value = ''
    laden.value = true
    try {
        const f = props.form
        const r = await axios.post('/api/rangliste/laeufe', {
            strategyId: f.strategyId,
            // Die Werte oben gehen mit — „Vorgaben" oder die einer Instanz.
            instanceId: Number(f.instanceId) || 0,
            params: f.params, risk: f.risk,
            timeframe: rl.value.timeframe,
            tage: rl.value.tage,
            art: rl.value.art, n: rl.value.n,
            symbole: rl.value.symbole, nurHandelbar: rl.value.nurHandelbar,
            name: rl.value.art === 'top' ? `Top ${rl.value.n}` : rl.value.art,
            timeframeQuelle: vorschlag.value?.timeframe === rl.value.timeframe ? vorschlag.value.quelle : 'hand',
            timeframeBegruendung: vorschlag.value?.timeframe === rl.value.timeframe ? vorschlag.value.begruendung : '',
        })
        oeffne(r.data.laufId)
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        laden.value = false
    }
}

async function abbrechen() {
    if (!lauf.value) return
    try { await axios.post(`/api/rangliste/laeufe/${lauf.value.id}/abbrechen`) } catch { /* egal */ }
}

async function oeffne(id) {
    stopPolling()
    await aktualisiere(id)
    if (laeuftGerade.value) pollTimer = setInterval(() => aktualisiere(id), 2000)
}

async function aktualisiere(id) {
    try {
        const [k, z] = await Promise.all([
            axios.get(`/api/rangliste/laeufe/${id}`),
            axios.get(`/api/rangliste/laeufe/${id}/zeilen`),
        ])
        lauf.value = k.data
        zeilen.value = z.data || []
        if (!laeuftGerade.value) stopPolling()
    } catch (e) {
        stopPolling()
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onMounted(async () => {
    holeVorschlag()
    axios.get('/api/rangliste/universen/quellen').then((r) => { quellen.value = r.data }).catch(() => { quellen.value = null })
    // Aus „Läufe" geöffnet, sonst der laufende oder der letzte Lauf — auch
    // einer, den eine andere Sitzung gestartet hat.
    if (route.query.rangliste) return oeffne(Number(route.query.rangliste))
    try {
        const laeufe = (await axios.get('/api/rangliste/laeufe')).data || []
        const offen = laeufe.find((x) => ['wartet', 'laeuft', 'pausiert'].includes(x.status))
        if (offen) oeffne(offen.id)
        else if (laeufe.length) oeffne(laeufe[0].id)
    } catch { /* ohne Liste beginnt die Seite leer */ }
})
onBeforeUnmount(stopPolling)

// ── Parameter vergleichen ───────────────────────────────────────────────
// Derselbe Parametersatz über mehrere Symbole und zwei Zeitfenster. Die
// Trennung in Optimierungs- und Prüffenster ist der Kern — eine Einstellung,
// die nur dort gut ist, wo sie ausgesucht wurde, taugt nichts.
const matrix = ref({
    symbole: 'BTCUSDT, ETHUSDT',
    zeitmodus: 'tage', tage: 360,
    von: dayjs().subtract(360, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    gegenGespeicherte: true,
    // `aus`: Marktdaten abgeschaltet — Antwort `{ aus: true, … }` statt
    // Ergebnis. Bis 31.10.2026 landete sie als Ergebnis und zeigte eine leere
    // Tabelle ohne Hinweis (FUN-F5-002).
    laeuft: false, fehler: '', ergebnis: null, aus: null,
})

/**
 * Verglichen wird gegen die GESPEICHERTEN Parameter der gewählten Instanz —
 * nur so beantwortet der Lauf die eigentliche Frage: „ist meine Änderung besser
 * als das, was gerade läuft?" Ohne Instanz gibt es keinen Vergleich, dann zeigt
 * die Matrix nur die Zahlen des aktuellen Satzes.
 */
async function matrixStarten() {
    const zeitraum = zeitraumVon(matrix.value)
    if (!zeitraum) { matrix.value.fehler = t('strategies.rangeInvalid'); return }
    matrix.value.laeuft = true
    matrix.value.fehler = ''
    matrix.value.ergebnis = null
    matrix.value.aus = null
    try {
        const f = props.form
        const inst = props.instanzen.find((i) => i.id === Number(f.instanceId))
        const r = await axios.post('/api/strategies/backtest-matrix', {
            strategyId: f.strategyId,
            timeframe: f.timeframe,
            symbols: matrix.value.symbole.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            ...zeitraum,
            // Startkapital aus `risk.startEquityUsdt` (Server), wie im Einzeltest.
            params: f.params,
            baselineParams: (matrix.value.gegenGespeicherte && inst) ? inst.params : null,
            risk: f.risk,
        })
        if (r.data?.aus) matrix.value.aus = r.data
        else matrix.value.ergebnis = r.data
    } catch (e) {
        matrix.value.fehler = apiFehlerText(e, t('strategies.matrixFailed'), t)
    } finally {
        matrix.value.laeuft = false
    }
}

const matrixZahl = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
</script>

<template>
<div class="vieleCoins">
    <div class="modusWahl">
        <button type="button" :class="['ctl-pill', { aktiv: modus === 'rangliste' }]" @click="modus = 'rangliste'">
            <Symbol name="listeNummer" class="vor" />{{ t('strategien.labor.modusRangliste') }}
        </button>
        <button type="button" :class="['ctl-pill', { aktiv: modus === 'vergleich' }]" @click="modus = 'vergleich'">
            <Symbol name="raster" class="vor" />{{ t('strategien.labor.modusVergleich') }}
        </button>
    </div>

    <template v-if="modus === 'rangliste'">
        <Hinweis v-if="fehler" art="fehler" class="abstand klein-text">{{ fehler }}</Hinweis>

        <!-- ══ Einstellungen ══ -->
        <div class="journalKarte karte">
            <p class="at-gedaempft klein-text abstand-klein">{{ t('rangliste.hint') }} {{ t('strategien.labor.parameterOben') }}</p>
            <div class="formular">
                <div class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.zeitraum') }}</label>
                    <input v-model.number="rl.tage" type="number" min="14" max="720"
                           class="at-feld klein" @change="holeVorschlag" />
                </div>
                <div class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.zeiteinheit') }}</label>
                    <select v-model="rl.timeframe" class="at-feld klein">
                        <option v-for="tf in (vorschlag?.kandidaten || [])" :key="tf" :value="tf">{{ tf }}</option>
                    </select>
                </div>
            </div>

            <!-- Der Vorschlag steht MIT Begründung da: eine Zeiteinheit, die aus
                 dem Nichts vorgeschlagen wird, übernimmt man blind. -->
            <div v-if="vorschlag?.begruendung" class="notiz abstand-klein">
                <Symbol name="idee" class="vor" />{{ vorschlag.begruendung }}
            </div>
            <Hinweis v-if="vorschlag?.knapp?.length" art="warn" class="abstand-klein klein-text">
                <span v-for="k in vorschlag.knapp" :key="k.timeframe" class="knapp">
                    <strong>{{ k.timeframe }}</strong>: {{ k.text }}
                </span>
            </Hinweis>

            <hr class="trenner" />

            <!-- ══ Universum ══ -->
            <div class="section-title abstand-klein">{{ t('rangliste.universum') }}</div>
            <p v-if="quellen" class="at-gedaempft klein-text abstand-klein">
                {{ t('rangliste.quellen', quellen) }}
            </p>
            <div class="formular">
                <div class="b-4">
                    <select v-model="rl.art" class="at-feld klein" :aria-label="t('rangliste.artLabel')" @change="probe = null">
                        <option value="bitunix">{{ t('rangliste.artBitunix') }}</option>
                        <option value="top">{{ t('rangliste.artTop') }}</option>
                        <option value="manuell">{{ t('rangliste.artManuell') }}</option>
                        <option value="ki">{{ t('rangliste.artKi') }}</option>
                    </select>
                </div>
                <div v-if="rl.art === 'top'" class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.anzahl') }}</label>
                    <input v-model.number="rl.n" type="number" min="5" max="250"
                           class="at-feld klein" />
                </div>
                <div v-if="rl.art === 'ki'" class="b-4">
                    <label class="at-label">{{ t('rangliste.kiThema') }}</label>
                    <div class="feld-gruppe">
                        <input v-model="rl.thema" type="text" class="at-feld klein"
                               placeholder="RWA" @keyup.enter="kiVorschlag" />
                        <Knopf klein :disabled="kiLaeuft || !rl.thema" @click="kiVorschlag">
                            <Kreisel v-if="kiLaeuft" still />
                            <span v-else>{{ t('rangliste.kiVorschlagen') }}</span>
                        </Knopf>
                    </div>
                </div>
                <div v-if="rl.art === 'manuell' || rl.art === 'ki'" class="b-6">
                    <label class="at-label">{{ t('rangliste.symbole') }}</label>
                    <input v-model="rl.symbole" type="text" class="at-feld klein"
                           placeholder="BTCUSDT, ETHUSDT" />
                </div>
                <div class="b-3">
                    <label class="at-check klein-text" for="nurH">
                        <input v-model="rl.nurHandelbar" type="checkbox" id="nurH" />
                        {{ t('rangliste.nurHandelbar') }}
                    </label>
                </div>
                <div class="b-2">
                    <Knopf klein class="voll" @click="pruefeUniversum">
                        {{ t('rangliste.pruefen') }}
                    </Knopf>
                </div>
            </div>

            <!-- Was das Modell vorgeschlagen hat UND was davon nicht ging.
                 Eine still gekürzte Liste wäre eine Behauptung über
                 Vollständigkeit, die niemand nachprüfen kann. -->
            <div v-if="kiErgebnis" class="notiz abstand-klein" data-ki-generiert="true">
                <div>
                    <strong>{{ kiErgebnis.name }}</strong> — {{ kiErgebnis.begruendung }}
                    <div v-if="kiErgebnis.verworfen.length" class="at-warn oben">
                        {{ t('rangliste.kiVerworfen', {
                            n: kiErgebnis.verworfen.length,
                            gesamt: kiErgebnis.gesamtVorschlaege,
                        }) }}
                        <span class="at-gedaempft">{{ kiErgebnis.verworfen.slice(0, 8).join(', ') }}</span>
                    </div>
                    <div class="at-gedaempft oben">
                        {{ kiErgebnis.provider }}/{{ kiErgebnis.modell }} ·
                        {{ kiErgebnis.tokens }} Token · {{ kiErgebnis.kostenUsd.toFixed(4) }} USD
                    </div>
                </div>
            </div>

            <div v-if="probe" class="notiz abstand-klein">
                <div>
                    <strong>{{ t('rangliste.gefunden', { n: probe.anzahl }) }}</strong>
                    <span class="at-gedaempft links">
                        {{ t('rangliste.ausgeschlossen', {
                            ohneHistorie: probe.ohneHistorie.length,
                            ohneMarkt: probe.ohneMarkt.length,
                            nichtHandelbar: probe.nichtHandelbar.length,
                        }) }}
                    </span>
                </div>
            </div>

            <Knopf art="haupt" klein :laedt="laden" :disabled="laden || laeuftGerade || !rl.timeframe || !form.strategyId"
                    @click="starten">
                {{ t('rangliste.starten') }}
            </Knopf>
        </div>

        <!-- ══ Fortschritt ══ -->
        <div v-if="lauf" class="journalKarte karte">
            <div class="lauf-kopf">
                <div>
                    <strong>{{ lauf.universumName }}</strong>
                    <span class="at-gedaempft klein-text links">
                        {{ lauf.strategyId }} · {{ lauf.timeframe }} ·
                        {{ datum(lauf.fromTs) }} – {{ datum(lauf.toTs) }}
                    </span>
                </div>
                <div class="lauf-aktionen">
                    <Pille :ton="lauf.status === 'fertig' ? 'gut'
                                : lauf.status === 'fehler' ? 'schlecht'
                                : lauf.status === 'abgebrochen' ? 'neutral' : 'akzent'">
                        {{ t('rangliste.st_' + lauf.status) }}
                    </Pille>
                    <Knopf v-if="laeuftGerade" art="gefahr" klein @click="abbrechen">
                        {{ t('rangliste.abbrechen') }}
                    </Knopf>
                </div>
            </div>
            <div v-if="laeuftGerade" class="fortschritt">
                <div class="fortschritt-balken" role="progressbar"
                     :style="{ width: (lauf.gesamt ? (lauf.fortschritt / lauf.gesamt * 100) : 0) + '%' }"></div>
            </div>
            <div class="klein-text at-gedaempft">
                {{ t('rangliste.fortschritt', { fertig: lauf.fortschritt, gesamt: lauf.gesamt }) }}
                <span v-if="lauf.timeframeBegruendung" class="links">· {{ lauf.timeframeBegruendung }}</span>
            </div>
        </div>

        <!-- ══ Die Beurteilung — wichtiger als die Tabelle ══ -->
        <Hinweis v-if="lauf?.nullverteilung?.satz" class="abstand klein-text"
             :art="lauf.nullverteilung.umtopfen && lauf.nullverteilung.umtopfen.anteilUeberBeobachtet < 0.05
                     ? 'gut' : 'warn'">
            <div class="fett titel-zeile">
                <Symbol name="wuerfel" class="vor" />{{ t('rangliste.beurteilung') }}
            </div>
            {{ lauf.nullverteilung.satz }}
        </Hinweis>

        <!-- ══ Rangliste ══ -->
        <div v-if="belastbare.length" class="journalKarte karte">
            <div class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <thead><tr>
                        <th style="width:3rem">{{ t('rangliste.rang') }}</th>
                        <th>{{ t('rangliste.symbol') }}</th>
                        <th class="zahl">{{ t('rangliste.trades') }}</th>
                        <th class="zahl">{{ t('rangliste.ohneTop') }}</th>
                        <th class="zahl">{{ t('rangliste.erwartung') }}</th>
                        <th class="zahl">{{ t('rangliste.maxDd') }}</th>
                        <th class="zahl">{{ t('rangliste.pruefhaelfte') }}</th>
                        <th></th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="z in belastbare" :key="z.id">
                            <td class="at-gedaempft">{{ z.rangA }}</td>
                            <td><strong>{{ z.symbol }}</strong></td>
                            <td class="zahl">{{ z.aTrades }}</td>
                            <td class="zahl" :class="z.aOhneTopR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                {{ zahl(z.aOhneTopR) }} R
                            </td>
                            <td class="zahl at-gedaempft">{{ zahl(z.aExpectancyR) }} R</td>
                            <td class="zahl at-gedaempft">{{ zahl(z.aMaxDdPct, 1) }} %</td>
                            <td class="zahl" :class="z.bOhneTopR >= 0 ? 'gewinnWert' : 'verlustWert'">
                                {{ zahl(z.bOhneTopR) }} R
                                <span class="at-gedaempft">({{ z.bTrades }})</span>
                            </td>
                            <td :class="ampel(z).farbe">{{ ampel(z).text }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ══ Unter der Trennlinie — sichtbar, aber ohne Rang ══ -->
        <div v-if="uebrige.length" class="journalKarte karte">
            <p class="at-gedaempft klein-text abstand-klein">{{ t('rangliste.unterTrennlinie') }}</p>
            <div class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <tbody>
                        <tr v-for="z in uebrige" :key="z.id">
                            <td style="width:9rem">
                                <Pille ton="neutral">{{ t('rangliste.k_' + z.klasse) }}</Pille>
                            </td>
                            <td><strong>{{ z.symbol }}</strong></td>
                            <td class="zahl">{{ z.aTrades }} {{ t('rangliste.trades') }}</td>
                            <td class="zahl at-gedaempft">{{ zahl(z.aOhneTopR) }} R</td>
                            <td class="at-gedaempft">
                                <span v-if="z.klasse === 'datenluecke'">
                                    {{ zahl(z.abdeckungPct, 0) }} % · ab {{ datum(z.historieAb) }}
                                </span>
                                <span v-else-if="z.fehler">{{ z.fehler }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

    </template>

    <template v-else>
        <!-- ══ Mehrfach-Test ══ -->
        <div class="journalKarte karte">
            <div class="section-title abstandUnten1">
                <Symbol name="raster" class="vorSymbol" />{{ t('strategies.matrixTitle') }}
            </div>
            <p class="at-gedaempft fein abstandUnten">{{ t('strategies.matrixHint') }}</p>
            <div class="raster unten abstandUnten">
                <div class="b2 m3">
                    <label class="at-label">{{ t('strategies.timeframe') }}</label>
                    <select v-model="form.timeframe" class="at-feld klein">
                        <option v-for="tf in strategie?.supportedTimeframes || []" :key="tf" :value="tf">{{ tf }}</option>
                    </select>
                </div>
                <div class="b3">
                    <label class="at-label">{{ t('strategies.matrixSymbols') }}</label>
                    <input v-model="matrix.symbole" type="text" class="at-feld klein"
                           placeholder="BTCUSDT, ETHUSDT" />
                </div>
                <div class="b2 m3">
                    <label class="at-label">{{ t('strategies.period') }}</label>
                    <select v-model="matrix.zeitmodus" class="at-feld klein">
                        <option value="tage">{{ t('strategies.days') }}</option>
                        <option value="datum">{{ t('strategies.dateRange') }}</option>
                    </select>
                </div>
                <div v-if="matrix.zeitmodus === 'tage'" class="b2 m3">
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
                <div v-if="form.instanceId" class="b3">
                    <label class="at-check fein" for="matrixVergleich">
                        <input id="matrixVergleich" v-model="matrix.gegenGespeicherte" type="checkbox" />
                        {{ t('strategies.matrixCompare') }}
                    </label>
                </div>
                <div class="b3">
                    <Knopf art="haupt" klein class="voll" :disabled="matrix.laeuft || !form.strategyId"
                            @click="matrixStarten">
                        {{ matrix.laeuft ? t('strategies.running') : t('strategies.matrixStart') }}
                    </Knopf>
                </div>
            </div>

            <div v-if="matrix.fehler" class="at-schlecht fein abstandUnten">{{ matrix.fehler }}</div>
            <QuelleAus v-if="matrix.aus" :aus="matrix.aus" class="abstandUnten" />

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

    </template>
</div>
</template>

<style scoped>
/*
 * `.journalKarte` trägt global `height: 100%` (design/journal.css). Das ist dort
 * richtig, wo Karten NEBENEINANDER in einer Zeile stehen und gleich hoch sein
 * sollen — Dashboard und Auswertung leben davon.
 *
 * Hier stehen die sechs Karten aber UNTEREINANDER. Gemessen (mit dem alten
 * Bootstrap-Raster): sechs Karten à 3796 px und eine 23 325 px hohe Seite —
 * die Rangliste stand dann irgendwo weit unten hinter riesigen Löchern.
 * Deshalb hier heilen und nicht global.
 */
.journalKarte {
    height: auto;
}

.vieleCoins {
    margin-top: var(--abstand-4);
}

.modusWahl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-3);
}

.ctl-pill.aktiv {
    border-color: var(--accent);
    color: var(--accent);
}

.karte {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-4);
}

.abstand {
    margin-bottom: var(--abstand-4);
}

.abstand-klein {
    margin-bottom: var(--abstand-2);
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: var(--abstand-1);
}

.titel-zeile {
    display: flex;
    align-items: center;
}

.vor {
    margin-right: var(--abstand-1);
}

.links {
    margin-left: var(--abstand-2);
}

.oben {
    margin-top: var(--abstand-1);
}

.klein-text {
    font-size: 0.85rem;
}

.fett {
    font-weight: 700;
    margin-bottom: var(--abstand-1);
}

/* Formularraster: 12 Spalten wie vorher, auf dem Telefon einspaltig
   (ausser den beiden Zahlenfeldern, die halbe Breite teilen). */
.formular {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--abstand-2);
    align-items: end;
    margin-bottom: var(--abstand-2);
}

.formular > * {
    grid-column: span 12;
    min-width: 0;
}

.at-label {
    margin-bottom: var(--abstand-1);
}

.feld-gruppe {
    display: flex;
    gap: var(--abstand-1);
}

.feld-gruppe .at-feld {
    flex: 1 1 auto;
    min-width: 0;
}

.voll {
    width: 100%;
}

.notiz {
    display: flex;
    align-items: flex-start;
    font-size: 0.85rem;
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-2) var(--abstand-3);
}

.knapp {
    margin-right: var(--abstand-2);
}

.trenner {
    border: 0;
    border-top: 1px solid var(--line);
    margin: var(--abstand-4) 0;
    opacity: 1;
}

.lauf-kopf {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.lauf-aktionen {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
}

.fortschritt {
    height: 6px;
    background: var(--panel-soft);
    border-radius: var(--radius-pille);
    overflow: hidden;
    margin-bottom: var(--abstand-1);
}

.fortschritt-balken {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
}

.at-tabelle {
    font-size: 0.85rem;
    margin: 0;
}

@media (max-width: 767.98px) {
    .formular > .mobil-halb {
        grid-column: span 6;
    }

    .karte {
        padding: var(--abstand-3);
    }
}

@media (min-width: 768px) {
    .formular > .b-2 { grid-column: span 2; }
    .formular > .b-3 { grid-column: span 3; }
    .formular > .b-4 { grid-column: span 4; }
    .formular > .b-6 { grid-column: span 6; }
}

/* ── Parameter vergleichen (aus dem Labor) ── */
.fein {
    font-size: 0.85rem;
}

.vorSymbol {
    margin-right: var(--abstand-1);
    vertical-align: -0.125em;
}

.abstandUnten1 { margin-bottom: var(--abstand-1); }

.abstandUnten { margin-bottom: var(--abstand-2); }

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

.kasten {
    padding: var(--abstand-2) var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    font-size: 0.85rem;
}

.fussnote {
    margin: var(--abstand-1) 0 0;
    font-size: 0.85rem;
    color: var(--muted);
}
.section-title.abstandUnten1 { margin-bottom: var(--abstand-1); }

@media (max-width: 767.98px) {
    .raster { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .raster > * { grid-column: 1 / -1; }
    .raster > .m3 { grid-column: span 3; }
}
</style>
