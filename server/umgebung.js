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

export function umgebung(name, vorgabe = undefined) {
    const neu = process.env['AT_' + name]
    if (neu !== undefined && neu !== '') return neu
    const alt = process.env['CTJ_' + name]
    if (alt !== undefined && alt !== '') return alt
    return vorgabe
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
