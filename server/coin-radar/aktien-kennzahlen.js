/**
 * Aktien-Radar: was eine Aktie anders gemessen haben will als ein Coin
 * (`docs/RECHERCHE-AKTIEN.md`, 15.11.2026).
 *
 * Der Coin-Radar fragt «bewegt es sich, ist etwas los, trendet es, was kostet
 * das Halten». Für Aktien ist anderes besser belegt und anderes falsch:
 *
 *   Stärke       Rendite über 3, 6 und 12 Monate GEGEN den Index (SPY) — im
 *                Querschnitt die am besten belegte Kennzahl für Aktien. Als
 *                Rang im Feld je Zeitraum, nicht als absolute Zahl: «stärker
 *                als 80 % der handelbaren Titel» ist die Aussage.
 *   Hoch-Nähe    Abstand zum 52-Wochen-Hoch (ebenfalls belegt).
 *   Im Spiel     relatives Volumen — aber gegen DIESELBE Tageszeit. Das
 *                Volumen einer Aktie ist über den Tag U-förmig; ein Vergleich
 *                mit den letzten 20 Kerzen meldet jeden Morgen einen Ausbruch
 *                und jede Nacht Flaute.
 *   Bewegung     ATR % wie beim Coin.
 *   Trend        ADX wie beim Coin, mit kleinem Gewicht.
 *
 * Funding ist KEINE Teilnote mehr: beim Aktien-Future entsteht der Kurs an der
 * echten Börse, Funding sind dort Haltekosten und sagen nichts über die Aktie.
 * Es steht als Kostenzeile neben der Note.
 *
 * Tageskurse kommen von der echten Aktie (Kursquelle), nicht vom Future — den
 * gibt es erst seit Monaten, zwölf Monate Stärke wären sonst nie messbar.
 *
 * Rein — kein Netz, keine Datenbank. Unbekannt bleibt `null` und fällt aus dem
 * Nenner der Note, statt als gut oder schlecht zu zählen.
 */
import { sitzungVon, nyTeile, sitzungenDerKerze, sitzungsRegelAnwendbar } from '../../shared/aktien-sitzung.js'
import { skala, ANKER } from './bewertung.js'
import { MIN_KERZEN } from './kennzahlen.js'

/** Vorgabe-Gewichte der Aktien-Note. Summe 100. */
export const GEWICHTE_AKTIEN = {
    staerke: 35,
    hochNaehe: 20,
    imSpiel: 20,
    bewegung: 15,
    trend: 10,
}

/** Gewichte der Zeiträume in der Stärke. Fehlt einer (junge Firma), verteilt sich sein Anteil auf die übrigen. */
const STAERKE_GEWICHT = { m3: 0.4, m6: 0.3, m12: 0.3 }
/** Ab diesem Abstand zum 52-Wochen-Hoch gibt es keine Punkte mehr. */
const HOCH_FERN_PCT = -30
/** Mindestens so viele Vergleichskerzen derselben Stunde bzw. Sitzung. */
const MIN_PROBEN_STUNDE = 4
const MIN_PROBEN_SITZUNG = 8
/** Sitzungen, in denen die US-Börse geschlossen ist. */
const GESCHLOSSEN = ['wochenende', 'feiertag']
/** Ist weniger als dieser Anteil des Gewichts gemessen, wird die Note gedeckelt. */
export const MIN_GEWICHT_BEKANNT = 60
/** Deckel für Noten, die auf zu wenig Gemessenem stehen. */
export const DECKEL_DUENN = 49

const zahl = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const median = (liste) => {
    const s = [...liste].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Relatives Volumen der letzten Kerze gegen dieselbe Tageszeit.
 *
 * Verglichen wird zuerst mit früheren Kerzen derselben New Yorker Stunde in
 * derselben Sitzung (Dienstag 10 Uhr gegen Montag 10 Uhr, nie gegen Samstag
 * 10 Uhr). Gibt es davon zu wenige — am Wochenende, nach einem Feiertag —,
 * mit allen früheren Kerzen derselben Sitzung. Reicht auch das nicht: `null`.
 * Am Wochenende und an US-Feiertagen gibt es gar keinen Vergleich (`rvol: null`,
 * `basis: 'geschlossen'`).
 * Der Median statt des Mittels, damit ein einzelner Zahlen-Tag den
 * Vergleichswert nicht hebt.
 *
 * @param {{t:number, v:number}[]} kerzen  geschlossene Kerzen, älteste zuerst
 * @returns {{rvol: number|null, basis: 'stunde'|'sitzung'|'geschlossen', proben: number, sitzung: string} | null}
 */
export function rvolTageszeit(kerzen = []) {
    if (kerzen.length < 2) return null
    const letzte = kerzen[kerzen.length - 1]
    const aktuell = zahl(Number(letzte.v))
    if (aktuell == null) return null
    const sitzung = sitzungVon(letzte.t)
    // Bei geschlossener Börse ist der Future so dünn, dass eine Stunde aus
    // einzelnen Trades besteht (gemessen 15.11.2026, LLYUSDT: Median 11 Stück
    // je Stunde, einzelne Stunden 50–100). Ein «5-faches Volumen» ist dort
    // Rauschen — der Vergleich bleibt aus.
    if (GESCHLOSSEN.includes(sitzung)) return { rvol: null, basis: 'geschlossen', proben: 0, sitzung }
    const stunde = Math.floor(nyTeile(letzte.t).minuten / 60)
    const gleicheStunde = [], gleicheSitzung = []
    for (let i = 0; i < kerzen.length - 1; i++) {
        const k = kerzen[i]
        const v = Number(k.v)
        if (!Number.isFinite(v) || sitzungVon(k.t) !== sitzung) continue
        gleicheSitzung.push(v)
        if (Math.floor(nyTeile(k.t).minuten / 60) === stunde) gleicheStunde.push(v)
    }
    const [proben, basis] = gleicheStunde.length >= MIN_PROBEN_STUNDE ? [gleicheStunde, 'stunde']
        : gleicheSitzung.length >= MIN_PROBEN_SITZUNG ? [gleicheSitzung, 'sitzung'] : [null, null]
    if (!proben) return null
    const mitte = median(proben)
    return mitte > 0 ? { rvol: aktuell / mitte, basis, proben: proben.length, sitzung } : null
}

/**
 * Kerzen ohne die Zeit, in der die US-Börse geschlossen ist (Wochenende,
 * Feiertag) — die Reihe, auf der ATR und ADX der Aktien-Note stehen.
 *
 * Der Future läuft am Wochenende weiter, aber flach und dünn. Auf der vollen
 * Reihe fiel der ADX bis Sonntag auf 10 und sprang mit dem Wiederanlauf am
 * Montagfrüh auf 48 — «starker Trend», Teilnote 100, Note 40 → 66 → 42
 * binnen drei Tagen bei unveränderter Aktie (Audit 15.11.2026, FACH-H-013,
 * gemessen an NVDA). Ohne diese Kerzen schliesst Sonntag 20:00 an Freitag
 * 20:00 an; der Sprung dazwischen ist eine echte Kurslücke und bleibt als
 * eine Spanne in der ATR.
 *
 * Eine Kerze fällt nur weg, wenn sie GANZ in geschlossener Zeit liegt (eine
 * 4h-Kerze über Sonntag 20:00 bleibt). Ab Tageskerzen gilt die Regel nicht
 * (`sitzungsRegelAnwendbar`); die Kerzenlänge wird aus der Reihe gelesen.
 *
 * @param {{t:number}[]} kerzen  geschlossene Kerzen, älteste zuerst
 * @returns {{t:number}[]}  dieselben Objekte, gefiltert (oder die Eingabe selbst)
 */
export function ohneGeschlosseneBoerse(kerzen = []) {
    if (!Array.isArray(kerzen) || kerzen.length < 2) return kerzen
    let ivMs = Infinity
    for (let i = 1; i < kerzen.length; i++) {
        const d = Number(kerzen[i].t) - Number(kerzen[i - 1].t)
        if (d > 0 && d < ivMs) ivMs = d
    }
    if (!sitzungsRegelAnwendbar(ivMs)) return kerzen
    return kerzen.filter((k) => !sitzungenDerKerze(Number(k.t), ivMs).every((s) => GESCHLOSSEN.includes(s)))
}

/**
 * Die Reihe für ATR und ADX der Aktien-Note: die Handelskerzen
 * (`ohneGeschlosseneBoerse`) — ausser es bleiben davon zu wenige zum Rechnen.
 *
 * 200 Kerzen 15m sind 50 Stunden. Zwischen Sonntagnachmittag und Montagfrüh
 * (New York) liegen davon weniger als 30 in Handelszeit; ATR und ADX wären
 * leer, und mit 15m als Hauptzeiteinheit fiele jeder Titel mit «keine_kerzen»
 * aus (Review RAS-06). Dann lieber die volle Reihe samt Wochenende — mit
 * `voll: true`, damit der Lauf es kennzeichnet: der ADX steht dann wieder auf
 * dem flachen Wochenende (FACH-H-013).
 *
 * @param {{t:number}[]} kerzen  geschlossene Kerzen, älteste zuerst
 * @param {number} [min]  so viele Kerzen braucht die Rechnung
 * @returns {{kerzen: {t:number}[], voll: boolean}}  `voll` = auf die volle Reihe zurückgefallen
 */
export function handelsKerzen(kerzen = [], min = MIN_KERZEN) {
    const handel = ohneGeschlosseneBoerse(kerzen)
    // Reicht auch die volle Reihe nicht, bleibt es bei den Handelskerzen — es gibt dann ohnehin keinen Wert.
    if (handel === kerzen || handel.length >= min || kerzen.length < min) return { kerzen: handel, voll: false }
    return { kerzen, voll: true }
}

/**
 * Hürde «Mindestens N Kerzen»: hat der Future genug Historie? Gezählt werden
 * die geholten Kerzen der Hauptzeiteinheit (alle, auch die vom Wochenende —
 * die Hürde fragt nach dem Alter der Listung, nicht nach dem Wochentag).
 * Bis 15.11.2026 las niemand den Wert (Audit FUN-F-008).
 */
export function genugKerzen(kerzen, minKerzen) {
    const n = Number(minKerzen)
    return !(n > 0) || (Array.isArray(kerzen) && kerzen.length >= n)
}

/**
 * Mehrrendite gegen den Index je Zeitraum, in Prozentpunkten. Unbekannt bleibt null.
 *
 * @param {{perf3m?, perf6m?, perf12m?}} titel   Renditen der Aktie in %
 * @param {{perf3m?, perf6m?, perf12m?}} index   Renditen des Index in %
 * @returns {{rs3m: number|null, rs6m: number|null, rs12m: number|null}}
 */
export function staerkeGegenIndex(titel = {}, index = {}) {
    const diff = (a, b) => (zahl(a) != null && zahl(b) != null ? a - b : null)
    return { rs3m: diff(titel.perf3m, index.perf3m), rs6m: diff(titel.perf6m, index.perf6m), rs12m: diff(titel.perf12m, index.perf12m) }
}

/**
 * Rang im Feld: 0 = schwächster, 100 = stärkster, Gleichstand teilt sich den
 * mittleren Rang. Unbekannte Werte bekommen `null` und zählen nicht zum Feld.
 * Ein Feld aus einem einzigen Titel hat keinen Rang.
 *
 * @param {(number|null)[]} werte
 * @returns {(number|null)[]}
 */
export function raengeImFeld(werte = []) {
    const bekannt = werte.filter((w) => zahl(w) != null)
    if (bekannt.length < 2) return werte.map(() => null)
    return werte.map((w) => {
        if (zahl(w) == null) return null
        let kleiner = 0, gleich = 0
        for (const b of bekannt) { if (b < w) kleiner++; else if (b === w) gleich++ }
        return ((kleiner + (gleich - 1) / 2) / (bekannt.length - 1)) * 100
    })
}

/**
 * Stärke eines jeden Titels als Zahl 0–100: der Rang im Feld JE ZEITRAUM,
 * danach gewichtet gemittelt (3 Monate 40 %, 6 und 12 Monate je 30 %).
 *
 * Bewusst nicht die Prozentpunkte selbst gewichtet: ein gehebelter ETF mit
 * +300 % über zwölf Monate und −49 % über die letzten drei stünde sonst ganz
 * oben (so gemessen an MUU, 15.11.2026). Im Rang zählt jeder Zeitraum gleich
 * viel, egal wie extrem der Wert ist. Fehlt ein Zeitraum (junge Firma),
 * verteilt sich sein Anteil auf die übrigen.
 *
 * @param {{rs3m, rs6m, rs12m}[]} liste  Ergebnis von `staerkeGegenIndex` je Titel
 * @returns {(number|null)[]}
 */
export function staerkeImFeld(liste = []) {
    const felder = [['rs3m', STAERKE_GEWICHT.m3], ['rs6m', STAERKE_GEWICHT.m6], ['rs12m', STAERKE_GEWICHT.m12]]
    const raenge = felder.map(([feld]) => raengeImFeld(liste.map((x) => x?.[feld] ?? null)))
    return liste.map((_, i) => {
        let summe = 0, gewicht = 0
        felder.forEach(([, g], f) => {
            if (raenge[f][i] == null) return
            summe += raenge[f][i] * g
            gewicht += g
        })
        return gewicht > 0 ? summe / gewicht : null
    })
}

/**
 * Note einer Aktie.
 *
 * @param {object} e
 * @param {{atrPct, adx}} e.kerzen        Kennzahlen der Hauptzeiteinheit (`rechneZeiteinheit`)
 * @param {number|null} e.rvol            relatives Volumen gegen dieselbe Tageszeit
 * @param {number|null} e.staerkeRang     Rang im Feld, 0–100
 * @param {number|null} e.abstandHochPct  Abstand zum 52-Wochen-Hoch in % (≤ 0)
 * @param {object} [gewichte]
 * @returns {{note: number|null, teilnoten: object, hinweise: string[], gewichtBekannt: number, duenn: boolean}}
 *          `gewichtBekannt` = Anteil des Gewichts (0–100), der gemessen werden konnte
 */
export function bewerteAktie(e = {}, gewichte = GEWICHTE_AKTIEN) {
    const g = { ...GEWICHTE_AKTIEN, ...(gewichte || {}) }
    const k = e.kerzen || {}
    const teilnoten = {
        staerke: zahl(e.staerkeRang),
        hochNaehe: zahl(e.abstandHochPct) != null ? skala(e.abstandHochPct, HOCH_FERN_PCT, 0) : null,
        imSpiel: zahl(e.rvol) != null ? skala(e.rvol, 1, ANKER.rvolVoll) : null,
        bewegung: zahl(k.atrPct) != null ? skala(k.atrPct, 0, ANKER.atrPctVoll) : null,
        trend: zahl(k.adx) != null ? skala(k.adx, ANKER.adxUnten, ANKER.adxVoll) : null,
    }
    const hinweise = []
    if (teilnoten.staerke == null) hinweise.push('Stärke unbekannt')
    if (teilnoten.hochNaehe == null) hinweise.push('52-Wochen-Hoch unbekannt')
    if (teilnoten.imSpiel == null) hinweise.push('Volumen zur Tageszeit nicht vergleichbar')

    const gesamt = Object.values(g).reduce((a, b) => a + (Number(b) || 0), 0) || 1
    let summe = 0, bekannt = 0
    for (const [feld, note] of Object.entries(teilnoten)) {
        const gewicht = Number(g[feld]) || 0
        if (note == null || !gewicht) continue
        summe += note * gewicht
        bekannt += gewicht
    }
    const gewichtBekannt = Math.round((bekannt / gesamt) * 100)
    let note = bekannt > 0 ? Math.round(summe / bekannt) : null
    // Steht die Note auf weniger als 60 % des Gewichts (z. B. ohne Tagesdaten),
    // darf sie nicht oben in der Rangliste landen: ein Titel, über den man
    // wenig weiss, ist kein Spitzenkandidat. Gedeckelt, nicht abgewertet.
    const duenn = note != null && gewichtBekannt < MIN_GEWICHT_BEKANNT
    if (duenn && note > DECKEL_DUENN) {
        note = DECKEL_DUENN
        hinweise.push('Note gedeckelt: zu wenig gemessen')
    }
    return { note, teilnoten, hinweise, gewichtBekannt, duenn }
}
