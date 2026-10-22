/**
 * Drei-Wege-Zusammenführung eines Chart-Layouts (rein, ohne Vue).
 *
 * Das Layout liegt in der Datenbank und gilt für alle Fenster und Geräte. Hat ein
 * anderes Fenster inzwischen gespeichert, antwortet der Server mit 409 und seinem
 * Stand. Bis 22.10.2026 übernahm das Fenster dann einfach diesen Stand — und der
 * eigene Klick (z. B. ein VWAP-Vector-Schalter) war still verloren. Jetzt werden
 * beide Änderungen gegen den gemeinsamen Ausgangsstand zusammengeführt:
 *
 *   - nur eine Seite hat etwas geändert → deren Wert;
 *   - Objekte → je Schlüssel;
 *   - Listen aus Objekten mit `id` (Panels, Indikatoren) → je id, Reihenfolge der
 *     eigenen Seite, auf einer Seite Gelöschtes bleibt gelöscht, Neues kommt dazu;
 *   - andere Listen gleicher Länge → je Stelle, sonst gewinnt die eigene Seite;
 *   - echter Widerspruch am selben Wert → die eigene Seite (der jüngste Klick).
 */

const gleich = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const mitIds = (l) => Array.isArray(l) && l.every((x) => istObjekt(x) && x.id != null)

export function fuehreZusammen(basis, mein, ihr) {
    if (gleich(mein, ihr)) return mein
    if (gleich(mein, basis)) return ihr
    if (gleich(ihr, basis)) return mein
    if (istObjekt(mein) && istObjekt(ihr)) {
        const b = istObjekt(basis) ? basis : {}
        const aus = {}
        for (const k of new Set([...Object.keys(mein), ...Object.keys(ihr)])) {
            const inMein = k in mein, inIhr = k in ihr, inBasis = k in b
            if (inMein && inIhr) aus[k] = fuehreZusammen(b[k], mein[k], ihr[k])
            else if (inMein) { if (!(inBasis && gleich(b[k], mein[k]))) aus[k] = mein[k] } // dort gelöscht, hier unverändert → weg
            else if (!(inBasis && gleich(b[k], ihr[k]))) aus[k] = ihr[k]
        }
        return aus
    }
    if (mitIds(mein) && mitIds(ihr)) {
        const b = new Map((mitIds(basis) ? basis : []).map((x) => [x.id, x]))
        const ihrNach = new Map(ihr.map((x) => [x.id, x]))
        const meinNach = new Map(mein.map((x) => [x.id, x]))
        const aus = []
        for (const x of mein) {
            if (ihrNach.has(x.id)) aus.push(fuehreZusammen(b.get(x.id), x, ihrNach.get(x.id)))
            else if (!(b.has(x.id) && gleich(b.get(x.id), x))) aus.push(x) // neu hier, oder dort gelöscht aber hier geändert
        }
        ihr.forEach((x) => { if (!meinNach.has(x.id) && !b.has(x.id)) aus.push(x) }) // dort neu
        return aus
    }
    if (Array.isArray(mein) && Array.isArray(ihr) && mein.length === ihr.length
        && Array.isArray(basis) && basis.length === mein.length) {
        return mein.map((x, i) => fuehreZusammen(basis[i], x, ihr[i]))
    }
    return mein
}
