/**
 * Bot-Vorlagen (18.11.2026): ein vorbereiteter Grid-Bot ohne feste Preise — rein, ohne Netz.
 *
 * Eine Vorlage hält, was vom Kurs unabhängig ist: Art, Richtung, Hebel, Einsatz, Grids und
 * die Abstände der Bandgrenzen und Stops als ANTEIL vom Bezugspreis. `vorlageAnwenden` setzt
 * sie an einen Preis — im Planer an den heutigen Kurs, im Chart an den Preis unter dem
 * Rechtsklick. Dort wird er zum Trigger-Preis: Pionex startet den Bot selbst, sobald der Kurs
 * ihn erreicht (`condition` beim Erstellen); die App startet nichts von sich aus.
 *
 * Gleiche Rechnung in Browser (Planer, Chart) und Server (Speichern).
 */
export const VORLAGE_ARTEN = ['linear', 'coinM', 'spot']
export const VORLAGE_RICHTUNGEN = ['LONG', 'SHORT', 'NEUTRAL']
export const MAX_VORLAGEN = 50
export const MAX_NAME = 60

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const zahl = (v) => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
    const s = String(v).trim()
    return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN
}
const runde = (v, stellen = 6) => (istZahl(v) ? Number(v.toPrecision(stellen)) : v)

/**
 * Vorlage prüfen und in ihre gespeicherte Form bringen.
 * @returns {{fehler}} oder {name, coin, art, richtung, hebel, einsatz, unter, ueber, anzahl, gridArt, stopLoss, takeProfit}
 *   `unter`/`ueber`: Abstand der Unter-/Obergrenze zum Bezugspreis als Anteil (0,2 = 20 %).
 *   `stopLoss`/`takeProfit`: Abstand zum Bezugspreis als Anteil oder null; die Seite ergibt sich aus der Richtung.
 */
export function pruefeVorlage(roh) {
    const name = String(roh?.name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    if (!name) return { fehler: 'name' }
    const art = VORLAGE_ARTEN.includes(roh?.art) ? roh.art : null
    if (!art) return { fehler: 'art' }
    const coin = String(roh?.coin ?? '').trim().toUpperCase()
    if (coin && !/^[A-Z0-9]{1,15}$/.test(coin)) return { fehler: 'coin' }
    // Coin-M: der Einsatz ist eine Menge der Coin und gilt darum nur für sie
    if (art === 'coinM' && !coin) return { fehler: 'coin' }
    const spot = art === 'spot'
    const richtung = spot ? 'LONG' : String(roh?.richtung ?? '').toUpperCase()
    if (!VORLAGE_RICHTUNGEN.includes(richtung)) return { fehler: 'richtung' }
    const hebel = spot ? 1 : zahl(roh?.hebel)
    if (!Number.isInteger(hebel) || hebel < 1 || hebel > 125) return { fehler: 'hebel' }
    const einsatz = zahl(roh?.einsatz)
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'einsatz' }
    const unter = zahl(roh?.unter), ueber = zahl(roh?.ueber)
    if (!istZahl(unter) || unter <= 0 || unter >= 0.95) return { fehler: 'band' }
    if (!istZahl(ueber) || ueber <= 0 || ueber > 10) return { fehler: 'band' }
    const anzahl = zahl(roh?.anzahl)
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > (spot ? 200 : 500)) return { fehler: 'anzahl' }
    const gridArt = roh?.gridArt === 'geometric' ? 'geometric' : 'arithmetic'
    const sl = zahl(roh?.stopLoss), tp = zahl(roh?.takeProfit)
    if (Number.isNaN(sl) || Number.isNaN(tp)) return { fehler: Number.isNaN(sl) ? 'stopLoss' : 'takeProfit' }
    if ((sl != null || tp != null) && (spot || richtung === 'NEUTRAL')) return { fehler: 'stops' }
    // Der Stop liegt jenseits der Bandkante der Verlustseite, das Ziel jenseits der Gewinnseite — oder im Band;
    // verlangt ist nur: grösser als 0 und, wo es nach unten geht, kleiner als 100 %
    const long = richtung === 'LONG'
    if (sl != null && (sl <= 0 || (long && sl >= 0.99) || sl > 10)) return { fehler: 'stopLoss' }
    if (tp != null && (tp <= 0 || (!long && tp >= 0.99) || tp > 10)) return { fehler: 'takeProfit' }
    return {
        name, coin, art, richtung, hebel, einsatz, unter: runde(unter), ueber: runde(ueber), anzahl, gridArt,
        stopLoss: sl == null ? null : runde(sl), takeProfit: tp == null ? null : runde(tp),
    }
}

/**
 * Vorlage aus einem Plan mit festen Preisen und dem Kurs, zu dem er gerechnet wurde.
 * @param p {name, coin, art, richtung, hebel, einsatz, unten, oben, anzahl, gridArt, stopLoss, takeProfit}
 */
export function vorlageAusPlan(p, kurs) {
    const k = zahl(kurs)
    if (!istZahl(k) || k <= 0) return { fehler: 'kurs' }
    const unten = zahl(p?.unten), oben = zahl(p?.oben)
    if (!istZahl(unten) || !istZahl(oben) || !(unten < k && k < oben)) return { fehler: 'band' }
    const sl = zahl(p?.stopLoss), tp = zahl(p?.takeProfit)
    if (Number.isNaN(sl) || Number.isNaN(tp)) return { fehler: Number.isNaN(sl) ? 'stopLoss' : 'takeProfit' }
    return pruefeVorlage({
        ...p, unter: 1 - unten / k, ueber: oben / k - 1,
        stopLoss: sl == null ? null : Math.abs(sl / k - 1), takeProfit: tp == null ? null : Math.abs(tp / k - 1),
    })
}

/**
 * Vorlage an einen Preis setzen: feste Bandgrenzen und Stops.
 * @returns {unten, oben, anzahl, art, stopLoss, takeProfit} (Stops null, wenn die Vorlage keine hat) oder null
 */
export function vorlageAnwenden(v, preis) {
    const p = zahl(preis)
    if (!v || !istZahl(p) || p <= 0) return null
    const long = v.richtung !== 'SHORT'
    const sl = v.stopLoss == null ? null : runde(long ? p * (1 - v.stopLoss) : p * (1 + v.stopLoss))
    const tp = v.takeProfit == null ? null : runde(long ? p * (1 + v.takeProfit) : p * (1 - v.takeProfit))
    return { unten: runde(p * (1 - v.unter)), oben: runde(p * (1 + v.ueber)), anzahl: v.anzahl, art: v.gridArt, stopLoss: sl, takeProfit: tp }
}

/** Passt die Vorlage zur Coin des Charts? Ohne Coin (USDT-M, Spot) passt sie zu jeder. */
export function vorlagePasst(v, coin) {
    const c = String(coin || '').toUpperCase()
    return !!v && (!v.coin || v.coin === c)
}

/** Coin aus einem Chart-Symbol («BTCUSDT» → «BTC»), oder '' wenn es kein USDT/USDC-Paar ist. */
export function coinAusSymbol(symbol) {
    const m = String(symbol || '').toUpperCase().match(/^([A-Z0-9]{1,15}?)(USDT|USDC)$/)
    return m ? m[1] : ''
}
