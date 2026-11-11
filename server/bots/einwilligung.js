/**
 * Einwilligung zur Bot-Steuerung — eigener Text, getrennt vom allgemeinen
 * Haftungsausschluss (rechtliche Recherche 11.11.2026: eine eigene, nicht
 * vorausgefüllte Zustimmung beim Einschalten der Funktion, dazu ein Haken vor
 * JEDER einzelnen Änderung). Rein, ohne Netz.
 *
 * Die Fassung steht im Text; ändert sich der Text, ändert sich der Hash, und
 * eine früher gegebene Zustimmung gilt nicht mehr (`zustimmungGueltig`).
 * Keine Rechtsberatung: ob die Texte im Streitfall standhalten, kann nur eine
 * Anwältin oder ein Anwalt beurteilen (`reports/bot-steuerung-rechtslage-2026-11-11.md`).
 */
import crypto from 'node:crypto'

export const FASSUNG = '1.0 vom 11.11.2026'

const TEXT = {
    de: [
        'Bot-Steuerung in AutarkTrade — Einwilligung',
        `Fassung ${FASSUNG}`,
        '',
        'Mit der Bot-Steuerung kann diese App Einstellungen deiner Pionex-Bots über deinen eigenen API-Schlüssel ändern, Marge hinzufügen oder abziehen, Stop-Loss und Take-Profit setzen, Bots pausieren, fortsetzen, beenden und neu starten.',
        '',
        '1. Jede Änderung führt die App nur aus, wenn du sie im Einzelfall auslöst und vorher bestätigst. Nichts läuft automatisch.',
        '2. Pionex führt eine gesendete Änderung sofort und unwiderruflich aus. Beim Ändern des Bands oder Beenden wird zum Marktpreis gehandelt; dabei können Verluste realisiert werden.',
        '3. Grid-Bots mit Hebel können bis zur Liquidation verlieren. Ein Totalverlust des eingesetzten Kapitals ist möglich.',
        '4. Simulationen sind Rückblicke auf vergangene Kurse und Modelle mit Näherungen (Gebühren, Funding, Ausführung). Sie sagen nicht voraus, was der Kurs macht.',
        '5. KI-Vorschläge sind KI-generiert. KI kann Fehler machen und Dinge erfinden; KI-Verwendung kann zu Verlusten führen. Vorschläge sind keine Anlageberatung.',
        '6. Die Verbindung zu Pionex kann ausfallen oder verzögert sein, und Pionex kann seine Schnittstelle ändern. Darauf hat AutarkTrade keinen Einfluss.',
        '7. Du bist für deinen API-Schlüssel verantwortlich. Lege ihn ohne Auszahlungsrecht und mit IP-Freigabe an.',
        '8. Du prüfst jede Änderung selbst und triffst jede Entscheidung selbst. Die Nutzung erfolgt auf eigenes Risiko. Die Entwickler von AutarkTrade haften für Verluste aus der Bot-Steuerung nicht, soweit das Gesetz es zulässt.',
        '',
        'AutarkTrade ist freie Software (AGPL-3.0-or-later) ohne Gewährleistung, siehe Haftungsausschluss.',
    ],
    en: [
        'Bot control in AutarkTrade — consent',
        `Version ${FASSUNG}`,
        '',
        'With bot control this app can change settings of your Pionex bots through your own API key, add or remove margin, set stop loss and take profit, pause, resume, close and start bots.',
        '',
        '1. The app carries out a change only when you trigger it individually and confirm it beforehand. Nothing runs automatically.',
        '2. Pionex executes a sent change immediately and irrevocably. Changing the range or closing trades at market price; losses can be realised.',
        '3. Leveraged grid bots can lose up to liquidation. A total loss of the capital used is possible.',
        '4. Simulations look back at past prices and are models with approximations (fees, funding, execution). They do not predict what the price will do.',
        '5. AI suggestions are AI-generated. AI can make mistakes and invent things; using AI can lead to losses. Suggestions are not investment advice.',
        '6. The connection to Pionex can fail or be delayed, and Pionex can change its interface. AutarkTrade has no influence on this.',
        '7. You are responsible for your API key. Create it without withdrawal permission and with an IP whitelist.',
        '8. You check every change yourself and make every decision yourself. Use is at your own risk. The developers of AutarkTrade are not liable for losses from bot control, to the extent the law permits.',
        '',
        'AutarkTrade is free software (AGPL-3.0-or-later) without warranty, see the disclaimer.',
    ],
}

/** Haken vor jeder einzelnen Änderung (nie vorausgefüllt). */
const HAKEN = {
    de: 'Ich habe diese Änderung geprüft und will sie jetzt an Pionex senden. Ich trage die volle Verantwortung dafür; die Entwickler von AutarkTrade haften nicht, soweit das Gesetz es zulässt.',
    en: 'I have checked this change and want to send it to Pionex now. I bear full responsibility for it; the developers of AutarkTrade are not liable, to the extent the law permits.',
}

/** Warnblock im Wortlaut des Entwicklers, vor jedem Senden. */
const WARNUNG = {
    de: ['KI kann Fehler machen.', 'KI kann halluzinieren.', 'KI-Verwendung kann zu Verlusten führen.', 'KI kann keinen Kaffee holen.'],
    en: ['AI can make mistakes.', 'AI can hallucinate.', 'Using AI can lead to losses.', 'AI cannot fetch coffee.'],
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

export function einwilligungsText(sprache = 'de') { return (TEXT[sprache] || TEXT.de).join('\n') }
export function hakenText(sprache = 'de') { return HAKEN[sprache] || HAKEN.de }
export function warnung(sprache = 'de') { return WARNUNG[sprache] || WARNUNG.de }

/** Hash über BEIDE Sprachfassungen: eine Zustimmung gilt für die Fassung, nicht für eine Übersetzung. */
export function fassungHash() { return sha(TEXT.de.join('\n') + '\n---\n' + TEXT.en.join('\n')) }
export function hakenHash(text) { return sha(String(text || '')) }

/** Ist eine gespeicherte Zustimmung {fassung, hash, zeit} für den heutigen Text gültig? */
export function zustimmungGueltig(z) {
    return !!(z && z.fassung === FASSUNG && z.hash === fassungHash() && Number(z.zeit) > 0)
}

/** Ist der übermittelte Haken-Text einer der gültigen (de/en)? */
export function hakenGueltig(text) {
    return Object.values(HAKEN).includes(String(text || ''))
}
