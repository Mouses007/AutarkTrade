<script setup>
/**
 * Exkursionen (`/addExcursions`): für vergangene Handelstage ohne Exkursion
 * den MFE-Preis je Trade aus Minutenkerzen (Databento oder Polygon) bestimmen
 * und in `excursions` schreiben.
 *
 * Die Module in `utils/journal/import.js` haben bekannte Fallen, die hier —
 * und nur hier — abgefangen werden, weil der Journal-Kern unangetastet bleibt:
 *   - `useGetOHLCV` erfüllt nach dem ERSTEN Symbol, die übrigen laden danach
 *     in dieselbe Liste weiter → wir warten selbst, bis alle da sind, mit Frist.
 *   - `useGetMFEPrices` für ein Symbol ohne Kerzen erfüllt NIE → wir rufen es
 *     nur für geladene Symbole auf, und jeden Aufruf mit Frist.
 *   - Dessen Modulliste wird nie geleert, `useUpdateMfePrices` schreibt sie
 *     ganz → ein zweiter Lauf schriebe doppelte Exkursionen. Darum schreibt
 *     diese Ansicht nur die Einträge der Trades DIESES Laufs, je Trade einmal.
 * Ohne das drehte der Kreisel bei einem fehlenden Symbol für immer.
 *
 * Fachlich ist die Seite ein Überbleibsel aus dem Aktienkontext: Databento
 * kennt nur `future`/`stock`, Polygon die Krypto-Perps nicht in dieser Form.
 * Sie bleibt in Parität erhalten; meist endet sie jetzt in einer Meldung statt
 * in einem hängenden Kreisel.
 */
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import dayjs from '../utils/journal/zeit.js'
import Karte from '../components/basis/Karte.vue'
import Knopf from '../components/basis/Knopf.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import { seiteLaedt } from '../stores/app/laden.js'
import { daysBack, daysMargin } from '../stores/journal/filter.js'
import { imports } from '../stores/journal/auswertung.js'
import { excursions } from '../stores/journal/tagebuch.js'
import { apis } from '../stores/app/einstellungen.js'
import { ladeApis, usePageRedirect } from '../utils/journal/app.js'
import { ladeTrades } from '../utils/journal/laden.js'
import { ladeExkursionen } from '../utils/journal/tagebuch.js'
import { useGetOHLCV, useGetMFEPrices } from '../utils/journal/import.js'
import { useDateCalFormat } from '../utils/journal/format.js'
import { dbCreate } from '../utils/db.js'

const { t } = useI18n()
const router = useRouter()

/*
 * Fristen. Polygon wartet bei HTTP 429 bis zu fünfmal 60 s — darum ist die
 * Frist für ALLE Kerzen grosszügig; ein einzelner MFE-Aufruf rechnet nur und
 * braucht keine Sekunde.
 */
const FRIST_KERZEN_MS = 180000
const FRIST_MFE_MS = 10000
const TAKT_MS = 250

// Sinnvolle Vorgaben: ohne sie war die untere Zeitgrenze NaN und der
// Puffervergleich nie wahr — die Seite meldete nie einen fehlenden Tag.
if (!(Number(daysBack.value) > 0)) daysBack.value = 30
if (!(Number(daysMargin.value) >= 0) || daysMargin.value === '' || daysMargin.value == null) daysMargin.value = 1

seiteLaedt.value = false

const boersenIndex = ref(-1)
const apiQuelle = ref(null)
const fehlendeTage = ref([])      // dateUnix
const tradeListe = ref([])
const symbolListe = ref([])       // { symbol, secType }
const fruehester = ref(null)
const spaetester = ref(null)

const laeuft = ref(false)
const meldungen = ref([])         // { art, text }
const gespeichertAnzahl = ref(0)

const hatSchluessel = computed(() => boersenIndex.value >= 0)
const einstellungsLink = computed(() => `<a href="/settings/journal">${t('nav.settings')}</a>`)
const pufferWort = computed(() => (Number(daysMargin.value) > 1 ? t('excursions.dayBufferMehr') : t('excursions.dayBuffer')))
const fehlendeText = computed(() => fehlendeTage.value.map(d => useDateCalFormat(d)).join(', '))

function waehleApi() {
    const mitSchluessel = (anbieter) => apis.findIndex(a => a.provider === anbieter && a.key)
    const db = mitSchluessel('databento')
    const pg = mitSchluessel('polygon')
    if (db >= 0) { boersenIndex.value = db; apiQuelle.value = 'databento' }
    else if (pg >= 0) { boersenIndex.value = pg; apiQuelle.value = 'polygon' }
    else { boersenIndex.value = -1; apiQuelle.value = null }
}

/*
 * Jede Eingabe startet eine Prüfung; überholte Läufe dürfen die Anzeige nicht
 * mit veralteten Ergebnissen überschreiben.
 */
let pruefNr = 0
async function pruefeFehlendeTage() {
    const nr = ++pruefNr
    const zurueck = Number(daysBack.value)
    if (!(zurueck > 0)) return
    try {
        await Promise.all([ladeTrades(), ladeExkursionen()])
    } catch (e) {
        console.warn('Exkursionen: Tage nicht lesbar', e)
        return
    }
    if (nr !== pruefNr) return

    // Alles zurücksetzen — früher wuchsen Symbole und Zeitfenster über alle Prüfungen.
    const tage = []
    const liste = []
    const symbole = []
    let frueh = null
    let spaet = null
    const grenze = dayjs().subtract(Number(daysMargin.value) || 0, 'day').unix()
    const erledigt = new Set(excursions.map(x => Number(x.dateUnix)))

    for (const zeile of imports.value || []) {
        const du = Number(zeile.dateUnix)
        if (erledigt.has(du)) continue
        if (du >= grenze) continue   // im Puffer: Daten des Tages evtl. noch nicht vollständig
        tage.push(du)
        for (const tr of Array.isArray(zeile.trades) ? zeile.trades : []) {
            liste.push(tr)
            if (!symbole.some(s => s.symbol === tr.symbol)) symbole.push({ symbol: tr.symbol, secType: tr.type })
        }
        if (frueh === null || du < frueh) frueh = du
        if (spaet === null || du > spaet) spaet = du
    }

    fehlendeTage.value = tage
    tradeListe.value = liste
    symbolListe.value = symbole
    fruehester.value = frueh
    spaetester.value = spaet
}

async function start() {
    try {
        await ladeApis()
    } catch (e) {
        console.warn('Exkursionen: API-Liste nicht lesbar', e)
    }
    waehleApi()
    pruefeFehlendeTage()
}
start()

watch([daysBack, daysMargin], () => { pruefeFehlendeTage() })

/** Versprechen mit Frist: erfüllt mit `{ zeit: true }`, wenn es nicht rechtzeitig kommt. */
function mitFrist(versprechen, ms) {
    let uhr
    const frist = new Promise(r => { uhr = setTimeout(() => r({ zeit: true }), ms) })
    return Promise.race([Promise.resolve(versprechen).then(wert => ({ wert })), frist])
        .finally(() => clearTimeout(uhr))
}

const fehlt = (kerzen, symbol) => !kerzen.some(k => k.symbol == symbol)

/** Wartet, bis die Kerzenliste alle Symbole enthält oder die Frist abläuft. */
async function warteAufAlle(kerzen, symbole, bisMs) {
    while (Date.now() < bisMs && symbole.some(s => fehlt(kerzen, s.symbol))) {
        await new Promise(r => setTimeout(r, TAKT_MS))
    }
}

async function hinzufuegen() {
    seiteLaedt.value = true
    laeuft.value = true
    meldungen.value = []
    gespeichertAnzahl.value = 0
    let alleGut = true
    try {
        const bis = Date.now() + FRIST_KERZEN_MS
        const symbole = [...symbolListe.value]
        const antwort = await mitFrist(useGetOHLCV(apiQuelle.value, 'manual', symbole, fruehester.value, spaetester.value), FRIST_KERZEN_MS)
        if (antwort.zeit) {
            meldungen.value.push({ art: 'fehler', text: t('excursions.zeitueberschreitung', { sekunden: FRIST_KERZEN_MS / 1000 }) })
            return
        }
        const kerzen = Array.isArray(antwort.wert) ? antwort.wert : []
        await warteAufAlle(kerzen, symbole, bis)
        if (!kerzen.length) {
            meldungen.value.push({ art: 'fehler', text: t('excursions.keineKerzen') })
            return
        }
        const ohne = symbole.filter(s => fehlt(kerzen, s.symbol)).map(s => s.symbol)
        if (ohne.length) {
            alleGut = false
            meldungen.value.push({ art: 'warn', text: t('excursions.kerzenFehlen', { symbole: ohne.join(', ') }) })
        }

        const dieserLauf = new Set()
        let liste = []
        let ohneAntwort = 0
        for (const trade of tradeListe.value) {
            if (trade.openPosition != false) continue
            if (fehlt(kerzen, trade.symbol)) continue
            dieserLauf.add(trade.id)
            const r = await mitFrist(useGetMFEPrices(trade, trade.entryTime, trade.entryPrice, trade, kerzen), FRIST_MFE_MS)
            if (r.zeit) { ohneAntwort++; continue }
            if (Array.isArray(r.wert)) liste = r.wert
        }
        if (ohneAntwort) {
            alleGut = false
            meldungen.value.push({ art: 'warn', text: t('excursions.tradesOhneAntwort', { anzahl: ohneAntwort }) })
        }

        // Nur Einträge dieses Laufs, je Trade einmal (der letzte gilt).
        const jeTrade = new Map()
        for (const e of liste) if (dieserLauf.has(e.tradeId)) jeTrade.set(e.tradeId, e)
        for (const e of jeTrade.values()) {
            await dbCreate('excursions', { mfePrice: e.mfePrice, dateUnix: e.dateUnix, tradeId: e.tradeId })
            gespeichertAnzahl.value++
        }

        if (!gespeichertAnzahl.value) {
            alleGut = false
            meldungen.value.push({ art: 'warn', text: t('excursions.nichtsBestimmt') })
        } else if (!alleGut) {
            meldungen.value.push({ art: 'gut', text: t('excursions.gespeichert', { anzahl: gespeichertAnzahl.value }) })
        }
    } catch (e) {
        alleGut = false
        meldungen.value.push({ art: 'fehler', text: t('excursions.fehler') + ' ' + (e?.message || String(e)) })
    } finally {
        seiteLaedt.value = false
        laeuft.value = false
    }

    if (alleGut && meldungen.value.length === 0) {
        usePageRedirect('daily')
        return
    }
    // Gespeicherte Tage fallen aus der Liste; was übrig bleibt, steht wieder da.
    pruefeFehlendeTage()
}

function abbrechen() {
    router.push('/dashboard')
}
</script>

<template>
    <div class="exkursionen-seite">
        <div v-if="spinnerLoadingPage" class="laden">
            <Kreisel :groesse="28" />
            <span v-if="laeuft" class="leise">{{ t('excursions.laeuft') }}</span>
        </div>

        <Karte v-else>
            <p v-if="!hatSchluessel" class="satz" v-html="t('excursions.configureApiKey', { link: einstellungsLink })"></p>

            <template v-else>
                <p class="satz">
                    {{ t('excursions.forLastDays') }}
                    <input v-model="daysBack" class="at-feld zahl-feld" type="number" min="1" step="1" inputmode="numeric"
                        :aria-label="t('excursions.feldTage')" />
                    {{ t('excursions.daysWithBuffer') }}
                    <input v-model="daysMargin" class="at-feld zahl-feld" type="number" min="0" step="1" inputmode="numeric"
                        :aria-label="t('excursions.feldPuffer')" />
                    {{ pufferWort }} {{ t('excursions.buffer') }}
                    <template v-if="fehlendeTage.length">
                        {{ t('excursions.missingMfeDates') }} <span class="daten">{{ fehlendeText }}</span>
                    </template>
                    <template v-else>{{ t('excursions.allUpToDate') }}</template>
                </p>
            </template>

            <Hinweis v-for="(m, i) in meldungen" :key="i" :art="m.art" class="at-mo-3">{{ m.text }}</Hinweis>

            <div class="aktionen">
                <Knopf v-if="hatSchluessel && fehlendeTage.length" art="haupt" symbol="plus" @click="hinzufuegen">
                    {{ t('excursions.add') }}
                </Knopf>
                <Knopf v-if="gespeichertAnzahl > 0" art="normal" @click="usePageRedirect('daily')">
                    {{ t('excursions.zurTagesansicht') }}
                </Knopf>
                <Knopf art="leise" klein @click="abbrechen">{{ t('common.cancel') }}</Knopf>
            </div>
        </Karte>
    </div>
</template>

<style scoped>
.exkursionen-seite {
    max-width: 50rem;
    min-width: 0;
}

.laden {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--abstand-3);
    padding: var(--abstand-6) 0;
}

.leise {
    color: var(--muted);
}

.satz {
    margin: 0;
    line-height: 2.2;
    color: var(--text);
}

.satz :deep(a) {
    color: var(--accent);
}

.zahl-feld {
    display: inline-block;
    width: 5rem;
    margin: 0 var(--abstand-1);
    vertical-align: middle;
}

.daten {
    overflow-wrap: anywhere;
}

.aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-3);
    margin-top: var(--abstand-5);
}
</style>
