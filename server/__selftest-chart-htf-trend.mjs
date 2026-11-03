/**
 * Selbsttest server/chart-htf-trend.js — übergeordneter Trend der KI-Analyse:
 * welche Zeiteinheiten in Frage kommen, eine Linie nur passend zur Struktur,
 * Vorliebe für den Tageschart, höchstens eine Linie, Verlängerung bis zum Chart.
 */
import { htfTrendKandidaten, trendAuf, uebergeordneterTrend, htfTrendZeile } from './chart-htf-trend.js'

let ok = 0, fehl = 0
function pruefe(name, bed) { if (bed) ok++; else { fehl++; console.error('FEHLER:', name) } }

const TAG = 86400000
/** Wellen um eine Gerade: steig > 0 aufwärts, < 0 abwärts, 0 seitwärts. */
function reihe(n, steig, { iv = TAG, welle = 12, amp = 6, start = 100 } = {}) {
    const k = []
    for (let i = 0; i < n; i++) {
        const mitte = start + steig * i + amp * Math.sin((2 * Math.PI * i) / welle)
        const o = mitte - 0.3, c = mitte + 0.3
        k.push({ t: i * iv, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.8, c, v: 100 })
    }
    return k
}

pruefe('15m → 1d, 4h, 1w', JSON.stringify(htfTrendKandidaten('15m')) === '["1d","4h","1w"]')
pruefe('4h → 1d, 1w', JSON.stringify(htfTrendKandidaten('4h')) === '["1d","1w"]')
pruefe('1d → 1w', JSON.stringify(htfTrendKandidaten('1d')) === '["1w"]')
pruefe('1w → nichts', htfTrendKandidaten('1w').length === 0)
pruefe('1w: kein Trend', uebergeordneterTrend({}, '1w') === null)

const auf = trendAuf(reihe(200, 0.5))
pruefe('Aufwärts erkannt', auf?.zustand === 1)
pruefe('Aufwärts: steigende Unterstützung', auf?.linie?.seite === 'tief' && auf.linie.richtung === 'auf' && !auf.linie.gegen)

const ab = trendAuf(reihe(200, -0.5, { start: 300 }))
pruefe('Abwärts erkannt', ab?.zustand === -1)
pruefe('Abwärts: fallender Widerstand', ab?.linie?.seite === 'hoch' && ab.linie.richtung === 'ab')

pruefe('zu wenige Kerzen → null', trendAuf(reihe(10, 0.5)) === null)

// Tageschart mit Linie gewinnt; Verlängerung bis knapp hinter die letzte Chartkerze
const d1 = reihe(200, 0.5)
const bisT = d1[d1.length - 1].t + 3 * 3600000
const h = uebergeordneterTrend({ '1d': d1, '4h': reihe(200, 0.5, { iv: 4 * 3600000 }), '1w': null }, '15m', { bisT, ivMs: 900000 })
pruefe('Tageschart bevorzugt', h?.tf === '1d' && !!h.linie)
pruefe('genau eine Linie', h && !Array.isArray(h.linie))
pruefe('Ende hinter der letzten Chartkerze', h?.linie?.tEnde === bisT + 10 * 900000)
const proMs = (h.linie.p2 - h.linie.p1) / (h.linie.t2 - h.linie.t1)
pruefe('Ende liegt auf der Geraden', Math.abs(h.linie.pEnde - (h.linie.p1 + proMs * (h.linie.tEnde - h.linie.t1))) < 1e-9)

// Tageschart ohne Richtung → die 4h-Linie
const h4 = uebergeordneterTrend({ '1d': reihe(200, 0), '4h': reihe(200, -0.5, { iv: 4 * 3600000, start: 300 }) }, '1h')
pruefe('ohne Tageslinie: 4h', h4?.tf === '4h' && h4.linie?.richtung === 'ab')

// Nirgends eine Linie → Richtung genannt, keine Zeichnung
const leer = uebergeordneterTrend({ '1d': reihe(200, 0), '4h': null, '1w': null }, '15m')
pruefe('keine Linie → linie null', leer && leer.linie === null)
pruefe('Zeile ohne Linie sagt es', /keine dazu passende Trendlinie/.test(htfTrendZeile(leer, 100)))
pruefe('Zeile mit Linie nennt Zeiteinheit', /ÜBERGEORDNETER TREND \(1D\)/.test(htfTrendZeile(h, d1[d1.length - 1].c)))

console.log(`chart-htf-trend: ${ok} ok, ${fehl} Fehler`)
process.exit(fehl ? 1 : 0)
