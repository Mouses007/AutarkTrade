/**
 * Börsensitzungen für Aktien-Futures (Aktien-Integration, `docs/RECHERCHE-AKTIEN.md`).
 *
 * Aktien-Futures bei Binance, Bitget und Bitunix handeln rund um die Uhr — der
 * Kurs der Aktie entsteht aber an der US-Börse. Ausserhalb der regulären
 * Sitzung ist der Future dünn (gemessen 15.11.2026, Binance NVDA: am
 * Wochenende etwa ein Zehntel des Stundenvolumens der regulären Sitzung), und
 * was dort passiert, ist ein anderer Markt als um 15:30 Uhr New Yorker Zeit.
 * Ein Wochenend-Filter nach UTC, wie ihn die Krypto-Strategien kennen, trifft
 * das nicht: die Grenze liegt bei 20:00 New Yorker Zeit, samt Sommerzeit und
 * US-Feiertagen.
 *
 * Sitzungen (New Yorker Wanduhr, an Handelstagen):
 *   vor        04:00 – 09:30   vorbörslich
 *   regulaer   09:30 – 16:00
 *   nach       16:00 – 20:00   nachbörslich
 *   nacht      20:00 – 04:00   gehört zum FOLGENDEN Handelstag
 * Ist der Tag, zu dem ein Zeitpunkt gehört, kein Handelstag:
 *   wochenende Freitag 20:00 – Sonntag 20:00
 *   feiertag   US-Börsenfeiertag (ab 20:00 des Vorabends)
 *
 * Der Handelstag beginnt deshalb um 20:00 des Vorabends — dort endet der
 * nachbörsliche Handel, und dort beginnt auch das Tageslimit einer Strategie.
 *
 * Nicht abgebildet: verkürzte Handelstage (Schluss 13:00 vor Thanksgiving-
 * Freitag, Heiligabend) und ausserplanmässige Schliessungen.
 *
 * Rein — kein Netz, keine Datenbank; läuft im Browser und auf dem Server.
 */

export const ZONE = 'America/New_York'
export const SITZUNGEN = ['regulaer', 'vor', 'nach', 'nacht', 'wochenende', 'feiertag']

const MIN = 60_000
const VOR_AB = 4 * 60, REGULAER_AB = 9 * 60 + 30, NACH_AB = 16 * 60, NACHT_AB = 20 * 60

const leser = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})
const WOCHENTAG = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const zwei = (n) => String(n).padStart(2, '0')

/*
 * Die Zeitzonen-Umrechnung ist das Teure. Der Versatz zu UTC ändert sich nur
 * zweimal im Jahr und nie mitten in einer Stunde — er wird deshalb je
 * UTC-Stunde gemerkt (ein Jahreslauf auf 15 Minuten fragt 35 000-mal).
 */
const versatzJeStunde = new Map()
function versatzMin(ms) {
    const stunde = Math.floor(ms / 3_600_000)
    let v = versatzJeStunde.get(stunde)
    if (v === undefined) {
        const t = {}
        for (const p of leser.formatToParts(new Date(stunde * 3_600_000))) t[p.type] = p.value
        const alsUtc = Date.UTC(Number(t.year), Number(t.month) - 1, Number(t.day), Number(t.hour), Number(t.minute))
        v = Math.round((alsUtc - stunde * 3_600_000) / MIN)
        if (versatzJeStunde.size > 200_000) versatzJeStunde.clear()
        versatzJeStunde.set(stunde, v)
    }
    return v
}

/** Zeitpunkt → New Yorker Wanduhr: Datum, Wochentag (0 = Sonntag), Minuten seit Mitternacht. */
export function nyTeile(ms) {
    const d = new Date(ms + versatzMin(ms) * MIN)
    return {
        datum: `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`,
        wochentag: d.getUTCDay(),
        minuten: d.getUTCHours() * 60 + d.getUTCMinutes(),
    }
}

/* ── US-Börsenfeiertage (NYSE/Nasdaq) ─────────────────────────────── */

const tag = (jahr, monat, t) => new Date(Date.UTC(jahr, monat - 1, t))
const alsDatum = (d) => `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`

/** Der n-te Wochentag eines Monats (n = -1: der letzte). */
function nterWochentag(jahr, monat, wochentag, n) {
    if (n > 0) {
        const erster = tag(jahr, monat, 1)
        return tag(jahr, monat, 1 + ((wochentag - erster.getUTCDay() + 7) % 7) + (n - 1) * 7)
    }
    const letzter = tag(jahr, monat + 1, 0)
    return tag(jahr, monat, letzter.getUTCDate() - ((letzter.getUTCDay() - wochentag + 7) % 7))
}

/** Ostersonntag (gregorianisch, Gauss/Butcher). */
function ostern(jahr) {
    const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
    const monat = Math.floor((h + l - 7 * m + 114) / 31)
    return tag(jahr, monat, ((h + l - 7 * m + 114) % 31) + 1)
}

/**
 * Feiertag mit festem Datum, wie die Börse ihn begeht: fällt er auf einen
 * Samstag, ist der Freitag davor geschlossen, bei Sonntag der Montag danach.
 * Ausnahme Neujahr: liegt es auf einem Samstag, bleibt der Freitag (31.12.)
 * ein Handelstag (NYSE-Regel 7.2).
 */
function begangen(jahr, monat, t, { neujahr = false } = {}) {
    const d = tag(jahr, monat, t)
    if (d.getUTCDay() === 6) return neujahr ? null : tag(jahr, monat, t - 1)
    if (d.getUTCDay() === 0) return tag(jahr, monat, t + 1)
    return d
}

const feiertageJeJahr = new Map()

/** Börsenfeiertage eines Jahres als Menge von `YYYY-MM-DD`. */
export function feiertage(jahr) {
    let menge = feiertageJeJahr.get(jahr)
    if (!menge) {
        const karfreitag = new Date(ostern(jahr).getTime() - 2 * 86_400_000)
        menge = new Set([
            begangen(jahr, 1, 1, { neujahr: true }),
            nterWochentag(jahr, 1, 1, 3),          // Martin Luther King
            nterWochentag(jahr, 2, 1, 3),          // Presidents' Day
            karfreitag,
            nterWochentag(jahr, 5, 1, -1),         // Memorial Day
            jahr >= 2022 ? begangen(jahr, 6, 19) : null,   // Juneteenth, Börsenfeiertag seit 2022
            begangen(jahr, 7, 4),
            nterWochentag(jahr, 9, 1, 1),          // Labor Day
            nterWochentag(jahr, 11, 4, 4),         // Thanksgiving
            begangen(jahr, 12, 25),
        ].filter(Boolean).map(alsDatum))
        feiertageJeJahr.set(jahr, menge)
    }
    return menge
}

/** Ist dieser New Yorker Kalendertag ein Handelstag? */
export function istHandelstag(datum, wochentag) {
    return wochentag >= 1 && wochentag <= 5 && !feiertage(Number(datum.slice(0, 4))).has(datum)
}

/* ── Sitzung und Handelstag ───────────────────────────────────────── */

/** Der Kalendertag, zu dem ein Zeitpunkt gehört: ab 20:00 schon der Folgetag. */
function zugehoerigerTag(ms) {
    const jetzt = nyTeile(ms)
    if (jetzt.minuten < NACHT_AB) return { ...jetzt, abend: false }
    const morgen = nyTeile(ms + (24 * 60 - jetzt.minuten) * MIN + 60 * MIN)
    return { datum: morgen.datum, wochentag: morgen.wochentag, minuten: jetzt.minuten, abend: true }
}

/** In welcher Sitzung liegt der Zeitpunkt? Einer aus `SITZUNGEN`. */
export function sitzungVon(ms) {
    const t = zugehoerigerTag(ms)
    if (!istHandelstag(t.datum, t.wochentag)) return t.wochentag === 0 || t.wochentag === 6 ? 'wochenende' : 'feiertag'
    if (t.abend || t.minuten < VOR_AB) return 'nacht'
    if (t.minuten < REGULAER_AB) return 'vor'
    if (t.minuten < NACH_AB) return 'regulaer'
    return 'nach'
}

/** Handelstag eines Zeitpunkts als `YYYY-MM-DD` (ab 20:00 der Folgetag; auch für Wochenend-Tage). */
export function handelstagVon(ms) {
    return zugehoerigerTag(ms).datum
}

/**
 * Beginn des laufenden Handelstags: das letzte 20:00 New Yorker Zeit vor oder
 * auf `ms`. Gegenstück zu `startOfDayUtc` der Krypto-Strategien.
 */
export function handelstagBeginn(ms) {
    const { minuten } = nyTeile(ms)
    const seit = minuten >= NACHT_AB ? minuten - NACHT_AB : minuten + (24 * 60 - NACHT_AB)
    let beginn = Math.floor(ms / MIN) * MIN - seit * MIN
    // Liegt die Zeitumstellung (02:00) dazwischen, ist die Wanduhr um eine Stunde verschoben.
    const kontrolle = nyTeile(beginn).minuten
    if (kontrolle !== NACHT_AB) beginn += (NACHT_AB - kontrolle) * MIN
    return beginn
}

/* ── Stichtage, an denen die Börsen ihre Regeln geändert haben ────── */

/**
 * Vor diesen Tagen handelten die Aktien-Futures am Wochenende nicht frei
 * (eingefrorener Kurs bzw. fester Index). Ein Backtest, der darüber läuft,
 * mischt zwei Märkte. Quellen in `docs/RECHERCHE-AKTIEN.md`; Binance und
 * Bitget aus Sekundärquellen, Bitunix aus der eigenen Hilfe.
 */
export const REGIME_STICHTAGE = {
    bitget: Date.UTC(2026, 1, 7),     // 24/7 statt 24/5
    binance: Date.UTC(2026, 4, 15),   // Index am Wochenende aus dem Orderbuch statt fix
    bitunix: Date.UTC(2026, 7, 14),   // 24/7
}

/** Stichtag der Börse, wenn der Zeitraum ihn überspannt oder ganz davor liegt — sonst null. */
export function regimeWechsel(boerse, von, bis) {
    const stichtag = REGIME_STICHTAGE[boerse]
    if (!stichtag || !(von < stichtag)) return null
    return { boerse, stichtag, ganzDavor: bis <= stichtag }
}

/* ── Auswertung ───────────────────────────────────────────────────── */

/**
 * Ergebnis je Sitzung des EINSTIEGS. Trades ohne `sitzung` zählen nicht.
 * @param {{sitzung?: string, netPnl: number, rMultiple?: number}[]} trades
 * @returns {{sitzung: string, trades: number, gewinner: number, netPnl: number, summeR: number}[]}
 *          nur Sitzungen mit Trades, in der Reihenfolge von `SITZUNGEN`
 */
export function sitzungsBilanz(trades = []) {
    const je = new Map()
    for (const t of trades) {
        if (!t?.sitzung) continue
        let z = je.get(t.sitzung)
        if (!z) { z = { sitzung: t.sitzung, trades: 0, gewinner: 0, netPnl: 0, summeR: 0 }; je.set(t.sitzung, z) }
        z.trades++
        if (t.netPnl > 0) z.gewinner++
        z.netPnl += Number(t.netPnl) || 0
        z.summeR += Number(t.rMultiple) || 0
    }
    return SITZUNGEN.map((s) => je.get(s)).filter(Boolean)
}
