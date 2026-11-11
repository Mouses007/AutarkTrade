/**
 * Bot-Seite (11.11.2026): Tabelle `bot_verlauf` — Schnappschüsse laufender
 * Bots, weil Pionex nur den aktuellen Stand liefert.
 *
 * Additiv und idempotent, ohne neue SCHEMA_VERSION — wie `portfolio.js`.
 * Nicht im Backup: die Zeilen sind aus der Börse abgeleitet und werden beim
 * nächsten Takt wieder geschrieben; was fehlt, fehlt nur in der Kurve.
 * Eine Zeile je Bot und 15-Minuten-Raster (`t`), eindeutig — schreiben zwei
 * Prozesse an derselben PostgreSQL, gewinnt der erste.
 */
export async function migriereBots(knex) {
    if (!(await knex.schema.hasTable('bot_verlauf'))) {
        await knex.schema.createTable('bot_verlauf', (t) => {
            t.increments('id').primary()
            t.string('botId', 64).notNullable()
            t.bigInteger('t').notNullable()
            t.double('kurs')
            t.double('gesamt')        // Gewinn in der Margin-Münze (realisiert + schwebend)
            t.double('realisiert')
            t.double('schwebend')
            t.double('gridGewinn')
            t.double('funding')
            t.double('marge')
            t.double('position')
            t.double('liqUnten')
            t.double('liqOben')
            t.integer('zyklen')
            t.unique(['botId', 't'])
        })
    }
}
