/** Selbsttest: Kaufzettel (shared/kaufzettel.js). */
// Die Tage bis zum Zahlentermin zählen in Ortszeit — fest, damit der Test überall gleich läuft.
process.env.TZ = 'Europe/Zurich'
import { rechneKaufzettel, zettelHinweise, zettelText, wartungsmargeAusHebel, GEBUEHR_VORGABE } from './kaufzettel.js'

let ok = 0, fehler = 0
const pruefe = (text, bedingung, detail = '') => {
    if (bedingung) ok++
    else { fehler++; console.log(`  ✗ ${text}${detail ? ` — ${detail}` : ''}`) }
}
const nah = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

// --- Future, Long: Grösse aus dem Verlust am Stop inklusive Gebühren -----------
{
    const r = rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 200, stop: 190, ziel: 230, betrag: 100, hebel: 5, gebuehrPct: 0.06 })
    // je Stück: 10 Abstand + 0,0006 × (200 + 190) = 10,234
    pruefe('Stückzahl', r.ok && nah(r.menge, 100 / 10.234), String(r.menge))
    pruefe('Verlust am Stop = Vorgabe', nah(r.verlustStop, -100), String(r.verlustStop))
    pruefe('Nominal und Marge', nah(r.nominal, r.menge * 200) && nah(r.marge, r.nominal / 5))
    // Gewinn am Ziel: 30 × Menge − 0,0006 × Menge × 430
    pruefe('Chance zu Risiko', nah(r.rr, (30 - 0.0006 * 430) * r.menge / 100), String(r.rr))
    pruefe('Liquidation hinter dem Stop', r.liq < 190 && !r.liqVorStop && !r.warnungen.includes('liqVorStop'), String(r.liq))
}
// --- Future, Short ----------------------------------------------------------------
{
    const r = rechneKaufzettel({ art: 'perp', richtung: 'short', einstieg: 200, stop: 206, ziel: 185, betrag: 60, hebel: 10 })
    pruefe('Short rechnet', r.ok && r.richtung === 'short' && nah(r.verlustStop, -60) && r.gewinnZiel > 0)
    pruefe('Short: Liquidation über dem Einstieg', r.liq > 206 && !r.liqVorStop, String(r.liq))
}
// --- Liquidation vor dem Stop -----------------------------------------------------
{
    // 20-fach, 2,5 % Wartung: Liq bei rund −2,5 %, der Stop liegt bei −5 %
    const r = rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 100, stop: 95, betrag: 50, hebel: 20 })
    pruefe('Warnung Liquidation vor Stop', r.ok && r.liqVorStop && r.warnungen.includes('liqVorStop'), `liq ${r.liq}`)
    const s = rechneKaufzettel({ art: 'perp', richtung: 'short', einstieg: 100, stop: 105, betrag: 50, hebel: 20 })
    pruefe('… auch Short', s.liqVorStop)
    const u = rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 100, stop: 95, betrag: 50, hebel: 50 })
    pruefe('Hebel, den die Wartungsmarge nicht trägt', u.liqVorStop)
}
// --- Wartungsmarge je Handelsplatz (Audit 15.11.2026, FUN-H-002) --------------------
{
    pruefe('ohne Hebelgrenze 2,5 %', wartungsmargeAusHebel() === 0.025 && wartungsmargeAusHebel(0) === 0.025)
    pruefe('kleiner Hebel bleibt bei 2,5 %', wartungsmargeAusHebel(10) === 0.025 && wartungsmargeAusHebel(20) === 0.025)
    pruefe('50× → 1 %, 100× → 0,5 %', nah(wartungsmargeAusHebel(50), 0.01) && nah(wartungsmargeAusHebel(100), 0.005))
    // Der Fall aus dem Audit: Long 200, Stop 198, 30× an einem Platz mit 50×
    const basis = { art: 'perp', richtung: 'long', einstieg: 200, stop: 198, betrag: 50 }
    const alt = rechneKaufzettel({ ...basis, hebel: 30 })
    pruefe('ohne Listung: 30× warnt weiter (2,5 %)', alt.liqVorStop && nah(alt.mmrPct, 2.5))
    const bitunix = rechneKaufzettel({ ...basis, hebel: 30, maxHebel: 50 })
    pruefe('Platz mit 50×: 30× ohne Liquidations-Warnung', bitunix.ok && !bitunix.liqVorStop && nah(bitunix.mmrPct, 1) && bitunix.liq < 198, `liq ${bitunix.liq}`)
    const voll = rechneKaufzettel({ ...basis, hebel: 50, maxHebel: 50 })
    pruefe('50× am 50×-Platz: Liquidation rund 1 % unter dem Einstieg, nicht darauf', voll.liq < 198.5 && voll.liq > 197.5, `liq ${voll.liq}`)
    const eigen = rechneKaufzettel({ ...basis, hebel: 30, maxHebel: 50, mmrPct: 2.5 })
    pruefe('eigene Wartungsmarge schlägt die Schätzung', eigen.liqVorStop && nah(eigen.mmrPct, 2.5))
    pruefe('leeres/ungültiges Feld = Schätzung', nah(rechneKaufzettel({ ...basis, hebel: 30, maxHebel: 50, mmrPct: '' }).mmrPct, 1)
        && nah(rechneKaufzettel({ ...basis, hebel: 30, maxHebel: 50, mmrPct: -1 }).mmrPct, 1))
    pruefe('Spot ohne Wartungsmarge', rechneKaufzettel({ art: 'token-spot', richtung: 'long', einstieg: 100, stop: 90, betrag: 50 }).mmrPct === null)
}
// --- Spot ---------------------------------------------------------------------------
{
    const r = rechneKaufzettel({ art: 'token-spot', richtung: 'long', einstieg: 100, stop: 90, betrag: 50, hebel: 20 })
    pruefe('Spot ohne Hebel', r.ok && r.hebel === 1 && nah(r.marge, r.nominal))
    pruefe('Spot ohne Liquidation', r.liq === null && r.liqVorStop === false && !r.warnungen.includes('liqVorStop'))
    pruefe('Spot: Gebühren-Vorgabe', r.gebuehrPct === GEBUEHR_VORGABE['token-spot'])
    pruefe('ohne Ziel kein Verhältnis', r.rr === null && r.gewinnZiel === null)
    const s = rechneKaufzettel({ art: 'broker-spot', richtung: 'short', einstieg: 100, stop: 110, betrag: 50 })
    pruefe('Spot kennt kein Short', !s.ok && s.fehler.includes('shortBeiSpot') && s.richtung === 'long')
    const k = rechneKaufzettel({ art: 'broker-spot', richtung: 'long', einstieg: 100, stop: 95, betrag: 100, konto: 1000 })
    pruefe('Spot: Nominal über dem Konto wird gemeldet', k.ok && k.marge > 1000 && k.warnungen.includes('margeUeberKonto'), String(k.marge))
}
// --- Prozent vom Konto --------------------------------------------------------------
{
    const r = rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 50, stop: 48, betrag: 1, einheit: 'prozent', konto: 5000, hebel: 3 })
    pruefe('1 % von 5000 = 50', r.ok && nah(r.betragUsdt, 50) && nah(r.verlustStop, -50) && nah(r.kontoRisikoPct, 1))
    const o = rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 50, stop: 48, betrag: 1, einheit: 'prozent', hebel: 3 })
    pruefe('Prozent ohne Konto ist ein Fehler, keine Null-Position', !o.ok && o.fehler.includes('kontoFehlt') && o.menge === undefined)
}
// --- Eingabefehler ------------------------------------------------------------------
{
    const f = (o) => rechneKaufzettel({ art: 'perp', richtung: 'long', einstieg: 100, stop: 95, betrag: 50, hebel: 2, ...o })
    pruefe('Stop auf der falschen Seite (Long)', f({ stop: 105 }).fehler.includes('stopFalscheSeite'))
    pruefe('Stop auf der falschen Seite (Short)', f({ richtung: 'short', stop: 95 }).fehler.includes('stopFalscheSeite'))
    pruefe('Ziel auf der falschen Seite', f({ ziel: 90 }).fehler.includes('zielFalscheSeite') && !f({ ziel: 90 }).ok)
    pruefe('Short mit Ziel darüber', f({ richtung: 'short', stop: 105, ziel: 110 }).fehler.includes('zielFalscheSeite'))
    pruefe('fehlende Eingaben', f({ einstieg: '' }).fehler.includes('einstiegFehlt') && f({ stop: 0 }).fehler.includes('stopFehlt') && f({ betrag: 0 }).fehler.includes('betragFehlt'))
    pruefe('Hebel über der Grenze der Listung', f({ hebel: 30, maxHebel: 20 }).warnungen.includes('hebelUeberGrenze') && !f({ hebel: 10, maxHebel: 20 }).warnungen.includes('hebelUeberGrenze'))
    pruefe('Gebühr 0 bleibt 0', f({ gebuehrPct: 0 }).gebuehrPct === 0 && nah(f({ gebuehrPct: 0 }).menge, 10))
}
// --- Hinweise -----------------------------------------------------------------------
{
    const mittwoch = Date.parse('2026-11-11T16:00:00Z')    // 11:00 New York, reguläre Sitzung
    const sonntag = Date.parse('2026-11-15T12:00:00Z')
    const nacht = Date.parse('2026-11-11T07:00:00Z')        // 02:00 New York
    pruefe('reguläre Sitzung: nicht dünn', zettelHinweise({ art: 'perp', jetzt: mittwoch }).duenn === false)
    pruefe('Wochenende: dünn', zettelHinweise({ art: 'perp', jetzt: sonntag }).duenn && zettelHinweise({ art: 'perp', jetzt: sonntag }).sitzung === 'wochenende')
    pruefe('Nacht: dünn', zettelHinweise({ art: 'perp', jetzt: nacht }).sitzung === 'nacht')
    const t = (stunden, mehr = {}) => zettelHinweise({ art: 'perp', jetzt: mittwoch, termin: { zeit: mittwoch + stunden * 3_600_000, ...mehr } }).zahlen
    pruefe('Zahlen in 30 Stunden werden genannt', t(30)?.tage === 1)
    pruefe('Zahlen in genau zwei Tagen noch', t(48)?.tage === 2)
    pruefe('übermorgen spät am Abend zählt noch (Kalendertage, nicht 48 Stunden)', t(54)?.tage === 2)
    pruefe('Zahlen in drei Tagen nicht', t(72) === null)
    pruefe('Zahlen von heute früh noch', t(-5)?.tage === 0)
    pruefe('Zahlen von gestern nicht', t(-30) === null)
    pruefe('geschätzter Termin bleibt gekennzeichnet', t(10, { geschaetzt: true }).geschaetzt === true)
    // FUN-H-011: gezählt wird das New Yorker Datum — 02:00 UTC ist dort noch der Vorabend (21:00).
    const abend = Date.parse('2026-11-11T02:00:00Z'), meldung = Date.parse('2026-11-11T21:20:00Z')
    pruefe('Vorabend in New York: die Meldung ist «morgen», gleich in welcher Ortszeit', zettelHinweise({ art: 'perp', jetzt: abend, termin: { zeit: meldung } }).zahlen?.tage === 1)
    pruefe('am Morgen desselben New Yorker Tags: «heute»', zettelHinweise({ art: 'perp', jetzt: Date.parse('2026-11-11T07:00:00Z'), termin: { zeit: meldung } }).zahlen?.tage === 0)
    pruefe('ohne Termin kein Hinweis', zettelHinweise({ art: 'perp', jetzt: mittwoch }).zahlen === null)
}
// --- Text ---------------------------------------------------------------------------
{
    const text = zettelText('NVDA · Bitunix', [['Einstieg', '200'], ['Ziel', ''], ['Stop', '190'], ['Hebel', null]], 'Nichts gesendet.')
    pruefe('Text: leere Zeilen fallen weg, Spalten bündig', text === 'NVDA · Bitunix\nEinstieg  200\nStop      190\nNichts gesendet.', JSON.stringify(text))
}

console.log(`kaufzettel: ${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
