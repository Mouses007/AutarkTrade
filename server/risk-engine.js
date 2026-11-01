/**
 * Risiko-Gates.
 *
 * Diese Prüfungen sind CODE, keine Prompt-Anweisung an ein Sprachmodell. Ein
 * LLM kann sie damit weder überreden noch übersehen. Sie laufen vor JEDER
 * Ausführung — im Backtest, im Papier- und im Schattenbetrieb — und zwar
 * identisch. (Orders sendet AutarkTrade seit S13 keine.)
 *
 * Rein: alle Zustände (Kontostand, offene Positionen, Tages-PnL) kommen als
 * Argumente rein. Die Engine holt sie aus der DB, der Backtest aus seiner
 * Simulation. Nur so rechnen beide gleich.
 */

import { satzFuer, einstiegsSorte, MARKT, LIMIT } from './fill-simulator.js'

/** Warum eine Ausführung abgelehnt wurde — landet in `strategy_runs.reason`. */
export const RISK_REASONS = {
    KILL_SWITCH: 'kill_switch',
    DAILY_LOSS: 'daily_loss_limit',
    MAX_POSITIONS: 'max_concurrent_positions',
    COOLDOWN: 'symbol_cooldown',
    DUPLICATE: 'symbol_already_open',
    BELOW_MIN_RR: 'below_min_rr',
    SIZE_TOO_SMALL: 'size_too_small',
    NO_EQUITY: 'no_equity',
    BAD_LEVELS: 'invalid_levels',
}

/**
 * Positionsgrösse aus dem Risiko je Trade.
 *
 *   qty = (Kontostand × riskPerTradePct/100) / |Einstieg − Stop|
 *
 * Der Hebel bestimmt NICHT die Grösse, sondern nur, wie viel Marge sie bindet.
 * Das ist der Unterschied zwischen Risikosteuerung und Zockerei.
 *
 * @returns {{ qty, notionalUsdt, marginUsdt, riskUsd, capped, reason? }}
 */
export function computePositionSize({
    equity, riskPerTradePct, entry, stopLoss, leverage = 1,
    maxNotionalUsdt = Infinity, stepSize = 0, minQty = 0, minNotional = 0, maxQty = 0,
    costs = {}, setup = null,
}) {
    const abstand = Math.abs(entry - stopLoss)
    if (!(equity > 0)) return { qty: 0, reason: RISK_REASONS.NO_EQUITY }
    if (!(abstand > 0) || !(entry > 0)) return { qty: 0, reason: RISK_REASONS.BAD_LEVELS }

    const riskUsd = equity * (riskPerTradePct / 100)
    // Der Verlust am Stop ist nicht nur der Kursabstand: beide Seiten kosten
    // Gebühr, und die Marktseiten rutschen. Ohne diesen Anteil liegt das echte
    // Risiko über dem eingestellten Prozentsatz — bei engen Stops um ein
    // Vielfaches.
    //
    // Gerechnet wird der WEG ZUM STOP, nicht ein Durchschnitt beider Ausgänge:
    // der Einstieg zu seiner Ordersorte, der Ausstieg als Stop-Market. Das ist
    // die teurere der beiden Seiten — und die Positionsgrösse soll sich am
    // schlechten Ausgang bemessen, nicht am guten.
    // Mit dem Setup: ein Stop- oder Markt-Einstieg zahlt Taker und Slippage,
    // auch wenn die Vorgabe Limit ist. Bis 01.11.2026 wurde hier ohne Setup
    // gefragt — die Grösse war mit Maker-Kosten bemessen, gefüllt wurde mit
    // Taker, und das echte Risiko lag über dem eingestellten Prozentsatz.
    const ein = satzFuer(costs, einstiegsSorte(costs, setup))
    const aus = satzFuer(costs, MARKT)
    const kostenBps = ein.feeBps + ein.slippageBps + aus.feeBps + aus.slippageBps
    const kostenJeEinheit = entry * kostenBps / 10000
    let qty = riskUsd / (abstand + kostenJeEinheit)
    let capped = false

    // Notional-Deckel in USDT — wirkt unabhängig vom Prozent-Risiko und ist
    // der eigentliche Schutz gegen einen zu engen Stop.
    if (maxNotionalUsdt > 0 && qty * entry > maxNotionalUsdt) {
        qty = maxNotionalUsdt / entry
        capped = true
    }

    // Marge darf den Kontostand nicht übersteigen
    const maxQtyByMargin = (equity * (leverage || 1)) / entry
    if (qty > maxQtyByMargin) {
        qty = maxQtyByMargin
        capped = true
    }

    const gerundet = rundeMenge(qty, entry, { stepSize, minQty, minNotional, maxQty })
    if (gerundet.capped) capped = true
    qty = gerundet.qty
    const notionalUsdt = qty * entry
    if (!qty) {
        return { qty: 0, notionalUsdt, marginUsdt: 0, riskUsd, capped, reason: gerundet.reason }
    }

    return {
        qty,
        notionalUsdt,
        marginUsdt: notionalUsdt / (leverage || 1),
        riskUsd: abstand * qty,
        capped,
    }
}

/**
 * Mengengrenzen der Börse für eine Ordersorte. Pionex führt getrennte Grenzen
 * für Limit- und Marktorders (`maxSizeMarket` ist bei BTC ein Fünftel von
 * `maxSizeLimit`, siehe pionex-meta.js); die übrigen Quellen kennen nur eine.
 */
export function grenzenFuer(meta = {}, sorte = MARKT) {
    const limit = sorte === LIMIT
    return {
        stepSize: Number(meta.stepSize) || 0,
        minQty: Number(limit ? meta.minQtyLimit : 0) || Number(meta.minQty) || 0,
        maxQty: Number(limit ? meta.maxQtyLimit : 0) || Number(meta.maxQty) || 0,
        minNotional: Number(meta.minNotional) || 0,
    }
}

/**
 * Eine Menge auf die Börsenregeln bringen: höchstens `maxQty`, auf `stepSize`
 * abgerundet, mindestens `minQty` und `minNotional`. Liefert `qty: 0` mit
 * Grund, wenn nichts Zulässiges übrig bleibt.
 *
 * Eigene Funktion, weil die Engine eine Menge nach dem Faktor des
 * Veto-Agenten NOCHMALS bringen muss — bis 01.11.2026 ging die verkleinerte
 * Menge ungerundet und ungeprüft in den Schattenbetrieb, dessen Zweck gerade
 * die zulässige Menge ist.
 *
 * Gerechnet wird in GANZEN Schritten, die Nachkommastellen kommen aus der
 * Schrittweite selbst. Bis 31.10.2026 leitete `-log10(stepSize)` sie ab — für
 * 0,5 oder 0,25 ergab das 0 bzw. 1 Stelle, und `toFixed` rundete die schon
 * abgerundete Menge wieder AUF (2,5 → 3, auch über `maxQty` hinaus).
 */
export function rundeMenge(qty, entry, { stepSize = 0, minQty = 0, minNotional = 0, maxQty = 0 } = {}) {
    let menge = Number(qty) || 0
    let capped = false
    if (maxQty > 0 && menge > maxQty) { menge = maxQty; capped = true }
    if (stepSize > 0) {
        const schritte = Math.floor(menge / stepSize + 1e-9)
        menge = Number((schritte * stepSize).toFixed(stellenVon(stepSize)))
        // Sicherheitsnetz: die Rundung darf nie über die Höchstmenge führen.
        if (maxQty > 0 && menge > maxQty) {
            menge = Number(((schritte - 1) * stepSize).toFixed(stellenVon(stepSize)))
        }
    }
    const notional = menge * entry
    if (!(menge > 0) || (minQty > 0 && menge < minQty) || (minNotional > 0 && notional < minNotional)) {
        return { qty: 0, capped, reason: RISK_REASONS.SIZE_TOO_SMALL }
    }
    return { qty: menge, capped }
}

/** Nachkommastellen einer Schrittweite: 0,25 → 2, 5 → 0, 1e-8 → 8. */
export function stellenVon(schritt) {
    const s = String(Number(schritt))
    const exp = s.match(/e-(\d+)$/)
    if (exp) {
        const mantisse = s.slice(0, s.indexOf('e'))
        const punkt = mantisse.indexOf('.')
        return Math.min(20, Number(exp[1]) + (punkt < 0 ? 0 : mantisse.length - punkt - 1))
    }
    const punkt = s.indexOf('.')
    return punkt < 0 ? 0 : Math.min(20, s.length - punkt - 1)
}

/**
 * Alle Gates in einem Durchlauf.
 *
 * @param {object} ctx
 * @param {object} ctx.setup            getriggertes Setup (entry, stopLoss, takeProfit, rr, symbol)
 * @param {object} ctx.risk             validierte Risiko-Parameter der Instanz
 * @param {number} ctx.equity           aktueller Kontostand in USDT
 * @param {Array}  ctx.openPositions    offene Positionen der Instanz
 * @param {number} ctx.todayNetPnl      heute realisierter Netto-PnL (negativ = Verlust)
 * @param {object} ctx.lastExitBySymbol { symbol: exitTime } für den Cooldown
 * @param {number} ctx.now              Zeitstempel des Auslösers
 * @param {object} [ctx.marketMeta]     { stepSize, minQty, minNotional, maxQty }
 * @param {boolean}[ctx.killSwitch]
 *
 * @returns {{ ok: boolean, reason?: string, detail?: string, size?: object }}
 */
export function evaluateRisk(ctx) {
    const {
        setup, risk, equity, openPositions = [], todayNetPnl = 0,
        lastExitBySymbol = {}, now = 0, marketMeta = {},
        killSwitch = false,
    } = ctx

    if (killSwitch) return { ok: false, reason: RISK_REASONS.KILL_SWITCH }

    if (!(setup?.entry > 0) || !(setup?.stopLoss > 0)) {
        return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    }
    // Stop muss auf der richtigen Seite liegen — sonst ist die Rechnung Unsinn
    const seiteOk = setup.direction === 'long'
        ? setup.stopLoss < setup.entry
        : setup.stopLoss > setup.entry
    if (!seiteOk) return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    // Auch das Ziel muss auf der richtigen Seite liegen. Ein Long mit Ziel
    // UNTER dem Einstieg würde fast sofort als 'tp' schliessen — mit Verlust,
    // der in der Statistik als Treffer zählt.
    if (setup.takeProfit > 0) {
        const zielOk = setup.direction === 'long'
            ? setup.takeProfit > setup.entry
            : setup.takeProfit < setup.entry
        if (!zielOk) return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    }

    // Tagesverlust-Limit: gilt VOR jeder neuen Order, nicht erst danach.
    // Bemessen am Kontostand zu TAGESBEGINN — am laufenden Stand schrumpfte
    // das Limit mit jedem Verlust des Tages und griff früher als eingestellt.
    const tagesBeginn = equity - todayNetPnl
    const limit = tagesBeginn * (risk.maxDailyLossPct / 100)
    if (limit > 0 && todayNetPnl <= -limit) {
        return {
            ok: false, reason: RISK_REASONS.DAILY_LOSS,
            detail: `heute ${todayNetPnl.toFixed(2)} USDT, Limit −${limit.toFixed(2)}`,
        }
    }

    if (openPositions.length >= risk.maxConcurrentPositions) {
        return { ok: false, reason: RISK_REASONS.MAX_POSITIONS, detail: `${openPositions.length} offen` }
    }

    // Nicht zweimal dasselbe Symbol — sonst wird aus 1 % Risiko unbemerkt 2 %.
    // Fährt die Instanz mehrere Zeiteinheiten, darf jede eine eigene Position
    // halten, WENN das ausdrücklich eingestellt ist (`symbol_tf`): sonst
    // verdrängt die schnellste Zeiteinheit dauerhaft die langsameren und der
    // Vergleich zwischen ihnen misst nur noch, wer zuerst da war.
    const jeZeiteinheit = risk.duplicateScope === 'symbol_tf'
    const belegt = openPositions.some((p) => p.symbol === setup.symbol
        && (!jeZeiteinheit || p.timeframe === setup.timeframe))
    if (belegt) {
        return {
            ok: false, reason: RISK_REASONS.DUPLICATE,
            detail: jeZeiteinheit ? `${setup.symbol} ${setup.timeframe}` : setup.symbol,
        }
    }

    if (risk.cooldownMinutes > 0) {
        // Die Sperrfrist folgt derselben Aufteilung: bei `symbol_tf` blockiert
        // ein 15m-Ausstieg nicht mehr den 1h-Einstieg.
        const letzter = (jeZeiteinheit
            ? lastExitBySymbol[`${setup.symbol}|${setup.timeframe}`]
            : lastExitBySymbol[setup.symbol]) || 0
        const wartet = (now - letzter) / 60000
        if (letzter && wartet < risk.cooldownMinutes) {
            return {
                ok: false, reason: RISK_REASONS.COOLDOWN,
                detail: `noch ${Math.ceil(risk.cooldownMinutes - wartet)} min`,
            }
        }
    }

    // Chancen/Risiko-Filter. Setups ohne festes Ziel (Swing-Runner, tp=0)
    // können kein RR haben und werden deshalb nicht daran gemessen.
    if (setup.takeProfit > 0 && risk.minRR > 0 && setup.rr > 0 && setup.rr < risk.minRR) {
        return {
            ok: false, reason: RISK_REASONS.BELOW_MIN_RR,
            detail: `${setup.rr.toFixed(2)} < ${risk.minRR}`,
        }
    }

    // Die Prüfung „Signalquelle und Handelsbörse laufen auseinander" galt
    // einer echten Marktorder; seit S13 sendet die Engine keine mehr, und der
    // Referenzkurs war immer 0. Mit dem Parameter `maxPriceDeviationPct` am
    // 01.11.2026 entfernt — beim Zurückholen des scharfen Handels neu bauen.

    const size = computePositionSize({
        equity,
        riskPerTradePct: risk.riskPerTradePct,
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        leverage: risk.leverage,
        maxNotionalUsdt: risk.maxNotionalUsdt,
        ...grenzenFuer(marketMeta, einstiegsSorte(risk, setup)),
        costs: risk,
        setup,
    })
    if (!size.qty) return { ok: false, reason: size.reason || RISK_REASONS.SIZE_TOO_SMALL }

    return { ok: true, size }
}

/** Beginn des Handelstages in der gewünschten Zeitzone (für das Tageslimit). */
export function startOfDayUtc(ts) {
    const d = new Date(ts)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
