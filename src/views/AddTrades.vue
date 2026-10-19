<script setup>
/**
 * Trades hinzufügen (`/addTrades`): ein einzelner Futures-Trade von Hand oder
 * ein API-Import über einen Zeitraum mit Vorschau vor dem Speichern.
 *
 * Rechnen tut diese Ansicht fast nichts selbst: Trade-Objekte kommen aus
 * `quickImport.js` (die EINZIGE Rechenvorschrift, gleich wie der Schnell-
 * import), Blotter/P&L und das Speichern aus `utils/journal/`. Hier leben nur
 * Eingabe, Prüfung und Ablauf.
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from '../utils/journal/zeit.js'
import Reiter from '../components/basis/Reiter.vue'
import Karte from '../components/basis/Karte.vue'
import Knopf from '../components/basis/Knopf.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import ImportVorschau from '../components/import/ImportVorschau.vue'
import { seiteLaedt } from '../stores/app/laden.js'
import { selectedBroker } from '../stores/journal/filter.js'
import { executions, vorhandeneImporte, vorhandeneTradeTage, tradeZeilen, trades, blotter, pAndL } from '../stores/journal/import.js'
import { refreshAccountBalance } from '../stores/accountBalance.js'
import { useGetExistingTradesArray, useUploadTrades } from '../utils/journal/import.js'
import { baueBlotter, bauePnL } from '../utils/journal/tagesrechnung.js'
import { ersetzeObjekt } from '../utils/journal/hilfen.js'
import { useDateCalFormat } from '../utils/journal/format.js'
import { useQuickApiImport, createBitunixTradeObj, createBitgetTradeObj, buildTradeObj, saveManualTrade } from '../utils/quickImport.js'
import { istGewinn } from '../../shared/gewinn.js'
import { sendNotification } from '../utils/notify.js'
import { useVerlassenSchutz } from '../composables/useVerlassenSchutz.js'

const { t } = useI18n()
const router = useRouter()

seiteLaedt.value = false

const BROKER_NAMEN = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const broker = computed(() => selectedBroker.value || 'bitunix')
const brokerName = computed(() => BROKER_NAMEN[broker.value] || 'Bitunix')

const reiter = ref('manuell')
const reiterListe = computed(() => [
    { id: 'manuell', titel: t('addTrades.manualTab') },
    { id: 'api', titel: t('addTrades.apiImport') },
])

onMounted(() => {
    // Nicht abwarten: bei einem DB-Fehler bleibt das Versprechen offen, und
    // nichts in dieser Ansicht braucht die Liste vor dem ersten API-Import.
    useGetExistingTradesArray()
})

// ── Manuelle Eingabe ───────────────────────────────────────────────────────

const heute = () => dayjs().format('YYYY-MM-DD')

const form = reactive({
    symbol: '',
    side: 'B',
    date: heute(),
    entryDate: '',
    entryPrice: '',
    exitPrice: '',
    qty: '',
    netPL: '',
    fee: '',
    leverage: '',
})
const speichert = ref(false)
const meldung = ref('')
const meldungGut = ref(false)

const seitenOptionen = computed(() => [
    { wert: 'B', text: t('addTrades.manualLong') },
    { wert: 'SS', text: t('addTrades.manualShort') },
])

/*
 * Ungespeichert sind nur die Zahlenfelder. Symbol, Seite und Daten bleiben
 * nach dem Speichern bewusst stehen (schnelle Mehrfacheingabe) — zählten sie,
 * fragte die Seite nach jedem erfolgreichen Speichern beim Verlassen nach.
 */
const ZAHLENFELDER = ['entryPrice', 'exitPrice', 'qty', 'netPL', 'fee', 'leverage']
const ungespeichert = computed(() => ZAHLENFELDER.some(f => String(form[f] ?? '').trim() !== ''))
useVerlassenSchutz(ungespeichert, () => t('common.unsavedLeave'))

/**
 * Zahl aus einem Textfeld. Textfeld statt Zahlenfeld, weil ein Zahlenfeld bei
 * „12,50" je nach Browser '' liefert — die Gebühr wäre still „leer". Darum
 * hier selbst: das erste Komma wird zum Punkt, leer heisst „nicht angegeben"
 * (null), NIE null Franken.
 */
function leseZahl(wert, feldKey, fehler) {
    const s = String(wert ?? '').trim()
    if (s === '') return null
    const z = Number(s.replace(',', '.'))
    if (!Number.isFinite(z)) {
        fehler.push(t('addTrades.manualNotANumber', { feld: t(feldKey) }))
        return null
    }
    return z
}

/** Datum JJJJ-MM-TT als UTC-Tagesbeginn, oder null wenn ungültig. */
function utcTag(text) {
    const d = dayjs.utc(String(text || ''), 'YYYY-MM-DD', true)
    return d.isValid() ? d.startOf('day') : null
}

async function speichereManuell() {
    meldung.value = ''
    meldungGut.value = false
    const symbol = String(form.symbol || '').trim().toUpperCase()
    if (!symbol) {
        meldung.value = t('addTrades.manualSymbolMissing')
        return
    }

    const fehler = []
    const netPL = leseZahl(form.netPL, 'addTrades.manualFieldNetPL', fehler)
    if (netPL === null && fehler.length === 0) fehler.push(t('addTrades.manualNetPLMissing'))
    const fee = leseZahl(form.fee, 'addTrades.manualFieldFee', fehler)
    const qty = leseZahl(form.qty, 'addTrades.manualFieldQty', fehler)
    const entryPrice = leseZahl(form.entryPrice, 'addTrades.manualFieldEntry', fehler)
    const exitPrice = leseZahl(form.exitPrice, 'addTrades.manualFieldExit', fehler)
    const leverage = leseZahl(form.leverage, 'addTrades.manualFieldLeverage', fehler)
    if (qty !== null && qty <= 0) fehler.push(t('addTrades.manualQtyPositive'))
    if (entryPrice !== null && entryPrice < 0) fehler.push(t('addTrades.manualPricePositive'))
    if (exitPrice !== null && exitPrice < 0) fehler.push(t('addTrades.manualPricePositive'))
    if (leverage !== null && leverage <= 0) fehler.push(t('addTrades.manualLeveragePositive'))

    const ausstieg = utcTag(form.date)
    if (!ausstieg) fehler.push(t('addTrades.manualDateInvalid'))
    else if (ausstieg.valueOf() > dayjs.utc().startOf('day').valueOf()) fehler.push(t('addTrades.manualDateFuture'))

    let einstieg = null
    if (String(form.entryDate || '').trim() !== '') {
        einstieg = utcTag(form.entryDate)
        if (!einstieg) fehler.push(t('addTrades.manualEntryDateInvalid'))
        else if (ausstieg && einstieg.valueOf() > ausstieg.valueOf()) fehler.push(t('addTrades.manualEntryAfterExit'))
    }

    if (fehler.length) {
        meldung.value = fehler.join(' · ')
        return
    }

    // Warnung sperrt nicht: ein Verlust trotz Kursgewinn kann echt sein (Gebühren, Funding).
    let warnung = ''
    if (entryPrice > 0 && exitPrice > 0 && netPL !== 0) {
        const lang = form.side === 'B'
        const preisGewinn = lang ? exitPrice > entryPrice : exitPrice < entryPrice
        if (preisGewinn !== netPL > 0) warnung = ' — ' + t('addTrades.manualPnlMismatch')
    }

    speichert.value = true
    try {
        const gebuehr = fee !== null ? Math.abs(fee) : 0
        const grossPL = netPL + gebuehr
        const menge = qty ?? 1
        const dateUnix = ausstieg.unix()
        const exitTime = ausstieg.add(12, 'hour').unix()
        const entryTime = einstieg ? einstieg.add(12, 'hour').unix() : exitTime

        const trade = buildTradeObj({
            id: 't' + dateUnix + '_0_manual' + Date.now(),
            broker: broker.value,
            td: dateUnix,
            side: form.side,
            quantity: menge,
            entryTime,
            exitTime,
            entryPrice: entryPrice ?? 0,
            exitPrice: exitPrice ?? 0,
            symbol,
            grossPL,
            netPL,
            fee: gebuehr,
            tradingFee: gebuehr,
            fundingFee: 0,
            isGrossWin: istGewinn(grossPL),
            isNetWin: istGewinn(netPL),
        })
        if (leverage !== null) trade.leverage = leverage

        await saveManualTrade(trade)
        try { await refreshAccountBalance({ broker: broker.value, force: true }) } catch { /* Kontostand ist Nebensache */ }

        meldung.value = t('addTrades.manualSaved', {
            symbol,
            seite: form.side === 'B' ? t('addTrades.manualLong') : t('addTrades.manualShort'),
            pnl: (netPL >= 0 ? '+' : '') + netPL,
            datum: form.date,
        }) + warnung
        meldungGut.value = true
        // Hebel mitleeren: blieb er stehen, galt das Formular nach jedem
        // Speichern weiter als ungespeichert und der Verlassen-Schutz fragte.
        for (const f of ZAHLENFELDER) form[f] = ''
    } catch (e) {
        meldung.value = t('addTrades.manualSaveFailed') + ' ' + (e?.message || String(e))
    } finally {
        speichert.value = false
    }
}

// ── API-Import ─────────────────────────────────────────────────────────────

const startDatum = ref(dayjs().subtract(7, 'day').format('YYYY-MM-DD'))
const endDatum = ref(heute())
const importiert = ref(false)
const importFehler = ref('')
const importErgebnis = ref('')

const titelBenachrichtigung = () => brokerName.value + ' Import'
const melde = (text) => sendNotification('importFertig', titelBenachrichtigung(), text)

async function importierePionex() {
    importiert.value = true
    importFehler.value = ''
    importErgebnis.value = ''
    try {
        const ergebnis = await useQuickApiImport('pionex')
        const text = ergebnis?.message || t('messages.importCount', { count: ergebnis?.count ?? 0 })
        // Abweichung: die Benachrichtigung erscheint nur bei Tab ohne Fokus —
        // wer die Seite ansieht, bekäme sonst gar keine Rückmeldung.
        importErgebnis.value = text
        melde(text)
    } catch (e) {
        const text = e?.response?.data?.error || e?.message || t('addTrades.importFailed')
        importFehler.value = text
        melde(t('messages.importFailed') + text)
    } finally {
        importiert.value = false
    }
}

/** Antwort der Positions-Proxys prüfen; `code` ≠ 0 ist ein Börsenfehler. */
function positionenAus(antwort) {
    const d = antwort?.data || {}
    if (d.code !== 0) throw new Error(d.msg || 'API error')
    return d.data?.positionList || []
}

async function holePositionen(startTime, endTime) {
    if (broker.value === 'bitget') {
        return positionenAus(await axios.get('/api/bitget/positions', { params: { startTime, endTime } }))
    }
    const alle = []
    const limit = 100
    for (let skip = 0; ; skip += limit) {
        const seite = positionenAus(await axios.get('/api/bitunix/positions', { params: { startTime, endTime, skip, limit } }))
        alle.push(...seite)
        if (seite.length < limit) break
    }
    return alle
}

async function importiereApi() {
    importiert.value = true
    importFehler.value = ''
    importErgebnis.value = ''
    try {
        const startTime = dayjs.utc(startDatum.value).startOf('day').valueOf()
        const endTime = dayjs.utc(endDatum.value).endOf('day').valueOf()
        const positionen = await holePositionen(startTime, endTime)
        if (!positionen.length) {
            importFehler.value = t('addTrades.noPositionsFound')
            melde(t('addTrades.noPositionsFound'))
            return
        }

        seiteLaedt.value = true
        for (const k of Object.keys(executions)) delete executions[k]
        vorhandeneImporte.length = 0
        tradeZeilen.length = 0

        const erzeuge = broker.value === 'bitget' ? createBitgetTradeObj : createBitunixTradeObj
        const jeTag = {}
        positionen.forEach((pos, i) => {
            const trade = erzeuge(pos, i)
            ;(jeTag[trade.td] ||= []).push(trade)
            ;(executions[trade.td] ||= []).push({ ...trade, trade: trade.id })
        })

        /*
         * Bereits vorhandene Tage aussortieren — bewusst tageweise und über
         * alle Broker, wie bisher (die Duplikatprüfung dieses Wegs bleibt; der
         * positionsgenaue Abgleich des Schnellimports wäre ein eigener Auftrag).
         */
        for (const td of Object.keys(jeTag)) {
            const datum = dayjs.unix(Number(td)).utc().format('YYYY-MM-DD')
            if (vorhandeneTradeTage.includes(datum)) {
                vorhandeneImporte.push(Number(td))
                delete jeTag[td]
                delete executions[td]
            }
        }

        const neueTage = Object.keys(jeTag).length
        if (!neueTage) {
            importFehler.value = t('addTrades.allAlreadyImported')
            melde(t('messages.noNewTrades'))
            seiteLaedt.value = false
            return
        }

        ersetzeObjekt(trades, jeTag)
        await baueBlotter()
        await bauePnL()
        seiteLaedt.value = false
        melde(t('messages.positionsImported', { count: positionen.length, days: neueTage }))
    } catch (e) {
        importFehler.value = e?.message || t('addTrades.importFailed')
        melde(t('messages.importFailed') + (e?.message || t('common.error')))
        seiteLaedt.value = false
    } finally {
        importiert.value = false
    }
}

const hatVorschau = computed(() => Object.keys(executions).length > 0)
const bereitsImportiert = computed(() => vorhandeneImporte.map(td => useDateCalFormat(td)).join(', '))

function absenden() {
    // Ohne Argumente: als Ereignis-Handler gebunden landete sonst das Klickereignis darin.
    useUploadTrades()
}

function abbrechen() {
    router.push('/dashboard')
}
</script>

<template>
    <div class="import-seite">
        <Reiter v-model="reiter" :reiter="reiterListe" class="at-mu-4" />

        <!-- Manuelle Eingabe -->
        <Karte v-if="reiter === 'manuell'">
            <p class="einleitung">
                {{ t('addTrades.manualIntro') }} <strong>{{ brokerName }}</strong>. {{ t('addTrades.manualIntroRequired') }}
            </p>

            <form class="at-formzeile" novalidate @submit.prevent="speichereManuell">
                <div class="at-feldbreite-m">
                    <label class="at-label" for="mt-symbol">{{ t('addTrades.feldSymbol') }}</label>
                    <input id="mt-symbol" v-model="form.symbol" class="at-feld" type="text" placeholder="BTCUSDT"
                        autocomplete="off" autocapitalize="characters" spellcheck="false" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-side">{{ t('addTrades.manualSide') }}</label>
                    <select id="mt-side" v-model="form.side" class="at-feld">
                        <option v-for="o in seitenOptionen" :key="o.wert" :value="o.wert">{{ o.text }}</option>
                    </select>
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-date">{{ t('addTrades.manualDateExit') }}</label>
                    <input id="mt-date" v-model="form.date" class="at-feld" type="date" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-entrydate">{{ t('addTrades.manualDateEntry') }} <span class="leise">{{ t('addTrades.manualOptional') }}</span></label>
                    <input id="mt-entrydate" v-model="form.entryDate" class="at-feld" type="date" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-entry">{{ t('addTrades.manualFieldEntry') }} <span class="leise">{{ t('addTrades.manualOptionalShort') }}</span></label>
                    <input id="mt-entry" v-model="form.entryPrice" class="at-feld" type="text" inputmode="decimal" autocomplete="off" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-exit">{{ t('addTrades.manualFieldExit') }} <span class="leise">{{ t('addTrades.manualOptionalShort') }}</span></label>
                    <input id="mt-exit" v-model="form.exitPrice" class="at-feld" type="text" inputmode="decimal" autocomplete="off" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-qty">{{ t('addTrades.manualFieldQty') }} <span class="leise">{{ t('addTrades.manualOptionalShort') }}</span></label>
                    <input id="mt-qty" v-model="form.qty" class="at-feld" type="text" inputmode="decimal" autocomplete="off" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-netpl">{{ t('addTrades.manualFieldNetPL') }} (USDT) *</label>
                    <input id="mt-netpl" v-model="form.netPL" class="at-feld" type="text" inputmode="decimal" autocomplete="off"
                        :placeholder="t('addTrades.manualPnlPlaceholder')" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-fee">{{ t('dashboard.fees') }} <span class="leise">(opt.)</span></label>
                    <input id="mt-fee" v-model="form.fee" class="at-feld" type="text" inputmode="decimal" autocomplete="off" />
                </div>
                <div class="at-feldbreite-s">
                    <label class="at-label" for="mt-lev">{{ t('addTrades.manualFieldLeverage') }} <span class="leise">{{ t('addTrades.manualOptionalShort') }}</span></label>
                    <input id="mt-lev" v-model="form.leverage" class="at-feld" type="text" inputmode="decimal" autocomplete="off" />
                </div>
                <div class="at-feldbreite-voll">
                    <Knopf art="haupt" type="submit" symbol="speichern" :laedt="speichert">
                        {{ speichert ? t('addTrades.manualSavingStatus') : t('addTrades.manualSave') }}
                    </Knopf>
                </div>
            </form>

            <Hinweis v-if="meldung" :art="meldungGut ? 'gut' : 'fehler'" class="at-mo-3">{{ meldung }}</Hinweis>
        </Karte>

        <!-- API-Import -->
        <template v-else>
            <Karte>
                <!-- Text mit Link zu den Einstellungen kommt als HTML aus i18n -->
                <p class="einleitung" v-html="t('addTrades.apiDescription', { broker: brokerName })"></p>

                <template v-if="broker === 'pionex'">
                    <p class="leise">{{ t('addTrades.apiPionexHint') }}</p>
                    <Knopf art="haupt" symbol="herunterladen" :laedt="importiert" @click="importierePionex">
                        {{ importiert ? t('addTrades.importingStatus') : t('addTrades.apiPionexButton') }}
                    </Knopf>
                </template>

                <div v-else class="at-formzeile">
                    <div class="at-feldbreite-s">
                        <label class="at-label" for="api-start">{{ t('addTrades.startDate') }}</label>
                        <input id="api-start" v-model="startDatum" class="at-feld" type="date" />
                    </div>
                    <div class="at-feldbreite-s">
                        <label class="at-label" for="api-ende">{{ t('addTrades.endDate') }}</label>
                        <input id="api-ende" v-model="endDatum" class="at-feld" type="date" />
                    </div>
                    <div>
                        <Knopf art="haupt" symbol="herunterladen" :laedt="importiert" @click="importiereApi">
                            {{ importiert ? t('addTrades.importingStatus') : t('addTrades.importFromApi') }}
                        </Knopf>
                    </div>
                </div>

                <Hinweis v-if="importFehler" art="fehler" class="at-mo-3">{{ importFehler }}</Hinweis>
                <Hinweis v-else-if="importErgebnis" art="gut" class="at-mo-3">{{ importErgebnis }}</Hinweis>
            </Karte>

            <div v-if="spinnerLoadingPage" class="laden"><Kreisel :groesse="28" /></div>

            <Karte v-else-if="vorhandeneImporte.length || hatVorschau" class="at-mo-4">
                <p v-if="vorhandeneImporte.length" class="leise">
                    {{ t('addTrades.alreadyImported') }} {{ bereitsImportiert }}
                </p>

                <ImportVorschau />

                <div class="aktionen">
                    <Knopf v-if="hatVorschau" art="haupt" symbol="haken" @click="absenden">{{ t('common.submit') }}</Knopf>
                    <Knopf art="leise" klein @click="abbrechen">{{ t('common.cancel') }}</Knopf>
                </div>
            </Karte>
        </template>
    </div>
</template>

<style scoped>
.import-seite {
    max-width: 60rem;
    min-width: 0;
}

.einleitung {
    margin: 0 0 var(--abstand-4);
    color: var(--muted);
}

.einleitung :deep(a) {
    color: var(--accent);
}

.leise {
    color: var(--muted);
    font-weight: 400;
}

.laden {
    display: flex;
    justify-content: center;
    padding: var(--abstand-6) 0;
}

.aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-3);
    margin-top: var(--abstand-5);
}
</style>
