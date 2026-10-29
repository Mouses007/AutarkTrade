<template>
    <div class="kiUeb">
        <div v-if="laedt" class="at-flex at-mitte at-luecke-2 at-gedaempft at-klein at-py-3">
            <Kreisel />{{ t('kiUebersicht.laedt') }}
        </div>
        <Hinweis v-else-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <template v-else>
            <!-- ── Kennzahlen ─────────────────────────────────────────── -->
            <div class="kuGrid at-mu-4">
                <div class="kuZelle">
                    <div class="kuWert">{{ geld(daten.verbrauch.heute.kostenUsd) }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.heute') }}</div>
                    <div class="kuExtra">{{ t('kiUebersicht.laeufe', { n: daten.verbrauch.heute.laeufe }) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert">{{ geld(daten.verbrauch.monat.kostenUsd) }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.monat') }}</div>
                    <div class="kuExtra">{{ t('kiUebersicht.laeufe', { n: daten.verbrauch.monat.laeufe }) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert">{{ (daten.verbrauch.dreissigTage.totalTokens || 0).toLocaleString() }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.tokens30') }}</div>
                    <div class="kuExtra">{{ geld(daten.verbrauch.dreissigTage.kostenUsd) }}</div>
                </div>
                <div class="kuZelle">
                    <div class="kuWert" :class="{ 'kuAktiv': laeuftWas }">{{ aktiveAutomatiken }}</div>
                    <div class="kuLabel">{{ t('kiUebersicht.aktiveAutomatiken') }}</div>
                    <div class="kuExtra">
                        <span v-if="laeuftWas" class="kuPunkt"></span>
                        {{ laeuftWas ? t('kiUebersicht.laeuftGerade') : t('kiUebersicht.ruhe') }}
                    </div>
                </div>
            </div>

            <!-- ── Verlauf ────────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.verlaufTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.verlaufHinweis') }}</p>
            <div v-if="hatVerlauf" ref="verlaufEl" class="kuVerlauf"></div>
            <!-- Eigene Legende: die des Diagramms schnitt den letzten Eintrag ab
                 und zeigte die Buchungsschlüssel statt Namen. -->
            <ul v-if="hatVerlauf && legende.length" class="kuLegende">
                <li v-for="l in legende" :key="l.schluessel">
                    <span class="kuFarbe" :style="{ background: l.farbe }"></span>{{ l.name }}
                </li>
            </ul>
            <p v-else class="at-gedaempft at-klein at-mu-4">{{ t('kiUebersicht.keinVerbrauch') }}</p>

            <!-- ── Funktionen ─────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.funktionenTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.funktionenHinweis') }}</p>
            <div class="at-tabelle-huelle at-mu-4">
                <table class="at-tabelle dicht kuTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('kiUebersicht.spalteFunktion') }}</th>
                            <th>{{ t('kiUebersicht.spalteModell') }}</th>
                            <th class="zahl">{{ t('kiUebersicht.spalte30') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="f in daten.funktionen" :key="f.id">
                            <td>{{ t(f.titelKey) }}</td>
                            <td>
                                <!-- Die Sammelzeile hat kein Modell, sondern die Schlüssel,
                                     unter denen gebucht wurde — sonst stünde dort nur „—". -->
                                <span v-if="f.schluessel" class="kuModell">{{ f.schluessel.map(funktionsName).join(', ') }}</span>
                                <template v-else>
                                    <span class="kuModell">{{ anbieterAnzeige(f.provider, t) || '—' }}<template v-if="f.modell">/{{ f.modell }}</template></span>
                                    <Pille v-if="f.folgtGlobal" ton="neutral" class="at-ml-2 kuBadge">
                                        {{ t('kiUebersicht.folgtGlobal') }}
                                    </Pille>
                                </template>
                            </td>
                            <td class="zahl">
                                <template v-if="f.verbrauch30.laeufe">
                                    {{ geld(f.verbrauch30.kostenUsd) }}
                                    <span class="kuExtra at-block">{{ t('kiUebersicht.laeufe', { n: f.verbrauch30.laeufe }) }}</span>
                                </template>
                                <span v-else class="at-gedaempft">—</span>
                            </td>
                            <td class="at-rechtsbuendig">
                                <a v-if="f.bereich" href="#" class="kuLink" @click.prevent="$emit('gehe-zu', f.bereich, f.abschnitt)">
                                    {{ t('kiUebersicht.einstellen') }}
                                </a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- ── Automatiken ────────────────────────────────────────── -->
            <h6 class="kuTitel">{{ t('kiUebersicht.automatikenTitel') }}</h6>
            <p class="kuHinweis">{{ t('kiUebersicht.automatikenHinweis') }}</p>
            <div class="at-tabelle-huelle">
                <table class="at-tabelle dicht kuTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('kiUebersicht.spalteAutomatik') }}</th>
                            <th>{{ t('kiUebersicht.spalteTakt') }}</th>
                            <th>{{ t('kiUebersicht.spalteLetzter') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="a in daten.automatiken" :key="a.id" :class="{ kuAus: !a.an }">
                            <td>
                                {{ t(a.titelKey) }}
                                <Pille v-if="a.kostet" ton="warn" class="at-ml-2 kuBadge">
                                    {{ t('kiUebersicht.kostet') }}
                                </Pille>
                                <Pille v-if="!a.an" ton="neutral" class="at-ml-2 kuBadge">
                                    {{ t('kiUebersicht.aus') }}
                                </Pille>
                            </td>
                            <!-- Wo ein Zeitplan steht, ersetzt er den Takt: „täglich"
                                 und „täglich ab 12 Uhr" untereinander sagt zweimal
                                 dasselbe, einmal davon unvollständig. -->
                            <td>{{ a.zeitplan ? zeitplanText(a.zeitplan) : t(a.taktKey) }}</td>
                            <td>
                                <span v-if="a.letzterLauf">{{ zeitpunkt(a.letzterLauf) }}</span>
                                <span v-else class="at-gedaempft">{{ t('kiUebersicht.nochNie') }}</span>
                                <span v-if="a.fehler" class="kuFehler at-block" :title="a.fehler">
                                    <Symbol name="warnung" /> {{ fehlerText(a.fehler) }}
                                </span>
                            </td>
                            <td class="at-rechtsbuendig">
                                <a v-if="a.bereich" href="#" class="kuLink" @click.prevent="$emit('gehe-zu', a.bereich, a.abschnitt)">
                                    {{ t('kiUebersicht.einstellen') }}
                                </a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script setup>
/**
 * KI-Übersicht — was läuft, wo, wann, und was kostet es.
 *
 * Die Seite zeigt nur an. Jede Einstellung bleibt in ihrem Reiter; von hier
 * führt je Zeile ein Verweis dorthin. Ein zweiter Ort zum Ändern wäre ein
 * zweiter Ort, an dem etwas veraltet.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import * as echarts from 'echarts'
import { useKostenAnzeige } from '../../utils/journal/format.js'
import { logWarn } from '../../utils/logger.js'
import { ladeKiAnbieter, anbieterAnzeige } from '../../utils/kiAnbieter.js'
import Kreisel from '../basis/Kreisel.vue'
import Hinweis from '../basis/Hinweis.vue'
import Pille from '../basis/Pille.vue'
import Symbol from '../basis/Symbol.vue'

const { t, te, locale } = useI18n()
defineEmits(['gehe-zu'])

const laedt = ref(true)
const fehler = ref('')
const daten = ref(null)
const verlaufEl = ref(null)
let diagramm = null

const geld = (usd) => useKostenAnzeige(usd) || '—'

const aktiveAutomatiken = computed(() =>
    (daten.value?.automatiken || []).filter((a) => a.an && a.kostet).length)

const laeuftWas = computed(() =>
    Boolean(daten.value?.laeuft?.agent) || Number(daten.value?.laeuft?.engine?.aktiveLaeufe) > 0)

const hatVerlauf = computed(() => (daten.value?.verbrauch?.verlauf || []).length > 0)
const legende = ref([])

/** Buchungsschlüssel (`ai_usage.funktion`) → Name; unbekannt bleibt der Schlüssel. */
function funktionsName(schluessel) {
    const k = 'kiUebersicht.schluessel.' + String(schluessel).replace(/-/g, '_')
    return te(k) ? t(k) : schluessel
}

/*
 * Fehlertexte der Automatiken kommen roh vom Server — ein Abbruch wegen
 * Zeitüberschreitung stand als „This operation was aborted" da.
 */
function fehlerText(f) {
    const s = String(f || '')
    if (/aborted|AbortError|timed? ?out|timeout|ETIMEDOUT/i.test(s)) return t('kiUebersicht.fehlerAbbruch')
    return s.slice(0, 60)
}

function zeitpunkt(ms) {
    if (!ms) return ''
    return new Date(Number(ms)).toLocaleString(locale.value === 'en' ? 'en-GB' : 'de-CH', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
}

function zeitplanText(z) {
    const stunde = String(z.stunde).padStart(2, '0')
    // „nur manuell": ein Uhrzeittext wäre hier schlicht falsch — es läuft nichts.
    if (z.rhythmus === 'manuell') return t('kiUebersicht.zeitplanManuell')
    if (z.rhythmus === 'woechentlich') {
        const tage = t('kiUebersicht.wochentage').split(',')
        return t('kiUebersicht.zeitplanWoche', { tag: tage[(z.wochentag - 1) % 7] || '', stunde })
    }
    return t('kiUebersicht.zeitplanTag', { stunde })
}

async function laden() {
    laedt.value = true
    fehler.value = ''
    try {
        const res = await axios.get('/api/ai/uebersicht')
        daten.value = res.data
        // `laedt` MUSS vor dem nextTick fallen — erst das schaltet die
        // Vorlage vom Spinner auf den `v-else`-Zweig um, der `verlaufEl`
        // überhaupt erst bindet. Stand das hier noch im `finally`, lief
        // `zeichne()` gegen ein `verlaufEl`, das noch gar nicht existierte,
        // und niemand rief es danach ein zweites Mal auf — leerer Container,
        // ohne Fehler.
        laedt.value = false
        await nextTick()
        zeichne()
    } catch (e) {
        logWarn('ki-uebersicht', 'Übersicht konnte nicht geladen werden', e)
        fehler.value = t('kiUebersicht.fehler')
        laedt.value = false
    }
}

/**
 * Kosten je Tag, gestapelt nach Funktion.
 *
 * Gestapelt und nicht als Linien: die Frage ist „wofür ging das Geld", und
 * dafür muss man die Anteile eines Tages nebeneinander sehen, nicht zehn
 * Kurven übereinander.
 */
function zeichne() {
    if (!verlaufEl.value || !hatVerlauf.value) return
    const verlauf = daten.value.verbrauch.verlauf
    const faktor = daten.value.waehrung?.faktor || 1
    const code = daten.value.waehrung?.faktor ? daten.value.waehrung.code : 'USD'

    const funktionen = [...new Set(verlauf.flatMap((v) => Object.keys(v.jeFunktion)))]
    const serien = funktionen.map((f) => ({
        name: funktionsName(f),
        type: 'bar',
        stack: 'gesamt',
        emphasis: { focus: 'series' },
        data: verlauf.map((v) => Number(((v.jeFunktion[f] || 0) * faktor).toFixed(4))),
    }))

    diagramm?.dispose()
    diagramm = echarts.init(verlaufEl.value)
    diagramm.setOption({
        grid: { left: 50, right: 12, top: 12, bottom: 30 },
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'shadow' },
            valueFormatter: (v) => `${Number(v).toFixed(2)} ${code}`,
        },
        legend: { show: false },
        xAxis: {
            type: 'category',
            data: verlauf.map((v) => v.tag.slice(5)),
            axisLabel: { color: '#9aa0a6', fontSize: 10 },
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: '#9aa0a6', fontSize: 10, formatter: (v) => `${v} ${code}` },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,.06)' } },
        },
        series: serien,
    })
    const farben = diagramm.getOption().color || []
    legende.value = funktionen.map((f, i) => ({ schluessel: f, name: funktionsName(f), farbe: farben[i % farben.length] }))
}

const beiGroesse = () => diagramm?.resize()

onMounted(() => {
    ladeKiAnbieter()   // neutrale Anbieternamen (S12)
    laden()
    window.addEventListener('resize', beiGroesse)
})
onBeforeUnmount(() => {
    window.removeEventListener('resize', beiGroesse)
    diagramm?.dispose()
})

// Sprachwechsel: die Achsen tragen übersetzte Einheiten
watch(locale, () => zeichne())

defineExpose({ laden })
</script>

<style scoped>
.kuTitel {
    font-size: .95rem;
    font-weight: 600;
    margin-bottom: .15rem;
}

.kuHinweis {
    font-size: .78rem;
    color: var(--muted);
    margin-bottom: .6rem;
}

.kuGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: .75rem;
}

.kuZelle {
    background: var(--panel-soft);
    border-radius: var(--radius-knopf);
    padding: .7rem .85rem;
}

.kuWert {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.2;
}

.kuWert.kuAktiv {
    color: var(--accent);
}

.kuLabel {
    font-size: .78rem;
    color: var(--muted);
}

.kuExtra {
    font-size: .72rem;
    color: var(--muted);
}

.kuPunkt {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    margin-right: 4px;
    animation: kuPuls 1.6s ease-in-out infinite;
}

@keyframes kuPuls {
    0%, 100% { opacity: 1 }
    50% { opacity: .25 }
}

/* Bewegung abschalten, wo der Nutzer das wünscht — der Punkt bleibt sichtbar,
   er hört nur auf zu blinken. */
@media (prefers-reduced-motion: reduce) {
    .kuPunkt { animation: none }
}

.kuVerlauf {
    width: 100%;
    height: 220px;
}

.kuLegende {
    display: flex;
    flex-wrap: wrap;
    gap: .25rem .9rem;
    margin: .4rem 0 1.25rem;
    padding: 0;
    list-style: none;
    font-size: .72rem;
    color: var(--muted);
}

.kuLegende li {
    display: inline-flex;
    align-items: center;
    gap: .3rem;
}

.kuFarbe {
    width: .6rem;
    height: .6rem;
    border-radius: 2px;
    flex: none;
}

.kuTabelle {
    font-size: .82rem;
}

.kuTabelle th {
    text-transform: none;
    letter-spacing: normal;
}

.kuModell {
    font-family: var(--schrift-mono);
    font-size: .78rem;
}

.kuBadge {
    font-size: .62rem;
    font-weight: 500;
    vertical-align: middle;
}

.kuAus {
    opacity: .55;
}

.kuFehler {
    font-size: .72rem;
    color: var(--bad);
}

.kuLink {
    color: var(--accent);
    font-size: .78rem;
    text-decoration: none;
    white-space: nowrap;
}
</style>
