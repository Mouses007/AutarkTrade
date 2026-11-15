/**
 * Benachrichtigungen des Aktien-Markts (Phase 8, `docs/PLAN-AKTIEN.md`).
 *
 * Drei Ereignisarten, jede im Register von `server/benachrichtigungen.js`
 * einzeln schaltbar und — wie jede Mail der App — ab Werk AUS:
 *
 *   aktienListung    ein Titel ist an einem Handelsplatz neu handelbar
 *   aktienZahlen     Quartalszahlen eines Titels der Aktien-Watchlist stehen an
 *   aktienNewcomer   ein junger Titel hat im Newcomer-Radar eine hohe Note
 *
 * Gemeinsame Regeln:
 *   - nur mit eingeschaltetem Aktien-Modus (`settings.modusAktienAn`);
 *   - geprüft wird erst, wenn die Mail für die Art eingeschaltet und der
 *     Versand eingerichtet ist — vorher geht kein Abruf an eine Fremdquelle
 *     und kein Anspruch wird verbraucht;
 *   - gebündelt: je Anlass EINE Mail, nie eine je Titel;
 *   - jeder Titel wird je Anlass einmal gemeldet (Anspruch in der Datenbank,
 *     bei gescheitertem Versand zurückgegeben).
 *
 * Der obere Teil ist rein (Auswahl und Wortlaut) und im Selbsttest geprüft.
 */
import { getKnex } from '../database.js'
import { beansprucheAufgabe, gibAufgabeFrei } from '../db-claim.js'
import { logWarn } from '../logger.js'
import { zeitzoneAus } from '../../shared/zeitzone.js'
import { MIN_MOMENTUM_TEILE } from '../newcomer-radar/bewertung.js'

/* ── Rein ─────────────────────────────────────────────────────────── */

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const ART = { perp: 'Future', 'token-spot': 'tokenisierte Aktie', 'broker-spot': 'Aktie (Broker)' }
const UNTERART = { etf: 'ETF', vorboerslich: 'vorbörslich' }

/** Höchstens so viele Titel werden in einer Mail einzeln genannt. */
export const MAX_ZEILEN = 30

/** So früh vor dem Termin wird gemeldet. Drei Tage: reicht über ein Wochenende. */
export const ZAHLEN_VORLAUF_MS = 3 * 24 * 3600e3

/** Ab dieser Note meldet der Newcomer-Radar. Bewusst hoch — die Mail soll selten sein. */
export const NEWCOMER_SCHWELLE = 80
/** Nur junge Titel: Börsengang höchstens zwei Jahre her oder frisch an einer unserer Börsen. */
export const NEWCOMER_KATEGORIEN = ['boersengang', 'neuGelistet']
/** Höchstens so viele Newcomer in einer Mail (der erste Lauf fände sonst alle auf einmal). */
export const MAX_NEWCOMER = 10

const platzName = (p) => PLATZ[p] || p
const mehr = (rest) => (rest > 0 ? `\n… und ${rest} weitere.` : '')

/**
 * Neue Listungen → eine Mail. `neu` ist das Feld gleichen Namens aus
 * `speichereStamm`: es enthält nur, was nach einem bereits gefüllten Stamm des
 * Handelsplatzes dazugekommen ist (der erste Abgleich ist die Ausgangslage).
 * Gemeldet werden nur Aktien-Titel (Aktien, ETFs, vorbörsliche Firmen) —
 * Rohstoffe, Devisen und Indizes stehen im Stamm, gehören aber nicht hierher.
 *
 * @returns {{betreff: string, text: string, schluessel: string, anzahl: number}|null}
 */
export function listungsMeldung(neu = []) {
    const liste = neu.filter((l) => l && l.anlageklasse === 'aktien' && l.ticker && l.handelsplatz)
    if (!liste.length) return null
    // Je Titel eine Zeile: NVDA an zwei Börsen ist eine Nachricht, nicht zwei.
    const jeTitel = new Map()
    for (const l of liste) {
        if (!jeTitel.has(l.ticker)) jeTitel.set(l.ticker, { ticker: l.ticker, name: l.name || '', unterart: l.unterart, plaetze: [] })
        jeTitel.get(l.ticker).plaetze.push(`${platzName(l.handelsplatz)} (${ART[l.art] || l.art}${l.wieder ? ', wieder gelistet' : ''})`)
    }
    const titel = [...jeTitel.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))
    const zeilen = titel.slice(0, MAX_ZEILEN).map((t) =>
        `${t.ticker}${t.name ? ` — ${t.name}` : ''}${UNTERART[t.unterart] ? ` [${UNTERART[t.unterart]}]` : ''}: ${[...new Set(t.plaetze)].join(', ')}`)
    const betreff = titel.length === 1
        ? `Neu handelbar: ${titel[0].ticker} bei ${platzName(liste[0].handelsplatz)}`
        : `Neu handelbar: ${titel.length} Aktien-Titel`
    return {
        betreff,
        text: 'Der Abgleich der Handelsplätze hat neue Listungen gefunden:\n\n'
            + zeilen.join('\n') + mehr(titel.length - MAX_ZEILEN)
            + '\n\nEine neue Listung heisst nur: der Titel ist dort jetzt handelbar. '
            + 'Am ersten Tag ist das Orderbuch oft dünn und der Spread weit.',
        schluessel: liste.map((l) => `${l.handelsplatz}:${l.symbol}:${l.art}`).sort().join(','),
        anzahl: titel.length,
    }
}

/**
 * Welche Termine stehen an? Nur künftige innerhalb des Vorlaufs.
 * @param {{ticker: string, name?: string, zeit: number|null, geschaetzt?: boolean}[]} titel
 * @returns dieselben Einträge, nach Zeit aufsteigend, je Ticker einmal
 */
export function faelligeZahlen(titel = [], jetzt = Date.now(), vorlaufMs = ZAHLEN_VORLAUF_MS) {
    const gesehen = new Set()
    return titel
        .filter((t) => t && t.ticker && Number.isFinite(t.zeit) && t.zeit > jetzt && t.zeit - jetzt <= vorlaufMs)
        .sort((a, b) => a.zeit - b.zeit || a.ticker.localeCompare(b.ticker))
        .filter((t) => (gesehen.has(t.ticker) ? false : (gesehen.add(t.ticker), true)))
}

/** Kalendertag eines Termins in New York — der Schlüssel, unter dem er einmal gemeldet wird. */
export function zahlenTag(zeit) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(zeit))
}

/** @returns {{betreff: string, text: string, schluessel: string}|null} */
export function zahlenMeldung(liste = [], zeitzone = 'Europe/Zurich') {
    if (!liste.length) return null
    const format = new Intl.DateTimeFormat('de-CH', { timeZone: zeitzone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const zeilen = liste.slice(0, MAX_ZEILEN).map((t) =>
        `${t.ticker}${t.name ? ` — ${t.name}` : ''}: ${format.format(new Date(t.zeit))}${t.geschaetzt ? ' (Termin geschätzt)' : ''}`)
    return {
        betreff: liste.length === 1
            ? `Quartalszahlen: ${liste[0].ticker} am ${format.format(new Date(liste[0].zeit))}`
            : `Quartalszahlen stehen an: ${liste.length} Titel deiner Watchlist`,
        text: 'Für Titel deiner Aktien-Watchlist stehen Quartalszahlen an:\n\n'
            + zeilen.join('\n') + mehr(liste.length - MAX_ZEILEN)
            + `\n\nZeiten in ${zeitzone}. Die Meldung kommt meist kurz nach Börsenschluss in New York; `
            + 'der Aktien-Future nimmt den Sprung in dünnen Stunden vorweg. Der Termin stammt von der Kursquelle '
            + 'und kann sich verschieben.',
        schluessel: liste.map((t) => `${t.ticker}:${zahlenTag(t.zeit)}`).join(','),
    }
}

/**
 * Newcomer mit hoher Note: zugelassen (keine gerissene Hürde), jung, Note ab
 * der Schwelle, Momentum auf mindestens zwei Teilmassen gemessen. Beste zuerst.
 *
 * Das Letzte hält die allerjüngsten Börsengänge aus der Mail: in den ersten
 * Wochen gibt es weder 3-Monats-Rendite noch 50-Tage-Linie (Audit 15.11.2026,
 * FACH-H-004). Fehlt die Angabe (Stand eines älteren Laufs), wird nicht gemeldet.
 * @param {{ticker, name, note, kategorie, huerden: string[], kennzahlen: {momentumTeile?: number}}[]} titel
 */
export function newcomerKandidaten(titel = [], schwelle = NEWCOMER_SCHWELLE) {
    return titel
        .filter((t) => t && t.ticker && typeof t.note === 'number' && t.note >= schwelle
            && NEWCOMER_KATEGORIEN.includes(t.kategorie) && Array.isArray(t.huerden) && !t.huerden.length
            && Number(t.kennzahlen?.momentumTeile) >= MIN_MOMENTUM_TEILE)
        .sort((a, b) => b.note - a.note || a.ticker.localeCompare(b.ticker))
}

/** @returns {{betreff: string, text: string, schluessel: string}|null} */
export function newcomerMeldung(liste = [], schwelle = NEWCOMER_SCHWELLE) {
    if (!liste.length) return null
    const KAT = { boersengang: 'junger Börsengang', neuGelistet: 'neu handelbar' }
    const gezeigt = liste.slice(0, MAX_NEWCOMER)
    const zeilen = gezeigt.map((t) => {
        const wo = [...new Set((t.listungen || []).map((l) => platzName(l.handelsplatz)))].join(', ')
        return `${t.ticker}${t.name ? ` — ${t.name}` : ''}: Note ${Math.round(t.note)} (${KAT[t.kategorie] || t.kategorie})${wo ? `, handelbar bei ${wo}` : ''}`
    })
    return {
        betreff: liste.length === 1
            ? `Newcomer-Radar: ${liste[0].ticker} mit Note ${Math.round(liste[0].note)}`
            : `Newcomer-Radar: ${liste.length} Titel mit Note ab ${schwelle}`,
        text: `Im letzten Lauf des Newcomer-Radars haben diese jungen Titel eine Note ab ${schwelle} erreicht:\n\n`
            + zeilen.join('\n') + mehr(liste.length - gezeigt.length)
            + '\n\nDie Note misst Neuheit, Momentum und Beteiligung — sie ist ein Anlass hinzusehen, keine Empfehlung. '
            + 'Jeder Titel wird höchstens einmal in dreissig Tagen gemeldet.',
        schluessel: liste.map((t) => t.ticker).sort().join(','),
    }
}

/** Symbole aus gespeicherten Watchlists (Einträge als Text oder `{symbol}`), ohne Doppelte. */
export function watchlistSymbole(zeilen = []) {
    const aus = new Set()
    for (const z of zeilen) {
        let liste = z?.symbole
        if (typeof liste === 'string') { try { liste = JSON.parse(liste) } catch { liste = [] } }
        for (const e of Array.isArray(liste) ? liste : []) {
            const s = String(typeof e === 'string' ? e : e?.symbol || '').toUpperCase().trim()
            if (s) aus.add(s)
        }
    }
    return [...aus]
}

/* ── Mit Datenbank und Versand ────────────────────────────────────── */

const ZAHLEN_PRUEF_MS = 6 * 3600e3      // die Kursquelle sparsam fragen
const ZAHLEN_MAX_TITEL = 40
const ZAHLEN_SPERRE_MS = 45 * 24 * 3600e3
const NEWCOMER_SPERRE_MS = 30 * 24 * 3600e3
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

async function einstellungen() {
    try { return await getKnex()('settings').where('id', 1).first() } catch { return null }
}

/**
 * Soll diese Art überhaupt geprüft werden? Aktien-Modus an, Mail für die Art
 * eingeschaltet, Versand eingerichtet. Liefert die Einstellungen oder null.
 */
async function bereit(id) {
    const s = await einstellungen()
    if (!s || Number(s.modusAktienAn ?? 0) !== 1) return null
    const { kanalWahl, mailKonfigVollstaendig } = await import('../benachrichtigungen.js')
    if (!kanalWahl(s, id).email || !mailKonfigVollstaendig(s)) return null
    return s
}

/** Neue Listungen aus einem Stamm-Abgleich melden. Wirft nie. */
export async function meldeNeueListungen(neu = []) {
    try {
        const m = listungsMeldung(neu)
        if (!m || !(await bereit('aktienListung'))) return false
        const { melde } = await import('../benachrichtigungen.js')
        return await melde('aktienListung', m)
    } catch (e) {
        logWarn('aktien-meldungen', `Neue Listungen: ${e.message}`)
        return false
    }
}

/**
 * Titel einmal je Anlass beanspruchen, melden, bei Fehlschlag zurückgeben.
 * @param {string} id
 * @param {object[]} liste
 * @param {(t: object) => string} schluesselVon
 * @param {(frei: object[]) => object|null} baue  Meldung aus den noch nicht gemeldeten Titeln
 */
async function meldeEinmalig(id, liste, schluesselVon, sperreMs, baue) {
    const frei = []
    for (const t of liste) {
        const k = schluesselVon(t)
        if (await beansprucheAufgabe(k, sperreMs)) frei.push({ t, k })
    }
    const m = baue(frei.map((f) => f.t))
    if (!m) return false
    const { melde } = await import('../benachrichtigungen.js')
    const verschickt = await melde(id, m)
    if (!verschickt) for (const f of frei) await gibAufgabeFrei(f.k)
    return verschickt
}

/**
 * Quartalszahlen der Aktien-Watchlist. Läuft im Benachrichtigungs-Takt,
 * fragt die Kursquelle aber höchstens alle sechs Stunden (die Termine selbst
 * sind zwölf Stunden gemerkt, `termine.js`).
 */
export async function pruefeZahlentermine() {
    const s = await bereit('aktienZahlen')
    if (!s) return false
    const knex = getKnex()
    if (!(await knex.schema.hasTable('instrument_listungen'))) return false
    const { quelleErlaubt } = await import('../quellen/freigabe.js')
    if (!(await quelleErlaubt('yahoo'))) return false

    const symbole = watchlistSymbole(await knex('chart_watchlists').where('anlageklasse', 'aktien').select('symbole'))
    if (!symbole.length) return false
    if (!(await beansprucheAufgabe('aktien_zahlen_pruefung', ZAHLEN_PRUEF_MS))) return false

    // Symbol der Watchlist → Titel des Stamms → Symbol der Kursquelle.
    const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
        .whereIn('l.symbol', symbole.slice(0, 400)).where({ 'l.aktiv': 1, 'i.anlageklasse': 'aktien' })
        .select('i.id', 'i.ticker', 'i.name', 'i.region')
    const titel = [...new Map(zeilen.map((z) => [z.id, z])).values()].slice(0, ZAHLEN_MAX_TITEL)
    if (!titel.length) return false
    const kursSymbole = new Map()
    if (await knex.schema.hasTable('newcomer_titel')) {
        for (const z of await knex('newcomer_titel').whereIn('instrumentId', titel.map((t) => t.id)).select('instrumentId', 'kursSymbol')) {
            kursSymbole.set(z.instrumentId, z)
        }
    }
    const { ladeTermine } = await import('./termine.js')
    const { kursSymbolFuer } = await import('../newcomer-radar/kursquelle-kern.js')
    const mitTermin = []
    for (const t of titel) {
        const kursSymbol = kursSymbolFuer(t, kursSymbole.get(t.id) || null)
        if (!kursSymbol) continue
        const { termine, grund } = await ladeTermine(kursSymbol)
        // Bremst die Quelle oder ist sie aus, hört die Runde auf statt weiterzufragen.
        if (grund === 'gebremst' || grund === 'quelleAus') break
        if (termine?.naechster?.zeit) mitTermin.push({ ticker: t.ticker, name: t.name, zeit: termine.naechster.zeit, geschaetzt: termine.naechster.geschaetzt === true })
        await warte(250)
    }
    const faellig = faelligeZahlen(mitTermin)
    if (!faellig.length) return false
    return meldeEinmalig('aktienZahlen', faellig, (t) => `aktien_zahlen|${t.ticker}|${zahlenTag(t.zeit)}`, ZAHLEN_SPERRE_MS,
        (frei) => zahlenMeldung(frei, zeitzoneAus(s.timeZone)))
}

/**
 * Newcomer mit hoher Note nach einem Lauf des Newcomer-Radars melden.
 * @param {number} seit  nur Titel, deren Stand aus diesem Lauf stammt
 */
export async function meldeNewcomer(seit = 0) {
    try {
        if (!(await bereit('aktienNewcomer'))) return false
        const { leseTitel } = await import('../newcomer-radar/lauf.js')
        const titel = (await leseTitel(getKnex(), { grenze: 200 })).filter((t) => Number(t.stand) >= seit)
        const kandidaten = newcomerKandidaten(titel)
        if (!kandidaten.length) return false
        return await meldeEinmalig('aktienNewcomer', kandidaten, (t) => `aktien_newcomer|${t.ticker}`, NEWCOMER_SPERRE_MS,
            (frei) => newcomerMeldung(frei))
    } catch (e) {
        logWarn('aktien-meldungen', `Newcomer: ${e.message}`)
        return false
    }
}
