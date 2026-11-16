/**
 * Beendete Pionex-Futures-Grid-Bots im Journal: Netto nach Gebühren und Funding (16.11.2026).
 *
 * Der Import buchte bis hierher `totalRealizedProfit` (Gewinn VOR Gebühren und Funding) als Netto —
 * Rechnung und Beleg in `shared/botNetto.js`. Neue Importe rechnen aus der Marge und tragen die Marke
 * `nettoNachGebuehren`; diese Migration holt die gespeicherten Tage nach.
 *
 * Läuft bei jedem Start und ist idempotent: ein Trade mit Marke wird nicht mehr angefasst, eine Zeile
 * ohne offenen Bot-Trade bleibt unberührt. Nur Pionex hat Bots; Spot-Grids und normale
 * Futures-Positionen sind nicht betroffen. Für Alt-Trades ist die Marge nicht gespeichert, gerechnet
 * wird deshalb Netto − Gebühr + Funding — bei liquidierten Bots etwas zu streng (um höchstens die
 * Gebühren), bei allen anderen in den Belegen auf vier Stellen genau.
 */
import { tagNettoKorrigiert } from '../../shared/botNetto.js'

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v)

export async function migriereBotNetto(knex) {
    if (!(await knex.schema.hasTable('trades'))) return
    const zeilen = await knex('trades').where('broker', 'pionex').select('id', 'trades', 'executions')
    let tage = 0, anzahl = 0, summe = 0
    for (const z of zeilen) {
        let trades, executions
        try { trades = json(z.trades); executions = json(z.executions) } catch { continue }
        const neu = tagNettoKorrigiert({ trades, executions })
        if (!neu.geaendert) continue
        for (let i = 0; i < trades.length; i++) {
            if (neu.trades[i] !== trades[i] && !neu.trades[i].coinM) { anzahl++; summe += (Number(neu.trades[i].netProceeds) || 0) - (Number(trades[i].netProceeds) || 0) }
        }
        await knex('trades').where('id', z.id).update({
            trades: JSON.stringify(neu.trades),
            executions: JSON.stringify(neu.executions ?? []),
            blotter: JSON.stringify(neu.blotter),
            pAndL: JSON.stringify(neu.pAndL),
        })
        tage++
    }
    if (tage) console.log(` -> Bot-Netto: ${tage} Pionex-Tag(e) nachgerechnet, ${anzahl} USDT-Bot(s) zusammen ${summe.toFixed(2)} USDT (Gebühren und Funding waren nicht abgezogen)`)
}
