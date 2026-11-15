/**
 * Routen des Instrument-Stamms (Aktien-Integration, Phase 2).
 *
 *   GET  /api/aktien/stamm            Titel mit Listungen (Filter: anlageklasse, suche,
 *                                     handelsplatz, art, nurKryptoBoersen, grenze)
 *   GET  /api/aktien/stamm/stand      Zahlen und letzter Lauf dieses Prozesses
 *   POST /api/aktien/stamm/abgleich   jetzt abgleichen (liest nur öffentliche Listen)
 *   GET  /api/aktien/chart-symbole    Aktien, deren Kerzen der Chart laden kann (Symbol je Börse)
 *   GET  /api/aktien/kontext?symbol=  ist das Symbol ein Aktien-Future? Ticker, Name, Börse und Zahlentermine
 *                                     für den Chart (`{ aktie: null }` = Coin)
 *   GET  /api/aktien/marktlage        Umfeld für Aktien: Index gegen 200-Tage-Linie, VIX, Sektoren, Zinsen,
 *                                     Dollar, Breite im eigenen Feld (Yahoo, 30 min im Speicher)
 *   GET  /api/aktien/titel/:ticker    Titel-Seite: Profil, Kurs, Kennzahlen, Analysten, Ertragsverlauf
 *                                     (Yahoo, hinter dem Quellen-Schalter; 15 min im Speicher)
 *   GET  /api/aktien/titel/:ticker/einreichungen   Einreichungen bei der SEC (EDGAR): Börsenprospekt, Angebote,
 *                                     Insider-Meldungen; nur mit eigener Kontaktangabe, 6 h im Speicher
 *   GET  /api/aktien/titel/:ticker/bewegung   gemerkte Recherche «was hat den Kurs bewegt» (liest nur)
 *   POST /api/aktien/titel/:ticker/bewegung   Recherche jetzt holen (Perplexity, kostet — nur auf Knopfdruck)
 */
import { getKnex } from '../database.js'
import { gleicheAb, letzterLauf, leseStamm, stammZahlen, HANDELSPLAETZE } from './stamm.js'
import { chartSymboleAus } from './chart-symbole.js'
import { holeMarktlage } from './marktlage.js'
import { aktienKontext } from './kontext.js'
import { ausZusammenfassung, kursLinie, bewegungsFrage } from './titel-kern.js'
import { holeZusammenfassung, holeChart, NichtGefunden, Gebremst } from '../newcomer-radar/kursquelle.js'
import { ladeTitel, namensWarnung } from './titel-stamm.js'
import { boersengangDatum } from '../newcomer-radar/kursquelle-kern.js'
import { sendeWennAus, istAus } from '../quellen/aus.js'
import { ladeLlmConfig, merkeKiGuthaben, istGuthabenFehler } from '../llm.js'
import { rechercheThema } from '../news-recherche.js'
import { pruefeEinordnung } from '../coin-radar/einordnung.js'
import { logWarn } from '../logger.js'
import { holeEinreichungen, EdgarAbgelehnt, EdgarGebremst } from './edgar.js'

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/
const TITEL_MS = 15 * 60_000
const BEWEGUNG_MS = 6 * 60 * 60_000
const titelCache = new Map()      // ticker → { zeit, wert } | { laeuft: Promise }
const bewegungCache = new Map()   // ticker → { zeit, wert }
const bewegungLaeuft = new Map()  // ticker → Promise des laufenden (bezahlten) Abrufs

async function baueTitelSeite(ticker) {
    const gefunden = await ladeTitel(getKnex(), ticker)
    if (!gefunden) return { ok: false, grund: 'unbekannt' }
    const { titel, kursSymbol, zuordnung } = gefunden
    const kopf = {
        ok: true,
        titel: { ticker: titel.ticker, name: titel.name, unterart: titel.unterart, listungen: titel.listungen },
        chart: chartSymboleAus([titel])[0]?.symbole || null,
        kursSymbol,
    }
    if (!kursSymbol) return { ...kopf, daten: null, grund: 'keinKursSymbol' }
    try {
        // Kennzahlen und Kurslinie getrennt: fällt eines aus, bleibt das andere.
        const [zus, chart] = await Promise.allSettled([holeZusammenfassung(kursSymbol), holeChart(kursSymbol)])
        for (const r of [zus, chart]) if (r.status === 'rejected' && istAus(r.reason)) throw r.reason
        if (zus.status === 'rejected' && chart.status === 'rejected') throw zus.reason
        const daten = zus.status === 'fulfilled' ? ausZusammenfassung(zus.value) : null
        const quellenName = (chart.status === 'fulfilled' ? chart.value.meta.name : null) || daten?.profil?.name || null
        return {
            ...kopf,
            daten,
            nameQuelle: namensWarnung(titel.name, quellenName, ticker),
            datenFehler: zus.status === 'rejected' ? String(zus.reason?.message || zus.reason) : null,
            linie: chart.status === 'fulfilled' ? kursLinie(chart.value.kerzen) : [],
            // «Junge Firma» und Haltefrist hängen daran: dieselbe Regel wie im Newcomer-Lauf (FUN-F-014).
            ipoDatum: chart.status === 'fulfilled' ? boersengangDatum(zuordnung, chart.value.meta.ipoDatum) : null,
            stand: Date.now(),
        }
    } catch (e) {
        if (e instanceof NichtGefunden) return { ...kopf, daten: null, grund: 'nichtGefunden' }
        if (e instanceof Gebremst) return { ...kopf, daten: null, grund: 'gebremst' }
        throw e
    }
}

const BEWEGUNG_DIENSTE = {
    ladeTitel: (ticker) => ladeTitel(getKnex(), ticker),
    ladeLlmConfig, rechercheThema, merkeKiGuthaben,
}

/**
 * Recherche «was hat den Kurs bewegt» holen (Perplexity, kostet). Liefert
 * `{status, body}` für die Route.
 *
 * Solange ein Abruf für den Ticker läuft, bekommt jeder weitere Aufruf
 * DASSELBE Versprechen: ein Doppelklick oder ein zweiter Tab löst keinen
 * zweiten bezahlten Abruf aus (Audit SEC-S-004). Die Sprache des ersten
 * Aufrufs gilt für alle, die sich anhängen.
 * @param {object} [dienste]  nur der Selbsttest reicht Attrappen herein — er löst nie einen echten Abruf aus
 */
export function holeBewegung(ticker, sprache = 'de', dienste = BEWEGUNG_DIENSTE) {
    const laeuft = bewegungLaeuft.get(ticker)
    if (laeuft) return laeuft
    const abruf = recherchiereBewegung(ticker, sprache, dienste).finally(() => {
        if (bewegungLaeuft.get(ticker) === abruf) bewegungLaeuft.delete(ticker)
    })
    bewegungLaeuft.set(ticker, abruf)
    return abruf
}

async function recherchiereBewegung(ticker, sprache, d) {
    const gefunden = await d.ladeTitel(ticker)
    if (!gefunden) return { status: 404, body: { ok: false, error: 'Titel nicht im Stamm' } }
    const cfg = await d.ladeLlmConfig({ provider: 'perplexity', model: 'sonar' })
    if (!cfg.apiKey) return { status: 200, body: { ok: false, grund: 'schluesselFehlt' } }
    let r
    try {
        r = await d.rechercheThema({
            thema: ticker,
            frage: bewegungsFrage({ name: gefunden.titel.name, symbol: gefunden.kursSymbol || ticker, sprache }),
            apiKey: cfg.apiKey, modell: 'sonar', timeoutMs: 60000, aktualitaet: 'week',
            ausloeser: 'manuell', funktion: 'aktien-titel',
        })
        d.merkeKiGuthaben('perplexity').catch(() => { })
    } catch (e) {
        if (istGuthabenFehler(e.message)) await d.merkeKiGuthaben('perplexity', e.message).catch(() => { })
        throw e
    }
    // Wie überall: keine Prognosen, keine Empfehlungen — auch nicht aus der Websuche.
    const geprueft = pruefeEinordnung({ text: r.text })
    if (!geprueft.ok) return { status: 200, body: { ok: false, grund: 'verworfen', warum: geprueft.grund } }
    const wert = {
        text: geprueft.text,
        quellen: (r.citations || []).filter((u) => /^https?:\/\//.test(u)).slice(0, 12),
        zeit: Date.now(), kiGeneriert: true,
    }
    bewegungCache.set(ticker, { zeit: Date.now(), wert })
    return { status: 200, body: { ok: true, bewegung: wert } }
}

const ARTEN = ['perp', 'token-spot', 'broker-spot']
const KLASSEN = ['aktien', 'sonstige']
const fehler = (res, e) => res.status(500).json({ ok: false, error: String(e?.message || e) })

export function setupAktienRoutes(app) {
    app.get('/api/aktien/stamm', async (req, res) => {
        try {
            const q = req.query
            const titel = await leseStamm(getKnex(), {
                anlageklasse: KLASSEN.includes(q.anlageklasse) ? q.anlageklasse : 'aktien',
                suche: typeof q.suche === 'string' ? q.suche.slice(0, 40) : '',
                handelsplatz: HANDELSPLAETZE.includes(q.handelsplatz) ? q.handelsplatz : undefined,
                art: ARTEN.includes(q.art) ? q.art : undefined,
                nurKryptoBoersen: q.nurKryptoBoersen === '1',
                grenze: q.grenze,
            })
            res.json({ ok: true, titel })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/aktien/stamm/stand', async (req, res) => {
        try {
            res.json({ ok: true, ...(await stammZahlen(getKnex())), letzterLauf: letzterLauf() })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/aktien/chart-symbole', async (req, res) => {
        try {
            const titel = await leseStamm(getKnex(), { anlageklasse: 'aktien', art: 'perp', grenze: 5000 })
            res.json({ ok: true, titel: chartSymboleAus(titel) })
        } catch (e) { fehler(res, e) }
    })

    // Auskunft für den Chart (Zahlen-Marker, Sitzungen). Splits bleiben draussen — die Kerzen kommen schon umgerechnet.
    app.get('/api/aktien/kontext', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!/^[A-Z0-9_.\-]{2,30}$/.test(symbol)) return res.status(400).json({ ok: false, error: 'ungültiges Symbol' })
        try {
            // Das Panel kann an jeder Chart-Börse hängen, nicht nur an der Marktdatenquelle (BUG-K-001).
            const k = await aktienKontext(symbol, { boerse: 'jede' })
            if (!k) return res.json({ ok: true, aktie: null })
            res.json({
                ok: true,
                aktie: {
                    symbol, ticker: k.ticker, name: k.name, boerse: k.boerse,
                    // null = unbekannt (Quelle aus, Abruf gescheitert) — der Grund steht daneben
                    termine: k.termine ? {
                        naechster: k.termine.naechster ? { zeit: k.termine.naechster.zeit, geschaetzt: k.termine.naechster.geschaetzt === true } : null,
                        vergangene: k.termine.vergangene || [],
                    } : null,
                    termineGrund: k.termine ? null : (k.termineGrund || 'abrufFehlgeschlagen'),
                },
            })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/aktien/marktlage', async (req, res) => {
        try {
            res.json(await holeMarktlage({ neu: req.query.neu === '1' }))
        } catch (e) {
            if (sendeWennAus(res, e)) return
            if (e instanceof Gebremst) return res.json({ ok: false, grund: 'gebremst' })
            logWarn('aktien', `Marktlage: ${e.message}`)
            res.status(502).json({ ok: false, error: String(e?.message || e) })
        }
    })

    app.get('/api/aktien/titel/:ticker', async (req, res) => {
        const ticker = String(req.params.ticker || '').toUpperCase()
        if (!TICKER_RE.test(ticker)) return res.status(400).json({ ok: false, error: 'ungültiger Ticker' })
        try {
            const c = titelCache.get(ticker)
            if (c?.wert && Date.now() - c.zeit < TITEL_MS && req.query.neu !== '1') return res.json(c.wert)
            // Gleichzeitige Aufrufe teilen sich einen Abruf.
            const laeuft = c?.laeuft || baueTitelSeite(ticker)
            titelCache.set(ticker, { ...c, laeuft })
            let wert
            try { wert = await laeuft } finally { const d = titelCache.get(ticker); if (d?.laeuft === laeuft) titelCache.set(ticker, { zeit: d.zeit, wert: d.wert }) }
            // Nur ein vollständiges Ergebnis wird gemerkt — ein gebremster Abruf soll beim nächsten Mal neu fragen.
            if (wert.ok && wert.daten) titelCache.set(ticker, { zeit: Date.now(), wert })
            res.json(wert)
        } catch (e) {
            if (sendeWennAus(res, e)) return
            logWarn('aktien', `Titel ${ticker}: ${e.message}`)
            res.status(502).json({ ok: false, error: String(e?.message || e) })
        }
    })

    // Eigene Route, getrennt von den Yahoo-Daten: fällt EDGAR aus, bleibt die Titel-Seite stehen.
    app.get('/api/aktien/titel/:ticker/einreichungen', async (req, res) => {
        const ticker = String(req.params.ticker || '').toUpperCase()
        if (!TICKER_RE.test(ticker)) return res.status(400).json({ ok: false, error: 'ungültiger Ticker' })
        try {
            const gefunden = await ladeTitel(getKnex(), ticker)
            if (!gefunden) return res.json({ ok: false, grund: 'unbekannt' })
            // Das Kurssymbol trägt bei Nicht-US-Titeln den Börsen-Anhang (ASML.AS) — daran erkennt EDGAR sie.
            // Ohne Kurssymbol (Newcomer-Lauf fand nichts, fremde Region) wird nicht unter dem blossen Ticker gesucht.
            if (!gefunden.kursSymbol) return res.json({ ok: true, gefuehrt: false, grund: 'keinUsTicker' })
            res.json(await holeEinreichungen(gefunden.kursSymbol, { neu: req.query.neu === '1' }))
        } catch (e) {
            if (sendeWennAus(res, e)) return
            if (e instanceof EdgarGebremst) return res.json({ ok: false, grund: 'gebremst' })
            if (e instanceof EdgarAbgelehnt) return res.json({ ok: false, grund: 'abgelehnt' })
            logWarn('aktien', `Einreichungen ${ticker}: ${e.message}`)
            res.status(502).json({ ok: false, error: String(e?.message || e) })
        }
    })

    app.get('/api/aktien/titel/:ticker/bewegung', (req, res) => {
        const c = bewegungCache.get(String(req.params.ticker || '').toUpperCase())
        res.json({ ok: true, bewegung: c && Date.now() - c.zeit < BEWEGUNG_MS ? c.wert : null })
    })

    app.post('/api/aktien/titel/:ticker/bewegung', async (req, res) => {
        const ticker = String(req.params.ticker || '').toUpperCase()
        if (!TICKER_RE.test(ticker)) return res.status(400).json({ ok: false, error: 'ungültiger Ticker' })
        try {
            const { status, body } = await holeBewegung(ticker, req.body?.sprache === 'en' ? 'en' : 'de')
            res.status(status).json(body)
        } catch (e) {
            logWarn('aktien', `Bewegung ${ticker}: ${e.message}`)
            res.status(502).json({ ok: false, error: String(e?.message || e) })
        }
    })

    app.post('/api/aktien/stamm/abgleich', async (req, res) => {
        try {
            const r = await gleicheAb()
            // Die Listen der neuen/entfallenen Listungen können lang sein — die Seite braucht nur Zahlen.
            res.json({ ok: r.ok, zeit: r.zeit, stand: r.stand, titel: r.titel, listungen: r.listungen,
                neu: r.neu?.slice(0, 50) || [], neuAnzahl: r.neu?.length || 0, wegAnzahl: r.weg?.length || 0, gebremst: r.gebremst || [] })
        } catch (e) { fehler(res, e) }
    })
}
