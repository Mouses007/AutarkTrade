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
 * Gesendet wird nur mit gültiger Einwilligung (Fassung + Hash), gültigem
 * Token aus einer Prüfung derselben Anfrage (5 min, an den Körper gebunden),
 * bestandener Prüfung (wo Pionex eine anbietet) und dem Haken mit gültigem
 * Text. Im Testbetrieb (Kopie der Live-DB mit echten Schlüsseln) wird nie
 * gesendet, nur geprüft. Jede gesendete Änderung landet in `bot_aenderungen`.
 */
import crypto from 'node:crypto'
import { getKnex } from '../database.js'
import { encrypt, decrypt, maske, hauptGeheimnis } from '../crypto.js'
import { pionexRequest } from '../pionex-transport.js'
import { istTestbetrieb } from '../testbetrieb.js'
import { logWarn, logInfo } from '../logger.js'
import { fehlerText } from '../boersen-status.js'
import { holeBots, vergesseBot } from './routen.js'
import { baueAktion, einstellungVon, liqAusPruefung, pruefungBestanden, STEUERBAR } from './steuerung.js'
import { FASSUNG, einwilligungsText, hakenText, warnung, fassungHash, hakenHash, zustimmungGueltig, hakenGueltig } from './einwilligung.js'

const TOKEN_MS = 5 * 60_000
const SPERRE_MS = 10_000
const zuletztGesendet = new Map()   // botId → Zeit

async function zeile() {
    return getKnex()('bot_steuerung').where('id', 1).first()
}
function zustimmungAus(z) {
    try { return z?.zustimmung ? JSON.parse(z.zustimmung) : null } catch { return null }
}
async function schluessel() {
    const z = await zeile()
    const apiKey = z?.apiKey ? decrypt(z.apiKey) : ''
    const secretKey = z?.secretKey ? decrypt(z.secretKey) : ''
    return apiKey && secretKey ? { apiKey, secretKey } : null
}

/**
 * Token: HMAC über Bot, Aktion, Anfrage und Zeit — beweist, dass genau das
 * geprüft wurde. `openPrice` (der Kurs beim Bauen) bleibt draussen: zwischen
 * Prüfen und Senden bewegt sich der Kurs immer, Pionex rechnet mit dem
 * aktuellen; alles, was der Nutzer festgelegt hat, ist gebunden.
 */
function ohneKurs(senden) {
    return { pfad: senden.pfad, body: { ...senden.body, openPrice: undefined } }
}
function token(botId, aktion, senden, zeit) {
    const roh = JSON.stringify([botId, aktion, ohneKurs(senden), zeit])
    return `${zeit}.${crypto.createHmac('sha256', hauptGeheimnis() || 'at').update(`tn_bot_aktion_v1:${roh}`).digest('hex')}`
}
export function tokenGueltig(t, botId, aktion, senden, jetzt = Date.now()) {
    const zeit = Number(String(t || '').split('.')[0])
    if (!Number.isFinite(zeit) || jetzt - zeit > TOKEN_MS || zeit > jetzt + 5000) return false
    const erwartet = token(botId, aktion, senden, zeit)
    return erwartet.length === String(t).length && crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(String(t)))
}

async function frage(k, pfad, body) {
    try {
        return await pionexRequest('POST', pfad, k.apiKey, k.secretKey, {}, body)
    } catch (e) {
        return { result: false, message: fehlerText(e) }
    }
}

async function botFuer(id) {
    const alle = await holeBots({ frisch: true })
    return alle.bots?.find((b) => b.id === String(id)) || null
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
                text: einwilligungsText(sprache), haken: hakenText(sprache), warnung: warnung(sprache),
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
            const probe = await pionexRequest('GET', '/api/v1/bot/orders', apiKey, secretKey, { status: 'running', limit: 1 })
            if (probe?.result === false) return res.status(400).json({ ok: false, code: 'schluesselAbgelehnt', error: probe.message || '' })
        } catch (e) {
            return res.status(400).json({ ok: false, code: 'schluesselAbgelehnt', error: fehlerText(e) })
        }
        await getKnex()('bot_steuerung').where('id', 1).update({ apiKey: encrypt(apiKey), secretKey: encrypt(secretKey), geaendertAm: Date.now() })
        logInfo('bots', 'Schlüssel für die Bot-Steuerung hinterlegt')
        res.json({ ok: true })
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
        logInfo('bots', `Bot-Steuerung freigeschaltet (Fassung ${FASSUNG})`)
        res.json({ ok: true, zustimmung: zust })
    })

    app.post('/api/bots/steuerung/sperren', async (req, res) => {
        await getKnex()('bot_steuerung').where('id', 1).update({ zustimmung: null, geaendertAm: Date.now() })
        res.json({ ok: true })
    })

    app.post('/api/bots/:id/aktion/pruefen', async (req, res) => {
        try {
            const z = await zeile()
            if (!zustimmungGueltig(zustimmungAus(z))) return res.status(403).json({ ok: false, code: 'nichtFreigeschaltet' })
            const k = await schluessel()
            if (!k) return res.status(403).json({ ok: false, code: 'keinSchluessel' })
            const bot = await botFuer(req.params.id)
            if (!bot) return res.status(404).json({ ok: false, code: 'nichtGefunden' })
            if (!STEUERBAR.has(bot.typ)) return res.status(400).json({ ok: false, code: 'typ' })
            const aktion = String(req.body?.aktion || '')
            const a = baueAktion(bot, aktion, req.body?.eingabe || {})
            if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
            const pruefung = a.pruefen ? await frage(k, a.pruefen.pfad, a.pruefen.body) : null
            const bestanden = a.pruefen ? pruefungBestanden(pruefung) : true
            res.json({
                ok: true, aktion, bestanden, ohnePruefung: !a.pruefen,
                pruefung: pruefung ? { result: pruefung.result, message: pruefung.message || null, code: pruefung.code || null, data: pruefung.data || null } : null,
                liq: pruefung?.data ? liqAusPruefung(bot, pruefung.data) : null,
                vorher: einstellungVon(bot), nachher: a.nachher, warnungen: a.warnungen,
                anfrage: a.senden,
                token: bestanden ? token(bot.id, aktion, a.senden, Date.now()) : null,
                testbetrieb: istTestbetrieb(),
            })
        } catch (e) {
            res.status(502).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.post('/api/bots/:id/aktion/senden', async (req, res) => {
        const id = String(req.params.id)
        try {
            if (istTestbetrieb()) return res.status(403).json({ ok: false, code: 'testbetrieb' })
            const z = await zeile()
            const zust = zustimmungAus(z)
            if (!zustimmungGueltig(zust)) return res.status(403).json({ ok: false, code: 'nichtFreigeschaltet' })
            const { aktion, eingabe, token: t, haken, hakenText: hText } = req.body || {}
            if (haken !== true || !hakenGueltig(hText)) return res.status(400).json({ ok: false, code: 'haken' })
            const k = await schluessel()
            if (!k) return res.status(403).json({ ok: false, code: 'keinSchluessel' })
            const letzte = zuletztGesendet.get(id) || 0
            if (Date.now() - letzte < SPERRE_MS) return res.status(429).json({ ok: false, code: 'zuSchnell' })
            const bot = await botFuer(id)
            if (!bot) return res.status(404).json({ ok: false, code: 'nichtGefunden' })
            const a = baueAktion(bot, String(aktion || ''), eingabe || {})
            if (a.fehler) return res.status(400).json({ ok: false, code: a.fehler })
            // Der Token beweist, dass GENAU diese Anfrage geprüft wurde. Hat sich der Kurs
            // seither bewegt (openPrice im Körper), ist eine neue Prüfung fällig.
            if (!tokenGueltig(t, bot.id, a.aktion, a.senden)) return res.status(409).json({ ok: false, code: 'neuPruefen' })
            zuletztGesendet.set(id, Date.now())
            const antwort = await frage(k, a.senden.pfad, a.senden.body)
            const ok = antwort?.result !== false && !(antwort?.data && Number(antwort.data.code) > 0)
            await getKnex()('bot_aenderungen').insert({
                botId: bot.id, zeit: Date.now(), aktion: a.aktion,
                vorher: JSON.stringify({ einstellung: einstellungVon(bot), kurs: bot.kurs, kennzahlen: bot.kennzahlen }),
                anfrage: JSON.stringify(a.senden), pruefung: null, antwort: JSON.stringify(antwort ?? null), ok,
                fassung: zust.fassung, fassungHash: zust.hash, hakenHash: hakenHash(hText),
            })
            vergesseBot(bot.id)
            if (!ok) logWarn('bots', `Änderung ${a.aktion} an ${bot.id} abgelehnt: ${antwort?.message || antwort?.data?.message || ''}`)
            else logInfo('bots', `Änderung ${a.aktion} an ${bot.id} gesendet`)
            res.json({ ok, antwort: { result: antwort?.result ?? null, message: antwort?.message || antwort?.data?.message || null, data: antwort?.data || null } })
        } catch (e) {
            logWarn('bots', `Senden ${id}: ${e.message}`)
            res.status(502).json({ ok: false, error: fehlerText(e) })
        }
    })

    app.get('/api/bots/:id/aenderungen', async (req, res) => {
        try {
            const zeilen = await getKnex()('bot_aenderungen').where('botId', String(req.params.id)).orderBy('zeit', 'desc').limit(200)
            const json = (s) => { try { return JSON.parse(s) } catch { return null } }
            res.json({ ok: true, aenderungen: zeilen.map((r) => ({ id: r.id, zeit: Number(r.zeit), aktion: r.aktion, ok: !!r.ok, vorher: json(r.vorher)?.einstellung || null, anfrage: json(r.anfrage), antwort: json(r.antwort), fassung: r.fassung })) })
        } catch (e) {
            res.status(500).json({ ok: false, error: fehlerText(e) })
        }
    })
}
