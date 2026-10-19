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
import { migriere as marktdaten } from './s12-marktdaten.js'

export async function migriereS12(knex, addColumnIfNotExists) {
    // Marktdatenquelle (server/marktdaten): bestehende Installationen liefen auf Binance.
    await addColumnIfNotExists('settings', 'marktdatenQuelle', (t) => t.string('marktdatenQuelle').defaultTo('binance'))
    // CoinGecko-Tarif des Kundenschlüssels (server/quellen/coingecko.js).
    await addColumnIfNotExists('settings', 'coingeckoTarif', (t) => t.string('coingeckoTarif').defaultTo('demo'))
    for (const [name, schritt] of [['marktdaten', marktdaten], ['hype', hype], ['marktradar', marktradar], ['ki', ki]]) {
        try {
            await schritt(knex, addColumnIfNotExists)
        } catch (e) {
            console.warn(` -> S12-Migration ${name} fehlgeschlagen: ${e.message}`)
        }
    }
}
