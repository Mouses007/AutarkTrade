/**
 * App-Rahmen: Seite, Einstellungszeile, Zeitzone, Modus, Menü- und Reiterzustand.
 *
 * Alles hier ist seitenübergreifend und gehört keinem Journal-Schritt. Die
 * exportierten Namen sind die öffentliche Schnittstelle (Spezifikation
 * journal-kern.md §3.2) und dürfen sich nicht ändern.
 */
import { ref, reactive } from 'vue'
import { lokal, lokalSchreiben, sitzung } from './ablage.js'

// ── Seite und Einstellungen ────────────────────────────────────────────────
/** Routenname der aktuellen Seite (gesetzt von `setzeSeitenId`). */
export const seitenId = ref(undefined)
/** Die Einstellungszeile (`settings`) — kein Benutzerobjekt. */
export const appEinstellungen = ref(undefined)
/** Handelszeitzone (gesetzt von `leseZeitzone`). */
export const tradeZeitzone = ref(undefined)

// ── Abfragen und Listen ────────────────────────────────────────────────────
export const abfrageGrenze = ref(50000)
export const abfrageGrenzeVorhanden = ref(50)
export const listeZuEnde = ref(false)
export const journalHatDaten = ref(false)
export const quill = ref(undefined)
export const speichernNoetig = ref(false)
export const istGescrollt = ref(undefined)
export const markierterEintrag = ref(undefined)
export const tagesSeite = ref(0)
export const tagesAbfrageGrenze = ref(10)
export const tradeDetailOffen = ref(false)
export const countdownTakt = ref(null)
export const countdownRest = ref(5)
/** 1 = nah, 3 = ganz weit. */
export const tagesChartZoom = ref(3)
export const scrollToDateUnix = ref(null)

// ── Menü und Bildschirm ────────────────────────────────────────────────────
export const seitenmenueMobilOffen = ref(false)
export const sideMenuEingeklappt = ref(lokal('sideMenuEingeklappt') === '1')
export function schalteSideMenu() {
    sideMenuEingeklappt.value = !sideMenuEingeklappt.value
    lokalSchreiben('sideMenuEingeklappt', sideMenuEingeklappt.value ? '1' : '0')
}
/** 'computer' oder 'mobile'. */
export const bildschirmTyp = ref(undefined)

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
