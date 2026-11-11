/**
 * Simulation auf der Bot-Seite — rein, ohne Netz.
 *
 * Rechnet die heutige Einstellung eines Bots und bis zu drei Varianten über
 * dieselben Kerzen (Start bis Ende bzw. jetzt) mit `shared/grid-simulation.js`,
 * stellt die Simulation der heutigen Einstellung neben die echten Zahlen von
 * Pionex (Eichung) und rechnet, was ein Umstellen zum heutigen Kurs an
 * Position und geschätzter Liquidation ändern würde.
 *
 * Eine Variante kann ändern: Band, Anzahl Grids, Art, Hebel, Einsatz,
 * Stop-Loss, Take-Profit (Preis). Leer = heutiger Wert. Mehr Einsatz oder
 * Hebel vergrössern die Menge je Grid im selben Verhältnis.
 *
 * Bewusst kein Urteil: die Seite zeigt Zahlen eines Rückblicks. Eine Variante,
 * die im Nachhinein besser abgeschnitten hätte, ist mit dem Wissen um den
 * Kursverlauf gewählt — das steht in der Oberfläche.
 */
import { simuliereBot } from '../../shared/grid-simulation.js'
import { GEBUEHREN } from './pionex-wissen.js'
import { gewinn } from './kennzahlen.js'

export const MAX_VARIANTEN = 3
/** Typen, die die Simulation rechnen kann (Grids mit festem Band). */
export const SIMULIERBAR = new Set(['futures_grid', 'coinm_grid', 'spot_grid', 'leveraged_grid'])
/** Abweichung des simulierten Ergebnisses, ab der die Eichung als unsicher gilt (Anteil am Einsatz). */
export const EICHUNG_GRENZE = 0.1
/** Durchstich, mit dem die Simulation an 53 echten Bots die Zyklen traf (siehe grid-simulation.js). */
export const DURCHSTICH = 0.0002
export const MMR_VORGABE = 0.005
export const MAX_HEBEL = 125

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const leer = (v) => v === undefined || v === null || v === ''

/** Eine Variante aus der Eingabe prüfen; `{fehler}` oder die bereinigte Variante (nur gesetzte Felder). */
export function pruefeVariante(v, bot) {
    const kurs = bot?.kurs ?? bot?.position?.schlussPreis ?? null
    const zahl = (x) => (leer(x) ? null : Number(x))
    const aus = {}
    const unten = zahl(v?.unten), oben = zahl(v?.oben)
    if (unten != null || oben != null) {
        const u = unten ?? bot?.grid?.unten, o = oben ?? bot?.grid?.oben
        if (!istZahl(u) || !istZahl(o) || u <= 0 || o <= u) return { fehler: 'band' }
        // Gegen Tippfehler (ein Komma zu viel): das Band muss in der Nähe des Kurses liegen.
        if (istZahl(kurs) && kurs > 0 && (o < kurs / 5 || u > kurs * 5)) return { fehler: 'weitWeg' }
        aus.unten = u; aus.oben = o
    }
    const anzahl = zahl(v?.anzahl)
    if (anzahl != null) {
        if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > 1000) return { fehler: 'anzahl' }
        aus.anzahl = anzahl
    }
    if (!leer(v?.art)) aus.art = v.art === 'geometric' ? 'geometric' : 'arithmetic'
    const hebel = zahl(v?.hebel)
    if (hebel != null) {
        if (!istZahl(hebel) || hebel < 1 || hebel > MAX_HEBEL) return { fehler: 'hebel' }
        aus.hebel = hebel
    }
    const einsatz = zahl(v?.einsatz)
    if (einsatz != null) {
        if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'einsatz' }
        aus.einsatz = einsatz
    }
    const sl = zahl(v?.stopLoss), tp = zahl(v?.takeProfit)
    if (sl != null || tp != null) {
        if (bot?.richtung === 'NEUTRAL') return { fehler: 'neutralStop' }
        const long = bot?.richtung !== 'SHORT'
        if (sl != null && (!istZahl(sl) || sl <= 0 || (istZahl(kurs) && (long ? sl >= kurs : sl <= kurs)))) return { fehler: 'stopLoss' }
        if (tp != null && (!istZahl(tp) || tp <= 0 || (istZahl(kurs) && (long ? tp <= kurs : tp >= kurs)))) return { fehler: 'takeProfit' }
        if (sl != null) aus.stopLoss = sl
        if (tp != null) aus.takeProfit = tp
    }
    if (!Object.keys(aus).length) return { fehler: 'leer' }
    return aus
}

/** Gebühren für die Simulation: Grid-Orders als Maker (die Quote des Bots, höchstens Maker), Markt als Taker. */
export function gebuehrenFuer(bot) {
    if (bot.typ === 'leveraged_grid') return { gebuehr: 0, gebuehrMarkt: 0 }
    const liste = bot.typ === 'spot_grid' ? GEBUEHREN.spot : GEBUEHREN.futures
    const vol = bot.ergebnis?.volumen, fee = Math.abs(bot.ergebnis?.gebuehren || 0)
    const quote = istZahl(vol) && vol > 0 && fee > 0 ? fee / vol : liste.maker
    return { gebuehr: Math.min(quote, liste.maker), gebuehrMarkt: liste.taker }
}

/** Heutige Stops, soweit sie Preise sind (andere Arten bildet die Simulation nicht ab). */
function heutigeStops(bot) {
    const preisStop = (s) => (s && /price/.test(s.art || '') && istZahl(s.wert) ? s.wert : null)
    return { stopLoss: preisStop(bot.stops?.stopLoss), takeProfit: preisStop(bot.stops?.takeProfit) }
}

function kurz(r) {
    if (!r) return null
    return {
        einstellung: r.einstellung,
        gesamt: r.gesamt, gridGewinn: r.gridGewinn, realisiert: r.realisiert, schwebend: r.schwebend,
        gebuehren: r.gebuehren, funding: r.funding, zyklen: r.zyklen, position: r.position, maxVerlust: r.maxVerlust,
        zeitImBand: r.zeitImBand, liquidation: r.liquidation, ausstieg: r.ausstieg, liqSchaetzung: r.liqSchaetzung, menge: r.menge,
        // Kurve ausgedünnt auf höchstens ~400 Punkte
        kurve: r.kurve.filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 400)) === 0 || i === a.length - 1),
    }
}

/** Die für die Risikoseite massgebliche Liquidationsschätzung (USD). */
function liqRisiko(bot, liq) {
    if (!liq) return null
    if (bot.richtung === 'SHORT') return liq.oben
    if (bot.richtung === 'LONG') return liq.unten
    return liq.unten ?? liq.oben
}

/**
 * @param bot    aus normalisiereBot (+ kurs)
 * @param kerzen [{t,o,h,l,c}] in USDT je Coin, ab Bot-Start
 * @param varianten bereinigte Varianten (pruefeVariante)
 * @param opt    { kurs, funding: [{t, rate}], mmr }
 */
export function vergleiche(bot, kerzen, varianten = [], { kurs = bot.kurs, funding = null, mmr = MMR_VORGABE } = {}) {
    if (!SIMULIERBAR.has(bot.typ)) return { fehler: 'typ' }
    if (!kerzen?.length) return { fehler: 'kerzen' }
    const heute = heutigeStops(bot)
    const opt = { ...gebuehrenFuer(bot), mmr, funding, durchstich: DURCHSTICH, startPreis: bot.position?.startPreis ?? undefined }
    const basis = simuliereBot(bot, kerzen, { ...opt, aenderung: { ...heute } })
    if (!basis) return { fehler: 'simulation' }

    const g = gewinn(bot, kurs)
    // Ohne Funding-Verlauf wird ohne Funding verglichen (sonst Äpfel mit Birnen)
    const echt = istZahl(g.gesamt) ? (funding ? g.gesamt : g.gesamt - (bot.ergebnis?.funding || 0)) : null
    const abweichung = istZahl(echt) ? basis.gesamt - echt : null
    const einsatz = g.basis
    const eichung = {
        echt,
        simuliert: basis.gesamt,
        abweichung,
        abweichungAnteil: istZahl(abweichung) && einsatz > 0 ? abweichung / einsatz : null,
        zyklenEcht: bot.ergebnis?.zyklen ?? null,
        zyklenSim: basis.zyklen,
        gridEcht: bot.ergebnis?.gridGewinn ?? null,
        gridSim: basis.gridGewinn,
        fundingEcht: bot.ergebnis?.funding ?? null,
        fundingSim: funding ? basis.funding : null,
        positionEcht: bot.laufend ? bot.position?.menge ?? null : null,
        positionSim: bot.laufend ? basis.position : null,
        liqEcht: bot.laufend ? liqRisiko(bot, bot.liquidation) : null,
        liqSim: bot.laufend ? liqRisiko(bot, basis.liqSchaetzung) : null,
    }
    eichung.unsicher = !istZahl(eichung.abweichungAnteil) || Math.abs(eichung.abweichungAnteil) > EICHUNG_GRENZE

    const mitHeute = (v) => ({ ...heute, ...v })
    const ergebnisse = varianten.slice(0, MAX_VARIANTEN).map((v) => kurz(simuliereBot(bot, kerzen, { ...opt, aenderung: mitHeute(v) })))

    // Umstellen zum heutigen Kurs: Eigenkapital bleibt, die Position wird zum Kurs
    // auf das neue Band eingestellt. Welche Position hielte es, wo läge die Liquidation?
    let abJetzt = null
    if (bot.laufend && istZahl(kurs) && kurs > 0) {
        const jetzt = [{ t: 0, o: kurs, h: kurs, l: kurs, c: kurs }]
        const posJetzt = bot.position?.menge ?? null
        const extra = bot.einsatz?.extraMarge || 0
        const eigenkapital = istZahl(einsatz) && istZahl(g.gesamt) ? einsatz + extra + g.gesamt : null
        const liqHeute = liqRisiko(bot, bot.liquidation)
        abJetzt = varianten.slice(0, MAX_VARIANTEN).map((v) => {
            const zusatz = istZahl(v.einsatz) && istZahl(einsatz) ? v.einsatz - einsatz : 0
            const r = simuliereBot(bot, jetzt, { ...opt, funding: null, startPreis: kurs, aenderung: mitHeute(v), marge: istZahl(eigenkapital) ? eigenkapital + zusatz : null })
            const ziel = r ? r.position : null
            let geschlossenAnteil = null, realisiertCa = null
            if (istZahl(ziel) && istZahl(posJetzt) && posJetzt !== 0) {
                const gleicheSeite = Math.sign(ziel) === Math.sign(posJetzt) || ziel === 0
                geschlossenAnteil = gleicheSeite ? Math.max(0, 1 - Math.abs(ziel) / Math.abs(posJetzt)) : 1
                realisiertCa = istZahl(g.schwebend) ? g.schwebend * geschlossenAnteil : null
            }
            return { ziel, aktuell: posJetzt, geschlossenAnteil, realisiertCa, liqNeu: r ? liqRisiko(bot, r.liqSchaetzung) : null, liqHeute, zusatz }
        })
    }

    return {
        von: kerzen[0].t,
        bis: kerzen[kerzen.length - 1].t,
        kerzenAnzahl: kerzen.length,
        einheit: bot.marginCoin,
        mmr,
        heute,
        basis: kurz(basis),
        eichung,
        varianten: ergebnisse,
        abJetzt,
        hinweise: { fundingSimuliert: !!funding },
    }
}
