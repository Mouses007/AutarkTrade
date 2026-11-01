/**
 * Zweiter Faktor beim Anmelden (30.10.2026): Spalten für den App-Code (TOTP)
 * und die Tabelle `auth_schluessel` für YubiKeys/Passkeys (WebAuthn).
 *
 * Additiv und idempotent, ohne neue SCHEMA_VERSION — wie `tls.js`. Ohne
 * Einrichtung bleibt alles aus (`totpAn` 0, keine Schlüssel): der Login einer
 * bestehenden Installation ändert sich nicht.
 *
 * - `settings.totpGeheimnis`: verschlüsselt (`crypto.js`, Eintrag in
 *   `geheimnisse.js` → Redaktion, Backup, Umschlüsselung).
 * - `settings.totpAn`: 0/1, erst nach dem bestätigten ersten Code.
 * - `settings.totpLetzterSchritt`: zuletzt angenommener Zeitschritt — derselbe
 *   Code gilt kein zweites Mal.
 * - `settings.webauthnVerbraucht`: JSON [[id, ablauf], …] der eingelösten
 *   Challenges. Die Challenges selbst sind signiert und zustandslos
 *   (`zweifaktor.js`); dieser Merker macht sie einmalig.
 *
 * - `settings.schluesselDirekt` (Audit 4.3.4 SEC-S1-002): 0/1, „Mit YubiKey
 *   anmelden" ohne Passwort. Vorgabe 0 — auch für bestehende Installationen
 *   mit registriertem Schlüssel: der Schlüssel bleibt zweiter Faktor, der
 *   passwortlose Login muss ausdrücklich (mit Passwort) eingeschaltet werden.
 * - `settings.totpFehlZahl`/`totpFehlAb`/`totpSperreBis` (SEC-S1-003):
 *   kontoweiter Zähler falscher App-Codes über alle Adressen und Prozesse,
 *   Fensterbeginn und Ende der Code-Sperre (ms).
 *
 * `auth_schluessel` steht bewusst NICHT in `BACKUP_TABLES` (`backup-api.js`)
 * und NICHT in `VALID_TABLES` (`api-routes.js`): kein Backup und keine
 * generische Route kann einen fremden Schlüssel einschleusen, mit dem sich
 * jemand ohne Passwort anmeldet. Nach einer Rücksicherung in eine leere
 * Datenbank registriert man den YubiKey neu.
 */
export async function migriereZweifaktor(knex, addColumnIfNotExists) {
    await addColumnIfNotExists('settings', 'totpGeheimnis', (t) => t.text('totpGeheimnis').defaultTo(''))
    await addColumnIfNotExists('settings', 'totpAn', (t) => t.integer('totpAn').defaultTo(0))
    await addColumnIfNotExists('settings', 'totpLetzterSchritt', (t) => t.bigInteger('totpLetzterSchritt').defaultTo(0))
    await addColumnIfNotExists('settings', 'webauthnVerbraucht', (t) => t.text('webauthnVerbraucht').defaultTo(''))
    await addColumnIfNotExists('settings', 'schluesselDirekt', (t) => t.integer('schluesselDirekt').defaultTo(0))
    await addColumnIfNotExists('settings', 'totpFehlZahl', (t) => t.integer('totpFehlZahl').defaultTo(0))
    await addColumnIfNotExists('settings', 'totpFehlAb', (t) => t.bigInteger('totpFehlAb').defaultTo(0))
    await addColumnIfNotExists('settings', 'totpSperreBis', (t) => t.bigInteger('totpSperreBis').defaultTo(0))

    if (!(await knex.schema.hasTable('auth_schluessel'))) {
        await knex.schema.createTable('auth_schluessel', (t) => {
            t.increments('id').primary()
            t.string('credentialId', 1024).notNullable().unique()   // base64url
            t.text('publicKey').notNullable()                        // COSE, base64url
            t.bigInteger('signCount').defaultTo(0)
            t.text('transports')                                     // JSON ['usb', 'nfc', …]
            t.string('name', 64)
            t.string('rpId', 255).notNullable()                      // Name, unter dem registriert
            t.bigInteger('erstelltAm')
            t.bigInteger('zuletztAm')
        })
    }
}
