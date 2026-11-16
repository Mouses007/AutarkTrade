/**
 * Selbsttest der Sitzungs-Abschnitte und Zahlen-Marken im Aktien-Chart
 * (`utils/chart/sitzungsAbschnitte.js`).
 *
 *   node src/utils/__selftest-sitzungs-abschnitte.mjs
 */
import { artDerKerze, sitzungsAbschnitte, zahlenMarken, SITZUNG_BIS_MS } from './chart/sitzungsAbschnitte.js'
import { OVERLAYS, overlaysFuer, overlayAn } from './chart/overlays/liste.js'
import { einstiegRegulaer, kerzeBeruehrtRegulaer } from '../../shared/aktien-sitzung.js'
import { AktienEbene, schildFlaechen, schildTreffer, LINIEN_FUSS } from './chart/overlays/AktienEbene.js'
import { kursReaktion, zahlenKarteDaten, boersenLage, grosseZahl } from './chart/zahlenKarte.js'
import { researchZiel, researchAdresse } from './researchZiel.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const MIN = 60_000, H = 60 * MIN
const reihe = (von, bis, iv) => { const a = []; for (let t = von; t < bis; t += iv) a.push(t); return a }
const zeige = (abschnitte, zeiten) => abschnitte.map((a) => `${a.art} ${new Date(zeiten[a.von]).toISOString().slice(5, 16)}–${new Date(zeiten[a.bis]).toISOString().slice(5, 16)}`).join(' | ')

console.log('Eine Kerze')
// Mittwoch 12.8.2026, Sommerzeit: New York = UTC−4 → regulär 13:30–20:00 UTC
const MI = Date.UTC(2026, 7, 12)
check('15m um 13:15 UTC: vorbörslich', artDerKerze(MI + 13 * H + 15 * MIN, 15 * MIN) === 'rand')
check('15m um 13:30 UTC: regulär, keine Fläche', artDerKerze(MI + 13 * H + 30 * MIN, 15 * MIN) === null)
check('15m um 19:45 UTC: noch regulär', artDerKerze(MI + 19 * H + 45 * MIN, 15 * MIN) === null)
check('15m um 20:00 UTC: nachbörslich', artDerKerze(MI + 20 * H, 15 * MIN) === 'rand')
check('15m um 00:00 UTC (20:00 New York): Nacht', artDerKerze(MI, 15 * MIN) === 'nacht')
check('15m um 08:00 UTC (04:00 New York): vorbörslich', artDerKerze(MI + 8 * H, 15 * MIN) === 'rand')
check('1h um 13:00 UTC enthält die Eröffnung: frei', artDerKerze(MI + 13 * H, H) === null)
check('1h um 12:00 UTC: vorbörslich', artDerKerze(MI + 12 * H, H) === 'rand')
check('4h um 12:00 UTC enthält die Eröffnung: frei', artDerKerze(MI + 12 * H, 4 * H) === null)
check('4h um 20:00 UTC: ganz nachbörslich', artDerKerze(MI + 20 * H, 4 * H) === 'rand')
check('4h um 00:00 UTC (20:00–24:00 New York): Nacht', artDerKerze(MI, 4 * H) === 'nacht')
check('4h um 04:00 UTC (00:00–04:00 New York): Nacht', artDerKerze(MI + 4 * H, 4 * H) === 'nacht')
check('Samstag: geschlossen', artDerKerze(Date.UTC(2026, 7, 15, 15), 15 * MIN) === 'zu')

console.log('\nAbschnitte bündeln')
{
    // Ein ganzer UTC-Mittwoch auf 15m: Nacht, vor, (regulär), nach — um 24:00 UTC (20:00 New York) begänne die nächste Nacht
    const zeiten = reihe(MI, MI + 24 * H, 15 * MIN)
    const a = sitzungsAbschnitte(zeiten, 15 * MIN)
    check('96 Kerzen → 3 Abschnitte', a.length === 3, zeige(a, zeiten))
    check('Reihenfolge Nacht, Rand, Rand', a.map((x) => x.art).join() === 'nacht,rand,rand', zeige(a, zeiten))
    check('Nacht bis 07:45 UTC', zeiten[a[0].bis] === MI + 7 * H + 45 * MIN)
    check('vorbörslich 08:00–13:15 UTC', zeiten[a[1].von] === MI + 8 * H && zeiten[a[1].bis] === MI + 13 * H + 15 * MIN)
    check('nachbörslich 20:00–23:45 UTC', zeiten[a[2].von] === MI + 20 * H && zeiten[a[2].bis] === MI + 23 * H + 45 * MIN)
    const frei = zeiten.length - a.reduce((s, x) => s + x.bis - x.von + 1, 0)
    check('frei bleiben 26 Kerzen (6,5 h regulär)', frei === 26, String(frei))
}
{
    // Wochenende auf 1m: Freitag 14.8. 20:00 New York (= Sa 00:00 UTC) bis Sonntag 20:00 New York
    const von = Date.UTC(2026, 7, 14, 22), bis = Date.UTC(2026, 7, 17, 2)
    const zeiten = reihe(von, bis, MIN)
    const a = sitzungsAbschnitte(zeiten, MIN)
    const zu = a.filter((x) => x.art === 'zu')
    check('Wochenende ist EIN Abschnitt', zu.length === 1, zeige(a, zeiten))
    check('… von Sa 00:00 UTC bis So 23:59 UTC (2880 Kerzen)', zu[0] && zeiten[zu[0].von] === Date.UTC(2026, 7, 15) && zu[0].bis - zu[0].von + 1 === 2880)
    check('davor nachbörslich, danach Nacht', a[0].art === 'rand' && a[a.length - 1].art === 'nacht', zeige(a, zeiten))
}

console.log('\nSommerzeit-Wechsel')
{
    // USA: Sommerzeit ab So 8.3.2026. Freitag 6.3. (UTC−5): regulär 14:30–21:00 UTC; Montag 9.3. (UTC−4): 13:30–20:00 UTC
    check('Fr 6.3. 14:15 UTC: vorbörslich', artDerKerze(Date.UTC(2026, 2, 6, 14, 15), 15 * MIN) === 'rand')
    check('Fr 6.3. 14:30 UTC: regulär', artDerKerze(Date.UTC(2026, 2, 6, 14, 30), 15 * MIN) === null)
    check('Mo 9.3. 13:30 UTC: regulär (eine Stunde früher)', artDerKerze(Date.UTC(2026, 2, 9, 13, 30), 15 * MIN) === null)
    check('Mo 9.3. 20:00 UTC: nachbörslich', artDerKerze(Date.UTC(2026, 2, 9, 20), 15 * MIN) === 'rand')
    check('Fr 6.3. 20:30 UTC: in Winterzeit noch regulär', artDerKerze(Date.UTC(2026, 2, 6, 20, 30), 15 * MIN) === null)
    // Ende der Sommerzeit: So 1.11.2026. Montag 2.11. (UTC−5): regulär 14:30–21:00 UTC
    check('Mo 2.11. 13:30 UTC: wieder vorbörslich', artDerKerze(Date.UTC(2026, 10, 2, 13, 30), 15 * MIN) === 'rand')
    check('Mo 2.11. 14:30 UTC: regulär', artDerKerze(Date.UTC(2026, 10, 2, 14, 30), 15 * MIN) === null)
    // Das Wochenende der Umstellung hat 47 Stunden zwischen Fr 20:00 und So 20:00 New Yorker Zeit
    const zeiten = reihe(Date.UTC(2026, 2, 6, 12), Date.UTC(2026, 2, 9, 12), H)
    const zu = sitzungsAbschnitte(zeiten, H).filter((x) => x.art === 'zu')
    check('Umstellungs-Wochenende: 47 Stundenkerzen geschlossen', zu.length === 1 && zu[0].bis - zu[0].von + 1 === 47, zu.map((x) => x.bis - x.von + 1).join())
    check('… beginnt Sa 01:00 UTC (Fr 20:00 Winterzeit)', zu[0] && zeiten[zu[0].von] === Date.UTC(2026, 2, 7, 1))
    check('… endet vor Mo 00:00 UTC (So 20:00 Sommerzeit)', zu[0] && zeiten[zu[0].bis] === Date.UTC(2026, 2, 8, 23))
}

console.log('\nUS-Feiertag')
{
    // Thanksgiving, Do 26.11.2026 (Winterzeit): geschlossen von Mi 20:00 bis Do 20:00 New Yorker Zeit
    check('Do 26.11. 15:00 UTC: geschlossen', artDerKerze(Date.UTC(2026, 10, 26, 15), 15 * MIN) === 'zu')
    const zeiten = reihe(Date.UTC(2026, 10, 25, 12), Date.UTC(2026, 10, 27, 12), 15 * MIN)
    const a = sitzungsAbschnitte(zeiten, 15 * MIN)
    const zu = a.filter((x) => x.art === 'zu')
    check('Feiertag ist EIN Abschnitt von 24 Stunden', zu.length === 1 && zu[0].bis - zu[0].von + 1 === 96, zeige(a, zeiten))
    check('… ab Do 01:00 UTC (Mi 20:00 New York)', zu[0] && zeiten[zu[0].von] === Date.UTC(2026, 10, 26, 1))
    check('Mittwoch davor regulär frei', artDerKerze(Date.UTC(2026, 10, 25, 15), 15 * MIN) === null)
    check('Freitag danach regulär frei', artDerKerze(Date.UTC(2026, 10, 27, 15), 15 * MIN) === null)
    // Der Freitag nach Thanksgiving ist verkürzt: Schluss 13:00 New York = 18:00 UTC
    check('verkürzter Tag: 17:45 UTC noch frei', artDerKerze(Date.UTC(2026, 10, 27, 17, 45), 15 * MIN) === null)
    check('verkürzter Tag: ab 18:00 UTC nachbörslich', artDerKerze(Date.UTC(2026, 10, 27, 18), 15 * MIN) === 'rand')
    check('verkürzter Tag: 4h-Kerze ab 16:00 UTC berührt die Sitzung', artDerKerze(Date.UTC(2026, 10, 27, 16), 4 * H) === null)
    check('verkürzter Tag: 1h-Kerze 20:00 UTC ist Rand, am Mittwoch davor frei',
        artDerKerze(Date.UTC(2026, 10, 27, 20), H) === 'rand' && artDerKerze(Date.UTC(2026, 10, 25, 20), H) === null)
    // Montags-Feiertag hängt am Wochenende: Labor Day, Mo 7.9.2026 — eine Fläche von Fr 20:00 bis Mo 20:00
    const lang = reihe(Date.UTC(2026, 8, 4, 12), Date.UTC(2026, 8, 8, 12), H)
    const zuLang = sitzungsAbschnitte(lang, H).filter((x) => x.art === 'zu')
    check('Wochenende + Montags-Feiertag: EIN Abschnitt von 72 h', zuLang.length === 1 && zuLang[0].bis - zuLang[0].von + 1 === 72, String(zuLang[0]?.bis - zuLang[0]?.von + 1))
}

console.log('\nGrenzen und Laufzeit')
{
    check('1d: keine Abschnitte', sitzungsAbschnitte(reihe(MI, MI + 30 * 24 * H, 24 * H), 24 * H).length === 0)
    check('4h ist die grösste Zeiteinheit', SITZUNG_BIS_MS === 4 * H && sitzungsAbschnitte(reihe(MI, MI + 48 * H, 6 * H), 6 * H).length === 0)
    check('leere Liste', sitzungsAbschnitte([], MIN).length === 0)
    check('ohne Kerzenlänge', sitzungsAbschnitte([MI], 0).length === 0)
    const zeiten = reihe(MI, MI + 5000 * 15 * MIN, 15 * MIN)
    const merker = new Map()
    let t0 = performance.now()
    const erste = sitzungsAbschnitte(zeiten, 15 * MIN, merker)
    const kalt = performance.now() - t0
    t0 = performance.now()
    const zweite = sitzungsAbschnitte(zeiten, 15 * MIN, merker)
    const warm = performance.now() - t0
    check(`5000 Kerzen in < 200 ms (${kalt.toFixed(1)} ms, mit Merker ${warm.toFixed(2)} ms)`, kalt < 200 && warm < 50)
    check('Merker ändert das Ergebnis nicht', JSON.stringify(erste) === JSON.stringify(zweite))
    check('5000 Kerzen 15m → unter 250 Abschnitte', erste.length < 250, String(erste.length))
    // Lücke in den Daten: Abschnitte laufen über Indizes weiter, nichts bricht
    const mitLuecke = [...reihe(MI, MI + 2 * H, 15 * MIN), ...reihe(MI + 30 * H, MI + 32 * H, 15 * MIN)]
    check('Datenlücke: gleiche Art bleibt ein Abschnitt', sitzungsAbschnitte(mitLuecke, 15 * MIN).length === 1)
}

console.log('\nZahlen-Marken')
{
    const jetzt = Date.UTC(2026, 10, 15, 12)
    const naechster = Date.UTC(2026, 10, 17, 21, 20)
    const m = zahlenMarken({ naechster: { zeit: naechster, geschaetzt: false }, vergangene: [Date.UTC(2026, 7, 26, 20, 20), Date.UTC(2026, 4, 27, 20, 20)] }, jetzt)
    check('drei Marken, aufsteigend', m.length === 3 && m[0].zeit < m[1].zeit && m[1].zeit < m[2].zeit)
    check('vergangene: nicht kommend, keine Tage', m[0].kommend === false && m[0].tage === null)
    check('nächster in 2 Tagen', m[2].kommend === true && m[2].tage === 2, String(m[2].tage))
    check('nicht geschätzt', m[2].geschaetzt === false)
    const g = zahlenMarken({ naechster: { zeit: naechster, geschaetzt: true }, vergangene: [] }, jetzt)
    check('geschätzter Termin ist gekennzeichnet', g.length === 1 && g[0].geschaetzt === true)
    const alt = zahlenMarken({ naechster: { zeit: jetzt - 3 * 86_400_000, geschaetzt: true }, vergangene: [] }, jetzt)
    check('überholter «nächster» Termin ist ein gewöhnlicher', alt[0].kommend === false && alt[0].geschaetzt === false && alt[0].tage === null)
    check('heute = 0 Tage', zahlenMarken({ naechster: { zeit: jetzt + 5 * H }, vergangene: [] }, jetzt)[0].tage === 0)
    // FUN-H-011: Kalendertage nach New Yorker Datum statt gerundeter 24-h-Blöcke
    const abends = Date.UTC(2026, 10, 18, 21, 20)
    check('Meldung heute Abend (in 14 h) = 0 Tage', zahlenMarken({ naechster: { zeit: abends }, vergangene: [] }, abends - 14 * H)[0].tage === 0)
    check('in 39 Stunden, aber morgen = 1 Tag', zahlenMarken({ naechster: { zeit: abends }, vergangene: [] }, abends - 39 * H)[0].tage === 1)
    check('doppelter Termin nur einmal', zahlenMarken({ naechster: { zeit: naechster }, vergangene: [naechster] }, jetzt).length === 1)
    check('unbekannt (null) → nichts', zahlenMarken(null, jetzt).length === 0)
    check('kein nächster Termin → nur vergangene', zahlenMarken({ naechster: null, vergangene: [1e12] }, jetzt).length === 1)
    check('Unsinn fällt weg', zahlenMarken({ naechster: { zeit: NaN }, vergangene: [0, null, 'x'] }, jetzt).length === 0)
}

console.log('\nOverlay-Liste: Coins sehen die Aktien-Ebenen nicht')
{
    const coin = overlaysFuer(false).map((o) => o.id)
    const aktie = overlaysFuer(true).map((o) => o.id)
    check('Coin: genau die fünf bisherigen', coin.join() === 'positionen,journal,liquidationen,hebelzonen,orderbuch', coin.join())
    // Seit der Trennung der Märkte: die Krypto-Ebenen (Liquidationen, Hebelzonen) gibt es bei Aktien nicht.
    check('Aktie: Zahlen und Sitzungen statt der Krypto-Ebenen', aktie.join() === 'positionen,journal,orderbuch,zahlen,sitzungen', aktie.join())
    check('beide ab Werk an', overlayAn({}, 'zahlen') === true && overlayAn({}, 'sitzungen') === true)
    check('abschaltbar je Panel', overlayAn({ overlays: { sitzungen: false } }, 'sitzungen') === false)
    check('jede Aktien-Ebene ist gekennzeichnet', OVERLAYS.filter((o) => o.nurAktien).map((o) => o.id).join() === 'zahlen,sitzungen')
}

console.log('Chart und Schalter «nur reguläre Sitzung» (FUN-H-005, RAS-05)')
{
    // Drei Wochen samt Zeitumstellung (1.11.2026) und Thanksgiving, jede Zeiteinheit bis 4h
    // Chart und Schalter haben dieselbe Regel: eine Kerze ist frei, wenn sie mindestens zur Hälfte
    // in der regulären Sitzung liegt (RAS-05, Chart nachgezogen am 16.11.2026).
    let abweichung = ''
    let geprueft = 0
    for (const iv of [5 * MIN, 15 * MIN, 30 * MIN, H, 2 * H, 4 * H]) {
        for (let t = Date.UTC(2026, 9, 26); t < Date.UTC(2026, 10, 30); t += iv) {
            geprueft++
            if ((artDerKerze(t, iv) === null) !== einstiegRegulaer(t, iv, 'kerze').regulaer) { abweichung = `${new Date(t).toISOString()} ${iv / MIN}m`; break }
        }
    }
    check(`frei im Chart = vom Schalter zugelassen, auf jeder Zeiteinheit bis 4h (${geprueft} Kerzen)`, !abweichung, abweichung)
    // 4h im Winter (UTC−5): 07–11 und 15–19 New York berühren die Sitzung nur, 11–15 liegt ganz darin
    check('4h Winter: 15–19 Uhr New York ist hinterlegt, obwohl die Kerze die Sitzung berührt; 11–15 ist frei',
        artDerKerze(Date.UTC(2026, 10, 11, 20), 4 * H) === 'rand' && kerzeBeruehrtRegulaer(Date.UTC(2026, 10, 11, 20), 4 * H)
        && artDerKerze(Date.UTC(2026, 10, 11, 16), 4 * H) === null && artDerKerze(Date.UTC(2026, 10, 11, 12), 4 * H) !== null)
    check('1h ab 09:00 New York (halb vorbörslich, halb regulär) bleibt frei', artDerKerze(Date.UTC(2026, 10, 11, 14), H) === null)
    check('ab 1d: der Chart hinterlegt nichts, der Schalter ist nicht anwendbar',
        sitzungsAbschnitte([Date.UTC(2026, 7, 12)], 24 * H).length === 0 && einstiegRegulaer(Date.UTC(2026, 7, 12), 24 * H).anwendbar === false)
}

console.log('Zahlen-Schilder: Flächen und Treffer')
{
    const G = { width: 800, height: 400 }
    const messe = (text) => text.length * 6
    const marke = (zeit, xLinie, o = {}) => ({ zeit, kommend: false, geschaetzt: false, tage: null, xLinie, ...o })
    const text = (m) => (m.kommend ? 'Zahlen in 3 Tagen' : 'Zahlen')
    const a = marke(1, 100), b = marke(2, 400), k = marke(3, 1200, { kommend: true, geschaetzt: true, tage: 3 })
    const fl = schildFlaechen([a, b, k], G, text, messe)
    check('drei Schilder; der kommende Termin rechts ausserhalb steht am Rand mit Pfeil',
        fl.length === 3 && fl[0].m === k && fl[0].text.endsWith('→') && fl[0].x + fl[0].b === G.width - 4, JSON.stringify(fl.map((f) => [f.text, f.x, f.b])))
    const fa = fl.find((f) => f.m === a)
    check('Schild steht rechts der Linie, 16 hoch, 12 über dem Rand', fa.x === 104 && fa.y === 388 && fa.b === 46)
    check('Treffer mitten im Schild', schildTreffer(fl, [a, b], 120, 388, 400) === a)
    check('knapp daneben mit Zugabe: Treffer, ohne Zugabe: keiner',
        schildTreffer(fl, [a, b], fa.x + fa.b + 9, 388, 400, 10) === a && schildTreffer(fl, [a, b], fa.x + fa.b + 9, 388, 400, 3) === null)
    check('über dem Schild (mitten im Chart): kein Treffer', schildTreffer(fl, [a, b], 120, 200, 400) === null)
    check('Fuss der Linie zählt, links vom Schild', schildTreffer(fl, [a, b], 98, 400 - LINIEN_FUSS + 2, 400) === a)
    check('dieselbe Linie weiter oben: kein Treffer', schildTreffer(fl, [a, b], 100, 400 - LINIEN_FUSS - 5, 400) === null)
    check('unter zwei nahen Linien gewinnt die nähere', schildTreffer([], [marke(7, 300), marke(8, 304)], 303, 395, 400) .zeit === 8)
    check('kein Zahlenwert: kein Treffer', schildTreffer(fl, [a, b], NaN, 388, 400) === null && schildTreffer(null, null, 1, 1, 400) === null)
    // Eng: zwei vergangene Termine dicht beieinander — der jüngere behält das Schild, die Linie des älteren bleibt anklickbar
    const c = marke(5, 300), d = marke(6, 320)
    const eng = schildFlaechen([c, d], G, text, messe)
    check('eng: nur der jüngere Termin hat ein Schild', eng.length === 1 && eng[0].m === d)
    check('eng: die Linie des älteren trifft trotzdem', schildTreffer(eng, [c, d], 299, 395, 400) === c)
    check('vergangener Termin rechts ausserhalb: kein Schild', schildFlaechen([marke(9, 900)], G, text, messe).length === 0)
    check('Schild am rechten Rand weicht nach links aus', (() => { const f = schildFlaechen([marke(9, 780)], G, text, messe)[0]; return f.x + f.b === 776 })())

    // Die Ebene selbst, mit Attrappen für Chart und Leinwand: nach dem Zeichnen trifft der Klick
    const H1 = 3_600_000, T0 = Date.UTC(2026, 7, 24)
    const kerzen = Array.from({ length: 100 }, (_, i) => ({ t: T0 + i * H1 }))
    const zeitachse = { logicalToCoordinate: (L) => L * 8, getVisibleLogicalRange: () => ({ from: 0, to: 99 }) }
    const serie = { attachPrimitive() {}, detachPrimitive() {} }
    const ebene = new AktienEbene({ chart: { timeScale: () => zeitachse }, serie, farben: { zahlen: '#fff', grund: '#000' },
        texte: { zahlen: 'Zahlen', heute: 'heute', morgen: 'morgen', inTagen: (n) => `in ${n}`, voraussichtlich: 'vsl.' } })
    const ctx = new Proxy({ measureText: (t) => ({ width: t.length * 6 }) }, { get: (o, n) => (n in o ? o[n] : () => {}), set: () => true })
    ebene.setzeKerzen(kerzen, H1)
    const termin = T0 + 50 * H1 + 20 * 60_000
    check('vor dem Zeichnen und ohne Termine: kein Treffer', ebene.trefferTest(400, 388) === null && ebene.hitTest(400, 388) === null)
    ebene.setzeTermine({ naechster: null, vergangene: [termin] })
    ebene.oben(ctx, G)
    const f0 = ebene.flaechen[0]
    check('gezeichnet: ein Schild an der Linie des Termins', ebene.flaechen.length === 1 && f0.m.zeit === termin && Math.abs(f0.x - 4 - ebene.linien[0].xLinie) < 1)
    const tr = ebene.trefferTest(f0.x + 5, f0.y)
    check('Treffer liefert die Marke (Zeit, kommend, geschätzt, Tage)', tr && tr.zeit === termin && tr.kommend === false && tr.geschaetzt === false && tr.tage === null)
    check('Mauszeiger über dem Schild: Zeiger', ebene.hitTest(f0.x + 5, f0.y)?.cursorStyle === 'pointer' && ebene.hitTest(f0.x + 5, 100) === null)
    ebene.setzeTermine(null)
    check('Zahlen ausgeschaltet: kein Treffer mehr, auch vor dem nächsten Bild', ebene.trefferTest(f0.x + 5, f0.y) === null)
}

console.log('Zahlen-Karte: Angaben und Kursreaktion')
{
    const H1 = 3_600_000, TAG = 24 * H1
    // Mittwoch 26.8.2026, Meldung 16:20 New Yorker Zeit (20:20 UTC, Sommerzeit)
    const termin = Date.UTC(2026, 7, 26, 20, 20)
    check('16:20 New York: nachbörslich', boersenLage(termin) === 'nach')
    check('08:00 New York: vorbörslich; 12:00: regulär', boersenLage(Date.UTC(2026, 7, 26, 12)) === 'vor' && boersenLage(Date.UTC(2026, 7, 26, 16)) === 'regulaer')
    check('Mitternacht oder Samstag: keine Aussage', boersenLage(Date.UTC(2026, 7, 26, 4)) === null && boersenLage(Date.UTC(2026, 7, 29, 15)) === null && boersenLage(NaN) === null)

    const von = Date.UTC(2026, 7, 24), jetzt = Date.UTC(2026, 8, 5)
    const stunden = Array.from({ length: 24 * 7 }, (_, i) => ({ t: von + i * H1, c: 100 }))
    // Schluss vor dem Termin: Kerze 19:00–20:00 → 100; Kerze, in der das Fenster endet (Do 20:00–21:00) → 110
    const iVor = stunden.findIndex((k) => k.t === Date.UTC(2026, 7, 26, 19))
    const iNach = stunden.findIndex((k) => k.t === Date.UTC(2026, 7, 27, 20))
    stunden[iVor].c = 100; stunden[iVor + 1].c = 140; stunden[iNach].c = 110; stunden[iNach + 1].c = 55
    const r = kursReaktion(stunden, termin, H1, jetzt)
    check('1h: Schluss vor der Meldung → Schluss am Fensterende = +10 %', r && r.vorher === 100 && r.nachher === 110 && Math.abs(r.pct - 10) < 1e-9, JSON.stringify(r))
    check('…mit den Schlusszeiten beider Kerzen', r.von === Date.UTC(2026, 7, 26, 20) && r.bis === Date.UTC(2026, 7, 27, 21))
    check('die Kerze, in der die Meldung fällt, ist nicht «vorher»', r.vorher !== 140)
    check('Fenster noch nicht zu Ende: nichts', kursReaktion(stunden, termin, H1, termin + 3 * H1) === null)
    check('Kerzen beginnen erst nach dem Termin: nichts', kursReaktion(stunden.slice(iVor + 2), termin, H1, jetzt) === null)
    check('Kerzen enden vor dem Fensterende: nichts', kursReaktion(stunden.slice(0, iNach - 3), termin, H1, jetzt) === null)
    check('letzte Kerze enthält das Fensterende: zählt', kursReaktion(stunden.slice(0, iNach + 1), termin, H1, jetzt)?.nachher === 110)
    const mitLuecke = stunden.filter((k) => k.t < termin - 6 * TAG || k.t > termin)
    check('Lücke vor dem Termin (älter als vier Tage): nichts', kursReaktion([{ t: termin - 9 * TAG, c: 90 }, ...mitLuecke], termin, H1, jetzt) === null)
    check('Wochenkerzen: nichts', kursReaktion(stunden, termin, 7 * TAG, jetzt) === null)
    check('leer oder ohne Zeit: nichts', kursReaktion([], termin, H1, jetzt) === null && kursReaktion(stunden, NaN, H1, jetzt) === null && kursReaktion(null, termin, H1, jetzt) === null)
    const tage = Array.from({ length: 10 }, (_, i) => ({ t: Date.UTC(2026, 7, 20 + i), c: 100 + i }))
    const rt = kursReaktion(tage, termin, TAG, jetzt)
    check('1d: Schluss des Vortags → Schluss des Tags, in dem das Fenster endet', rt && rt.von === Date.UTC(2026, 7, 26) && rt.bis === Date.UTC(2026, 7, 28) && rt.vorher === 105 && rt.nachher === 107, JSON.stringify(rt))

    const termine = {
        naechster: { zeit: termin + 90 * TAG, geschaetzt: true, epsSchaetzung: 2.47, umsatzSchaetzung: 108_731_903_900 },
        vergangene: [termin - 98 * TAG, termin],
        einzelheiten: [{ zeit: termin, quartal: '2Q2026', eps: 2.22, schaetzung: 2.09, ueberraschungPct: 6.16 }],
    }
    const verg = zahlenKarteDaten({ zeit: termin, kommend: false, geschaetzt: false, tage: null }, termine, { kerzen: stunden, iv: H1, jetzt })
    check('vergangener Termin: Quartal, Gewinn je Aktie, Schätzung, Überraschung, Lage, Reaktion',
        verg.hatEinzelheiten && verg.quartal === '2Q2026' && verg.eps === 2.22 && verg.schaetzung === 2.09 && verg.ueberraschungPct === 6.16 && verg.lage === 'nach' && Math.abs(verg.reaktion.pct - 10) < 1e-9)
    const alt = zahlenKarteDaten({ zeit: termin - 98 * TAG, kommend: false, geschaetzt: false, tage: null }, termine, { kerzen: stunden, iv: H1, jetzt })
    check('Termin ohne Einzelheit: sagt es (hatEinzelheiten false), nichts erfunden', alt.hatEinzelheiten === false && alt.eps === null && alt.quartal === null && alt.reaktion === null)
    const komm = zahlenKarteDaten({ zeit: termin + 90 * TAG, kommend: true, geschaetzt: true, tage: 80 }, termine, { kerzen: stunden, iv: H1, jetzt })
    check('kommender Termin: geschätzt, EPS- und Umsatzschätzung, keine Reaktion',
        komm.kommend && komm.geschaetzt && komm.tage === 80 && komm.schaetzung === 2.47 && komm.umsatzSchaetzung === 108_731_903_900 && komm.reaktion === null && komm.eps === null && komm.hatEinzelheiten)
    // Stand eines älteren Servers: nur Zeitpunkte
    const altStand = { naechster: { zeit: termin + 90 * TAG, geschaetzt: false }, vergangene: [termin] }
    const k2 = zahlenKarteDaten({ zeit: termin + 90 * TAG, kommend: true, geschaetzt: false, tage: 80 }, altStand)
    const v2 = zahlenKarteDaten({ zeit: termin, kommend: false, geschaetzt: false, tage: null }, altStand)
    check('alter gemerkter Stand ohne Einzelheiten: bricht nichts, Karte sagt «keine Zahlen»', k2.hatEinzelheiten === false && k2.schaetzung === null && v2.hatEinzelheiten === false && v2.reaktion === null)
    check('Termine ganz unbekannt: bricht nichts', zahlenKarteDaten({ zeit: termin, kommend: false }, null).hatEinzelheiten === false)
    check('Umsatz kurz: Mrd., Mio., klein, unbekannt',
        grosseZahl(108_731_903_900).einheit === 'mrd' && Math.abs(grosseZahl(108_731_903_900).wert - 108.7319039) < 1e-6 && grosseZahl(950e6).einheit === 'mio' && grosseZahl(500).einheit === '' && grosseZahl(null) === null)
}

console.log('Absprung «Im Research öffnen»')
{
    const aktien = { modusAktienAn: 1, aktiverMarkt: 'aktien', modusResearchAn: 1 }
    const krypto = { modusAktienAn: 1, aktiverMarkt: 'krypto', modusResearchAn: 1 }
    const z = researchZiel({ symbol: 'ACNSTOCKUSDT', aktie: { ticker: 'ACN' } }, aktien)
    check('Aktien-Future: Titel-Seite mit dem Ticker aus dem Kontext, nicht aus dem Symbol', z?.art === 'aktie' && z.path === '/aktien' && z.query.titel === 'ACN')
    check('Adresse für den Router ohne das Feld «art»', JSON.stringify(researchAdresse(z)) === '{"path":"/aktien","query":{"titel":"ACN"}}' && researchAdresse(null) === null)
    const c = researchZiel({ symbol: 'btcusdt', aktie: null }, krypto)
    check('Coin: Einzelprüfung im Coin-Radar', c?.art === 'coin' && c.path === '/coin-radar' && c.query.symbol === 'BTCUSDT')
    check('Coin ohne Aktien-Teil (Vorgabe) und mit noch nicht geladenen Einstellungen: Ziel da',
        researchZiel({ symbol: 'ETHUSDT' }, { modusResearchAn: 1 })?.art === 'coin' && researchZiel({ symbol: 'ETHUSDT' }, null)?.art === 'coin')
    check('Research ausgeschaltet: kein Ziel', researchZiel({ symbol: 'BTCUSDT' }, { ...krypto, modusResearchAn: 0 }) === null
        && researchZiel({ symbol: 'NVDAUSDT', aktie: { ticker: 'NVDA' } }, { ...aktien, modusResearchAn: 0 }) === null)
    check('Coin im Aktien-Markt (kein Coin-Radar dort): kein Ziel', researchZiel({ symbol: 'BTCUSDT', aktie: null }, aktien) === null)
    check('Aktie ohne brauchbaren Ticker oder Aktien-Teil aus: kein Ziel',
        researchZiel({ symbol: 'NVDAUSDT', aktie: { ticker: '' } }, aktien) === null && researchZiel({ symbol: 'NVDAUSDT', aktie: { ticker: 'NVDA' } }, { modusResearchAn: 1, modusAktienAn: 0 }) === null)
    check('kein Symbol oder Sonderzeichen: kein Ziel', researchZiel({ symbol: '' }, krypto) === null && researchZiel({ symbol: 'BTC/USDT?x=1' }, krypto) === null && researchZiel(undefined, krypto) === null)
}


console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
