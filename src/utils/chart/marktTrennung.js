/**
 * Trennung der Märkte im Chart-Arbeitsplatz (Krypto ↔ Aktien) — rein, ohne Vue.
 *
 * Layouts, Watchlists und damit die offenen Reiter liegen schon je Markt in der
 * Datenbank (`chart_layouts.anlageklasse`). Was diese Datei trennt, liegt quer
 * dazu: offene Positionen (eine Tabelle für alle Börsen) und Chart-Alarme.
 *
 * Grundsatz wie überall: Unbekanntes wird nicht versteckt. Ohne Titel-Stamm
 * (`nachschlag === null`) oder ohne Aktien-Teil (`markt` leer) bleibt die Liste,
 * wie sie ist.
 */
import { klasseVonTrade } from '../../../shared/anlageklasse.js'

/**
 * Offene Positionen nach Markt teilen.
 *
 * @param {object[]} liste                     Positionen mit `symbol` und `broker`
 * @param {''|'krypto'|'aktien'} markt         aktiver Markt; leer = keine Trennung (Aktien-Teil aus)
 * @param {Map<string, Set<string>>|null} nachschlag  Aktien-Symbole je Börse (`baueKlassenNachschlag`); null = unbekannt
 * @returns {{eigene: object[], andere: number}}  `andere` = Positionen des anderen Markts (nur gezählt)
 */
export function teilePositionen(liste, markt, nachschlag) {
    const alle = Array.isArray(liste) ? liste : []
    if (!markt || !nachschlag) return { eigene: alle, andere: 0 }
    const eigene = alle.filter((p) => klasseVonTrade(p, nachschlag) === markt)
    return { eigene, andere: alle.length - eigene.length }
}

/** Der andere Markt — für Vermerke wie «im Markt Krypto». */
export function andererMarkt(markt) {
    return markt === 'aktien' ? 'krypto' : 'aktien'
}

/**
 * Gehört ein Alarm in die Liste dieses Markts? Alarme ohne Angabe (vor der
 * Aktien-Integration angelegt) sind Krypto; ohne Markt (Aktien-Teil aus) zählen alle.
 */
export function alarmImMarkt(alarm, markt) {
    if (!markt) return true
    return (alarm?.anlageklasse === 'aktien' ? 'aktien' : 'krypto') === markt
}
