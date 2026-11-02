/**
 * Spot-Portfolio (seit 22.10.2026, auf master seit 24.10.2026).
 *
 * Additiv und idempotent, OHNE neue SCHEMA_VERSION: der Zweig geht nicht in
 * ein Release, und eine Versionsnummer, die master später für etwas anderes
 * vergibt, wäre ein Konflikt. Fehlen die Tabellen, legt jeder Start sie an;
 * eine Installation ohne diesen Zweig ignoriert sie.
 *
 * Tabellen:
 *   portfolio_wallets     Gerät/App mit eigenem Namen (zwei Ledger möglich)
 *   portfolio_adressen    je Wallet die Ketten: Adresse oder xpub (verschlüsselt)
 *   portfolio_bewegungen  DIE Wahrheit: jede Bewegung jeder Quelle, eingefroren
 *   portfolio_bestaende   gemeldeter Bestand je Quelle/Ort (jeweils der letzte)
 *   portfolio_verlauf     ein Wert je Tag (Verlaufskurve, Beleg zum 31.12.)
 *   portfolio_kurse       Tageskurse für die CHF-Bewertung je Bewegung (Cache)
 *   portfolio_schluessel  Zugangsdaten (Bitpanda, Etherscan, Solana-RPC), verschlüsselt
 *   portfolio_quellen     Stand je Quelle: letzter Abruf, Fehler, Cursor
 */
import { spamHandUmschreiben, normKontrakt } from '../portfolio/token-id.js'
import { bitpandaHandel, handelsZeile } from '../portfolio/normal.js'

export async function migrierePortfolio(knex, addColumnIfNotExists) {
    const s = { hasTable: (t) => knex.schema.hasTable(t), createTable: (t, f) => knex.schema.createTable(t, f) }
    if (!(await s.hasTable('portfolio_wallets'))) {
        await s.createTable('portfolio_wallets', (t) => {
            t.increments('id').primary()
            t.string('typ').notNullable()            // ledger | safepal | metamask | andere
            t.string('name').notNullable()
            t.integer('sortierung').defaultTo(0)
            t.bigInteger('createdAt')
        })
    }
    if (!(await s.hasTable('portfolio_adressen'))) {
        await s.createTable('portfolio_adressen', (t) => {
            t.increments('id').primary()
            t.integer('walletId').notNullable().index()
            t.string('kette').notNullable()          // btc | evm | sol
            t.string('art')                          // adresse | xpub | ypub | zpub
            t.text('adresse').notNullable()          // verschlüsselt
            t.string('anzeige')                      // gekürzt, für die Liste
            t.string('fingerabdruck').index()        // sha256 der Adresse — Doppelte erkennen ohne Klartext
            t.text('netze')                          // EVM: JSON-Liste der chainids
            t.string('label')
            t.bigInteger('createdAt')
        })
    }
    if (!(await s.hasTable('portfolio_bewegungen'))) {
        await s.createTable('portfolio_bewegungen', (t) => {
            t.increments('id').primary()
            t.string('quelle').notNullable()         // bitget | bitunix | pionex | bitpanda | a<adressId>
            t.string('externeId').notNullable()
            t.bigInteger('zeit').notNullable()
            t.string('art').notNullable()
            t.string('asset').notNullable()
            t.double('menge')
            t.string('gegenAsset')
            t.double('gegenMenge')
            t.string('gebuehrAsset')
            t.double('gebuehrMenge')
            t.string('txHash')
            t.string('kette')
            t.string('kontrakt')
            t.integer('transferMit')                 // id der Gegenzeile eines eigenen Transfers
            t.integer('transferSicher')              // 1 = gleiche txHash
            t.string('einordnung')                   // vom Nutzer: transfer | kauf | einkommen | ignorieren
            t.double('chfWert')                      // CHF im Moment der Bewegung, eingefroren
            t.string('chfQuelle')
            t.text('roh')
            t.bigInteger('createdAt')
            t.unique(['quelle', 'externeId'])
            t.index(['zeit'])
        })
    }
    if (!(await s.hasTable('portfolio_bestaende'))) {
        await s.createTable('portfolio_bestaende', (t) => {
            t.increments('id').primary()
            t.string('quelle').notNullable()
            t.string('ort')                          // z.B. evm:1 oder spot / bots
            t.string('asset').notNullable()
            t.string('kontrakt')
            t.double('menge')
            t.string('name')
            t.bigInteger('zeit')
            t.index(['quelle'])
        })
    }
    if (!(await s.hasTable('portfolio_verlauf'))) {
        await s.createTable('portfolio_verlauf', (t) => {
            t.string('datum').primary()              // YYYY-MM-DD (Europe/Zurich)
            t.double('wertChf')
            t.double('wertUsd')
            t.text('daten')                          // JSON: je Quelle und Asset
            t.bigInteger('zeit')
        })
    }
    if (!(await s.hasTable('portfolio_kurse'))) {
        await s.createTable('portfolio_kurse', (t) => {
            t.string('schluessel').notNullable()     // Asset oder usdchf/usdeur
            t.string('datum').notNullable()
            t.double('usd')
            t.string('quelle')
            t.primary(['schluessel', 'datum'])
        })
    }
    if (!(await s.hasTable('portfolio_schluessel'))) {
        await s.createTable('portfolio_schluessel', (t) => {
            t.string('name').primary()               // bitpanda | etherscan | solanaRpc
            t.text('wert')                           // verschlüsselt
            t.bigInteger('updatedAt')
        })
    }
    if (!(await s.hasTable('portfolio_quellen'))) {
        await s.createTable('portfolio_quellen', (t) => {
            t.string('quelle').primary()
            t.bigInteger('letzterAbruf')
            t.bigInteger('letzteBewegung')           // Zeit der jüngsten Bewegung (Cursor)
            t.string('status')                       // ok | fehler | teilweise
            t.text('meldung')
            t.text('stand')                          // JSON: Quellen-eigene Zusatzinfos
        })
    }
    // Übergabe Import → Live: diese Adresse setzt die Historie der genannten
    // importierten Orte fort; live gezählt wird erst NACH `liveAb`.
    await addColumnIfNotExists('portfolio_adressen', 'importOrte', (t) => t.text('importOrte'))
    await addColumnIfNotExists('portfolio_adressen', 'liveAb', (t) => t.bigInteger('liveAb'))
    // Import (Datei): wie belegt eine Zeile ist, und die Notiz der Rekonstruktion.
    await addColumnIfNotExists('portfolio_bewegungen', 'sicherheit', (t) => t.string('sicherheit'))
    await addColumnIfNotExists('portfolio_bewegungen', 'notiz', (t) => t.text('notiz'))
    // Steuerkurse je Jahr und Asset (ESTV-Kursliste oder von Hand); fehlt einer, gilt der Jahresschlusskurs.
    if (!(await knex.schema.hasTable('portfolio_steuerkurse'))) {
        await knex.schema.createTable('portfolio_steuerkurse', (t) => {
            t.integer('jahr').notNullable()
            t.string('asset').notNullable()
            t.double('chf').notNullable()
            t.string('quelle')                       // estv | manuell
            t.bigInteger('updatedAt')
            t.primary(['jahr', 'asset'])
        })
    }
    // Kurs, den die Quelle selbst nennt (Bitpanda `currency_balance` / Menge) — Ersatz, wenn keine Börse den Coin führt.
    await addColumnIfNotExists('portfolio_bestaende', 'kursUsd', (t) => t.double('kursUsd'))
    await addColumnIfNotExists('settings', 'modusPortfolioAn', (t) => t.integer('modusPortfolioAn').defaultTo(1))
    // { bitunix: { futures: 1, spot: 0 }, … } — fehlt ein Eintrag: Futures an, Spot aus.
    await addColumnIfNotExists('settings', 'portfolioBoersen', (t) => t.text('portfolioBoersen'))
    await addColumnIfNotExists('settings', 'portfolioStaubChf', (t) => t.double('portfolioStaubChf').defaultTo(1))
    // Zusätzliche Handelspaare für Bitunix/Pionex (die Börsen liefern Historie nur je Paar).
    await addColumnIfNotExists('settings', 'portfolioPaare', (t) => t.text('portfolioPaare'))
    // { "2025": { pionex: { usd, quelle } } } — Futures-Guthaben am 31.12. laut Kontoauszug (ersetzt die Rückrechnung).
    await addColumnIfNotExists('settings', 'portfolioFuturesStichtag', (t) => t.text('portfolioFuturesStichtag'))
    // { ASSET: { am } } — als Totalverlust markierte Coins (`totalverlust.js`).
    await addColumnIfNotExists('settings', 'portfolioTotalverlust', (t) => t.text('portfolioTotalverlust'))
    // { ASSET: true|false } — Spam von Hand (`spam.js`); sonst entscheidet die Namensregel.
    await addColumnIfNotExists('settings', 'portfolioSpam', (t) => t.text('portfolioSpam'))
    // Valorennummer aus der ESTV-Kursliste (`estv-kursliste.js`) — gehört ins Wertschriftenverzeichnis.
    await addColumnIfNotExists('portfolio_steuerkurse', 'valor', (t) => t.string('valor'))
    // Voller Name aus der ESTV-Kursliste (Steuerbericht: „VXV“ allein sagt dem Steueramt nichts).
    await addColumnIfNotExists('portfolio_steuerkurse', 'name', (t) => t.string('name'))
    // Wohnkanton (KZ, z. B. 'ZH') für Rubrik, Ersatzkurs und Kriterien im Steuerbericht (`shared/steuer-kantone.js`).
    await addColumnIfNotExists('settings', 'portfolioKanton', (t) => t.string('portfolioKanton'))
    // Ort nicht mehr genutzt (Konto aufgelöst, Wallet aufgegeben): ab diesem Zeitpunkt
    // (ms, Ende des Tages) nicht in der aktuellen Ansicht und nicht im Vermögen späterer Stichtage.
    await addColumnIfNotExists('portfolio_quellen', 'genutztBis', (t) => t.bigInteger('genutztBis'))
    // Solana-Verträge wurden bis 25.10.2026 kleingeschrieben gespeichert (Base58
    // unterscheidet Gross/Klein — so fand keine Börse den Token). Bekannte zurück.
    for (const echt of ['rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof']) {
        for (const tabelle of ['portfolio_bewegungen', 'portfolio_bestaende']) {
            await knex(tabelle).where('kontrakt', echt.toLowerCase()).update({ kontrakt: echt }).catch(() => {})
        }
    }
    // { quelle: true } — Konten, deren neue Bewegungen gemeldet werden (`wacht.js`).
    await addColumnIfNotExists('settings', 'portfolioWacht', (t) => t.text('portfolioWacht'))
    // Sparplan: id der Gegenzeile (Lastschrift ↔ Kauf), gesetzt vom Abruf (`ordneSparplaene`).
    await addColumnIfNotExists('portfolio_bewegungen', 'sparplanMit', (t) => t.integer('sparplanMit'))
    await spamJeVertrag(knex)
    await bitpandaGebuehrZusammen(knex)
}

/*
 * Bitpanda-Käufe mit Gebühr in VSN/BEST (drei Assets in EINER Operation) lagen
 * bis 01.11.2026 als drei „Tausch“-Zeilen `op:ASSET` ohne Gegenseite vor —
 * Feb.–Juni 2026 acht Sparplan-Käufe BTC. Sie werden zu der einen Zeile, die
 * `ausBitpandaOperationen` heute liefert, MIT deren externeId: sonst stünde
 * der Kauf nach einem vollen Neuabruf doppelt da. Behalten wird die Zeile des
 * gekauften Coins; ihr CHF-Wert wird neu bewertet (jetzt über den bezahlten
 * Betrag). Eine Operation mit Einordnung oder Partner bleibt, wie sie ist.
 * Idempotent: danach gibt es für die Operation keine `op:`-Zeilen mehr.
 */
async function bitpandaGebuehrZusammen(knex) {
    try {
        const zeilen = await knex('portfolio_bewegungen').where('quelle', 'bitpanda').where('externeId', 'like', '%:%')
            .select('id', 'externeId', 'asset', 'menge', 'gegenAsset', 'einordnung', 'transferMit', 'sparplanMit')
        const jeOp = new Map()
        for (const z of zeilen) {
            const op = z.externeId.slice(0, z.externeId.lastIndexOf(':'))
            if (!jeOp.has(op)) jeOp.set(op, [])
            jeOp.get(op).push(z)
        }
        let n = 0
        for (const [op, liste] of jeOp) {
            if (liste.length !== 3 || liste.some((z) => z.gegenAsset || z.einordnung || z.transferMit || z.sparplanMit)) continue
            const h = bitpandaHandel(liste.map((z) => [z.asset, Number(z.menge)]))
            if (!h?.gebuehr) continue
            const behalten = liste.find((z) => z.asset === h.plus[0])
            const weg = liste.filter((z) => z !== behalten).map((z) => z.id)
            await knex.transaction(async (trx) => {
                // Schon da (Neuabruf mit dem neuen Code): nur die geteilten Zeilen entfernen.
                if (await trx('portfolio_bewegungen').where({ quelle: 'bitpanda', externeId: op }).first('id')) {
                    await trx('portfolio_bewegungen').whereIn('id', liste.map((z) => z.id)).del()
                    return
                }
                await trx('portfolio_bewegungen').whereIn('id', weg).del()
                await trx('portfolio_bewegungen').where('id', behalten.id)
                    .update({ externeId: op, ...handelsZeile(h), chfWert: null, chfQuelle: null })
            })
            n++
        }
        if (n) console.log(` -> Portfolio: Bitpanda-Käufe mit Gebühr in VSN/BEST zu je einer Zeile zusammengelegt: ${n}`)
    } catch (e) {
        console.warn(' -> Portfolio: Bitpanda-Gebührenzeilen nicht zusammengelegt:', e.message)
    }
}

/*
 * Spam von Hand je Vertrag (Audit FUN-PRT-001, 26.10.2026): Einträge mit reinem
 * Kürzel („USDT“: true) trafen jeden Token dieses Namens, auch den echten.
 * Eindeutige (genau ein Vertrag mit dem Kürzel) werden auf `ASSET|kontrakt`
 * umgeschrieben; mehrdeutige bleiben und gelten als Rückfall (`spam.js`).
 * Idempotent: ein zweiter Lauf findet keine eindeutigen Kürzel-Einträge mehr.
 */
async function spamJeVertrag(knex) {
    try {
        const s = await knex('settings').where('id', 1).first('portfolioSpam')
        let hand = {}
        try { hand = JSON.parse(s?.portfolioSpam || '{}') || {} } catch { return }
        if (!Object.keys(hand).some((k) => !k.includes('|'))) return
        const vertraege = new Map()
        for (const t of ['portfolio_bestaende', 'portfolio_bewegungen']) {
            for (const z of await knex(t).whereNotNull('kontrakt').distinct('asset', 'kontrakt')) {
                const a = String(z.asset || '').toUpperCase()
                const k = normKontrakt(z.kontrakt)
                if (!a || !k) continue
                if (!vertraege.has(a)) vertraege.set(a, new Set())
                vertraege.get(a).add(k)
            }
        }
        const r = spamHandUmschreiben(hand, vertraege)
        if (!r.geaendert) return
        await knex('settings').where('id', 1).update({ portfolioSpam: JSON.stringify(r.hand) })
        console.log(` -> Portfolio: ${r.geaendert} Spam-Einträge von Hand auf ihren Vertrag umgeschrieben`)
    } catch (e) {
        console.warn(' -> Portfolio: Spam je Vertrag nicht umgeschrieben:', e.message)
    }
}
