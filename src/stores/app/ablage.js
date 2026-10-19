/**
 * Lesen aus localStorage/sessionStorage beim Laden der Store-Module.
 *
 * Die Stores holen ihre Anfangswerte einmal beim Import. Ausserhalb des
 * Browsers (Node ohne Attrappe) fehlt der Speicher — dann liefern einige
 * Exporte statt einer Ref eine leere Zeichenkette (Altverhalten, Spezifikation
 * journal-kern.md §3.2 / §7.15). `refOderLeer` kapselt genau diese Regel, damit
 * sie an einer Stelle steht und später an einer Stelle entfernt werden kann.
 */
import { ref } from 'vue'

export const mitLokalspeicher = typeof localStorage !== 'undefined' && localStorage !== null
export const mitSitzungsspeicher = typeof sessionStorage !== 'undefined' && sessionStorage !== null

/** Rohwert aus localStorage oder null (ohne Speicher, bei Fehler). */
export function lokal(schluessel) {
    if (!mitLokalspeicher) return null
    try { return localStorage.getItem(schluessel) } catch { return null }
}

/** Schreibt in localStorage; Fehler (voll, gesperrt) werden geschluckt. */
export function lokalSchreiben(schluessel, wert) {
    if (!mitLokalspeicher) return
    try { localStorage.setItem(schluessel, wert) } catch { /* egal */ }
}

/** Rohwert aus sessionStorage oder null. */
export function sitzung(schluessel) {
    if (!mitSitzungsspeicher) return null
    try { return sessionStorage.getItem(schluessel) } catch { return null }
}

/** Kommaliste aus localStorage → Liste; fehlend → []. */
export function lokalListe(schluessel) {
    const roh = lokal(schluessel)
    return roh ? roh.split(',') : []
}

/** JSON aus localStorage; fehlend → null. */
export function lokalJson(schluessel) {
    const roh = lokal(schluessel)
    if (roh == null) return null
    try { return JSON.parse(roh) } catch { return null }
}

/** Ref mit Anfangswert aus dem Speicher — ohne localStorage '' statt Ref (§7.15). */
export function refOderLeer(anfang) {
    return mitLokalspeicher ? ref(anfang()) : ''
}
