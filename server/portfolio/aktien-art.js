/**
 * Aktien und ETFs im Spot-Portfolio (Bitpanda) — als eigene Art, nicht als Coin.
 *
 * Warum: Das Portfolio bewertet jeden Bestand über sein Kürzel (`${asset}USDT`
 * im Spot-Ticker). Für eine Aktie ist das falsch — es gibt kein solches Paar,
 * und heisst zufällig ein Coin gleich, bekäme die Aktie dessen Kurs.
 *
 * Erkannt wird eine Aktie auf drei Wegen (ODER), nie über das Kürzel allein:
 *   1. Bitpanda nennt die Gruppe am Asset (`group`/`type`: stock, etf).
 *   2. Die Asset-Kennung steht im Titel-Stamm als Bitpanda-Listung
 *      (`instrument_listungen.symbol` = `pid` der öffentlichen Asset-Liste).
 *      Der Stamm ist nur bei eingeschaltetem Aktien-Modus gefüllt.
 *   3. Die Asset-Kennung steht in Bitpandas öffentlicher Asset-Liste als
 *      Aktie/ETF (`aktien/bitpanda-liste.js`) — unabhängig vom Aktien-Modus,
 *      sobald Bitpanda im Portfolio abgerufen wird (Audit FUN-P-002: ohne
 *      diesen Weg hing die Erkennung im Werkszustand allein an Weg 1, einem
 *      Feld, das für die private API nicht belegt ist).
 * Was keiner der Wege kennt, bleibt wie bisher ein Coin. Ein «keine Aktie»
 * wird nur gemerkt, wenn es belegt ist (`bestimmeKlasse`): lag weder Gruppe
 * noch Stamm noch Liste vor, fragt der nächste Lauf wieder.
 *
 * Bewertet wird eine Aktien-Zeile so:
 *   1. Bitpandas eigene Bewertung der Position (`currency_balance`) — der
 *      Kurs des Produkts, das dort wirklich liegt.
 *   2. Sonst der Aktien-Future des Titels aus dem Stamm (Kurs der
 *      Marktdatenquelle in USDT, als Näherung gekennzeichnet).
 *   3. Sonst kein Kurs. NIE `${asset}USDT`.
 *
 * Nicht Teil dieses Moduls: Dividenden, Steuerbericht, ESTV-Kursliste.
 */
import * as marktdaten from '../marktdaten/index.js'
import { ausBitpanda } from '../aktien/einordnung.js'

export const KLASSEN = ['aktie', 'etf']

const GRUPPE = { stock: 'aktie', stocks: 'aktie', equity: 'aktie', share: 'aktie', etf: 'etf', etfs: 'etf' }

const GRUPPEN_FELDER = ['group', 'asset_group', 'type', 'asset_type', 'category']

/** Art aus einem Asset-Eintrag von Bitpanda (`group`, `type` …); unbekannt → null. Rein. */
export function klasseAusAsset(a) {
    for (const feld of GRUPPEN_FELDER) {
        const k = GRUPPE[String(a?.[feld] ?? '').trim().toLowerCase()]
        if (k) return k
    }
    return null
}

/** Nennt der Asset-Eintrag überhaupt eine Gruppe (welche auch immer)? Nur dann ist «keine Aktie» eine Aussage von Bitpanda. Rein. */
export function gruppeGenannt(a) {
    return GRUPPEN_FELDER.some((feld) => String(a?.[feld] ?? '').trim() !== '')
}

/**
 * Bitpandas öffentliche Asset-Liste → Kennung → `{ticker, unterart}`, nur Aktien und ETFs. Rein.
 *
 * Schlüssel ist die `pid` (eindeutig). Die kurze `id` («28») steht auch drin,
 * zählt aber nur zusammen mit dem passenden Kürzel (`nurMitKuerzel`) — ob die
 * private API sie je nennt, ist nicht belegt, und eine kurze Zahl allein soll
 * nichts zur Aktie machen.
 * @param {object[]|null} liste  `attributes` der Einträge von `/v3/assets`
 */
export function kennungenAusListe(liste) {
    const aus = new Map()
    for (const a of liste || []) {
        const l = ausBitpanda(a)
        if (!KLASSEN.includes(l.unterart) || !l.basis) continue
        if (a.pid != null && a.pid !== '') aus.set(String(a.pid), { ticker: l.basis, unterart: l.unterart })
        if (a.id != null && a.id !== '' && !aus.has(String(a.id))) aus.set(String(a.id), { ticker: l.basis, unterart: l.unterart, nurMitKuerzel: true })
    }
    return aus
}

/**
 * Art über die öffentliche Liste: Kennung (`id`/`pid` des Assets) gegen `kennungenAusListe`. Rein.
 * @param {Map} liste
 * @param {string|null} kuerzel  Kürzel des Assets laut privater API, falls bekannt
 */
export function klasseAusListe(liste, kuerzel, ...kennungen) {
    const k = String(kuerzel || '').toUpperCase()
    for (const kennung of kennungen) {
        const e = kennung != null ? liste?.get(String(kennung)) : null
        if (!e || !KLASSEN.includes(e.unterart)) continue
        if (e.nurMitKuerzel && e.ticker !== k) continue
        return e.unterart
    }
    return null
}

/**
 * Art eines Bitpanda-Assets aus allem, was vorliegt. Rein.
 *
 * @param {{asset?: object|null, id?: string, kuerzel?: string|null, stamm?: Map, liste?: Map}} o
 *        `asset` = Eintrag der privaten API (kann fehlen), `stamm` aus `ladeBitpandaStamm`, `liste` aus `kennungenAusListe`
 * @returns {{klasse: 'aktie'|'etf'|null, belegt: boolean}}
 *        `belegt`: das Ergebnis darf gemerkt werden. Ein «keine Aktie» ist nur belegt, wenn Bitpanda
 *        selbst eine Gruppe nennt oder Stamm bzw. Liste vorlagen — sonst hiesse «nichts gefunden» nur
 *        «nichts zum Nachschlagen gehabt».
 */
export function bestimmeKlasse({ asset = null, id = null, kuerzel = null, stamm = null, liste = null } = {}) {
    const kennungen = [id, asset?.id, asset?.pid]
    const klasse = klasseAusAsset(asset) || klasseAusStamm(stamm, ...kennungen) || klasseAusListe(liste, kuerzel ?? asset?.symbol, ...kennungen)
    return { klasse, belegt: !!klasse || gruppeGenannt(asset) || (stamm?.size || 0) > 0 || (liste?.size || 0) > 0 }
}

/**
 * Die gemerkten Arten aus dem Stand des letzten Laufs (`''` = gefragt, keine Aktie). Rein.
 *
 * Ein Stand ohne `klassenBelegt` stammt aus der Fassung, die `''` auch dann
 * merkte, wenn Stamm und Gruppe fehlten (Aktien-Modus aus). Diese `''` sind
 * nichts wert und werden einmal neu gefragt; erkannte Aktien bleiben.
 * @returns {Map<string, string>}
 */
export function gemerkteKlassen(alterStand = {}) {
    const alle = Object.entries(alterStand?.klassen || {})
    return new Map(alterStand?.klassenBelegt ? alle : alle.filter(([, k]) => k))
}

/**
 * Kürzel und Art zu den Asset-Kennungen eines Bitpanda-Kontos nachtragen.
 * `symbole` und `klassen` werden ergänzt. Das Netz kommt als `holeAsset` herein.
 *
 * Gefragt wird jede Kennung, zu der Kürzel ODER Art fehlt. Scheitert der
 * Abruf, wird nichts gemerkt; ist das Ergebnis nicht belegt (`bestimmeKlasse`),
 * auch nicht — der nächste Lauf fragt wieder.
 *
 * @param {Iterable<string>} ids
 * @param {{symbole: Map, klassen: Map, stamm?: Map, liste?: Map,
 *          holeAsset: (id: string) => Promise<{data?: object[]}|null>, pause?: () => Promise<void>}} o
 * @returns {Promise<{gefragt: number, offen: string[]}>}  `offen` = Kennungen ohne belegte Art
 */
export async function trageKlassenNach(ids, { symbole, klassen, stamm = null, liste = null, holeAsset, pause = async () => {} }) {
    let gefragt = 0
    const offen = []
    const merke = (kennung, asset) => {
        const { klasse, belegt } = bestimmeKlasse({ asset, id: kennung, kuerzel: symbole.get(kennung), stamm, liste })
        if (belegt) klassen.set(kennung, klasse || '')
        return belegt
    }
    for (const id of ids) {
        if (symbole.has(id) && klassen.has(id)) continue
        gefragt++
        const d = await holeAsset(id).catch(() => null)
        // Abruf gescheitert: nichts merken, der nächste Lauf fragt wieder.
        if (!d) { offen.push(id); continue }
        for (const a of d.data || []) {
            if (a?.id == null) continue
            if (a.symbol) symbole.set(a.id, a.symbol)
            merke(a.id, a)
        }
        if (!klassen.has(id) && !merke(id, null)) offen.push(id)
        await pause()
    }
    return { gefragt, offen }
}

/**
 * Art über den Titel-Stamm: Kennung (`id` oder `pid`) gegen die Bitpanda-Listungen. Rein.
 * @param {Map<string, {ticker: string, unterart: string}>} stamm
 */
export function klasseAusStamm(stamm, ...kennungen) {
    for (const k of kennungen) {
        const e = k != null ? stamm?.get(String(k)) : null
        if (e && KLASSEN.includes(e.unterart)) return e.unterart
    }
    return null
}

/** Bitpanda-Listungen des Stamms: Kennung → `{ticker, unterart}`. Ohne Stamm leer. */
export async function ladeBitpandaStamm(knex) {
    const aus = new Map()
    try {
        if (!(await knex.schema.hasTable('instrument_listungen'))) return aus
        const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
            .where({ 'l.handelsplatz': 'bitpanda', 'i.anlageklasse': 'aktien' }).whereIn('i.unterart', KLASSEN)
            .select('l.symbol', 'i.ticker', 'i.unterart')
        for (const z of zeilen) aus.set(String(z.symbol), { ticker: z.ticker, unterart: z.unterart })
    } catch { /* Stamm nicht lesbar → nur Bitpandas eigene Angabe zählt */ }
    return aus
}

/**
 * Kurs einer Aktien-Zeile des Bestands. Rein.
 * @param {{asset: string, kursUsd?: number}} b
 * @param {Map<string, {usd: number, quelle: string}>} [stammKurse]  Ticker → Kurs des Aktien-Futures
 */
export function aktienZeilenKurs(b, stammKurse) {
    if (Number(b?.kursUsd) > 0) return { usd: Number(b.kursUsd), quelle: 'Bewertung Bitpanda' }
    const s = stammKurse?.get(String(b?.asset || '').toUpperCase())
    if (s && Number(s.usd) > 0) return { usd: Number(s.usd), quelle: s.quelle }
    return { usd: null, quelle: 'kein Kurs (Aktie)' }
}

/**
 * Kurse der Aktien-Futures zu einer Liste von Tickern, über den Stamm:
 * Ticker → Future-Symbol der Marktdatenquelle → letzter Preis in USDT.
 * Nur für Zeilen, die Bitpanda nicht selbst bewertet. Fehlt etwas, fehlt der Eintrag.
 */
export async function stammKurseUsd(knex, tickers) {
    const aus = new Map()
    const liste = [...new Set((tickers || []).map((t) => String(t).toUpperCase()))]
    if (!liste.length) return aus
    try {
        const quelle = (await marktdaten.fordere('ticker', { markt: 'futures' })).id
        const zeilen = await knex('instrument_listungen as l').join('instrumente as i', 'i.id', 'l.instrumentId')
            .where({ 'l.art': 'perp', 'l.aktiv': 1, 'l.handelsplatz': quelle, 'i.anlageklasse': 'aktien' }).whereIn('i.ticker', liste)
            .select('i.ticker', 'l.symbol')
        if (!zeilen.length) return aus
        const preise = await marktdaten.preise({ markt: 'futures' })
        for (const z of zeilen) {
            const p = preise.get(String(z.symbol).toUpperCase())
            if (Number.isFinite(p) && p > 0) aus.set(z.ticker, { usd: p, quelle: `Aktien-Future ${z.symbol} (≈)` })
        }
    } catch { /* Marktdaten aus oder Stamm fehlt → kein Ersatzkurs */ }
    return aus
}

/** Aktien/ETFs, die der letzte Bitpanda-Abruf gemeldet hat: KÜRZEL → `aktie` | `etf` (`portfolio_quellen.stand.aktien`). */
export async function bitpandaAktienArten(knex) {
    const aus = new Map()
    try {
        const z = await knex('portfolio_quellen').where('quelle', 'bitpanda').first()
        const a = JSON.parse(z?.stand || '{}').aktien
        for (const [s, k] of Object.entries(a && typeof a === 'object' ? a : {})) aus.set(s.toUpperCase(), KLASSEN.includes(k) ? k : 'aktie')
    } catch { /* ohne Stand keine Aktien */ }
    return aus
}

/** Kürzel der Aktien/ETFs, die der letzte Bitpanda-Abruf gemeldet hat. */
export async function bitpandaAktienKuerzel(knex) {
    return new Set((await bitpandaAktienArten(knex)).keys())
}

/**
 * Art einer Seite nach QUELLE und Kürzel — nie nach dem Kürzel allein: `SUI`
 * ist bei Bitpanda die Aktie Sun Communities, bei einer anderen Quelle der Coin.
 * @param {Map<string, string>} arten  aus `bitpandaAktienArten`
 * @returns {(quelle: string, asset: string) => 'aktie'|'etf'|null}
 */
export function aktienKlasseVon(arten) {
    return (quelle, asset) => (quelle === 'bitpanda' && asset ? arten?.get(String(asset).toUpperCase()) || null : null)
}

/**
 * Bewegungen ohne ihre Aktien-Seiten — für den Krypto-Steuerbericht. Rein.
 *
 * Eine Aktie gehört ins Wertschriftenverzeichnis, nicht in die Krypto-Beilage.
 * Die Geld- oder Coin-Seite derselben Bewegung bleibt aber stehen (sonst
 * stimmte der EUR-Bestand bei Bitpanda nicht mehr): aus «Kauf SUI gegen EUR»
 * wird ein Abgang von EUR, aus «Verkauf SUI gegen EUR» ein Zugang. Bewegungen,
 * die nur aus einer Aktie bestehen, fallen ganz weg. Eine neue Bewertung der
 * Aktie findet hier NICHT statt.
 *
 * @param {Array} bewegungen
 * @param {(quelle: string, asset: string) => string|null} klasse  siehe `aktienKlasseVon`
 * @returns {{ bewegungen: Array, betroffen: Set, kuerzel: Map<string, {klasse: string, ersteZeit: number}> }}
 *   `betroffen` = ids der gekürzten Bewegungen (sie sind keine «Veränderung» des Krypto-Berichts mehr).
 */
export function ohneAktienSeiten(bewegungen, klasse) {
    const aus = [], betroffen = new Set(), kuerzel = new Map()
    const merke = (asset, k, zeit) => {
        const a = String(asset).toUpperCase()
        const e = kuerzel.get(a)
        if (!e) kuerzel.set(a, { klasse: k, ersteZeit: Number(zeit) })
        else if (Number(zeit) < e.ersteZeit) e.ersteZeit = Number(zeit)
    }
    for (const b of bewegungen || []) {
        const kA = b.asset ? klasse(b.quelle, b.asset) : null
        const kG = b.gegenAsset ? klasse(b.quelle, b.gegenAsset) : null
        if (!kA && !kG) { aus.push(b); continue }
        if (kA) merke(b.asset, kA, b.zeit)
        if (kG) merke(b.gegenAsset, kG, b.zeit)
        if (b.id != null) betroffen.add(b.id)
        // Gebühr in Aktien-Stücken gehört zur Aktie; eine Gebühr in Geld oder Coin bleibt.
        const gebuehr = b.gebuehrAsset && !klasse(b.quelle, b.gebuehrAsset) ? {} : { gebuehrAsset: null, gebuehrMenge: null }
        let rest = null
        if (kA && b.gegenAsset && !kG) rest = { asset: b.gegenAsset, menge: b.gegenMenge, kontrakt: null }
        else if (kG && b.asset && !kA) rest = { asset: b.asset, menge: b.menge }
        if (!rest || !(Math.abs(Number(rest.menge)) > 0)) continue
        aus.push({ ...b, ...rest, ...gebuehr, gegenAsset: null, gegenMenge: null, art: Number(rest.menge) < 0 ? 'auszahlung' : 'einzahlung' })
    }
    return { bewegungen: aus, betroffen, kuerzel }
}

/**
 * Hinweis des Krypto-Steuerberichts auf die ausgelassenen Aktien/ETFs. Rein.
 * @param {Map<string, string>} liste  KÜRZEL → `aktie` | `etf`
 * @returns {{art: 'aktien', n: number, kuerzel: string[], text: string}|null}
 */
export function aktienHinweis(liste) {
    const kuerzel = [...(liste?.keys() || [])].sort()
    if (!kuerzel.length) return null
    return {
        art: 'aktien', n: kuerzel.length, kuerzel,
        text: `${kuerzel.length} Aktien/ETF bei Bitpanda nicht enthalten – sie gehören ins Wertschriftenverzeichnis, nicht in die Beilage Kryptowährungen: ${kuerzel.join(', ')}.`,
    }
}
