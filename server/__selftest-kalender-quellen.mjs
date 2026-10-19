/**
 * Selbsttest der S12-Quellenumstellung im Marktradar-Bereich.
 *
 *   node server/__selftest-kalender-quellen.mjs
 *
 * Drei Dinge, die sich im Betrieb nicht von selbst verraten:
 *
 * 1. **Amtliche Kalender lesen** (`kalender-quellen.js`). Die Formen sind
 *    gemessen (19.10.2026): BEA faltet lange Titel mitten im Wort und maskiert
 *    Kommas, Eurostat liefert nur ein Datum und Kategorien mit maskiertem
 *    Komma, die Fed Ortszeit New York. Ein Fehler in der Zeitzone verschiebt
 *    jeden Termin um eine oder zwei Stunden — plausibel aussehend und falsch.
 * 2. **„Quelle aus" ist kein Ausfall** (`ausCache`). Ein abgeschalteter
 *    CoinGecko-Schlüssel darf nicht als „gestört, hier der Altstand" enden —
 *    sonst zeigte die Kachel nach dem Abschalten weiter alte Zahlen.
 * 3. **Regenbogen auf kürzerer Reihe** (`wochenpunkte`, `regression`): der
 *    jüngste Tag muss in der Stichprobe sein, sonst steht „jetzt" auf einem
 *    bis zu sechs Tage alten Kurs.
 *
 * Kein Netz.
 */

import {
    leseIcs, leseIcsZeit, beaBedeutung, beaTermine, eurostatTermine, fedTermine,
    EUROSTAT_AUSWAHL, KALENDER_QUELLEN,
} from './kalender-quellen.js'
import { ausCache, _cacheZuruecksetzen, wochenpunkte, regression } from './marktradar-api.js'
import { QuelleAus } from './quellen/aus.js'

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const iso = (ms) => new Date(ms).toISOString()

console.log('iCalendar lesen')
{
    // Wortgetreu nach BEA (CRLF, Faltung mitten im Wort, maskiertes Komma)
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0',
        'BEGIN:VEVENT',
        'SUMMARY:Gross Domestic Product\\, 4th Quarter and Year 2024 (Advance Estima',
        ' te)',
        'DTSTART;VALUE=DATE-TIME:20250130T133000Z',
        'UID:abc',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:ohne Start',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n')
    const e = leseIcs(ics)
    pruefe('gefaltete Zeile wird zusammengesetzt, Komma entmaskiert',
        e[0]?.titel === 'Gross Domestic Product, 4th Quarter and Year 2024 (Advance Estimate)', e[0]?.titel)
    pruefe('UTC-Zeit wird gelesen', iso(e[0].start) === '2025-01-30T13:30:00.000Z')
    pruefe('Termin ohne Start fällt weg', e.length === 1)

    pruefe('reines Datum → ganztags, Mitternacht UTC',
        leseIcsZeit('VALUE=DATE', '20261104').ganztags === true
        && iso(leseIcsZeit('VALUE=DATE', '20261104').ms) === '2026-11-04T00:00:00.000Z')
    pruefe('Ortszeit mit TZID (Sommerzeit Luxemburg = UTC+2)',
        iso(leseIcsZeit('TZID=Europe/Luxembourg', '20260716T110000').ms) === '2026-07-16T09:00:00.000Z')
    pruefe('Unsinn → null', leseIcsZeit('', 'gestern') === null)
}

console.log('\nBEA')
{
    pruefe('BIP hoch', beaBedeutung('GDP (Advance Estimate), 3rd Quarter 2026') === 'high')
    pruefe('Einkommen/Ausgaben (PCE) hoch', beaBedeutung('Personal Income and Outlays, September 2026') === 'high')
    pruefe('Handelsbilanz mittel', beaBedeutung('U.S. International Trade in Goods and Services, August 2026') === 'medium')
    pruefe('BIP der Bundesstaaten NICHT hoch (Gegenprobe)',
        beaBedeutung('Gross Domestic Product by State and Personal Income by State, 2nd Quarter 2026') === 'low')
    pruefe('Unbekanntes niedrig', beaBedeutung('Services Supplied Through Affiliates, 2024') === 'low')

    const ics = ['BEGIN:VEVENT', 'SUMMARY:GDP (Advance Estimate)\\, 3rd Quarter 2026',
        'DTSTART:20261029T123000Z', 'END:VEVENT',
        'BEGIN:VEVENT', 'SUMMARY:Alt', 'DTSTART:20250101T133000Z', 'END:VEVENT'].join('\n')
    const t = beaTermine(ics, { von: Date.UTC(2026, 0, 1) })
    pruefe('Fenster schneidet Vergangenes ab', t.length === 1)
    pruefe('Zeile trägt Land, Quelle und Bedeutung',
        t[0].land === 'USD' && t[0].quelle === 'bea' && t[0].impact === 'high' && iso(t[0].dateUnix) === '2026-10-29T12:30:00.000Z')
}

console.log('\nEurostat')
{
    const ev = (titel, datum, kat = 'Purple Category,Data release\\,Euro indicators release') =>
        ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${datum}`, `SUMMARY:${titel}`, `X-CATEGORY:${kat}`, 'END:VEVENT'].join('\n')
    const ics = [
        ev('Flash estimate inflation euro area', '20261104'),          // Winterzeit
        ev('Inflation (HICP)', '20260716'),                             // Sommerzeit
        ev('Air transport', '20261104'),                                // nicht ausgewählt
        ev('Industrial production', '20261116', 'Statistics Explained'), // gleichnamiger Artikel
    ].join('\n')
    const t = eurostatTermine(ics)
    pruefe('nur ausgewählte Euro-Indikatoren', t.length === 2, String(t.length))
    const flash = t.find(x => x.titel.startsWith('Flash'))
    const hicp = t.find(x => x.titel.startsWith('Inflation'))
    pruefe('11:00 Luxemburg im Winter = 10:00 UTC', iso(flash.dateUnix) === '2026-11-04T10:00:00.000Z', iso(flash.dateUnix))
    pruefe('11:00 Luxemburg im Sommer = 09:00 UTC', iso(hicp.dateUnix) === '2026-07-16T09:00:00.000Z', iso(hicp.dateUnix))
    pruefe('Schnellschätzung Inflation hoch, Land EUR, Quelle eurostat',
        flash.impact === 'high' && flash.land === 'EUR' && flash.quelle === 'eurostat')
    pruefe('Auswahl kennt jede Stufe nur aus high/medium/low',
        Object.values(EUROSTAT_AUSWAHL).every(v => ['high', 'medium', 'low'].includes(v)))
}

console.log('\nFed')
{
    const json = {
        events: [
            { type: 'FOMC', title: 'FOMC Meeting', month: '2026-12', days: '8-9', time: '2:00 p.m.' },
            { type: 'Beige', title: 'Beige Book', month: '2026-07', days: '15', time: '2:00 p.m.' },
            { type: 'Speech', title: 'Rede', month: '2026-12', days: '1', time: '9:00 a.m.' },
        ],
    }
    const t = fedTermine(json)
    pruefe('Reden fallen weg', t.length === 2)
    const fomc = t.find(x => x.titel === 'FOMC Meeting')
    pruefe('mehrtägige Sitzung zählt am letzten Tag, 14:00 New York im Winter = 19:00 UTC',
        iso(fomc.dateUnix) === '2026-12-09T19:00:00.000Z', iso(fomc.dateUnix))
    pruefe('Sommerzeit New York: 14:00 = 18:00 UTC',
        iso(t.find(x => x.titel === 'Beige Book').dateUnix) === '2026-07-15T18:00:00.000Z')
    pruefe('Fenster gilt auch hier', fedTermine(json, { von: Date.UTC(2026, 11, 1) }).length === 1)
}

console.log('\nPflicht-Quellenangaben')
{
    pruefe('jede Kalenderquelle hat Name, Link und Art „quelle"',
        Object.values(KALENDER_QUELLEN).every(q => q.name && /^https:\/\//.test(q.url) && q.art === 'quelle'))
    pruefe('Fed mit dem Wortlaut, den sie erbittet', KALENDER_QUELLEN.fed.name === 'Federal Reserve Board')
}

console.log('\n„Quelle aus" im Zwischenspeicher')
{
    _cacheZuruecksetzen()
    await ausCache('s12', 1, async () => ({ wert: 1 }))
    await new Promise(r => setTimeout(r, 5))
    let geworfen = null
    try {
        await ausCache('s12', 1, async () => { throw new QuelleAus('CoinGecko', 'schluesselFehlt') })
    } catch (e) { geworfen = e }
    pruefe('abgeschaltete Quelle wirft durch, statt den Altstand zu liefern',
        geworfen?.code === 'quelleAus' && geworfen.grund === 'schluesselFehlt')
    let rufe = 0
    const r = await ausCache('s12', 10000, async () => { rufe++; return { wert: 2 } })
    pruefe('… und hinterlässt keine Sperrfrist (der nächste Abruf läuft sofort)', rufe === 1 && r.wert === 2)
}

console.log('\nRegenbogen auf Tageskerzen ab 2017')
{
    const tag = 86400000
    const reihe = Array.from({ length: 30 }, (_, i) => ({ t: Date.UTC(2020, 0, 1) + i * tag, p: 100 + i }))
    const w = wochenpunkte(reihe)
    pruefe('jüngster Tag ist immer dabei', w[w.length - 1].t === reihe[reihe.length - 1].t)
    pruefe('Abstand eine Woche', w.length === 5 && w[1].t - w[0].t === 7 * tag, String(w.length))

    // Exakte Potenzkurve: p = e^b · x^a → Regression trifft a und b, Streuung 0
    const G = Date.UTC(2009, 0, 3)
    const a = 4.4, b = -27
    const kurve = Array.from({ length: 50 }, (_, i) => {
        const t = Date.UTC(2017, 7, 17) + i * 60 * tag
        return { t, p: Math.exp(a * Math.log((t - G) / tag) + b) }
    })
    const reg = regression(kurve)
    pruefe('Regression trifft Steigung und Achsenabschnitt',
        Math.abs(reg.a - a) < 1e-6 && Math.abs(reg.b - b) < 1e-5, `${reg.a} ${reg.b}`)
    pruefe('Reststreuung einer exakten Kurve ist 0', reg.s < 1e-6)
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
