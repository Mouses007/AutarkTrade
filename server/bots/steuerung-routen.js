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
import { baueAktion, einstellungVon, liqAusPruefung, pruefungBestanden, STEUERBAR } from './steuerung.js'
import { PLAN_ID, planBot, pruefePlanEingabe, pruefePlanVariante } from './planer.js'
import { fetchTickerPrice } from '../pionex-api.js'
import { FASSUNG, einwilligungsText, einwilligungsTeile, hakenText, warnung, fassungHash, hakenHash, zustimmungGueltig, hakenGueltig } from './einwilligung.js'

const TOKEN_MS = 5 * 60_000
let SPERRE_MS = 10_000
let PRUEF_PAUSE_MS = 3_000
let NACHLESEN_MS = 2_500

/** Nur für den Selbsttest: Wartezeiten verkürzen. */
export function _testZeiten({ sperre, pruefPause, nachlesen } = {}) {
    if (sperre != null) SPERRE_MS = sperre
    if (pruefPause != null) PRUEF_PAUSE_MS = pruefPause
    if (nachlesen != null) NACHLESEN_MS = nachlesen
}
const zuletztGesendet = new Map()   // botId → Zeit
const zuletztGeprueft = new Map()   // botId → Zeit
const laeuft = new Set()            // botId — Sperre, synchron gesetzt
const pruefungen = new Map()        // tokenHash → { zeit, pruefung } (für das Protokoll)

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
 * nur, wenn Pionex mit einem Fehlerstatus geantwortet hat — ausser 5xx, das
 * kann auch ein Gateway vor Pionex sein. Alles andere ist „unklar".
 */
export function deuteSendung(antwort, fehler = null) {
    if (fehler) {
        const text = String(fehler.message || fehler)
        if (/^Pionex API: /.test(text) && !/^Pionex API: 5\d\d\b/.test(text)) return { zustand: 'abgelehnt', text }
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

/** Preispräzision des Kontrakts aus Pionex' Symboltabelle (Audit SEC-03). */
async function stellenFuer(bot) {
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
    const kurs = await fetchTickerPrice(`${e.coin}_USDT_PERP`) || await fetchTickerPrice(`${e.coin}_USDT`)
    if (!(kurs > 0)) return { fehler: 'kurs' }
    const v = pruefePlanVariante({ unten: eingabe?.unten, oben: eingabe?.oben, anzahl: eingabe?.anzahl, art: eingabe?.art }, kurs, e.richtung)
    if (v.fehler) return { fehler: v.fehler }
    return planBot({ ...e, ...v, startKurs: kurs, kurs })
}

/** Nach einem Start: der neue Bot (ID aus der Antwort, sonst der jüngste laufende derselben Coin und Art). */
export function findeNeuenBot(lauf, bot, seit, antwort) {
    const id = antwort?.data?.buOrderId ?? antwort?.data?.bu_order_id
    if (id != null) { const b = lauf.find((x) => x.id === String(id)); if (b) return b }
    return lauf.filter((b) => b.coin === bot.coin && !!b.coinM === !!bot.coinM && Number(b.erstellt) >= seit - 60_000)
        .sort((a, b) => Number(b.erstellt) - Number(a.erstellt))[0] || null
}

function fehlerAntwort(res, e) {
    if (e?.code === 'leseschluessel') return res.status(409).json({ ok: false, code: 'leseschluessel' })
    if (e?.code === 'keinGeheimnis') return res.status(500).json({ ok: false, code: 'keinGeheimnis' })
    return res.status(502).json({ ok: false, error: fehlerText(e) })
}

export function setupBotSteuerungRoutes(app) {
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
            const a = baueAktion(bot, aktion, req.body?.eingabe || {}, { stellen: await stellenFuer(bot) })
            if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
            const pruefung = a.pruefen ? await frage(k, a.pruefen.pfad, a.pruefen.body) : null
            const bestanden = a.pruefen ? pruefungBestanden(pruefung) : true
            const t = bestanden ? token(bot.id, aktion, a.senden, Date.now()) : null
            if (t) pruefungen.set(sha(t), { zeit: Date.now(), pruefung })
            for (const [h, p] of pruefungen) if (Date.now() - p.zeit > TOKEN_MS) pruefungen.delete(h)
            res.json({
                ok: true, aktion, bestanden, ohnePruefung: !a.pruefen,
                pruefung: pruefung ? { result: pruefung.result, message: pruefung.message || null, code: pruefung.code || null, data: pruefung.data || null } : null,
                liq: pruefung?.data ? liqAusPruefung(bot, pruefung.data) : null,
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
            const s = await sende(k, a.senden.pfad, a.senden.body)
            // Soll/Ist (Audit SEC-06): Pionex verarbeitet asynchron — kurz warten, dann frisch lesen.
            let ist = null
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
            vergesseBot(bot.id)
            const meldung = `${a.aktion} an ${bot.id}: ${s.zustand}${s.text ? ` (${s.text})` : ''}`
            if (s.zustand === 'ausgefuehrt') logInfo('bots', meldung)
            else logWarn('bots', meldung)
            res.json({
                ok: s.zustand === 'ausgefuehrt', zustand: s.zustand, soll: a.nachher, ist,
                antwort: { result: s.antwort?.result ?? null, message: s.text || s.antwort?.message || null, data: s.antwort?.data || null },
            })
        } catch (e) {
            logWarn('bots', `Senden ${id}: ${e.message}`)
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
