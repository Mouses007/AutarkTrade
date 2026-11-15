/**
 * Coach-Werkzeug für den Portfolio-Modus.
 *
 * Liest dieselben Rechnungen wie die Seiten (`berechneUebersicht`,
 * `dcaAnsicht`, `stakingAnsicht`, `berechneBilanz`) — keine zweite Fassung.
 *
 * Was NICHT hinausgeht: Wallet-Adressen, xpubs, Transaktions-Hashes, die
 * Rohdaten der Börsen (`roh`), Notizen, Schlüssel. Als Spam erkannte Token
 * fehlen ganz — ihr „Name" ist die Werbebotschaft (`spam.js` erkennt sie
 * genau daran). Kürzel von Token mit Vertragsadresse sind frei wählbar und
 * stehen als Zitat; deshalb trägt das Werkzeug `fremdtext: true`.
 */
import { berechneUebersicht } from '../portfolio/uebersicht.js'
import { berechneBilanz } from '../portfolio/bilanz.js'
import { stakingAnsicht, dcaAnsicht } from '../portfolio/api.js'
import { zitatZeile } from '../fremdtext.js'
import { zahl, kurzBetrag, zeit, grenze } from './gemeinsam.js'

const HINWEIS = 'Beträge in CHF. „?" heisst unbekannt, nicht null. Keine Anlage- oder Steuerberatung; keine Kauf- oder Verkaufsempfehlung daraus ableiten.'
const chf = (w) => (w === null || w === undefined || !Number.isFinite(Number(w)) ? '?' : Math.round(Number(w)).toLocaleString('de-CH'))
const kuerzel = (p) => (p.kontrakt ? zitatZeile(p.asset, 20) : String(p.asset || '?').replace(/[^A-Za-z0-9.]/g, '').slice(0, 20))
const tag = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : '?')

export async function toolQueryPortfolio(knex, params = {}) {
    const bereich = ['uebersicht', 'dca', 'staking', 'bilanz', 'bewegungen'].includes(params.bereich) ? params.bereich : 'uebersicht'
    const limit = grenze(params.limit, 20, 50)

    if (bereich === 'uebersicht' || bereich === 'bilanz') {
        const u = await berechneUebersicht({ ohneVerlauf: true })
        if (bereich === 'bilanz') {
            const b = await berechneBilanz({ spotChf: u.gesamt.chf, usdChf: u.fx.chf })
            return {
                bereich: 'Bilanz',
                hinweis: HINWEIS + ' „Differenz" ist Wert heute minus netto eingezahltes Bargeld, kein steuerlicher Gewinn.',
                zeilen: [
                    `Eingezahlt ${chf(b.eingezahltChf)}, ausgezahlt ${chf(b.ausgezahltChf)}, Kartenzahlungen ${chf(b.karteChf)}, netto ${chf(b.nettoChf)}`,
                    `Wert heute ${chf(b.wertChf)} (Spot ${chf(b.spotChf)}, Futures-Konten ${chf(b.futuresChf)})`,
                    `Differenz ${chf(b.differenzChf)}`,
                    ...(b.futures || []).map((f) => `Futures-Konto ${String(f.name || f.boerse).replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 30)}: ${chf(f.chf)}`),
                ],
            }
        }
        const posten = (u.posten || []).filter((p) => !p.spam && (params.mitStaub === true || !p.staub)).sort((a, b) => (b.chf || 0) - (a.chf || 0))
        if (!posten.length) return { error: 'Im Portfolio sind keine Bestände erfasst (keine Quelle eingerichtet oder noch kein Abruf).' }
        return {
            bereich: 'Übersicht',
            gesamtChf: chf(u.gesamt?.chf),
            ohneKurs: u.gesamt?.ohneKurs || 0,
            count: posten.length,
            anzahlGezeigt: Math.min(limit, posten.length),
            hinweis: HINWEIS + ' „Einstand teilweise" heisst: für einen Teil des Bestands fehlt der Kaufpreis.',
            zeilen: posten.slice(0, limit).map((p) => [
                kuerzel(p), `Menge ${zahl(p.menge, 6)}`, p.ohneKurs ? 'ohne Kurs' : `Wert ${chf(p.chf)}`,
                p.anteil != null ? `Anteil ${zahl(p.anteil * 100, 1)} %` : null,
                p.kaufkurs != null ? `Kaufkurs ${kurzBetrag(p.kaufkurs)}` : null,
                p.einstandChf != null ? `Einstand ${chf(p.einstandChf)}${p.einstandTeilweise ? ' (teilweise)' : ''}` : null,
                p.unrealisiertChf != null ? `unrealisiert ${chf(p.unrealisiertChf)}` : null,
                p.ersterKauf ? `erster Kauf ${tag(p.ersterKauf)}` : null,
            ].filter(Boolean).join(', ')),
        }
    }

    if (bereich === 'dca') {
        const d = await dcaAnsicht({ nurLaufende: params.nurLaufende === true })
        if (!d.coins?.length) return { error: 'Keine DCA-Käufe (Sparplan) erfasst.' }
        const s = d.summe || {}
        return {
            bereich: 'DCA-Portfolio',
            summe: `investiert ${chf(s.investiertChf)}, Wert ohne Auszahlungen ${chf(s.wertHeuteChf)}, Gewinn ${chf(s.gewinnChf)}${s.gewinnPct != null ? ' (' + zahl(s.gewinnPct * 100, 1) + ' %)' : ''}, laufende Pläne ${s.aktivePlaene ?? '?'}`,
            count: d.coins.length,
            hinweis: HINWEIS + ' Die Seite misst die Strategie: gezählt wird alles so Gekaufte, unabhängig von späteren Verkäufen oder Auszahlungen.',
            zeilen: d.coins.slice(0, limit).map((c) => [
                String(c.asset).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12) + (c.umgestellt ? ` (heute ${String(c.heuteAsset).replace(/[^A-Za-z0-9.]/g, '')})` : ''),
                `${c.anzahl} Käufe ${tag(c.von)} bis ${tag(c.bis)}`, `investiert ${chf(c.investiertChf)}`, `Wert ${chf(c.wertHeuteChf)}`,
                c.gewinnChf != null ? `Gewinn ${chf(c.gewinnChf)}${c.gewinnPct != null ? ' (' + zahl(c.gewinnPct * 100, 1) + ' %)' : ''}` : null,
                Array.isArray(c.plaene) ? `Pläne laufend ${c.plaene.filter((x) => x.aktiv).length} von ${c.plaene.length}` : null,
            ].filter(Boolean).join(', ')),
        }
    }

    if (bereich === 'staking') {
        const st = await stakingAnsicht()
        if (!st.produkte?.length) return { error: 'Keine Staking-Erträge erfasst.' }
        return {
            bereich: 'Staking',
            count: st.produkte.length,
            hinweis: HINWEIS + ' Rendite p.a. ist aus den Erträgen der letzten 90 Tage gemessen, kein Versprechen.',
            zeilen: st.produkte.slice(0, limit).map((p) => [
                `${String(p.asset).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12)} (${String(p.produkt || '').replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 24)})`,
                p.aktiv ? 'läuft' : 'beendet', `${p.anzahl} Auszahlungen`, `Ertrag ${zahl(p.ertragMenge, 6)} = ${chf(p.ertragChf)} bei Erhalt, ${chf(p.ertragHeuteChf)} heute`,
                p.bestandChf != null ? `Bestand ${chf(p.bestandChf)}` : null, p.renditePa != null ? `Rendite ${zahl(p.renditePa, 1)} % p.a.` : null,
            ].filter(Boolean).join(', ')),
        }
    }

    // Bewegungen: nur die Felder der Liste, ohne Hash, Adresse, Rohdaten.
    const q = knex('portfolio_bewegungen').select('zeit', 'art', 'asset', 'menge', 'gegenAsset', 'gegenMenge', 'chfWert', 'kontrakt', 'quelle')
    if (typeof params.asset === 'string' && /^[A-Za-z0-9.]{1,12}$/.test(params.asset)) {
        const a = params.asset.toUpperCase()
        q.where((w) => w.where('asset', a).orWhere('gegenAsset', a))
    }
    const zeilen = await q.orderBy('zeit', 'desc').orderBy('id', 'desc').limit(limit)
    if (!zeilen.length) return { error: 'Keine Bewegungen erfasst.' }
    return {
        bereich: 'Bewegungen',
        count: zeilen.length,
        hinweis: HINWEIS,
        zeilen: zeilen.map((z) => [
            zeit(z.zeit), String(z.art || '?').replace(/\W/g, ''), `${zahl(z.menge, 6)} ${kuerzel({ asset: z.asset, kontrakt: z.kontrakt })}`,
            z.gegenAsset ? `gegen ${zahl(z.gegenMenge, 2)} ${String(z.gegenAsset).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12)}` : null,
            z.chfWert != null ? `Wert ${chf(z.chfWert)}` : null,
            /^[a-z]{3,12}$/.test(String(z.quelle)) ? `Ort ${z.quelle}` : 'Ort Wallet/Import',
        ].filter(Boolean).join(', ')),
    }
}

export const PORTFOLIO_TOOLS = [{
    name: 'query_portfolio',
    fremdtext: true,
    description: 'Read the Portfolio mode (spot holdings across exchanges and wallets). bereich: "uebersicht" (holdings with value, share, cost basis, unrealised result; default) | "bilanz" (cash paid in vs. value today, incl. futures accounts) | "dca" (savings-plan purchases per coin) | "staking" (staking products and rewards) | "bewegungen" (latest movements, optional asset filter). Amounts in CHF. Never contains addresses or transaction hashes. No investment or tax advice.',
    parameters: {
        type: 'object',
        properties: {
            bereich: { type: 'string', enum: ['uebersicht', 'bilanz', 'dca', 'staking', 'bewegungen'], description: 'Which part (default uebersicht)' },
            limit: { type: 'number', description: 'Max rows (default 20, max 50)' },
            asset: { type: 'string', description: 'bewegungen only: ticker filter, e.g. BTC' },
            mitStaub: { type: 'boolean', description: 'uebersicht only: include dust positions' },
            nurLaufende: { type: 'boolean', description: 'dca only: hide coins without a running plan' },
        },
    },
}]

export const PORTFOLIO_TOOL_IMPL = { query_portfolio: toolQueryPortfolio }
