/**
 * Selbsttest: Backtest auf einem Aktien-Future — Börsensitzungen, Einstiegs-
 * sperre ausserhalb der regulären Sitzung, Split-Umrechnung. Und die
 * Gegenprobe: ein Coin rechnet genau wie vorher.
 *
 *   node server/__selftest-backtest-aktien.mjs
 */
import assert from 'node:assert/strict'
import { runBacktest } from './strategy-backtest.js'
import { sitzungVon } from '../shared/aktien-sitzung.js'
import { bereinigeSplits } from './aktien/splits.js'
import { satzFuer, kostenAus, rutschAufschlag, createPosition, closePosition, MARKT, LIMIT } from './fill-simulator.js'
import { evaluateRisk } from './risk-engine.js'

let n = 0
const ok = (bed, text) => { assert.ok(bed, text); n++ }
const H = 3_600_000
const T0 = Date.UTC(2026, 7, 31)   // Montag, 31.8.2026 — enthält Labor Day (7.9.) und Wochenenden

// Zufall mit festem Keim
let keim = 7
const rnd = () => { keim = (keim * 16807) % 2147483647; return keim / 2147483647 }
function reihe(anzahl, sprungBei = -1, faktor = 1) {
    const aus = []
    let preis = 400
    for (let i = 0; i < anzahl; i++) {
        if (i === sprungBei) preis /= faktor
        const o = preis
        const c = o * (1 + (rnd() - 0.5) * 0.01)
        aus.push({ t: T0 + i * H, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 10 })
        preis = c
    }
    return aus
}

// Alle 7 Stunden ein Setup, Einstieg zur Eröffnung der Folgekerze — so wandern die Einstiege durch alle Tageszeiten.
const manifest = {
    id: 'aktien_test', name: 'Aktien-Test', params: [], supportedTimeframes: ['1h'], warmupCandles: 20,
    regeln: { maxHoldCandles: 4, breakEvenAtR: 0 },
    detect({ candles: sicht, openSetups }) {
        const jetzt = sicht[sicht.length - 1]
        const idx = Math.round((jetzt.t - T0) / H)
        const events = []
        for (const s of openSetups) {
            if (idx !== s._ausloeser) continue
            const risiko = jetzt.o * 0.01
            events.push({
                id: s.id, status: 'triggered', candleTime: jetzt.t, triggeredAt: jetzt.t, entryAtOpen: true,
                entry: jetzt.o, stopLoss: jetzt.o - risiko, takeProfit: jetzt.o + 2 * risiko,
            })
        }
        const setups = []
        if (idx >= 25 && idx % 7 === 0) {
            setups.push({
                direction: 'long', entry: jetzt.c, stopLoss: jetzt.c * 0.99, takeProfit: jetzt.c * 1.02,
                obCandleTime: jetzt.t, _ausloeser: idx + 1, entryTrigger: 'market',
            })
        }
        return { setups, events, diagnostics: {} }
    },
}
const lauf = (kerzen, aktie, risk = {}, extra = {}) => runBacktest({
    strategyId: 'aktien_test', strategie: manifest, symbol: 'TESTUSDT', timeframe: '1h', market: 'futures',
    risk: { riskPerTradePct: 1, maxNotionalUsdt: 1e6, leverage: 5, minRR: 1, maintenanceMarginPct: 0.5, cooldownMinutes: 0, maxDailyLossPct: 25, ...risk },
    startEquity: 10000, candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: T0, toTs: T0 + kerzen.length * H,
    aktie, ...extra,
})
const AKTIE = { ticker: 'TEST', boerse: 'bitunix', splits: [], splitsGrund: null }

const kerzen = reihe(900)
const coin = await lauf(kerzen, null)
ok(coin.trades.length > 60, `Grundlauf handelt (${coin.trades.length} Trades)`)
ok(coin.stats.aktien === null && coin.trades.every((t) => t.sitzung === undefined), 'Coin: keine Sitzungen, kein Aktien-Block')
const coinGesperrt = await lauf(kerzen, null, { nurRegulaereSitzung: true })
ok(coinGesperrt.trades.length === coin.trades.length && !coinGesperrt.funnel.entrySkipped.ausserhalb_sitzung, 'Coin: die Sitzungssperre wirkt nicht')

const aktie = await lauf(kerzen, AKTIE)
ok(aktie.trades.length > 60 && aktie.trades.every((t) => t.sitzung === sitzungVon(t.entryTime)), 'Aktie: jeder Trade trägt die Sitzung seines Einstiegs')
const je = Object.fromEntries(aktie.stats.aktien.sitzungen.map((s) => [s.sitzung, s]))
ok(je.regulaer && je.vor && je.nach && je.nacht && je.wochenende && je.feiertag, 'alle sechs Sitzungen kommen vor (Labor Day im Zeitraum)')
ok(aktie.stats.aktien.sitzungen.reduce((s, z) => s + z.trades, 0) === aktie.trades.length, 'Bilanz je Sitzung summiert auf alle Trades')
ok(aktie.stats.aktien.ticker === 'TEST' && aktie.stats.aktien.nurRegulaer === false && aktie.stats.aktien.splitsBekannt === true, 'Aktien-Block im Ergebnis')
ok(aktie.stats.aktien.regime === null, 'Zeitraum nach dem Stichtag der Börse: kein Hinweis')

const gesperrt = await lauf(kerzen, AKTIE, { nurRegulaereSitzung: true })
ok(gesperrt.trades.length > 5 && gesperrt.trades.every((t) => t.sitzung === 'regulaer'), 'Sperre: nur Einstiege in der regulären Sitzung')
ok(gesperrt.funnel.entrySkipped.ausserhalb_sitzung > 30, `Sperre zählt die ausgelassenen Einstiege (${gesperrt.funnel.entrySkipped.ausserhalb_sitzung})`)
ok(gesperrt.stats.aktien.nurRegulaer === true && gesperrt.setups.some((s) => s.rejectReason === 'ausserhalb_sitzung'), 'Sperre steht im Ergebnis und am Setup')

// ── Sitzungssperre nach Füllzeitpunkt statt Kerzenbeginn (FUN-H-005) ──
{
    const { nyTeile, kerzeBeruehrtRegulaer } = await import('../shared/aktien-sitzung.js')
    ok(gesperrt.stats.aktien.nurRegulaerWirkt === true && aktie.stats.aktien.nurRegulaerWirkt === false, '1h: der Schalter wirkt und das Ergebnis sagt es')
    // Dieselbe Strategie, aber Limit in der Auslösekerze (Zeitpunkt in der Kerze unbekannt) und beliebige Kerzenlänge.
    const variante = (iv, zurEroeffnung) => ({
        ...manifest, id: 'aktien_test_iv', supportedTimeframes: ['1h', '4h', '1d'],
        detect({ candles: sicht, openSetups }) {
            const jetzt = sicht[sicht.length - 1]
            const idx = Math.round((jetzt.t - T0) / iv)
            const events = []
            for (const s of openSetups) {
                if (idx !== s._ausloeser) continue
                const risiko = jetzt.o * 0.01
                events.push({ id: s.id, status: 'triggered', candleTime: jetzt.t, triggeredAt: jetzt.t, ...(zurEroeffnung ? { entryAtOpen: true } : {}),
                    entry: jetzt.o, stopLoss: jetzt.o - risiko, takeProfit: jetzt.o + 2 * risiko })
            }
            const setups = idx >= 25 && idx % 7 === 0
                ? [{ direction: 'long', entry: jetzt.c, stopLoss: jetzt.c * 0.99, takeProfit: jetzt.c * 1.02, obCandleTime: jetzt.t, _ausloeser: idx + 1,
                    ...(zurEroeffnung ? { entryTrigger: 'market' } : {}) }]
                : []
            return { setups, events, diagnostics: {} }
        },
    })
    const laufIv = (tf, iv, zurEroeffnung, aktieKontext, risk = {}) => {
        const k = kerzen.map((c, i) => ({ ...c, t: T0 + i * iv }))   // dieselben Kurse, andere Kerzenlänge
        return runBacktest({ strategyId: 'aktien_test_iv', strategie: variante(iv, zurEroeffnung), symbol: 'TESTUSDT', timeframe: tf, market: 'futures',
            risk: { riskPerTradePct: 1, maxNotionalUsdt: 1e6, leverage: 5, minRR: 1, maintenanceMarginPct: 0.5, cooldownMinutes: 0, maxDailyLossPct: 25, ...risk },
            startEquity: 10000, candles: k, marketMeta: {}, fundingVerlauf: [], fromTs: T0, toTs: T0 + k.length * iv, aktie: aktieKontext })
    }
    const an = { nurRegulaereSitzung: true }
    const gleicheTrades = (a, b) => a.trades.length === b.trades.length && a.trades.every((t, i) => t.entryTime === b.trades[i].entryTime && t.netPnl === b.trades[i].netPnl && t.qty === b.trades[i].qty)

    // 1h, Limit in der Kerze: die Kerze 09:00–10:00 New York enthält die Eröffnung und war bisher gesperrt
    const limit = await laufIv('1h', H, false, AKTIE, an)
    const neunUhr = limit.trades.filter((t) => nyTeile(t.entryTime).minuten === 9 * 60)
    ok(limit.trades.length > 5 && limit.trades.every((t) => kerzeBeruehrtRegulaer(t.entryTime, H)), `1h Limit: jede Auslösekerze berührt die reguläre Sitzung (${limit.trades.length} Trades)`)
    ok(neunUhr.length >= 1, `1h Limit: die Eröffnungskerze 09:00–10:00 ist handelbar (${neunUhr.length})`)
    const offen = await laufIv('1h', H, true, AKTIE, an)
    ok(offen.trades.length > 5 && offen.trades.every((t) => sitzungVon(t.entryTime) === 'regulaer') && offen.trades.length < limit.trades.length,
        '1h zur Eröffnung der Kerze: der Einstiegszeitpunkt selbst liegt in der Sitzung (09:00 bleibt gesperrt)')

    // 1d: nicht anwendbar — nichts gesperrt, und das Ergebnis meldet es
    const tagOhne = await laufIv('1d', 24 * H, true, AKTIE)
    const tagMit = await laufIv('1d', 24 * H, true, AKTIE, an)
    ok(tagOhne.trades.length > 60 && gleicheTrades(tagMit, tagOhne), `1d: der Schalter sperrt nichts mehr (${tagMit.trades.length} Trades wie ohne)`)
    ok(!tagMit.funnel.entrySkipped.ausserhalb_sitzung && tagMit.stats.aktien.nurRegulaer === true && tagMit.stats.aktien.nurRegulaerWirkt === false,
        '1d: gesetzt, aber ohne Wirkung — steht im Ergebnis')

    // 4h: Kerzen auf UTC; gesperrt wird, was die Sitzung nicht berührt, in Sommer- wie Winterzeit
    const vier = await laufIv('4h', 4 * H, false, AKTIE, an)
    ok(vier.trades.length > 5 && vier.trades.every((t) => kerzeBeruehrtRegulaer(t.entryTime, 4 * H)) && vier.funnel.entrySkipped.ausserhalb_sitzung > 5
        && vier.stats.aktien.nurRegulaerWirkt === true, `4h Limit: nur Kerzen, die die Sitzung berühren (${vier.trades.length} Trades, ${vier.funnel.entrySkipped.ausserhalb_sitzung} gesperrt)`)

    // Krypto: der Schalter ändert nichts, auf keiner Zeiteinheit
    for (const [tf, iv] of [['1h', H], ['4h', 4 * H], ['1d', 24 * H]]) {
        const a = await laufIv(tf, iv, false, null), b = await laufIv(tf, iv, false, null, an)
        ok(a.trades.length > 20 && gleicheTrades(a, b) && JSON.stringify(a.funnel) === JSON.stringify(b.funnel) && b.stats.aktien === null, `Coin ${tf}: mit Schalter bitgleich`)
    }
}

// Stichtag: Bitunix handelt erst seit 14.8.2026 rund um die Uhr
const alt = reihe(600).map((k) => ({ ...k, t: k.t - 40 * 24 * H }))
const frueh = await runBacktest({
    strategyId: 'aktien_test', strategie: manifest, symbol: 'TESTUSDT', timeframe: '1h', market: 'futures',
    risk: { minRR: 1, cooldownMinutes: 0, maintenanceMarginPct: 0.5 }, startEquity: 10000, candles: alt, marketMeta: {}, fundingVerlauf: [],
    fromTs: alt[0].t, toTs: alt.at(-1).t + H, aktie: AKTIE,
})
ok(frueh.stats.aktien.regime?.boerse === 'bitunix' && frueh.stats.aktien.regime.ganzDavor === false, 'Zeitraum über den Stichtag: Hinweis')

// Split 10:1 mitten im Zeitraum
const mitSprung = reihe(900, 450, 10)
const split = { t: T0 + 452 * H, faktor: 10, text: '10:1' }
const roh = await lauf(mitSprung, { ...AKTIE, splits: null, splitsGrund: 'quelleAus' })
ok(roh.stats.aktien.splitsBekannt === false && roh.stats.aktien.sprungVerdacht.length === 1 && roh.stats.aktien.splitsGrund === 'quelleAus', 'ohne Split-Angaben: Verdacht gemeldet, nichts umgerechnet')
const bereinigt = await lauf(mitSprung, { ...AKTIE, splits: [split] })
const s0 = bereinigt.stats.aktien.splits[0]
ok(s0?.angewendet && s0.bei === T0 + 450 * H && bereinigt.stats.aktien.sprungVerdacht.length === 0, 'Split gefunden und umgerechnet')
ok(mitSprung[0].o === 400, 'die übergebenen Kerzen bleiben unverändert')
const schlimmster = (e) => Math.min(...e.trades.map((t) => t.rMultiple))
ok(schlimmster(bereinigt) > -2 && bereinigt.trades.every((t) => Math.abs(t.entryPrice) < 60), `bereinigt: kein Trade durch den Sprung zerstört (schlimmster ${schlimmster(bereinigt).toFixed(2)} R), alle Kurse im neuen Massstab`)
ok(roh.trades.some((t) => t.entryPrice > 300) && roh.trades.some((t) => t.entryPrice < 60), 'unbereinigt: Kurse in zwei Massstäben — die Gegenprobe')

// Quartalszahlen: Termin mitten im Zeitraum (Kerze 500), einer davor ausserhalb
const TERMIN = T0 + 500 * H
const mitTerminen = { ...AKTIE, termine: { naechster: { zeit: T0 + 3000 * H, geschaetzt: false }, vergangene: [T0 - 2000 * H, TERMIN] }, termineGrund: null }
const zl = await lauf(kerzen, mitTerminen)
const zb = zl.stats.aktien.zahlen
ok(zb.bekannt && zb.termine.length === 1 && zb.termine[0] === TERMIN && zb.gemieden === false, 'Termin im Zeitraum erkannt')
const beruehrt = zl.trades.filter((t) => t.zahlen)
ok(beruehrt.length >= 4 && beruehrt.every((t) => t.zahlen === TERMIN && t.exitTime >= TERMIN - 24 * H && t.entryTime <= TERMIN + 24 * H), `Trades im Fenster markiert (${beruehrt.length})`)
ok(zb.bilanz.mit.trades === beruehrt.length && zb.bilanz.mit.trades + zb.bilanz.ohne.trades === zl.trades.length, 'Bilanz mit und ohne summiert auf alle Trades')
ok(zl.trades.length === aktie.trades.length, 'das Markieren ändert keinen Trade')
ok(zb.lueckeVorn === false, 'Termine reichen vor den Zeitraum zurück: keine Lücke')

const gemieden = await lauf(kerzen, mitTerminen, { meideZahlentermine: true })
ok(gemieden.funnel.entrySkipped.zahlentermin >= 4 && gemieden.stats.aktien.zahlen.gemieden === true, `Sperre lässt die Einstiege im Fenster aus (${gemieden.funnel.entrySkipped.zahlentermin})`)
ok(gemieden.trades.every((t) => t.entryTime < TERMIN - 24 * H || t.entryTime > TERMIN + 24 * H), 'kein Einstieg im Fenster')
ok(gemieden.setups.some((s) => s.rejectReason === 'zahlentermin'), 'Grund steht am Setup')

const unbekannt = await lauf(kerzen, { ...AKTIE, termine: null, termineGrund: 'quelleAus' }, { meideZahlentermine: true })
ok(unbekannt.stats.aktien.zahlen.bekannt === false && unbekannt.stats.aktien.zahlen.grund === 'quelleAus' && unbekannt.stats.aktien.zahlen.bilanz === null, 'Termine unbekannt: steht im Ergebnis')
ok(unbekannt.trades.length === aktie.trades.length && unbekannt.trades.every((t) => t.zahlen === undefined) && !unbekannt.funnel.entrySkipped.zahlentermin, 'unbekannt: nichts markiert, nichts gesperrt')

// Die Quelle nennt nur vier Quartale: ein langer Lauf reicht vor den ältesten bekannten Termin zurück
const lang = reihe(3700)
const spaet = await lauf(lang, { ...AKTIE, termine: { naechster: null, vergangene: [T0 + 3600 * H] }, termineGrund: null })
ok(spaet.stats.aktien.zahlen.lueckeVorn === true && spaet.stats.aktien.zahlen.bekanntAb > T0 + 1000 * H, 'Termine erst spät bekannt: Lücke vorn gemeldet')
ok(zl.stats.aktien.zahlen.bekanntAb < T0, 'Gegenprobe: im kurzen Lauf liegt der Beginn der Abdeckung vor dem Zeitraum')

const coinMitSperre = await lauf(kerzen, null, { meideZahlentermine: true })
ok(coinMitSperre.trades.length === coin.trades.length, 'Coin: die Zahlen-Sperre wirkt nicht')

// ── Funding über einen Split: Lauf auf rohen Kerzen + Split = Lauf auf vorab bereinigten Kerzen ──
{
    // Abrechnung alle 8 h zum Schlusskurs der Kerze — roh steht der Mark-Preis vor dem Sprung im alten Massstab.
    const verlaufAus = (ks) => ks.filter((k) => k.t % (8 * H) === 0).map((k) => ({ t: k.t, rate: 0.0002, markPrice: k.c }))
    const mitSplit = await lauf(mitSprung, { ...AKTIE, splits: [split] }, {}, { fundingVerlauf: verlaufAus(mitSprung) })
    const sauber = bereinigeSplits(mitSprung, [split]).kerzen
    const vorab = await lauf(sauber, AKTIE, {}, { fundingVerlauf: verlaufAus(sauber) })
    ok(mitSplit.trades.length === vorab.trades.length && mitSplit.trades.length > 60, 'gleiche Trades auf rohen Kerzen mit Split wie auf vorab bereinigten')
    ok(mitSplit.trades.some((t) => t.entryTime < T0 + 450 * H && t.funding !== 0), 'es gibt Trades vor dem Sprung, die Funding zahlen')
    ok(mitSplit.trades.every((t, i) => Math.abs(t.funding - vorab.trades[i].funding) < 1e-9 && Math.abs(t.netPnl - vorab.trades[i].netPnl) < 1e-9),
        'Funding und Netto je Trade gleich — die Mark-Preise vor dem Sprung sind umgerechnet')
    const ohneUmrechnung = mitSprung.filter((k) => k.t % (8 * H) === 0 && k.t < T0 + 450 * H).length
    ok(ohneUmrechnung > 20 && mitSprung[100].c / sauber[100].c > 9.9, 'Gegenprobe: der rohe Mark-Preis davor ist das Zehnfache — ohne Umrechnung wäre das Funding zehnmal zu hoch')
}

// ── Rutsch-Aufschlag ausserhalb der regulären Sitzung (Vorgabe aus) ──
{
    const SO = Date.UTC(2026, 10, 15, 13), DI = Date.UTC(2026, 10, 10, 16)   // Sonntag / Dienstag 11:00 New York
    const risk = { feeMakerBps: 2, feeTakerBps: 6, slippageBps: 2, slippageAusserhalbBps: 40 }
    const ka = kostenAus(risk, { aktie: true }), kc = kostenAus(risk)
    ok(ka.slippageAusserhalbBps === 40 && kc.slippageAusserhalbBps === 0 && kostenAus(risk, { aktie: false }).slippageAusserhalbBps === 0, 'kostenAus: der Aufschlag reist nur für Aktien mit')
    ok(rutschAufschlag(ka, SO) === 40 && rutschAufschlag(ka, DI) === 0 && rutschAufschlag(ka, 0) === 0 && rutschAufschlag(kc, SO) === 0 && rutschAufschlag({}, SO) === 0, 'Aufschlag nur ausserhalb der regulären Sitzung, nur mit Zeit, nur wenn gesetzt')
    ok(satzFuer(ka, MARKT, SO).slippageBps === 42 && satzFuer(ka, MARKT, DI).slippageBps === 2 && satzFuer(ka, MARKT).slippageBps === 2, 'Marktorder: 2 + 40 bp am Sonntag, 2 bp regulär und ohne Zeit')
    ok(satzFuer(ka, LIMIT, SO).slippageBps === 0 && satzFuer(ka, MARKT, SO).feeBps === 6, 'Limit rutscht nie; die Gebühr bleibt')
    ok(satzFuer(kc, MARKT, SO).slippageBps === 2, 'Coin: 2 bp, auch am Sonntag')
    const su = { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, entryTrigger: 'market' }
    const pSo = createPosition({ setup: su, qty: 1, entryPrice: 100, entryTime: SO, costs: ka })
    const pDi = createPosition({ setup: su, qty: 1, entryPrice: 100, entryTime: DI, costs: ka })
    ok(Math.abs(pSo.entryPrice - 100.42) < 1e-9 && Math.abs(pDi.entryPrice - 100.02) < 1e-9, 'Markt-Einstieg: am Sonntag 42 bp teurer, am Dienstag 2 bp')
    ok(Math.abs(closePosition(pDi, { price: 95, reason: 'sl', time: SO }, ka).exitPrice - 95 * (1 - 0.0042)) < 1e-9
        && Math.abs(closePosition(pDi, { price: 95, reason: 'sl', time: DI }, ka).exitPrice - 95 * (1 - 0.0002)) < 1e-9
        && closePosition(pDi, { price: 110, reason: 'tp', time: SO }, ka).exitPrice === 110, 'Stop am Sonntag rutscht 42 bp, am Dienstag 2 bp; das Ziel (Limit) gar nicht')
    // Positionsgrösse: der teurere Einstieg zählt zum Risiko am Stop
    const groesse = (extra) => evaluateRisk({ setup: { ...su, symbol: 'X', rr: 2 }, equity: 10000, now: SO + H, marketMeta: {},
        risk: { riskPerTradePct: 1, maxDailyLossPct: 50, maxConcurrentPositions: 5, maxNotionalUsdt: 1e9, leverage: 5, cooldownMinutes: 0, minRR: 1, ...risk }, ...extra }).size.qty
    const qCoin = groesse({}), qSo = groesse({ aktie: true, einstiegsZeit: SO }), qDi = groesse({ aktie: true, einstiegsZeit: DI })
    ok(qSo < qDi && qDi === qCoin && groesse({ aktie: false, einstiegsZeit: SO }) === qCoin, `Grösse: am Sonntag kleiner (${qSo.toFixed(3)} < ${qDi.toFixed(3)}), regulär und beim Coin unverändert`)

    const auf = await lauf(kerzen, AKTIE, { slippageAusserhalbBps: 40 })
    ok(aktie.stats.aktien.rutschAusserhalbBps === 0 && auf.stats.aktien.rutschAusserhalbBps === 40 && aktie.stats.aktien.dividendenGebucht === false, 'Ergebnis nennt den Aufschlag (Vorgabe 0) und dass Dividenden fehlen')
    ok(auf.trades.length === aktie.trades.length, 'der Aufschlag ändert die Zahl der Trades nicht')
    const paare = auf.trades.map((t, i) => [t, aktie.trades[i]])
    ok(paare.every(([a, b]) => a.entryTime === b.entryTime && (a.sitzung === 'regulaer'
        ? Math.abs(a.entryPrice - b.entryPrice) < 1e-9
        : Math.abs(a.entryPrice / b.entryPrice - 1.0042 / 1.0002) < 1e-9)), 'Markt-Einstiege ausserhalb der Sitzung 40 bp teurer, in der Sitzung gleich')
    const drinnen = paare.filter(([a]) => a.sitzung === 'regulaer' && (a.exitReason === 'tp' || sitzungVon(a.exitTime) === 'regulaer'))
    ok(drinnen.length > 3 && drinnen.every(([a, b]) => Math.abs(a.rMultiple - b.rMultiple) < 1e-9), `Trades ganz in der regulären Sitzung: R unverändert (${drinnen.length})`)
    const summe = (e) => e.trades.reduce((x, t) => x + t.rMultiple, 0)
    ok(summe(auf) < summe(aktie) - 1, `Summe R mit Aufschlag schlechter (${summe(auf).toFixed(1)} gegen ${summe(aktie).toFixed(1)})`)
    const coinAuf = await lauf(kerzen, null, { slippageAusserhalbBps: 40 })
    ok(coinAuf.trades.length === coin.trades.length && coinAuf.trades.every((t, i) => t.netPnl === coin.trades[i].netPnl && t.qty === coin.trades[i].qty && t.entryPrice === coin.trades[i].entryPrice),
        'Coin mit gesetztem Aufschlag: jeder Trade bitgleich')
}

console.log(`✓ Backtest Aktien: ${n} Prüfungen`)
