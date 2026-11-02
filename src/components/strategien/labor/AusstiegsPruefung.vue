<script setup>
/**
 * Labor › Test › Ausstiegs-Prüfung: dieselben Einstiege, andere Ausstiege.
 *
 * Rechnet den Backtest mit den Eingaben des Formulars und spielt jeden Trade
 * mit schlichten Ausstiegen neu (`server/ausstiege.js`). Die Frage dahinter:
 * Fehlt einer Strategie die Kante beim Einstieg oder beim Ausstieg?
 *
 * Gezeigt wird zuerst das Urteil auf den ungesehenen 30 % der Trades, dann
 * die Karte. Die Karte allein verleitet dazu, die grünste Zelle zu nehmen —
 * genau die, die im Prüfteil am ehesten zusammenbricht.
 *
 * Dazwischen zwei Gegenproben ohne eigene Auswahl: die Einstiege gegen
 * Zufallseinstiege (Edge Ratio) und die Überanpassung der Zonenwahl über
 * 70 Aufteilungen (CSCV).
 */
import { ref, computed } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import QuelleAus from '../../quellen/QuelleAus.vue'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../../basis'
import { apiFehlerText } from '../../../utils/apiError.js'
import { zeitraumVon } from '../../../utils/strategien/format.js'

const props = defineProps({
    // Gemeinsames Formular der Labor-Seite (Strategie, Werte, Symbol, Zeitraum)
    form: { type: Object, required: true },
})
const { t } = useI18n()

const antwort = ref(null)
const laeuft = ref(false)
const fehler = ref('')
const aus = ref(null)
// Haltedauer der Karte (Index); null = die der gewählten Zone
const haltWahl = ref(null)
const teil = ref('alle')

// Ohne Vorzeichen bei null: „-0.00" sähe nach einem Verlust aus.
const zahl = (v, n = 2) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–'
    const text = Number(v).toFixed(n)
    return Number(text) === 0 ? (0).toFixed(n) : text
}
const datum = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : '–')
const pWert = (p) => (p === null || p === undefined ? '–' : p < 0.001 ? '< 0.001' : Number(p).toFixed(3))

async function starten() {
    const zeitraum = zeitraumVon(props.form)
    if (!zeitraum) { fehler.value = t('strategies.rangeInvalid'); return }
    laeuft.value = true
    fehler.value = ''
    aus.value = null
    antwort.value = null
    haltWahl.value = null
    try {
        const f = props.form
        const r = await axios.post('/api/strategies/robustness/ausstiege', {
            strategyId: f.strategyId, symbol: f.symbol.toUpperCase(), timeframe: f.timeframe,
            ...zeitraum, params: f.params, risk: f.risk,
        })
        if (r.data?.aus) aus.value = r.data
        else antwort.value = r.data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategien.ausstiege.fehlgeschlagen'), t)
    } finally {
        laeuft.value = false
    }
}

const a = computed(() => antwort.value?.ausstiege || null)
const raster = computed(() => a.value?.raster || { stops: [], ziele: [], halten: [] })
const haltIdx = computed(() => haltWahl.value ?? a.value?.gewaehlt?.h ?? 0)

const stopText = (i) => t('strategien.ausstiege.stop', { f: raster.value.stops[i] })
const zielText = (i) => (raster.value.ziele[i] > 0
    ? t('strategien.ausstiege.ziel', { r: raster.value.ziele[i] })
    : t('strategien.ausstiege.ohneZiel'))
const haltText = (i) => t('strategien.ausstiege.kerzen', { n: raster.value.halten[i] })
const zielLang = (i) => (raster.value.ziele[i] > 0
    ? t('strategien.ausstiege.zielLang', { r: raster.value.ziele[i] })
    : t('strategien.ausstiege.ohneZiel'))
const zelleText = (c) => (c ? t('strategien.ausstiege.zelle', { stop: stopText(c.s), ziel: zielLang(c.z), halten: haltText(c.h) }) : '–')

function zelleBei(s, z, h) {
    const Z = raster.value.ziele.length
    const H = raster.value.halten.length
    return a.value?.zellen?.[(s * Z + z) * H + h] || null
}

/** Die Zeilen der Karte bei der gewählten Haltedauer und dem gewählten Teil. */
const karte = computed(() => {
    if (!a.value) return []
    return raster.value.stops.map((_, s) => raster.value.ziele.map((__, z) => {
        const c = zelleBei(s, z, haltIdx.value)
        return { s, z, wert: c?.[teil.value]?.mittel ?? null }
    }))
})

/** Farbstärke je Zelle: gemessen am grössten Betrag der sichtbaren Karte. */
const groesster = computed(() => {
    let m = 0
    for (const reihe of karte.value) for (const c of reihe) if (c.wert !== null) m = Math.max(m, Math.abs(c.wert))
    return m || 1
})
function zellStil(wert) {
    if (wert === null) return {}
    const anteil = Math.round(Math.min(1, Math.abs(wert) / groesster.value) * 45)
    const farbe = wert >= 0 ? 'var(--good)' : 'var(--bad)'
    return { background: `color-mix(in srgb, ${farbe} ${anteil}%, transparent)` }
}
const istZone = (s, z) => a.value?.gewaehlt && a.value.gewaehlt.s === s && a.value.gewaehlt.z === z
    && a.value.gewaehlt.h === haltIdx.value

// „Besser" als die eigenen Ausstiege heisst noch nicht „gut": bleibt auch die
// Zone im Prüfteil im Minus, ist es eine Warnung, kein grünes Signal.
const urteilTon = (u) => (u === 'besser' ? (a.value?.hinweise?.includes('ohneKante') ? 'warn' : 'gut')
    : u === 'keinVorteil' ? 'schlecht' : u === 'zuWenig' ? 'neutral' : 'warn')

// Grün nur, wenn gesichert besser — ein Wert knapp über dem Zufall ist keiner.
const gesichert = (x) => x.p !== null && x.p < 0.05 / (a.value?.einstieg?.horizonte?.length || 1) && x.strategie > x.zufall
const einstiegTon = (u) => (u === 'schlaegtZufall' ? 'gut' : u === 'wieZufall' ? 'schlecht' : 'neutral')
const prozent = (v) => (v === null || v === undefined ? '–' : Math.round(Number(v) * 100))
/** Überanpassung: unter einem Viertel gering, bis zur Hälfte mittel, darüber hoch. */
const ueberStufe = (pbo) => (pbo < 0.25 ? 'gering' : pbo < 0.5 ? 'mittel' : 'hoch')
const ueberTon = (pbo) => ({ gering: 'gut', mittel: 'warn', hoch: 'schlecht' })[ueberStufe(pbo)]

/** Vergleichszeilen: eigene Ausstiege, gewählte Zone, beste Einzelzelle. */
const zeilen = computed(() => {
    if (!a.value) return []
    const raus = [{ name: t('strategien.ausstiege.zeileEigene'), auswahl: a.value.original.auswahl, pruefung: a.value.original.pruefung }]
    if (a.value.gewaehlt) {
        raus.push({
            name: t('strategien.ausstiege.zeileZone'), zelle: zelleText(a.value.gewaehlt),
            auswahl: a.value.gewaehlt.auswahl, pruefung: a.value.gewaehlt.pruefung, vergleich: a.value.gewaehlt.vergleich, zone: true,
        })
    }
    const e = a.value.besteZelle
    const g = a.value.gewaehlt
    if (e && !(g && e.s === g.s && e.z === g.z && e.h === g.h)) {
        raus.push({
            name: t('strategien.ausstiege.zeileSpitze'), zelle: zelleText(e),
            auswahl: e.auswahl, pruefung: e.pruefung, vergleich: e.vergleich,
        })
    }
    return raus
})
</script>

<template>
    <div class="journalKarte karte">
        <div class="section-title abstandUnten1">
            <Symbol name="waage" class="vorSymbol" />{{ t('strategien.ausstiege.titel') }}
        </div>
        <p class="fein at-gedaempft">{{ t('strategien.ausstiege.erklaerung') }}</p>

        <div class="knopfZeile abstandUnten">
            <Knopf klein :disabled="laeuft || !form.strategyId" @click="starten">
                <Kreisel v-if="laeuft" still />
                {{ t('strategien.ausstiege.starten') }}
            </Knopf>
            <span v-if="laeuft" class="fein at-gedaempft">{{ t('strategien.ausstiege.laeuft') }}</span>
        </div>

        <Hinweis v-if="fehler" art="fehler" class="abstandUnten">{{ fehler }}</Hinweis>
        <QuelleAus v-if="aus" :aus="aus" class="abstandUnten" />

        <div v-if="antwort && !a" class="kasten">
            {{ antwort.lauf?.hinweis || t('strategien.ausstiege.keineTrades') }}
        </div>

        <template v-if="a">
            <!-- Erst das Urteil auf den ungesehenen Trades, dann die Karte. -->
            <div class="zeileMitSymbol">
                <Pille :ton="urteilTon(a.urteil)">{{ t('strategien.ausstiege.pille_' + a.urteil) }}</Pille>
                <span class="fein">
                    {{ t('strategien.ausstiege.urteil_' + a.urteil, {
                        n: a.trades.gespielt,
                        p: pWert(a.gewaehlt?.vergleich?.p),
                        diff: zahl(a.gewaehlt?.vergleich?.mittelDiff),
                    }) }}
                </span>
            </div>
            <Hinweis v-if="a.hinweise.includes('ohneKante')" art="warn" class="abstandUnten">
                {{ t('strategien.ausstiege.hinweis_ohneKante', { r: zahl(a.gewaehlt?.pruefung?.mittel) }) }}
            </Hinweis>
            <ul v-if="a.hinweise.some((h) => h !== 'ohneKante')" class="punkte fein at-gedaempft abstandUnten">
                <li v-for="h in a.hinweise.filter((x) => x !== 'ohneKante')" :key="h">
                    {{ t('strategien.ausstiege.hinweis_' + h, { zelle: zelleText(a.besteZelle) }) }}
                </li>
            </ul>

            <div class="at-tabelle-huelle abstandUnten">
                <table class="at-tabelle dicht">
                    <thead><tr>
                        <th></th>
                        <th class="zahl">{{ t('strategien.ausstiege.spalteAuswahl') }}</th>
                        <th class="zahl">{{ t('strategien.ausstiege.spaltePruefung') }}</th>
                        <th class="zahl">{{ t('strategien.ausstiege.spalteTreffer') }}</th>
                        <th class="zahl">{{ t('strategien.ausstiege.spalteSumme') }}</th>
                        <th class="zahl">{{ t('strategien.ausstiege.spalteRueckgang') }}</th>
                        <th class="zahl" :title="t('strategien.ausstiege.vergleichTitel')">
                            {{ t('strategien.ausstiege.spalteVergleich') }}
                        </th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="z in zeilen" :key="z.name" :class="{ zoneZeile: z.zone }">
                            <td>
                                <strong>{{ z.name }}</strong>
                                <div v-if="z.zelle" class="fein at-gedaempft">{{ z.zelle }}</div>
                            </td>
                            <td class="zahl" :class="z.auswahl.mittel >= 0 ? 'gewinnWert' : 'verlustWert'">{{ zahl(z.auswahl.mittel) }}</td>
                            <td class="zahl" :class="z.pruefung.mittel >= 0 ? 'gewinnWert' : 'verlustWert'">
                                <strong>{{ zahl(z.pruefung.mittel) }}</strong>
                            </td>
                            <td class="zahl">{{ zahl(z.pruefung.treffer, 0) }} %</td>
                            <td class="zahl">{{ zahl(z.pruefung.summe, 1) }}</td>
                            <td class="zahl">{{ zahl(z.pruefung.dd, 1) }}</td>
                            <td class="zahl">
                                <template v-if="z.vergleich">
                                    <span class="gewinnWert">{{ z.vergleich.besser }}</span> /
                                    <span class="verlustWert">{{ z.vergleich.schlechter }}</span>
                                </template>
                                <template v-else>–</template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p v-if="a.gewaehlt" class="fein at-gedaempft abstandUnten3">
                <Symbol name="info" class="vorSymbol" />
                {{ a.gewaehlt.zweifel
                    ? t('strategien.ausstiege.zweifel', { k: a.gewaehlt.zweifel, n: a.trades.gespielt })
                    : t('strategien.ausstiege.zweifelKeine') }}
            </p>

            <!-- Gegenprobe 1: der Einstieg allein, gegen Zufallseinstiege -->
            <div class="unterTitel">{{ t('strategien.ausstiege.einstiegTitel') }}</div>
            <div class="zeileMitSymbol">
                <Pille :ton="einstiegTon(a.einstieg.urteil)">{{ t('strategien.ausstiege.einstieg_' + a.einstieg.urteil) }}</Pille>
                <span class="fein">{{ t('strategien.ausstiege.einstiegText_' + a.einstieg.urteil) }}</span>
            </div>
            <div v-if="a.einstieg.horizonte?.length" class="at-tabelle-huelle">
                <table class="at-tabelle dicht">
                    <thead><tr>
                        <th></th>
                        <th v-for="x in a.einstieg.horizonte" :key="x.h" class="zahl">
                            {{ t('strategien.ausstiege.nachKerzen', { n: x.h }) }}
                        </th>
                    </tr></thead>
                    <tbody>
                        <tr>
                            <td>{{ t('strategien.ausstiege.zeileStrategie') }}</td>
                            <td v-for="x in a.einstieg.horizonte" :key="x.h" class="zahl"
                                :class="{ gewinnWert: gesichert(x) }">
                                <strong>{{ zahl(x.strategie) }}</strong>
                            </td>
                        </tr>
                        <tr>
                            <td>{{ t('strategien.ausstiege.zeileZufall') }}</td>
                            <td v-for="x in a.einstieg.horizonte" :key="x.h" class="zahl">{{ zahl(x.zufall) }}</td>
                        </tr>
                        <tr>
                            <td>{{ t('strategien.ausstiege.zeileMfeMae') }}</td>
                            <td v-for="x in a.einstieg.horizonte" :key="x.h" class="zahl">{{ zahl(x.mfe) }} / {{ zahl(x.mae) }}</td>
                        </tr>
                        <tr>
                            <td>{{ t('strategien.ausstiege.zeileP') }}</td>
                            <td v-for="x in a.einstieg.horizonte" :key="x.h" class="zahl">{{ pWert(x.p) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="fussnote abstandUnten3">
                {{ t('strategien.ausstiege.einstiegErklaerung', { n: a.einstieg.zufallseinstiege || 0 }) }}
            </p>

            <!-- Gegenprobe 2: wie viel der Zonenwahl ist Glück der Aufteilung? -->
            <div class="unterTitel">{{ t('strategien.ausstiege.ueberTitel') }}</div>
            <div v-if="a.ueberanpassung" class="zeileMitSymbol abstandUnten3">
                <Pille :ton="ueberTon(a.ueberanpassung.pbo)">
                    {{ t('strategien.ausstiege.ueber_' + ueberStufe(a.ueberanpassung.pbo)) }}
                </Pille>
                <span class="fein">
                    {{ t('strategien.ausstiege.ueberText', {
                        bloecke: a.ueberanpassung.bloecke, m: a.ueberanpassung.aufteilungen,
                        pbo: prozent(a.ueberanpassung.pbo), verlust: prozent(a.ueberanpassung.verlust),
                        innen: zahl(a.ueberanpassung.innen), aussen: zahl(a.ueberanpassung.aussen),
                    }) }}
                </span>
            </div>
            <p v-else class="fein at-gedaempft abstandUnten3">{{ t('strategien.ausstiege.ueberFehlt', { n: a.ueberanpassungAb }) }}</p>

            <!-- Karte: Stop × Ziel bei einer Haltedauer -->
            <div class="unterTitel">{{ t('strategien.ausstiege.karteTitel') }}</div>
            <div class="kartenKopf">
                <div class="knopfZeile">
                    <span class="fein at-gedaempft">{{ t('strategien.ausstiege.haltenTitel') }}</span>
                    <button v-for="(h, i) in raster.halten" :key="h" type="button" class="ctl-pill"
                        :class="{ active: i === haltIdx }" @click="haltWahl = i">{{ h }}</button>
                </div>
                <div class="knopfZeile">
                    <button v-for="tl in ['alle', 'auswahl', 'pruefung']" :key="tl" type="button" class="ctl-pill"
                        :class="{ active: teil === tl }" @click="teil = tl">{{ t('strategien.ausstiege.teil_' + tl) }}</button>
                </div>
            </div>
            <div class="at-tabelle-huelle">
                <table class="at-tabelle dicht karteTabelle">
                    <thead><tr>
                        <th class="ecke">{{ t('strategien.ausstiege.achsen') }}</th>
                        <th v-for="(_, z) in raster.ziele" :key="z" class="zahl">{{ zielText(z) }}</th>
                    </tr></thead>
                    <tbody>
                        <tr v-for="(reihe, s) in karte" :key="s">
                            <th class="zeilenKopf">{{ stopText(s) }}</th>
                            <td v-for="c in reihe" :key="c.z" class="zahl zelle" :class="{ zone: istZone(c.s, c.z) }"
                                :style="zellStil(c.wert)">{{ zahl(c.wert) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="fussnote">
                {{ t('strategien.ausstiege.fuss', {
                    n: a.trades.gespielt, auswahl: a.trades.auswahl, pruefung: a.trades.pruefung, ab: datum(a.pruefAb),
                }) }}
                <template v-if="a.trades.ausgelassen">
                    {{ t('strategien.ausstiege.ausgelassen', { n: a.trades.ausgelassen }) }}
                </template>
            </p>
        </template>
    </div>
</template>

<style scoped>
/* `.journalKarte` setzt global `height: 100%` — hier gestapelt, also auto. */
.journalKarte {
    height: auto;
}

.karte {
    padding: var(--abstand-4);
    margin-bottom: var(--abstand-4);
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

.zeileMitSymbol,
.knopfZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}

.zeileMitSymbol {
    margin-bottom: var(--abstand-2);
}

.kasten {
    padding: var(--abstand-2) var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    font-size: 0.85rem;
}

.punkte {
    margin: 0 0 var(--abstand-2);
    padding-left: var(--abstand-4);
}

.unterTitel {
    font-size: 0.8rem;
    font-weight: 600;
    margin-top: var(--abstand-3);
    margin-bottom: var(--abstand-1);
}

.zoneZeile td {
    background: var(--panel-soft);
}

.kartenKopf {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.karteTabelle .ecke,
.karteTabelle .zeilenKopf {
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
}

.karteTabelle .zelle {
    font-variant-numeric: tabular-nums;
    min-width: 3.4rem;
}

/* Die gewählte Zone: Rahmen statt Farbe — die Farbe sagt schon den Wert. */
.karteTabelle .zelle.zone {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    font-weight: 700;
}

.fussnote {
    margin-top: var(--abstand-2);
    font-size: 0.78rem;
    color: var(--muted);
}

@media (max-width: 767.98px) {
    .karte {
        padding: var(--abstand-3);
    }
}
</style>
