/**
 * Selbsttest: Lagebericht „an bestimmten Tagen".
 *
 * Läuft ohne Netz und ohne Datenbank. Geprüft werden die Tagesliste
 * (`shared/news-tage.js`), die Tagesprüfung des Takts (`sollBerichtLaufen`
 * mit `rhythmus: 'tage'`) — auch über die Zeitzone des Journals, so wie
 * `startNewsTakt` die Ortszeit bildet —, das Berichtsfenster über die Lücke
 * seit dem vorigen gewählten Tag, und dass täglich/wöchentlich/manuell
 * unverändert bleiben.
 *
 * Aufruf: node server/__selftest-news-tage.mjs
 */
import { leseTage, tageText, tageSeitVorigem, wochentagNr, TAGE_VORGABE } from '../shared/news-tage.js'
import { readFileSync } from 'node:fs'
import {
    sollBerichtLaufen, leseRhythmus, berichtLueckeTage, aktualitaetFuer,
    sollUpdateLaufen, faelligerUpdatePlatz, basisTaugtFuerUpdate, leseUpdateStunden, UPDATE_SCHLUESSEL,
} from './marktradar-news.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Lagebericht an bestimmten Tagen')

/** Ortszeit-Datum (Monat 1-basiert). 17.08.2026 ist ein Montag. */
const zeit = (jahr, monat, tag, stunde, minute = 0) => new Date(jahr, monat - 1, tag, stunde, minute)
/** Genau wie der Takt: UTC-Zeitpunkt → Wanduhr der Journal-Zeitzone. */
const lokalIn = (iso, zone) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: zone }))

// ── 1) Tagesliste lesen und schreiben ────────────────────────────────────
pruefe('CSV sortiert, ohne Dubletten', JSON.stringify(leseTage('5,1,3,1')) === '[1,3,5]')
pruefe('Ungültiges fällt weg', JSON.stringify(leseTage('0, 8, x, 2.5, , 7')) === '[7]')
pruefe('leer → leere Liste', leseTage('').length === 0 && leseTage(null).length === 0)
pruefe('Liste → CSV', tageText([5, 3, 1]) === '1,3,5')
pruefe('leere Liste → leerer Text', tageText([]) === '')
pruefe('Vorgabe ist Mo–Fr', TAGE_VORGABE === '1,2,3,4,5')
pruefe('Wochentag Montag = 1', wochentagNr(zeit(2026, 8, 17, 12)) === 1)
pruefe('Wochentag Sonntag = 7', wochentagNr(zeit(2026, 8, 23, 12)) === 7)

// ── 2) Rhythmus wird erkannt, die alten bleiben ──────────────────────────
pruefe('„tage" ist ein gültiger Rhythmus', leseRhythmus('tage') === 'tage')
pruefe('täglich bleibt täglich', leseRhythmus('taeglich') === 'taeglich')
pruefe('wöchentlich bleibt', leseRhythmus('woechentlich') === 'woechentlich')
pruefe('manuell bleibt', leseRhythmus('manuell') === 'manuell')
pruefe('Unbekanntes ist täglich', leseRhythmus('irgendwas') === 'taeglich')

// ── 3) Tagesprüfung: Mo/Mi/Fr ────────────────────────────────────────────
const moMiFr = '1,3,5'
const soll = (tag, stunde, tage, s = 12) =>
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, tag, stunde), stunde: s, rhythmus: 'tage', tage })
pruefe('Mo/Mi/Fr: Montag zur Stunde ja', soll(17, 12, moMiFr) === true)
pruefe('Mo/Mi/Fr: Montag vor der Stunde nein', soll(17, 11, moMiFr) === false)
pruefe('Mo/Mi/Fr: Dienstag nein', soll(18, 12, moMiFr) === false)
pruefe('Mo/Mi/Fr: Mittwoch ja', soll(19, 15, moMiFr) === true)
pruefe('Mo/Mi/Fr: Donnerstag nein', soll(20, 12, moMiFr) === false)
pruefe('Mo/Mi/Fr: Freitag ja', soll(21, 23, moMiFr) === true)
pruefe('Mo/Mi/Fr: Samstag nein', soll(22, 12, moMiFr) === false)
pruefe('Mo/Mi/Fr: Sonntag nein', soll(23, 12, moMiFr) === false)

// ── 4) Mo–Fr ohne Wochenende, als Liste übergeben ────────────────────────
const werktage = [1, 2, 3, 4, 5]
const treffer = [17, 18, 19, 20, 21, 22, 23].filter(tag => soll(tag, 12, werktage))
pruefe('Mo–Fr: genau die fünf Werktage', JSON.stringify(treffer) === '[17,18,19,20,21]', JSON.stringify(treffer))
pruefe('nur Sonntag: nur der Sonntag',
    JSON.stringify([17, 18, 19, 20, 21, 22, 23].filter(tag => soll(tag, 12, '7'))) === '[23]')
pruefe('ohne Tage läuft nichts', [17, 18, 19, 20, 21, 22, 23].every(tag => !soll(tag, 12, '')))
pruefe('„tage" ignoriert den Wochentag des wöchentlichen Berichts',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 18, 12), stunde: 12, rhythmus: 'tage', wochentag: 2, tage: '1' }) === false)

// ── 5) Über die Zeitzone ─────────────────────────────────────────────────
// So 16.08.2026 23:30 UTC = Mo 01:30 in Brüssel (MESZ, +2) und So 19:30 in New York.
pruefe('Brüssel: in UTC noch Sonntag, lokal schon Montag → ja',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-08-16T23:30:00Z', 'Europe/Brussels'), stunde: 1, rhythmus: 'tage', tage: '1,2,3,4,5' }) === true)
pruefe('UTC selbst: Sonntag → nein',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-08-16T23:30:00Z', 'UTC'), stunde: 1, rhythmus: 'tage', tage: '1,2,3,4,5' }) === false)
// Mo 17.08.2026 02:00 UTC = So 22:00 in New York (EDT, −4).
pruefe('New York: in UTC Montag, lokal noch Sonntag → nein',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-08-17T02:00:00Z', 'America/New_York'), stunde: 20, rhythmus: 'tage', tage: '1,2,3,4,5' }) === false)
// Sa 22.08.2026 03:00 UTC = Fr 23:00 in New York → Freitag zählt noch.
pruefe('New York: in UTC Samstag, lokal Freitag 23 Uhr → ja',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-08-22T03:00:00Z', 'America/New_York'), stunde: 12, rhythmus: 'tage', tage: '1,3,5' }) === true)
// Winterzeit: Mo 26.10.2026 (nach der Umstellung am 25.10.) 23:30 UTC = Di 00:30 in Brüssel (+1).
pruefe('Brüssel Winterzeit: Montag 23:30 UTC ist lokal Dienstag → bei Mo/Mi/Fr nein',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-10-26T23:30:00Z', 'Europe/Brussels'), stunde: 0, rhythmus: 'tage', tage: '1,3,5' }) === false)
// Tokio (+9): Fr 21.08.2026 16:00 UTC = Sa 01:00 → bei Mo–Fr nein.
pruefe('Tokio: in UTC Freitag, lokal Samstag → nein',
    sollBerichtLaufen({ jetztLokal: lokalIn('2026-08-21T16:00:00Z', 'Asia/Tokyo'), stunde: 0, rhythmus: 'tage', tage: '1,2,3,4,5' }) === false)

// ── 6) Lücke seit dem vorigen gewählten Tag ──────────────────────────────
pruefe('Mo–Fr: Montag blickt 3 Tage zurück (Wochenende)', tageSeitVorigem('1,2,3,4,5', 1) === 3)
pruefe('Mo–Fr: Dienstag 1 Tag', tageSeitVorigem('1,2,3,4,5', 2) === 1)
pruefe('Mo/Mi/Fr: Mittwoch 2 Tage', tageSeitVorigem('1,3,5', 3) === 2)
pruefe('Mo/Mi/Fr: Montag 3 Tage', tageSeitVorigem('1,3,5', 1) === 3)
pruefe('nur Mittwoch: eine Woche', tageSeitVorigem('3', 3) === 7)
pruefe('alle Tage: 1', tageSeitVorigem('1,2,3,4,5,6,7', 4) === 1)
pruefe('Sonntag → Montag über die Wochengrenze', tageSeitVorigem('7', 1) === 1)
pruefe('Montag → Sonntag', tageSeitVorigem([1], 7) === 6)
pruefe('ohne Tage: 1', tageSeitVorigem('', 3) === 1)

pruefe('Lücke: täglich 1', berichtLueckeTage({ rhythmus: 'taeglich', jetztLokal: zeit(2026, 8, 17, 12) }) === 1)
pruefe('Lücke: wöchentlich 7', berichtLueckeTage({ rhythmus: 'woechentlich', jetztLokal: zeit(2026, 8, 17, 12) }) === 7)
pruefe('Lücke: tage Mo–Fr am Montag 3',
    berichtLueckeTage({ rhythmus: 'tage', tage: '1,2,3,4,5', jetztLokal: zeit(2026, 8, 17, 12) }) === 3)
pruefe('Lücke: tage Mo–Fr am Donnerstag 1',
    berichtLueckeTage({ rhythmus: 'tage', tage: '1,2,3,4,5', jetztLokal: zeit(2026, 8, 20, 12) }) === 1)

pruefe('Recherche: tage mit Lücke 1 bleibt „day"', aktualitaetFuer({ thema: 'crypto', rhythmus: 'tage', luecke: 1 }) === 'day')
pruefe('Recherche: Montag nach Wochenende „week"', aktualitaetFuer({ thema: 'crypto', rhythmus: 'tage', luecke: 3 }) === 'week')
pruefe('Recherche: täglich unverändert „day"', aktualitaetFuer({ thema: 'crypto', rhythmus: 'taeglich' }) === 'day')
pruefe('Recherche: Zwischenmeldung immer „day"', aktualitaetFuer({ thema: 'crypto', rhythmus: 'tage', luecke: 3, istUpdate: true }) === 'day')

// ── 7) Die bestehenden Rhythmen laufen unverändert ───────────────────────
pruefe('täglich: jeder Tag zur Stunde',
    [17, 18, 19, 20, 21, 22, 23].every(tag => sollBerichtLaufen({ jetztLokal: zeit(2026, 8, tag, 12), stunde: 12, rhythmus: 'taeglich', tage: '1' })))
pruefe('wöchentlich: nur der Wochentag, Tage-Liste egal',
    JSON.stringify([17, 18, 19, 20, 21, 22, 23].filter(tag =>
        sollBerichtLaufen({ jetztLokal: zeit(2026, 8, tag, 12), stunde: 12, rhythmus: 'woechentlich', wochentag: 3, tage: '1,2' }))) === '[19]')
pruefe('manuell: nie, auch mit Tagen',
    [17, 18, 19, 20, 21, 22, 23].every(tag => !sollBerichtLaufen({ jetztLokal: zeit(2026, 8, tag, 12), stunde: 12, rhythmus: 'manuell', tage: '1,2,3,4,5,6,7' })))

// ── 8) Zwischenmeldungen nur an gewählten Tagen (Audit FUN-R-401) ────────
{
    const moFr = '1,2,3,4,5'
    // 21.08.2026 = Freitag, 22. = Samstag, 23. = Sonntag, 24. = Montag
    pruefe('Zwischenmeldung: Freitag (gewählt) ja', sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 21, 18), rhythmus: 'tage', tage: moFr }) === true)
    pruefe('Zwischenmeldung: Samstag (abgewählt) nein', sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 22, 18), rhythmus: 'tage', tage: moFr }) === false)
    pruefe('Zwischenmeldung: Sonntag (abgewählt) nein', sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 23, 21), rhythmus: 'tage', tage: [1, 2, 3, 4, 5] }) === false)
    pruefe('Zwischenmeldung: Samstag mit Vollbericht von heute ja',
        sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 22, 18), rhythmus: 'tage', tage: moFr, berichtHeute: true }) === true)
    pruefe('Zwischenmeldung: ohne gültigen Tag nie', sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 19, 18), rhythmus: 'tage', tage: '' }) === false)
    pruefe('Zwischenmeldung: täglich und wöchentlich unverändert jeden Tag',
        [17, 18, 19, 20, 21, 22, 23].every(tag => sollUpdateLaufen({ jetztLokal: zeit(2026, 8, tag, 18), rhythmus: 'taeglich', tage: '1' })
            && sollUpdateLaufen({ jetztLokal: zeit(2026, 8, tag, 18), rhythmus: 'woechentlich', tage: '1' })))
    pruefe('Zwischenmeldung: manuell nie, auch mit Bericht von heute',
        sollUpdateLaufen({ jetztLokal: zeit(2026, 8, 19, 18), rhythmus: 'manuell', tage: moFr, berichtHeute: true }) === false)

    /*
     * Der Takt, nachgestellt mit den reinen Entscheidungsfunktionen (kein
     * KI-Abruf, keine Datenbank): Mo–Fr, Bericht 10 Uhr, Zwischenmeldungen
     * 18 und 21 Uhr, alle zehn Minuten von Donnerstag bis Dienstag.
     */
    const nachgestellt = (mitTagespruefung) => {
        const stunden = leseUpdateStunden('18,21', 2)
        const anspruch = {}
        const laeufe = []
        let letzter = 0
        let vollAm = ''
        for (let t = zeit(2026, 8, 20, 0, 5).getTime(); t < zeit(2026, 8, 26, 0, 0).getTime(); t += 600000) {
            const lokal = new Date(t)
            const tag = lokal.toDateString()
            const lauf = (schluessel, art) => {
                if (anspruch[schluessel] === tag) return false
                anspruch[schluessel] = tag; letzter = t + 120000
                laeufe.push(`${wochentagNr(lokal)}-${art}`)
                return true
            }
            if (sollBerichtLaufen({ jetztLokal: lokal, stunde: 10, rhythmus: 'tage', tage: moFr })) {
                if (lauf('bericht', 'B')) { vollAm = tag; continue }
            }
            const platz = faelligerUpdatePlatz({ jetztLokal: lokal, stunden })
            if (!platz) continue
            if (mitTagespruefung && !sollUpdateLaufen({ jetztLokal: lokal, rhythmus: 'tage', tage: moFr, berichtHeute: vollAm === tag })) continue
            if (letzter && basisTaugtFuerUpdate({ basisAm: letzter, jetzt: t, rhythmus: 'tage' })) lauf(UPDATE_SCHLUESSEL(platz), `U${platz}`)
        }
        return laeufe
    }
    const alt = nachgestellt(false)
    const neu = nachgestellt(true)
    pruefe('Gegenprobe: ohne Tagesprüfung läuft die Kette am Wochenende weiter (der Befund)',
        alt.filter(l => /^[67]-U/.test(l)).length === 4, alt.join(' '))
    pruefe('Takt Mo–Fr: Sa/So keine Zwischenmeldung', !neu.some(l => /^[67]-/.test(l)), neu.join(' '))
    pruefe('Takt Mo–Fr: werktags je ein Bericht und zwei Zwischenmeldungen',
        neu.join(' ') === '4-B 4-U1 4-U2 5-B 5-U1 5-U2 1-B 1-U1 1-U2 2-B 2-U1 2-U2', neu.join(' '))

    // Die Prüfung muss auch wirklich im Takt stehen, vor dem bezahlten Lauf.
    const quelle = readFileSync(new URL('./marktradar-news.js', import.meta.url), 'utf8')
    const takt = quelle.slice(quelle.indexOf('export function startNewsTakt'))
    const iPruef = takt.indexOf('sollUpdateLaufen(')
    const iLauf = takt.indexOf('erzeugeLagebericht({ aktualisierung: true')
    pruefe('startNewsTakt fragt sollUpdateLaufen vor der Zwischenmeldung', iPruef > 0 && iLauf > iPruef && /if \(!erlaubt\) return/.test(takt.slice(iPruef, iLauf)))
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
