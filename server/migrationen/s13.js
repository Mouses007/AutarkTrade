/**
 * Migration aus S13 „Scharfen Handel auslagern" (19.10.2026, Schema v29).
 *
 * AutarkTrade sendet keine Orders mehr; der scharfe Handel liegt auf dem Branch
 * `spaeter/scharfer-handel` (docs/SPAETER-SCHARFER-HANDEL.md). Was davon in der
 * Datenbank steht, wird hier stillgelegt — und NUR in der Datenbank:
 *
 *   - Instanzen mit `mode = 'live'` → `paper`, pausiert (`enabled = 0`), die
 *     Freigabe gelöscht, und `lastError` sagt der Oberfläche, warum.
 *   - Live-Positionen bekommen `ausgelagert = 1`. Ihr Status bleibt, wie er
 *     ist: ob sie an der Börse noch stehen, weiss nur die Börse, und die fragt
 *     diese Migration bewusst nicht. Nichts wird geschlossen, nichts gelöscht,
 *     kein einziger Börsenaufruf. Der Status bleibt auch deshalb unberührt,
 *     weil ein älterer Codestand (mit Stop-Wächter) an derselben Datenbank
 *     sonst eine Position aus den Augen verlöre, die er noch bewacht.
 *
 * Läuft bei jedem Start (idempotent): eine `live`-Zeile, die ein älterer
 * Codestand später noch schreibt, wird beim nächsten Start ebenso stillgelegt.
 */
export const HINWEIS_LIVE = 'S13: Betriebsart live ist ausgelagert — auf Papier gestellt und pausiert'

export async function migriereS13(knex, addColumnIfNotExists) {
    await addColumnIfNotExists('strategy_positions', 'ausgelagert', (t) => t.integer('ausgelagert').defaultTo(0))

    if (await knex.schema.hasTable('strategy_instances')) {
        const n = await knex('strategy_instances').where('mode', 'live').update({
            mode: 'paper', enabled: 0, liveApprovedAt: 0, lastError: HINWEIS_LIVE,
        })
        if (n) console.log(` -> S13: ${n} Live-Instanz(en) auf Papier gestellt und pausiert`)
    }
    if (await knex.schema.hasTable('strategy_positions')) {
        const n = await knex('strategy_positions')
            .where('mode', 'live').whereNot('ausgelagert', 1)
            .update({ ausgelagert: 1 })
        if (n) console.log(` -> S13: ${n} Live-Position(en) als ausgelagert markiert (nichts geschlossen)`)
    }
}
