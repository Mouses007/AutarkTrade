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
 * Selbsttest (`__selftest-f2-sicherheit.mjs`) schlägt an, sobald eine Spalte
 * mit verdächtigem Namen — in IRGENDEINER Tabelle, auch deutsch benannt
 * (`…Geheimnis`, `…Schluessel`) — weder hier steht noch in `OHNE_GEHEIMNIS`
 * begründet ist (`fehlendeGeheimnisse`, Audit SEC-S3-003).
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
    // Nur-Anzeige-Schlüssel der ESP32-Displays (SEC-GER-001): gilt nur für /api/esp32/display.
    'esp32AnzeigeKey',
    'cryptoquantApiKey', 'mailPasswort',
    // Hype-Radar: Zustellgeheimnisse und Zusatzquellen. Die Webhook-Adresse
    // gehört dazu: bei Home Assistant IST die Adresse das Geheimnis.
    'hypeAlarmNtfyToken', 'hypeAlarmTelegramToken', 'hypeAlarmWebhookUrl',
    'hypeKeySolanaRpc', 'hypeKeyCoingecko', 'hypeKeyCryptopanic', 'hypeKeyLunarcrush',
    // Zweiter Faktor: Geheimnis der Authenticator-App (wer es hat, erzeugt die Codes).
    'totpGeheimnis',
])]

/**
 * Geheim, aber kein umkehrbar verschlüsselter Schlüssel: Passwort-Hash,
 * Sitzungs-Generation, Lizenzschlüssel (kann Zugangsdaten der Paketquelle
 * tragen). Werden genauso wenig ausgeliefert.
 */
export const SONSTIGE_GEHEIME_SETTINGS = [
    'authPasswordHash', 'sessionGeneration', 'lizenzSchluessel', 'esp32PushGeraete',
    // Zweiter Faktor: zuletzt angenommener Code-Schritt und eingelöste
    // YubiKey-Challenges. Kein Schlüssel, verrät aber, wann sich jemand anmeldete.
    'totpLetzterSchritt', 'webauthnVerbraucht',
    // Kontoweite Code-Bremse (Audit 4.3.4 SEC-S1-003): verrät Angriffe und
    // darf aus keinem Backup zurückkommen (eine alte Sperre bzw. ein Nullstand).
    'totpFehlZahl', 'totpFehlAb', 'totpSperreBis',
]

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
    // Handy-Geräte der Sofort-Zustellung (Adresse + Auth-Geheimnis): nur über /api/esp32/push
    'esp32PushGeraete',
])]

/** Zugangs- und Rechtsstand: nie aus einem Backup. */
// `schluesselDirekt` (SEC-S1-002): passwortloser YubiKey-Login, nur über seine eigene Route mit Passwort.
export const ZUGANGS_SETTINGS = ['authEnabled', 'rechtlichesZustimmung', 'quellenOhneFreigabe', 'totpAn', 'schluesselDirekt']

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
 * Portfolio-Modus: verschlüsselte Spalten mit ihrer Schlüsselspalte
 * (Audit SEC-SRV-015). `portfolio_schluessel` hat keine `id`, ihr
 * Primärschlüssel ist `name` (bitpanda | etherscan | solanaRpc). Bis zum
 * Audit vom 26.10.2026 fehlten beide Tabellen hier — nach einer Rotation von
 * `AT_SECRET` waren Bitpanda-/Etherscan-Schlüssel, Wallet-Adressen und xpubs
 * still unlesbar (`decrypt` liefert dann ''). Im Backup wie die Börsenschlüssel:
 * redigiert hinaus, beim Import bleiben die bestehenden Zeilen (FUN-BAK-001).
 */
export const PORTFOLIO_GEHEIMNISSE = [
    ['portfolio_schluessel', ['wert'], 'name'],
    ['portfolio_adressen', ['adresse'], 'id'],
]

/**
 * HTTPS (`server/tls/dienst.js`): private Schlüssel der eigenen Stamm-CA und
 * des Server-Zertifikats. Die Tabelle steht NICHT im Backup (`backup-api.js`,
 * `BACKUP_TABLES`) — wer den CA-Schlüssel hat, kann jedem Gerät, das ihr
 * vertraut, jede Seite vorspielen. Hier steht sie, damit Umschlüsselung und
 * Start-Migration die Spalten mitnehmen.
 */
export const TLS_GEHEIMNISSE = [
    ['tls_zertifikat', ['caSchluessel', 'serverSchluessel'], 'id'],
]

/**
 * Zweiter Faktor (`server/migrationen/zweifaktor.js`): registrierte YubiKeys
 * bzw. Passkeys. Nichts darin ist verschlüsselt — ein öffentlicher Schlüssel
 * ist öffentlich —, aber wer hier eine Zeile einschleust, meldet sich mit
 * seinem eigenen Schlüssel ohne Passwort an. Deshalb steht die Tabelle wie
 * `tls_zertifikat` NICHT in `BACKUP_TABLES` und NICHT in `VALID_TABLES`;
 * geschrieben wird sie nur über `/api/auth/schluessel/*` (`auth.js`). Die
 * Rücksetzwege (Reset, Deaktivieren, AT_RESET_AUTH) leeren sie.
 */
export const ZUGANGS_TABELLEN = ['auth_schluessel']

/**
 * Alle verschlüsselten Stellen als [tabelle, spalten, schluesselSpalte] — für
 * die Umschlüsselung und die Schlüssel-Migration nativer Installationen.
 * Fehlt die Schlüsselspalte, ist es `id`.
 */
export const ALLE_VERSCHLUESSELTEN = [
    ['settings', VERSCHLUESSELTE_SETTINGS, 'id'],
    ...Object.entries(BOERSEN_GEHEIMNISSE).map(([t, sp]) => [t, sp, 'id']),
    ...PORTFOLIO_GEHEIMNISSE,
    ...TLS_GEHEIMNISSE,
]

/**
 * Verschlüsselte Werte INNERHALB einer JSON-Spalte: [tabelle, spalte, feld].
 * `settings.apis` ist eine Liste `[{provider, key}]` (Polygon, Databento);
 * verschlüsselt ist nur `key`, nicht die ganze Spalte — deshalb steht sie
 * nicht in ALLE_VERSCHLUESSELTEN (die Migration verschlüsselte sonst den
 * ganzen JSON-Text). Umschlüsselung und Start-Migration lesen beide Listen.
 */
export const JSON_GEHEIMNISSE = [
    ['settings', 'apis', 'key'],
]

/**
 * Namensmuster, das der Selbsttest als „sieht geheim aus" wertet. Bis zum
 * Audit 4.3.4 (SEC-S3-003) nur englische Wörter: `totpGeheimnis`,
 * `caSchluessel` oder eine künftige `pushGeheimnis` rutschten durch, und
 * gescannt wurde nur `settings` (später auch `portfolio_*`).
 */
export const VERDAECHTIG = /key|token|pass|secret|webhook|rpc|hash|lizenz|geheim|schluessel|totp|webauthn|credential|session/i

/** Zähl- und Budgetfelder der KI-Abrechnung: „Tokens" ist hier eine Menge, kein Zugang. */
export const KEIN_GEHEIMNIS_MUSTER = /Tokens$|TokenBudget$/i

/**
 * Spalten, deren Name verdächtig klingt, die aber nichts Geheimes tragen —
 * `tabelle.spalte` mit Grund. Eine neue Spalte kommt hier nur mit Begründung
 * hinein; sonst gehört sie in eine der Listen oben.
 */
export const OHNE_GEHEIMNIS = new Map([
    ['settings.totpAn', 'Schalter, ob der zweite Faktor an ist'],
    ['settings.schluesselDirekt', 'Schalter für den Direkt-Login mit YubiKey (Zugangsfeld, nie aus dem Backup)'],
    ['ai_agent_messages.sessionId', 'Gesprächs-Kennung des KI-Agenten, keine Anmeldung'],
    ['api_cache.key', 'Name des Zwischenspeicher-Eintrags'],
    ['radar_fetch_state.key', 'Name der periodischen Aufgabe'],
    ['coinradar_settings.schluessel', 'Name der Einstellung (Schlüssel-Wert-Tabelle)'],
    ['hype_settings.schluessel', 'Name der Einstellung; Zustellgeheimnisse liegen in settings.hype*'],
    ['hype_projekt.schluessel', 'chain|contract bzw. sym|SYMBOL, öffentlich'],
    ['quiz_karten.schluessel', 'stabiler Name einer eingebauten Karte'],
    ['portfolio_kurse.schluessel', 'Asset bzw. Währungspaar'],
    ['portfolio_bewegungen.txHash', 'öffentliche Transaktionskennung'],
    ['coinradar_zeilen.atrPct', 'ATR in Prozent (trifft „rpc")'],
    ['radar_ergebnisse.atrPct', 'ATR in Prozent (trifft „rpc")'],
])

/**
 * Spalten mit Geheimnis-Namen, die in keiner Liste stehen. `tabellen` ist
 * `{tabelle: [spalten]}` aus der echten Datenbank. Gelistet heisst: in
 * `settings` unter `GEHEIME_SETTINGS`, sonst in `ALLE_VERSCHLUESSELTEN` oder
 * `JSON_GEHEIMNISSE`, oder die ganze Tabelle ist eine `ZUGANGS_TABELLEN`.
 * @returns {string[]} `tabelle.spalte`
 */
export function fehlendeGeheimnisse(tabellen) {
    const fehlen = []
    for (const [tabelle, spalten] of Object.entries(tabellen)) {
        if (ZUGANGS_TABELLEN.includes(tabelle)) continue
        for (const s of spalten) {
            if (!VERDAECHTIG.test(s) || KEIN_GEHEIMNIS_MUSTER.test(s)) continue
            const name = `${tabelle}.${s}`
            if (OHNE_GEHEIMNIS.has(name)) continue
            const gelistet = tabelle === 'settings'
                ? GEHEIME_SETTINGS.includes(s)
                : ALLE_VERSCHLUESSELTEN.some(([t, sp]) => t === tabelle && sp.includes(s))
                    || JSON_GEHEIMNISSE.some(([t, sp]) => t === tabelle && sp === s)
            if (!gelistet) fehlen.push(name)
        }
    }
    return fehlen
}
