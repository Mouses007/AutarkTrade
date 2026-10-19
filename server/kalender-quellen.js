/**
 * Amtliche Wirtschaftskalender — der reine Teil (kein Netz, keine DB).
 *
 * Seit S12 kommt der Kalender nur noch aus Veröffentlichungen von Behörden,
 * deren Bedingungen die Weiterverwendung erlauben (Verkaufs-Prüfung Z. 47/48,
 * alle Fundstellen abgerufen am 19.10.2026):
 *
 *   Fed       https://www.federalreserve.gov/json/calendar.json
 *             Werk einer US-Bundesbehörde, gemeinfrei; die Fed bittet um
 *             Quellenangabe, keine Siegel, keine suggerierte Zugehörigkeit
 *             (https://www.federalreserve.gov/disclaimer.htm).
 *   BEA       https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics
 *             Veröffentlichungstermine des U.S. Bureau of Economic Analysis
 *             (BIP, Einkommen/Ausgaben inkl. PCE, Handelsbilanz). Werk einer
 *             US-Bundesbehörde (17 U.S.C. § 105, kein Urheberrecht); BEA
 *             wünscht Quellenangabe und untersagt den Anschein einer
 *             Empfehlung (https://www.bea.gov/help/guidelines-for-citing-bea).
 *             Gemessen: 166 Termine von 01/2025 bis 12/2027, Zeiten in UTC.
 *   Eurostat  https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=0
 *             Veröffentlichungskalender des Statistischen Amts der EU.
 *             „Reuse of statistical data, metadata … for commercial or
 *             non-commercial purposes is authorised provided the source is
 *             acknowledged"; Änderungen sind kenntlich zu machen, dazu ein
 *             Hinweis, dass Eurostat nicht verantwortlich ist
 *             (https://ec.europa.eu/eurostat/web/main/help/copyright-notice,
 *             Kommissionsbeschluss 2011/833/EU). Gemessen: 2480 Termine, nur
 *             mit Datum ohne Uhrzeit — übernommen wird eine kleine Auswahl der
 *             Euro-Indikatoren (Liste unten), Uhrzeit 11:00 Luxemburger Zeit,
 *             zu der Eurostat die Euro-Indikatoren veröffentlicht. Beides ist
 *             unsere Bearbeitung und wird in der Anzeige so benannt.
 *
 * Geprüft und NICHT eingebaut:
 *   BLS       https://www.bls.gov/schedule/news_release/bls.ics — antwortet
 *             automatischen Abrufen mit HTTP 403 (auch mit Browser-Kennung,
 *             19.10.2026). CPI und Arbeitsmarktbericht fehlen deshalb; ein
 *             Abruf gegen die Sperre wäre genau das, was die Prüfung vermeiden
 *             soll.
 *   EZB       Sitzungs- und Statistikkalender nur als HTML-Seite, kein
 *             maschinenlesbares Format gefunden. Kein Seiten-Zerleger auf Vorrat.
 *
 * Prognosen und Vorwerte liefert keine dieser Quellen — die stammen aus
 * Umfragen unter Volkswirten und sind das, was Bezahlanbieter verkaufen.
 * ForexFactory (bis S12 die Hauptquelle, mit Prognosen) ist entfernt: dessen
 * Kalenderdatenbank darf weder ganz noch teilweise kopiert werden (Z. 47).
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

export const FED_URL = 'https://www.federalreserve.gov/json/calendar.json'
export const BEA_URL = 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics'
export const EUROSTAT_URL = 'https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=0'

/**
 * Pflicht-Quellenangaben je Quelle, für die Anzeige (`Quellenhinweis`).
 * Die Schlüssel sind die Werte in `calendar_events.quelle`.
 */
export const KALENDER_QUELLEN = {
    fed: { name: 'Federal Reserve Board', url: 'https://www.federalreserve.gov/newsevents/calendar.htm', art: 'quelle' },
    bea: { name: 'U.S. Bureau of Economic Analysis', url: 'https://www.bea.gov/news/schedule', art: 'quelle' },
    eurostat: { name: 'Eurostat', url: 'https://ec.europa.eu/eurostat/news/release-calendar', art: 'quelle' },
}

// ── iCalendar ────────────────────────────────────────────────────────────

/** Text-Escapes nach RFC 5545 auflösen. */
function entschaerfe(wert) {
    return String(wert || '')
        .replace(/\\n/gi, ' ')
        .replace(/\\([,;\\])/g, '$1')
        .trim()
}

/**
 * Zeitstempel eines DTSTART lesen.
 *
 * Drei Formen kommen vor: UTC (`…T133000Z`), Ortszeit mit `TZID=…` und reines
 * Datum (`VALUE=DATE`). Ein reines Datum liefert `ganztags: true` und
 * Mitternacht UTC — die Uhrzeit setzt der Aufrufer, der weiss, was sie
 * bedeutet.
 *
 * @returns {{ ms: number, ganztags: boolean }|null}
 */
export function leseIcsZeit(parameter, wert) {
    const w = String(wert || '').trim()
    const tzid = /TZID=([^;:]+)/i.exec(parameter || '')?.[1]
    let m = /^(\d{4})(\d{2})(\d{2})$/.exec(w)
    if (m) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), ganztags: true }
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(w)
    if (!m) return null
    if (m[7] === 'Z') return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), ganztags: false }
    const text = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    const z = tzid ? dayjs.tz(text, 'YYYY-MM-DD HH:mm:ss', tzid) : dayjs.utc(text, 'YYYY-MM-DD HH:mm:ss')
    return z.isValid() ? { ms: z.valueOf(), ganztags: false } : null
}

/**
 * iCalendar-Text → `[{ titel, start, ganztags, kategorien, uid }]`.
 *
 * Bewusst nur das, was ein Veröffentlichungskalender braucht: VEVENT mit
 * SUMMARY und DTSTART. Gefaltete Zeilen (Fortsetzung beginnt mit Leerzeichen
 * oder Tab) werden vorher zusammengesetzt — BEA faltet lange Titel mitten im
 * Wort („Advance Estima\n te").
 */
export function leseIcs(text) {
    const zeilen = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
    const aus = []
    let e = null
    for (const zeile of zeilen) {
        if (zeile === 'BEGIN:VEVENT') { e = {}; continue }
        if (zeile === 'END:VEVENT') {
            if (e?.titel && e.start) aus.push(e)
            e = null
            continue
        }
        if (!e) continue
        const doppel = zeile.indexOf(':')
        if (doppel < 0) continue
        const kopf = zeile.slice(0, doppel)
        const wert = zeile.slice(doppel + 1)
        const [name, ...par] = kopf.split(';')
        const parameter = par.join(';')
        if (name === 'SUMMARY') e.titel = entschaerfe(wert)
        else if (name === 'UID') e.uid = wert.trim()
        else if (name === 'CATEGORIES' || name === 'X-CATEGORY') {
            // Eurostat trennt mit maskiertem Komma („Data release\,Euro indicators release")
            e.kategorien = [...(e.kategorien || []), ...entschaerfe(wert).split(',').map(x => x.trim()).filter(Boolean)]
        } else if (name === 'DTSTART') {
            const z = leseIcsZeit(parameter, wert)
            if (z) { e.start = z.ms; e.ganztags = z.ganztags }
        }
    }
    return aus
}

// ── BEA ──────────────────────────────────────────────────────────────────

/**
 * Bedeutung eines BEA-Termins. Nur die drei Veröffentlichungen, die Märkte
 * erfahrungsgemäss bewegen, stehen höher; Regional- und Strukturdaten sind
 * niedrig (sie bleiben sichtbar, wer den Filter auf „alle" stellt).
 */
export function beaBedeutung(titel) {
    const t = String(titel || '')
    if (/\b(State|States|County|Counties|Metropolitan|Territor|Puerto Rico|Affiliates)\b/i.test(t)) return 'low'
    if (/^(Gross Domestic Product|GDP)\b/i.test(t)) return 'high'
    if (/^Personal Income and Outlays/i.test(t)) return 'high'
    if (/^U\.S\. International Trade in Goods and Services/i.test(t)) return 'medium'
    return 'low'
}

/** BEA-Kalender → Zeilen für `calendar_events` (ohne extId/Zeitstempel). */
export function beaTermine(icsText, { von = -Infinity, bis = Infinity } = {}) {
    return leseIcs(icsText)
        .filter(e => !e.ganztags && e.start >= von && e.start <= bis)
        .map(e => ({ titel: e.titel, land: 'USD', impact: beaBedeutung(e.titel), dateUnix: e.start, quelle: 'bea' }))
}

// ── Eurostat ─────────────────────────────────────────────────────────────

/**
 * Welche Eurostat-Veröffentlichungen übernommen werden, und wie wichtig.
 * Der Kalender hat rund 2500 Einträge im Jahr — Luftverkehr, Asylanträge,
 * Schlachtungen. Für einen Krypto-Händler zählt davon eine Handvoll.
 * Genaue Titel, gemessen am 19.10.2026.
 */
export const EUROSTAT_AUSWAHL = {
    'Flash estimate inflation euro area': 'high',
    'Inflation (HICP)': 'medium',
    'Flash estimate GDP and employment - EU and euro area': 'medium',
    'Preliminary flash estimate GDP - EU and euro area': 'medium',
    'Unemployment': 'medium',
    'GDP main aggregates and employment - update': 'low',
    'Industrial production': 'low',
    'Retail trade': 'low',
    'Industrial producer prices': 'low',
}

/** Euro-Indikatoren erscheinen um 11:00 Uhr Luxemburger Zeit. */
const EUROSTAT_ZEIT = { stunde: 11, zone: 'Europe/Luxembourg' }

/** Eurostat-Kalender → Zeilen für `calendar_events`. */
export function eurostatTermine(icsText, { von = -Infinity, bis = Infinity } = {}) {
    const aus = []
    for (const e of leseIcs(icsText)) {
        const impact = EUROSTAT_AUSWAHL[e.titel]
        if (!impact) continue
        // Gleichnamige „Statistics Explained"-Artikel sind keine
        // Veröffentlichung von Zahlen — nur echte Euro-Indikatoren zählen,
        // und nur für sie gilt die 11-Uhr-Regel.
        if (!(e.kategorien || []).some(k => /euro indicators/i.test(k))) continue
        let ms = e.start
        if (e.ganztags) {
            const tag = new Date(e.start).toISOString().slice(0, 10)
            ms = dayjs.tz(`${tag} ${String(EUROSTAT_ZEIT.stunde).padStart(2, '0')}:00`, 'YYYY-MM-DD HH:mm', EUROSTAT_ZEIT.zone).valueOf()
        }
        if (!Number.isFinite(ms) || ms < von || ms > bis) continue
        aus.push({ titel: e.titel, land: 'EUR', impact, dateUnix: ms, quelle: 'eurostat' })
    }
    return aus
}

// ── Fed ──────────────────────────────────────────────────────────────────

const FED_ZONE = 'America/New_York'
/** Nur was Märkte bewegt. Reden einzelner Mitglieder sind zu zahlreich und zu ungleich gewichtig. */
const FED_ARTEN = { FOMC: 'high', Beige: 'medium' }

/** Fed-`calendar.json` → Zeilen für `calendar_events`. */
export function fedTermine(json, { von = -Infinity, bis = Infinity } = {}) {
    const ereignisse = Array.isArray(json?.events) ? json.events : []
    const aus = []
    for (const e of ereignisse) {
        const stufe = FED_ARTEN[e.type]
        if (!stufe || !e.month || !e.days) continue

        // "9" oder "8-9" — bei mehrtägigen Sitzungen zählt der letzte Tag,
        // denn dann fällt die Entscheidung
        const tag = String(e.days).split('-').pop().trim()

        // "2:00 p.m." → 14:00 New Yorker Ortszeit (Sommer- und Winterzeit inbegriffen)
        const zeitText = String(e.time || '2:00 p.m.').toLowerCase().replace(/[\s.]/g, '')
        const m = zeitText.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
        let stunde = m ? Number(m[1]) % 12 : 14
        const minute = m ? Number(m[2] || 0) : 0
        if (m && m[3] === 'pm') stunde += 12

        const stempel = `${e.month}-${String(tag).padStart(2, '0')} `
            + `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        const zeit = dayjs.tz(stempel, 'YYYY-MM-DD HH:mm', FED_ZONE)
        if (!zeit.isValid()) continue
        const dateUnix = zeit.valueOf()
        if (dateUnix < von || dateUnix > bis) continue

        const titel = String(e.title || e.type).trim()
        if (!titel) continue
        aus.push({ titel, land: 'USD', impact: stufe, dateUnix, quelle: 'fed' })
    }
    return aus
}
