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
export const tagAuswahl = refOderLeer(() => lokalListe('at.journal.tags'))
export const gewaehlteRichtungen = refOderLeer(() => lokalListe('at.journal.richtungen'))
export const gewaehlterZeitrahmen = refOderLeer(() => lokal('at.journal.zeitrahmen'))
export const gewaehlteKennzahl = refOderLeer(() => lokal('at.journal.kennzahl'))
export const gewaehltesKonto = refOderLeer(() => lokal('at.journal.konto'))
export const gewaehlteKonten = refOderLeer(() => lokalListe('at.journal.konten'))
export const gewaehltBruttoNetto = refOderLeer(() => lokal('at.journal.bruttoNetto'))
export const gewaehltPlOderZufriedenheit = refOderLeer(() => lokal('at.journal.plZufriedenheit'))
export const gewaehlteBoerse = ref(mitLokalspeicher ? lokal('at.journal.boerse') : undefined)
export const selectedTradeCategory = ref(lokal('selectedTradeCategory') || 'futures')
// Eine Bot-Kategorie ohne Bot-Börse ergibt nur leere Seiten.
if (mitLokalspeicher && !BOT_BROKERS.includes(gewaehlteBoerse.value) && selectedTradeCategory.value === 'bot') {
    selectedTradeCategory.value = 'futures'
    lokalSchreiben('selectedTradeCategory', 'futures')
}
export const datumsBereich = refOderLeer(() => lokalJson('at.journal.datumsBereich'))
export const gewaehlterMonat = refOderLeer(() => lokalJson('at.journal.monat'))
export const selectedMonthPreset = ref(lokal('selectedMonthPreset') || 'current')
export const gewaehlterZeitraum = refOderLeer(() => lokalJson('at.journal.zeitraum'))
export const dashReiter = refOderLeer(() => lokal('at.journal.dashReiter'))
const grossNetGespeichert = lokal('at.journal.bruttoNetto')
export const betragArt = ref(grossNetGespeichert === 'gross' || grossNetGespeichert === 'net' ? grossNetGespeichert : 'gross')
export const betragGross = ref(undefined)
export const selectedTradeTimeframes = reactive([])
export const plOderZufriedenheitEntwurf = ref(null)

// ── Bereich und Optionen ───────────────────────────────────────────────────
/** `{start, end}` in Sekunden; `{0,0}` = alles. */
export const gewaehlterBereich = ref(undefined)
/** Gefüllt von `ladeZeitraeume`. */
export const zeitraumListe = reactive([])
export const richtungsOptionen = ref([{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }])
export const zeitrahmenOptionen = computed(() => [
    { value: 'daily', label: t('options.daily') },
    { value: 'weekly', label: t('options.weekly') },
    { value: 'monthly', label: t('options.monthly') },
])
export const kennzahlOptionen = computed(() => [
    { value: 'appt', label: 'APPT' },
    { value: 'profitFactor', label: t('options.profitFactor') },
])
export const bruttoNettoOptionen = computed(() => [
    { value: 'gross', label: t('options.gross') },
    { value: 'net', label: t('options.net') },
])
export const plZufriedenheitOptionen = computed(() => [
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

export const tageZurueck = ref(undefined)
export const tageReserve = ref(undefined)
export const holtWeitere = ref(false)
export const mfeSpeichern = ref(false)
