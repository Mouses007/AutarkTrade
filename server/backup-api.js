import fs from 'fs'
import { getKnex } from './database.js'
import { loadDbConfig, getConfigPath, saveDbConfig } from './db-config.js'
import { SETTINGS_SENSITIVE_FIELDS, isAllowedDbHost } from './api-routes.js'
import { BEHALTEN_BEIM_IMPORT, BOERSEN_GEHEIMNISSE, PORTFOLIO_GEHEIMNISSE } from './geheimnisse.js'
import { loadAuthConfig } from './auth.js'
import { migriereKiAufgaben } from './migrationen/einstellungen-ordnung.js'
import { migriereStrategien } from './migrationen/strategien.js'

/*
 * Sensible Felder, die im Export unkenntlich gemacht werden.
 *
 * IMPORTIERT statt abgeschrieben: die Kopie hier hinkte der Liste in
 * `api-routes.js` hinterher, `aiKeyPerplexity` fehlte und ging im Klartext ins
 * Backup. Genau diese Fehlerklasse soll ein Import ausschliessen — ein neuer
 * Schlüssel wird an einer Stelle eingetragen und ist hier automatisch dabei.
 */
const REDACTED_SETTINGS_KEYS = [...SETTINGS_SENSITIVE_FIELDS]

// Settings-Felder, die beim Import NIE aus dem Backup übernommen werden:
// - die redigierten Secrets (Export enthält nur '[REDACTED]' → würde echte Keys
//   zerstören bzw. via authPasswordHash den Eigentümer aussperren)
// - die Auth-Schalter selbst (Schutz vor Manipulation per fremdem Backup)
// - seit F2 (Audit A2-09) auch alle ZIELE von Geheimnissen (KI-Adressen,
//   SMTP-Server und -Benutzer), Rechtsstand, Quellen-Schalter und `apis`:
//   ein geteiltes „Vorlagen"-Backup leitete sonst Alarme und gespeicherte
//   Schlüssel an Fremde um. Liste in `geheimnisse.js`.
// Die bestehenden Werte bleiben stattdessen erhalten.
const PRESERVE_SETTINGS_FIELDS = [...new Set([...REDACTED_SETTINGS_KEYS, ...BEHALTEN_BEIM_IMPORT])]

/*
 * Börsenzugänge kommen nie aus einem Backup (A2-09): aus dem eigenen Export
 * wurde der Schlüssel zu '[REDACTED]', aus einem fremden zu beliebigem
 * Klartext. Die Tabellen stehen weiter im Export (redigiert, zeigt, welche
 * Börse eingerichtet war), beim Import bleiben die bestehenden Zeilen.
 */
const IMPORT_UEBERSPRINGEN = new Set([...Object.keys(BOERSEN_GEHEIMNISSE), ...PORTFOLIO_GEHEIMNISSE.map(([t]) => t)])

/*
 * Hype-Radar-Einstellungen, die ein Ziel bestimmen: die Alarmkanäle (ntfy-
 * Adresse). Ihr Token liegt in `settings` und bleibt — die Adresse muss es
 * also auch.
 */
const HYPE_BEHALTEN = ['alarmKanaele']

// Alle Tabellen die gesichert werden (Reihenfolge wichtig für Import: abhängige zuletzt)
const BACKUP_TABLES = [
    'settings',
    'trades',
    'diaries',
    'screenshots',
    'playbooks',
    'satisfactions',
    'tags',
    'notes',
    'excursions',
    'incoming_positions',
    'bitunix_config',
    'bitget_config',
    'ai_reports',
    'ai_report_messages',
    // Tagesschnappschüsse des Marktradars (BTC-Dominanz, Gesamtmarkt). Winzig,
    // aber NICHT nachbestellbar: für die Dominanz gibt es keine kostenlose
    // Historie. Einmal verloren ist der Bestand endgültig weg — deshalb steht
    // sie im Backup, während die viel grösseren live_recordings draussen
    // bleiben (die sind ein Mitschnitt, kein Original).
    'market_snapshots',
    // Vergangene Wochen liefert der Feed nicht mehr — einmal verloren, weg
    'calendar_events',
    // Handelssitzungen aus dem Live-Trading-Fenster: Plan, Notizen und Fazit
    // sind Handarbeit und stehen nirgendwo sonst. Der eingefrorene Trade-Stand
    // darin liesse sich zwar aus dem Journal neu rechnen — aber nicht mehr so,
    // wie er am Ende der Sitzung aussah.
    'live_sessions',
    // ── Chart-Arbeitsplatz ──────────────────────────────────────────────
    // Zeichnungen, Layouts, Watchlists und Alarme sind Handarbeit — nirgendwo
    // sonst abgelegt und nicht nachbestellbar.
    'chart_layouts',
    'chart_watchlists',
    'chart_zeichnungen',
    'chart_alarme',
    'chart_vorlagen',
    // ── Strategie-Sektion ───────────────────────────────────────────────
    // Selbst gebaute Regelstrategien existieren NIRGENDWO sonst — sie sind
    // Handarbeit des Nutzers, kein Mitschnitt. Ohne sie wäre der
    // Versionsverlauf darunter sinnlos: Fassungen von Strategien, die es nach
    // dem Rückspielen nicht mehr gibt.
    'rule_strategies',
    'rule_strategy_history',
    // Instanzen sind Konfiguration (winzig), die Parameter-Historie erklärt
    // alte Trades, und die Trades selbst sind das Ergebnis eines Laufs, der
    // sich nicht wiederholen lässt — er hing an echten Kursen zu echten Zeiten.
    'strategy_instances',
    'strategy_param_history',
    // Positionen gehören zu den Trades: jeder Trade zeigt mit `positionId`
    // auf seine Position. Bis 31.10.2026 fehlten sie hier — eine Rücksicherung
    // ersetzte die Trades und liess die Positionen stehen. Nach dem Backup
    // geschlossene Positionen standen dann ohne Trade da und sperrten die
    // Instanz, und in einer frischen DB trafen neue Positions-Nummern auf die
    // alten der Trades (FUN-L3-001). Vor `strategy_trades`, wie die Instanzen.
    'strategy_positions',
    'strategy_trades',
    // ── Marktradar-Nachrichten ──────────────────────────────────────────
    // Die Kanalliste ist Handarbeit des Nutzers. Die Lageberichte sind der
    // eigentliche Grund: sie haben KI-Kontingent gekostet und lassen sich nicht
    // nachbestellen — die Beiträge, aus denen sie entstanden, werden nach 30
    // Tagen gelöscht, ein zweiter Lauf ergäbe nie denselben Bericht.
    // `news_items` bleibt bewusst draussen: wächst schnell, jederzeit neu
    // holbar, und es sind fremde Inhalte, die nicht in eine Datei gehören, die
    // der Nutzer womöglich weitergibt. Dieselbe Linie wie bei live_recordings.
    'news_sources',
    'news_digests',
    // ── Coin-Rangliste ──────────────────────────────────────────────────
    // Von Hand gepflegte Listen sind Handarbeit, KI-Vorschläge haben Kontingent
    // gekostet — beides existiert nirgendwo sonst. Die LÄUFE bleiben draussen:
    // sie sind jederzeit neu rechenbar und tragen je Coin eine R-Reihe im JSON,
    // die die Sicherungsdatei dominieren würde (dieselbe Begründung wie bei
    // `strategy_backtests` weiter unten).
    'coin_universen',
    // ── Research: Hype-Radar und Coin-Radar ─────────────────────────────
    /*
     * Bis zum Audit vom 19.08.2026 stand hier NICHTS davon — ein Restore
     * hätte jeden Favoriten, jeden Alarm, beide Einstellungssätze und die
     * gesamte KI-Verbrauchserfassung verloren.
     *
     * Aufgenommen wird, was Handarbeit ist oder Geld gekostet hat:
     * Favoriten und ihre Alarme (die Beobachtungsliste des Nutzers), die
     * Einstellungen beider Radare, die KI-Berichte (Kontingent verbraucht,
     * nicht nachbestellbar) und die Coin-Radar-Läufe mit ihren Zeilen — ohne
     * sie gäbe es nach dem Rückspielen keine Rangkorrelation mehr, weil der
     * Vergleichslauf fehlte.
     *
     * `hype_candidates` bleibt draussen: wächst je Lauf um rund hundert
     * Zeilen, ist in sechs Stunden neu geholt, und es sind fremde Inhalte —
     * dieselbe Linie wie bei `news_items` und `live_recordings`.
     */
    'hype_favoriten',
    'hype_alarme',
    'hype_settings',
    'hype_reports',
    'coinradar_settings',
    'coinradar_laeufe',
    'coinradar_zeilen',
    // Der Verbrauchsnachweis: Wer nachvollziehen will, was die KI gekostet
    // hat, kann das nach einem Restore ohne diese Tabelle nie wieder.
    'ai_usage',
    // Lern-Karteikasten: eigene Karten und der Lernfortschritt (Box je Karte)
    // sind Handarbeit bzw. Lernverlauf — beides sonst nirgends rekonstruierbar.
    'quiz_karten',
    'quiz_fortschritt',
    // ── Spot-Portfolio (Audit FUN-BAK-001, 26.10.2026) ────────────────────
    /*
     * Die Bewegungen sind DIE Wahrheit des Steuerteils — mit Einordnungen von
     * Hand, Datei-Importen geschlossener Konten und eingefrorenen CHF-Werten.
     * Dazu Wallets, Quellenstand („genutzt bis“), Steuerkurse (ESTV/Hand) und
     * der Tagesverlauf (Beleg zum 31.12.). `portfolio_kurse` bleibt draussen:
     * ein Kurs-Cache, jederzeit neu holbar.
     *
     * Verschlüsselt (wie die Börsenschlüssel, `PORTFOLIO_GEHEIMNISSE`):
     * Wallet-Adressen/xpubs und die Zugangsschlüssel (Bitpanda, Etherscan).
     * Sie gehen redigiert hinaus, und ein Import behält die bestehenden Zeilen
     * — nach einem Restore in eine leere DB also Adressen neu eintragen; ihre
     * Bewegungen (Quelle `a<id>`) stehen im Backup.
     */
    'portfolio_wallets',
    'portfolio_adressen',
    'portfolio_schluessel',
    'portfolio_quellen',
    'portfolio_bewegungen',
    'portfolio_bestaende',
    'portfolio_steuerkurse',
    'portfolio_verlauf',
]

/**
 * Bewusst NICHT im Backup: `strategy_setups`, `strategy_runs`,
 * `strategy_backtests`, `rangliste_laeufe` und `rangliste_zeilen`. Die ersten
 * beiden sind Zwischenstände in grosser Zahl — aus Instanzen und Kerzen
 * jederzeit neu erzeugbar (`strategy_positions` stand bis 31.10.2026 auch
 * hier, siehe oben bei BACKUP_TABLES). Backtests
 * sind zwar die Experiment-Registry, tragen aber je Lauf bis zu 500 Trades im
 * JSON; sie würden die Sicherungsdatei dominieren. Wer sie braucht, exportiert
 * die Strategie einzeln (`/api/strategies/rules/:id/export`).
 */

// Beim Import: abhängige Tabellen zuerst löschen.
// ACHTUNG: Jede Tabelle aus BACKUP_TABLES MUSS hier stehen. Fehlt eine, wird
// sie exportiert und wieder eingespielt, ohne vorher geleert zu werden — bei
// gleichen IDs scheitert der Import am Schlüsselkonflikt und die Transaktion
// rollt die GANZE Rücksicherung zurück. Der Selbsttest `__selftest-backup.mjs`
// hält beide Listen deckungsgleich.
const DELETE_ORDER = [
    // Portfolio: Bewegungen/Bestände (fachlich an Adressen) vor Adressen vor Wallets.
    'portfolio_verlauf',
    'portfolio_steuerkurse',
    'portfolio_bestaende',
    'portfolio_bewegungen',
    'portfolio_quellen',
    'portfolio_schluessel',
    'portfolio_adressen',
    'portfolio_wallets',
    // Fortschritt (verweist auf Karten) vor den Karten selbst.
    'quiz_fortschritt',
    'quiz_karten',
    // Radar-Tabellen: Zeilen vor Läufen, Alarme vor Favoriten.
    'coinradar_zeilen',
    'coinradar_laeufe',
    'coinradar_settings',
    'hype_alarme',
    'hype_favoriten',
    'hype_reports',
    'hype_settings',
    'ai_usage',
    'coin_universen',
    'news_digests',
    'news_sources',
    // Abhängige zuerst: die Historie zeigt (fachlich, nicht per Fremdschlüssel)
    // auf `rule_strategies`, die Trades auf `strategy_instances`.
    'rule_strategy_history',
    'strategy_trades',
    'strategy_positions',
    'strategy_param_history',
    'strategy_instances',
    'rule_strategies',
    // Alarme verweisen (fachlich) auf Zeichnungen → zuerst.
    'chart_alarme',
    'chart_zeichnungen',
    'chart_watchlists',
    'chart_layouts',
    'chart_vorlagen',
    'live_sessions',
    'calendar_events',
    'market_snapshots',
    'ai_report_messages',
    'ai_reports',
    'excursions',
    'notes',
    'tags',
    'satisfactions',
    'incoming_positions',
    'screenshots',
    'playbooks',
    'diaries',
    'trades',
    'bitunix_config',
    'bitget_config',
    'settings',
]

/**
 * Der JSON-Export — für den Knopf (`GET /api/db-export`) und die tägliche
 * Sicherung (`sicherung.js`) derselbe, damit beide dasselbe redigieren.
 */
export async function baueExport() {
    const knex = getKnex()
    const dbConfig = loadDbConfig()
    const tables = {}

    for (const table of BACKUP_TABLES) {
        try {
            const hasTable = await knex.schema.hasTable(table)
            if (hasTable) {
                tables[table] = await knex(table).select('*')
            }
        } catch (e) {
            console.warn(`Backup: Tabelle "${table}" übersprungen:`, e.message)
        }
    }

    // Sensitive Felder redaktieren
    if (tables.settings && tables.settings.length > 0) {
        for (const key of REDACTED_SETTINGS_KEYS) {
            if (tables.settings[0][key]) tables.settings[0][key] = '[REDACTED]'
        }
        // Polygon-/Databento-Schlüssel in `apis` (A2-07)
        try {
            const apis = JSON.parse(tables.settings[0].apis || '[]')
            if (Array.isArray(apis)) {
                tables.settings[0].apis = JSON.stringify(apis.map((a) => (a?.key ? { ...a, key: '[REDACTED]' } : a)))
            }
        } catch { tables.settings[0].apis = '[]' }
    }
    for (const configTable of ['bitunix_config', 'bitget_config']) {
        if (tables[configTable]) {
            for (const row of tables[configTable]) {
                if (row.apiKey) row.apiKey = '[REDACTED]'
                if (row.secretKey) row.secretKey = '[REDACTED]'
                if (row.passphrase) row.passphrase = '[REDACTED]'
            }
        }
    }
    redigierePortfolio(tables)

    // db-config.json mitlesen (Datenbankverbindung)
    let dbConfigFile = null
    try {
        const configPath = getConfigPath()
        if (fs.existsSync(configPath)) {
            dbConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
            // DB-Passwort redaktieren
            if (dbConfigFile && dbConfigFile.password) {
                dbConfigFile = { ...dbConfigFile, password: '[REDACTED]' }
            }
        }
    } catch (e) {
        // Kein db-config.json vorhanden (SQLite default)
    }

    return {
        exportedAt: new Date().toISOString(),
        version: '2.2.0',
        dbType: dbConfig?.type || 'sqlite',
        dbConfig: dbConfigFile,
        tables
    }
}

/** Verschlüsselte Portfolio-Spalten (Adressen, Zugangsschlüssel) im Export unkenntlich machen. */
export function redigierePortfolio(tables) {
    for (const [tabelle, spalten] of PORTFOLIO_GEHEIMNISSE) {
        for (const row of tables[tabelle] || []) {
            for (const s of spalten) if (row[s]) row[s] = '[REDACTED]'
        }
    }
    return tables
}

export function setupBackupRoutes(app) {

    // ==================== EXPORT ====================
    app.get('/api/db-export', async (req, res) => {
        try {
            res.json(await baueExport())
        } catch (e) {
            console.error('Backup export error:', e)
            res.status(500).json({ error: e.message || 'Export fehlgeschlagen' })
        }
    })

    // ==================== IMPORT ====================
    app.post('/api/db-import', async (req, res) => {
        const { tables, dbConfig: backupDbConfig, confirmDbConfigOverwrite } = req.body
        if (!tables || typeof tables !== 'object') {
            return res.status(400).json({ ok: false, error: 'Ungültiges Backup-Format: "tables" Objekt fehlt' })
        }

        try {
            const knex = getKnex()
            const dbConfig = loadDbConfig()
            const isPg = dbConfig?.client === 'pg' || dbConfig?.client === 'postgresql' || dbConfig?.type === 'postgresql'
            const imported = {}
            let verworfen = []

            // Alle Tabellen in einer Transaktion leeren und neu befüllen
            await knex.transaction(async (trx) => {

                // 0. Sensible/Auth-Settings vor dem Leeren sichern → werden NICHT
                //    aus dem Backup überschrieben (verhindert Lockout/Manipulation)
                let preservedSettings = null
                try {
                    if (await trx.schema.hasTable('settings')) {
                        preservedSettings = await trx('settings').where('id', 1).first()
                    }
                } catch (e) { /* ignore */ }
                let preservedHype = []
                try {
                    if (await trx.schema.hasTable('hype_settings')) {
                        preservedHype = await trx('hype_settings').whereIn('schluessel', HYPE_BEHALTEN)
                    }
                } catch (e) { /* ignore */ }
                // Offene Positionen, die das Backup nicht kennt (nach ihm
                // eröffnet), gehen mit dem Ersetzen der Tabelle verloren — so
                // wie die Trades seither. Nicht still: die Antwort nennt sie.
                verworfen = await offeneOhneBackup(trx, tables.strategy_positions)

                // 1. Tabellen in Abhängigkeitsreihenfolge leeren
                for (const table of DELETE_ORDER) {
                    if (IMPORT_UEBERSPRINGEN.has(table)) continue
                    if (tables[table]) {
                        try {
                            const hasTable = await trx.schema.hasTable(table)
                            if (hasTable) {
                                await trx(table).del()
                            }
                        } catch (e) {
                            console.warn(`Backup import: Löschen von "${table}" fehlgeschlagen:`, e.message)
                        }
                    }
                }

                // 2. Daten einfügen (in Batches für SQLite-Kompatibilität)
                for (const table of BACKUP_TABLES) {
                    let rows = tables[table]
                    if (!rows || !Array.isArray(rows) || rows.length === 0) continue
                    if (IMPORT_UEBERSPRINGEN.has(table)) {
                        imported[table] = 'übersprungen (Börsenzugang bleibt wie eingerichtet)'
                        continue
                    }
                    /*
                     * `settings` ist eine einzige Zeile mit id 1 (A2-06). Bis
                     * F2 wurde die id des Backups übernommen: mit `id: 2`
                     * traf das Zurückschreiben der geschützten Felder
                     * (`where id = 1`) nichts, beim nächsten Start legte
                     * database.js eine leere Zeile 1 an — Passwort-Gate,
                     * Lizenz und Sitzungs-Generation waren weg, entwertete
                     * Cookies galten wieder.
                     */
                    if (table === 'settings') rows = [{ ...rows[0], id: 1 }]

                    try {
                        const hasTable = await trx.schema.hasTable(table)
                        if (!hasTable) {
                            console.warn(`Backup import: Tabelle "${table}" existiert nicht, übersprungen`)
                            continue
                        }

                        // Spalten der Zieltabelle ermitteln (nur bekannte Spalten einfügen)
                        const columnInfo = await trx(table).columnInfo()
                        const validColumns = Object.keys(columnInfo)

                        // Rows filtern: nur gültige Spalten behalten.
                        // Bei settings: sensible/Auth-Felder NICHT aus dem Backup übernehmen.
                        const skipCols = table === 'settings' ? new Set(PRESERVE_SETTINGS_FIELDS) : null
                        const cleanRows = rows.map(row => {
                            const clean = {}
                            for (const col of validColumns) {
                                if (skipCols && skipCols.has(col)) continue
                                if (row[col] !== undefined) {
                                    clean[col] = row[col]
                                }
                            }
                            return clean
                        })

                        // In 100er-Batches einfügen (SQLite-Limit)
                        const batchSize = 100
                        for (let i = 0; i < cleanRows.length; i += batchSize) {
                            const batch = cleanRows.slice(i, i + batchSize)
                            await trx(table).insert(batch)
                        }

                        imported[table] = cleanRows.length
                    } catch (e) {
                        console.error(`Backup import: Fehler bei "${table}":`, e.message)
                        throw e // Transaktion abbrechen
                    }
                }

                // 2b. Setups stehen nicht im Backup, Positionen schon: deren
                //     `setupId` darf auf kein fremdes Setup zeigen.
                await setupBezuegeLoesen(trx)

                // 3. Gesicherte sensible/Auth-Settings wiederherstellen (nicht aus Backup)
                if (preservedSettings) {
                    const restore = {}
                    for (const field of PRESERVE_SETTINGS_FIELDS) {
                        if (preservedSettings[field] !== undefined) restore[field] = preservedSettings[field]
                    }
                    if (Object.keys(restore).length > 0) {
                        const n = await trx('settings').where('id', 1).update(restore)
                        // Ohne getroffene Zeile wären Gate und Lizenz weg — dann lieber
                        // den ganzen Import zurückrollen.
                        if (!n && tables.settings?.length) throw new Error('Einstellungen nach dem Import nicht auffindbar (id 1)')
                    }
                }
                if (preservedHype.length && tables.hype_settings) {
                    for (const z of preservedHype) {
                        await trx('hype_settings').where('schluessel', z.schluessel).del()
                        await trx('hype_settings').insert(z)
                    }
                }
            })

            // 3. PostgreSQL: Sequenzen reparieren
            if (isPg) {
                await fixSequencesAfterImport(knex)
            }
            if (verworfen.length) {
                imported['offene Positionen verworfen (nach dem Backup eröffnet)'] = verworfen.length
                console.warn('Backup import: offene Positionen verworfen:', verworfen.map((p) => `#${p.id} ${p.symbol} (Instanz ${p.instanceId})`).join(', '))
            }
            // Strategien-Migration auf den zurückgespielten Stand: ein älteres
            // Backup bringt seinen eigenen `strategienStand` mit (FUN-L3-002).
            // Gleich nachziehen statt erst beim nächsten Start — bis dahin
            // liefen alte Instanzen ungestartet, gespiegelte Agenten-Trades
            // stünden wieder im Journal; die Waisen-Bereinigung läuft mit.
            if (tables.strategy_instances || tables.settings) {
                try {
                    await migriereStrategien(knex, spalteDazu(knex))
                } catch (e) {
                    console.warn('Backup import: Strategien-Migration fehlgeschlagen (läuft beim nächsten Start):', e.message)
                }
            }
            // Offene Positionen ohne Instanz (Backup ohne Positionen, oder ihre
            // Instanz fehlt im Backup): melden, und keine neue Instanz darf
            // ihre Nummer erben.
            const waisen = await offeneWaisen(knex)
            if (waisen.length) {
                imported['offene Positionen ohne Instanz (ausbuchen unter Strategien › Instanzen)'] = waisen.length
            }
            await instanzZaehlerAnheben(knex, isPg)
            await setupZaehlerAnheben(knex, isPg)

            // 4. db-config.json wiederherstellen — NUR mit ausdrücklicher Bestätigung
            //    und gültiger Struktur. Das Überschreiben der DB-Verbindung ist
            //    sicherheitskritisch (kann die App auf eine fremde DB umleiten).
            if (backupDbConfig && typeof backupDbConfig === 'object') {
                if (confirmDbConfigOverwrite !== true) {
                    imported['db-config.json'] = 'übersprungen (Bestätigung fehlt: confirmDbConfigOverwrite)'
                } else if (!isValidDbConfig(backupDbConfig)) {
                    imported['db-config.json'] = 'übersprungen (ungültige Struktur)'
                } else if (!isAllowedDbHost(backupDbConfig.host)) {
                    // Gleiche Hostprüfung wie PUT /api/db-config (A2-25): sonst
                    // läse und schriebe die App nach dem Neustart gegen eine
                    // fremde Datenbank — mit Auth-Daten und Schlüsseln.
                    imported['db-config.json'] = 'übersprungen (Host nicht lokal/privat)'
                } else {
                    try {
                        let konfig = { ...backupDbConfig }
                        if (!konfig.password || konfig.password === '[REDACTED]') {
                            // Redigiertes Passwort nie wörtlich speichern: nur das
                            // bestehende übernehmen, und nur für dieselbe Verbindung.
                            const jetzt = loadDbConfig()
                            const c = jetzt?.connection || {}
                            const gleich = jetzt?.client === 'pg' && String(c.host) === String(konfig.host)
                                && Number(c.port) === Number(konfig.port) && String(c.user) === String(konfig.user)
                                && String(c.database) === String(konfig.database)
                            if (!gleich) throw Object.assign(new Error('übersprungen (Passwort fehlt)'), { still: true })
                            konfig.password = c.password
                        }
                        saveDbConfig(konfig)
                        imported['db-config.json'] = 1
                    } catch (e) {
                        if (e.still) imported['db-config.json'] = e.message
                        else console.warn('Backup import: db-config.json konnte nicht wiederhergestellt werden:', e.message)
                    }
                }
            }

            // Ein Backup von vor der Neuordnung trägt noch Zeilen der
            // Aufgaben-Tabelle: gleich umziehen, nicht erst beim nächsten Start
            // — bis dahin galten sonst die alten Seitenfelder des Backups.
            await migriereKiAufgaben(knex)

            // Gate und Generation aus der (unveränderten) Zeile 1 neu laden.
            await loadAuthConfig()
            console.log('Backup import erfolgreich:', imported)
            res.json({ ok: true, imported })
        } catch (e) {
            console.error('Backup import error:', e)
            res.status(500).json({ ok: false, error: e.message || 'Import fehlgeschlagen' })
        }
    })
}

/** Wie `addColumnIfNotExists` beim Start — die Spalten stehen zur Laufzeit längst. */
function spalteDazu(knex) {
    return async (tabelle, spalte, bauen) => {
        if (!(await knex.schema.hasTable(tabelle))) return
        if (!(await knex.schema.hasColumn(tabelle, spalte))) await knex.schema.alterTable(tabelle, bauen)
    }
}

const OFFEN = ['open', 'closing', 'pending']

/**
 * Offene Positionen der jetzigen DB, die das Backup nicht enthält. Nur wenn
 * das Backup Positionen trägt (ab 31.10.2026) — sonst bleibt die Tabelle, wie
 * sie ist. Erkannt an Nummer UND `clientOrderId` (eindeutig je Position).
 */
async function offeneOhneBackup(trx, backupPositionen) {
    if (!Array.isArray(backupPositionen)) return []
    if (!(await trx.schema.hasTable('strategy_positions'))) return []
    const imBackup = new Set(backupPositionen.map((p) => `${p.id}|${p.clientOrderId ?? ''}`))
    const offen = await trx('strategy_positions').whereIn('status', OFFEN)
        .select('id', 'instanceId', 'symbol', 'clientOrderId')
    return offen.filter((p) => !imBackup.has(`${p.id}|${p.clientOrderId ?? ''}`))
}

/** Offene Positionen, deren Instanz es nicht gibt. */
async function offeneWaisen(knex) {
    if (!(await knex.schema.hasTable('strategy_positions')) || !(await knex.schema.hasTable('strategy_instances'))) return []
    return knex('strategy_positions').whereIn('status', OFFEN)
        .whereNotIn('instanceId', knex('strategy_instances').select('id'))
        .select('id', 'instanceId', 'symbol')
}

/**
 * Der Zähler der Instanz-Nummern muss über jeder Nummer liegen, auf die noch
 * eine Zeile zeigt (FUN-L3-002). Sonst erbt die nächste neue Instanz Waisen
 * mit ihrer Nummer — unter PostgreSQL setzt der Import die Sequenz auf
 * MAX(id)+1, und in einer frischen SQLite beginnt der Zähler beim Backup.
 */
async function instanzZaehlerAnheben(knex, isPg) {
    try {
        if (!(await knex.schema.hasTable('strategy_instances'))) return
        let hoechste = Number((await knex('strategy_instances').max({ m: 'id' }).first())?.m) || 0
        for (const t of ['strategy_positions', 'strategy_trades', 'strategy_setups', 'strategy_runs', 'strategy_suggestions', 'strategy_param_history']) {
            if (!(await knex.schema.hasTable(t))) continue
            hoechste = Math.max(hoechste, Number((await knex(t).max({ m: 'instanceId' }).first())?.m) || 0)
        }
        if (isPg) {
            // Läuft nach `fixSequencesAfterImport` (MAX(id)+1) und nach der
            // Migration; `hoechste` enthält MAX(id), senkt also nie.
            await knex.raw(`SELECT setval(pg_get_serial_sequence('strategy_instances', 'id'), ?, false)`, [hoechste + 1])
            return
        }
        // SQLite (AUTOINCREMENT): `sqlite_sequence` hält die höchste je vergebene Nummer.
        const z = await knex('sqlite_sequence').where('name', 'strategy_instances').first()
        if (!z) await knex('sqlite_sequence').insert({ name: 'strategy_instances', seq: hoechste })
        else if (Number(z.seq) < hoechste) await knex('sqlite_sequence').where('name', 'strategy_instances').update({ seq: hoechste })
    } catch (e) {
        console.warn('Backup import: Instanz-Zähler nicht angehoben:', e.message)
    }
}

/*
 * `strategy_setups` steht nicht im Backup, `strategy_positions` und
 * `strategy_trades` schon — beide tragen eine `setupId`. Das Schliessen einer
 * Position setzt ihr Setup auf 'closed' (execution/paper.js). In einer
 * frischen DB zählen die Setup-Nummern aber wieder ab 1: eine zurückgespielte
 * Position mit `setupId` 37 hätte beim Schliessen das neue, fremde Setup #37
 * einer anderen Instanz still auf 'closed' gesetzt und dessen Einstieg
 * verworfen (Nachbesserung FUN-L3-001). Zwei Riegel:
 *   - offene Positionen, deren Setup fehlt oder nicht zu ihnen passt (andere
 *     Instanz oder anderes Symbol), verlieren den Bezug (`setupId` 0, wie
 *     Altbestand ohne Setup);
 *   - der Setup-Zähler wird über jede `setupId` gehoben, auf die noch eine
 *     Zeile zeigt, damit kein neues Setup eine alte Nummer erbt.
 */
async function setupBezuegeLoesen(trx) {
    if (!(await trx.schema.hasTable('strategy_positions')) || !(await trx.schema.hasTable('strategy_setups'))) return
    const offen = await trx('strategy_positions').whereIn('status', OFFEN).where('setupId', '>', 0)
        .select('id', 'instanceId', 'symbol', 'setupId')
    if (!offen.length) return
    const setups = new Map((await trx('strategy_setups').whereIn('id', [...new Set(offen.map((p) => p.setupId))])
        .select('id', 'instanceId', 'symbol')).map((s) => [Number(s.id), s]))
    const fremd = offen.filter((p) => {
        const s = setups.get(Number(p.setupId))
        return !s || Number(s.instanceId) !== Number(p.instanceId) || s.symbol !== p.symbol
    }).map((p) => p.id)
    for (let i = 0; i < fremd.length; i += 100) {
        await trx('strategy_positions').whereIn('id', fremd.slice(i, i + 100)).update({ setupId: 0 })
    }
}

async function setupZaehlerAnheben(knex, isPg) {
    try {
        if (!(await knex.schema.hasTable('strategy_setups'))) return
        let hoechste = 0
        for (const t of ['strategy_positions', 'strategy_trades', 'strategy_runs']) {
            if (!(await knex.schema.hasTable(t))) continue
            hoechste = Math.max(hoechste, Number((await knex(t).max({ m: 'setupId' }).first())?.m) || 0)
        }
        if (hoechste <= 0) return
        if (isPg) {
            // Nie senken: der Zähler kann über MAX(id) stehen (gelöschte Setups).
            const seq = (await knex.raw(`SELECT pg_get_serial_sequence('strategy_setups', 'id') AS s`)).rows?.[0]?.s
            if (!seq) return
            const z = (await knex.raw(`SELECT last_value, is_called FROM ${seq}`)).rows?.[0]
            const naechste = z ? Number(z.last_value) + (z.is_called ? 1 : 0) : 1
            if (naechste <= hoechste) await knex.raw(`SELECT setval(?::regclass, ?, false)`, [seq, hoechste + 1])
            return
        }
        const z = await knex('sqlite_sequence').where('name', 'strategy_setups').first()
        if (!z) await knex('sqlite_sequence').insert({ name: 'strategy_setups', seq: hoechste })
        else if (Number(z.seq) < hoechste) await knex('sqlite_sequence').where('name', 'strategy_setups').update({ seq: hoechste })
    } catch (e) {
        console.warn('Backup import: Setup-Zähler nicht angehoben:', e.message)
    }
}

/**
 * Validiert die Struktur einer wiederhergestellten DB-Konfiguration, bevor sie
 * db-config.json überschreibt. Erwartet die Kern-Verbindungsfelder.
 */
function isValidDbConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false
    const host = cfg.host
    const database = cfg.database
    const user = cfg.user
    const port = cfg.port
    return typeof host === 'string' && host.length > 0
        && typeof database === 'string' && database.length > 0
        && typeof user === 'string' && user.length > 0
        && (typeof port === 'number' || (typeof port === 'string' && port.length > 0))
}

/**
 * PostgreSQL-Sequenzen nach Import mit expliziten IDs reparieren.
 * Setzt jede Sequenz auf MAX(id) + 1.
 */
async function fixSequencesAfterImport(knex) {
    const tables = BACKUP_TABLES.filter(t => t !== 'settings') // settings hat feste id=1
    let fixed = 0

    for (const table of tables) {
        try {
            const hasTable = await knex.schema.hasTable(table)
            if (!hasTable) continue

            await knex.raw(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
            )
            fixed++
        } catch (e) {
            // Tabelle hat evtl. keine Sequenz
        }
    }

    if (fixed > 0) {
        console.log(` -> ${fixed} PostgreSQL-Sequenzen nach Import repariert`)
    }
}
