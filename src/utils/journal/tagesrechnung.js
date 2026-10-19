/**
 * Blotter (je Tag und Symbol) und P&L (je Tag).
 *
 * Bewusst OHNE Absicherung gegen fehlende Werte (Spezifikation §4.2, §6): ein
 * fehlendes Feld macht die Summe NaN, ein NaN aus dem Trade wird durch die
 * JSON-Rundreise zu null und zählt wie 0. Anders als `totals-kern.js`, das
 * jede Zahl durch `z()` schickt.
 */
import { filteredTradesTrades } from '../../stores/journal/auswertung.js'
import { blotter, pAndL, trades } from '../../stores/journal/import.js'
import { gruppiere, sortiertNach, jsonKopie, ersetzeObjekt } from './hilfen.js'

/** Felder, die Blotter und P&L schlicht aufsummieren (gleicher Name in Quelle und Ziel). */
const SUMMEN = [
    'buyQuantity', 'sellQuantity', 'commission', 'sec', 'taf', 'nscc', 'nasdaq',
    'grossProceeds', 'grossWins', 'grossLoss', 'grossSharePL', 'grossSharePLWins', 'grossSharePLLoss',
    'netProceeds', 'netWins', 'netLoss', 'netSharePL', 'netSharePLWins', 'netSharePLLoss',
    'grossWinsQuantity', 'grossLossQuantity', 'grossWinsCount', 'grossLossCount',
    'netWinsQuantity', 'netLossQuantity', 'netWinsCount', 'netLossCount',
]

function leererPosten() {
    const p = { otherCommission: 0, fees: 0, executions: 0, trades: 0,
        highGrossSharePLWin: 0, highGrossSharePLLoss: 0, highNetSharePLWin: 0, highNetSharePLLoss: 0 }
    for (const f of SUMMEN) p[f] = 0
    return p
}

// Hoch-/Tiefstwerte: nur Gewinne (≥ 0) heben das Hoch, nur Verluste senken das Tief.
function merkeSpitzen(p, brutto, netto) {
    if (brutto >= 0 && brutto > p.highGrossSharePLWin) p.highGrossSharePLWin = brutto
    if (brutto < 0 && brutto < p.highGrossSharePLLoss) p.highGrossSharePLLoss = brutto
    if (netto >= 0 && netto > p.highNetSharePLWin) p.highNetSharePLWin = netto
    if (netto < 0 && netto < p.highNetSharePLLoss) p.highNetSharePLLoss = netto
}

/** Blotter-Objekt eines Symbols aus seinen Trades (nach Einstieg geordnet). */
function blotterPosten(symbol, liste) {
    const p = leererPosten()
    for (const t of liste) {
        for (const f of SUMMEN) p[f] += t[f]
        p.otherCommission += t.sec + t.taf + t.nscc + t.nasdaq
        p.fees += t.commission + t.sec + t.taf + t.nscc + t.nasdaq
        p.executions += t.executionsCount
        p.trades += t.tradesCount
        merkeSpitzen(p, t.grossSharePL, t.netSharePL)
    }
    return { symbol, type: liste[0]?.type, ...p }
}

/**
 * Baut `blotter` neu: `td` → Symbol → Posten.
 * @param {boolean} ausGefiltert  true: aus `filteredTradesTrades`, sonst aus dem Import-Store `trades`
 */
export async function useCreateBlotter(ausGefiltert) {
    const jeTag = ausGefiltert
        ? jsonKopie(gruppiere(sortiertNach([...filteredTradesTrades], t => t.entryTime), t => t.td))
        : trades

    const neu = {}
    for (const td of Object.keys(jeTag)) {
        const jeSymbol = jsonKopie(gruppiere(sortiertNach([...jeTag[td]], t => t.entryTime), t => t.symbol))
        neu[td] = {}
        for (const symbol of Object.keys(jeSymbol)) neu[td][symbol] = blotterPosten(symbol, jeSymbol[symbol])
    }
    ersetzeObjekt(blotter, neu)
}

/** Baut `pAndL` neu: je `td` die Summe über die Symbole des Blotters. */
export async function useCreatePnL() {
    const neu = {}
    for (const td of Object.keys(blotter)) {
        const p = leererPosten()
        for (const b of Object.values(blotter[td])) {
            for (const f of [...SUMMEN, 'otherCommission', 'fees', 'executions', 'trades']) p[f] += b[f]
            if (b.highGrossSharePLWin > p.highGrossSharePLWin) p.highGrossSharePLWin = b.highGrossSharePLWin
            if (b.highGrossSharePLLoss < p.highGrossSharePLLoss) p.highGrossSharePLLoss = b.highGrossSharePLLoss
            if (b.highNetSharePLWin > p.highNetSharePLWin) p.highNetSharePLWin = b.highNetSharePLWin
            if (b.highNetSharePLLoss < p.highNetSharePLLoss) p.highNetSharePLLoss = b.highNetSharePLLoss
        }
        neu[td] = p
    }
    ersetzeObjekt(pAndL, neu)
}
