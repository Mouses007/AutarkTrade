/**
 * Aktien-Integration, Phase 1 (14.11.2026, `docs/PLAN-AKTIEN.md`).
 *
 * Läuft bei jedem Start, rein additiv, ohne SCHEMA_VERSION:
 *
 * 1. Instrument-Stamm — ein Titel, viele Listungen:
 *      `instrumente`           NVIDIA (anlageklasse, ticker, unterart, ISIN …)
 *      `instrument_listungen`  NVDAUSDT bei Bitget (perp), NVDAX_USDT bei
 *                              Pionex (token-spot), Bitpanda (broker-spot)
 *    Gefüllt wird er vom Stamm-Abgleich (Phase 2), die Einordnung dafür
 *    steht in `server/aktien/einordnung.js`.
 *
 * 2. Spalte `anlageklasse` (Vorgabe `krypto`) an allem, was heute still
 *    «Krypto» meint: Universen, Radar- und Ranglisten-Läufe, Ergebnis-
 *    Verfolgung, Strategie-Instanzen, Chart-Alarme. Bestehende Zeilen sind
 *    damit ohne Umschreiben Krypto.
 *
 * 3. `newcomer_titel` — Stand des Newcomer-Radars je Titel (`server/newcomer-radar/`).
 *
 * 4. Einstellungen: `aktiverMarkt` (krypto | aktien, der Umschalter in der
 *    Kopfleiste) und `modusAktienAn` (Vorgabe aus — solange der Aktien-Teil
 *    im Bau ist, sieht niemand einen Schalter ohne Wirkung).
 *
 * 6. `splitsAngewendet` an `strategy_positions` und `strategy_setups` — welche
 *    Splits an einer offenen Papier-Position schon umgerechnet sind bzw.
 *    welche ein wartendes Setup schon im neuen Massstab gesehen hat
 *    (`server/aktien/splits.js`, `rechneUeberSplitsUm` in der Engine). JSON
 *    `[{t, faktor, bei}]`; leer = keiner. Sichert «genau einmal je Split»
 *    über Neustarts.
 *
 * 5. `edgarKontakt` — womit sich die App bei der SEC ausweist (`server/aktien/edgar.js`).
 *    Trägt der Nutzer selbst ein; leer = EDGAR aus.
 */

/** Tabellen, deren Zeilen eine Anlageklasse tragen. */
export const TABELLEN_MIT_ANLAGEKLASSE = [
    'coin_universen', 'coinradar_laeufe', 'rangliste_laeufe',
    'radar_ergebnisse', 'strategy_instances', 'chart_alarme',
    // Phase 5: jeder Markt hat seine eigenen Chart-Layouts und Watchlists.
    'chart_layouts', 'chart_watchlists',
]

export const MAERKTE = ['krypto', 'aktien']

/** Gespeicherten Wert auf einen gültigen Markt bringen; Unbekanntes ist Krypto. */
export function normMarkt(wert) {
    return MAERKTE.includes(wert) ? wert : 'krypto'
}

export async function migriereAktien(knex, addColumnIfNotExists) {
    if (!(await knex.schema.hasTable('instrumente'))) {
        await knex.schema.createTable('instrumente', (t) => {
            t.increments('id').primary()
            t.string('anlageklasse').notNullable()   // krypto | aktien | sonstige
            t.string('ticker').notNullable()         // Basis ohne Notierung: NVDA, BRKB
            t.string('unterart')                     // aktie | etf | vorboerslich | rohstoff | index | devise | coin
            t.string('name')
            t.string('isin')
            t.string('region')                       // US, HK, KR … soweit bekannt
            t.string('heimatboerse')                 // MIC
            t.string('sektor')
            t.string('branche')
            t.string('waehrung')
            t.bigInteger('ipoDatum')
            t.double('marktkap')
            t.bigInteger('stand')                    // letzte Stammdaten-Auffrischung
            t.bigInteger('createdAt')
            t.unique(['anlageklasse', 'ticker'])
        })
    }
    if (!(await knex.schema.hasTable('instrument_listungen'))) {
        await knex.schema.createTable('instrument_listungen', (t) => {
            t.increments('id').primary()
            t.integer('instrumentId').notNullable().index()
            t.string('handelsplatz').notNullable()   // binance | bitget | bitunix | pionex | bitpanda
            t.string('symbol').notNullable()         // wie die Börse es nennt
            t.string('art').notNullable()            // perp | token-spot | broker-spot
            t.string('quote')
            t.double('maxHebel')
            t.string('handelszeit')                  // 24/7 | 24/5 | boerse
            t.integer('sicher').defaultTo(1)         // 0 = nur per Ticker-Abgleich zugeordnet
            t.integer('aktiv').defaultTo(1)
            t.bigInteger('gelistetSeit')             // Handelsstart laut Börse (ms)
            t.bigInteger('ersteSichtung')
            t.bigInteger('letzteSichtung')
            t.unique(['handelsplatz', 'symbol', 'art'])
        })
    }

    // Für Datenbanken, die die Tabelle vor dieser Spalte bekommen haben.
    await addColumnIfNotExists('instrument_listungen', 'gelistetSeit', (t) => t.bigInteger('gelistetSeit'))

    // Newcomer-Radar (Phase 4): ein Stand je Titel, bei jedem Lauf überschrieben.
    if (!(await knex.schema.hasTable('newcomer_titel'))) {
        await knex.schema.createTable('newcomer_titel', (t) => {
            t.increments('id').primary()
            t.integer('instrumentId').notNullable().unique()
            t.string('kursSymbol')                   // Symbol bei der Kursquelle (NVDA, ASML.AS)
            t.string('zuordnung')                    // ticker | name | suche | sucheFremd — wie das Kurssymbol gefunden wurde
            t.string('kategorie')                    // boersengang | vorboerslich | neuGelistet | etabliert | unbekannt
            t.double('note')
            t.text('noten')                          // JSON: Teil-Noten
            t.text('kennzahlen')                     // JSON
            t.text('huerden')                        // JSON: Liste der gerissenen Hürden
            t.string('grund')                        // warum es keine Kennzahlen gibt
            t.bigInteger('stand')
            t.index(['kategorie', 'note'])
        })
    }

    for (const tabelle of TABELLEN_MIT_ANLAGEKLASSE) {
        await addColumnIfNotExists(tabelle, 'anlageklasse', (t) => t.string('anlageklasse').defaultTo('krypto'))
    }

    await addColumnIfNotExists('settings', 'aktiverMarkt', (t) => t.string('aktiverMarkt').defaultTo('krypto'))
    await addColumnIfNotExists('settings', 'modusAktienAn', (t) => t.boolean('modusAktienAn').defaultTo(false))
    await addColumnIfNotExists('settings', 'edgarKontakt', (t) => t.string('edgarKontakt').defaultTo(''))

    // Offene Papier-Positionen und wartende Setups über einen Split (Punkt 6 oben).
    await addColumnIfNotExists('strategy_positions', 'splitsAngewendet', (t) => t.text('splitsAngewendet').defaultTo(''))
    await addColumnIfNotExists('strategy_setups', 'splitsAngewendet', (t) => t.text('splitsAngewendet').defaultTo(''))
}
