/**
 * Instanz neu starten: die alte wird archiviert, eine Kopie zählt von vorn.
 *
 * Wozu: Nach einer Korrektur an Detektor oder Simulator gehören die bisherigen
 * Trades zu einem anderen Rechenweg. Sie zu löschen hiesse, die Geschichte zu
 * verlieren; sie weiterzuzählen, Äpfel mit Birnen zu mischen. Das Archiv
 * behält sie, die Kopie beginnt sauber — mit derselben Strategie, denselben
 * Parametern, demselben Risiko und denselben Symbolen.
 *
 * Offene Papierpositionen der archivierten Instanz laufen wie bisher bis
 * Stop oder Ziel weiter (die Engine pflegt offene Positionen unabhängig vom
 * Laufzustand) — sie werden nur nicht mehr der neuen Instanz zugerechnet.
 * WARTENDE Setups dagegen bearbeitet die Engine nur für aktive Instanzen; sie
 * würden im Archiv für immer „wartet" zeigen und werden deshalb mit dem Grund
 * `archiviert` abgeschlossen. Offene Vorschläge wandern zur Kopie — am Archiv
 * liessen sie sich nicht mehr annehmen.
 *
 * Nimmt `knex` von aussen, damit die Migration es ohne Kreisimport nutzen kann.
 */
export async function neustartInstanz(knex, id, { quelle = 'neustart' } = {}) {
    const alt = await knex('strategy_instances').where('id', Number(id)).first()
    if (!alt) return { ok: false, grund: 'nicht_gefunden' }
    if (Number(alt.archiviert)) return { ok: false, grund: 'schon_archiviert' }

    const isPg = knex.client.config.client === 'pg'
    let neuId = 0
    let verloren = false
    await knex.transaction(async (trx) => {
        // Erst archivieren, mit Bedingung: nur EIN Aufruf gewinnt — ein
        // Doppelklick oder zwei Prozesse, die beim Start beide migrieren,
        // legten sonst zwei Kopien an. Der zweite wartet auf die Zeilensperre
        // und findet danach nichts mehr zum Archivieren.
        const n = await trx('strategy_instances').where('id', alt.id)
            .where((q) => q.where('archiviert', 0).orWhereNull('archiviert'))
            .update({ enabled: 0, archiviert: 1, archiviertAm: Date.now() })
        if (!n) { verloren = true; return }
        const kopie = {
            strategyId: alt.strategyId,
            name: alt.name,
            mode: alt.mode === 'shadow' ? 'shadow' : 'paper',
            broker: alt.broker,
            market: alt.market,
            timeframe: alt.timeframe,
            timeframes: alt.timeframes,
            symbols: alt.symbols,
            params: alt.params,
            risk: alt.risk,
            agents: alt.agents,
            enabled: Number(alt.enabled) ? 1 : 0,
            paramsVersion: 1,
            lastError: '',
        }
        neuId = isPg
            ? (await trx('strategy_instances').insert(kopie).returning('id'))[0]?.id
            : (await trx('strategy_instances').insert(kopie))[0]
        await trx('strategy_param_history').insert({
            instanceId: neuId, paramsVersion: 1, params: alt.params, risk: alt.risk,
            source: `${quelle} von #${alt.id}`,
        })
        await trx('strategy_instances').where('id', alt.id).update({ nachfolger: neuId })
        await trx('strategy_setups').where('instanceId', alt.id).whereIn('status', ['waiting_retest', 'armed'])
            .update({ status: 'invalidated', invalidReason: 'archiviert' })
        // Offene Vorschläge gehen mit: die Kopie hat dieselben Parameter, der
        // Vorschlag bleibt dort entscheidbar. Am Archiv liesse er sich nicht
        // mehr annehmen (FUN-S2-001). Geprüft statt vorausgesetzt: der
        // Neustart läuft auch in der Migration, ein Fehler hier bräche sie ab.
        if (await trx.schema.hasColumn('strategy_suggestions', 'status')) {
            await trx('strategy_suggestions').where({ instanceId: alt.id, status: 'pending' })
                .update({ instanceId: neuId })
        }
    })
    if (verloren) return { ok: false, grund: 'schon_archiviert' }
    return { ok: true, altId: alt.id, neuId }
}
