/**
 * Selbsttest: Börsensitzungen für Aktien-Futures.
 *
 *   node shared/__selftest-aktien-sitzung.mjs
 */
import assert from 'node:assert/strict'
import { kalenderTageNY, nyTeile, feiertage, istHandelstag, sitzungVon, handelstagVon, handelstagBeginn, regimeWechsel, sitzungsBilanz, REGIME_STICHTAGE, verkuerzteTage, istVerkuerzt,
    sitzungenDerKerze, kerzeBeruehrtRegulaer, einstiegRegulaer, sitzungsRegelAnwendbar } from './aktien-sitzung.js'

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

// ── Ausserplanmässige Schliessungen ──
ok(feiertage(2025).has('2025-01-09') && feiertage(2025).size === 11, 'Staatstrauer 9.1.2025 zählt als Feiertag')
gleich(sitzungVon(utc(2025, 0, 9, 15, 0)), 'feiertag', '9.1.2025 10:00: geschlossen')
gleich(sitzungVon(utc(2025, 0, 10, 15, 0)), 'regulaer', 'der Tag danach ist ein Handelstag')
ok(feiertage(2012).has('2012-10-29') && feiertage(2012).has('2012-10-30'), 'Hurrikan Sandy: zwei Tage')

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

// ── Kerze und Sitzung: die Regel hinter «nur reguläre Sitzung» (FUN-H-005) ──
{
    const STD = 3_600_000
    // Mittwoch 12.8.2026 (Sommer, New York = UTC−4) und Mittwoch 11.11.2026 (Winter, UTC−5)
    const SO = utc(2026, 7, 12), WI = utc(2026, 10, 11)
    const ny = (tag, stunde, minute = 0) => tag + (stunde + (tag === SO ? 4 : 5)) * STD + minute * 60_000
    const urteil = (t, iv, art) => { const u = einstiegRegulaer(t, iv, art); return u.regulaer ? 'ja' : u.sitzung }

    gleich(sitzungenDerKerze(ny(SO, 9), STD).join(), 'vor,regulaer', '1h ab 09:00: vorbörslich, dann regulär')
    gleich(sitzungenDerKerze(ny(SO, 9, 15), 15 * 60_000).join(), 'vor', 'bis 30 Minuten: die Sitzung des Beginns')
    ok(kerzeBeruehrtRegulaer(ny(SO, 9), STD) && !kerzeBeruehrtRegulaer(ny(SO, 8), STD) && !kerzeBeruehrtRegulaer(ny(SO, 16), STD), 'berührt: 09:00 ja, 08:00 und 16:00 nein')

    for (const [name, tag] of [['Sommer', SO], ['Winter', WI]]) {
        // 1h: die Eröffnungskerze war bis 15.11.2026 gesperrt
        gleich(urteil(ny(tag, 9), STD, 'kerze'), 'ja', `${name} 1h 09:00–10:00, Limit in der Kerze: enthält die Eröffnung → regulär`)
        gleich(urteil(ny(tag, 9), STD, 'eroeffnung'), 'vor', `${name} 1h 09:00, Einstieg zur Eröffnung der Kerze: 09:00 ist vorbörslich`)
        gleich(urteil(ny(tag, 9), STD, 'schluss'), 'ja', `${name} 1h 09:00, Einstieg zum Schluss (10:00): regulär`)
        gleich(urteil(ny(tag, 8), STD, 'kerze'), 'vor', `${name} 1h 08:00–09:00: vorbörslich`)
        gleich(urteil(ny(tag, 15), STD, 'schluss'), 'ja', `${name} 1h 15:00, Schluss um 16:00 zählt zur Sitzung`)
        gleich(urteil(ny(tag, 16), STD, 'kerze'), 'nach', `${name} 1h 16:00–17:00: nachbörslich`)
        gleich(urteil(ny(tag, 16), STD, 'eroeffnung'), 'nach', `${name} 1h 16:00 zur Eröffnung: nachbörslich`)
        gleich(urteil(ny(tag, 15, 45), 15 * 60_000, 'kerze'), 'ja', `${name} 15m 15:45: regulär`)
        gleich(urteil(ny(tag, 9, 15), 15 * 60_000, 'kerze'), 'vor', `${name} 15m 09:15: vorbörslich`)
    }
    // Gleiche New Yorker Wanduhr → gleiches Urteil, Sommer wie Winter (jede halbe Stunde, alle drei Arten)
    let gleichlauf = true
    for (const iv of [15 * 60_000, STD, 2 * STD, 4 * STD]) for (const art of ['kerze', 'eroeffnung', 'schluss']) for (let m = 0; m < 24 * 60; m += 30) {
        if (urteil(ny(SO, 0, m), iv, art) !== urteil(ny(WI, 0, m), iv, art)) gleichlauf = false
    }
    ok(gleichlauf, 'gleiche New Yorker Uhrzeit: Sommer und Winter dasselbe Urteil')

    // 4h-Kerzen der Börse liegen auf UTC: Sommer 08–12, 12–16, 16–20 New York; Winter 07–11, 11–15, 15–19
    gleich([12, 16, 20].map((h) => urteil(SO + h * STD, 4 * STD, 'kerze')).join(), 'ja,ja,nach', 'Sommer 4h (Limit): 08–12 und 12–16 regulär, 16–20 nachbörslich')
    // RAS-05: «berührt» genügt nicht mehr — die Kerze muss mindestens zur Hälfte in der Sitzung liegen.
    gleich([12, 16, 20].map((h) => urteil(WI + h * STD, 4 * STD, 'kerze')).join(), 'vor,ja,nach', 'Winter 4h (Limit): 07–11 (1,5 h in der Sitzung) und 15–19 (1 h) gesperrt, 11–15 regulär')
    ok([12, 16, 20].every((h) => kerzeBeruehrtRegulaer(WI + h * STD, 4 * STD)), '…obwohl alle drei die Sitzung berühren (Chart-Regel)')
    gleich(urteil(ny(SO, 8), 4 * STD, 'kerze') + urteil(ny(SO, 12), 4 * STD, 'kerze'), 'jaja', 'Sommer 4h 08–12: 2,5 von 4 Stunden in der Sitzung → zugelassen; 12–16 ganz')
    gleich(urteil(ny(SO, 9), STD, 'kerze'), 'ja', '1h ab 09:00: genau die Hälfte (30 von 60 Minuten) → zugelassen')
    // 2h: Sommer 08–10 (eine halbe Stunde von zwei) gesperrt, Winter 09–11 und 15–17 zugelassen (15–17 genau die Hälfte)
    gleich(urteil(ny(SO, 8), 2 * STD, 'kerze') + ',' + urteil(ny(WI, 9), 2 * STD, 'kerze') + ',' + urteil(ny(WI, 15), 2 * STD, 'kerze') + ',' + urteil(ny(SO, 16), 2 * STD, 'kerze'),
        'vor,ja,ja,nach', '2h: 08–10 gesperrt, 09–11 und 15–17 zugelassen, 16–18 gesperrt')
    // Keine zugelassene Kerze liegt mehr als zur Hälfte ausserhalb, auf keiner Zeiteinheit (vier Wochen samt Zeitumstellung und Thanksgiving)
    {
        let schlecht = ''
        for (const iv of [5 * 60_000, 15 * 60_000, 30 * 60_000, STD, 2 * STD, 4 * STD, 6 * STD, 12 * STD]) {
            for (let t = utc(2026, 9, 26); t < utc(2026, 10, 30) && !schlecht; t += iv) {
                const liste = sitzungenDerKerze(t, iv)
                const drin = liste.filter((x) => x === 'regulaer').length
                const u = einstiegRegulaer(t, iv, 'kerze')
                if (u.regulaer !== (2 * drin >= liste.length) || (!u.regulaer && (u.sitzung === 'regulaer' || !u.sitzung))) schlecht = `${new Date(t).toISOString()} ${iv / 60_000}m`
            }
        }
        ok(!schlecht, `Limit in der Kerze: zugelassen genau dann, wenn mindestens die Hälfte in der Sitzung liegt; die Begründung nennt nie «regulär» ${schlecht}`)
    }
    // Verkürzter Tag (27.11.2026, Schluss 13:00): 4h 12:00–16:00 UTC = 07–11 gesperrt, 11–15 hat nur 2 von 4 Stunden → zugelassen
    gleich(urteil(utc(2026, 10, 27, 16), 4 * STD, 'kerze'), 'ja', 'verkürzter Tag, 4h 11–15: genau die Hälfte bis 13:00 → zugelassen')
    gleich([12, 16, 20].map((h) => urteil(SO + h * STD, 4 * STD, 'eroeffnung')).join(), 'vor,ja,nach', 'Sommer 4h zur Eröffnung: 08:00 vorbörslich, 12:00 regulär, 16:00 nachbörslich')
    gleich([12, 16, 20].map((h) => urteil(WI + h * STD, 4 * STD, 'eroeffnung')).join(), 'vor,ja,ja', 'Winter 4h zur Eröffnung: 07:00 vorbörslich, 11:00 und 15:00 regulär')
    gleich(urteil(WI + 20 * STD, 4 * STD, 'schluss'), 'nach', 'Winter 4h 15–19, Einstieg zum Schluss (19:00): nachbörslich')
    gleich(urteil(SO + 4 * STD, 4 * STD, 'kerze'), 'nacht', 'Sommer 4h 00–04 New York: Nacht')
    gleich(urteil(utc(2026, 7, 15, 14), STD, 'kerze'), 'wochenende', 'Samstag: Wochenende')
    gleich(urteil(utc(2026, 10, 26, 15), STD, 'kerze'), 'feiertag', 'Thanksgiving: Feiertag')
    gleich(urteil(utc(2026, 10, 27, 17), STD, 'kerze') + urteil(utc(2026, 10, 27, 18), STD, 'kerze'), 'janach', 'verkürzter Tag: 12:00 regulär, 13:00 nachbörslich')

    // Ab 1d nicht anwendbar: nichts sperren, sondern melden
    for (const [name, iv] of [['1d', 24 * STD], ['3d', 72 * STD], ['1w', 168 * STD]]) {
        for (const t of [SO, WI, utc(2026, 7, 15), utc(2026, 10, 26)]) {
            const u = einstiegRegulaer(t, iv, 'kerze')
            ok(u.anwendbar === false && u.regulaer === true && u.sitzung === null, `${name}: nicht anwendbar, nichts gesperrt`)
        }
    }
    ok(sitzungsRegelAnwendbar(12 * STD) && !sitzungsRegelAnwendbar(24 * STD) && !sitzungsRegelAnwendbar(0), 'anwendbar unter 1d')
    ok(einstiegRegulaer(ny(SO, 10), STD).regulaer && einstiegRegulaer(ny(SO, 10), STD).anwendbar, 'Vorgabe der Art: Kerze')
}

// ── Kalendertage nach New Yorker Datum (FUN-H-011) ──
{
    const meldung = Date.UTC(2026, 10, 18, 21, 20)                      // Mi 18.11.2026, 16:20 New York
    gleich(kalenderTageNY(meldung, Date.UTC(2026, 10, 18, 7, 0)), 0, 'Meldung heute Abend (in 14 h): heute, nicht «1 Tag»')
    gleich(kalenderTageNY(meldung, Date.UTC(2026, 10, 17, 6, 0)), 1, 'in 39 Stunden, aber morgen: 1, nicht 2')
    gleich(kalenderTageNY(meldung, Date.UTC(2026, 10, 18, 4, 59)), 1, '23:59 New York am Vortag: morgen')
    gleich(kalenderTageNY(meldung, Date.UTC(2026, 10, 18, 5, 0)), 0, 'ab Mitternacht New York: heute')
    gleich(kalenderTageNY(meldung, Date.UTC(2026, 10, 19, 15, 0)), -1, 'am Tag danach: -1')
    // Über die Zeitumstellung (1.11.2026) zählt der Tag mit 25 Stunden als einer.
    gleich(kalenderTageNY(Date.UTC(2026, 10, 2, 21, 0), Date.UTC(2026, 9, 31, 14, 0)), 2, 'über die Zeitumstellung: Sa → Mo sind 2 Tage')
    ok(kalenderTageNY(null) === null && kalenderTageNY(NaN, 0) === null && kalenderTageNY('', 0) === null, 'ohne Zeitpunkt → null')
}

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
