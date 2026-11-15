/**
 * Bitcoin-Bewertung — reine Rechnung, ohne Netz und ohne Datenbank.
 *
 * Die Frage der Kachel: Steht der Kurs gemessen an seiner eigenen Geschichte
 * hoch oder tief? Beantwortet wird sie mit drei Vergleichspreisen:
 *
 *   realized  Realized Price — der durchschnittliche Einstand aller Coins,
 *             bewertet zum Kurs ihrer letzten Bewegung. Kurs / Realized Price
 *             ist das MVRV-Verhältnis; die Quelle liefert das Verhältnis, der
 *             Preis wird daraus zurückgerechnet.
 *   w200      Durchschnitt der letzten 200 Wochen (1400 Tagesschlüsse).
 *   sth       Einstand der kurzfristigen Halter (Coins, die in den letzten
 *             rund 155 Tagen bewegt wurden).
 *
 * Je Modell entsteht das Verhältnis Kurs / Vergleichspreis und daraus ein
 * RANG: an wie viel Prozent aller bisherigen Tage war dieses Verhältnis
 * tiefer als heute. Rang 18 heisst: an 18 % der Tage war Bitcoin nach diesem
 * Modell günstiger bewertet, an 82 % teurer.
 *
 * Was hier bewusst NICHT passiert:
 *
 * - Kein Signal. Ein Rang ist eine Einordnung in die Vergangenheit, keine
 *   Aussage über morgen; in Bärenmärkten blieb der Kurs monatelang tief.
 * - Kein Mitzählen kurzer Reihen im Gesamtwert. Der Kurzfrist-Einstand reicht
 *   beim Gratis-Zugang nur vier Jahre zurück — ein Rang über einen einzigen
 *   Zyklus ist mit einem über vierzehn Jahre nicht vergleichbar. Er steht
 *   daneben, mit eigenem Startdatum, und zählt erst mit, wenn die eigene
 *   Sammlung `LANG_AB_TAGE` erreicht.
 * - Kein Rang vor 2012. Davor kostete ein Bitcoin Cent-Beträge bei
 *   Tagesumsätzen von wenigen tausend Dollar; die Ausschläge dieser Zeit
 *   (MVRV über 100) würden jede spätere Bewertung „günstig" aussehen lassen.
 */

export const TAG_MS = 24 * 60 * 60 * 1000

/** Ab hier zählt ein Tag für den Rang. */
export const RANG_AB = Date.UTC(2012, 0, 1)

/** 200 Wochen in Tagesschlüssen. */
export const W200_TAGE = 1400

/** So viel Geschichte braucht ein Modell, um in den Gesamtwert einzugehen. */
export const LANG_AB_TAGE = 8 * 365

const tagesBeginn = (t) => Math.floor(t / TAG_MS) * TAG_MS

const zahl = (roh) => {
    if (roh === null || roh === undefined || roh === '') return NaN
    return Number(roh)
}

/** Datum der Quelle → UTC-Mitternacht in ms. Nur die ersten zehn Zeichen zählen. */
function tagAus(roh) {
    const s = String(roh || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN
    return Date.parse(`${s}T00:00:00Z`)
}

/**
 * Antwort der Coin-Metrics-Community-API in zwei Tagesreihen wandeln.
 *
 * Die Quelle liefert Zahlen als Zeichenketten und lässt ein Feld weg, wenn
 * sie für den Tag nichts hat — solche Tage fallen für die jeweilige Reihe
 * heraus, statt als 0 einzugehen.
 *
 * @param {Array} zeilen  `data` der Antwort
 * @returns {{kurs: Array<[number, number]>, mvrv: Array<[number, number]>}}
 */
export function reihenAusCoinMetrics(zeilen) {
    const kurs = new Map()
    const mvrv = new Map()
    for (const z of Array.isArray(zeilen) ? zeilen : []) {
        const t = tagAus(z?.time)
        if (!Number.isFinite(t)) continue
        const p = zahl(z?.PriceUSD)
        const m = zahl(z?.CapMVRVCur)
        if (Number.isFinite(p) && p > 0) kurs.set(t, p)
        if (Number.isFinite(m) && m > 0) mvrv.set(t, m)
    }
    const sortiert = (map) => [...map.entries()].sort((a, b) => a[0] - b[0])
    return { kurs: sortiert(kurs), mvrv: sortiert(mvrv) }
}

/**
 * Antwort von BGeometrics (`/v1/sth-realized-price`) in eine Tagesreihe wandeln.
 * Auch hier kommen die Werte als Zeichenketten.
 */
export function reiheAusBGeometrics(zeilen, feld = 'sthRealizedPrice') {
    const proTag = new Map()
    for (const z of Array.isArray(zeilen) ? zeilen : []) {
        const t = tagAus(z?.d)
        const w = zahl(z?.[feld])
        if (!Number.isFinite(t) || !Number.isFinite(w) || w <= 0) continue
        proTag.set(t, w)
    }
    return [...proTag.entries()].sort((a, b) => a[0] - b[0])
}

/**
 * Gleitender Durchschnitt über die letzten `n` EINTRÄGE (nicht Kalendertage —
 * die Tagesreihe ist lückenlos genug, und eine fehlende Kerze soll die Linie
 * nicht unterbrechen). Liefert erst ab dem n-ten Eintrag.
 */
export function gleitend(reihe, n) {
    const aus = []
    let summe = 0
    for (let i = 0; i < reihe.length; i++) {
        summe += reihe[i][1]
        if (i >= n) summe -= reihe[i - n][1]
        if (i >= n - 1) aus.push([reihe[i][0], summe / n])
    }
    return aus
}

/**
 * Rang eines Werts in einer Menge: Anteil der kleineren Werte in Prozent,
 * gleiche zählen halb. Leere Menge → null.
 */
export function rangVon(werte, wert) {
    if (!werte.length || !Number.isFinite(wert)) return null
    let kleiner = 0
    let gleich = 0
    for (const w of werte) {
        if (w < wert) kleiner++
        else if (w === wert) gleich++
    }
    return Math.round(((kleiner + gleich / 2) / werte.length) * 100)
}

/** Fünf Stufen für Farbe und Wort der Kachel. */
export function stufeVon(rang) {
    if (rang === null || rang === undefined) return null
    if (rang < 20) return 'guenstig'
    if (rang < 40) return 'eherGuenstig'
    if (rang < 60) return 'mittel'
    if (rang < 80) return 'eherTeuer'
    return 'teuer'
}

const runde = (v, stellen) => Math.round(v * 10 ** stellen) / 10 ** stellen

/**
 * Ein Modell auswerten.
 *
 * @param {string} id
 * @param {Array<[number, number]>} verhaeltnisse  [Tag, Kurs / Vergleichspreis] ab `RANG_AB`
 * @param {number} verhJetzt   heutiges Verhältnis
 * @param {number} wertJetzt   heutiger Vergleichspreis in Dollar
 * @param {number} stand       Tag, von dem der Vergleichspreis stammt
 */
function modell(id, verhaeltnisse, verhJetzt, wertJetzt, stand) {
    if (!verhaeltnisse.length || !Number.isFinite(verhJetzt) || !Number.isFinite(wertJetzt)) return null
    const werte = verhaeltnisse.map(v => v[1])
    return {
        id,
        wert: runde(wertJetzt, 2),
        verh: runde(verhJetzt, 3),
        abstandPct: runde((verhJetzt - 1) * 100, 1),
        rang: rangVon(werte, verhJetzt),
        seit: verhaeltnisse[0][0],
        tage: verhaeltnisse.length,
        stand,
        zaehlt: verhaeltnisse.length >= LANG_AB_TAGE,
    }
}

/**
 * Nutzlast der Kachel aus den eingelagerten Reihen.
 *
 * @param {object} reihen
 * @param {Array<[number, number]>} reihen.kurs  Tagesschlüsse in Dollar
 * @param {Array<[number, number]>} reihen.mvrv  Kurs / Realized Price
 * @param {Array<[number, number]>} [reihen.sth] Einstand der kurzfristigen Halter
 * @returns {object|null}  null, solange Kurs oder MVRV fehlen
 */
export function baueBewertung({ kurs = [], mvrv = [], sth = [] } = {}) {
    if (!kurs.length) return null
    const kursAmTag = new Map(kurs)
    const [tag, preis] = kurs[kurs.length - 1]
    const ab = (reihe) => reihe.filter(v => v[0] >= RANG_AB)

    // Realized Price: die Quelle liefert das Verhältnis, der Preis folgt daraus
    const mvrvAb = ab(mvrv)
    const mvrvLetzt = mvrv[mvrv.length - 1]
    const realizedAmTag = new Map()
    for (const [t, m] of mvrv) {
        const p = kursAmTag.get(t)
        if (p) realizedAmTag.set(t, p / m)
    }
    const realized = mvrvLetzt && kursAmTag.get(mvrvLetzt[0])
        ? modell('realized', mvrvAb, mvrvLetzt[1], kursAmTag.get(mvrvLetzt[0]) / mvrvLetzt[1], mvrvLetzt[0])
        : null

    // 200-Wochen-Durchschnitt aus derselben Kursreihe
    const schnitt = gleitend(kurs, W200_TAGE)
    const schnittAmTag = new Map(schnitt)
    const w200Verh = ab(schnitt).map(([t, s]) => [t, kursAmTag.get(t) / s])
    const schnittLetzt = schnitt[schnitt.length - 1]
    const w200 = schnittLetzt
        ? modell('w200', w200Verh, preis / schnittLetzt[1], schnittLetzt[1], schnittLetzt[0])
        : null

    // Kurzfrist-Einstand: hinkt beim Gratis-Zugang eine Woche nach. Verglichen
    // wird der HEUTIGE Kurs mit dem letzten bekannten Einstand — der bewegt
    // sich in einer Woche um Promille, der Kurs um Prozente.
    const sthVerh = []
    for (const [t, s] of ab(sth)) {
        const p = kursAmTag.get(t)
        if (p) sthVerh.push([t, p / s])
    }
    const sthLetzt = sth[sth.length - 1]
    const kurzfrist = sthLetzt
        ? modell('sth', sthVerh, preis / sthLetzt[1], sthLetzt[1], sthLetzt[0])
        : null

    const modelle = [realized, w200, kurzfrist].filter(Boolean)
    if (!modelle.length) return null

    const lang = modelle.filter(m => m.zaehlt && m.rang !== null)
    const gesamtRang = lang.length
        ? Math.round(lang.reduce((s, m) => s + m.rang, 0) / lang.length)
        : null

    // Verlauf für das Diagramm: Wochenpunkte, vom jüngsten Tag rückwärts
    const sthAmTag = new Map(sth)
    const verlauf = []
    for (let i = kurs.length - 1; i >= 0 && kurs[i][0] >= RANG_AB; i -= 7) {
        const [t, p] = kurs[i]
        const r = realizedAmTag.get(t)
        const w = schnittAmTag.get(t)
        const s = sthAmTag.get(t)
        verlauf.push([
            t, runde(p, 2),
            r ? runde(r, 2) : null,
            w ? runde(w, 2) : null,
            s ? runde(s, 2) : null,
        ])
    }
    verlauf.reverse()

    return {
        tag,
        preis: runde(preis, 2),
        modelle,
        gesamt: {
            rang: gesamtRang,
            stufe: stufeVon(gesamtRang),
            anzahl: lang.length,
        },
        verlauf,
    }
}

/**
 * Ab welchem Tag nachgeholt werden muss.
 *
 * Leerer Bestand → alles (null). Sonst drei Tage vor dem letzten eigenen Tag:
 * die Quelle korrigiert die jüngsten Werte gelegentlich nach.
 *
 * @returns {string|null}  'YYYY-MM-DD' oder null für „von Anfang an"
 */
export function abrufAb(reihe) {
    if (!reihe.length) return null
    const t = reihe[reihe.length - 1][0] - 3 * TAG_MS
    return new Date(tagesBeginn(t)).toISOString().slice(0, 10)
}

/**
 * Hinweis, wenn der Bestand alt ist. Die Quelle liefert den Vortag; alles
 * über drei Tage heisst, dass der Abruf hängt.
 */
export function frischeHinweis(tag, jetzt = Date.now()) {
    const alter = Math.floor((tagesBeginn(jetzt) - tag) / TAG_MS)
    return alter > 3 ? `Stand ist ${alter} Tage alt` : null
}
