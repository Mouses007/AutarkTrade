/**
 * Filter des Journals: was die Seitenleiste auswählt und welche Optionen sie
 * anbietet.
 *
 * Anfangswerte kommen aus localStorage (gelesen beim Laden des Moduls). Ohne
 * localStorage liefern die mit `refOderLeer` angelegten Exporte '' statt einer
 * Ref (Spezifikation §3.2, Altverhalten §7.15).
 */
import { ref, reactive, computed } from 'vue'
import i18n from '../../i18n/index.js'
import { lokal, lokalSchreiben, lokalListe, lokalJson, refOderLeer, mitLokalspeicher } from '../app/ablage.js'

const t = (k) => i18n.global.t(k)

// ── Konstanten ─────────────────────────────────────────────────────────────
/** Börsen mit Bot-API. */
export const BOT_BROKERS = ['pionex']
export const brokers = reactive([
    { value: 'bitunix', label: 'Bitunix', assetTypes: ['futures'] },
    { value: 'bitget', label: 'Bitget', assetTypes: ['futures'] },
    { value: 'pionex', label: 'Pionex', assetTypes: ['futures'] },
])

// ── Auswahl ────────────────────────────────────────────────────────────────
export const tagAuswahl = refOderLeer(() => lokalListe('selectedTags'))
export const selectedPositions = refOderLeer(() => lokalListe('selectedPositions'))
export const selectedTimeFrame = refOderLeer(() => lokal('selectedTimeFrame'))
export const selectedRatio = refOderLeer(() => lokal('selectedRatio'))
export const selectedAccount = refOderLeer(() => lokal('selectedAccount'))
export const selectedAccounts = refOderLeer(() => lokalListe('selectedAccounts'))
export const gewaehltBruttoNetto = refOderLeer(() => lokal('selectedGrossNet'))
export const gewaehltPlOderZufriedenheit = refOderLeer(() => lokal('selectedPlSatisfaction'))
export const selectedBroker = ref(mitLokalspeicher ? lokal('selectedBroker') : undefined)
export const selectedTradeCategory = ref(lokal('selectedTradeCategory') || 'futures')
// Eine Bot-Kategorie ohne Bot-Börse ergibt nur leere Seiten.
if (mitLokalspeicher && !BOT_BROKERS.includes(selectedBroker.value) && selectedTradeCategory.value === 'bot') {
    selectedTradeCategory.value = 'futures'
    lokalSchreiben('selectedTradeCategory', 'futures')
}
export const selectedDateRange = refOderLeer(() => lokalJson('selectedDateRange'))
export const gewaehlterMonat = refOderLeer(() => lokalJson('selectedMonth'))
export const selectedMonthPreset = ref(lokal('selectedMonthPreset') || 'current')
export const selectedPeriodRange = refOderLeer(() => lokalJson('selectedPeriodRange'))
export const selectedDashTab = refOderLeer(() => lokal('selectedDashTab'))
const grossNetGespeichert = lokal('selectedGrossNet')
export const betragArt = ref(grossNetGespeichert === 'gross' || grossNetGespeichert === 'net' ? grossNetGespeichert : 'gross')
export const betragGross = ref(undefined)
export const selectedTradeTimeframes = reactive([])
export const gewaehlterTagIndex = ref(undefined)
export const plOderZufriedenheitEntwurf = ref(null)

// ── Bereich und Optionen ───────────────────────────────────────────────────
/** `{start, end}` in Sekunden; `{0,0}` = alles. */
export const gewaehlterBereich = ref(undefined)
/** Gefüllt von `ladeZeitraeume`. */
export const zeitraumListe = reactive([])
export const positions = ref([{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }])
export const timeFrames = computed(() => [
    { value: 'daily', label: t('options.daily') },
    { value: 'weekly', label: t('options.weekly') },
    { value: 'monthly', label: t('options.monthly') },
])
export const ratios = computed(() => [
    { value: 'appt', label: 'APPT' },
    { value: 'profitFactor', label: t('options.profitFactor') },
])
export const grossNet = computed(() => [
    { value: 'gross', label: t('options.gross') },
    { value: 'net', label: t('options.net') },
])
export const plSatisfaction = computed(() => [
    { value: 'pl', label: 'PnL' },
    { value: 'satisfaction', label: t('options.satisfaction') },
])

const ZEITRAHMEN = [
    ['timeframes.minutes', ['1m', '2m', '3m', '5m', '6m', '10m', '15m', '30m', '45m']],
    ['timeframes.hours', ['1h', '2h', '3h', '4h']],
    ['timeframes.days', ['1D', '1W', '1M', '3M', '6M', '12M']],
]
export const allTradeTimeframes = computed(() => ZEITRAHMEN.flatMap(([gruppe, werte]) =>
    werte.map(value => ({ value, label: t(`timeframes.${value}`), group: t(gruppe) }))))

export const filteredSuggestions = reactive([])
export const daysBack = ref(undefined)
export const daysMargin = ref(undefined)
export const holtWeitere = ref(false)
export const uploadMfePrices = ref(false)
