/**
 * Spot-Portfolio: Kontoüberwachung — neue Bewegungen eines überwachten Kontos
 * melden (Spende auf die BTC-Adresse, Abgang vom Ledger, den man nicht selbst
 * gemacht hat). Rein: welche Zeilen meldenswert sind und wie die Meldung
 * lautet. Erkennen und Zustellen macht der Abruf (`abruf.js`).
 *
 * Je Konto (Börse oder Wallet-Adresse, Schlüssel = `quelle`) ein Schalter in
 * `settings.portfolioWacht` ({ "a7": true, "bitpanda": false }). Gemeldet wird,
 * was ein Abruf NEU in die Bewegungen schreibt — ausser:
 *   - Routine: Staking- und Belohnungs-Erträge (Bitpanda zahlt wöchentlich);
 *   - Spam-Airdrops (`spam.js`);
 *   - Nachgeladenes: eine Zeile, die älter als 7 Tage ist, ist Historie, keine
 *     Bewegung von gerade eben (neuer Etherscan-Schlüssel, Börse frisch an).
 * Den allerersten Abruf eines Kontos meldet der Abruf gar nicht (Grundstand).
 *
 * Ein Abgang ohne eigenes Gegenstück („an unbekannte Adresse“) geht mit der
 * höchsten Schwere hinaus — so erreicht er auch einen Telegram-Kanal, der nur
 * Warnungen durchlässt. Das ist der Fall „alles geklaut“.
 */

export const ROUTINE = new Set(['staking', 'belohnung'])
export const NACHGELADEN_MS = 7 * 86400e3

/** Schalter aus der Einstellungsspalte (JSON-Text oder Objekt). */
export function wachtAus(roh) {
    let w = roh
    if (typeof w === 'string') { try { w = JSON.parse(w || '{}') } catch { w = {} } }
    return w && typeof w === 'object' && !Array.isArray(w) ? w : {}
}

/** Schalter setzen; „aus“ entfernt den Eintrag statt false zu speichern. */
export function setzeWacht(roh, quelle, an) {
    const w = { ...wachtAus(roh) }
    if (an) w[quelle] = true
    else delete w[quelle]
    return JSON.stringify(w)
}

/** Darf ein Konto überwacht werden? Börsen mit API und Wallet-Adressen — Importe bewegen sich nicht mehr. */
export function wachtbar(quelle, boersen = ['bitunix', 'bitget', 'pionex', 'bitpanda']) {
    return boersen.includes(quelle) || /^a\d+$/.test(String(quelle))
}

/**
 * @param {{ art, zeit, asset, kontrakt? }} z
 * @param {{ jetzt?: number, istSpam?: (asset, kontrakt) => any }} opt
 */
export function meldenswert(z, { jetzt = Date.now(), istSpam = () => null } = {}) {
    if (ROUTINE.has(z.art)) return false
    if (Number(z.zeit) < jetzt - NACHGELADEN_MS) return false
    if (z.einordnung === 'ignorieren') return false
    if (istSpam(z.asset, z.kontrakt)) return false
    return true
}

const ART_WORT = {
    einzahlung: 'Eingang', auszahlung: 'Ausgang', kauf: 'Kauf', verkauf: 'Verkauf', tausch: 'Tausch',
    umbuchung: 'Umbuchung', airdrop: 'Airdrop', gebuehr: 'Gebühr', sonstiges: 'Bewegung', staking: 'Staking-Ertrag', belohnung: 'Belohnung',
}

/** Menge lesbar: bis 8 Stellen, ohne Nullen am Ende, mit Vorzeichen. */
export function mengeText(m) {
    const n = Number(m) || 0
    const s = Math.abs(n).toFixed(Math.abs(n) >= 1000 ? 2 : 8).replace(/\.?0+$/, '')
    return `${n < 0 ? '−' : '+'}${s}`
}

const chfText = (v) => `CHF ${Math.abs(Number(v)).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const zeitVorgabe = (ms) => new Date(Number(ms)).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Ein Abgang, der an keinen eigenen Ort ging (kein Partner, nicht als eigener Transfer eingeordnet). */
export const unbekannterAbgang = (z) => ['auszahlung', 'sonstiges'].includes(z.art) && Number(z.menge) < 0 && !z.transferMit && z.einordnung !== 'transfer'

/** Eine Zeile der Meldung. `partnerName(z)` nennt den eigenen Gegenort eines Transfers, sonst null. */
export function zeileText(z, { partnerName = () => null, zeitText = zeitVorgabe } = {}) {
    const teile = [`${ART_WORT[z.art] || z.art} ${mengeText(z.menge)} ${z.asset}`]
    if (z.gegenAsset && Number(z.gegenMenge)) teile[0] += ` (${mengeText(z.gegenMenge)} ${z.gegenAsset})`
    if (z.chfWert != null) teile.push(`≈ ${chfText(z.chfWert)}`)
    const partner = partnerName(z)
    if (partner) teile.push(Number(z.menge) < 0 ? `eigener Transfer an ${partner}` : `eigener Transfer von ${partner}`)
    else if (unbekannterAbgang(z)) teile.push('⚠ an eine fremde Adresse')
    else if (z.art === 'einzahlung') teile.push('von aussen')
    teile.push(zeitText(z.zeit))
    return teile.join(' · ')
}

/**
 * Meldung für die neuen Bewegungen EINES Kontos (gebündelt je Abruf).
 * @returns {{ titel, text, schwere }}
 */
export function meldungFuer(ortName, zeilen, opt = {}) {
    const liste = [...zeilen].sort((a, b) => Number(a.zeit) - Number(b.zeit))
    const fremd = liste.some(unbekannterAbgang)
    const kopf = liste.length === 1
        ? `${ART_WORT[liste[0].art] || 'Bewegung'} ${mengeText(liste[0].menge)} ${liste[0].asset}`
        : `${liste.length} neue Bewegungen`
    const titel = `${fremd ? '⚠ ' : ''}${ortName}: ${kopf}`
    const MAX = 8
    const zeilenText = liste.slice(0, MAX).map((z) => `• ${zeileText(z, opt)}`)
    if (liste.length > MAX) zeilenText.push(`… und ${liste.length - MAX} weitere`)
    // Telegram zeigt nur den Text, nicht den Titel — deshalb steht er als erste Zeile mit drin.
    const text = [titel, ...zeilenText].join('\n')
    return { titel, text, schwere: fremd ? 'einstieg' : 'warnung' }
}
