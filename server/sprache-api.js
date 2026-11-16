/**
 * Spracheingabe über den Server (Begründung im Kopf von `sprache-kern.js`).
 *
 *   GET  /api/sprache/einstellungen   → {art, url, modell, openaiSchluessel: bool, vorgabe}
 *   PUT  /api/sprache/einstellungen   {art, url, modell}
 *   POST /api/sprache/umschrift?sprache=de&sekunden=12  Rohdaten der Aufnahme → {text}
 *   POST /api/sprache/pruefen      {art, url, modell} → erreicht? Modell da? (kostenlos)
 *   POST /api/sprache/modell-laden {url, modell} → eigener Dienst lädt das Modell (Speaches)
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
    normArt, MAX_BYTES, STANDARD_MODELL, ordne404, grundAusAntwort, modelleAus, spracheBasis, gueltigesModell,
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

    /*
     * Dienst prüfen — mit den Werten des Formulars, damit man vor dem Speichern
     * testen kann. Kostet nichts: GET /models (bei OpenAI gratis), kein Ton.
     * Die Adresse geht durch dieselbe Prüfung wie beim Speichern.
     */
    async function zielAusFormular(body) {
        const art = normArt(body?.art)
        const modell = String(body?.modell || '').trim()
        if (!gueltigesModell(modell)) return { fehler: 'modell' }
        if (art === 'eigen') {
            const basis = spracheBasis(body?.url)
            if (!basis) return { fehler: 'urlFehlt' }
            try { await pruefeKiEndpunkt(basis) } catch (e) { return { fehler: 'url', grund: e.message } }
            return { art, basis, modell: modell || STANDARD_MODELL.eigen, schluessel: '' }
        }
        if (art === 'openai') {
            const st = await ladeStand()
            if (!st.openaiSchluessel) return { fehler: 'fehlt_schluessel' }
            return { art, basis: 'https://api.openai.com/v1', modell: modell || STANDARD_MODELL.openai, schluessel: st.openaiSchluessel }
        }
        return { fehler: 'fehlt_browser' }
    }

    app.post('/api/sprache/pruefen', async (req, res) => {
        let ziel
        try { ziel = await zielAusFormular(req.body) } catch (e) { return res.status(500).json({ error: e.message }) }
        if (ziel.fehler) return res.json({ ok: false, fehler: ziel.fehler, grund: ziel.grund || '' })
        let antwort
        try {
            antwort = await fetch(`${ziel.basis}/models`, {
                headers: ziel.schluessel ? { Authorization: `Bearer ${ziel.schluessel}` } : {},
                signal: AbortSignal.timeout(15_000),
            })
        } catch (e) {
            return res.json({ ok: false, fehler: e.name === 'TimeoutError' ? 'zeit' : 'nichtErreichbar', grund: e.cause?.code || e.message })
        }
        const roh = await antwort.text().catch(() => '')
        if (!antwort.ok) {
            const fehler = antwort.status === 401 || antwort.status === 403 ? 'schluesselAbgelehnt' : antwort.status === 404 ? 'adresse' : 'dienst'
            return res.json({ ok: false, fehler, status: antwort.status, grund: grundAusAntwort(roh) })
        }
        let modelle = []
        try { modelle = modelleAus(JSON.parse(roh)) } catch { /* keine Liste */ }
        // OpenAI listet hunderte Modelle; gezeigt werden nur Umschrift-Modelle.
        const gezeigt = ziel.art === 'openai' ? modelle.filter((m) => /whisper|transcribe/.test(m)) : modelle
        res.json({ ok: true, art: ziel.art, modell: ziel.modell, modellDa: modelle.includes(ziel.modell), modelle: gezeigt.slice(0, 50) })
    })

    // Nur für den eigenen Dienst (Speaches: POST /v1/models/{id}). Dauert je nach
    // Modell und Leitung Minuten; eine Ladung zur Zeit.
    let laedt = false
    app.post('/api/sprache/modell-laden', async (req, res) => {
        let ziel
        try { ziel = await zielAusFormular({ ...req.body, art: 'eigen' }) } catch (e) { return res.status(500).json({ error: e.message }) }
        if (ziel.fehler) return res.json({ ok: false, fehler: ziel.fehler, grund: ziel.grund || '' })
        if (laedt) return res.json({ ok: false, fehler: 'belegt' })
        laedt = true
        try {
            const antwort = await fetch(`${ziel.basis}/models/${ziel.modell.split('/').map(encodeURIComponent).join('/')}`, {
                method: 'POST',
                signal: AbortSignal.timeout(15 * 60_000),
            })
            const roh = await antwort.text().catch(() => '')
            if (!antwort.ok) return res.json({ ok: false, fehler: 'dienst', status: antwort.status, grund: grundAusAntwort(roh) })
            res.json({ ok: true, modell: ziel.modell, grund: grundAusAntwort(roh) })
        } catch (e) {
            res.json({ ok: false, fehler: e.name === 'TimeoutError' ? 'zeit' : 'nichtErreichbar', grund: e.cause?.code || e.message })
        } finally {
            laedt = false
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
                        : antwort.status === 404 ? ordne404(roh) : 'dienst'
                return res.status(502).json({ fehler, status: antwort.status, grund: grundAusAntwort(roh) })
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
