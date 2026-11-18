/**
 * Selbsttest der Coin-Ansicht (Serverteil): `ansicht-kern.js` und die
 * Verdrahtung des Tagesverlaufs in `ansicht.js`.
 *
 * Ohne Netz: `fetch` und axios sind gesperrt, die Abrufe des Tagesverlaufs
 * sind eingespeist. Ohne Datenbank: der Kontext wird hier nur in seinen
 * reinen Teilen geprüft (`rangVerlauf`, `eigeneTrades`).
 *
 * Aufruf: node server/coin-radar/__selftest-ansicht.mjs
 */
import assert from 'node:assert/strict'
import axios from 'axios'

globalThis.fetch = async (url) => { throw new Error('Netz gesperrt (fetch): ' + url) }
axios.defaults.adapter = async (c) => { throw new Error('Netz gesperrt (axios): ' + c.url) }

const {
    spanne24h, tageKompakt, ersterHandelstag, rangVerlauf, eigeneTrades, VERLAUF_TAGE,
    tageAusMarketChart, berichtOhneFuture, CG_VERLAUF_TAGE,
} = await import('./ansicht-kern.js')
const { QuelleAus } = await import('../quellen/aus.js')
const { holeTagesverlauf } = await import('./ansicht.js')

let gut = 0
let schlecht = 0
async function pruefe(name, fn) {
    try { await fn(); gut++ } catch (e) { schlecht++; console.error(`  ✗ ${name}\n    ${e.message}`) }
}

const H = 3_600_000
const TAG = 24 * H
const JETZT = Date.UTC(2026, 10, 16, 12, 0, 0)
const MS = { '5m': 300_000, '15m': 900_000, '1h': H, '4h': 4 * H, '1d': TAG }
/** n geschlossene Kerzen bis `JETZT`, Kurs steigt je Kerze um `schritt`. */
function reihe(ze, n, start = 100, schritt = 1) {
    const ms = MS[ze]
    const ende = Math.floor(JETZT / ms) * ms
    return Array.from({ length: n }, (_, i) => {
        const o = start + i * schritt
        return { t: ende - (n - i) * ms, o, h: o + 2, l: o - 1, c: o + schritt }
    })
}

console.log('Coin-Ansicht: 24-h-Spanne, Tagesverlauf, Rang-Verlauf')

// ── 24-h-Spanne ─────────────────────────────────────────────────────────
await pruefe('Spanne aus den letzten 24 Stundenkerzen, laufender Kurs zählt mit', () => {
    const k = reihe('1h', 200)            // letzte Kerze: o=299, h=301, c=300
    const s = spanne24h({ '1h': k }, MS, 305, JETZT)
    assert.equal(s.zeiteinheit, '1h')
    assert.equal(s.hoch, 305)             // der laufende Kurs liegt über dem letzten Kerzenhoch
})

await pruefe('Tief und Veränderung stimmen mit dem Fensterbeginn', () => {
    const k = reihe('1h', 200)
    const s = spanne24h({ '1h': k }, MS, 300, JETZT)
    // Fenster = 24 Kerzen, die erste öffnet bei 100 + 176 = 276 (Tief 275).
    assert.equal(s.tief, 275)
    assert.ok(Math.abs(s.aenderungPct - (300 / 276 - 1) * 100) < 1e-9)
})

await pruefe('der Ticker-Wert der Veränderung hat Vorrang', () => {
    const s = spanne24h({ '1h': reihe('1h', 200) }, MS, 300, JETZT, -4.2)
    assert.equal(s.aenderungPct, -4.2)
})

await pruefe('feinste Zeiteinheit, die 24 h deckt — 200 × 5m sind keine 24 h', () => {
    const s = spanne24h({ '5m': reihe('5m', 200), '15m': reihe('15m', 200), '1h': reihe('1h', 200) }, MS, 300, JETZT)
    assert.equal(s.zeiteinheit, '15m')
})

await pruefe('frisch gelistet (zu wenige Kerzen) → null, keine erfundene Spanne', () => {
    assert.equal(spanne24h({ '1h': reihe('1h', 10) }, MS, 300, JETZT), null)
    assert.equal(spanne24h({}, MS, 300, JETZT), null)
    assert.equal(spanne24h({ '1d': reihe('1d', 200) }, MS, 300, JETZT), null)   // Tageskerzen sind zu grob
})

await pruefe('veraltete Kerzen (Lücke am Ende) → null', () => {
    const alt = reihe('1h', 200).map((k) => ({ ...k, t: k.t - 5 * H }))
    assert.equal(spanne24h({ '1h': alt }, MS, 300, JETZT), null)
})

await pruefe('ohne Kurs: Spanne ja, Veränderung unbekannt (nicht 0)', () => {
    const s = spanne24h({ '1h': reihe('1h', 200) }, MS, null, JETZT)
    assert.equal(s.hoch, 301)
    assert.equal(s.aenderungPct, null)
})

// ── Tageskerzen ─────────────────────────────────────────────────────────
await pruefe('tageKompakt: aufsteigend, ohne Doppelte, ohne kaputte Kerzen', () => {
    const r = tageKompakt([
        { t: 3 * TAG, h: 12, l: 9, c: 11 },
        { t: 1 * TAG, h: 11, l: 8, c: 10 },
        { t: 3 * TAG, h: 99, l: 1, c: 50 },     // doppelt
        { t: 2 * TAG, h: 11, l: 9, c: 0 },      // kein Schluss
        { t: 4 * TAG, h: NaN, l: 0, c: 12 },    // Hoch/Tief unlesbar → Schluss
    ])
    assert.deepEqual(r, [[TAG, 11, 8, 10], [3 * TAG, 12, 9, 11], [4 * TAG, 12, 12, 12]])
})

await pruefe('ersterHandelstag: nur wenn die Reihe das Fenster nicht füllt', () => {
    const voll = [[JETZT - VERLAUF_TAGE * TAG + TAG, 1, 1, 1]]
    const jung = [[JETZT - 40 * TAG, 1, 1, 1]]
    assert.equal(ersterHandelstag(voll, JETZT), null)
    assert.equal(ersterHandelstag(jung, JETZT), JETZT - 40 * TAG)
    assert.equal(ersterHandelstag([], JETZT), null)
})

// ── Tagesverlauf: Verdrahtung mit eingespeisten Quellen ─────────────────
const tage = (n, start) => Array.from({ length: n }, (_, i) => ({ t: JETZT - (n - i) * TAG, o: start, h: start + 2, l: start - 1, c: start + i }))
const ohneCache = async (_key, _ttl, holen) => ({ ...(await holen()), stand: JETZT, veraltet: false, _cache: 'MISS' })

await pruefe('Paar bei der Marktdatenquelle: Kerzen von dort, BTC als Vergleich', async () => {
    const abrufe = []
    const r = await holeTagesverlauf('ETHUSDT', {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map([['ETHUSDT', {}]]),
        testbar: async () => new Set(['ETHUSDT', 'BTCUSDT']),
        marktdatenTage: async (s) => { abrufe.push(s); return tage(30, s === 'BTCUSDT' ? 60000 : 3000) },
        bitunixTage: async () => { throw new Error('Bitunix darf hier nicht gefragt werden') },
        anbieter: async () => ({ id: 'binance', name: 'Binance' }),
    })
    assert.equal(r.gefunden, true)
    assert.equal(r.quelle, 'marktdaten')
    assert.equal(r.quelleName, 'Binance')
    assert.equal(r.kerzen.length, 30)
    assert.deepEqual(r.kerzen[0], [JETZT - 30 * TAG, 3002, 2999, 3000])
    assert.equal(r.btc.length, 30)
    assert.deepEqual(r.btc[0], [JETZT - 30 * TAG, 60000])
    assert.equal(r.ersterTag, JETZT - 30 * TAG)
    assert.deepEqual(abrufe, ['ETHUSDT', 'BTCUSDT'])
})

await pruefe('Paar nur auf Bitunix: Kerzen von Bitunix, Quelle ausgewiesen', async () => {
    const r = await holeTagesverlauf('CASHCATUSDT', {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map([['CASHCATUSDT', {}]]),
        testbar: async () => new Set(['BTCUSDT']),
        marktdatenTage: async (s) => { assert.equal(s, 'BTCUSDT'); return tage(10, 60000) },
        bitunixTage: async (s) => { assert.equal(s, 'CASHCATUSDT'); return tage(20, 1) },
    })
    assert.equal(r.quelle, 'bitunix')
    assert.equal(r.quelleName, 'Bitunix')
    assert.equal(r.kerzen.length, 20)
    assert.equal(r.btc.length, 10)
})

await pruefe('BTC selbst bekommt keine Vergleichslinie; BTC-Ausfall bricht nichts ab', async () => {
    const basis = {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map(), testbar: async () => new Set(['BTCUSDT', 'ETHUSDT']),
        anbieter: async () => ({ id: 'binance', name: 'Binance' }),
    }
    const btc = await holeTagesverlauf('BTCUSDT', { ...basis, marktdatenTage: async () => tage(5, 60000) })
    assert.equal(btc.btc, null)
    const eth = await holeTagesverlauf('ETHUSDT', {
        ...basis, marktdatenTage: async (s) => { if (s === 'BTCUSDT') throw new Error('weg'); return tage(5, 3000) },
    })
    assert.equal(eth.kerzen.length, 5)
    assert.equal(eth.btc, null)
})

await pruefe('unbekanntes Symbol (auch bei CoinGecko) → gefunden: false, kein Börsenabruf', async () => {
    const r = await holeTagesverlauf('GIBTSNICHTUSDT', {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map(), testbar: async () => new Set(['BTCUSDT']),
        marktdatenTage: async () => { throw new Error('darf nicht') }, bitunixTage: async () => { throw new Error('darf nicht') },
        coinInfo: async () => null,
        cgMarketChart: async () => { throw new Error('darf nicht') },
    })
    assert.deepEqual(r, { gefunden: false, symbol: 'GIBTSNICHTUSDT' })
})

// ── Ohne Future: CoinGecko-Tagesreihe ───────────────────────────────────
const MITTERNACHT = Math.floor(JETZT / TAG) * TAG
await pruefe('tageAusMarketChart: Mitternachtskurs = Schluss des Vortags, laufender Punkt fällt weg', () => {
    const j = { prices: [
        [MITTERNACHT - 2 * TAG, 0.02],
        [MITTERNACHT - TAG + 60_000, 0.021],     // ein paar Sekunden nach Mitternacht
        [MITTERNACHT, 0.019],
        [MITTERNACHT + 5 * 3_600_000, 0.0195],   // laufender Kurs mitten im Tag
        [MITTERNACHT - TAG, 0.0211],             // doppelt für denselben Tag: der spätere in der Liste gilt
        ['x', 1], [MITTERNACHT - 3 * TAG, 0], [MITTERNACHT - 4 * TAG, null],
    ] }
    const r = tageAusMarketChart(j)
    assert.deepEqual(r, [
        [MITTERNACHT - 3 * TAG, 0.02, 0.02, 0.02],
        [MITTERNACHT - 2 * TAG, 0.0211, 0.0211, 0.0211],
        [MITTERNACHT - TAG, 0.019, 0.019, 0.019],
    ])
    assert.deepEqual(tageAusMarketChart(null), [])
    assert.deepEqual(tageAusMarketChart({ prices: 'kaputt' }), [])
    assert.equal(CG_VERLAUF_TAGE, 365)
})

const HONEY_INFO = {
    id: 'hivemapper', name: 'Hivemapper', symbol: 'HONEY',
    markt: { stand: JETZT - 60_000, preisUsd: 0.0123, hoch24hUsd: 0.013, tief24hUsd: 0.012, aenderung24hPct: -2.5,
        aenderung7dPct: -8, aenderung30dPct: null, aenderung1jPct: -84 },
}
await pruefe('berichtOhneFuture: unbekanntes Perp, CoinGecko kennt genau dieses Kürzel', () => {
    const b = berichtOhneFuture({ gefunden: false, fehler: 'unbekannt', symbol: 'HONEYUSDT', eingabe: 'honey', vorschlaege: ['HONEYXUSDT'] }, HONEY_INFO, JETZT)
    assert.equal(b.gefunden, true)
    assert.equal(b.ohneFuture, true)
    assert.equal(b.symbol, 'HONEYUSDT')
    assert.equal(b.quelle, 'coingecko')
    assert.equal(b.preis, 0.0123)
    assert.deepEqual(b.tag, { hoch: 0.013, tief: 0.012, aenderungPct: -2.5 })
    assert.deepEqual(b.aenderungen, { d7: -8, d30: null, j1: -84 })
    assert.equal(b.gemessenAm, JETZT - 60_000)
    assert.equal(b.umsatz24h, null)
    assert.equal(b.boersen, null)
    assert.deepEqual(b.vorschlaege, ['HONEYXUSDT'], 'Vorschläge ähnlicher Futures bleiben')
})
await pruefe('berichtOhneFuture: nichts geraten', () => {
    const unbekannt = { gefunden: false, fehler: 'unbekannt', symbol: 'HONEYUSDT' }
    assert.equal(berichtOhneFuture(unbekannt, null), null, 'CoinGecko kennt es nicht')
    assert.equal(berichtOhneFuture(unbekannt, { ...HONEY_INFO, symbol: 'HONEYX' }), null, 'anderes Kürzel')
    assert.equal(berichtOhneFuture({ gefunden: false, fehler: 'zu_lang', symbol: 'X' }, HONEY_INFO), null, 'Eingabefehler')
    assert.equal(berichtOhneFuture({ gefunden: true, symbol: 'HONEYUSDT' }, HONEY_INFO), null, 'Perp gefunden')
    const ohnePreis = berichtOhneFuture(unbekannt, { ...HONEY_INFO, markt: {} }, JETZT)
    assert.equal(ohnePreis.preis, null)
    assert.equal(ohnePreis.tag, null)
    assert.equal(ohnePreis.gemessenAm, JETZT)
    const kaputteSpanne = berichtOhneFuture(unbekannt, { ...HONEY_INFO, markt: { ...HONEY_INFO.markt, hoch24hUsd: 0.01 } }, JETZT)
    assert.equal(kaputteSpanne.tag.hoch, null, 'Hoch unter Tief ist keine Spanne')
})

await pruefe('Tagesverlauf ohne Future: CoinGecko, nurSchluss, BTC-Linie auf denselben Tagen', async () => {
    const r = await holeTagesverlauf('HONEYUSDT', {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map(), testbar: async () => new Set(['BTCUSDT']),
        marktdatenTage: async (s) => { assert.equal(s, 'BTCUSDT'); return tage(5, 60000) },
        bitunixTage: async () => { throw new Error('darf nicht') },
        coinInfo: async () => HONEY_INFO,
        cgMarketChart: async (id) => { assert.equal(id, 'hivemapper'); return { prices: [[MITTERNACHT - TAG, 0.02], [MITTERNACHT, 0.019], [JETZT, 0.0123]] } },
    })
    assert.equal(r.gefunden, true)
    assert.equal(r.quelle, 'coingecko')
    assert.equal(r.quelleName, 'CoinGecko')
    assert.equal(r.nurSchluss, true)
    assert.equal(r.ersterTag, null)
    assert.equal(r.tage, 365)
    assert.deepEqual(r.kerzen.map((k) => k[0]), [MITTERNACHT - 2 * TAG, MITTERNACHT - TAG])
    assert.equal(r.btc.length, 5)
})

await pruefe('Tagesverlauf ohne Future: CoinGecko aus → QuelleAus geht an die Route', async () => {
    await assert.rejects(() => holeTagesverlauf('HONEYUSDT', {
        jetzt: JETZT, ausCache: ohneCache,
        handelbar: async () => new Map(), testbar: async () => new Set(['BTCUSDT']),
        coinInfo: async () => { throw new QuelleAus('CoinGecko', 'schluesselFehlt') },
    }), (e) => e.code === 'quelleAus' && e.grund === 'schluesselFehlt')
})

// ── Rang-Verlauf ────────────────────────────────────────────────────────
await pruefe('rangVerlauf: chronologisch, Hürde und Fehlen sind eigene Zustände', () => {
    const laeufe = [{ id: 3, zeit: 300, gesamt: 110 }, { id: 1, zeit: 100, gesamt: 100 }, { id: 2, zeit: 200, gesamt: 0 }, { id: 4, zeit: 400, gesamt: 120 }]
    const zeilen = [
        { laufId: 1, rang: 4, note: 71, status: 'bewertet' },
        { laufId: 2, rang: 0, note: 0, status: 'huerde', huerdeGrund: 'umsatz_zu_klein' },
        { laufId: 4, rang: 14, note: 55, status: 'bewertet' },
    ]
    const r = rangVerlauf(laeufe, zeilen)
    assert.equal(r.laeufe, 4)
    assert.equal(r.bewertet, 2)
    assert.equal(r.top10, 1)
    assert.deepEqual(r.punkte.map((p) => p.status), ['bewertet', 'huerde', 'fehlt', 'bewertet'])
    assert.deepEqual(r.punkte.map((p) => p.rang), [4, null, null, 14])
    assert.equal(r.punkte[1].note, null)                 // eine Hürden-Zeile trägt keine Note, auch nicht 0
    assert.equal(r.punkte[1].huerdeGrund, 'umsatz_zu_klein')
    assert.equal(r.punkte[1].gesamt, null)
    assert.deepEqual({ rang: r.letzter.rang, gesamt: r.letzter.gesamt }, { rang: 14, gesamt: 120 })
})

await pruefe('rangVerlauf ohne Läufe', () => {
    assert.deepEqual(rangVerlauf([], []), { laeufe: 0, bewertet: 0, top10: 0, punkte: [], letzter: null })
})

// ── Eigene Trades ───────────────────────────────────────────────────────
await pruefe('eigeneTrades: offene zählen, tragen aber kein Ergebnis', () => {
    const r = eigeneTrades([
        { einstieg: { t: 10 }, ausstieg: { t: 20 }, netto: 12.5 },
        { einstieg: { t: 30 }, ausstieg: { t: 40 }, netto: -4.5 },
        { einstieg: { t: 50 }, ausstieg: null, netto: 999 },
    ])
    assert.deepEqual(r, { anzahl: 3, geschlossen: 2, netto: 8, letzter: 50 })
    assert.deepEqual(eigeneTrades([]), { anzahl: 0, geschlossen: 0, netto: null, letzter: null })
})

console.log(`  ${gut} bestanden, ${schlecht} fehlgeschlagen`)
if (schlecht) process.exit(1)
// Offene Zeitgeber der eingebundenen Module (Zwischenspeicher) halten den Prozess sonst wach.
process.exit(0)
