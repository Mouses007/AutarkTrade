/**
 * Selbsttest der Chart-Indikatoren — ohne Browser, ohne Chart-Bibliothek.
 *
 *   node src/utils/__selftest-chart-indikatoren.mjs
 *
 * Geprüft wird, was beim Zeichnen nicht auffällt, aber falsche Linien ergibt:
 * dass der Chart DIESELBE Rechnung benutzt wie die Strategie-Detektoren, dass
 * jede Ausgabe genau so lang ist wie die Kerzenreihe (sonst rutscht die Linie
 * gegen die Kerzen), dass die Preisquelle wirklich wirkt, und dass kaputte
 * gespeicherte Parameter nicht durchschlagen.
 */
import { INDIKATOREN, rechneIndikator, saubereParams, vorgaben, kurzname, neueInstanz, standardVon, aufKerzen, jeKerzeSumme, benoetigteQuellen, veraenderung, vwapVectorQuellen, vwapVectorSchluessel } from './chart/indikatorRegister.js'
import { TF_MS } from './chart/vwapVector.js'
import { ema, rsi, macd, bollinger } from '../../shared/indicators.js'
import { ema as serverEma } from '../../server/strategies/indicators.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const gleich = (a, b) => a.length === b.length && a.every((x, i) => (x === null && b[i] === null) || Math.abs(x - b[i]) < 1e-12)

// Deterministische Kerzen: Welle mit Trend, Volumen schwankend.
const kerzen = Array.from({ length: 300 }, (_, i) => {
    const basis = 100 + i * 0.05 + Math.sin(i / 7) * 3
    const o = basis + Math.sin(i / 3)
    const c = basis + Math.cos(i / 4)
    // vb: Kaufvolumen wie in Binance-Kerzen (CVD, Delta-Volumen)
    return { t: 1_700_000_000_000 + i * 3_600_000, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.6, c, v: 1000 + (i % 17) * 40, vb: 500 + (i % 13) * 30 }
})

console.log('\nEine Rechnung für Chart und Strategie\n')
check('Weiterleitung server/strategies/indicators.js zeigt auf shared/', serverEma === ema)
check('EMA im Chart == EMA der Detektoren', gleich(rechneIndikator('ema', kerzen, { laenge: 21 }).wert, ema(kerzen, 21)))
check('RSI im Chart == RSI der Detektoren', gleich(rechneIndikator('rsi', kerzen, { laenge: 14 }).wert, rsi(kerzen, 14)))
{
    const m = rechneIndikator('macd', kerzen, { schnell: 12, langsam: 26, signal: 9 })
    check('MACD-Linie, Signal und Histogramm == Detektoren',
        gleich(m.macd, macd(kerzen, { line: 'macd' })) && gleich(m.signal, macd(kerzen, { line: 'signal' })) && gleich(m.hist, macd(kerzen, { line: 'hist' })))
}
{
    const b = rechneIndikator('bb', kerzen, { laenge: 20, mult: 2, basis: 'sma' })
    const r = bollinger(kerzen, { period: 20, mult: 2 })
    check('Bollinger oben/mitte/unten == Detektoren', gleich(b.oben, r.upper) && gleich(b.mitte, r.middle) && gleich(b.unten, r.lower))
}

// Fremddaten für die Datenfenster: stündliches OI, Funding alle 8 h, Momentum je Kerze.
const extern = {
    oi: kerzen.filter((_, i) => i % 1 === 0).map((k, i) => ({ t: k.t, oi: 1000 + i, longPct: 50 + (i % 10) })),
    funding: kerzen.filter((_, i) => i % 8 === 0).map((k) => ({ t: k.t + 60_000, rate: 0.0001 })),
    // Liquidationen: abwechselnd Short (isBuy) und Long, je 1000 USD
    liquidationen: kerzen.filter((_, i) => i % 3 === 0).map((k, i) => ({ t: k.t + 1000, price: 100, qty: 10, isBuy: i % 2 === 0 })),
    momentum: { t: kerzen.map((k) => k.t), w1: kerzen.map((_, i) => Math.sin(i / 5) * 50), w2: kerzen.map((_, i) => Math.sin(i / 5 - 0.3) * 50), mf: kerzen.map((_, i) => Math.cos(i / 7) * 20) },
}

{
    const l = rechneIndikator('liquidationen', kerzen, {}, extern)
    check('Liquidationen: Shorts positiv, Longs negativ, je Kerze in USD',
        l.short.filter((x) => x != null).every((x) => x === 1000) && l.long.filter((x) => x != null).every((x) => x === -1000)
        && l.short.filter((x) => x != null).length > 0 && l.long.filter((x) => x != null).length > 0)
    check('Liquidationen: nicht in „Indikator hinzufügen"', INDIKATOREN.liquidationen.intern === true)
}

console.log('\nJede Ausgabe so lang wie die Kerzenreihe\n')
for (const typ of Object.keys(INDIKATOREN)) {
    const params = { ...vorgaben(typ), ...(typ === 'vwap' ? { band: 2 } : {}) }
    const aus = rechneIndikator(typ, kerzen, params, extern)
    const pflicht = INDIKATOREN[typ].ausgaben.filter((a) => !a.optional || typ === 'vwap')
    const fehlt = pflicht.filter((a) => !Array.isArray(aus[a.key]) || aus[a.key].length !== kerzen.length).map((a) => a.key)
    const zahlen = pflicht.every((a) => (aus[a.key] || []).some((x) => Number.isFinite(x)))
    check(`${typ}: alle Ausgaben vorhanden, Länge ${kerzen.length}, mit Werten`, !fehlt.length && zahlen, fehlt.join(','))
}
{
    const ohneBand = rechneIndikator('vwap', kerzen, { anker: 'session', band: 0 })
    check('VWAP ohne Band liefert keine leeren Bandreihen', !('oben' in ohneBand) && !('unten' in ohneBand))
    const mitBand = rechneIndikator('vwap', kerzen, { anker: 'session', band: 1 })
    const i = kerzen.length - 1
    check('VWAP-Band liegt um die Linie (oben > Linie > unten)', mitBand.oben[i] > mitBand.wert[i] && mitBand.wert[i] > mitBand.unten[i])
}
{
    // Anker US-Eröffnung (FACH-H-009): wählbar, bei Aktien-Futures vorbelegt, bei Coins bleibt alles
    const { vwap } = await import('../../shared/indicators.js')
    const std = Array.from({ length: 24 * 6 }, (_, j) => ({ t: Date.UTC(2026, 10, 9) + j * 3_600_000, o: 100 + j % 7, h: 102 + j % 7, l: 99 + j % 5, c: 100 + j % 6, v: 10 + j % 9 }))
    const us = rechneIndikator('vwap', std, { anker: 'usOpen', band: 0 }).wert
    const ref = vwap(std, { anchor: 'usOpen' })
    check('VWAP mit Anker US-Eröffnung == gemeinsamer Indikator', us.every((x, j) => x === ref[j]) && us.some((x) => x !== null) && us[0] === null)
    check('Anker US-Eröffnung übersteht das Säubern; Unbekanntes fällt auf den Tag zurück',
        saubereParams('vwap', { anker: 'usOpen' }).anker === 'usOpen' && saubereParams('vwap', { anker: 'quatsch' }).anker === 'session')
    check('neuer VWAP im Coin-Chart: Anker Tag (UTC) wie bisher',
        neueInstanz('vwap').params.anker === 'session' && neueInstanz('vwap', null, { aktie: false }).params.anker === 'session' && vorgaben('vwap').anker === 'session')
    check('neuer VWAP im Chart eines Aktien-Futures: Anker US-Eröffnung vorbelegt', neueInstanz('vwap', null, { aktie: true }).params.anker === 'usOpen')
    check('der eigene Standard geht vor', neueInstanz('vwap', { params: { anker: 'week' } }, { aktie: true }).params.anker === 'week')
    {   // RUK-05: gespeicherter Standard mit unberührtem Anker `session` (standardVon legt alle Parameter ab)
        const gespeichert = standardVon({ typ: 'vwap', params: { band: 2 }, farben: { wert: '#123456' } })
        const n = neueInstanz('vwap', gespeichert, { aktie: true })
        check('eigener Standard speichert den Werks-Anker mit', gespeichert.params.anker === 'session')
        check('eigener Standard mit Werks-Anker: Aktien-Future ankert trotzdem an der US-Eröffnung', n.params.anker === 'usOpen', n.params.anker)
        check('… und behält die übrigen eigenen Werte', n.params.band === 2 && n.farben.wert === '#123456')
        check('… ausserhalb des Aktien-Futures bleibt es beim Tagesanker', neueInstanz('vwap', gespeichert).params.anker === 'session' && neueInstanz('vwap', gespeichert, { aktie: false }).params.anker === 'session')
        check('bewusst gespeicherter Monatsanker bleibt', neueInstanz('vwap', standardVon({ typ: 'vwap', params: { anker: 'month' } }), { aktie: true }).params.anker === 'month')
    }
    check('andere Indikatoren kennen keine Aktien-Vorgabe', JSON.stringify(neueInstanz('ema', null, { aktie: true }).params) === JSON.stringify(neueInstanz('ema').params))
    const tag = rechneIndikator('vwap', std, { anker: 'session', band: 0 }).wert
    check('Anker Tag (UTC) rechnet weiter den UTC-Tag', tag.every((x, j) => x === vwap(std, { anchor: 'session' })[j]) && tag[30] !== us[30])
}

console.log('\nDatenfenster: fremde Reihen auf Kerzen\n')
{
    const k = [{ t: 100 }, { t: 200 }, { t: 300 }, { t: 400 }]
    const oi = aufKerzen(k, [{ t: 150, oi: 7 }, { t: 300, oi: 9 }], 'oi')
    check('Vor dem ersten Punkt null, nicht 0', oi[0] === null)
    check('Letzter bekannter Wert zur Kerzeneröffnung', oi[1] === 7 && oi[2] === 9 && oi[3] === 9, JSON.stringify(oi))
    check('Unsortierte Punkte werden sortiert', aufKerzen(k, [{ t: 300, oi: 9 }, { t: 150, oi: 7 }], 'oi')[1] === 7)
    // Stand am Kerzenschluss: Punkt bei 200 = Schluss der Kerze [100,200) → gehört zu Kerze 0
    const s = aufKerzen(k, [{ t: 200, oi: 5 }, { t: 400, oi: 8 }], 'oi', { amSchluss: true })
    check('amSchluss: Stand zur Zeit 200 sitzt auf der Kerze, die um 200 schliesst', s[0] === 5, JSON.stringify(s))
    check('amSchluss: Stand von 400 auf der Kerze 300–400, nicht schon auf 200–300', s[1] === 5 && s[2] === 8 && s[3] === 8, JSON.stringify(s))
    check('Gegenprobe ohne amSchluss: derselbe Punkt eine Kerze später', aufKerzen(k, [{ t: 200, oi: 5 }], 'oi')[0] === null && aufKerzen(k, [{ t: 200, oi: 5 }], 'oi')[1] === 5)
    const f = jeKerzeSumme(k, [{ t: 210, rate: 0.0001 }, { t: 290, rate: 0.0002 }, { t: 50, rate: 1 }], 'rate', 100)
    check('Funding in der Kerze, in die es fällt, summiert (in %)', Math.abs(f[1] - 0.03) < 1e-12 && f[0] === null && f[2] === null, JSON.stringify(f))
    check('Zahlung vor der ersten Kerze wird nicht der ersten zugeschlagen', f[0] === null)
    const d = veraenderung([null, 7, 7, 9, 8])
    check('OI-Veränderung: fortgeschriebener Wert ist keine Messung (null statt 0)', d[0] === null && d[1] === null && d[2] === null && d[3] === 2 && d[4] === -1, JSON.stringify(d))
    check('Ohne Fremddaten: Reihe aus null statt Absturz', rechneIndikator('oi', kerzen, {}, {}).wert.every((v) => v === null))
    const m = rechneIndikator('momentum', kerzen.slice(0, 5), {}, { momentum: { t: [kerzen[1].t, kerzen[3].t], w1: [10, 20], w2: [1, 2], mf: [3, 4] } })
    check('Momentum nur an exakt passenden Kerzenzeiten (andere Zeiteinheit → leer)', m.w1[0] === null && m.w1[1] === 10 && m.w1[3] === 20 && m.w1[2] === null)
    check('Momentum-Geldfluss als Wert für die Legende', m.mf[1] === 3 && m.mf[3] === 4)
    check('Benötigte Quellen ohne Doppelte, ausgeblendete zählen nicht',
        benoetigteQuellen([{ typ: 'oi' }, { typ: 'longShort' }, { typ: 'funding', sichtbar: false }, { typ: 'ema' }]).join() === 'oi')
}

console.log('\nPreisquelle wirkt\n')
{
    const c = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'c' }).wert
    const h = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'h' }).wert
    const hl2 = rechneIndikator('sma', kerzen, { laenge: 10, quelle: 'hl2' }).wert
    const i = 200
    const erwartetHl2 = kerzen.slice(i - 9, i + 1).reduce((s, k) => s + (k.h + k.l) / 2, 0) / 10
    check('SMA auf Hoch liegt über SMA auf Schluss', h[i] > c[i])
    check('SMA hl2 nachgerechnet', Math.abs(hl2[i] - erwartetHl2) < 1e-9, `${hl2[i]} vs ${erwartetHl2}`)
    check('Quelle verändert die Kerzen des Aufrufers nicht', kerzen[i].c !== (kerzen[i].h + kerzen[i].l) / 2)
}

console.log('\nGespeicherte Parameter säubern\n')
{
    const p = saubereParams('ema', { laenge: '9999', quelle: 'quatsch', fremd: 1 })
    check('Zahl auf Maximum begrenzt', p.laenge === 500, String(p.laenge))
    check('unbekannte Wahl fällt auf Vorgabe', p.quelle === 'c')
    check('unbekannter Schlüssel fällt weg', !('fremd' in p))
    check('Text statt Zahl → Vorgabe', saubereParams('rsi', { laenge: 'abc' }).laenge === 14)
    check('unbekannter Indikator → leeres Ergebnis statt Absturz', Object.keys(rechneIndikator('gibtsnicht', kerzen, {})).length === 0)
    check('leere Kerzenreihe → leeres Ergebnis', Object.keys(rechneIndikator('ema', [], { laenge: 5 })).length === 0)
}

console.log('\nBeschriftung und Instanzen\n')
check('Kurzname EMA', kurzname('ema', { laenge: 21, quelle: 'c' }, 'EMA') === 'EMA 21')
check('Kurzname zeigt abweichende Quelle', kurzname('sma', { laenge: 50, quelle: 'hl2' }, 'SMA') === 'SMA 50 hl2')
check('Kurzname BB', kurzname('bb', { laenge: 20, mult: 2, basis: 'sma' }, 'BB') === 'BB 20 2')
// Legende: Wert einer Wahl übersetzt, wenn es einen Text gibt (vorher «VWAP 0 usOpen»)
{
    const TEXTE = { usOpen: 'US-Eröffnung', hl2: '(H+L)/2' }
    const wahlText = (w) => TEXTE[w] || null
    check('Kurzname VWAP: Anker übersetzt', kurzname('vwap', { anker: 'usOpen', band: 0 }, 'VWAP', wahlText) === 'VWAP 0 US-Eröffnung')
    check('Kurzname VWAP: ohne Text bleibt der rohe Wert', kurzname('vwap', { anker: 'week', band: 0 }, 'VWAP', wahlText) === 'VWAP 0 week')
    check('Kurzname VWAP: ohne Übersetzer wie bisher', kurzname('vwap', { anker: 'usOpen', band: 0 }, 'VWAP') === 'VWAP 0 usOpen')
    check('Kurzname: Preisquelle übersetzt', kurzname('sma', { laenge: 50, quelle: 'hl2' }, 'SMA', wahlText) === 'SMA 50 (H+L)/2')
}
// FACH-H-012: was der Perpetual selbst misst, ist gekennzeichnet (Hinweis im Aktien-Markt) — nicht gesperrt
{
    const future = Object.keys(INDIKATOREN).filter((t) => INDIKATOREN[t].misstFuture === true).sort()
    check('misstFuture: genau OI, Long/Short, Funding, CVD, Delta, Footprint',
        future.join() === ['cvd', 'deltaVol', 'footprint', 'funding', 'longShort', 'oi'].join(), future.join())
    check('misstFuture: keiner davon ist aus der Auswahl genommen', future.every((t) => !INDIKATOREN[t].intern && !INDIKATOREN[t].nurKrypto))
    check('Preis-Indikatoren tragen den Hinweis nicht', ['ema', 'vwap', 'rsi', 'vwapVector', 'momentum'].every((t) => !INDIKATOREN[t].misstFuture))
}
// FUN-R-402: die POC-Periode gehört in den Schlüssel der feinen Kerzen
{
    const basis = { symbol: 'BTCUSDT', markt: 'futures', interval: '1h', intra: null, boerse: 'binance' }
    const q = (pocPerTf) => vwapVectorQuellen({ ...vorgaben('vwapVector'), showPocPer: true, pocPerTf }, 3_600_000, TF_MS, 1000).pocFein
    check('12h und 1d teilen die Feinheit', q('12h') === q('1d') && q('12h') != null, `${q('12h')} / ${q('1d')}`)
    check('Schlüssel unterscheidet 12h und 1d trotz gleicher Feinheit',
        vwapVectorSchluessel({ ...basis, pocFein: q('12h'), pocPeriode: '12h' }) !== vwapVectorSchluessel({ ...basis, pocFein: q('1d'), pocPeriode: '1d' }))
    check('Schlüssel ohne feine Kerzen hängt nicht an der Periode',
        vwapVectorSchluessel({ ...basis, pocFein: null, pocPeriode: '12h' }) === vwapVectorSchluessel({ ...basis, pocFein: null, pocPeriode: '1d' }))
    check('Schlüssel gleicher Eingaben ist gleich',
        vwapVectorSchluessel({ ...basis, pocFein: '15m', pocPeriode: '1d' }) === vwapVectorSchluessel({ ...basis, pocFein: '15m', pocPeriode: '1d' }))
}
{
    const a = neueInstanz('ema')
    const b = neueInstanz('ema')
    check('zwei Instanzen desselben Typs haben verschiedene ids', a.id !== b.id)
    check('neue Instanz trägt die Vorgaben', a.params.laenge === 21 && a.sichtbar === true)
}

console.log('\nEingaben säubern\n')
{
    const k = Array.from({ length: 100 }, (_, i) => ({ t: i * 3_600_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 10 }))
    let wirft = false
    try { rechneIndikator('ema', k, { laenge: 14.5 }) } catch { wirft = true }
    check('Länge 14.5 wird gerundet statt zu werfen (griff auf candles[i − 14.5])', !wirft && saubereParams('ema', { laenge: 14.5 }).laenge === 15)
    check('leeres Feld ergibt die Vorgabe, nicht das Minimum (EMA 1)', saubereParams('ema', { laenge: '' }).laenge === vorgaben('ema').laenge && saubereParams('ema', { laenge: null }).laenge === vorgaben('ema').laenge)
    check('Gegenprobe: Faktor mit Schritt 0.1 bleibt wie eingegeben (2.25)', saubereParams('bb', { mult: 2.25 }).mult === 2.25)
    check('shared/ema rundet selbst (Strategien mit gebrochener Länge)', ema(k, 14.5)[99] === ema(k, 15)[99])
}

// ── Eigener Standard („Als Standard speichern“) ──
{
    const eigen = standardVon({ typ: 'rsi', params: { laenge: 21, unbekannt: 5 }, farben: { wert: '#ff0000' } })
    check('Standard: Unbekanntes fällt weg', !('unbekannt' in eigen.params))
    check('Standard: keine ID', !('id' in eigen))
    const n = neueInstanz('rsi', eigen)
    check('Neue Instanz mit eigenem Standard', n.params.laenge === 21 && n.farben.wert === '#ff0000')
    const w = neueInstanz('rsi')
    check('Ohne eigenen Standard: Werksvorgaben', w.params.laenge === vorgaben('rsi').laenge && !Object.keys(w.farben).length)
    const alt = neueInstanz('rsi', { params: { laenge: 99999 } })
    check('Gespeicherter Standard wird gesäubert (Bereich)', alt.params.laenge === INDIKATOREN.rsi.params.find((x) => x.key === 'laenge').max)
    n.farben.wert = '#00ff00'
    check('Neue Instanz teilt die Farben nicht mit dem Standard', eigen.farben.wert === '#ff0000')
}

// Momentum Radar: Ebenen einzeln schaltbar, Schnellwahl «Ansicht»
{
    const P = INDIKATOREN.momentum.params
    const schalter = P.filter((x) => x.typ === 'schalter').map((x) => x.key)
    const ansicht = P.find((x) => x.key === 'mrAnsicht')
    const v = vorgaben('momentum')
    check('Momentum: ab Werk alles an (Bild wie bisher)', schalter.length === 9 && schalter.every((k) => v[k] === true) && v.mrAnsicht === 'mrAlles')
    check('Momentum: altes Layout ohne Parameter → alles an', schalter.every((k) => saubereParams('momentum', undefined)[k] === true))
    check('Momentum: jede Schnellwahl stellt ALLE Schalter', Object.values(ansicht.setzt).every((s) => schalter.every((k) => typeof s[k] === 'boolean')))
    check('Momentum: «Alles» entspricht den Vorgaben', schalter.every((k) => ansicht.setzt.mrAlles[k] === true))
    const nf = ansicht.setzt.mrNurFluss
    check('Momentum: «Nur Geldfluss» ohne Welle und Signale', nf.mrFluss && nf.mrSpot && nf.mrLeiste && !nf.mrWelle && !nf.mrSignal && !nf.mrPunkte && !nf.mrDiv && !nf.mrSchienen)
    const nw = ansicht.setzt.mrNurWelle
    check('Momentum: «Nur Welle» ohne Geldfluss', nw.mrWelle && nw.mrPunkte && !nw.mrFluss && !nw.mrSpot && !nw.mrLeiste)
    const saetze = Object.values(ansicht.setzt).map((s) => JSON.stringify(s))
    check('Momentum: Schnellwahlen sind unterscheidbar', new Set(saetze).size === saetze.length)
    check('Momentum: freie Wahl ist eine Option ohne Satz', ansicht.optionen.includes(ansicht.frei) && !(ansicht.frei in ansicht.setzt))
    const aus = INDIKATOREN.momentum.ausgabenFuer(saubereParams('momentum', { mrWelle: false, mrFluss: false }))
    check('Momentum: ausgeblendete Ebenen bleiben als Serie, nur versteckt', aus.length === 3 && aus.find((a) => a.key === 'w1').versteckt === true && aus.find((a) => a.key === 'w2').versteckt === false && aus.find((a) => a.key === 'mf').versteckt === true)
    check('Momentum: Kurzname ohne Parameter', kurzname('momentum', v, 'Momentum') === 'Momentum')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
