/**
 * Robustheitsprüfungen — die Stufen zwischen „guter Backtest" und „belastbar".
 *
 * Der beste Backtest ist keine Aussage. Er ist die Spitze einer Verteilung, aus
 * der man ihn ausgewählt hat. Diese Datei liefert die drei Prüfungen, die aus
 * einer Zahl eine Einschätzung machen:
 *
 *   1. Parameterstabilität — steht der Wert auf einem Plateau oder auf einer
 *      Nadel? Ein Gipfel, dessen Nachbarn abstürzen, ist Zufall.
 *   2. Monte Carlo — dieselbe Strategie, andere Reihenfolge oder andere
 *      Stichprobe. Beantwortet: wie schlimm konnte es zwischendurch aussehen?
 *   3. Walk-forward — rollend optimieren und immer auf dem FOLGENDEN,
 *      ungesehenen Fenster prüfen. Die ehrlichste Form von „hätte es damals
 *      funktioniert".
 *
 * Alles hier rechnet auf fertigen Backtest-Ergebnissen. Es gibt keinen eigenen
 * Simulator — sonst würde die Robustheitsprüfung etwas anderes messen als der
 * Backtest, den sie beurteilen soll.
 */

import { runBacktest, berechneStatistik, MIN_TRADES_BELASTBAR, MAX_BACKTEST_CANDLES } from './strategy-backtest.js'
import { getStrategy, validateParams, htfBedarf } from './strategies/index.js'
import { getHistoricalCandles, getFundingHistory, getSymbolMeta, timeframeMs } from './market-data.js'

/** Mindestzahl Trades, ab der ein Wert im Walk-forward überhaupt gewählt wird. */
export const WF_MIN_TRADES = 10

/** Vorlauf (ms), damit ein Lauf ab `fromTs` handelt statt erst nach dem Warmup. */
function vorlaufMs(basis) {
    const strategie = getStrategy(basis.strategyId)
    if (!strategie || !basis.timeframe) return 0
    return (strategie.warmupCandles || 200) * timeframeMs(basis.timeframe)
}

/**
 * HTF-Vorlauf (Kerzen) für einen Parametersatz — 0, wenn der Trendfilter aus
 * ist oder keine eigene höhere Zeiteinheit verlangt wird.
 */
function htfVorlaufKerzen(strategie, basis, params) {
    if (!strategie) return { tf: null, kerzen: 0 }
    const p = validateParams(basis.strategyId, params || {}).values
    if (!(p.htfTrendFilter && p.htfTimeframe && p.htfTimeframe !== basis.timeframe)) return { tf: null, kerzen: 0 }
    return { tf: p.htfTimeframe, kerzen: htfBedarf(strategie, p) }
}

/**
 * Daten EINES Symbols für den ganzen Zeitraum, einmal geladen: Kerzen (mit
 * Vorlauf), die HTF-Kerzen, Funding-Verlauf, Börsenregeln.
 *
 * Bis 01.11.2026 holte jede Stufe jedes Laufs ihre Kerzen selbst neu — eine
 * Matrix über 8 Symbole, zwei Hälften und 25 Stufen waren bis zu 400 Abrufe
 * derselben Daten, und jedes Fenster verlor seine ersten 200 Kerzen an den
 * Warmup.
 *
 * Der HTF-Vorlauf richtet sich nach der Stufe, die am meisten braucht
 * (`stufen`: die Parametersätze aller Stufen). Bis 31.10.2026 kam er allein
 * aus den Grundparametern: eine Stufe `zonenFensterHtf: 1000` (Bedarf 1010
 * Tageskerzen) rechnete mit 290 Tagen Vorlauf und damit andere Trades als
 * Einzel-Backtest und Papier — bei Seed 2 ein scheinbar tragendes Plateau
 * (+1,06/+3,18 R) gegen −1,14/−0,45 R im Einzellauf (Audit 4.3.4, FUN-L4-002).
 */
export async function ladeVorrat(basis, { stufen = [] } = {}) {
    const market = basis.market === 'spot' ? 'spot' : 'futures'
    const vorlauf = vorlaufMs(basis)
    const vorrat = {
        symbol: basis.symbol,
        vorlauf,
        candles: await getHistoricalCandles(basis.symbol, basis.timeframe,
            Number(basis.fromTs) - vorlauf, basis.toTs, { market, maxCandles: MAX_BACKTEST_CANDLES }),
        marketMeta: null, fundingVerlauf: null, htf: null,
    }
    try { vorrat.marketMeta = await getSymbolMeta(basis.symbol, { market }) } catch { vorrat.marketMeta = null }
    if (market === 'futures') {
        try { vorrat.fundingVerlauf = await getFundingHistory(basis.symbol, Number(basis.fromTs) - vorlauf, basis.toTs) } catch { vorrat.fundingVerlauf = null }
    }
    const strategie = getStrategy(basis.strategyId)
    const grund = htfVorlaufKerzen(strategie, basis, basis.params)
    if (grund.tf) {
        // Grösster Bedarf über Grundparameter und alle Stufen derselben
        // höheren Zeiteinheit — Stufen mit einer anderen holen selbst.
        let kerzen = grund.kerzen
        for (const params of stufen) {
            const stufe = htfVorlaufKerzen(strategie, basis, params)
            if (stufe.tf === grund.tf && stufe.kerzen > kerzen) kerzen = stufe.kerzen
        }
        const htfVorlauf = kerzen * timeframeMs(grund.tf)
        try {
            vorrat.htf = {
                tf: grund.tf,
                vorlauf: htfVorlauf,
                candles: await getHistoricalCandles(basis.symbol, grund.tf,
                    Number(basis.fromTs) - vorlauf - htfVorlauf, basis.toTs, { market, maxCandles: MAX_BACKTEST_CANDLES }),
            }
        } catch { vorrat.htf = null }
    }
    return vorrat
}

/**
 * Ein Backtest über einen Ausschnitt des Vorrats: Kerzen ab `von − Vorlauf`,
 * gehandelt wird ab `von`. HTF-Kerzen nur, wenn die Stufe dieselbe höhere
 * Zeiteinheit nutzt wie der Vorrat UND sein Vorlauf für ihren Bedarf reicht —
 * sonst holt der Lauf sie selbst, mit dem Vorlauf, den Einzel-Backtest und
 * Papier auch hätten. Geschnitten wird auf den Bedarf DIESER Stufe.
 */
function ausVorrat(vorrat, basis, params, von, bis) {
    const ab = von - vorrat.vorlauf
    const candles = vorrat.candles.filter((k) => k.t >= ab && k.t < bis)
    const opts = {
        ...basis, params, fromTs: ab, toTs: bis, candles,
        marketMeta: vorrat.marketMeta, fundingVerlauf: vorrat.fundingVerlauf,
    }
    const stufe = htfVorlaufKerzen(getStrategy(basis.strategyId), basis, params)
    if (vorrat.htf && stufe.tf === vorrat.htf.tf) {
        const stufenVorlauf = stufe.kerzen * timeframeMs(stufe.tf)
        if (stufenVorlauf <= vorrat.htf.vorlauf) {
            const htfAb = ab - stufenVorlauf
            opts.htfCandles = vorrat.htf.candles.filter((k) => k.t >= htfAb && k.t < bis)
        }
    }
    return runBacktest(opts)
}

/** Die Parametersätze aller Stufen — für den HTF-Vorlauf des Vorrats. */
function stufenParams(basis, paramKey, stufen) {
    return paramKey ? stufen.map((wert) => ({ ...basis.params, [paramKey]: wert })) : []
}

/** Deckel, damit ein Klick den Server nicht für Stunden beschäftigt. */
export const MAX_STUFEN = 25
export const MAX_MC_LAEUFE = 5000
export const MAX_WF_FENSTER = 12

/**
 * Kleiner, aussaatfähiger Zufall (mulberry32).
 *
 * Bewusst nicht `Math.random`: eine Robustheitsprüfung, die bei jedem Aufruf
 * andere Zahlen liefert, lässt sich weder testen noch nachvollziehen. Mit
 * derselben Aussaat kommt dasselbe Ergebnis — das ist bei einer Kennzahl, auf
 * die jemand eine Entscheidung stützt, keine Spielerei.
 */
export function zufall(aussaat = 1) {
    let a = aussaat >>> 0
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Perzentil einer unsortierten Zahlenreihe (lineare Interpolation). */
export function perzentil(werte, p) {
    const s = [...werte].sort((a, b) => a - b)
    if (!s.length) return 0
    const i = (s.length - 1) * p
    const unten = Math.floor(i)
    const oben = Math.ceil(i)
    return unten === oben ? s[unten] : s[unten] + (s[oben] - s[unten]) * (i - unten)
}

/**
 * Verlauf einer Kapitalkurve aus einer Trade-Folge: Endstand und grösster
 * Rückgang. Arbeitet auf Geldbeträgen, nicht auf R — der Rückgang, der wehtut,
 * ist der in Prozent vom Kapital.
 *
 * Jeder Eintrag ist `{ r, anteil }`: das Ergebnis in R und der Anteil des
 * Kontos, der bei diesem Trade im Risiko stand.
 */
function verlauf(folge, startEquity) {
    let equity = startEquity
    let hoch = startEquity
    let maxDd = 0
    for (const { r, anteil } of folge) {
        // Fester Anteil vom JEWEILIGEN Kontostand je R — so bemisst auch der
        // Backtest seine Positionen. Gemischte Dollarbeträge aus einem
        // wachsenden Konto hätten späte, grosse Trades an den Anfang gestellt.
        equity += equity * anteil * r
        if (equity > hoch) hoch = equity
        const dd = hoch > 0 ? ((hoch - equity) / hoch) * 100 : 0
        if (dd > maxDd) maxDd = dd
    }
    return { endEquity: equity, maxDrawdownPct: maxDd }
}

/**
 * Monte Carlo über eine vorhandene Trade-Liste — in R, je Trade mit dem
 * Risikoanteil, den der Backtest wirklich eingegangen ist (`risikoAnteil` am
 * Trade). Seit 01.11.2026; vorher wurden die Dollarbeträge gemischt, die aus
 * einem wachsenden Konto stammten.
 *
 * Der Risikoanteil kommt seit 31.10.2026 vom Trade selbst und nicht mehr aus
 * `risikoPct`: der Notional-Deckel, die Marge und die Mengenrundung
 * verkleinern die Position, `rMultiple` bezieht sich auf dieses kleinere
 * Risiko. Mit dem vollen Prozentsatz bildete der Pfad „original" den Backtest
 * nicht nach (Endstand 914 statt 979, Rückgang 16,7 % statt 4,5 % bei einem
 * Deckel, der das Risiko auf ein Viertel drückte). `risikoPct` gilt nur noch
 * für Trades ohne diese Angabe (ältere gespeicherte Läufe, Selbsttests).
 *
 * Zwei Fragen, zwei Verfahren — sie beantworten NICHT dasselbe:
 *
 *   `reihenfolge` mischt dieselben Trades neu. Der Endstand bleibt gleich, der
 *   Rückgang unterwegs nicht. Antwort auf: „hatte ich Glück mit der Abfolge?"
 *
 *   `ziehen` zieht mit Zurücklegen eine gleich lange Stichprobe. Auch der
 *   Endstand schwankt. Antwort auf: „wie sähe ein anderer Durchgang derselben
 *   Strategie aus?"
 *
 * @param {Array} trades      abgeschlossene Trades mit `rMultiple` (und `risikoAnteil`)
 * @param {object} opts       { startEquity, laeufe, aussaat, risikoPct }
 */
export function monteCarlo(trades, { startEquity = 1000, laeufe = 1000, aussaat = 1, risikoPct = 1 } = {}) {
    const ersatzAnteil = (Number(risikoPct) > 0 ? Number(risikoPct) : 1) / 100
    const betraege = (trades || [])
        .filter((t) => t.exitReason !== 'open_at_end')
        .map((t) => ({
            r: Number(t.rMultiple) || 0,
            anteil: Number(t.risikoAnteil) > 0 ? Number(t.risikoAnteil) : ersatzAnteil,
        }))

    if (betraege.length < 2) {
        return { trades: betraege.length, hinweis: 'Zu wenige Trades für eine Verteilung', laeufe: 0 }
    }
    const n = Math.max(1, Math.min(Number(laeufe) || 1000, MAX_MC_LAEUFE))
    const rnd = zufall(aussaat)

    const original = verlauf(betraege, startEquity)
    const endMisch = []
    const ddMisch = []
    const endZiehen = []
    const ddZiehen = []

    for (let i = 0; i < n; i++) {
        // (a) mischen — Fisher-Yates auf einer Kopie
        const kopie = [...betraege]
        for (let j = kopie.length - 1; j > 0; j--) {
            const k = Math.floor(rnd() * (j + 1))
            ;[kopie[j], kopie[k]] = [kopie[k], kopie[j]]
        }
        const a = verlauf(kopie, startEquity)
        endMisch.push(a.endEquity)
        ddMisch.push(a.maxDrawdownPct)

        // (b) ziehen mit Zurücklegen
        const probe = Array.from({ length: betraege.length }, () => betraege[Math.floor(rnd() * betraege.length)])
        const b = verlauf(probe, startEquity)
        endZiehen.push(b.endEquity)
        ddZiehen.push(b.maxDrawdownPct)
    }

    const auswertung = (enden, dds) => ({
        endEquity: {
            p5: perzentil(enden, 0.05), p50: perzentil(enden, 0.5), p95: perzentil(enden, 0.95),
        },
        maxDrawdownPct: {
            p50: perzentil(dds, 0.5), p95: perzentil(dds, 0.95), schlimmster: Math.max(...dds),
        },
        // Wie oft endet der Durchgang unter dem Startkapital? Das ist die Zahl,
        // die ein Erwartungswert von „+0,4 R" gern verschweigt.
        anteilVerlust: enden.filter((e) => e < startEquity).length / enden.length,
    })

    // Mittlerer Risikoanteil, wie er wirklich gerechnet wurde — weicht er vom
    // eingestellten Prozentsatz ab, hat ein Deckel gegriffen.
    const mittel = betraege.reduce((s, b) => s + b.anteil, 0) / betraege.length
    return {
        trades: betraege.length,
        laeufe: n,
        aussaat,
        risikoPct: mittel * 100,
        risikoPctEingestellt: ersatzAnteil * 100,
        original,
        reihenfolge: auswertung(endMisch, ddMisch),
        ziehen: auswertung(endZiehen, ddZiehen),
        belastbar: betraege.length >= MIN_TRADES_BELASTBAR,
    }
}

/**
 * Parameterstabilität: denselben Backtest über eine Reihe von Werten fahren.
 *
 * Gesucht ist kein Bestwert, sondern ein PLATEAU — eine Zone, in der auch die
 * Nachbarn tragen. Steht der beste Wert allein zwischen schlechten, hat man das
 * Rauschen optimiert und nicht die Strategie.
 */
export async function parameterStabilitaet(basis, paramKey, werte, opts = {}) {
    const stufen = (Array.isArray(werte) ? werte : []).slice(0, MAX_STUFEN)
    if (!paramKey || stufen.length < 3) {
        return { fehler: 'Mindestens drei Werte nötig, um eine Nachbarschaft zu beurteilen' }
    }

    const vorrat = opts.vorrat || await ladeVorrat(basis, { stufen: stufenParams(basis, paramKey, stufen) })
    const von = Number(opts.von ?? basis.fromTs)
    const bis = Number(opts.bis ?? basis.toTs)
    const punkte = []
    for (const wert of stufen) {
        const r = await ausVorrat(vorrat, basis, { ...basis.params, [paramKey]: wert }, von, bis)
        punkte.push({
            wert,
            // Abdeckung mitführen: eine Stufe ohne Trades kann bedeuten „nichts
            // ausgelöst" ODER „für diesen Zeitraum gab es das Symbol noch nicht".
            // Ohne diese Unterscheidung liest sich beides gleich.
            abdeckung: r.stats.abdeckung || null,
            datenOk: r.stats.abdeckung ? r.stats.abdeckung.vollstaendig !== false : true,
            trades: r.stats.trades || 0,
            expectancyR: r.stats.expectancyR || 0,
            expectancyROhneTop: r.stats.expectancyROhneTop || 0,
            profitFactor: r.stats.profitFactor,
            returnPct: r.stats.returnPct || 0,
            maxDrawdownPct: r.stats.maxDrawdownPct || 0,
            belastbar: Boolean(r.stats.belastbar),
        })
    }

    return { paramKey, punkte, ...beurteilePlateau(punkte) }
}

/**
 * Urteil über eine Stabilitätskurve.
 *
 * Die Regel ist bewusst schlicht und nachvollziehbar: der beste Punkt zählt nur,
 * wenn seine direkten Nachbarn ebenfalls positiv sind. Alles andere ist eine
 * Nadel — hübsch im Rückblick, unbrauchbar für die Zukunft.
 */
export function beurteilePlateau(punkte) {
    const gueltig = (punkte || []).filter((p) => p.trades > 0)
    if (gueltig.length < 3) return { urteil: 'zu_wenig_daten', plateau: [] }

    let bestIdx = 0
    for (let i = 1; i < punkte.length; i++) {
        if ((punkte[i].expectancyR || 0) > (punkte[bestIdx].expectancyR || 0)) bestIdx = i
    }
    const nachbarn = [punkte[bestIdx - 1], punkte[bestIdx + 1]].filter(Boolean)
    const nachbarnTragen = nachbarn.length > 0 && nachbarn.every((n) => (n.expectancyR || 0) > 0)
    const bestPositiv = (punkte[bestIdx].expectancyR || 0) > 0

    // Zusammenhängende Zone um den Bestwert, in der alles positiv bleibt
    const plateau = []
    if (bestPositiv) {
        for (let i = bestIdx; i >= 0 && (punkte[i].expectancyR || 0) > 0; i--) plateau.unshift(punkte[i].wert)
        for (let i = bestIdx + 1; i < punkte.length && (punkte[i].expectancyR || 0) > 0; i++) plateau.push(punkte[i].wert)
    }

    return {
        besterWert: punkte[bestIdx].wert,
        plateau,
        urteil: !bestPositiv ? 'nichts_positiv' : (nachbarnTragen ? 'plateau' : 'nadel'),
    }
}

/**
 * Urteil über eine Stabilitätsmatrix — mehrere Symbole, beide Zeitfenster.
 *
 * Warum das nicht `beurteilePlateau` auf Mittelwerten sein darf: ein Mittelwert
 * glättet genau die Uneinigkeit weg, auf die es ankommt. Gemessen am 16.08.2026
 * sah `swingLookback: 25` im Schnitt am besten aus (+0,211) — getragen von EINER
 * von acht Zellen (BTC im Optimierungsfenster, +1,12). Ohne sie blieben +0,08
 * gegen +0,06 der Ausgangslage, also nichts.
 *
 * Deshalb zählt hier, in WIE VIELEN Zellen ein Wert trägt, und der Mittelpunkt
 * ist der Median — ein einzelner Ausreisser kann ihn nicht kippen.
 */
export function beurteileMatrix(werte, zellen) {
    const proWert = werte.map((wert) => {
        // Zellen ohne belastbare Datengrundlage fliegen RAUS statt als
        // „nicht positiv" zu zählen — sonst zieht eine Datenlücke das Urteil
        // nach unten und sieht aus wie ein Ergebnis über die Strategie.
        const punkte = zellen
            .map((z) => z.punkte.find((p) => p.wert === wert))
            .filter((p) => p && p.trades > 0 && p.datenOk !== false)
        const reihe = punkte.map((p) => p.expectancyR)
        const anteilPositiv = reihe.length ? reihe.filter((x) => x > 0).length / reihe.length : 0
        return {
            wert,
            zellen: reihe.length,
            positiv: reihe.filter((x) => x > 0).length,
            anteilPositiv,
            median: perzentil(reihe, 0.5),
            schlechteste: reihe.length ? Math.min(...reihe) : 0,
            beste: reihe.length ? Math.max(...reihe) : 0,
            // Trägt der Wert in der MEHRHEIT der Zellen und ist sein Median
            // positiv? Beides zusammen — eine hohe Trefferzahl mit negativem
            // Median hiesse „oft knapp positiv, selten heftig negativ".
            traegt: reihe.length >= 2 && anteilPositiv >= 0.6 && perzentil(reihe, 0.5) > 0,
        }
    })

    // Längste zusammenhängende Zone tragender Werte
    let beste = []
    let lauf = []
    for (const p of proWert) {
        if (p.traegt) { lauf.push(p.wert); if (lauf.length > beste.length) beste = [...lauf] }
        else lauf = []
    }

    const irgendwoPositiv = proWert.some((p) => p.median > 0)
    return {
        proWert,
        zone: beste,
        urteil: beste.length >= 3 ? 'plateau'
            : beste.length >= 1 ? 'schmal'
                : irgendwoPositiv ? 'uneinig' : 'nichts_positiv',
    }
}

/**
 * Stabilität über mehrere Symbole UND beide Zeitfenster.
 *
 * Die Aufteilung folgt dem Mehrfach-Test: erste Hälfte zum Aussuchen, zweite
 * zum Prüfen. Ein Wert, der nur in einer Hälfte trägt, ist keine Einstellung,
 * sondern eine Beobachtung über einen Zeitraum.
 */
export async function stabilitaetsMatrix(basis, paramKey, werte, { symbole = [] } = {}) {
    const stufen = (Array.isArray(werte) ? werte : []).slice(0, MAX_STUFEN)
    const syms = (Array.isArray(symbole) && symbole.length ? symbole : [basis.symbol]).slice(0, 8)
    if (!paramKey || stufen.length < 3) {
        return { fehler: 'Mindestens drei Werte nötig, um eine Nachbarschaft zu beurteilen' }
    }

    const mitte = Math.floor((Number(basis.fromTs) + Number(basis.toTs)) / 2)
    const fenster = [
        { name: 'opt', von: Number(basis.fromTs), bis: mitte },
        { name: 'pruef', von: mitte, bis: Number(basis.toTs) },
    ]

    const zellen = []
    for (const symbol of syms) {
        const vorrat = await ladeVorrat({ ...basis, symbol }, { stufen: stufenParams(basis, paramKey, stufen) })
        for (const f of fenster) {
            const r = await parameterStabilitaet(
                { ...basis, symbol, fromTs: f.von, toTs: f.bis }, paramKey, stufen,
                { vorrat, von: f.von, bis: f.bis },
            )
            zellen.push({ symbol, fenster: f.name, von: f.von, bis: f.bis, punkte: r.punkte || [], urteil: r.urteil })
        }
    }

    // Wie viele Zellen mussten wegen fehlender Daten draussen bleiben? Diese
    // Zahl gehört sichtbar neben das Urteil, nicht in eine Fussnote.
    const unvollstaendig = zellen.filter((z) => z.punkte.some((p) => p.datenOk === false)).length
    return {
        paramKey, werte: stufen, symbole: syms, zellen, unvollstaendig,
        ...beurteileMatrix(stufen, zellen),
    }
}

/**
 * Walk-forward: rollend optimieren, immer auf dem FOLGENDEN Fenster prüfen.
 *
 * Der Zeitraum wird in `fenster` gleiche Abschnitte geteilt. Abschnitt i dient
 * der Auswahl, Abschnitt i+1 der Prüfung — und der Prüfabschnitt wird NIE für
 * die Auswahl benutzt. Summiert man nur die Prüfabschnitte, entsteht die Kurve,
 * die man damals tatsächlich gehandelt hätte.
 *
 * `backtest` ist nur zum Prüfen da: der echte Lauf braucht Kerzen aus dem Netz,
 * und ein Test, der dafür online sein muss, wird nicht geschrieben. Voreinstellung
 * ist immer `runBacktest` — der Betrieb merkt von diesem Parameter nichts.
 */
export async function walkForward(basis, paramKey, werte, { fenster = 4, backtest = null, minTrades = WF_MIN_TRADES } = {}) {
    const stufen = (Array.isArray(werte) ? werte : []).slice(0, MAX_STUFEN)
    const n = Math.max(2, Math.min(Number(fenster) || 4, MAX_WF_FENSTER))
    if (!paramKey || stufen.length < 2) {
        return { fehler: 'Mindestens zwei Werte nötig, sonst gibt es nichts auszuwählen' }
    }

    const von = Number(basis.fromTs)
    const bis = Number(basis.toTs)
    const breite = Math.floor((bis - von) / n)
    if (!(breite > 0)) return { fehler: 'Zeitraum zu kurz für diese Zahl von Fenstern' }

    // Ein echter Lauf lädt die Daten EINMAL und gibt jedem Fenster Vorlauf
    // (es handelt ab seinem Beginn). Ein eingespeister Backtest (Selbsttest)
    // bekommt die Fenstergrenzen unverändert.
    const vorrat = backtest ? null : await ladeVorrat(basis, { stufen: stufenParams(basis, paramKey, stufen) })
    const fensterLauf = (params, a, b) => (backtest
        ? backtest({ ...basis, params, fromTs: a, toTs: b })
        : ausVorrat(vorrat, basis, params, a, b))

    const abschnitte = []
    for (let i = 0; i < n - 1; i++) {
        const optVon = von + i * breite
        const optBis = optVon + breite
        const pruefBis = Math.min(optBis + breite, bis)

        // Auswahl auf dem Optimierungsabschnitt — nur unter Werten mit
        // genug Trades. Ein Wert mit zwei Glückstreffern hatte bis 01.11.2026
        // dieselben Chancen wie einer mit vierzig, und meist gewann er.
        let bester = null
        let meisteTrades = 0
        for (const wert of stufen) {
            const r = await fensterLauf({ ...basis.params, [paramKey]: wert }, optVon, optBis)
            const punkt = { wert, expectancyR: r.stats.expectancyR || 0, trades: r.stats.trades || 0 }
            meisteTrades = Math.max(meisteTrades, punkt.trades)
            if (punkt.trades < minTrades) continue
            if (!bester || punkt.expectancyR > bester.expectancyR) bester = punkt
        }
        if (!bester) {
            abschnitte.push({
                optVon, optBis, pruefVon: optBis, pruefBis,
                // `null` statt 0: geprüft wurde hier nichts. Eine 0 erschien
                // bis 31.10.2026 als „0.00 R" in Gewinnfarbe (FUN-L5-002).
                gewaehlt: null, keineAuswahl: true, optTrades: meisteTrades,
                pruefExpectancyR: null, pruefTrades: 0, pruefReturnPct: null, pruefTradesListe: [],
            })
            continue
        }

        // Prüfung auf dem FOLGENDEN Abschnitt — dieser Wert war dort nie gesehen
        const pruef = await fensterLauf({ ...basis.params, [paramKey]: bester.wert }, optBis, pruefBis)
        abschnitte.push({
            optVon, optBis, pruefVon: optBis, pruefBis,
            gewaehlt: bester.wert,
            optExpectancyR: bester.expectancyR,
            optTrades: bester.trades,
            pruefExpectancyR: pruef.stats.expectancyR || 0,
            pruefTrades: pruef.stats.trades || 0,
            pruefReturnPct: pruef.stats.returnPct || 0,
            pruefTradesListe: (pruef.trades || []).filter((t) => t.exitReason !== 'open_at_end'),
        })
    }

    // Nur die Prüfabschnitte ergeben die ehrliche Gesamtkurve.
    //
    // Die Kurve muss hier wirklich gebaut werden. Früher stand an dieser Stelle
    // eine leere Liste — dann rechnet `berechneStatistik` einen maximalen
    // Rückgang von 0 aus, und zwar IMMER. Eine Kennzahl, die nie etwas anderes
    // sagen kann, ist schlimmer als keine: sie sieht aus wie ein Ergebnis.
    // Die Abschnitte liegen hintereinander, sortiert wird trotzdem nach
    // Ausstiegszeit — innerhalb eines Abschnitts kommen die Trades nicht
    // zwingend in dieser Reihenfolge zurück.
    const startEquity = basis.startEquity || 1000
    const alleTrades = abschnitte.flatMap((a) => a.pruefTradesListe)
    const nachZeit = [...alleTrades].sort((a, b) => Number(a.exitTime) - Number(b.exitTime))
    let lauf = startEquity
    const kurve = nachZeit.map((t) => {
        lauf += Number(t.netPnl) || 0
        return { t: Number(t.exitTime), equity: lauf }
    })
    const gesamt = berechneStatistik(alleTrades, startEquity, lauf, kurve)

    // Wechselt die Auswahl in jedem Abschnitt, ist der Parameter nicht stabil —
    // dann optimiert man Rauschen, egal wie gut die Summe aussieht.
    //
    // „Stabil" verlangt seit 31.10.2026 auch, dass es überhaupt etwas zu
    // vergleichen gibt: mindestens zwei Abschnitte mit Auswahl, und zwar mehr
    // als die Hälfte. Vorher genügte eine einzige Auswahl unter drei
    // Abschnitten für ein grünes „Auswahl stabil" (FUN-L5-002) — eine Aussage
    // über Stabilität ohne einen einzigen Vergleich.
    const gewaehlte = abschnitte.filter((a) => !a.keineAuswahl).map((a) => a.gewaehlt)
    const verschieden = new Set(gewaehlte).size
    const genugAuswahl = gewaehlte.length >= 2 && gewaehlte.length * 2 > abschnitte.length
    const auswahlStabil = genugAuswahl && verschieden <= Math.max(1, Math.ceil(gewaehlte.length / 2))

    return {
        paramKey,
        fenster: n,
        minTrades,
        ohneAuswahl: abschnitte.filter((a) => a.keineAuswahl).length,
        abschnitte: abschnitte.map(({ pruefTradesListe, ...rest }) => rest),
        gesamt,
        gewaehlteWerte: gewaehlte,
        auswahlStabil,
        // 'stabil' | 'springt' | 'zu_wenige' (zu wenige Abschnitte mit Auswahl)
        auswahlUrteil: !genugAuswahl ? 'zu_wenige' : (auswahlStabil ? 'stabil' : 'springt'),
    }
}
