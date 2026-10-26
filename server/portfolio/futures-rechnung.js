/**
 * Spot-Portfolio: Futures im Steuerjahr — reiner Teil (kein Netz, keine DB).
 *
 * Quelle sind die Journal-Trades (eine Zeile je Tag, `trades` als JSON-Liste).
 * Ein Trade zählt in das Jahr, in dem er GESCHLOSSEN wurde (`exitTime`), denn
 * erst dann ist das Ergebnis realisiert.
 *
 * Volumen (Kriterium „Transaktionsvolumen" im KS 36): bei normalen Futures
 * Eröffnung + Schliessung zum Nominalwert (Preis × Menge). Bei Pionex-Bots ist
 * `buyQuantity` schon das Volumen in USDT — Preis × Menge ergäbe dort
 * Milliarden (gemessen: 5,1 Mrd. für 100 Bot-Trades 2025).
 *
 * Guthaben am Stichtag: die Börsen liefern keinen historischen Kontostand.
 * Rückgerechnet wird heute − Σ Ergebnis nach dem Stichtag. Ein- und
 * Auszahlungen nach dem Stichtag kennt das Journal nicht — darum ist der Wert
 * `abgeleitet` und wird von einem eingetragenen Auszugswert ersetzt.
 */

export const BOERSEN = ['bitunix', 'bitget', 'pionex']

/** Journal-Zeilen → flache Liste der geschlossenen Futures-Trades. */
export function flacheTrades(zeilen) {
    const aus = []
    for (const z of zeilen || []) {
        let t = z.trades
        if (typeof t === 'string') { try { t = JSON.parse(t) } catch { t = [] } }
        for (const x of Array.isArray(t) ? t : []) {
            if (!x || x.openPosition || x.type === 'spot' || x.category === 'spot') continue
            const exit = Number(x.exitTime)
            if (!exit) continue
            aus.push(x)
        }
    }
    return aus
}

/** Börse eines Journal-Trades (wie in futuresJahr). */
export function boerseVon(x) { return String(x.broker || x.account || 'andere').toLowerCase() }

/**
 * Börsen, deren Journal erst über einen Monat nach dem Stichtag beginnt (oder
 * die gar keine Trades haben): dort trägt die Rückrechnung nicht.
 */
export function vorJournalJe(trades, boersen, bis) {
    const erst = new Map()
    for (const x of trades) {
        const b = boerseVon(x), ms = Number(x.exitTime) * 1000
        if (!(erst.get(b) <= ms)) erst.set(b, ms)
    }
    return new Set(boersen.filter((b) => !(erst.get(b) <= bis + 31 * 86400e3)))
}

export function tradeVolumen(x) {
    if (x.category === 'bot') return Math.abs(Number(x.buyQuantity) || 0)
    return Math.abs((Number(x.entryPrice) || 0) * (Number(x.buyQuantity) || 0))
        + Math.abs((Number(x.exitPrice) || 0) * (Number(x.sellQuantity) || 0))
}

function tag(sek) { return new Date(sek * 1000).toISOString().slice(0, 10) }

/**
 * Summen je Börse für [von, bis] (ms). `tage` sammelt Ergebnis und Volumen je
 * Kalendertag, damit der Aufrufer mit dem Devisenkurs DES TAGES umrechnet.
 */
export function futuresJahr(trades, { von, bis }) {
    const je = new Map()
    for (const x of trades) {
        const ms = Number(x.exitTime) * 1000
        if (ms < von || ms > bis) continue
        const b = boerseVon(x)
        const e = je.get(b) || { boerse: b, n: 0, bots: 0, nettoUsd: 0, bruttoUsd: 0, gebuehrUsd: 0, fundingUsd: 0, volumenUsd: 0, gewinne: 0, verluste: 0, tage: new Map() }
        const netto = Number(x.netProceeds) || 0
        const vol = tradeVolumen(x)
        e.n++
        if (x.category === 'bot') e.bots++
        e.nettoUsd += netto
        e.bruttoUsd += Number(x.grossProceeds) || 0
        e.gebuehrUsd += Number(x.commission) || 0
        e.fundingUsd += Number(x.fundingFee) || 0
        e.volumenUsd += vol
        if (netto >= 0) e.gewinne += netto; else e.verluste += netto
        const d = tag(Number(x.exitTime))
        const t = e.tage.get(d) || { netto: 0, volumen: 0 }
        t.netto += netto; t.volumen += vol
        e.tage.set(d, t)
        je.set(b, e)
    }
    return [...je.values()].sort((a, b) => BOERSEN.indexOf(a.boerse) - BOERSEN.indexOf(b.boerse))
}

/** Σ Nettoergebnis je Börse NACH dem Stichtag (ms). */
export function nettoNach(trades, bis) {
    const m = new Map()
    for (const x of trades) {
        if (Number(x.exitTime) * 1000 <= bis) continue
        const b = String(x.broker || x.account || 'andere').toLowerCase()
        m.set(b, (m.get(b) || 0) + (Number(x.netProceeds) || 0))
    }
    return m
}

/**
 * Guthaben am Stichtag je Börse.
 * @param {Map<string,{usd:number|null}>} heute   Kontostand heute (Live-API)
 * @param {Map<string,number>} nach               Σ Ergebnis nach dem Stichtag
 * @param {Record<string,{usd:number, quelle?:string}>} manuell  eingetragene Auszugswerte
 * @param {{vorJournal?: boolean}} o  Stichtag liegt vor dem ersten Journal-Trade
 * @returns {{boerse, usd, sicherheit: 'beleg'|'abgeleitet'|'unbekannt', grund?}[]}
 */
export function stichtagSaldo(heute, nach, manuell = {}, { vorJournal = false } = {}) {
    // `vorJournal`: true für alle Börsen, oder ein Set der Börsen, deren erster
    // Journal-Trade nach dem Stichtag liegt (je Börse — Bitunix kam erst 2025 dazu).
    const vor = (b) => (vorJournal instanceof Set ? vorJournal.has(b) : !!vorJournal)
    const namen = new Set([...heute.keys(), ...nach.keys(), ...Object.keys(manuell)])
    const aus = []
    for (const b of [...namen].sort((x, y) => BOERSEN.indexOf(x) - BOERSEN.indexOf(y))) {
        const m = manuell[b]
        if (m && Number.isFinite(Number(m.usd))) { aus.push({ boerse: b, usd: Number(m.usd), sicherheit: 'beleg', quelle: m.quelle || 'Auszug' }); continue }
        // Vor dem ersten Journal-Trade deckt die Rückrechnung den Zeitraum nicht ab —
        // „heute − 0" wäre der heutige Kontostand, nicht der von damals.
        if (vor(b)) { aus.push({ boerse: b, usd: null, sicherheit: 'unbekannt', grund: 'vorJournal' }); continue }
        const h = heute.get(b)
        if (h?.usd == null) { aus.push({ boerse: b, usd: null, sicherheit: 'unbekannt', grund: 'heute' }); continue }
        const wert = h.usd - (nach.get(b) || 0)
        // Negativ heisst: nach dem Stichtag wurde eingezahlt — die Rückrechnung trägt nicht.
        if (wert < -0.005) { aus.push({ boerse: b, usd: null, sicherheit: 'unbekannt', grund: 'negativ', rechnung: wert }); continue }
        aus.push({ boerse: b, usd: Math.max(0, wert), sicherheit: 'abgeleitet', heuteUsd: h.usd, nachUsd: nach.get(b) || 0 })
    }
    return aus
}
