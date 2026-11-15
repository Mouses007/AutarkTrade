/**
 * Quartalszahlen in der Simulation (Aktien-Integration, `docs/RECHERCHE-AKTIEN.md`).
 *
 * Um einen Zahlentermin herum ist eine Aktie ein anderes Instrument: der Kurs
 * springt auf eine Meldung, die keine Regel einer Strategie kennt, und der
 * Aktien-Future nimmt den Sprung in dünnen Stunden vorweg (die Meldung kommt
 * meist kurz nach 16:00 New Yorker Zeit). Ein Backtest, der diese Tage
 * mitzählt, ohne es zu sagen, lobt oder verwirft eine Regel für etwas, das sie
 * nicht getan hat. Deshalb:
 *
 *   - jeder Trade trägt, ob er ein Zahlen-Fenster berührt hat;
 *   - das Ergebnis wird mit und ohne diese Trades ausgewiesen;
 *   - auf Wunsch steigt die Strategie im Fenster nicht ein.
 *
 * Fenster: ein Tag vor bis ein Tag nach dem Meldezeitpunkt. Ein Tag davor,
 * weil eine Position, die über die Meldung gehalten wird, das Risiko trägt —
 * gleich, wie ruhig der Einstieg war.
 *
 * Rein — kein Netz, keine Datenbank.
 */

export const FENSTER_VOR_MS = 24 * 3_600_000
export const FENSTER_NACH_MS = 24 * 3_600_000

/** Liegt der Zeitpunkt im Fenster eines Termins? Gibt den Termin zurück oder null. */
export function imZahlenFenster(ms, termine = []) {
    for (const t of termine) {
        if (ms >= t - FENSTER_VOR_MS && ms <= t + FENSTER_NACH_MS) return t
    }
    return null
}

/** Berührt der Zeitraum [von, bis] das Fenster eines Termins? Gibt den Termin zurück oder null. */
export function beruehrtZahlen(von, bis, termine = []) {
    for (const t of termine) {
        if (von <= t + FENSTER_NACH_MS && bis >= t - FENSTER_VOR_MS) return t
    }
    return null
}

/**
 * Ergebnis getrennt nach Trades mit und ohne Zahlen-Fenster.
 * @param {{zahlen?: number|null, netPnl: number, rMultiple?: number}[]} trades  `zahlen` = berührter Termin oder null
 * @returns {{mit: object, ohne: object}}  je {trades, gewinner, netPnl, summeR}
 */
export function zahlenBilanz(trades = []) {
    const leer = () => ({ trades: 0, gewinner: 0, netPnl: 0, summeR: 0 })
    const aus = { mit: leer(), ohne: leer() }
    for (const t of trades) {
        const z = t?.zahlen ? aus.mit : aus.ohne
        z.trades++
        if (t.netPnl > 0) z.gewinner++
        z.netPnl += Number(t.netPnl) || 0
        z.summeR += Number(t.rMultiple) || 0
    }
    return aus
}

/**
 * Termine als eine aufsteigende Liste und die Angabe, ab wann sie vollständig
 * sind. Die Kursquelle nennt nur die letzten vier Quartale: vor dem ältesten
 * bekannten Termin (minus ein Quartal Sicherheitsabstand) ist UNBEKANNT, ob es
 * einen gab — nicht «keiner».
 *
 * @param {{naechster?: {zeit: number}|null, vergangene?: number[]}|null} roh
 * @returns {{liste: number[], bekanntAb: number|null}}
 */
export function terminListe(roh) {
    const liste = [...(roh?.vergangene || []), roh?.naechster?.zeit].filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b)
    const QUARTAL_MS = 100 * 86_400_000
    return { liste, bekanntAb: liste.length ? liste[0] - QUARTAL_MS + FENSTER_NACH_MS : null }
}

/** Ganze Kalendertage bis zum nächsten Termin ab `jetzt` (UTC-Tage; 0 = heute) — oder null. */
export function tageBisZahlen(liste = [], jetzt = Date.now()) {
    const naechster = liste.find((t) => t >= jetzt - FENSTER_NACH_MS)
    if (naechster == null) return null
    return Math.max(0, Math.round((naechster - jetzt) / 86_400_000))
}
