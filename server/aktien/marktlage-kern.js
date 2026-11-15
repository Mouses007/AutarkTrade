/**
 * Marktlage für Aktien (Aktien-Integration, `docs/RECHERCHE-AKTIEN.md` C5).
 *
 * Das Gegenstück zu Fear & Greed, Dominanz und Altseason des Krypto-Marktradars
 * — die für Aktien nichts bedeuten. Was hier steht, ist eine BESCHREIBUNG des
 * Umfelds aus Tageskursen, keine Vorhersage:
 *
 *   Index       SPY, QQQ und IWM gegen ihre 200-Tage-Linie. Als Risikofilter
 *               belegt (weniger tiefe Einbrüche), nicht als Renditebringer.
 *   Schwankung  VIX und sein Verhältnis zum Dreimonats-VIX. «Kurzfrist über
 *               Langfrist = Stress» ist Praxiswissen, nicht belegt.
 *   Sektoren    Stärke der elf Sektor-ETFs gegen SPY über einen und drei
 *               Monate (Branchen-Momentum ist belegt).
 *   Zinsen      Rendite zehnjähriger US-Staatsanleihen und der Dollar-Index.
 *   Breite      Anteil der Titel des eigenen Stamms über ihrer 50-Tage-Linie.
 *               NICHT die Marktbreite der Börse — nur das eigene, handelbare Feld.
 *
 * Das Urteil am Ende ist regelbasiert: dieselben Zahlen ergeben immer dasselbe
 * Urteil, und die Gründe stehen dabei. Rein — kein Netz, keine Datenbank.
 *
 * Alle Zahlen sind SCHLUSSKURSE: die Kursquelle liefert nur abgeschlossene
 * Tageskerzen (`ausChart` verwirft den laufenden Tag). `kursStand` sagt
 * deshalb je Block, von welchem Handelstag der letzte Schluss stammt, und ob
 * die reguläre US-Sitzung gerade läuft — dann ist der Markt seit diesen
 * Zahlen weitergelaufen (Audit FACH-H-006).
 */
import { nyTeile, sitzungVon } from '../../shared/aktien-sitzung.js'

const TAGE_MONAT = 21
const TAGE_JAHR = 252
/** VIX-Schwellen: darunter ruhig, darüber angespannt (übliche Praxis-Marken). */
export const VIX_RUHIG = 16
export const VIX_ANGESPANNT = 25

const zahl = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const mittel = (liste) => (liste.length ? liste.reduce((s, x) => s + x, 0) / liste.length : null)
const sma = (kerzen, n, versatz = 0) => {
    const bis = kerzen.length - versatz
    return bis >= n ? mittel(kerzen.slice(bis - n, bis).map((k) => k.c)) : null
}
const rendite = (kerzen, n) => {
    if (kerzen.length <= n) return null
    const alt = kerzen[kerzen.length - 1 - n].c
    return alt > 0 ? (kerzen[kerzen.length - 1].c / alt - 1) * 100 : null
}

/**
 * Lage eines Index (oder ETF) aus Tageskerzen.
 * @param {{t,c,h}[]} kerzen  aufsteigend
 * @returns {null | {kurs, sma50, sma200, ueber50, ueber200, abstand200Pct, linie200: 'steigt'|'faellt'|null,
 *                   perf1m, perf3m, abstandHochPct, stand}}
 */
export function indexLage(kerzen = []) {
    if (kerzen.length < 2) return null
    const kurs = kerzen[kerzen.length - 1].c
    const s50 = sma(kerzen, 50), s200 = sma(kerzen, 200), s200Vor = sma(kerzen, 200, TAGE_MONAT)
    const hoch = Math.max(...kerzen.slice(-TAGE_JAHR).map((k) => k.h ?? k.c))
    return {
        kurs,
        sma50: s50, sma200: s200,
        ueber50: s50 != null ? kurs > s50 : null,
        ueber200: s200 != null ? kurs > s200 : null,
        abstand200Pct: s200 > 0 ? (kurs / s200 - 1) * 100 : null,
        // Richtung der 200-Tage-Linie selbst, gemessen gegen ihren Stand vor einem Monat
        linie200: s200 != null && s200Vor != null ? (s200 > s200Vor ? 'steigt' : 'faellt') : null,
        perf1m: rendite(kerzen, TAGE_MONAT), perf3m: rendite(kerzen, 3 * TAGE_MONAT),
        abstandHochPct: hoch > 0 ? (kurs / hoch - 1) * 100 : null,
        stand: kerzen[kerzen.length - 1].t,
    }
}

/**
 * Schwankung: VIX, sein Rang im letzten Jahr und das Verhältnis zum Dreimonats-VIX.
 * @returns {null | {vix, rangPct, vix3m, verhaeltnis, struktur: 'normal'|'umgekehrt'|null, zone: 'ruhig'|'mittel'|'angespannt'}}
 */
export function schwankung(vixKerzen = [], vix3mKerzen = []) {
    if (!vixKerzen.length) return null
    const vix = vixKerzen[vixKerzen.length - 1].c
    const jahr = vixKerzen.slice(-TAGE_JAHR).map((k) => k.c)
    const darunter = jahr.filter((v) => v < vix).length
    const vix3m = vix3mKerzen.length ? vix3mKerzen[vix3mKerzen.length - 1].c : null
    const verhaeltnis = vix3m > 0 ? vix / vix3m : null
    return {
        vix,
        rangPct: jahr.length > 20 ? (darunter / (jahr.length - 1)) * 100 : null,
        vix3m, verhaeltnis,
        // normal: kurzfristige Schwankung billiger als die der nächsten drei Monate
        struktur: verhaeltnis == null ? null : verhaeltnis > 1 ? 'umgekehrt' : 'normal',
        zone: vix < VIX_RUHIG ? 'ruhig' : vix > VIX_ANGESPANNT ? 'angespannt' : 'mittel',
    }
}

/**
 * Sektoren nach Stärke gegen den Index, stärkster zuerst.
 * @param {{id: string, kerzen: object[]}[]} sektoren
 * @param {object[]} indexKerzen
 * @returns {{id, perf1m, perf3m, rs1m, rs3m, ueber50}[]}  Sektoren ohne Daten fehlen
 */
export function sektorStaerke(sektoren = [], indexKerzen = []) {
    const i1 = rendite(indexKerzen, TAGE_MONAT), i3 = rendite(indexKerzen, 3 * TAGE_MONAT)
    return sektoren.map(({ id, kerzen }) => {
        const p1 = rendite(kerzen || [], TAGE_MONAT), p3 = rendite(kerzen || [], 3 * TAGE_MONAT)
        const s50 = sma(kerzen || [], 50)
        return {
            id, perf1m: p1, perf3m: p3,
            rs1m: p1 != null && i1 != null ? p1 - i1 : null,
            rs3m: p3 != null && i3 != null ? p3 - i3 : null,
            ueber50: s50 != null ? kerzen[kerzen.length - 1].c > s50 : null,
        }
    }).filter((s) => s.rs3m != null || s.rs1m != null)
        .sort((a, b) => (b.rs3m ?? b.rs1m ?? -Infinity) - (a.rs3m ?? a.rs1m ?? -Infinity))
}

/**
 * Zinsen oder Dollar: Stand und Veränderung über einen Monat.
 * @param {object[]} kerzen
 * @param {'punkte'|'prozent'} art  'punkte' = Differenz (Rendite in Prozentpunkten), 'prozent' = relative Änderung
 */
export function standUndAenderung(kerzen = [], art = 'prozent') {
    if (kerzen.length <= TAGE_MONAT) return kerzen.length ? { stand: kerzen[kerzen.length - 1].c, aenderung1m: null } : null
    const jetzt = kerzen[kerzen.length - 1].c, vor = kerzen[kerzen.length - 1 - TAGE_MONAT].c
    return { stand: jetzt, aenderung1m: art === 'punkte' ? jetzt - vor : vor > 0 ? (jetzt / vor - 1) * 100 : null }
}

/**
 * Breite im eigenen Feld: Anteil der Titel über ihrer 50-Tage-Linie.
 * @param {(boolean|null)[]} ueberSma50  je Titel; null zählt nicht
 * @returns {null | {anteilPct, ueber, gezaehlt}}  null bei weniger als 20 Titeln
 */
export function breite(ueberSma50 = []) {
    const bekannt = ueberSma50.filter((x) => x === true || x === false)
    if (bekannt.length < 20) return null
    const ueber = bekannt.filter(Boolean).length
    return { anteilPct: (ueber / bekannt.length) * 100, ueber, gezaehlt: bekannt.length }
}

/**
 * Regelbasiertes Urteil über das Umfeld.
 *
 *   rueckenwind  SPY UND QQQ über einer steigenden 200-Tage-Linie, VIX nicht angespannt
 *   gegenwind    SPY unter der 200-Tage-Linie ODER VIX angespannt mit umgekehrter Struktur
 *   gemischt     alles dazwischen
 *   unbekannt    der Leitindex fehlt
 *
 * @returns {{urteil: string, gruende: {id: string, ton: 'gut'|'schlecht'|'neutral'}[]}}
 */
export function urteile({ spy, qqq, iwm, vola, breiteFeld } = {}) {
    if (!spy || spy.ueber200 == null) return { urteil: 'unbekannt', gruende: [] }
    const g = []
    const fuege = (id, ton) => g.push({ id, ton })
    fuege(spy.ueber200 ? 'spyUeber200' : 'spyUnter200', spy.ueber200 ? 'gut' : 'schlecht')
    if (spy.linie200) fuege(spy.linie200 === 'steigt' ? 'linieSteigt' : 'linieFaellt', spy.linie200 === 'steigt' ? 'gut' : 'schlecht')
    if (qqq?.ueber200 != null) fuege(qqq.ueber200 ? 'qqqUeber200' : 'qqqUnter200', qqq.ueber200 ? 'gut' : 'schlecht')
    if (iwm?.ueber200 != null) fuege(iwm.ueber200 ? 'iwmUeber200' : 'iwmUnter200', iwm.ueber200 ? 'gut' : 'schlecht')
    if (vola) {
        fuege('vix_' + vola.zone, vola.zone === 'ruhig' ? 'gut' : vola.zone === 'angespannt' ? 'schlecht' : 'neutral')
        if (vola.struktur === 'umgekehrt') fuege('vixUmgekehrt', 'schlecht')
    }
    if (breiteFeld) fuege(breiteFeld.anteilPct >= 60 ? 'breiteBreit' : breiteFeld.anteilPct <= 40 ? 'breiteSchmal' : 'breiteMittel',
        breiteFeld.anteilPct >= 60 ? 'gut' : breiteFeld.anteilPct <= 40 ? 'schlecht' : 'neutral')

    const stress = vola?.zone === 'angespannt' && vola.struktur === 'umgekehrt'
    let urteil = 'gemischt'
    if (!spy.ueber200 || stress) urteil = 'gegenwind'
    else if (spy.linie200 === 'steigt' && qqq?.ueber200 === true && vola?.zone !== 'angespannt') urteil = 'rueckenwind'
    return { urteil, gruende: g }
}

/** Handelstag der letzten Tageskerze als `YYYY-MM-DD` (New Yorker Datum); ohne Kerzen `null`. */
export function schlussTag(kerzen = []) {
    const t = kerzen.length ? Number(kerzen[kerzen.length - 1].t) : NaN
    return Number.isFinite(t) && t > 0 ? nyTeile(t).datum : null
}

/**
 * Von wann sind die Zahlen? Je Block der Handelstag des letzten Schlusskurses,
 * dazu die Sitzung, in der `jetzt` liegt.
 *
 * Stehen in einem Block mehrere Reihen (drei Indizes, elf Sektoren), zählt die
 * ÄLTESTE — der Block ist so alt wie sein ältester Wert. Reihen ohne Kerzen
 * zählen nicht (sie stehen schon unter `fehlend`).
 *
 * @param {Record<string, object[][]>} bloecke  Blockname → Kerzenreihen
 * @param {number} jetzt
 * @returns {{schluss: Record<string, string|null>, sitzung: string, sitzungLaeuft: boolean}}
 *          `sitzungLaeuft`: die reguläre US-Sitzung läuft — die Zahlen sind der Schluss davor
 */
export function kursStand(bloecke = {}, jetzt = Date.now()) {
    const schluss = {}
    for (const [name, reihen] of Object.entries(bloecke)) {
        const tage = (reihen || []).map(schlussTag).filter(Boolean).sort()
        schluss[name] = tage[0] ?? null
    }
    return { schluss, ...sitzungsStand(jetzt) }
}

/** Sitzung zu einem Zeitpunkt — getrennt, weil die Lage 30 Minuten im Speicher liegt und die Sitzung inzwischen wechselt. */
export function sitzungsStand(jetzt = Date.now()) {
    const sitzung = sitzungVon(jetzt)
    return { sitzung, sitzungLaeuft: sitzung === 'regulaer' }
}

/** Auf eine Nachkommastelle weniger Rauschen: Zahlen für die Antwort runden (null bleibt null). */
export function runde(x, stellen = 2) {
    return zahl(x) == null ? null : Number(x.toFixed(stellen))
}
