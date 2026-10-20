/**
 * Umgebungsvariablen von AutarkTrade.
 *
 * Der neue Name ist `AT_<NAME>`. Installationen aus der Zeit vor der Umbenennung
 * setzen noch `CTJ_<NAME>` (Docker-Compose-Dateien, NAS-Container, Startskripte) —
 * die bleiben lesbar, sonst startet ein bestehender Container nach dem Update ohne
 * Secret und alle gespeicherten Börsenschlüssel sind unlesbar.
 *
 * Gelesen wird bei jedem Aufruf, nicht beim Laden des Moduls: die Selbsttests
 * setzen Variablen zur Laufzeit und erwarten, dass das wirkt.
 *
 * `AT_` gewinnt, auch wenn es leer ist? Nein: ein leerer Wert gilt als nicht
 * gesetzt, so wie `process.env.X || …` es vorher auch behandelt hat.
 */

/*
 * Sicherheitsschalter fallen NICHT auf `CTJ_` zurück, sobald `AT_X` überhaupt
 * gesetzt ist — auch leer (Audit A2-30, F2 20.10.2026). Sonst wirkte ein
 * altes `CTJ_RESET_AUTH=1` aus einer früheren Compose-Datei weiter, obwohl die
 * neue `AT_RESET_AUTH=` ausdrücklich leer setzt — und schaltete das Gate bei
 * jedem Start ab. Fehlt `AT_X` ganz, gilt `CTJ_X` weiter (alte Installationen
 * dürfen beim Update nicht anders starten), wird beim Start aber laut gemeldet.
 */
export const SICHERHEITS_SCHALTER = ['ALLOW_INSECURE', 'RESET_AUTH', 'TRUST_PROXY', 'TRUSTED_PROXY', 'ALLOWED_HOSTS']

export function umgebung(name, vorgabe = undefined) {
    const neu = process.env['AT_' + name]
    if (neu !== undefined && neu !== '') return neu
    if (neu !== undefined && SICHERHEITS_SCHALTER.includes(name)) return vorgabe
    const alt = process.env['CTJ_' + name]
    if (alt !== undefined && alt !== '') return alt
    return vorgabe
}

/**
 * Welche Sicherheitsschalter kommen gerade aus einem alten `CTJ_`-Namen?
 * Für die laute Meldung beim Start.
 *
 * @returns {string[]} z. B. ['CTJ_ALLOW_INSECURE=1']
 */
export function alteSicherheitsSchalter() {
    return SICHERHEITS_SCHALTER
        .filter((n) => process.env['AT_' + n] === undefined
            && process.env['CTJ_' + n] !== undefined && process.env['CTJ_' + n] !== '')
        .map((n) => `CTJ_${n}=${process.env['CTJ_' + n]}`)
}

/** true, wenn die Variable genau '1' ist (Schalter wie AT_NO_ENGINE). */
export function umgebungAn(name) {
    return umgebung(name) === '1'
}

/**
 * Testbetrieb: die V2-Testinstanz läuft gegen eine KOPIE der Live-DB. Darin
 * stehen echte Börsenschlüssel, offene Positionen und Benachrichtigungskanäle.
 * Im Testbetrieb startet kein Hintergrund-Takt, kein Rekorder, keine Engine,
 * und es geht keine Mail und kein Push hinaus. Was ein
 * Mensch per Knopf auslöst, läuft weiter.
 */
export function istTestbetrieb() {
    return umgebungAn('TESTBETRIEB')
}
