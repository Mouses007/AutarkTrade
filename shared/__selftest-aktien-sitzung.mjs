/**
 * Selbsttest: Börsensitzungen für Aktien-Futures.
 *
 *   node shared/__selftest-aktien-sitzung.mjs
 */
import assert from 'node:assert/strict'
import { nyTeile, feiertage, istHandelstag, sitzungVon, handelstagVon, handelstagBeginn, regimeWechsel, sitzungsBilanz, REGIME_STICHTAGE } from './aktien-sitzung.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const gleich = (a, b, text) => { assert.equal(a, b, text); n++ }
const utc = (...a) => Date.UTC(...a)

// ── Wanduhr, Winter- und Sommerzeit ──
gleich(nyTeile(utc(2026, 10, 13, 15, 0)).minuten, 600, 'Winter: 15:00 UTC = 10:00 New York')
gleich(nyTeile(utc(2026, 6, 1, 13, 30)).minuten, 570, 'Sommer: 13:30 UTC = 09:30 New York')
gleich(nyTeile(utc(2026, 10, 14, 1, 0)).datum, '2026-11-13', 'Datum in New York, nicht in UTC')
gleich(nyTeile(utc(2026, 10, 15, 12, 0)).wochentag, 0, 'Sonntag')

// ── Feiertage 2026 (NYSE-Kalender) ──
const f26 = feiertage(2026)
for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']) {
    ok(f26.has(d), `Feiertag ${d}`)
}
gleich(f26.size, 10, 'genau zehn Feiertage 2026')
ok(!f26.has('2026-07-04'), '4. Juli auf Samstag: begangen am Freitag davor')
ok(feiertage(2027).has('2027-12-24') && !feiertage(2027).has('2027-12-25'), 'Weihnachten 2027 am Samstag → Freitag')
ok(!feiertage(2027).has('2027-12-31') && !feiertage(2028).has('2028-01-01'), 'Neujahr am Samstag: kein Ersatztag')
ok(feiertage(2023).has('2023-01-02'), 'Neujahr am Sonntag → Montag')
ok(feiertage(2022).has('2022-06-20') && feiertage(2021).size === 9, 'Juneteenth erst seit 2022')
ok(istHandelstag('2026-11-13', 5) && !istHandelstag('2026-11-14', 6) && !istHandelstag('2026-11-26', 4), 'Handelstag, Samstag, Thanksgiving')

// ── Sitzungen ──
gleich(sitzungVon(utc(2026, 10, 13, 15, 0)), 'regulaer', 'Freitag 10:00')
gleich(sitzungVon(utc(2026, 10, 13, 14, 29)), 'vor', '09:29 ist noch vorbörslich')
gleich(sitzungVon(utc(2026, 10, 13, 14, 30)), 'regulaer', '09:30 ist regulär')
gleich(sitzungVon(utc(2026, 10, 13, 21, 0)), 'nach', '16:00 ist nachbörslich')
gleich(sitzungVon(utc(2026, 10, 13, 8, 59)), 'nacht', '03:59 ist Nacht')
gleich(sitzungVon(utc(2026, 10, 13, 9, 0)), 'vor', '04:00 ist vorbörslich')
gleich(sitzungVon(utc(2026, 10, 12, 1, 0)), 'nacht', 'Mittwoch 20:00 gehört zum Donnerstag')
gleich(sitzungVon(utc(2026, 10, 14, 0, 59)), 'nach', 'Freitag 19:59')
gleich(sitzungVon(utc(2026, 10, 14, 1, 0)), 'wochenende', 'Freitag 20:00 beginnt das Wochenende')
gleich(sitzungVon(utc(2026, 10, 15, 12, 0)), 'wochenende', 'Sonntagmittag')
gleich(sitzungVon(utc(2026, 10, 16, 0, 59)), 'wochenende', 'Sonntag 19:59')
gleich(sitzungVon(utc(2026, 10, 16, 1, 0)), 'nacht', 'Sonntag 20:00 gehört zum Montag')
gleich(sitzungVon(utc(2026, 6, 1, 13, 29)), 'vor', 'Sommerzeit: 09:29')
gleich(sitzungVon(utc(2026, 6, 1, 13, 30)), 'regulaer', 'Sommerzeit: 09:30')
gleich(sitzungVon(utc(2026, 8, 7, 15, 0)), 'feiertag', 'Labor Day mittags')
gleich(sitzungVon(utc(2026, 8, 7, 0, 30)), 'feiertag', 'Sonntagabend vor Labor Day')
gleich(sitzungVon(utc(2026, 8, 8, 0, 0)), 'nacht', 'Labor Day 20:00 gehört zum Dienstag')

// ── Handelstag und sein Beginn ──
gleich(handelstagVon(utc(2026, 10, 13, 15, 0)), '2026-11-13', 'Handelstag am Tag')
gleich(handelstagVon(utc(2026, 10, 12, 1, 0)), '2026-11-12', 'ab 20:00 der Folgetag')
gleich(handelstagBeginn(utc(2026, 10, 13, 15, 0)), utc(2026, 10, 13, 1, 0), 'Beginn: Vorabend 20:00 (Winter)')
gleich(handelstagBeginn(utc(2026, 10, 13, 1, 0)), utc(2026, 10, 13, 1, 0), 'genau 20:00 ist der Beginn selbst')
gleich(handelstagBeginn(utc(2026, 10, 13, 0, 59)), utc(2026, 10, 12, 1, 0), 'eine Minute davor: der Vortag')
gleich(handelstagBeginn(utc(2026, 6, 1, 15, 0)), utc(2026, 6, 1, 0, 0), 'Beginn: Vorabend 20:00 (Sommer)')
gleich(handelstagBeginn(utc(2026, 2, 8, 14, 0)), utc(2026, 2, 8, 1, 0), 'über die Umstellung auf Sommerzeit')
gleich(handelstagBeginn(utc(2026, 10, 1, 15, 0)), utc(2026, 10, 1, 0, 0), 'über die Umstellung auf Winterzeit')
gleich(handelstagBeginn(utc(2026, 10, 13, 15, 0, 37, 500)), utc(2026, 10, 13, 1, 0), 'Sekunden zählen nicht')

// ── Stichtage ──
ok(regimeWechsel('bitget', utc(2026, 0, 1), utc(2026, 5, 1)).ganzDavor === false, 'Zeitraum überspannt den Stichtag')
ok(regimeWechsel('bitget', utc(2025, 0, 1), utc(2026, 0, 1)).ganzDavor === true, 'Zeitraum ganz davor')
ok(regimeWechsel('bitget', utc(2026, 5, 1), utc(2026, 9, 1)) === null && regimeWechsel('kraken', 0, 1) === null, 'danach oder unbekannte Börse: null')
ok(REGIME_STICHTAGE.binance > REGIME_STICHTAGE.bitget && REGIME_STICHTAGE.bitunix > REGIME_STICHTAGE.binance, 'Reihenfolge der Stichtage')

// ── Auswertung ──
const bilanz = sitzungsBilanz([
    { sitzung: 'wochenende', netPnl: -5, rMultiple: -1 },
    { sitzung: 'regulaer', netPnl: 10, rMultiple: 2 },
    { sitzung: 'regulaer', netPnl: -4, rMultiple: -1 },
    { netPnl: 99, rMultiple: 9 },
])
ok(bilanz.length === 2 && bilanz[0].sitzung === 'regulaer' && bilanz[1].sitzung === 'wochenende', 'nur belegte Sitzungen, regulär zuerst')
ok(bilanz[0].trades === 2 && bilanz[0].gewinner === 1 && bilanz[0].netPnl === 6 && bilanz[0].summeR === 1, 'Summen je Sitzung')
ok(sitzungsBilanz().length === 0, 'ohne Trades leer')

console.log(`✓ Aktien-Sitzungen: ${n} Prüfungen`)
