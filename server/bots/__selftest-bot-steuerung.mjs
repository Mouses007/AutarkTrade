/**
 * Selbsttest: Bot-Steuerung (server/bots/steuerung.js, einwilligung.js) — ohne
 * Netz. Prüft die Anfragen an Pionex gegen die Doku-Formate (11.11.2026), die
 * Coin-M-Umrechnung und die Schranken vor dem Senden.
 *
 * Aufruf: node server/bots/__selftest-bot-steuerung.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalisiereBot } from './pionex-bots.js'
import { baueAktion, instrumentPreis, stellenVon, liqAusPruefung, pruefungBestanden, einstellungVon, AKTIONEN, pruefGrund, rundeEinsatzAuf, sucheMindestEinsatz, minAusPruefung, SPOT_AKTIONEN, reduzierAusPruefung } from './steuerung.js'
import { planBot } from './planer.js'
import { FASSUNG, fassungHash, zustimmungGueltig, hakenGueltig, hakenText, einwilligungsText, warnung, hakenHash } from './einwilligung.js'

let ok = 0, fehl = 0
const p = (name, bed, zusatz = '') => {
    if (bed) { ok++; console.log(`  ✓ ${name}`) }
    else { fehl++; console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nahe = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

const hier = path.dirname(fileURLToPath(import.meta.url))
const fix = JSON.parse(readFileSync(path.join(hier, '..', 'fixtures', 'pionex-bot-orders.json'), 'utf8'))
const coinm = { ...normalisiereBot(fix.data.results[0]), kurs: 83.035 }
const linear = { ...normalisiereBot({ ...fix.data.results[1], buOrderData: { ...fix.data.results[1].buOrderData, status: 'running' } }), kurs: 1.05 }

console.log('Preise ins Instrument')
p('Stellen aus den API-Preisen', stellenVon('0.0105263', '0.005') === 7 && stellenVon('1.3066', '0.65') === 4)
p('Coin-M: 60 USD → 1/60 auf 7 Stellen', instrumentPreis(coinm, 60) === '0.0166667')
p('linear: Preis bleibt, auf 4 Stellen', instrumentPreis(linear, 1.123456) === '1.1235')
p('ungültig → null', instrumentPreis(coinm, 0) === null)
p('Präzision aus der Pionex-Tabelle schlägt den Rückfall (Coin-M BTC, 11 Stellen: 95 000 bleibt 95 000)', instrumentPreis({ ...coinm, roh: { top: '0.0000125', bottom: '0.00001' } }, 95000, 11) === (1 / 95000).toFixed(11).replace(/0+$/, ''))
p('Rückfall bei ganzzahligem Band: 6 signifikante Stellen statt 8 Nachkommastellen', instrumentPreis({ ...linear, roh: { top: '160', bottom: '120' } }, 141.123456789) === '141.123')
const rund = baueAktion({ ...coinm, roh: { ...coinm.roh, top: '0.0000125', bottom: '0.00001' }, grid: { ...coinm.grid } }, 'band', { unten: 95000, oben: 99000, anzahl: 100 }, { kurs: 97000 })
p('Rückfall mit 7 Stellen bei Coin-M BTC: „nachher" zeigt den gesendeten Wert und warnt', rund.warnungen.includes('gerundet') && Math.abs(rund.nachher.unten - 95000) > 100)
console.log('Strenge Zahlen (Audit SEC-04)')
p('„0x10" und „1e3" werden abgewiesen', baueAktion(coinm, 'margeDazu', { betrag: '0x10' }).fehler === 'betrag' && baueAktion(coinm, 'margeDazu', { betrag: '1e3' }).fehler === 'betrag')
p('„1,5" und „1.5" gehen', baueAktion(coinm, 'margeDazu', { betrag: '1,5' }).senden.body.amount === 1.5 && baueAktion(coinm, 'margeDazu', { betrag: '1.5' }).senden.body.amount === 1.5)
p('Betrag über dem Einsatz: Warnung', baueAktion(coinm, 'investieren', { betrag: 50 }).warnungen.includes('grosserBetrag'))
p('Betrag bis zum Dreifachen des Einsatzes: keine Tippfehler-Warnung', !baueAktion(coinm, 'investieren', { betrag: 2 }).warnungen.includes('grosserBetrag') && !baueAktion(coinm, 'margeDazu', { betrag: 2 }).warnungen.includes('grosserBetrag'))
p('Marge abziehen über der Extra-Marge → zuViel', baueAktion(coinm, 'margeWeg', { betrag: 99 }).fehler === 'zuViel')
p('Band nach unten verlängert: Warnung „Liquidation näher"', baueAktion(coinm, 'band', { unten: 60, oben: 150 }).warnungen.includes('liqNaeherBand'))
p('Neuer Bot ohne Kurs → kurs (Audit FUN-07)', baueAktion({ ...coinm, kurs: null, laufend: false }, 'starten', {}).fehler === 'kurs')

console.log('Band ändern (adjustParams, keepInvestment)')
const band = baueAktion(coinm, 'band', { unten: 60, oben: 150, anzahl: 150 })
p('Prüfung adjustParamsCheck, Senden adjustParams, gleicher Körper', band.pruefen.pfad.endsWith('/futuresGrid/adjustParamsCheck') && band.senden.pfad.endsWith('/futuresGrid/adjustParams') && band.pruefen.body === band.senden.body)
const bb = band.senden.body
p('Felder nach Doku', bb.buOrderId === coinm.id && bb.type === 'adjust_params' && bb.extraMargin === false && bb.keepInvestment === true && bb.row === 150)
p('Coin-M: top = 1/Untergrenze, bottom = 1/Obergrenze', bb.top === '0.0166667' && bb.bottom === '0.0066667')
p('openPrice = 1/Kurs (Zahl)', nahe(bb.openPrice, 1 / 83.035, 1e-6) && typeof bb.openPrice === 'number')
p('Warnung Marktpreis', band.warnungen.includes('marktpreis'))
p('Band ausserhalb des Kurses gewarnt', baueAktion(coinm, 'band', { unten: 90, oben: 150 }).warnungen.includes('kursAusserhalb'))
p('Grids > 500 (API-Grenze) → anzahl', baueAktion(coinm, 'band', { anzahl: 600 }).fehler === 'anzahl')
p('oben ≤ unten → band', baueAktion(coinm, 'band', { unten: 150, oben: 60 }).fehler === 'band')
p('Tippfehler 6000–15000 → weitWeg', baueAktion(coinm, 'band', { unten: 6000, oben: 15000 }).fehler === 'weitWeg')
const lb = baueAktion(linear, 'band', { unten: 0.8, oben: 1.4, anzahl: 100 }).senden.body
p('linear: top/bottom direkt', lb.top === '1.4' && lb.bottom === '0.8')

console.log('Investition, Marge')
const inv = baueAktion(coinm, 'investieren', { betrag: 1 })
p('invest_in mit quoteInvestment', inv.senden.body.type === 'invest_in' && inv.senden.body.quoteInvestment === 1 && inv.warnungen.includes('positionGroesser'))
const md = baueAktion(coinm, 'margeDazu', { betrag: '0,5' })
p('addMarginCheck {buOrderId, amount}, addMargin mit coin', md.pruefen.pfad.endsWith('/addMarginCheck') && md.pruefen.body.amount === 0.5 && md.senden.body.coin === 'SOL' && md.senden.pfad.endsWith('/addMargin'))
const mw = baueAktion(coinm, 'margeWeg', { betrag: 0.2 })
p('reduceMargin warnt: Liquidation näher', mw.senden.pfad.endsWith('/reduceMargin') && mw.warnungen.includes('liqNaeher'))
p('Betrag ≤ 0 → betrag', baueAktion(coinm, 'margeDazu', { betrag: 0 }).fehler === 'betrag')

console.log('Stop-Loss / Take-Profit')
const st = baueAktion(coinm, 'stops', { stopLoss: 75, takeProfit: 110 })
const liste = st.senden.body.list
p('updateTriggerProfitLoss, snake_case, ohne Prüfabfrage', st.senden.pfad.endsWith('/updateTriggerProfitLoss') && st.senden.body.bu_order_id === coinm.id && st.pruefen === null && st.warnungen.includes('ohnePruefung'))
p('Coin-M: SL 75 USD → value 1/75', liste[0].type === 'stop_loss' && liste[0].stop_type === 'price' && liste[0].value === instrumentPreis(coinm, 75))
p('TP 110 USD → stop_profit 1/110', liste[1].type === 'stop_profit' && liste[1].value === instrumentPreis(coinm, 110))
p('leer = entfernen (value ""), Warnung bei vorhandenem SL', baueAktion({ ...coinm, stops: { stopLoss: { art: 'price', wert: 70 } } }, 'stops', { stopLoss: '' }).warnungen.includes('stopEntfernt'))
p('nur TP: SL unverändert (nicht in der Liste)', baueAktion(coinm, 'stops', { takeProfit: 120 }).senden.body.list.length === 1)
p('Long: SL über dem Kurs → stopLoss', baueAktion(coinm, 'stops', { stopLoss: 90 }).fehler === 'stopLoss')
p('SL hinter der Liquidation gewarnt', baueAktion(coinm, 'stops', { stopLoss: 65 }).warnungen.includes('stopHinterLiq'))
p('nichts angegeben → leer', baueAktion(coinm, 'stops', {}).fehler === 'leer')
// Audit BUG-R-104: ein auf 0 gerundeter Preis wird abgelehnt, nie gesendet
{
    const linear = { ...coinm, coinM: false, richtung: 'LONG', kurs: 0.01, liquidation: null }
    const sl0 = baueAktion(linear, 'stops', { stopLoss: '0.001' }, { stellen: 2 })
    const tp0 = baueAktion({ ...linear, richtung: 'SHORT' }, 'stops', { takeProfit: '0.001' }, { stellen: 2 })
    p('SL rundet auf 0 → stopLossNull, keine Anfrage', sl0.fehler === 'stopLossNull' && !sl0.senden, JSON.stringify(sl0))
    p('TP rundet auf 0 → takeProfitNull, keine Anfrage', tp0.fehler === 'takeProfitNull' && !tp0.senden, JSON.stringify(tp0))
    const slOk = baueAktion(linear, 'stops', { stopLoss: '0.006' }, { stellen: 2 })
    p('Gegenprobe: 0.006 bei 2 Stellen → 0.01 gesendet, Warnung gerundet', slOk.senden?.body.list[0].value === '0.01' && slOk.warnungen.includes('gerundet'), JSON.stringify(slOk))
    p('Gegenprobe: leer (entfernen) bleibt erlaubt', baueAktion(linear, 'stops', { stopLoss: '' }, { stellen: 2 }).senden?.body.list[0].value === '')
}

console.log('Pausieren, Fortsetzen, Beenden')
p('pauseCheck/pause sofort, Stops bleiben aktiv', baueAktion(coinm, 'pausieren').senden.body.mode === 'immediate' && baueAktion(coinm, 'pausieren').senden.body.stopLossEnabled === true)
p('resumeCheck/resume', baueAktion(coinm, 'fortsetzen').pruefen.pfad.endsWith('/resumeCheck'))
const be = baueAktion(coinm, 'beenden')
p('cancel ohne immediate, Warnungen beenden + marktpreis', be.senden.pfad.endsWith('/cancel') && !('immediate' in be.senden.body) && be.warnungen.includes('beenden') && be.warnungen.includes('marktpreis'))

console.log('Neuer Bot')
const neu = baueAktion(coinm, 'starten', { unten: 60, oben: 150, anzahl: 150, hebel: 2, einsatz: 3 })
p('checkParams snake_case, create camelCase', neu.pruefen.pfad.endsWith('/checkParams') && neu.pruefen.body.buOrderData.quote_investment === '3' && neu.senden.body.buOrderData.quoteInvestment === '3')
p('Coin-M: base USDT.PERP, quote SOL, cateType und investCoin übernommen', neu.senden.body.base === 'USDT.PERP' && neu.senden.body.quote === 'SOL' && neu.senden.body.buOrderData.cateType === 'FUTURE_GRID_COIN_MARGINED' && neu.senden.body.buOrderData.investCoin === 'SOL')
p('Richtung (trend) vom alten Bot', neu.senden.body.buOrderData.trend === 'short' && neu.senden.body.buOrderData.leverage === 2)
p('Hebel 1,5 → hebel (ganze Zahl)', baueAktion(coinm, 'starten', { hebel: 1.5 }).fehler === 'hebel')
p('linear: base COIN.PERP, quote USDT', baueAktion(linear, 'starten', {}).senden?.body.base === 'SUI.PERP')

console.log('Schranken')
p('beendeter Bot: keine Änderung', baueAktion({ ...coinm, laufend: false }, 'band', { unten: 60 }).fehler === 'nichtLaufend')
p('beendeter Bot: neu starten geht (mit Kurs)', !baueAktion({ ...coinm, laufend: false }, 'starten', {}).fehler)
console.log('Position reduzieren')
const red = baueAktion(coinm, 'reduzieren', { reduceNum: '12' }, { stellen: 7 })
p('reduzieren: reduceCheck/reduce, ganze Zahl, openPrice als Text im Instrument (Coin-M invers)', /futuresGrid\/reduceCheck$/.test(red.pruefen.pfad) && /futuresGrid\/reduce$/.test(red.senden.pfad) && red.senden.body.reduceNum === 12 && red.senden.body.buOrderId === coinm.id && Math.abs(Number(red.senden.body.openPrice) - 1 / 83.035) < 1e-6 && red.warnungen.includes('teilverkauf'), JSON.stringify(red.senden.body))
p('reduzieren: 0, 1.5, leer → abgewiesen', ['0', '1.5', ''].every((x) => baueAktion(coinm, 'reduzieren', { reduceNum: x }).fehler === 'betrag'))
p('reduzieren bei Spot nicht', baueAktion({ ...normalisiereBot({ buOrderId: 'S9', buOrderType: 'spot_grid', base: 'X', quote: 'USDT', buOrderData: { top: '2', bottom: '1', row: 5, status: 'running' } }), kurs: 1.5 }, 'reduzieren', { reduceNum: '1' }).fehler === 'nichtFuerSpot')
const ra = reduzierAusPruefung({ maxReduceNum: 40, reduceAmount: '0.5', reducePnl: '-1.2', reduceFee: '0.01', reason: 'REDUCE_TOO_MUCH' })
p('Schätzungen aus reduceCheck gelesen', ra.max === 40 && ra.menge === 0.5 && ra.pnl === -1.2 && ra.grund === 'REDUCE_TOO_MUCH')

console.log('Spot-Grid')
const spotLauf = { ...normalisiereBot({ buOrderId: 'S1', buOrderType: 'spot_grid', base: 'NVDAX', quote: 'USDT', buOrderData: { top: '190', bottom: '140', row: 50, gridType: 'arithmetic', quoteTotalInvestment: '100', status: 'running' } }), kurs: 162.2 }
p('Spot: nur Beenden und Starten, Band/Marge/Stops abgewiesen', SPOT_AKTIONEN.join() === 'beenden,starten' && ['band', 'investieren', 'margeDazu', 'stops', 'pausieren'].every((a) => baueAktion(spotLauf, a, { unten: '150', oben: '180', anzahl: '20', betrag: '10' }).fehler === 'nichtFuerSpot'))
const sb = baueAktion(spotLauf, 'beenden', {})
p('Spot beenden: cancel, Coins bleiben (NOT_SELL), ohne Prüfung', /spotGrid\/cancel$/.test(sb.senden.pfad) && sb.senden.body.closeSellModel === 'NOT_SELL' && sb.senden.body.buOrderId === 'S1' && sb.pruefen === null && sb.warnungen.includes('spotBehaelt'))
const sp = planBot({ coin: 'NVDAX', spot: true, richtung: 'LONG', unten: 140, oben: 190, anzahl: 50, art: 'geometric', hebel: 1, einsatz: 100, startKurs: 162.2, kurs: 162.2 })
p('Spot-Plan: spot_grid, Einsatz in USDT, Menge je Grid, kein Hebel', sp.typ === 'spot_grid' && sp.marginCoin === 'USDT' && sp.einsatz.basis === 100 && sp.grid.mengeJeGrid > 0 && sp.hebel === 1 && !sp.coinM)
const ss = baueAktion(sp, 'starten', { unten: '140', oben: '190', anzahl: '50', einsatz: '100', art: 'geometric' }, { stellen: 2 })
const pd = ss.pruefen?.body?.buOrderData, cd = ss.senden?.body?.buOrderData
p('Spot starten: checkParams snake_case, create camelCase (Doku 14.11.2026)', /spotGrid\/checkParams$/.test(ss.pruefen.pfad) && /spotGrid\/create$/.test(ss.senden.pfad) && pd.grid_type === 'geometric' && pd.quote_total_investment === '100' && cd.gridType === 'geometric' && cd.quoteTotalInvestment === '100' && !('leverage' in cd) && !('trend' in cd))
const sr = baueAktion(sp, 'starten', { unten: '140.123', oben: '190.456', anzahl: '50', einsatz: '100' }, { stellen: 2 })
p('Spot starten: base/quote, Preise als Text, auf die Spot-Präzision gerundet', ss.senden.body.base === 'NVDAX' && ss.senden.body.quote === 'USDT' && pd.top === '190' && pd.bottom === '140' && pd.row === 50 && sr.senden.body.buOrderData.top === '190.46' && sr.senden.body.buOrderData.bottom === '140.12', JSON.stringify(sr.senden.body.buOrderData))
p('Spot starten: Warnung Kauf zum Marktpreis', ss.warnungen.includes('spotKauf') && ss.warnungen.includes('neuerBot'))
p('Spot starten: mehr als 200 Grids abgewiesen', baueAktion(sp, 'starten', { unten: '140', oben: '190', anzahl: '201', einsatz: '100' }).fehler === 'anzahl')
p('Spot: Mindesteinsatz aus der Prüfantwort, Absage erkannt', minAusPruefung({ result: false, message: 'investment too small', data: { min_investment: '23.5' } }) === 23.5 && pruefGrund({ result: false, message: 'quote investment invalid', data: { min_investment: '23.5' } }) === 'einsatzZuKlein' && minAusPruefung({ result: true, data: {} }) === null)
p('unbekannte Aktion', baueAktion(coinm, 'hebel', { hebel: 2 }).fehler === 'aktion')
p(`${AKTIONEN.length} Aktionen (mit reduzieren)`, AKTIONEN.length === 10 && AKTIONEN.includes("reduzieren"))

console.log('Prüfantworten')
p('checkResult false → nicht bestanden', !pruefungBestanden({ result: true, data: { checkResult: false, reason: 'X' } }))
p('result false → nicht bestanden', !pruefungBestanden({ result: false, message: 'x' }))
p('ohne checkResult → bestanden', pruefungBestanden({ result: true, data: {} }))
const lq = liqAusPruefung(coinm, { estimateLiquidationPriceUpBefore: String(1 / 70.928), estimateLiquidationPriceUpAfter: String(1 / 65.964), estimateLiquidationPriceDownBefore: '0' })
p('Coin-M: Up-Schätzung = Liquidation UNTEN in USD (wie Pionex-App 70,928 → 65,964)', nahe(lq.vorher.unten, 70.928, 1e-9) && nahe(lq.nachher.unten, 65.964, 1e-9) && lq.vorher.oben === null)
const ll = liqAusPruefung(linear, { estimateLiquidationPriceDown: '0.9', estimate_liquidation_price_down: '0.85' })
p('linear: Down = unten, checkParams-Felder als „nachher"', nahe(ll.vorher.unten, 0.9) && nahe(ll.nachher.unten, 0.85))
p('heutige Einstellung lesbar', einstellungVon(coinm).anzahl === 320 && einstellungVon(coinm).hebel === 4)

console.log('Einwilligung und Haken')
p('Fassung im Text, Haftung ausgeschlossen', einwilligungsText().includes(FASSUNG) && einwilligungsText().includes('haften die Entwickler von AutarkTrade nicht') && !/niemals haft/i.test(einwilligungsText()))
p('Text nennt Totalverlust, Unwiderruflichkeit, KI, Schlüssel ohne Auszahlung', ['Totalverlust', 'unwiderruflich', 'KI', 'Auszahlungsrecht'].every((w) => einwilligungsText().includes(w)))
p('Warnblock im Wortlaut (Kaffee)', warnung().length === 4 && warnung()[3].includes('Kaffee'))
p('Zustimmung gilt nur für die heutige Fassung', zustimmungGueltig({ fassung: FASSUNG, hash: fassungHash(), zeit: 1 }) && !zustimmungGueltig({ fassung: '0.9', hash: fassungHash(), zeit: 1 }) && !zustimmungGueltig({ fassung: FASSUNG, hash: 'x', zeit: 1 }) && !zustimmungGueltig(null))
p('Haken: nur der echte Text (de/en) gilt', hakenGueltig(hakenText('de')) && hakenGueltig(hakenText('en')) && !hakenGueltig('ok') && !hakenGueltig(''))
p('Haken-Hash stabil', hakenHash('a') === hakenHash('a') && hakenHash('a') !== hakenHash('b'))

console.log('Mindesteinsatz')
p('Grund „less than min investment" erkannt (Text, wie Pionex ihn sendet)', pruefGrund({ result: false, message: 'Pionex API: [BOT_INVALID_ARGUMENT] less than min investment' }) === 'einsatzZuKlein')
p('anderer Grund → null, bestanden → null', pruefGrund({ result: false, message: 'Pionex API: [BOT_INVALID_ARGUMENT] nein' }) === null && pruefGrund({ result: true, data: { checkResult: true } }) === null)
p('Aufrunden nie unter den Wert', rundeEinsatzAuf(37.31) === 38 && rundeEinsatzAuf(4.12) === 4.2 && rundeEinsatzAuf(38) === 38 && rundeEinsatzAuf(412) === 415 && rundeEinsatzAuf(0) === null)
// Audit FUN-R-102: Coin-M-Einsätze sind Bruchteile einer Coin — das Raster 0.1 machte aus 0.02 ein «Minimum» von 0.1
p('Coin-M: 0.02 bleibt 0.02, kleine Beträge auf zwei gültige Stellen', rundeEinsatzAuf(0.02) === 0.02 && rundeEinsatzAuf(0.0213) === 0.022 && rundeEinsatzAuf(0.004) === 0.004 && rundeEinsatzAuf(0.00123) === 0.0013 && rundeEinsatzAuf(0.099) === 0.099 && rundeEinsatzAuf(0.0991) === 0.1,
    [0.02, 0.0213, 0.004, 0.00123, 0.099, 0.0991].map(rundeEinsatzAuf).join())
p('USDT-Raster ab 1 unverändert', rundeEinsatzAuf(0.8) === 0.8 && rundeEinsatzAuf(1) === 1 && rundeEinsatzAuf(9.99) === 10 && rundeEinsatzAuf(99.2) === 100 && rundeEinsatzAuf(999.9) === 1000 && rundeEinsatzAuf(1234.5) === 1300 && rundeEinsatzAuf(100000) === 100000,
    [0.8, 1, 9.99, 99.2, 999.9, 1234.5, 100000].map(rundeEinsatzAuf).join())
{
    let schlecht = ''
    for (let i = 0; i < 4000; i++) {
        const x = 10 ** (-5 + 10 * ((i * 0.6180339887) % 1))
        const r = rundeEinsatzAuf(x)
        if (!(r >= x * (1 - 1e-8)) || !(r <= x * 1.1 + (x >= 1 && x < 10 ? 0.1 : x >= 100 && x < 1000 ? 5 : 0))) { schlecht = `${x} → ${r}`; break }
    }
    p('Aufrunden: nie unter dem Wert, höchstens rund 10 % darüber (0.00001 … 100000)', !schlecht, schlecht)
}
for (const echt of [0.02, 0.0037, 0.31]) {
    let n = 0
    const r = await sucheMindestEinsatz(async (x) => { n++; return x >= echt ? 'ok' : 'zuKlein' }, { start: echt / 2, lo: echt / 4 })
    p(`Coin-M-Suche findet ${echt} (≥ echt, ≤ +16 %, genauer Wert dabei)`, r.min >= echt && r.min <= echt * 1.16 && r.genau >= echt && r.genau <= r.min, JSON.stringify(r) + ' n=' + n)
}
for (const echt of [0.8, 7, 37.3, 260, 4100]) {
    let n = 0
    const r = await sucheMindestEinsatz(async (x) => { n++; return x >= echt ? 'ok' : 'zuKlein' }, { start: 10 })
    p(`Suche findet ${echt} (≥ echt, ≤ +10 %, ≤ 14 Abfragen)`, r.min >= echt && r.min <= echt * 1.1 + 0.1 && n <= 14, JSON.stringify(r) + ' n=' + n)
}
p('anderer Grund vor dem ersten „ok" bricht ab', (await sucheMindestEinsatz(async () => 'anders', { start: 10 })).fehler === 'anders')
p('über der Grenze: fehler grenze', (await sucheMindestEinsatz(async () => 'zuKlein', { start: 10, max: 1000 })).fehler === 'grenze')
p('bekannter zu kleiner Betrag wird nicht noch einmal geprüft', await (async () => { const gesehen = []; await sucheMindestEinsatz(async (x) => { gesehen.push(x); return x >= 30 ? 'ok' : 'zuKlein' }, { lo: 5, start: 10 }); return !gesehen.includes(5) })())

console.log(`\n${ok} bestanden, ${fehl} fehlgeschlagen`)
process.exit(fehl ? 1 : 0)
