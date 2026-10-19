/**
 * Migrationen aus S12 „Quellen & Pflichthinweise" (Verkaufs-Prüfung).
 *
 * Eigene Dateien statt neuer Blöcke in `database.js`: mehrere Bereiche
 * (Marktdaten, Hype-Radar, Marktradar/News, KI) überführen gleichzeitig
 * Einstellungen, und jeder Schritt muss bei jedem Start wieder laufen dürfen
 * (idempotent), weil die Test-DB eine Kopie echter Nutzerdaten ist.
 */
import { migriere as hype } from './s12-hype.js'
import { migriere as marktradar } from './s12-marktradar.js'
import { migriere as ki } from './s12-ki.js'
import { schalterAn } from './s15.js'

export async function migriereS12(knex, addColumnIfNotExists) {
    // Marktdatenquelle (server/marktdaten): bestehende Installationen liefen auf Binance.
    await addColumnIfNotExists('settings', 'marktdatenQuelle', (t) => t.string('marktdatenQuelle').defaultTo('binance'))
    // CoinGecko-Tarif des Kundenschlüssels (server/quellen/coingecko.js).
    await addColumnIfNotExists('settings', 'coingeckoTarif', (t) => t.string('coingeckoTarif').defaultTo('demo'))
    // S15: Mit „Quellen ohne Verkaufsfreigabe" an (Vorgabe) schalten diese
    // Schritte nichts mehr ab — sonst wären Telegram-Quellen, Kalender-Länder
    // und Wartungsmarge nach jedem Start wieder auf dem Stand nach S12.
    const ohneFreigabe = await schalterAn(knex)
    const schritte = ohneFreigabe
        ? [['ki', ki]]
        // `marktdaten` (Wartungsmarge binance → bybit) läuft seit S15 nie mehr: mit Schalter
        // aus bedient `margin-rates.js` den Wunsch „binance" ohnehin aus Bybit, und ein
        // dauerhaftes Umschreiben in der DB bliebe nach dem Wiedereinschalten stehen.
        : [['hype', hype], ['marktradar', marktradar], ['ki', ki]]
    for (const [name, schritt] of schritte) {
        try {
            await schritt(knex, addColumnIfNotExists)
        } catch (e) {
            console.warn(` -> S12-Migration ${name} fehlgeschlagen: ${e.message}`)
        }
    }
}
