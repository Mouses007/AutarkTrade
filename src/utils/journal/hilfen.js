/**
 * Kleine reine Helfer des Journal-Kerns: Gruppieren, stabil sortieren,
 * reaktive Container in place leeren und füllen.
 */

/**
 * Gruppiert eine Liste nach dem berechneten Schlüssel. Der Schlüssel wird zur
 * Zeichenkette (`undefined` → „undefined"); die Reihenfolge der Schlüssel ist
 * die von JavaScript (ganzzahlige zuerst, aufsteigend; die übrigen in der
 * Reihenfolge ihres ersten Auftretens) — `charts.js` übernimmt sie in Achsen.
 */
export function gruppiere(liste, schluesselVon) {
    const aus = {}
    for (const eintrag of liste) {
        const k = String(schluesselVon(eintrag))
        ;(aus[k] ||= []).push(eintrag)
    }
    return aus
}

/** Neue, stabil nach dem Zahlenwert aufsteigend sortierte Liste. */
export function sortiertNach(liste, wertVon) {
    return liste
        .map((eintrag, i) => ({ eintrag, i, w: wertVon(eintrag) }))
        .sort((a, b) => vergleicheZahl(a.w, b.w) || a.i - b.i)
        .map(x => x.eintrag)
}

// NaN/undefined ans Ende, sonst numerisch — dieselbe Ordnung für jede Quelle.
function vergleicheZahl(a, b) {
    const aLeer = a == null || Number.isNaN(a)
    const bLeer = b == null || Number.isNaN(b)
    if (aLeer || bLeer) return aLeer === bLeer ? 0 : (aLeer ? 1 : -1)
    return a < b ? -1 : (a > b ? 1 : 0)
}

/** JSON-Rundreise: NaN/±Infinity → null, undefined-Felder verschwinden. */
export const jsonKopie = (x) => JSON.parse(JSON.stringify(x))

/** Leert eine reaktive Liste in place und füllt sie neu. */
export function ersetzeListe(ziel, neu = []) {
    ziel.length = 0
    for (const e of neu) ziel.push(e)
}

/** Leert ein reaktives Objekt in place und füllt es neu. */
export function ersetzeObjekt(ziel, neu = {}) {
    for (const k of Object.keys(ziel)) delete ziel[k]
    Object.assign(ziel, neu)
}

/** `{0,0}` heisst „alles" — kein Zeitfilter. */
export function istGanzerZeitraum(bereich) {
    return Number(bereich?.start) === 0 && Number(bereich?.end) === 0
}
