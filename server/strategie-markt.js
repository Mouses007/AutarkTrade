/**
 * Listen des Strategien-Modus je Markt (Krypto | Aktien).
 *
 * Instanzen tragen `anlageklasse` in der Datenbank. Was an einer Instanz hängt
 * (Setups, aussortierte Signale, Trades), erbt ihren Markt über `instanceId`.
 * Backtest-Läufe haben keine Spalte: ihr Markt steht im Ergebnis selbst —
 * `stats.aktien` schreibt der Backtest genau dann, wenn er das Symbol als
 * Aktien-Future gerechnet hat (`aktienKontext`). Das ist die ehrlichste
 * Auskunft: sie sagt, WIE gerechnet wurde, nicht, was der Stamm heute meint.
 *
 * `?markt=` fehlt oder ist unbekannt → kein Filter (alles, wie vor der Trennung).
 */

/** `krypto` | `aktien` | null (kein Filter). Bewusst nicht `normMarkt`: Unbekanntes filtert nicht. */
export function marktFilter(wert) {
    return wert === 'krypto' || wert === 'aktien' ? wert : null
}

function alsObjekt(stats) {
    if (stats && typeof stats === 'object') return stats
    try { return JSON.parse(stats || '{}') || {} } catch { return {} }
}

/** Markt eines Backtest-Laufs aus seinen Kennzahlen (Text oder Objekt). */
export function laufKlasse(stats) {
    const s = alsObjekt(stats)
    return s.aktien && typeof s.aktien === 'object' ? 'aktien' : 'krypto'
}

/** Läufe eines Markts; ohne Filter alle. Reihenfolge bleibt. */
export function laeufeImMarkt(zeilen, filter) {
    if (!filter) return zeilen
    return zeilen.filter((z) => laufKlasse(z.stats) === filter)
}

/**
 * Abfrage auf die Instanzen eines Markts einschränken — für `strategy_instances`
 * selbst (`spalte = 'anlageklasse'`). Zeilen ohne Angabe sind Krypto.
 */
export function nurMarkt(abfrage, filter, spalte = 'anlageklasse') {
    if (filter === 'aktien') return abfrage.where(spalte, 'aktien')
    if (filter === 'krypto') return abfrage.where((q) => q.whereNot(spalte, 'aktien').orWhereNull(spalte))
    return abfrage
}

/**
 * Abfrage auf Zeilen einschränken, deren Instanz zu diesem Markt gehört
 * (`strategy_setups`, `strategy_aussortiert`, `strategy_trades`).
 */
export function nurInstanzenImMarkt(abfrage, knex, filter, spalte = 'instanceId') {
    if (!filter) return abfrage
    return abfrage.whereIn(spalte, nurMarkt(knex('strategy_instances').select('id'), filter))
}
