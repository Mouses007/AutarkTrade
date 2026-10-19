<script setup>
/**
 * Coin-Rangliste — eine fertige Strategie über ein ganzes Coin-Universum.
 *
 * Die Seite fragt den Fortschritt ab, statt an einem Ereignisstrom zu hängen:
 * ein Lauf dauert Minuten, und ein Seitenwechsel darf ihn nicht töten. Der
 * Server arbeitet ihn im Hintergrund ab; hier wird nur gezeigt, wie weit er ist.
 *
 * Die wichtigste Anzeige ist nicht die Tabelle, sondern der Satz darüber: bei
 * hundert getesteten Coins sieht immer irgendeiner hervorragend aus. Ohne die
 * Nullverteilung daneben wäre die Rangliste eine Einladung, Rauschen zu handeln.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { Knopf, Pille, Symbol, Hinweis, Kreisel } from '../components/basis'
import KiHinweis from '../components/quellen/KiHinweis.vue'

const { t } = useI18n()

const strategien = ref([])
const universen = ref([])
const quellen = ref(null)
const laeufe = ref([])

const form = ref({
    strategyId: '',
    timeframe: '',
    // 360 Tage als Vorgabe, nicht 180: weil der Zeitraum geteilt wird, braucht
    // JEDE Hälfte für sich 30 Trades. Auf 1h liefern 180 Tage nur gut 20 — die
    // ganze Rangliste wäre dann „zu wenige Trades".
    tage: 360,
    art: 'top',
    n: 100,
    symbole: '',
    nurHandelbar: true,
    thema: '',
})

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
    if (z.bestaetigt) return { farbe: 'greenTrade', text: t('rangliste.bestaetigt') }
    if (Number(z.bTrades) < 30) return { farbe: 'at-warn', text: t('rangliste.duenn') }
    return { farbe: 'redTrade', text: t('rangliste.gekippt') }
}

async function ladeGrunddaten() {
    try {
        const [s, u, l] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/rangliste/universen'),
            axios.get('/api/rangliste/laeufe'),
        ])
        strategien.value = s.data?.strategies || []
        universen.value = u.data || []
        laeufe.value = l.data || []
        if (!form.value.strategyId && strategien.value.length) {
            form.value.strategyId = strategien.value[0].id
            await holeVorschlag()
        }
        // Ein noch laufender Lauf wird sofort übernommen — auch wenn ihn eine
        // andere Sitzung gestartet hat.
        const offen = laeufe.value.find((x) => ['wartet', 'laeuft', 'pausiert'].includes(x.status))
        if (offen) oeffne(offen.id)
        else if (laeufe.value.length) oeffne(laeufe.value[0].id)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
    axios.get('/api/rangliste/universen/quellen')
        .then((r) => { quellen.value = r.data })
        .catch(() => { quellen.value = null })
}

async function holeVorschlag() {
    vorschlag.value = null
    if (!form.value.strategyId) return
    try {
        const r = await axios.get('/api/rangliste/zeiteinheit', {
            params: { strategyId: form.value.strategyId, tage: form.value.tage },
        })
        vorschlag.value = r.data
        if (r.data.timeframe) form.value.timeframe = r.data.timeframe
    } catch { /* ohne Vorschlag wählt der Nutzer selbst */ }
}

const kiLaeuft = ref(false)
const kiErgebnis = ref(null)

/**
 * Die KI schlägt vor, entscheidet aber nichts: das Ergebnis landet im
 * Symbolfeld, wo der Nutzer es sieht und ändern kann. Eine Liste, die direkt in
 * einen zehnminütigen Lauf wandert, hätte niemand geprüft.
 */
async function kiVorschlag() {
    kiErgebnis.value = null
    fehler.value = ''
    kiLaeuft.value = true
    try {
        const r = await axios.post('/api/rangliste/ki-vorschlag', { thema: form.value.thema })
        kiErgebnis.value = r.data
        form.value.symbole = r.data.symbole.join(', ')
        probe.value = null
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        kiLaeuft.value = false
    }
}

async function pruefeUniversum() {
    probe.value = null
    fehler.value = ''
    try {
        const r = await axios.post('/api/rangliste/universen/aufloesen', {
            art: form.value.art, n: form.value.n,
            symbole: form.value.symbole, nurHandelbar: form.value.nurHandelbar,
        })
        probe.value = r.data
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function starten() {
    fehler.value = ''
    laden.value = true
    try {
        const r = await axios.post('/api/rangliste/laeufe', {
            strategyId: form.value.strategyId,
            timeframe: form.value.timeframe,
            tage: form.value.tage,
            art: form.value.art, n: form.value.n,
            symbole: form.value.symbole, nurHandelbar: form.value.nurHandelbar,
            name: form.value.art === 'top' ? `Top ${form.value.n}` : form.value.art,
            timeframeQuelle: vorschlag.value?.timeframe === form.value.timeframe
                ? vorschlag.value.quelle : 'hand',
            timeframeBegruendung: vorschlag.value?.timeframe === form.value.timeframe
                ? vorschlag.value.begruendung : '',
        })
        await ladeGrunddaten()
        oeffne(r.data.laufId)
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laden.value = false
    }
}

async function abbrechen() {
    if (!lauf.value) return
    try { await axios.post(`/api/rangliste/laeufe/${lauf.value.id}/abbrechen`) } catch { /* egal */ }
}

async function loesche(id) {
    try {
        await axios.delete(`/api/rangliste/laeufe/${id}`)
        if (lauf.value?.id === id) { lauf.value = null; zeilen.value = [] }
        await ladeGrunddaten()
    } catch (e) { fehler.value = e.response?.data?.error || e.message }
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
        if (!laeuftGerade.value) { stopPolling(); await ladeListe() }
    } catch (e) {
        stopPolling()
        fehler.value = e.response?.data?.error || e.message
    }
}

async function ladeListe() {
    try { laeufe.value = (await axios.get('/api/rangliste/laeufe')).data || [] } catch { /* egal */ }
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onMounted(ladeGrunddaten)
onBeforeUnmount(stopPolling)
</script>

<template>
<div class="rangliste-seite">
    <div>
        <div class="dailyCard karte">
            <div class="section-title titel-zeile">
                <Symbol name="liste" class="vor" />{{ t('rangliste.title') }}
            </div>
            <p class="at-gedaempft klein-text ohne-rand">{{ t('rangliste.hint') }}</p>
        </div>

        <Hinweis v-if="fehler" art="fehler" class="abstand klein-text">{{ fehler }}</Hinweis>

        <!-- ══ Einstellungen ══ -->
        <div class="dailyCard karte">
            <div class="formular">
                <div class="b-4">
                    <label class="at-label">{{ t('rangliste.strategie') }}</label>
                    <select v-model="form.strategyId" class="at-feld klein" @change="holeVorschlag">
                        <option v-for="s in strategien" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                </div>
                <div class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.zeitraum') }}</label>
                    <input v-model.number="form.tage" type="number" min="14" max="720"
                           class="at-feld klein" @change="holeVorschlag" />
                </div>
                <div class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.zeiteinheit') }}</label>
                    <select v-model="form.timeframe" class="at-feld klein">
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
                    <select v-model="form.art" class="at-feld klein" @change="probe = null">
                        <option value="bitunix">{{ t('rangliste.artBitunix') }}</option>
                        <option value="top">{{ t('rangliste.artTop') }}</option>
                        <option value="manuell">{{ t('rangliste.artManuell') }}</option>
                        <option value="ki">{{ t('rangliste.artKi') }}</option>
                    </select>
                </div>
                <div v-if="form.art === 'top'" class="b-2 mobil-halb">
                    <label class="at-label">{{ t('rangliste.anzahl') }}</label>
                    <input v-model.number="form.n" type="number" min="5" max="250"
                           class="at-feld klein" />
                </div>
                <div v-if="form.art === 'ki'" class="b-4">
                    <label class="at-label">{{ t('rangliste.kiThema') }}</label>
                    <div class="feld-gruppe">
                        <input v-model="form.thema" type="text" class="at-feld klein"
                               placeholder="RWA" @keyup.enter="kiVorschlag" />
                        <Knopf klein :disabled="kiLaeuft || !form.thema" @click="kiVorschlag">
                            <Kreisel v-if="kiLaeuft" still />
                            <span v-else>{{ t('rangliste.kiVorschlagen') }}</span>
                        </Knopf>
                    </div>
                </div>
                <div v-if="form.art === 'manuell' || form.art === 'ki'" class="b-6">
                    <label class="at-label">{{ t('rangliste.symbole') }}</label>
                    <input v-model="form.symbole" type="text" class="at-feld klein"
                           placeholder="BTCUSDT, ETHUSDT" />
                </div>
                <div class="b-3">
                    <label class="at-check klein-text" for="nurH">
                        <input v-model="form.nurHandelbar" type="checkbox" id="nurH" />
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
                    <!-- S12: Pflichtlabel am KI-Vorschlag. -->
                    <KiHinweis klein />
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

            <Knopf art="haupt" klein :laedt="laden" :disabled="laden || laeuftGerade || !form.timeframe"
                    @click="starten">
                {{ t('rangliste.starten') }}
            </Knopf>
        </div>

        <!-- ══ Fortschritt ══ -->
        <div v-if="lauf" class="dailyCard karte">
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
        <div v-if="belastbare.length" class="dailyCard karte">
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
                            <td class="zahl" :class="z.aOhneTopR >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ zahl(z.aOhneTopR) }} R
                            </td>
                            <td class="zahl at-gedaempft">{{ zahl(z.aExpectancyR) }} R</td>
                            <td class="zahl at-gedaempft">{{ zahl(z.aMaxDdPct, 1) }} %</td>
                            <td class="zahl" :class="z.bOhneTopR >= 0 ? 'greenTrade' : 'redTrade'">
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
        <div v-if="uebrige.length" class="dailyCard karte">
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

        <!-- ══ Frühere Läufe ══ -->
        <div class="dailyCard karte">
            <div class="section-title abstand-klein">{{ t('rangliste.laeufe') }}</div>
            <p v-if="!laeufe.length" class="at-gedaempft klein-text ohne-rand">{{ t('rangliste.keineLaeufe') }}</p>
            <div v-else class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <tbody>
                        <tr v-for="l in laeufe" :key="l.id" style="cursor:pointer" @click="oeffne(l.id)">
                            <td>{{ l.universumName }}</td>
                            <td class="at-gedaempft">{{ l.strategyId }} · {{ l.timeframe }}</td>
                            <td class="at-gedaempft">{{ datum(l.fromTs) }} – {{ datum(l.toTs) }}</td>
                            <td>{{ t('rangliste.st_' + l.status) }}</td>
                            <td class="at-gedaempft">{{ l.fortschritt }}/{{ l.gesamt }}</td>
                            <td class="zahl">
                                <Knopf art="gefahr" klein nurSymbol symbol="muell"
                                        @click.stop="loesche(l.id)" />
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
/*
 * `.dailyCard` trägt global `height: 100%` (design/journal.css). Das ist dort
 * richtig, wo Karten NEBENEINANDER in einer Zeile stehen und gleich hoch sein
 * sollen — Dashboard und Auswertung leben davon.
 *
 * Hier stehen die sechs Karten aber UNTEREINANDER. Gemessen (mit dem alten
 * Bootstrap-Raster): sechs Karten à 3796 px und eine 23 325 px hohe Seite —
 * die Rangliste stand dann irgendwo weit unten hinter riesigen Löchern.
 * Deshalb hier heilen und nicht global.
 */
.dailyCard {
    height: auto;
}

.rangliste-seite {
    margin-top: var(--abstand-2);
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

.ohne-rand {
    margin: 0;
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
</style>
