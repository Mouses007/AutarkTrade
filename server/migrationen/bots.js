/**
 * Bot-Seite (11.11.2026): Tabelle `bot_verlauf` — Schnappschüsse laufender
 * Bots, weil Pionex nur den aktuellen Stand liefert.
 *
 * Additiv und idempotent, ohne neue SCHEMA_VERSION — wie `portfolio.js`.
 * Nicht im Backup: die Zeilen sind aus der Börse abgeleitet und werden beim
 * nächsten Takt wieder geschrieben; was fehlt, fehlt nur in der Kurve.
 * Eine Zeile je Bot und 15-Minuten-Raster (`t`), eindeutig — schreiben zwei
 * Prozesse an derselben PostgreSQL, gewinnt der erste.
 *
 * Bot-Steuerung (Schritt 5): `bot_steuerung` (eine Zeile, id = 1) hält den
 * zweiten Pionex-Schlüssel mit „Bot Trading" (verschlüsselt, Eintrag in
 * `geheimnisse.js`, nicht im Backup) und die Einwilligung (Fassung, SHA-256,
 * Zeit). `bot_aenderungen` ist das Protokoll jeder gesendeten Änderung —
 * die App bietet kein Löschen an.
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
    if (!(await knex.schema.hasTable('bot_steuerung'))) {
        await knex.schema.createTable('bot_steuerung', (t) => {
            t.integer('id').primary()
            t.text('apiKey').defaultTo('')       // verschlüsselt
            t.text('secretKey').defaultTo('')    // verschlüsselt
            t.text('zustimmung')                 // JSON {fassung, hash, zeit} oder null
            t.bigInteger('geaendertAm').defaultTo(0)
        })
        await knex('bot_steuerung').insert({ id: 1 }).onConflict('id').ignore()
    }
    if (!(await knex.schema.hasTable('bot_aenderungen'))) {
        await knex.schema.createTable('bot_aenderungen', (t) => {
            t.increments('id').primary()
            t.string('botId', 64).notNullable()
            t.bigInteger('zeit').notNullable()
            t.string('aktion', 32).notNullable()
            t.text('vorher')          // JSON: Einstellungen und Kennzahlen vor der Änderung
            t.text('anfrage')         // JSON: Pfad + Körper an Pionex (ohne Schlüssel)
            t.text('pruefung')        // JSON: Antwort der Prüfabfrage
            t.text('antwort')         // JSON: Antwort auf die Änderung
            t.boolean('ok')
            t.string('fassung', 32)   // Fassung der Einwilligung
            t.string('fassungHash', 64)
            t.string('hakenHash', 64) // SHA-256 des Haken-Texts, der bestätigt wurde
            t.index(['botId', 'zeit'])
        })
    }
}
