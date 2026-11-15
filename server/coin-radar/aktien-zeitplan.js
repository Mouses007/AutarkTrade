/**
 * Zeitplan des Aktien-Radars (rein — kein Netz, keine Datenbank).
 *
 * Der Coin-Radar läuft alle paar Stunden; für Aktien ist das der falsche
 * Rhythmus. Der Kurs einer Aktie entsteht an der US-Börse, und das Volumen
 * des Tages ist U-förmig: viel in der ersten und in der letzten halben
 * Stunde, wenig dazwischen, fast nichts in der Nacht und am Wochenende. Ein
 * Lauf um drei Uhr nachts New Yorker Zeit misst ein dünnes Band und sagt
 * nichts über den Titel.
 *
 * Deshalb zwei feste Plätze an jedem US-Handelstag (`shared/aktien-sitzung.js`):
 *
 *   eroeffnung   N Minuten nach 09:30 — die Eröffnungsspanne steht, das
 *                relative Volumen hat einen ersten belastbaren Wert
 *   schluss      N Minuten vor 16:00 — der Tag ist fast gelaufen, wer über
 *                Nacht halten will, sieht den Stand vor dem Schluss
 *
 * Ein Platz gilt nur in seinem Fenster. War der Rechner in der Zeit aus, wird
 * NICHT nachgeholt: ein «Lauf nach der Eröffnung» um 14 Uhr wäre keiner.
 *
 * Verkürzte Handelstage (`istVerkuerzt`: Schluss 13:00) verschieben den Platz
 * `schluss` entsprechend nach vorn.
 */
import { nyTeile, istHandelstag, istVerkuerzt } from '../../shared/aktien-sitzung.js'

const MIN = 60_000
const EROEFFNUNG = 9 * 60 + 30
const SCHLUSS = 16 * 60
const SCHLUSS_VERKUERZT = 13 * 60
const schlussAm = (datum) => (datum && istVerkuerzt(datum) ? SCHLUSS_VERKUERZT : SCHLUSS)

/** Ab Werk aus — wie der Zeitplan des Coin-Radars. */
export const ZEITPLAN_VORGABE = Object.freeze({ an: false, nachEroeffnungMin: 30, vorSchlussMin: 30 })

/** Grenzen der beiden Abstände in Minuten. */
export const ZEITPLAN_GRENZEN = Object.freeze({ min: 5, max: 180 })

/** So lange nach seinem Zeitpunkt darf der Platz `eroeffnung` noch laufen. */
export const FENSTER_MIN = 45

export const PLAETZE = ['eroeffnung', 'schluss']

const ganz = (w) => (typeof w === 'number' || (typeof w === 'string' && w.trim() !== '')) && Number.isFinite(Number(w)) ? Math.round(Number(w)) : null

/**
 * Eingabe prüfen. Unbekannte Felder fallen weg, fehlende nehmen die Vorgabe.
 * @returns {{plan: object}|{fehler: string}}  `fehler` ist ein Kürzel (`zeitplanAbstand`)
 */
export function bereinigeZeitplan(roh) {
    const r = roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}
    const plan = { ...ZEITPLAN_VORGABE, an: r.an === true || r.an === 1 }
    for (const feld of ['nachEroeffnungMin', 'vorSchlussMin']) {
        if (r[feld] === undefined || r[feld] === null || r[feld] === '') continue
        const n = ganz(r[feld])
        if (n === null || n < ZEITPLAN_GRENZEN.min || n > ZEITPLAN_GRENZEN.max) return { fehler: 'zeitplanAbstand' }
        plan[feld] = n
    }
    return { plan }
}

/** Gespeicherten Plan lesen — Kaputtes fällt auf die Vorgabe (und damit auf «aus»). */
export function leseZeitplan(roh) {
    const r = bereinigeZeitplan(roh)
    return r.plan || { ...ZEITPLAN_VORGABE }
}

/** Minute des Tages (New Yorker Wanduhr), zu der ein Platz beginnt. */
export function platzMinute(platz, plan, datum = null) {
    return platz === 'eroeffnung' ? EROEFFNUNG + plan.nachEroeffnungMin : schlussAm(datum) - plan.vorSchlussMin
}

/** Bis zu welcher Minute der Platz noch gilt (ausschliesslich). */
function platzEnde(platz, plan, datum = null) {
    // Der Schluss-Platz endet mit der Glocke; der Eröffnungs-Platz nach seinem Fenster,
    // spätestens aber dort, wo der Schluss-Platz beginnt.
    if (platz === 'schluss') return schlussAm(datum)
    return Math.min(platzMinute('eroeffnung', plan) + FENSTER_MIN, platzMinute('schluss', plan, datum))
}

/**
 * Welcher Platz ist JETZT fällig?
 * @returns {{platz: 'eroeffnung'|'schluss', handelstag: string}|null}
 */
export function faelligerPlatz(ms, planRoh) {
    const plan = leseZeitplan(planRoh)
    if (!plan.an) return null
    const t = nyTeile(ms)
    if (!istHandelstag(t.datum, t.wochentag)) return null
    for (const platz of PLAETZE) {
        if (t.minuten >= platzMinute(platz, plan, t.datum) && t.minuten < platzEnde(platz, plan, t.datum)) return { platz, handelstag: t.datum }
    }
    return null
}

/** New Yorker Wanduhr → Zeitpunkt. Probiert beide Versätze (Sommer-/Winterzeit). */
export function nyZeitpunkt(datum, minuten) {
    const [j, m, d] = datum.split('-').map(Number)
    const alsUtc = Date.UTC(j, m - 1, d) + minuten * MIN
    for (const stunden of [4, 5]) {
        const kandidat = alsUtc + stunden * 60 * MIN
        const t = nyTeile(kandidat)
        if (t.datum === datum && t.minuten === minuten) return kandidat
    }
    return null
}

/**
 * Der nächste Platz nach `ms` — für die Anzeige «nächster Lauf».
 * @returns {{platz: string, zeit: number, handelstag: string}|null}  null, wenn der Plan aus ist
 */
export function naechsterPlatz(ms, planRoh) {
    const plan = leseZeitplan(planRoh)
    if (!plan.an) return null
    // 17:00 UTC ist in New York Mittag (Sommer 13:00, Winter 12:00) — sicher am selben Kalendertag.
    const [j, m, d] = nyTeile(ms).datum.split('-').map(Number)
    const mittag = Date.UTC(j, m - 1, d, 17)
    for (let tag = 0; tag < 12; tag++) {
        const t = nyTeile(mittag + tag * 86_400_000)
        if (!istHandelstag(t.datum, t.wochentag)) continue
        for (const platz of PLAETZE) {
            const zeit = nyZeitpunkt(t.datum, platzMinute(platz, plan, t.datum))
            if (zeit !== null && zeit > ms) return { platz, zeit, handelstag: t.datum }
        }
    }
    return null
}
