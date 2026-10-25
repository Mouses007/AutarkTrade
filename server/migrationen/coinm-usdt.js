/**
 * Coin-M-Bots in USDT umschreiben (Audit FIN-01, 24.10.2026).
 *
 * Bis zu diesem Stand speicherte der Pionex-Import Coin-M-Bots mit Beträgen in
 * der Coin (SOL), und Kontostand, kumulierter PnL und APPT summierten sie als
 * USDT. Neue Importe rechnen jetzt selbst um (`src/utils/quickImport.js`); diese
 * Migration holt die gespeicherten Tage nach: Trades und Executions werden mit
 * `tagInUsdt` (`shared/coinM.js`) umgeschrieben, Blotter und P&L neu gerechnet.
 *
 * Läuft bei jedem Start und ist idempotent — `einheitUsdt` am Trade sagt, dass
 * er schon umgerechnet ist; eine Zeile ohne offenen Coin-M-Trade wird nicht
 * angefasst. Nur Pionex hat Coin-M-Bots.
 */
import { tagInUsdt } from '../../shared/coinM.js'

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v)

export async function migriereCoinMUsdt(knex) {
    if (!(await knex.schema.hasTable('trades'))) return
    const zeilen = await knex('trades').where('broker', 'pionex').select('id', 'trades', 'executions')
    let n = 0
    for (const z of zeilen) {
        let trades, executions
        try { trades = json(z.trades); executions = json(z.executions) } catch { continue }
        const neu = tagInUsdt({ trades, executions })
        if (!neu.geaendert) continue
        await knex('trades').where('id', z.id).update({
            trades: JSON.stringify(neu.trades),
            executions: JSON.stringify(neu.executions ?? []),
            blotter: JSON.stringify(neu.blotter),
            pAndL: JSON.stringify(neu.pAndL),
        })
        n++
    }
    if (n) console.log(` -> Coin-M: ${n} Pionex-Tag(e) in USDT umgerechnet (Audit FIN-01)`)
}
