/**
 * Währung der Kurse eines Titels → US-Dollar (rein, ohne Netz).
 *
 * Die Hürden des Newcomer-Radars («Kurs ≥ 1», «Tagesumsatz ≥ 1 Mio.») sind in
 * US-Dollar gemeint. Die Kursquelle liefert Kerzen in der Währung der Börse:
 * Tokio in Yen, Seoul in Won, London in PENCE. 900 Yen × 1500 Stück sind
 * 1,35 Mio. Yen und rund 9 000 Dollar — ohne Umrechnung bestand das die Hürde
 * (Audit 15.11.2026, FUN-H-007).
 *
 * Der Abruf des Wechselkurses steht im Lauf (`lauf.js`, einmal je Währung und
 * Lauf); hier steht nur die Rechnung.
 */

/** Unterwährungen, wie die Kursquelle sie schreibt: Pence, Agorot, südafrikanische Cent. */
const UNTEREINHEIT = { GBp: 'GBP', GBX: 'GBP', ILA: 'ILS', ZAc: 'ZAR', ZAC: 'ZAR' }
const TAGE_3M = 63

/**
 * Währungsangabe der Kursquelle zerlegen.
 * @returns {{code: string, teiler: number}|null}  `null` = keine lesbare Währung
 */
export function waehrungsEinheit(waehrung) {
    const roh = String(waehrung ?? '').trim()
    // Gross-/Kleinschreibung trägt hier Bedeutung: `GBp` sind Pence, `GBP` Pfund.
    if (UNTEREINHEIT[roh]) return { code: UNTEREINHEIT[roh], teiler: 100 }
    return /^[A-Z]{3}$/.test(roh) ? { code: roh, teiler: 1 } : null
}

/** Symbol des Wechselkurses bei der Kursquelle (`JPYUSD=X`); `null` für US-Dollar und Unlesbares. */
export function wechselkursSymbol(waehrung) {
    const e = waehrungsEinheit(waehrung)
    return e && e.code !== 'USD' ? `${e.code}USD=X` : null
}

/**
 * Faktor, mit dem ein Betrag in der Währung des Titels zu US-Dollar wird.
 *
 * @param {string|null} waehrung        wie die Kursquelle sie nennt (`USD`, `JPY`, `GBp` …)
 * @param {number|null} [usdJeEinheit]  US-Dollar je EINER Einheit der Hauptwährung (Pfund, nicht Pence)
 * @returns {{faktor: number|null, grund: 'waehrungUnbekannt'|'wechselkursFehlt'|null}}
 */
export function usdFaktor(waehrung, usdJeEinheit = null) {
    const e = waehrungsEinheit(waehrung)
    if (!e) return { faktor: null, grund: 'waehrungUnbekannt' }
    if (e.code === 'USD') return { faktor: 1 / e.teiler, grund: null }
    const kurs = Number(usdJeEinheit)
    if (usdJeEinheit == null || !Number.isFinite(kurs) || !(kurs > 0)) return { faktor: null, grund: 'wechselkursFehlt' }
    return { faktor: kurs / e.teiler, grund: null }
}

/**
 * Aus den Tageskerzen eines Wechselkurses (`XXXUSD=X`): Stand und 3-Monats-Veränderung in %.
 * @returns {{kurs: number, perf3m: number|null}|null}  `null`, wenn kein brauchbarer Kurs dabei ist
 */
export function ausWechselkurs(kerzen = []) {
    const n = kerzen.length
    const kurs = n ? Number(kerzen[n - 1].c) : NaN
    if (!Number.isFinite(kurs) || !(kurs > 0)) return null
    const alt = n > TAGE_3M ? Number(kerzen[n - 1 - TAGE_3M].c) : NaN
    return { kurs, perf3m: alt > 0 ? (kurs / alt - 1) * 100 : null }
}

/**
 * Rendite in Lokalwährung → Rendite in US-Dollar.
 * @param {number|null} perfPct          Rendite des Titels in seiner Währung (%)
 * @param {number|null} waehrungPerfPct  Veränderung der Währung gegen den Dollar im selben Zeitraum (%)
 */
export function renditeInUsd(perfPct, waehrungPerfPct) {
    if (perfPct == null || waehrungPerfPct == null) return null
    return ((1 + perfPct / 100) * (1 + waehrungPerfPct / 100) - 1) * 100
}
