/**
 * Spracheingabe über den Server (Begründung im Kopf von `sprache-kern.js`).
 *
 *   GET  /api/sprache/einstellungen   → {art, url, modell, openaiSchluessel: bool, vorgabe}
 *   PUT  /api/sprache/einstellungen   {art, url, modell}
 *   POST /api/sprache/umschrift?sprache=de&sekunden=12  Rohdaten der Aufnahme → {text}
 *
 * Die Adresse eines eigenen Dienstes ist ein Ziel im Sinn von `ZIEL_SETTINGS`
 * (`geheimnisse.js`): sie bestimmt, wohin der Ton geht. Deshalb wird sie nur
 * hier geschrieben, mit `pruefeKiEndpunkt`, nie über die allgemeine
 * Einstellungs-Route, und beim Backup-Import bleibt der bestehende Wert.
 */
import express from 'express'
import { getKnex } from './database.js'
import { decrypt } from './crypto.js'
import { pruefeKiEndpunkt } from './ollama-url.js'
import { merkeVerbrauch, FUNKTIONEN } from './ai-usage.js'
import { logWarn } from './logger.js'
import {
    pruefeSpracheEinstellung, zielFuer, dateiName, sprachCode, kostenUsd, textAusAntwort,
    normArt, MAX_BYTES, STANDARD_MODELL,
} from './sprache-kern.js'

const ZEIT_MS = 120_000
const GLEICHZEITIG = 2
let laufend = 0

async function ladeStand() {
    const s = await getKnex()('settings')
        .select('spracheArt', 'spracheUrl', 'spracheModell', 'aiKeyOpenai', 'aiApiKey')
        .where('id', 1).first()
    let openaiSchluessel = ''
    try { openaiSchluessel = decrypt(s?.aiKeyOpenai || '') || decrypt(s?.aiApiKey || '') || '' } catch { /* unlesbar = keiner */ }
    return {
        art: normArt(s?.spracheArt),
        url: String(s?.spracheUrl || ''),
        modell: String(s?.spracheModell || ''),
        openaiSchluessel,
    }
}

export function setupSpracheRoutes(app) {
    app.get('/api/sprache/einstellungen', async (req, res) => {
        try {
            const st = await ladeStand()
            res.json({ art: st.art, url: st.url, modell: st.modell, openaiSchluessel: !!st.openaiSchluessel, vorgabe: STANDARD_MODELL })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.put('/api/sprache/einstellungen', async (req, res) => {
        let neu
        try {
            neu = pruefeSpracheEinstellung(req.body || {})
        } catch (e) {
            return res.status(400).json({ fehler: e.fehlerCode || 'eingabe' })
        }
        if (neu.url) {
            try { await pruefeKiEndpunkt(neu.url) } catch (e) {
                return res.status(400).json({ fehler: 'url', grund: e.message })
            }
        }
        try {
            await getKnex()('settings').where('id', 1)
                .update({ spracheArt: neu.art, spracheUrl: neu.url, spracheModell: neu.modell })
            res.json({ ok: true, ...neu })
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    // Rohdaten, egal welcher Typ: der Browser schickt, was sein MediaRecorder kann.
    const rohBody = express.raw({ type: () => true, limit: MAX_BYTES })
    app.post('/api/sprache/umschrift', (req, res, next) => {
        rohBody(req, res, (err) => {
            if (err) return res.status(err.status === 413 ? 413 : 400).json({ fehler: err.status === 413 ? 'zuGross' : 'eingabe' })
            next()
        })
    }, async (req, res) => {
        const ton = req.body
        if (!Buffer.isBuffer(ton) || ton.length < 200) return res.status(400).json({ fehler: 'leer' })
        const name = dateiName(req.get('content-type'))
        if (!name) return res.status(415).json({ fehler: 'format' })
        if (laufend >= GLEICHZEITIG) return res.status(429).json({ fehler: 'belegt' })

        let stand
        try { stand = await ladeStand() } catch (e) { return res.status(500).json({ error: e.message }) }
        const ziel = zielFuer(stand)
        if (ziel.fehlt) return res.status(400).json({ fehler: `fehlt_${ziel.fehlt}` })

        laufend++
        try {
            const form = new FormData()
            form.append('file', new Blob([ton], { type: req.get('content-type') }), name)
            form.append('model', ziel.modell)
            form.append('response_format', 'json')
            const code = sprachCode(req.query.sprache)
            if (code) form.append('language', code)

            let antwort
            try {
                antwort = await fetch(ziel.url, {
                    method: 'POST',
                    headers: ziel.schluessel ? { Authorization: `Bearer ${ziel.schluessel}` } : {},
                    body: form,
                    signal: AbortSignal.timeout(ZEIT_MS),
                })
            } catch (e) {
                logWarn('sprache', `Dienst nicht erreichbar (${ziel.anbieter}): ${e.message}`)
                return res.status(502).json({ fehler: e.name === 'TimeoutError' ? 'zeit' : 'nichtErreichbar' })
            }
            const roh = await antwort.text().catch(() => '')
            if (!antwort.ok) {
                logWarn('sprache', `Umschrift ${ziel.anbieter} HTTP ${antwort.status}: ${roh.slice(0, 300)}`)
                const fehler = antwort.status === 401 || antwort.status === 403 ? 'schluesselAbgelehnt'
                    : antwort.status === 429 ? 'limit'
                        : antwort.status === 404 ? 'adresse' : 'dienst'
                return res.status(502).json({ fehler, status: antwort.status })
            }
            const text = textAusAntwort(roh)
            if (ziel.anbieter === 'openai') {
                merkeVerbrauch({
                    funktion: FUNKTIONEN.SPRACHE,
                    ausloeser: 'manuell',
                    provider: 'openai',
                    modell: ziel.modell,
                    kostenUsd: kostenUsd({ anbieter: 'openai', modell: ziel.modell, sekunden: req.query.sekunden, bytes: ton.length }),
                })
            }
            res.json({ text, kiGeneriert: true })
        } finally {
            laufend--
        }
    })
}
