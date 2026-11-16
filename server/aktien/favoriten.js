/**
 * Favoriten Aktien: die Merkliste des Nutzers (`aktien_favoriten`).
 *
 *   GET    /api/aktien/favoriten           Merkliste mit dem Stand des letzten Aktien-Radar-Laufs
 *   GET    /api/aktien/favoriten/ticker    nur die Ticker — für die Sterne in den Listen
 *   POST   /api/aktien/favoriten           `{ticker}` anheften (muss im Stamm stehen)
 *   DELETE /api/aktien/favoriten/:ticker   entfernen
 *
 * Getrennt von `hype_favoriten`: jene Tabelle wird vom Wachhund überwacht und
 * meldet Coins; eine Aktie darin bekäme Coin-Alarme. Diese Liste hier löst
 * nichts aus — sie liest nur, was der Radar-Lauf ohnehin gespeichert hat.
 */
import { getKnex } from '../database.js'
import { leseStamm } from './stamm-speicher.js'
import { chartSymboleAus } from './chart-symbole.js'
import { ladeMitKursSymbol, fuelleSpartenImHintergrund, stosseSpartenAn, spartenLaeuft } from './sparte.js'
import { sparteGilt } from './sparte-kern.js'
import { favoritenZeilen, tagesstandAus, normTicker, MAX_FAVORITEN } from './favoriten-kern.js'
import { logWarn } from '../logger.js'

const json = (text, sonst) => { try { return JSON.parse(text) ?? sonst } catch { return sonst } }

/** Die Merkliste, zusammengeführt mit dem letzten fertigen Aktien-Radar-Lauf. */
export async function leseFavoriten(knex) {
    const favoriten = await knex('aktien_favoriten').orderBy('ticker')
    const lauf = await knex('coinradar_laeufe').where({ status: 'fertig', anlageklasse: 'aktien' }).orderBy('id', 'desc').first()
    const kopf = lauf ? { id: lauf.id, zeit: Number(lauf.beendetAm || lauf.erstelltAm) || null, referenz: json(lauf.quellenStand, {})?.referenz?.ticker || null } : null
    if (!favoriten.length) return { lauf: kopf, favoriten: [] }
    const tickers = favoriten.map((f) => f.ticker)

    const stamm = new Map()
    for (const t of tickers) {
        // Genau dieser Ticker, wie auf der Titel-Seite — die Suche fände bei «V» Hunderte.
        const [titel] = await leseStamm(knex, { anlageklasse: 'aktien', ticker: t })
        if (titel) stamm.set(t, titel)
    }
    const sparten = new Map(), tagesstaende = new Map()
    for (const t of await ladeMitKursSymbol(knex, tickers)) {
        sparten.set(t.zeile.ticker, sparteGilt(t.zeile, t.kursSymbol))
        tagesstaende.set(t.zeile.ticker, tagesstandAus(t.tagesstand, t.kursSymbol))
    }
    // Die Zeilen eines Laufs sind ein paar hundert; gesucht wird nach dem Ticker im JSON-Feld `boersen`.
    const zeilen = lauf
        ? (await knex('coinradar_zeilen').where('laufId', lauf.id)
            .select('symbol', 'status', 'huerdeGrund', 'rang', 'note', 'teilnoten', 'jeZeiteinheit', 'boersen'))
            .map((z) => ({ ...z, teilnoten: json(z.teilnoten, {}), jeZeiteinheit: json(z.jeZeiteinheit, {}), boersen: json(z.boersen, {}) }))
        : []
    return {
        lauf: kopf,
        // `chart`: Symbol je Börse, dessen Kerzen der Chart laden kann (`null` = keines, dann fehlt der Sprung)
        favoriten: favoritenZeilen(favoriten, { lauf, zeilen, stamm, sparten, tagesstaende })
            .map((f) => ({ ...f, chart: stamm.has(f.ticker) ? chartSymboleAus([stamm.get(f.ticker)])[0]?.symbole || null : null })),
    }
}

/**
 * Anheften. Liefert `{status, body}`.
 * Nur Titel des Stamms: ein frei getippter Ticker hätte keine Titel-Seite und keinen Chart.
 */
export async function fuegeFavoritHinzu(knex, roh, jetzt = Date.now()) {
    const ticker = normTicker(roh)
    if (!ticker) return { status: 400, body: { ok: false, error: 'ungültiger Ticker' } }
    const da = await knex('aktien_favoriten').where('ticker', ticker).first()
    if (da) return { status: 200, body: { ok: true, ticker, neu: false } }
    const titel = await knex('instrumente').where({ anlageklasse: 'aktien', ticker }).first('name')
    if (!titel) return { status: 404, body: { ok: false, grund: 'nichtImStamm', error: 'Titel nicht im Stamm' } }
    const anzahl = Number((await knex('aktien_favoriten').count({ n: '*' }).first())?.n) || 0
    if (anzahl >= MAX_FAVORITEN) return { status: 409, body: { ok: false, grund: 'voll', max: MAX_FAVORITEN, error: 'Merkliste voll' } }
    try {
        await knex('aktien_favoriten').insert({ ticker, name: titel.name || null, erstelltAm: jetzt })
    } catch (e) {
        // Doppelklick: die zweite Zeile scheitert am eindeutigen Ticker — das Ergebnis ist dasselbe.
        if (!(await knex('aktien_favoriten').where('ticker', ticker).first())) throw e
    }
    return { status: 200, body: { ok: true, ticker, neu: true } }
}

const fehler = (res, e, was) => {
    logWarn('aktien', `${was}: ${e.message}`)
    res.status(500).json({ ok: false, error: String(e?.message || e) })
}

export function setupAktienFavoritenRoutes(app) {
    app.get('/api/aktien/favoriten/ticker', async (req, res) => {
        try {
            res.json({ ok: true, ticker: (await getKnex()('aktien_favoriten').select('ticker').orderBy('ticker')).map((z) => z.ticker) })
        } catch (e) { fehler(res, e, 'Favoriten lesen') }
    })

    app.get('/api/aktien/favoriten', async (req, res) => {
        try {
            const knex = getKnex()
            const seite = await leseFavoriten(knex)
            stosseSpartenAn(knex, seite.favoriten.filter((f) => !f.sparte && f.status !== 'nichtImStamm').map((f) => f.ticker))
            res.json({ ok: true, ...seite, spartenLaeuft: spartenLaeuft() })
        } catch (e) { fehler(res, e, 'Favoriten lesen') }
    })

    app.post('/api/aktien/favoriten', async (req, res) => {
        try {
            const knex = getKnex()
            const { status, body } = await fuegeFavoritHinzu(knex, req.body?.ticker)
            // Die Sparte des neuen Favoriten gleich holen, falls sie fehlt (ein schlanker Abruf, nur mit erlaubter Quelle).
            if (body.ok && body.neu) fuelleSpartenImHintergrund(knex, [body.ticker])
            res.status(status).json(body)
        } catch (e) { fehler(res, e, 'Favorit anheften') }
    })

    app.delete('/api/aktien/favoriten/:ticker', async (req, res) => {
        try {
            const ticker = normTicker(req.params.ticker)
            if (!ticker) return res.status(400).json({ ok: false, error: 'ungültiger Ticker' })
            await getKnex()('aktien_favoriten').where('ticker', ticker).del()
            res.json({ ok: true, ticker })
        } catch (e) { fehler(res, e, 'Favorit entfernen') }
    })
}
