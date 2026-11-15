<script setup>
/**
 * Einstellungen des Aktien-Radars: Zeitplan nach US-Börsenzeit, Hürden und
 * Gewichte der Note — je Block mit «Vorgabe wiederherstellen».
 *
 * Geprüft wird zweimal: hier, damit der Fehler am Feld steht, und auf dem
 * Server (`server/coin-radar/aktien-einstellungen.js`), der die Grenzen
 * mitliefert — sie stehen also nur an einer Stelle. Eine Vorgabe wird als
 * «keine Abweichung» gespeichert, nicht als Zahl: ändert sich die Vorgabe
 * später, gilt die neue.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import { pruefeZahl } from '../../utils/aktienRadarEingabe.js'

const emit = defineEmits(['gespeichert'])
const { t, locale } = useI18n()

const HUERDEN = ['minUmsatz24hUsd', 'maxSpreadBp', 'minTiefeUsd', 'minKerzen']
const GEWICHTE = ['staerke', 'hochNaehe', 'imSpiel', 'bewegung', 'trend']
const ABSTAENDE = ['nachEroeffnungMin', 'vorSchlussMin']

const laedt = ref(true)
const speichert = ref(false)
const fehler = ref('')
const gespeichert = ref(false)
const stand = ref(null)            // Antwort des Servers: Werte, Vorgaben, Grenzen, nächster Lauf
const huerden = ref({})            // Eingaben als Text — ein leeres Feld ist kein 0
const gewichte = ref({})
const zeitplan = ref({ an: false, nachEroeffnungMin: '', vorSchlussMin: '' })

const alsText = (objekt, felder) => Object.fromEntries(felder.map((f) => [f, objekt?.[f] == null ? '' : String(objekt[f])]))

function uebernimm(daten) {
    stand.value = daten
    huerden.value = alsText(daten.huerden, HUERDEN)
    gewichte.value = alsText(daten.gewichte, GEWICHTE)
    zeitplan.value = { an: daten.zeitplan?.an === true, ...alsText(daten.zeitplan, ABSTAENDE) }
}

async function lade() {
    fehler.value = ''
    try {
        uebernimm((await axios.get('/api/coin-radar/aktien-einstellungen')).data)
    } catch (e) {
        fehler.value = `${t('aktienAlltag.einst.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}
onMounted(lade)

/* ── Prüfung am Feld ── */
const grenzen = computed(() => stand.value?.grenzen || {})
const feldFehler = computed(() => {
    const aus = {}
    const melde = (schluessel, wert, g) => {
        const r = pruefeZahl(wert, g)
        if (r.fehler) aus[schluessel] = t('aktienAlltag.einst.fehler_' + r.fehler, { min: zahl(g?.min), max: zahl(g?.max) })
    }
    for (const f of HUERDEN) melde('h.' + f, huerden.value[f], grenzen.value.huerden?.[f])
    for (const f of GEWICHTE) melde('g.' + f, gewichte.value[f], grenzen.value.gewichte)
    for (const f of ABSTAENDE) melde('z.' + f, zeitplan.value[f], { ...grenzen.value.zeitplan, ganz: true })
    return aus
})
const gewichtSumme = computed(() => GEWICHTE.reduce((s, f) => s + (pruefeZahl(gewichte.value[f], grenzen.value.gewichte).wert ?? 0), 0))
const summeNull = computed(() => !GEWICHTE.some((f) => feldFehler.value['g.' + f]) && !(gewichtSumme.value > 0))
const ungueltig = computed(() => Object.keys(feldFehler.value).length > 0 || summeNull.value)

const zahlen = (eingaben, felder, g) => Object.fromEntries(felder.map((f) => [f, pruefeZahl(eingaben[f], g?.[f] ?? g).wert]))

async function speichere(koerper) {
    if (speichert.value) return
    speichert.value = true
    fehler.value = ''
    gespeichert.value = false
    try {
        await axios.put('/api/coin-radar/einstellungen', koerper)
        await lade()
        gespeichert.value = true
        emit('gespeichert')
    } catch (e) {
        const d = e?.response?.data
        fehler.value = d?.code
            ? t('aktienAlltag.einst.server_' + d.code) + (d.feld ? ` (${d.feld})` : '')
            : `${t('aktienAlltag.einst.speicherFehler')}: ${d?.error || e.message}`
    } finally {
        speichert.value = false
    }
}

function speichern() {
    if (ungueltig.value) return
    speichere({
        huerdenAktien: zahlen(huerden.value, HUERDEN, grenzen.value.huerden),
        gewichteAktien: zahlen(gewichte.value, GEWICHTE, grenzen.value.gewichte),
        aktienZeitplan: { an: zeitplan.value.an, ...zahlen(zeitplan.value, ABSTAENDE, { ...grenzen.value.zeitplan, ganz: true }) },
    })
}
/** Einen Block auf die Vorgabe zurücksetzen — `null` heisst für den Server «Vorgabe». */
const vorgabe = (block) => speichere({ [block]: null })

const weichtAb = (werte, vorgaben) => !!vorgaben && Object.keys(vorgaben).some((k) => werte?.[k] !== vorgaben[k])
const huerdenEigen = computed(() => weichtAb(stand.value?.huerden, stand.value?.vorgaben?.huerden))
const gewichteEigen = computed(() => weichtAb(stand.value?.gewichte, stand.value?.vorgaben?.gewichte))
const zeitplanEigen = computed(() => weichtAb(stand.value?.zeitplan, stand.value?.vorgaben?.zeitplan))

const zahl = (x) => (x == null ? '' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(x))
const zeit = (ms) => new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
const naechster = computed(() => {
    const n = stand.value?.naechster
    return n ? t('aktienAlltag.einst.naechster', { zeit: zeit(n.zeit), platz: t('aktienAlltag.einst.platz_' + n.platz) }) : ''
})
const letzte = computed(() => ['eroeffnung', 'schluss']
    .map((p) => ({ platz: p, ...(stand.value?.letzte?.[p] || {}) }))
    .filter((l) => l.zeit))
</script>

<template>
    <section class="einst" :aria-label="t('aktienAlltag.einst.titel')">
        <Kreisel v-if="laedt" />
        <template v-else-if="stand">
            <Hinweis v-if="!stand.modusAktienAn" art="warn">{{ t('aktienAlltag.einst.modusAus') }}</Hinweis>

            <!-- Zeitplan -->
            <fieldset class="block">
                <legend>{{ t('aktienAlltag.einst.zeitplan') }}</legend>
                <p class="leise">{{ t('aktienAlltag.einst.zeitplanText') }}</p>
                <label class="haken">
                    <input v-model="zeitplan.an" type="checkbox" />
                    {{ t('aktienAlltag.einst.zeitplanAn') }}
                </label>
                <div class="felder">
                    <label v-for="f in ABSTAENDE" :key="f" class="feld">
                        <span>{{ t('aktienAlltag.einst.' + f) }}</span>
                        <span class="mitEinheit">
                            <input v-model="zeitplan[f]" type="text" inputmode="numeric" :aria-invalid="!!feldFehler['z.' + f] || undefined" />
                            <span class="einheit">{{ t('aktienAlltag.einst.minuten') }}</span>
                        </span>
                        <span v-if="feldFehler['z.' + f]" class="fehler">{{ feldFehler['z.' + f] }}</span>
                    </label>
                </div>
                <p v-if="naechster" class="leise">{{ naechster }}</p>
                <p v-else-if="stand.zeitplan.an" class="leise">{{ t('aktienAlltag.einst.keinNaechster') }}</p>
                <p v-for="l in letzte" :key="l.platz" :class="['leise', { fehler: !!l.fehler }]">
                    {{ t('aktienAlltag.einst.letzter', { platz: t('aktienAlltag.einst.platz_' + l.platz), zeit: zeit(l.zeit) }) }}
                    <template v-if="l.fehler"> — {{ l.fehler }}</template>
                </p>
                <p class="leise">{{ t('aktienAlltag.einst.zeitplanGrenze') }}</p>
                <Knopf v-if="zeitplanEigen" klein art="leise" symbol="wiederholen" :disabled="speichert" @click="vorgabe('aktienZeitplan')">
                    {{ t('aktienAlltag.einst.vorgabe') }}
                </Knopf>
            </fieldset>

            <!-- Hürden -->
            <fieldset class="block">
                <legend>{{ t('aktienAlltag.einst.huerden') }}</legend>
                <p class="leise">{{ t('aktienAlltag.einst.huerdenText') }}</p>
                <div class="felder">
                    <label v-for="f in HUERDEN" :key="f" class="feld">
                        <span :title="t('aktienAlltag.einst.info_' + f)">{{ t('aktienAlltag.einst.' + f) }}</span>
                        <input v-model="huerden[f]" type="text" inputmode="decimal" :aria-invalid="!!feldFehler['h.' + f] || undefined" />
                        <span v-if="feldFehler['h.' + f]" class="fehler">{{ feldFehler['h.' + f] }}</span>
                        <span v-else class="leise">{{ t('aktienAlltag.einst.vorgabeWert', { wert: zahl(stand.vorgaben.huerden[f]) }) }}</span>
                    </label>
                </div>
                <Knopf v-if="huerdenEigen" klein art="leise" symbol="wiederholen" :disabled="speichert" @click="vorgabe('huerdenAktien')">
                    {{ t('aktienAlltag.einst.vorgabe') }}
                </Knopf>
            </fieldset>

            <!-- Gewichte -->
            <fieldset class="block">
                <legend>{{ t('aktienAlltag.einst.gewichte') }}</legend>
                <p class="leise">{{ t('aktienAlltag.einst.gewichteText') }}</p>
                <div class="felder">
                    <label v-for="f in GEWICHTE" :key="f" class="feld">
                        <span :title="t('aktienAlltag.einst.info_' + f)">{{ t('aktienAlltag.einst.' + f) }}</span>
                        <input v-model="gewichte[f]" type="text" inputmode="decimal" :aria-invalid="!!feldFehler['g.' + f] || undefined" />
                        <span v-if="feldFehler['g.' + f]" class="fehler">{{ feldFehler['g.' + f] }}</span>
                        <span v-else class="leise">{{ t('aktienAlltag.einst.vorgabeWert', { wert: zahl(stand.vorgaben.gewichte[f]) }) }}</span>
                    </label>
                </div>
                <p :class="['leise', { fehler: summeNull }]">
                    {{ summeNull ? t('aktienAlltag.einst.fehler_gewichteNull') : t('aktienAlltag.einst.summe', { summe: zahl(gewichtSumme) }) }}
                </p>
                <Knopf v-if="gewichteEigen" klein art="leise" symbol="wiederholen" :disabled="speichert" @click="vorgabe('gewichteAktien')">
                    {{ t('aktienAlltag.einst.vorgabe') }}
                </Knopf>
            </fieldset>

            <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
            <div class="fuss">
                <Knopf art="haupt" symbol="speichern" :laedt="speichert" :disabled="ungueltig" @click="speichern">{{ t('aktienAlltag.einst.speichern') }}</Knopf>
                <span v-if="gespeichert" class="leise" role="status">{{ t('aktienAlltag.einst.gespeichert') }}</span>
            </div>
        </template>
        <Hinweis v-else-if="fehler" art="fehler">{{ fehler }}</Hinweis>
    </section>
</template>

<style scoped>
.einst {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--line);
    border-radius: 10px;
}

.block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
}

.block legend {
    padding: 0;
    font-weight: 700;
    font-size: 0.95rem;
}

.felder {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.7rem 1rem;
    width: 100%;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.86rem;
    min-width: 0;
}

.feld > span[title] {
    cursor: help;
}

.feld input {
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-variant-numeric: tabular-nums;
}

.feld input[aria-invalid] {
    border-color: var(--warn);
}

.mitEinheit {
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.einheit,
.leise {
    margin: 0;
    color: var(--muted);
    font-size: 0.82rem;
}

.fehler {
    color: var(--warn);
    font-size: 0.82rem;
}

.haken {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    cursor: pointer;
}

.fuss {
    display: flex;
    align-items: center;
    gap: 0.8rem;
}
</style>
