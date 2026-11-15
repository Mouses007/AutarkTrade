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
/** Der gemessene Sprung darf vom Faktor höchstens um diesen Anteil abweichen (Kursbewegung am Ex-Tag). */
const TOLERANZ = 0.25
/**
 * … und höchstens um diesen Teil des Faktors selbst (in Logarithmen). Mit der
 * festen Toleranz allein «passte» bei einem Faktor zwischen 0,8 und 1,25 jede
 * unveränderte Kerze: ihre Abweichung ist |ln f| und lag damit immer innerhalb
 * (Audit 15.11.2026, FUN-F-003).
 */
const TOLERANZ_ANTEIL = 0.4
/**
 * Faktoren näher an 1 als dieser (Aktiendividende 21:20, Bezugsrechts- oder
 * Abspaltungs-Anpassung, 5:4) werden nur gemeldet, nie angewendet: ein solcher
 * «Sprung» ist von einem gewöhnlichen Kurstag nicht zu unterscheiden, und ob
 * die Börsen den Kontrakt dafür überhaupt umstellen, ist nicht belegt.
 */
const KLEINSTER_FAKTOR = 1.3
/** Der Sprung muss mindestens so viel Mal grösser sein als die übliche Bewegung von Kerze zu Kerze (Median). */
const UEBER_RAUSCHEN = 4
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

/** Erlaubte Abweichung des gemessenen Sprungs vom Faktor, in Logarithmen. */
const toleranz = (f) => Math.min(Math.log(1 + TOLERANZ), TOLERANZ_ANTEIL * Math.abs(Math.log(f)))

/** Faktor zu nahe an 1, um ihn in den Kerzen sicher wiederzufinden — nur melden. */
export const faktorNaheEins = (f) => !(Math.abs(Math.log(Number(f))) >= Math.log(KLEINSTER_FAKTOR))

/** Übliche Bewegung von Schlusskurs zu Schlusskurs (Median der Beträge, in Logarithmen), ohne die Kerze `ohne`. */
function ueblicheBewegung(kerzen, ohne) {
    const b = []
    for (let i = 1; i < kerzen.length; i++) {
        const a = kerzen[i - 1].c, c = kerzen[i].c
        if (i !== ohne && a > 0 && c > 0) b.push(Math.abs(Math.log(a / c)))
    }
    if (!b.length) return 0
    b.sort((x, y) => x - y)
    return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2
}

/** Index der Kerze, mit der der Sprung um `faktor` beginnt — oder -1. */
function findeSprung(kerzen, split) {
    if (faktorNaheEins(split.faktor)) return -1
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
    if (bester < 0 || besteAbweichung > toleranz(split.faktor)) return -1
    // Ein Sprung, der in der gewöhnlichen Kerzenbewegung untergeht, ist keiner.
    const sprung = Math.abs(Math.log(kerzen[bester - 1].c / kerzen[bester].c))
    return sprung >= UEBER_RAUSCHEN * ueblicheBewegung(kerzen, bester) ? bester : -1
}

/**
 * Die Kerze, IN die der Split fällt (Tageskerze am Ex-Tag): sie eröffnet noch
 * im alten Massstab und schliesst im neuen. Ihr Eröffnungskurs wird
 * umgerechnet; das Hoch (bei einer Zusammenlegung das Tief) stammt ebenfalls
 * aus dem alten Massstab und lässt sich nicht retten — es wird auf das
 * begrenzt, was Eröffnung und Schluss hergeben. Kerzen, die sauber im neuen
 * Massstab eröffnen, bleiben unverändert.
 */
function flickeSprungKerze(k, f) {
    if (!(k.o > 0) || !(k.c > 0) || Math.abs(Math.log(k.o / k.c) - Math.log(f)) > toleranz(f)) return k
    const o = k.o / f
    return f > 1
        ? { ...k, o, h: Math.max(o, k.c), l: Math.min(k.l, o, k.c) }
        : { ...k, o, l: Math.min(o, k.c), h: Math.max(k.h, o, k.c) }
}

/**
 * Kerzen vor jedem Split umrechnen.
 *
 * @param {{t,o,h,l,c,v,vb?}[]} kerzen  aufsteigend; wird NICHT verändert (die Marktdaten-Schicht merkt sich ihre Reihen)
 * @param {{t, faktor, text?}[]} splits
 * @returns {{kerzen: object[], splits: {t, faktor, text, angewendet: boolean, bei: number|null}[]}}
 *          `splits` nennt nur, was in den Zeitraum der Kerzen fällt; `angewendet: false` =
 *          der Sprung steht nicht in den Kerzen, es wurde nichts umgerechnet.
 *          `nurGemeldet: true` (immer mit `angewendet: false`) = Faktor zu nahe an 1,
 *          es wurde gar nicht erst gesucht.
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
        bericht.push({
            t: split.t, faktor: split.faktor, text: split.text || '', angewendet: i > 0, bei: i > 0 ? aus[i].t : null,
            ...(faktorNaheEins(split.faktor) ? { nurGemeldet: true } : {}),
        })
        if (i <= 0) continue
        const f = split.faktor
        aus = aus.map((k, j) => (j === i ? flickeSprungKerze(k, f) : j > i ? k : {
            ...k, o: k.o / f, h: k.h / f, l: k.l / f, c: k.c / f, v: k.v * f,
            ...(k.vb != null ? { vb: k.vb * f } : {}),
        }))
    }
    return { kerzen: aus, splits: bericht.reverse() }
}

/**
 * Wie `bereinigeSplits`, aber für Kerzen, die SEITENWEISE kommen (Chart: beim
 * Zurückscrollen lädt jede Seite für sich).
 *
 * Eine Seite, die ganz vor dem Split liegt, enthält den Sprung nicht — für
 * sich allein lässt sich nicht sagen, ob sie umzurechnen ist. Deshalb merkt
 * sich der Aufrufer in `bekannt`, an welcher Kerze der Sprung gefunden wurde;
 * jede spätere Seite davor wird dann ganz umgerechnet. Der Chart lädt von neu
 * nach alt, die Seite mit dem Sprung kommt also vor den älteren.
 *
 * Grenze: liegt der Sprung genau zwischen zwei Seiten (letzte Kerze der einen,
 * erste der anderen), wird er nicht gefunden und nichts umgerechnet.
 *
 * @param {object[]} kerzen   aufsteigend; wird nicht verändert
 * @param {{t, faktor}[]} splits
 * @param {Map<number, number>} bekannt  Split-Zeit → Zeit der ersten Kerze NACH dem Sprung; wird ergänzt
 * @returns {{kerzen: object[], angewendet: number}}  `angewendet` = Zahl der Splits, die auf diese Seite wirkten
 */
export function bereinigeSeite(kerzen = [], splits = [], bekannt = new Map()) {
    if (!kerzen.length || !splits.length) return { kerzen, angewendet: 0 }
    let aus = kerzen
    let angewendet = 0
    for (const split of [...splits].sort((a, b) => b.t - a.t)) {
        if (faktorNaheEins(split.faktor)) continue   // auch nicht aus altem Wissen
        let ab = bekannt.get(split.t)
        if (ab === undefined) {
            const i = aus.length > 1 ? findeSprung(aus, split) : -1
            if (i <= 0) continue
            ab = aus[i].t
            bekannt.set(split.t, ab)
        }
        if (!(aus[0].t <= ab)) continue
        const f = split.faktor
        aus = aus.map((k) => (k.t === ab ? flickeSprungKerze(k, f) : k.t > ab ? k : {
            ...k, o: k.o / f, h: k.h / f, l: k.l / f, c: k.c / f, v: k.v * f,
            ...(k.vb != null ? { vb: k.vb * f } : {}),
        }))
        angewendet++
    }
    return { kerzen: aus, angewendet }
}

/**
 * Ohne Split-Angaben der Kursquelle: Stellen, an denen zwei Schlusskurse um
 * mehr als das 1,8-Fache auseinanderliegen. Nur ein Hinweis — ein Kurssturz um
 * die Hälfte sieht genauso aus wie ein Split 2:1, deshalb wird hier nichts
 * umgerechnet.
 */
export function verdaechtigeSpruenge(kerzen = [], ab = VERDACHT_AB) {
    const aus = []
    for (let i = 1; i < kerzen.length; i++) {
        const a = kerzen[i - 1].c, b = kerzen[i].c
        if (!(a > 0) || !(b > 0)) continue
        const verhaeltnis = a / b
        if (verhaeltnis >= ab || verhaeltnis <= 1 / ab) aus.push({ t: kerzen[i].t, verhaeltnis })
    }
    return aus
}

/** Kleinster Sprung zweier Schlusskurse, hinter dem ein anwendbarer Split stehen kann (Faktor 1,3 abzüglich Toleranz). */
const SPLIT_MOEGLICH_AB = 1.15

/**
 * Kerzen für eine Messung OHNE Position (Aktien-Radar, Erfolgskontrolle):
 * bereinigen, wo ein Split den Sprung erklärt, und sagen, wenn ein Sprung
 * unerklärt stehen bleibt.
 *
 * Die Splits werden nur geholt, wenn in den Kerzen überhaupt ein Sprung steht,
 * hinter dem ein Split stecken kann — der Radar vermisst zweihundert Titel,
 * und ein Abruf je Titel bei der Kursquelle wäre für fast alle verschenkt.
 *
 * @param {object[]} kerzen  aufsteigend; wird nicht verändert
 * @param {() => Promise<object[]|null>|object[]|null} holeSplits  `null` = unbekannt
 * @returns {Promise<{kerzen: object[], splits: object[], offen: boolean}>}
 *          `splits` = was umgerechnet wurde (Bericht aus `bereinigeSplits`);
 *          `offen` = es steht noch ein Sprung ≥ 1,8× in den Kerzen, den kein
 *          Split erklärt — Kennzahlen und Renditen darüber sind wertlos.
 */
export async function ohneSplitSprung(kerzen = [], holeSplits = () => null) {
    if (!verdaechtigeSpruenge(kerzen, SPLIT_MOEGLICH_AB).length) return { kerzen, splits: [], offen: false }
    let splits = null
    try { splits = await holeSplits() } catch { splits = null }
    const b = Array.isArray(splits) && splits.length ? bereinigeSplits(kerzen, splits) : { kerzen, splits: [] }
    return { kerzen: b.kerzen, splits: b.splits.filter((s) => s.angewendet), offen: verdaechtigeSpruenge(b.kerzen).length > 0 }
}

/**
 * `ohneSplitSprung` über die Kerzen vieler Symbole (Aktien-Radar: eine Map je
 * Zeiteinheit). Die Eingabe wird nicht verändert.
 *
 * @param {Map<string, object[]>} jeSymbol
 * @param {(symbol: string) => Promise<object[]|null>} holeSplits
 * @param {Map<string, {splits: {t, faktor, text}[], offen: boolean}>} merk  wird ergänzt — über mehrere
 *        Zeiteinheiten hinweg: nur Symbole, bei denen umgerechnet wurde oder ein Sprung offen blieb
 * @returns {Promise<Map<string, object[]>>}
 */
export async function ohneSplitSpruengeJe(jeSymbol, holeSplits, merk = new Map()) {
    const aus = new Map()
    for (const [symbol, kerzen] of jeSymbol) {
        const r = await ohneSplitSprung(kerzen, () => holeSplits(symbol))
        aus.set(symbol, r.kerzen)
        if (!r.splits.length && !r.offen) continue
        const bisher = merk.get(symbol) || { splits: [], offen: false }
        for (const x of r.splits) {
            if (!bisher.splits.some((b) => b.t === x.t)) bisher.splits.push({ t: x.t, faktor: x.faktor, text: x.text || '' })
        }
        bisher.offen = bisher.offen || r.offen
        merk.set(symbol, bisher)
    }
    return aus
}

/* ── Funding und offene Papier-Positionen über einen Split ────────── */

/**
 * Funding-Verlauf in den Massstab der bereinigten Kerzen bringen.
 *
 * Die Börse rechnet Funding auf Menge × Mark-Preis der Abrechnung. Der
 * Mark-Preis im Verlauf steht — wie die Kerzen — im Massstab seiner Zeit; die
 * Menge einer Position dagegen im Massstab NACH dem Split (Backtest: bereinigte
 * Kerzen, Papier: umgerechnete Position). Ohne diese Umrechnung zählte jede
 * Abrechnung vor einem Split 20:1 das Zwanzigfache.
 *
 * @param {{t, rate, markPrice?}[]|null} verlauf  wird nicht verändert
 * @param {{faktor, bei, angewendet?}[]} splits   Bericht aus `bereinigeSplits` (nur `angewendet` zählt)
 *                                                oder der Vermerk einer Position
 */
export function bereinigeFunding(verlauf, splits = []) {
    const wirksam = (splits || []).filter((s) => s && s.angewendet !== false && s.faktor > 0 && s.bei > 0)
    if (!Array.isArray(verlauf) || !wirksam.length) return verlauf
    return verlauf.map((e) => {
        if (!(Number(e?.markPrice) > 0)) return e
        let f = 1
        for (const s of wirksam) if (Number(e.t) < s.bei) f *= s.faktor
        return f === 1 ? e : { ...e, markPrice: Number(e.markPrice) / f }
    })
}

/** Felder einer Position (`strategy_positions`), die Stückzahlen bzw. Kurse sind. */
const POSITION_MENGEN = ['qty', 'initialQty', 'partialQty']
const POSITION_KURSE = ['entryPrice', 'stopLoss', 'initialStopLoss', 'takeProfit', 'maePrice', 'mfePrice', 'partialPrice']

/**
 * Eine offene Position über einen Split umrechnen — so, wie Bitget es tut
 * (`docs/RECHERCHE-AKTIEN.md`): Menge × Faktor, Kurse ÷ Faktor. Einstieg,
 * laufender und ursprünglicher Stop, Ziel, die mitgeschriebenen Extreme
 * (MAE/MFE) und ein schon genommener Teilausstieg wandern mit. Nominalwert,
 * Marge, Gebühren und das gebuchte Teilergebnis sind Geldbeträge und bleiben.
 *
 * Gibt nur die GEÄNDERTEN Felder zurück (für ein `update`); Felder ohne Wert
 * (0 = «kein Ziel», fehlende Spalte) bleiben unberührt.
 *
 * Die neue Menge wird nicht auf die Schrittweite der Börse gerundet: was die
 * Börse mit Bruchteilen macht, ist nicht belegt.
 *
 * @param {object} zeile   Zeile aus `strategy_positions` oder Position des Simulators
 * @param {number} faktor  > 1 = Aktiensplit (20:1 → 20), < 1 = Zusammenlegung (1:10 → 0,1)
 */
export function positionUeberSplit(zeile, faktor) {
    const f = Number(faktor)
    if (!(f > 0) || f === 1) return {}
    const aus = {}
    for (const k of POSITION_MENGEN) if (Number(zeile[k]) > 0) aus[k] = Number(zeile[k]) * f
    for (const k of POSITION_KURSE) if (Number(zeile[k]) > 0) aus[k] = Number(zeile[k]) / f
    return aus
}

/** Der Vermerk `splitsAngewendet` (JSON-Text oder Liste) als Liste `[{t, faktor, bei}]`. */
export function leseSplitVermerk(wert) {
    let liste = wert
    if (typeof wert === 'string') {
        try { liste = JSON.parse(wert) } catch { liste = null }
    }
    return Array.isArray(liste) ? liste.filter((s) => s && Number(s.t) > 0) : []
}

/**
 * Welche Splits sind an einer offenen Position noch umzurechnen?
 *
 * Ein Split betrifft die Position, wenn sie zuletzt auf einer Kerze VOR dem
 * Sprung bewertet wurde (`lastCandleTime` + Kerzenlänge ≤ Beginn der ersten
 * Kerze im neuen Massstab) — dann stehen ihre Kurse noch im alten Massstab.
 * Eine Position, die auf der Sprungkerze oder danach entstand, wurde schon aus
 * bereinigten Kerzen gebaut. Was im Vermerk steht, ist erledigt.
 *
 * @param {{t, faktor, text?, angewendet, bei}[]} bericht  aus `bereinigeSplits`, aufsteigend
 * @param {{lastCandleTime: number, kerzeMs: number, vermerk: object[]}} stand
 * @returns {object[]} die fälligen Einträge des Berichts, aufsteigend
 */
export function faelligeSplits(bericht = [], { lastCandleTime, kerzeMs = 0, vermerk = [] } = {}) {
    const erledigt = new Set(vermerk.map((s) => Number(s.t)))
    const zuletzt = Number(lastCandleTime) || 0
    return bericht.filter((s) => s.angewendet && s.bei > 0 && !erledigt.has(Number(s.t))
        && zuletzt > 0 && zuletzt + (Number(kerzeMs) || 0) <= s.bei)
}
