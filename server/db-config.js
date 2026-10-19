/**
 * Database configuration.
 * Reads DB type from db-config.json in project root.
 * Default: SQLite (zero config).
 * Optional: PostgreSQL (host, port, user, password, database).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { umgebung } from './umgebung.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CONFIG_PATH = path.join(__dirname, '..', 'db-config.json')
const DB_PATH_NEU = path.join(__dirname, '..', 'autarktrade.db')
// Eine Installation aus der Zeit vor der Umbenennung hat ihre Daten noch in
// tradenote.db. Liegt nur diese Datei da, wird sie weiter benutzt — eine leere
// neue Datenbank sähe aus wie ein Datenverlust.
const DB_PATH_ALT = path.join(__dirname, '..', 'tradenote.db')
const DB_PATH = (!fs.existsSync(DB_PATH_NEU) && fs.existsSync(DB_PATH_ALT)) ? DB_PATH_ALT : DB_PATH_NEU

/**
 * Load DB config from db-config.json.
 * Returns knex connection config object.
 */
export function loadDbConfig() {
    // Testbetrieb: eine ausdrücklich benannte Wegwerf-Datenbank schlägt ALLES.
    // Ohne diesen Ausweg liefe jeder Selbsttest, der initDb() braucht, gegen
    // die in db-config.json konfigurierte echte Datenbank.
    if (umgebung('DB_FILE')) {
        return {
            client: 'better-sqlite3',
            connection: { filename: umgebung('DB_FILE') },
            useNullAsDefault: true
        }
    }

    let config = null
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
        }
    } catch (e) {
        console.warn(' -> Warning: Could not read db-config.json, using SQLite default')
    }

    if (config && config.type === 'postgresql') {
        return {
            client: 'pg',
            connection: {
                host: config.host || 'localhost',
                port: config.port || 5432,
                user: config.user || 'autarktrade',
                password: config.password || '',
                database: config.database || 'autarktrade'
            },
            pool: { min: 0, max: 7 }
        }
    }

    // Default: SQLite
    return {
        client: 'better-sqlite3',
        connection: {
            filename: DB_PATH
        },
        useNullAsDefault: true
    }
}

/**
 * Save DB config to db-config.json.
 * Enthält das DB-Passwort im Klartext → Dateirechte auf 0600 (nur Owner)
 * beschränken. Bevorzugt sollten DB-Credentials per Umgebungsvariablen
 * gesetzt werden (werden bereits unterstützt) statt über diese Datei.
 */
export function saveDbConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 })
    try {
        fs.chmodSync(CONFIG_PATH, 0o600)
    } catch {
        // chmod kann auf manchen FS (z.B. Windows) fehlschlagen — nicht fatal
    }
}

/**
 * Get the config file path (for API routes to read/write).
 */
export function getConfigPath() {
    return CONFIG_PATH
}
