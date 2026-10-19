/**
 * S12-Migration, Bereich marktdaten: bestehende Einstellungen verträglich überführen.
 * Muss mehrfach laufen dürfen (idempotent) — sie läuft bei jedem Start.
 *
 * Die Spalte `marktdatenQuelle` legt `s12.js` an (Vorgabe `binance`, weil
 * bestehende Installationen darauf liefen); hier nur, was der Bereich
 * Marktdaten an alten Werten umstellt.
 */
export async function migriere(knex, addColumnIfNotExists) { // eslint-disable-line no-unused-vars
    /*
     * Wartungsmarge der Liquidationskarte: die Quelle „Binance (automatisch)"
     * las den undokumentierten bapi-Endpunkt (Verkaufs-Prüfung Zeile 34, rot)
     * und ist entfernt. Die Absicht des Nutzers war „automatisch je Symbol" —
     * das bedient jetzt Bybit (gelb, bleibt). Wer „manuell" gewählt hat,
     * behält seinen Wert.
     */
    if (await knex.schema.hasColumn('settings', 'levMapMmrQuelle')) {
        await knex('settings').where('levMapMmrQuelle', 'binance').update({ levMapMmrQuelle: 'bybit' })
    }
}
