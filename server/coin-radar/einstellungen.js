/**
 * Einstellungen des Coin-Radars.
 *
 * Schlüssel-Wert in `coinradar_settings`, gleicher Aufbau wie beim
 * Hype-Radar und aus demselben Grund: Gewichte, Hürden und Zeiteinheiten sind
 * Objekte und Listen, und sie werden sich noch bewegen. Je Stellschraube eine
 * Spalte hiesse, für jede neue Schraube das Schema zu ändern.
 *
 * Eigene Zugangsdaten braucht der Coin-Radar keine — er rechnet auf Binance-
 * und Bitunix-Daten, die das Haus ohnehin holt. Nur die KI-Einordnung kostet,
 * und deren Anbieter kommt aus der Rollenbelegung des Hype-Radars.
 */

import { getKnex } from '../database.js'
import { STANDARD_GEWICHTE, STANDARD_HUERDEN, STANDARD_HUERDEN_AKTIEN } from './bewertung.js'
import { GEWICHTE_AKTIEN } from './aktien-kennzahlen.js'
import { ZEITPLAN_VORGABE } from './aktien-zeitplan.js'
import { leseHuerdenAktien, leseGewichteAktien } from './aktien-einstellungen.js'

export const VORGABEN = {
    /*
     * Aus. Ein Takt, der ungefragt stündlich Binance-Gewicht verbraucht, wäre
     * ein schlechter erster Eindruck — wer die Seite will, schaltet ihn ein.
     */
    aktiv: false,
    intervallStunden: 1,
    /*
     * Die erste Zeiteinheit trägt die Note, die zweite bestätigt sie. 1h ist
     * grob genug, dass eine einzelne Kerze nicht das Bild kippt, und fein
     * genug, dass „gerade" noch heute heisst; 15m sieht, ob der Ausschlag
     * frisch ist oder schon abflaut.
     */
    zeiteinheiten: ['1h', '15m'],
    gewichte: STANDARD_GEWICHTE,
    huerden: STANDARD_HUERDEN,
    /*
     * Die KI-Einordnung ist ein Absatz, keine Analyse — wenige Cent je Lauf.
     * An als Vorgabe: die Zahlen stehen ohnehin da, der Satz sagt, was sie
     * zusammen bedeuten. Wer nicht zahlen will, schaltet ihn ab.
     */
    einordnungAn: true,
    /*
     * Abverkaufs-Wache (`abverkauf.js`). Hier an als Vorgabe, anders als die
     * Rangliste: Sie ist ausdrücklich bestellt worden, und eine Wache, die erst
     * eingeschaltet werden muss, verpasst genau den ersten Abverkauf. Ihr
     * Verbrauch ist klein (rund zwanzig Coins alle zehn Minuten).
     */
    abverkauf: { an: true, intervallMin: 10, minAnstieg: 20, minUmsatz: 10_000_000, schwelle: 45, maxKandidaten: 20, vorwarnung: false },
    /*
     * Aktien-Radar (`lauf.js` mit `anlageklasse: 'aktien'`). Eigene Schlüssel,
     * damit die Coin-Einstellungen bleiben, was sie sind. Bis 15.11.2026 las
     * der Lauf `huerdenAktien`/`gewichteAktien`, ohne dass sie hier standen —
     * ein gespeicherter Wert wäre nie angekommen (nur bekannte Schlüssel
     * werden gelesen). Geprüft werden sie in `aktien-einstellungen.js`.
     */
    huerdenAktien: STANDARD_HUERDEN_AKTIEN,
    gewichteAktien: GEWICHTE_AKTIEN,
    // Zeitplan nach US-Börsenzeit (`aktien-zeitplan.js`), ab Werk aus.
    aktienZeitplan: ZEITPLAN_VORGABE,
}

/** Alle Einstellungen, mit Vorgaben aufgefüllt. */
export async function leseEinstellungen() {
    let zeilen = []
    try {
        zeilen = await getKnex()('coinradar_settings').select('schluessel', 'wert')
    } catch {
        // Tabelle fehlt noch (ältere DB, neuerer Code).
        return { ...VORGABEN }
    }

    const e = { ...VORGABEN }
    for (const z of zeilen) {
        // `Object.hasOwn`, nicht `in`: sonst gelten `__proto__`, `constructor`, `toString` als Schlüssel (SEC-S-006).
        if (!Object.hasOwn(VORGABEN, z.schluessel)) continue
        let wert
        try {
            wert = JSON.parse(z.wert)
        } catch {
            // Eine kaputte Zeile darf nicht alle übrigen mitnehmen.
            continue
        }
        if (wert === null || wert === undefined) continue
        // Objekte auffüllen statt ersetzen — sonst fehlt nach dem Hinzufügen
        // einer neuen Schraube genau diese in älteren Ständen.
        const vorgabe = VORGABEN[z.schluessel]
        e[z.schluessel] = (typeof wert === 'object' && !Array.isArray(wert)
            && typeof vorgabe === 'object' && !Array.isArray(vorgabe))
            ? { ...vorgabe, ...wert }
            : wert
    }
    /*
     * Hürden und Gewichte des Aktien-Radars auch beim LESEN prüfen (SEC-S-005):
     * über einen Backup-Import oder direkten DB-Zugriff kommt ein Wert an der
     * Prüfung beim Speichern vorbei — Text als Gewicht ergab NaN in der Note.
     */
    e.huerdenAktien = leseHuerdenAktien(e.huerdenAktien)
    e.gewichteAktien = leseGewichteAktien(e.gewichteAktien)
    return e
}

/** Nur bekannte Schlüssel, in einer Anweisung. */
export async function schreibeEinstellungen(neu = {}) {
    const jetzt = Date.now()
    const zeilen = Object.entries(neu)
        .filter(([k]) => Object.hasOwn(VORGABEN, k))
        .map(([schluessel, v]) => ({ schluessel, wert: JSON.stringify(v), aktualisiertAm: jetzt }))
    if (!zeilen.length) return

    await getKnex()('coinradar_settings')
        .insert(zeilen)
        .onConflict('schluessel')
        .merge(['wert', 'aktualisiertAm'])
}
