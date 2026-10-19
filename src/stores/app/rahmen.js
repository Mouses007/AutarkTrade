/**
 * App-Rahmen: Seite, Einstellungszeile, Zeitzone, Modus, Menü- und Reiterzustand.
 *
 * Alles hier ist seitenübergreifend und gehört keinem Journal-Schritt. Die
 * exportierten Namen sind die öffentliche Schnittstelle (Spezifikation
 * journal-kern.md §3.2) und dürfen sich nicht ändern.
 */
import { ref, reactive } from 'vue'
import { lokal, lokalSchreiben, sitzung, mitSitzungsspeicher } from './ablage.js'

// ── Seite und Einstellungen ────────────────────────────────────────────────
/** Routenname der aktuellen Seite (gesetzt von `usePageId`). */
export const pageId = ref(undefined)
/** Die Einstellungszeile (`settings`) — kein Benutzerobjekt. */
export const currentUser = ref(undefined)
export const timeZones = ref(['America/New_York', 'Asia/Shanghai', 'Europe/Brussels', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Europe/London', 'Asia/Riyadh'])
/** Handelszeitzone (gesetzt von `useGetTimeZone`). */
export const timeZoneTrade = ref(undefined)

// ── Abfragen und Listen ────────────────────────────────────────────────────
export const queryLimit = ref(50000)
export const queryLimitExistingTrades = ref(50)
export const endOfList = ref(false)
export const noData = ref(false)
export const stepper = ref(undefined)
export const hasData = ref(false)
export const itemToEditId = mitSitzungsspeicher ? ref(sitzung('editItemId')) : ''
export const currentDate = ref(undefined)
export const quill = ref(undefined)
export const saveButton = ref(false)
export const windowIsScrolled = ref(undefined)
export const selectedItem = ref(undefined)
export const dailyPagination = ref(0)
export const dailyQueryLimit = ref(10)
export const legacy = reactive([])
export const modalDailyTradeOpen = ref(false)
export const countdownInterval = ref(null)
export const countdownSeconds = ref(5)
/** 1 = nah, 3 = ganz weit. */
export const dailyChartZoom = ref(3)
export const scrollToDateUnix = ref(null)

// ── Menü und Bildschirm ────────────────────────────────────────────────────
export const sideMenuMobileOut = ref(false)
export const sideMenuEingeklappt = ref(lokal('sideMenuEingeklappt') === '1')
export function schalteSideMenu() {
    sideMenuEingeklappt.value = !sideMenuEingeklappt.value
    lokalSchreiben('sideMenuEingeklappt', sideMenuEingeklappt.value ? '1' : '0')
}
/** 'computer' oder 'mobile'. */
export const screenType = ref(undefined)

// ── Reiterzustand der Tagesansicht ─────────────────────────────────────────
export const idCurrent = ref(undefined)
export const idPrevious = ref(undefined)
export const idCurrentType = ref(undefined)
export const idCurrentNumber = ref(undefined)
export const idPreviousType = ref(undefined)
export const idPreviousNumber = ref(undefined)

// ── Modus, Privatsphäre, Zwischenablage ────────────────────────────────────
// Muss alle Modi aus config/menu.js kennen — sonst fällt ein gemerkter Modus beim Neuladen auf das Journal (z. B. Lernen → Einstellungen).
export const APP_MODES = ['start', 'journal', 'live', 'research', 'agent', 'lernen']
const gespeicherterModus = lokal('appMode')
export const appMode = ref(APP_MODES.includes(gespeicherterModus) ? gespeicherterModus : 'journal')
export const privacyMode = ref(lokal('privacyMode') === '1')

function leseKopiertesBild() {
    try {
        const roh = sitzung('kopiertesBild')
        return roh ? JSON.parse(roh) : null
    } catch { return null }
}
export const kopiertesBild = ref(leseKopiertesBild())
