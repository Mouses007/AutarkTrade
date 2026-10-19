/**
 * Gewinnanalyse: Durchschnitte je Trade, R-Verhältnis und die MFE-basierte
 * Take-Profit-Stufe, die den Erwartungswert über den heutigen hebt.
 */
import { journalTage, totals, gewinnAnalyse } from '../../stores/journal/auswertung.js'
import { excursions } from '../../stores/journal/tagebuch.js'
import { mfeR } from '../mfe-kern.js'
import { ersetzeObjekt } from './hilfen.js'

const geteilt = (a, b) => (b === 0 ? 0 : a / b)

/** Erwartungswert in R: Trefferquote w, Gewinn R, Verlust 1. */
const erwartung = (w, r) => w * r - (1 - w) * 1

/** Zielstufen 1; 1,5; … ; 20. */
const STUFEN = Array.from({ length: 39 }, (_, i) => 1 + i * 0.5)
const MIN_MESSUNGEN = 10

/** Erste Stufe mit dem strikt grössten Erwartungswert. */
function besteStufe(werte) {
    let beste = { stufe: null, e: -Infinity }
    for (const stufe of STUFEN) {
        const w = werte.length ? werte.filter(r => r >= stufe).length / werte.length : 0
        const e = erwartung(w, stufe)
        if (e > beste.e) beste = { stufe, e }
    }
    return beste
}

/** MFE-R je Exkursion, getrennt nach Brutto- und Netto-Durchschnittsverlust. */
function mfeListen(avLossBrutto, avLossNetto) {
    const brutto = [], netto = []
    if (journalTage.length === 0) return { brutto, netto }
    for (const exk of excursions) {
        // Bewusster Altfehler §7.2: nur die ERSTE Tageskopie dieses dateUnix wird durchsucht.
        const tag = journalTage.find(d => d.dateUnix == exk.dateUnix)
        const trade = tag?.trades.find(t => t.id == exk.tradeId)
        if (!trade) continue
        const rb = mfeR(trade, exk.mfePrice, avLossBrutto)
        const rn = mfeR(trade, exk.mfePrice, avLossNetto)
        if (rb !== null) brutto.push(rb)
        if (rn !== null) netto.push(rn)
    }
    return { brutto, netto }
}

export async function berechneGewinnAnalyse(_param) {
    ersetzeObjekt(gewinnAnalyse)
    if (Object.keys(totals).length === 0) return

    const grossAvWinPerShare = geteilt(totals.grossSharePLWins, totals.grossWinsCount)
    const netAvWinPerShare = geteilt(totals.netSharePLWins, totals.netWinsCount)
    const grossAvLossPerShare = totals.grossLossCount === 0 ? 0 : -totals.grossSharePLLoss / totals.grossLossCount
    const netAvLossPerShare = totals.netLossCount === 0 ? 0 : -totals.netSharePLLoss / totals.netLossCount
    const grossR = geteilt(grossAvWinPerShare, grossAvLossPerShare)
    const netR = geteilt(netAvWinPerShare, netAvLossPerShare)

    const { brutto, netto } = mfeListen(grossAvLossPerShare, netAvLossPerShare)
    const zielStufe = (werte, heute) => {
        const beste = besteStufe(werte)
        return werte.length >= MIN_MESSUNGEN && beste.e > heute ? beste.stufe : null
    }

    Object.assign(gewinnAnalyse, {
        grossAvWinPerShare,
        netAvWinPerShare,
        grossAvLossPerShare,
        netAvLossPerShare,
        grossHighWinPerShare: totals.highGrossSharePLWin,
        netHighWinPerShare: totals.highNetSharePLWin,
        grossHighLossPerShare: -totals.highGrossSharePLLoss,
        netHighLossPerShare: -totals.highNetSharePLLoss,
        grossR,
        netR,
        grossMfeR: zielStufe(brutto, erwartung(totals.probGrossWins, grossR)),
        netMfeR: zielStufe(netto, erwartung(totals.probNetWins, netR)),
    })
}
