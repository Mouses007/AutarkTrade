/**
 * Wo in der Datenbank Geheimnisse liegen — EINE Liste für alle, die es wissen
 * müssen: Redaktion von `GET /api/db/settings`, Backup-Export und -Import,
 * die Umschlüsselung (`reencrypt-keys.mjs`) und die Migration des Schlüssels
 * nativer Installationen (`crypto.js`).
 *
 * Bis F2 (20.10.2026, Audit A2-07/A2-28) pflegte jede Stelle ihre eigene
 * Liste von Hand. Ergebnis: elf Geheimnis-Spalten fehlten in der Redaktion
 * (OpenRouter, Moonshot, Z.ai, MiniMax, die Zustellgeheimnisse des Hype-Radars,
 * CoinGecko, Solana-RPC …) und gingen als Geheimtext an jede Sitzung und in
 * jedes Backup; die Umschlüsselung vergass Perplexity, Mail und alle `hype*`.
 * Jetzt werden die KI-Schlüssel aus der Anbieter-Registry ABGELEITET, und der
 * Selbsttest (`__selftest-geheimnisse.mjs`) schlägt an, sobald eine neue
 * Spalte mit verdächtigem Namen nicht hier steht.
 */
import { KEY_SPALTEN, KI_URL_SPALTEN } from './ai-models.js'

/**
 * Verschlüsselt gespeicherte Schlüssel in `settings` (AES-GCM über
 * `crypto.js`). Gehen nie hinaus, nicht einmal als Geheimtext.
 */
export const VERSCHLUESSELTE_SETTINGS = [...new Set([
    'aiApiKey',
    ...KEY_SPALTEN,
    'fluxApiKey', 'geminiImageApiKey', 'esp32ApiKey',
    'cryptoquantApiKey', 'mailPasswort',
    // Hype-Radar: Zustellgeheimnisse und Zusatzquellen. Die Webhook-Adresse
    // gehört dazu: bei Home Assistant IST die Adresse das Geheimnis.
    'hypeAlarmNtfyToken', 'hypeAlarmTelegramToken', 'hypeAlarmWebhookUrl',
    'hypeKeySolanaRpc', 'hypeKeyCoingecko', 'hypeKeyCryptopanic', 'hypeKeyLunarcrush',
])]

/**
 * Geheim, aber kein umkehrbar verschlüsselter Schlüssel: Passwort-Hash,
 * Sitzungs-Generation, Lizenzschlüssel (kann Zugangsdaten der Paketquelle
 * tragen). Werden genauso wenig ausgeliefert.
 */
export const SONSTIGE_GEHEIME_SETTINGS = ['authPasswordHash', 'sessionGeneration', 'lizenzSchluessel']

/** Alles, was `GET /api/db/settings` und das Backup nie im Wert zeigen. */
export const GEHEIME_SETTINGS = [...VERSCHLUESSELTE_SETTINGS, ...SONSTIGE_GEHEIME_SETTINGS]

/**
 * Felder, die bestimmen, WOHIN Geheimnisse gehen, oder die den Zugang selbst
 * steuern. Ein Backup-Import übernimmt sie nicht (A2-09): ein fremdes
 * „Vorlagen"-Backup leitete sonst Alarme und — über die KI-Adressen —
 * gespeicherte Schlüssel an Fremde um. Und die generische Settings-Route
 * schreibt sie nicht (A2-05c/A2-24): Adressen gehen über ihre eigenen,
 * prüfenden Routen.
 */
export const ZIEL_SETTINGS = [...new Set([
    ...KI_URL_SPALTEN, 'aiOllamaUrl',
    'mailHost', 'mailPort', 'mailUser', 'mailSicherheit', 'mailVon', 'mailAn',
])]

/** Zugangs- und Rechtsstand: nie aus einem Backup. */
export const ZUGANGS_SETTINGS = ['authEnabled', 'rechtlichesZustimmung', 'quellenOhneFreigabe']

/** Beim Backup-Import immer den bestehenden Wert behalten. */
export const BEHALTEN_BEIM_IMPORT = [...new Set([
    ...GEHEIME_SETTINGS, ...ZIEL_SETTINGS, ...ZUGANGS_SETTINGS,
    // Polygon-/Databento-Schlüssel stehen in `apis` (JSON).
    'apis',
])]

/** Börsen-Konfigurationstabellen mit ihren verschlüsselten Spalten. */
export const BOERSEN_GEHEIMNISSE = {
    bitunix_config: ['apiKey', 'secretKey'],
    bitget_config: ['apiKey', 'secretKey', 'passphrase'],
    pionex_config: ['apiKey', 'secretKey'],
}

/**
 * Alle verschlüsselten Stellen als [tabelle, spalten] — für die Umschlüsselung
 * und die Schlüssel-Migration nativer Installationen.
 */
export const ALLE_VERSCHLUESSELTEN = [
    ['settings', VERSCHLUESSELTE_SETTINGS],
    ...Object.entries(BOERSEN_GEHEIMNISSE),
]

/** Namensmuster, das der Selbsttest als „sieht geheim aus" wertet. */
export const VERDAECHTIG = /key|token|pass|secret|webhook|rpc|hash|lizenz/i
