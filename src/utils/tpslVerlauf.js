/**
 * TP/SL-Verlauf einer offenen Position: bereinigen und Stände vereinigen.
 *
 * Audit FUN-TRD-002: `Incoming.vue` las die DB nur, wenn der localStorage leer
 * war. Ein Browser mit altem Stand [SL 100] überschrieb so den Verlauf eines
 * anderen Geräts [100 → 105 → 110] mit [100, 100 → 110 zu SEINER Uhrzeit] —
 * Stufe 105 und die echten Zeitpunkte waren weg. Jede Adresse (localhost,
 * NAS-IP, `.local`, anderer Port) hat ihren eigenen localStorage.
 *
 * Jetzt ist die DB (`incoming_positions.tpslHistory`) die Quelle. Was dieser
 * Tab schon im Speicher hat, wird mit dem DB-Stand VEREINIGT statt ihn zu
 * ersetzen (Schlüssel Zeit/Art/Aktion/Wert), nach Zeit sortiert und bereinigt.
 */

const norm = (v) => (v === undefined || v === null || v === '' || v === 0 ? null : String(v))

/**
 * Aufeinanderfolgende gleiche Einträge je Art (SL/TP) entfernen — gleiche
 * Aktion, gleicher alter und neuer Wert. Reihenfolge bleibt.
 *
 * @param {Array<{type, action, oldVal, newVal}>} verlauf
 */
export function bereinigeVerlauf(verlauf) {
    const sauber = []
    const letzterJeArt = {}
    for (const e of Array.isArray(verlauf) ? verlauf : []) {
        if (!e || typeof e !== 'object') continue
        const vorher = letzterJeArt[e.type]
        if (vorher && e.action === vorher.action
            && norm(e.oldVal) === norm(vorher.oldVal) && norm(e.newVal) === norm(vorher.newVal)) continue
        sauber.push(e)
        letzterJeArt[e.type] = { action: e.action, oldVal: e.oldVal, newVal: e.newVal }
    }
    return sauber
}

const schluessel = (e) => `${Number(e.time) || 0}|${e.type}|${e.action}|${norm(e.newVal)}`

/**
 * Mehrere Stände (DB, Speicher dieses Tabs, Altbestand aus dem localStorage)
 * zu einem Verlauf vereinigen: gleiche Einträge einmal, nach Zeit sortiert
 * (stabil — gleiche Zeit behält die Reihenfolge), dann bereinigt.
 *
 * @param {...Array} staende
 */
export function vereinigeVerlauf(...staende) {
    const gesehen = new Map()
    for (const liste of staende) {
        if (!Array.isArray(liste)) continue
        for (const e of liste) {
            if (!e || typeof e !== 'object') continue
            const k = schluessel(e)
            if (!gesehen.has(k)) gesehen.set(k, e)
        }
    }
    const alle = [...gesehen.values()]
    alle.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))
    return bereinigeVerlauf(alle)
}
