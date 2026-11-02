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
 *
 * Orte ohne Historie (XRP, BNB Chain ausserhalb des Etherscan-Gratistarifs,
 * VeChain, Börsen ohne Ein-/Auszahlungen) liefern keine Bewegungen — dort
 * meldet `bestandsAenderungen`, was sich am Bestand geändert hat, ohne dass
 * eine neue Bewegung es erklärt.
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
 * Meldung für die neuen Bewegungen EINES Kontos (gebündelt je Abruf);
 * `opt.bestand` = Bestandsänderungen ohne Bewegung (`bestandsAenderungen`).
 * @returns {{ titel, text, schwere }}
 */
export function meldungFuer(ortName, zeilen, opt = {}) {
    const liste = [...zeilen].sort((a, b) => Number(a.zeit) - Number(b.zeit))
    const bestand = opt.bestand || []
    // Ein Bestand, der ohne Bewegung SINKT, ist so ernst wie ein Abgang an eine fremde Adresse.
    const fremd = liste.some(unbekannterAbgang) || bestand.some((a) => a.delta < 0)
    const kopf = liste.length === 1 && !bestand.length
        ? `${ART_WORT[liste[0].art] || 'Bewegung'} ${mengeText(liste[0].menge)} ${liste[0].asset}`
        : !liste.length && bestand.length === 1
            ? `Bestand ${bestand[0].asset} ${mengeText(bestand[0].delta)}`
            : `${liste.length + bestand.length} neue Bewegungen`
    const titel = `${fremd ? '⚠ ' : ''}${ortName}: ${kopf}`
    const MAX = 8
    const zeilenText = [...bestand.map((a) => `• ${bestandText(a)}`), ...liste.slice(0, MAX).map((z) => `• ${zeileText(z, opt)}`)]
    if (liste.length > MAX) zeilenText.push(`… und ${liste.length - MAX} weitere`)
    // Telegram zeigt nur den Text, nicht den Titel — deshalb steht er als erste Zeile mit drin.
    const text = [titel, ...zeilenText].join('\n')
    return { titel, text, schwere: fremd ? 'einstieg' : 'warnung' }
}

// ── Bestand ohne Bewegung ────────────────────────────────────────────────

/** Assets, die ohne Bewegung von selbst wachsen: VeChain erzeugt VTHO aus gehaltenem VET. */
export const ZUWACHS_ROUTINE = new Set(['VTHO'])
/** Pionex-Bots handeln laufend: ihr Gesamtwert ist kein Bestand, der sich „bewegt“. */
const OHNE_VERGLEICH = new Set(['bots'])

const schluessel = (b) => (b.kontrakt ? `${String(b.asset).toUpperCase()}|${String(b.kontrakt).toLowerCase()}` : String(b.asset).toUpperCase())

/**
 * Bestandsänderung, die keine neue Bewegung erklärt (rein).
 *
 * @param {Array<{ort, asset, kontrakt?, menge}>} alt   Bestand vor dem Abruf
 * @param {Array<{ort, asset, kontrakt?, menge}>} neu   Bestand nach dem Abruf
 * @param {Array} bewegungen  ALLE in diesem Abruf neu eingefügten Zeilen des Kontos —
 *   auch Routine und Nachgeladenes: was eine Zeile erklärt, ist keine Meldung wert.
 * @param {{ gelesen?: string[]|null, gelesenVorher?: string[]|null }} opt
 *   `gelesen`: Orte, die dieser Abruf wirklich gelesen hat (EVM schluckt einen
 *   Netzfehler und liefert das Netz dann gar nicht — das ist kein leerer Bestand).
 *   `gelesenVorher`: Orte des Grundstands; ein Ort ohne Grundstand (neu
 *   zugeschaltetes Netz) wird nicht verglichen.
 * @returns {Array<{ asset, kontrakt, alt, neu, delta, orte }>}  `delta` = unerklärter Teil
 */
export function bestandsAenderungen(alt = [], neu = [], bewegungen = [], { gelesen = null, gelesenVorher = null } = {}) {
    const vorher = new Set([...(gelesenVorher || []), ...alt.map((b) => b.ort)])
    const zaehlt = (ort) => !OHNE_VERGLEICH.has(ort) && (!gelesen || gelesen.includes(ort)) && vorher.has(ort)
    const je = new Map()
    const posten = (b) => {
        const k = schluessel(b)
        if (!je.has(k)) je.set(k, { asset: String(b.asset).toUpperCase(), kontrakt: b.kontrakt || null, alt: 0, neu: 0, bewegt: 0, orte: new Map() })
        return je.get(k)
    }
    for (const [liste, feld] of [[alt, 'alt'], [neu, 'neu']]) {
        for (const b of liste) {
            if (!zaehlt(b.ort)) continue
            const p = posten(b)
            p[feld] += Number(b.menge) || 0
            const o = p.orte.get(b.ort) || { alt: 0, neu: 0 }
            o[feld] += Number(b.menge) || 0
            p.orte.set(b.ort, o)
        }
    }
    for (const z of bewegungen) {
        if (z.einordnung === 'ignorieren') continue
        const seiten = [[z.asset, Number(z.menge) || 0, z.kontrakt], [z.gegenAsset, Number(z.gegenMenge) || 0, null], [z.gebuehrAsset, -(Number(z.gebuehrMenge) || 0), null]]
        for (const [asset, m, kontrakt] of seiten) {
            if (!asset || !m) continue
            const k = schluessel({ asset, kontrakt })
            if (je.has(k)) je.get(k).bewegt += m
        }
    }
    const aus = []
    for (const p of je.values()) {
        const delta = (p.neu - p.alt) - p.bewegt
        const tol = Math.max(1e-9, 1e-6 * Math.max(Math.abs(p.alt), Math.abs(p.neu)))
        if (Math.abs(delta) <= tol) continue
        if (delta > 0 && ZUWACHS_ROUTINE.has(p.asset)) continue
        const orte = [...p.orte].filter(([, o]) => Math.abs(o.neu - o.alt) > tol).map(([ort]) => ort)
        aus.push({ asset: p.asset, kontrakt: p.kontrakt, alt: p.alt, neu: p.neu, delta, orte })
    }
    return aus.sort((a, b) => a.delta - b.delta)
}

const ORT_NAME = { 'evm:1': 'Ethereum', 'evm:56': 'BNB Chain', 'evm:137': 'Polygon', 'evm:42161': 'Arbitrum', 'evm:8453': 'Base', 'evm:10': 'Optimism', 'evm:43114': 'Avalanche', 'evm:100009': 'VeChain', xrp: 'XRP Ledger', btc: 'Bitcoin', sol: 'Solana' }
const mengeOhne = (m) => mengeText(m).slice(1)

/** Eine Zeile für eine Bestandsänderung ohne Bewegung. */
export function bestandText(a) {
    const wo = a.orte.map((o) => ORT_NAME[o] || o).join(', ')
    return `Bestand ${a.asset} ${mengeOhne(a.alt)} → ${mengeOhne(a.neu)} (${mengeText(a.delta)})${wo ? ` · ${wo}` : ''} · ohne Bewegungsdaten${a.delta < 0 ? ' ⚠' : ''}`
}
