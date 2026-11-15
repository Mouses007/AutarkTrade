/**
 * KI-Coach-Leiste: offen/zu, Breite, laufendes Gespräch, Seitenstand.
 *
 * Der Coach klappt als Seitenleiste über der aktuellen Seite auf (bis
 * 15.11.2026 sprang der Knopf zur Seite /ki-coach und verliess, wonach man
 * fragen wollte). Offen/zu, Breite und die Gesprächs-ID liegen in
 * localStorage: Seitenmenü und Modusleiste sind gewöhnliche Links, ein Klick
 * lädt die App neu — die Leiste soll danach wieder so dastehen.
 */
import { ref } from 'vue'
import { lokal, lokalSchreiben, sitzung, mitSitzungsspeicher } from './ablage.js'

export const KI_BREITE_MIN = 320
export const KI_BREITE_MAX = 720
const klemme = (n) => Math.min(KI_BREITE_MAX, Math.max(KI_BREITE_MIN, Math.round(Number(n)) || 420))

export const kiCoachOffen = ref(lokal('at.kiCoach.offen') === '1')
export const kiCoachBreite = ref(klemme(lokal('at.kiCoach.breite')))
/** ID des Gesprächs, das die Leiste zeigt; null = neues Gespräch. */
export const kiCoachSitzung = ref(Number(lokal('at.kiCoach.sitzung')) || null)
/** Frage, die die Leiste beim Öffnen gleich senden soll: `{ text, neu }` oder null. */
export const kiCoachFrage = ref(null)

function merkeOffen() { lokalSchreiben('at.kiCoach.offen', kiCoachOffen.value ? '1' : '0') }

/**
 * Leiste öffnen. Mit `frage` wird sie gleich gestellt — so rufen andere
 * Seiten den Coach („KI-Bewertung" der Tagesansicht, „KI-Coach" einer
 * Strategie-Instanz); `neu` beginnt dafür ein eigenes Gespräch.
 */
export function oeffneKiCoach({ frage = null, neu = false } = {}) {
    if (frage) kiCoachFrage.value = { text: String(frage), neu }
    kiCoachOffen.value = true
    merkeOffen()
}
export function schliesseKiCoach() {
    kiCoachOffen.value = false
    merkeOffen()
}
export function schalteKiCoach() {
    kiCoachOffen.value = !kiCoachOffen.value
    merkeOffen()
}
export function setzeKiCoachBreite(px) {
    kiCoachBreite.value = klemme(px)
    lokalSchreiben('at.kiCoach.breite', String(kiCoachBreite.value))
}
export function setzeKiCoachSitzung(id) {
    kiCoachSitzung.value = id || null
    lokalSchreiben('at.kiCoach.sitzung', id ? String(id) : '')
}

// ── Laufmarke ──────────────────────────────────────────────────────────────
// Ein Neuladen der Seite (Menüklick) bricht eine laufende Antwort ab. Die
// Marke überlebt das Neuladen, damit die Leiste es danach sagen kann, statt
// eine Frage ohne Antwort kommentarlos stehen zu lassen.
export function merkeKiLauf(laeuft) {
    if (!mitSitzungsspeicher) return
    try {
        if (laeuft) sessionStorage.setItem('at.kiCoach.laeuft', '1')
        else sessionStorage.removeItem('at.kiCoach.laeuft')
    } catch { /* egal */ }
}
export const kiLaufUnterbrochen = () => sitzung('at.kiCoach.laeuft') === '1'

// ── Seitenstand ────────────────────────────────────────────────────────────
// Seiten melden eine Funktion an, die sagt, was dort gerade gewählt ist
// (Reiter, aufgeklappte Zeile, Filter). Gelesen wird erst beim Senden einer
// Frage. Mehrere Bausteine einer Seite dürfen anmelden (Seite + Unteransicht);
// spätere überschreiben gleichnamige Felder der früheren.
const standGeber = []
export function meldeSeitenStand(fn) { if (!standGeber.includes(fn)) standGeber.push(fn) }
export function vergissSeitenStand(fn) {
    const i = standGeber.indexOf(fn)
    if (i !== -1) standGeber.splice(i, 1)
}
/** `{ stand, chart }` — `chart` nur, wenn eine Seite einen offenen Chart meldet. */
export function leseSeitenStand() {
    const stand = {}
    let chart = null
    for (const fn of standGeber) {
        let teil = null
        try { teil = fn() } catch { teil = null }
        if (!teil || typeof teil !== 'object') continue
        const { chart: c, ...rest } = teil
        if (c) chart = c
        Object.assign(stand, rest)
    }
    return { stand, chart }
}
