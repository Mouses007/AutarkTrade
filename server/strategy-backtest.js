/**
 * Backtest.
 *
 * Läuft Kerze für Kerze durch die Historie und sieht dabei immer nur das, was
 * zu diesem Zeitpunkt schon geschlossen war — kein Blick nach vorn. Benutzt
 * exakt dieselben Bausteine wie der Live-Betrieb: denselben Detector, dieselbe
 * Risk-Engine, denselben Fill-Simulator. Ein Backtest, der eigene Regeln
 * anwendet, misst nur sich selbst.
 *
 * Der Backtest ist kein Beiwerk: ohne ihn sind Werte wie »Retest-Tiefe 25 %«
 * geraten. Er ist ausserdem das Werkzeug, mit dem der Optimizer-Agent seine
 * Vorschläge belegen muss, statt zu behaupten.
 */

import { getStrategy, validateParams, validateRisk, validateAgainstSchema, htfBedarf, sichtFensterKerzen } from './strategies/index.js'
import { getHistoricalCandles, timeframeMs, currentCandleOpen, getFundingHistory, getSymbolMeta } from './market-data.js'
import { fundingAusVerlauf } from './execution/zwischenstand.js'
import { evaluateRisk, startOfDayUtc } from './risk-engine.js'
import { wartungsmargeMitQuelle } from './margin-rates.js'
import { createPosition, stepCandle, closePosition, entryIsValid, kostenAus, einstiegsPreis, einstiegsZeit, riskPerUnit, fundingFor } from './fill-simulator.js'

/**
 * Obergrenze, damit ein versehentlicher 5-Jahres-Lauf den Server nicht blockiert.
 *
 * Zwei Jahre 15m plus Vorlauf. Bis 01.11.2026 waren es 20 000 — auf 15m
 * keine sieben Monate, zu wenig für eine Aussage. Gemessen 01.11.2026 auf
 * BTCUSDT 15m über zwei Jahre (70 080 Kerzen): Abruf 15 s, LSOB 3 s, Set and
 * Forget 10–25 s, Heap +100 MB. Die Schleife gibt die Ereignisschleife
 * zwischendurch frei (`ATEMPAUSE_MS`), der Server bleibt bedienbar.
 */
export const MAX_BACKTEST_CANDLES = 75000

/**
 * Nach so vielen Millisekunden Rechnen gibt die Backtest-Schleife die
 * Ereignisschleife einmal frei.
 *
 * Node führt JavaScript in EINEM Thread aus. Ohne diese Pausen lief die
 * Schleife von der ersten bis zur letzten Kerze durch, und der Prozess machte
 * so lange nichts anderes: keine Anfrage wurde angenommen, kein Engine-Takt
 * lief, kein Not-Aus kam durch. Gemessen am 16.08.2026: 20 000 Kerzen ≈ 520 ms
 * am Stück, ein Mehrfach-Test über mehrere Symbole entsprechend ein Vielfaches.
 * Im NAS-Container teilen sich Oberfläche und Engine denselben Prozess — dort
 * stand also beides still, solange jemand im Labor rechnete.
 *
 * 25 ms ist kurz genug, dass ein Takt im Sekundenraster nichts davon merkt, und
 * lang genug, dass die Pausen selbst kaum ins Gewicht fallen. Gemessen wird
 * VERSTRICHENE ZEIT statt einer festen Kerzenzahl: eine Regelstrategie mit
 * vielen Indikatoren rechnet je Kerze ein Mehrfaches einer einfachen, und eine
 * feste Zahl wäre für die eine zu grob und für die andere zu teuer.
 *
 * Am Ergebnis ändern die Pausen nichts — die Schleife hat keinen Zustand, den
 * jemand anders anfassen könnte. Nur die Laufzeit wird minimal länger.
 */
const ATEMPAUSE_MS = 25

/** Einmal die Ereignisschleife durchlassen. */
const atemholen = () => new Promise((fertig) => setImmediate(fertig))

/**
 * Rechenzeit, nach der ein Entwurf-Backtest abbricht (Audit 4.3.4,
 * SEC-S4-001). Die Atempausen halten die Bedienung frei, aber ein Entwurf
 * mit ATH-VWAP und einem nie gefüllten Limit rechnete auf 90 Tagen 15m schon
 * 85 s, auf 20 000 Kerzen eine Viertelstunde — und weitere Klicks stapelten
 * sich darauf. Gespeicherte Strategien laufen ohne diese Grenze.
 */
export const ENTWURF_ZEITBUDGET_MS = 120000

/**
 * Ab so vielen abgeschlossenen Trades gilt ein Ergebnis als belastbar.
 *
 * Darunter entscheiden Einzeltrades: gemessen am 16.08.2026 stand hinter einem
 * Erwartungswert von 1,467 R auf 4h ein EINZIGER Trade — ohne ihn blieben
 * −0,007 R übrig. Solche Zahlen sind nicht falsch, sie tragen nur nichts.
 */
export const MIN_TRADES_BELASTBAR = 30

/**
 * Deckt die gelieferte Kerzenreihe den angeforderten Zeitraum wirklich ab?
 *
 * Fehlende Daten fallen sonst NICHT auf: der Backtest rechnet klaglos weiter und
 * meldet Kennzahlen zu einem stillschweigend kürzeren Zeitraum. Typische
 * Ursachen sind ein späteres Listing des Symbols, Lücken beim Datenanbieter oder
 * ein Kerzen-Deckel, der hinten abschneidet — und abgeschnitten wird immer das
 * ENDE, also der jüngste und meist interessanteste Teil.
 */
export function pruefeAbdeckung(candles, fromTs, toTs, timeframe) {
    const ms = timeframeMs(timeframe)
    if (!ms || !candles?.length) {
        return { vorhanden: 0, erwartet: 0, prozent: 0, vollstaendig: false, von: 0, bis: 0, fehlend: [] }
    }
    const ende = Math.min(Number(toTs) || 0, currentCandleOpen(timeframe))
    const erwartet = Math.max(1, Math.ceil((ende - Number(fromTs)) / ms))
    const von = candles[0].t
    const bis = candles[candles.length - 1].t

    // Was am Rand fehlt, ist die gefährlichere Lücke: sie verschiebt den
    // gemessenen Zeitraum, statt ihn nur auszudünnen.
    const fehlend = []
    if (von > Number(fromTs) + ms * 1.5) fehlend.push('Anfang')
    if (bis < ende - ms * 1.5) fehlend.push('Ende')

    const prozent = Math.min(100, (candles.length / erwartet) * 100)
    return {
        vorhanden: candles.length, erwartet, prozent,
        vollstaendig: prozent >= 95 && !fehlend.length,
        von, bis, fehlend,
    }
}

function leeresErgebnis(grund) {
    return {
        stats: { trades: 0, hinweis: grund },
        trades: [], equityCurve: [], funnel: emptyFunnel(),
    }
}

function emptyFunnel() {
    // Zähler ohne Prototyp: die Schlüssel sind Codes aus Regelwerken, und ein
    // Code wie `constructor` oder `__proto__` griff sonst auf geerbte
    // Eigenschaften (Audit 4.3.4, BUG-S4-004). JSON und Spread sehen keinen
    // Unterschied.
    return {
        sweepsFound: 0,
        setupsDetected: 0,
        triggered: 0,
        executed: 0,
        invalidated: Object.create(null),     // warum ein Setup vor dem Einstieg starb
        riskRejected: Object.create(null),    // warum die Risk-Engine den Einstieg verweigerte
        entrySkipped: Object.create(null),    // warum der Fill nicht zustande kam
    }
}

const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1 }

/**
 * Ein Schritt der Floating-Drawdown-Verfolgung.
 *
 * `maxDrawdownPct` (siehe `berechneStatistik`) misst nur an Trade-ABSCHLÜSSEN
 * — eine Position, die zwischenzeitlich tief im Minus steht, bevor sie am Stop
 * schliesst, fliesst dort nicht ein. Hier wird JEDE Kerze zum ungünstigsten
 * Preis bewertet (dieselbe pessimistische Grundhaltung wie der Rest der
 * Datei): Tief bei Long, Hoch bei Short — nicht `pos.maePrice`, das ist der
 * Tiefstwert seit Einstieg und damit ein Wert PRO TRADE, keine Zeitreihe.
 *
 * Läuft als Peak-to-Trough auf einer eigenen Serie statt sie komplett zu
 * speichern — bei 20 000 Kerzen wäre das reiner Ballast für eine Zahl, die am
 * Ende nur EIN Prozentwert ist. Als eigene Funktion, damit sie ohne einen
 * kompletten Backtest-Lauf mit echter Strategie-Erkennung testbar ist.
 *
 * @param {{hoch:number, maxDd:number}} zustand  wird in place fortgeschrieben
 * @param {number} equity            realisierte Equity zu diesem Zeitpunkt
 * @param {Array}  offenePositionen  Positionen mit direction/entryPrice/qty
 * @param {{l:number,h:number}} kerze
 * @returns {number} Floating-Equity dieser Kerze
 */
export function floatingEquitySchritt(zustand, equity, offenePositionen, kerze) {
    let floatingEquity = equity
    for (const pos of offenePositionen) {
        const ungPreis = pos.direction === 'long' ? kerze.l : kerze.h
        floatingEquity += pos.direction === 'long'
            ? (ungPreis - pos.entryPrice) * pos.qty
            : (pos.entryPrice - ungPreis) * pos.qty
    }
    if (floatingEquity > zustand.hoch) zustand.hoch = floatingEquity
    if (zustand.hoch > 0) {
        const dd = ((zustand.hoch - floatingEquity) / zustand.hoch) * 100
        if (dd > zustand.maxDd) zustand.maxDd = dd
    }
    return floatingEquity
}

/**
 * @param {object} opts
 * @param {string} opts.strategyId
 * @param {object} opts.params      Roh-Parameter (werden validiert)
 * @param {object} opts.risk        Roh-Risikoparameter (werden validiert)
 * @param {string} opts.symbol
 * @param {string} opts.timeframe
 * @param {number} opts.fromTs / opts.toTs
 * @param {number} [opts.startEquity] Startkapital; ohne Angabe `risk.startEquityUsdt` (Vorgabe 1000)
 * @param {Array}  [opts.candles]   vorgeladene Kerzen (spart den Abruf)
 * @param {Array}  [opts.htfCandles] vorgeladene Kerzen der höheren Zeiteinheit
 * @param {number} [opts.maxLeverage] globaler Hebeldeckel wie im Betrieb
 * @param {number} [opts.zeitBudgetMs] Rechenzeit, nach der der Lauf abbricht
 *                 (Entwürfe, `ENTWURF_ZEITBUDGET_MS`); Ergebnis ohne Trades,
 *                 `stats.abgebrochen = 'zeit'`
 * @param {Function} [opts.abbrechen] liefert `true`, wenn niemand mehr auf das
 *                 Ergebnis wartet (Verbindung zu); `stats.abgebrochen = 'abbruch'`
 */
export async function runBacktest(opts) {
    // `opts.strategie`: ein Manifest, das nicht in der Registry steht — der
    // ungespeicherte Entwurf aus dem Regel-Editor (alsManifest). Ohne diesen Weg
    // rechnete der Test im Editor den GESPEICHERTEN Stand (bis 01.11.2026).
    const strategie = opts.strategie || getStrategy(opts.strategyId)
    if (!strategie) return leeresErgebnis(`Unbekannte Strategie: ${opts.strategyId}`)

    const { values: params } = opts.strategie
        ? validateAgainstSchema(strategie.params, opts.params || {})
        : validateParams(opts.strategyId, opts.params)
    const { values: risk } = validateRisk(opts.risk)

    // Derselbe Hebeldeckel wie im Betrieb.
    //
    // Die Risiko-Parameter erlauben bis 125×, die Engine kappt aber auf den
    // globalen Wert aus den Einstellungen — und zwar in JEDER Betriebsart.
    // Ohne diese Zeile misst das Labor eine Positionsgrösse, die der
    // Papierbetrieb derselben Instanz nie eingehen würde: bei engen Stops
    // begrenzt die Marge die Menge, und ein Backtest mit 50× nimmt dort ein
    // Vielfaches der Position, die live entstünde.
    const hebelDeckel = Number(opts.maxLeverage) > 0 ? Number(opts.maxLeverage) : Infinity
    const hebelEffektiv = Math.min(risk.leverage, hebelDeckel)
    const hebelGekappt = hebelEffektiv < risk.leverage
    risk.leverage = hebelEffektiv

    const symbol = String(opts.symbol || '').toUpperCase()
    const timeframe = opts.timeframe
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    // Startkapital: ausdrücklich übergeben, sonst `risk.startEquityUsdt` —
    // dasselbe Feld, mit dem eine Instanz im Papierbetrieb rechnet. Was hier
    // gerechnet wird, steht danach auch in `meta.risk`: ein gespeicherter Lauf
    // übergibt beim „Als Instanz starten" genau das Kapital, mit dem er
    // entstand. Bis 31.10.2026 rechnete das Labor immer mit 1000 und speicherte
    // daneben das angezeigte Startkapital (FUN-L5-001).
    const startEquity = Number(opts.startEquity) > 0 ? Number(opts.startEquity)
        : Number(risk.startEquityUsdt) > 0 ? Number(risk.startEquityUsdt) : 1000
    risk.startEquityUsdt = startEquity

    const candles = opts.candles || await getHistoricalCandles(
        symbol, timeframe, opts.fromTs, opts.toTs,
        { market, maxCandles: MAX_BACKTEST_CANDLES },
    )

    // Kerzen der höheren Zeiteinheit — nur laden, wenn der Filter auch an ist.
    //
    // Ohne sie läuft `htfTrendFilter` ins Leere: der Detector bekommt kein
    // `htfCandles`, `htfBias` bleibt null und die Bestätigung blockiert nie.
    // Der Lauf wird deswegen NICHT abgebrochen — aber er darf sich auch nicht
    // als gefilterter Lauf ausgeben. Das Ergebnis trägt deshalb `htfFilter`
    // mit, und die Anzeige macht daraus eine Warnung. Ein Parameter, der
    // heimlich nichts tut, ist schlimmer als keiner.
    const htfVerlangt = Boolean(params.htfTrendFilter && params.htfTimeframe
        && params.htfTimeframe !== timeframe)
    const htfFilter = {
        verlangt: htfVerlangt,
        timeframe: htfVerlangt ? params.htfTimeframe : null,
        aktiv: false, kerzen: 0, grund: htfVerlangt ? 'keine_daten' : 'aus',
    }
    let htfAlle = []
    if (htfVerlangt) {
        try {
            // Mit Vorlauf: die Strategie sieht im Betrieb immer ihr volles
            // HTF-Fenster (`htfKerzen`). Ohne Vorlauf wäre die EMA in den
            // ersten Monaten eines Laufs nicht eingeschwungen.
            const vorlauf = htfBedarf(strategie, params) * timeframeMs(params.htfTimeframe)
            htfAlle = opts.htfCandles || await getHistoricalCandles(
                symbol, params.htfTimeframe, opts.fromTs - vorlauf, opts.toTs,
                { market, maxCandles: MAX_BACKTEST_CANDLES },
            )
        } catch (e) {
            htfAlle = []
            htfFilter.grund = 'abruf_fehlgeschlagen'
        }
        // Reicht die Reihe vorn weit genug zurück? Vorgeladene HTF-Kerzen
        // (Robustheit, Messskript) ab Laufbeginn statt ab Laufbeginn minus
        // Bedarf liessen die Strategie die ersten Monate ohne HTF-Lage und
        // danach mit verkürztem Fenster rechnen — so geschehen im Messskript
        // bis 31.10.2026 (Audit 4.3.4, BUG-L4-003). Der Lauf rechnet trotzdem,
        // trägt die Lücke aber mit.
        const htfVorlaufMs = htfBedarf(strategie, params) * timeframeMs(params.htfTimeframe)
        if (htfAlle.length && htfVorlaufMs > 0
            && htfAlle[0].t > Number(opts.fromTs) - htfVorlaufMs + 1.5 * timeframeMs(params.htfTimeframe)) {
            htfFilter.vorlaufFehlt = true
            htfFilter.vorlaufAb = htfAlle[0].t
        }
        // Eine Handvoll Kerzen reicht nicht: der Trendfilter braucht seine EMA,
        // sonst greift er erst weit im Zeitraum und misst vorher nichts.
        const noetig = (params.htfEmaPeriod || 50) + 5
        htfFilter.kerzen = htfAlle.length
        if (htfAlle.length >= noetig) {
            htfFilter.aktiv = true
            htfFilter.grund = 'aktiv'
        } else if (htfAlle.length > 0) {
            htfFilter.grund = 'zu_wenige_kerzen'
            htfFilter.noetig = noetig
        }
    }
    let htfZeiger = 0
    const htfMs = params.htfTimeframe ? timeframeMs(params.htfTimeframe) : 0
    const ltfMs = timeframeMs(timeframe)

    const warmup = strategie.warmupCandles || 200
    if (candles.length <= warmup + 10) {
        return leeresErgebnis(`Zu wenige Kerzen (${candles.length}, mindestens ${warmup + 11} nötig)`)
    }

    // Gleitendes Fenster statt der kompletten Historie: der Detector schaut
    // ohnehin nur `scanWindowCandles` zurück, und ein volles Slice je Kerze
    // wäre bei Jahresläufen quadratisch.
    //
    // ABER: verankerte Linien brauchen ihren Anker. Ein Monats-VWAP auf 15m
    // liegt knapp 2900 Kerzen zurück — mit dem Standardfenster von ein paar
    // Hundert wäre seine Linie unbekannt, und der Interpreter liefert dann
    // bewusst `null` statt einer erfundenen Linie. Deshalb fragt der Backtest
    // das Regelwerk, wie weit es zurücksehen muss. `Infinity` (ATH/ATL) heisst:
    // die ganze geladene Historie, also kein Ausschnitt. Dieselbe Rechnung wie
    // in der Engine (`sichtFensterKerzen`): Indikatorperioden und das eigene
    // Fenster einer Strategie (`ltfKerzen`) zählen seit 31.10.2026 mit.
    const sichtBedarf = sichtFensterKerzen(strategie, params, ltfMs)
    const volleHistorie = sichtBedarf === Infinity
    const fenster = volleHistorie ? 0 : sichtBedarf

    const costs = kostenAus(risk)

    // Rundung und Mindestmengen der Marktdatenquelle — dieselben, die der
    // Papierbetrieb anlegt. Ohne sie gab es `size_too_small` nur im Papier,
    // und der Backtest handelte Mengen, die es dort nicht gab.
    let marketMeta = opts.marketMeta
    if (marketMeta === undefined) {
        try { marketMeta = await getSymbolMeta(symbol, { market }) } catch { marketMeta = null }
    }
    marketMeta = marketMeta || {}

    // Funding aus dem ECHTEN Verlauf, wie der Zwischenstand offener Positionen
    // und der Papierbetrieb beim Schliessen. Die Annahme `fundingBpsPer8h`
    // (Vorgabe 0) gilt nur noch, wenn kein Verlauf zu haben ist — bis
    // 01.11.2026 rechnete jeder Lauf mit ihr, also meist ohne Funding.
    let fundingVerlauf = null
    if (market === 'futures') {
        try {
            fundingVerlauf = opts.fundingVerlauf !== undefined
                ? opts.fundingVerlauf
                : await getFundingHistory(symbol, opts.fromTs, opts.toTs)
        } catch { fundingVerlauf = null }
    }
    const mitFundingVerlauf = Array.isArray(fundingVerlauf) && fundingVerlauf.length > 0

    // Deckt der Verlauf den gehandelten Zeitraum überhaupt ab?
    //
    // Bitget liefert nur rund 90 Tage zurück (270 Abrechnungen), egal wie weit
    // man blättert. Bis 31.10.2026 bekam jeder Trade davor Funding 0, und der
    // Lauf meldete trotzdem „aus dem Verlauf" (Audit 4.3.4, FUN-F1-007). Jetzt
    // gilt für den ungedeckten Teil dieselbe Annahme wie ganz ohne Verlauf
    // (`fundingBpsPer8h`, Vorgabe 0), und die Quelle heisst 'teilweise' samt
    // Datum, ab dem echte Sätze vorliegen. Gemessen wird ab dem ersten
    // gehandelten Zeitpunkt (nach dem Warmup), mit anderthalb Takten Toleranz.
    const fundingTaktMs = (Number(risk.fundingIntervalH) > 0 ? Number(risk.fundingIntervalH) : 8) * 3600000
    const handelAb = Math.max(Number(opts.fromTs) || 0, candles[warmup]?.t || 0)
    const fundingAbdeckungAb = mitFundingVerlauf ? Number(fundingVerlauf[0].t) || 0 : 0
    const fundingTeilweise = mitFundingVerlauf && fundingAbdeckungAb > handelAb + fundingTaktMs * 1.5

    // Wartungsmarge je Symbol von der Börse, sofern nicht bewusst überschrieben.
    // Eine Pauschale für alle Coins liess Alt-Coin-Positionen im Backtest weit
    // über den Punkt hinaus laufen, an dem die Börse geschlossen hätte.
    const { pct: wartungsmargePct, quelle: wartungsmargeQuelle } = await wartungsmargeMitQuelle(symbol, risk.maintenanceMarginPct)
    // Zeitausstieg in Millisekunden — der Detector zählt in Kerzen
    // Regelstrategien tragen Break-Even/Zeitausstieg in der Regelwurzel —
    // dieselbe Auflösung wie in der Engine, sonst schliesst der Papierbetrieb
    // Positionen, die der Backtest laufen lässt.
    const maxHoldKerzen = params.maxHoldCandles ?? strategie.regeln?.maxHoldCandles ?? 0
    const maxHoldMs = (maxHoldKerzen || 0) * timeframeMs(timeframe)
    const schrittOpts = {
        breakEvenAtR: params.breakEvenAtR ?? strategie.regeln?.breakEvenAtR ?? 0,
        maxHoldMs,
        partialTpR: params.partialTpR,
        partialTpPct: params.partialTpPct,
        maintenanceMarginPct: wartungsmargePct,
        kerzeMs: timeframeMs(timeframe),
        costs,
    }
    const funnel = emptyFunnel()

    let equity = startEquity
    // Wert der am Ende noch offenen Positionen — bewusst NEBEN der Kapitalkurve
    let unrealisiert = 0
    // Floating-Drawdown: `maxDrawdownPct` (siehe berechneStatistik) misst nur an
    // Trade-ABSCHLÜSSEN — eine Position, die zwischenzeitlich tief im Minus
    // steht, bevor sie am Stop schliesst, fliesst dort nicht ein. Hier wird JEDE
    // Kerze zum ungünstigsten Preis bewertet (dieselbe pessimistische
    // Grundhaltung wie der Rest der Datei), damit dieser Rückgang nicht
    // unterschlagen wird. Läuft als Peak-to-Trough auf einer eigenen Serie statt
    // sie komplett zu speichern — bei 20 000 Kerzen wäre das reiner Ballast für
    // eine Zahl, die am Ende nur EIN Prozentwert ist.
    const floatingZustand = { hoch: startEquity, maxDd: 0 }
    let nextSetupId = 1
    let offeneSetups = []
    const bekannteSchluessel = new Set()
    const gezaehlteAblehnungen = new Set()
    const setupsGesamt = []
    let offenePositionen = []
    const trades = []
    const equityCurve = []
    const lastExitBySymbol = {}

    const abschliessen = (pos, exit) => {
        const extra = { symbol, timeframe }
        if (mitFundingVerlauf) {
            extra.funding = fundingAusVerlauf(fundingVerlauf, {
                qty: pos.qty, direction: pos.direction, entryTime: pos.entryTime,
                bis: exit.time, ersatzPreis: pos.entryPrice,
            })
            // Abrechnungen VOR dem ersten Verlaufseintrag kennt der Verlauf
            // nicht — für sie gilt die Annahme, wie ohne Verlauf. Die
            // Abrechnung genau am Verlaufsbeginn steckt schon oben drin.
            if (fundingTeilweise && pos.entryTime < fundingAbdeckungAb) {
                extra.funding += fundingFor(pos.notionalUsdt, pos.entryTime,
                    Math.min(exit.time, fundingAbdeckungAb - 1), risk.fundingBpsPer8h, risk.fundingIntervalH)
            }
        }
        const trade = closePosition(pos, exit, costs, extra)
        // Welcher Anteil des Kontos stand bei diesem Trade WIRKLICH im Risiko?
        // Nicht zwingend `riskPerTradePct`: der Notional-Deckel, die Marge und
        // die Mengenrundung verkleinern die Position, und `rMultiple` bezieht
        // sich auf das so verkleinerte Risiko. Monte Carlo rechnete bis
        // 31.10.2026 jedes R mit dem vollen Prozentsatz — bei einem Deckel, der
        // das Risiko auf ein Viertel drückte, waren Rückgang und Streuung dort
        // rund viermal zu gross (Audit 4.3.4, FUN-F1-002).
        if (pos.equityBeimEinstieg > 0) {
            const mengeAmEinstieg = Number(pos.initialQty) || Number(pos.qty) || 0
            trade.risikoAnteil = (riskPerUnit(pos) * mengeAmEinstieg) / pos.equityBeimEinstieg
        }
        trades.push(trade)
        // Eine am Testende zwangsweise bewertete Position ist KEIN Ergebnis,
        // sondern eine Momentaufnahme. Sie darf die Kapitalkurve nicht
        // fortschreiben, sonst widersprechen sich die Kennzahlen: Trefferquote
        // und Erwartungswert klammern sie aus, Rendite und Rückgang nähmen sie
        // mit. Ihr Wert wird getrennt ausgewiesen (`unrealisiertPnl`).
        if (exit.reason === 'open_at_end') {
            unrealisiert += trade.netPnl
            return
        }
        equity += trade.netPnl
        // Beide Schlüssel wie in der Engine — der Backtest läuft zwar je
        // Zeiteinheit einzeln, aber `duplicateScope: symbol_tf` würde sonst
        // hier eine Sperrfrist von null sehen und anders messen als der Betrieb.
        lastExitBySymbol[symbol] = exit.time
        lastExitBySymbol[`${symbol}|${timeframe}`] = exit.time
        equityCurve.push({ t: exit.time, equity })
    }

    let letzteAtempause = Date.now()
    const laufBeginn = Date.now()
    const zeitBudget = Number(opts.zeitBudgetMs) > 0 ? Number(opts.zeitBudgetMs) : Infinity

    for (let i = warmup; i < candles.length; i++) {
        // Luft holen, damit Engine-Takt, laufende Anfragen und vor allem der
        // Not-Aus während eines langen Laufs weiter drankommen.
        if (Date.now() - letzteAtempause >= ATEMPAUSE_MS) {
            await atemholen()
            letzteAtempause = Date.now()
            // Nur an den Atempausen geprüft — dort kostet es nichts, und
            // zwischen zwei Pausen liegen höchstens 25 ms Rechnen.
            const grund = Date.now() - laufBeginn > zeitBudget ? 'zeit'
                : (typeof opts.abbrechen === 'function' && opts.abbrechen()) ? 'abbruch' : null
            if (grund) {
                const leer = leeresErgebnis(grund === 'zeit'
                    ? `Abgebrochen nach ${Math.round(zeitBudget / 1000)} s Rechenzeit (Kerze ${i - warmup} von ${candles.length - warmup})`
                    : 'Abgebrochen: niemand wartet mehr auf das Ergebnis')
                leer.stats.abgebrochen = grund
                return leer
            }
        }

        const kerze = candles[i]

        // 1. Offene Positionen mit dieser Kerze fortschreiben.
        //    Bewusst VOR der Erkennung: eine Position, die in dieser Kerze
        //    eröffnet wird, darf frühestens in der nächsten bewertet werden.
        if (offenePositionen.length) {
            const bleiben = []
            for (const pos of offenePositionen) {
                const { exit } = stepCandle(pos, kerze, schrittOpts)
                if (exit) abschliessen(pos, exit)
                else bleiben.push(pos)
            }
            offenePositionen = bleiben
        }

        floatingEquitySchritt(floatingZustand, equity, offenePositionen, kerze)

        // 2. Erkennung auf allem, was bis einschliesslich dieser Kerze geschlossen ist
        const von = volleHistorie ? 0 : Math.max(0, i + 1 - fenster)
        const sicht = candles.slice(von, i + 1)
        // HTF-Ausschnitt bis zur aktuellen Kerze — der Zeiger wandert mit, ein
        // Filter je Takt wäre bei Jahresläufen quadratisch. Nur abgeschlossene
        // HTF-Kerzen zählen, sonst wäre es ein Blick in die Zukunft.
        // Eine HTF-Kerze zählt erst, wenn sie GESCHLOSSEN ist, bevor die
        // aktuelle LTF-Kerze schliesst. `t <= kerze.t` hätte die Bar
        // mitgenommen, die gerade erst eröffnet — ihr Verlauf wäre Zukunft.
        while (htfZeiger < htfAlle.length && htfAlle[htfZeiger].t + htfMs <= kerze.t + ltfMs) htfZeiger++
        const { setups, events, diagnostics } = strategie.detect({
            candles: sicht,
            params,
            openSetups: offeneSetups,
            knownSetupKeys: [...bekannteSchluessel],
            htfCandles: htfZeiger > 0 ? htfAlle.slice(0, htfZeiger) : null,
            // Links fehlt Historie: ATH/ATL sind dann nicht bestimmbar und
            // bleiben leer, statt das Extrem des Ausschnitts vorzutäuschen.
            historieVerkuerzt: von > 0,
        })

        // Ablehnungen nur EINMAL zählen: der Detector sieht denselben Sweep in
        // jedem Takt erneut, deshalb wird über den Schlüssel entduplifiziert.
        for (const { reason, key } of diagnostics.rejections || []) {
            if (gezaehlteAblehnungen.has(key)) continue
            gezaehlteAblehnungen.add(key)
            funnel.sweepsFound++
            bump(funnel.invalidated, reason)
        }

        for (const s of setups) {
            // `erkanntT`: die Kerze, mit deren Schluss das Setup bekannt wurde —
            // früher kann kein Einstieg liegen (Selbsttest Lookahead).
            const setup = { ...s, id: nextSetupId++, symbol, timeframe, strategyId: opts.strategyId, erkanntT: kerze.t }
            offeneSetups.push(setup)
            setupsGesamt.push(setup)
            bekannteSchluessel.add(`${s.direction}|${s.obCandleTime}`)
            funnel.setupsDetected++
            // Gefunden ist jeder Kandidat — angelegt ODER abgelehnt. Bis
            // 01.11.2026 zählten hier nur die abgelehnten.
            funnel.sweepsFound++
        }

        // 3. Ereignisse auswerten
        for (const ev of events) {
            const setup = offeneSetups.find((s) => s.id === ev.id)
            if (!setup) continue
            offeneSetups = offeneSetups.filter((s) => s.id !== ev.id)

            setup.status = ev.status
            if (ev.invalidReason) setup.invalidReason = ev.invalidReason

            if (ev.status !== 'triggered') {
                setup.endeT = Number(ev.candleTime) || 0
                bump(funnel.invalidated, ev.invalidReason || ev.status)
                continue
            }

            funnel.triggered++
            setup.confirmations = ev.confirmations || {}
            setup.triggeredAt = ev.triggeredAt

            // Dieselbe Übernahme wie in der Engine: Strategien mit wandernden
            // Kursmarken (z. B. Einstieg an einer EMA) liefern Einstieg, Stop
            // und Ziel erst mit dem Auslöser.
            if (Number.isFinite(ev.entry) && ev.entry > 0) setup.entry = ev.entry
            if (Number.isFinite(ev.stopLoss) && ev.stopLoss > 0) setup.stopLoss = ev.stopLoss
            if (Number.isFinite(ev.takeProfit)) setup.takeProfit = ev.takeProfit
            const risiko = Math.abs(setup.entry - setup.stopLoss)
            setup.rr = setup.takeProfit > 0 && risiko > 0
                ? Math.abs(setup.takeProfit - setup.entry) / risiko
                : 0

            // Gehandelt wird nur auf der Kerze, auf der das Setup bekannt war.
            //
            // Bis 01.11.2026 wurde ein Auslöser auf einer ÄLTEREN Kerze
            // nachgebucht („der Rücklauf kann schon ein paar Kerzen
            // zurückliegen") und die Kerzen dazwischen nachgeholt. Das ist ein
            // Blick in die Zukunft: Ein Setup, das erst bei Kerze i erkannt
            // wird, konnte bei Kerze j < i niemand handeln. Getroffen hat es
            // jede Strategie, die spät erkennt — LSOB v1, Set and Forget, den
            // ersten Lauf über ein Scanfenster. Dieselbe Regel gilt in der
            // Engine (`zu_spaet_erkannt`).
            const triggerVersatz = sicht.findIndex((c) => c.t === ev.candleTime)
            const triggerIdx = triggerVersatz >= 0 ? von + triggerVersatz : i
            if (triggerIdx !== i) {
                bump(funnel.entrySkipped, 'zu_spaet_erkannt')
                setup.status = 'rejected'
                setup.rejectReason = 'zu_spaet_erkannt'
                continue
            }
            const triggerKerze = kerze

            // 3a. Fill überhaupt möglich? Ein nie berührter Einstieg wird
            //     verworfen. Ein Stop in der Auslösekerze dagegen wird als
            //     Verlust GEBUCHT — verwerfen würde genau die schlechtesten
            //     Fills aus der Statistik löschen und sie schönen.
            const fill = entryIsValid(setup, triggerKerze)
            if (!fill.ok && fill.reason === 'entry_not_touched') {
                bump(funnel.entrySkipped, fill.reason); continue
            }
            const sameBarStop = !fill.ok

            // 3b. Risiko-Gates — dieselben wie im Live-Betrieb, zum selben
            //     Stichtag: dem Schluss der Auslösekerze (`risikoStichtag` in
            //     der Engine). Die Position beginnt trotzdem bei `triggerKerze.t`.
            const stichtag = triggerKerze.t + timeframeMs(timeframe)
            const heuteBeginn = startOfDayUtc(stichtag)
            const heutePnl = trades
                .filter((t) => t.exitTime >= heuteBeginn)
                .reduce((sum, t) => sum + t.netPnl, 0)

            const pruefung = evaluateRisk({
                setup, risk, equity,
                openPositions: offenePositionen,
                todayNetPnl: heutePnl,
                lastExitBySymbol,
                now: stichtag,
                marketMeta,
            })
            if (!pruefung.ok) {
                bump(funnel.riskRejected, pruefung.reason)
                setup.rejectReason = pruefung.reason
                continue
            }

            if (sameBarStop) {
                const posSofort = createPosition({
                    setup, qty: pruefung.size.qty,
                    entryPrice: einstiegsPreis(setup, triggerKerze),
                    entryTime: triggerKerze.t, leverage: risk.leverage, costs,
                })
                posSofort.equityBeimEinstieg = equity
                const gap = setup.direction === 'long'
                    ? Math.min(setup.stopLoss, triggerKerze.o)
                    : Math.max(setup.stopLoss, triggerKerze.o)
                abschliessen(posSofort, { price: gap, reason: 'sl', time: triggerKerze.t })
                funnel.executed++
                setup.status = 'closed'
                continue
            }

            const position = createPosition({
                setup,
                qty: pruefung.size.qty,
                // Stop-Einstiege füllen bei einer Eröffnungslücke schlechter
                // als am Wunschpreis — `einstiegsPreis` bildet das ab.
                entryPrice: einstiegsPreis(setup, triggerKerze),
                // Ein Einstieg zum SCHLUSS (LSOB-Ablehnungs-/Richtungskerze)
                // beginnt mit dem Ende der Auslösekerze (`einstiegsZeit`).
                entryTime: einstiegsZeit(ev, setup, triggerKerze.t, timeframeMs(timeframe)),
                leverage: risk.leverage,
                costs,
            })
            // Bezug für den echten Risikoanteil des Trades (siehe `abschliessen`)
            position.equityBeimEinstieg = equity
            funnel.executed++

            // Liegt der Einstieg auf der ERÖFFNUNG der Auslösekerze, muss diese
            // Kerze selbst mitgeprüft werden — ihr Hoch und Tief können Stop
            // oder Ziel bereits berühren. Bei einem Einstieg mitten in der
            // Kerze (z. B. Limit an einer Zone) ist die Reihenfolge darin
            // unbekannt; bewertet wird ab der Folgekerze (Schritt 1).
            let ueberlebt = true
            if (ev.entryAtOpen) {
                const { exit } = stepCandle(position, kerze, schrittOpts)
                if (exit) { abschliessen(position, exit); ueberlebt = false }
            }
            if (ueberlebt) offenePositionen.push(position)
        }
    }

    // Am Ende noch offene Positionen werden zum letzten Kurs bewertet, aber als
    // `open_at_end` gekennzeichnet: sie sind KEINE abgeschlossenen Trades und
    // gehen deshalb nicht in Trefferquote und Erwartungswert ein. Ohne diese
    // Trennung schlug ein einzelner, 200 Tage laufender Trade als +85R in der
    // Statistik durch.
    const letzte = candles[candles.length - 1]
    for (const pos of offenePositionen) {
        abschliessen(pos, { price: letzte.c, reason: 'open_at_end', time: letzte.t })
    }

    const abdeckung = pruefeAbdeckung(candles, opts.fromTs, opts.toTs, timeframe)
    const baseline = berechneBuyHoldBaseline(candles.slice(warmup), startEquity)
    const statsRoh = berechneStatistik(trades, startEquity, equity, equityCurve)

    return {
        // Die erkannten Setups gehören zum Ergebnis, nicht nur die Trades:
        // gerade die VERWORFENEN erklären, warum eine Strategie selten handelt.
        // Gedeckelt, weil ein Jahreslauf sonst Tausende zurückschickt.
        // `strategyId` und die Sweep-Felder braucht die Chart-Ebene: ohne sie
        // zeichnete das Labor Swing Game als Zone statt als Ausbruchslinie,
        // und die Sweep-Marke fehlte bei allen Strategien (BUG-L5-004).
        setups: setupsGesamt.slice(-300).map((s) => ({
            id: s.id, strategyId: s.strategyId, direction: s.direction, status: s.status,
            symbol: s.symbol, timeframe: s.timeframe,
            sweepLevel: s.sweepLevel, sweepPrice: s.sweepPrice,
            sweepCandleTime: s.sweepCandleTime, obCandleTime: s.obCandleTime,
            obHigh: s.obHigh, obLow: s.obLow, watchFrom: s.watchFrom, tradeableFrom: s.tradeableFrom || 0,
            entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit, rr: s.rr,
            triggeredAt: s.triggeredAt || 0, erkanntT: s.erkanntT || 0, endeT: s.endeT || 0,
            invalidReason: s.invalidReason || '', rejectReason: s.rejectReason || '',
            confirmations: s.confirmations || {},
        })),
        stats: {
            ...statsRoh,
            // Zusätzlich zu `maxDrawdownPct` (nur bei Trade-Abschluss gemessen):
            // der Rückgang, den eine offene Position zwischenzeitlich gerissen
            // hätte, wäre sie schon zu diesem Zeitpunkt bewertet worden.
            maxFloatingDrawdownPct: floatingZustand.maxDd,
            // Kontrollgruppe: schlägt die Strategie reines Halten? `null`, wenn
            // keine Baseline berechenbar war (z. B. zu wenige Kerzen) — dann
            // zeigt die Oberfläche keinen Vergleich statt einer erfundenen Zahl.
            baselineBuyHoldReturnPct: baseline?.buyHoldReturnPct ?? null,
            baselineDiffPct: baseline ? statsRoh.returnPct - baseline.buyHoldReturnPct : null,
            // Was die offenen Positionen zum Stichtag wert wären. Steht neben
            // den Kennzahlen, nicht in ihnen — wer sie mitrechnen will, kann
            // es tun, aber niemand tut es versehentlich.
            // Hat der Trendfilter der höheren Zeiteinheit wirklich gegriffen?
            // Ohne dieses Feld sah ein ungefilterter Lauf aus wie ein
            // gefilterter — und genau so wurde er verglichen.
            htfFilter,
            // Wurden Finanzierungskosten überhaupt angenommen? Ohne diese
            // Angabe sieht ein Lauf ohne Funding aus wie einer, in dem Funding
            // nichts gekostet hat — das ist nicht dasselbe.
            // Mit welchem Hebel wurde wirklich gerechnet? Die Zahl im
            // Formular ist nicht zwingend die, die gewirkt hat.
            leverageEffektiv: hebelEffektiv,
            leverageGekappt: hebelGekappt,
            fundingModelliert: mitFundingVerlauf || Number(risk.fundingBpsPer8h) > 0,
            // 'verlauf' = echte Funding-Sätze der Börse, 'teilweise' = echte
            // Sätze erst ab `fundingAbdeckungAb`, davor die Annahme,
            // 'annahme' = Pauschale aus den Risiko-Einstellungen, 'keins' =
            // weder noch.
            fundingQuelle: mitFundingVerlauf
                ? (fundingTeilweise ? 'teilweise' : 'verlauf')
                : (Number(risk.fundingBpsPer8h) > 0 ? 'annahme' : 'keins'),
            fundingAbdeckungAb: fundingTeilweise ? fundingAbdeckungAb : null,
            fundingBpsPer8h: Number(risk.fundingBpsPer8h) || 0,
            // Mit welcher Wartungsmarge wurde die Zwangsliquidation gerechnet?
            // Auch das ist eine Annahme und gehört ausgewiesen.
            wartungsmargePct,
            // Kam die Zahl aus dem Formular oder von der Börse? Eine Annahme
            // ohne ihre Herkunft ist im Nachhinein nicht mehr zu beurteilen.
            wartungsmargeQuelle,
            unrealisiertPnl: unrealisiert,
            endEquityMitOffenen: equity + unrealisiert,
            // Gehört zu den Kennzahlen, nicht in die Metadaten: ein Ergebnis zu
            // einem unvollständigen Zeitraum ist eine Eigenschaft des Ergebnisses.
            abdeckung,
        },
        trades,
        equityCurve,
        funnel,
        meta: {
            strategyId: opts.strategyId,
            symbol, timeframe, market,
            candles: candles.length,
            von: candles[0].t,
            bis: letzte.t,
            abdeckung,
            params, risk,
        },
    }
}

/**
 * Kennzahlen. `expectancyR` ist die wichtigste Zahl: der erwartete Gewinn je
 * Trade in R. Alles darunter oder gleich 0 heisst, dass die Strategie in dieser
 * Konfiguration nichts verdient — egal wie gut die Trefferquote aussieht.
 */
/**
 * Sharpe-Verhältnis auf TAGESBASIS, annualisiert.
 *
 * Bewusst nicht pro Trade: eine Strategie mit 500 Trades bekäme sonst allein
 * durch ihre Frequenz eine andere Zahl als eine mit 20, obwohl beide dasselbe
 * Kapital gleich stark schwanken lassen. Der Tag ist die Einheit, in der man
 * Schwankung vergleicht — deshalb √365 als Faktor (Krypto handelt durchgehend,
 * die üblichen 252 Börsentage wären hier falsch).
 *
 * Zwischen zwei Abschlüssen bleibt das Kapital stehen: offene Positionen gehen
 * nicht in die Kurve ein (siehe `abschliessen`), also ist der Wert an einem Tag
 * ohne Abschluss unverändert. Diese Nulltage GEHÖREN in die Rechnung — sie sind
 * echte Tage ohne Bewegung, kein fehlender Wert.
 *
 * `null`, wenn es weniger als zwei Tage gibt oder die Kurve gar nicht schwankt.
 * Eine Zahl zu erfinden, wo keine Streuung messbar ist, wäre schlimmer als die
 * Lücke zuzugeben.
 */
export function berechneSharpe(equityCurve, startEquity) {
    if (!Array.isArray(equityCurve) || equityCurve.length < 2) return null
    const TAG = 86400000

    // Letzter Kapitalstand je Tag
    const proTag = new Map()
    for (const punkt of equityCurve) {
        const tag = Math.floor(Number(punkt.t) / TAG)
        if (Number.isFinite(tag)) proTag.set(tag, punkt.equity)
    }
    const tage = [...proTag.keys()].sort((a, b) => a - b)
    if (tage.length < 2) return null

    // Tage ohne Abschluss auffüllen — sonst zählt eine ruhige Woche gar nicht
    const renditen = []
    let vorher = startEquity
    for (let tag = tage[0]; tag <= tage[tage.length - 1]; tag++) {
        const stand = proTag.has(tag) ? proTag.get(tag) : vorher
        if (vorher > 0) renditen.push((stand - vorher) / vorher)
        vorher = stand
    }
    if (renditen.length < 2) return null

    const mittel = renditen.reduce((s, r) => s + r, 0) / renditen.length
    // Stichprobenstreuung (n−1): die Tage sind eine Stichprobe, nicht die Welt
    const varianz = renditen.reduce((s, r) => s + (r - mittel) ** 2, 0) / (renditen.length - 1)
    const streuung = Math.sqrt(varianz)

    // `> 0` reicht hier NICHT. Eine Kurve, die jeden Tag exakt gleich viel
    // zulegt, hat rechnerisch keine Streuung — in Fliesskomma bleibt aber ein
    // Rest von etwa 1e-17 stehen, und daraus wird ein Sharpe von 3·10¹⁵. Die
    // Zahl sähe aus wie ein Traumergebnis und wäre reines Rauschen. Deshalb
    // gilt eine Streuung als null, sobald sie gegenüber dem Mittelwert
    // verschwindet.
    const winzig = Math.max(1e-12, Math.abs(mittel) * 1e-9)
    if (!(streuung > winzig)) return null

    return (mittel / streuung) * Math.sqrt(365)
}

export function berechneStatistik(alleTrades, startEquity, endEquity, equityCurve) {
    // Am Testende zwangsweise bewertete Positionen sind keine abgeschlossenen
    // Trades — sie würden Trefferquote und Erwartungswert verzerren.
    const trades = alleTrades.filter((t) => t.exitReason !== 'open_at_end')
    const nochOffen = alleTrades.length - trades.length
    const n = trades.length
    if (!n) {
        return {
            trades: 0, winRate: 0, netPnl: 0, expectancyR: 0, profitFactor: null,
            maxDrawdownPct: 0, sharpe: null, startEquity, endEquity, nochOffen,
            belastbar: false, mindestTrades: MIN_TRADES_BELASTBAR, expectancyROhneTop: 0,
        }
    }

    const gewinner = trades.filter((t) => t.netPnl > 0)
    const verlierer = trades.filter((t) => t.netPnl <= 0)
    const summe = (arr, f) => arr.reduce((s, t) => s + f(t), 0)

    const bruttoGewinn = summe(gewinner, (t) => t.netPnl)
    const bruttoVerlust = Math.abs(summe(verlierer, (t) => t.netPnl))

    // Maximaler Rückgang der Kapitalkurve, in Prozent vom jeweiligen Hoch
    let hoch = startEquity
    let maxDd = 0
    for (const punkt of equityCurve) {
        if (punkt.equity > hoch) hoch = punkt.equity
        const dd = hoch > 0 ? ((hoch - punkt.equity) / hoch) * 100 : 0
        if (dd > maxDd) maxDd = dd
    }

    const exitGruende = {}
    for (const t of trades) bump(exitGruende, t.exitReason)

    // Wie weit lief der Kurs zu unseren Gunsten, bevor der Trade endete?
    // Aus dieser Verteilung folgt direkt, ob das Take-Profit-Ziel passt.
    const mfeStufen = { '1R': 0, '2R': 0, '3R': 0, '5R': 0 }
    for (const t of trades) {
        if (t.mfeR >= 1) mfeStufen['1R']++
        if (t.mfeR >= 2) mfeStufen['2R']++
        if (t.mfeR >= 3) mfeStufen['3R']++
        if (t.mfeR >= 5) mfeStufen['5R']++
    }

    // Erwartungswert OHNE den grössten Gewinner. Trennt Mechanik von Glück:
    // hält eine Änderung diesen Test nicht, hing sie an einem einzelnen Trade.
    // Genau daran sind die Optimizer-Vorschläge #1 und #2 gescheitert.
    const nachR = [...trades].sort((a, b) => b.rMultiple - a.rMultiple)
    const ohneTop = nachR.slice(1)
    const expectancyROhneTop = ohneTop.length
        ? summe(ohneTop, (t) => t.rMultiple) / ohneTop.length
        : 0

    return {
        trades: n,
        wins: gewinner.length,
        losses: verlierer.length,
        winRate: (gewinner.length / n) * 100,
        expectancyROhneTop,
        // Nicht „schlecht", sondern „sagt nichts": unter dieser Grenze ist jede
        // Aussage über Erwartungswert und Trefferquote Zufall.
        belastbar: n >= MIN_TRADES_BELASTBAR,
        mindestTrades: MIN_TRADES_BELASTBAR,
        netPnl: summe(trades, (t) => t.netPnl),
        grossPnl: summe(trades, (t) => t.grossPnl),
        fees: summe(trades, (t) => t.fees),
        funding: summe(trades, (t) => Number(t.funding) || 0),
        avgR: summe(trades, (t) => t.rMultiple) / n,
        expectancyR: summe(trades, (t) => t.rMultiple) / n,
        // Ohne Verlust-Trades ist der Profit-Faktor nicht definiert. Bewusst
        // `null` statt Infinity: JSON macht aus Infinity ein `null`, und das
        // wurde in der Anzeige zu "0.00" — also genau das Gegenteil der Wahrheit.
        profitFactor: bruttoVerlust > 0 ? bruttoGewinn / bruttoVerlust : null,
        avgWinR: gewinner.length ? summe(gewinner, (t) => t.rMultiple) / gewinner.length : 0,
        avgLossR: verlierer.length ? summe(verlierer, (t) => t.rMultiple) / verlierer.length : 0,
        maxDrawdownPct: maxDd,
        // `null` heisst „nicht messbar", nicht „null". Die Anzeige muss das
        // unterscheiden — eine 0 wäre hier eine Behauptung.
        sharpe: berechneSharpe(equityCurve, startEquity),
        avgHoldingMinutes: summe(trades, (t) => t.holdingMinutes) / n,
        avgMaeR: summe(trades, (t) => t.maeR) / n,
        avgMfeR: summe(trades, (t) => t.mfeR) / n,
        mfeReached: mfeStufen,
        exitReasons: exitGruende,
        nochOffen,
        startEquity,
        endEquity,
        returnPct: startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0,
    }
}

/**
 * Kontrollgruppe für einen Backtest: was hätte reines Halten über denselben
 * Zeitraum gebracht? Ohne sie ist eine positive Rendite bedeutungslos — an
 * einem Tag, an dem der Coin ohnehin durchmarschiert, sieht jede Strategie gut
 * aus (dasselbe Prinzip wie die Kontrollgruppe in `radar-guete.js`, dort für
 * den Coin-Radar).
 *
 * Bewusst NUR Buy&Hold, nicht die „ungefilterte Strategie" wie beim Vorbild:
 * das würde einen zweiten vollständigen Simulationslauf verlangen. Buy&Hold
 * kostet nichts extra — die Kerzen sind ohnehin schon geladen.
 *
 * `candles` beginnt bewusst erst NACH der Warmup-Phase: die Strategie konnte
 * darin ohnehin nicht handeln, und ein Vergleich gegen den Warmup-Anfangspreis
 * wäre ein Vorteil, den keine Strategie je hätte nutzen können.
 */
export function berechneBuyHoldBaseline(candles, startEquity) {
    if (!Array.isArray(candles) || candles.length < 2) return null
    const erstesOpen = candles[0].o
    const letztesClose = candles[candles.length - 1].c
    if (!(erstesOpen > 0)) return null
    const returnPct = ((letztesClose - erstesOpen) / erstesOpen) * 100
    return {
        buyHoldReturnPct: returnPct,
        buyHoldEndEquity: startEquity * (1 + returnPct / 100),
    }
}

/**
 * Näherung des Floating-Drawdown aus bereits ABGESCHLOSSENEN Trades (Papier-
 * /Schatten-/Live-Betrieb), ohne Kerzen zur Verfügung zu haben.
 *
 * `floatingEquitySchritt` braucht eine Kerze je Schritt — die echte Auswertung
 * (`ladePerformance`) hat nur die gespeicherten Trades mit ihrem MAE in R.
 * Angenommen wird: der Tiefpunkt eines Trades lag VOR seinem Ergebnis (das ist
 * exakt, was „Maximum Adverse Excursion" bedeutet), und das eingegangene
 * Risiko in USD lässt sich aus `netPnl / rMultiple` zurückrechnen. Gröber als
 * die kerzengenaue Version, aber besser als ein blinder Fleck — bei einem
 * Break-Even-Trade (rMultiple 0) trägt er mangels rekonstruierbarem Risiko
 * nichts bei, statt zu raten.
 */
export function schaetzeFloatingDrawdownAusTrades(trades, startEquity) {
    let equity = startEquity
    let hoch = startEquity
    let maxDd = 0
    for (const t of trades) {
        const rMultiple = Number(t.rMultiple) || 0
        const risk = rMultiple !== 0 ? Math.abs((Number(t.netPnl) || 0) / rMultiple) : 0
        const mae = Number(t.maeR) || 0
        const tiefpunkt = equity - risk * mae
        if (equity > hoch) hoch = equity
        if (hoch > 0) {
            const dd = ((hoch - tiefpunkt) / hoch) * 100
            if (dd > maxDd) maxDd = dd
        }
        equity += Number(t.netPnl) || 0
        if (equity > hoch) hoch = equity
    }
    return maxDd
}

/** Grobe Abschätzung, wie viele Kerzen ein Zeitraum umfasst (für Limits in der UI). */
export function schaetzeKerzen(fromTs, toTs, timeframe) {
    const ms = timeframeMs(timeframe)
    return ms > 0 ? Math.ceil((toTs - fromTs) / ms) : 0
}
