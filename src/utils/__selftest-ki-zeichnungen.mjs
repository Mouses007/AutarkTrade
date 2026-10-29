/**
 * Selbsttest: KI-Analyse → Zeichnungen (kiZeichnungen.js).
 *
 *   node src/utils/__selftest-ki-zeichnungen.mjs
 *
 * Ältere Analysen (vor dem Umbau auf IDs, 18.10.2026) liegen bis zu 30 min im
 * Cache und müssen genauso gezeichnet werden wie bisher.
 */
import { kanalAlsZeichnung, linieAlsZeichnung, zoneAlsZeichnung, kiVorschau, kandidatenVorschau, KI_FARBEN, hatProfil, anzeigeAnalyse, vorschauAnalyse, leereMarken, markenSchluessel } from './chart/kiZeichnungen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nAltes Format\n')
{
    const l = linieAlsZeichnung({ art: 'widerstand', t1: 10, p1: 100, t2: 20, p2: 101, label: 'W' })
    check('Widerstand mit zwei Preisen → waagerecht am höheren, rot', l.typ === 'strahlH' && l.punkte[0].p === 101 && l.stil.farbe === KI_FARBEN.widerstand)
    check('ohne ID: Beschriftung unverändert, Breite 1', l.stil.text === 'W' && l.stil.breite === 1)
    const z = zoneAlsZeichnung({ art: 'unterstuetzung', tief: 90, hoch: 91, label: 'Z' }, 5, 50)
    check('Zone ohne vonT über den ganzen Bereich', z.punkte[0].t === 5 && z.punkte[1].t === 50 && z.stil.text === 'Z')
}

console.log('\nNeues Format\n')
{
    const l = linieAlsZeichnung({ id: 'N4', art: 'unterstuetzung', t1: 10, p1: 98, t2: 20, p2: 98, label: 'Boden', gewicht: 'stark' })
    check('Beschriftung trägt die ID', l.stil.text === 'Boden (N4)', l.stil.text)
    check('„stark" → Breite 2', l.stil.breite === 2)
    const t = linieAlsZeichnung({ id: 'T1', art: 'trend', t1: 10, p1: 110, t2: 40, p2: 105, label: 'Abwärtslinie' })
    check('alte Trendlinie (ohne tEnde) bleibt schräg, nach rechts verlängert, lila', t.typ === 'trendlinie' && t.stil.rechts === true && t.stil.farbe === KI_FARBEN.trend)
    // 20.10.2026: bis tEnde gezeichnet, nicht ins Unendliche; Beschriftung am Ende statt am zweiten Anker
    const neu = linieAlsZeichnung({ id: 'T1', art: 'trend', t1: 10, p1: 110, t2: 40, p2: 105, tEnde: 70, pEnde: 100, label: 'Fallender Widerstand (3 Berührungen)' })
    check('Trendlinie mit tEnde: Strecke Anker 1 → Ende, nicht verlängert', neu.punkte[0].t === 10 && neu.punkte[1].t === 70 && neu.punkte[1].p === 100 && neu.stil.rechts === false, JSON.stringify(neu))
    check('… Beschriftung am Ende der Strecke', neu.stil.textPos === 'ende' && neu.stil.text === 'Fallender Widerstand (3 Berührungen) (T1)', JSON.stringify(neu.stil))
    check('waagerechte KI-Linie: Beschriftung am rechten Rand', l.stil.textPos === 'rechts')
    const z = zoneAlsZeichnung({ art: 'widerstand', tief: 104, hoch: 105, ids: ['N2', 'N3'], vonT: 30, label: 'Deckel' }, 5, 50)
    check('Zone beginnt bei vonT, Beschriftung mit IDs', z.punkte[0].t === 30 && z.stil.text === 'Deckel (N2+N3)', JSON.stringify(z))
    const ohne = linieAlsZeichnung({ id: null, art: 'unterstuetzung', t1: 1, p1: 98, t2: 2, p2: 98, label: 'Boden' })
    check('übernommen (id: null) ohne ID im Text', ohne.stil.text === 'Boden')
}

console.log('\nKandidaten\n')
{
    const analyse = {
        kerzenVon: 1, kerzenBis: 99,
        linien: [{ id: 'N1', art: 'widerstand', t1: 1, p1: 110, t2: 99, p2: 110, label: 'a' }],
        zonen: [{ ids: ['N2'], art: 'widerstand', tief: 104, hoch: 105, label: 'b' }],
        auswahl: { kandidaten: [
            { id: 'N1', quelle: 'niveau', preis: 110, t1: 1 }, { id: 'N2', quelle: 'niveau', preis: 104.5, t1: 5 },
            { id: 'N3', quelle: 'niveau', preis: 98, t1: 7 }, { id: 'V1', quelle: 'volumenprofil', name: 'POC', preis: 101, t1: 1 },
            { id: 'T1', quelle: 'trend', t1: 2, p1: 112, t2: 40, p2: 106 },
        ] },
    }
    const k = kandidatenVorschau(analyse)
    check('nur nicht gewählte Kandidaten (N3, T1) — V gehört zum Profil, keine graue Einzellinie', k.map((x) => x.stil.text).join() === 'N3,T1', k.map((x) => x.stil.text).join())
    check('grau gepunktet, eigene negative IDs', k.every((x) => x.stil.strich === 'gepunktet' && x.id <= -300))
    check('ohne Schalter nicht in der Vorschau', kiVorschau(analyse).length === 2)
    check('mit Schalter dazu', kiVorschau({ ...analyse, _alle: true }).length === 4)
    check('alte Analyse ohne auswahl → keine Kandidaten, kein Fehler', kandidatenVorschau({ linien: [] }).length === 0)
}

console.log('\nVolumenprofil\n')
{
    const a = {
        kerzenVon: 1, kerzenBis: 99,
        linien: [{ id: 'V1', quelle: 'volumenprofil', art: 'widerstand', t1: 1, p1: 105, t2: 99, p2: 105, label: 'POC' }, { id: 'V2', quelle: 'volumenprofil', art: 'widerstand', t1: 1, p1: 107, t2: 99, p2: 107, label: 'VAH' }, { id: 'N1', quelle: 'niveau', art: 'unterstuetzung', t1: 3, p1: 98, t2: 99, p2: 98, label: 'Boden' }],
        zonen: [{ ids: ['V3'], art: 'unterstuetzung', tief: 99, hoch: 100, label: 'VAL' }],
    }
    const v = kiVorschau(a)
    const profile = v.filter((z) => z.typ === 'volprofil')
    check('alte Analyse ohne Abschnitte → EIN Profil über den Bereich', profile.length === 1 && profile[0].punkte[0].t === 1 && profile[0].punkte[1].t === 99)
    check('Hausfarbe mit POC/VAH/VAL wie das Werkzeug (Profil ist immer einfarbig)', profile[0].stil.farbe === '#1fd6c4' && profile[0].stil.marken === true)
    // Neu: V-Marken tragen ihren Abschnitt → ein Profil je Abschnitt, nur über dessen Zeit
    const b = { ...a, auswahl: { kandidaten: [
        { id: 'V1', abschnitt: 'A1', t1: 60, t2: 99 }, { id: 'V2', abschnitt: 'A1', t1: 60, t2: 99 }, { id: 'V3', abschnitt: 'A2', t1: 20, t2: 60 },
    ] } }
    const pb = kiVorschau(b, { profilStil: { farbe: '#ffeb3b', zeilen: 120 } }).filter((z) => z.typ === 'volprofil')
    check('zwei Abschnitte gewählt → zwei Profile über ihre Zeit', pb.length === 2 && pb.some((z) => z.punkte[0].t === 60 && z.punkte[1].t === 99) && pb.some((z) => z.punkte[0].t === 20 && z.punkte[1].t === 60), JSON.stringify(pb.map((z) => z.punkte)))
    check('Stil = zuletzt benutzter des Profil-Werkzeugs', pb[0].stil.farbe === '#ffeb3b' && pb[0].stil.zeilen === 120)
    check('keine V-Linie und keine V-Zone mehr einzeln', !v.some((z) => /V\d/.test(z.stil?.text || '')) && v.length === 2, JSON.stringify(v.map((z) => z.typ)))
    check('Gegenprobe: ohne V kein Profil', !hatProfil({ linien: [{ id: 'N1' }], zonen: [] }))
}

console.log('\nÜbernehmen, verwerfen, erledigt, zurücksetzen (22.10.2026)\n')
{
    const a = {
        symbol: 'BTCUSDT', interval: '1h', markt: 'futures', stand: 123, kerzenVon: 1, kerzenBis: 99,
        linien: [
            { id: 'T1', art: 'trend', t1: 10, p1: 110, t2: 40, p2: 105, tEnde: 70, pEnde: 100, label: 'a' },
            { id: 'N1', art: 'widerstand', t1: 1, p1: 112, t2: 99, p2: 112, label: 'b' },
            { id: 'V1', quelle: 'volumenprofil', art: 'widerstand', t1: 1, p1: 104, t2: 99, p2: 104, label: 'poc' },
        ],
        zonen: [{ ids: ['N2'], art: 'unterstuetzung', tief: 95, hoch: 96, label: 'z' }],
        auswahl: { kandidaten: [{ id: 'V1', quelle: 'volumenprofil', abschnitt: 'A1', t1: 5, t2: 90, preis: 104 }] },
    }
    const roh = kiVorschau(a)
    check('jede Vorschau trägt ihren Schlüssel (linie0, linie1, zone0, profil) — Klick im Chart', ['linie0', 'linie1', 'zone0', 'profil'].every((k) => roh.some((z) => z.ki === k)), roh.map((z) => z.ki).join())
    check('graue Kandidaten sind nicht anklickbar', kiVorschau({ ...a, _alle: true, auswahl: { kandidaten: [{ id: 'N9', quelle: 'niveau', preis: 90, t1: 1 }] } }).filter((z) => z.stil.strich === 'gepunktet').every((z) => !z.ki))
    const m = { ...leereMarken(), uebernommen: ['linie0'], geloescht: ['zone0'] }
    const v = vorschauAnalyse(a, m)
    check('Vorschau ohne Übernommenes (jetzt eigene Linie) und Verworfenes', v.linien.map((l) => l._key).join() === 'linie1,linie2' && v.zonen.length === 0)
    check('… Schlüssel bleiben die ursprünglichen, auch gefiltert', kiVorschau(v).some((z) => z.ki === 'linie1') && !kiVorschau(v).some((z) => z.ki === 'linie0'))
    const an = anzeigeAnalyse(a, m)
    check('Reiter vor „erledigt": alles ausser dem Verworfenen', an.linien.length === 3 && an.zonen.length === 0)
    const fertig = { ...m, erledigt: true }
    check('„Vorschau erledigt": keine gestrichelten Linien mehr', vorschauAnalyse(a, fertig) === null && kiVorschau(vorschauAnalyse(a, fertig)).length === 0)
    const anF = anzeigeAnalyse(a, fertig)
    check('… Reiter zeigt die Analyse weiter, nur mit dem Eingezeichneten', anF && anF.linien.map((l) => l._key).join() === 'linie0' && anF.zonen.length === 0)
    check('… Text und Bedingungen bleiben', anzeigeAnalyse({ ...a, text: 'x', bedingungen: [{ id: 'N1' }] }, fertig).text === 'x')
    const profil = { ...leereMarken(), uebernommen: ['profil', 'linie2'] }
    check('Profil übernommen: kein gestricheltes Profil mehr', !kiVorschau(vorschauAnalyse(a, profil)).some((z) => z.ki === 'profil'))
    check('„Analyse zurücksetzen": Reiter leer, Vorschau leer', anzeigeAnalyse(a, { ...fertig, zurueck: true }) === null && vorschauAnalyse(a, { ...fertig, zurueck: true }) === null)
    check('Schlüssel je Analyse: Symbol, Zeiteinheit, Markt, Zeitpunkt', markenSchluessel(a) === 'BTCUSDT|1h|futures|123' && markenSchluessel({ ...a, stand: 124 }) !== markenSchluessel(a))
    check('ohne Analyse nichts', anzeigeAnalyse(null) === null && vorschauAnalyse(null) === null)
}

console.log('\nKanal-Beschriftung\n')
{
    const k = { id: 'K1', art: 'kanal', richtung: 'ab', t1: 10, p1: 100, t2: 40, p2: 95, breite: 2 }
    const kurz = kanalAlsZeichnung({ ...k, label: 'Absteigender Kanal (5/3 Berührungen, nach unten verlassen)', labelKurz: 'Absteigender Kanal, nach unten verlassen' })
    check('im Chart der kurze Name ohne Berührungszahlen', kurz.stil.text === 'Absteigender Kanal, nach unten verlassen (K1)', kurz.stil.text)
    check('ältere Analyse ohne labelKurz: langer Name', kanalAlsZeichnung({ ...k, label: 'Absteigender Kanal (5/3 Berührungen)' }).stil.text === 'Absteigender Kanal (5/3 Berührungen) (K1)')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
