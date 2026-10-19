/**
 * Filterprüfung und Anreicherung eines Trades — rein, ohne Stores und Netz.
 *
 * `baueNachschlag` macht aus den Begleitdaten Tabellen (bei Mehrfachtreffern
 * gewinnt der SPÄTERE Eintrag), `passtFilter` entscheidet je Trade, und
 * `reichereAn` erzeugt den gefilterten Trade, wie Ansichten und Diagramme ihn
 * lesen (Spezifikation journal-kern.md §3.5, §4.1).
 */

/** Pseudo-Tag „ohne Tag" in der Auswahl. */
export const OHNE_TAG = 't000t'

const alsListe = (x) => (Array.isArray(x) ? x : [])

/**
 * @param {object} q
 * @param {Array} q.tagZeilen       `{tradeId, tags, dateUnix}`
 * @param {Array} q.tagesZufriedenheit  `{dateUnix, satisfaction}`
 * @param {Array} q.tradeZufriedenheit  `{tradeId, satisfaction}`
 * @param {Array} q.exkursionen     Exkursionszeilen
 * @param {Array} q.notizen         Notizzeilen (nur `tradeId`, `tradeType` zählen)
 * @param {Array} q.katalog         Tag-Gruppen `{tags: [{id, name}]}`
 */
export function baueNachschlag({ tagZeilen = [], tagesZufriedenheit = [], tradeZufriedenheit = [], exkursionen = [], notizen = [], katalog = [] }) {
    const n = {
        tradeTags: new Map(),
        tagesTags: new Map(),
        tagesZufriedenheit: new Map(),
        tradeZufriedenheit: new Map(),
        exkursion: new Map(),
        tradeTyp: new Map(),
        tagName: new Map(),
    }
    for (const z of tagZeilen) {
        if (z.tradeId != null) n.tradeTags.set(String(z.tradeId), alsListe(z.tags))
        // auch Trade-Zeilen landen hier unter ihrem dateUnix — so gewollt (§4.1)
        if (z.dateUnix != null) n.tagesTags.set(String(z.dateUnix), alsListe(z.tags))
    }
    for (const z of tagesZufriedenheit) n.tagesZufriedenheit.set(String(z.dateUnix), z.satisfaction)
    for (const z of tradeZufriedenheit) n.tradeZufriedenheit.set(String(z.tradeId), z.satisfaction)
    for (const z of exkursionen) n.exkursion.set(String(z.tradeId), z)
    for (const z of notizen) {
        if (z.tradeType && z.tradeId) n.tradeTyp.set(String(z.tradeId), z.tradeType)
    }
    for (const gruppe of katalog) {
        if (!gruppe.tags) continue
        for (const tag of gruppe.tags) n.tagName.set(tag.id, tag.name)
    }
    return n
}

const istAgent = (t) => t.category === 'agent'
const istBot = (t) => !!t.botType

/**
 * Baut die Prüffunktion aus der aktuellen Auswahl.
 * @returns {(trade: object, n: object) => boolean}
 */
export function erstelleFilter({ boerse, kategorie, bereich, richtungen, konten, gewaehlteTags }) {
    const kat = kategorie || 'all'
    const alles = Number(bereich?.start) === 0 && Number(bereich?.end) === 0
    const ohneKonten = !(konten && konten.length)
    const auswahl = new Set(gewaehlteTags || [])
    const ohneTagGewaehlt = auswahl.has(OHNE_TAG)

    // Eine Tag-Quelle passt, wenn sie einen gewählten Tag trägt — oder leer
    // ist und „ohne Tag" gewählt wurde. Zwei Quellen, ODER (§7.10).
    const quellePasst = (liste) => (liste.length > 0 ? liste.some(id => auswahl.has(id)) : ohneTagGewaehlt)

    return function passtFilter(t, n) {
        if (boerse && t.broker !== boerse) return false

        if (kat === 'agent') {
            if (!istAgent(t)) return false
        } else {
            if (istAgent(t)) return false
            if (kat === 'bot' && !istBot(t)) return false
            if (kat !== 'all' && kat !== 'bot' && istBot(t)) return false
        }

        if (alles ? !(t.td >= 0) : !(t.td >= bereich.start && t.td < bereich.end)) return false
        if (!(richtungen || []).includes(t.strategy)) return false
        if (!(kat === 'bot' || ohneKonten || konten.includes(t.account) || t.account === boerse)) return false

        if (istBot(t) || istAgent(t)) return true
        return quellePasst(n.tradeTags.get(String(t.id)) || [])
            || quellePasst(n.tagesTags.get(String(t.td)) || [])
    }
}

const wennWahr = (v) => (v ? v : null)

/**
 * Gefilterter Trade: Kopie ohne `excursions`, dazu `priceVar`, `tags`
 * (zugeordnet UND gewählt UND im Katalog benannt), Zufriedenheit, Exkursion
 * und Trade-Typ.
 */
export function reichereAn(t, n, gewaehlteTags) {
    const { excursions, ...kopie } = t
    const auswahl = new Set(gewaehlteTags || [])

    const tags = []
    const genommen = new Set()
    for (const id of [...(n.tradeTags.get(String(t.id)) || []), ...(n.tagesTags.get(String(t.td)) || [])]) {
        if (!auswahl.has(id) || genommen.has(id) || !n.tagName.has(id)) continue
        genommen.add(id)
        tags.push({ id, name: n.tagName.get(id) })
    }

    const exk = n.exkursion.get(String(t.id))
    const zuf = String(t.id)
    return Object.assign(kopie, {
        priceVar: t.strategy === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice,
        tags,
        satisfaction: n.tradeZufriedenheit.has(zuf) ? n.tradeZufriedenheit.get(zuf) : null,
        stopLoss: exk ? wennWahr(exk.stopLoss) : null,
        maePrice: exk ? wennWahr(exk.maePrice) : null,
        mfePrice: exk ? wennWahr(exk.mfePrice) : null,
        tradeType: n.tradeTyp.get(zuf) || '',
    })
}
