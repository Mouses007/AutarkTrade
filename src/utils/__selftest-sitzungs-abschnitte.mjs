/**
 * Selbsttest der Sitzungs-Abschnitte und Zahlen-Marken im Aktien-Chart
 * (`utils/chart/sitzungsAbschnitte.js`).
 *
 *   node src/utils/__selftest-sitzungs-abschnitte.mjs
 */
import { artDerKerze, sitzungsAbschnitte, zahlenMarken, SITZUNG_BIS_MS } from './chart/sitzungsAbschnitte.js'
import { OVERLAYS, overlaysFuer, overlayAn } from './chart/overlays/liste.js'
import { einstiegRegulaer, kerzeBeruehrtRegulaer } from '../../shared/aktien-sitzung.js'

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

console.log('Chart und Schalter «nur reguläre Sitzung»: eine Regel (FUN-H-005)')
{
    // Drei Wochen samt Zeitumstellung (1.11.2026) und Thanksgiving, jede Zeiteinheit bis 4h
    let abweichung = ''
    let geprueft = 0
    for (const iv of [5 * MIN, 15 * MIN, 30 * MIN, H, 2 * H, 4 * H]) {
        for (let t = Date.UTC(2026, 9, 26); t < Date.UTC(2026, 10, 30); t += iv) {
            const frei = artDerKerze(t, iv) === null
            geprueft++
            if (frei !== einstiegRegulaer(t, iv, 'kerze').regulaer || frei !== kerzeBeruehrtRegulaer(t, iv)) { abweichung = `${new Date(t).toISOString()} ${iv / MIN}m`; break }
        }
    }
    check(`was der Chart nicht hinterlegt, lässt der Schalter zu – und nur das (${geprueft} Kerzen)`, !abweichung, abweichung)
    check('ab 1d: der Chart hinterlegt nichts, der Schalter ist nicht anwendbar',
        sitzungsAbschnitte([Date.UTC(2026, 7, 12)], 24 * H).length === 0 && einstiegRegulaer(Date.UTC(2026, 7, 12), 24 * H).anwendbar === false)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
