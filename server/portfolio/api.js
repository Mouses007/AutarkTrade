/**
 * Spot-Portfolio: Routen unter /api/portfolio.
 *
 *   GET    /uebersicht                 Stand aus der DB + Kurse (kein Börsenabruf)
 *   POST   /abruf            {quelle?} Abruf im Hintergrund starten (202)
 *   GET    /abruf                      läuft gerade einer?
 *   GET    /bewegungen       ?quelle&asset&arten&offen&vor&limit
 *   PUT    /bewegungen/:id   {einordnung}
 *   POST   /bewegungen/sammel {quelle, einordnung, art?}
 *   GET    /wallets
 *   POST   /wallets          {typ, name}
 *   PUT    /wallets/:id      {name}
 *   DELETE /wallets/:id
 *   POST   /wallets/:id/adressen {eingabe, netze?, label?}
 *   PUT    /adressen/:id     {netze?, label?}
 *   DELETE /adressen/:id
 *   POST   /erkenne          {eingabe}  nur prüfen, nichts speichern
 *   GET    /schluessel                 welche Zugänge hinterlegt sind (nie der Wert)
 *   POST   /schluessel       {name, wert}
 *   DELETE /schluessel/:name
 *   POST   /bitpanda/test    {wert?}
 *   POST   /import           {text, nurPruefen?}  Datei-Import (Format: import.js)
 *   DELETE /import/:ort                    einen importierten Ort entfernen
 *   GET    /steuer?jahr=                   Steuerjahr (Vermögen 31.12., Einkommen, Abgänge, Kriterien)
 *   GET    /steuer.csv?jahr=               dasselbe als CSV
 *   GET    /steuer/bericht?jahr=           dasselbe als Dokument zum Drucken / PDF (+ bericht.css, bericht.js)
 *   GET    /steuer/jahre                   Jahre mit Bewegungen
 *   PUT    /steuerkurs       {jahr, asset, chf|null, quelle}
 *   PUT    /futures-stichtag {jahr, boerse, usd|null, quelle}  Futures-Guthaben 31.12. laut Auszug
 *   PUT    /totalverlust     {asset, an, abJahr}  Coin als Totalverlust markieren (raus aus Portfolio, Steuer ab abJahr)
 *   GET    /totalverluste                  Seite Totalverluste (Zeilen + Statistik)
 *   PUT    /kanton           {kz|null}     Wohnkanton für den Steuerbericht
 *   PUT    /quellen/genutzt-bis {quelle, datum|null}  Ort nicht mehr genutzt ab (raus aus aktueller Ansicht)
 *   POST   /estv/:jahr                     ESTV-Kursliste eines Jahres neu holen
 *   PUT    /spam             {asset, kontrakt?, spam: true|false|null}  Spam von Hand je Vertrag (null = Regel)
 */

import crypto from 'crypto'
import { getKnex } from '../database.js'
import { encrypt } from '../crypto.js'
import { erkenneEingabe, kurzAdresse, WALLET_TYPEN, EVM_NETZE, EVM_VORGABE } from '../../shared/portfolio-adresse.js'
import { berechneUebersicht } from './uebersicht.js'
import { berechneBilanz, futuresKontenGemerkt } from './bilanz.js'
import { setzeFuturesStichtag } from './futures-steuer.js'
import { setzeTotalverlust } from './totalverlust.js'
import { setzeSpam } from './spam.js'
import { totalverlustUebersicht } from './totalverlust-seite.js'
import { steuerBerichtHtml, BERICHT_CSS, BERICHT_JS } from './steuer-bericht.js'
import fs from 'fs'
import { importiereKursliste, kurslisteStand } from './estv-kursliste.js'
import { kanton as kantonVon } from '../../shared/steuer-kantone.js'
import { BOERSEN } from './futures-rechnung.js'
import { rufeAb, laufStand, bewerteAlles } from './abruf.js'
import { testeBitpanda } from './quellen.js'
import { ARTEN, FIAT } from './normal.js'
import { leseImportCsv, importQuelle } from './import.js'
import { berechneSteuerjahr, steuerCsv, RECHTSHINWEIS } from './steuer.js'
import { ketteNorm, fxHeute } from './kurse.js'

const SCHLUESSEL_NAMEN = ['bitpanda', 'etherscan']
const EINORDNUNGEN = ['transfer', 'kauf', 'einkommen', 'ignorieren']
/** „Zu prüfen": Ein-/Ausgänge ohne erkannten Gegenpart und Unbekanntes. Airdrops sind ihrer Art nach klar. */
const OFFENE_ARTEN = ['einzahlung', 'auszahlung', 'sonstiges']

// Version für den Kopf des Steuerberichts (einmal beim Laden gelesen).
const APP_VERSION = (() => {
    try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version } catch { return '' }
})()

const fehler = (res, e, code = 500) => res.status(code).json({ ok: false, error: String(e?.message || e) })
const fingerabdruck = (s) => crypto.createHash('sha256').update(String(s).trim()).digest('hex')

export function setupPortfolioRoutes(app) {
    app.get('/api/portfolio/uebersicht', async (req, res) => {
        try { res.json({ ok: true, ...(await berechneUebersicht()) }) } catch (e) { fehler(res, e) }
    })

    // Futures-Konten (Handelskapital) — die Übersicht zeigt sie als eigene Gruppe.
    app.get('/api/portfolio/futures', async (req, res) => {
        try {
            const fx = await fxHeute()
            const konten = (await futuresKontenGemerkt()).map((f) => ({ ...f, chf: f.usd != null ? f.usd * fx.chf : null }))
            res.json({ ok: true, konten, chf: konten.reduce((s, f) => s + (f.chf || 0), 0) })
        } catch (e) { fehler(res, e) }
    })

    // Bilanz zur Info: Bargeld rein ↔ Wert heute (Spot + Futures-Konten).
    app.get('/api/portfolio/bilanz', async (req, res) => {
        try {
            const u = await berechneUebersicht({ ohneVerlauf: true })
            res.json({ ok: true, ...(await berechneBilanz({ spotChf: u.gesamt.chf, usdChf: u.fx.chf })) })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/portfolio/abruf', async (req, res) => {
        const nur = req.body?.quelle ? String(req.body.quelle) : null
        if (laufStand().laeuft) return res.status(202).json({ ok: true, schonAktiv: true })
        rufeAb({ nur }).catch((e) => console.warn(' -> Portfolio-Abruf:', e.message))
        res.status(202).json({ ok: true, gestartet: true })
    })
    app.get('/api/portfolio/abruf', (req, res) => res.json({ ok: true, ...laufStand() }))

    app.get('/api/portfolio/bewegungen', async (req, res) => {
        try {
            const k = getKnex()
            const q = k('portfolio_bewegungen').select('id', 'quelle', 'zeit', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge',
                'gebuehrAsset', 'gebuehrMenge', 'txHash', 'kette', 'kontrakt', 'transferMit', 'transferSicher', 'einordnung', 'chfWert', 'chfQuelle')
            if (req.query.quelle) q.where('quelle', String(req.query.quelle))
            if (req.query.asset) q.where((w) => w.where('asset', String(req.query.asset).toUpperCase()).orWhere('gegenAsset', String(req.query.asset).toUpperCase()))
            if (req.query.arten) {
                const arten = String(req.query.arten).split(',').filter((a) => ARTEN.includes(a))
                if (arten.length) q.whereIn('art', arten)
            }
            if (req.query.offen === '1') {
                q.whereNull('einordnung').whereNull('transferMit')
                    .whereIn('art', OFFENE_ARTEN).whereNotIn('asset', FIAT)
            }
            if (req.query.vor) q.where('zeit', '<', Number(req.query.vor))
            const limit = Math.min(Number(req.query.limit) || 100, 500)
            const zeilen = await q.orderBy('zeit', 'desc').orderBy('id', 'desc').limit(limit)
            const offen = await k('portfolio_bewegungen').whereNull('einordnung').whereNull('transferMit')
                .whereIn('art', OFFENE_ARTEN).whereNotIn('asset', FIAT).count({ n: '*' }).first()
            res.json({ ok: true, zeilen, offen: Number(offen?.n || 0), weitere: zeilen.length === limit })
        } catch (e) { fehler(res, e) }
    })

    // Alle offenen Zeilen EINER Quelle (optional nur eine Richtung) auf einmal einordnen.
    app.post('/api/portfolio/bewegungen/sammel', async (req, res) => {
        try {
            const e = req.body?.einordnung
            const quelle = String(req.body?.quelle || '')
            if (!EINORDNUNGEN.includes(e) || !quelle) return fehler(res, 'Quelle und Einordnung nötig', 400)
            const q = getKnex()('portfolio_bewegungen').where('quelle', quelle).whereNull('einordnung').whereNull('transferMit').whereIn('art', OFFENE_ARTEN).whereNotIn('asset', FIAT)
            if (req.body?.art && OFFENE_ARTEN.includes(req.body.art)) q.where('art', req.body.art)
            const n = await q.update({ einordnung: e })
            res.json({ ok: true, geaendert: n })
        } catch (err) { fehler(res, err) }
    })

    app.put('/api/portfolio/bewegungen/:id', async (req, res) => {
        try {
            const e = req.body?.einordnung
            // `migration` (Umstellung, kein Verkauf — z. B. CHSB→BORG) nur für einen Tausch
            // und nur einzeln, nie per Sammel-Einordnung.
            if (e !== null && !EINORDNUNGEN.includes(e) && e !== 'migration') return fehler(res, 'Unbekannte Einordnung', 400)
            const z = await getKnex()('portfolio_bewegungen').where('id', Number(req.params.id)).first('art', 'gegenAsset')
            if (!z) return fehler(res, 'Bewegung nicht gefunden', 404)
            if (e === 'migration' && !(z.art === 'tausch' && z.gegenAsset)) return fehler(res, 'Umstellung nur für einen Tausch', 400)
            await getKnex()('portfolio_bewegungen').where('id', Number(req.params.id)).update({ einordnung: e })
            res.json({ ok: true })
        } catch (err) { fehler(res, err) }
    })

    // ── Wallets ──
    app.get('/api/portfolio/wallets', async (req, res) => {
        try {
            const k = getKnex()
            const wallets = await k('portfolio_wallets').select('*').orderBy([{ column: 'sortierung' }, { column: 'id' }])
            const adressen = await k('portfolio_adressen').select('id', 'walletId', 'kette', 'art', 'anzeige', 'netze', 'label', 'importOrte', 'liveAb').orderBy('id')
            const importOrte = (await k('portfolio_quellen').where('quelle', 'like', 'i:%').select('quelle', 'letzteBewegung'))
                .map((z) => ({ ort: z.quelle.slice(2), bis: Number(z.letzteBewegung) || null }))
            res.json({
                ok: true, typen: WALLET_TYPEN, netze: EVM_NETZE, netzVorgabe: EVM_VORGABE, importOrte,
                wallets: wallets.map((w) => ({
                    ...w,
                    adressen: adressen.filter((a) => a.walletId === w.id).map((a) => ({
                        ...a, netze: JSON.parse(a.netze || '[]'), importOrte: JSON.parse(a.importOrte || '[]'), liveAb: Number(a.liveAb) || null,
                    })),
                })),
            })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/portfolio/wallets', async (req, res) => {
        try {
            const typ = String(req.body?.typ || '')
            if (!WALLET_TYPEN[typ]) return fehler(res, 'Unbekannter Wallet-Typ', 400)
            const name = String(req.body?.name || '').trim().slice(0, 60) || WALLET_TYPEN[typ].name
            const [id] = await getKnex()('portfolio_wallets').insert({ typ, name, sortierung: Date.now() % 1e9, createdAt: Date.now() }).returning('id')
            res.json({ ok: true, id: typeof id === 'object' ? id.id : id })
        } catch (e) { fehler(res, e) }
    })

    app.put('/api/portfolio/wallets/:id', async (req, res) => {
        try {
            const name = String(req.body?.name || '').trim().slice(0, 60)
            if (!name) return fehler(res, 'Name fehlt', 400)
            await getKnex()('portfolio_wallets').where('id', Number(req.params.id)).update({ name })
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.delete('/api/portfolio/wallets/:id', async (req, res) => {
        try {
            const k = getKnex()
            const id = Number(req.params.id)
            const adr = await k('portfolio_adressen').where('walletId', id).select('id')
            await k.transaction(async (trx) => {
                for (const a of adr) await loescheAdresse(trx, a.id)
                await trx('portfolio_wallets').where('id', id).del()
            })
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/portfolio/erkenne', (req, res) => {
        const e = erkenneEingabe(req.body?.eingabe)
        // Ein abgelehnter Wert wird nicht zurückgespiegelt.
        res.json({ ok: true, erkannt: { ...e, wert: undefined } })
    })

    app.post('/api/portfolio/wallets/:id/adressen', async (req, res) => {
        try {
            const k = getKnex()
            const walletId = Number(req.params.id)
            if (!(await k('portfolio_wallets').where('id', walletId).first())) return fehler(res, 'Wallet nicht gefunden', 404)
            const e = erkenneEingabe(req.body?.eingabe)
            if (!e.ok) return fehler(res, e.text, 400)
            const fp = fingerabdruck(e.kette === 'evm' ? e.wert.toLowerCase() : e.wert)
            if (await k('portfolio_adressen').where('fingerabdruck', fp).first()) return fehler(res, 'Diese Adresse ist schon eingetragen.', 409)
            let netze = null
            if (e.kette === 'evm') {
                const gewaehlt = Array.isArray(req.body?.netze) ? req.body.netze.map(Number) : EVM_VORGABE
                netze = JSON.stringify(gewaehlt.filter((n) => EVM_NETZE.some((x) => x.id === n)))
            }
            const [id] = await k('portfolio_adressen').insert({
                walletId, kette: e.kette, art: e.art, adresse: encrypt(e.wert), anzeige: kurzAdresse(e.wert, e.art === 'adresse' ? 6 : 8, 4),
                fingerabdruck: fp, netze, label: String(req.body?.label || '').trim().slice(0, 40) || null, createdAt: Date.now(),
            }).returning('id')
            const adressId = typeof id === 'object' ? id.id : id
            // Gleich lesen, damit die Karte nicht leer bleibt.
            if (!laufStand().laeuft) rufeAb({ nur: `a${adressId}` }).catch(() => {})
            res.json({ ok: true, id: adressId, erkannt: { ...e, wert: undefined } })
        } catch (err) { fehler(res, err) }
    })

    app.put('/api/portfolio/adressen/:id', async (req, res) => {
        try {
            const upd = {}
            if (Array.isArray(req.body?.netze)) upd.netze = JSON.stringify(req.body.netze.map(Number).filter((n) => EVM_NETZE.some((x) => x.id === n)))
            if (req.body?.label !== undefined) upd.label = String(req.body.label || '').trim().slice(0, 40) || null
            // Übergabe Import → Live
            if (req.body?.importOrte !== undefined) {
                const orte = Array.isArray(req.body.importOrte) ? req.body.importOrte.map(String).filter(Boolean) : []
                upd.importOrte = orte.length ? JSON.stringify(orte) : null
                upd.liveAb = orte.length ? (Number(req.body.liveAb) || Date.now()) : null
            }
            if (!Object.keys(upd).length) return fehler(res, 'Nichts zu ändern', 400)
            const k = getKnex()
            const id = Number(req.params.id)
            await k.transaction(async (trx) => {
                await trx('portfolio_adressen').where('id', id).update(upd)
                // Schon live gelesene Bewegungen bis zum Stichtag stehen im Import —
                // weg damit, sonst zählen sie doppelt.
                if (upd.liveAb) {
                    const ids = (await trx('portfolio_bewegungen').where('quelle', `a${id}`).where('zeit', '<=', upd.liveAb).select('id')).map((z) => z.id)
                    for (let i = 0; i < ids.length; i += 500) {
                        await trx('portfolio_bewegungen').whereIn('transferMit', ids.slice(i, i + 500)).update({ transferMit: null, transferSicher: null })
                        await trx('portfolio_bewegungen').whereIn('id', ids.slice(i, i + 500)).del()
                    }
                }
            })
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.delete('/api/portfolio/adressen/:id', async (req, res) => {
        try {
            await getKnex().transaction((trx) => loescheAdresse(trx, Number(req.params.id)))
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    // ── Datei-Import ──
    app.post('/api/portfolio/import', async (req, res) => {
        try {
            const text = String(req.body?.text || '')
            if (!text.trim()) return fehler(res, 'Datei ist leer', 400)
            if (text.length > 20 * 1024 * 1024) return fehler(res, 'Datei zu gross (max. 20 MB)', 400)
            const r = leseImportCsv(text)
            const orte = Object.entries(r.orte).map(([ort, o]) => ({ ort, quelle: importQuelle(ort), ...o }))
            if (r.fehler.length) return res.json({ ok: false, fehler: r.fehler.slice(0, 200), anzahlFehler: r.fehler.length, zeilen: r.zeilen.length, orte })
            const k = getKnex()
            // Vorschau: Bestand je Ort, wie er nach dem Import aussähe — und ob ein Ort schon da ist.
            const vorhanden = new Set((await k('portfolio_quellen').where('quelle', 'like', 'i:%').select('quelle')).map((z) => z.quelle))
            const vorschau = orte.map((o) => {
                const s = saldoJeAsset(r.zeilen.filter((z) => z.ort === o.ort))
                const bestand = [...s.entries()].filter(([, e]) => Math.abs(e.menge) > 1e-9).map(([asset, e]) => ({ asset, menge: e.menge }))
                // Negatives Fiat heisst nur: die Bankeinzahlungen stehen nicht in der Datei — kein Loch.
                return { ...o, vorhanden: vorhanden.has(o.quelle), bestand, negativ: bestand.filter((b) => b.menge < -1e-7 && !FIAT.includes(b.asset)) }
            })
            if (req.body?.nurPruefen) return res.json({ ok: true, vorschau, zeilen: r.zeilen.length })

            const jetzt = Date.now()
            let neu = 0
            const ergebnis = []
            await k.transaction(async (trx) => {
                // „Ersetzen": die Orte der Datei vorher leeren — sonst überspringt der
                // Import korrigierte Zeilen mit bekannter externe_id. Eigene Einordnungen
                // in der App für diese Orte gehen dabei verloren (die UI sagt es).
                if (req.body?.ersetzen) {
                    for (const o of orte) {
                        const ids = (await trx('portfolio_bewegungen').where('quelle', o.quelle).select('id')).map((z) => z.id)
                        for (let i = 0; i < ids.length; i += 500) {
                            await trx('portfolio_bewegungen').whereIn('transferMit', ids.slice(i, i + 500)).update({ transferMit: null, transferSicher: null })
                        }
                        await trx('portfolio_bewegungen').where('quelle', o.quelle).del()
                    }
                }
                for (let i = 0; i < r.zeilen.length; i += 200) {
                    const teil = r.zeilen.slice(i, i + 200).map((z) => ({
                        quelle: z.quelle, externeId: z.externeId, zeit: z.zeit, art: z.art, asset: z.asset, menge: z.menge,
                        gegenAsset: z.gegenAsset, gegenMenge: z.gegenMenge, gebuehrAsset: z.gebuehrAsset, gebuehrMenge: z.gebuehrMenge,
                        txHash: z.txHash, kette: z.kette, kontrakt: z.kontrakt, einordnung: z.einordnung,
                        chfWert: z.chfWert, chfQuelle: z.chfWert != null ? 'Import' : null,
                        sicherheit: z.sicherheit, notiz: z.notiz, createdAt: jetzt,
                    }))
                    const vorher = await trx('portfolio_bewegungen').whereIn('quelle', [...new Set(teil.map((t) => t.quelle))]).count({ n: '*' }).first()
                    await trx('portfolio_bewegungen').insert(teil).onConflict(['quelle', 'externeId']).ignore()
                    const nachher = await trx('portfolio_bewegungen').whereIn('quelle', [...new Set(teil.map((t) => t.quelle))]).count({ n: '*' }).first()
                    neu += Number(nachher.n) - Number(vorher.n)
                }
                for (const o of orte) {
                    const negativ = await bestandAusImport(trx, o.quelle)
                    const n = await trx('portfolio_bewegungen').where('quelle', o.quelle).count({ n: '*' }).first()
                    await trx('portfolio_quellen').insert({
                        quelle: o.quelle, letzterAbruf: jetzt, letzteBewegung: o.bis, status: 'ok',
                        meldung: `Import: ${n.n} Bewegungen${negativ.length ? ` · negativ: ${negativ.join(', ')}` : ''}`,
                        stand: JSON.stringify({ art: 'import', vollstaendig: true, ort: o.ort }),
                    }).onConflict('quelle').merge()
                    ergebnis.push({ ort: o.ort, negativ })
                }
            })
            // CHF-Werte der neuen Zeilen ohne Wert sofort nachziehen, nicht erst
            // 400 je Abruf — sonst fehlt das Einkommen in der Steuer-Ansicht.
            bewerteAlles().catch((e) => console.warn(' -> Portfolio-Bewertung:', e.message))
            res.json({ ok: true, neu, uebersprungen: r.zeilen.length - neu, orte: ergebnis })
        } catch (e) { fehler(res, e) }
    })

    app.delete('/api/portfolio/import/:ort', async (req, res) => {
        try {
            const quelle = importQuelle(req.params.ort)
            const k = getKnex()
            await k.transaction(async (trx) => {
                const ids = (await trx('portfolio_bewegungen').where('quelle', quelle).select('id')).map((z) => z.id)
                for (let i = 0; i < ids.length; i += 500) {
                    await trx('portfolio_bewegungen').whereIn('transferMit', ids.slice(i, i + 500)).update({ transferMit: null, transferSicher: null })
                }
                await trx('portfolio_bewegungen').where('quelle', quelle).del()
                await trx('portfolio_bestaende').where('quelle', quelle).del()
                await trx('portfolio_quellen').where('quelle', quelle).del()
            })
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    // ── Steuer ──
    app.get('/api/portfolio/steuer/jahre', async (req, res) => {
        try {
            const z = await getKnex()('portfolio_bewegungen').min({ von: 'zeit' }).first()
            const erstes = z?.von ? new Date(Number(z.von)).getUTCFullYear() : new Date().getFullYear()
            const jahre = []
            for (let j = new Date().getFullYear(); j >= erstes; j--) jahre.push(j)
            res.json({ ok: true, jahre })
        } catch (e) { fehler(res, e) }
    })
    app.get('/api/portfolio/steuer', async (req, res) => {
        try {
            const jahr = Number(req.query.jahr) || new Date().getFullYear() - 1
            res.json({ ok: true, ...(await berechneSteuerjahr(jahr)) })
        } catch (e) { fehler(res, e) }
    })
    // Steuerbericht als eigenes Dokument (Druck / PDF) — Stil und Druckknopf als
    // eigene Dateien, weil die CSP Inline-Skripte sperrt.
    app.get('/api/portfolio/steuer/bericht', async (req, res) => {
        try {
            const jahr = Number(req.query.jahr) || new Date().getFullYear() - 1
            const [s, tv] = await Promise.all([berechneSteuerjahr(jahr), totalverlustUebersicht()])
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.send(steuerBerichtHtml(s, { erstellt: Date.now(), version: APP_VERSION, totalverluste: tv.zeilen, rechtshinweis: RECHTSHINWEIS }))
        } catch (e) { res.status(500).type('text/plain').send(`Bericht nicht erstellt: ${e.message}`) }
    })
    app.get('/api/portfolio/steuer/bericht.css', (req, res) => { res.type('text/css').send(BERICHT_CSS) })
    app.get('/api/portfolio/steuer/bericht.js', (req, res) => { res.type('application/javascript').send(BERICHT_JS) })
    app.get('/api/portfolio/steuer.csv', async (req, res) => {
        try {
            const jahr = Number(req.query.jahr) || new Date().getFullYear() - 1
            const csv = steuerCsv(await berechneSteuerjahr(jahr))
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="krypto-steuer-${jahr}.csv"`)
            res.send(csv)
        } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/steuerkurs', async (req, res) => {
        try {
            const jahr = Number(req.body?.jahr), asset = String(req.body?.asset || '').toUpperCase()
            if (!jahr || !asset) return fehler(res, 'Jahr und Asset nötig', 400)
            const k = getKnex()
            if (req.body?.chf == null || req.body.chf === '') {
                await k('portfolio_steuerkurse').where({ jahr, asset }).del()
            } else {
                const chf = Number(req.body.chf)
                if (!(chf >= 0)) return fehler(res, 'Kurs ungültig', 400)
                await k('portfolio_steuerkurse').insert({ jahr, asset, chf, quelle: req.body.quelle === 'estv' ? 'estv' : 'manuell', updatedAt: Date.now() })
                    .onConflict(['jahr', 'asset']).merge()
            }
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.get('/api/portfolio/totalverluste', async (req, res) => {
        try { res.json({ ok: true, ...(await totalverlustUebersicht()) }) } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/quellen/genutzt-bis', async (req, res) => {
        try {
            const quelle = String(req.body?.quelle || '')
            const d = req.body?.datum ? String(req.body.datum) : null
            if (!quelle) return fehler(res, 'Quelle fehlt', 400)
            if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return fehler(res, 'Datum ungültig', 400)
            // Ende des Tages Schweizer Zeit: am genannten Tag zählt der Ort noch.
            const ms = d ? Date.parse(`${d}T23:59:59+01:00`) : null
            const n = await getKnex()('portfolio_quellen').where({ quelle }).update({ genutztBis: ms })
            if (!n) return fehler(res, 'Quelle unbekannt', 404)
            res.json({ ok: true, genutztBis: ms })
        } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/kanton', async (req, res) => {
        try {
            const kz = req.body?.kz ? String(req.body.kz).toUpperCase() : null
            if (kz && !kantonVon(kz)) return fehler(res, 'Kanton unbekannt', 400)
            const k = getKnex()
            const s = await k('settings').first('id')
            await k('settings').where({ id: s.id }).update({ portfolioKanton: kz })
            res.json({ ok: true, kz })
        } catch (e) { fehler(res, e) }
    })
    app.post('/api/portfolio/estv/:jahr', async (req, res) => {
        try {
            const jahr = Number(req.params.jahr)
            if (!(jahr >= 2023 && jahr < new Date().getFullYear())) return fehler(res, 'Jahr ohne ESTV-Kursliste', 400)
            const r = await importiereKursliste(jahr)
            res.json({ ok: true, ...r, stand: await kurslisteStand(jahr) })
        } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/spam', async (req, res) => {
        try {
            const asset = String(req.body?.asset ?? '')
            if (!asset || asset.length > 200) return fehler(res, 'Asset fehlt', 400)
            const w = req.body?.spam
            const kontrakt = req.body?.kontrakt ? String(req.body.kontrakt) : null
            if (kontrakt && kontrakt.length > 200) return fehler(res, 'Vertrag zu lang', 400)
            await setzeSpam(asset, w === null || w === undefined ? null : !!w, kontrakt)
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/totalverlust', async (req, res) => {
        try {
            const asset = String(req.body?.asset || '').trim()
            if (!asset || asset.length > 60) return fehler(res, 'Asset fehlt', 400)
            await setzeTotalverlust(asset, !!req.body?.an, req.body?.abJahr)
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })
    app.put('/api/portfolio/futures-stichtag', async (req, res) => {
        try {
            const jahr = Number(req.body?.jahr), boerse = String(req.body?.boerse || '').toLowerCase()
            if (!jahr || !BOERSEN.includes(boerse)) return fehler(res, 'Jahr und Börse nötig', 400)
            const usd = req.body?.usd
            if (usd != null && usd !== '' && !(Number(usd) >= 0)) return fehler(res, 'Betrag ungültig', 400)
            await setzeFuturesStichtag(jahr, boerse, usd === '' ? null : usd, String(req.body?.quelle || '').slice(0, 80) || null)
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    // ── Zugänge ──
    app.get('/api/portfolio/schluessel', async (req, res) => {
        try {
            const z = await getKnex()('portfolio_schluessel').select('name', 'updatedAt')
            const aus = {}
            for (const n of SCHLUESSEL_NAMEN) aus[n] = z.some((x) => x.name === n)
            res.json({ ok: true, schluessel: aus })
        } catch (e) { fehler(res, e) }
    })

    app.post('/api/portfolio/schluessel', async (req, res) => {
        try {
            const name = String(req.body?.name || '')
            const wert = String(req.body?.wert || '').trim()
            if (!SCHLUESSEL_NAMEN.includes(name)) return fehler(res, 'Unbekannter Zugang', 400)
            if (!wert || wert.includes('•')) return fehler(res, 'Wert fehlt', 400)
            if (name === 'bitpanda') {
                try { await testeBitpanda(wert) } catch (e) { return fehler(res, `Bitpanda lehnt den Schlüssel ab: ${e.message}`, 400) }
            }
            await getKnex()('portfolio_schluessel').insert({ name, wert: encrypt(wert), updatedAt: Date.now() }).onConflict('name').merge()
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.delete('/api/portfolio/schluessel/:name', async (req, res) => {
        try {
            await getKnex()('portfolio_schluessel').where('name', String(req.params.name)).del()
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })
}

/**
 * Saldo je Coin eines importierten Orts. Bewusst je ASSET, nicht je Vertrag:
 * eine Rekonstruktion bucht denselben Token mal mit, mal ohne Vertrags-
 * adresse (Kette vs. Börsen-Export) — getrennt entstanden daraus zwei Töpfe,
 * einer zu hoch, einer negativ (gemessen 23.10.2026: USDT bei MetaMask,
 * stETH bei beiden Ledger-Konten). Der Vertrag wird übernommen, wenn eine
 * Zeile ihn nennt.
 */
function saldoJeAsset(zeilen) {
    const m = new Map()
    const add = (asset, menge, kontrakt, kette) => {
        if (!asset || !menge) return
        const e = m.get(asset) || { menge: 0, kontrakt: null, kette: null }
        e.menge += menge
        if (kontrakt && !e.kontrakt) { e.kontrakt = kontrakt; e.kette = ketteNorm(kette) }
        m.set(asset, e)
    }
    for (const b of zeilen) {
        if (b.einordnung === 'ignorieren') continue
        add(b.asset, Number(b.menge) || 0, b.kontrakt, b.kette)
        if (b.gegenAsset) add(b.gegenAsset, Number(b.gegenMenge) || 0, null)
        if (b.gebuehrAsset) add(b.gebuehrAsset, -(Number(b.gebuehrMenge) || 0), null)
    }
    return m
}

/** Bestand eines importierten Orts aus seinen Bewegungen (eine API gibt es nicht). */
async function bestandAusImport(trx, quelle) {
    const bew = await trx('portfolio_bewegungen').where('quelle', quelle)
        .select('asset', 'menge', 'gegenAsset', 'gegenMenge', 'gebuehrAsset', 'gebuehrMenge', 'kontrakt', 'kette', 'einordnung')
    const s = saldoJeAsset(bew)
    await trx('portfolio_bestaende').where('quelle', quelle).del()
    const zeilen = []
    const negativ = []
    for (const [asset, { menge, kontrakt, kette }] of s) {
        // Rundungsreste (−1e-8 aus Tauschen mit 18 Dezimalen) sind kein Loch.
        if (menge < -1e-7 && !FIAT.includes(asset)) negativ.push(`${asset} ${menge}`)
        // Token mit Vertrag und bekannter Kette: `ort` = Kette, damit die Übersicht
        // ihn über den Vertrag bewertet (DexScreener, mit Liquiditätsschwelle).
        if (menge > 1e-12) zeilen.push({ quelle, ort: kontrakt && kette ? kette : 'import', asset, kontrakt: kontrakt && kette ? kontrakt : null, menge, zeit: Date.now() })
    }
    if (zeilen.length) await trx('portfolio_bestaende').insert(zeilen)
    return negativ
}

async function loescheAdresse(trx, id) {
    const quelle = `a${id}`
    // Transfer-Partner an anderen Orten wieder freigeben
    const ids = (await trx('portfolio_bewegungen').where('quelle', quelle).select('id')).map((z) => z.id)
    for (let i = 0; i < ids.length; i += 500) {
        await trx('portfolio_bewegungen').whereIn('transferMit', ids.slice(i, i + 500)).update({ transferMit: null, transferSicher: null })
    }
    await trx('portfolio_bewegungen').where('quelle', quelle).del()
    await trx('portfolio_bestaende').where('quelle', quelle).del()
    await trx('portfolio_quellen').where('quelle', quelle).del()
    await trx('portfolio_adressen').where('id', id).del()
}
