/**
 * Chart-Alarme im Browser, die reine Logik hinter Store und Alarm-Reiter:
 * welche Verlaufseinträge als Hinweis erscheinen und welche Alarme
 * „Ausgelöste entfernen" löschen darf. Ohne Vue und axios, damit es sich
 * prüfen lässt (`src/utils/__selftest-chart-alarm-hinweise.mjs`).
 */

export const hinweisSchluessel = (id, t) => `${id}-${t}`

/**
 * Eine echte Auslösung? Schaltet sich ein Alarm selbst ab (Linie endet, Profil
 * geändert, Watchlist leer, Box ungültig), schreibt der Server einen Eintrag
 * mit `hinweis` — teils mit Kurs `p`, aber nie mit einer Meldung. Vorher
 * zählte ein solcher Eintrag mit `p` als Auslösung, und der Browser meldete
 * „kreuzt Linie — 77645.1", obwohl nie gekreuzt wurde (Audit FUN-F2B-001).
 */
export const istAusloesung = (v) => v != null && Number.isFinite(v.t) && !v.hinweis

/**
 * Neue Auslösungen in einer Antwort von `/api/chart/alarme`: jeder Eintrag
 * jünger als `ab`, dessen Schlüssel (Alarm-id + Zeit) noch nicht gesehen ist.
 *
 * Gemerkt wird je Eintrag, nicht eine Zeitmarke über alle Alarme: der Server
 * schreibt den Verlauf erst nach der Zustellung, ein zweiter Alarm desselben
 * Takts (gleiches `t`) oder ein Preisalarm hinter einem jüngeren
 * Momentum-Eintrag kam deshalb oft nach einem Abruf an, der schon eine
 * spätere Zeit gesehen hatte — und fehlte bis zum Neuladen (Audit FUN-F2B-002).
 *
 * @param {Array} alarme   Antwort des Servers
 * @param {Set} gesehen    Schlüssel aus dem letzten Abruf
 * @param {number} ab      ältere Einträge zählen nie (Rückblick nach dem Öffnen)
 * @returns {{ neu: Array<{ a, v }>, gesehen: Set }} `gesehen` enthält nur Schlüssel,
 *   die in der Antwort noch stehen — die Menge wächst so nicht über den Verlauf hinaus.
 */
export function findeNeue(alarme, gesehen, ab) {
    const neu = []
    const jetzt = new Set()
    for (const a of alarme || []) {
        for (const v of a?.verlauf || []) {
            if (!(v?.t > ab)) continue
            const k = hinweisSchluessel(a.id, v.t)
            jetzt.add(k)
            if (gesehen.has(k) || !istAusloesung(v)) continue
            neu.push({ a, v })
        }
    }
    return { neu, gesehen: jetzt }
}

/**
 * Reihenfolge der Abrufe: eine Antwort, die von einem später gestarteten Abruf
 * schon überholt wurde, wird verworfen. Sonst ersetzte ihr älterer Stand die
 * gemerkten Schlüssel (`findeNeue` gibt nur die der Antwort zurück), und der
 * nächste Abruf meldete eine schon gezeigte Auslösung ein zweites Mal — etwa
 * wenn der Zehn-Sekunden-Takt und `ladeAlarme()` aus einem Fehlerpfad
 * gleichzeitig laufen (Audit FUN-F2B-002, Nachbesserung).
 *
 * `beginne()` vor dem Abruf, `uebernimm(n)` mit dessen Nummer nach der Antwort:
 * true, solange keine jüngere Antwort schon übernommen ist. Scheitert ein
 * jüngerer Abruf, zählt die ältere Antwort weiterhin.
 */
export function abrufFolge() {
    let vergeben = 0
    let uebernommen = 0
    return {
        beginne: () => ++vergeben,
        uebernimm(n) {
            if (n <= uebernommen) return false
            uebernommen = n
            return true
        },
    }
}

/**
 * Darf „Ausgelöste entfernen" diesen Alarm löschen? Nur, wenn er ausgelöst und
 * sich DESHALB selbst abgeschaltet hat (einmalige, LSOB-Box nach dem Bruch) —
 * der Server vermerkt das in `selbstAus`. Ein von Hand pausierter
 * wiederholender Alarm, der früher schon ausgelöst hat, bleibt; vorher wurde
 * er mitgelöscht, samt Watchlists und Notiz (Audit FUN-F2B-003).
 */
export const wischbar = (a) => !a.aktiv && a.selbstAus === 'ausgeloest'
