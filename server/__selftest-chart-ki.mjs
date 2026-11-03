/**
 * Selbsttest der KI-Analyse im Chart — Eingabe und Auswahlprüfung, ohne Modell.
 *
 *   node server/__selftest-chart-ki.mjs
 *
 * Seit 18.10.2026 vermisst der Code den Chart und das Modell wählt per ID aus.
 * Das Sieb hier ist die Stelle, die das durchsetzt: Preise und Zeiten kommen
 * NUR aus den Kandidaten, eine erfundene ID oder ein Fantasiepreis im alten
 * Format kommt nicht durch. Zu streng frisst es bezahlte, gute Auswahl — für
 * jede Ablehnung steht deshalb eine Gegenprobe daneben, die durchgehen MUSS.
 */
import fs from 'node:fs'
import { baueChartEingabe, pruefeChartAuswahl, systemText, normModus, pruefeBild, korrekturPunkte, sperrtNachFehler, MAX_ZEICHNUNGEN, MAX_FEHLEND } from './chart-ki.js'
import { zeitText, baueKandidaten, PROFIL_ARTEN_ALLE, messeNutzerZeichnungen, zaehleAnLinie, nutzerBeziehungen, kandidatenText, zonenUrsprung, waehleNutzer, sichtbarAufTf, NUTZER_MAX, fensterUeberblick } from './chart-kandidaten.js'
import { parseJsonOhneUnsichtbare, parseJsonAntwort, istGrok } from './llm.js'
import { MarktdatenAus } from './marktdaten/index.js'
import { QuelleAus } from './quellen/aus.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 10, 0, 0)
// Welle um 100 mit Volumen — genug für eine Vermessung (≥ 30 Kerzen)
const kerzen = Array.from({ length: 60 }, (_, i) => {
    const m = 100 + 3 * Math.sin(i / 4)
    return { t: T0 + i * H, o: m - 0.3, h: m + 1, l: m - 1, c: m + 0.3, v: 1000 + 10 * i }
})

console.log('\nEingabe\n')
{
    const e = baueChartEingabe({
        symbol: 'SOLUSDT', interval: '1h', kerzen,
        zeichnungen: [{ typ: 'horizontale', punkte: [{ t: T0, p: 102 }], stil: { text: 'Wochenhoch' } }, { typ: 'fib', punkte: [] }],
        hebelzonen: { oben: [{ preis: 110, usd: 12e6 }], unten: [{ preis: 95, usd: 8e6 }] },
        trades: [{ richtung: 'long', einstieg: { t: T0 + 5 * H, p: 100.4 }, ausstieg: null }],
    })
    check('Kandidaten mit IDs statt Roh-Kerzen', /^N1 \|/m.test(e) && /VOLUMENPROFILE je /.test(e) && /^A1 .*V1 POC/m.test(e))
    check('nur die letzten 12 Kerzen roh, nicht alle 60', e.split('\n').filter((z) => /^\d\d\.\d\d\. \d\d:\d\d,/.test(z)).length === 12)
    check('eigene Linie als gemessener U-Eintrag mit Beschriftung, Fibonacci ohne Punkte weggelassen', /^U1 \| Horizontale 102 „Wochenhoch" \| Berührungen \d+/m.test(e) && !/Fibonacci/.test(e), e.split('\n').find((z) => z.startsWith('U1')))
    check('Hebelzonen als Modell gekennzeichnet', e.includes('Modell') && e.includes('~12 Mio USD Shorts'))
    check('offener eigener Trade als offen', e.includes('(offen)'))
    check('Eingabe deutlich kürzer als 60 Roh-Kerzen-Zeilen hätten', e.length < 4000, String(e.length))
    check('System verbietet Prognosen immer', systemText(false).includes('KEINE Prognose'))
    // S12: der Schalter `kiEmpfehlungenAn` ist weg — auch ein altes Argument `true` an zweiter Stelle hebt die Sperre nicht auf.
    check('kein Schalter hebt die Sperre auf', systemText(false, true).includes('KEINE Prognose'))
    check('System verlangt IDs statt Preise', systemText(false).includes('NUR IDs aus der Liste'))
    const mitVp = baueChartEingabe({ symbol: 'X', interval: '1h', kerzen, zeichnungen: [{ typ: 'volprofil', punkte: [{ t: kerzen[10].t, p: 0 }, { t: kerzen[30].t, p: 0 }], stil: {} }] })
    check('gezogenes Volumenprofil erscheint als U-Bezug', /U1 \| Volumenprofil/.test(mitVp))
}

// Ein fest gebautes Paket: Kurs 100, ATR 1
const paket = {
    kurs: 100, atr: 1, vonT: T0, bisT: T0 + 59 * H, interval: '1h', intervalHtf: '4h',
    spanne: { tief: 94, hoch: 111, breiteAtr: 17, positionPct: 35, kerzen: 30 },
    struktur: { hochs: [], tiefs: [], zustand: -1, bruch: null },
    roh: [{ h: 100.5, l: 99.5 }],
    nutzer: [{ id: 'U1', zid: 41, typ: 'horizontale', name: 'Horizontale 103', preis: 103, punkte: [{ t: T0, p: 103 }], text: '' }],
    kandidaten: [
        { id: 'N1', quelle: 'niveau', preis: 110, tief: 109.7, hoch: 110.3, t1: T0 + 2 * H, rolle: 'widerstand', beruehrungen: 3 },
        { id: 'N2', quelle: 'niveau', preis: 105, tief: 104.8, hoch: 105.2, t1: T0 + 10 * H, rolle: 'widerstand', beruehrungen: 4 },
        { id: 'N3', quelle: 'niveau', preis: 103.5, tief: 103.3, hoch: 103.7, t1: T0 + 11 * H, rolle: 'widerstand', beruehrungen: 2 },
        { id: 'N4', quelle: 'niveau', preis: 98, tief: 97.8, hoch: 98.2, t1: T0 + 20 * H, rolle: 'unterstuetzung', beruehrungen: 3 },
        { id: 'N5', quelle: 'niveau', preis: 95, tief: 94.8, hoch: 95.2, t1: T0 + 30 * H, rolle: 'unterstuetzung', beruehrungen: 2 },
        { id: 'V1', quelle: 'volumenprofil', name: 'POC', preis: 105.1, tief: 104.95, hoch: 105.25, t1: T0 },
        { id: 'T1', quelle: 'trend', seite: 'hoch', rolle: 'widerstand', richtung: 'ab', t1: T0 + 5 * H, p1: 112, t2: T0 + 40 * H, p2: 108, wertJetzt: 106, abstandAtr: 6, beruehrungen: 3, tEnde: T0 + 69 * H, pEnde: 104.8571 },
        { id: 'D1', quelle: 'htf', preis: 92, tief: 91.5, hoch: 92.5, t1: T0, beruehrungen: 2 },
    ],
}

console.log('\nAuswahl abbilden\n')
{
    const gut = pruefeChartAuswahl({
        text: 'Der Kurs pendelt zwischen [N4] und [N2]. Darüber liegt [T1].',
        linien: [
            { id: 'N2', label: 'Widerstand', grund: 'viermal abgewiesen, deckt sich mit [V1]', gewicht: 'stark' },
            { id: 'T1', label: 'Abwärtslinie', grund: 'drei Berührungen' },
            { id: 'N4', label: 'Boden', grund: 'drei Tiefs' },
        ],
        zonen: [{ ids: ['N5'], label: 'Bodenzone', grund: 'Tiefs', gewicht: 'mittel' }],
        bedingungen: [{ id: 'N2', richtung: 'ueber', dann: 'wäre der Weg bis [N1] frei', ziel: 'N1' }],
    }, paket)
    check('sachliche Auswahl kommt vollständig durch', gut.linien.length === 3 && gut.zonen.length === 1 && gut.bedingungen.length === 1 && gut.text, JSON.stringify(gut.verworfen))
    check('Preise exakt aus den Kandidaten (N2 = 105, waagerecht)', gut.linien[0].p1 === 105 && gut.linien[0].p2 === 105 && gut.linien[0].t1 === T0 + 10 * H)
    check('Trendlinie mit den Ankern des Kandidaten', gut.linien[1].art === 'trend' && gut.linien[1].p1 === 112 && gut.linien[1].t2 === T0 + 40 * H)
    check('Platzhalter im Text eingesetzt', gut.text.includes('98 (N4)') && gut.text.includes('105 (N2)') && gut.text.includes('Trendlinie T1 (jetzt 106)'), gut.text)
    check('Platzhalter im Grund eingesetzt', gut.linien[0].grund.includes('105.1 (V1)'), gut.linien[0].grund)
    check('Gewicht übernommen, ohne Angabe „mittel"', gut.linien[0].gewicht === 'stark' && gut.linien[1].gewicht === 'mittel')
    check('„wenn" baut der Code, mit Zahl und ID', gut.bedingungen[0].wenn === '1h-Schluss über 105 (N2)', gut.bedingungen[0].wenn)
    check('Zone aus einer ID = deren Band, ab erster Berührung', gut.zonen[0].tief === 94.8 && gut.zonen[0].hoch === 95.2 && gut.zonen[0].vonT === T0 + 30 * H)
}
{
    const art = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'x' }, { id: 'N4', label: 'y' }] }, paket)
    check('Art folgt der Lage zum Kurs, nicht dem Modell', art.linien[0].art === 'widerstand' && art.linien[1].art === 'unterstuetzung')
    const norm = pruefeChartAuswahl({ linien: [{ id: ' n2 ', label: 'x' }, { id: '[N4]', label: 'y' }] }, paket)
    check('Gegenprobe: IDs in Kleinschreibung / mit Klammern werden normalisiert', norm.linien.length === 2, JSON.stringify(norm.verworfen))
}
{
    const fremd = pruefeChartAuswahl({ linien: [{ id: 'N99', label: 'gibt es nicht' }, { art: 'widerstand', t1: '2026-10-10T05:00Z', p: 104, label: 'altes Format' }, { id: 'U1', label: 'eigene' }] }, paket)
    check('unbekannte ID verworfen', fremd.verworfen.some((v) => v.grund === 'unbekannteId' && v.inhalt === 'N99'))
    check('altes Format mit eigenem Preis kommt nicht durch (kein Fantasiepreis)', fremd.linien.length === 0)
    check('eigene Linie (U) nicht als Linie wählbar', !fremd.linien.some((l) => l.id === 'U1'))
}
{
    const doppelt = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'a' }, { id: 'N2', label: 'a2' }, { id: 'V1', label: 'POC' }, { id: 'N5', label: 'b' }], zonen: [{ ids: ['N5'], label: 'z' }] }, paket)
    check('dieselbe ID zweimal → einmal', doppelt.linien.filter((l) => l.id === 'N2').length === 1)
    check('V1 0,1 ATR neben N2 → nur eine Linie (doppelt)', !doppelt.linien.some((l) => l.id === 'V1') && doppelt.verworfen.some((v) => v.inhalt === 'V1' && v.grund === 'doppelt'))
    check('ID als Linie und Zone → die Zone bleibt', !doppelt.linien.some((l) => l.id === 'N5') && doppelt.zonen.length === 1)
}
{
    const z = pruefeChartAuswahl({ zonen: [
        { ids: ['N2', 'N4'], label: 'nicht benachbart' },
        { ids: ['N1', 'N2'], label: 'zu breit' },
        { ids: ['T1'], label: 'aus Trend' },
        { ids: ['N2', 'N3'], label: 'ok' },
    ] }, paket)
    check('Zone aus nicht benachbarten IDs verworfen', z.verworfen.some((v) => v.grund === 'nichtBenachbart'))
    check('Zone breiter als 2 ATR verworfen', z.verworfen.some((v) => v.grund === 'zoneZuBreit'))
    check('Zone aus Trendlinie verworfen', z.verworfen.some((v) => v.grund === 'zoneAusTrend'))
    check('Gegenprobe: benachbart und 1,9 ATR breit bleibt', z.zonen.length === 1 && z.zonen[0].tief === 103.3 && z.zonen[0].hoch === 105.2, JSON.stringify(z.zonen))
}
{
    const b = pruefeChartAuswahl({ bedingungen: [
        { id: 'N2', richtung: 'ueber', dann: 'x', ziel: 'N4' },
        { id: 'N4', richtung: 'unter', dann: 'läge [N5] als nächste Marke an', ziel: 'N5' },
        { id: 'N4', richtung: 'ueber', dann: 'hält der Boden' },
    ] }, paket)
    check('Ziel gegen die Richtung verworfen', b.verworfen.some((v) => v.grund === 'zielGegenRichtung'))
    check('Gegenprobe: Ziel in Richtung bleibt', b.bedingungen.some((x) => x.id === 'N4' && x.zielId === 'N5'))
    check('Kurs schon auf der Seite → „solange …"', b.bedingungen.some((x) => x.wenn.startsWith('solange 1h-Schlüsse über 98 (N4)')), JSON.stringify(b.bedingungen.map((x) => x.wenn)))
}
{
    const viele = pruefeChartAuswahl({ linien: ['N1', 'N2', 'N3', 'N4', 'N5', 'T1', 'D1', 'V1', 'N1'].map((id) => ({ id, label: id })) }, paket)
    check('höchstens 6 Linien', viele.linien.length <= 6, String(viele.linien.length))
    const satz = pruefeChartAuswahl({ text: 'Erster Satz mit [N2]. Zweiter mit [N99]. Dritter.' }, paket)
    check('unbekannte ID im Text entfernt nur ihren Satz', satz.text.includes('105 (N2)') && satz.text.includes('Dritter') && !satz.text.includes('Zweiter'), satz.text)
    const zahl = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'a', grund: 'Abpraller bei 160' }, { id: 'N4', label: 'b', grund: 'Tief bei 98,1' }] }, paket)
    check('fremde Zahl im Grund → Warnung (nur protokolliert)', zahl.warnungen.some((w) => w.zahl === 160) && zahl.linien.length === 2)
    check('Gegenprobe: Zahl 0,1 neben N4 ohne Warnung', !zahl.warnungen.some((w) => Math.abs(w.zahl - 98.1) < 1e-9))
}

console.log('\nZwei Arten, gemeinsame Grenze (31.10.2026)\n')
{
    check('Modus: Vorgabe setzen ohne Ergänzen, eigene mit Ergänzen', normModus(null).modus === 'setzen' && !normModus(null).ergaenzen && normModus({ modus: 'eigene' }).ergaenzen && !normModus({ modus: 'eigene', ergaenzen: false }).ergaenzen && normModus({ modus: 'x' }).modus === 'setzen')
    const sys = systemText(false)
    check('„setzen": höchstens 6 insgesamt, leere Auswahl erlaubt, keine Pflicht über/unter', sys.includes(`Höchstens ${MAX_ZEICHNUNGEN} Zeichnungen insgesamt`) && sys.includes('leere Auswahl richtig') && !sys.includes('über und unter dem Kurs'))
    check('„setzen": Kanäle wählbar über „muster"', sys.includes('"muster"'))
    const eig = systemText(false, { modus: 'eigene', ergaenzen: true })
    check('„eigene": Bewertungen, Korrekturen, höchstens 4 fehlende', eig.includes('"bewertungen"') && eig.includes('"korrekturen"') && eig.includes(`höchstens ${MAX_FEHLEND} wichtige Marken`))
    const eigOhne = systemText(false, { modus: 'eigene', ergaenzen: false })
    check('„eigene" ohne Ergänzen: keine Auswahlregel, leere Korrekturen', !eigOhne.includes('Höchstens 4 Zeichnungen') && eigOhne.includes('"korrekturen": []'))
    const viele = pruefeChartAuswahl({ linien: ['N1', 'N2', 'N4', 'N5', 'T1', 'D1'].map((id) => ({ id, label: id })), zonen: [{ ids: ['N3'], label: 'z' }] }, paket)
    check('Linien und Zonen zählen gemeinsam: höchstens 6', viele.linien.length + viele.zonen.length === 6 && viele.verworfen.some((v) => v.grund === 'zuViele'), JSON.stringify(viele.verworfen))
    const leerOk = pruefeChartAuswahl({ text: 'Kein Setup: der Kurs liegt mitten in der Spanne.', linien: [] }, paket)
    check('leere Auswahl mit Text ist eine gültige Antwort', !leerOk.leer && !leerOk.linien.length)
    const ohneHebel = baueChartEingabe({ symbol: 'X', interval: '1h', kerzen, hebelzonen: null })
    check('ohne Liquidationszonen → nicht in der Eingabe', !ohneHebel.includes('LIQUIDATIONSZONEN'))
    const alle = baueKandidaten({ kerzen: Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * H, o: 100, h: 101 + (i % 7) * 0.1, l: 99, c: 100 + Math.sin(i / 5), v: 100 })), interval: '1h', profilArten: PROFIL_ARTEN_ALLE })
    // Seit 03.11.2026: Profile nur über nachgewiesene Rechtecke, genau über deren Kerzen
    const zick = (i) => { const p = i % 20; return (p < 10 ? p : 20 - p) - 5 }
    const box = baueKandidaten({ kerzen: Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * H, o: 100 + zick(i), h: 100.3 + zick(i), l: 99.7 + zick(i), c: 100 + zick(i), v: 100 })), interval: '1h', profilArten: PROFIL_ARTEN_ALLE })
    const vs = box.kandidaten.filter((k) => k.quelle === 'volumenprofil')
    const ks = box.kandidaten.filter((k) => k.quelle === 'kanal' && k.form === 'range')
    check('Profile nur über Rechtecke, gleiche Kerzen wie das K-Rechteck', vs.length > 0 && vs.every((v) => v.bereich === 'rechteck' && ks.some((k) => k.id === v.rechteck && k.t1 === v.t1)), JSON.stringify(vs.map((v) => [v.bereich, v.rechteck, v.t1])) + ' ' + JSON.stringify(ks.map((k) => [k.id, k.t1])))
    const trend = baueKandidaten({ kerzen: Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * H, o: 100 + i * 0.5, h: 101 + i * 0.5, l: 99 + i * 0.5, c: 100.3 + i * 0.5, v: 100 })), interval: '1h', profilArten: PROFIL_ARTEN_ALLE })
    check('ohne Rechteck kein Profil (kein Tages-, Wochen- oder Phasenprofil als Ersatz)', !trend.kandidaten.some((k) => k.quelle === 'volumenprofil'))
}

console.log('\nMeine Zeichnungen (31.10.2026)\n')
{
    // Waagerechte bei 103: Kerzen schwingen 97…103 → Berührungen an den Hochs
    const kz = Array.from({ length: 80 }, (_, i) => { const m = 100 + 3 * Math.sin(i / 4); return { t: T0 + i * H, o: m, h: m + 0.4, l: m - 0.4, c: m, v: 100 } })
    const z = zaehleAnLinie(kz, () => 103, 1)
    check('Berührungen zählen Wellen, nicht Kerzen', z.beruehrungen >= 2 && z.beruehrungen <= 4, JSON.stringify(z))
    check('ohne Durchquerung: hält, Kurs darunter', z.durchquerungen === 0 && z.zustand === 'haelt')
    const bruch = zaehleAnLinie(kz.map((k, i) => (i >= 77 ? { ...k, c: 104, h: 104.5 } : k)), () => 103, 1)
    check('Schluss auf der anderen Seite in den letzten 5 Kerzen → gebrochen', bruch.zustand === 'gebrochen' && bruch.durchquerungen >= 1)
    check('Gegenprobe: weit weg → unberührt', zaehleAnLinie(kz, () => 120, 1).zustand === 'unberuehrt')
    const [u] = messeNutzerZeichnungen(kz, [{ id: 7, typ: 'horizontale', punkte: [{ t: T0, p: 103.2 }], stil: {} }], 1, [{ id: 'N1', quelle: 'niveau', preis: 103 }, { id: 'N2', quelle: 'niveau', preis: 110 }])
    check('Messung trägt DB-ID, Name, nächsten Kandidaten', u.zid === 7 && u.name === 'Horizontale 103.2' && u.naechster?.id === 'N1' && Math.abs(u.naechster.abstandAtr - 0.2) < 1e-9, JSON.stringify(u.naechster))
    const r = pruefeChartAuswahl({
        text: 'Die eigene Linie [U1] liegt knapp über [N3].',
        bewertungen: [{ u: 'U1', wichtig: 'hoch', text: '[U1] wirkt als Widerstand.' }, { u: 'U9', text: 'gibt es nicht' }],
        korrekturen: [{ u: 'U1', id: 'N3', grund: '[N3] hat mehr Berührungen' }, { u: 'U1', id: 'T1', grund: 'falsche Art' }],
        fehlend: { linien: [{ id: 'N4', label: 'Boden' }], zonen: [], muster: [] },
        linien: [{ id: 'N1', label: 'oben ausserhalb von fehlend' }],
    }, paket, { modus: 'eigene' })
    check('Bewertung mit Name und DB-ID, unbekannte U verworfen', r.bewertungen.length === 1 && r.bewertungen[0].zid === 41 && r.bewertungen[0].text.includes('Horizontale 103 (U1)') && r.verworfen.some((v) => v.art === 'bewertung'), JSON.stringify(r.bewertungen))
    check('Korrektur nur zum passenden Kandidaten (N3 0,5 ATR daneben), mit neuen Punkten', r.korrekturen.length === 1 && r.korrekturen[0].id === 'N3' && r.korrekturen[0].punkte[0].p === 103.5 && r.korrekturen[0].zid === 41, JSON.stringify(r.korrekturen))
    check('„eigene": Linien nur aus „fehlend", nicht aus der Wurzel', r.linien.length === 1 && r.linien[0].id === 'N4')
    const ohne = pruefeChartAuswahl({ text: 'x', korrekturen: [{ u: 'U1', id: 'N3' }], fehlend: { linien: [{ id: 'N4', label: 'b' }] } }, paket, { modus: 'eigene', ergaenzen: false })
    check('ohne Ergänzen: keine Korrektur, nichts Fehlendes', !ohne.korrekturen.length && !ohne.linien.length)
    const weit = pruefeChartAuswahl({ korrekturen: [{ u: 'U1', id: 'N1' }] }, paket, { modus: 'eigene' })
    check('Korrektur 7 ATR daneben verworfen', !weit.korrekturen.length && weit.verworfen.some((v) => v.grund === 'passtNicht'))
    const prog = pruefeChartAuswahl({ bewertungen: [{ u: 'U1', text: 'Der Kurs dürfte hier steigen.' }] }, paket, { modus: 'eigene' })
    check('Prognose-Wächter auch in Bewertungen', !prog.bewertungen.length && prog.verworfen.some((v) => v.art === 'bewertung' && v.grund === 'prognose'))
    check('korrekturPunkte: Trendlinie bekommt die Anker des Kandidaten', JSON.stringify(korrekturPunkte({ typ: 'trendlinie' }, { t1: 1, p1: 2, t2: 3, p2: 4 })) === '[{"t":1,"p":2},{"t":3,"p":4}]')
}

console.log('\nMeine Zeichnungen: die Zeichnungen sind das Thema (01.11.2026)\n')
{
    const { uSchwelle } = await import('./chart-ki.js')
    const eig = systemText(false, { modus: 'eigene', ergaenzen: false })
    check('Auftrag: Zeichnungen des Nutzers sind das Thema, Fehler ehrlich benennen', eig.includes('THEMA sind die Zeichnungen') && eig.includes('"hinweis"') && eig.includes('Erfinde keine Fehler'))
    check('Ohne Ergänzen keine Kandidaten-IDs erlaubt', eig.includes('"fehlend": {}') && !eig.includes('Kandidaten-IDs (N, V'))

    // Bruch bleibt Bruch (BTC 1h: untere Kanallinie am 29.10. gebrochen, am 31.10. stand „hält")
    const kz = Array.from({ length: 80 }, (_, i) => ({ t: T0 + i * H, o: 101, h: 101.4, l: 100.6, c: i < 30 ? 101 : 98.5 }))
    kz.forEach((k, i) => { if (i >= 30) Object.assign(k, { o: 98.5, h: 98.9, l: 98.1 }) })
    kz[10] = { ...kz[10], l: 99.9 }; kz[20] = { ...kz[20], l: 99.9 }
    const b = zaehleAnLinie(kz, () => 100, 1)
    check('Einmal durchschlossen, 49 Kerzen her → weiter „gebrochen", mit Zeitpunkt und Berührungen davor', b.zustand === 'gebrochen' && b.bruch?.vorKerzen === 49 && b.bruch.vorher === 2 && b.bruch.nach === 'unten', JSON.stringify(b.bruch))
    const zick = kz.map((k, i) => ({ ...k, c: [10, 20, 40].some((x) => i >= x && i < x + 5) ? 101 : 99 }))
    check('Drei- und mehrmal durchquert → Drehpunkt', zaehleAnLinie(zick, () => 100, 1).zustand === 'drehpunkt')

    // Zone am Tief, danach Rally ohne Rückkehr
    const rally = Array.from({ length: 60 }, (_, i) => { const m = i < 5 ? 75.5 - i * 0.2 : 74.5 + (i - 5) * 0.4; return { t: T0 + i * H, o: m, h: m + 0.3, l: m - 0.3, c: m, v: 10 } })
    const o = zonenUrsprung(rally, 3, 74.2, 75.4, 1)
    check('Zonen-Ursprung: Tief am linken Rand, Bewegung danach, nicht zurück', o.wende === 'tief' && o.bewegungAtr > 15 && o.zurueckT === null, JSON.stringify(o))
    const [zone] = messeNutzerZeichnungen(rally, [{ id: 3, typ: 'rechteck', punkte: [{ t: rally[3].t, p: 74.2 }, { t: rally[50].t, p: 75.4 }], stil: { text: 'Support Zone' } }], 1)
    check('Zone unter dem Kurs mit „Support": nichts auffällig, Ursprung gemessen', zone.ursprung?.wende === 'tief' && !zone.auffaellig.length, JSON.stringify(zone.auffaellig))
    const [falsch] = messeNutzerZeichnungen(rally, [{ id: 4, typ: 'rechteck', punkte: [{ t: rally[3].t, p: 74.2 }, { t: rally[50].t, p: 75.4 }], stil: { text: 'Resistance' } }], 1)
    check('„Resistance" unter dem Kurs → auffällig', falsch.auffaellig.some((x) => x.includes('Beschriftung')))

    // Volumenprofil vor den geladenen Kerzen: ehrlich ausserhalb statt aus fremden Kerzen gerechnet
    const [vp] = messeNutzerZeichnungen(rally, [{ id: 5, typ: 'volprofil', punkte: [{ t: T0 - 500 * H, p: 0 }, { t: T0 - 300 * H, p: 0 }], stil: {} }], 1)
    check('Profil vor den Kerzen → ausserhalb, kein POC', vp.zustand === 'ausserhalb' && vp.poc === undefined)

    // Trendlinie quer durch die Kerzen, Anker nicht an Hoch/Tief
    const koerper = rally.map((k) => ({ ...k, o: k.c - 0.5, c: k.c + 0.5 }))
    const [quer] = messeNutzerZeichnungen(koerper, [{ id: 6, typ: 'trendlinie', punkte: [{ t: rally[10].t, p: 76.5 }, { t: rally[40].t, p: 88.5 }], stil: {} }], 1)
    check('Linie durch Kerzenkörper → auffällig', quer.auffaellig.some((x) => x.includes('Kerzenkörper')), JSON.stringify(quer.auffaellig))
    const sauber = rally.map((k) => ({ ...k, o: k.c - 0.5, c: k.c + 0.5, h: k.c + 0.8, l: k.c - 0.8 }))
    const [anTiefs] = messeNutzerZeichnungen(sauber, [{ id: 7, typ: 'trendlinie', punkte: [{ t: rally[10].t, p: 75.7 }, { t: rally[40].t, p: 87.7 }], stil: {} }], 1)
    check('Gegenprobe: Linie an den Tiefs → nichts auffällig', !anTiefs.auffaellig.length, JSON.stringify(anTiefs.auffaellig))

    const bz = nutzerBeziehungen([{ id: 'U1', typ: 'horizontale', preis: 102 }, { id: 'U2', typ: 'rechteck', hoch: 102.3, tief: 101 }, { id: 'U3', typ: 'volprofil', poc: 99, vah: 100.5, val: 98 }], 100.2, 1)
    check('Leiter von oben nach unten, gleiche Höhe erkannt', bz.marken[0].preis === 102.3 && bz.decken.some((d) => [d.a.u, d.b.u].sort().join() === 'U1,U2'))
    check('uSchwelle: Zone über → Oberkante, unter → Unterkante; Profil VAH/VAL', uSchwelle({ typ: 'rechteck', hoch: 5, tief: 4 }, 'ueber') === 5 && uSchwelle({ typ: 'rechteck', hoch: 5, tief: 4 }, 'unter') === 4 && uSchwelle({ typ: 'volprofil', vah: 3, val: 1 }, 'unter') === 1)

    const pk2 = { ...paket, nutzer: [paket.nutzer[0], { id: 'U2', zid: 42, typ: 'rechteck', name: 'Zone 95–96', tief: 95, hoch: 96, punkte: [] }], beziehungen: { marken: [], decken: [] } }
    const r = pruefeChartAuswahl({
        text: 'Der Kurs steht zwischen [U1] und der Zone [U2]. Darunter liegt [N4].',
        bewertungen: [{ u: 'U2', wichtig: 'hoch', text: 'Die Zone [U2] fing das letzte Tief.', hinweis: 'Die Beschriftung passt nicht.' }],
        bedingungen: [{ id: 'U2', richtung: 'unter', dann: 'Dann wäre [U2] verloren.' }, { id: 'N4', richtung: 'unter', dann: 'x' }, { id: 'U1', richtung: 'ueber', dann: 'Dann liegt [N1] offen.' }],
    }, pk2, { modus: 'eigene', ergaenzen: false })
    check('Text: Satz mit Kandidaten-ID fällt weg, „Zone Zone" nicht doppelt', r.text.includes('Zone 95–96 (U2)') && !r.text.includes('Zone Zone') && !r.text.includes('N4') && r.verworfen.some((v) => v.grund === 'fremdeId'), r.text)
    check('Bedingung an Zone „unter" hängt an der Unterkante', r.bedingungen.length === 1 && r.bedingungen[0].schwelle === 95 && r.bedingungen[0].wenn.includes('Zone 95–96'), JSON.stringify(r.bedingungen))
    check('Bedingungen an Kandidaten oder mit Kandidaten im „dann" verworfen', r.verworfen.filter((v) => v.art === 'bedingung' && v.grund === 'fremdeId').length === 2)
    check('Hinweis auf einen Fehler bleibt bei der Bewertung', r.bewertungen[0].hinweis === 'Die Beschriftung passt nicht.')

    const pkEcht = baueKandidaten({ kerzen: rally, interval: '1h', zeichnungen: [{ id: 9, typ: 'horizontale', punkte: [{ t: rally[0].t, p: 80 }], stil: {} }] })
    const ohneK = kandidatenText(pkEcht, { eigene: true, mitKandidaten: false })
    const mitK = kandidatenText(pkEcht, { eigene: true, mitKandidaten: true })
    check('Eingabe „eigene" ohne Ergänzen: keine Kandidaten, Zeichnungen und Leiter da', !ohneK.includes('NIVEAUS') && ohneK.includes('EIGENE ZEICHNUNGEN') && ohneK.includes('LEITER'))
    check('Mit Ergänzen: Zeichnungen zuerst, Kandidaten danach als Prüfmassstab', mitK.indexOf('EIGENE ZEICHNUNGEN') < mitK.indexOf('KANDIDATEN DES CODES'))
}

console.log('\nKanäle wählt das Modell (31.10.2026; vorher zeichnete der Code sie immer)\n')
{
    const H2 = 3_600_000
    const kz = (t, m) => ({ t: t * H2, o: m - 0.1, h: m + 0.5, l: m - 0.5, c: m + 0.1, v: 100 })
    const zick = (i) => { const p = i % 10; return (p < 5 ? p : 10 - p) * 0.6 - 1.5 }
    const kk = []
    for (let i = 0; i < 30; i++) kk.push(kz(kk.length, 100 + i))
    for (let i = 0; i < 40; i++) kk.push(kz(kk.length, 129 - i * 0.12 + zick(i)))
    const pk = baueKandidaten({ kerzen: kk, interval: '1h' })
    const mit = pruefeChartAuswahl({ text: 'Die Lage [K1].', linien: [{ id: 'K1', label: 'vom Modell' }], muster: [{ id: 'K1', grund: 'sauber' }] }, pk, {})
    const kanal = mit.linien.filter((l) => l.art === 'kanal')
    check('Kanal gewählt (in linien oder muster) → einmal, mit Namen vom Code', kanal.length === 1 && kanal[0].label.startsWith('Bull-Flagge') && kanal[0].breite > 0, JSON.stringify(kanal.map((l) => l.label)))
    check('Gegenprobe: nicht gewählt → kein Kanal', !pruefeChartAuswahl({ text: 'Die Lage [K1].' }, pk, {}).linien.some((l) => l.art === 'kanal'))
    check('[K1] im Text wird durch Name und Kanten ersetzt', /Bull-Flagge .*K1 \(Kanten jetzt/.test(mit.text), mit.text)
    const oft = pruefeChartAuswahl({ text: 'Die Bull-Flagge [K1] hält. Ein Bruch von [K1] wäre neu. Die Flagge [K1] bleibt.', linien: [] }, pk, {}).text
    check('[K1] nur beim ersten Nennen voll, danach kurz, kein doppelter Name', (oft.match(/Kanten jetzt/g) || []).length === 1 && (oft.match(/Berührungen/g) || []).length === 1
        && !/Flagge\s+Bull-Flagge/.test(oft) && /Bruch von Bull-Flagge K1/.test(oft) && /Die Bull-Flagge K1 bleibt/.test(oft), oft)
    {
        const roh = JSON.parse(fs.readFileSync(new URL('./fixtures/chart-hbar-4h-flagge.json', import.meta.url))).kerzen.slice(-200)
        const ph = baueKandidaten({ kerzen: roh.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })), interval: '4h' })
        const r = pruefeChartAuswahl({ text: 'Die Range [K1] wurde verlassen. Zurück in [K1] wäre ein Fehlausbruch.', muster: [{ id: 'K1' }] }, ph, {})
        const kl = r.linien.find((l) => l.art === 'kanal')
        check('HBAR: Seitwärts-Range waagerecht im Chart, Text ohne Doppelnamen', kl && kl.p1 === kl.p2 && kl.label.startsWith('Seitwärts-Range') && !/Range\s+Seitwärts/.test(r.text) && /Zurück in Seitwärts-Range K1/.test(r.text), r.text)
    }

    // Bildprüfung: ein Einwand gegen K1 nimmt den Kanal aus Zeichnung, Text und Bedingungen
    const kid = pk.kandidaten.find((k) => k.quelle === 'kanal').id
    const nid = pk.kandidaten.find((k) => k.quelle === 'niveau')?.id
    const antwortE = { text: `Die Flagge [${kid}] ist wichtig. Die Spanne ist eng.`, linien: [], muster: [{ id: kid }], bedingungen: nid ? [{ id: kid, richtung: 'unter', dann: 'Muster gebrochen' }] : [],
        einwaende: [{ id: kid, grund: 'Im Bild seitwärts, keine Fahnenstange davor' }, { id: 'K99', grund: 'gibt es nicht' }, ...(nid ? [{ id: nid, grund: 'Niveau ist keine Geometrie' }] : [])] }
    const mitE = pruefeChartAuswahl(antwortE, pk, { mitBild: true })
    check('Bild-Einwand: Kanal wird nicht gezeichnet', !mitE.linien.some((l) => l.id === kid), JSON.stringify(mitE.linien.map((l) => l.id)))
    check('Bild-Einwand: Satz mit der ID fällt weg, der Rest bleibt', mitE.text === 'Die Spanne ist eng.', mitE.text)
    check('Bild-Einwand: Bedingung an der ID verworfen', !mitE.bedingungen.length)
    check('Bild-Einwand: nur bekannte Kanal/Trend-IDs, mit Name und Grund', mitE.einwaende.length === 1 && mitE.einwaende[0].id === kid && mitE.einwaende[0].name.includes('Flagge') && /seitwärts/.test(mitE.einwaende[0].grund), JSON.stringify(mitE.einwaende))
    const ohneBildE = pruefeChartAuswahl(antwortE, pk, {})
    check('Gegenprobe: ohne Bild zählt kein Einwand', ohneBildE.linien.some((l) => l.id === kid) && !ohneBildE.einwaende.length)
    const prognoseE = pruefeChartAuswahl({ ...antwortE, einwaende: [{ id: kid, grund: 'der Kurs dürfte steigen' }] }, pk, { mitBild: true })
    check('Einwand mit Prognose im Grund gilt nicht', prognoseE.linien.some((l) => l.id === kid))
    check('Prompt mit Bild verlangt Einwände, ohne Bild nicht', systemText(false, { mitBild: true }).includes('"einwaende"') && !systemText(false).includes('einwaende'))
    check('Prompt mit Bild: Preise nicht aus dem Bild ablesen', systemText(false, { mitBild: true }).includes('Preise liest du NICHT aus dem Bild ab'))
    check('pruefeBild: gültiges JPEG', pruefeBild({ mediaType: 'image/jpeg', base64: 'A'.repeat(200) })?.kind === 'image')
    check('pruefeBild: falscher Typ, Müll, zu gross → null', pruefeBild({ mediaType: 'image/gif', base64: 'A'.repeat(200) }) === null
        && pruefeBild({ mediaType: 'image/png', base64: '<script>'.repeat(30) }) === null
        && pruefeBild({ mediaType: 'image/png', base64: 'A'.repeat(3_000_001) }) === null && pruefeBild(null) === null)
}

console.log('\nDreiecke und Keile (31.10.2026)\n')
{
    // Symmetrisches Dreieck: Kerzen pendeln zwischen einer fallenden und einer steigenden Kante
    const kz = []
    for (let i = 0; i < 40; i++) { const v = 100 + Math.sin(i / 3) * 0.3; kz.push({ t: i * H, o: v, h: v + 0.2, l: v - 0.2, c: v, v: 100 }) }
    for (let i = 0; i < 100; i++) {
        const x = i / 99, w = 1 - Math.abs(2 * ((i % 14) / 14) - 1)
        const v = (90 + 7 * x) + ((110 - 7 * x) - (90 + 7 * x)) * w
        kz.push({ t: (40 + i) * H, o: v, h: v + 0.08, l: v - 0.08, c: v, v: 100 })
    }
    const pd = baueKandidaten({ kerzen: kz, interval: '1h' })
    const m = pd.kandidaten.find((k) => k.quelle === 'dreieck')
    check('Dreieck als M-Kandidat im Paket und in der Eingabe', m?.id === 'M1' && m.form === 'symmetrisch' && baueChartEingabe({ symbol: 'X', interval: '1h', kerzen: kz, paket: pd }).includes('DREIECKE, KEILE UND WIMPEL'), JSON.stringify(m))
    const r = pruefeChartAuswahl({ text: 'Das symmetrische Dreieck [M1] läuft zur Spitze.', muster: [{ id: 'M1', grund: 'sauber' }], bedingungen: [{ id: 'M1', richtung: 'ueber', dann: 'x' }] }, pd, {})
    const l = r.linien.find((x) => x.art === 'dreieck')
    check('gewählt über „muster": Eintrag mit beiden Kanten, Name vom Code', l && l.label.startsWith('Symmetrisches Dreieck (') && l.obenA > l.untenA && l.tE > l.tA, JSON.stringify(l))
    check('Text: Name einmal, kein Doppelname', /Das Symmetrisches Dreieck \(.*\) M1 \(Kanten jetzt/.test(r.text) && !/Dreieck Symmetrisches/.test(r.text), r.text)
    check('Bedingung an ein Dreieck verworfen (zwei Kanten, keine Schwelle)', !r.bedingungen.length && r.verworfen.some((v) => v.grund === 'musterOhneSchwelle'))
    check('Gegenprobe: nicht gewählt → nichts gezeichnet', !pruefeChartAuswahl({ text: 'x' }, pd, {}).linien.some((x) => x.art === 'dreieck'))
    const e = pruefeChartAuswahl({ text: 'y', muster: [{ id: 'M1' }], einwaende: [{ id: 'M1', grund: 'im Bild ein Kanal' }] }, pd, { mitBild: true })
    check('Bild-Einwand gilt auch für Dreiecke, mit Dreiecksnamen', !e.linien.some((x) => x.art === 'dreieck') && e.einwaende[0]?.id === 'M1' && e.einwaende[0].name.startsWith('Symmetrisches Dreieck'))
    check('Prompt nennt Dreiecke, Keile und Wimpel', systemText(false).includes('Dreiecke, Keile und Wimpel (M)'))
}

console.log('\nUmkehrmuster (03.11.2026)\n')
{
    // Doppeltop: Anstieg 90 → 110, Rücksetzer 100, zweites Top 110, Bruch unter 100
    const zug = (punkte) => {
        const k = []
        for (let j = 1; j < punkte.length; j++) {
            const [l, a] = punkte[j - 1], [, b] = punkte[j]
            for (let i = 0; i < l; i++) { const v = a + (b - a) * (i / l) + Math.sin(k.length * 1.7) * 0.15; k.push({ t: k.length * H, o: v, h: v + 0.2, l: v - 0.2, c: v, v: 100 }) }
        }
        return k
    }
    const kz = zug([[30, 100], [25, 90], [20, 110], [20, 100], [20, 110], [8, 98], [1, 98]])
    const pd = baueKandidaten({ kerzen: kz, interval: '1h' })
    const rk = pd.kandidaten.find((k) => k.quelle === 'umkehr' && k.form === 'doppeltop')
    check('Doppeltop als R-Kandidat im Paket und in der Eingabe', /^R\d$/.test(rk?.id || '') && baueChartEingabe({ symbol: 'X', interval: '1h', kerzen: kz, paket: pd }).includes('UMKEHRMUSTER'), JSON.stringify(pd.kandidaten.filter((k) => k.quelle === 'umkehr').map((k) => k.form)))
    const r = pruefeChartAuswahl({ text: `Das Doppeltop [${rk.id}] ist bestätigt.`, muster: [{ id: rk.id, grund: 'zwei gleich hohe Tops' }], bedingungen: [{ id: rk.id, richtung: 'ueber', dann: 'Muster hinfällig' }] }, pd, {})
    const l = r.linien.find((x) => x.art === 'umkehr')
    check('gewählt über „muster": Wendepunkte und Nackenlinie, Name vom Code', l && l.label.startsWith('Doppeltop, Nackenlinie gebrochen') && l.punkte.length === 4 && Number.isFinite(l.nacken.p1), JSON.stringify(l))
    check('Text: Name mit Nackenlinie', new RegExp(`Doppeltop, Nackenlinie gebrochen \\(.*\\) ${rk.id} \\(Nackenlinie jetzt`).test(r.text), r.text)
    check('Bedingung an der Nackenlinie erlaubt', r.bedingungen.length === 1 && Math.abs(r.bedingungen[0].schwelle - rk.nackenJetzt) < 1e-9, JSON.stringify(r.bedingungen))
    check('Prompt nennt Umkehrmuster (R)', systemText(false).includes('Umkehrmuster (R:'))
}

console.log('\nBeschriftung, Länge, Ortszeit (20.10.2026)\n')
{
    const r = pruefeChartAuswahl({
        linien: [
            { id: 'T1', label: 'Steigende Hochlinie (5 Berührungen)', grund: 'an den Hochs' },
            { id: 'N2', label: 'Fallende Hochlinie seit 14:45Z', grund: 'x' },
            { id: 'N4', label: 'Boden ab 09:30 UTC', grund: 'y' },
        ],
        zonen: [{ ids: ['N5'], label: 'Zone (12:00)', grund: 'z' }],
    }, paket)
    const t = r.linien.find((l) => l.id === 'T1')
    check('Trendlinie: Beschriftung vom Code, gemessene Berührungen, Rolle aus der Seite', t.label === 'Fallender Widerstand (3 Berührungen)', t.label)
    check('englisch ebenso', pruefeChartAuswahl({ linien: [{ id: 'T1', label: 'x' }] }, paket, { englisch: true }).linien[0].label === 'Falling resistance (3 touches)')
    check('Trendlinie trägt ihr Ende (tEnde/pEnde) statt endlos nach rechts', t.tEnde === T0 + 69 * H && t.pEnde === 104.8571 && t.beruehrungen === 3 && t.rolle === 'widerstand', JSON.stringify(t))
    check('Uhrzeit mit Z aus der Beschriftung entfernt', r.linien.find((l) => l.id === 'N2').label === 'Fallende Hochlinie', r.linien.find((l) => l.id === 'N2').label)
    check('Uhrzeit mit UTC entfernt', r.linien.find((l) => l.id === 'N4').label === 'Boden', r.linien.find((l) => l.id === 'N4').label)
    check('Zone: Uhrzeit in Klammern entfernt', r.zonen[0].label === 'Zone', r.zonen[0].label)
    const preis = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'Widerstand 1.25 / 105' }] }, paket)
    check('Gegenprobe: Preise in der Beschriftung bleiben', preis.linien[0].label === 'Widerstand 1.25 / 105', preis.linien[0].label)
    const e = baueChartEingabe({ symbol: 'X', interval: '1h', kerzen, paket: { ...paket, zeitzone: 'Europe/Zurich', kandidaten: paket.kandidaten.filter((k) => k.id === 'T1').map((k) => ({ ...k, beruehrT: [T0 + 5 * H, T0 + 20 * H, T0 + 40 * H] })), roh: [], volMedian: null } })
    check('Eingabe in Ortszeit, nirgends eine Zeit mit Z', e.includes('ZEITEN in Ortszeit (Europe/Zurich)') && !/\d\d:\d\dZ/.test(e), e.slice(0, 300))
    check('Trendlinie in der Eingabe mit Rolle und Berührungszeiten', /^T1 \| Widerstand an Hochs, fallend \| .* \| 3 \(\d\d\.\d\d\. \d\d:\d\d, /m.test(e), e.split('\n').find((z) => z.startsWith('T1')))
    const zwei = pruefeChartAuswahl({ linien: [{ id: 'T1', label: 'x', gewicht: 'stark' }] }, { ...paket, kandidaten: paket.kandidaten.map((k) => (k.id === 'T1' ? { ...k, beruehrungen: 2 } : k)) })
    check('Trendlinie mit 2 Berührungen: „stark" wird „mittel"', zwei.linien[0].gewicht === 'mittel' && zwei.linien[0].label === 'Fallender Widerstand (2 Berührungen)')
    check('Gegenprobe: mit 3 Berührungen bleibt „stark"', pruefeChartAuswahl({ linien: [{ id: 'T1', label: 'x', gewicht: 'stark' }] }, paket).linien[0].gewicht === 'stark')
    const doppelt = pruefeChartAuswahl({ text: 'Darunter liegt die Trendlinie [T1].', linien: [{ id: 'N2', label: 'x', grund: 'Trendlinie [T1] liegt darunter' }] }, paket)
    check('„Trendlinie [T1]" wird nicht zu „Trendlinie Trendlinie T1"', !/Trendlinie Trendlinie/.test(doppelt.text + doppelt.linien[0].grund) && doppelt.text.includes('die Trendlinie T1 (jetzt 106)'), doppelt.text)
    check('zeitText: 20.10.2026 14:45 UTC = 16:45 in Zürich', zeitText(Date.UTC(2026, 9, 20, 14, 45), 'Europe/Zurich') === '20.10. 16:45')
    check('zeitText: unbekannte Zone fällt auf UTC zurück statt zu werfen', zeitText(Date.UTC(2026, 9, 20, 14, 45), 'Mars/Olympus') === '20.10. 14:45')
}

console.log('\nAudit 4.3.4 (01.11.2026)\n')
{
    // FUN-F3-001: Bedingung an einem Kanal hängt an der Kante in der Richtung, nicht an der Mitte
    const K1 = { id: 'K1', quelle: 'kanal', richtung: 'auf', form: 'kanal', muster: null, laenge: 40, t1: T0, p1: 90, t2: T0 + 39 * H, p2: 96,
        tEnde: T0 + 49 * H, pEnde: 97.5, breite: 6, breiteAtr: 6, beruehrOben: 3, beruehrUnten: 3, ausserhalb: 0, untenJetzt: 96, obenJetzt: 102, preis: 99, abstandAtr: 0, bruch: null }
    const pk = { kurs: 99, atr: 1, vonT: T0, bisT: T0 + 39 * H, interval: '4h', roh: [], nutzer: [], spanne: null,
        kandidaten: [K1, { id: 'N1', quelle: 'niveau', preis: 100.5, tief: 100.3, hoch: 100.7, t1: T0 }, { id: 'N2', quelle: 'niveau', preis: 97.5, tief: 97.3, hoch: 97.7, t1: T0 },
            { id: 'N3', quelle: 'niveau', preis: 104, tief: 103.8, hoch: 104.2, t1: T0 }] }
    const bed = (b) => pruefeChartAuswahl({ text: '', muster: [{ id: 'K1' }], bedingungen: [b] }, pk)
    const ue = bed({ id: 'K1', richtung: 'ueber', dann: 'Ausbruch aus [K1]' }).bedingungen[0]
    check('Kanal „ueber": Schwelle = Oberkante, nicht die Mitte', ue?.schwelle === 102 && /Schluss über 102 \(K1, Oberkante\)/.test(ue.wenn), JSON.stringify(ue))
    const un = bed({ id: 'K1', richtung: 'unter', dann: 'Bruch aus [K1]' }).bedingungen[0]
    check('Kanal „unter": Schwelle = Unterkante', un?.schwelle === 96 && /unter 96 \(K1, Unterkante\)/.test(un.wenn), JSON.stringify(un))
    const imKanal = bed({ id: 'K1', richtung: 'ueber', dann: 'x', ziel: 'N1' })
    check('Ziel im Kanal (100,5) bei „über K1" verworfen', !imKanal.bedingungen.length && imKanal.verworfen.some((v) => v.grund === 'zielGegenRichtung'))
    check('Gegenprobe: Ziel über der Oberkante geht durch', bed({ id: 'K1', richtung: 'ueber', dann: 'x', ziel: 'N3' }).bedingungen[0]?.zielId === 'N3')
    const zielK = bed({ id: 'N2', richtung: 'ueber', dann: 'Weg zu [K1]', ziel: 'K1' }).bedingungen[0]
    check('Kanal als Ziel: liegt die Unterkante hinter der Schwelle, zählt die Oberkante', zielK?.zielId === 'K1', JSON.stringify(zielK))
    check('Prompt: Kanal-Bedingung an der Kante', systemText(false).includes('bei einem Kanal (K) jenseits der oberen Kante'))

    // FUN-F3-003: sichtbarAuf wie im Chart
    const hz = (id, p, sichtbarAuf, extra = {}) => ({ id, typ: 'horizontale', punkte: [{ t: T0 + 5 * H, p }], stil: {}, sichtbarAuf, versteckt: 0, ...extra })
    check('sichtbarAufTf: JSON-Text, Liste, null', !sichtbarAufTf({ sichtbarAuf: '["4h"]' }, '1h') && sichtbarAufTf({ sichtbarAuf: ['1h', '4h'] }, '1h') && sichtbarAufTf({ sichtbarAuf: null }, '1h') && sichtbarAufTf({ sichtbarAuf: '[]' }, '1h'))
    const p4 = baueKandidaten({ kerzen, interval: '1h', zeichnungen: [hz(1, 102, '["4h"]'), hz(2, 98, null)] })
    check('Zeichnung „nur 4h" fehlt in der 1h-Analyse, die übrige bleibt', p4.nutzer.length === 1 && p4.nutzer[0].zid === 2, JSON.stringify(p4.nutzer.map((u) => u.zid)))
    const nur4h = baueKandidaten({ kerzen, interval: '1h', zeichnungen: Array.from({ length: 20 }, (_, i) => hz(100 + i, 95 + i * 0.4, ['4h'])).concat(hz(999, 101, null)) })
    check('20 Zeichnungen „nur 4h" verdrängen die sichtbare nicht', nur4h.nutzer.length === 1 && nur4h.nutzer[0].zid === 999)

    // FUN-F3-004: über NUTZER_MAX hinaus entscheidet die Ordnung, nicht die Datenbank
    const alt = T0 - 30 * 24 * H
    const alte = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, typ: 'horizontale', punkte: [{ t: alt + i * 24 * H, p: 80 + i * 3 }], stil: {}, geaendertAm: 1 }))
    const neue = [
        { id: 30, typ: 'trendlinie', punkte: [{ t: T0 + 10 * H, p: 97 }, { t: T0 + 50 * H, p: 101 }], stil: {}, geaendertAm: 2 },
        { id: 31, typ: 'rechteck', punkte: [{ t: T0 + 20 * H, p: 99 }, { t: T0 + 55 * H, p: 101 }], stil: {}, geaendertAm: 2 },
        { id: 32, typ: 'kanal', punkte: [{ t: T0 + 15 * H, p: 96 }, { t: T0 + 50 * H, p: 99 }, { t: T0 + 15 * H, p: 103 }], stil: {}, geaendertAm: 2 },
    ]
    const w = waehleNutzer([...alte, ...neue], T0, T0 + 59 * H, { interval: '1h', kurs: 100 })
    check(`mehr als ${NUTZER_MAX}: neue Trendlinie, Zone und Kanal im Fenster sind drin`, [30, 31, 32].every((id) => w.liste.some((z) => z.id === id)) && w.liste.length === NUTZER_MAX, w.liste.map((z) => z.id).join(','))
    check('Weggelassene werden gezählt', w.weggelassen === 3, String(w.weggelassen))
    const fern = waehleNutzer(alte.concat(hz(50, 100.2, null, { punkte: [{ t: alt, p: 100.2 }] })), T0, T0 + 59 * H, { interval: '1h', kurs: 100 })
    check('ausserhalb des Fensters: näher am Kurs zuerst', fern.liste.some((z) => z.id === 50) && !fern.liste.some((z) => z.id === 20), fern.liste.map((z) => z.id).join(','))
    const pw = baueKandidaten({ kerzen, interval: '1h', zeichnungen: [...alte, ...neue] })
    check('Paket meldet nutzerWeggelassen, Eingabe sagt es dem Modell', pw.nutzerWeggelassen === 3 && /NICHT IN DER LISTE: 3 weitere/.test(baueChartEingabe({ symbol: 'X', interval: '1h', paket: pw, modus: 'eigene' })))

    // FUN-F3-010: Fib-Extension, Pfeil, Ellipse, Pinsel — gezählt statt still übergangen
    const neuTypen = [
        { id: 'a', typ: 'fibExt', punkte: [{ t: T0 + 20 * H, p: 95 }, { t: T0 + 30 * H, p: 104 }, { t: T0 + 40 * H, p: 100 }] },
        { id: 'b', typ: 'ellipse', punkte: [{ t: T0 + 40 * H, p: 97 }, { t: T0 + 50 * H, p: 99 }] },
        { id: 'c', typ: 'pfeil', punkte: [{ t: T0 + 45 * H, p: 97 }, { t: T0 + 55 * H, p: 103 }] },
    ]
    const nu = baueKandidaten({ kerzen, interval: '1h', zeichnungen: neuTypen })
    check('nur ungemessene Typen: keine U, aber nutzerUebergangen je Typ', nu.nutzer.length === 0 && nu.nutzerUebergangen.length === 3 && nu.nutzerUebergangen.every((x) => x.anzahl === 1), JSON.stringify(nu.nutzerUebergangen))
    const mitH = baueKandidaten({ kerzen, interval: '1h', zeichnungen: [...neuTypen, hz('e', 100, null)] })
    check('mit Horizontale: gemessen wird sie, die anderen stehen im Hinweis an das Modell', mitH.nutzer.length === 1 && /nicht messbar: 1× Fib-Extension, 1× Ellipse, 1× Pfeil/.test(baueChartEingabe({ symbol: 'X', interval: '1h', paket: mitH, modus: 'eigene' })))
    check('versteckte und „nur 4h" zählen auch dort nicht', baueKandidaten({ kerzen, interval: '1h', zeichnungen: [{ ...neuTypen[0], versteckt: 1 }, { ...neuTypen[1], sichtbarAuf: ['4h'] }] }).nutzerUebergangen.length === 0)

    // FUN-F3-005: unsichtbare Zeichen (Grok) — im JSON, in IDs, in [U1]
    const ZW = String.fromCodePoint(0x200B), BOM = String.fromCodePoint(0xFEFF), LS = String.fromCodePoint(0x2028)
    const roh = '{"text":"Die Linie [U1] hält.","linien":[{"id":"N2"}]}'
    const zwischen = roh.replace(',"linien"', ',' + ZW + '"linien"')
    check('Grok: Zeichen ZWISCHEN den JSON-Teilen → trotzdem JSON', parseJsonAntwort(zwischen) === null && parseJsonOhneUnsichtbare(zwischen)?.linien?.[0]?.id === 'N2')
    check('Grok: BOM und Zeichen im String weg, auch als Escape', parseJsonOhneUnsichtbare(BOM + roh.replace('[U1]', '[U1' + ZW + ']'))?.text === 'Die Linie [U1] hält.'
        && parseJsonOhneUnsichtbare(roh.replace('[U1]', '[U1' + String.fromCharCode(92) + 'u200B]'))?.text === 'Die Linie [U1] hält.')
    check('Grok: roher Zeilentrenner im String bricht das JSON nicht', parseJsonOhneUnsichtbare(zwischen.replace('Linie', 'Li' + LS + 'nie'))?.linien?.length === 1)
    check('istGrok: xAI und Grok über Vermittler, sonst nicht', istGrok({ provider: 'xai' }) && istGrok({ provider: 'openrouter', model: 'x-ai/grok-4' }) && !istGrok({ provider: 'anthropic', model: 'claude-sonnet' }))
    const pu = { atr: 1, kurs: 100, roh: [], kandidaten: [{ id: 'N2', quelle: 'niveau', preis: 105, tief: 104.8, hoch: 105.2, t1: T0 }],
        nutzer: [{ id: 'U1', zid: 41, typ: 'horizontale', name: 'Horizontale 103', preis: 103, punkte: [{ t: T0, p: 103 }], text: '' }] }
    const ru = pruefeChartAuswahl({ text: 'Die Linie [U1' + ZW + '] hält.', bewertungen: [{ u: 'U1' + ZW, text: '[U1] wirkt als Widerstand.' }] }, pu, { modus: 'eigene', ergaenzen: false })
    check('Chart-KI: [U1+Nullbreite] wird ersetzt, ID mit Zeichen erkannt', ru.text === 'Die Linie Horizontale 103 (U1) hält.' && ru.bewertungen.length === 1, ru.text)
    check('Chart-KI: Kandidaten-ID mit Zeichen wird gezeichnet', pruefeChartAuswahl({ text: 'x', linien: [{ id: 'N2' + ZW, label: 'y' }] }, pu).linien.length === 1)

    // BUG-L1-002: „Marktdaten aus" sperrt nicht 45 s
    check('„Marktdaten aus" und „Quelle aus" sperren nicht, 400/429 auch nicht', !sperrtNachFehler(new MarktdatenAus('kerzen', 'aus')) && !sperrtNachFehler(new QuelleAus('X', 'aus'))
        && !sperrtNachFehler(Object.assign(new Error('x'), { status: 400 })) && !sperrtNachFehler(Object.assign(new Error('x'), { status: 429 })))
    check('Gegenprobe: ein bezahlter Fehlschlag sperrt', sperrtNachFehler(new Error('Die KI hat keine verwertbare Analyse geliefert')))

    // FUN-L1-001: die Erfolgsantwort heisst nicht mehr `aus`, der Reiter prüft `aus === true`
    const quelle = fs.readFileSync(new URL('./chart-ki.js', import.meta.url), 'utf8')
    const reiter = fs.readFileSync(new URL('../src/components/chart/KiReiter.vue', import.meta.url), 'utf8')
    check('Erfolgsantwort trägt `herkunft`, nicht `aus`', !/aus: '(neu|sperre)'/.test(quelle) && /herkunft: 'neu'/.test(quelle) && /herkunft: 'sperre'/.test(quelle))
    check('KI-Reiter: {aus: true} wird QuelleAus, nicht Analyse', /if \(data\?\.aus === true\) \{ quelleAus\.value = data; return \}\s*\n\s*setzeKiAnalyse\(data\)/.test(reiter) && reiter.includes('<QuelleAus v-if="quelleAus"'))
    // SEC-L6-001: das Bild an die KI entsteht ohne Kontowerte
    check('KI-Bild mit ohneKontowerte', reiter.includes('props.bild?.({ ohneKontowerte: true })'))
}

console.log('\nWächter\n')
{
    const schlecht = pruefeChartAuswahl({
        text: 'SOL dürfte in den nächsten Stunden steigen.',
        linien: [{ id: 'N2', label: 'Kursziel 120', grund: 'Kursziel nach Ausbruch' }],
        bedingungen: [{ id: 'N2', richtung: 'ueber', dann: 'jetzt kaufen' }],
    }, paket)
    check('Prognose im Text verworfen', schlecht.text === '')
    check('Kursziel in Beschriftung verworfen', schlecht.verworfen.some((v) => v.grund === 'prognose' && v.art === 'linie'))
    check('Empfehlung in Bedingung verworfen', schlecht.bedingungen.length === 0)
    check('ganz leer → leer = true', schlecht.leer === true)
    const negiert = pruefeChartAuswahl({ text: 'Eine Prognose lässt sich daraus nicht ableiten; die Spanne ist eng.' }, paket)
    check('Gegenprobe: verneinte „Prognose" geht durch', negiert.text !== '')
    // S12: früher hob `{ empfehlungen: true }` die Prüfung auf — die Option gibt es nicht mehr.
    const erlaubt = pruefeChartAuswahl({ text: 'SOL dürfte steigen.' }, paket, { empfehlungen: true })
    check('auch mit altem Schalter-Argument bleibt die Sperre', erlaubt.text === '')
    check('fehlende Antwort bricht nichts', pruefeChartAuswahl(null, paket).leer === true)
}

// Überblick über das ganze Fenster (01.11.2026, RENDERUSDT 1h: nur Marken am rechten Rand gezeichnet)
{
    // Absturz von 200 auf 140 mit Zwischenerholung, dann Seitwärts am Ende
    const pfad = []
    for (let i = 0; i < 400; i++) {
        const basis = i < 100 ? 200 - i * 0.3 : i < 160 ? 170 + (i - 100) * 0.25 : i < 300 ? 185 - (i - 160) * 0.32 : 140 + Math.sin(i / 3)
        pfad.push({ t: i * 3600000, o: basis, h: basis + 1, l: basis - 1, c: basis + (i % 2 ? 0.3 : -0.3), v: 100 })
    }
    const ub = fensterUeberblick(pfad)
    check('Überblick: Anfang → Ende in %', ub && Math.abs(ub.aenderungPct - ((pfad[399].c / pfad[0].o - 1) * 100)) < 1e-9, JSON.stringify(ub?.aenderungPct))
    check('Überblick: Hoch und Tief des ganzen Fensters', ub.hoch.p === 201 && ub.tief.p === Math.min(...pfad.map((k) => k.l)))
    check('Überblick: höchstens 8 grosse Wellen, abwechselnd Hoch/Tief', ub.wellen.length >= 2 && ub.wellen.length <= 8 && ub.wellen.every((w, i) => i === 0 || w.hoch !== ub.wellen[i - 1].hoch), JSON.stringify(ub.wellen))
    check('Überblick: die Zwischenerholung (Hoch um Kerze 160) ist eine Welle', ub.wellen.some((w) => w.hoch && w.t >= 150 * 3600000 && w.t <= 170 * 3600000), JSON.stringify(ub.wellen))
    const pk = baueKandidaten({ kerzen: pfad, interval: '1h', zeitzone: 'UTC' })
    const text = kandidatenText(pk)
    check('Eingabe nennt das ganze Fenster und die grossen Wellen', text.includes('GANZES FENSTER') && text.includes('GROSSE WELLEN'))
    const sys = systemText(false)
    check('Prompt verlangt die übergeordnete Struktur, nicht nur Marken am Kurs', sys.includes('Übergeordnete Struktur') && sys.includes('rechten Rand') && !sys.includes('NUR was für ein mögliches Setup JETZT'))
    check('fensterUeberblick ohne Kerzen → null', fensterUeberblick([]) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
