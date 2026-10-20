/**
 * Reine Regeln der Playbook-Seite (Trade-Bewertungen): Eintrag aus den
 * DB-Zeilen bauen, Altformat der Notiz lesen, Bild zum Feld finden, Füllungen
 * gruppieren. Kein Vue-Zustand, kein Netz — damit die Ansicht nur zeichnet und
 * diese Regeln an einer Stelle stehen (Spezifikation `docs/spec/ansichten.md`,
 * Teil „Playbook“, P.3/P.4/P.7/P.8/P.9).
 */
import dayjs from '@/utils/journal/zeit.js'
import { sanitizeHtml } from '@/utils/sanitize.js'

export const FELDER = ['entry', 'trend', 'closing']

/** Welche Notizspalte die Bild-ID eines Feldes trägt. */
export const ID_FELD = { entry: 'screenshotId', trend: 'trendScreenshotId', closing: 'closingScreenshotId' }

export const TRADE_TYPEN = [
    { wert: 'scalp', schluessel: 'incoming.scalptrade' },
    { wert: 'day', schluessel: 'incoming.daytrade' },
    { wert: 'swing', schluessel: 'incoming.swingtrade' },
]

/** Gesetzte, aber leere Notiz: so schreibt das Playbook „nichts“ in `note`. */
export const LEERE_NOTIZ = '<p>-</p>'

// ── Text ──────────────────────────────────────────────────────────────────

/**
 * HTML → reiner Text für Leer-Prüfungen. Gesäubert wird VOR dem Einsetzen,
 * weil das losgelöste Element sonst Bilder laden und Handler auslösen könnte.
 */
export function reinText(html) {
    if (!html) return ''
    const el = document.createElement('div')
    el.innerHTML = sanitizeHtml(html)
    return (el.textContent || '').trim()
}

export const hatText = (html) => reinText(html).length > 0

// ── Altformat der Notiz (P.4) ─────────────────────────────────────────────

// Ein „Absatz“ ist genau <p><strong|b|em|i>Text</…></p> ohne weitere Formatierung.
const fett = (inhalt) => new RegExp(`<p>\\s*<(strong|b)>\\s*${inhalt}\\s*</\\1>\\s*</p>`, 'i')
const kursiv = (inhalt) => new RegExp(`<p>\\s*<(em|i)>\\s*${inhalt}\\s*</\\1>\\s*</p>`, 'i')

const RE_EINSTIEGS_STRESS = fett('Einstiegs-Stresslevel:\\s*(\\d+)\\s*/\\s*\\d+')
const RE_STRESS = fett('Stresslevel:\\s*(\\d+)\\s*/\\s*\\d+')
const RE_AUSSTIEGS_STRESS = fett('Ausstiegs-Stresslevel:\\s*(\\d+)\\s*/\\s*\\d+')
const RE_ZEITRAHMEN = fett('Timeframe:\\s*(\\w+)')
const RE_GRUND = kursiv('Einstiegs-Grund:\\s*([^<]*?)')
const RE_KURSIV = kursiv('([^<]*?)')

const LEERE_RESTE = ['', LEERE_NOTIZ, '<p><br></p>', '<p></p>']

/**
 * Ältere Stände (Incoming → Trade-Verknüpfung) schrieben alles als HTML in
 * `note`. Die Skala hinter „/“ wird ignoriert: alte Stände nutzten /5, der Wert
 * wird trotzdem 1:1 als /10 gezeigt (bewusst so, siehe P.4).
 */
export function leseAltformat(note) {
    const raus = {}
    let rest = String(note || '')
    const schneide = (re) => {
        const m = rest.match(re)
        if (!m) return null
        rest = rest.replace(m[0], '')
        return m
    }
    const m1 = schneide(RE_EINSTIEGS_STRESS)
    if (m1) raus.entryStressLevel = Number(m1[2])
    else {
        // „Stresslevel“ steckt auch in „Ausstiegs-Stresslevel“ — der Absatzanfang
        // in der Regel verhindert, dass es dort trifft.
        const m2 = schneide(RE_STRESS)
        if (m2) raus.entryStressLevel = Number(m2[2])
    }
    schneide(RE_AUSSTIEGS_STRESS)
    const m4 = schneide(RE_ZEITRAHMEN)
    if (m4) raus.timeframe = m4[2]
    const m5 = schneide(RE_GRUND)
    if (m5) raus.entryNote = m5[2]
    const m6 = schneide(RE_KURSIV)
    if (m6) raus.feelings = m6[2]
    const r = rest.trim()
    if (!LEERE_RESTE.includes(r)) raus.playbook = r
    return raus
}

// ── Eintrag aus den Zeilen (P.3) ──────────────────────────────────────────

const ERSATZ_FARBE = '#6c757d'

/** Tag-IDs → {id, name, color}; unbekannte Tags zeigen ihre ID als Namen. */
export function loeseTags(ids, tagInfo) {
    if (!Array.isArray(ids)) return []
    return ids.map(id => {
        const info = tagInfo(id) || {}
        // Unbekannt (nicht im Katalog): ID als Name, neutrales Grau (f3-tags.md §4.2)
        if (info.gruppeId === undefined) return { id, name: String(id), color: ERSATZ_FARBE }
        return { id, name: info.name || String(id), color: info.farbe || ERSATZ_FARBE }
    })
}

const ABSCHLUSS_TEXT = ['closingTradeType', 'closingNote', 'closingFeelings', 'closingTimeframe', 'closingPlaybook', 'closingScreenshotId']
const ABSCHLUSS_ZAHL = ['closingStressLevel', 'closingEmotionLevel']

/**
 * Ein Eintrag je Notiz. `trade`/`tageszeile` dürfen fehlen (Notiz ohne Trade
 * unter den geladenen Tageszeilen): dann ohne Symbol und ohne PnL.
 */
export function baueEintrag({ notiz, trade, tageszeile, zufriedenheit, tagZeile, tagInfo }) {
    const n = notiz
    const leer = !n.feelings && !n.playbook && !Number(n.entryStressLevel)
    const alt = leer && n.note && n.note !== LEERE_NOTIZ ? leseAltformat(n.note) : {}

    const e = {
        noteObjectId: n.objectId ?? null,
        tagRecordObjectId: tagZeile?.objectId ?? null,
        satisfactionObjectId: zufriedenheit?.objectId ?? null,
        dateUnix: n.dateUnix,
        tradeId: n.tradeId,
        tradeType: n.tradeType || '',
        timeframe: n.timeframe || alt.timeframe || '',
        feelings: n.feelings || alt.feelings || '',
        playbook: n.playbook || alt.playbook || '',
        entryNote: n.entryNote || alt.entryNote || '',
        entryStressLevel: Number(n.entryStressLevel) || alt.entryStressLevel || 0,
        emotionLevel: Number(n.emotionLevel) || 0,
        screenshotId: n.screenshotId ? String(n.screenshotId) : '',
        // A-P1 behoben: das zweite Eröffnungsbild hängt an seiner ID, nicht mehr nur am Namen.
        trendScreenshotId: n.trendScreenshotId ? String(n.trendScreenshotId) : '',
        note: n.note || '',
        satisfaction: zufriedenheit && zufriedenheit.satisfaction !== undefined ? zufriedenheit.satisfaction : null,
        tags: loeseTags(tagZeile?.tags, tagInfo),
        closingTags: loeseTags(tagZeile?.closingTags, tagInfo),
        symbol: trade?.symbol || tageszeile?.trades?.[0]?.symbol || '',
        side: trade?.strategy || '',
        pnl: Number(trade?.netProceeds) || Number(trade?.grossProceeds) || 0,
        tradingMetadata: n.tradingMetadata || null,
    }
    for (const f of ABSCHLUSS_TEXT) e[f] = n[f] ? String(n[f]) : ''
    for (const f of ABSCHLUSS_ZAHL) e[f] = Number(n[f]) || 0
    if (e.satisfaction === undefined) e.satisfaction = null
    return e
}

/** Hat der Eintrag eine Bewertung? Bilder und Abschluss-Tags zählen NICHT (P.9). */
export function hatDaten(e) {
    return !!(e.tradeType || e.entryStressLevel > 0 || e.emotionLevel > 0 || e.timeframe
        || e.feelings || hatText(e.playbook) || e.tags.length > 0 || e.satisfaction !== null
        || e.entryNote || e.closingStressLevel > 0 || e.closingEmotionLevel > 0
        || e.closingTimeframe || e.closingFeelings || hatText(e.closingPlaybook) || e.closingNote)
}

/** Seiten-Plakette: Text und ob Long. */
export function seite(side) {
    if (side === 'long' || side === 'B') return { text: 'LONG', long: true }
    if (side === 'short' || side === 'SS' || side === 'S') return { text: 'SHORT', long: false }
    return { text: String(side || ''), long: false }
}

export function typSchluessel(wert) {
    return TRADE_TYPEN.find(t => t.wert === wert)?.schluessel || null
}

// ── Bilder (P.8) ──────────────────────────────────────────────────────────

const istAbschlussbild = (b, e) =>
    (e.closingScreenshotId && String(b.objectId) === String(e.closingScreenshotId)) || String(b.name || '').includes('_closing')

/**
 * Bild zu einem Feld aus der geladenen Liste. Liefert `{bild, regel}`; die
 * Regelnummer sagt, wie sicher der Treffer zum Trade gehört: (1)–(4) tragen die
 * Trade-ID im Namen bzw. sind gespeichert, (5)/(6) raten über Tag/Symbol und
 * können Bilder ANDERER Trades desselben Tages treffen (A-P5) — zum Anzeigen
 * reicht das (Altbestand wird nur so gefunden), zum Löschen und Festschreiben
 * nicht (A-P6).
 */
export function findeBild(e, feld, bilder) {
    const id = String(e.tradeId || '')
    const name = (b) => String(b.name || '')
    const gleich = (b, wert) => wert && String(b.objectId) === String(wert)
    const treffer = (bild, regel) => (bild ? { bild, regel } : null)

    if (feld === 'trend') {
        return treffer(bilder.find(b => gleich(b, e.trendScreenshotId)), 1)
            || treffer(id && bilder.find(b => name(b).includes(id) && name(b).includes('_trend')), 2)
    }
    if (feld === 'closing') {
        return treffer(bilder.find(b => gleich(b, e.closingScreenshotId)), 1)
            || treffer(id && bilder.find(b => name(b).includes(id) && name(b).includes('_closing')), 2)
    }
    // Eröffnung
    const r1 = bilder.find(b => gleich(b, e.screenshotId))
    if (r1) return treffer(r1, 1)
    if (!id) return null
    const kandidaten = bilder.filter(b => !istAbschlussbild(b, e))
    const r2 = bilder.find(b => name(b).includes(id) && name(b).includes('_entry'))
    if (r2) return treffer(r2, 2)
    const r3 = kandidaten.find(b => name(b) === id)
    if (r3) return treffer(r3, 3)
    // `_trend` ausgeschlossen (Empfehlung zu A-P5): das Trendbild hat sein eigenes Feld.
    const r4 = kandidaten.find(b => name(b).includes(id) && !name(b).includes('_trend')
        && !(e.trendScreenshotId && String(b.objectId) === String(e.trendScreenshotId)))
    if (r4) return treffer(r4, 4)
    const r5 = e.symbol && kandidaten.find(b => b.symbol === e.symbol
        && (Number(b.dateUnixDay) === Number(e.dateUnix) || Number(b.dateUnix) === Number(e.dateUnix))
        && !name(b).includes('_trend'))
    if (r5) return treffer(r5, 5)
    const ziffern = id.match(/^t?(\d+)/)?.[1]
    if (ziffern) {
        const r6 = kandidaten.find(b => (name(b).startsWith(`${ziffern}_`) || String(b.dateUnixDay) === ziffern)
            && !name(b).includes('_trend'))
        if (r6) return treffer(r6, 6)
    }
    return null
}

/**
 * Darf dieses Bild beim Entfernen GELÖSCHT werden? Nur über die gespeicherte ID
 * oder den exakten Namen, den das Playbook selbst vergibt (Entscheidung
 * A-P5/A-P6) — sonst träfe ein Kreuz womöglich das Bild eines anderen Trades.
 */
export function darfLoeschen(e, feld, bild) {
    if (!bild) return false
    const gespeichert = e[ID_FELD[feld]]
    if (gespeichert && String(bild.objectId) === String(gespeichert)) return true
    return String(bild.name || '') === `${e.tradeId}_${feld}`
}

/** Darf ein gefundenes Bild beim Speichern als ID festgeschrieben werden? */
export const darfFestschreiben = (treffer) => !!treffer && treffer.regel <= 4

// ── Füllungen (P.7) ───────────────────────────────────────────────────────

const zahl = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
}
const ms = (t) => zahl(t)

export const fuellZeit = (t, zone) => dayjs(ms(t)).tz(zone).format('DD.MM. HH:mm')

/** Hat `tradingMetadata` überhaupt etwas zu zeigen? */
export function hatMetadaten(m) {
    if (!m || typeof m !== 'object') return false
    return (Array.isArray(m.fills) && m.fills.length > 0) || (m.sl != null) || (m.tp != null)
        || !!m.positionSize || (Array.isArray(m.tpslHistory) && m.tpslHistory.length > 0) || !!m.rrr
}

/** Mengengewichteter Durchschnittspreis der Eröffnungsfüllungen, 0 bei Menge 0. */
export function durchschnittEroeffnung(fills) {
    let menge = 0
    let wert = 0
    for (const f of fills || []) {
        if (f.reduceOnly) continue
        menge += zahl(f.qty)
        wert += zahl(f.qty) * zahl(f.price)
    }
    return menge > 0 ? wert / menge : 0
}

/**
 * Aufeinanderfolgende Füllungen derselben Minute (Handelszeitzone) und mit
 * gleichem `reduceOnly` bilden eine Gruppe.
 *
 * Plakette: Die alte Regel verglich die Summe ALLER Schliessungen mit allen
 * Eröffnungen, so hiessen bei einer vollständig geschlossenen Position auch die
 * Teilschliessungen „Schliessung“ (A-P4). Hier wird kumuliert bis zur jeweiligen
 * Gruppe gerechnet — eine Gruppe schliesst erst, wenn bis dahin so viel
 * geschlossen wie eröffnet ist.
 */
export function gruppiereFuellungen(fills, zone, tradeId) {
    const gruppen = []
    for (const f of fills || []) {
        const minute = dayjs(ms(f.time)).tz(zone).format('YYYY-MM-DD HH:mm')
        const letzte = gruppen[gruppen.length - 1]
        if (letzte && letzte.minute === minute && letzte.reduceOnly === !!f.reduceOnly) letzte.fills.push(f)
        else gruppen.push({ minute, reduceOnly: !!f.reduceOnly, fills: [f] })
    }
    let eroeffnet = 0
    let geschlossen = 0
    let davorNurSchliessend = true
    gruppen.forEach((g, i) => {
        const menge = g.fills.reduce((s, f) => s + zahl(f.qty), 0)
        const wert = g.fills.reduce((s, f) => s + zahl(f.qty) * zahl(f.price), 0)
        g.menge = menge
        g.preis = g.fills.length > 1 ? (menge > 0 ? wert / menge : 0) : zahl(g.fills[0].price)
        g.wert = menge * g.preis
        g.gebuehr = g.fills.reduce((s, f) => s + zahl(f.fee), 0)
        g.zeit = fuellZeit(g.fills[0].time, zone)
        // Schlüssel je Trade eindeutig — früher klappten zwei Trades mit
        // Füllungen derselben Minute gemeinsam (P.7, „darf behoben werden“).
        g.schluessel = `${tradeId}|${i}|${g.minute}|${g.reduceOnly ? 'r' : 'o'}`
        if (g.reduceOnly) {
            geschlossen += menge
            g.art = eroeffnet > 0 && geschlossen >= eroeffnet - 1e-12 ? 'close' : 'partialClose'
        } else {
            g.art = davorNurSchliessend ? 'initial' : 'compound'
            eroeffnet += menge
            davorNurSchliessend = false
        }
    })
    return gruppen
}

/** SL/TP-Protokoll: mit Füllungen nur bis 60 s nach der letzten Füllung. */
export function gefiltertesProtokoll(m) {
    const verlauf = Array.isArray(m?.tpslHistory) ? m.tpslHistory : []
    const fills = Array.isArray(m?.fills) ? m.fills : []
    if (fills.length === 0) return verlauf
    const spaetest = Math.max(...fills.map(f => ms(f.time)))
    if (!spaetest) return verlauf
    return verlauf.filter(h => ms(h.time) <= spaetest + 60000)
}

export const fest = (x, stellen) => zahl(x).toFixed(stellen)
