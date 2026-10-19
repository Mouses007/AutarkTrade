/**
 * Summen über die gefilterten Trades: `totals` (alles) und `summenJeTag`
 * (je Handelstag). Die eigentliche Summierung steht in `totals-kern.js`.
 */
import { journalTage, totals, summenJeTag } from '../../stores/journal/auswertung.js'
import { neueSummen, summiereTrade, leiteKennzahlenAb } from '../totals-kern.js'
import { gruppiere, sortiertNach, ersetzeObjekt } from './hilfen.js'
import { kette } from './kette.js'

/** Gebühren aus dem Kassenbuch der Tage (Aktien-Erbe; im Krypto-Betrieb 0). */
function kassenbuchGebuehren(tage) {
    let locate = 0, software = 0, banking = 0
    for (const tag of tage) {
        const kb = tag.cashJournal
        if (!kb || Object.keys(kb).length === 0) continue
        locate += kb.locate ?? 0
        software += kb.software ?? 0
        banking += kb.banking?.fee ?? 0
    }
    return { locateFees: locate, softwareFees: software, bankingFees: banking }
}

export async function summiereTrades() {
    // L: Tage in der Reihenfolge von journalTage, darin die Trades der Zeile
    const liste = journalTage.flatMap(tag => tag.trades)
    kette.tradeListe = liste

    const summe = neueSummen()
    for (const trade of liste) summiereTrade(summe, trade)
    const kasse = kassenbuchGebuehren(journalTage)
    const otherFees = kasse.locateFees + kasse.softwareFees + kasse.bankingFees

    ersetzeObjekt(totals, {
        ...summe,
        ...leiteKennzahlenAb(summe),
        quantity: summe.buyQuantity + summe.sellQuantity,
        ...kasse,
        otherFees,
        netFeesProceeds: summe.netProceeds - otherFees,
        netProceedsEstimations: 0,
        netWinsEstimations: 0,
        netLossEstimations: 0,
    })

    const jeTag = gruppiere(sortiertNach(liste, t => t.td), t => t.td)
    const tagesSummen = {}
    for (const [td, tradesDesTages] of Object.entries(jeTag)) {
        const s = neueSummen()
        for (const trade of tradesDesTages) summiereTrade(s, trade)
        // Bewusster Altfehler §7.12: der Wert des ERSTEN Trades, nicht die
        // Summe — im Krypto-Betrieb undefined, der Schlüssel fällt in JSON weg.
        s.financials = tradesDesTages[0].financials
        tagesSummen[td] = s
    }
    ersetzeObjekt(summenJeTag, tagesSummen)
    kette.tagesSummen = tagesSummen
}
