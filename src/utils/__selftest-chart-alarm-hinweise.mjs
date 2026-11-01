/**
 * Selbsttest: welche Alarm-Einträge der Browser meldet und welche Alarme
 * „Ausgelöste entfernen" löscht (Audit FUN-F2B-001/-002/-003);
 * überholte Abrufe melden nichts doppelt.
 *
 *   node src/utils/__selftest-chart-alarm-hinweise.mjs
 *
 * Die Einträge sind so gebaut, wie `server/chart-alarme.js` sie schreibt.
 */

import { abrufFolge, findeNeue, istAusloesung, wischbar } from './chart/alarmHinweise.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const T = 1_790_000_000_000
const AB = T - 6 * 3_600_000
const titel = (r) => r.neu.map(({ v }) => v.titel || v.hinweis)

console.log('\nSelbstabschaltung ist keine Auslösung (FUN-F2B-001)\n')
{
    const daten = [
        { id: 7, verlauf: [{ t: T, p: 77645.1, hinweis: 'geometrieEndet' }] },
        { id: 8, verlauf: [{ t: T + 1, p: 3012.5, hinweis: 'profilGeaendert' }] },
        { id: 9, verlauf: [{ t: T + 2, hinweis: 'watchlistLeer' }] },
        { id: 10, verlauf: [{ t: T + 3, p: 1.2, hinweis: 'boxUngueltig' }] },
    ]
    const r = findeNeue(daten, new Set(), AB)
    check('Linie endet / Profil geändert mit Kurs → kein Hinweis', r.neu.length === 0, JSON.stringify(titel(r)))
    check('echte Auslösung ohne Text (alter Eintrag) zählt', istAusloesung({ t: T, p: 100 }))
    check('Eintrag ohne Zeit zählt nicht', !istAusloesung({ p: 100 }))
}

console.log('\nNichts geht verloren, nichts doppelt (FUN-F2B-002)\n')
{
    const e = (t, titel) => ({ t, p: 1, titel, text: titel })
    const A = { id: 2, verlauf: [] }
    const B = { id: 1, verlauf: [] }
    let g = new Set()
    // gleicher Takt: A ist geschrieben, B noch nicht
    A.verlauf = [e(T, 'A')]
    let r = findeNeue([A, B], g, AB); g = r.gesehen
    check('erster Abruf meldet A', titel(r).join() === 'A')
    B.verlauf = [e(T, 'B')]
    r = findeNeue([A, B], g, AB); g = r.gesehen
    check('B mit gleichem t kommt nach dem Abruf → trotzdem gemeldet', titel(r).join() === 'B', JSON.stringify(titel(r)))
    r = findeNeue([A, B], g, AB); g = r.gesehen
    check('dritter Abruf meldet nichts doppelt', r.neu.length === 0)
    // jüngerer Momentum-Eintrag vor einem älteren Preis-Eintrag
    const M = { id: 3, verlauf: [e(T + 22_000, 'M')] }
    const P = { id: 4, verlauf: [] }
    r = findeNeue([P, M, A, B], g, AB); g = r.gesehen
    check('Momentum gemeldet', titel(r).join() === 'M')
    P.verlauf = [e(T + 20_000, 'P')]
    r = findeNeue([P, M, A, B], g, AB); g = r.gesehen
    check('älteres t hinter jüngerem gesehenen → trotzdem gemeldet', titel(r).join() === 'P', JSON.stringify(titel(r)))
    check('vor dem Rückblick liegt nichts', findeNeue([{ id: 5, verlauf: [e(AB, 'alt')] }], new Set(), AB).neu.length === 0)
    const weg = findeNeue([A], g, AB).gesehen
    check('gemerkte Schlüssel wachsen nicht über die Antwort hinaus', weg.size === 1, String(weg.size))
}

console.log('\nÜberholte Abrufe melden nichts doppelt (FUN-F2B-002, Nachbesserung)\n')
{
    // So wie `ladeAlarme()` im Store: Nummer vor dem Abruf, Antwort nur übernehmen, wenn nicht überholt.
    const folge = abrufFolge()
    let g = new Set()
    const gemeldet = []
    const antwort = (n, daten) => {
        if (!folge.uebernimm(n)) return
        const r = findeNeue(daten, g, AB); g = r.gesehen
        gemeldet.push(...titel(r))
    }
    const alt = [{ id: 2, verlauf: [] }]
    const neu = [{ id: 2, verlauf: [{ t: T, p: 1, titel: 'BTC', text: 'BTC' }] }]
    const n1 = folge.beginne()          // Takt startet, Antwort noch alt
    const n2 = folge.beginne()          // Fehlerpfad startet, Antwort schon mit BTC
    antwort(n2, neu)                    // kommt zuerst an
    antwort(n1, alt)                    // überholt — darf `gesehen` nicht zurücksetzen
    antwort(folge.beginne(), neu)       // nächster Takt
    check('BTC genau einmal gemeldet', gemeldet.join() === 'BTC', JSON.stringify(gemeldet))
    const f = abrufFolge()
    const a = f.beginne(); f.beginne()  // der jüngere scheitert und meldet sich nie
    check('ältere Antwort zählt, wenn die jüngere ausbleibt', f.uebernimm(a))
    const b = f.beginne()
    check('der Reihe nach angekommene Antworten zählen alle', f.uebernimm(b))
}

console.log('\n„Ausgelöste entfernen" (FUN-F2B-003)\n')
{
    check('einmalig ausgelöst, selbst aus → wird gelöscht', wischbar({ aktiv: false, einmalig: true, anzahlAusgeloest: 1, selbstAus: 'ausgeloest' }))
    check('wiederholend, 3× ausgelöst, von Hand pausiert → bleibt',
        !wischbar({ aktiv: false, einmalig: false, anzahlAusgeloest: 3, ausgeloestAm: T, selbstAus: null }))
    check('früher ausgelöst, dann Linie zu Ende → bleibt', !wischbar({ aktiv: false, anzahlAusgeloest: 2, ausgeloestAm: T, selbstAus: 'geometrieEndet' }))
    check('aktiv → bleibt', !wischbar({ aktiv: true, selbstAus: 'ausgeloest' }))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
process.exit(fehlgeschlagen ? 1 : 0)
