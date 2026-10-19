/**
 * Testbetrieb (`AT_TESTBETRIEB=1`).
 *
 * Die V2-Testinstanz läuft gegen eine KOPIE der Live-Datenbank. Darin stehen
 * echte Börsenschlüssel, offene Live-Positionen, Benachrichtigungskanäle und
 * KI-Schlüssel mit Guthaben. In der eigenen Datenbank ist die Testinstanz
 * zudem der einzige Bewerber um jede Führungssperre (`db-claim.js`) — ohne
 * diesen Schalter würde sie also ALLES tun, was sonst die NAS tut: Strategien
 * fahren, Lageberichte bezahlen, Mails verschicken.
 *
 * Im Testbetrieb gilt deshalb:
 *   - kein Hintergrund-Takt startet (Liste in index.mjs, über `starteTakte`),
 *     ebenso Strategie-Engine und Rekorder;
 *   - keine Mail, kein Push (ntfy/Telegram/Webhook): `versandGesperrt()` wird
 *     am Transport geprüft, nicht an jedem Aufrufer;
 *   - was ein Mensch per Knopf auslöst (Scan, Lagebericht, Analyse), läuft —
 *     wer drückt, will es und sieht die Kosten.
 */
import { istTestbetrieb } from './umgebung.js'

export { istTestbetrieb }

/**
 * Startet die übergebenen Takte — oder im Testbetrieb keinen davon.
 *
 * @param {Array<[string, Function]>} takte  Name und Startfunktion
 * @param {object} [opt]
 * @param {boolean} [opt.testbetrieb]  Vorgabe: aus der Umgebung
 * @param {Function} [opt.log]
 * @returns {{gestartet: string[], aus: string[]}}
 */
export function starteTakte(takte, { testbetrieb = istTestbetrieb(), log = console.log } = {}) {
    const gestartet = []
    const aus = []
    for (const [name, start] of takte) {
        if (testbetrieb) {
            aus.push(name)
            continue
        }
        start()
        gestartet.push(name)
    }
    if (aus.length) {
        log(` -> Testbetrieb: ${aus.length} Takte NICHT gestartet (${aus.join(', ')})`)
    }
    return { gestartet, aus }
}

/** true, wenn keine Mail und kein Push hinausgehen darf. */
export function versandGesperrt() {
    return istTestbetrieb()
}

/** Fehler für einen gesperrten Versand — ein Knopf zeigt ihn dem Nutzer. */
export function versandSperrFehler() {
    const e = new Error('Testbetrieb: Versand von Mails und Push-Nachrichten ist gesperrt.')
    e.testbetrieb = true
    return e
}
