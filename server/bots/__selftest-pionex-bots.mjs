/**
 * Selbsttest: Bot-Seite — Wissen über die Pionex-Bot-Typen und die
 * Normalisierung der Bot-Liste, gegen die echte Feldstruktur vom 11.11.2026
 * (`server/fixtures/pionex-bot-orders.json`: Kennungen ersetzt, Beträge
 * skaliert, Preise/Grids/Zähler echt).
 *
 * Aufruf: node server/bots/__selftest-pionex-bots.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TYPEN, typVon, zyklusGebuehr, wissenAlsText, GEBUEHREN } from './pionex-wissen.js'
import { normalisiereBot, gridAbstand, zahl, holeAlleSeiten, liqRisiko } from './pionex-bots.js'
import { kennzahlen } from './kennzahlen.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-6) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const [rohLauf, rohSui, rohNeutral] = fix.data.results

console.log('Wissen über die Bot-Typen')
for (const [id, t] of Object.entries(TYPEN)) {
    p(`${id}: Name, Funktion und Quelle`, t.name && t.funktion && t.gutBei && t.schlechtBei && t.quellen?.length > 0)
    p(`${id}: Gebührenmodell bekannt`, ['spot', 'futures', 'gewinnAnteil'].includes(t.gebuehren))
    if (t.api?.lesen) p(`${id}: lesbarer Typ nennt buOrderType`, !!t.api.buOrderType)
}
p('typVon: Coin-M', typVon('futures_grid', 'FUTURE_GRID_COIN_MARGINED') === 'coinm_grid')
p('typVon: Futures-Grid ohne cateType', typVon('futures_grid', null) === 'futures_grid')
p('typVon: Leveraged Grid', typVon('futures_grid', 'LEVERAGE_GRID') === 'leveraged_grid')
p('typVon: Cross-Margin', typVon('future_hedge_grid') === 'cross_margin_grid')
p('typVon: Spot-Grid', typVon('spot_grid') === 'spot_grid')
p('typVon: Unbekanntes → null', typVon('irgendwas') === null)
for (const id of ['futures_grid', 'coinm_grid', 'spot_grid', 'leveraged_grid', 'cross_margin_grid', 'smart_copy']) {
    const api = TYPEN[id].api
    p(`typVon findet ${id} über seine eigenen API-Angaben`, typVon(api.buOrderType, api.cateType) === id)
}
p('Zyklusgebühr Futures = 2 × Maker', nahe(zyklusGebuehr('futures_grid'), 2 * GEBUEHREN.futures.maker))
p('Zyklusgebühr Spot = 2 × 0,05 %', nahe(zyklusGebuehr('spot_grid'), 0.001))
p('Gewinnanteil-Modell hat keine Zyklusgebühr', zyklusGebuehr('leveraged_grid') === null)
const text = wissenAlsText('coinm_grid')
p('Prompt-Text nennt Typ, Rat und Gebühr', text.includes('Coin-M') && text.includes('Was Pionex rät') && text.includes('0.04 %'))

console.log('Datenvertrag: Felder, die die Bot-Seite liest')
const FELDER = ['top', 'bottom', 'row', 'gridType', 'trend', 'leverage', 'quoteInvestment', 'initQuoteInvestment', 'marginBalance',
    'extraMargin', 'gridProfit', 'gridProfit24h', 'trx24h', 'exchangeOrderPairedCount', 'totalRealizedProfit', 'totalFee',
    'totalFundingFee', 'position', 'positionOpenPrice', 'liquidationPrice', 'estimateLiquidationPriceUp',
    'estimateLiquidationPriceDown', 'riskStatus', 'reasonBy', 'status', 'condition', 'lossStopType', 'lossStop',
    'profitStopType', 'profitStop', 'movingIndicatorType', 'perVolume', 'cateType', 'investCoin', 'uiExtraData']
for (const roh of fix.data.results) {
    const fehlt = FELDER.filter((f) => !(f in roh.buOrderData))
    p(`${roh.buOrderId}: alle gelesenen Felder vorhanden`, fehlt.length === 0, fehlt.join(', '))
}

console.log('Laufender Coin-M-Bot (SOL, invers)')
const lauf = normalisiereBot(rohLauf)
p('Typ coinm_grid', lauf.typ === 'coinm_grid')
p('Coin SOL, Marge in SOL', lauf.coin === 'SOL' && lauf.marginCoin === 'SOL' && lauf.coinM)
p('trend short auf USDT-Seite = LONG der Coin', lauf.richtung === 'LONG')
p('läuft', lauf.laufend === true && lauf.status === 'running')
p('Untergrenze = 1/top ≈ 95 USD', nahe(lauf.grid.unten, 1 / 0.0105263))
p('Obergrenze = 1/bottom = 200 USD', nahe(lauf.grid.oben, 200))
p('320 Grids, arithmetisch', lauf.grid.anzahl === 320 && lauf.grid.art === 'arithmetic')
p('Einstieg in USD (≈ 97,24)', nahe(lauf.position.einstieg, 1 / 0.010283693956167))
p('Liquidation „up" der USDT-Seite = unter dem Coin-Kurs (≈ 70,92)', nahe(lauf.liquidation.unten, 1 / 0.0141000087195626))
p('liquidationPrice 0 = unbekannt, nicht 0', lauf.liquidation.preis === null)
p('Zähler bleiben echt (2356 Zyklen, 0 Trades in 24 h)', lauf.ergebnis.zyklen === 2356 && lauf.ergebnis.trades24h === 0)
p('kein Trigger, kein Trailing', lauf.trigger === null && lauf.trailing === null)
p('Stop-Loss ohne Wert = null', lauf.stops.stopLoss === null && lauf.stops.takeProfit === null)
p('Netto je Zyklus = Abstand − 2 × Futures-Maker', nahe(lauf.grid.nettoJeZyklus, lauf.grid.abstand.mitte - 0.0004))
// Inverse arithmetische Grids: Schritt in Coin je USDT, relativ am USD-Unterende kleiner
const schrittInv = (0.0105263 - 0.005) / 320
p('Coin-M: Abstand unten (USD 95) ≈ Schritt / 0.0105263 ≈ 0,156 %', nahe(lauf.grid.abstand.unten, schrittInv / (0.0105263 - schrittInv), 1e-9))
p('Coin-M: Abstand oben (USD 200) ≈ Schritt / 0.005 ≈ 0,33 %', nahe(lauf.grid.abstand.oben, schrittInv / 0.005, 1e-9))
p('Coin-M: unten dichter als oben', lauf.grid.abstand.unten < lauf.grid.abstand.oben)

console.log('Beendeter linearer Bot (SUI, liquidiert)')
const sui = normalisiereBot(rohSui)
p('Typ futures_grid, Coin SUI, Marge USDT', sui.typ === 'futures_grid' && sui.coin === 'SUI' && sui.marginCoin === 'USDT' && !sui.coinM)
p('LONG, Hebel 50', sui.richtung === 'LONG' && sui.hebel === 50)
p('Band 0,65–1,3066 direkt (nicht invers)', nahe(sui.grid.unten, 0.65) && nahe(sui.grid.oben, 1.3066))
p('beendet durch Liquidation', sui.laufend === false && sui.endGrund === 'force_liquidation')
p('Schlusspreis gelesen', nahe(sui.position.schlussPreis, 1.0397))

console.log('Beendeter Coin-M-Bot neutral')
const neutral = normalisiereBot(rohNeutral)
p('no_trend = NEUTRAL', neutral.richtung === 'NEUTRAL')
p('Untergrenze < Obergrenze nach Umrechnung', neutral.grid.unten < neutral.grid.oben)

console.log('Liquidationsseite aus dem Feld (Audit FUN-01)')
const shortRoh = { ...rohSui, buOrderData: { ...rohSui.buOrderData, trend: 'short', status: 'running', estimateLiquidationPriceUp: '190', estimateLiquidationPriceDown: '0', liquidationPrice: '0' } }
const kurzBot = { ...normalisiereBot(shortRoh), kurs: 150 }
p('USDT-M Short: „Up" = oben, unten leer', kurzBot.liquidation.oben === 190 && kurzBot.liquidation.unten === null)
const kk = kennzahlen(kurzBot, { kurs: 150 })
p('Short hat jetzt einen Liquidationsabstand (oben, 26,7 %)', kk.liquidation?.seite === 'oben' && nahe(kk.liquidation.abstand, 40 / 150))
p('linearer Long: „Down" = unten', normalisiereBot({ ...rohSui, buOrderData: { ...rohSui.buOrderData, estimateLiquidationPriceUp: '0', estimateLiquidationPriceDown: '0.9' } }).liquidation.unten === 0.9)
p('Coin-M Long: „Up" des Instruments = unten in USD (wie bisher)', nahe(lauf.liquidation.unten, 1 / 0.0141000087195626) && lauf.liquidation.oben === null)
p('liqRisiko: Long unten, Short oben, Neutral die nähere Seite', liqRisiko('LONG', { unten: 70, oben: 120 }) === 70 && liqRisiko('SHORT', { unten: 70, oben: 120 }) === 120 && liqRisiko('NEUTRAL', { unten: 70, oben: 120 }, 110) === 120)
p('liqRisiko: nur Einzelpreis → Einzelpreis', liqRisiko('SHORT', { preis: 5 }) === 5 && liqRisiko('LONG', null) === null)
p('Einsatz-Basis: Coin-M in der Coin, linear USDT-Investment (Audit FUN-09)', lauf.einsatz.basis === lauf.einsatz.aktuell && sui.einsatz.basis === sui.einsatz.usdt)

console.log('Hilfsfunktionen')
p('zahl: leer/null → null, "0" → 0', zahl('') === null && zahl(null) === null && zahl('0') === 0 && zahl('x') === null)
const ar = gridAbstand(100, 200, 10, 'arithmetic')
p('arithmetisch: unten 10 %, oben 10/190', nahe(ar.unten, 0.1) && nahe(ar.oben, 10 / 190))
const ge = gridAbstand(100, 200, 10, 'geometric')
p('geometrisch: überall 2^(1/10) − 1', nahe(ge.unten, Math.pow(2, 0.1) - 1) && ge.unten === ge.oben)
p('ungültiges Band → null', gridAbstand(200, 100, 10, 'arithmetic') === null && gridAbstand(100, 200, 0, 'x') === null)
p('ohne buOrderId → null', normalisiereBot({ buOrderData: {} }) === null)

let aufrufe = 0
const seiten = [{ result: true, data: { results: [{ buOrderId: 'a' }], nextPageToken: 't2' } }, { result: true, data: { results: [{ buOrderId: 'b' }] } }]
const alle = await holeAlleSeiten(async (opt) => { aufrufe++; return seiten[opt.pageToken ? 1 : 0] }, 'finished')
p('Blättern folgt nextPageToken', alle.length === 2 && aufrufe === 2)
let geworfen = false
try { await holeAlleSeiten(async () => ({ result: false, message: 'APIKEY_EXPIRED' }), 'running') } catch (e) { geworfen = /EXPIRED/.test(e.message) }
p('Ablehnung von Pionex wird Fehler, keine leere Liste', geworfen)

console.log('Echter XRP-Bot 15.11.2026: nach Erhöhen, Stops und Reduzieren')
{
    const x = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-xrp-2026-11-15.json'), 'utf8'))
    const b = normalisiereBot({ ...rohSui, buOrderType: 'futures_grid', base: 'XRP.PERP', quote: 'USDT', status: 'running', closeTime: 0, buOrderData: x.buOrderData })
    p('lineares USDT-Grid, läuft', b && !b.coinM && b.laufend && b.marginCoin === 'USDT', JSON.stringify({ typ: b?.typ, coinM: b?.coinM, mc: b?.marginCoin }))
    p('Einsatz = heutige Investition 15.36, nicht der Startwert 9.2', b.einsatz.basis === 15.36)
    p('Stop-Loss 0.6 und Take-Profit 5 erkannt, obwohl …Enabled false ist', b.stops.stopLoss?.wert === 0.6 && b.stops.takeProfit?.wert === 5 && /price/.test(b.stops.stopLoss.art))
    const k = kennzahlen(b, { kurs: 0.959 })
    // Pionex zeigte −0.0596 (was im Bot steckt); dazu 0.0007 schon ausgezahlter Gewinn (`profitExited`)
    p('Gewinn bei Kurs 0.959 = −0.0589 (Pionex −0.0596 + ausgetreten 0.0007), statt +6.17', Math.abs(k.gewinn.gesamt - (-0.0596 + 0.00071597)) < 0.0002 && b.ergebnis.ausgetreten === 0.00071597, String(k.gewinn?.gesamt))
    p('kein Hinweis «Hebel ohne Stop-Loss» mehr', !k.hinweise.includes('ohneStop'))
    const ohne = normalisiereBot({ ...rohSui, buOrderType: 'futures_grid', base: 'XRP.PERP', quote: 'USDT', status: 'running', closeTime: 0, buOrderData: { ...x.buOrderData, lossStop: '0', profitStop: null } })
    p('Stop 0 oder leer = keiner', ohne.stops.stopLoss === null && ohne.stops.takeProfit === null)
}

console.log('Echter XRP-Spot-Grid 15.11.2026')
{
    const x = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-xrp-spot-2026-11-15.json'), 'utf8'))
    const b = normalisiereBot({ buOrderId: 'spot-1', buOrderType: 'spot_grid', base: 'XRP', quote: 'USDT', status: 'running', createTime: 1794779644000, closeTime: 0, buOrderData: x.buOrderData })
    p('Spot-Grid erkannt, Marge in USDT, kein Coin-M', b?.typ === 'spot_grid' && b.marginCoin === 'USDT' && !b.coinM, JSON.stringify({ typ: b?.typ, mc: b?.marginCoin }))
    p('Einsatz = Einzahlung 10, nicht 9.597 (ohne Gebührenreserve)', b.einsatz.basis === 10)
    p('Position = gehaltene Coins 6.05697 zum Durchschnitt 0.9671', b.position.menge === 6.05697 && Math.abs(b.position.einstieg - 0.96708354) < 1e-6)
    p('Obergrenze 1.205 (Pionex zeigt gekürzt 1,2)', b.grid.oben === 1.205 && b.grid.unten === 0.788)
    const k = kennzahlen(b, { kurs: 0.9666 })
    p('Gewinn −0.00293 wie bei Pionex', Math.abs(k.gewinn.gesamt - (-0.00293)) < 0.00002, String(k.gewinn?.gesamt))
    p('Spot ohne Kurs: Gewinn unbekannt, nicht 0', kennzahlen(b, {}).gewinn.gesamt === null)
    p('Spot: kein Hinweis «Hebel ohne Stop-Loss»', !k.hinweise.includes('ohneStop'))
}

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
