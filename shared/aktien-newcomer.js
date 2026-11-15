/**
 * Newcomer-Karte: was bei jungen Firmen zählt und bei Coins nie Thema war
 * (`docs/RECHERCHE-AKTIEN.md`, Abschnitt C4).
 *
 *   Haltefrist    Altaktionäre dürfen nach dem Börsengang meist 180 Tage nicht
 *                 verkaufen. Um den Ablauf herum ist Kursdruck belegt, und das
 *                 Volumen bleibt danach dauerhaft höher (Field/Hanka 2001).
 *                 Hier GERECHNET aus dem ersten Handelstag — die wirkliche
 *                 Frist steht im Börsenprospekt und kann abweichen (90 Tage,
 *                 gestaffelt, vorzeitig aufgehoben). Deshalb heisst sie überall
 *                 «üblich» und nie «läuft ab am».
 *   Reichweite    Barmittel geteilt durch den Mittelabfluss: wie viele Monate
 *                 reicht die Kasse, bevor frisches Geld nötig ist (und damit
 *                 eine Kapitalerhöhung droht). Faustregel aus der Praxis.
 *   Insider       echte Käufe und Verkäufe der letzten sechs Monate —
 *                 Zuteilungen aus Vergütungsplänen zählen nicht als Kauf.
 *
 * Rein — kein Netz, keine Datenbank; läuft im Browser und auf dem Server.
 */

const TAG = 86_400_000
/** Übliche Länge der Haltefrist nach einem Börsengang. */
export const HALTEFRIST_TAGE = 180
/** So lange vor dem üblichen Ablauf gilt er als «bald». */
const BALD_TAGE = 30
/** So lange nach dem Ablauf wird er noch genannt (das Volumen bleibt erhöht). */
const NACHLAUF_TAGE = 90
/** Bis zu diesem Alter gilt eine Firma hier als jung. */
export const JUNG_TAGE = 730
const INSIDER_FENSTER_TAGE = 180

/** Ist die Firma höchstens zwei Jahre an der Börse? `null`, wenn der Börsengang unbekannt ist. */
export function istJung(ipoDatum, jetzt = Date.now()) {
    if (!Number.isFinite(ipoDatum) || ipoDatum <= 0) return null
    return jetzt - ipoDatum <= JUNG_TAGE * TAG
}

/**
 * Übliche Haltefrist nach dem Börsengang.
 * @returns {{ablauf: number, tage: number, status: 'laeuft'|'bald'|'abgelaufen'} | null}
 *          `tage` = Tage bis zum üblichen Ablauf (negativ = seit so vielen Tagen vorbei);
 *          `null`, wenn der Börsengang unbekannt ist oder der Ablauf länger als 90 Tage zurückliegt
 */
export function haltefrist(ipoDatum, jetzt = Date.now()) {
    if (!Number.isFinite(ipoDatum) || ipoDatum <= 0 || ipoDatum > jetzt) return null
    const ablauf = ipoDatum + HALTEFRIST_TAGE * TAG
    const tage = Math.round((ablauf - jetzt) / TAG)
    if (tage < -NACHLAUF_TAGE) return null
    return { ablauf, tage, status: tage < 0 ? 'abgelaufen' : tage <= BALD_TAGE ? 'bald' : 'laeuft' }
}

/**
 * Wie lange reicht die Kasse beim heutigen Mittelabfluss?
 * @param {number|null} barmittel
 * @param {number|null} freierCashflow  der letzten zwölf Monate; negativ = Abfluss
 * @returns {{monate: number} | {positiv: true} | null}  null = eine der Zahlen fehlt
 */
export function reichweite(barmittel, freierCashflow) {
    if (!Number.isFinite(barmittel) || !Number.isFinite(freierCashflow) || barmittel < 0) return null
    if (freierCashflow >= 0) return { positiv: true }
    return { monate: barmittel / (-freierCashflow / 12) }
}

/**
 * Insider-Geschäfte der letzten sechs Monate, nach Art gezählt.
 * @param {{zeit: number, art: string, stueck?: number|null, wert?: number|null}[]} liste
 * @returns {{verkaeufe: {anzahl, stueck, wert}, kaeufe: {anzahl, stueck, wert}, bild: 'verkauf'|'kauf'|'gemischt'|'keine'}}
 */
export function insiderBilanz(liste = [], jetzt = Date.now()) {
    const leer = () => ({ anzahl: 0, stueck: 0, wert: 0 })
    const aus = { verkaeufe: leer(), kaeufe: leer() }
    for (const e of liste) {
        if (!(e.zeit > jetzt - INSIDER_FENSTER_TAGE * TAG)) continue
        const ziel = e.art === 'verkauf' ? aus.verkaeufe : e.art === 'kauf' ? aus.kaeufe : null
        if (!ziel) continue
        ziel.anzahl++
        ziel.stueck += Number(e.stueck) || 0
        ziel.wert += Number(e.wert) || 0
    }
    const v = aus.verkaeufe.anzahl, k = aus.kaeufe.anzahl
    return { ...aus, bild: !v && !k ? 'keine' : v && !k ? 'verkauf' : k && !v ? 'kauf' : 'gemischt' }
}

/** Veränderung der leerverkauften Stücke gegen den Vormonat in %, oder null. */
export function shortVeraenderung(jetztStueck, vormonatStueck) {
    return Number.isFinite(jetztStueck) && vormonatStueck > 0 ? (jetztStueck / vormonatStueck - 1) * 100 : null
}
