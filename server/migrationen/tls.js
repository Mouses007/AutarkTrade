/**
 * HTTPS in der App (26.10.2026): Tabelle `tls_zertifikat` und der
 * Nur-Anzeige-Schlüssel der ESP32-Displays (Audit SEC-GER-001).
 *
 * Additiv und idempotent, ohne neue SCHEMA_VERSION — wie `portfolio.js`.
 *
 * `tls_zertifikat` hat genau eine Zeile (id = 1): die eigene Stamm-CA, das
 * aktuelle Server-Zertifikat und die Namenslisten (`server/tls/dienst.js`).
 * Die beiden privaten Schlüssel liegen verschlüsselt (`crypto.js`, Eintrag
 * in `geheimnisse.js` → Umschlüsselung und Start-Migration greifen), die
 * Zertifikate im Klartext — sie sind öffentlich. Die Tabelle steht bewusst
 * NICHT in `BACKUP_TABLES`: der CA-Schlüssel verlässt die Datenbank nie, auch
 * nicht verschlüsselt im JSON-Export. Nach einer Rücksicherung in eine leere
 * Datenbank entsteht eine neue CA, die Geräte vertrauen ihr einmal neu.
 *
 * `stand` zählt jede Änderung des Zertifikats hoch. Zwei Prozesse an
 * derselben PostgreSQL (NAS und Entwicklungsrechner) schreiben nur, wenn der
 * Stand noch der gelesene ist, und laden sonst den des anderen.
 */
export async function migriereTls(knex, addColumnIfNotExists) {
    if (!(await knex.schema.hasTable('tls_zertifikat'))) {
        await knex.schema.createTable('tls_zertifikat', (t) => {
            t.integer('id').primary()
            t.text('caPem')
            t.text('caSchluessel')            // verschlüsselt (PKCS#8-PEM)
            t.string('caId')
            t.bigInteger('caErstellt')
            t.text('serverPem')
            t.text('serverSchluessel')        // verschlüsselt (PKCS#8-PEM)
            t.bigInteger('serverErstellt')
            t.text('namen')                   // JSON: in der Oberfläche bestätigte Namen/IPs
            t.text('vorschlaege')             // JSON: [{name, zuletzt}] gesehene Host-Köpfe
            t.text('abgelehnt')               // JSON: verworfene Vorschläge
            t.integer('stand').defaultTo(0)
        })
    }
    // ESP32: eigener Schlüssel, der NUR die Anzeige liest (Audit SEC-GER-001).
    await addColumnIfNotExists('settings', 'esp32AnzeigeKey', (t) => t.text('esp32AnzeigeKey').defaultTo(''))
}
