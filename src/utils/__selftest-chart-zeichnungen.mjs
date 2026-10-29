/**
 * Selbsttest der Zeichen-Geometrie — ohne Browser.
 *
 *   node src/utils/__selftest-chart-zeichnungen.mjs
 *
 * Die heikle Stelle ist die Umrechnung Zeit ↔ logischer Index JENSEITS der
 * Kerzen: eine Trendlinie, deren zweiter Punkt in der Zukunft liegt, muss
 * beim Hin- und Zurückrechnen an derselben Zeit landen, sonst wandert sie bei
 * jedem Verschieben ein Stück. Dazu Fibonacci in TradingView-Richtung,
 * Positions-R mit falsch gesetztem Stop, Magnet und Trefferabstand.
 */
import {
    zeitZuLogisch, logischZuZeit, logischZuX, abstandZuStrecke, verlaengere, preisAufGerade,
    fibPreise, positionWerte, magnet, imRechteck, messung, dauerText,
} from './chart/zeichnungen/geometrie.js'
import { WERKZEUGE, stilFuer, STANDARD_STIL } from './chart/zeichnungen/werkzeuge.js'
import { ereignisZuLogisch, kreuzVerschoben, istTipp, freieZeile } from './chart/zeichnungen/geometrie.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

const H = 3_600_000
const t0 = 1_760_000_000_000
const zeiten = Array.from({ length: 10 }, (_, i) => t0 + i * H)

console.log('\nZeit ↔ logischer Index\n')
check('Kerzenzeit → ganzzahliger Index', zeitZuLogisch(t0 + 3 * H, zeiten, H) === 3)
check('Zwischen zwei Kerzen anteilig', nahe(zeitZuLogisch(t0 + 3.5 * H, zeiten, H), 3.5))
check('Zukunft: mit Kerzenlänge weitergezählt', nahe(zeitZuLogisch(t0 + 15 * H, zeiten, H), 15))
check('Vergangenheit vor der ersten Kerze: negativ', nahe(zeitZuLogisch(t0 - 2 * H, zeiten, H), -2))
for (const L of [-3.25, 0, 2.5, 9, 12.75]) {
    check(`Hin und zurück ohne Wanderung (L=${L})`, nahe(zeitZuLogisch(logischZuZeit(L, zeiten, H), zeiten, H), L))
}
{
    // Lücke in den Kerzen (z. B. Börsenausfall): Index bleibt monoton.
    const mitLuecke = [t0, t0 + H, t0 + 5 * H, t0 + 6 * H]
    const L = zeitZuLogisch(t0 + 3 * H, mitLuecke, H)
    check('Lücke: Zeit in der Lücke liegt zwischen den Nachbarn', L > 1 && L < 2, String(L))
    check('Lücke: Rückweg stimmt', nahe(logischZuZeit(L, mitLuecke, H), t0 + 3 * H))
}
check('Ohne Kerzen → null statt Absturz', zeitZuLogisch(t0, [], H) === null && logischZuZeit(1, [], H) === null)

{
    // Attrappe der Zeitachse, die sich wie Lightweight Charts verhält: ganze
    // Indizes ergeben x = 50 + 10·i, gebrochene 0 (so gemessen in v5.2.1).
    const achse = { logicalToCoordinate: (L) => (Number.isInteger(L) ? 50 + 10 * L : 0) }
    check('Gebrochener Index wird zwischen den Nachbarn geteilt (nicht 0)', nahe(logischZuX(achse, 3.5), 85))
    check('Ganzer Index unverändert', logischZuX(achse, 3) === 80)
    check('Negativer gebrochener Index (vor den Daten)', nahe(logischZuX(achse, -1.25), 37.5))
    check('null bleibt null', logischZuX(achse, null) === null)
}

console.log('\nTreffer und Verlängerung\n')
check('Abstand zur Strecke (senkrecht)', nahe(abstandZuStrecke(5, 3, 0, 0, 10, 0), 3))
check('Hinter dem Ende zählt der Endpunkt', nahe(abstandZuStrecke(14, 3, 0, 0, 10, 0), 5))
check('Verlängert nach rechts: hinter dem Ende auf der Linie', nahe(abstandZuStrecke(50, 0, 0, 0, 10, 0, { rechts: true }), 0))
check('Nicht nach links verlängert, wenn nur rechts', abstandZuStrecke(-50, 0, 0, 0, 10, 0, { rechts: true }) > 40)
{
    const v = verlaengere(0, 0, 10, 10, 800, { rechts: true })
    check('Verlängerung bleibt auf derselben Geraden', nahe(v.by / v.bx, 1, 1e-6) && v.bx > 800)
    check('Verlängerung ändert den Startpunkt nicht', v.ax === 0 && v.ay === 0)
}
check('Preis auf Gerade in der Zukunft', nahe(preisAufGerade(20, 0, 100, 10, 110), 120))
check('Senkrechte Gerade (gleicher Index) liefert Startpreis', preisAufGerade(5, 3, 100, 3, 200) === 100)
check('Im Rechteck mit vertauschten Ecken', imRechteck(5, 5, 10, 10, 0, 0) && !imRechteck(11, 5, 10, 10, 0, 0))

console.log('\nFibonacci, Position, Magnet, Messen\n')
{
    const f = fibPreise(100, 200)
    check('Fib 0 am Endpunkt, 1 am Startpunkt', f.find((x) => x.stufe === 0).preis === 200 && f.find((x) => x.stufe === 1).preis === 100)
    check('Fib 0.618 einer Aufwärtsbewegung 100→200 = 138.2', nahe(f.find((x) => x.stufe === 0.618).preis, 138.2, 1e-9))
}
{
    const w = positionWerte(100, 110, 95)
    check('Long: 10 Chance / 5 Risiko = 2 R', w.long && nahe(w.rr, 2) && w.stimmig)
    const s = positionWerte(100, 90, 105)
    check('Short erkannt, 2 R', !s.long && nahe(s.rr, 2) && s.stimmig)
    const falsch = positionWerte(100, 110, 104)
    check('Stop auf der falschen Seite: stimmig = false (nicht still korrigiert)', falsch.stimmig === false)
    check('Stop = Einstieg → R unbekannt statt Unendlich', positionWerte(100, 110, 100).rr === null)
}
{
    const k = { o: 100, h: 105, l: 98, c: 103 }
    check('Magnet rastet aufs Hoch ein', magnet(104.6, k, 1) === 105)
    check('Magnet ausserhalb der Toleranz lässt den Preis', magnet(101.5, k, 1) === 101.5)
    check('Magnet ohne Kerze lässt den Preis', magnet(50, null, 10) === 50)
    check('Starker Magnet (Toleranz ∞) rastet immer auf das nächste OHLC', magnet(101.5, k, Infinity) !== 101.5 && [k.o, k.h, k.l, k.c].includes(magnet(101.5, k, Infinity)))
}
{
    const m = messung({ t: t0, p: 100 }, { t: t0 + 5 * H, p: 110 }, H)
    check('Messung: +10, +10 %, 5 Kerzen', m.dp === 10 && nahe(m.pct, 10) && m.kerzen === 5)
    check('Dauertext', dauerText(5 * H) === '5h 0m' && dauerText(26 * H) === '1d 2h' && dauerText(90_000) === '2m')
}

console.log('\nWerkzeuge\n')
{
    const gespeichert = ['horizontale', 'strahlH', 'vertikale', 'trendlinie', 'strahl', 'kanal', 'rechteck', 'fib', 'position', 'text', 'volprofil']
    const fluechtig = WERKZEUGE.filter((w) => w.fluechtig).map((w) => w.typ)
    const alle = WERKZEUGE.map((w) => w.typ)
    check('Jedes speicherbare Werkzeug hat eine Vorgabe-Gestaltung', gespeichert.every((t) => STANDARD_STIL[t]))
    check('Werkzeugleiste und Server-Liste decken sich (ohne flüchtige)', alle.filter((t) => !fluechtig.includes(t)).sort().join() === [...gespeichert].sort().join())
    check('Eigener Stil überschreibt die Vorgabe, Rest bleibt', stilFuer({ typ: 'trendlinie', stil: { farbe: '#fff' } }).farbe === '#fff' && stilFuer({ typ: 'trendlinie', stil: { farbe: '#fff' } }).breite === 2)
}

console.log('\nEreignisse in ihrer Kerze (Journal)\n')
{
    const T = 86_400_000, t0 = Date.UTC(2026, 9, 10)
    const zeiten = [0, 1, 2, 3].map((i) => t0 + i * T)
    const L = ereignisZuLogisch(t0 + T + 14 * 3_600_000, zeiten, T)
    check('Trade 11.10. 14:00 auf 1d sitzt über der 11.10.-Kerze (Bereich 0,5…1,5), nicht über dem 12.10.', L > 0.5 && L < 1.5, String(L))
    const linie = zeitZuLogisch(t0 + T + 14 * 3_600_000, zeiten, T)
    check('Gegenprobe: dieselbe Zeit als Zeichnungspunkt bleibt bei 1,58 (Linien teilen zwischen Öffnungen)', Math.abs(linie - 1.5833) < 0.001, String(linie))
    const auf = ereignisZuLogisch(t0 + T, zeiten, T)
    check('Ereignis genau zur Eröffnung liegt innerhalb der Kerze, nicht auf der Grenze', auf > 0.5 && auf < 1, String(auf))
    const a = ereignisZuLogisch(t0 + T + 3_600_000, zeiten, T), b = ereignisZuLogisch(t0 + T + 20 * 3_600_000, zeiten, T)
    check('Reihenfolge in derselben Kerze bleibt (Einstieg 01:00 vor Ausstieg 20:00)', a < b && Math.round(a) === 1 && Math.round(b) === 1)
}

// ── Fortlaufend: bis zur aktuellen Kerze ────────────────────────────────────
{
    const { fortlaufendePunkte } = await import('./chart/zeichnungen/geometrie.js')
    const zuL = (t) => t / 10          // 10 ms je Kerze
    const linie = [{ t: 0, p: 100 }, { t: 100, p: 110 }]
    const f = fortlaufendePunkte('trendlinie', linie, 200, zuL)
    check('Linie: Endpunkt rückt zur aktuellen Kerze, entlang der Geraden', f[1].t === 200 && Math.abs(f[1].p - 120) < 1e-9 && f[0].t === 0 && f[0].p === 100)
    const rueck = fortlaufendePunkte('trendlinie', [linie[1], linie[0]], 200, zuL)
    check('Linie rückwärts gezeichnet: der spätere Punkt rückt vor', rueck[0].t === 200 && Math.abs(rueck[0].p - 120) < 1e-9 && rueck[1].t === 0)
    check('endet schon rechts der aktuellen Kerze: bleibt', fortlaufendePunkte('trendlinie', linie, 50, zuL) === linie)
    const log = fortlaufendePunkte('trendlinie', [{ t: 0, p: 100 }, { t: 100, p: 200 }], 200, zuL, true)
    check('Log-Skala: im Logarithmus verlängert (×2 je Strecke → 400)', Math.abs(log[1].p - 400) < 1e-6, log[1].p)
    const kanal = fortlaufendePunkte('kanal', [{ t: 0, p: 100 }, { t: 100, p: 110 }, { t: 0, p: 90 }], 200, zuL)
    check('Kanal: Grundlinie verlängert, dritter Punkt (Abstand) bleibt', kanal[1].t === 200 && Math.abs(kanal[1].p - 120) < 1e-9 && kanal[2].p === 90)
    const re = fortlaufendePunkte('rechteck', [{ t: 0, p: 100 }, { t: 100, p: 110 }], 200, zuL)
    check('Rechteck: nur die rechte Kante rückt vor, Preise bleiben', re[1].t === 200 && re[1].p === 110 && re[0].p === 100)
    check('andere Typen unverändert', fortlaufendePunkte('fib', linie, 200, zuL) === linie)
}

// ── Rechteck: acht Griffe, Beschriftung ─────────────────────────────────────
{
    const { rechteckGezogen, textInBox, textAnLinie } = await import('./chart/zeichnungen/geometrie.js')
    const box = [{ t: 100, p: 50 }, { t: 200, p: 60 }]
    const pt = { t: 150, p: 55 }
    const j = (x) => JSON.stringify(x)
    check('Ecke 0/1: der gezogene Punkt ersetzt die Ecke', j(rechteckGezogen(box, 0, pt)) === j([pt, box[1]]) && j(rechteckGezogen(box, 1, pt)) === j([box[0], pt]))
    check('Ecke 2 (Zeit von 0, Preis von 1)', j(rechteckGezogen(box, 2, pt)) === j([{ t: 150, p: 50 }, { t: 200, p: 55 }]))
    check('Ecke 3 (Zeit von 1, Preis von 0)', j(rechteckGezogen(box, 3, pt)) === j([{ t: 100, p: 55 }, { t: 150, p: 60 }]))
    check('Kantenmitte 4/5: nur die senkrechte Kante, Preise bleiben', j(rechteckGezogen(box, 4, pt)) === j([{ t: 150, p: 50 }, box[1]]) && j(rechteckGezogen(box, 5, pt)) === j([box[0], { t: 150, p: 60 }]))
    check('Kantenmitte 6/7: nur die waagrechte Kante, Zeiten bleiben', j(rechteckGezogen(box, 6, pt)) === j([{ t: 100, p: 55 }, box[1]]) && j(rechteckGezogen(box, 7, pt)) === j([box[0], { t: 200, p: 55 }]))
    check('Original bleibt unverändert', box[0].t === 100 && box[1].p === 60)
    const b = { links: 0, oben: 0, rechts: 200, unten: 100 }
    check('Text oben links (Vorgabe) innen', j(textInBox(b, {}, 40, 12)) === j({ x: 6, y: 15 }))
    check('Text Mitte/Mitte zentriert', j(textInBox(b, { textH: 'mitte', textV: 'mitte' }, 40, 12)) === j({ x: 80, y: 50 + 12 * 0.35 }))
    check('Text unter der Box rechts', j(textInBox(b, { textH: 'rechts', textV: 'unter' }, 40, 12)) === j({ x: 154, y: 115 }))
    check('Text über der Box', textInBox(b, { textV: 'ueber' }, 40, 12).y === -5)
    check('Linie: rechts unter der Linie', j(textAnLinie(0, 300, 50, { textH: 'rechts', textV: 'unten' }, 40, 12)) === j({ x: 254, y: 65 }))
}

// ── Rechteck-Griffe in Pixeln (ankerVon) ────────────────────────────────────
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const e = Object.create(ZeichenEbene.prototype)
    e.vorschau = new Map()
    e.zuX = (t) => t
    e.zuY = (p) => 1000 - p
    const anker = e.ankerVon({ id: 1, typ: 'rechteck', punkte: [{ t: 100, p: 50 }, { t: 200, p: 60 }], stil: {} }, 800)
    check('Rechteck: acht Griffe, Kantenmitten in der Mitte der Kanten', anker.length === 8 && anker[4].x === 100 && anker[4].y === 945 && anker[6].x === 150 && anker[6].y === 950, JSON.stringify(anker))
    const r = e.ankerVon({ id: 2, typ: 'rechteck', punkte: [{ t: 100, p: 50 }, { t: 200, p: 60 }], stil: { rechts: true } }, 800)
    check('Rechteck nach rechts verlängert: rechte Griffe am Rand', r[1].x === 800 && r[5].x === 800)
}

// ── Deckkraft ───────────────────────────────────────────────────────────────
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const e = Object.create(ZeichenEbene.prototype)
    const stapel = []
    const ctx = { globalAlpha: 1, save() { stapel.push(this.globalAlpha) }, restore() { this.globalAlpha = stapel.pop() } }
    let innen = null, anker = null
    e.zeichneInhalt = (c) => { innen = c.globalAlpha }
    e.zeichneAnker = (c) => { anker = c.globalAlpha }
    e.zeichneEine(ctx, { id: 1, typ: 'trendlinie', stil: { deckkraft: 0.4 } }, [], 800, 400, true)
    check('Deckkraft 40 %: die Zeichnung mit 0,4, die Anker voll, danach zurück auf 1', innen === 0.4 && anker === 1 && ctx.globalAlpha === 1, `${innen} ${anker} ${ctx.globalAlpha}`)
    e.zeichneEine(ctx, { id: 2, typ: 'trendlinie', stil: {} }, [], 800, 400, false)
    check('ohne Deckkraft: voll', innen === 1)
    e.zeichneEine(ctx, { id: 3, typ: 'trendlinie', stil: { deckkraft: 'x' } }, [], 800, 400, false)
    check('Unsinn als Deckkraft: voll', innen === 1)
    e.zeichneInhalt = () => { throw new Error('kaputt') }
    try { e.zeichneEine(ctx, { id: 4, typ: 'trendlinie', stil: { deckkraft: 0.5 } }, [], 800, 400, false) } catch { /* erwartet */ }
    check('Fehler beim Zeichnen: Deckkraft trotzdem zurückgesetzt', ctx.globalAlpha === 1)
}

// ── Gesperrte liegen hinten (Treffertest) ───────────────────────────────────
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const e = Object.create(ZeichenEbene.prototype)
    e.chart = { timeScale: () => ({ width: () => 800 }) }
    e.auswahlId = null
    // alles trifft überall — es zählt nur die Reihenfolge
    e.trifft = () => true
    e.zeichnungen = [{ id: 1, typ: 'trendlinie' }, { id: 2, typ: 'kanal', gesperrt: true }]
    check('gesperrter Kanal über (jünger als) einer Linie: die Linie wird getroffen', e.trefferTest(10, 10)?.z.id === 1)
    e.zeichnungen = [{ id: 2, typ: 'kanal', gesperrt: true }, { id: 3, typ: 'rechteck', gesperrt: true }]
    check('nur Gesperrte: die jüngste wird getroffen (zum Entsperren)', e.trefferTest(10, 10)?.z.id === 3)
    e.zeichnungen = [{ id: 1, typ: 'trendlinie' }, { id: 4, typ: 'rechteck' }]
    check('ohne Gesperrte: wie bisher die jüngste', e.trefferTest(10, 10)?.z.id === 4)
}

// ── Fadenkreuz-Zeichnen per Touch ──
{
    check('Fadenkreuz wandert um den Weg des Fingers', JSON.stringify(kreuzVerschoben({ x: 100, y: 100 }, 30, -20, 400, 300)) === '{"x":130,"y":80}')
    check('Fadenkreuz bleibt im Zeichenbereich', JSON.stringify(kreuzVerschoben({ x: 390, y: 5 }, 50, -50, 400, 300)) === '{"x":399,"y":0}')
    check('Kurz und ruhig = Tippen', istTipp(3, 4, 120))
    check('Weit bewegt = Schieben, kein Punkt', !istTipp(20, 0, 120))
    check('Lange gehalten = Schieben, kein Punkt', !istTipp(0, 0, 900))
}

// Ablauf: Werkzeug wählen → Fadenkreuz in der Mitte → schieben → tippen setzt Start → schieben → tippen setzt Ziel
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const e = Object.create(ZeichenEbene.prototype)
    const achse = { width: () => 400, coordinateToLogical: (x) => x / 10, logicalToCoordinate: (L) => L * 10 }
    Object.assign(e, {
        chart: { timeScale: () => achse, panes: () => [{ getHeight: () => 300 }] },
        serie: { coordinateToPrice: (y) => 1000 - y, priceToCoordinate: (p) => 1000 - p },
        huelle: { getBoundingClientRect: () => ({ left: 0, top: 0, height: 300 }), setPointerCapture() {}, releasePointerCapture() {} },
        zeiten: Array.from({ length: 40 }, (_, i) => t0 + i * H), kerzen: [], iv: H,
        zeichnungen: [], vorschau: new Map(), temporaer: [], magnetAn: false, rueckruf: {}, requestUpdate() {},
        fadenkreuzAn: true, touchGeraet: true,
    })
    const neu = []
    e.rueckruf = { neu: (z) => neu.push(z), werkzeugFertig() {} }
    e.setzeWerkzeug('volprofil')
    check('Fadenkreuz steht nach der Werkzeugwahl in der Mitte', e.kreuz?.x === 200 && e.kreuz?.y === 150)
    let jetzt = 0
    const alt = performance.now
    performance.now = () => jetzt
    const ev = (x, y, type = 'pointermove') => ({ type, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0, stopPropagation() {}, preventDefault() {} })
    try {
        e.zeigerUnten(ev(300, 250)); e.zeigerBewegt(ev(250, 250)); jetzt = 300; e.zeigerOben(ev(250, 250, 'pointerup'))
        check('Schieben setzt keinen Punkt', !e.entwurf && neu.length === 0 && e.kreuz.x === 150)
        jetzt = 400; e.zeigerUnten(ev(10, 10)); jetzt = 450; e.zeigerOben(ev(12, 11, 'pointerup'))
        check('Tippen setzt den Start am Fadenkreuz, nicht unter dem Finger', e.entwurf?.punkte[0].t === t0 + 15 * H)
        jetzt = 500; e.zeigerUnten(ev(100, 100)); e.zeigerBewegt(ev(160, 100))
        check('Entwurf folgt dem Fadenkreuz', e.entwurf?.punkte[1].t === t0 + 21 * H)
        jetzt = 700; e.zeigerOben(ev(160, 100, 'pointerup'))
        jetzt = 800; e.zeigerUnten(ev(5, 5)); jetzt = 850; e.zeigerOben(ev(5, 5, 'pointerup'))
        check('Zweites Tippen zeichnet das Profil von Start bis Ziel', neu.length === 1 && neu[0].punkte[0].t === t0 + 15 * H && neu[0].punkte[1].t === t0 + 21 * H, JSON.stringify(neu))
        check('Danach ist das Fadenkreuz weg', e.kreuz === null)
        e.setzeFadenkreuz(false)
        e.setzeWerkzeug('horizontale')
        e.zeigerUnten(ev(50, 40, 'pointerdown'))
        check('Abgeschaltet: Tippen zeichnet wie bisher unter dem Finger', neu.length === 2 && neu[1].punkte[0].p === 960)
    } finally { performance.now = alt }
}

// ── Preis-Alarmlinien: ziehen, sperren, Werkzeug „Alarm" ──
{
    const { ZeichenEbene } = await import('./chart/zeichnungen/ZeichenEbene.js')
    const e = Object.create(ZeichenEbene.prototype)
    const achse = { width: () => 400, coordinateToLogical: (x) => x / 10, logicalToCoordinate: (L) => L * 10 }
    const log = []
    Object.assign(e, {
        chart: { timeScale: () => achse, panes: () => [{ getHeight: () => 300 }] },
        serie: { coordinateToPrice: (y) => 1000 - y, priceToCoordinate: (p) => 1000 - p },
        huelle: { getBoundingClientRect: () => ({ left: 0, top: 0, height: 300 }), setPointerCapture() {}, releasePointerCapture() {} },
        zeiten: Array.from({ length: 40 }, (_, i) => t0 + i * H), kerzen: [], iv: H,
        zeichnungen: [], vorschau: new Map(), temporaer: [], magnetAn: false, requestUpdate() {},
        fadenkreuzAn: true, touchGeraet: false, alarme: [], alarmZug: null, finger: null,
        rueckruf: {
            alarmZiehen: (id, p) => log.push(['ziehen', id, p]), alarmVerschoben: (id, p) => log.push(['verschoben', id, p]),
            alarmKlick: (id) => log.push(['klick', id]), alarmPreis: (p) => log.push(['preis', p]), werkzeugFertig() {},
        },
    })
    const ev = (type, x, y) => ({ type, pointerId: 2, pointerType: 'mouse', clientX: x, clientY: y, button: 0, stopPropagation() {}, preventDefault() {} })
    e.setzeAlarme([{ id: 7, preis: 900, gesperrt: false }, { id: 8, preis: 850, gesperrt: true }])
    e.zeigerUnten(ev('pointerdown', 200, 102)); e.zeigerBewegt(ev('pointermove', 200, 120)); e.zeigerOben(ev('pointerup', 200, 120))
    check('Alarmlinie ziehen: neuer Preis beim Loslassen', log.some((x) => x[0] === 'verschoben' && x[1] === 7 && x[2] === 880), JSON.stringify(log))
    log.length = 0
    e.zeigerUnten(ev('pointerdown', 430, 100)); e.zeigerBewegt(ev('pointermove', 430, 60)); e.zeigerOben(ev('pointerup', 430, 60))
    check('Auch an der Preisskala greifbar', log.some((x) => x[0] === 'verschoben' && x[2] === 940), JSON.stringify(log))
    log.length = 0
    e.zeigerUnten(ev('pointerdown', 200, 150)); e.zeigerBewegt(ev('pointermove', 200, 190)); e.zeigerOben(ev('pointerup', 200, 190))
    check('Gesperrte Alarmlinie bewegt sich nicht, Loslassen = Tipp (Menü)', !log.some((x) => x[0] === 'verschoben') && log.some((x) => x[0] === 'klick' && x[1] === 8), JSON.stringify(log))
    log.length = 0
    e.zeigerUnten(ev('pointerdown', 200, 101)); e.zeigerOben(ev('pointerup', 200, 101))
    check('Tipp ohne Ziehen öffnet das Menü der Linie', log.length === 1 && log[0][0] === 'klick' && log[0][1] === 7, JSON.stringify(log))
    log.length = 0
    e.setzeWerkzeug('alarm')
    e.zeigerUnten(ev('pointerdown', 200, 40))
    check('Werkzeug „Alarm": Klick gibt den Preis an den Dialog, keine Zeichnung', log.length === 1 && log[0][0] === 'preis' && log[0][1] === 960, JSON.stringify(log))
}

console.log('\nBeschriftungen weichen einander aus\n')
{
    const box = { x: 100, y: 50, w: 80, h: 15 }
    check('frei: bleibt, wo sie ist', freieZeile(box, []) === 0)
    check('belegt: eine Zeile höher', freieZeile(box, [{ x: 120, y: 52, w: 80, h: 15 }]) === -17)
    check('oben kein Platz: eine Zeile tiefer', freieZeile({ ...box, y: 5 }, [{ x: 100, y: 5, w: 80, h: 15 }], { oben: 0 }) === 17)
    check('daneben (andere x) stört nicht', freieZeile(box, [{ x: 300, y: 50, w: 80, h: 15 }]) === 0)
    const voll = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ x: 100, y: 50 + i * 17, w: 80, h: 15 }))
    check('nirgends Platz: bleibt (lieber überdeckt als weit weg)', freieZeile(box, voll) === 0)
    check('zwei Zeilen höher, wenn eine nicht reicht', freieZeile(box, voll.slice(2, 5).concat([{ x: 100, y: 84, w: 80, h: 15 }])) === -34)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
