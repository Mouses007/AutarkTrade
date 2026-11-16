/**
 * Netto eines beendeten Pionex-Futures-Grid-Bots — die EINE Rechnung für Journal-Import und Bot-Seite.
 *
 * `totalRealizedProfit` ist der Gewinn VOR Gebühren und Funding. Bis 16.11.2026 buchte der Journal-Import
 * das Feld als «Netto-Wallet-Delta» (die Aussage galt für normale Futures-Positionen, nicht für Bots):
 * beendete USDT-M-Bots standen um |Gebühren| − Funding zu gut im Journal (an fünf gespeicherten Bots
 * zusammen 6.70 USDT, rund 9 % der Verluste). Belegt am echten XRP-Bot vom 15.11.2026:
 * totalRealizedProfit 0.2144, Gebühren 0.0549, Funding −0.0020 → 0.1575.
 *
 * Was wirklich zurückkam, ist die Marge: Netto = Marge − Investition − Extra-Marge + ausgetretener Gewinn
 * (`profitExited`) + entnommener Gewinn (`profitWithdrawn`).
 *
 * `profitExited` ist Pflicht: Gewinn, der den Bot schon verlassen hat oder in die Investition umgebucht
 * wurde (bei «Reduzieren» ausgezahlt; bei einer Band-Änderung mit `adjustParamsInvestmentChanged` der
 * Investition zugeschlagen). Ohne ihn fehlte am 16.11.2026 an 100 echten beendeten USDT-Bots zusammen
 * rund 2400 USDT (ein MYX-Bot: +881 statt +1728 — Start 570, zurück 2298, `quoteInvestment` 1347 =
 * 500 + 847 `profitExited`). Mit ihm stimmt die Rechnung bei 91 von 100 auf 0,5 % mit Pionex' eigener
 * Buchung (Gewinn − Gebühren + Funding) überein, der Rest liegt wenige Cent bis Dollar daneben.
 * Pionex' «Gesamt Profit» zeigt nur, was im Bot blieb (XRP: 0.15) — der wahre Gewinn ist 0.1575.
 *
 * Fehlt die Marge (alter Import), bleibt die Näherung Gewinn − Gebühren + Funding; sie ist bei
 * liquidierten Bots zu streng (der Verlust ist dort auf den Einsatz gedeckelt).
 *
 * Rein, ohne Netz und Datenbank. Selbsttest: `shared/__selftest-bot-netto.mjs`.
 */
import { istGewinn } from './gewinn.js'
import { tagesSummen, tradeInUsdt } from './coinM.js'

const zahl = (v) => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null }

/** Spot-Grids haben ein eigenes Layout (Gewinn schon netto) und sind nie gemeint. */
export const istSpotBot = (botType) => /spot|token_grid/i.test(String(botType || ''))

/**
 * Netto aus den Rohfeldern einer Pionex-Bot-Antwort, in der Margin-Münze. `null`, wenn die Marge fehlt.
 * @param {{marginBalance, quoteInvestment, extraMargin, profitExited, profitWithdrawn}} d
 */
export function nettoAusMarge(d) {
    const marge = zahl(d?.marginBalance), invest = zahl(d?.quoteInvestment)
    if (marge === null || invest === null) return null
    return marge - invest - (zahl(d.extraMargin) ?? 0) + (zahl(d.profitExited) ?? 0) + (zahl(d.profitWithdrawn) ?? 0)
}

/** Näherung ohne Marge: Gewinn vor Gebühren − Gebühren + Funding (Funding trägt sein Vorzeichen). */
export function nettoAusGewinn(gewinnVorGebuehren, gebuehr, funding) {
    return (zahl(gewinnVorGebuehren) ?? 0) - Math.abs(zahl(gebuehr) ?? 0) + (zahl(funding) ?? 0)
}

/** Braucht dieser gespeicherte Trade die Korrektur? Nur Futures-Grid-Bots ohne Marke. */
export function brauchtNettoKorrektur(t) {
    return !!t && t.category === 'bot' && !istSpotBot(t.botType) && !t.nettoNachGebuehren
}

function geldFelder(t, brutto, netto) {
    const gw = istGewinn(brutto), nw = istGewinn(netto)
    const menge = Number(t.buyQuantity) || 0
    return {
        grossProceeds: brutto, netProceeds: netto, grossSharePL: brutto, netSharePL: netto,
        grossWins: gw ? brutto : 0, grossLoss: gw ? 0 : brutto,
        netWins: nw ? netto : 0, netLoss: nw ? 0 : netto,
        grossWinsCount: gw ? 1 : 0, grossLossCount: gw ? 0 : 1,
        netWinsCount: nw ? 1 : 0, netLossCount: nw ? 0 : 1,
        grossWinsQuantity: gw ? menge : 0, grossLossQuantity: gw ? 0 : menge,
        netWinsQuantity: nw ? menge : 0, netLossQuantity: nw ? 0 : menge,
        grossSharePLWins: gw ? brutto : 0, grossSharePLLoss: gw ? 0 : brutto,
        netSharePLWins: nw ? netto : 0, netSharePLLoss: nw ? 0 : netto,
        highGrossSharePLWin: gw ? brutto : 0, highGrossSharePLLoss: gw ? 0 : brutto,
        highNetSharePLWin: nw ? netto : 0, highNetSharePLLoss: nw ? 0 : netto,
    }
}

/**
 * Einen bereits importierten Bot-Trade nachrechnen (neues Objekt; andere unverändert zurück).
 * - USDT-M: gespeichert ist Netto = Gewinn vor Gebühren. Neu: Netto − Gebühr + Funding; das alte Netto
 *   ist das richtige Brutto. Die Marge ist am Trade nicht gespeichert, darum die Näherung.
 * - Coin-M: der USDT-Wert kam schon aus der Marge und bleibt; nur der Coin-Wert `netCoin` war vor Gebühren.
 */
export function tradeNettoKorrigiert(t) {
    if (!brauchtNettoKorrektur(t)) return t
    if (t.coinM || (t.marginCoin && t.marginCoin !== 'USDT')) {
        const netCoin = zahl(t.netCoin)
        if (netCoin === null) return { ...t, nettoNachGebuehren: true }
        const neu = nettoAusGewinn(netCoin, t.feeCoin, t.fundingCoin)
        return { ...t, grossCoin: netCoin, netCoin: neu, nettoNachGebuehren: true }
    }
    const alt = zahl(t.netProceeds ?? t.netSharePL) ?? 0
    const netto = nettoAusGewinn(alt, t.tradingFee ?? t.commission, t.fundingFee)
    return { ...t, ...geldFelder(t, alt, netto), ...(t.pnlUsdt !== undefined ? { pnlUsdt: netto } : {}), nettoNachGebuehren: true }
}

/**
 * Eine gespeicherte Tageszeile nachrechnen: Trades und Executions, Blotter und P&L neu.
 * `geaendert: false` = nichts zu tun.
 */
export function tagNettoKorrigiert(zeile) {
    const trades = Array.isArray(zeile?.trades) ? zeile.trades : []
    if (!trades.some(brauchtNettoKorrektur)) return { geaendert: false }
    const neueTrades = trades.map(tradeNettoKorrigiert)
    const executions = Array.isArray(zeile.executions) ? zeile.executions.map(tradeNettoKorrigiert) : zeile.executions
    return { geaendert: true, trades: neueTrades, executions, ...tagesSummen(neueTrades) }
}

/** Bot-Kennung aus der Trade-ID des Imports: `t<Tag>_<Index>_<buOrderId>`. */
export function botIdAusTradeId(id) {
    const teile = String(id || '').split('_')
    return teile.length >= 3 ? teile.slice(2).join('_') : null
}

/** Fehlt diesem Bot-Trade noch der Abgleich mit Pionex' Rohdaten? */
export function brauchtPionexAbgleich(t) {
    return !!t && t.category === 'bot' && !istSpotBot(t.botType) && !t.nettoAusPionex
}

/**
 * Einen Bot-Trade auf das Netto aus Pionex' Rohdaten setzen (`nettoAusMarge`), exakt statt genähert.
 * Nötig, weil die Start-Migration für Alt-Trades nur Gewinn − Gebühr + Funding rechnen konnte — bei
 * liquidierten Bots zu streng (NAS 16.11.2026: sieben Bots zusammen 132 USDT, ein MYX-Bot −177.90 statt
 * −143.57: der Verlust ist auf das Eingezahlte gedeckelt).
 * @param {object} t      gespeicherter Trade
 * @param {number|null} netto  Netto in der Margin-Münze, oder null = Pionex kennt den Bot nicht (mehr)
 */
export function tradeAusPionex(t, netto) {
    if (!brauchtPionexAbgleich(t)) return t
    if (netto === null || netto === undefined || !Number.isFinite(netto)) return { ...t, nettoAusPionex: 'unbekannt' }
    if (t.coinM || (t.marginCoin && t.marginCoin !== 'USDT')) {
        // USDT-Wert kam schon aus der Marge; nur der Coin-Wert wird exakt
        const brutto = netto + Math.abs(zahl(t.feeCoin) ?? 0) - (zahl(t.fundingCoin) ?? 0)
        return { ...t, netCoin: netto, grossCoin: brutto, nettoNachGebuehren: true, nettoAusPionex: true }
    }
    const brutto = netto + Math.abs(zahl(t.tradingFee ?? t.commission) ?? 0) - (zahl(t.fundingFee) ?? 0)
    return { ...t, ...geldFelder(t, brutto, netto), ...(t.pnlUsdt !== undefined ? { pnlUsdt: netto } : {}), nettoNachGebuehren: true, nettoAusPionex: true }
}

/** Fehlt diesem Bot-Trade noch die Prüfung, ob er ein Coin-M-Bot ist? */
export function brauchtCoinMPruefung(t) {
    return !!t && t.category === 'bot' && !istSpotBot(t.botType) && !t.coinMGeprueft
}

/**
 * Coin-M nachtragen: Über «Pendente Trades» erfasste Bots trugen bis 16.11.2026 weder `coinM` noch den
 * USDT-Wert — ein SOL-Bot mit −3.53 SOL stand als «−3.53 USDT» im Journal (wahr: rund −411 USDT).
 * `info` kommt aus Pionex' Rohdaten ({coinM, marginCoin, pnlUsdt, investUsdt, quoteCloseP}); null = Pionex
 * kennt den Bot nicht mehr. Danach rechnet `tradeInUsdt` (shared/coinM.js) wie beim Schnell-Import um.
 */
export function tradeCoinMNachtrag(t, info) {
    if (!brauchtCoinMPruefung(t)) return t
    if (!info) return { ...t, coinMGeprueft: 'unbekannt' }
    if (!info.coinM || t.coinM || t.einheitUsdt) return { ...t, coinMGeprueft: true }
    return tradeInUsdt({ ...t, coinM: true, marginCoin: info.marginCoin || 'Coin', pnlUsdt: info.pnlUsdt, investUsdt: info.investUsdt, quoteCloseP: info.quoteCloseP, coinMGeprueft: true })
}

/**
 * Eine Tageszeile mit Pionex abgleichen. `nettoNachBot`: Map buOrderId → Netto (Margin-Münze);
 * `infoNachBot` (optional): Map buOrderId → Coin-M-Angaben für `tradeCoinMNachtrag`.
 * `geaendert: false` = nichts zu tun.
 */
export function tagAusPionex(zeile, nettoNachBot, infoNachBot = null) {
    const trades = Array.isArray(zeile?.trades) ? zeile.trades : []
    const offen = (t) => brauchtPionexAbgleich(t) || (infoNachBot && brauchtCoinMPruefung(t))
    if (!trades.some(offen)) return { geaendert: false }
    const neu = (t) => {
        const id = botIdAusTradeId(t.trade ?? t.id)
        let x = brauchtPionexAbgleich(t) ? tradeAusPionex(t, nettoNachBot.get(id) ?? null) : t
        if (infoNachBot && brauchtCoinMPruefung(x)) x = tradeCoinMNachtrag(x, infoNachBot.get(id) ?? null)
        return x
    }
    const neueTrades = trades.map(neu)
    const executions = Array.isArray(zeile.executions) ? zeile.executions.map(neu) : zeile.executions
    return { geaendert: true, trades: neueTrades, executions, ...tagesSummen(neueTrades) }
}
