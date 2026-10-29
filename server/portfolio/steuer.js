/**
 * Spot-Portfolio: Steuerjahr zusammenstellen (I/O um `steuer-rechnung.js`).
 *
 * Stichtag ist der 31.12. 23:59:59 Schweizer Zeit. Bewertet wird je Coin:
 *   1. Steuerkurs aus `portfolio_steuerkurse` (ESTV-Kursliste — wird für
 *      abgeschlossene Jahre ab 2023 selbst geholt, `estv-kursliste.js` — oder von Hand)
 *   2. Jahresschlusskurs: Tageskerze 31.12. (Marktdatenquelle, sonst Bitget)
 *      × USD/CHF der EZB am 31.12.
 *   3. Stablecoin = 1 USD, CHF = 1, EUR über die EZB
 *   4. Bitpanda / CoinGecko für Coins ohne Börsenpaar
 *   5. Kaufpreis (Ø-Einstand), wenn der gewählte Kanton ihn zulässt
 * Fehlt alles, bleibt der Wert leer und die Zeile wird zum Nachtragen
 * angeboten — ein fehlender Kurs ist kein Nullwert.
 *
 * Der Kanton (`settings.portfolioKanton`, `shared/steuer-kantone.js`) bestimmt
 * Rubrik/Code im Übertrag, den Kaufpreis-Rückfall und die Haltedauer im
 * Kriterienkatalog (TG 12 Monate).
 *
 * Quellen mit unvollständiger Historie (Bitunix, Pionex, EVM-Wallets ohne
 * Explorer-Schlüssel) können einen vergangenen Stichtag nicht belegen. Sie
 * werden für Vorjahre ausgelassen und als Hinweis genannt; im laufenden Jahr
 * zählt ihr heutiger Bestand (provisorisch).
 */
import { getKnex } from '../database.js'
import { bestandAm, einkommen, fifo, veraeusserungen, gewerbsKriterien, istMigration, einstandJeAsset, einstandZusammen, ortSchluessel, bestandesrechnung, veraenderungen } from './steuer-rechnung.js'
import { tokenIdentitaet, ladeGegenKontrakte } from './token-id.js'
import { tagesKursUsd, fxAm, gleicherCoin, bitpandaKursChf, coingeckoKursChf, GELD_TOKEN } from './kurse.js'
import { totalverluste } from './totalverlust.js'
import { importiereKursliste, kurslisteStand } from './estv-kursliste.js'
import { kanton as kantonVon, kaufpreisErlaubt, haltedauerMonate } from '../../shared/steuer-kantone.js'
import { coinName } from '../../shared/coin-namen.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { spamPruefer } from './spam.js'
import { STABIL, FIAT } from './normal.js'
import { uebergaben } from './uebergabe.js'
import { futuresSteuerjahr } from './futures-steuer.js'

const SPALTEN = ['id', 'quelle', 'zeit', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'gebuehrAsset', 'gebuehrMenge',
    'transferMit', 'einordnung', 'chfWert', 'sicherheit', 'kontrakt', 'kette']

export function jahrGrenzen(jahr) {
    return { von: Date.parse(`${jahr}-01-01T00:00:00+01:00`), bis: Date.parse(`${jahr + 1}-01-01T00:00:00+01:00`) - 1 }   // bis 23:59:59.999
}

async function quellenStand() {
    const k = getKnex()
    const zeilen = await k('portfolio_quellen').select('quelle', 'stand')
    const vollstaendig = new Set()
    const abgeschnitten = new Map()      // Quelle → Netze, deren Historie an der Seitengrenze endet (FUN-PRT-002)
    for (const z of zeilen) {
        let st = {}
        try { st = JSON.parse(z.stand || '{}') } catch { st = {} }
        if (st.vollstaendig || z.quelle.startsWith('i:')) vollstaendig.add(z.quelle)
        if (Array.isArray(st.abgeschnitten) && st.abgeschnitten.length) abgeschnitten.set(z.quelle, st.abgeschnitten)
    }
    return { alle: zeilen.map((z) => z.quelle), vollstaendig, abgeschnitten }
}

/** Steuerkurs (CHF je Einheit) eines Assets am Jahresende, mit Quelle. */
async function steuerkurs(asset, jahr, manuell, fxCache, datum = `${jahr}-12-31`) {
    const m = manuell.get(asset)
    if (m) return { chf: m.chf, quelle: m.quelle === 'estv' ? 'ESTV-Kursliste' : 'von Hand', valor: m.valor || null }
    if (asset === 'CHF' || GELD_TOKEN[asset] === 'CHF') return { chf: 1, quelle: asset === 'CHF' ? 'CHF' : `Fiat24 · 1 ${asset} = 1 CHF` }
    const tag = datum.slice(8, 10) + '.' + datum.slice(5, 7) + '.'
    if (!fxCache.chf) fxCache.chf = await fxAm(datum, 'CHF')
    if (!fxCache.chf) return { chf: null, quelle: 'kein Wechselkurs' }
    if (asset === 'EUR') {
        if (!fxCache.eur) fxCache.eur = await fxAm(datum, 'EUR')
        return fxCache.eur ? { chf: fxCache.chf / fxCache.eur, quelle: `EZB ${tag}` } : { chf: null, quelle: 'kein Wechselkurs' }
    }
    if (asset in STABIL) return { chf: fxCache.chf, quelle: `Stablecoin · EZB ${tag}` }
    const t = await tagesKursUsd(asset, datum)
    if (t.usd != null) return { chf: t.usd * fxCache.chf, quelle: `${t.quelle} ${tag} · EZB` }
    // Weder Binance noch Bitget: Bitpanda führt manche Coins allein (CSPR, WSI, DUEL).
    const b = await bitpandaKursChf(asset, datum) || await coingeckoKursChf(asset, datum)
    return b ? { chf: b.chf, quelle: `${b.quelle} ${tag}` } : { chf: null, quelle: 'kein Kurs' }
}

/**
 * @param {string} [datum]  Bewertungstag; im laufenden Jahr gestern (den
 *   31.12. gibt es noch nicht — das Vermögen wäre sonst 0), sonst der 31.12.
 */
async function bewerte(mengen, jahr, tokenOrte = new Map(), datum = `${jahr}-12-31`) {
    const k = getKnex()
    const manuell = new Map((await k('portfolio_steuerkurse').where('jahr', jahr)).map((z) => [z.asset, z]))
    const fxCache = {}
    const kurse = new Map()
    for (const asset of new Set([...mengen.keys()].map((k2) => k2.split('\u0000')[1]))) {
        kurse.set(asset, await steuerkurs(asset, jahr, manuell, fxCache, datum))
    }
    // Ein Wallet-Token, der nur wie ein Börsen-Coin heisst, bekommt dessen
    // Kurs NICHT — aber nur an den Orten, wo er als Token liegt (siehe kursAn).
    // Geprüft wird je Vertrag: derselbe Name kann echt (USDT) und gefälscht sein.
    // Ein Kurs von Hand gilt auch für den Token (EPIK); der ESTV-Kurs nicht —
    // er gehört zum Coin mit Valor, nicht zu einem namensgleichen Token.
    // Menge je Vertrag (über alle Orte): ab der Pool-Liquidität gedeckelt (`kurse.js`).
    const mengeJe = new Map()
    for (const [key, t] of tokenOrte) {
        if (!mengen.has(key)) continue
        const id = key.split('\u0000')[1] + TOKEN + t.kontrakt
        mengeJe.set(id, (mengeJe.get(id) || 0) + Math.abs(mengen.get(key)))
    }
    const geprueft = new Set()
    for (const [key, t] of tokenOrte) {
        const asset = key.split('\u0000')[1]
        const id = asset + TOKEN + t.kontrakt
        if (geprueft.has(id) || !mengen.has(key)) continue
        geprueft.add(id)
        if (manuell.get(asset) && manuell.get(asset).quelle !== 'estv') continue
        if (!(await gleicherCoin(asset, t.kontrakt, t.kette, mengeJe.get(id)))) kurse.set(id, { chf: null, quelle: 'Token ohne Börsenkurs', token: true })
    }
    return kurse
}

export const TOKEN = '\u0000token\u0000'

/**
 * Kurs einer Position (`quelle\0asset`). Bis 25.10.2026 galt die Token-Prüfung
 * für das ganze Asset: weil RENDER auch auf einer Solana-Wallet lag, verloren
 * die 152 RENDER bei Crypto.com ihren Börsenkurs.
 */
export function kursAn(kurse, tokenOrte, key) {
    const asset = key.split('\u0000')[1]
    const t = tokenOrte.get(key)
    return (t && kurse.get(asset + TOKEN + t.kontrakt)) || kurse.get(asset)
}

/**
 * Orte, an denen ein Asset als Token mit FREMDEM Vertrag gebucht ist:
 * `quelle\0asset\0kontrakt` → { kontrakt, kette }. Bis zum Audit FUN-PRT-001
 * galt je Ort und Kürzel der erste Vertrag — echter und falscher USDT an
 * derselben Adresse wurden summiert und bekamen den Kurs des ersten.
 * Kanonische und per Transfer belegte Verträge zählen beim Kürzel (kein Eintrag).
 */
export function tokenOrteVon(bew, ident = tokenIdentitaet(bew)) {
    const m = new Map()
    for (const b of bew) {
        // Ohne Kette (Datei-Import ohne Spalte `kette`) wie bisher keine Token-Prüfung:
        // der Kurs kommt dann über das Kürzel — getrennt bleibt der Bestand trotzdem.
        if (!b.kette) continue
        for (const s of ident.seiten(b)) {
            if (!s.fremd) continue
            const key = ortSchluessel(b.quelle, s.asset, s.fremd)
            if (!m.has(key)) m.set(key, { kontrakt: s.fremd, kette: b.kette })
        }
    }
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
 * ESTV-Kursliste eines abgeschlossenen Jahres einmal holen (seit 2023 gibt es
 * sie, Erscheinen jeweils am 1. Januar). Ein Fehlschlag wird gemeldet, nicht
 * geworfen — der Bericht rechnet dann mit Börsenkursen weiter.
 */
async function sorgeFuerKursliste(jahr, laufend) {
    if (laufend || jahr < 2023) return { anzahl: 0, am: null, nichtVorgesehen: true }
    const st = await kurslisteStand(jahr)
    if (st.anzahl > 0 && !st.ohneNamen) return st
    // Höchstens alle 6 h ein Versuch — auch wenn die Liste noch nicht erschienen ist.
    // Vor dem 27.10.2026 geholte Listen tragen keine Namen: einmal neu holen; klappt
    // das nicht, gelten die gespeicherten Kurse weiter.
    const nachholen = st.anzahl > 0
    if (!(await beansprucheAufgabe(`portfolio_estv_${jahr}${nachholen ? '_namen' : ''}`, 6 * 3600e3))) return nachholen ? st : { ...st, wartet: true }
    try {
        const r = await importiereKursliste(jahr)
        return r.erschienen ? { ...(await kurslisteStand(jahr)), datei: r.datei } : nachholen ? st : { ...st, nichtErschienen: true }
    } catch (e) { return nachholen ? st : { ...st, fehler: e.message } }
}

/**
 * @returns Steuerjahr mit Vermögen, Einkommen, Abgängen, Kriterien, Hinweisen.
 */
export async function berechneSteuerjahr(jahr) {
    const k = getKnex()
    const { von, bis } = jahrGrenzen(jahr)
    const jetzt = Date.now()
    const laufend = bis > jetzt
    const kz = (await k('settings').first('portfolioKanton').catch(() => null))?.portfolioKanton || null
    const kt = kantonVon(kz)
    const halteMonate = haltedauerMonate(kz)
    const estv = await sorgeFuerKursliste(jahr, laufend)
    // Spam-Tokens (Werbe-Airdrops) gehören in keinen Steuerbericht — weder als
    // Vermögen noch als Einkommen ohne Wert.
    const istSpam = await spamPruefer()
    const roh = (await k('portfolio_bewegungen').select(SPALTEN)).map((b) => ({ ...b, zeit: Number(b.zeit) }))
    const bew = (await ladeGegenKontrakte(k, roh)).filter((b) => !istSpam(b.asset, b.kontrakt))
    // Identität je Token (Kürzel oder Kürzel|Vertrag) — einmal aus ALLEN Bewegungen,
    // denn der Transfer-Beleg kann an einer unvollständigen Quelle hängen.
    const ident = tokenIdentitaet(bew)
    const { alle, vollstaendig, abgeschnitten } = await quellenStand()
    const [wallets, adressen] = await Promise.all([k('portfolio_wallets').select('*'), k('portfolio_adressen').select('id', 'walletId', 'kette', 'label')])
    const name = namenVon(alle, wallets, adressen)
    // Voller Coin-Name: ESTV-Kursliste (neuestes Jahr gewinnt), sonst `shared/coin-namen.js`.
    const estvNamen = new Map()
    for (const z of await k('portfolio_steuerkurse').whereNotNull('name').orderBy('jahr').select('asset', 'name')) if (z.name) estvNamen.set(String(z.asset).toUpperCase(), z.name)

    // ── Vermögen am Stichtag ──
    const belegbar = bew.filter((b) => vollstaendig.has(b.quelle))
    const mengen = bestandAm(belegbar, bis, ident)
    const hinweise = []
    const unbelegt = alle.filter((q) => !vollstaendig.has(q))
    // Token-Bestände, die nur live gemeldet werden (Wallet ohne Bewegungen): auch
    // sie brauchen die Prüfung „namensgleicher Token?“ — sonst bekamen 4 Mio.
    // „AI“ auf MetaMask den Kurs des Börsen-Coins AI (63'874 CHF, 26.10.2026).
    const liveTokens = []
    if (laufend) {
        // Laufendes Jahr: unvollständige Quellen mit ihrem HEUTIGEN Bestand (provisorisch).
        const heuteBestand = (await k('portfolio_bestaende').select('quelle', 'asset', 'menge', 'kontrakt', 'ort')).filter((x) => !istSpam(x.asset, x.kontrakt))
        for (const z of heuteBestand.filter((x) => unbelegt.includes(x.quelle))) {
            const fremd = ident.fremd(z.asset, z.kontrakt, z.ort)
            const key = ortSchluessel(z.quelle, z.asset, fremd)
            mengen.set(key, (mengen.get(key) || 0) + Number(z.menge))
            if (fremd) liveTokens.push({ key, asset: z.asset, kontrakt: fremd, kette: z.ort })
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
    if (abgeschnitten.size) {
        hinweise.push({
            art: 'abgeschnitten', quellen: [...abgeschnitten].map(([q, netze]) => `${name(q)} (${netze.join(', ')})`),
            text: 'Bei diesen Wallets endete die Etherscan-Historie an der Seiten-Obergrenze: neuere Bewegungen fehlen, der Bestand ist nicht belegt. Fehlendes per Datei-Import ergänzen.',
        })
    }
    // Rundungsreste (Bitpanda: SHIB −1.4e-9) sind kein Bestand und kein Loch.
    for (const [key, m] of mengen) if (Math.abs(m) < 1e-8) mengen.delete(key)
    // Totalverluste: ab ihrem Steuerjahr nicht mehr im Vermögen (frühere Jahre unverändert).
    const tot = await totalverluste()
    const ohneTotalverluste = (m, j) => {
        const weg = new Set()
        for (const key of [...m.keys()]) {
            const asset = key.split('\u0000')[1]
            const t = tot.get(String(asset).toUpperCase())
            if (t && j >= t.abJahr) { m.delete(key); weg.add(asset) }
        }
        return [...weg]
    }
    const ausgeblendet = ohneTotalverluste(mengen, jahr)
    // Nicht mehr genutzte Orte: nach ihrem Datum kein Vermögen mehr. Steht dort noch
    // etwas, fehlt in den Daten der Abgang — sagen, nicht still mitzählen.
    const genutztBis = new Map((await k('portfolio_quellen').whereNotNull('genutztBis').select('quelle', 'genutztBis')).map((q) => [q.quelle, Number(q.genutztBis)]))
    const ohneBeendete = (m, stichtag) => {
        const rest = []
        for (const [key, menge] of [...m]) {
            const q = key.split('\u0000')[0]
            const bis = genutztBis.get(q)
            if (!bis || bis >= stichtag) continue
            if (Math.abs(menge) > 1e-8) rest.push({ quelle: name(q), asset: key.split('\u0000')[1], menge })
            m.delete(key)
        }
        return rest
    }
    const nachEnde = ohneBeendete(mengen, bis)
    const tokenOrte = tokenOrteVon(bew, ident)
    for (const t of liveTokens) if (!tokenOrte.has(t.key)) tokenOrte.set(t.key, { kontrakt: t.kontrakt, kette: t.kette })
    const gestern = new Date(jetzt - 86400e3).toISOString().slice(0, 10)
    const kurse = await bewerte(mengen, jahr, tokenOrte, laufend ? gestern : `${jahr}-12-31`)
    const sicherheitJe = new Map()
    for (const b of belegbar) {
        if (b.zeit > bis || !b.sicherheit || b.sicherheit === 'beleg') continue
        for (const s of ident.seiten(b)) {
            if (!s.asset) continue
            const key = ortSchluessel(b.quelle, s.asset, s.fremd)
            sicherheitJe.set(key, b.sicherheit === 'offen' ? 'offen' : (sicherheitJe.get(key) === 'offen' ? 'offen' : 'abgeleitet'))
        }
    }
    // Weicht bei einer API-Quelle die Summe aller Bewegungen HEUTE vom gemeldeten
    // Bestand ab (Bitpanda: EUR +40, eine Bankbewegung fehlt), ist auch der
    // Stichtag für dieses Asset nicht belegt → markieren statt still mitzählen.
    const heute = new Map()
    for (const z of await k('portfolio_bestaende').select('quelle', 'asset', 'menge', 'kontrakt', 'ort')) {
        const key = ortSchluessel(z.quelle, z.asset, ident.fremd(z.asset, z.kontrakt, z.ort))
        heute.set(key, (heute.get(key) || 0) + Number(z.menge))
    }
    const jetztSaldo = bestandAm(belegbar, Infinity, ident)
    for (const [key, m] of jetztSaldo) {
        if (key.startsWith('i:') || Math.abs(m) < 1e-8) continue
        const h = heute.get(key) || 0
        if (Math.abs(h - m) > Math.max(1e-8, Math.abs(h) * 1e-6)) sicherheitJe.set(key, 'abweichung')
    }
    const jeAsset = new Map()
    const negativ = []
    const spamOrte = new Set()
    for (const [key, menge] of mengen) {
        const [quelle, asset, fremd] = key.split('\u0000')
        if (menge < 0) {
            // Importierte Konten ohne Bankbuchungen: negatives Fiat ist erwartet, kein Loch.
            if (!(quelle.startsWith('i:') && FIAT.includes(asset))) negativ.push({ quelle: name(quelle), asset, menge })
            continue
        }
        const kurs = kursAn(kurse, tokenOrte, key)
        // Token ohne Kurs und ohne eigene Herkunft = ungefragt zugeschickt (Spam).
        if (kurs.chf == null && tokenOrte.has(key) && istSpam(asset, tokenOrte.get(key).kontrakt, { ohneKurs: true })) { spamOrte.add(key); continue }
        // Ein namensgleicher Token ohne Kurs steht als eigene Zeile neben dem Börsen-Coin.
        const gruppe = kurs.token ? asset + TOKEN + tokenOrte.get(key).kontrakt : asset
        const p = jeAsset.get(gruppe) || { asset, token: gruppe !== asset, valor: kurs.valor || null, menge: 0, kursChf: kurs.chf, kursQuelle: kurs.quelle, chf: kurs.chf != null ? 0 : null, orte: [], ids: new Set() }
        // Identitäten dieser Zeile (für den Einstand aus den Losen)
        p.ids.add(fremd ? `${String(asset).toUpperCase()}|${fremd}` : String(asset).toUpperCase())
        p.menge += menge
        if (kurs.chf != null) p.chf += menge * kurs.chf
        p.orte.push({ quelle, name: name(quelle), menge, sicherheit: sicherheitJe.get(key) || 'beleg' })
        jeAsset.set(gruppe, p)
    }
    // Kaufkurs am Stichtag: FIFO-Lose bis 31.12. → Ø-Einstand, Kostenbasis, unrealisiert.
    // Ohne Kurs und mit Kanton, der den Kaufpreis zulässt: Steuerwert = Kostenbasis.
    const einstand = einstandJeAsset(fifo(bew.filter((b) => b.zeit <= bis), { fiat: FIAT, halteMonate, ident }).lose)
    for (const p of jeAsset.values()) {
        const e = einstandZusammen(einstand, [...p.ids])
        delete p.ids
        p.name = coinName(p.asset, estvNamen, p.token)
        p.kaufkurs = e?.schnitt ?? null
        p.kostenbasis = p.kaufkurs != null ? p.kaufkurs * p.menge : null
        p.einstandTeilweise = !!e && (e.ohneKostenMenge > p.menge * 0.001 || e.mitKostenMenge < p.menge * 0.99)
        // Nicht für namensgleiche Token: ihr Einstand stammt meist aus einer Bewertung
        // über den NAMEN (vor FUN-PRT-001) — als Steuerwert nicht belastbar.
        if (p.chf == null && !p.token && p.kostenbasis != null && kaufpreisErlaubt(kz)) {
            p.chf = p.kostenbasis
            p.kursChf = p.kaufkurs
            p.kursQuelle = 'Kaufpreis'
        }
        p.unrealisiert = p.chf != null && p.kostenbasis != null ? p.chf - p.kostenbasis : null
    }
    const vermoegen = [...jeAsset.values()].sort((a, b) => (b.chf ?? -1) - (a.chf ?? -1))
    const vermoegenSumme = vermoegen.reduce((s, p) => s + (p.chf || 0), 0)
    if (negativ.length) hinweise.push({ art: 'negativ', text: 'Negative Bestände am Stichtag — ein Zugang fehlt in der Historie.', liste: negativ })
    const mitKaufpreis = vermoegen.filter((p) => String(p.kursQuelle).startsWith('Kaufpreis'))
    if (mitKaufpreis.length) {
        hinweise.push({
            art: 'kaufpreis', coins: mitKaufpreis.map((p) => ({ asset: p.asset, chf: p.chf })),
            text: `Ohne Kurs bewertet zum Kaufpreis (Kanton ${kz} erlaubt es): ${mitKaufpreis.length} Coins, zusammen ${Math.round(mitKaufpreis.reduce((a, p) => a + p.chf, 0))} CHF. Ist ein Projekt tot, als Totalverlust markieren — sonst zählt der Einstand als Vermögen.`,
        })
    }
    if (nachEnde.length) hinweise.push({ art: 'beendet', liste: nachEnde, text: 'Bestand an Orten, die nicht mehr genutzt werden — nach ihrem „genutzt bis“ nicht gezählt. Fehlt der Abgang (Verkauf, Auszahlung) in den Daten?' })
    if (ausgeblendet.length) hinweise.push({ art: 'totalverlust', text: `Als Totalverlust markiert und für ${jahr} nicht im Vermögen: ${ausgeblendet.join(', ')}.` })
    if (estv.fehler) hinweise.push({ art: 'estv', text: `ESTV-Kursliste ${jahr} konnte nicht gelesen werden (${estv.fehler}) — es gelten Börsenkurse; Kurse der ESTV von Hand eintragen.` })
    else if (estv.nichtErschienen) hinweise.push({ art: 'estv', text: `Die ESTV-Kursliste ${jahr} ist noch nicht erschienen (jeweils am 1. Januar) — bis dahin gelten Börsenkurse.` })

    // ── Einkommen ──
    const ek = einkommen(bew, von, bis)
    const jeCoin = new Map()
    for (const b of ek.zeilen) {
        const a = String(b.asset).toUpperCase()
        const z = jeCoin.get(a) || { asset: b.asset, name: coinName(a, estvNamen), menge: 0, chf: 0, n: 0, ohneWert: 0 }
        z.menge += Number(b.menge) || 0
        z.n++
        if (b.chfWert == null) z.ohneWert++
        else z.chf += Number(b.chfWert)
        jeCoin.set(a, z)
    }

    // ── Abgänge (FIFO über die ganze Historie) ──
    const { abgaenge } = fifo(bew, { fiat: FIAT, von, bis, halteMonate, ident })
    const vs = veraeusserungen(abgaenge)

    // ── Kriterien ──
    const vorjahr = jahrGrenzen(jahr - 1)
    let vermoegenAnfang = null
    let m0 = new Map(), k0 = null
    try {
        m0 = bestandAm(belegbar, vorjahr.bis, ident)
        for (const [key, m] of m0) if (m <= 0) m0.delete(key)
        ohneTotalverluste(m0, jahr - 1)
        ohneBeendete(m0, vorjahr.bis)
        k0 = await bewerte(m0, jahr - 1, tokenOrte)
        vermoegenAnfang = 0
        for (const [key, m] of m0) { const kurs = kursAn(k0, tokenOrte, key); if (kurs?.chf != null) vermoegenAnfang += m * kurs.chf }
    } catch { vermoegenAnfang = null }

    // ── Bestandesrechnung 1.1. → 31.12. je Coin (über alle Orte) ──
    // Anfang und Ende genau so, wie der Bericht sie ausweist (Spam ohne Kurs, negative Orte weg).
    const jeId = (m, kx, spam) => {
        const aus = new Map()
        for (const [key, menge] of m) {
            if (!(menge > 0) || spam(key, kx)) continue
            const [, asset, fremd] = key.split('\u0000')
            const id = fremd ? `${String(asset).toUpperCase()}|${fremd}` : String(asset).toUpperCase()
            aus.set(id, (aus.get(id) || 0) + menge)
        }
        return aus
    }
    const spamAm = (key, kx) => {
        const t = tokenOrte.get(key)
        return !!t && (!kx || kursAn(kx, tokenOrte, key)?.chf == null) && istSpam(key.split('\u0000')[1], t.kontrakt, { ohneKurs: true })
    }
    const bestandJahr = bestandesrechnung(belegbar, von, bis, jeId(m0, k0, spamAm), jeId(mengen, kurse, (key) => spamOrte.has(key)), ident)
        .map((z) => ({ ...z, name: coinName(z.asset, estvNamen, !!z.kontrakt) }))
    const veraenderungJahr = veraenderungen(belegbar, von, bis, ident).map((v) => ({ ...v, quelle: name(v.quelle) }))

    // ── Devisenkurse am Bewertungstag (EZB) ──
    const fxTag = laufend ? gestern : `${jahr}-12-31`
    const usdChf = await fxAm(fxTag, 'CHF').catch(() => null)
    const usdEur = await fxAm(fxTag, 'EUR').catch(() => null)
    const devisen = { datum: fxTag, usdChf, eurChf: usdChf && usdEur ? usdChf / usdEur : null, quelle: 'EZB' }
    const volumenSpot = bew.filter((b) => b.zeit >= von && b.zeit <= bis && ['kauf', 'verkauf', 'tausch'].includes(b.art) && b.einordnung !== 'ignorieren' && b.chfWert != null && !istMigration(b))
        .reduce((s, b) => s + Math.abs(Number(b.chfWert)), 0)
    // Futures: Ergebnis, Volumen, Guthaben am Stichtag. Fällt das Journal aus,
    // bleibt der Spot-Bericht stehen.
    let futures = null
    try { futures = await futuresSteuerjahr(jahr, { von, bis, laufend }) } catch (e) { futures = { fehler: e.message } }
    const volumenFutures = futures?.summe?.volumenChf || 0
    const volumen = volumenSpot + volumenFutures
    // Vermögen am Anfang inkl. Futures-Guthaben des Vorjahrs (sonst wäre das Volumen-Verhältnis zu streng).
    if (vermoegenAnfang != null) {
        try {
            const fv = await futuresSteuerjahr(jahr - 1, { von: vorjahr.von, bis: vorjahr.bis, laufend: false })
            vermoegenAnfang += fv.guthabenChf || 0
        } catch { /* Spot allein */ }
    }
    const kriterien = gewerbsKriterien({ volumen, vermoegenAnfang, kurzfristigErloes: vs.kurzfristigErloes, haltedauerUnbekanntErloes: vs.haltedauerUnbekanntErloes, erloes: vs.erloes, futuresTrades: futures?.summe?.n ?? await futuresTrades(von, bis) })
    if (futures?.guthaben?.some((g) => g.sicherheit === 'abgeleitet')) {
        hinweise.push({ art: 'futuresAbgeleitet', text: 'Futures-Guthaben am Stichtag ist zurückgerechnet (heute − Ergebnis seither). Ein- und Auszahlungen nach dem Stichtag sind darin nicht abgezogen — mit dem Kontoauszug der Börse prüfen und den Wert eintragen.' })
    }

    return {
        jahr, stichtag: bis, laufend,
        vermoegen, vermoegenSumme, ohneKurs: vermoegen.filter((p) => p.chf == null).map((p) => p.asset),
        einkommen: {
            summe: ek.summe, ohneWert: ek.ohneWert, jeArt: ek.jeArt, jeAsset: ek.jeAsset,
            jeCoin: [...jeCoin.values()].sort((a, b) => b.chf - a.chf),
            zeilen: ek.zeilen.map((b) => ({ id: b.id, zeit: b.zeit, quelle: name(b.quelle), art: ['staking', 'airdrop', 'belohnung'].includes(b.art) ? b.art : 'eingeordnet', asset: b.asset, menge: b.menge, chfWert: b.chfWert, sicherheit: b.sicherheit })),
        },
        veraeusserungen: { ...vs, abgaenge: abgaenge.filter((a) => a.art !== 'gebuehr').map((a) => ({ ...a, quelle: name(a.quelle) })) },
        kriterien: kriterien.map((x) => (x.id === 'volumen' ? { ...x, volumen, volumenSpot, volumenFutures, vermoegenAnfang }
            : x.id === 'haltedauer' ? { ...x, monate: halteMonate } : x)),
        kanton: kt, estv, totalverlustAusgeblendet: ausgeblendet, bestandesrechnung: bestandJahr, veraenderungen: veraenderungJahr, devisen,
        kostenbasisSumme: vermoegen.reduce((s, p) => s + (p.kostenbasis || 0), 0),
        futures,
        vermoegenGesamt: vermoegenSumme + (futures?.guthabenChf || 0),
        hinweise,
    }
}

/**
 * CSV als Beilage zur Steuererklärung — derselbe Inhalt wie der Bericht: nur, was
 * die Steuerämter verlangen (Bestand, Kurs, Steuerwert, Erträge, Veränderungen).
 * Gewinne, Einstand und die KS-36-Kriterien stehen nur in der App.
 */
export function steuerCsv(s) {
    // Zahlen ohne Exponent (5e-7 liest Excel als Text) und Texte, die mit = + - @
    // beginnen, mit Apostroph: ein Token-Name wie „=HYPERLINK(…)“ wäre sonst eine Formel.
    const zahl = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 12, useGrouping: false }) : '')
    const text = (v) => `"${(/^[=+\-@\t\r]/.test(v) ? "'" : '') + v.replace(/"/g, '""')}"`
    const z = (v) => (v == null ? '' : typeof v === 'number' ? zahl(v) : text(String(v)))
    const d = (ms) => new Date(ms).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })
    const kt = s.kanton
    const zeilen = [
        `Steuerjahr ${s.jahr} — Stichtag 31.12.${s.jahr}${s.laufend ? ' (provisorisch)' : ''}`,
        kt ? z(`Kanton ${kt.name} (${kt.kz}): ${[kt.formular, kt.rubrik, kt.code ? `Code ${kt.code}` : null].filter(Boolean).join(' · ')}`) : 'Kanton: nicht gewählt',
        s.estv?.anzahl ? `ESTV-Kursliste ${s.jahr}: ${s.estv.anzahl} Coins` : '',
        s.devisen?.usdChf ? `Devisenkurse EZB zum ${s.devisen.datum.split('-').reverse().join('.')}: USD/CHF ${zahl(s.devisen.usdChf)}; EUR/CHF ${zahl(s.devisen.eurChf)}` : '', '',
        'VERMÖGEN (Wertschriftenverzeichnis);Name;Valor;Menge;Kurs CHF 31.12.;Steuerwert CHF;Kursquelle;Orte']
    for (const p of s.vermoegen) {
        zeilen.push([p.asset + (p.token ? ' (Token)' : ''), p.name, p.valor, p.menge, p.kursChf, p.chf, p.kursQuelle,
            p.orte.map((o) => `${o.name} ${o.menge}`).join(' | ')].map(z).join(';'))
    }
    zeilen.push(['Total', '', '', '', '', s.vermoegenSumme, '', ''].map(z).join(';'))
    const f = s.futures
    if (f && !f.fehler && f.guthaben?.length) {
        zeilen.push('', 'GUTHABEN AUF FUTURES-BÖRSEN AM STICHTAG (Vermögen);Wert USDT;Kurs USD/CHF;Wert CHF')
        for (const g of f.guthaben) zeilen.push([g.name, g.usd, f.stichtagKurs, g.chf].map(z).join(';'))
        zeilen.push(['Total', '', '', f.guthabenChf].map(z).join(';'))
    }
    if (s.bestandesrechnung?.length) {
        zeilen.push('', 'BESTANDESRECHNUNG (über alle Orte);Name;Bestand 1.1.;Zugänge;Abgänge;Übrige;Bestand 31.12.')
        for (const b of s.bestandesrechnung) zeilen.push([b.asset + (b.kontrakt ? ` (Token ${b.kontrakt})` : ''), b.name, b.anfang, b.zugang, b.abgang, b.uebrige, b.ende].map(z).join(';'))
    }
    if (s.einkommen.jeCoin?.length) {
        zeilen.push('', 'ERTRÄGE JE COIN — Rubrik B;Name;Zuflüsse;Menge;Wert CHF')
        for (const c of s.einkommen.jeCoin) zeilen.push([c.asset, c.name, c.n, c.menge, c.chf].map(z).join(';'))
    }
    zeilen.push('', 'ERTRÄGE (Staking, Airdrops, Belohnungen) — Rubrik B;Datum;Ort;Art;Menge;Wert CHF beim Zufluss')
    for (const e of s.einkommen.zeilen) zeilen.push([e.asset, d(e.zeit), e.quelle, e.art, e.menge, e.chfWert].map(z).join(';'))
    zeilen.push(['Total', '', '', '', '', s.einkommen.summe].map(z).join(';'))
    zeilen.push('', 'VERÄNDERUNGEN (Käufe, Verkäufe, Tausch, Ein- und Auszahlungen);Ort;Art;Abgang Coin;Abgang Menge;Zugang Coin;Zugang Menge;Wert CHF')
    for (const v of s.veraenderungen || []) zeilen.push([d(v.zeit), v.quelle, v.art, v.ab?.asset, v.ab?.menge, v.zu?.asset, v.zu?.menge, v.chfWert].map(z).join(';'))
    zeilen.push('', 'Methode: Stichtag 31.12. 23:59:59 Europe/Zurich; Kurse: ESTV-Kursliste, sonst Tagesschlusskurs der Börse (Spalte Kursquelle); USD/CHF und EUR/CHF der EZB.')
    return '\ufeff' + zeilen.join('\n') + '\n'
}
