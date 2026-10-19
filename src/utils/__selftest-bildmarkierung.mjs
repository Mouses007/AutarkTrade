/**
 * Selbsttest der Bildmarkierung — ohne Browser.
 *
 *   node src/utils/__selftest-bildmarkierung.mjs
 *
 * Die heiklen Stellen: alte markerjs2-Zustände (Pixel der damaligen
 * ANZEIGEfläche) müssen auf relative Koordinaten umgerechnet werden — eine
 * falsche Achse oder ein vergessener Faktor verschiebt jede alte Markierung,
 * und das sieht erst der, der das Bild neu speichert und damit einbrennt.
 * Dazu: leere Werte (`{}` liess markerjs2 werfen), unbekannte Typen dürfen
 * nicht verschwinden, Rückgängig, Rundreise des eigenen Formats.
 */
import {
    leseZustand, herkunft, migriereMarkerjs, zumSpeichern, formen, grenzen, trifft, obersterTreffer,
    verschoben, umgestylt, zuKlein, Verlauf, zeichneZustand, schriftPixel, pfeilspitze, hatMarker,
    istBearbeitbar, FORMAT_VERSION, mimeVon, bildUrlsIn,
} from './bildmarkierung.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// Anzeigefläche 800×400 (markerjs2 speicherte DIESE Pixel, nicht die des Bildes).
const W = 800, H = 400
const rechteckFelder = { left: 80, top: 40, width: 160, height: 80, rotationAngle: 0, visualTransformMatrix: { a: 1, b: 0, c: 0, d: 1, e: 80, f: 40 }, containerTransformMatrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, state: 'select' }
const linienFelder = { x1: 400, y1: 200, x2: 800, y2: 0, state: 'select' }
const ALLE_13 = [
    { typeName: 'FrameMarker', ...rechteckFelder, fillColor: 'transparent', strokeColor: 'white', strokeWidth: 2, strokeDasharray: '', opacity: 1 },
    { typeName: 'FreehandMarker', ...rechteckFelder, drawingImgUrl: 'data:image/png;base64,AAAA' },
    { typeName: 'ArrowMarker', ...linienFelder, strokeColor: '#ef4444', strokeWidth: 3, strokeDasharray: '3', arrowType: 'both' },
    { typeName: 'TextMarker', ...rechteckFelder, color: 'white', fontFamily: 'Helvetica, Arial, sans-serif', padding: 5, text: 'Einstieg\nzu früh' },
    { typeName: 'EllipseFrameMarker', ...rechteckFelder, fillColor: 'transparent', strokeColor: 'white', strokeWidth: 2, strokeDasharray: '', opacity: 1 },
    { typeName: 'EllipseMarker', ...rechteckFelder, fillColor: '#22c55e', strokeColor: 'transparent', strokeWidth: 0, strokeDasharray: '', opacity: 0.75 },
    { typeName: 'HighlightMarker', ...rechteckFelder, fillColor: '#ffff00', strokeColor: 'transparent', strokeWidth: 0, strokeDasharray: '', opacity: 0.5 },
    { typeName: 'CalloutMarker', ...rechteckFelder, color: 'black', bgColor: '#ffffffde', fontFamily: 'Helvetica', padding: 5, text: 'Hier', tipPosition: { x: -40, y: 120 } },
    { typeName: 'MeasurementMarker', ...linienFelder, strokeColor: 'white', strokeWidth: 2, strokeDasharray: '' },
    { typeName: 'CoverMarker', ...rechteckFelder, fillColor: '#000000', strokeColor: 'transparent', strokeWidth: 0, strokeDasharray: '', opacity: 1 },
    { typeName: 'LineMarker', ...linienFelder, strokeColor: 'white', strokeWidth: 2, strokeDasharray: '12 3' },
    { typeName: 'CurveMarker', ...linienFelder, strokeColor: 'white', strokeWidth: 2, strokeDasharray: '', curveX: 600, curveY: 300 },
    { typeName: 'CaptionFrameMarker', ...rechteckFelder, fillColor: 'transparent', strokeColor: 'white', strokeWidth: 2, strokeDasharray: '', opacity: 1, textColor: 'black', fontFamily: 'Helvetica', fontSize: '1rem', captionText: 'Setup' },
]
const ERWARTET = {
    FrameMarker: 'rechteck', FreehandMarker: 'bild', ArrowMarker: 'pfeil', TextMarker: 'text', EllipseFrameMarker: 'ellipse',
    EllipseMarker: 'ellipse', HighlightMarker: 'hervorhebung', CalloutMarker: 'sprechblase', MeasurementMarker: 'linie',
    CoverMarker: 'abdeckung', LineMarker: 'linie', CurveMarker: 'kurve', CaptionFrameMarker: 'beschriftung',
}

console.log('Leere und kaputte Werte')
for (const [name, wert] of [['fehlend', undefined], ['null', null], ['{}', {}], ['leerer Text', ''], ['kein JSON', 'quatsch{'], ['Liste', []], ['Text {}', '{}']]) {
    const z = leseZustand(wert)
    check(`${name} → leerer eigener Zustand (behebt A-S9)`, z.v === FORMAT_VERSION && z.marker.length === 0 && z.fremd.length === 0)
}
check('hatMarker({}) ist falsch', hatMarker({}) === false)
check('Herkunft {} = leer', herkunft({}) === 'leer')

console.log('Migration: jeder der 13 markerjs2-Typen')
const alt = { width: W, height: H, markers: ALLE_13 }
check('Herkunft = markerjs', herkunft(alt) === 'markerjs')
const mig = leseZustand(alt)
check('alle 13 werden zu Markern, keiner landet in fremd', mig.marker.length === 13 && mig.fremd.length === 0, `${mig.marker.length}/${mig.fremd.length}`)
ALLE_13.forEach((o, i) => {
    const m = mig.marker[i]
    check(`${o.typeName} → ${ERWARTET[o.typeName]}`, m?.typ === ERWARTET[o.typeName], m?.typ)
    check(`${o.typeName} erzeugt sichtbare Formen`, formen(m, 1000, 500).length > 0)
})
check('Reihenfolge bleibt (später = oben)', mig.marker.map(m => m.typ).join() === ALLE_13.map(o => ERWARTET[o.typeName]).join())

const [rahmen, freihand, pfeil, text, ellRahmen, ell, hervor, blase, mess, deck, linie, kurve, beschr] = mig.marker
check('Rechteck: left/top/width/height relativ zur Fläche', nahe(rahmen.x, 0.1) && nahe(rahmen.y, 0.1) && nahe(rahmen.b, 0.2) && nahe(rahmen.h, 0.2))
check('Rechteck: transparente Füllung → keine Füllung', rahmen.fuellung === undefined)
check('Rechteck: Strichbreite relativ zur Breite (2/800)', nahe(rahmen.breite, 2 / 800))
check('Rechteck bleibt bearbeitbar', istBearbeitbar(rahmen))
check('Freihand → Bild-Marker mit der PNG-Zeichnung', freihand.url === 'data:image/png;base64,AAAA' && nahe(freihand.b, 0.2))
check('Pfeil: Endpunkte relativ (x zur Breite, y zur Höhe)', nahe(pfeil.x1, 0.5) && nahe(pfeil.y1, 0.5) && nahe(pfeil.x2, 1) && nahe(pfeil.y2, 0))
check('Pfeil: arrowType both → beide Spitzen', pfeil.spitze === 'beide' && formen(pfeil, 800, 400).filter(f => f.art === 'polygon').length === 2)
check('Pfeil: Strichmuster relativ', Array.isArray(pfeil.muster) && nahe(pfeil.muster[0], 3 / 800))
check('Pfeil: Vorgabe ohne arrowType ist Spitze am Ende', leseZustand({ width: W, height: H, markers: [{ typeName: 'ArrowMarker', ...linienFelder }] }).marker[0].spitze === 'ende')
check('Text: Zeilen bleiben', text.text === 'Einstieg\nzu früh')
// Box 80 px hoch, 5 px Rand je Seite, 2 Zeilen à 1,2 → 70/2,4 = 29,2 px; Breite 150/(8·0,6) = 31,25 → Höhe gewinnt.
check('Text: Schriftgrösse aus Boxhöhe ÷ Zeilen (relativ zur Höhe)', nahe(text.groesse * H, 70 / 2.4, 1e-6), String(text.groesse * H))
check('Text: Lage innerhalb des Rands', nahe(text.x, 85 / 800) && nahe(text.y, 45 / 400))
check('Text bleibt bearbeitbar', istBearbeitbar(text))
check('Ellipsenrahmen: ohne Füllung, mit Strich', formen(ellRahmen, 800, 400)[0].fuellung === undefined && !!formen(ellRahmen, 800, 400)[0].strich)
check('Ellipse: gefüllt, Deckkraft 0,75, ohne Strich', ell.fuellung === '#22c55e' && ell.deckkraft === 0.75 && !formen(ell, 800, 400)[0].strich)
check('Hervorhebung: Deckkraft 0,5', hervor.deckkraft === 0.5 && hervor.fuellung === '#ffff00')
check('Sprechblase: Spitze relativ zu left/top umgerechnet', nahe(blase.spitze.x, 40 / 800) && nahe(blase.spitze.y, 160 / 400))
check('Sprechblase: Hintergrund und Text', blase.hintergrund === '#ffffffde' && blase.text === 'Hier' && formen(blase, 800, 400).some(f => f.art === 'text'))
check('Messung → Linie, Herkunft vermerkt', mess.typ === 'linie' && mess.quelle === 'MeasurementMarker')
check('Abdeckung: deckend', deck.deckkraft === 1 && deck.fuellung === '#000000')
check('Linie: Muster „12 3“ → zwei Werte', linie.muster?.length === 2 && nahe(linie.muster[0], 12 / 800))
check('Kurve: Kontrollpunkt relativ', nahe(kurve.kx, 0.75) && nahe(kurve.ky, 0.75))
check('Bildunterschrift: 1rem = 16 px relativ zur Höhe', nahe(beschr.groesse, 16 / 400) && beschr.text === 'Setup')
check('Altmarker sind nicht umfärbbar', !istBearbeitbar(ell) && umgestylt(ell, { farbe: '#000' }) === ell)
check('Gedrehtes Rechteck: Drehung übernommen', leseZustand({ width: W, height: H, markers: [{ typeName: 'FrameMarker', ...rechteckFelder, rotationAngle: 30 }] }).marker[0].drehung === 30)
check('Gedrehtes Rechteck: Form trägt Drehpunkt in der Mitte', (() => {
    const m = leseZustand({ width: W, height: H, markers: [{ typeName: 'FrameMarker', ...rechteckFelder, rotationAngle: 30 }] }).marker[0]
    const d = formen(m, 800, 400)[0].drehung
    return d && d.winkel === 30 && nahe(d.cx, 160) && nahe(d.cy, 80)
})())
check('Schriftgrössen: px, pt, em, Unsinn', schriftPixel('14px') === 14 && nahe(schriftPixel('12pt'), 16) && schriftPixel('2em') === 32 && schriftPixel('x') === 16)

console.log('Skalierung')
// Dieselbe Markierung, in zwei verschiedenen Fenstergrössen gespeichert, muss gleich liegen.
const klein = leseZustand({ width: 400, height: 200, markers: [{ typeName: 'LineMarker', x1: 40, y1: 20, x2: 200, y2: 100, strokeWidth: 1, strokeColor: 'red' }] }).marker[0]
const gross = leseZustand({ width: 1600, height: 800, markers: [{ typeName: 'LineMarker', x1: 160, y1: 80, x2: 800, y2: 400, strokeWidth: 4, strokeColor: 'red' }] }).marker[0]
check('Anzeigegrösse beim Speichern spielt keine Rolle', nahe(klein.x1, gross.x1) && nahe(klein.y2, gross.y2) && nahe(klein.breite, gross.breite))
const aufBild = formen(klein, 3000, 1500)[0]
check('Auf das natürliche Bild 3000×1500 skaliert (Faktor 7,5)', nahe(aufBild.x1, 300) && nahe(aufBild.y1, 150) && nahe(aufBild.x2, 1500) && nahe(aufBild.breite, 7.5))
check('Seitenverhältnis der Fläche ≠ Bild: x und y getrennt skaliert', nahe(formen(klein, 1000, 1000)[0].y2, 500))
check('Ohne width/height: nichts raten, alles in fremd', (() => { const z = migriereMarkerjs({ markers: ALLE_13.slice(0, 2) }); return z.marker.length === 0 && z.fremd.length === 2 })())

console.log('Unbekannte Typen')
const mitFremd = leseZustand({ width: W, height: H, markers: [{ typeName: 'ZukunftMarker', foo: 1 }, { typeName: 'LineMarker', ...linienFelder }] })
check('unbekannter Typ wird nicht angezeigt, aber behalten', mitFremd.marker.length === 1 && mitFremd.fremd.length === 1 && mitFremd.fremd[0].typeName === 'ZukunftMarker' && mitFremd.fremd[0].foo === 1)
check('fremd merkt sich die alte Fläche', mitFremd.fremd[0]._raum.width === W)
const gespeichert = JSON.parse(JSON.stringify(zumSpeichern(mitFremd)))
check('nach dem Speichern ist der Fremdtyp noch da', leseZustand(gespeichert).fremd[0]?.typeName === 'ZukunftMarker')
const eigenFremd = leseZustand({ v: 2, marker: [{ typ: 'hologramm', x: 0.1 }], fremd: [] })
check('eigenes Format: unbekannter Typ bleibt in der Liste', eigenFremd.marker.length === 1 && formen(eigenFremd.marker[0], 100, 100).length === 0)

console.log('Rundreise eigenes Format')
const eigen = zumSpeichern(mig)
const text1 = JSON.stringify(eigen)
const zurueck = leseZustand(text1)
check('als Text gespeichert und gelesen: Herkunft eigen', herkunft(text1) === 'eigen')
check('Rundreise verlustfrei', JSON.stringify(zumSpeichern(zurueck)) === text1)
check('IDs bleiben über die Rundreise stabil', zurueck.marker.every((m, i) => m.id === eigen.marker[i].id))
check('Version steht im Zustand', eigen.v === 2)
check('Bild-URLs werden für das Einbrennen gesammelt', bildUrlsIn(eigen).length === 1)

console.log('Werkzeuge: Treffer, Verschieben, Stil')
const r = { id: 'a', typ: 'rechteck', x: 0.1, y: 0.1, b: 0.5, h: 0.5, farbe: '#fff', breite: 0.002 }
check('leerer Rahmen: Kante trifft', trifft(r, 100, 300, 1000, 1000))
check('leerer Rahmen: Mitte trifft nicht', !trifft(r, 350, 350, 1000, 1000))
check('gefüllter Rahmen: Mitte trifft', trifft({ ...r, fuellung: '#000' }, 350, 350, 1000, 1000))
const l = { id: 'b', typ: 'linie', x1: 0, y1: 0, x2: 1, y2: 1, farbe: '#fff', breite: 0.002 }
check('Linie: Punkt auf der Diagonale trifft', trifft(l, 500, 503, 1000, 1000))
check('Linie: Punkt daneben nicht', !trifft(l, 500, 560, 1000, 1000))
const f = { id: 'c', typ: 'freihand', punkte: [[0.1, 0.9], [0.2, 0.9], [0.3, 0.8]], farbe: '#fff', breite: 0.002 }
check('Freihand: Punkt auf der Strecke trifft', trifft(f, 150, 900, 1000, 1000))
check('oberster Treffer = zuletzt gezeichnet', obersterTreffer({ marker: [{ ...r, id: 'u', fuellung: '#000' }, { ...r, id: 'o', fuellung: '#000' }] }, 350, 350, 1000, 1000).id === 'o')
const v = verschoben(f, 0.1, -0.1)
check('Verschieben bewegt alle Punkte, Original bleibt', nahe(v.punkte[0][0], 0.2) && nahe(v.punkte[0][1], 0.8) && f.punkte[0][0] === 0.1)
check('Verschieben einer Sprechblase nimmt die Spitze mit', nahe(verschoben(blase, 0.1, 0).spitze.x, blase.spitze.x + 0.1))
check('Umfärben eines Werkzeugmarkers', umgestylt(r, { farbe: '#ef4444', breite: 0.01 }).farbe === '#ef4444')
check('Klick ohne Ziehen ist zu klein', zuKlein({ typ: 'rechteck', x: 0.5, y: 0.5, b: 0, h: 0 }, 1000, 1000))
check('Text ohne Inhalt ist zu klein', zuKlein({ typ: 'text', x: 0, y: 0, text: '  ' }, 100, 100))
check('Hülle eines Pfeils', (() => { const g = grenzen(l, 200, 100); return g.x === 0 && g.y === 0 && g.b === 200 && g.h === 100 })())
check('Pfeilspitze sitzt am Endpunkt', (() => { const p = pfeilspitze(0, 0, 100, 0, 2, 1000); return p[0][0] === 100 && p[1][0] < 100 && p[1][1] !== p[2][1] })())

console.log('Rückgängig')
const verlauf = new Verlauf({ v: 2, marker: [], fremd: [] })
check('am Anfang nichts rückgängig, nicht geändert', !verlauf.kannZurueck && !verlauf.geaendert)
verlauf.setze({ v: 2, marker: [r], fremd: [] })
verlauf.setze({ v: 2, marker: [r, l], fremd: [] })
verlauf.setze({ v: 2, marker: [r, l, f], fremd: [] })
check('drei Schritte, geändert', verlauf.jetzt.marker.length === 3 && verlauf.geaendert)
check('mehrstufig zurück', verlauf.zurueck().marker.length === 2 && verlauf.zurueck().marker.length === 1)
check('wiederholen', verlauf.kannVor && verlauf.vor().marker.length === 2)
verlauf.setze({ v: 2, marker: [l], fremd: [] })
check('neuer Schritt verwirft den Wiederholen-Zweig', !verlauf.kannVor)
check('zurück bis zum Anfang: nicht mehr geändert', (() => { while (verlauf.kannZurueck) verlauf.zurueck(); return !verlauf.geaendert && verlauf.jetzt.marker.length === 0 })())
const kopie = verlauf.jetzt
kopie.marker.push(r)
check('jetzt liefert eine Kopie (Ändern verfälscht den Stapel nicht)', verlauf.jetzt.marker.length === 0)
const kurz = new Verlauf({ v: 2, marker: [], fremd: [] }, 3)
for (let i = 0; i < 6; i++) kurz.setze({ v: 2, marker: Array(i + 1).fill(r), fremd: [] })
check('Begrenzung behält den Anfang', kurz.stapel.length === 3 && kurz.stapel[0].marker.length === 0 && kurz.jetzt.marker.length === 6)

console.log('Einbrennen in ein Canvas (Attrappe)')
const aufrufe = []
const ctx = new Proxy({}, {
    get: (_, name) => (typeof name === 'string' && !['lineWidth', 'strokeStyle', 'fillStyle', 'globalAlpha', 'font', 'textBaseline', 'lineCap', 'lineJoin'].includes(name)
        ? (...a) => aufrufe.push([name, ...a]) : undefined),
    set: (_, name, wert) => { aufrufe.push(['=' + String(name), wert]); return true },
})
zeichneZustand(ctx, eigen, 1600, 800, { 'data:image/png;base64,AAAA': { attrappe: true } })
check('Rahmen landet skaliert (×2) im Canvas', aufrufe.some(a => a[0] === 'rect' && a[1] === 160 && a[2] === 80 && a[3] === 320 && a[4] === 160))
check('Text wird zeilenweise geschrieben', aufrufe.filter(a => a[0] === 'fillText' && (a[1] === 'Einstieg' || a[1] === 'zu früh')).length === 2)
check('Freihand-Bild wird gezeichnet', aufrufe.some(a => a[0] === 'drawImage' && a[1]?.attrappe))
check('Kurve als quadratische Kurve', aufrufe.some(a => a[0] === 'quadraticCurveTo' && a[1] === 1200 && a[2] === 600))
check('Ellipse gezeichnet', aufrufe.some(a => a[0] === 'ellipse'))
check('save/restore ausgeglichen', aufrufe.filter(a => a[0] === 'save').length === aufrufe.filter(a => a[0] === 'restore').length)
check('MIME aus Daten-URL', mimeVon('data:image/jpeg;base64,xx') === 'image/jpeg' && mimeVon('') === 'image/png')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
