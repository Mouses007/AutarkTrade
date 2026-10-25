/**
 * Momentum-Alarme des Chart-Arbeitsplatzes — rein, ohne Netz und Datenbank
 * (Selbsttest: `server/__selftest-chart-alarm-momentum.mjs`).
 *
 * Ein Momentum-Alarm meldet die Signalpunkte des Momentum Radar
 * (`momentum-radar.js`, `momentumPunkte`): „nur grosse Punkte" oder „grosse
 * und kleine", optional nur eine Richtung und optional nur Punkte, an denen
 * eine Divergenz endet (`bedingung.divergenz`). Er schaut auf ein Symbol ODER auf
 * eine oder mehrere Watchlists, und das in mehreren Zeiteinheiten zugleich —
 * jede Kombination Symbol × Zeiteinheit ist ein „Paar".
 *
 * Drei Regeln tragen alles:
 *
 *   1. **Nur geschlossene Kerzen.** Ein Punkt auf der laufenden Kerze kann bis
 *      zum Schluss wieder verschwinden; gemeldet wäre er trotzdem. Die Kerzen
 *      kommen schon aus `getClosedCandles`, `nurGeschlossene` schneidet
 *      trotzdem noch einmal nach der Uhr — eine Reihe aus dem Cache, die über
 *      eine Kerzengrenze hinweg gehalten wurde, darf nichts hereinschmuggeln.
 *   2. **Nur die jüngste geschlossene Kerze.** Ein Punkt drei Kerzen zurück ist
 *      keine Neuigkeit; und eine Kerze, die vor mehr als `MAX_VERSPAETUNG_MS`
 *      schloss (Server war aus), wird nicht nachgemeldet — wie beim
 *      Preisalarm nach einer Lücke.
 *   3. **Eine Kerze meldet einmal.** Der Stand des Alarms hält je Paar die
 *      zuletzt GEMELDETE Kerze (`gemeldetBis`); dieselbe Kerze im nächsten
 *      Takt, nach einem Neustart oder in einem anderen Prozess meldet nicht
 *      erneut.
 *
 * Abgefragt wird ein Paar nur, wenn in seiner Zeiteinheit seit der letzten
 * Prüfung eine Kerze geschlossen hat (`faellig`), und erst `VERZUG_MS` nach
 * dem Schluss — die Börse braucht ein paar Sekunden, bis die geschlossene
 * Kerze endgültig ist.
 */
import { momentumPunkte, benoetigteZeitebenen, ZEITEBENEN } from './momentum-radar.js'

/**
 * Wählbare Zeiteinheiten: die Chart-Zeitebenen der Kachel plus Tag und Woche.
 * Auf 1w gibt es keine höhere Zeiteinheit, also nie einen GROSSEN Punkt
 * (`punkteAus`: ohne zählende Zeitebene ist kein Punkt stark) — „nur grosse"
 * auf 1w lehnt die Eingabeprüfung deshalb ab (`OHNE_GROSSE`).
 */
export const MOMENTUM_ZEITEBENEN = ['5m', '15m', '1h', '4h', '1d', '1w']
export const OHNE_GROSSE = ['1w']
export const TF_MS = Object.fromEntries(ZEITEBENEN.map((z) => [z.tf, z.ms]))
export const PUNKTGROESSEN = ['gross', 'alle']
export const MOMENTUM_RICHTUNGEN = ['beide', 'long', 'short']

/** Nach Kerzenschluss so lange warten, bis die Börse die Kerze endgültig liefert. */
export const VERZUG_MS = 15_000
/** Später als das nach dem Kerzenschluss wird nicht mehr gemeldet. */
export const MAX_VERSPAETUNG_MS = 10 * 60_000
/**
 * Kerzen je Zeiteinheit. 300 genügen: die Welle (EMA 9/9/12) ist nach 250
 * Kerzen auf 1e-20 eingeschwungen, der Geldfluss zählt hier nur mit seinem
 * VORZEICHEN (SMA 60), und unter 500 kostet ein Binance-Abruf Gewicht 2 statt 5.
 */
export const KERZEN_JE_ABRUF = 300
export const MIN_KERZEN = 30
/**
 * Höchstens so viele Paare über ALLE Momentum-Alarme. Rechnung fürs Gewicht:
 * zur Tageswende schliessen 5m, 15m, 1h, 4h und 1d zugleich — je Symbol fünf
 * Abrufe à 2, bei 60 Symbolen 600 Gewicht in einer Minute, unter dem eigenen
 * Deckel von 1000 (`binance-takt.js`). Zu jeder Viertelstunde ist es ein
 * Abruf je 15m-Paar.
 */
export const MAX_PAARE = 120
export const MAX_SYMBOLE = 60
export const MAX_WATCHLISTS = 10

/** Montag, 5. Jan. 1970 00:00 UTC — Wochenkerzen beginnen montags, der Epoch war ein Donnerstag. */
const MONTAG = 345_600_000

/** Beginn der laufenden Kerze (5m…1d rasten auf UTC-Epoch, 1w auf Montag 00:00 UTC). */
export function laufendeKerze(tf, jetzt) {
    const ms = TF_MS[tf]
    if (tf === '1w') return Math.floor((jetzt - MONTAG) / ms) * ms + MONTAG
    return Math.floor(jetzt / ms) * ms
}

/** Öffnungszeit der jüngsten geschlossenen Kerze. */
export function letzteGeschlossene(tf, jetzt) {
    return laufendeKerze(tf, jetzt) - TF_MS[tf]
}

/** Ist für dieses Paar seit `geprueftBis` (Öffnungszeit der zuletzt geprüften Kerze) eine neue Kerze geschlossen? */
export function faellig(tf, jetzt, geprueftBis) {
    if (jetzt - laufendeKerze(tf, jetzt) < VERZUG_MS) return false
    return !(Number(geprueftBis) >= letzteGeschlossene(tf, jetzt))
}

/** Nur Kerzen, die zur Zeit `jetzt` geschlossen sind. */
export function nurGeschlossene(kerzen, tf, jetzt) {
    const ms = TF_MS[tf]
    return (kerzen || []).filter((k) => k.t + ms <= jetzt)
}

/**
 * Passt der Punkt zur Bedingung? Bei „nur grosse" zählt ein kleiner Punkt nicht,
 * mit „nur mit Divergenz" einer ohne Divergenz nicht (beides kombinierbar).
 */
export function passtPunkt(bedingung, punkt) {
    if (!punkt) return false
    const groesse = bedingung?.punktgroesse === 'alle' ? 'alle' : 'gross'
    if (groesse === 'gross' && !punkt.stark) return false
    if (bedingung?.divergenz && !punkt.divergenz) return false
    const r = bedingung?.richtung || 'beide'
    return r === 'beide' || r === punkt.seite
}

export const paarSchluessel = (p) => `${p.symbol}|${p.markt}|${p.tf}`

/**
 * Die Paare eines Alarms: Symbole aus dem Alarm selbst oder seinen Watchlists,
 * je mit jeder gewählten Zeiteinheit. Doppelte (ein Symbol in zwei Listen) fallen weg.
 * @param {object} alarm       { symbol, markt, watchlistIds, zeiteinheiten }
 * @param {Map<number, Array<{symbol, markt}>>} watchlists  id → Symbole
 */
export function alarmPaare(alarm, watchlists) {
    const symbole = []
    if (alarm.watchlistIds?.length) {
        for (const id of alarm.watchlistIds) for (const s of watchlists.get(Number(id)) || []) symbole.push(s)
    } else if (alarm.symbol) {
        symbole.push({ symbol: alarm.symbol, markt: alarm.markt })
    }
    const tfs = (alarm.zeiteinheiten || []).filter((tf) => MOMENTUM_ZEITEBENEN.includes(tf))
    const aus = new Map()
    for (const s of symbole) {
        const symbol = String(s?.symbol || '').toUpperCase()
        if (!/^[A-Z0-9]{2,20}$/.test(symbol)) continue
        const markt = s.markt === 'spot' ? 'spot' : 'futures'
        for (const tf of tfs) {
            const p = { symbol, markt, tf }
            aus.set(paarSchluessel(p), p)
        }
    }
    return [...aus.values()]
}

/**
 * Welche Kerzenreihen ein Paar braucht: seine Zeiteinheit und die höheren, die
 * für die Punktstärke zählen. Gleiche Reihen mehrerer Paare teilen einen Abruf
 * (der Kerzenspeicher in `market-data.js` hält sie bis zur nächsten Kerze).
 */
export function reihenFuer(paar) {
    return benoetigteZeitebenen(paar.tf).map((tf) => ({ symbol: paar.symbol, markt: paar.markt, tf }))
}

/**
 * Regeln 2 und 3 für eine geschlossene Reihe: ist ihre letzte Kerze die jüngste
 * geschlossene, nicht zu spät, nach der Anlage und noch nicht gemeldet?
 * Gemeinsam mit den LSOB-Alarmen (`chart-alarm-lsob.js`).
 * @returns {{ letzte: object } | { grund: string, kerzeT?: number }}
 */
export function juengsteKerze({ tf, chart, jetzt, gemeldetBis = 0, abMs = 0, minKerzen = MIN_KERZEN }) {
    if (!chart || chart.length < minKerzen) return { grund: 'zuWenigKerzen' }
    const letzte = chart[chart.length - 1]
    // Die Reihe muss bis zur jüngsten geschlossenen Kerze reichen — sonst ist sie veraltet,
    // und ihr letzter Punkt wäre eine alte Neuigkeit.
    if (letzte.t !== letzteGeschlossene(tf, jetzt)) return { grund: 'veraltet', kerzeT: letzte.t }
    const schluss = letzte.t + TF_MS[tf]
    if (jetzt - schluss > MAX_VERSPAETUNG_MS) return { grund: 'zuSpaet', kerzeT: letzte.t }
    if (schluss < abMs) return { grund: 'vorAnlage', kerzeT: letzte.t }
    if (Number(gemeldetBis) >= letzte.t) return { grund: 'schonGemeldet', kerzeT: letzte.t }
    return { letzte }
}

/**
 * Meldet das Paar auf seiner jüngsten geschlossenen Kerze?
 *
 * @param {object} o
 * @param {object} o.bedingung   { punktgroesse, richtung }
 * @param {string} o.tf          Zeiteinheit des Paars
 * @param {object} o.kerzen      { [tf]: [...] } — die Reihen aus `reihenFuer`
 * @param {number} o.jetzt
 * @param {number} [o.gemeldetBis] Öffnungszeit der zuletzt gemeldeten Kerze dieses Paars
 * @param {number} [o.abMs]      Kerzen, die vorher schlossen, zählen nicht (Anlage/Wiedereinschalten)
 * @returns {{ ausloesen: boolean, grund?: string, kerzeT?: number, punkt?: object, preis?: number }}
 */
export function pruefeMomentum({ bedingung, tf, kerzen, jetzt, gemeldetBis = 0, abMs = 0 }) {
    const ms = TF_MS[tf]
    if (!ms || !MOMENTUM_ZEITEBENEN.includes(tf)) return { ausloesen: false, grund: 'zeiteinheit' }
    const geschlossen = {}
    for (const z of benoetigteZeitebenen(tf)) geschlossen[z] = nurGeschlossene(kerzen?.[z], z, jetzt)
    const lage = juengsteKerze({ tf, chart: geschlossen[tf], jetzt, gemeldetBis, abMs })
    if (lage.grund) return { ausloesen: false, ...lage }
    const letzte = lage.letzte
    const punkte = momentumPunkte({ kerzen: geschlossen, chartTf: tf })
    const p = punkte.length && punkte[punkte.length - 1].t === letzte.t ? punkte[punkte.length - 1] : null
    if (!p) return { ausloesen: false, grund: 'keinPunkt', kerzeT: letzte.t }
    const punkt = { seite: p.seite, stark: p.stark, divergenz: !!p.divergenz, w: Number.isFinite(p.w) ? Math.round(p.w * 10) / 10 : null }
    if (!passtPunkt(bedingung, punkt)) return { ausloesen: false, grund: 'passtNicht', kerzeT: letzte.t, punkt }
    return { ausloesen: true, kerzeT: letzte.t, punkt, preis: letzte.c }
}

/**
 * Stand eines Alarms nach Treffern fortschreiben: je Paar die gemeldete Kerze,
 * Paare, die der Alarm nicht mehr hat, fallen weg (sonst wüchse die Spalte mit
 * jeder Watchlist-Änderung).
 */
export function neuerStand(stand, treffer, paare) {
    const k = { ...(stand?.k || {}) }
    for (const tr of treffer) k[paarSchluessel(tr)] = Math.max(Number(k[paarSchluessel(tr)]) || 0, tr.kerzeT)
    const gueltig = new Set(paare.map(paarSchluessel))
    for (const s of Object.keys(k)) if (!gueltig.has(s)) delete k[s]
    return { ...(stand || {}), k }
}

const SEITE = { long: 'Long', short: 'Short' }
const art = (p) => `${p.stark ? 'grosser' : 'kleiner'} ${SEITE[p.seite]}-Punkt${p.divergenz ? ' mit Divergenz' : ''}`

/** Text einer (gebündelten) Auslösung. */
export function momentumText(alarm, treffer, zahl = String) {
    const zeile = (tr) => `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf}: ${art(tr.punkt)} — ${zahl(tr.preis)}`
    const titel = treffer.length === 1
        ? `Momentum ${treffer[0].symbol} ${treffer[0].tf}: ${art(treffer[0].punkt)}`
        : `Momentum: ${treffer.length} Signale`
    const text = `${treffer.map(zeile).join('\n')}${alarm.notiz ? `\n${alarm.notiz}` : ''}`
    return { titel, text }
}
