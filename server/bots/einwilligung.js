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

export const FASSUNG = '1.2 vom 11.11.2026'

/**
 * Gegliedert, damit die Oberfläche die Punkte einzeln zeigen kann; Fassung und
 * Hash laufen über den daraus gebauten Klartext (`einwilligungsText`).
 */
const TEXT = {
    de: {
        titel: 'Bot-Steuerung in AutarkTrade — Einwilligung',
        einleitung: 'Mit der Bot-Steuerung ändert AutarkTrade deine Pionex-Bots über deinen eigenen API-Schlüssel: Einstellungen, Marge, Stop-Loss und Take-Profit, Pausieren, Beenden und Neustart.',
        punkte: [
            { symbol: 'hakenKreis', titel: 'Nur auf deinen Klick', text: 'Die App tut nur, was du im Einzelfall auslöst und bestätigst. Nichts läuft automatisch.' },
            { symbol: 'blitz', titel: 'Sofort und endgültig', text: 'Pionex führt jede Änderung sofort und unwiderruflich aus. Beim Ändern des Bands oder Beenden wird zum Marktpreis gehandelt. Mit Hebel ist ein Totalverlust möglich.' },
            { symbol: 'ki', titel: 'Rückblick und KI sind keine Prognose', text: 'Simulationen rechnen mit vergangenen Kursen, KI-Vorschläge können falsch sein. Beides ist keine Anlageberatung.' },
            { symbol: 'schluessel', titel: 'Dein Schlüssel', text: 'Lege den API-Schlüssel ohne Auszahlungsrecht und mit IP-Freigabe an.' },
            { symbol: 'waage', titel: 'Dein Risiko', text: 'Du entscheidest selbst. Für Verluste haften die Entwickler von AutarkTrade nicht, ausser bei Absicht oder grober Fahrlässigkeit.' },
        ],
    },
    en: {
        titel: 'Bot control in AutarkTrade — consent',
        einleitung: 'With bot control AutarkTrade changes your Pionex bots through your own API key: settings, margin, stop loss and take profit, pausing, closing and starting.',
        punkte: [
            { symbol: 'hakenKreis', titel: 'Only on your click', text: 'The app only does what you trigger and confirm yourself, one change at a time. Nothing runs automatically.' },
            { symbol: 'blitz', titel: 'Immediate and final', text: 'Pionex executes every change immediately and irrevocably. Changing the range or closing trades at market price. With leverage a total loss is possible.' },
            { symbol: 'ki', titel: 'Hindsight and AI are no forecast', text: 'Simulations use past prices, AI suggestions can be wrong. Neither is investment advice.' },
            { symbol: 'schluessel', titel: 'Your key', text: 'Create the API key without withdrawal permission and with an IP whitelist.' },
            { symbol: 'waage', titel: 'Your risk', text: 'You decide yourself. The developers of AutarkTrade are not liable for losses, except for intent or gross negligence.' },
        ],
    },
}

/** Haken vor jeder einzelnen Änderung (nie vorausgefüllt). */
const HAKEN = {
    de: 'Ich habe diese Änderung geprüft, will sie jetzt an Pionex senden und trage das Risiko selbst.',
    en: 'I have checked this change, want to send it to Pionex now and bear the risk myself.',
}

/** Warnblock im Wortlaut des Entwicklers, vor jedem Senden. */
const WARNUNG = {
    de: ['KI kann Fehler machen.', 'KI kann halluzinieren.', 'KI-Verwendung kann zu Verlusten führen.', 'KI kann keinen Kaffee holen.'],
    en: ['AI can make mistakes.', 'AI can hallucinate.', 'Using AI can lead to losses.', 'AI cannot fetch coffee.'],
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

const klartext = (t) => [t.titel, `${t === TEXT.en ? 'Version' : 'Fassung'} ${FASSUNG}`, '', t.einleitung, '', ...t.punkte.map((p, i) => `${i + 1}. ${p.titel}: ${p.text}`)].join('\n')

export function einwilligungsText(sprache = 'de') { return klartext(TEXT[sprache] || TEXT.de) }
/** Dasselbe gegliedert für die Anzeige: {titel, einleitung, punkte:[{symbol, titel, text}]}. */
export function einwilligungsTeile(sprache = 'de') { return { ...(TEXT[sprache] || TEXT.de), fassung: FASSUNG } }
export function hakenText(sprache = 'de') { return HAKEN[sprache] || HAKEN.de }
export function warnung(sprache = 'de') { return WARNUNG[sprache] || WARNUNG.de }

/** Hash über BEIDE Sprachfassungen: eine Zustimmung gilt für die Fassung, nicht für eine Übersetzung. */
export function fassungHash() { return sha(klartext(TEXT.de) + '\n---\n' + klartext(TEXT.en)) }
export function hakenHash(text) { return sha(String(text || '')) }

/** Ist eine gespeicherte Zustimmung {fassung, hash, zeit} für den heutigen Text gültig? */
export function zustimmungGueltig(z) {
    return !!(z && z.fassung === FASSUNG && z.hash === fassungHash() && Number(z.zeit) > 0)
}

/** Ist der übermittelte Haken-Text einer der gültigen (de/en)? */
export function hakenGueltig(text) {
    return Object.values(HAKEN).includes(String(text || ''))
}
