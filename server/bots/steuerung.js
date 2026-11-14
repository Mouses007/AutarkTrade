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
import { liqRisiko } from './pionex-bots.js'

const PFAD = '/api/v1/bot/orders/futuresGrid'
const SPOT_PFAD = '/api/v1/bot/orders/spotGrid'
export const AKTIONEN = ['band', 'investieren', 'margeDazu', 'margeWeg', 'stops', 'pausieren', 'fortsetzen', 'beenden', 'starten']
export const STEUERBAR = new Set(['futures_grid', 'coinm_grid', 'spot_grid'])
/**
 * Spot-Grid (14.11.2026): nur Starten (mit checkParams) und Beenden. Für Band,
 * Nachschiessen und Gewinn-Entnahme hat Pionex keine Prüfabfrage — ungeprüft
 * senden wir dort nichts. `create` nimmt höchstens 200 Grids.
 */
export const SPOT_AKTIONEN = ['beenden', 'starten']
export const SPOT_MAX_GRIDS = 200

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const leer = (v) => v === undefined || v === null || v === ''
/**
 * Zahl aus einer Eingabe: nur Dezimalschreibweise (Komma oder Punkt), sonst NaN.
 * Audit SEC-04: `Number()` nahm „0x10" als 16 und „1e3" als 1000 an.
 */
const zahl = (v) => {
    if (leer(v)) return null
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN
    const t = String(v).trim()
    return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN
}

/** Nachkommastellen eines API-Preises („0.0105263" → 7). */
export function stellenVon(...texte) {
    let n = 0
    for (const t of texte) {
        const s = String(t ?? '')
        const i = s.indexOf('.')
        if (i >= 0) n = Math.max(n, s.length - i - 1)
    }
    return Math.min(n, 12)
}

/**
 * Preis in USD je Coin → Preis-Text des Instruments. Gerundet auf die
 * Preispräzision des Kontrakts (`stellen`, aus Pionex' Symboltabelle:
 * `quotePrecision`, z. B. USDT_SOL_PERP 7, USDT_BTC_PERP 11). Ohne Tabelle
 * Rückfall auf die Stellen der heutigen API-Preise des Bots, mindestens
 * 6 signifikante Stellen (Audit SEC-03: aus 95 000 USD wurde sonst 95 238).
 */
export function instrumentPreis(bot, usd, stellen = null) {
    if (!istZahl(usd) || usd <= 0) return null
    const p = bot.coinM ? 1 / usd : usd
    let n = Number.isInteger(stellen) && stellen >= 0 ? stellen : null
    if (n == null) {
        const roh = bot.roh || {}
        const ausBand = stellenVon(roh.top, roh.bottom)
        n = ausBand > 0 ? ausBand : Math.min(12, Math.max(0, 6 - Math.floor(Math.log10(p)) - 1))
    }
    return p.toFixed(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/** Der tatsächlich gesendete Preis zurück in USD je Coin (für die Anzeige „nachher"). */
export function usdAusInstrument(bot, text) {
    const n = Number(text)
    if (!(n > 0)) return null
    return bot.coinM ? 1 / n : n
}

/** Weicht der gerundete Preis um mehr als 0,05 % von der Eingabe ab? */
function gerundetWarnung(eingaben, warnungen) {
    for (const [ein, aus] of eingaben) {
        if (istZahl(ein) && istZahl(aus) && Math.abs(aus - ein) / ein > 0.0005) { warnungen.push('gerundet'); return }
    }
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
        hebel: bot.hebel ?? null, einsatz: bot.einsatz?.basis ?? bot.einsatz?.aktuell ?? null, extraMarge: bot.einsatz?.extraMarge ?? null,
        stopLoss: bot.stops?.stopLoss?.wert ?? null, takeProfit: bot.stops?.takeProfit?.wert ?? null,
        status: bot.status, liquidation: liqRisiko(bot.richtung, bot.liquidation, bot.kurs),
    }
}

/**
 * Anfrage für eine Aktion bauen.
 * @returns {{fehler}} oder {aktion, pruefen: {pfad, body}|null, senden: {pfad, body}, nachher, warnungen}
 */
export function baueAktion(bot, aktion, eingabe = {}, { kurs = bot?.kurs, stellen = null } = {}) {
    if (!bot || !STEUERBAR.has(bot.typ)) return { fehler: 'typ' }
    if (!AKTIONEN.includes(aktion)) return { fehler: 'aktion' }
    if (aktion !== 'starten' && !bot.laufend) return { fehler: 'nichtLaufend' }
    if (bot.typ === 'spot_grid') return baueSpotAktion(bot, aktion, eingabe, { kurs, stellen })
    const id = bot.id
    const warnungen = []
    const ip = (usd) => instrumentPreis(bot, usd, stellen)
    const openPrice = istZahl(kurs) && kurs > 0 ? Number(ip(kurs)) : null
    const basis = bot.einsatz?.basis ?? bot.einsatz?.aktuell ?? null

    if (aktion === 'band') {
        const unten = zahl(eingabe.unten) ?? bot.grid?.unten, oben = zahl(eingabe.oben) ?? bot.grid?.oben
        const anzahl = zahl(eingabe.anzahl) ?? bot.grid?.anzahl
        if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
        if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > 500) return { fehler: 'anzahl' }
        if (istZahl(kurs) && (oben < kurs / 5 || unten > kurs * 5)) return { fehler: 'weitWeg' }
        if (openPrice == null) return { fehler: 'kurs' }
        const top = ip(bot.coinM ? unten : oben), bottom = ip(bot.coinM ? oben : unten)
        const body = { buOrderId: id, type: 'adjust_params', extraMargin: false, openPrice, top, bottom, row: anzahl, keepInvestment: true }
        // Anzeige: was wirklich gesendet wird, in USD zurückgerechnet
        const untenGesendet = usdAusInstrument(bot, bot.coinM ? top : bottom), obenGesendet = usdAusInstrument(bot, bot.coinM ? bottom : top)
        warnungen.push('marktpreis')
        gerundetWarnung([[unten, untenGesendet], [oben, obenGesendet]], warnungen)
        if (istZahl(kurs) && (kurs < unten || kurs > oben)) warnungen.push('kursAusserhalb')
        if (bot.richtung !== 'SHORT' && istZahl(bot.grid?.unten) && unten < bot.grid.unten) warnungen.push('liqNaeherBand')
        if (bot.richtung === 'SHORT' && istZahl(bot.grid?.oben) && oben > bot.grid.oben) warnungen.push('liqNaeherBand')
        return { aktion, pruefen: { pfad: `${PFAD}/adjustParamsCheck`, body }, senden: { pfad: `${PFAD}/adjustParams`, body }, nachher: { unten: untenGesendet, oben: obenGesendet, anzahl }, warnungen }
    }
    if (aktion === 'investieren') {
        const betrag = zahl(eingabe.betrag)
        if (!istZahl(betrag) || betrag <= 0) return { fehler: 'betrag' }
        if (openPrice == null) return { fehler: 'kurs' }
        const body = { buOrderId: id, type: 'invest_in', extraMargin: false, openPrice, quoteInvestment: betrag }
        warnungen.push('positionGroesser')
        if (istZahl(basis) && betrag > basis) warnungen.push('grosserBetrag')
        return { aktion, pruefen: { pfad: `${PFAD}/adjustParamsCheck`, body }, senden: { pfad: `${PFAD}/adjustParams`, body }, nachher: { einsatz: (basis ?? 0) + betrag }, warnungen }
    }
    if (aktion === 'margeDazu' || aktion === 'margeWeg') {
        const betrag = zahl(eingabe.betrag)
        if (!istZahl(betrag) || betrag <= 0) return { fehler: 'betrag' }
        const dazu = aktion === 'margeDazu'
        const extra = bot.einsatz?.extraMarge
        if (!dazu && istZahl(extra) && betrag > extra) return { fehler: 'zuViel' }
        if (!dazu) warnungen.push('liqNaeher')
        if (dazu && istZahl(basis) && betrag > basis) warnungen.push('grosserBetrag')
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
        if (slAn && sl != null && !istZahl(sl)) return { fehler: 'stopLoss' }
        if (tpAn && tp != null && !istZahl(tp)) return { fehler: 'takeProfit' }
        const slText = slAn && sl != null ? ip(sl) : '', tpText = tpAn && tp != null ? ip(tp) : ''
        if (slAn) liste.push({ type: 'stop_loss', stop_type: 'price', value: slText, stop_delay: 0 })
        if (tpAn) liste.push({ type: 'stop_profit', stop_type: 'price', value: tpText, stop_delay: 0 })
        gerundetWarnung([[sl, usdAusInstrument(bot, slText)], [tp, usdAusInstrument(bot, tpText)]], warnungen)
        if (slAn && sl == null && bot.stops?.stopLoss) warnungen.push('stopEntfernt')
        const liq = liqRisiko(bot.richtung, bot.liquidation, kurs)
        if (sl != null && istZahl(liq) && (bot.richtung !== 'SHORT' ? sl <= liq : sl >= liq)) warnungen.push('stopHinterLiq')
        warnungen.push('ohnePruefung')
        return { aktion, pruefen: null, senden: { pfad: `${PFAD}/updateTriggerProfitLoss`, body: { bu_order_id: id, list: liste } }, nachher: { stopLoss: slAn ? (sl == null ? null : usdAusInstrument(bot, slText)) : undefined, takeProfit: tpAn ? (tp == null ? null : usdAusInstrument(bot, tpText)) : undefined }, warnungen }
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
    const einsatz = zahl(eingabe.einsatz) ?? bot.einsatz?.basis ?? bot.einsatz?.aktuell
    const art = eingabe.art === 'geometric' ? 'geometric' : eingabe.art === 'arithmetic' ? 'arithmetic' : (bot.grid?.art || 'arithmetic')
    if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > 500) return { fehler: 'anzahl' }
    if (!istZahl(hebel) || hebel < 1 || hebel > 125 || !Number.isInteger(hebel)) return { fehler: 'hebel' }
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'betrag' }
    // Ohne Kurs keine Plausibilitätsprüfung — dann gar nicht (Audit FUN-07)
    if (!istZahl(kurs) || kurs <= 0) return { fehler: 'kurs' }
    if (oben < kurs / 5 || unten > kurs * 5) return { fehler: 'weitWeg' }
    const top = ip(bot.coinM ? unten : oben), bottom = ip(bot.coinM ? oben : unten)
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
        nachher: { unten: usdAusInstrument(bot, bot.coinM ? top : bottom), oben: usdAusInstrument(bot, bot.coinM ? bottom : top), anzahl, art, hebel, einsatz },
        warnungen: ['neuerBot', 'marktpreis', ...(istZahl(basis) && einsatz > 2 * basis ? ['grosserBetrag'] : [])],
    }
}

/**
 * Spot-Grid: Starten und Beenden (rein). Preise sind USDT je Coin, ohne Umrechnung.
 * checkParams verlangt snake_case, create camelCase (Pionex-Doku, gesehen 14.11.2026).
 * Beenden mit `closeSellModel: NOT_SELL` (Vorgabe von Pionex): die Coins bleiben im
 * Konto, es wird nichts zum Marktpreis verkauft.
 */
function baueSpotAktion(bot, aktion, eingabe, { kurs, stellen }) {
    if (!SPOT_AKTIONEN.includes(aktion)) return { fehler: 'nichtFuerSpot' }
    if (aktion === 'beenden') {
        return { aktion, pruefen: null, senden: { pfad: `${SPOT_PFAD}/cancel`, body: { buOrderId: bot.id, closeSellModel: 'NOT_SELL' } }, nachher: { status: 'canceled' }, warnungen: ['beenden', 'spotBehaelt', 'ohnePruefung'] }
    }
    const unten = zahl(eingabe.unten) ?? bot.grid?.unten, oben = zahl(eingabe.oben) ?? bot.grid?.oben
    const anzahl = zahl(eingabe.anzahl) ?? bot.grid?.anzahl
    const einsatz = zahl(eingabe.einsatz) ?? bot.einsatz?.basis ?? bot.einsatz?.aktuell
    const art = eingabe.art === 'geometric' ? 'geometric' : eingabe.art === 'arithmetic' ? 'arithmetic' : (bot.grid?.art || 'arithmetic')
    if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > SPOT_MAX_GRIDS) return { fehler: 'anzahl' }
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'betrag' }
    if (!istZahl(kurs) || kurs <= 0) return { fehler: 'kurs' }
    if (oben < kurs / 5 || unten > kurs * 5) return { fehler: 'weitWeg' }
    const ip = (usd) => instrumentPreis({ ...bot, coinM: false }, usd, stellen)
    const top = ip(oben), bottom = ip(unten)
    const base = bot.coin, quote = 'USDT'
    const basis = bot.plan ? null : (bot.einsatz?.basis ?? bot.einsatz?.aktuell ?? null)
    const warnungen = ['neuerBot', 'spotKauf', ...(istZahl(basis) && einsatz > 2 * basis ? ['grosserBetrag'] : [])]
    if (kurs < unten || kurs > oben) warnungen.push('kursAusserhalb')
    gerundetWarnung([[unten, Number(bottom)], [oben, Number(top)]], warnungen)
    return {
        aktion,
        pruefen: { pfad: `${SPOT_PFAD}/checkParams`, body: { base, quote, buOrderData: { top, bottom, row: anzahl, grid_type: art, quote_total_investment: String(einsatz) } } },
        senden: { pfad: `${SPOT_PFAD}/create`, body: { base, quote, buOrderData: { top, bottom, row: anzahl, gridType: art, quoteTotalInvestment: String(einsatz) } } },
        nachher: { unten: Number(bottom), oben: Number(top), anzahl, art, einsatz },
        warnungen,
    }
}

/** Mindesteinsatz aus einer Spot-Prüfantwort (Pionex nennt ihn dort: `min_investment`). */
export function minAusPruefung(antwort) {
    const n = Number(antwort?.data?.min_investment ?? antwort?.data?.minInvestment)
    return Number.isFinite(n) && n > 0 ? n : null
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

/**
 * Warum hat Pionex eine Prüfung abgelehnt? Ein Code für die Oberfläche, wo der
 * Grund bekannt ist, sonst null (dann zeigt sie den Text von Pionex).
 * Gesehen 12.11.2026: „[BOT_INVALID_ARGUMENT] less than min investment".
 */
export function pruefGrund(antwort) {
    if (!antwort || pruefungBestanden(antwort)) return null
    const text = [antwort.message, antwort.code, antwort.data?.reason, antwort.data?.message].filter(Boolean).join(' ')
    if (/less than min(imum)?[ _]?invest/i.test(text)) return 'einsatzZuKlein'
    // Spot-Grid: Pionex nennt min_investment in der Antwort; der Wortlaut der Absage ist noch nicht gesehen
    if (/invest/i.test(text) && minAusPruefung(antwort)) return 'einsatzZuKlein'
    return null
}

/** Rundet einen Einsatz auf eine handliche Zahl nach OBEN (nie unter das Gemessene). */
export function rundeEinsatzAuf(x) {
    if (!(x > 0)) return null
    const schritt = x < 10 ? 0.1 : x < 100 ? 1 : x < 1000 ? 5 : 10 ** (Math.floor(Math.log10(x)) - 1)
    return Number((Math.ceil(x / schritt - 1e-9) * schritt).toFixed(2))
}

/**
 * Mindesteinsatz suchen, den Pionex für einen neuen Bot annimmt. Pionex nennt
 * ihn nicht; also prüfen (checkParams sendet nichts) und eingrenzen: vom Start
 * aus verdoppeln bzw. halbieren, bis ein abgelehnter und ein angenommener
 * Betrag bekannt sind, dann geometrisch halbieren bis auf `genau` (5 %).
 *
 * `pruefe(einsatz)` → 'ok' | 'zuKlein' | 'anders'. „anders" (ein anderer Grund)
 * beendet die Suche, solange noch kein Betrag angenommen wurde — darüber kann
 * die Suche nichts sagen. `lo` = schon bekannt zu klein.
 * Ergebnis: {min, genau, schritte} oder {fehler: 'anders'|'grenze'|'schritte', schritte}.
 */
export async function sucheMindestEinsatz(pruefe, { start, lo = null, hi = null, max = 100_000, genau = 0.05, maxSchritte = 14 } = {}) {
    let n = 0
    let x = start > 0 ? start : lo > 0 ? lo * 2 : 10
    while (lo == null || hi == null) {
        if (n >= maxSchritte) return { fehler: 'schritte', schritte: n }
        if (x > max) return { fehler: 'grenze', schritte: n }
        const r = await pruefe(x); n++
        if (r === 'ok') hi = x
        else if (r === 'zuKlein' || (r === 'anders' && hi != null)) lo = x
        else return { fehler: 'anders', schritte: n }
        if (hi == null) x = x * 2
        else if (lo == null) {
            if (x / 2 < 0.5) return { min: rundeEinsatzAuf(hi), genau: hi, schritte: n }
            x = x / 2
        }
    }
    while (hi / lo > 1 + genau && n < maxSchritte) {
        const mitte = Math.sqrt(lo * hi)
        const r = await pruefe(Number(mitte.toFixed(2))); n++
        if (r === 'ok') hi = Number(mitte.toFixed(2)); else lo = mitte
    }
    return { min: rundeEinsatzAuf(hi), genau: hi, schritte: n }
}
