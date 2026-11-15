/**
 * Stamm-Abgleich, der Teil ohne Netz: Listen einsammeln (Abrufe werden
 * hereingereicht), speichern, lesen. Getrennt von `stamm.js`, damit der
 * Selbsttest ohne Börsen-Clients und ohne Schlüsseldatei läuft.
 *
 * Die drei Regeln stehen im Kopf von `stamm.js`.
 */

import { buendle } from './einordnung.js'

export const HANDELSPLAETZE = ['binance', 'bitget', 'bitunix', 'pionex', 'bitpanda']

/**
 * Alle Listen parallel holen.
 * @returns {{roh: object, stand: Record<string, {ok: boolean, anzahl?: number, grund?: string}>}}
 */
export async function holeListen(abrufe) {
    const roh = {}, stand = {}
    await Promise.all(HANDELSPLAETZE.map(async (platz) => {
        try {
            const liste = await abrufe[platz]()
            if (liste === null) { stand[platz] = { ok: false, grund: 'nichtGewaehlt' }; return }
            if (!liste.length) { stand[platz] = { ok: false, grund: 'leer' }; return }
            roh[platz] = liste
            stand[platz] = { ok: true, anzahl: liste.length }
        } catch (e) {
            stand[platz] = { ok: false, grund: String(e?.message || e).slice(0, 200) }
        }
    }))
    return { roh, stand }
}

/* ── Speichern ── */

const stuecke = (liste, n) => {
    const out = []
    for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n))
    return out
}
const lSchluessel = (l) => `${l.handelsplatz}|${l.symbol}|${l.art}`

/**
 * Eingeordnete Listungen in die Datenbank schreiben.
 *
 * @param {import('knex').Knex} knex
 * @param {object[]} listungen   Ergebnis von `ordneAlle`
 * @param {string[]} gelesen     Handelsplätze, deren Liste diesmal vollständig kam
 * @param {number}   jetzt
 * @returns {{titel: number, listungen: number, neu: object[], weg: object[], gebremst: string[]}}
 */
export async function speichereStamm(knex, listungen, gelesen, jetzt = Date.now()) {
    const relevant = listungen.filter((l) => l.anlageklasse !== 'krypto' && gelesen.includes(l.handelsplatz))
    const titel = buendle(relevant)

    return knex.transaction(async (trx) => {
        // 1. Instrumente: fehlende anlegen, bekannte nur dort ergänzen, wo wir jetzt mehr wissen.
        const iSchluessel = (z) => `${z.anlageklasse}|${z.ticker}`
        let vorhanden = new Map((await trx('instrumente').select()).map((z) => [iSchluessel(z), z]))
        const fehlend = titel.filter((t) => !vorhanden.has(t.schluessel))
        for (const teil of stuecke(fehlend, 100)) {
            await trx('instrumente').insert(teil.map((t) => ({
                anlageklasse: t.anlageklasse, ticker: t.basis, unterart: t.unterart,
                name: t.name, region: t.region, stand: jetzt, createdAt: jetzt,
            })))
        }
        if (fehlend.length) vorhanden = new Map((await trx('instrumente').select()).map((z) => [iSchluessel(z), z]))
        for (const t of titel) {
            const z = vorhanden.get(t.schluessel)
            const neuWert = {}
            // Die genauere Unterart gewinnt (ETF/vorbörslich schlägt Aktie), nie umgekehrt.
            if (z.unterart !== t.unterart && (t.unterart === 'etf' || t.unterart === 'vorboerslich' || !z.unterart)) neuWert.unterart = t.unterart
            if (!z.name && t.name) neuWert.name = t.name
            if (!z.region && t.region) neuWert.region = t.region
            if (Object.keys(neuWert).length) await trx('instrumente').where('id', z.id).update({ ...neuWert, stand: jetzt })
        }

        // 2. Listungen.
        const alt = await trx('instrument_listungen').select()
        const altKarte = new Map(alt.map((z) => [lSchluessel(z), z]))
        const bekanntePlaetze = new Set(alt.map((z) => z.handelsplatz))
        const gesehen = new Set()
        const neu = [], anlegen = [], auffrischen = []
        for (const t of titel) {
            const instrumentId = vorhanden.get(t.schluessel).id
            for (const l of t.listungen) {
                const k = lSchluessel(l)
                if (gesehen.has(k)) continue
                gesehen.add(k)
                const z = altKarte.get(k)
                if (!z) {
                    anlegen.push({
                        instrumentId, handelsplatz: l.handelsplatz, symbol: l.symbol, art: l.art, quote: l.quote,
                        maxHebel: l.maxHebel, sicher: l.sicher ? 1 : 0, aktiv: 1, ersteSichtung: jetzt, letzteSichtung: jetzt,
                        gelistetSeit: l.gelistetSeit,
                    })
                    // Regel 3: der erste Abgleich eines Handelsplatzes ist die Ausgangslage.
                    if (bekanntePlaetze.has(l.handelsplatz)) neu.push({ ...l, ticker: t.basis, name: t.name })
                } else {
                    auffrischen.push(z.id)
                    if (!z.aktiv) neu.push({ ...l, ticker: t.basis, name: t.name, wieder: true })
                    const seit = l.gelistetSeit ?? (z.gelistetSeit != null ? Number(z.gelistetSeit) : null)
                    if (z.instrumentId !== instrumentId || (z.maxHebel ?? null) !== (l.maxHebel ?? null) || !!z.sicher !== l.sicher
                        || (z.gelistetSeit != null ? Number(z.gelistetSeit) : null) !== seit) {
                        await trx('instrument_listungen').where('id', z.id)
                            .update({ instrumentId, maxHebel: l.maxHebel, sicher: l.sicher ? 1 : 0, gelistetSeit: seit })
                    }
                }
            }
        }
        for (const teil of stuecke(anlegen, 100)) await trx('instrument_listungen').insert(teil)
        for (const teil of stuecke(auffrischen, 400)) {
            await trx('instrument_listungen').whereIn('id', teil).update({ aktiv: 1, letzteSichtung: jetzt })
        }

        // 3. Abschalten, was eine vollständig gelesene Liste nicht mehr führt (Regeln 1 und 2).
        const weg = [], gebremst = []
        for (const platz of gelesen) {
            const vorher = alt.filter((z) => z.handelsplatz === platz && z.aktiv)
            const fehlt = vorher.filter((z) => !gesehen.has(lSchluessel(z)))
            if (!fehlt.length) continue
            if (vorher.length >= 10 && fehlt.length > vorher.length / 2) { gebremst.push(platz); continue }
            for (const teil of stuecke(fehlt.map((z) => z.id), 400)) {
                await trx('instrument_listungen').whereIn('id', teil).update({ aktiv: 0 })
            }
            weg.push(...fehlt.map((z) => ({ handelsplatz: z.handelsplatz, symbol: z.symbol, art: z.art })))
        }

        return { titel: titel.length, listungen: gesehen.size, neu, weg, gebremst }
    })
}

/* ── Lesen ── */

/**
 * Titel mit ihren aktiven Listungen.
 *
 * Mit `suche` kommt der exakte Ticker zuerst, dann «Ticker beginnt mit», dann
 * «Name enthält» — und erst danach wird begrenzt. Sonst verdrängen bei «V»
 * oder «GE» die Namens-Treffer den gesuchten Titel (Audit DB-D-001).
 *
 * @param {{anlageklasse?: string, ticker?: string, suche?: string, handelsplatz?: string, art?: string,
 *          nurKryptoBoersen?: boolean, grenze?: number}} filter  `ticker` = genau dieser Ticker
 */
export async function leseStamm(knex, filter = {}) {
    const grenze = Math.min(Math.max(Number(filter.grenze) || 200, 1), 5000)
    let q = knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId').where('l.aktiv', 1)
    if (filter.anlageklasse) q = q.where('i.anlageklasse', filter.anlageklasse)
    if (filter.handelsplatz) q = q.where('l.handelsplatz', filter.handelsplatz)
    if (filter.art) q = q.where('l.art', filter.art)
    if (filter.nurKryptoBoersen) q = q.whereNot('l.handelsplatz', 'bitpanda')
    const suche = String(filter.suche || '').trim().toUpperCase().replace(/[%_\\]/g, '')
    if (filter.ticker) q = q.where('i.ticker', String(filter.ticker).toUpperCase())
    if (suche) q = q.where((w) => w.where('i.ticker', 'like', `${suche}%`).orWhereRaw('upper(??) like ?', ['i.name', `%${suche}%`]))
    // Gruppieren statt DISTINCT: PostgreSQL verlangt bei DISTINCT jede Sortierspalte in der Auswahl.
    let idAbfrage = q.clone().select('i.id').groupBy('i.id', 'i.ticker')
    if (suche) {
        idAbfrage = idAbfrage
            .orderByRaw('case when ?? = ? then 0 when ?? like ? then 1 else 2 end', ['i.ticker', suche, 'i.ticker', `${suche}%`])
            .orderBy('i.ticker')
    }
    const ids = (await idAbfrage.orderBy('i.id').limit(grenze)).map((z) => z.id)
    if (!ids.length) return []
    const [titel, listungen] = await Promise.all([
        knex('instrumente').whereIn('id', ids).orderBy('ticker'),
        knex('instrument_listungen').whereIn('instrumentId', ids).where('aktiv', 1),
    ])
    const je = new Map()
    for (const l of listungen) {
        if (!je.has(l.instrumentId)) je.set(l.instrumentId, [])
        je.get(l.instrumentId).push({
            handelsplatz: l.handelsplatz, symbol: l.symbol, art: l.art, quote: l.quote,
            maxHebel: l.maxHebel, sicher: !!l.sicher, ersteSichtung: Number(l.ersteSichtung) || null,
            gelistetSeit: Number(l.gelistetSeit) || null,
        })
    }
    // Die Suche behält ihre Rangfolge, alles andere bleibt nach Ticker geordnet.
    if (suche) {
        const rang = new Map(ids.map((id, i) => [id, i]))
        titel.sort((a, b) => rang.get(a.id) - rang.get(b.id))
    }
    return titel.map((t) => {
        const ls = je.get(t.id) || []
        return {
            id: t.id, anlageklasse: t.anlageklasse, ticker: t.ticker, unterart: t.unterart, name: t.name,
            region: t.region, isin: t.isin, sektor: t.sektor,
            spot: ls.some((l) => l.art !== 'perp'), future: ls.some((l) => l.art === 'perp'),
            listungen: ls,
        }
    })
}

/** Zahlen für die Statuszeile: Titel je Unterart, Aktien-Titel mit Future bzw. Spot, aktive Listungen je Handelsplatz. */
export async function stammZahlen(knex) {
    const [unterarten, plaetze] = await Promise.all([
        knex('instrumente').select('anlageklasse', 'unterart').count({ n: '*' }).groupBy('anlageklasse', 'unterart'),
        knex('instrument_listungen').where('aktiv', 1).select('handelsplatz', 'art').count({ n: '*' }).groupBy('handelsplatz', 'art'),
    ])
    // Titel, nicht Listungen: NVDA an drei Börsen ist EIN Future-Titel.
    const jeTitel = async (bedingung) => Number((await bedingung(knex('instrument_listungen as l')
        .join('instrumente as i', 'i.id', 'l.instrumentId')
        .where('l.aktiv', 1).where('i.anlageklasse', 'aktien')).countDistinct({ n: 'l.instrumentId' }).first())?.n) || 0
    const [titelFuture, titelSpot] = await Promise.all([
        jeTitel((q) => q.where('l.art', 'perp')),
        jeTitel((q) => q.whereNot('l.art', 'perp')),
    ])
    return {
        titelFuture, titelSpot,
        unterarten: unterarten.map((z) => ({ anlageklasse: z.anlageklasse, unterart: z.unterart, anzahl: Number(z.n) })),
        handelsplaetze: plaetze.map((z) => ({ handelsplatz: z.handelsplatz, art: z.art, anzahl: Number(z.n) })),
    }
}
