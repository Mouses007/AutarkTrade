/**
 * Preis-, Linien- und Zonenalarme des Chart-Arbeitsplatzes.
 *
 *   CRUD /api/chart/alarme
 *   POST /api/chart/alarme/test     eine Testmeldung über die Push-Kanäle
 *
 * Der Takt läuft alle 5 s — aber nur, wenn es aktive Alarme gibt, und nur in
 * EINEM Prozess: NAS und Testcontainer teilen eine Datenbank, und zwei Takte
 * meldeten jede Kreuzung doppelt. Die Führung (`db-claim.js`) hat eine TTL
 * von 30 s; fällt der Halter aus, übernimmt der andere nach einer halben
 * Minute.
 *
 * Preise kommen als EIN Sammelabruf je Markt (Binance `ticker/price` ohne
 * Symbol, Gewicht 2 bzw. 4; Bitget `tickers`) statt einer Anfrage je Alarm —
 * zwanzig Alarme kosten so dasselbe wie einer. Welche Börse, entscheidet die
 * Marktdatenquelle (`server/marktdaten/`); mit `aus` ruht der Takt und sagt
 * das einmal im Log.
 *
 * Zugestellt wird über die Push-Kanäle des Hype-Radars (ntfy, Telegram,
 * Webhook — eine Stelle für alle Handy-Meldungen) und, wenn in den
 * Benachrichtigungen eingeschaltet, per Mail (`melde('chartAlarm')`). Die
 * Regeln selbst (Kreuzen, Lücke, Sperrfrist) stehen rein in
 * `chart-alarm-regeln.js`.
 *
 * Momentum-Alarme (Art `momentum`, Regeln rein in `chart-alarm-momentum.js`)
 * laufen in einem EIGENEN Takt alle 15 s unter derselben Führung: sie lesen
 * keine Kurse, sondern geschlossene Kerzen, und fragen ein Paar Symbol ×
 * Zeiteinheit nur ab, wenn in seiner Zeiteinheit eine neue Kerze geschlossen
 * hat. Die höheren Zeiteinheiten für die Punktstärke hält der Kerzenspeicher
 * von `getClosedCandles` bis zu ihrer nächsten Kerze — sie kosten also nur
 * dann Gewicht, wenn sie selbst schliessen. Vor jedem Abruf einer frisch
 * geschlossenen Reihe steht `warteAufGewicht` (nur bei Binance).
 *
 * LSOB-Alarme (Art `lsob`, rein in `chart-alarm-lsob.js`: Retest oder neue Box
 * des Indikators „LSOB") laufen im selben Takt nach denselben Regeln —
 * nur mit einer Reihe je Paar, dafür `LSOB_KERZEN` lang.
 *
 * Watchlists und mehrere Zeiteinheiten gibt es NUR für Momentum- und LSOB-Alarme: ein
 * Preis ist an ein Symbol gebunden (65 000 heisst bei SOL nichts), eine
 * Zeichnung liegt auf genau einem Symbol, und Kreuzen prüft der 5-s-Takt am
 * laufenden Kurs — dafür gibt es keine Zeiteinheit.
 */
import { getKnex } from './database.js'
import { beansprucheFuehrung, verlaengereFuehrung } from './db-claim.js'
import { warteAufGewicht } from './binance-takt.js'
import * as marktdaten from './marktdaten/index.js'
import { pruefeAlarm, sperreAbgelaufen, geometrieVorbei, profilSignatur, PROFIL_LINIEN, MIN_SPERRE_MIN } from './chart-alarm-regeln.js'
import {
    pruefeMomentum, faellig, alarmPaare, reihenFuer, neuerStand, momentumText, paarSchluessel, letzteGeschlossene,
    MOMENTUM_ZEITEBENEN, OHNE_GROSSE, MOMENTUM_RICHTUNGEN, PUNKTGROESSEN, KERZEN_JE_ABRUF, MAX_PAARE, MAX_SYMBOLE, MAX_WATCHLISTS,
} from './chart-alarm-momentum.js'
import { pruefeLsob, pruefeLsobBox, boxEingabe, lsobText, lsobParams, LSOB_ZEITEBENEN, LSOB_RICHTUNGEN, LSOB_EREIGNISSE, LSOB_KERZEN } from './chart-alarm-lsob.js'
import { getClosedCandles } from './market-data.js'
import { seitenGewicht } from './marktdaten/binance.js'
import { stelleZu } from './hype-radar/zustellung.js'
import { sendeAnGeraete } from './esp32-push.js'
import { leseEinstellungen } from './hype-radar/einstellungen.js'
import { melde } from './benachrichtigungen.js'
import { logWarn } from './logger.js'

const TAKT_MS = 5000
const FUEHRUNG_KEY = 'chart_alarme'
const FUEHRUNG_TTL_MS = 30_000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const MAX_VERLAUF = 20
const MAX_ALARME = 300

const LINIEN_TYPEN = ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'kanal', 'volprofil']
const ZONEN_TYPEN = ['rechteck', 'kanal']
const RICHTUNGEN = { preis: ['ueber', 'unter', 'kreuzt'], linie: ['ueber', 'unter', 'kreuzt'], zone: ['betreten', 'verlassen'], momentum: MOMENTUM_RICHTUNGEN, lsob: LSOB_RICHTUNGEN }
/** Arten über Symbol ODER Watchlists in mehreren Zeiteinheiten, geprüft je Kerzenschluss. */
const MEHRFACH = ['momentum', 'lsob']

const PREIS_GEWICHT = { futures: 2, spot: 4 }

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

function alarmZeile(r) {
    return {
        id: r.id, symbol: r.symbol, markt: r.markt, art: r.art,
        bedingung: parse(r.bedingung, {}), zeichnungId: r.zeichnungId == null ? null : Number(r.zeichnungId),
        kanaele: parse(r.kanaele, null), einmalig: Number(r.einmalig) === 1, aktiv: Number(r.aktiv) === 1,
        letzterPreis: r.letzterPreis == null ? null : Number(r.letzterPreis), letzteZeit: Number(r.letzteZeit) || 0,
        ausgeloestAm: Number(r.ausgeloestAm) || 0, anzahlAusgeloest: Number(r.anzahlAusgeloest) || 0,
        verlauf: parse(r.verlauf, []), notiz: r.notiz || '', erstelltAm: Number(r.erstelltAm) || 0,
        watchlistIds: parse(r.watchlistIds, []), zeiteinheiten: parse(r.zeiteinheiten, []),
        punktgroesse: r.punktgroesse === 'alle' ? 'alle' : 'gross', stand: parse(r.stand, {}),
    }
}

/**
 * Eingabe prüfen. Ein Linienalarm braucht eine Zeichnung, die eine Linie ist —
 * ein Alarm auf ein Fibonacci-Gitter hätte keine eindeutige Linie und löste
 * nie aus, ohne dass jemand erführe, warum.
 */
async function pruefeEingabe(roh, knex, teilweise = false) {
    const aus = {}
    const mitListen = MEHRFACH.includes(roh.art) && Array.isArray(roh.watchlistIds) && roh.watchlistIds.length > 0
    if (mitListen) {
        aus.symbol = ''   // eine Watchlist-Überwachung hat kein eigenes Symbol
    } else if (!teilweise || roh.symbol !== undefined) {
        const s = String(roh.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(s)) return { fehler: 'symbol ungültig' }
        aus.symbol = s
    }
    if (!teilweise || roh.markt !== undefined) aus.markt = roh.markt === 'spot' ? 'spot' : 'futures'
    const art = teilweise ? roh.art : roh.art
    if (!teilweise || art !== undefined) {
        if (!RICHTUNGEN[art]) return { fehler: `art unbekannt: ${art}` }
        aus.art = art
    }
    if (roh.bedingung !== undefined || !teilweise) {
        const b = roh.bedingung && typeof roh.bedingung === 'object' ? roh.bedingung : {}
        const a = aus.art || roh.art
        const bed = {}
        if (b.richtung !== undefined) {
            if (a && !RICHTUNGEN[a]?.includes(b.richtung)) return { fehler: `richtung ${b.richtung} passt nicht zu ${a}` }
            bed.richtung = b.richtung
        }
        if (a === 'preis') {
            const p = Number(b.preis)
            if (!(p > 0)) return { fehler: 'preis fehlt' }
            bed.preis = p
        }
        if (b.kante !== undefined) bed.kante = ['oben', 'unten', 'mitte', ...PROFIL_LINIEN].includes(b.kante) ? b.kante : 'oben'
        // Volumenprofil: die Höhe, wie der Chart sie zeigte (siehe `profilSignatur`)
        if (b.niveau !== undefined && Number(b.niveau) > 0) bed.niveau = Number(b.niveau)
        if (b.sperreMin !== undefined) bed.sperreMin = Math.max(MIN_SPERRE_MIN, Math.min(10080, Number(b.sperreMin) || 0))
        if (a === 'momentum' && b.divergenz) bed.divergenz = true
        if (a === 'lsob') {
            bed.ereignis = LSOB_EREIGNISSE.includes(b.ereignis) ? b.ereignis : 'retest'
            const params = lsobParams(b.params)
            if (Object.keys(params).length) bed.params = params
            if (b.box != null) {
                const box = boxEingabe(b.box)
                if (!box) return { fehler: 'Box ungültig' }
                bed.box = box
            }
        }
        // „kritisch“ hiess bis 26.10.2026 die oberste Stufe, heute „Trade-Einstieg“
        if (b.schwere !== undefined) bed.schwere = b.schwere === 'kritisch' ? 'einstieg' : ['info', 'warnung', 'einstieg'].includes(b.schwere) ? b.schwere : 'warnung'
        aus.bedingung = JSON.stringify(bed)
    }
    if (!teilweise && (aus.art === 'linie' || aus.art === 'zone')) {
        const id = Number(roh.zeichnungId)
        const z = id ? await knex('chart_zeichnungen').where('id', id).first() : null
        if (!z) return { fehler: 'zeichnung fehlt' }
        const erlaubt = aus.art === 'linie' ? LINIEN_TYPEN : ZONEN_TYPEN
        if (!erlaubt.includes(z.typ)) return { fehler: `ein ${aus.art}-Alarm geht nicht auf ${z.typ}` }
        if (z.symbol !== aus.symbol) return { fehler: 'zeichnung gehört zu einem anderen Symbol' }
        const geo = { ...z, punkte: parse(z.punkte, []), stil: parse(z.stil, {}) }
        if (z.typ === 'volprofil') {
            const bed = parse(aus.bedingung, {})
            if (!PROFIL_LINIEN.includes(bed.kante)) return { fehler: 'Linie des Volumenprofils fehlt (POC, VAH oder VAL)' }
            if (!(bed.niveau > 0)) return { fehler: 'Höhe der Profillinie fehlt' }
            bed.profil = profilSignatur(geo)
            aus.bedingung = JSON.stringify(bed)
        }
        // Eine Linie/Zone, die schon zu Ende ist, kann nie auslösen — sagen statt still anlegen.
        if (geometrieVorbei({ art: aus.art, bedingung: parse(aus.bedingung, {}) }, geo, Date.now())) {
            return { fehler: 'Die Linie bzw. Zone endet vor jetzt — „Fortlaufend" oder „Nach rechts verlängern" einschalten, sonst kann der Alarm nie auslösen' }
        }
        aus.zeichnungId = id
    }
    if (MEHRFACH.includes(aus.art || roh.art)) {
        const m = await pruefeMehrfachFelder(roh, knex, teilweise, aus, aus.art || roh.art)
        if (m.fehler) return m
        Object.assign(aus, m.daten)
    }
    if (roh.kanaele !== undefined) {
        const k = roh.kanaele && typeof roh.kanaele === 'object' ? roh.kanaele : {}
        aus.kanaele = JSON.stringify({ push: k.push !== false, mail: k.mail !== false })
    }
    if (roh.einmalig !== undefined) aus.einmalig = roh.einmalig ? 1 : 0
    if (roh.aktiv !== undefined) aus.aktiv = roh.aktiv ? 1 : 0
    if (roh.notiz !== undefined) aus.notiz = String(roh.notiz || '').slice(0, 300)
    return { daten: aus }
}

/**
 * Felder eines Momentum- oder LSOB-Alarms: Watchlists ODER Symbol, Zeiteinheiten, Punktgrösse (nur Momentum).
 * Die Paare werden schon beim Anlegen gezählt — ein Alarm über mehr Paare, als
 * der Takt je prüft, lief sonst still nur zum Teil.
 */
async function pruefeMehrfachFelder(roh, knex, teilweise, aus, art) {
    const momentum = art === 'momentum'
    const ZEITEN = momentum ? MOMENTUM_ZEITEBENEN : LSOB_ZEITEBENEN
    const daten = {}
    // Nur ausschalten, Notiz oder Kanäle ändern: nichts zu zählen — sonst liesse sich ein Alarm
    // mit geleerter Watchlist nicht einmal mehr abschalten.
    const ziel = ['watchlistIds', 'zeiteinheiten', 'punktgroesse', 'symbol'].some((f) => roh[f] !== undefined)
    if (teilweise && !ziel && roh.aktiv !== true) return { daten }
    if (!teilweise || roh.watchlistIds !== undefined) {
        const ids = [...new Set((Array.isArray(roh.watchlistIds) ? roh.watchlistIds : []).map(Number))]
        if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { fehler: 'watchlistIds ungültig' }
        if (ids.length > MAX_WATCHLISTS) return { fehler: `höchstens ${MAX_WATCHLISTS} Watchlists` }
        if (ids.length) {
            const da = await knex('chart_watchlists').whereIn('id', ids).select('id')
            if (da.length !== ids.length) return { fehler: 'Watchlist nicht gefunden' }
        }
        daten.watchlistIds = JSON.stringify(ids)
        if (ids.length) daten.symbol = ''
    }
    if (!teilweise || roh.zeiteinheiten !== undefined) {
        const tfs = ZEITEN.filter((tf) => (Array.isArray(roh.zeiteinheiten) ? roh.zeiteinheiten : []).includes(tf))
        if (!tfs.length) return { fehler: `mindestens eine Zeiteinheit (${ZEITEN.join(', ')})` }
        daten.zeiteinheiten = JSON.stringify(tfs)
    }
    if (momentum && (!teilweise || roh.punktgroesse !== undefined)) {
        daten.punktgroesse = PUNKTGROESSEN.includes(roh.punktgroesse) ? roh.punktgroesse : 'gross'
    }
    // Paare zählen — mit den Watchlists, wie sie jetzt sind
    const alt = roh.id ? alarmZeile(await knex('chart_alarme').where('id', roh.id).first()) : null
    const tfsJetzt = daten.zeiteinheiten ? JSON.parse(daten.zeiteinheiten) : alt?.zeiteinheiten || []
    const groesseJetzt = daten.punktgroesse || alt?.punktgroesse || 'gross'
    // Alarm auf eine Box: die Box liegt auf einem Symbol in einer Zeiteinheit
    const boxJetzt = aus.bedingung ? parse(aus.bedingung, {}).box : alt?.bedingung?.box
    if (art === 'lsob' && boxJetzt) {
        const ids = daten.watchlistIds ? JSON.parse(daten.watchlistIds) : alt?.watchlistIds || []
        if (ids.length || tfsJetzt.length !== 1) return { fehler: 'Ein Alarm auf eine Box gilt für ein Symbol in einer Zeiteinheit — für Watchlists die Box abwählen' }
    }
    if (momentum && groesseJetzt === 'gross' && tfsJetzt.some((tf) => OHNE_GROSSE.includes(tf))) {
        return { fehler: 'Auf 1w gibt es keine grossen Punkte (keine höhere Zeiteinheit stimmt zu) — eine Wahl ohne „grosse" nehmen oder 1w abwählen' }
    }
    const probe = {
        symbol: daten.symbol ?? aus.symbol ?? alt?.symbol ?? '',
        markt: aus.markt ?? alt?.markt ?? 'futures',
        watchlistIds: daten.watchlistIds ? JSON.parse(daten.watchlistIds) : alt?.watchlistIds || [],
        zeiteinheiten: daten.zeiteinheiten ? JSON.parse(daten.zeiteinheiten) : alt?.zeiteinheiten || [],
    }
    const paare = alarmPaare(probe, await watchlistKarte(knex))
    if (!paare.length) return { fehler: probe.watchlistIds.length ? 'Die gewählten Watchlists sind leer' : 'symbol ungültig' }
    const symbole = new Set(paare.map((x) => `${x.symbol}|${x.markt}`))
    if (paare.length > MAX_PAARE || symbole.size > MAX_SYMBOLE) {
        return { fehler: `Zu viele Paare (${symbole.size} Symbole × Zeiteinheiten = ${paare.length}) — höchstens ${MAX_SYMBOLE} Symbole und ${MAX_PAARE} Paare, sonst reicht das Börsengewicht nicht` }
    }
    return { daten }
}

async function watchlistKarte(knex) {
    return new Map((await knex('chart_watchlists').select('id', 'symbole')).map((w) => [Number(w.id), parse(w.symbole, [])]))
}

// ── Preise ───────────────────────────────────────────────────────────────
// Letzter Sammelabruf je Markt — fürs Anlegen (führt die Quelle das Symbol?) ohne Extraabruf.
// `quelle` gehört dazu: nach einem Wechsel der Marktdatenquelle gilt die alte Karte nicht.
const letztePreise = { futures: { t: 0, karte: null, quelle: null }, spot: { t: 0, karte: null, quelle: null } }

/** Führt die Marktdatenquelle das Symbol? null = unbekannt (kein frischer Abruf, dann nicht ablehnen). */
async function symbolBeiQuelle(symbol, markt) {
    const l = letztePreise[markt]
    try {
        if (!l.karte || l.quelle !== await marktdaten.wahl() || Date.now() - l.t > 10 * 60_000) await holePreise(markt)
    } catch (e) {
        if (marktdaten.istAus(e)) throw e
        return null
    }
    return letztePreise[markt].karte ? letztePreise[markt].karte.has(symbol) : null
}

async function holePreise(markt) {
    const anbieter = await marktdaten.fordere('ticker', { markt })
    // Die Bremse rechnet in Binance-Gewicht — nur dort anstehen. Gewicht und
    // 429/418 meldet der Binance-Anbieter selbst.
    if (anbieter.id === 'binance') await warteAufGewicht(PREIS_GEWICHT[markt])
    const roh = await anbieter.preise({ markt })
    const karte = new Map()
    for (const [sym, p] of roh) if (sym && p > 0) karte.set(sym, p)
    letztePreise[markt] = { t: Date.now(), karte, quelle: anbieter.id }
    return karte
}

// Einmal melden, dass der Takt mangels Marktdaten ruht — alle 5 s dieselbe Zeile wäre Lärm.
let ausGemeldet = false

// ── Meldung ──────────────────────────────────────────────────────────────
function zahl(p) {
    if (!Number.isFinite(p)) return '—'
    const a = Math.abs(p)
    const stellen = a >= 1000 ? 2 : a >= 1 ? 4 : 8
    return Number(p.toFixed(stellen)).toLocaleString('de-CH', { maximumFractionDigits: stellen })
}

const WORT = { ueber: 'steigt über', unter: 'fällt unter', betreten: 'läuft in die Zone', verlassen: 'verlässt die Zone' }
const TYP_NAME = { horizontale: 'Horizontale', strahlH: 'Strahl', trendlinie: 'Trendlinie', strahl: 'Strahl', kanal: 'Kanal', rechteck: 'Zone', volprofil: 'Volumenprofil' }
const PROFIL_NAME = { poc: 'POC', vah: 'VAH', val: 'VAL' }

/** Text einer Auslösung — rein, damit er im Selbsttest der Route mitgeprüft werden kann. */
export function meldungsText(alarm, zeichnung, erg, preis) {
    const was = alarm.art === 'zone'
        ? WORT[alarm.bedingung?.richtung || 'betreten']
        : `${WORT[erg.richtung] || 'kreuzt'} ${zahl(erg.niveau)}`
    const profil = zeichnung?.typ === 'volprofil' && PROFIL_NAME[alarm.bedingung?.kante] ? ` ${PROFIL_NAME[alarm.bedingung.kante]}` : ''
    const wo = alarm.art === 'preis' ? '' : ` (${TYP_NAME[zeichnung?.typ] || 'Zeichnung'}${profil}${zeichnung?.stil?.text ? ` „${zeichnung.stil.text}"` : ''})`
    const markt = alarm.markt === 'spot' ? ' Spot' : ''
    const titel = `${alarm.symbol}${markt} ${was}`
    const text = `${titel}${wo} — jetzt ${zahl(preis)}${alarm.notiz ? `\n${alarm.notiz}` : ''}`
    return { titel, text }
}

/**
 * Zustellen und das Ergebnis zurückgeben — es kommt in den Verlauf des Alarms.
 * Vorher verschwand eine Meldung an einen toten Kanal spurlos (der einmalige
 * Alarm war da schon abgeschaltet), und ein Mailfehler warf aus `melde` heraus
 * und brach den ganzen Takt ab: die übrigen Alarme dieses Takts blieben ungeprüft.
 */
async function melden(alarm, zeichnung, erg, preis, t) {
    const { titel, text } = meldungsText(alarm, zeichnung, erg, preis)
    return stelleMeldungZu(alarm, titel, text, { alarmId: alarm.id, art: alarm.art, symbol: alarm.symbol, preis, niveau: erg.niveau ?? null }, t)
}

async function stelleMeldungZu(alarm, titel, text, daten, t) {
    const kanaele = alarm.kanaele || { push: true, mail: true }
    const zustellung = {}
    if (kanaele.push !== false) {
        try {
            zustellung.push = await stelleZu({
                regel: 'chartAlarm', schwere: (alarm.bedingung?.schwere === 'kritisch' ? 'einstieg' : alarm.bedingung?.schwere) || 'warnung',
                meldung: text, titel, quelle: 'chart', daten,
            }, { symbol: daten.symbol || 'Momentum', chain: alarm.markt }, await leseEinstellungen())
        } catch (e) { logWarn('chart-alarme', `Push: ${e.message}`); zustellung.push = { fehler: e.message } }
    }
    if (kanaele.mail !== false) {
        try {
            zustellung.mail = (await melde('chartAlarm', { betreff: titel, text, schluessel: `${alarm.id}|${t}`, ttlMs: 60_000 })) ? 'ok' : 'nicht verschickt'
        } catch (e) { logWarn('chart-alarme', `Mail: ${e.message}`); zustellung.mail = String(e.message).slice(0, 200) }
    }
    return zustellung
}

/** Wurde die Meldung irgendwo zugestellt? */
function zugestellt(z) {
    if (z.mail === 'ok') return true
    if (Object.values(z.handy || {}).some((v) => v === 'ok')) return true
    return Object.values(z.push || {}).some((v) => v === 'ok')
}

// ── Takt ─────────────────────────────────────────────────────────────────
let taktUhr = null
let laeuft = false
/*
 * Letzte Messung je Alarm im Speicher. In die Datenbank kommt sie nur alle
 * `PERSIST_MS` oder beim Auslösen — vorher schrieb jeder aktive Alarm alle
 * 5 s eine Zeile (20 Alarme ≈ 345 600 Schreibvorgänge am Tag auf die NAS).
 * Übernimmt ein anderer Prozess, setzt er auf dem höchstens eine Minute alten
 * Stand an: eine Kreuzung in dieser Minute meldet er noch, eine Lücke über
 * 10 Minuten setzt neu an (pruefeAlarm).
 */
const PERSIST_MS = 60_000
const messung = new Map()      // alarmId → { p, t, gespeichert }

async function einTakt() {
    if (laeuft) return
    laeuft = true
    try {
        const knex = getKnex()
        const roh = await knex('chart_alarme').where('aktiv', 1).whereNotIn('art', MEHRFACH)
        if (!roh.length) return
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) return
        const alarme = roh.map(alarmZeile)

        const preise = {}
        for (const markt of new Set(alarme.map((a) => a.markt))) {
            try { preise[markt] = await holePreise(markt); ausGemeldet = false } catch (e) {
                if (!marktdaten.istAus(e)) logWarn('chart-alarme', `Preise ${markt}: ${e.message}`)
                else if (!ausGemeldet) { ausGemeldet = true; logWarn('chart-alarme', `Alarme ruhen: ${e.message}`) }
            }
        }

        const ids = [...new Set(alarme.map((a) => a.zeichnungId).filter(Boolean))]
        const zeichnungen = new Map()
        if (ids.length) {
            for (const z of await knex('chart_zeichnungen').whereIn('id', ids)) {
                zeichnungen.set(Number(z.id), { ...z, punkte: parse(z.punkte, []), stil: parse(z.stil, {}) })
            }
        }

        const t = Date.now()
        const aktiveIds = new Set(alarme.map((a) => a.id))
        for (const id of messung.keys()) if (!aktiveIds.has(id)) messung.delete(id)
        for (const a of alarme) {
            const p = preise[a.markt]?.get(a.symbol)
            if (!p) continue
            const z = a.zeichnungId ? zeichnungen.get(a.zeichnungId) : null
            if ((a.art === 'linie' || a.art === 'zone') && !z) {
                // Die Zeichnung ist weg — der Alarm hätte nie wieder etwas zu prüfen.
                await knex('chart_alarme').where('id', a.id).update({ aktiv: 0 })
                continue
            }
            if (z?.typ === 'volprofil' && a.bedingung?.profil !== profilSignatur(z)) {
                // Bereich oder Zeilenzahl geändert: die gemerkte Höhe gilt nicht mehr.
                await knex('chart_alarme').where('id', a.id).update({
                    aktiv: 0, verlauf: JSON.stringify([...a.verlauf, { t, p, hinweis: 'profilGeaendert' }].slice(-MAX_VERLAUF)),
                })
                messung.delete(a.id)
                continue
            }
            if (geometrieVorbei(a, z, t)) {
                // Linie/Zone ohne Verlängerung ist zu Ende: abschalten und sagen, warum —
                // vorher lief der Alarm still weiter und konnte nie mehr auslösen.
                await knex('chart_alarme').where('id', a.id).update({
                    aktiv: 0, verlauf: JSON.stringify([...a.verlauf, { t, p, hinweis: 'geometrieEndet' }].slice(-MAX_VERLAUF)),
                })
                messung.delete(a.id)
                continue
            }
            // Die eigene, frischere Messung vor der gespeicherten — ausser die Datenbank ist neuer
            // (ein anderer Prozess hat geführt), dann deren Stand.
            const m = messung.get(a.id)
            const db = a.letzterPreis != null && a.letzteZeit ? { p: a.letzterPreis, t: a.letzteZeit } : null
            const vorher = m && (!db || m.t >= db.t) ? m : db
            const erg = pruefeAlarm(a, z, vorher, { p, t })
            if (erg.ausloesen && sperreAbgelaufen(a, t)) {
                // Führung vor dem Melden verlängern — ein Takt kann (Gewichtswarten, langsame
                // Kanäle) länger dauern als die TTL, und dann meldete der andere Prozess dasselbe.
                if (!(await verlaengereFuehrung(FUEHRUNG_KEY))) break
                const patch = {
                    letzterPreis: p, letzteZeit: t, ausgeloestAm: t, anzahlAusgeloest: a.anzahlAusgeloest + 1,
                    ...(a.einmalig ? { aktiv: 0 } : {}),
                }
                // Nur melden, wenn niemand die Zeile seit dem Lesen geändert hat.
                const getroffen = await knex('chart_alarme').where({ id: a.id, letzteZeit: a.letzteZeit }).update(patch)
                messung.set(a.id, { p, t, gespeichert: t })
                if (getroffen !== 1) continue
                const { titel, text } = meldungsText(a, z, erg, p)
                const zustellung = await melden(a, z, erg, p, t)
                // Titel und Text stehen mit im Verlauf: das Android-Widget liest Auslösungen
                // über /api/esp32/alarme und soll denselben Wortlaut melden wie ntfy/Telegram.
                const eintrag = { t, p, niveau: erg.niveau ?? null, titel, text, zustellung }
                // Sofort ans Handy (UnifiedPush) — vor dem Verlauf, damit das Ergebnis mit hineinkommt.
                zustellung.handy = await sendeAnGeraete(a, eintrag)
                eintrag.zugestellt = zugestellt(zustellung)
                await knex('chart_alarme').where('id', a.id).update({
                    verlauf: JSON.stringify([...a.verlauf, eintrag].slice(-MAX_VERLAUF)),
                })
            } else {
                const gespeichert = m?.gespeichert || a.letzteZeit || 0
                messung.set(a.id, { p, t, gespeichert })
                if (t - gespeichert >= PERSIST_MS) {
                    await knex('chart_alarme').where('id', a.id).update({ letzterPreis: p, letzteZeit: t })
                    messung.set(a.id, { p, t, gespeichert: t })
                }
            }
        }
    } catch (e) {
        logWarn('chart-alarme', `Takt: ${e.message}`)
    } finally {
        laeuft = false
    }
}

// ── Momentum-Takt ────────────────────────────────────────────────────────
const MOMENTUM_TAKT_MS = 15_000
let momentumUhr = null
let momentumLaeuft = false
let momentumAusGemeldet = false
const geprueftBis = new Map()     // Paar → Öffnungszeit der zuletzt geprüften Kerze
const geholtBis = new Map()       // Reihe → jüngste geschlossene Kerze beim letzten Abruf (fürs Gewicht)
const gewarnt = new Set()         // einmalige Logzeilen (übers Limit, Abruffehler je Reihe)

function warneEinmal(schluessel, text) {
    if (gewarnt.has(schluessel)) return
    if (gewarnt.size > 500) gewarnt.clear()
    gewarnt.add(schluessel)
    logWarn('chart-alarme', text)
}

/**
 * Was je Art anders ist: welche Kerzenreihen ein Paar braucht, wie geprüft und
 * wie gemeldet wird. Momentum braucht die höheren Zeiteinheiten für die
 * Punktstärke (300 Kerzen), LSOB nur die eigene, dafür länger (Boxen leben lange).
 */
const ARTEN = {
    momentum: {
        reihen: (p) => reihenFuer(p).map((r) => ({ ...r, n: KERZEN_JE_ABRUF })),
        pruefe: (a, p, kerzen, jetzt) => {
            const erg = pruefeMomentum({
                bedingung: { ...a.bedingung, punktgroesse: a.punktgroesse }, tf: p.tf, kerzen, jetzt,
                gemeldetBis: a.stand?.k?.[paarSchluessel(p)], abMs: a.stand?.ab || a.erstelltAm,
            })
            return erg.ausloesen ? { ...p, kerzeT: erg.kerzeT, punkt: erg.punkt, preis: erg.preis } : null
        },
        text: (a, treffer) => momentumText(a, treffer, zahl),
        daten: (tr) => ({ symbol: tr.symbol, markt: tr.markt, tf: tr.tf, ...tr.punkt, preis: tr.preis }),
        verlauf: (tr) => ({ symbol: tr.symbol, markt: tr.markt, tf: tr.tf, seite: tr.punkt.seite, stark: tr.punkt.stark, divergenz: tr.punkt.divergenz, preis: tr.preis, kerzeT: tr.kerzeT }),
    },
    lsob: {
        reihen: (p) => [{ symbol: p.symbol, markt: p.markt, tf: p.tf, n: LSOB_KERZEN }],
        pruefe: (a, p, kerzen, jetzt) => {
            const zeit = { tf: p.tf, kerzen, jetzt, gemeldetBis: a.stand?.k?.[paarSchluessel(p)], abMs: a.stand?.ab || a.erstelltAm }
            const erg = a.bedingung?.box
                ? pruefeLsobBox({ box: a.bedingung.box, params: a.bedingung.params, ...zeit })
                : pruefeLsob({ bedingung: a.bedingung, ...zeit })
            if (erg.nurAbschalten) return { nurAbschalten: true }
            return erg.ausloesen ? { ...p, kerzeT: erg.kerzeT, ereignisse: erg.ereignisse, preis: erg.preis, abschalten: !!erg.abschalten } : null
        },
        text: (a, treffer) => lsobText(a, treffer, zahl),
        daten: (tr) => ({ symbol: tr.symbol, markt: tr.markt, tf: tr.tf, ereignisse: tr.ereignisse, preis: tr.preis }),
        // `seite` des ersten Ereignisses für Liste und Sprung; die Ereignisse selbst für den Text
        verlauf: (tr) => ({ symbol: tr.symbol, markt: tr.markt, tf: tr.tf, seite: tr.ereignisse[0].seite, ereignisse: tr.ereignisse.slice(0, 4), preis: tr.preis, kerzeT: tr.kerzeT }),
    },
}
const reiheSchluessel = (r) => `${paarSchluessel(r)}|${r.n}`
const artPaar = (art, p) => `${art}|${paarSchluessel(p)}`

/**
 * Ein Durchgang über alle aktiven Momentum- und LSOB-Alarme (exportiert für
 * Prüfskripte; sonst ruft ihn nur der Takt). Beide prüfen je Kerzenschluss —
 * gleiche Reihen teilen den Abruf, das Paar-Limit gilt über beide zusammen.
 */
export async function momentumTakt() {
    if (momentumLaeuft) return
    momentumLaeuft = true
    try {
        const knex = getKnex()
        const roh = await knex('chart_alarme').where('aktiv', 1).whereIn('art', MEHRFACH).orderBy('id')
        if (!roh.length) return
        const alarme = roh.map(alarmZeile)
        const jetzt = Date.now()
        const listen = await watchlistKarte(knex)

        // Paare je Alarm; über alle Alarme gedeckelt (Gewicht). Gleiche Paare teilen den Abruf.
        const zugelassen = new Map()      // art|paar → { art, paar }
        const symbole = new Set()
        const jeAlarm = []
        for (const a of alarme) {
            const alle = alarmPaare(a, listen)
            if (!alle.length) {
                if (a.watchlistIds.length) {
                    // Watchlists gelöscht oder geleert: abschalten und sagen, warum.
                    await knex('chart_alarme').where('id', a.id).update({
                        aktiv: 0, verlauf: JSON.stringify([...a.verlauf, { t: jetzt, hinweis: 'watchlistLeer' }].slice(-MAX_VERLAUF)),
                    })
                }
                continue
            }
            const eigene = []
            for (const p of alle) {
                const k = artPaar(a.art, p)
                if (!zugelassen.has(k)) {
                    const sk = `${p.symbol}|${p.markt}`
                    if (zugelassen.size >= MAX_PAARE || (!symbole.has(sk) && symbole.size >= MAX_SYMBOLE)) {
                        warneEinmal(`limit|${a.id}|${k}`, `Chart-Alarm ${a.id} (${a.art}): ${paarSchluessel(p)} übersprungen — mehr als ${MAX_PAARE} Paare / ${MAX_SYMBOLE} Symbole über alle Alarme`)
                        continue
                    }
                    zugelassen.set(k, { art: a.art, paar: p })
                    symbole.add(sk)
                }
                eigene.push(p)
            }
            jeAlarm.push({ a, paare: eigene, alle })
        }
        const faellige = [...zugelassen.entries()].filter(([k, { paar }]) => faellig(paar.tf, jetzt, geprueftBis.get(k)))
        // Der Normalfall: keine Zeiteinheit hat eine neue Kerze (eine 5m-Kerze schliesst alle 300 s, der Takt läuft alle 15 s).
        if (!faellige.length) return
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) return

        // Kerzen holen — jede Reihe einmal, Gewicht nur für frisch geschlossene Reihen.
        const quelle = await marktdaten.wahl()
        const reihen = new Map()
        for (const [, { art, paar }] of faellige) {
            for (const r of ARTEN[art].reihen(paar)) {
                const rk = reiheSchluessel(r)
                if (reihen.has(rk)) continue
                try {
                    const neu = letzteGeschlossene(r.tf, jetzt)
                    if (quelle === 'binance' && !(geholtBis.get(rk) >= neu)) await warteAufGewicht(seitenGewicht(r.markt, r.n + 1))
                    reihen.set(rk, await getClosedCandles(r.symbol, r.tf, r.n, { market: r.markt }))
                    geholtBis.set(rk, neu)
                } catch (e) {
                    if (marktdaten.istAus(e)) {
                        if (!momentumAusGemeldet) { momentumAusGemeldet = true; logWarn('chart-alarme', `Momentum-/LSOB-Alarme ruhen: ${e.message}`) }
                        return
                    }
                    reihen.set(rk, null)
                    warneEinmal(`abruf|${rk}|${letzteGeschlossene(r.tf, jetzt)}`, `Chart-Alarm: Kerzen ${rk}: ${e.message}`)
                }
            }
        }
        momentumAusGemeldet = false

        const faelligSet = new Set(faellige.map(([k]) => k))
        const vollstaendig = (art, p) => ARTEN[art].reihen(p).every((r) => reihen.get(reiheSchluessel(r)))
        for (const { a, paare, alle } of jeAlarm) {
            const def = ARTEN[a.art]
            const treffer = []
            let abschalten = false
            for (const p of paare) {
                if (!faelligSet.has(artPaar(a.art, p)) || !vollstaendig(a.art, p)) continue
                const kerzen = Object.fromEntries(def.reihen(p).map((r) => [r.tf, reihen.get(reiheSchluessel(r))]))
                const tr = def.pruefe(a, p, kerzen, jetzt)
                if (tr?.nurAbschalten) abschalten = true
                else if (tr) treffer.push(tr)
            }
            if (!treffer.length) {
                // Box ungültig geworden, ohne dass es eine Kerze gemeldet hätte (Server war aus): still aus.
                if (abschalten) {
                    await knex('chart_alarme').where('id', a.id).update({
                        aktiv: 0, verlauf: JSON.stringify([...a.verlauf, { t: jetzt, hinweis: 'boxUngueltig' }].slice(-MAX_VERLAUF)),
                    })
                }
                continue
            }
            // Führung vor dem Melden verlängern (wie im Preis-Takt) — sonst meldete ein zweiter Prozess dasselbe.
            if (!(await verlaengereFuehrung(FUEHRUNG_KEY))) break
            const t = Date.now()
            const patch = {
                stand: JSON.stringify(neuerStand(a.stand, treffer, alle)),
                letzteZeit: t, ausgeloestAm: t, anzahlAusgeloest: a.anzahlAusgeloest + treffer.length,
                // Box gebrochen: der Alarm hat nichts mehr zu bewachen
                ...(a.einmalig || treffer.some((tr) => tr.abschalten) ? { aktiv: 0 } : {}),
            }
            // Nur melden, wenn niemand die Zeile seit dem Lesen geändert hat (letzteZeit ist der Stempel).
            const getroffen = await knex('chart_alarme').where({ id: a.id, letzteZeit: a.letzteZeit }).update(patch)
            if (getroffen !== 1) continue
            const { titel, text } = def.text(a, treffer)
            const zustellung = await stelleMeldungZu(a, titel, text, {
                alarmId: a.id, art: a.art, symbol: treffer.length === 1 ? treffer[0].symbol : '',
                treffer: treffer.map(def.daten),
            }, t)
            const eintrag = { t, p: treffer[0].preis, titel, text, zustellung, treffer: treffer.slice(0, 20).map(def.verlauf) }
            zustellung.handy = await sendeAnGeraete(a, eintrag)
            eintrag.zugestellt = zugestellt(zustellung)
            await knex('chart_alarme').where('id', a.id).update({ verlauf: JSON.stringify([...a.verlauf, eintrag].slice(-MAX_VERLAUF)) })
        }
        // Geprüft ist ein Paar erst, wenn seine Kerzen da waren — sonst im nächsten Takt nochmal.
        for (const [k, { art, paar }] of faellige) if (vollstaendig(art, paar)) geprueftBis.set(k, letzteGeschlossene(paar.tf, jetzt))
        if (geprueftBis.size > 4 * MAX_PAARE) {
            for (const k of geprueftBis.keys()) if (!zugelassen.has(k)) geprueftBis.delete(k)
        }
    } catch (e) {
        logWarn('chart-alarme', `Momentum-/LSOB-Takt: ${e.message}`)
    } finally {
        momentumLaeuft = false
    }
}

export function startChartAlarmTakt() {
    if (taktUhr) return
    taktUhr = setInterval(einTakt, TAKT_MS)
    momentumUhr = setInterval(momentumTakt, MOMENTUM_TAKT_MS)
}

export function stopChartAlarmTakt() {
    clearInterval(taktUhr)
    clearInterval(momentumUhr)
    taktUhr = null
    momentumUhr = null
}

// ── Routen ───────────────────────────────────────────────────────────────
export function setupChartAlarmRoutes(app) {
    app.get('/api/chart/alarme', async (req, res) => {
        try {
            let q = getKnex()('chart_alarme').orderBy('id', 'desc')
            const symbol = String(req.query.symbol || '').toUpperCase()
            if (symbol) q = q.where('symbol', symbol)
            res.json((await q.limit(MAX_ALARME)).map(alarmZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/alarme', async (req, res) => {
        try {
            const knex = getKnex()
            const { fehler, daten } = await pruefeEingabe(req.body || {}, knex)
            if (fehler) return res.status(400).json({ error: fehler })
            // Die Alarme laufen auf den Kursen der Marktdatenquelle; ein Symbol, das sie nicht
            // führt (nur Bitunix), käme im Takt nie an — sagen statt still nie auslösen.
            // Ohne Marktdaten gar nicht anlegen: der Alarm könnte nie auslösen.
            // Eine Watchlist-Überwachung hat kein eigenes Symbol; ihre Symbole kommen aus dem Chart,
            // der dieselbe Quelle liest — fehlt eines, sagt es der Takt einmal im Log.
            let gefuehrt = null
            if (daten.symbol) try { gefuehrt = await symbolBeiQuelle(daten.symbol, daten.markt) } catch (e) {
                if (marktdaten.sendeWennAus(res, e)) return
                throw e
            }
            if (gefuehrt === false) {
                const quelle = letztePreise[daten.markt].quelle === 'bitget' ? 'Bitget' : 'Binance'
                return res.status(400).json({ error: `${daten.symbol} gibt es bei ${quelle} ${daten.markt === 'spot' ? 'Spot' : 'Futures'} nicht — die Alarme laufen auf ${quelle}-Kursen` })
            }
            const momentum = MEHRFACH.includes(daten.art)
            const [zeile] = await knex('chart_alarme').insert({
                // Ein Momentum-Alarm über eine Watchlist soll weiterlaufen; je Kerze meldet er ohnehin nur einmal.
                einmalig: momentum ? 0 : 1, aktiv: 1, kanaele: JSON.stringify({ push: true, mail: true }),
                ...(momentum ? { stand: JSON.stringify({ ab: Date.now(), k: {} }) } : {}),
                ...daten, erstelltAm: Date.now(),
            }).returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            res.json(alarmZeile(await knex('chart_alarme').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/alarme/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ungültige id' })
            const knex = getKnex()
            const alt = await knex('chart_alarme').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Alarm nicht gefunden' })
            const { fehler, daten } = await pruefeEingabe({ ...req.body, art: alt.art, id }, knex, true)
            if (fehler) return res.status(400).json({ error: fehler })
            delete daten.art
            // Volumenprofil: Höhe und Signatur stammen vom Anlegen — ein Ändern von Dringlichkeit
            // oder Sperrfrist schickt sie nicht mit und darf sie nicht löschen.
            if (daten.bedingung && alt.art === 'linie') {
                const altB = parse(alt.bedingung, {})
                if (altB.profil) daten.bedingung = JSON.stringify({ ...JSON.parse(daten.bedingung), niveau: altB.niveau, profil: altB.profil, kante: altB.kante })
            }
            // Wieder eingeschaltet: neu ansetzen. Der gespeicherte Preis ist
            // womöglich Tage alt, und ein Vergleich damit wäre eine Kreuzung,
            // die niemand gesehen hat.
            if (daten.aktiv === 1 && Number(alt.aktiv) !== 1) {
                daten.letzterPreis = null; daten.letzteZeit = 0; messung.delete(id)
                // Momentum: erst Kerzen, die nach dem Wiedereinschalten schliessen.
                if (MEHRFACH.includes(alt.art)) daten.stand = JSON.stringify({ ...parse(alt.stand, {}), ab: Date.now() })
            }
            await knex('chart_alarme').where('id', id).update(daten)
            res.json(alarmZeile(await knex('chart_alarme').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/alarme/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ungültige id' })
            await getKnex()('chart_alarme').where('id', id).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/alarme/test', async (_req, res) => {
        try {
            // Ergebnis je Kanal zurückgeben — vorher hiess es „verschickt", auch wenn alle Kanäle aus waren.
            // Die Mindest-Schwere gilt beim Test nicht: wer drückt, will wissen, ob der Draht steht.
            const ergebnis = await stelleZu({
                regel: 'chartAlarm', schwere: 'einstieg', quelle: 'chart',
                titel: 'Chart-Alarm: Test', meldung: 'Testmeldung vom Chart-Arbeitsplatz — die Zustellung funktioniert.',
                daten: { test: true },
            }, { symbol: 'TEST', chain: '—' }, await leseEinstellungen(), { alleSchweren: true })
            const ok = Object.values(ergebnis).some((v) => v === 'ok')
            res.json({ ok, ergebnis })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })
}
