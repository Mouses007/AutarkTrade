/**
 * Trade-Bewertungs-Popup: der Server merkt sich, was gemeldet ist (29.10.2026).
 *
 * Additiv und idempotent, ohne neue SCHEMA_VERSION — ein älterer Codestand
 * kennt die Spalten nicht und fasst sie nicht an; was er anlegt, hat keine
 * Zeiten und gilt deshalb nie als neu (`server/trade-popups.js`).
 *
 *   incoming_positions.openedAt / closedAt   Börsenzeit der Eröffnung/Schliessung
 *                                            (ms; ersatzweise Erkennungszeit)
 *   incoming_positions.openNotifiedAt /      wann die Meldung quittiert wurde;
 *                      closeNotifiedAt       null = nie gemeldet
 *   settings.tradePopupBaseline              nur Trades ab hier sind „neu"
 *   settings.tradePopupBoersen               JSON Börse → ms: Speichern eines
 *                                            Schlüssels setzt die Grenze dieser
 *                                            Börse neu (Altbestand eines neuen
 *                                            Kontos ist nicht neu)
 *
 * Merker ist die Baseline selbst: steht keine, wird der Grundstand gesetzt
 * (bestehende Zeilen gelten als gemeldet, Baseline = jetzt). Nach einem
 * Update erscheint so kein Popup für den Altbestand.
 */
export async function migriereTradePopups(knex, addColumnIfNotExists, jetzt = Date.now()) {
    for (const spalte of ['openedAt', 'closedAt', 'openNotifiedAt', 'closeNotifiedAt']) {
        await addColumnIfNotExists('incoming_positions', spalte, (t) => t.bigInteger(spalte))
    }
    await addColumnIfNotExists('settings', 'tradePopupBaseline', (t) => t.bigInteger('tradePopupBaseline'))
    await addColumnIfNotExists('settings', 'tradePopupBoersen', (t) => t.text('tradePopupBoersen').defaultTo('{}'))

    const s = await knex('settings').select('tradePopupBaseline').where('id', 1).first()
    if (s && !Number(s.tradePopupBaseline)) await setzeGrundstand(knex, jetzt)
}

/**
 * Altbestand als gemeldet markieren und die Baseline setzen.
 *
 * Eröffnungen aller Zeilen, Schliessungen nur der schon geschlossenen: eine
 * Position, die beim Update offen ist und danach schliesst, ist eine neue
 * Schliessung. Die Baseline zuletzt — bricht der Lauf ab, setzt der nächste
 * Start neu an.
 */
export async function setzeGrundstand(knex, jetzt = Date.now()) {
    await knex.transaction(async (trx) => {
        if (await trx.schema.hasTable('incoming_positions')) {
            await trx('incoming_positions').whereNull('openNotifiedAt').update({ openNotifiedAt: jetzt })
            await trx('incoming_positions').whereNull('closeNotifiedAt').whereNot('status', 'open').update({ closeNotifiedAt: jetzt })
        }
        await trx('settings').where('id', 1).update({ tradePopupBaseline: jetzt })
    })
}
