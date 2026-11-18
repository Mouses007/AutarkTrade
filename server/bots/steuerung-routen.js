/**
 * Routen der Bot-Steuerung (Schritt 5). Alle hinter der Sitzung; ändernde
 * Aufrufe zusätzlich hinter `herkunftMiddleware` (gleiche Herkunft, JSON).
 *
 *   GET    /api/bots/steuerung                  Status: Schlüssel da? freigeschaltet? Text, Haken, Warnung
 *   PUT    /api/bots/steuerung/schluessel       {apiKey, secretKey} — zweiter Pionex-Schlüssel („Bot Trading")
 *   DELETE /api/bots/steuerung/schluessel
 *   POST   /api/bots/steuerung/freischalten     {fassung, hash, bestaetigt: true}
 *   POST   /api/bots/steuerung/sperren
 *   POST   /api/bots/:id/aktion/pruefen         {aktion, eingabe} → Prüfabfrage bei Pionex + Token
 *   POST   /api/bots/plan/mindesteinsatz        {eingabe, schaetzung} → reicht der Einsatz eines Plans? (nur Prüfabfragen)
 *   POST   /api/bots/:id/aktion/senden          {aktion, eingabe, token, haken: true, hakenText}
 *   GET    /api/bots/:id/aenderungen            Protokoll
 *
 * Gesendet wird nur mit gültiger Einwilligung (Fassung + Hash), einem Token aus
 * einer Prüfung derselben Anfrage (5 min, an den Körper gebunden, EINMALIG),
 * bestandener Prüfung (wo Pionex eine anbietet) und dem Haken mit gültigem
 * Text. Im Testbetrieb (Kopie der Live-DB mit echten Schlüsseln) wird nie
 * gesendet, nur geprüft.
 *
 * Audit 11.11.2026, umgesetzt:
 *  - SEC-01/09: je Bot eine Sperre, gesetzt VOR dem ersten await; der Token gilt
 *    einmal — die Protokollzeile mit eindeutigem Token-Hash entsteht vor dem
 *    Senden, ein zweiter Versuch scheitert an der Datenbank (auch über Prozesse).
 *  - SEC-02: drei Ausgänge. „abgelehnt" nur, wenn Pionex mit Fehler antwortet;
 *    Zeitüberschreitung, Verbindungsabbruch, 5xx oder leere Antwort heissen
 *    „unklar" — dann nichts erneut senden, sondern bei Pionex nachsehen.
 *  - SEC-06: nach dem Senden den Bot frisch lesen und den Stand mitliefern
 *    (Soll/Ist), damit ein falsch verstandenes Format auffällt.
 *  - SEC-10: Prüfantwort, abgewiesene Versuche, Freischalten und Sperren stehen
 *    im Protokoll.
 */
import crypto from 'node:crypto'
import { getKnex } from '../database.js'
import { encrypt, decrypt, maske, hauptGeheimnis } from '../crypto.js'
import { pionexRequest } from '../pionex-transport.js'
import { holeSymbolTabelle } from '../execution/pionex-meta.js'
import { istTestbetrieb } from '../testbetrieb.js'
import { logWarn, logInfo } from '../logger.js'
import { fehlerText } from '../boersen-status.js'
import { holeBot, holeLaufendeBots, vergesseBot } from './routen.js'
import { zahl as strengeZahl, baueAktion, einstellungVon, liqAusPruefung, pruefungBestanden, pruefGrund, sucheMindestEinsatz, rundeEinsatzAuf, minAusPruefung, reduzierAusPruefung, STEUERBAR } from './steuerung.js'
import { pionexSpotSymbole } from './pionex-kerzen.js'
import { PLAN_ID, planBot, pruefePlanEingabe, pruefePlanVariante } from './planer.js'
import { fetchTickerPrice } from '../pionex-api.js'
import { FASSUNG, einwilligungsText, einwilligungsTeile, hakenText, warnung, fassungHash, hakenHash, zustimmungGueltig, hakenGueltig } from './einwilligung.js'

const TOKEN_MS = 5 * 60_000
/** Aktionen, die bei einer Wiederholung doppelt wirken (zweiter Bot, doppelter Betrag, doppelter Verkauf). */
const DOPPELBAR = new Set(['starten', 'investieren', 'margeDazu', 'reduzieren'])
/** So lange nach einer unklaren Sendung keine doppelbare Aktion an denselben Bot. */
const UNKLAR_SPERRE_MS = 10 * 60_000
/** Erlaubte Abweichung der frei werdenden Investition zwischen Prüfen und Senden (Anteil). */
const REDUZIER_TOLERANZ = 0.02
/** Prüfantwort → Schätzungen, oder null, wenn Pionex die Prüfung nicht (mehr) besteht. */
const pruefungBestandenUndDaten = (antwort) => (pruefungBestanden(antwort) ? reduzierAusPruefung(antwort?.data) : null)
let SPERRE_MS = 10_000
let PRUEF_PAUSE_MS = 3_000
let NACHLESEN_MS = 2_500
let MIN_PAUSE_MS = 300
const MIN_CACHE_MS = 10 * 60_000

/** Nur für den Selbsttest: Wartezeiten verkürzen. */
export function _testZeiten({ sperre, pruefPause, nachlesen, minPause } = {}) {
    if (minPause != null) MIN_PAUSE_MS = minPause
    if (sperre != null) SPERRE_MS = sperre
    if (pruefPause != null) PRUEF_PAUSE_MS = pruefPause
    if (nachlesen != null) NACHLESEN_MS = nachlesen
}
const zuletztGesendet = new Map()   // botId → Zeit
const zuletztGeprueft = new Map()   // botId → Zeit
const laeuft = new Set()            // botId — Sperre, synchron gesetzt
const pruefungen = new Map()        // tokenHash → { zeit, pruefung } (für das Protokoll)
const mindestCache = new Map()      // Plan ohne Einsatz → { min (gerundet, zum Anzeigen), genau (gemessen, zum Vergleichen), zeit }
let mindestLaeuft = false

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const json = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

async function zeile() {
    return getKnex()('bot_steuerung').where('id', 1).first()
}
function zustimmungAus(z) { return json(z?.zustimmung) }
async function schluessel() {
    const z = await zeile()
    const apiKey = z?.apiKey ? decrypt(z.apiKey) : ''
    const secretKey = z?.secretKey ? decrypt(z.secretKey) : ''
    return apiKey && secretKey ? { apiKey, secretKey } : null
}

async function protokolliere(eintrag) {
    try {
        const [id] = await getKnex()('bot_aenderungen').insert({ zeit: Date.now(), ...eintrag }).returning('id')
        return typeof id === 'object' ? id.id : id
    } catch (e) {
        if (/unique|UNIQUE|duplicate/i.test(String(e.message))) throw Object.assign(new Error('Token schon verwendet'), { code: 'verbraucht' })
        throw e
    }
}

/**
 * Token: HMAC über Bot, Aktion, Anfrage und Zeit — beweist, dass genau das
 * geprüft wurde. `openPrice` (der Kurs beim Bauen) bleibt draussen: zwischen
 * Prüfen und Senden bewegt sich der Kurs immer, Pionex rechnet mit dem
 * aktuellen; alles, was der Nutzer festgelegt hat, ist gebunden.
 * Ohne Hauptgeheimnis gibt es keinen Token (Audit SEC-07).
 */
function ohneKurs(senden) {
    return { pfad: senden.pfad, body: { ...senden.body, openPrice: undefined } }
}
function token(botId, aktion, senden, zeit) {
    const geheim = hauptGeheimnis()
    if (!geheim) throw Object.assign(new Error('Kein Hauptgeheimnis — Bot-Steuerung nicht möglich'), { code: 'keinGeheimnis' })
    const roh = JSON.stringify([botId, aktion, ohneKurs(senden), zeit])
    return `${zeit}.${crypto.createHmac('sha256', geheim).update(`tn_bot_aktion_v1:${roh}`).digest('hex')}`
}
export function tokenGueltig(t, botId, aktion, senden, jetzt = Date.now()) {
    const zeit = Number(String(t || '').split('.')[0])
    if (!Number.isFinite(zeit) || jetzt - zeit > TOKEN_MS || zeit > jetzt + 5000) return false
    let erwartet
    try { erwartet = Buffer.from(token(botId, aktion, senden, zeit)) } catch { return false }
    const gegeben = Buffer.from(String(t))
    // Byte-Längen vergleichen, sonst wirft timingSafeEqual (Audit SEC-08)
    return erwartet.length === gegeben.length && crypto.timingSafeEqual(erwartet, gegeben)
}

/** Prüfabfrage (Dry-Run): jeder Fehler heisst „nicht bestanden". */
async function frage(k, pfad, body) {
    try {
        return await pionexRequest('POST', pfad, k.apiKey, k.secretKey, {}, body)
    } catch (e) {
        return { result: false, message: fehlerText(e) }
    }
}

/**
 * Sendung: drei Ausgänge (Audit SEC-02). `pionexRequest` wirft „Pionex API: …"
 * nur, wenn Pionex mit einem Fehlerstatus geantwortet hat — ausser 5xx und 408:
 * das kann auch ein Gateway vor Pionex sein, oder Pionex ist mitten in der
 * Ausführung gescheitert. Erkannt wird das am HTTP-Status des Fehlers
 * (`fehler.status`, Audit SEC-R-103: ein 503 mit JSON-Körper trägt den Status
 * nicht im Text), ersatzweise am Text. Alles andere (Zeitüberschreitung,
 * Netzabbruch) ist ebenfalls „unklar" — dann wird nachgelesen statt neu gesendet.
 */
export function deuteSendung(antwort, fehler = null) {
    if (fehler) {
        const text = String(fehler.message || fehler)
        const status = Number(fehler.status)
        if (status >= 500 || status === 408) return { zustand: 'unklar', text }
        if (/^Pionex API: /.test(text) && !/^Pionex API: (5\d\d|408)\b/.test(text)) return { zustand: 'abgelehnt', text }
        return { zustand: 'unklar', text }
    }
    if (!antwort || typeof antwort !== 'object') return { zustand: 'unklar', text: 'Leere Antwort' }
    if (antwort.result === false) return { zustand: 'abgelehnt', text: antwort.message || antwort.code || '' }
    if (antwort.data && Number(antwort.data.code) > 0) return { zustand: 'abgelehnt', text: antwort.data.message || String(antwort.data.code) }
    if (antwort.result !== true) return { zustand: 'unklar', text: 'Antwort ohne Ergebnis' }
    return { zustand: 'ausgefuehrt', text: '' }
}
async function sende(k, pfad, body) {
    try {
        const antwort = await pionexRequest('POST', pfad, k.apiKey, k.secretKey, {}, body)
        return { ...deuteSendung(antwort), antwort }
    } catch (e) {
        return { ...deuteSendung(null, e), antwort: null }
    }
}

/**
 * Prüfabfrage für die Mindesteinsatz-Suche: eine andere Antwort als „bestanden" oder „zu
 * wenig Einsatz" ist oft nur Pionex' Bremse bei vielen Abfragen (gesehen 14.11.2026 im
 * Planer: die Suche brach ab, direkt aufgerufen fand sie 240 USDT) — dann kurz warten und
 * höchstens zweimal nachfragen. Sendet nie etwas.
 */
async function frageGeduldig(k, pfad, body) {
    let p = null
    for (let versuch = 0; versuch < 3; versuch++) {
        if (MIN_PAUSE_MS) await new Promise((r) => setTimeout(r, versuch ? MIN_PAUSE_MS * 6 : MIN_PAUSE_MS))
        p = await frage(k, pfad, body)
        if (pruefungBestanden(p) || pruefGrund(p) === 'einsatzZuKlein') return p
    }
    return p
}

/**
 * Mindesteinsatz eines neuen Bots bei Pionex suchen (nur Prüfabfragen, gesendet
 * wird nichts). Höchstens 14 Abfragen mit Pause, damit Pionex nicht bremst.
 */
async function mindestEinsatzFuer(k, bot, eingabe, stellen, { start, lo }) {
    // Pionex nimmt USDT-Beträge nur mit höchstens 2 Nachkommastellen („quote_total_investment not
    // match quote precision", gesehen 14.11.2026 bei einem Schätzwert 194.1176…); Coin-M in der Coin feiner
    const betragText = (x) => String(bot.coinM ? Number(Number(x).toPrecision(6)) : Number(Number(x).toFixed(2)))
    const pruefe = async (x) => {
        const a = baueAktion(bot, 'starten', { ...eingabe, einsatz: betragText(x) }, { stellen })
        if (a.fehler || !a.pruefen) return 'anders'
        const p = await frageGeduldig(k, a.pruefen.pfad, a.pruefen.body)
        return pruefungBestanden(p) ? 'ok' : pruefGrund(p) === 'einsatzZuKlein' ? 'zuKlein' : 'anders'
    }
    return sucheMindestEinsatz(pruefe, { start, lo })
}

/** Preispräzision des Kontrakts aus Pionex' Symboltabelle (Audit SEC-03). Spot: aus der Spot-Tabelle. */
let spotCache = null
async function stellenFuer(bot) {
    if (bot.typ === 'spot_grid') {
        try {
            if (!spotCache || Date.now() - spotCache.zeit > 30 * 60_000) spotCache = { zeit: Date.now(), m: await pionexSpotSymbole() }
            const n = spotCache.m.get(bot.coin)?.quotePrecision
            return Number.isInteger(n) ? n : null
        } catch { return null }
    }
    try {
        const name = bot.coinM ? `USDT_${bot.coin}_PERP` : `${bot.coin}_USDT_PERP`
        const e = (await holeSymbolTabelle()).find((x) => x.symbol === name)
        const n = Number(e?.quotePrecision)
        return Number.isInteger(n) && n >= 0 ? n : null
    } catch { return null }
}

/**
 * Der Bot, an dem eine Aktion hängt. `plan` (Bot-Planer) ist kein Pionex-Bot: er
 * entsteht aus der Eingabe selbst (Coin, Art, Richtung, Band, Grids, Hebel,
 * Einsatz) und kann nur gestartet werden. Alles, was ihn ausmacht, steht damit
 * im gebundenen Anfragekörper des Tokens.
 */
async function botFuer(id, aktion, eingabe) {
    if (id !== PLAN_ID) return holeBot(id, { auchBeendete: aktion === 'starten' })
    if (aktion !== 'starten') return { fehler: 'aktion' }
    const e = pruefePlanEingabe({ ...eingabe, coinM: eingabe?.coinM === true || eingabe?.coinM === 'true', tage: 30 })
    if (e.fehler) return { fehler: e.fehler }
    const kurs = e.spot ? await fetchTickerPrice(`${e.coin}_USDT`) : (await fetchTickerPrice(`${e.coin}_USDT_PERP`) || await fetchTickerPrice(`${e.coin}_USDT`))
    if (!(kurs > 0)) return { fehler: 'kurs' }
    // Mit Trigger-Preis startet der Plan dort: das Band muss den Trigger umschliessen, nicht den heutigen Kurs
    const trig = strengeZahl(eingabe?.trigger)
    if (Number.isNaN(trig) || (trig != null && !(trig > 0))) return { fehler: 'trigger' }
    const bezug = trig ?? kurs
    const v = pruefePlanVariante({ unten: eingabe?.unten, oben: eingabe?.oben, anzahl: eingabe?.anzahl, art: eingabe?.art }, bezug, e.richtung, { spot: e.spot })
    if (v.fehler) return { fehler: trig != null && v.fehler === 'kursAusserhalb' ? 'triggerAusserhalb' : v.fehler }
    return planBot({ ...e, ...v, startKurs: bezug, kurs })
}

/** Nach einem Start: der neue Bot (ID aus der Antwort, sonst der jüngste laufende derselben Coin und Art). */
export function findeNeuenBot(lauf, bot, seit, antwort) {
    const id = antwort?.data?.buOrderId ?? antwort?.data?.bu_order_id
    if (id != null) { const b = lauf.find((x) => x.id === String(id)); if (b) return b }
    return lauf.filter((b) => b.coin === bot.coin && !!b.coinM === !!bot.coinM && (b.typ === 'spot_grid') === (bot.typ === 'spot_grid') && Number(b.erstellt) >= seit - 60_000)
        .sort((a, b) => Number(b.erstellt) - Number(a.erstellt))[0] || null
}

function fehlerAntwort(res, e) {
    if (e?.code === 'leseschluessel') return res.status(409).json({ ok: false, code: 'leseschluessel' })
    if (e?.code === 'keinGeheimnis') return res.status(500).json({ ok: false, code: 'keinGeheimnis' })
    return res.status(502).json({ ok: false, error: fehlerText(e) })
}

export function setupBotSteuerungRoutes(app) {
    // Eine Zeile «laeuft» von vor diesem Start gehört zu einem Prozess, der nicht mehr lebt: ihr Ausgang ist unklar
    getKnex()('bot_aenderungen').where('zustand', 'laeuft').update({ zustand: 'unklar' })
        .then((n) => { if (n) logWarn('bots', `${n} Sendung(en) ohne Abschluss aus einem früheren Lauf als «unklar» markiert`) })
        .catch(() => { /* Tabelle noch nicht da: nichts zu markieren */ })
    app.get('/api/bots/steuerung', async (req, res) => {
        try {
            const z = await zeile()
            const sprache = req.query.sprache === 'en' ? 'en' : 'de'
            const zust = zustimmungAus(z)
            res.json({
                ok: true,
                schluessel: !!(z?.apiKey && z?.secretKey),
                schluesselMaske: z?.apiKey ? maske(decrypt(z.apiKey)) : '',
                freigeschaltet: zustimmungGueltig(zust),
                zustimmung: zust,
                fassung: FASSUNG, hash: fassungHash(),
                text: einwilligungsText(sprache), teile: einwilligungsTeile(sprache), haken: hakenText(sprache), warnung: warnung(sprache),
                testbetrieb: istTestbetrieb(),
            })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.put('/api/bots/steuerung/schluessel', async (req, res) => {
        const apiKey = String(req.body?.apiKey || '').trim(), secretKey = String(req.body?.secretKey || '').trim()
        if (!apiKey || !secretKey || apiKey.length > 200 || secretKey.length > 200) return res.status(400).json({ ok: false, code: 'schluessel' })
        // Taugt der Schlüssel? Ein lesender Aufruf derselben Bot-Schnittstelle.
        try {
            await pionexRequest('GET', '/api/v1/bot/orders', apiKey, secretKey, { status: 'running', limit: 1 })
        } catch (e) {
            return res.status(400).json({ ok: false, code: 'schluesselAbgelehnt', error: fehlerText(e) })
        }
        await getKnex()('bot_steuerung').where('id', 1).update({ apiKey: encrypt(apiKey), secretKey: encrypt(secretKey), geaendertAm: Date.now() })
        logInfo('bots', 'Schlüssel für die Bot-Steuerung hinterlegt')
        // Rechteprobe (Audit SEC-05): eine Prüfabfrage (Dry-Run, ändert nichts) an einem
        // laufenden Futures-Grid zeigt, ob „Bot Trading" wirklich freigegeben ist.
        let rechte = 'unbekannt', rechteText = ''
        try {
            const bot = (await holeLaufendeBots()).find((b) => STEUERBAR.has(b.typ))
            if (bot) {
                try {
                    const probe = baueAktion(bot, 'pausieren').pruefen
                    await pionexRequest('POST', probe.pfad, apiKey, secretKey, {}, probe.body)
                    rechte = 'ok'
                } catch (e) {
                    rechteText = fehlerText(e)
                    rechte = /permission|forbidden|unauthori|not allowed|no access|40[13]/i.test(rechteText) ? 'fehlt' : 'unbekannt'
                }
            }
        } catch { /* ohne Leseschlüssel bleibt es „unbekannt" */ }
        res.json({ ok: true, rechte, rechteText })
    })

    app.delete('/api/bots/steuerung/schluessel', async (req, res) => {
        await getKnex()('bot_steuerung').where('id', 1).update({ apiKey: '', secretKey: '', geaendertAm: Date.now() })
        res.json({ ok: true })
    })

    app.post('/api/bots/steuerung/freischalten', async (req, res) => {
        const { fassung, hash, bestaetigt } = req.body || {}
        // Die Zustimmung gilt nur für genau den Text, der angezeigt wurde.
        if (bestaetigt !== true || fassung !== FASSUNG || hash !== fassungHash()) return res.status(409).json({ ok: false, code: 'fassung' })
        const zust = { fassung: FASSUNG, hash: fassungHash(), zeit: Date.now() }
        await getKnex()('bot_steuerung').where('id', 1).update({ zustimmung: JSON.stringify(zust), geaendertAm: Date.now() })
        await protokolliere({ botId: '-', aktion: 'freischalten', ok: true, zustand: 'ausgefuehrt', fassung: zust.fassung, fassungHash: zust.hash })
        logInfo('bots', `Bot-Steuerung freigeschaltet (Fassung ${FASSUNG})`)
        res.json({ ok: true, zustimmung: zust })
    })

    app.post('/api/bots/steuerung/sperren', async (req, res) => {
        await getKnex()('bot_steuerung').where('id', 1).update({ zustimmung: null, geaendertAm: Date.now() })
        await protokolliere({ botId: '-', aktion: 'sperren', ok: true, zustand: 'ausgefuehrt' })
        res.json({ ok: true })
    })

    /**
     * Bot-Planer: reicht der Einsatz einer Variante für Pionex? Braucht nur den
     * Schlüssel (Prüfabfragen senden nichts). Eine Suche zur Zeit; Minimum je
     * Variante (ohne Einsatz) 10 min im Speicher. `schaetzung` = Startwert aus
     * einer schon gemessenen Variante.
     */
    app.post('/api/bots/plan/mindesteinsatz', async (req, res) => {
        try {
            const k = await schluessel()
            if (!k) return res.status(403).json({ ok: false, code: 'keinSchluessel' })
            const eingabe = req.body?.eingabe || {}
            // dieselbe strenge Schreibweise wie die Eingabeprüfung (Komma erlaubt, kein «1e3»)
            const einsatz = strengeZahl(eingabe.einsatz) ?? NaN
            const schluesselPlan = JSON.stringify(['coin', 'coinM', 'spot', 'richtung', 'hebel', 'unten', 'oben', 'anzahl', 'art'].map((f) => String(eingabe[f] ?? '')))
            const gemerkt = mindestCache.get(schluesselPlan)
            if (gemerkt && Date.now() - gemerkt.zeit < MIN_CACHE_MS) return res.json({ ok: true, min: gemerkt.min, reichtAus: einsatz >= (gemerkt.genau ?? gemerkt.min) })
            if (mindestLaeuft) return res.status(429).json({ ok: false, code: 'zuSchnell' })
            mindestLaeuft = true
            try {
                const bot = await botFuer(PLAN_ID, 'starten', eingabe)
                if (!bot) return res.status(404).json({ ok: false, code: 'nichtGefunden' })
                if (bot.fehler) return res.status(400).json({ ok: false, code: bot.fehler })
                const stellen = await stellenFuer(bot)
                const a = baueAktion(bot, 'starten', eingabe, { stellen })
                if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
                const erste = await frageGeduldig(k, a.pruefen.pfad, a.pruefen.body)
                if (pruefungBestanden(erste)) return res.json({ ok: true, min: null, reichtAus: true })
                // Spot: Pionex nennt den Mindesteinsatz selbst, kein Herantasten nötig
                if (bot.typ === 'spot_grid' && minAusPruefung(erste)) {
                    // Verglichen wird mit dem genauen Wert, nicht mit dem aufgerundeten (FUN-R-102)
                    const genau = minAusPruefung(erste)
                    const min = rundeEinsatzAuf(genau)
                    mindestCache.set(schluesselPlan, { min, genau, zeit: Date.now() })
                    return res.json({ ok: true, min, reichtAus: einsatz >= genau })
                }
                if (pruefGrund(erste) !== 'einsatzZuKlein') return res.json({ ok: true, min: null, reichtAus: null, text: erste?.message || erste?.data?.reason || '' })
                const schaetzung = Number(req.body?.schaetzung)
                const m = await mindestEinsatzFuer(k, bot, eingabe, stellen, { lo: einsatz, start: schaetzung > einsatz ? schaetzung : einsatz * 2 })
                // Suche ohne Ergebnis: nicht „zu klein" behaupten, sondern unbekannt
                if (m.min == null) return res.json({ ok: true, min: null, reichtAus: null, text: `Mindesteinsatz nicht ermittelt (${m.fehler || 'unbekannt'})` })
                if (m.unsicher) return res.json({ ok: true, min: m.min, reichtAus: null, text: 'Mindesteinsatz nur grob eingegrenzt (Pionex antwortete zwischendurch nicht eindeutig) — höchstens dieser Betrag' })
                mindestCache.set(schluesselPlan, { min: m.min, genau: m.genau ?? m.min, zeit: Date.now() })
                for (const [s2, w] of mindestCache) if (Date.now() - w.zeit > MIN_CACHE_MS) mindestCache.delete(s2)
                res.json({ ok: true, min: m.min, reichtAus: false })
            } finally { mindestLaeuft = false }
        } catch (e) {
            fehlerAntwort(res, e)
        }
    })

    app.post('/api/bots/:id/aktion/pruefen', async (req, res) => {
        const id = String(req.params.id)
        try {
            const z = await zeile()
            if (!zustimmungGueltig(zustimmungAus(z))) return res.status(403).json({ ok: false, code: 'nichtFreigeschaltet' })
            const k = await schluessel()
            if (!k) return res.status(403).json({ ok: false, code: 'keinSchluessel' })
            // Bremse: höchstens eine Prüfung je 3 s und Bot (Audit FUN-03)
            if (Date.now() - (zuletztGeprueft.get(id) || 0) < PRUEF_PAUSE_MS) return res.status(429).json({ ok: false, code: 'zuSchnell' })
            zuletztGeprueft.set(id, Date.now())
            const aktion = String(req.body?.aktion || '')
            const bot = await botFuer(id, aktion, req.body?.eingabe || {})
            if (!bot) return res.status(404).json({ ok: false, code: 'nichtGefunden' })
            if (bot.fehler) return res.status(400).json({ ok: false, code: bot.fehler })
            if (!STEUERBAR.has(bot.typ)) return res.status(400).json({ ok: false, code: 'typ' })
            let eingabe = req.body?.eingabe || {}
            let anteilInfo
            const stellen = await stellenFuer(bot)
            // Reduzieren: Anteil in % → reduceNum. Erst eine Prüfung mit 1 Schritt, die Pionex' Höchstmenge
            // (maxReduceNum) nennt; die umgerechnete Eingabe geht an den Browser zurück und wird so gesendet.
            let stueck
            if (aktion === 'reduzieren' && eingabe.reduceNum == null) {
                // strenge Dezimalschreibweise wie überall in der Steuerung (Audit SEC-04/STG-07: «0x19», «2.5e1»)
                const zahlAus = (v) => { const n = strengeZahl(v); return n == null ? NaN : n }
                // Eingabe wahlweise als Anteil in % oder als frei werdende Investition in der Margin-Münze
                const inBetrag = eingabe.einheit === 'betrag'
                const anteil = inBetrag ? null : zahlAus(eingabe.anteil)
                const wunsch = inBetrag ? zahlAus(eingabe.betrag) : null
                if (inBetrag ? !(wunsch > 0) : !(anteil > 0 && anteil <= 100)) return res.status(400).json({ ok: false, code: inBetrag ? 'betrag' : 'anteil' })
                const probe = baueAktion(bot, aktion, { ...eingabe, reduceNum: 1 }, { stellen })
                if (probe.fehler) return res.status(400).json({ ok: false, code: probe.fehler })
                const vor = await frage(k, probe.pruefen.pfad, probe.pruefen.body)
                const max = reduzierAusPruefung(vor?.data)?.max
                if (!(max >= 1)) return res.json({ ok: true, aktion, bestanden: false, grund: null, pruefung: { result: vor?.result ?? false, message: vor?.message || 'Pionex nennt keine Höchstmenge zum Reduzieren', code: null, data: vor?.data || null }, nachher: {}, warnungen: [], token: null, testbetrieb: istTestbetrieb() })
                // Ein Schritt ist bei Pionex KEINE Stückzahl, sondern eine Stufe der Menge je Grid — er verkauft
                // über alle gehaltenen Grids hinweg (XRP 15.11.2026: Menge je Grid 4 → 3 = 11 von 44 XRP = 25 %),
                // und die Höchstmenge ist nicht die ganze Position (dort 2 Schritte = 50 %). Welchen Teil der
                // Position ein Schritt ausmacht, sagt deshalb nur die frei werdende Investition der 1-Schritt-Prüfung
                // gegen die heutige Investition. Bis 15.11.2026 galt «Schritte / Höchstmenge» als Anteil: der Dialog
                // nannte 22 XRP (50 %), verkauft wurden 11.
                const jeSchritt = reduzierAusPruefung(vor?.data)?.einsatz
                const investition = Number(bot.einsatz?.aktuell)
                const teil = jeSchritt > 0 && investition > 0 ? Math.min(1, jeSchritt / investition) : null   // Anteil der Position je Schritt
                let schritte
                if (inBetrag) {
                    if (!(jeSchritt > 0)) return res.status(400).json({ ok: false, code: 'betragUnbekannt' })
                    // Münzgerecht nennen: 2 Stellen reichen für USDT, bei Coin-M (Schritt 0.004 SOL) stünde «0» da
                    const nenne = (x, ab) => (bot.marginCoin === 'USDT' ? Number((ab ? Math.floor(x * 100 + 1e-9) / 100 : x).toFixed(2)) : Number(x.toPrecision(4)))
                    if (wunsch > jeSchritt * max * 1.001) return res.status(400).json({ ok: false, code: 'betragZuGross', max: nenne(jeSchritt * max, true) })
                    // ABrunden: beim Betrag nie mehr verkaufen als verlangt (bis 15.11.2026 gerundet: 5.76 → 7.68)
                    schritte = Math.min(max, Math.floor(wunsch / jeSchritt + 1e-9))
                    if (schritte < 1) return res.status(400).json({ ok: false, code: 'betragZuKlein', schritt: nenne(jeSchritt) })
                } else if (teil) {
                    // Audit FUN-R-105: nie stillschweigend auf einen Schritt aufrunden
                    if (anteil / 100 > teil * (max + 0.5)) return res.status(400).json({ ok: false, code: 'anteilZuGross', max: Number((teil * max * 100).toFixed(1)) })
                    schritte = Math.min(max, Math.round(anteil / 100 / teil))
                    if (schritte < 1) return res.status(400).json({ ok: false, code: 'anteilZuKlein', schritt: Number((teil * 100).toFixed(1)) })
                } else {
                    // Pionex nennt keine frei werdende Investition: der Anteil lässt sich nur an der Höchstmenge messen
                    schritte = Math.min(max, Math.round(max * anteil / 100))
                    if (schritte < 1) return res.status(400).json({ ok: false, code: 'anteilZuKlein', schritt: Number((100 / max).toFixed(1)) })
                }
                anteilInfo = {
                    gewuenscht: inBetrag ? null : anteil, tatsaechlich: teil ? schritte * teil * 100 : null,
                    schritt: teil ? teil * 100 : null, hoechstens: teil ? max * teil * 100 : null,
                    betragGewuenscht: inBetrag ? wunsch : null, betragTatsaechlich: jeSchritt > 0 ? schritte * jeSchritt : null,
                }
                // Verkaufte Stückzahl: derselbe Anteil der Position, die der Bot gerade hält
                const menge = Math.abs(Number(bot.position?.menge))   // Short-Positionen meldet Pionex negativ
                stueck = teil && Number.isFinite(menge) && menge > 0 ? menge * schritte * teil : null
                eingabe = { ...eingabe, reduceNum: String(schritte) }
            }
            const a = baueAktion(bot, aktion, eingabe, { stellen })
            if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
            const pruefung = a.pruefen ? await frage(k, a.pruefen.pfad, a.pruefen.body) : null
            const bestanden = a.pruefen ? pruefungBestanden(pruefung) : true
            const grund = bestanden ? null : pruefGrund(pruefung)
            let minEinsatz = null
            if (grund === 'einsatzZuKlein' && aktion === 'starten' && bot.typ === 'spot_grid') {
                minEinsatz = rundeEinsatzAuf(minAusPruefung(pruefung))
            } else if (grund === 'einsatzZuKlein' && aktion === 'starten') {
                const einsatz = Number(req.body?.eingabe?.einsatz) || Number(a.nachher?.einsatz) || null
                const m = await mindestEinsatzFuer(k, bot, req.body?.eingabe || {}, await stellenFuer(bot), { lo: einsatz, start: einsatz ? einsatz * 2 : 10 })
                minEinsatz = m.min ?? null
            }
            const t = bestanden ? token(bot.id, aktion, a.senden, Date.now()) : null
            if (t) pruefungen.set(sha(t), { zeit: Date.now(), pruefung })
            for (const [h, p] of pruefungen) if (Date.now() - p.zeit > TOKEN_MS) pruefungen.delete(h)
            res.json({
                ok: true, aktion, bestanden, ohnePruefung: !a.pruefen, grund, minEinsatz,
                pruefung: pruefung ? { result: pruefung.result, message: pruefung.message || null, code: pruefung.code || null, data: pruefung.data || null } : null,
                liq: pruefung?.data ? liqAusPruefung(bot, pruefung.data) : null,
                reduzieren: aktion === 'reduzieren' ? { ...reduzierAusPruefung(pruefung?.data), stueck: stueck ?? null } : undefined,
                eingabe: aktion === 'reduzieren' ? eingabe : undefined,
                anteil: anteilInfo,
                vorher: bot.plan ? null : einstellungVon(bot), nachher: a.nachher, warnungen: a.warnungen,
                anfrage: a.senden, token: t, testbetrieb: istTestbetrieb(),
            })
        } catch (e) {
            fehlerAntwort(res, e)
        }
    })

    app.post('/api/bots/:id/aktion/senden', async (req, res) => {
        const id = String(req.params.id)
        if (istTestbetrieb()) return res.status(403).json({ ok: false, code: 'testbetrieb' })
        // Sperre je Bot SYNCHRON vor dem ersten await (Audit SEC-01): ein Doppelklick
        // oder ein zweiter Tab kommt hier nicht durch, solange die erste Sendung läuft.
        if (laeuft.has(id)) return res.status(429).json({ ok: false, code: 'laeuft' })
        laeuft.add(id)
        let gesendet = false
        try {
            const z = await zeile()
            const zust = zustimmungAus(z)
            if (!zustimmungGueltig(zust)) return res.status(403).json({ ok: false, code: 'nichtFreigeschaltet' })
            const { aktion, eingabe, token: t, haken, hakenText: hText } = req.body || {}
            if (haken !== true || !hakenGueltig(hText)) {
                await protokolliere({ botId: id, aktion: String(aktion || '?').slice(0, 32), ok: false, zustand: 'abgewiesen', code: 'haken' })
                return res.status(400).json({ ok: false, code: 'haken' })
            }
            const k = await schluessel()
            if (!k) return res.status(403).json({ ok: false, code: 'keinSchluessel' })
            if (Date.now() - (zuletztGesendet.get(id) || 0) < SPERRE_MS) return res.status(429).json({ ok: false, code: 'zuSchnell' })
            const bot = await botFuer(id, String(aktion || ''), eingabe || {})
            if (!bot) return res.status(404).json({ ok: false, code: 'nichtGefunden' })
            if (bot.fehler) return res.status(400).json({ ok: false, code: bot.fehler })
            const a = baueAktion(bot, String(aktion || ''), eingabe || {}, { stellen: await stellenFuer(bot) })
            if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
            // Der Token beweist, dass GENAU diese Anfrage geprüft wurde (Kurs ausgenommen).
            if (!tokenGueltig(t, bot.id, a.aktion, a.senden)) {
                await protokolliere({ botId: bot.id, aktion: a.aktion, ok: false, zustand: 'abgewiesen', code: 'neuPruefen' })
                return res.status(409).json({ ok: false, code: 'neuPruefen' })
            }
            const th = sha(t)
            // Audit STG-02: nach einer Sendung mit unklarem Ausgang (Zeitlimit, 5xx) kann Pionex ausgeführt haben.
            // Wer dann neu prüft und sendet, verdoppelt Start, Investition, Marge oder Verkauf — der Einmal-Token
            // schützt nur denselben Token. Deshalb für diese Aktionen eine Wartezeit, bis der Stand bei Pionex klar ist.
            if (DOPPELBAR.has(a.aktion)) {
                const letzte = await getKnex()('bot_aenderungen').where('botId', bot.id).whereIn('zustand', ['unklar', 'laeuft', 'ausgefuehrt', 'abgelehnt']).orderBy('id', 'desc').first('zustand', 'zeit', 'aktion')
                if (letzte && ['unklar', 'laeuft'].includes(letzte.zustand) && Date.now() - Number(letzte.zeit) < UNKLAR_SPERRE_MS) {
                    await protokolliere({ botId: bot.id, aktion: a.aktion, ok: false, zustand: 'abgewiesen', code: 'unklarOffen' })
                    return res.status(409).json({ ok: false, code: 'unklarOffen', minuten: Math.ceil((UNKLAR_SPERRE_MS - (Date.now() - Number(letzte.zeit))) / 60_000) })
                }
            }
            // Audit STG-01: der Token bindet bei «Reduzieren» nur die Zahl der Schritte, nicht was ein Schritt
            // bedeutet. Füllt sich zwischen Prüfen und Senden ein Grid oder ändert sich die Investition, verkaufte
            // derselbe Körper eine andere Menge als angezeigt. Darum unmittelbar vor dem Senden nochmals fragen
            // und gegen die geprüften Werte halten.
            let sollNachher = a.nachher
            if (a.aktion === 'reduzieren') {
                const geprueft = reduzierAusPruefung(pruefungen.get(th)?.pruefung?.data)
                const jetzt = pruefungBestandenUndDaten(await frage(k, a.pruefen.pfad, a.pruefen.body))
                const gleich = (x, y) => x != null && y != null && Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * REDUZIER_TOLERANZ
                if (!geprueft || !jetzt || geprueft.max !== jetzt.max || !gleich(geprueft.einsatz, jetzt.einsatz)) {
                    await protokolliere({ botId: bot.id, aktion: a.aktion, ok: false, zustand: 'abgewiesen', code: 'neuPruefen' })
                    return res.status(409).json({ ok: false, code: 'neuPruefen' })
                }
                // Soll für den Vergleich nach dem Senden (Audit STG-03): die Investition sinkt um das Freigegebene
                const heute = Number(bot.einsatz?.aktuell)
                if (Number.isFinite(heute) && jetzt.einsatz > 0) sollNachher = { ...a.nachher, einsatz: Number((heute - jetzt.einsatz).toFixed(6)) }
            }
            const vorher = { einstellung: einstellungVon(bot), kurs: bot.kurs, kennzahlen: bot.kennzahlen }
            // Einmal-Token: die Zeile mit eindeutigem Hash entsteht VOR dem Senden.
            let zeileId
            try {
                zeileId = await protokolliere({
                    botId: bot.id, aktion: a.aktion, ok: false, zustand: 'laeuft', tokenHash: th,
                    vorher: JSON.stringify(vorher), anfrage: JSON.stringify(a.senden),
                    pruefung: JSON.stringify(pruefungen.get(th)?.pruefung ?? null),
                    fassung: zust.fassung, fassungHash: zust.hash, hakenHash: hakenHash(hText),
                })
            } catch (e) {
                if (e.code === 'verbraucht') return res.status(409).json({ ok: false, code: 'verbraucht' })
                throw e
            }
            zuletztGesendet.set(id, Date.now())
            const sendeZeit = Date.now()
            // Ab hier ist die Anfrage bei Pionex (oder unterwegs): kein Fehler danach darf wie «nicht gesendet» aussehen.
            gesendet = true
            const s = await sende(k, a.senden.pfad, a.senden.body)
            // Soll/Ist (Audit SEC-06): Pionex verarbeitet asynchron — kurz warten, dann frisch lesen.
            let ist = null
            // Audit BUG-R-106: eigenes try nach dem Senden. Scheitert das Protokoll (Datenbank), bleibt der
            // Ausgang der Sendung die Antwort — mit dem Vermerk, dass die Zeile nicht geschrieben wurde.
            let protokollFehler = false
            try {
                if (s.zustand !== 'abgelehnt') {
                    await new Promise((ok) => setTimeout(ok, NACHLESEN_MS))
                    try {
                        const lauf = await holeLaufendeBots()
                        // Ein Start erzeugt einen NEUEN Bot — der alte (oder der Plan) ist nicht gemeint
                        const neu = a.aktion === 'starten' ? findeNeuenBot(lauf, bot, sendeZeit, s.antwort) : lauf.find((b) => b.id === bot.id)
                        ist = neu ? { ...einstellungVon(neu), ...(a.aktion === 'starten' ? { neueId: neu.id } : {}) } : { status: a.aktion === 'starten' ? 'nichtGefunden' : 'nichtMehrLaufend' }
                    } catch (e) { ist = { fehler: fehlerText(e) } }
                }
                await getKnex()('bot_aenderungen').where('id', zeileId).update({
                    ok: s.zustand === 'ausgefuehrt', zustand: s.zustand, antwort: JSON.stringify(s.antwort ?? { message: s.text }), ist: JSON.stringify(ist),
                })
            } catch (e) {
                protokollFehler = true
                logWarn('bots', `Protokoll nach dem Senden (${a.aktion} an ${bot.id}, Zeile ${zeileId}) nicht geschrieben: ${e.message}`)
            }
            vergesseBot(bot.id)
            const meldung = `${a.aktion} an ${bot.id}: ${s.zustand}${s.text ? ` (${s.text})` : ''}`
            if (s.zustand === 'ausgefuehrt') logInfo('bots', meldung)
            else logWarn('bots', meldung)
            res.json({
                ok: s.zustand === 'ausgefuehrt', zustand: s.zustand, soll: sollNachher, ist,
                antwort: { result: s.antwort?.result ?? null, message: s.text || s.antwort?.message || null, data: s.antwort?.data || null },
                ...(protokollFehler ? { protokollFehler: true } : {}),
            })
        } catch (e) {
            logWarn('bots', `Senden ${id}: ${e.message}`)
            // BUG-R-106, Auffangnetz: ein unerwarteter Fehler NACH dem Senden ist «unklar», kein 502
            if (gesendet) { if (!res.headersSent) res.json({ ok: false, zustand: 'unklar', soll: null, ist: null, antwort: { result: null, message: fehlerText(e), data: null }, protokollFehler: true }); return }
            fehlerAntwort(res, e)
        } finally {
            laeuft.delete(id)
        }
    })

    app.get('/api/bots/:id/aenderungen', async (req, res) => {
        try {
            const zeilen = await getKnex()('bot_aenderungen').whereIn('botId', [String(req.params.id), '-']).orderBy('zeit', 'desc').limit(200)
            res.json({
                ok: true,
                aenderungen: zeilen.map((r) => ({
                    id: r.id, zeit: Number(r.zeit), aktion: r.aktion, ok: !!r.ok, zustand: r.zustand || (r.ok ? 'ausgefuehrt' : 'abgelehnt'), code: r.code || null,
                    vorher: json(r.vorher)?.einstellung || null, anfrage: json(r.anfrage), antwort: json(r.antwort), ist: json(r.ist), fassung: r.fassung,
                })),
            })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })
}
