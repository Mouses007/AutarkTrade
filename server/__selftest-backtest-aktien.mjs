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
const lauf = (kerzen, aktie, risk = {}) => runBacktest({
    strategyId: 'aktien_test', strategie: manifest, symbol: 'TESTUSDT', timeframe: '1h', market: 'futures',
    risk: { riskPerTradePct: 1, maxNotionalUsdt: 1e6, leverage: 5, minRR: 1, maintenanceMarginPct: 0.5, cooldownMinutes: 0, maxDailyLossPct: 25, ...risk },
    startEquity: 10000, candles: kerzen, marketMeta: {}, fundingVerlauf: [], fromTs: T0, toTs: T0 + kerzen.length * H,
    aktie,
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

console.log(`✓ Backtest Aktien: ${n} Prüfungen`)
