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
import { getStrategy, validateParams, validateRisk, AGENT_DEFAULTS, normalisiereTimeframes, htfBedarf, ladeRegelStrategien, sichtFensterKerzen } from './strategies/index.js'
import { getClosedCandles, getSymbolMeta, getLastPrice, timeframeMs, isValidTimeframe } from './market-data.js'
import { evaluateRisk, startOfDayUtc, RISK_REASONS, rundeMenge, grenzenFuer } from './risk-engine.js'
import { openPaperPosition, stepPaperPositions, getPaperEquity, closePaperPositionManually } from './execution/paper.js'
import { entryIsValid, kostenAus, einstiegsPreis, einstiegsSorte, einstiegsZeit, einstiegsArtVon } from './fill-simulator.js'
import { agentenVeto } from './strategy-agents.js'
// `instance.broker` nennt die Börse, deren Rundungsregeln der Schattenbetrieb
// anlegt. Orders sendet die Engine seit S13 keine mehr (docs/SPAETER-SCHARFER-HANDEL.md).
import { holeAdapter } from './execution/index.js'
import { beansprucheFuehrung, verlaengereFuehrung, gibFuehrungFrei } from './db-claim.js'
import { wartungsmargePctFuer } from './margin-rates.js'
import { umgebungAn } from './umgebung.js'
import { istTestbetrieb } from './umgebung.js'
import { istAus as marktdatenAus } from './marktdaten/index.js'
import { aussortierteZeilen } from './strategie-aussortiert.js'
import { zeitpunkt } from '../shared/strategieChart.js'
import { aktienKontext } from './aktien/kontext.js'
import { bereinigeSplits, positionUeberSplit, faelligeSplits, leseSplitVermerk, verdaechtigeSpruenge } from './aktien/splits.js'
import { handelstagBeginn, einstiegRegulaer } from '../shared/aktien-sitzung.js'
import { imZahlenFenster, terminListe } from '../shared/aktien-zahlen.js'

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
/**
 * Gleicher Schlüssel → Kerzenzeit, für die schon frisch (force) nachgefragt
 * wurde. Eigene Map, weil `lastProcessed` bei mancher Kerze nie gesetzt wird
 * (unter 50 Kerzen, HTF fehlt) — sonst kehrte die Nachfrage jeden Takt wieder.
 */
const nachgefragt = new Map()
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

/**
 * Woher die Engine weiss, ob ein Symbol ein Aktien-Future ist. Im Betrieb
 * `aktienKontext` (Stamm in der Datenbank, Splits und Zahlentermine von der
 * Kursquelle). Über `setAktienKontext` austauschbar — für Selbsttests, die
 * einen Aktien-Kontext stellen, ohne Stamm und ohne Netz.
 */
let kontextQuelle = aktienKontext
export function setAktienKontext(fn) { kontextQuelle = typeof fn === 'function' ? fn : aktienKontext }
const kontextVon = async (symbol, opt) => kontextQuelle(symbol, opt)

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
        // Start der Instanz — aussortierte Signale davor hat sie nie gesehen
        seit: zeitpunkt(row.createdAt) || 0,
        // Markt der Instanz (alle Symbole Aktien-Futures oder keines) — bemisst
        // das Sichtfenster des Tages-VWAP (FACH-H-009).
        anlageklasse: row.anlageklasse === 'aktien' ? 'aktien' : 'krypto',
        symbols, params, risk, agents, strategie,
    }
}

// ── Eigene Regelstrategien mit der DB abgleichen ─────────────────────────

/**
 * Fingerabdruck der Tabelle `rule_strategies` beim letzten Laden.
 *
 * Die Registry lebt im Prozess. Ändert ein ZWEITER Prozess an derselben DB
 * eine Regel (Entwicklungsserver mit AT_NO_ENGINE=1, NAS führt die Engine),
 * lud der führende Prozess sie bis zum Neustart nicht nach: er rechnete mit
 * den alten Regeln weiter, buchte aber unter der neuen paramsVersion, und eine
 * dort neu angelegte Strategie übersprang er still (Audit 4.3.4, FUN-L2-003).
 * Jetzt vergleicht jeder Takt einen billigen Fingerabdruck und lädt bei
 * Abweichung neu.
 */
let regelStand = null

async function regelFingerabdruck(knex) {
    const z = await knex('rule_strategies')
        .count({ n: '*' }).sum({ v: 'version' }).sum({ e: 'enabled' })
        .max({ u: 'updatedAt' }).max({ i: 'id' }).first()
    return JSON.stringify([Number(z?.n) || 0, Number(z?.v) || 0, Number(z?.e) || 0, String(z?.u ?? ''), Number(z?.i) || 0])
}

/**
 * Alle aktiven Regelstrategien aus der DB in die Registry laden und den
 * Fingerabdruck merken. `ladeAlleRegelStrategien` (strategy-api.js) ruft das
 * nach jeder eigenen Änderung auf, der Takt nur bei fremder.
 */
export async function ladeRegelStrategienAusDb() {
    const knex = getKnex()
    const stand = await regelFingerabdruck(knex)
    const rows = await knex('rule_strategies').where('enabled', 1)
    const r = ladeRegelStrategien(rows)
    regelStand = stand
    return r
}

/** true, wenn neu geladen wurde (dann ist auch der Kerzen-Cache geleert). */
async function gleicheRegelStrategienAb() {
    const stand = await regelFingerabdruck(getKnex())
    if (stand === regelStand) return false
    const erstes = regelStand === null
    const r = await ladeRegelStrategienAusDb()
    for (const f of r.fehlerhaft) {
        logWarn('strategy-engine', `Regelstrategie "${f.strategyId}" nicht ladbar: ${f.fehler.join('; ')}`)
    }
    if (!erstes) {
        logWarn('strategy-engine', 'Regelstrategien in der DB geändert (anderer Prozess?) — neu geladen')
        lastProcessed.clear()
        nachgefragt.clear()
    }
    return true
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
 * `now` ist der SCHLUSS der Auslösekerze (`risikoStichtag`), nicht die
 * Systemzeit. Bis 31.10.2026 war es ihr Beginn (`ev.triggeredAt`): seit der
 * Regel `zu_spaet_erkannt` liegt der Auslöser immer auf der jüngsten
 * geschlossenen Kerze, der Stichtag lag damit genau eine Kerze VOR dem
 * Entscheid. Bei mehreren Zeiteinheiten sah ein 4h-Auslöser um 12:00 den Stand
 * von 08:00 — eine 15m-Position von 09:15 galt als nicht offen (zweite
 * Position trotz Deckel und Duplikat-Sperre), 15m-Verluste und -Ausstiege seit
 * 08:00 zählten weder für Tageslimit noch für Sperrfrist (Audit 4.3.4,
 * FUN-F1-001). Der Backtest rechnet mit demselben Stichtag.
 *
 * Geschichte: Beim ersten Lauf über ein Symbol wertete die Strategie ihr ganzes
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
 * wirkungslos und es ändert sich nichts. Der Fix betraf damals den Rücklauf,
 * den es seit `zu_spaet_erkannt` nicht mehr gibt; die Schranken bleiben, weil
 * sie Einträge nach dem Stichtag (andere Zeiteinheit, späterer Takt) sauber
 * ausschliessen.
 */
export function risikoKontextAbfragen(knex, instanceId, now, tagesBeginn = startOfDayUtc(now)) {
    // `tagesBeginn`: Coins Mitternacht UTC (Vorgabe), Aktien-Futures der New
    // Yorker Handelstag (`handelstagBeginn`) — wie im Backtest.
    // Der Trade GENAU dieser Position: gleiche Positions-Nummer, gleiche
    // Instanz, gleicher Einstieg. Die Nummer allein reicht nicht — nach einer
    // Rücksicherung in eine frische DB zählen die Positions-Nummern wieder ab
    // 1, während die zurückgespielten Trades die alten Nummern tragen; eine
    // neue Position galt dann sofort als geschlossen (FUN-L3-001).
    // Bezeichner über ?? binden, nicht blank in whereRaw: PostgreSQL faltet
    // ungequotetes camelCase zu Kleinbuchstaben.
    const tradeDerPosition = (q) => q
        .select(knex.raw('1'))
        .from('strategy_trades')
        .whereRaw('?? = ??', ['strategy_trades.positionId', 'strategy_positions.id'])
        .whereRaw('?? = ??', ['strategy_trades.instanceId', 'strategy_positions.instanceId'])
        .whereRaw('?? = ??', ['strategy_trades.entryTime', 'strategy_positions.entryTime'])
    return {
        // Offen ZUM ZEITPUNKT now = eingestiegen bis dahin und bis dahin nicht
        // wieder geschlossen. `whereExists` statt Join, damit eine Position
        // nicht doppelt in der Liste landet.
        //
        // 'open' und 'closing' zählen immer ('closing': Altbestand des
        // Stop-Wächters vor S13, eine Position, deren Schliessung hängen-
        // geblieben sein kann — fiele sie raus, sähe die Engine einen freien
        // Platz). 'closed' zählt nur, wenn ihr Trade erst NACH now endet. Bis
        // 31.10.2026 zählte eine geschlossene Position ohne Trade für immer
        // als offen — so sieht jede Position aus, die nach dem letzten Backup
        // geschlossen wurde, wenn das Backup zurückgespielt wird: die Instanz
        // sperrte das Symbol und nahm ab dem Deckel nichts mehr an, während
        // Liste und Überblick 0 offen zeigten (FUN-L3-001).
        //
        // `pending` bleibt draussen wie bisher: das war die Reservierung VOR
        // einer Live-Order (Altbestand vor S13), keine Position.
        offen: knex('strategy_positions')
            .where({ instanceId })
            .where('entryTime', '<=', now)
            .where((q) => q
                .whereIn('status', ['open', 'closing'])
                .orWhere((g) => g
                    .where('status', 'closed')
                    .whereExists((t) => tradeDerPosition(t).where('strategy_trades.exitTime', '>', now)))),
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

/**
 * Stichtag der Risikoprüfung: Schluss der Auslösekerze. Ohne Kerzenzeit (alte
 * Detektoren) die Systemzeit — so meldeten sie den Auslöser schon immer.
 */
/**
 * Kerzen eines Aktien-Futures vor jedem Split umrechnen — wie im Backtest
 * (`server/aktien/splits.js`). Für Coins und bei unbekannten Splits unverändert.
 *
 * `bericht` nennt die Splits, deren Sprung in diesem Fenster steht
 * (`angewendet`, `bei` = erste Kerze im neuen Massstab). Damit rechnet
 * `rechneUeberSplitsUm` offene Positionen um.
 *
 * `verdacht` (nur Aktien-Futures, sonst `null`): ein junger Sprung ≥ 1,8×
 * zwischen zwei Schlusskursen, den auch die FRISCH geholten Splits nicht
 * erklären (`verdaechtigeSpruenge` — dieselbe Prüfung wie im Backtest). Die
 * Kursquelle führt einen Split womöglich noch nicht, und der Speicher in
 * `aktien/kontext.js` hält auch eine leere Liste zwölf Stunden für bekannt;
 * ohne diese Wache träfe die erste Kerze nach dem Sprung unbereinigt den Stop
 * eines Longs, und ein Trade mit −95 % stünde endgültig in `strategy_trades`
 * (Audit 15.11.2026, FUN-F-006). Die Aufrufer setzen bei Verdacht die Runde
 * aus; der nächste Takt fragt wieder.
 */
async function mitSplits(symbol, candles, market) {
    if (!candles?.length) return { kerzen: candles, bericht: [], aktie: null, verdacht: null }
    // `market` der Instanz geht mit: ein Spot-Symbol ist nie ein Aktien-Future (BUG-K-001).
    let aktie = await kontextVon(symbol, { market })
    // Coin: unverändert, und kein Blick auf Sprünge — dort gibt es keine Splits.
    if (!aktie) return { kerzen: candles, bericht: [], aktie, verdacht: null }
    const rechne = (a) => (a.splits?.length ? bereinigeSplits(candles, a.splits) : { kerzen: candles, splits: [] })
    let b = rechne(aktie)
    let verdacht = jungerSprung(b.kerzen)
    if (verdacht) {
        // Am Speicher vorbei nachfragen (dort gebremst auf einmal je zehn Minuten und Symbol).
        const frisch = await kontextVon(symbol, { splitsFrisch: true, market }).catch(() => null)
        if (frisch) {
            aktie = frisch
            b = rechne(aktie)
            verdacht = jungerSprung(b.kerzen)
        }
    }
    return { kerzen: b.kerzen, bericht: b.splits.filter((x) => x.angewendet), aktie, verdacht }
}

/**
 * So lange nach einem unerklärten Sprung wartet der Papierbetrieb auf die
 * Split-Angabe der Kursquelle (drei Tage — ein Wochenende). Danach gilt der
 * Sprung als Kursbewegung und wird gebucht wie jede andere: eine Position
 * endlos einzufrieren, weil ein Titel wirklich um die Hälfte gefallen ist,
 * wäre der grössere Fehler. Gemessen an der jüngsten Kerze, nicht an der Uhr.
 */
const SPLIT_VERDACHT_MS = 72 * 3600_000

/** Der jüngste verdächtige Sprung innerhalb der Wartezeit — oder `null`. */
function jungerSprung(kerzen) {
    const ab = kerzen[kerzen.length - 1].t - SPLIT_VERDACHT_MS
    const liste = verdaechtigeSpruenge(kerzen).filter((x) => x.t > ab)
    return liste.length ? liste[liste.length - 1] : null
}

/** Einmal je Sprung ins Log, nicht je Takt. */
const verdachtGemeldet = new Map()
function meldeSplitVerdacht(schluessel, symbol, verdacht) {
    if (verdachtGemeldet.get(schluessel) === verdacht.t) return
    verdachtGemeldet.set(schluessel, verdacht.t)
    logWarn('strategy-engine', `${symbol}: Kurssprung ×${kurz(verdacht.verhaeltnis >= 1 ? verdacht.verhaeltnis : 1 / verdacht.verhaeltnis)} `
        + `${verdacht.verhaeltnis >= 1 ? 'nach unten' : 'nach oben'} am ${new Date(verdacht.t).toISOString()}, den kein bekannter Split erklärt — `
        + 'Runde ausgesetzt, Splits werden neu geholt (längstens drei Tage, danach zählt der Sprung als Kursbewegung)')
}

async function splitBereinigt(symbol, candles, market) {
    return (await mitSplits(symbol, candles, market)).kerzen
}

const kurz = (v) => (Number.isFinite(Number(v)) ? String(Number(Number(v).toPrecision(8))) : '–')
const splitText = (x) => x.text || (x.faktor >= 1 ? `${kurz(x.faktor)}:1` : `1:${kurz(1 / x.faktor)}`)

/**
 * Offene Papier-/Schatten-Positionen und wartende Setups über einen Split.
 *
 * Die Kerzen sind ab dem Sprung im neuen Massstab (`mitSplits`); eine
 * Position, die davor eröffnet wurde, trägt Einstieg, Stop und Ziel noch im
 * alten. Ohne Umrechnung löste ein Split 20:1 sofort den Stop eines Longs aus
 * (Kurs «fällt» um 95 %), eine Zusammenlegung das Ziel — Ergebnisse, die es
 * nie gab. Gerechnet wird wie bei Bitget (`positionUeberSplit`): Menge ×
 * Faktor, Kurse ÷ Faktor; der Wert der Position bleibt gleich. (Binance
 * schliesst solche Positionen laut Sekundärquelle — das ist nicht belegt und
 * wird nicht nachgebildet.)
 *
 * GENAU EINMAL je Split und Position: der Vermerk `splitsAngewendet` steht in
 * derselben Transaktion wie die neuen Werte, und geändert wird nur, wenn der
 * Vermerk noch so dasteht wie gelesen. Ein Neustart zwischen Umrechnung und
 * Fortschreiben oder ein zweiter Prozess rechnet deshalb kein zweites Mal.
 * Jede Umrechnung steht als Zeile `split` im Verlauf der Instanz
 * (`strategy_runs`).
 *
 * Wartende Setups aus der Zeit vor dem Split werden NICHT umgerechnet, sondern
 * mit dem Grund `split` beendet — so wie die Börsen offene Orders löschen.
 * Ihre Kursmarken stehen zum Teil in strategie-eigenen Feldern
 * (`confirmations`), die hier niemand kennt; ein halb umgerechnetes Setup
 * würde zu einem Kurs «ausgelöst», den es nicht mehr gibt. Setups, die schon
 * auf bereinigten Kerzen entstanden, tragen den Split im Vermerk und bleiben.
 *
 * Grenzen: gefunden wird ein Split nur, solange sein Sprung im Kerzenfenster
 * steht und zur Angabe der Kursquelle passt (`bereinigeSplits`); sind die
 * Splits unbekannt, wird nichts umgerechnet und nichts geraten.
 *
 * @returns {Promise<{positionen: number, setups: number}>} was umgerechnet bzw. beendet wurde
 */
export async function rechneUeberSplitsUm({ instanceId, symbol, timeframe = '', bericht, kerzeMs = 0 }) {
    const wirksam = (bericht || []).filter((x) => x.angewendet && x.bei > 0)
    const aus = { positionen: 0, setups: 0 }
    if (!wirksam.length) return aus
    const knex = getKnex()

    const offen = await knex('strategy_positions')
        .where({ instanceId, symbol, status: 'open' })
        .modify((q) => { if (timeframe) q.where('timeframe', timeframe) })
        .whereIn('mode', BETRIEBSARTEN)
    for (const row of offen) {
        const vermerk = leseSplitVermerk(row.splitsAngewendet)
        const faellig = faelligeSplits(wirksam, {
            lastCandleTime: Number(row.lastCandleTime) || Number(row.entryTime) || 0, kerzeMs, vermerk,
        })
        if (!faellig.length) continue
        const stand = { ...row }
        const aenderung = {}
        for (const x of faellig) {
            const d = positionUeberSplit(stand, x.faktor)
            Object.assign(stand, d)
            Object.assign(aenderung, d)
        }
        const neuerVermerk = JSON.stringify([...vermerk,
            ...faellig.map((x) => ({ t: x.t, faktor: x.faktor, bei: x.bei, text: x.text || '' }))])
        const text = faellig.map((x) => `${splitText(x)} am ${new Date(x.t).toISOString().slice(0, 10)}`).join(', ')
        await knex.transaction(async (trx) => {
            const q = trx('strategy_positions').where({ id: row.id, status: 'open' })
            const beansprucht = await (row.splitsAngewendet
                ? q.where('splitsAngewendet', row.splitsAngewendet)
                : q.where((w) => w.whereNull('splitsAngewendet').orWhere('splitsAngewendet', '')))
                .update({ ...aenderung, splitsAngewendet: neuerVermerk, updatedAt: trx.fn.now() })
            if (!beansprucht) return
            aus.positionen++
            await trx('strategy_runs').insert({
                instanceId, setupId: Number(row.setupId) || 0, finalAction: 'split',
                reason: (`split: ${symbol} ${text} — offene Position #${row.id} umgerechnet: `
                    + `Menge ${kurz(row.qty)} → ${kurz(stand.qty)}, Einstieg ${kurz(row.entryPrice)} → ${kurz(stand.entryPrice)}, `
                    + `Stop ${kurz(row.stopLoss)} → ${kurz(stand.stopLoss)}, Ziel ${kurz(row.takeProfit)} → ${kurz(stand.takeProfit)}`).slice(0, 400),
                executionOutput: JSON.stringify({
                    art: 'split', positionId: row.id, splits: faellig.map((x) => ({ t: x.t, faktor: x.faktor, bei: x.bei, text: x.text || '' })),
                    vorher: Object.fromEntries(Object.keys(aenderung).map((k) => [k, Number(row[k])])),
                    nachher: aenderung,
                }),
            })
        })
    }

    const wartend = await knex('strategy_setups')
        .where({ instanceId, symbol })
        .modify((q) => { if (timeframe) q.where('timeframe', timeframe) })
        .whereIn('status', WARTEND)
    for (const r of wartend) {
        const gesehen = new Set(leseSplitVermerk(r.splitsAngewendet).map((x) => Number(x.t)))
        const split = wirksam.find((x) => !gesehen.has(Number(x.t)) && Number(r.obCandleTime) < x.bei)
        if (!split) continue
        aus.setups += await knex('strategy_setups').where('id', r.id).whereIn('status', WARTEND).update({
            status: 'invalidated', invalidReason: 'split', endeT: split.bei, updatedAt: knex.fn.now(),
        })
    }
    return aus
}

export function risikoStichtag(ev, tfMs) {
    const beginn = Number(ev?.candleTime ?? ev?.triggeredAt) || 0
    return beginn > 0 ? beginn + (tfMs || 0) : Date.now()
}

async function ladeRisikoKontext(instance, now, tagesBeginn) {
    const abfragen = risikoKontextAbfragen(getKnex(), instance.id, now, tagesBeginn)
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
 * Der Papierbetrieb behält die Marktdatenquelle — genau wie der Backtest, sonst runden
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

/** Zustände eines Setups, die noch auf den Auslöser warten. */
const WARTEND = ['armed', 'waiting_retest']

/**
 * Ist die Instanz JETZT noch aktiv und nicht archiviert? Frisch aus der DB,
 * nicht aus der Zeile vom Taktbeginn: `neustartInstanz` (oder Pausieren) kann
 * mitten in einem Takt kommen, während die Engine auf Kerzen oder das
 * Agenten-Veto wartet.
 */
async function instanzNochAktiv(instanceId) {
    const z = await getKnex()('strategy_instances').where('id', instanceId)
        .select('enabled', 'archiviert').first()
    return Boolean(z && Number(z.enabled) && !Number(z.archiviert))
}

async function verarbeiteSymbol(instance, symbol, timeframe, schalter) {
    const knex = getKnex()
    const p = instance.params

    // Verankerte Linien brauchen ihren Anker im Sichtfenster (Wochen-VWAP auf
    // 15m ≈ 700 Kerzen). Ohne diesen Aufschlag bliebe die Linie im Betrieb leer,
    // während sie im Backtest gerechnet wurde — dieselbe Strategie würde live
    // schweigen und niemand wüsste, warum. ATH/ATL (`Infinity`) kann die Engine
    // nicht halten; dort bleibt die Linie bewusst leer, der Interpreter erfährt
    // das über `historieVerkuerzt`. Dieselbe Rechnung wie im Backtest
    // (`sichtFensterKerzen`), samt Indikatorperioden und `ltfKerzen`.
    // Aktien-Instanz: der Tages-VWAP einer Regelstrategie verankert an der
    // US-Eröffnung und braucht bis zu sechs Tage Sicht (FACH-H-009).
    const bedarf = sichtFensterKerzen(instance.strategie, p, timeframeMs(timeframe),
        { endlich: true, aktie: instance.anlageklasse === 'aktien' })

    let { kerzen: candles, bericht: splitBericht, aktie, verdacht: splitVerdacht } = await mitSplits(symbol,
        await getClosedCandles(symbol, timeframe, bedarf, { market: instance.market }), instance.market)
    // Für Aktien-Futures reist der Rutsch-Aufschlag ausserhalb der regulären
    // Sitzung mit (Vorgabe 0); bei Coins nie.
    const costs = kostenAus(instance.risk, { aktie: Boolean(aktie) })
    if (!candles.length) return { skipped: 'zu wenige Kerzen' }
    const key = `${instance.id}|${symbol}|${timeframe}`
    if (lastProcessed.get(key) === candles[candles.length - 1].t) return { skipped: 'keine neue Kerze' }

    // Deutlich weniger als verlangt: einmal frisch nachfragen, bevor die Kerze
    // als verarbeitet gilt. Ein verkürztes Fenster (leerer Anker-VWAP, nicht
    // eingeschwungene EMA) würde sonst nie korrekt nachgerechnet. Bleibt es
    // kurz, ist die Historie wirklich so kurz (junger Coin, Quelle) — dann
    // wird damit gearbeitet wie bisher. Erst NACH der Prüfung auf eine neue
    // Kerze und höchstens einmal je Kerze: bei dauerhaft kurzer Historie
    // brächte die Nachfrage nichts und verdoppelte nur die Abrufe je Takt.
    const kurzVon = candles[candles.length - 1].t
    if (candles.length < bedarf * 0.9 && nachgefragt.get(key) !== kurzVon) {
        nachgefragt.set(key, kurzVon)
        const frisch = await mitSplits(symbol, await getClosedCandles(symbol, timeframe, bedarf, { market: instance.market, force: true }), instance.market)
        if (frisch.kerzen.length > candles.length) { candles = frisch.kerzen; splitBericht = frisch.bericht; splitVerdacht = frisch.verdacht }
    }
    if (candles.length < 50) return { skipped: 'zu wenige Kerzen' }

    // Neu lesen: die frische Reihe kann eine Kerze weiter reichen.
    const neueste = candles[candles.length - 1].t
    if (lastProcessed.get(key) === neueste) return { skipped: 'keine neue Kerze' }

    // Unerklärter Sprung (nur Aktien-Futures): diese Runde nichts fortschreiben,
    // nichts erkennen. Die Kerze gilt NICHT als verarbeitet — der nächste Takt
    // fragt die Splits erneut und holt sie nach.
    if (splitVerdacht) {
        meldeSplitVerdacht(key, symbol, splitVerdacht)
        return { skipped: 'split_verdacht' }
    }

    // ── 0. Split im Fenster: offene Positionen umrechnen, alte Setups beenden ──
    // VOR dem Fortschreiben — die Kerzen sind ab dem Sprung im neuen Massstab.
    if (splitBericht.length) {
        await rechneUeberSplitsUm({ instanceId: instance.id, symbol, timeframe, bericht: splitBericht, kerzeMs: timeframeMs(timeframe) })
    }

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
        maintenanceMarginPct: await wartungsmargePctFuer(symbol, instance.risk.maintenanceMarginPct, { aktie: Boolean(aktie), hebel: instance.risk.leverage }),
    })

    // ── 2. Erkennen ──────────────────────────────────────────────────────
    const fensterStart = candles[0].t
    const [offeneSetups, bekannte] = await Promise.all([
        knex('strategy_setups')
            .where({ instanceId: instance.id, symbol, timeframe })
            .whereIn('status', WARTEND),
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
        // `htfKerzen` im Manifest: so viele HTF-Kerzen, wie die Strategie selbst
        // sieht — sie schneidet im Backtest auf dasselbe Fenster zu. Mit nur
        // Periode + 20 Kerzen rechnete der Papierbetrieb eine andere EMA (und
        // Set and Forget eine andere Wochenebene) als das Labor.
        const anzahl = Math.max((p.htfEmaPeriod || 50) + 20, htfBedarf(instance.strategie, p))
        try {
            htfCandles = await splitBereinigt(symbol, await getClosedCandles(
                symbol, p.htfTimeframe, anzahl, { market: instance.market },
            ), instance.market)
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

    const { setups, events, diagnostics } = instance.strategie.detect({
        candles,
        params: p,
        openSetups,
        knownSetupKeys: bekannte.map((r) => `${r.direction}|${r.obCandleTime}`),
        htfCandles,
        // Die Engine hält immer nur ein Fenster, nie die ganze Historie.
        historieVerkuerzt: true,
        // Aktien-Future: Regelstrategien rechnen den Tages-VWAP ab der US-Eröffnung (wie der Backtest).
        aktie: Boolean(aktie),
    })

    // Zwischen Taktbeginn und hier liegen Netzabrufe. Wurde die Instanz in
    // der Zeit neu gestartet (archiviert) oder pausiert, legt sie nichts mehr
    // an: ein neues Setup bliebe im Archiv für immer „scharf" (Audit 4.3.4,
    // FUN-S4-005). Offene Positionen sind oben schon fortgeschrieben.
    if (!(await instanzNochAktiv(instance.id))) return { skipped: 'instanz_inaktiv' }

    // ── 2b. Aussortierte Signale sichern ─────────────────────────────────
    // Was schon am Filter scheiterte, wird nie ein Setup. Ohne diese Zeilen
    // sah eine Instanz, deren Signale alle am Tagestrend scheiterten, aus wie
    // eine stehende Engine. Ein Fehler hier darf den Takt nicht kosten: es
    // geht um Sichtbarkeit, nicht um den Handel.
    if (diagnostics?.rejections?.length) {
        const zeilen = aussortierteZeilen(diagnostics.rejections, {
            instanceId: instance.id, symbol, timeframe,
            paramsVersion: instance.paramsVersion,
            abT: instance.seit, tfMs: timeframeMs(timeframe),
            setupSchluessel: [
                ...bekannte.map((r) => `${r.direction}|${Number(r.obCandleTime)}`),
                ...openSetups.map((s) => `${s.direction}|${Number(s.obCandleTime)}`),
                ...setups.map((s) => `${s.direction}|${Number(s.obCandleTime)}`),
            ],
        })
        if (zeilen.length) {
            await knex('strategy_aussortiert').insert(zeilen)
                .onConflict(['instanceId', 'symbol', 'timeframe', 'direction', 'candleTime']).ignore()
                .catch((e) => logWarn('strategy-engine', `Aussortierte Signale für ${symbol} nicht gespeichert: ${e.message}`))
        }
    }

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
            // Auf Kerzen entstanden, in denen diese Splits schon umgerechnet
            // sind — `rechneUeberSplitsUm` lässt das Setup dann stehen.
            ...(splitBericht.length
                ? { splitsAngewendet: JSON.stringify(splitBericht.map((x) => ({ t: x.t, faktor: x.faktor, bei: x.bei }))) }
                : {}),
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

        // Statuswechsel nur aus einem wartenden Zustand: ein Neustart kann das
        // Setup inzwischen mit `archiviert` abgeschlossen haben, und das darf
        // kein später Takt mehr überschreiben.
        if (ev.status !== 'triggered') {
            await knex('strategy_setups').where('id', ev.id).whereIn('status', WARTEND).update({
                status: ev.status,
                invalidReason: ev.invalidReason || '',
                endeT: Number(ev.candleTime) || 0,
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
        await knex('strategy_setups').where('id', ev.id).whereIn('status', WARTEND).update({
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
 * Wie viele Kerzen liegt der Auslöser hinter der jüngsten geschlossenen Kerze?
 * 0 heisst: er liegt auf ihr und darf gehandelt werden. Ohne Zeitangabe am
 * Ereignis gilt er als aktuell — so meldeten es die Detektoren schon immer.
 */
export function ausloeserAlter(ev, candles, tfMs) {
    const neuesteT = candles?.[candles.length - 1]?.t || 0
    const ausloeserT = Number(ev?.candleTime ?? ev?.triggeredAt) || 0
    if (!(ausloeserT > 0) || !(neuesteT > ausloeserT)) return 0
    return Math.max(1, Math.round((neuesteT - ausloeserT) / (tfMs || 1)))
}

/**
 * Ein getriggertes Setup durch Veto, Risiko und Ausführung schicken.
 * Jeder Ausgang — auch jede Ablehnung — landet in `strategy_runs`.
 */
async function fuehreAus({ instance, setup, ev, candles, schalter, costs }) {
    const knex = getKnex()
    // Zwei Zeitpunkte: `now` ist der Beginn der Auslösekerze und bleibt die
    // Einstiegszeit der Position (wie im Backtest). Der Risiko-Kontext wird
    // dagegen zum SCHLUSS der Auslösekerze gestellt (`stichtag`) — erst dann
    // fällt die Entscheidung. Siehe `risikoKontextAbfragen`.
    const now = ev.triggeredAt || Date.now()
    const stichtag = risikoStichtag(ev, timeframeMs(setup.timeframe))

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

    // (a2) Zu spät erkannt: gehandelt wird nur ein Auslöser auf der jüngsten
    // geschlossenen Kerze. Ein älterer ist ein Signal, das zum Zeitpunkt
    // seiner Kerze niemand kannte — der erste Scan über das Fenster nach dem
    // Anlegen, ein Neustart, eine Pause oder ein Detektor, der spät erkennt.
    // Bis 01.11.2026 wurde so etwas als Papier-Trade nachgebucht (bei #15
    // waren es alle drei ersten Trades). Dieselbe Regel gilt im Backtest; der
    // scharfe Betrieb vor S13 nannte sie `stale_trigger`.
    const alter = ausloeserAlter(ev, candles, timeframeMs(setup.timeframe))
    if (alter > 0) return beenden('reject_risk', 'zu_spaet_erkannt', `Auslöser ${alter} Kerzen alt`)

    // (a3) Aktien-Futures: Börsensitzung statt UTC-Tag. Auf Wunsch nur in der
    // regulären US-Sitzung einsteigen — massgebend ist, wann gefüllt wird
    // (`einstiegRegulaer`, dieselbe Funktion wie im Backtest und dieselbe
    // Regel wie im Chart, FUN-H-005). Ab 1d ist der Schalter nicht anwendbar
    // und bleibt ohne Wirkung.
    const aktie = await kontextVon(setup.symbol, { market: instance.market })
    if (aktie && instance.risk?.nurRegulaereSitzung) {
        const urteil = einstiegRegulaer(Number(ev?.candleTime ?? ev?.triggeredAt) || now, timeframeMs(setup.timeframe), einstiegsArtVon(ev, setup))
        if (!urteil.regulaer) return beenden('reject_risk', 'ausserhalb_sitzung', `Sitzung ${urteil.sitzung}`)
    }
    // (a4) …und auf Wunsch kein Einstieg rund um einen Zahlentermin (ein Tag
    // davor bis ein Tag danach). Sind die Termine unbekannt, wirkt die Sperre
    // nicht — wie im Backtest.
    if (aktie?.termine && instance.risk?.meideZahlentermine) {
        const termin = imZahlenFenster(Number(ev?.candleTime ?? ev?.triggeredAt) || now, terminListe(aktie.termine).liste)
        if (termin) return beenden('reject_risk', 'zahlentermin', `Zahlen am ${new Date(termin).toISOString().slice(0, 10)}`)
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
    // 'entry_not_touched' ist endgültig. 'stop_in_entry_candle' dagegen wird
    // NICHT verworfen, sondern unten pessimistisch als Verlust gebucht — sonst
    // verschwinden genau die schlechtesten Fills aus der Statistik und
    // Trefferquote wie Erwartungswert sehen besser aus, als sie sind. Bis
    // 01.11.2026 liess der Schatten solche Setups weg; jetzt bucht er sie wie
    // Papier und Backtest.
    if (!einstiegOk.ok && einstiegOk.reason !== 'stop_in_entry_candle') {
        return beenden('reject_risk', einstiegOk.reason, '')
    }
    const sameBarStop = !einstiegOk.ok

    // (c) Risiko-Gates
    const [equity, kontext, meta] = await Promise.all([
        ladeKontostand(instance),
        ladeRisikoKontext(instance, stichtag, aktie ? handelstagBeginn(stichtag) : undefined),
        marktMetaFuer(instance, setup.symbol),
    ])

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
        now: stichtag,
        marketMeta: meta || {},
        killSwitch: schalter.killSwitch,
        // Nur für den Rutsch-Aufschlag eines Aktien-Futures ausserhalb der Sitzung.
        aktie: Boolean(aktie),
        einstiegsZeit: sameBarStop ? now : einstiegsZeit(ev, setup, now, timeframeMs(setup.timeframe)),
    })
    lauf.riskOutput = JSON.stringify({ equity, todayNetPnl: kontext.todayNetPnl, ...pruefung })
    if (!pruefung.ok) return beenden('reject_risk', pruefung.reason, pruefung.detail)

    // (d) Ausführung. Der Agenten-Faktor verkleinert die Größe, nie umgekehrt —
    // und die kleinere Menge muss wieder auf die Börsenregeln (Schrittweite,
    // Mindest- und Höchstmenge), sonst zeigt der Schatten eine Menge, die es
    // dort nicht gibt.
    let size = pruefung.size
    if (sizeFactor < 1) {
        const r = rundeMenge(size.qty * sizeFactor, setup.entry,
            grenzenFuer(meta || {}, einstiegsSorte(costs, setup)))
        if (!r.qty) return beenden('reject_risk', r.reason || RISK_REASONS.SIZE_TOO_SMALL)
        size = { ...size, qty: r.qty, notionalUsdt: r.qty * setup.entry }
    }
    if (!(size.qty > 0)) return beenden('reject_risk', RISK_REASONS.SIZE_TOO_SMALL)

    // Deterministische Order-Kennung: ein zweiter Versuch mit demselben Setup
    // läuft in den Unique-Index und kann keine zweite Position öffnen.
    const clientOrderId = `ctj-${instance.id}-${setup.id}`

    // Vor dem Eröffnen die Instanz frisch prüfen: das Agenten-Veto und die
    // Abrufe oben können Sekunden dauern. Eine inzwischen archivierte Instanz
    // eröffnet keine Position mehr (Audit 4.3.4, FUN-S4-005).
    if (!(await instanzNochAktiv(instance.id))) return beenden('reject_risk', 'instanz_inaktiv')

    // Same-Bar-Stop: kein Broker-Aufruf, sondern pessimistische Papier-Buchung
    // (Einstieg an der Zonenkante, Ausstieg am Stop derselben Kerze).
    if (sameBarStop) {
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
            // Einstieg zum Schluss: die Position beginnt mit dem Ende der
            // Auslösekerze (wie im Backtest, `einstiegsZeit`); der Nachlauf
            // setzt trotzdem erst nach ihr an (`abKerze` = ihr Beginn).
            entryTime: einstiegsZeit(ev, setup, now, timeframeMs(setup.timeframe)),
            costs, clientOrderId,
            // Einstieg zur Eröffnung: die Auslösekerze selbst gehört schon zur
            // Position (Ziel, Liquidation, Break-Even) — der Nachlauf beginnt
            // deshalb VOR ihr, wie im Backtest. Den Stop darin hat
            // `entryIsValid` oben schon geprüft.
            abKerze: ev.entryAtOpen ? now - 1 : now,
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
    if (!instance) {
        // Aktiv, aber hier nicht ausführbar: das muss die Oberfläche sehen.
        // Bis 31.10.2026 blieb `lastError` leer und die Instanz stand als
        // „aktiv" da, obwohl die Engine sie in jedem Takt übersprang.
        const grund = !getStrategy(row.strategyId)
            ? `Strategie „${row.strategyId}" ist in diesem Prozess nicht geladen`
            : `Ungültige Zeiteinheit ${row.timeframe}`
        if (Number(row.enabled) && row.lastError !== grund) {
            await getKnex()('strategy_instances').where('id', row.id)
                .update({ lastError: grund }).catch(() => {})
        }
        return
    }
    if (!instance.enabled || !instance.symbols.length) return

    if (running.get(instance.id)) return          // Guard je Instanz
    running.set(instance.id, true)

    const knex = getKnex()
    try {
        // Zeiteinheit AUSSEN, Symbol innen: die Liste ist von fein nach grob
        // sortiert, und bei knappem Risikobudget soll nicht die Reihenfolge der
        // Symbole entscheiden, welche Zeiteinheit noch einen Platz bekommt.
        let erstes = true
        for (const timeframe of instance.timeframes) {
            for (const symbol of instance.symbols) {
                // Auch zwischen den Symbolen verlängern: ein Abruf über viele
                // Seiten (Monats-VWAP) oder eine lange Instanz kann die TTL
                // sonst innerhalb EINER Instanz überschreiten.
                if (!erstes && !(await verlaengereFuehrung(FUEHRUNG_KEY))) {
                    hatFuehrung = false
                    logWarn('strategy-engine', `Führung während Instanz ${instance.id} verloren — Durchgang abgebrochen`)
                    return
                }
                erstes = false
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
 * Regeln einer archivierten Instanz: die Fassung, die beim Archivieren galt
 * (jüngste in `rule_strategy_history` bis `archiviertAm`). `null` bei
 * eingebauten Strategien oder ohne passende Fassung — dann gilt die aktuelle.
 */
async function regelnZumArchiv(knex, row) {
    const am = Number(row.archiviertAm) || 0
    if (!am || !getStrategy(row.strategyId)?.istRegelStrategie) return null
    const z = await knex('rule_strategy_history')
        .where('strategyId', row.strategyId).where('createdAt', '<=', am)
        .orderBy('version', 'desc').first('rules')
    const regeln = parseJson(z?.rules, null)
    return regeln && typeof regeln === 'object' ? regeln : null
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
            const { kerzen: candles, bericht: splitBericht, aktie, verdacht: splitVerdacht } = await mitSplits(symbol,
                await getClosedCandles(symbol, pflegeTf, bedarf, { market: instance.market }), instance.market)
            if (!candles?.length) continue
            // Unerklärter Sprung, über den die Position noch nicht fortgeschrieben ist: aussetzen (siehe `mitSplits`).
            if (splitVerdacht && splitVerdacht.t > minAb) {
                meldeSplitVerdacht(`pflege|${key}`, symbol, splitVerdacht)
                continue
            }
            if (candles[0].t > minAb + tfMs * 1.5) {
                logWarn('strategy-engine', `Kerzenlücke ${symbol}: Abdeckung beginnt erst ${new Date(candles[0].t).toISOString()} — Nachlauf ausgesetzt, um keine Stops zu überspringen`)
                continue
            }
            // Ein Archiv behält die Regeln vom Archivieren: eine spätere
            // Regeländerung soll seine offenen Positionen nicht mehr umstellen
            // (FUN-L2-001). Aktive Instanzen erben Änderungen — so gewollt.
            const regeln = Number(row.archiviert)
                ? (await regelnZumArchiv(knex, row)) || instance.strategie?.regeln
                : instance.strategie?.regeln
            // Split seit dem letzten Stand: erst umrechnen, dann fortschreiben.
            if (splitBericht.length) {
                await rechneUeberSplitsUm({ instanceId: instance.id, symbol, timeframe: pflegeTf, bericht: splitBericht, kerzeMs: tfMs })
            }
            await stepPaperPositions({
                instance, symbol, timeframe: pflegeTf, candles,
                costs: kostenAus(instance.risk, { aktie: Boolean(aktie) }),
                breakEvenAtR: instance.params.breakEvenAtR ?? regeln?.breakEvenAtR ?? 0,
                maxHoldMs: ((instance.params.maxHoldCandles ?? regeln?.maxHoldCandles ?? 0) || 0) * timeframeMs(pflegeTf),
                partialTpR: instance.params.partialTpR,
                partialTpPct: instance.params.partialTpPct,
                maintenanceMarginPct: await wartungsmargePctFuer(symbol, instance.risk.maintenanceMarginPct, { aktie: Boolean(aktie), hebel: instance.risk.leverage }),
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
        // Regeln aus einem anderen Prozess übernehmen, bevor gerechnet wird.
        await gleicheRegelStrategienAb().catch((e) =>
            logWarn('strategy-engine', `Abgleich der Regelstrategien fehlgeschlagen: ${e.message}`))

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
    // Auch die Nachfrage-Merker: nach einer Parameteränderung kann der
    // Kerzenbedarf ein anderer sein.
    if (instanceId === null) { lastProcessed.clear(); nachgefragt.clear(); return }
    for (const map of [lastProcessed, nachgefragt]) {
        for (const key of [...map.keys()]) {
            if (key.startsWith(`${instanceId}|`)) map.delete(key)
        }
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
            // Ohne (lauffähige) Instanz keine Kosten und kein Konto — schliessen
            // geht nicht. Bis 31.10.2026 übersprang der Not-Aus sie still und
            // meldete vollen Erfolg, während Waisen einer Rücksicherung weiter
            // offen standen (FUN-L3-002). Ausbuchen geht in der Instanzenliste.
            if (!instance) {
                fehlgeschlagen.push({ id: row.id, symbol: row.symbol, grund: instRow ? 'instanz_nicht_lauffaehig' : 'instanz_fehlt' })
                continue
            }
            const preis = await getLastPrice(row.symbol, { market: instance.market }).catch(() => Number(row.entryPrice))
            const r = await schliessePositionManuell({
                instance, positionRow: row, price: preis, time: Date.now(),
                costs: kostenAus(instance.risk, { aktie: Boolean(await kontextVon(row.symbol, { market: instance.market }).catch(() => null)) }),
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
