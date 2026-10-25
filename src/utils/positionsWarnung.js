/**
 * Warnungen für offene Positionen (rein, ohne Vue und Netz):
 *
 *   ohneSl     kein Stop-Loss gesetzt
 *   hinterLiq  Stop-Loss liegt hinter dem Liquidationspreis — Long: SL ≤ Liq,
 *              Short: SL ≥ Liq. Die Börse liquidiert dann, bevor der Stop greift.
 *
 * Unbekannt ist nicht „ohne": konnte die Börse nicht gefragt werden
 * (`slUnbekannt`), schweigt die Prüfung. Frisch eröffnete Positionen bekommen
 * `gnadeMs`, weil der Stop oft erst Sekunden nach dem Einstieg gesetzt wird.
 *
 * „Ohne SL" muss BESTEHEN, nicht nur einmal gesehen sein (25.10.2026): löst
 * der Stop aus, löscht die Börse die Stop-Order sofort, die Position steht aber
 * bis zum nächsten Abgleich noch als offen in der Datenbank — und die Leiste
 * meldete „kein SL gesetzt" für einen Trade, dessen SL gerade gegriffen hatte.
 * Deshalb:
 *   - Verlauf sagt „SL ausgelöst"            → nie eine Warnung (die Position schliesst)
 *   - SL war schon einmal gesetzt, jetzt weg → erst nach `wegMs` (5 min) ohne SL
 *   - nie ein SL                             → erst nach `bestaetigungMs` (1 min) ohne SL
 * Seit wann eine Position ohne SL gesehen wird, führt der Aufrufer in `seit`
 * (id → ms), fortgeschrieben mit `fuehreOhneSlSeit`.
 */
export const GNADE_MS = 60_000
export const BESTAETIGUNG_MS = 60_000
export const WEG_MS = 5 * 60_000

const SL_GESETZT = new Set(['set', 'moved'])

/** Letzter SL-Eintrag im Verlauf der Position (oder null). */
function letzterSl(p) {
    const sl = (p?.tpslVerlauf || []).filter((h) => h.art === 'SL').sort((a, b) => a.t - b.t)
    return sl[sl.length - 1] || null
}

/** `seit` fortschreiben: wer jetzt ohne SL ist, behält seinen ersten Zeitpunkt; wer einen hat, fällt heraus. */
export function fuehreOhneSlSeit(positionen, seit = {}, jetzt = Date.now()) {
    const neu = {}
    for (const p of positionen || []) {
        if (!p || p.slUnbekannt || p.sl > 0) continue
        neu[p.id] = seit[p.id] ?? jetzt
    }
    return neu
}

/**
 * @param {Array<{id, symbol, richtung, sl, liq, slUnbekannt, einstiegT, tpslVerlauf}>} positionen  aus `ladeAlleOffenen()`
 * @param {{ jetzt?, gnadeMs?, seit?: Record<string, number>, bestaetigungMs?, wegMs?, hatteSl?: Set<string> }} o
 *        `hatteSl`: Positionen, die der Aufrufer schon mit SL gesehen hat (der Verlauf wird nur
 *        bei offener Seite „Pendente Trades" geschrieben und fehlt oft)
 *        ohne `seit` gilt jede SL-lose Position als „gerade erst gesehen" (keine Warnung)
 * @returns {Array<{schluessel, id, symbol, richtung, art, sl, liq}>}
 */
export function positionsWarnungen(positionen, { jetzt = Date.now(), gnadeMs = GNADE_MS, seit = null, bestaetigungMs = BESTAETIGUNG_MS, wegMs = WEG_MS, hatteSl = null } = {}) {
    const aus = []
    for (const p of positionen || []) {
        if (!p || p.slUnbekannt) continue
        if (p.einstiegT && jetzt - p.einstiegT < gnadeMs) continue
        let art = null
        if (!(p.sl > 0)) {
            const letzt = letzterSl(p)
            if (letzt?.aktion === 'triggered') continue                 // Stop hat gegriffen, Position schliesst
            const warSl = (letzt && (SL_GESETZT.has(letzt.aktion) || letzt.aktion === 'removed')) || hatteSl?.has(String(p.id))
            const warteMs = warSl ? wegMs : bestaetigungMs
            const ab = seit?.[p.id]
            if (!(ab != null && jetzt - ab >= warteMs)) continue
            art = 'ohneSl'
        } else if (p.liq > 0 && (p.richtung === 'short' ? p.sl >= p.liq : p.sl <= p.liq)) art = 'hinterLiq'
        if (art) aus.push({ schluessel: `${p.id}|${art}`, id: p.id, symbol: p.symbol, richtung: p.richtung, art, sl: p.sl ?? null, liq: p.liq ?? null })
    }
    return aus
}
