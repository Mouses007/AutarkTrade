/**
 * Spot-Portfolio: Routen unter /api/portfolio (Testzweig).
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
 */

import crypto from 'crypto'
import { getKnex } from '../database.js'
import { encrypt } from '../crypto.js'
import { erkenneEingabe, kurzAdresse, WALLET_TYPEN, EVM_NETZE, EVM_VORGABE } from '../../shared/portfolio-adresse.js'
import { berechneUebersicht } from './uebersicht.js'
import { rufeAb, laufStand } from './abruf.js'
import { testeBitpanda } from './quellen.js'
import { ARTEN } from './normal.js'

const SCHLUESSEL_NAMEN = ['bitpanda', 'etherscan']
const EINORDNUNGEN = ['transfer', 'kauf', 'einkommen', 'ignorieren']
/** „Zu prüfen": Ein-/Ausgänge ohne erkannten Gegenpart und Unbekanntes. Airdrops sind ihrer Art nach klar. */
const OFFENE_ARTEN = ['einzahlung', 'auszahlung', 'sonstiges']

const fehler = (res, e, code = 500) => res.status(code).json({ ok: false, error: String(e?.message || e) })
const fingerabdruck = (s) => crypto.createHash('sha256').update(String(s).trim()).digest('hex')

export function setupPortfolioRoutes(app) {
    app.get('/api/portfolio/uebersicht', async (req, res) => {
        try { res.json({ ok: true, ...(await berechneUebersicht()) }) } catch (e) { fehler(res, e) }
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
                    .whereIn('art', OFFENE_ARTEN)
            }
            if (req.query.vor) q.where('zeit', '<', Number(req.query.vor))
            const limit = Math.min(Number(req.query.limit) || 100, 500)
            const zeilen = await q.orderBy('zeit', 'desc').orderBy('id', 'desc').limit(limit)
            const offen = await k('portfolio_bewegungen').whereNull('einordnung').whereNull('transferMit')
                .whereIn('art', OFFENE_ARTEN).count({ n: '*' }).first()
            res.json({ ok: true, zeilen, offen: Number(offen?.n || 0), weitere: zeilen.length === limit })
        } catch (e) { fehler(res, e) }
    })

    // Alle offenen Zeilen EINER Quelle (optional nur eine Richtung) auf einmal einordnen.
    app.post('/api/portfolio/bewegungen/sammel', async (req, res) => {
        try {
            const e = req.body?.einordnung
            const quelle = String(req.body?.quelle || '')
            if (!EINORDNUNGEN.includes(e) || !quelle) return fehler(res, 'Quelle und Einordnung nötig', 400)
            const q = getKnex()('portfolio_bewegungen').where('quelle', quelle).whereNull('einordnung').whereNull('transferMit').whereIn('art', OFFENE_ARTEN)
            if (req.body?.art && OFFENE_ARTEN.includes(req.body.art)) q.where('art', req.body.art)
            const n = await q.update({ einordnung: e })
            res.json({ ok: true, geaendert: n })
        } catch (err) { fehler(res, err) }
    })

    app.put('/api/portfolio/bewegungen/:id', async (req, res) => {
        try {
            const e = req.body?.einordnung
            if (e !== null && !EINORDNUNGEN.includes(e)) return fehler(res, 'Unbekannte Einordnung', 400)
            await getKnex()('portfolio_bewegungen').where('id', Number(req.params.id)).update({ einordnung: e })
            res.json({ ok: true })
        } catch (err) { fehler(res, err) }
    })

    // ── Wallets ──
    app.get('/api/portfolio/wallets', async (req, res) => {
        try {
            const k = getKnex()
            const wallets = await k('portfolio_wallets').select('*').orderBy([{ column: 'sortierung' }, { column: 'id' }])
            const adressen = await k('portfolio_adressen').select('id', 'walletId', 'kette', 'art', 'anzeige', 'netze', 'label').orderBy('id')
            res.json({
                ok: true, typen: WALLET_TYPEN, netze: EVM_NETZE, netzVorgabe: EVM_VORGABE,
                wallets: wallets.map((w) => ({ ...w, adressen: adressen.filter((a) => a.walletId === w.id).map((a) => ({ ...a, netze: JSON.parse(a.netze || '[]') })) })),
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
            if (!Object.keys(upd).length) return fehler(res, 'Nichts zu ändern', 400)
            await getKnex()('portfolio_adressen').where('id', Number(req.params.id)).update(upd)
            res.json({ ok: true })
        } catch (e) { fehler(res, e) }
    })

    app.delete('/api/portfolio/adressen/:id', async (req, res) => {
        try {
            await getKnex().transaction((trx) => loescheAdresse(trx, Number(req.params.id)))
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
