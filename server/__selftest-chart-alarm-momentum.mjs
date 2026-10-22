/**
 * Selbsttest der Momentum-Alarme (`chart-alarm-momentum.js`).
 *
 *   node server/__selftest-chart-alarm-momentum.mjs
 *
 * Wie bei den Preisalarmen steht neben jeder Auslösung ein Fall, der NICHT
 * auslösen darf: kleiner Punkt bei „nur grosse", dieselbe Kerze ein zweites
 * Mal, der Punkt auf der laufenden Kerze, die verspätete Kerze.
 */
import {
    pruefeMomentum, passtPunkt, faellig, nurGeschlossene, alarmPaare, reihenFuer, neuerStand, momentumText,
    letzteGeschlossene, laufendeKerze, paarSchluessel, TF_MS, VERZUG_MS, MAX_VERSPAETUNG_MS,
} from './chart-alarm-momentum.js'
import { momentumPunkte, werteAus, benoetigteZeitebenen } from './momentum-radar.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── Kerzen: Zufallsweg mit Wellen, damit die Welle in beide Zonen läuft ──────
const ENDE = 1_760_000_000_000 - (1_760_000_000_000 % TF_MS['1d'])
function reihe(seed, tf, n) {
    let s = seed
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647
    const ms = TF_MS[tf]
    let p = 100
    const out = []
    for (let i = n; i > 0; i--) {
        const o = p
        p *= 1 + (r() - 0.5) * 0.03 + Math.sin(i / 11) * 0.006
        out.push({ t: ENDE - i * ms, o, h: Math.max(o, p) * (1 + r() * 0.004), l: Math.min(o, p) * (1 - r() * 0.004), c: p, v: 100 + r() * 900 })
    }
    return out
}
function satz(seed) {
    return { '15m': reihe(seed, '15m', 700), '1h': reihe(seed + 1, '1h', 300), '4h': reihe(seed + 2, '4h', 300), '1d': reihe(seed + 3, '1d', 300) }
}

// Einen Satz suchen, in dem es grosse UND kleine Punkte gibt (weit genug hinten).
let kerzen = null
let gross = null
let klein = null
for (let seed = 11; seed < 400 && !(gross && klein); seed++) {
    kerzen = satz(seed)
    const pk = momentumPunkte({ kerzen, chartTf: '15m' }).filter((p) => p.i > 400)
    gross = pk.find((p) => p.stark) || null
    klein = pk.find((p) => !p.stark) || null
}
check('Testdaten: grosser und kleiner Punkt gefunden', gross && klein)

/** Zustand „Kerze i ist die jüngste geschlossene": Uhr kurz nach ihrem Schluss. */
const nach = (p, plus = VERZUG_MS) => kerzen['15m'][p.i].t + TF_MS['15m'] + plus
/** Nur Kerzen bis einschliesslich i auf der Chart-Zeitebene (die Börse kennt die Zukunft nicht). */
const bis = (i) => ({ ...kerzen, '15m': kerzen['15m'].slice(0, i + 1) })
const GROSS = { punktgroesse: 'gross', richtung: 'beide' }
const ALLE = { punktgroesse: 'alle', richtung: 'beide' }

console.log('\nPunktgrösse und Richtung\n')
{
    const e = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) })
    check('grosser Punkt bei „nur grosse" → löst aus', e.ausloesen && e.punkt.stark, JSON.stringify(e))
    check('…auf der Kerze des Punkts, mit ihrem Schlusskurs', e.kerzeT === gross.t && e.preis === kerzen['15m'][gross.i].c)
    const k = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(klein.i), jetzt: nach(klein) })
    check('kleiner Punkt bei „nur grosse" → meldet NICHT', !k.ausloesen && k.grund === 'passtNicht', JSON.stringify(k))
    check('kleiner Punkt bei „grosse und kleine" → löst aus',
        pruefeMomentum({ bedingung: ALLE, tf: '15m', kerzen: bis(klein.i), jetzt: nach(klein) }).ausloesen)
    const gegen = gross.seite === 'long' ? 'short' : 'long'
    check('falsche Richtung → meldet NICHT',
        !pruefeMomentum({ bedingung: { ...GROSS, richtung: gegen }, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) }).ausloesen)
    check('passende Richtung → löst aus',
        pruefeMomentum({ bedingung: { ...GROSS, richtung: gross.seite }, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) }).ausloesen)
    check('passtPunkt: Vorgabe ist „nur grosse"', !passtPunkt({}, { stark: false, seite: 'long' }) && passtPunkt({}, { stark: true, seite: 'long' }))
    check('passtPunkt: kein Punkt → nein', !passtPunkt(ALLE, null))
}

console.log('\nDivergenz\n')
{
    // Je einen Punkt mit und ohne Divergenz suchen (beliebige Grösse).
    let mit = null
    let ohne = null
    for (let seed = 11; seed < 400 && !(mit && ohne); seed++) {
        const satzD = satz(seed)
        const pk = momentumPunkte({ kerzen: satzD, chartTf: '15m' }).filter((p) => p.i > 400)
        if (!mit) { const p = pk.find((x) => x.divergenz); if (p) mit = { p, k: satzD } }
        if (!ohne) { const p = pk.find((x) => !x.divergenz); if (p) ohne = { p, k: satzD } }
    }
    check('Testdaten: Punkt mit und ohne Divergenz gefunden', mit && ohne)
    const fall = ({ p, k }, bedingung) => pruefeMomentum({
        bedingung, tf: '15m', kerzen: { ...k, '15m': k['15m'].slice(0, p.i + 1) }, jetzt: k['15m'][p.i].t + TF_MS['15m'] + VERZUG_MS,
    })
    const d = fall(mit, { ...ALLE, divergenz: true })
    check('Punkt mit Divergenz bei „nur mit Divergenz" → löst aus', d.ausloesen && d.punkt.divergenz, JSON.stringify(d))
    const o = fall(ohne, { ...ALLE, divergenz: true })
    check('Punkt OHNE Divergenz bei „nur mit Divergenz" → meldet NICHT', !o.ausloesen && o.grund === 'passtNicht', JSON.stringify(o))
    check('…ohne den Haken meldet derselbe Punkt', fall(ohne, ALLE).ausloesen)
    check('Divergenz + „nur grosse": kleiner Divergenzpunkt meldet NICHT',
        mit.p.stark || !fall(mit, { ...GROSS, divergenz: true }).ausloesen)
    const v = werteAus({ kerzen: { ...mit.k, '5m': [], '1w': [] }, chartTf: '15m', punkte: 700 }).verlauf.divergenzen.map((x) => x.i2)
    const pkt = momentumPunkte({ kerzen: mit.k, chartTf: '15m' }).filter((x) => x.divergenz).map((x) => x.i)
    check('Divergenz-Punkte == Divergenzen der Kachel', JSON.stringify([...new Set(v)]) === JSON.stringify(pkt), `${v} / ${pkt}`)
    check('Meldungstext nennt die Divergenz',
        momentumText({}, [{ symbol: 'X', markt: 'futures', tf: '1h', punkt: { seite: 'short', stark: true, divergenz: true }, preis: 1 }]).titel.endsWith('Short-Punkt mit Divergenz'))
}

console.log('\nNur geschlossene Kerzen\n')
{
    // Uhr MITTEN in der Kerze des Punkts: sie läuft noch; jüngste geschlossene ist die davor.
    const mitten = kerzen['15m'][gross.i].t + TF_MS['15m'] / 2
    const e = pruefeMomentum({ bedingung: ALLE, tf: '15m', kerzen: bis(gross.i), jetzt: mitten })
    check('Punkt auf der laufenden Kerze zählt NICHT', !e.ausloesen && e.grund === 'keinPunkt' && e.kerzeT === kerzen['15m'][gross.i - 1].t, JSON.stringify(e))
    check('…dieselben Kerzen nach dem Schluss → löst aus',
        pruefeMomentum({ bedingung: ALLE, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) }).ausloesen)
    check('nurGeschlossene schneidet nach der Uhr', nurGeschlossene(kerzen['15m'], '15m', mitten).length === gross.i)
    // Laufende 1h-Kerze darf die Punktstärke nicht beeinflussen: eine 1h-Kerze, die erst nach
    // `jetzt` schliesst, mit absurden Werten anhängen — das Ergebnis bleibt gleich.
    const t1h = laufendeKerze('1h', nach(gross))
    const gift = { ...bis(gross.i), '1h': [...kerzen['1h'].filter((k) => k.t < t1h), { t: t1h, o: 1, h: 1e9, l: 1e-9, c: 1e9, v: 1e12 }] }
    const g = pruefeMomentum({ bedingung: ALLE, tf: '15m', kerzen: gift, jetzt: nach(gross) })
    check('laufende Kerze einer höheren Zeiteinheit ändert nichts', g.ausloesen && g.punkt.stark === gross.stark, JSON.stringify(g))
}

console.log('\nEinmal je Kerze\n')
{
    const paar = { symbol: 'BTCUSDT', markt: 'futures', tf: '15m' }
    const e1 = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) })
    const stand = neuerStand({}, [{ ...paar, kerzeT: e1.kerzeT }], [paar])
    check('Stand hält die gemeldete Kerze je Paar', stand.k[paarSchluessel(paar)] === gross.t)
    const e2 = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross, VERZUG_MS + 5000), gemeldetBis: stand.k[paarSchluessel(paar)] })
    check('dieselbe Kerze im nächsten Takt meldet NICHT', !e2.ausloesen && e2.grund === 'schonGemeldet')
    check('neuerStand senkt nie (älterer Treffer überschreibt nichts)',
        neuerStand(stand, [{ ...paar, kerzeT: gross.t - TF_MS['15m'] }], [paar]).k[paarSchluessel(paar)] === gross.t)
    const ohne = neuerStand(stand, [], [{ ...paar, tf: '1h' }])
    check('neuerStand wirft Paare weg, die der Alarm nicht mehr hat', !(paarSchluessel(paar) in ohne.k))
}

console.log('\nVerspätung, veraltete Reihe, Anlage\n')
{
    const spaet = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross, MAX_VERSPAETUNG_MS + 1) })
    check('Kerze schloss vor > 10 min → kein Nachmelden', !spaet.ausloesen && spaet.grund === 'zuSpaet', JSON.stringify(spaet))
    check('knapp innerhalb → meldet', pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross, MAX_VERSPAETUNG_MS) }).ausloesen)
    const alt = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross) + TF_MS['15m'] })
    check('Reihe endet eine Kerze zu früh → veraltet, kein alter Punkt', !alt.ausloesen && alt.grund === 'veraltet')
    const vor = pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: bis(gross.i), jetzt: nach(gross), abMs: nach(gross) - 1000 })
    check('Kerze schloss vor dem Anlegen → meldet NICHT', !vor.ausloesen && vor.grund === 'vorAnlage')
    check('zu wenig Kerzen → kein Urteil', pruefeMomentum({ bedingung: GROSS, tf: '15m', kerzen: { '15m': kerzen['15m'].slice(0, 10) }, jetzt: nach(gross) }).grund === 'zuWenigKerzen')
    check('unbekannte Zeiteinheit → kein Urteil', pruefeMomentum({ bedingung: GROSS, tf: '2h', kerzen, jetzt: nach(gross) }).grund === 'zeiteinheit')
}

console.log('\nFälligkeit\n')
{
    const grenze = laufendeKerze('15m', ENDE + 7 * TF_MS['15m'])
    check('direkt nach dem Schluss noch nicht (Verzug)', !faellig('15m', grenze + VERZUG_MS - 1, 0))
    check('nach dem Verzug fällig', faellig('15m', grenze + VERZUG_MS, 0))
    check('schon geprüft → nicht fällig', !faellig('15m', grenze + VERZUG_MS, letzteGeschlossene('15m', grenze + VERZUG_MS)))
    check('nächste Kerze geschlossen → wieder fällig',
        faellig('15m', grenze + TF_MS['15m'] + VERZUG_MS, letzteGeschlossene('15m', grenze + VERZUG_MS)))
    check('4h ist innerhalb der Kerze nur einmal fällig',
        !faellig('4h', grenze + 3600000, letzteGeschlossene('4h', grenze + 3600000)))
}

console.log('\nTag und Woche\n')
{
    const mi = Date.UTC(2026, 9, 21, 15, 0)            // Mittwoch, 21.10.2026
    check('Wochenkerze beginnt Montag 00:00 UTC', laufendeKerze('1w', mi) === Date.UTC(2026, 9, 19))
    check('Montag kurz nach Mitternacht: neue Woche, die alte ist geschlossen',
        laufendeKerze('1w', Date.UTC(2026, 9, 26, 0, 1)) === Date.UTC(2026, 9, 26) && letzteGeschlossene('1w', Date.UTC(2026, 9, 26, 0, 1)) === Date.UTC(2026, 9, 19))
    check('Sonntagabend: die Woche läuft noch', laufendeKerze('1w', Date.UTC(2026, 9, 25, 23, 59)) === Date.UTC(2026, 9, 19))
    check('1d ist nach dem Tagesschluss fällig, danach den Tag über nicht mehr',
        faellig('1d', Date.UTC(2026, 9, 22, 0, 1), 0) && !faellig('1d', Date.UTC(2026, 9, 22, 15), letzteGeschlossene('1d', Date.UTC(2026, 9, 22, 0, 1))))
    check('1d zählt 1w für die Stärke, 1w hat keine höhere Zeiteinheit',
        benoetigteZeitebenen('1d').join() === '1d,1w' && benoetigteZeitebenen('1w').join() === '1w')
    // Wochenkerzen ab einem Montag, Tageskerzen dazu — 1w hat nie grosse Punkte.
    const mo = Date.UTC(2020, 0, 6)
    const woche = reihe(77, '1w', 300).map((k, i) => ({ ...k, t: mo + i * TF_MS['1w'] }))
    const pw = momentumPunkte({ kerzen: { '1w': woche }, chartTf: '1w' })
    check('1w: Punkte gibt es, grosse nie', pw.length > 0 && pw.every((p) => !p.stark), `${pw.length} Punkte`)
    const p1 = pw[pw.length - 1]
    const jetztW = woche[p1.i].t + TF_MS['1w'] + VERZUG_MS
    const w = pruefeMomentum({ bedingung: ALLE, tf: '1w', kerzen: { '1w': woche.slice(0, p1.i + 1) }, jetzt: jetztW })
    check('1w mit „grosse und kleine" meldet den Wochenpunkt', w.ausloesen && w.kerzeT === woche[p1.i].t, JSON.stringify(w))
    check('1w mit „nur grosse" meldet nie', !pruefeMomentum({ bedingung: GROSS, tf: '1w', kerzen: { '1w': woche.slice(0, p1.i + 1) }, jetzt: jetztW }).ausloesen)
}

console.log('\nPaare aus Symbol und Watchlists\n')
{
    const wl = new Map([[1, [{ symbol: 'BTCUSDT', markt: 'futures' }, { symbol: 'ethusdt', markt: 'futures' }]], [2, [{ symbol: 'BTCUSDT', markt: 'futures' }, { symbol: 'SOLUSDT', markt: 'spot' }, { symbol: 'kaputt!' }]]])
    const p = alarmPaare({ watchlistIds: [1, 2], zeiteinheiten: ['15m', '1h', '2h'] }, wl)
    check('zwei Listen × zwei gültige Zeiteinheiten, Doppelte einmal', p.length === 6, JSON.stringify(p))
    check('Spot bleibt Spot, Kleinschreibung wird gross', p.some((x) => x.symbol === 'SOLUSDT' && x.markt === 'spot') && p.some((x) => x.symbol === 'ETHUSDT'))
    check('unbekannte Zeiteinheit (2h) fällt weg', !p.some((x) => x.tf === '2h'))
    check('gelöschte Watchlist → keine Paare', alarmPaare({ watchlistIds: [9], zeiteinheiten: ['15m'] }, wl).length === 0)
    check('ohne Watchlist: das Symbol des Alarms', alarmPaare({ symbol: 'XRPUSDT', markt: 'futures', zeiteinheiten: ['5m', '4h'] }, wl).length === 2)
    const r = reihenFuer({ symbol: 'BTCUSDT', markt: 'futures', tf: '15m' }).map((x) => x.tf).sort()
    check('15m braucht 15m, 1h, 4h, 1d (nicht 1w, nicht 5m)', r.join() === '15m,1d,1h,4h', r.join())
    check('4h braucht 4h und 1d', benoetigteZeitebenen('4h').join() === '4h,1d')
}

console.log('\nGleich wie die Kachel\n')
{
    const v = werteAus({ kerzen: { ...kerzen, '5m': [], '1w': [] }, chartTf: '15m', punkte: 700 }).verlauf.punkte
    const p = momentumPunkte({ kerzen, chartTf: '15m' }).map(({ i, seite, stark }) => ({ i, seite, stark }))
    check('momentumPunkte == Punkte der Kachel (werteAus)', JSON.stringify(v) === JSON.stringify(p))
}

console.log('\nMeldungstext\n')
{
    const tr = [{ symbol: 'BTCUSDT', markt: 'futures', tf: '1h', punkt: { seite: 'long', stark: true }, preis: 100 }]
    check('ein Treffer: Symbol, Zeiteinheit, Grösse, Seite im Titel', momentumText({}, tr).titel === 'Momentum BTCUSDT 1h: grosser Long-Punkt')
    const zwei = momentumText({ notiz: 'Favoriten' }, [...tr, { symbol: 'SOLUSDT', markt: 'spot', tf: '15m', punkt: { seite: 'short', stark: false }, preis: 5 }])
    check('mehrere Treffer werden gebündelt', zwei.titel === 'Momentum: 2 Signale' && zwei.text.split('\n').length === 3 && zwei.text.includes('SOLUSDT Spot 15m: kleiner Short-Punkt'))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:', fehler.join('; ')); process.exit(1) }
