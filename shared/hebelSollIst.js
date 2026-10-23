/**
 * Soll/Ist der Hebelzonen: was das Modell erwartete, gegen das, was wirklich
 * liquidiert wurde — je Preisband und Seite. Rein (kein Netz, keine DB).
 *
 *   Soll  aus dem Verlauf der Hebelkarte (`buildLeverageHistory`): offene Masse
 *         der letzten Spalte PLUS die vom Kurs abgeräumte (`sweptLong/Short`).
 *         Die Momentkarte allein taugt nicht: dort ist eine durchlaufene Zone
 *         schon gelöscht, und genau deren Vorhersage soll geprüft werden.
 *   Ist   aufgezeichnete Binance-Liquidationen im selben Fenster, nach Preis.
 *         Bybit bleibt draussen: dessen Preis ist der Bankrott-, nicht der
 *         Liquidationspreis (siehe `server/liq-kalibrierung.js`) — nach Preis
 *         sortiert wäre das ein systematischer Versatz.
 *
 * Das Ist ist eine STICHPROBE (Binance meldet höchstens eine Liquidation je
 * Sekunde und Symbol), also nie in Dollar mit dem Soll vergleichbar. Darum
 * relativ: `k` = Ist je Soll über ALLE durchlaufenen Zonen. Eine Zone ist
 * bestätigt, wenn sie mindestens die Hälfte ihres fairen Anteils bekam, leer
 * unter einem Fünftel. So bleibt das Urteil gleich, ob Binance ein Zehntel
 * oder die Hälfte der Liquidationen meldet (Selbsttest: Skalen-Gegenprobe).
 *
 * Seiten: `long` = Long-Positionen, die liquidiert würden (Zwangsverkäufe,
 * meist UNTER dem Einstieg), `short` = Shorts (Zwangskäufe). Ein Ereignis mit
 * `isBuy: true` ist eine liquidierte SHORT (Projekt-Konvention).
 */

export const BESTAETIGT_AB = 0.5
export const LEER_UNTER = 0.2

/**
 * @param {object} hist    Ergebnis von `buildLeverageHistory`
 * @param {Array<{t,price,qty,isBuy}>|null} events  aufgezeichnete Liquidationen; null = nicht erfasst
 * @param {object} o
 * @param {number} o.mid           Bezugskurs
 * @param {number} [o.spannePct]   Band um den Kurs
 * @param {number} [o.baender]     Bänder je Seite des Kurses
 * @param {number} [o.minAnteil]   kleinere Zonen (Anteil an der grössten) fallen weg
 * @param {number} [o.trefferAb]   nur Zonen ab diesem Anteil zählen in der Trefferquote
 * @param {number} [o.jetzt]
 */
export function sollIstZonen(hist, events, { mid, spannePct = 3, baender = 12, minAnteil = 0.05, trefferAb = 0.15, jetzt = Date.now() } = {}) {
    if (!hist?.cols || !hist.rows || !(mid > 0)) return null
    const { rows, base, bucketSize } = hist
    const c = (hist.cols - 1) * rows
    const breite = mid * spannePct / 100 / baender
    const unten = mid * (1 - spannePct / 100), oben = mid * (1 + spannePct / 100)
    const zonen = new Map()
    const zone = (preis, seite) => {
        const b = Math.round(preis / breite)
        const k = `${b}|${seite}`
        let z = zonen.get(k)
        if (!z) zonen.set(k, z = { preis: b * breite, seite, offen: 0, gefegt: 0, ist: 0 })
        return z
    }
    for (let r = 0; r < rows; r++) {
        const preis = (base + r) * bucketSize
        if (!(preis > 0) || preis < unten || preis > oben) continue
        // Masse in Münzen — mal Zeilenpreis für Dollar.
        const offenL = hist.long[c + r] * preis, offenS = hist.short[c + r] * preis
        const gefegtL = (hist.sweptLong?.[r] || 0) * preis, gefegtS = (hist.sweptShort?.[r] || 0) * preis
        if (offenL || gefegtL) { const z = zone(preis, 'long'); z.offen += offenL; z.gefegt += gefegtL }
        if (offenS || gefegtS) { const z = zone(preis, 'short'); z.offen += offenS; z.gefegt += gefegtS }
    }
    const erfasst = Array.isArray(events)
    const von = hist.ts?.[0] ?? 0
    if (erfasst) {
        for (const e of events) {
            if (e.t < von || !(e.price >= unten && e.price <= oben)) continue
            // Ist auch dort, wo das Modell nichts erwartete — sonst verschwiegen.
            zone(e.price, e.isBuy ? 'short' : 'long').ist += e.price * e.qty
        }
    }
    const alle = [...zonen.values()].map((z) => ({ ...z, soll: z.offen + z.gefegt }))
    const maxSoll = Math.max(0, ...alle.map((z) => z.soll))
    if (!(maxSoll > 0)) return null

    const durch = alle.filter((z) => z.gefegt > 0 && z.gefegt >= 0.5 * z.soll)
    const summeGefegt = durch.reduce((a, z) => a + z.gefegt, 0)
    const summeIst = durch.reduce((a, z) => a + z.ist, 0)
    const k = erfasst && summeGefegt > 0 && summeIst > 0 ? summeIst / summeGefegt : null

    const aus = alle
        .filter((z) => z.soll >= maxSoll * minAnteil)
        .map((z) => {
            const durchlaufen = z.gefegt > 0 && z.gefegt >= 0.5 * z.soll
            const quote = k && durchlaufen ? z.ist / (z.gefegt * k) : null
            const status = !durchlaufen ? 'offen' : quote == null ? null
                : quote >= BESTAETIGT_AB ? 'bestaetigt' : quote < LEER_UNTER ? 'leer' : 'teils'
            return {
                preis: z.preis, seite: z.seite,
                soll: z.soll / maxSoll,
                // gefüllter Teil, auf dieselbe Länge wie das Soll bezogen
                ist: k ? Math.min(z.soll, z.ist / k) / maxSoll : null,
                status,
                // zählt in der Trefferquote — nur diese bekommen ✓/○ im Bild
                zaehlt: z.soll >= maxSoll * trefferAb,
            }
        })
        .sort((a, b) => a.preis - b.preis)
    const zaehlen = aus.filter((z) => (z.status === 'bestaetigt' || z.status === 'leer' || z.status === 'teils') && z.zaehlt)
    return {
        zonen: aus,
        erfasst,
        treffer: k ? { bestaetigt: zaehlen.filter((z) => z.status === 'bestaetigt').length, durchlaufen: zaehlen.length } : null,
        stunden: von ? Math.round((jetzt - von) / 3_600_000) : null,
    }
}
