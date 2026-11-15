/**
 * Split-Wache (Aktien-Integration, `docs/RECHERCHE-AKTIEN.md`).
 *
 * Die Kerzen der Aktien-Futures sind NICHT split-bereinigt: nach einem Split
 * 20:1 steht in der Historie ein Sprung von 481 auf 22,7 (gemessen an
 * KORUUSDT bei Binance und Bitget, Split vom 15.7.2026). Jeder Indikator, der
 * über diesen Tag rechnet, und jeder Stop, der davor gesetzt wurde, ist dann
 * falsch — der Backtest bucht einen Verlust von 95 %, den es nie gab.
 *
 * Deshalb: die Splits des Titels von der Kursquelle holen und die Kerzen DAVOR
 * umrechnen (Preis ÷ Faktor, Volumen × Faktor), so wie eine bereinigte
 * Kursreihe es tut. Umgerechnet wird nur, wenn der Sprung in den Kerzen auch
 * wirklich steht — ein Future, der erst nach dem Split gelistet wurde oder
 * dessen Börse die Historie doch angepasst hat, bliebe sonst doppelt geteilt.
 *
 * Rein — kein Netz. Das Holen steht in `newcomer-radar/kursquelle.js`.
 */

/** So weit um den Ex-Tag herum wird der Sprung gesucht (die Börsen setzen den Handel um ihn herum aus). */
const SUCHFENSTER_MS = 3 * 86_400_000
/** Der gemessene Sprung darf vom Faktor um diesen Anteil abweichen (Kursbewegung am Ex-Tag). */
const TOLERANZ = 0.25
/** Ohne Split-Angaben: ab diesem Verhältnis zweier Schlusskurse gilt ein Sprung als verdächtig. */
const VERDACHT_AB = 1.8

/**
 * Yahoos `events.splits` → `[{t, faktor, text}]`, aufsteigend.
 * `faktor` > 1 = Aktiensplit (4:1 → 4), < 1 = Zusammenlegung (1:10 → 0,1).
 */
export function ausSplits(json) {
    const roh = json?.chart?.result?.[0]?.events?.splits
    if (!roh || typeof roh !== 'object') return []
    const aus = []
    for (const s of Object.values(roh)) {
        const zaehler = Number(s?.numerator), nenner = Number(s?.denominator), sek = Number(s?.date)
        if (!(zaehler > 0) || !(nenner > 0) || !(sek > 0) || zaehler === nenner) continue
        aus.push({ t: sek * 1000, faktor: zaehler / nenner, text: String(s.splitRatio || `${zaehler}:${nenner}`).slice(0, 12) })
    }
    return aus.sort((a, b) => a.t - b.t)
}

/** Index der Kerze, mit der der Sprung um `faktor` beginnt — oder -1. */
function findeSprung(kerzen, split) {
    let bester = -1, besteAbweichung = Infinity
    for (let i = 1; i < kerzen.length; i++) {
        const k = kerzen[i]
        if (k.t < split.t - SUCHFENSTER_MS) continue
        if (k.t > split.t + SUCHFENSTER_MS) break
        const vorher = kerzen[i - 1].c
        if (!(vorher > 0) || !(k.c > 0)) continue
        const abweichung = Math.abs(Math.log(vorher / k.c) - Math.log(split.faktor))
        if (abweichung < besteAbweichung) { besteAbweichung = abweichung; bester = i }
    }
    return besteAbweichung <= Math.log(1 + TOLERANZ) ? bester : -1
}

/**
 * Kerzen vor jedem Split umrechnen.
 *
 * @param {{t,o,h,l,c,v,vb?}[]} kerzen  aufsteigend; wird NICHT verändert (die Marktdaten-Schicht merkt sich ihre Reihen)
 * @param {{t, faktor, text?}[]} splits
 * @returns {{kerzen: object[], splits: {t, faktor, text, angewendet: boolean, bei: number|null}[]}}
 *          `splits` nennt nur, was in den Zeitraum der Kerzen fällt; `angewendet: false` =
 *          der Sprung steht nicht in den Kerzen, es wurde nichts umgerechnet.
 */
export function bereinigeSplits(kerzen = [], splits = []) {
    if (kerzen.length < 2 || !splits.length) return { kerzen, splits: [] }
    const von = kerzen[0].t, bis = kerzen[kerzen.length - 1].t
    const bericht = []
    let aus = kerzen
    // Von hinten nach vorn: ein früherer Split rechnet dann auf schon bereinigten Kursen.
    for (const split of [...splits].sort((a, b) => b.t - a.t)) {
        if (split.t <= von - SUCHFENSTER_MS || split.t > bis + SUCHFENSTER_MS) continue
        const i = findeSprung(aus, split)
        bericht.push({ t: split.t, faktor: split.faktor, text: split.text || '', angewendet: i > 0, bei: i > 0 ? aus[i].t : null })
        if (i <= 0) continue
        const f = split.faktor
        aus = aus.map((k, j) => (j >= i ? k : {
            ...k, o: k.o / f, h: k.h / f, l: k.l / f, c: k.c / f, v: k.v * f,
            ...(k.vb != null ? { vb: k.vb * f } : {}),
        }))
    }
    return { kerzen: aus, splits: bericht.reverse() }
}

/**
 * Ohne Split-Angaben der Kursquelle: Stellen, an denen zwei Schlusskurse um
 * mehr als das 1,8-Fache auseinanderliegen. Nur ein Hinweis — ein Kurssturz um
 * die Hälfte sieht genauso aus wie ein Split 2:1, deshalb wird hier nichts
 * umgerechnet.
 */
export function verdaechtigeSpruenge(kerzen = []) {
    const aus = []
    for (let i = 1; i < kerzen.length; i++) {
        const a = kerzen[i - 1].c, b = kerzen[i].c
        if (!(a > 0) || !(b > 0)) continue
        const verhaeltnis = a / b
        if (verhaeltnis >= VERDACHT_AB || verhaeltnis <= 1 / VERDACHT_AB) aus.push({ t: kerzen[i].t, verhaeltnis })
    }
    return aus
}
