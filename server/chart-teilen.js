/**
 * Chart teilen per Mail: `POST /api/chart/teilen/mail {an, betreff, text, dateiname, bild: {mediaType, base64}}`.
 *
 * Eine Webseite kann kein Mailprogramm mit Anhang öffnen (`mailto:` kennt keine
 * Anhänge, Thunderbird lässt sich aus dem Browser nicht starten, und der Server
 * läuft auf dem NAS, nicht am Arbeitsplatz). Deshalb verschickt der Server das
 * Bild über den SMTP-Zugang der Benachrichtigungen. Eine Sperre von 10 s hält
 * Doppelklicks und Schleifen aus dem Postausgang.
 */
import { pruefeTeilenMail } from './chart-teilen-kern.js'
import { sendeBildMail } from './benachrichtigungen.js'
import { logWarn } from './logger.js'

const SPERRE_MS = 10_000
let zuletzt = 0

export function setupChartTeilenRoutes(app) {
    app.post('/api/chart/teilen/mail', async (req, res) => {
        const e = pruefeTeilenMail(req.body)
        if (e.fehler) return res.status(400).json({ error: e.fehler, verworfen: e.verworfen })
        if (Date.now() - zuletzt < SPERRE_MS) return res.status(429).json({ error: 'sperre' })
        zuletzt = Date.now()
        try {
            await sendeBildMail({ an: e.an, betreff: e.betreff, text: e.text, png: e.bild, dateiname: e.dateiname })
            res.json({ ok: true, an: e.an })
        } catch (err) {
            if (err.code === 'mailFehlt') return res.status(409).json({ error: 'mailFehlt' })
            logWarn('chart-teilen', `Versand: ${err.message}`)
            // Den SMTP-Fehler im Klartext zurück — wie bei der Testmail ist er sonst nicht zu finden
            res.status(502).json({ error: 'versand', meldung: err.message })
        }
    })
}
