/**
 * Spot-Portfolio: Spam-Tokens erkennen.
 *
 * Betrüger schicken Tokens ungefragt an öffentliche Wallet-Adressen; der Name
 * IST die Werbung („VISIT HTTPS://… TO CLAIM REWARDS“, „AAVE [ACCESS AAVE.ASIA]“).
 * Gemessen 25.10.2026: 67 von 113 Token-Namen eines echten Bestands waren so
 * gebaut. Sie haben keinen Wert, stehen nicht in der Übersicht und nicht in
 * der Steuer — und wer ihre Seite öffnet, verliert die Wallet.
 *
 * Erkannt wird nur am NAMEN, und nur bei Tokens mit Vertrag (ein Coin an einer
 * Börse ist kein Airdrop). Echte Kürzel sind kurz, ohne Leerzeichen, ohne
 * Webadresse; „USDC.e“ bleibt echt (Endung zu kurz für eine Domain).
 * Zweite Regel (`assetsMitHerkunft`): Token ohne Kurs, die nie gekauft, getauscht
 * oder selbst hingeschickt wurden. Daneben gilt die Hand des Nutzers:
 * `settings.portfolioSpam` { 'ASSET|kontrakt': true|false } — seit dem Audit
 * FUN-PRT-001 je Vertrag. Ältere Einträge mit reinem Kürzel gelten weiter als
 * Rückfall (eindeutige schreibt `migrationen/portfolio.js` um), aber nie für
 * den kanonischen Vertrag: „USDT: Spam“ nimmt den echten USDT nicht mehr mit.
 * Herkunft zählt ebenfalls je Identität (`token-id.js`): eine Einzahlung eines
 * fremden „USDT“ ist keine Herkunft des echten — und ihr CHF-Wert, der aus dem
 * NAMEN kam, macht sie nicht zur eigenen.
 */
import { getKnex } from '../database.js'
import { tokenIdentitaet, normKontrakt, istKanon, ladeGegenKontrakte } from './token-id.js'

const DOMAIN = /[a-z0-9-]\.(com|org|net|io|xyz|site|tech|app|cash|art|gift|events|asia|cc|us|club|top|live|me|dev|click|supply|gg|finance|fi|vip|pro|info|online|network|exchange|claims?)\b/i
const SCHLAGWORT = /\b(claim|claims|visit|reward|rewards|airdrop|airdrops|voucher|giveaway|eligible|bonus)\b/i
const ADRESSE = /^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/i

/**
 * @param {string} name     Symbol/Name, wie die Kette ihn meldet
 * @param {string|null} kontrakt
 * @returns {string|null}  Grund oder null (kein Spam)
 */
export function spamGrund(name, kontrakt) {
    if (!kontrakt) return null
    const roh = String(name ?? '')
    const n = roh.trim()
    if (!ADRESSE.test(String(kontrakt).trim())) return 'vertrag'      // „ THEGRAPHS.ORG“ statt einer Adresse
    if (!n || /^\$\s*$/.test(n)) return 'leer'
    if (/^https?:|www\./i.test(n) || DOMAIN.test(n)) return 'webadresse'
    if (SCHLAGWORT.test(n)) return 'werbung'
    if (/[\s[\]():/!&;]/.test(n)) return 'zeichen'
    if (n.startsWith('$')) return 'zeichen'
    if (roh !== n) return 'zeichen'                                    // „PAWS “ mit Leerzeichen am Ende
    return null
}

async function lese() {
    try {
        const s = await getKnex()('settings').first('portfolioSpam')
        const d = JSON.parse(s?.portfolioSpam || '{}')
        return d && typeof d === 'object' ? d : {}
    } catch { return {} }
}

/**
 * Assets mit eigener Herkunft (rein): mindestens eine Bewegung, die man selbst
 * ausgelöst hat oder die einen Wert hat — Kauf, Tausch, Abgang, Umbuchung mit
 * Gegenstück, erfasster Anfangsbestand, Ertrag mit CHF-Wert, als „Kauf“
 * eingeordnete Einzahlung (Presale: bezahlt anderswo, Token kommt später). Ein Eingang ohne
 * Wert und ohne Gegenbuchung ist KEINE Herkunft: so kommen Werbe-Airdrops.
 *
 * Zweite Spam-Regel (26.10.2026): FIRE, FISH, KEKIUS, SHIT … — je genau 1 Stück,
 * harmlose Namen, aber keine einzige Bewegung, nur in der Live-Abfrage der
 * Wallet. Der Name allein verrät sie nicht.
 */
export function assetsMitHerkunft(bewegungen, ident = tokenIdentitaet(bewegungen)) {
    const s = new Set()
    for (const b of bewegungen) {
        if (b.einordnung === 'ignorieren') continue
        for (const seite of ident.seiten(b)) {
            if (!seite.asset) continue
            // Ein CHF-Wert zählt nur, wenn er nicht über den Namen eines fremden Vertrags kam.
            const mitWert = Number(b.chfWert) > 0 && !seite.fremd
            const ungefragt = seite.menge > 0 && ['einzahlung', 'airdrop', 'sonstiges'].includes(b.art)
                && !mitWert && !b.transferMit && !['transfer', 'kauf'].includes(b.einordnung)
            if (!ungefragt) s.add(seite.id)
        }
    }
    return s
}

/**
 * Entscheid für ein Asset: die Hand des Nutzers vor den Regeln.
 * `istSpam(asset, kontrakt, { ohneKurs })` — mit `ohneKurs: true` greift auch die
 * Herkunftsregel (Token mit Vertrag, ohne Kurs, ohne eigene Herkunft).
 */
export async function spamPruefer() {
    let herkunft = new Set()
    let ident
    try {
        const k = getKnex()
        const bew = await ladeGegenKontrakte(k, await k('portfolio_bewegungen')
            .select('id', 'asset', 'gegenAsset', 'art', 'menge', 'gegenMenge', 'chfWert', 'transferMit', 'einordnung', 'kontrakt', 'kette'))
        ident = tokenIdentitaet(bew)
        herkunft = assetsMitHerkunft(bew, ident)
    } catch { /* ohne Herkunft nur die Namensregel */ }
    return spamEntscheid(await lese(), herkunft, ident)
}

/** Schlüssel der Hand-Liste: `ASSET|kontrakt` bzw. `ASSET` (Börsen-Coin ohne Vertrag). */
export function spamSchluessel(asset, kontrakt) {
    const a = String(asset ?? '').trim().toUpperCase()
    const k = normKontrakt(kontrakt)
    return k ? `${a}|${k}` : a
}

/** Reiner Teil von `spamPruefer`: Hand-Liste und Herkunft → Prüffunktion. */
export function spamEntscheid(hand, herkunft, ident = tokenIdentitaet([])) {
    return (asset, kontrakt, { ohneKurs = false } = {}) => {
        const key = String(asset ?? '').toUpperCase()
        const k = normKontrakt(kontrakt)
        // 1. Von Hand je Vertrag.
        const genau = k ? hand[spamSchluessel(asset, k)] : undefined
        if (genau !== undefined) return genau ? 'hand' : null
        // 2. Rückfall: alter Eintrag mit reinem Kürzel. „Spam“ gilt nur für Tokens mit
        // Vertrag (der Werbe-Token „AI“ darf den Börsen-Coin AI bei Bitget nicht
        // mitnehmen) und nie für den kanonischen Vertrag (echter USDT neben falschem).
        if (key in hand && (!hand[key] || (k && !istKanon(asset, k)))) return hand[key] ? 'hand' : null
        const grund = spamGrund(asset, kontrakt)
        if (grund) return grund
        if (ohneKurs && k && !herkunft.has(ident.id(asset, k))) return 'ungefragt'
        return null
    }
}

/**
 * @param {true|false|null} wert  true = Spam, false = kein Spam, null = Regel entscheidet
 * @param {string|null} [kontrakt]  mit Vertrag gilt der Eintrag nur für diesen Token
 */
export async function setzeSpam(asset, wert, kontrakt = null) {
    const a = String(asset ?? '').toUpperCase()
    if (!a) throw new Error('Asset fehlt')
    const d = await lese()
    const key = spamSchluessel(a, kontrakt)
    if (wert == null) delete d[key]
    else d[key] = !!wert
    const k = getKnex()
    const s = await k('settings').first('id')
    await k('settings').where({ id: s.id }).update({ portfolioSpam: JSON.stringify(d) })
}
