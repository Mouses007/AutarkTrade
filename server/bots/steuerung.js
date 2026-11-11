/**
 * Bot-Steuerung (Schritt 5): baut die Anfragen an Pionex — rein, ohne Netz.
 *
 * Die EINZIGE Stelle im Server, an der schreibende Bot-Pfade von Pionex
 * stehen (`server/execution/__selftest-broker-registry.mjs` prüft das). Jede
 * Aktion hat, wo Pionex eine anbietet, eine Prüfabfrage (Dry-Run); gesendet
 * wird nur nach Prüfung, Einwilligung und Haken (Routen in steuerung-routen.js).
 *
 * Formate nach der Pionex-API-Doku (abgerufen 11.11.2026,
 * https://www.pionex.com/docs/api-docs/bot-api/futures-grid.md). Nur
 * Futures-Grids (auch Coin-M); der Hebel eines laufenden Bots lässt sich über
 * die API NICHT ändern (adjustParams hat kein Feld dafür) — das geht nur in
 * der Pionex-App oder mit einem neuen Bot.
 *
 * Coin-M ist invers: Eingaben in USD je Coin werden in den Instrument-Preis
 * (Coin je USDT) umgerechnet, Unter- und Obergrenze tauschen dabei die Plätze.
 */
const PFAD = '/api/v1/bot/orders/futuresGrid'
export const AKTIONEN = ['band', 'investieren', 'margeDazu', 'margeWeg', 'stops', 'pausieren', 'fortsetzen', 'beenden', 'starten']
export const STEUERBAR = new Set(['futures_grid', 'coinm_grid'])

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const leer = (v) => v === undefined || v === null || v === ''
const zahl = (v) => (leer(v) ? null : Number(String(v).replace(',', '.')))

/** Nachkommastellen eines API-Preises („0.0105263" → 7). */
export function stellenVon(...texte) {
    let n = 0
    for (const t of texte) {
        const s = String(t ?? '')
        const i = s.indexOf('.')
        if (i >= 0) n = Math.max(n, s.length - i - 1)
    }
    return Math.min(n || 8, 12)
}

/** Preis in USD je Coin → Preis-Text des Instruments, gerundet auf die Stellen des Bots. */
export function instrumentPreis(bot, usd) {
    if (!istZahl(usd) || usd <= 0) return null
    const roh = bot.roh || {}
    const stellen = stellenVon(roh.top, roh.bottom)
    const p = bot.coinM ? 1 / usd : usd
    return p.toFixed(stellen).replace(/0+$/, '').replace(/\.$/, '')
}

function basisQuote(bot) {
    return bot.coinM ? { base: 'USDT.PERP', quote: bot.coin } : { base: `${bot.coin}.PERP`, quote: 'USDT' }
}

function seitenPruefung(bot, sl, tp, kurs) {
    if (bot.richtung === 'NEUTRAL' && (sl != null || tp != null)) return 'neutralStop'
    const long = bot.richtung !== 'SHORT'
    if (sl != null && (!(sl > 0) || (istZahl(kurs) && (long ? sl >= kurs : sl <= kurs)))) return 'stopLoss'
    if (tp != null && (!(tp > 0) || (istZahl(kurs) && (long ? tp <= kurs : tp >= kurs)))) return 'takeProfit'
    return null
}

/** Heutige Einstellung in Anzeigeform (USD je Coin, Margin-Münze). */
export function einstellungVon(bot) {
    return {
        unten: bot.grid?.unten ?? null, oben: bot.grid?.oben ?? null, anzahl: bot.grid?.anzahl ?? null, art: bot.grid?.art ?? null,
        hebel: bot.hebel ?? null, einsatz: bot.einsatz?.aktuell ?? null, extraMarge: bot.einsatz?.extraMarge ?? null,
        stopLoss: bot.stops?.stopLoss?.wert ?? null, takeProfit: bot.stops?.takeProfit?.wert ?? null,
        status: bot.status, liquidation: bot.liquidation?.unten ?? bot.liquidation?.oben ?? bot.liquidation?.preis ?? null,
    }
}

/**
 * Anfrage für eine Aktion bauen.
 * @returns {{fehler}} oder {aktion, pruefen: {pfad, body}|null, senden: {pfad, body}, nachher, warnungen}
 */
export function baueAktion(bot, aktion, eingabe = {}, { kurs = bot?.kurs } = {}) {
    if (!bot || !STEUERBAR.has(bot.typ)) return { fehler: 'typ' }
    if (!AKTIONEN.includes(aktion)) return { fehler: 'aktion' }
    if (aktion !== 'starten' && !bot.laufend) return { fehler: 'nichtLaufend' }
    const id = bot.id
    const warnungen = []
    const openPrice = istZahl(kurs) && kurs > 0 ? Number(instrumentPreis(bot, kurs)) : null

    if (aktion === 'band') {
        const unten = zahl(eingabe.unten) ?? bot.grid?.unten, oben = zahl(eingabe.oben) ?? bot.grid?.oben
        const anzahl = zahl(eingabe.anzahl) ?? bot.grid?.anzahl
        if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
        if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > 500) return { fehler: 'anzahl' }
        if (istZahl(kurs) && (oben < kurs / 5 || unten > kurs * 5)) return { fehler: 'weitWeg' }
        if (openPrice == null) return { fehler: 'kurs' }
        const top = instrumentPreis(bot, bot.coinM ? unten : oben), bottom = instrumentPreis(bot, bot.coinM ? oben : unten)
        const body = { buOrderId: id, type: 'adjust_params', extraMargin: false, openPrice, top, bottom, row: anzahl, keepInvestment: true }
        warnungen.push('marktpreis')
        if (istZahl(kurs) && (kurs < unten || kurs > oben)) warnungen.push('kursAusserhalb')
        return { aktion, pruefen: { pfad: `${PFAD}/adjustParamsCheck`, body }, senden: { pfad: `${PFAD}/adjustParams`, body }, nachher: { unten, oben, anzahl }, warnungen }
    }
    if (aktion === 'investieren') {
        const betrag = zahl(eingabe.betrag)
        if (!istZahl(betrag) || betrag <= 0) return { fehler: 'betrag' }
        if (openPrice == null) return { fehler: 'kurs' }
        const body = { buOrderId: id, type: 'invest_in', extraMargin: false, openPrice, quoteInvestment: betrag }
        warnungen.push('positionGroesser')
        return { aktion, pruefen: { pfad: `${PFAD}/adjustParamsCheck`, body }, senden: { pfad: `${PFAD}/adjustParams`, body }, nachher: { einsatz: (bot.einsatz?.aktuell || 0) + betrag }, warnungen }
    }
    if (aktion === 'margeDazu' || aktion === 'margeWeg') {
        const betrag = zahl(eingabe.betrag)
        if (!istZahl(betrag) || betrag <= 0) return { fehler: 'betrag' }
        const dazu = aktion === 'margeDazu'
        if (!dazu) warnungen.push('liqNaeher')
        return {
            aktion,
            pruefen: { pfad: `${PFAD}/${dazu ? 'addMarginCheck' : 'reduceMarginCheck'}`, body: { buOrderId: id, amount: betrag } },
            senden: { pfad: `${PFAD}/${dazu ? 'addMargin' : 'reduceMargin'}`, body: { buOrderId: id, coin: bot.marginCoin, amount: betrag } },
            nachher: { extraMarge: (bot.einsatz?.extraMarge || 0) + (dazu ? betrag : -betrag) },
            warnungen,
        }
    }
    if (aktion === 'stops') {
        // Leer = entfernen; nicht angegeben (undefined) = unverändert lassen
        const slAn = eingabe.stopLoss !== undefined, tpAn = eingabe.takeProfit !== undefined
        if (!slAn && !tpAn) return { fehler: 'leer' }
        const sl = slAn ? zahl(eingabe.stopLoss) : null, tp = tpAn ? zahl(eingabe.takeProfit) : null
        const seite = seitenPruefung(bot, sl, tp, kurs)
        if (seite) return { fehler: seite }
        const liste = []
        if (slAn) liste.push({ type: 'stop_loss', stop_type: 'price', value: sl == null ? '' : instrumentPreis(bot, sl), stop_delay: 0 })
        if (tpAn) liste.push({ type: 'stop_profit', stop_type: 'price', value: tp == null ? '' : instrumentPreis(bot, tp), stop_delay: 0 })
        if (slAn && sl == null && bot.stops?.stopLoss) warnungen.push('stopEntfernt')
        const liq = bot.liquidation?.unten ?? bot.liquidation?.oben
        if (sl != null && istZahl(liq) && (bot.richtung !== 'SHORT' ? sl <= liq : sl >= liq)) warnungen.push('stopHinterLiq')
        warnungen.push('ohnePruefung')
        return { aktion, pruefen: null, senden: { pfad: `${PFAD}/updateTriggerProfitLoss`, body: { bu_order_id: id, list: liste } }, nachher: { stopLoss: slAn ? sl : undefined, takeProfit: tpAn ? tp : undefined }, warnungen }
    }
    if (aktion === 'pausieren') {
        return { aktion, pruefen: { pfad: `${PFAD}/pauseCheck`, body: { buOrderId: id, mode: 'immediate' } }, senden: { pfad: `${PFAD}/pause`, body: { buOrderId: id, mode: 'immediate', stopLossEnabled: true, stopProfitEnabled: true } }, nachher: { status: 'paused' }, warnungen: ['pausiert'] }
    }
    if (aktion === 'fortsetzen') {
        return { aktion, pruefen: { pfad: `${PFAD}/resumeCheck`, body: { buOrderId: id } }, senden: { pfad: `${PFAD}/resume`, body: { buOrderId: id, isResumeImmediate: true } }, nachher: { status: 'running' }, warnungen: [] }
    }
    if (aktion === 'beenden') {
        return { aktion, pruefen: null, senden: { pfad: `${PFAD}/cancel`, body: { buOrderId: id, closeSellModel: 'TO_QUOTE' } }, nachher: { status: 'canceled' }, warnungen: ['beenden', 'marktpreis', 'ohnePruefung'] }
    }
    // starten: neuer Bot mit den Einstellungen dieses Bots und den Änderungen der Eingabe
    const roh = bot.roh || {}
    const unten = zahl(eingabe.unten) ?? bot.grid?.unten, oben = zahl(eingabe.oben) ?? bot.grid?.oben
    const anzahl = zahl(eingabe.anzahl) ?? bot.grid?.anzahl
    const hebel = zahl(eingabe.hebel) ?? bot.hebel
    const einsatz = zahl(eingabe.einsatz) ?? bot.einsatz?.aktuell
    const art = eingabe.art === 'geometric' ? 'geometric' : eingabe.art === 'arithmetic' ? 'arithmetic' : (bot.grid?.art || 'arithmetic')
    if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > 500) return { fehler: 'anzahl' }
    if (!istZahl(hebel) || hebel < 1 || hebel > 125 || !Number.isInteger(hebel)) return { fehler: 'hebel' }
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'betrag' }
    if (istZahl(kurs) && (oben < kurs / 5 || unten > kurs * 5)) return { fehler: 'weitWeg' }
    const top = instrumentPreis(bot, bot.coinM ? unten : oben), bottom = instrumentPreis(bot, bot.coinM ? oben : unten)
    const trend = String(roh.trend || 'long')
    const { base, quote } = basisQuote(bot)
    const daten = { top, bottom, row: anzahl, grid_type: art, trend, leverage: hebel, quoteInvestment: String(einsatz) }
    // Art des Bots übernehmen (Coin-M: cateType, Margin-Münze, UI-Kennung), soweit vorhanden
    for (const feld of ['investCoin', 'cateType', 'uiExtraData']) if (roh[feld]) daten[feld] = roh[feld]
    const pruefDaten = { top, bottom, row: anzahl, grid_type: art, trend, leverage: hebel, quote_investment: String(einsatz), extra_margin: false }
    return {
        aktion,
        pruefen: { pfad: `${PFAD}/checkParams`, body: { base, quote, buOrderData: pruefDaten } },
        senden: { pfad: `${PFAD}/create`, body: { base, quote, buOrderData: daten } },
        nachher: { unten, oben, anzahl, art, hebel, einsatz },
        warnungen: ['neuerBot', 'marktpreis'],
    }
}

/** Liquidationsschätzungen einer Prüfantwort in USD je Coin (Coin-M: invers, Seiten getauscht). */
export function liqAusPruefung(bot, data) {
    if (!data || typeof data !== 'object') return null
    const z = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
    const usd = (v) => (v == null ? null : bot.coinM ? 1 / v : v)
    const paar = (oben, unten) => {
        const a = usd(z(oben)), b = usd(z(unten))
        // Coin-M: „Up" des Instruments ist ein fallender Coin-Kurs
        return bot.coinM ? { unten: a, oben: b } : { unten: b, oben: a }
    }
    const vorher = paar(data.estimateLiquidationPriceUpBefore ?? data.estimateLiquidationPriceUp, data.estimateLiquidationPriceDownBefore ?? data.estimateLiquidationPriceDown)
    const nachher = paar(data.estimateLiquidationPriceUpAfter ?? data.estimate_liquidation_price_up, data.estimateLiquidationPriceDownAfter ?? data.estimate_liquidation_price_down)
    return { vorher, nachher }
}

/** Hat Pionex die Prüfung bestanden? */
export function pruefungBestanden(antwort) {
    if (!antwort || antwort.result === false) return false
    const d = antwort.data
    return !(d && d.checkResult === false)
}
