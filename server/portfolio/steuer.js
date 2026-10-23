/**
 * Spot-Portfolio: Steuerjahr zusammenstellen (I/O um `steuer-rechnung.js`).
 *
 * Stichtag ist der 31.12. 23:59:59 Schweizer Zeit. Bewertet wird je Coin:
 *   1. Steuerkurs aus `portfolio_steuerkurse` (ESTV-Kursliste oder von Hand)
 *   2. Jahresschlusskurs: Tageskerze 31.12. (Marktdatenquelle, sonst Bitget)
 *      × USD/CHF der EZB am 31.12.
 *   3. Stablecoin = 1 USD, CHF = 1, EUR über die EZB
 * Fehlt alles, bleibt der Wert leer und die Zeile wird zum Nachtragen
 * angeboten — ein fehlender Kurs ist kein Nullwert.
 *
 * Quellen mit unvollständiger Historie (Bitunix, Pionex, EVM-Wallets ohne
 * Explorer-Schlüssel) können einen vergangenen Stichtag nicht belegen. Sie
 * werden für Vorjahre ausgelassen und als Hinweis genannt; im laufenden Jahr
 * zählt ihr heutiger Bestand (provisorisch).
 */
import { getKnex } from '../database.js'
import { bestandAm, einkommen, fifo, veraeusserungen, gewerbsKriterien } from './steuer-rechnung.js'
import { tagesKursUsd, fxAm, gleicherCoin } from './kurse.js'
import { STABIL, FIAT } from './normal.js'
import { uebergaben } from './uebergabe.js'

const SPALTEN = ['id', 'quelle', 'zeit', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'gebuehrAsset', 'gebuehrMenge',
    'transferMit', 'einordnung', 'chfWert', 'sicherheit', 'kontrakt', 'kette']

export function jahrGrenzen(jahr) {
    return { von: Date.parse(`${jahr}-01-01T00:00:00+01:00`), bis: Date.parse(`${jahr}-12-31T23:59:59+01:00`) }
}

async function quellenStand() {
    const k = getKnex()
    const zeilen = await k('portfolio_quellen').select('quelle', 'stand')
    const vollstaendig = new Set()
    for (const z of zeilen) {
        let st = {}
        try { st = JSON.parse(z.stand || '{}') } catch { st = {} }
        if (st.vollstaendig || z.quelle.startsWith('i:')) vollstaendig.add(z.quelle)
    }
    return { alle: zeilen.map((z) => z.quelle), vollstaendig }
}

/** Steuerkurs (CHF je Einheit) eines Assets am Jahresende, mit Quelle. */
async function steuerkurs(asset, jahr, manuell, fxCache, token) {
    const m = manuell.get(asset)
    if (m) return { chf: m.chf, quelle: m.quelle === 'estv' ? 'ESTV-Kursliste' : 'von Hand' }
    if (asset === 'CHF') return { chf: 1, quelle: 'CHF' }
    const datum = `${jahr}-12-31`
    if (!fxCache.chf) fxCache.chf = await fxAm(datum, 'CHF')
    if (!fxCache.chf) return { chf: null, quelle: 'kein Wechselkurs' }
    if (asset === 'EUR') {
        if (!fxCache.eur) fxCache.eur = await fxAm(datum, 'EUR')
        return fxCache.eur ? { chf: fxCache.chf / fxCache.eur, quelle: 'EZB 31.12.' } : { chf: null, quelle: 'kein Wechselkurs' }
    }
    if (asset in STABIL) return { chf: fxCache.chf, quelle: 'Stablecoin · EZB 31.12.' }
    // Ein Wallet-Token, der nur wie ein Börsen-Coin heisst, bekommt dessen Kurs NICHT.
    if (token && !(await gleicherCoin(asset, token.kontrakt, token.kette))) {
        return { chf: null, quelle: 'Token ohne Börsenkurs' }
    }
    const t = await tagesKursUsd(asset, datum)
    return t.usd != null ? { chf: t.usd * fxCache.chf, quelle: `${t.quelle} 31.12. · EZB` } : { chf: null, quelle: 'kein Kurs' }
}

async function bewerte(mengen, jahr, tokens = new Map()) {
    const k = getKnex()
    const manuell = new Map((await k('portfolio_steuerkurse').where('jahr', jahr)).map((z) => [z.asset, z]))
    const fxCache = {}
    const kurse = new Map()
    for (const asset of new Set([...mengen.keys()].map((k2) => k2.split('\u0000')[1]))) {
        kurse.set(asset, await steuerkurs(asset, jahr, manuell, fxCache, tokens.get(asset)))
    }
    return kurse
}

/** Assets, die irgendwo als Token mit Vertrag gebucht sind → { kontrakt, kette }. */
function tokenVertraege(bew) {
    const m = new Map()
    for (const b of bew) if (b.kontrakt && b.kette && !m.has(b.asset)) m.set(b.asset, { kontrakt: b.kontrakt, kette: b.kette })
    return m
}

async function futuresTrades(von, bis) {
    try {
        const zeilen = await getKnex()('trades').whereBetween('dateUnix', [Math.floor(von / 1000), Math.floor(bis / 1000)]).select('trades')
        let n = 0
        for (const z of zeilen) {
            let t = z.trades
            if (typeof t === 'string') { try { t = JSON.parse(t) } catch { t = [] } }
            n += Array.isArray(t) ? t.length : 0
        }
        return n
    } catch { return 0 }
}

function namenVon(quellen, wallets, adressen) {
    const BOERSE = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex', bitpanda: 'Bitpanda' }
    return (q) => {
        if (BOERSE[q]) return BOERSE[q]
        if (q.startsWith('i:')) return q.slice(2)
        const a = adressen.find((x) => `a${x.id}` === q)
        if (a) return `${wallets.find((w) => w.id === a.walletId)?.name || 'Wallet'} · ${a.label || a.kette.toUpperCase()}`
        return q
    }
}

/**
 * @returns Steuerjahr mit Vermögen, Einkommen, Abgängen, Kriterien, Hinweisen.
 */
export async function berechneSteuerjahr(jahr) {
    const k = getKnex()
    const { von, bis } = jahrGrenzen(jahr)
    const jetzt = Date.now()
    const laufend = bis > jetzt
    const bew = (await k('portfolio_bewegungen').select(SPALTEN)).map((b) => ({ ...b, zeit: Number(b.zeit) }))
    const { alle, vollstaendig } = await quellenStand()
    const [wallets, adressen] = await Promise.all([k('portfolio_wallets').select('*'), k('portfolio_adressen').select('id', 'walletId', 'kette', 'label')])
    const name = namenVon(alle, wallets, adressen)

    // ── Vermögen am Stichtag ──
    const belegbar = bew.filter((b) => vollstaendig.has(b.quelle))
    const mengen = bestandAm(belegbar, bis)
    const hinweise = []
    const unbelegt = alle.filter((q) => !vollstaendig.has(q))
    if (laufend) {
        // Laufendes Jahr: unvollständige Quellen mit ihrem HEUTIGEN Bestand (provisorisch).
        const heuteBestand = await k('portfolio_bestaende').select('quelle', 'asset', 'menge')
        for (const z of heuteBestand.filter((x) => unbelegt.includes(x.quelle))) {
            const key = `${z.quelle}\u0000${z.asset}`
            mengen.set(key, (mengen.get(key) || 0) + Number(z.menge))
        }
        // Übergabe Import → Live: was die Adresse heute meldet, ersetzt den
        // Import-Ort (sonst stünde z. B. das XRP des Ledgers zweimal da).
        const adrZeilen = await k('portfolio_adressen').select('id', 'importOrte', 'liveAb')
        const stZeilen = await k('portfolio_quellen').select('quelle', 'status', 'stand')
        const { ersetzt } = uebergaben(heuteBestand, adrZeilen, new Map(stZeilen.map((q) => [q.quelle, q])))
        for (const [iq, e] of ersetzt) {
            // Vollständige Live-Quelle (xpub): Import bis liveAb + Live-Bewegungen danach
            // ergeben den Stand schon richtig — nichts ersetzen.
            if (e.alle || (e.liveAb && e.liveAb > bis)) continue
            for (const key of [...mengen.keys()]) {
                const [q, asset] = key.split('\u0000')
                if (q === iq && (e.alle || e.assets.has(asset))) mengen.delete(key)
            }
        }
        hinweise.push({ art: 'laufend', text: `Das Jahr ${jahr} ist nicht abgeschlossen: Bestände und Kurse sind provisorisch (Stand heute, Kurse vom 31.12. sobald verfügbar).` })
    } else if (unbelegt.length) {
        hinweise.push({ art: 'unbelegt', quellen: unbelegt.map(name), text: 'Diese Quellen liefern keine vollständige Historie; ihr Bestand am Stichtag ist nicht belegbar und fehlt unten. Für Vorjahre per Datei-Import ergänzen.' })
    }
    // Rundungsreste (Bitpanda: SHIB −1.4e-9) sind kein Bestand und kein Loch.
    for (const [key, m] of mengen) if (Math.abs(m) < 1e-8) mengen.delete(key)
    const tokens = tokenVertraege(bew)
    const kurse = await bewerte(mengen, jahr, tokens)
    const sicherheitJe = new Map()
    for (const b of belegbar) {
        if (b.zeit > bis || !b.sicherheit || b.sicherheit === 'beleg') continue
        for (const a of [b.asset, b.gegenAsset]) if (a) sicherheitJe.set(`${b.quelle}\u0000${a}`, b.sicherheit === 'offen' ? 'offen' : (sicherheitJe.get(`${b.quelle}\u0000${a}`) === 'offen' ? 'offen' : 'abgeleitet'))
    }
    // Weicht bei einer API-Quelle die Summe aller Bewegungen HEUTE vom gemeldeten
    // Bestand ab (Bitpanda: EUR +40, eine Bankbewegung fehlt), ist auch der
    // Stichtag für dieses Asset nicht belegt → markieren statt still mitzählen.
    const heute = new Map()
    for (const z of await k('portfolio_bestaende').select('quelle', 'asset', 'menge')) {
        const key = `${z.quelle}\u0000${z.asset}`
        heute.set(key, (heute.get(key) || 0) + Number(z.menge))
    }
    const jetztSaldo = bestandAm(belegbar, Infinity)
    for (const [key, m] of jetztSaldo) {
        if (key.startsWith('i:') || Math.abs(m) < 1e-8) continue
        const h = heute.get(key) || 0
        if (Math.abs(h - m) > Math.max(1e-8, Math.abs(h) * 1e-6)) sicherheitJe.set(key, 'abweichung')
    }
    const jeAsset = new Map()
    const negativ = []
    for (const [key, menge] of mengen) {
        const [quelle, asset] = key.split('\u0000')
        if (menge < 0) {
            // Importierte Konten ohne Bankbuchungen: negatives Fiat ist erwartet, kein Loch.
            if (!(quelle.startsWith('i:') && FIAT.includes(asset))) negativ.push({ quelle: name(quelle), asset, menge })
            continue
        }
        const kurs = kurse.get(asset)
        const p = jeAsset.get(asset) || { asset, menge: 0, kursChf: kurs.chf, kursQuelle: kurs.quelle, chf: kurs.chf != null ? 0 : null, orte: [] }
        p.menge += menge
        if (kurs.chf != null) p.chf += menge * kurs.chf
        p.orte.push({ quelle, name: name(quelle), menge, sicherheit: sicherheitJe.get(key) || 'beleg' })
        jeAsset.set(asset, p)
    }
    const vermoegen = [...jeAsset.values()].sort((a, b) => (b.chf ?? -1) - (a.chf ?? -1))
    const vermoegenSumme = vermoegen.reduce((s, p) => s + (p.chf || 0), 0)
    if (negativ.length) hinweise.push({ art: 'negativ', text: 'Negative Bestände am Stichtag — ein Zugang fehlt in der Historie.', liste: negativ })

    // ── Einkommen ──
    const ek = einkommen(bew, von, bis)

    // ── Abgänge (FIFO über die ganze Historie) ──
    const { abgaenge } = fifo(bew, { fiat: FIAT, von, bis })
    const vs = veraeusserungen(abgaenge)

    // ── Kriterien ──
    const vorjahr = jahrGrenzen(jahr - 1)
    let vermoegenAnfang = null
    try {
        const m0 = bestandAm(belegbar, vorjahr.bis)
        for (const [key, m] of m0) if (m <= 0) m0.delete(key)
        const k0 = await bewerte(m0, jahr - 1, tokens)
        vermoegenAnfang = 0
        for (const [key, m] of m0) { const kurs = k0.get(key.split('\u0000')[1]); if (kurs?.chf != null) vermoegenAnfang += m * kurs.chf }
    } catch { vermoegenAnfang = null }
    const volumen = bew.filter((b) => b.zeit >= von && b.zeit <= bis && ['kauf', 'verkauf', 'tausch'].includes(b.art) && b.chfWert != null)
        .reduce((s, b) => s + Math.abs(Number(b.chfWert)), 0)
    const kriterien = gewerbsKriterien({ volumen, vermoegenAnfang, kurzfristigErloes: vs.kurzfristigErloes, erloes: vs.erloes, futuresTrades: await futuresTrades(von, bis) })

    return {
        jahr, stichtag: bis, laufend,
        vermoegen, vermoegenSumme, ohneKurs: vermoegen.filter((p) => p.chf == null).map((p) => p.asset),
        einkommen: {
            summe: ek.summe, ohneWert: ek.ohneWert, jeArt: ek.jeArt, jeAsset: ek.jeAsset,
            zeilen: ek.zeilen.map((b) => ({ id: b.id, zeit: b.zeit, quelle: name(b.quelle), art: ['staking', 'airdrop', 'belohnung'].includes(b.art) ? b.art : 'eingeordnet', asset: b.asset, menge: b.menge, chfWert: b.chfWert, sicherheit: b.sicherheit })),
        },
        veraeusserungen: { ...vs, abgaenge: abgaenge.filter((a) => a.art !== 'gebuehr').map((a) => ({ ...a, quelle: name(a.quelle) })) },
        kriterien: kriterien.map((x) => (x.id === 'volumen' ? { ...x, volumen, vermoegenAnfang } : x)),
        hinweise,
    }
}

/** CSV für die Steuererklärung / den Treuhänder. */
export function steuerCsv(s) {
    const z = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e8) / 1e8) : `"${String(v).replace(/"/g, '""')}"`)
    const d = (ms) => new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })
    const zeilen = [`Steuerjahr ${s.jahr} — Stichtag 31.12.${s.jahr}${s.laufend ? ' (provisorisch)' : ''}`, '',
        'VERMÖGEN (Wertschriftenverzeichnis);Menge;Kurs CHF;Wert CHF;Kursquelle;Orte']
    for (const p of s.vermoegen) zeilen.push([p.asset, p.menge, p.kursChf, p.chf, p.kursQuelle, p.orte.map((o) => `${o.name} ${o.menge}${o.sicherheit !== 'beleg' ? ` (${o.sicherheit})` : ''}`).join(' | ')].map(z).join(';'))
    zeilen.push(['Total', '', '', s.vermoegenSumme, '', ''].map(z).join(';'), '', 'EINKOMMEN (Staking, Airdrops, Belohnungen);Datum;Ort;Art;Menge;Wert CHF beim Zufluss;Sicherheit')
    for (const e of s.einkommen.zeilen) zeilen.push([e.asset, d(e.zeit), e.quelle, e.art, e.menge, e.chfWert, e.sicherheit || 'beleg'].map(z).join(';'))
    zeilen.push(['Total', '', '', '', '', s.einkommen.summe, ''].map(z).join(';'), '', 'VERÄUSSERUNGEN (privat steuerfrei, zur Information);Datum;Ort;Art;Menge;Erlös CHF;Einstand CHF (FIFO);Gewinn CHF;Anteil < 6 Monate')
    for (const a of s.veraeusserungen.abgaenge) zeilen.push([a.asset, d(a.zeit), a.quelle, a.art, a.menge, a.erloes, a.kosten, a.gewinn, a.kurzfristigAnteil].map(z).join(';'))
    zeilen.push(['Total', '', '', '', '', s.veraeusserungen.erloes, s.veraeusserungen.kosten, s.veraeusserungen.gewinn, ''].map(z).join(';'))
    return '﻿' + zeilen.join('\n') + '\n'
}
