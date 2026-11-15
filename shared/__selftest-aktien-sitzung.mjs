/**
 * Selbsttest: Börsensitzungen für Aktien-Futures.
 *
 *   node shared/__selftest-aktien-sitzung.mjs
 */
import assert from 'node:assert/strict'
import { nyTeile, feiertage, istHandelstag, sitzungVon, handelstagVon, handelstagBeginn, regimeWechsel, sitzungsBilanz, REGIME_STICHTAGE, verkuerzteTage, istVerkuerzt } from './aktien-sitzung.js'

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

// ── Verkürzte Handelstage (Schluss 13:00) — Kalender der NYSE 2025 bis 2028 ──
const kurz = (jahr) => [...verkuerzteTage(jahr)].sort().join(',')
gleich(kurz(2025), '2025-07-03,2025-11-28,2025-12-24', '2025: 3. Juli, Tag nach Thanksgiving, Heiligabend')
gleich(kurz(2026), '2026-11-27,2026-12-24', '2026: 4. Juli am Samstag → 3. Juli ist der Feiertag, der 2. Juli ein voller Tag')
gleich(kurz(2027), '2027-11-26', '2027: 4. Juli am Sonntag, Weihnachten am Samstag → nur der Tag nach Thanksgiving')
gleich(kurz(2028), '2028-07-03,2028-11-24', '2028: 3. Juli am Montag; der 24.12. ist ein Sonntag')
gleich(kurz(2023), '2023-07-03,2023-11-24', '2023: Heiligabend am Sonntag')
gleich(kurz(2020), '2020-11-27,2020-12-24', '2020: wie 2026')
ok(istVerkuerzt('2026-11-27') && !istVerkuerzt('2026-07-02') && !istVerkuerzt('2026-11-26'), 'istVerkuerzt; ein Feiertag ist kein verkürzter Tag')
for (const j of [2019, 2021, 2022, 2024, 2029, 2030]) {
    ok([...verkuerzteTage(j)].every((d) => !feiertage(j).has(d) && new Date(d + 'T12:00Z').getUTCDay() % 6 !== 0), `${j}: verkürzte Tage sind Handelstage`)
}
// Freitag, 27.11.2026 (Winterzeit: New York = UTC − 5)
gleich(sitzungVon(utc(2026, 10, 27, 14, 30)), 'regulaer', 'verkürzt: 09:30 regulär')
gleich(sitzungVon(utc(2026, 10, 27, 17, 59)), 'regulaer', 'verkürzt: 12:59 noch regulär')
gleich(sitzungVon(utc(2026, 10, 27, 18, 0)), 'nach', 'verkürzt: 13:00 ist nachbörslich')
gleich(sitzungVon(utc(2026, 10, 27, 21, 59)), 'nach', 'verkürzt: 16:59 noch nachbörslich')
gleich(sitzungVon(utc(2026, 10, 27, 22, 0)), 'nacht', 'verkürzt: ab 17:00 ist keine US-Börse mehr offen')
gleich(sitzungVon(utc(2026, 10, 28, 1, 0)), 'wochenende', 'verkürzt: 20:00 beginnt das Wochenende wie immer')
gleich(sitzungVon(utc(2026, 10, 27, 14, 29)), 'vor', 'verkürzt: vorbörslich unverändert')
gleich(sitzungVon(utc(2026, 10, 25, 20, 0)), 'regulaer', 'Gegenprobe: Mittwoch davor 15:00 ist regulär')
// Donnerstag, 3.7.2025 (Sommerzeit: New York = UTC − 4)
gleich(sitzungVon(utc(2025, 6, 3, 16, 59)), 'regulaer', '3.7.2025 12:59 regulär')
gleich(sitzungVon(utc(2025, 6, 3, 17, 0)), 'nach', '3.7.2025 13:00 nachbörslich')
gleich(sitzungVon(utc(2026, 6, 2, 19, 0)), 'regulaer', '2.7.2026 15:00: voller Handelstag')
gleich(sitzungVon(utc(2026, 11, 24, 18, 30)), 'nach', 'Heiligabend 2026 13:30 nachbörslich')
gleich(handelstagBeginn(utc(2026, 10, 27, 22, 30)), utc(2026, 10, 27, 1, 0), 'verkürzter Tag: der Handelstag selbst endet weiter um 20:00')

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
