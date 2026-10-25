/**
 * Rechnungen der Dashboard-Karten (Spezifikation ansichten.md B.5, B.10, B.11).
 *
 * Rein: keine Stores, kein Vue — die Karten reichen ihre Eingaben herein. So
 * steht die Regel einmal da und nicht verteilt über Templates, wo ein
 * vergessenes `?? 0` erst beim Anschauen auffällt.
 */
import { istGewinn } from '../../../shared/gewinn.js'
import dayjs from '../../utils/journal/zeit.js'

const zahl = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
}

/**
 * Kontostand der gewählten Börse. Der Bonus geht nur in den angezeigten Stand
 * ein, damit er mit dem Wallet übereinstimmt; Performance bleibt bonusfrei,
 * sonst sähe ein geschenkter Bonus wie Handelserfolg aus.
 */
export function kontostand({ benutzer, broker, allTimeNetPnL, positionen, bonus }) {
    const b = broker || 'bitunix'
    const eintrag = benutzer?.balances?.[b]
    const start = eintrag ? zahl(eintrag.start) : zahl(benutzer?.startBalance)
    if (start === 0) return null
    let unrealisiert = 0
    for (const p of positionen || []) {
        if (p?.status !== 'open') continue
        if (p.broker && p.broker !== b) continue
        const u = Number(p.unrealizedPNL)
        if (Number.isFinite(u)) unrealisiert += u
    }
    const B = zahl(bonus)
    const aktuell = start + zahl(allTimeNetPnL) + unrealisiert + B
    const pnl = aktuell - start - B
    const performance = start > 0 ? ((aktuell - B) / start - 1) * 100 : 0
    return { start, unrealisiert, bonus: B, aktuell, pnl, performance }
}

/**
 * Trades von heute im aktuellen Filter, nach der SCHLUSSZEIT (`exitTime`) in
 * der Handelszeitzone. Bis 24.10.2026 zählte der Tagesstempel `td` (UTC-
 * Mitternacht): westlich von UTC fiel ein heutiger Trade heraus, östlich kam
 * kurz nach Mitternacht einer von gestern dazu (Audit FIN-05). Ohne
 * Schlusszeit bleibt `td` der Rückfall.
 */
export function heuteZaehler(trades, zone, jetzt = dayjs()) {
    const tz = zone || 'Europe/Brussels'
    const von = jetzt.tz(tz).startOf('day').unix()
    const bis = jetzt.tz(tz).endOf('day').unix()
    let anzahl = 0, gewinner = 0, verlierer = 0, pnl = 0
    for (const t of trades || []) {
        const zeit = Number(t?.exitTime) || Number(t?.td)
        if (!(zeit >= von && zeit <= bis)) continue
        const wert = zahl(t.netProceeds ?? t.grossProceeds ?? 0)
        anzahl += 1
        pnl += wert
        if (istGewinn(wert)) gewinner += 1
        else verlierer += 1
    }
    return { anzahl, gewinner, verlierer, pnl }
}

/** Gebührenkarte: alle fehlenden Werte zählen als 0. */
export function gebuehren(totals) {
    const G = zahl(totals?.fees)
    const n = zahl(totals?.trades)
    const grossWins = zahl(totals?.grossWins)
    const fundingPaid = zahl(totals?.fundingPaid)
    const fundingReceived = zahl(totals?.fundingReceived)
    return {
        gesamt: G,
        jeTrade: n ? G / n : 0,
        anteil: grossWins > 0 ? (G / grossWins) * 100 : 0,
        handel: zahl(totals?.tradingFees) || zahl(totals?.commission) || 0,
        fundingPaid,
        fundingReceived,
        otherFees: zahl(totals?.otherFees),
        // positiv = netto bezahlt (Kosten), negativ = netto erhalten
        fundingNetto: fundingPaid - fundingReceived,
        brutto: zahl(totals?.grossProceeds),
        netto: zahl(totals?.netProceeds),
    }
}

/**
 * Ratio der Kennzahlen-Karte (APPT oder Profitfaktor). Der Profitfaktor wird
 * mit den UNGERUNDETEN Summen geteilt — Runden vorher machte winzige Verluste
 * zu 0 und den Faktor zu ∞.
 */
export function ratio(art, totals, fall) {
    if (art === 'appt') {
        const erloes = zahl(totals?.[`${fall}Proceeds`])
        const n = zahl(totals?.trades)
        return { art, kurz: 'APPT', erloes, anzahl: n, wert: n ? erloes / n : 0 }
    }
    if (art === 'profitFactor') {
        const W = zahl(totals?.[`${fall}Wins`])
        const L = Math.abs(zahl(totals?.[`${fall}Loss`]))
        const wert = L > 0 ? W / L : (W > 0 ? Infinity : 0)
        return { art, gewinne: W, verluste: L, wert }
    }
    return null
}

/**
 * Verlust-Trades, die zwischenzeitlich im Gewinn waren (MFE). Nenner sind
 * ALLE Verlust-Trades ausser Bots, auch die ohne Exkursion — die Quote sagt also, wie oft
 * es nachweislich passiert ist, nicht wie oft unter den gemessenen.
 */
export function mfeAnalyse(trades, exkursionen, fall) {
    const leer = { zeilen: [], verlustTrades: 0, treffer: 0, quote: 0, verschenkt: 0, verlust: 0 }
    if (!trades?.length || !exkursionen?.length) return leer
    const nachTrade = new Map()
    for (const e of exkursionen) if (e?.tradeId) nachTrade.set(e.tradeId, e)
    const zeilen = []
    let verlustTrades = 0
    for (const t of trades) {
        const erloes = zahl(t[`${fall}Proceeds`])
        if (erloes >= 0) continue
        // Bots nicht: ihre Menge ist USDT-Volumen, Menge × Kursabstand ergab
        // „10'000 USDT verschenkt" bei einem Verlust von 20 (Audit FIN-02) —
        // dieselbe Ausnahme wie `mengeFuerR` in mfe-kern.js.
        if (t.botType || t.category === 'bot') continue
        verlustTrades += 1
        const ex = nachTrade.get(t.id)
        if (!ex || !ex.mfePrice) continue
        const long = t.strategy === 'long'
        const mfe = Number(ex.mfePrice)
        const einstieg = Number(t.entryPrice)
        if (long ? !(mfe > einstieg) : !(mfe < einstieg)) continue
        const menge = Math.max(zahl(t.buyQuantity), zahl(t.sellQuantity))
        zeilen.push({
            id: t.id,
            symbol: t.symbol || '',
            datum: t.td || t.entryTime,
            long,
            verschenkt: (long ? mfe - einstieg : einstieg - mfe) * menge,
            verlust: Math.abs(erloes),
            mfe,
            einstieg,
            ausstieg: t.exitPrice,
        })
    }
    zeilen.sort((a, b) => b.verschenkt - a.verschenkt)
    return {
        zeilen,
        verlustTrades,
        treffer: zeilen.length,
        quote: verlustTrades ? (zeilen.length / verlustTrades) * 100 : 0,
        verschenkt: zeilen.reduce((s, z) => s + z.verschenkt, 0),
        verlust: zeilen.reduce((s, z) => s + z.verlust, 0),
    }
}

/**
 * Kennzahlen einer Gruppe von Trades. Rechnet IMMER mit `netProceeds` — so
 * hat es die Statistik schon immer getan (Rechenregel, Spezifikation B.11);
 * die Karte trägt deshalb fest das Netto-Kennzeichen. Break-even zählt als
 * Gewinner (`istGewinn`), sonst fiele er aus beiden Zählern und drückte die
 * Quote.
 */
function gruppenWerte(liste) {
    let gewinner = 0, verlierer = 0, gewinne = 0, verluste = 0, summe = 0
    for (const t of liste) {
        const w = zahl(t?.netProceeds)
        summe += w
        if (istGewinn(w)) { gewinner += 1; gewinne += w }
        else { verlierer += 1; verluste += Math.abs(w) }
    }
    const n = liste.length
    return {
        anzahl: n,
        gewinner,
        verlierer,
        quote: n ? (gewinner / n) * 100 : 0,
        schnitt: n ? summe / n : 0,
        summe,
        faktor: verluste > 0 ? gewinne / verluste : (gewinne > 0 ? Infinity : 0),
    }
}

const TYP_NAME = { scalp: 'Scalptrade', day: 'Daytrade', swing: 'Swingtrade' }
const TYP_TON = { scalp: 'warn', day: 'blau', swing: 'violett' }

export function typStatistik(gruppen) {
    const aus = []
    for (const [schluessel, liste] of Object.entries(gruppen || {})) {
        if (!Array.isArray(liste) || !liste.length) continue
        aus.push({ schluessel, name: TYP_NAME[schluessel] || schluessel, ton: TYP_TON[schluessel] || 'grau', ...gruppenWerte(liste) })
    }
    return aus.sort((a, b) => b.summe - a.summe)
}

/** Konvention: die ERSTE Tag-Gruppe des Katalogs ist „Strategie". */
export function strategieStatistik(katalog, tagGruppen) {
    const gruppe = katalog?.[0]
    if (!gruppe || !tagGruppen) return []
    const tagsDerGruppe = new Map((gruppe.tags || []).map(t => [t.id, t]))
    const aus = []
    for (const [id, liste] of Object.entries(tagGruppen)) {
        if (!tagsDerGruppe.has(id) || !Array.isArray(liste) || !liste.length) continue
        let name = id
        for (const e of liste) if (e?.tagName) name = e.tagName
        aus.push({ schluessel: id, name, farbe: tagsDerGruppe.get(id).color || gruppe.color, ...gruppenWerte(liste) })
    }
    return aus.sort((a, b) => b.summe - a.summe)
}
