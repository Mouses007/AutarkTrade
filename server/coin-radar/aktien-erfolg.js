/**
 * Erfolgskontrolle des Aktien-Radars (rein — kein Netz, keine Datenbank).
 *
 * Der Coin-Radar verspricht «lässt sich jetzt handeln» und misst deshalb die
 * SPANNE der nächsten Stunden. Der Aktien-Radar verspricht etwas anderes: die
 * Note steht zu 55 % auf Stärke gegen den Index und Nähe zum 52-Wochen-Hoch —
 * Kennzahlen, die über Tage und Wochen wirken, nicht über Minuten. Gemessen
 * wird deshalb die MEHRRENDITE gegen den Index (SPY, sonst QQQ/IVV/VOO —
 * dieselbe Referenz, an der der Lauf die Kopplung misst), über einen Tag, eine
 * Woche und vier Wochen.
 *
 * Wie die Referenz in die Messung kommt: sie wird als eigener Auftrag mit der
 * Gruppe `referenz` angelegt und genau wie jeder Titel gemessen — dasselbe
 * Fenster, dieselben Kerzen der Marktdatenquelle. Keine eigene Spalte, kein
 * zweiter Abruf bei der Auswertung. Ein Lauf ohne gemessene Referenz zählt
 * nur für den Vergleich Spitze gegen Kontrolle (der braucht den Index nicht:
 * er fällt aus der Differenz heraus).
 *
 * Gruppen wie beim Coin-Radar: `spitze` = die obersten 20, `kontrolle` = eine
 * Zufallsstichprobe von 10 aus der unteren Hälfte desselben Laufs.
 *
 * Was die Zahlen NICHT können: Die Fenster überlappen (ein Lauf je Tag, vier
 * Wochen Horizont), die Läufe sind also nicht unabhängig — der p-Wert des
 * Vorzeichentests ist eine Untergrenze. Und das Feld sind die handelbaren
 * Aktien-Futures einer Börse, kein Abbild des Marktes.
 */
import { vorzeichenTest, median, MIN_LAEUFE, P_GRENZE } from '../radar-guete.js'

/** Zufällige Stichprobe ohne Zurücklegen (wie `stichprobe` in `radar-ergebnisse.js`, hier ohne dessen Datenbank-Importe). */
function stichprobe(liste, n, zufall) {
    const kopie = [...liste]
    for (let i = kopie.length - 1; i > 0; i--) {
        const j = Math.floor(zufall() * (i + 1))
        ;[kopie[i], kopie[j]] = [kopie[j], kopie[i]]
    }
    return kopie.slice(0, Math.max(0, n))
}

export const ART_AKTIEN = 'aktienradar'

/**
 * Kalenderzeit, nicht Handelstage: die Futures handeln durch, und sieben
 * Kalendertage enden zur selben Tageszeit desselben Wochentags. Ein
 * Ein-Tages-Fenster aus einem Freitags-Lauf endet am Samstag im dünnen Band —
 * Titel und Referenz trifft das gleich.
 */
export const HORIZONTE_AKTIEN = { '1d': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '28d': 28 * 24 * 3600e3 }

/** Kerzenlänge je Horizont — rund hundert bis zweihundert Kerzen je Messung. */
export const KERZEN_AKTIEN = { '1d': '15m', '7d': '1h', '28d': '4h' }

const VERFOLGT = 20
const KONTROLLE = 10
/** Unter so vielen gemessenen Titeln je Gruppe wird ein Lauf nicht verglichen. */
export const MIN_JE_GRUPPE = 5

const zahl = (w) => (w === null || w === undefined || w === '' ? null : (Number.isFinite(Number(w)) ? Number(w) : null))

/**
 * Wer verfolgt wird. Die Referenz selbst (oft als Future im Feld) gehört in
 * keine der beiden Gruppen — sie gegen sich selbst zu messen ergäbe eine Null,
 * die wie ein Ergebnis aussieht.
 *
 * @param {Array} bewertet  Zeilen eines Laufs, nach Rang aufsteigend
 * @param {string|null} referenzSymbol
 */
export function waehleAktienRadar(bewertet = [], referenzSymbol = null, zufall = Math.random) {
    const feld = bewertet.filter((z) => z.symbol !== referenzSymbol)
    const spitze = feld.slice(0, VERFOLGT)
    const oben = new Set(spitze.map((z) => z.symbol))
    const untereHaelfte = feld.slice(Math.ceil(feld.length / 2)).filter((z) => !oben.has(z.symbol))
    return [
        ...spitze.map((z) => ({ ...z, gruppe: 'spitze' })),
        ...stichprobe(untereHaelfte, KONTROLLE, zufall).map((z) => ({ ...z, gruppe: 'kontrolle' })),
        ...(referenzSymbol ? [{ symbol: referenzSymbol, rang: 0, note: null, noteAusfuehrung: null, atrPct: null, gruppe: 'referenz' }] : []),
    ]
}

const gemessen = (zeilen) => zeilen.filter((z) => z.status === 'gemessen' && zahl(z.renditePct) !== null)

/** Ein Lauf, ein Horizont. */
export function werteAktienLaufAus(zeilen = []) {
    const alle = gemessen(zeilen)
    const referenz = zahl(alle.find((z) => z.gruppe === 'referenz')?.renditePct)
    const spitze = alle.filter((z) => z.gruppe === 'spitze')
    const kontrolle = alle.filter((z) => z.gruppe === 'kontrolle')
    const rendite = (z) => zahl(z.renditePct)
    const medianSpitze = median(spitze.map(rendite))
    const medianKontrolle = median(kontrolle.map(rendite))
    const genugSpitze = spitze.length >= MIN_JE_GRUPPE
    return {
        laufId: zeilen[0]?.laufId ?? null,
        referenzPct: referenz,
        nSpitze: spitze.length,
        nKontrolle: kontrolle.length,
        // Mehrrendite der Spitze gegen den Index — nur mit gemessener Referenz
        mehrrendite: genugSpitze && referenz !== null ? medianSpitze - referenz : null,
        // Anteil der Spitzen-Titel, die den Index geschlagen haben
        vorIndex: genugSpitze && referenz !== null
            ? { k: spitze.filter((z) => rendite(z) > referenz).length, n: spitze.length }
            : null,
        // Spitze gegen Kontrolle — der Index fällt aus der Differenz heraus
        abstand: genugSpitze && kontrolle.length >= MIN_JE_GRUPPE ? medianSpitze - medianKontrolle : null,
        medianMaeSpitze: median(spitze.map((z) => zahl(z.maePct))),
    }
}

export const URTEILE_AKTIEN = {
    zuWenig: 'zuWenig',                 // zu wenige Läufe mit gemessener Referenz
    nichtVorIndex: 'nichtVorIndex',     // die Spitze schlägt den Index im Median nicht
    nichtGesichert: 'nichtGesichert',   // Vorsprung nicht gesichert
    nichtVorKontrolle: 'nichtVorKontrolle', // schlägt den Index, aber nicht die untere Hälfte des eigenen Felds
    traegt: 'traegt',
}

function urteile(a) {
    if (a.laeufeMitReferenz < MIN_LAEUFE) return URTEILE_AKTIEN.zuWenig
    if (!(a.mehrrenditeMedian > 0)) return URTEILE_AKTIEN.nichtVorIndex
    if (!(a.vorzeichenP < P_GRENZE)) return URTEILE_AKTIEN.nichtGesichert
    // Schlägt die Spitze den Index, die untere Hälfte aber auch, liegt es am Feld und nicht an der Note.
    if (a.laeufeMitKontrolle >= MIN_LAEUFE && !(a.abstandMedian > 0)) return URTEILE_AKTIEN.nichtVorKontrolle
    return URTEILE_AKTIEN.traegt
}

/** Die Auswertung eines Horizonts über alle Läufe — erst je Lauf, dann zusammengefasst. */
export function werteAusAktien(zeilen = [], horizont = '') {
    const jeLauf = new Map()
    for (const z of zeilen) {
        const id = z.laufId ?? 0
        if (!jeLauf.has(id)) jeLauf.set(id, [])
        jeLauf.get(id).push(z)
    }
    const laeufe = [...jeLauf.values()].map(werteAktienLaufAus).filter((l) => l.nSpitze > 0)
    const mehr = laeufe.map((l) => l.mehrrendite).filter((w) => w !== null)
    const abstaende = laeufe.map((l) => l.abstand).filter((w) => w !== null)
    const vor = laeufe.map((l) => l.vorIndex).filter(Boolean)
    const k = vor.reduce((s, v) => s + v.k, 0)
    const n = vor.reduce((s, v) => s + v.n, 0)
    const positiv = mehr.filter((w) => w > 0).length
    const negativ = mehr.filter((w) => w < 0).length

    const a = {
        horizont,
        anzahl: gemessen(zeilen).filter((z) => z.gruppe !== 'referenz').length,
        offen: zeilen.filter((z) => z.status === 'offen').length,
        fehlgeschlagen: zeilen.filter((z) => z.status === 'fehlgeschlagen').length,
        laeufe: laeufe.length,
        laeufeMitReferenz: mehr.length,
        laeufeMitKontrolle: abstaende.length,
        mehrrenditeMedian: median(mehr),
        referenzMedian: median(laeufe.map((l) => l.referenzPct)),
        vorIndex: { k, n, wert: n ? k / n : null },
        laeufeVorIndexAnteil: mehr.length ? positiv / mehr.length : null,
        vorzeichenP: vorzeichenTest(positiv, negativ),
        abstandMedian: median(abstaende),
        medianMaeSpitze: median(laeufe.map((l) => l.medianMaeSpitze)),
    }
    a.urteil = urteile(a)
    return a
}
