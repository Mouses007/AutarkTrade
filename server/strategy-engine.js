/**
 * Strategie-Engine — der Taktgeber.
 *
 * Aufbau nach dem bewährten `reconcile()`-Muster aus `live-recorder.js`: der
 * Soll-Zustand steht in der DB, ein Timer gleicht ab. Änderungen an einer
 * Instanz greifen dadurch sofort und überleben einen Neustart, ohne dass
 * irgendwo eine Konfiguration im Code stünde.
 *
 * Getaktet wird auf KERZENSCHLUSS, nicht auf ein starres Intervall: ein Setup
 * lebt über viele Kerzen (Sweep → Order Block → Impuls → Retest Stunden
 * später). Ein reiner Intervall-Scan würde dasselbe Setup mehrfach erkennen
 * oder den Retest verpassen.
 *
 * Reihenfolge je Takt — bewusst identisch zum Backtest:
 *   1. offene Positionen mit den neuen Kerzen fortschreiben
 *   2. erkennen (nur auf geschlossenen Kerzen)
 *   3. getriggerte Setups durch Agenten-Veto und Risk-Engine schicken
 *   4. ausführen
 */

import { vetoFaktor } from './strategy-agents-regeln.js'
import { getKnex } from './database.js'
import { logError, logWarn } from './logger.js'
import { getStrategy, validateParams, validateRisk, AGENT_DEFAULTS, normalisiereTimeframes } from './strategies/index.js'
import { getClosedCandles, getSymbolMeta, getLastPrice, timeframeMs, isValidTimeframe } from './market-data.js'
import { sichtBedarfKerzen } from './strategies/rule-engine.js'
import { evaluateRisk, startOfDayUtc, RISK_REASONS } from './risk-engine.js'
import { openPaperPosition, stepPaperPositions, getPaperEquity, closePaperPositionManually } from './execution/paper.js'
import { entryIsValid, kostenAus, einstiegsPreis } from './fill-simulator.js'
import { agentenVeto } from './strategy-agents.js'
// `instance.broker` nennt die Börse, deren Rundungsregeln der Schattenbetrieb
// anlegt. Orders sendet die Engine seit S13 keine mehr (docs/SPAETER-SCHARFER-HANDEL.md).
import { holeAdapter } from './execution/index.js'
import { beansprucheFuehrung, verlaengereFuehrung, gibFuehrungFrei } from './db-claim.js'
import { wartungsmargePctFuer } from './margin-rates.js'
import { umgebungAn } from './umgebung.js'
import { istTestbetrieb } from './umgebung.js'
import { istAus as marktdatenAus } from './marktdaten/index.js'

// Instanzen, deren „Marktdaten aus" schon im Log steht: alle 15 s dieselbe
// Zeile wäre Lärm, der echte Fehler verdeckt (S12). `lastError` sagt es der
// Oberfläche weiterhin bei jedem Takt.
const ausGemeldet = new Set()

const TICK_MS = 15000          // Prüfintervall; gearbeitet wird nur bei neuem Kerzenschluss
const MAX_SYMBOLS = 20         // Deckel je Instanz, damit ein Tippfehler den Server nicht flutet

/**
 * Führungs-Sperre über die Datenbank.
 *
 * Ohne sie schützt nichts gegen zwei Engines: `tickLaeuft` und `running` leben
 * beide IM Prozess, während NAS-Container und Entwicklungsrechner auf dieselbe
 * PostgreSQL zeigen. Am 16.08.2026 lief genau das eine Stunde lang — ohne
 * Schaden, aber nur weil in dem Fenster zufällig kein Setup auslöste.
 *
 * Die TTL ist die Nachsicht-Frist nach einem Absturz: so lange bleibt die
 * Führung blockiert, bevor ein anderer Prozess übernehmen darf. Sie muss
 * deutlich über der Dauer eines Takts liegen — ein Durchgang holt Kerzen für
 * mehrere Symbole und Zeiteinheiten über das Netz.
 *
 * Verlassen wird sich dabei auf die Uhr des jeweiligen Prozesses. Gemessen am
 * 16.08.2026 liegt der Versatz zwischen Entwicklungsrechner und Datenbank bei
 * ±7 ms; erst ein Versatz GRÖSSER als die TTL könnte zwei Führungen erlauben.
 */
const FUEHRUNG_KEY = 'strategy_engine'
const FUEHRUNG_TTL_MS = 120000

let tickTimer = null
let engineStopped = false

/** instanceId → true, solange ein Lauf aktiv ist (Guard je Instanz, nicht global). */
const running = new Map()
/** `${instanceId}|${symbol}|${timeframe}` → Zeit der zuletzt verarbeiteten Kerze. */
const lastProcessed = new Map()
/** Hält DIESER Prozess gerade die Führung? Nur zur Anzeige. */
let hatFuehrung = false
/** Kurzstatistik für den Status-Endpunkt. */
const stats = { ticks: 0, runs: 0, lastRunAt: 0, errors: 0, fremdgefuehrt: 0 }

/**
 * Agenten-Veto. Standardmässig verdrahtet, greift aber nur, wenn eine Instanz
 * mindestens eine Rolle aktiviert hat — ohne das läuft die Strategie rein
 * deterministisch. Über `setAgentHook` austauschbar (Tests, Abschalten).
 */
let agentHook = agentenVeto
export function setAgentHook(fn) { agentHook = fn }

// ── Instanz laden ────────────────────────────────────────────────────────

function parseJson(wert, fallback) {
    if (wert === null || wert === undefined) return fallback
    if (typeof wert === 'object') return wert
    try { return JSON.parse(wert) } catch { return fallback }
}

/**
 * DB-Zeile → benutzbare Instanz mit validierten Parametern.
 * Gibt null zurück, wenn die Instanz unbrauchbar ist (unbekannte Strategie,
 * ungültiger Timeframe) — solche Instanzen werden übersprungen, nicht geraten.
 */
export function ladeInstanz(row) {
    const strategie = getStrategy(row.strategyId)
    if (!strategie) return null
    if (!isValidTimeframe(row.timeframe)) return null

    const symbols = parseJson(row.symbols, []).filter(Boolean).slice(0, MAX_SYMBOLS)
    const { values: params } = validateParams(row.strategyId, parseJson(row.params, {}))
    const { values: risk } = validateRisk(parseJson(row.risk, {}))
    const agents = { ...AGENT_DEFAULTS, ...parseJson(row.agents, {}) }

    return {
        id: row.id,
        strategyId: row.strategyId,
        name: row.name || row.strategyId,
        enabled: Boolean(row.enabled),
        mode: row.mode || 'paper',
        broker: row.broker || 'bitunix',
        market: row.market || 'futures',
        timeframe: row.timeframe,
        // Eine Instanz kann dieselbe Strategie auf mehreren Zeiteinheiten
        // gleichzeitig laufen lassen — jede für sich, aber unter EINEM
        // Risikobudget. Leer/kaputt → nur die Haupt-Zeiteinheit, also der
        // bisherige Betrieb.
        timeframes: normalisiereTimeframes(row.timeframes, row.timeframe, strategie),
        paramsVersion: Number(row.paramsVersion) || 1,
        symbols, params, risk, agents, strategie,
    }
}

/** Globale Schalter aus den Einstellungen. */
async function ladeSchalter() {
    const knex = getKnex()
    const s = await knex('settings')
        .select('strategyKillSwitch', 'strategyMaxLeverage')
        .where('id', 1).first()
    return {
        killSwitch: Boolean(s?.strategyKillSwitch),
        maxLeverage: Number(s?.strategyMaxLeverage) || 10,
    }
}

/**
 * Betriebsarten, die die Engine fährt. `live` gehört nicht dazu: der scharfe
 * Handel ist seit S13 ausgelagert (Branch `spaeter/scharfer-handel`). Eine
 * Instanz, die trotzdem `live` sagt — eine alte Zeile, an der Migration vorbei
 * —, wird abgewiesen, nicht still als Papier gefahren.
 */
export const BETRIEBSARTEN = ['paper', 'shadow']

// ── Kontext für die Risikoprüfung ────────────────────────────────────────

/**
 * Die drei Abfragen des Risiko-Kontexts, als Builder — damit ein Selbsttest
 * ihr SQL prüfen kann, ohne eine Datenbank zu brauchen.
 *
 * ALLE DREI SIND ZUM ZEITPUNKT `now` GESTELLT, nicht „jetzt gerade".
 *
 * `now` ist die Kerzenzeit des Auslösers (`ev.triggeredAt`), nicht die
 * Systemzeit. Beim ersten Lauf über ein Symbol wertet die Strategie ihr ganzes
 * Scan-Fenster aus — bei LSOB 200 Kerzen, auf 4h also fünf Wochen — und löst
 * dabei Setups auf Kerzen aus, die längst vergangen sind. Die Abfragen lasen
 * dagegen den JETZIGEN Stand. Drei Folgen, alle in dieselbe Richtung:
 *
 *   1. Sperrfrist: `max(exitTime)` konnte NACH `now` liegen. Die Wartezeit
 *      wurde negativ, und aus 60 Minuten Sperre wurden Meldungen wie „noch
 *      34380 min". Am 20.08.2026 waren 76 von 79 Sperrfrist-Ablehnungen von
 *      dieser Sorte — der häufigste Ablehnungsgrund überhaupt, und er traf
 *      nicht zufällig, sondern bevorzugt überlappende Setups.
 *   2. Tagesverlust: die Summe zählte Trades mit, die zum Zeitpunkt der
 *      Entscheidung noch gar nicht geschlossen waren. Ein Blick in die
 *      Zukunft, der das Tageslimit mal zu früh, mal zu spät greifen liess.
 *   3. Offene Positionen: eine im Rücklauf längst geschlossene Position galt
 *      als zu. Ohne (3) würde (1) allein den Rücklauf bloss durchlässiger
 *      machen — zwei gleichzeitige Positionen auf demselben Symbol wären dann
 *      möglich, ohne dass ein Tor es merkt.
 *
 * Im laufenden Betrieb ist `now` die Gegenwart; dann sind alle drei Schranken
 * wirkungslos und es ändert sich nichts. Der Fix betrifft ausschliesslich den
 * Rücklauf — dort aber die Datenbasis, auf der später Optimierungen fussen.
 */
export function risikoKontextAbfragen(knex, instanceId, now) {
    const tagesBeginn = startOfDayUtc(now)
    return {
        // Offen ZUM ZEITPUNKT now = eingestiegen bis dahin und bis dahin nicht
        // wieder geschlossen. `whereNotExists` statt Join, damit eine Position
        // nicht doppelt in der Liste landet.
        //
        // `pending` bleibt draussen wie bisher: das war die Reservierung VOR
        // einer Live-Order (Altbestand vor S13), keine Position.
        offen: knex('strategy_positions')
            .where({ instanceId })
            // 'closing' zaehlt mit: Altbestand des Stop-Waechters (vor S13),
            // eine Position, deren Schliessung haengengeblieben sein kann.
            // Faellt sie raus, saehe die Engine einen freien Platz.
            .whereIn('status', ['open', 'closing', 'closed'])
            .where('entryTime', '<=', now)
            .whereNotExists((q) => q
                .select(knex.raw('1'))
                .from('strategy_trades')
                // Bezeichner über ?? binden, nicht blank in whereRaw:
                // PostgreSQL faltet ungequotetes camelCase zu Kleinbuchstaben.
                .whereRaw('?? = ??', ['strategy_trades.positionId', 'strategy_positions.id'])
                .where('strategy_trades.exitTime', '<=', now)),
        heute: knex('strategy_trades')
            .where({ instanceId })
            .whereBetween('exitTime', [tagesBeginn, now])
            .sum({ pnl: 'netPnl' }).first(),
        letzte: knex('strategy_trades')
            .where({ instanceId })
            .where('exitTime', '<=', now)
            .groupBy('symbol', 'timeframe')
            .select('symbol', 'timeframe')
            .max({ exitTime: 'exitTime' }),
    }
}

async function ladeRisikoKontext(instance, now) {
    const abfragen = risikoKontextAbfragen(getKnex(), instance.id, now)
    const [offen, heute, letzte] = await Promise.all([
        abfragen.offen, abfragen.heute, abfragen.letzte,
    ])

    // Zwei Schlüssel je Zeile: `BTCUSDT` für die symbolweite Sperrfrist,
    // `BTCUSDT|15m` für die Variante je Zeiteinheit. Welcher gilt, entscheidet
    // `duplicateScope` in der Risk-Engine.
    const lastExitBySymbol = {}
    for (const r of letzte) {
        const t = Number(r.exitTime) || 0
        lastExitBySymbol[`${r.symbol}|${r.timeframe}`] = t
        lastExitBySymbol[r.symbol] = Math.max(lastExitBySymbol[r.symbol] || 0, t)
    }

    return {
        openPositions: offen,
        todayNetPnl: Number(heute?.pnl) || 0,
        lastExitBySymbol,
    }
}

/** Kontostand: Papier und Schatten rechnen mit dem simulierten Konto. */
async function ladeKontostand(instance) {
    return getPaperEquity(instance)
}

/**
 * Rundungsregeln der AUSFÜHRUNGSbörse, wo sie gebraucht werden.
 *
 * Der Papierbetrieb behält Binance — genau wie der Backtest, sonst runden
 * dieselben Regeln in Labor und Papier unterschiedlich und die Ergebnisse sind
 * nicht mehr vergleichbar. Der Schatten bekommt die echten Werte der
 * Börse: sein Zweck ist zu zeigen, welche Menge dort zulässig wäre.
 */
async function marktMetaFuer(instance, symbol) {
    const binance = () => getSymbolMeta(symbol, { market: instance.market }).catch(() => null)
    if (instance.mode === 'paper') return binance()

    let adapter
    try { adapter = holeAdapter(instance.broker) } catch { return binance() }
    if (!adapter.faehigkeiten.orderMeta || typeof adapter.holeSymbolMeta !== 'function') {
        return binance()
    }
    const eigen = await adapter.holeSymbolMeta(symbol).catch(() => null)
    return eigen || binance()
}

// ── Ein Symbol verarbeiten ───────────────────────────────────────────────

async function verarbeiteSymbol(instance, symbol, timeframe, schalter) {
    const knex = getKnex()
    const p = instance.params
    const costs = kostenAus(instance.risk)

    // Verankerte Linien brauchen ihren Anker im Sichtfenster (Wochen-VWAP auf
    // 15m ≈ 700 Kerzen). Ohne diesen Aufschlag bliebe die Linie im Betrieb leer,
    // während sie im Backtest gerechnet wurde — dieselbe Strategie würde live
    // schweigen und niemand wüsste, warum. ATH/ATL (`Infinity`) kann die Engine
    // nicht halten; dort bleibt die Linie bewusst leer, der Interpreter erfährt
    // das über `historieVerkuerzt`.
    const ankerBedarf = sichtBedarfKerzen(instance.strategie.regeln, timeframeMs(timeframe))
    const bedarf = Math.max(
        (instance.strategie.warmupCandles || 200)
            + (p.scanWindowCandles || 200)
            + (p.retestMaxCandles || 40) + 10,
        Number.isFinite(ankerBedarf) ? ankerBedarf : 0,
    )

    const candles = await getClosedCandles(symbol, timeframe, bedarf, { market: instance.market })
    if (candles.length < 50) return { skipped: 'zu wenige Kerzen' }

    const neueste = candles[candles.length - 1].t
    const key = `${instance.id}|${symbol}|${timeframe}`
    if (lastProcessed.get(key) === neueste) return { skipped: 'keine neue Kerze' }

    // ── 1. Offene Positionen fortschreiben ───────────────────────────────
    const geschlossen = await stepPaperPositions({
        instance, symbol, timeframe, candles, costs,
        breakEvenAtR: p.breakEvenAtR ?? instance.strategie?.regeln?.breakEvenAtR ?? 0,
        // Zeitausstieg zählt in Kerzen DIESER Zeiteinheit — bei mehreren
        // Zeiteinheiten je Instanz wäre eine feste Umrechnung sonst für alle
        // ausser einer falsch.
        maxHoldMs: ((p.maxHoldCandles ?? instance.strategie?.regeln?.maxHoldCandles ?? 0) || 0) * timeframeMs(timeframe),
        partialTpR: p.partialTpR,
        partialTpPct: p.partialTpPct,
        // Wartungsmarge je Symbol (0 in der Instanz = von der Börse holen),
        // damit Papierbetrieb und Backtest denselben Liquidationspreis rechnen.
        maintenanceMarginPct: await wartungsmargePctFuer(symbol, instance.risk.maintenanceMarginPct),
    })

    // ── 2. Erkennen ──────────────────────────────────────────────────────
    const fensterStart = candles[0].t
    const [offeneSetups, bekannte] = await Promise.all([
        knex('strategy_setups')
            .where({ instanceId: instance.id, symbol, timeframe })
            .whereIn('status', ['armed', 'waiting_retest']),
        // Statusunabhängig: sonst wird ein bereits abgeschlossenes Setup bei
        // jedem Takt neu erzeugt, solange sein Sweep im Fenster liegt.
        knex('strategy_setups')
            .where({ instanceId: instance.id, symbol, timeframe })
            .where('obCandleTime', '>=', fensterStart)
            .select('direction', 'obCandleTime'),
    ])

    const openSetups = offeneSetups.map((r) => ({
        ...r,
        confirmations: parseJson(r.confirmations, {}),
        obHigh: Number(r.obHigh), obLow: Number(r.obLow),
        entry: Number(r.entry), stopLoss: Number(r.stopLoss), takeProfit: Number(r.takeProfit),
        sweepPrice: Number(r.sweepPrice), impulseExtreme: Number(r.impulseExtreme),
        watchFrom: Number(r.watchFrom) || Number(r.obCandleTime),
        tradeableFrom: Number(r.tradeableFrom) || 0,
    }))

    // Kerzen der höheren Zeiteinheit für den Trendfilter. Werden sie nicht
    // übergeben, bleibt `htfBias` null und der Filter blockiert nie — er wäre
    // eine Einstellung ohne Wirkung. Nur bei eingeschaltetem Filter holen,
    // sonst kostet es bei jedem Takt einen Abruf ohne Nutzen.
    //
    // Scheitert der Abruf, wird der Takt ÜBERSPRUNGEN statt ungefiltert
    // gehandelt. Im Backtest ist ein ungefilterter Lauf nur eine falsche Zahl;
    // hier wäre er eine Position, die der Nutzer ausdrücklich ausgeschlossen
    // hat. Ein verpasster Einstieg ist der günstigere Fehler.
    let htfCandles = null
    if (p.htfTrendFilter && p.htfTimeframe && p.htfTimeframe !== timeframe) {
        const noetig = (p.htfEmaPeriod || 50) + 5
        // `htfKerzen` im Manifest: eine Strategie, deren EMA ausgeschwungen sein
        // muss, holt mehr als die knappe Vorgabe. Der Backtest reicht die ganze
        // Historie durch — mit nur Periode + 20 Kerzen rechnete der Papierbetrieb
        // eine andere EMA als das Labor.
        const anzahl = Math.max((p.htfEmaPeriod || 50) + 20, Number(instance.strategie.htfKerzen) || 0)
        try {
            htfCandles = await getClosedCandles(
                symbol, p.htfTimeframe, anzahl, { market: instance.market },
            )
        } catch (e) {
            htfCandles = null
        }
        if (!htfCandles || htfCandles.length < noetig) {
            logWarn('strategy-engine',
                `HTF-Kerzen (${p.htfTimeframe}) fehlen oder reichen nicht (${htfCandles?.length || 0}/${noetig}) — `
                + `Takt für ${symbol} ${timeframe} übersprungen, statt den Trendfilter stillschweigend auszulassen`)
            // Bewusst VOR `lastProcessed.set` — dieselbe Kerze wird beim
            // nächsten Takt erneut versucht, sobald die Daten wieder da sind.
            // Offene Positionen sind oben (Schritt 1) bereits fortgeschrieben
            // worden; übersprungen wird nur das Erkennen neuer Setups.
            return { skipped: 'HTF-Kerzen fehlen' }
        }
    }

    const { setups, events } = instance.strategie.detect({
        candles,
        params: p,
        openSetups,
        knownSetupKeys: bekannte.map((r) => `${r.direction}|${r.obCandleTime}`),
        htfCandles,
        // Die Engine hält immer nur ein Fenster, nie die ganze Historie.
        historieVerkuerzt: true,
    })

    // ── 3. Neue Setups sichern ───────────────────────────────────────────
    if (setups.length) {
        const zeilen = setups.map((s) => ({
            instanceId: instance.id,
            strategyId: instance.strategyId,
            symbol,
            timeframe,
            direction: s.direction,
            status: s.status,
            sweepLevel: s.sweepLevel,
            sweepPrice: s.sweepPrice,
            sweepCandleTime: s.sweepCandleTime,
            obHigh: s.obHigh,
            obLow: s.obLow,
            obCandleTime: s.obCandleTime,
            watchFrom: s.watchFrom,
            tradeableFrom: s.tradeableFrom || 0,
            impulseExtreme: s.impulseExtreme,
            entry: s.entry,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit,
            rr: s.rr,
            confirmations: JSON.stringify(s.confirmations || {}),
            paramsVersion: instance.paramsVersion,
            detectorVersion: s.detectorVersion || 1,
        }))
        // Der Unique-Index ist der Rückfallschutz gegen Doppelanlagen
        await knex('strategy_setups')
            .insert(zeilen)
            .onConflict(['instanceId', 'symbol', 'timeframe', 'direction', 'obCandleTime'])
            .ignore()
    }

    // ── 4. Ereignisse anwenden ───────────────────────────────────────────
    let ausgefuehrt = 0
    for (const ev of events) {
        const setup = openSetups.find((s) => s.id === ev.id)
        if (!setup) continue

        if (ev.status !== 'triggered') {
            await knex('strategy_setups').where('id', ev.id).update({
                status: ev.status,
                invalidReason: ev.invalidReason || '',
                updatedAt: knex.fn.now(),
            })
            continue
        }

        setup.symbol = symbol
        setup.timeframe = timeframe
        setup.confirmations = ev.confirmations || {}

        // Kursmarken aus dem Auslöser übernehmen. Bei manchen Strategien stehen
        // sie schon beim Erkennen fest (LSOB: die Zone liegt fest), bei anderen
        // ergeben sie sich erst beim Auslösen, weil sie an einem wandernden
        // Indikator hängen. Ohne diese Übernahme würde mit veralteten Werten
        // gehandelt — dem Stand von vor der Korrektur.
        if (Number.isFinite(ev.entry) && ev.entry > 0) setup.entry = ev.entry
        if (Number.isFinite(ev.stopLoss) && ev.stopLoss > 0) setup.stopLoss = ev.stopLoss
        if (Number.isFinite(ev.takeProfit)) setup.takeProfit = ev.takeProfit
        const risiko = Math.abs(setup.entry - setup.stopLoss)
        setup.rr = setup.takeProfit > 0 && risiko > 0
            ? Math.abs(setup.takeProfit - setup.entry) / risiko
            : 0

        const ergebnis = await fuehreAus({ instance, setup, ev, candles, schalter, costs })
        await knex('strategy_setups').where('id', ev.id).update({
            status: ergebnis.ok ? 'open' : 'rejected',
            rejectReason: ergebnis.ok ? '' : (ergebnis.reason || ''),
            triggeredAt: ev.triggeredAt || 0,
            entry: setup.entry,
            stopLoss: setup.stopLoss,
            takeProfit: setup.takeProfit,
            rr: setup.rr,
            confirmations: JSON.stringify(setup.confirmations),
            updatedAt: knex.fn.now(),
        })
        if (ergebnis.ok) ausgefuehrt++
    }

    lastProcessed.set(key, neueste)
    return { candles: candles.length, neu: setups.length, events: events.length, ausgefuehrt, geschlossen: geschlossen.length }
}

/**
 * Ein getriggertes Setup durch Veto, Risiko und Ausführung schicken.
 * Jeder Ausgang — auch jede Ablehnung — landet in `strategy_runs`.
 */
async function fuehreAus({ instance, setup, ev, candles, schalter, costs }) {
    const knex = getKnex()
    const now = ev.triggeredAt || Date.now()

    const lauf = {
        instanceId: instance.id,
        setupId: setup.id,
        sentimentOutput: '{}',
        portfolioOutput: '{}',
        riskOutput: '{}',
        executionOutput: '{}',
        finalAction: '',
        reason: '',
    }
    /**
     * Schreibt den Lauf fort und beendet ihn.
     *
     * `code` ist maschinenlesbar und wird am Setup gespeichert — die Auswertung
     * gruppiert danach und die Oberfläche übersetzt ihn. `detail` ist Klartext
     * für das Protokoll und darf frei formuliert sein. Beides zu vermischen
     * würde die Gruppierung in der Auswertung zerstören.
     *
     * `extra` enthält ausschliesslich JSON-Spalten.
     */
    const beenden = async (action, code, detail = '', extra = {}) => {
        const protokoll = detail ? `${code}: ${detail}` : String(code || '')
        await knex('strategy_runs').insert({
            ...lauf, ...extra, finalAction: action, reason: protokoll.slice(0, 400),
        })
        return { ok: action === 'execute', reason: code }
    }

    // (a) Not-Aus und Betriebsart
    if (schalter.killSwitch) {
        return beenden('reject_risk', RISK_REASONS.KILL_SWITCH)
    }
    if (!BETRIEBSARTEN.includes(instance.mode)) {
        return beenden('reject_risk', 'mode_ausgelagert', `Betriebsart ${instance.mode} ist ausgelagert`)
    }

    // (b) Agenten-Veto — optional, darf NUR ablehnen oder verkleinern
    let sizeFactor = 1
    if (agentHook) {
        try {
            const veto = await agentHook({ instance, setup, candles })
            lauf.sentimentOutput = JSON.stringify(veto.sentiment || {})
            lauf.portfolioOutput = JSON.stringify(veto.portfolio || {})
            lauf.costUsd = Number(veto.costUsd) || 0
            // Diese drei Spalten blieben bisher leer, obwohl sie seit jeher in
            // der Tabelle stehen — die Token-Statistik filtert auf
            // `totalTokens > 0` und übersprang die Strategie-Läufe damit
            // vollständig.
            lauf.totalTokens = Number(veto.totalTokens) || 0
            lauf.provider = veto.provider || ''
            lauf.model = veto.model || ''
            if (veto.action === 'reject') {
                return beenden('reject_agent', 'agent_veto', veto.reason)
            }
            // Ein Faktor > 1 wäre eine Vergrösserung — das dürfen die Agenten nicht.
            // Eine 0 heisst „Grösse null" und ist damit eine Ablehnung.
            sizeFactor = vetoFaktor(veto.sizeFactor)
            if (sizeFactor === 0) return beenden('reject_agent', 'agent_veto', String(veto.reason || 'Agent: Grösse 0').slice(0, 200))
        } catch (e) {
            // Der Nutzer hat das Veto ausdrücklich eingeschaltet. Bei einem
            // Ausfall trotzdem zu handeln hiesse, genau die Prüfung zu
            // überspringen, auf die er sich verlässt — also kein Trade.
            logWarn('strategy-engine', `Agenten-Veto fehlgeschlagen: ${e.message}`)
            return beenden('reject_agent', 'agent_error', String(e.message).slice(0, 200))
        }
    }

    // (b2) Gleiche Einstiegsprüfung wie im Backtest: die Auslösekerze muss den
    // Einstieg erreichbar gemacht haben, und der Stop darf nicht schon in ihr
    // liegen. Ohne diese Prüfung war der Papierbetrieb optimistischer als der Backtest.
    const ausloeseKerze = candles.find((k) => k.t === ev.candleTime) || candles[candles.length - 1]
    const einstiegOk = entryIsValid(setup, ausloeseKerze)
    // 'entry_not_touched' ist endgültig. 'stop_in_entry_candle' dagegen wird im
    // Papierbetrieb NICHT verworfen, sondern unten pessimistisch als Verlust
    // gebucht — sonst verschwinden genau die schlechtesten Fills aus der
    // Statistik und Trefferquote wie Erwartungswert sehen besser aus, als sie
    // sind. Der Schatten bucht so ein Setup schlicht nicht.
    if (!einstiegOk.ok && einstiegOk.reason !== 'stop_in_entry_candle') {
        return beenden('reject_risk', einstiegOk.reason, '')
    }
    const sameBarStop = !einstiegOk.ok

    // (c) Risiko-Gates
    const [equity, kontext, meta] = await Promise.all([
        ladeKontostand(instance),
        ladeRisikoKontext(instance, now),
        marktMetaFuer(instance, setup.symbol),
    ])

    // Kein Referenzkurs: die Kursabweichungs-Prüfung gilt einer echten
    // Marktorder, und die sendet die Engine nicht mehr.
    const referencePrice = 0

    // Hebel: der eingestellte, gedeckelt durch die Einstellung.
    const risk = {
        ...instance.risk,
        leverage: Math.min(instance.risk.leverage, schalter.maxLeverage),
    }
    const pruefung = evaluateRisk({
        setup, risk, equity,
        openPositions: kontext.openPositions,
        todayNetPnl: kontext.todayNetPnl,
        lastExitBySymbol: kontext.lastExitBySymbol,
        now,
        marketMeta: meta || {},
        referencePrice,
        killSwitch: schalter.killSwitch,
    })
    lauf.riskOutput = JSON.stringify({ equity, todayNetPnl: kontext.todayNetPnl, ...pruefung })
    if (!pruefung.ok) return beenden('reject_risk', pruefung.reason, pruefung.detail)

    // (d) Ausführung. Der Agenten-Faktor verkleinert die Größe, nie umgekehrt.
    const size = { ...pruefung.size, qty: pruefung.size.qty * sizeFactor }
    if (!(size.qty > 0)) return beenden('reject_risk', RISK_REASONS.SIZE_TOO_SMALL)

    // Deterministische Order-Kennung: ein zweiter Versuch mit demselben Setup
    // läuft in den Unique-Index und kann keine zweite Position öffnen.
    const clientOrderId = `ctj-${instance.id}-${setup.id}`

    // Same-Bar-Stop: kein Broker-Aufruf, sondern pessimistische Papier-Buchung
    // (Einstieg an der Zonenkante, Ausstieg am Stop derselben Kerze).
    if (sameBarStop) {
        if (instance.mode !== 'paper') return beenden('reject_risk', 'stop_in_entry_candle', '')
        const eroeff = await openPaperPosition({
            instance, setup, size, entryPrice: einstiegsPreis(setup, ausloeseKerze),
            entryTime: now, costs, clientOrderId,
        }).catch(() => ({ ok: false }))
        if (!eroeff.ok) return beenden('reject_risk', 'duplicate_order', '')
        const zeile = await knex('strategy_positions').where('id', eroeff.positionId).first()
        const gap = setup.direction === 'long'
            ? Math.min(setup.stopLoss, ausloeseKerze.o)
            : Math.max(setup.stopLoss, ausloeseKerze.o)
        await closePaperPositionManually({ instance, positionRow: zeile, price: gap, time: now, costs, reason: 'sl' })
        return beenden('execute', '', 'same_bar_stop')
    }

    // Frische Schalterprüfung im Schattenbetrieb: seit dem Taktbeginn können
    // Sekunden vergangen sein (Marktdaten, LLM-Veto). Ein inzwischen
    // gedrückter Not-Aus soll den Einstieg HIER noch stoppen.
    if (instance.mode !== 'paper') {
        const frisch = await ladeSchalter()
        if (frisch.killSwitch) return beenden('reject_risk', RISK_REASONS.KILL_SWITCH)
    }

    // ═ Reihenfolge ist hier die halbe Sicherheit ═
    // ZUERST die Reservierung in der DB (Unique auf clientOrderId), DANN die
    // Order. Andersherum kann ein Absturz zwischen Order und Insert beim
    // nächsten Takt eine zweite Order auslösen — und der Duplikat-Zweig würde
    // dann die Position glattstellen, die der ERSTE Versuch korrekt eröffnet
    // hat. Genau dieser Ablauf stand hier bis zum Audit vom 14.08.
    let eroeffnet
    try {
        eroeffnet = await openPaperPosition({
            instance, setup, size,
            // Eine Stop-Order füllt zur Eröffnung, wenn die Kerze schon
            // jenseits des Niveaus aufmacht — siehe `einstiegsPreis`.
            entryPrice: einstiegsPreis(setup, ausloeseKerze),
            entryTime: now,
            costs, clientOrderId,
            status: 'open',
        })
    } catch (err) {
        eroeffnet = { ok: false, reason: 'open_failed', detail: err.message }
    }
    if (!eroeffnet.ok) {
        // Duplikat heisst: ein früherer Versuch hat die Reservierung schon —
        // hier wird NICHTS geschlossen und NICHTS erneut gesendet.
        return beenden('reject_risk', eroeffnet.reason || 'open_failed', eroeffnet.detail || '')
    }

    return beenden('execute', '', '', {
        executionOutput: JSON.stringify({
            mode: instance.mode, clientOrderId,
            qty: size.qty, entry: setup.entry, stopLoss: setup.stopLoss, takeProfit: setup.takeProfit,
            sizeFactor,
            gesendet: false,
        }),
    })
}

// ── Takt und Abgleich ────────────────────────────────────────────────────

async function verarbeiteInstanz(row, schalter) {
    const instance = ladeInstanz(row)
    if (!instance || !instance.enabled || !instance.symbols.length) return

    if (running.get(instance.id)) return          // Guard je Instanz
    running.set(instance.id, true)

    const knex = getKnex()
    try {
        // Zeiteinheit AUSSEN, Symbol innen: die Liste ist von fein nach grob
        // sortiert, und bei knappem Risikobudget soll nicht die Reihenfolge der
        // Symbole entscheiden, welche Zeiteinheit noch einen Platz bekommt.
        for (const timeframe of instance.timeframes) {
            for (const symbol of instance.symbols) {
                await verarbeiteSymbol(instance, symbol, timeframe, schalter)
            }
        }
        await knex('strategy_instances').where('id', instance.id).update({
            lastRunAt: Date.now(), lastError: '',
        })
        stats.runs++
        stats.lastRunAt = Date.now()
    } catch (e) {
        stats.errors++
        if (!marktdatenAus(e)) {
            ausGemeldet.delete(instance.id)
            logError('strategy-engine', `Instanz ${instance.id} (${instance.name}) fehlgeschlagen`, e)
        } else if (!ausGemeldet.has(instance.id)) {
            ausGemeldet.add(instance.id)
            logWarn('strategy-engine', `Instanz ${instance.id} (${instance.name}) ausgesetzt: ${e.message}`)
        }
        await knex('strategy_instances').where('id', instance.id)
            .update({ lastError: String(e.message).slice(0, 500) })
            .catch(() => {})
    } finally {
        running.delete(instance.id)
    }
}

/**
 * Offene Papier-/Schatten-Positionen fortschreiben — unabhängig davon, ob die
 * Instanz noch aktiv ist. Ohne diesen Nachlauf würde der Not-Aus (der alle
 * Instanzen deaktiviert) die offenen Positionen einfrieren: kein Stop, kein
 * Ziel, kein Break-Even mehr. Ein Not-Aus, der laufende Ausstiege stoppt,
 * wäre das Gegenteil von Sicherheit.
 */
async function pflegeOffenePositionen() {
    const knex = getKnex()
    const zeilen = await knex('strategy_positions')
        .where('status', 'open').whereIn('mode', ['paper', 'shadow'])
        .select('instanceId', 'symbol', 'timeframe', 'lastCandleTime', 'entryTime')
    // Die Zeiteinheit gehört in den Schlüssel: eine Instanz kann mehrere
    // gleichzeitig fahren, und jede Position muss mit IHREN Kerzen
    // fortgeschrieben werden.
    const gruppen = new Map()
    for (const z of zeilen) {
        const key = `${z.instanceId}|${z.symbol}|${z.timeframe}`
        const ab = Number(z.lastCandleTime) || Number(z.entryTime) || Date.now()
        gruppen.set(key, Math.min(gruppen.get(key) ?? Infinity, ab))
    }
    for (const [key, minAb] of gruppen) {
        const [instanceId, symbol, posTf] = key.split('|')
        try {
            const row = await knex('strategy_instances').where('id', Number(instanceId)).first()
            const instance = row ? ladeInstanz(row) : null
            if (!instance) continue
            // So viele Kerzen holen, dass die Lücke seit dem letzten Stand
            // wirklich abgedeckt ist. Eine fixe Zahl würde nach längerem
            // Ausfall `lastCandleTime` über die Lücke hinweg vorspulen — ein
            // Stop IN der Lücke würde dann nie ausgewertet.
            // Die Zeiteinheit der POSITION zählt, nicht die der Instanz: bei
            // mehreren Zeiteinheiten je Instanz gehören die Kerzen sonst nicht
            // zur Position, und ihr Zeitausstieg würde falsch gemessen.
            const pflegeTf = isValidTimeframe(posTf) ? posTf : instance.timeframe
            const tfMs = timeframeMs(pflegeTf)
            const bedarf = Math.min(990, Math.max(60, Math.ceil((Date.now() - minAb) / tfMs) + 3))
            const candles = await getClosedCandles(symbol, pflegeTf, bedarf, { market: instance.market })
            if (!candles?.length) continue
            if (candles[0].t > minAb + tfMs * 1.5) {
                logWarn('strategy-engine', `Kerzenlücke ${symbol}: Abdeckung beginnt erst ${new Date(candles[0].t).toISOString()} — Nachlauf ausgesetzt, um keine Stops zu überspringen`)
                continue
            }
            await stepPaperPositions({
                instance, symbol, timeframe: pflegeTf, candles,
                costs: kostenAus(instance.risk),
                breakEvenAtR: instance.params.breakEvenAtR ?? instance.strategie?.regeln?.breakEvenAtR ?? 0,
                maxHoldMs: ((instance.params.maxHoldCandles ?? instance.strategie?.regeln?.maxHoldCandles ?? 0) || 0) * timeframeMs(pflegeTf),
                partialTpR: instance.params.partialTpR,
                partialTpPct: instance.params.partialTpPct,
                maintenanceMarginPct: await wartungsmargePctFuer(symbol, instance.risk.maintenanceMarginPct),
            })
        } catch (e) {
            // Ohne Marktdaten steht es schon einmal bei der Instanz im Log (`ausGemeldet`).
            if (!marktdatenAus(e)) logWarn('strategy-engine', `Positions-Nachlauf ${instanceId}/${symbol} fehlgeschlagen: ${e.message}`)
        }
    }
}

/** Ein Takt: alle aktiven Instanzen prüfen. Arbeit fällt nur bei neuer Kerze an. */
let tickLaeuft = false
export async function tick({ vorher = null } = {}) {
    if (engineStopped) return false
    // Ein Takt, der länger als das Intervall braucht, darf nicht vom nächsten
    // überholt werden — sonst verarbeiten zwei Läufe dieselben Setups parallel.
    if (tickLaeuft) return false
    tickLaeuft = true
    try {
        // Führung holen, BEVOR irgendetwas geschrieben wird. Auch der
        // Positions-Nachlauf schliesst Positionen und bucht Trades — er gehört
        // deshalb mit hinein, nicht nur die Einstiege.
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) {
            if (hatFuehrung) {
                logWarn('strategy-engine', 'Führung verloren — ein anderer Prozess taktet jetzt')
            }
            hatFuehrung = false
            stats.fremdgefuehrt++
            return false
        }
        hatFuehrung = true

        // Erst NACH dem Guard, sonst leert ein abgewiesener manueller Takt den
        // Kerzen-Cache und derselbe Schluss wird doppelt erkannt.
        if (typeof vorher === 'function') vorher()
        stats.ticks++
        const knex = getKnex()
        const schalter = await ladeSchalter()

        // Ausstiege IMMER pflegen — auch bei Not-Aus und für deaktivierte
        // Instanzen. Nur neue Einstiege hängen an den Schaltern.
        await pflegeOffenePositionen()

        if (schalter.killSwitch) return true   // Not-Aus: Takt lief (Nachlauf), nur nichts Neues

        const rows = await knex('strategy_instances').where('enabled', 1)
        for (const row of rows) {
            // Zwischen den Instanzen verlängern: ein Durchgang über mehrere
            // Symbole und Zeiteinheiten kann die TTL sonst überschreiten, und
            // dann übernähme ein zweiter Prozess MITTEN im Takt.
            if (!(await verlaengereFuehrung(FUEHRUNG_KEY))) {
                hatFuehrung = false
                logWarn('strategy-engine', 'Führung während des Takts verloren — Durchgang abgebrochen')
                return false
            }
            await verarbeiteInstanz(row, schalter)
        }
        return true
    } finally {
        tickLaeuft = false
    }
}

export function engineStatus() {
    return {
        running: !engineStopped && Boolean(tickTimer),
        // Damit niemand rätselt, warum eine aktive Instanz nichts tut: der
        // Schalter steht in der Umgebung des Prozesses, nicht in der Datenbank.
        abgeschaltet: umgebungAn('NO_ENGINE') || istTestbetrieb(),
        // Zweiter Grund für „läuft, tut aber nichts": ein anderer Prozess führt.
        fuehrung: hatFuehrung,
        aktiveLaeufe: [...running.keys()],
        verarbeitet: Object.fromEntries(lastProcessed),
        ...stats,
    }
}

/** Erzwingt beim nächsten Takt eine Neuauswertung (nach Parameteränderung). */
export function resetSymbolCache(instanceId = null) {
    if (instanceId === null) { lastProcessed.clear(); return }
    for (const key of [...lastProcessed.keys()]) {
        if (key.startsWith(`${instanceId}|`)) lastProcessed.delete(key)
    }
}

export function startStrategyEngine() {
    if (tickTimer) return
    engineStopped = false
    tick().catch((e) => logError('strategy-engine', 'Erster Takt fehlgeschlagen', e))
    tickTimer = setInterval(() => {
        tick().catch((e) => logError('strategy-engine', 'Takt fehlgeschlagen', e))
    }, TICK_MS)
    console.log(` -> Strategie-Engine gestartet (Takt ${TICK_MS / 1000}s)`)
}

export async function stopStrategyEngine() {
    engineStopped = true
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    // Laufende Durchgänge auslaufen lassen, damit keine halbe Order zurückbleibt
    const bis = Date.now() + 10000
    while (running.size && Date.now() < bis) {
        await new Promise((r) => setTimeout(r, 100))
    }
    running.clear()
    // Führung zurückgeben, damit ein anderer Prozess sofort übernehmen kann
    // statt die volle Nachsicht-Frist abzuwarten.
    if (hatFuehrung) {
        await gibFuehrungFrei(FUEHRUNG_KEY)
        hatFuehrung = false
    }
}

/**
 * Eine offene Papier- oder Schattenposition von Hand schliessen.
 *
 * Eine `live`-Zeile (aus der Zeit vor S13) wird NICHT gebucht: ob sie an der
 * Börse noch steht, weiss nur die Börse, und die fragt AutarkTrade nicht mehr.
 * Sie lokal zu schliessen, hiesse einen Trade ins Journal zu schreiben, der an
 * der Börse vielleicht offen weiterläuft. Also bleibt sie stehen und die
 * Ablehnung sagt warum.
 */
export async function schliessePositionManuell({ instance, positionRow, price, time, costs, reason = 'manual' }) {
    if (!BETRIEBSARTEN.includes(positionRow.mode)) {
        return { ok: false, reason: 'live_ausgelagert', trade: null }
    }
    const trade = await closePaperPositionManually({ instance, positionRow, price, time, costs, reason })
    return { ok: true, trade }
}

/**
 * Not-Aus: stoppt alle Instanzen. `closePositions` schliesst zusätzlich alle
 * offenen Papier- und Schattenpositionen.
 */
export async function killSwitch({ closePositions = false } = {}) {
    const knex = getKnex()
    await knex('settings').where('id', 1).update({ strategyKillSwitch: 1 })
    await knex('strategy_instances').update({ enabled: 0 })

    let geschlossen = 0
    const fehlgeschlagen = []
    if (closePositions) {
        // 'pending' ist eine Reservierung, zu der eine Order unterwegs sein
        // KANN; 'closing' eine, deren Schliessung haengengeblieben ist. Beide
        // gehoeren in einen Not-Aus — er ist die Stelle, an der lieber einmal
        // zu viel nachgesehen wird.
        // Nur Papier/Schatten: ausgelagerte Live-Zeilen bleiben unangetastet.
        const offen = await knex('strategy_positions').whereIn('status', ['open', 'closing', 'pending'])
            .whereIn('mode', BETRIEBSARTEN)
        for (const row of offen) {
            const instRow = await knex('strategy_instances').where('id', row.instanceId).first()
            const instance = instRow ? ladeInstanz(instRow) : null
            if (!instance) continue
            const preis = await getLastPrice(row.symbol, { market: instance.market }).catch(() => Number(row.entryPrice))
            const r = await schliessePositionManuell({
                instance, positionRow: row, price: preis, time: Date.now(),
                costs: kostenAus(instance.risk),
                reason: 'manual',
            }).catch((err) => ({ ok: false, reason: err.message }))
            if (r.ok) geschlossen++
            // Eine Position, die nicht zu schliessen war, MUSS sichtbar bleiben —
            // sonst wiegt der Not-Aus in falscher Sicherheit.
            else fehlgeschlagen.push({ id: row.id, symbol: row.symbol, grund: r.reason })
        }
    }
    resetSymbolCache()
    return { geschlossen, fehlgeschlagen }
}
