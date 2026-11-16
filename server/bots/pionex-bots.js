/**
 * Pionex-Bots für die Bot-Seite: Abruf (nur lesend) und eine einheitliche Form.
 *
 * Die Liste GET /api/v1/bot/orders trägt bereits das volle buOrderData
 * (gemessen 11.11.2026: dieselben ~120 Felder wie die Detail-Abfrage), darum
 * gibt es keinen Detail-Aufruf pro Bot.
 *
 * Coin-M ist invers: base = USDT.PERP, quote = Coin, alle Preise sind „Coin je
 * USDT". `normalisiereBot` rechnet sie in USDT je Coin um — dabei tauschen
 * Unter- und Obergrenze die Plätze, ebenso die beiden geschätzten
 * Liquidationspreise, und trend 'short' (USDT-Seite) ist ein LONG der Coin.
 *
 * Unbekannt bleibt null, nie 0: ein leeres Feld ist kein Messwert.
 */
import { typVon, TYPEN, zyklusGebuehr } from './pionex-wissen.js'

/**
 * Die für die Richtung massgebliche Liquidation (USD je Coin): Long unten,
 * Short oben, Neutral die nähere bekannte Seite (sonst unten vor oben).
 * Eine Stelle für Kennzahlen, KI, Simulation und Steuerung (Audit FUN-01).
 */
export function liqRisiko(richtung, liq, kurs = null) {
    if (!liq) return null
    if (richtung === 'LONG') return liq.unten ?? liq.preis ?? null
    if (richtung === 'SHORT') return liq.oben ?? liq.preis ?? null
    const kandidaten = [liq.unten, liq.oben].filter((v) => v != null)
    if (!kandidaten.length) return liq.preis ?? null
    if (kurs != null && kandidaten.length > 1) return kandidaten.sort((a, b) => Math.abs(a - kurs) - Math.abs(b - kurs))[0]
    return kandidaten[0]
}

/** Zahl aus einem API-Feld; '', null, nicht endlich → null. */
export function zahl(v) {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Wie zahl(), aber 0 gilt als „nicht gesetzt" (Preise, die Pionex als 0 statt leer meldet). */
function preisOderNull(v) {
    const n = zahl(v)
    return n && n > 0 ? n : null
}

const kehrwert = (n) => (n && n > 0 ? 1 / n : null)

function istCoinM(o, d) {
    return d.cateType === 'FUTURE_GRID_COIN_MARGINED'
        || /coin_margin/i.test(d.uiExtraData || '')
        || /^USDT(\.PERP)?$/i.test(String(o.base || ''))
}

const ohneSuffix = (s) => String(s || '').replace(/\.(PERP|SPOT)$/i, '').toUpperCase()

/**
 * Grid-Abstand in Prozent. Arithmetisch ist er unten grösser als oben
 * (gleicher Preisschritt auf kleinerem Preis), geometrisch überall gleich.
 */
export function gridAbstand(unten, oben, anzahl, art) {
    if (!(unten > 0) || !(oben > unten) || !(anzahl >= 1)) return null
    if (String(art).toLowerCase() === 'geometric') {
        const p = Math.pow(oben / unten, 1 / anzahl) - 1
        return { unten: p, oben: p, mitte: p }
    }
    const schritt = (oben - unten) / anzahl
    return { unten: schritt / unten, oben: schritt / (oben - schritt), mitte: schritt / ((oben + unten) / 2) }
}

/** Ein Bot aus der Pionex-Liste in der Form der Bot-Seite. */
export function normalisiereBot(o) {
    if (!o?.buOrderId) return null
    const d = o.buOrderData || {}
    const typ = typVon(o.buOrderType, d.cateType)
    const spot = o.buOrderType === 'spot_grid'
    const coinM = o.buOrderType !== 'spot_grid' && istCoinM(o, d)
    const coin = coinM ? ohneSuffix(o.quote) : ohneSuffix(o.base)
    const marginCoin = coinM ? (d.investCoin || coin) : (o.buOrderType === 'spot_grid' ? 'USDT' : (d.investCoin || 'USDT'))
    // Preis in USDT je Coin
    const p = coinM ? (v) => kehrwert(preisOderNull(v)) : preisOderNull

    const trend = String(d.trend || '').toLowerCase()
    let richtung = null
    if (trend === 'no_trend' || trend === 'neutral') richtung = 'NEUTRAL'
    else if (trend === 'long' || trend === 'short') {
        const kurz = trend === 'short'
        richtung = coinM ? (kurz ? 'LONG' : 'SHORT') : (kurz ? 'SHORT' : 'LONG')
    }

    const top = p(d.top), bottom = p(d.bottom)
    const unten = top != null && bottom != null ? Math.min(top, bottom) : null
    const oben = top != null && bottom != null ? Math.max(top, bottom) : null
    const anzahl = zahl(d.row)
    const art = d.gridType || null

    // Liquidation: die Seite kommt aus dem FELD, nicht aus min/max — gerichtete Bots melden nur
    // eine Seite (die andere 0). Linear: Up = über dem Kurs, Down = darunter; Coin-M invers
    // getauscht (ein steigender Instrument-Kurs ist ein fallender Coin-Kurs). Audit FUN-01:
    // bis 11.11.2026 landete ein USDT-M-Short mit nur „Up" in `unten`.
    const liqUp = p(d.estimateLiquidationPriceUp), liqDown = p(d.estimateLiquidationPriceDown)
    const liqUnten = coinM ? liqUp : liqDown
    const liqOben = coinM ? liqDown : liqUp

    // TP/SL: nur Preis-Arten sind Preise; Betrags- und Quoten-Arten bleiben Zahlen.
    const stopWert = (typAngabe, wert) => {
        const t = String(typAngabe || '')
        if (wert === null || wert === undefined || wert === '') return null
        // Ein Preis-Stop von 0 ist keiner (so meldet Pionex einen entfernten Stop)
        if (/price/.test(t) && !(zahl(wert) > 0)) return null
        return { art: t || null, wert: /price/.test(t) ? p(wert) : zahl(wert) }
    }

    const status = String(d.status || o.status || '').toLowerCase()
    const laufend = status === 'running' || status === 'open' || ['paused', 'condition_lock', 'prepare'].includes(status)

    const gebuehrZyklus = zyklusGebuehr(typ)
    // Coin-M: Pionex verteilt die Grids auf dem INVERSEN Preis (Coin je USDT).
    // Arithmetisch dort heisst in USD unten dichter, oben weiter (Pionex-Hilfe
    // „Coin-M Futures Grid") — also auf den Rohwerten rechnen und die Enden tauschen.
    let abstand = null
    if (coinM) {
        const a = gridAbstand(preisOderNull(d.bottom), preisOderNull(d.top), anzahl, art)
        abstand = a ? { unten: a.oben, oben: a.unten, mitte: a.mitte } : null
    } else abstand = gridAbstand(unten, oben, anzahl, art)

    return {
        id: String(o.buOrderId),
        typ,
        typName: TYPEN[typ]?.name || o.buOrderType || 'Bot',
        buOrderType: o.buOrderType || null,
        cateType: d.cateType || null,
        name: o.customizeName || o.botName || null,
        coin,
        symbol: `${coin}USDT`,
        coinM,
        marginCoin,
        richtung,
        status,
        laufend,
        risikoStatus: d.riskStatus || null,
        endGrund: d.reasonBy || null,
        erstellt: zahl(o.createTime ?? d.createTime),
        beendet: zahl(o.closeTime) || null,
        grid: {
            unten, oben, anzahl, art,
            abstand,
            // Gewinn eines Zyklus nach Gebühren in der Mitte des Bands (null beim Gewinnanteil-Modell)
            nettoJeZyklus: abstand && gebuehrZyklus != null ? abstand.mitte - gebuehrZyklus : null,
            gebuehrZyklus,
            mengeJeGrid: zahl(d.perVolume),
            minOffeneOrders: zahl(d.minOpenOrders),
        },
        hebel: zahl(d.leverage),
        einsatz: {
            // Die eine Basis für Rendite, Simulation und Schritte (Audit FUN-09):
            // Coin-M in der Coin, sonst USDT-Investment, Rückfall auf quoteInvestment
            // USDT-Bots: `quoteInvestment` ist die HEUTIGE Investition (Pionex «Tatsächliche Investition»);
            // `usdtInvestment` blieb am 15.11.2026 nach «Investition erhöhen» (9.2 → 19.2) und «Reduzieren»
            // (→ 15.36) auf 9.2 stehen — der Gewinn las sich dadurch als +67 % statt −0.4 %.
            // Spot: `quoteTotalInvestment` ist, was eingezahlt wurde (Pionex «Investition» 10); `quoteInvestment`
            // (9.597) ist derselbe Betrag ohne die Gebührenreserve und liesse 0.40 USDT als Verlust erscheinen.
            basis: spot ? (zahl(d.quoteTotalInvestment) ?? zahl(d.usdtInvestment ?? d.initUsdtInvestment) ?? zahl(d.quoteInvestment))
                : coinM ? zahl(d.quoteInvestment)
                : (String(d.investCoin || 'USDT').toUpperCase() === 'USDT' ? (zahl(d.quoteInvestment) ?? zahl(d.usdtInvestment ?? d.initUsdtInvestment))
                    : (zahl(d.usdtInvestment ?? d.initUsdtInvestment) ?? zahl(d.quoteInvestment))),
            aktuell: zahl(d.quoteInvestment),
            start: zahl(d.initQuoteInvestment),
            usdt: zahl(d.usdtInvestment ?? d.initUsdtInvestment),
            extraMarge: zahl(d.extraMargin),
            marge: zahl(d.marginBalance),
            // Spot: USDT, die der Bot neben den Coins hält (für offene Käufe und als Gebührenreserve)
            quoteBestand: spot ? zahl(d.quoteTotalAmount ?? d.quoteAmount) : null,
            startKurs: coinM ? zahl(d.initQuotePrice) : null,   // Coin-Preis in USDT beim Start (Coin-M)
        },
        ergebnis: {
            gridGewinn: zahl(d.gridProfit),
            gridGewinn24h: zahl(d.gridProfit24h),
            trades24h: zahl(d.trx24h),
            zyklen: zahl(d.exchangeOrderPairedCount),
            gesamt: zahl(d.totalRealizedProfit),
            gebuehren: zahl(d.totalFee),
            funding: zahl(d.totalFundingFee),
            entnommen: zahl(d.profitWithdrawn),
            // Gewinn, der den Bot schon verlassen hat oder der Investition zugeschlagen wurde (shared/botNetto.js)
            ausgetreten: zahl(d.profitExited),
            reinvestiert: zahl(d.profitReinvest),
            gewinnAnteilPionex: zahl(d.sharedProfit),
            volumen: zahl(d.totalVolume),
        },
        position: {
            // Spot hat keine Futures-Position: gehaltene Coins und ihr Durchschnittspreis
            menge: spot ? zahl(d.baseTotalAmount ?? d.baseAmount) : zahl(d.position),
            einstieg: spot ? preisOderNull(d.averageCost) : p(d.positionOpenPrice),
            startPreis: p(d.initPrice ?? d.openPrice),
            schlussPreis: p(d.closedPrice),
        },
        liquidation: {
            preis: p(d.liquidationPrice),
            unten: liqUnten,
            oben: liqOben,
        },
        stops: {
            // `stopLossEnabled`/`stopProfitEnabled` sagen NICHT, ob ein Stop gesetzt ist: am 15.11.2026 standen
            // beide auf false, während Pionex Voll-SL ≤ 0.6 und Voll-TP ≥ 5 «wartet auf Auslösung» zeigte
            // (auch in allen gespeicherten Antworten false, mit und ohne Stop). Es zählt der Wert.
            stopLoss: stopWert(d.lossStopType, d.lossStop),
            stopLossOben: stopWert(d.lossStopType, d.lossStopHigh),
            takeProfit: stopWert(d.profitStopType, d.profitStop),
        },
        trigger: preisOderNull(d.condition) ? { preis: p(d.condition), richtung: zahl(d.conditionDirection) } : null,
        trailing: d.movingIndicatorType ? {
            art: d.movingIndicatorType,
            intervall: d.movingIndicatorInterval || null,
            param: d.movingIndicatorParam || null,
            oben: p(d.movingTop), unten: p(d.movingBottom),
        } : null,
        roh: d,
    }
}

/** Alle Seiten einer Bot-Liste holen (höchstens `maxSeiten`, Pause gegen das Limit von 10/s). */
export async function holeAlleSeiten(holeSeite, status, maxSeiten = 20) {
    const alle = []
    let token = null
    for (let i = 0; i < maxSeiten; i++) {
        const r = await holeSeite({ status, limit: 50, ...(token ? { pageToken: token } : {}) })
        if (r?.result === false) throw new Error(r.message || r.code || 'Pionex lehnte die Abfrage ab')
        const res = r?.data?.results || []
        alle.push(...res)
        token = r?.data?.nextPageToken
        if (!token || !res.length) break
        await new Promise((ok) => setTimeout(ok, 250))
    }
    return alle
}
