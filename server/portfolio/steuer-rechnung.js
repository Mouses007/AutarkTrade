/**
 * Spot-Portfolio: Steuer-Rechnung Schweiz (rein, selbstgetestet).
 *
 * KEINE Steuerberatung. Die Funktionen legen die Zahlen so bereit, wie die
 * Steuererklärung sie fragt:
 *
 *   Vermögen       Bestand je Coin am 31.12. (Wertschriftenverzeichnis);
 *                  bewertet wird ausserhalb (ESTV-Kurs, sonst Jahresschluss).
 *   Einkommen      Staking, Airdrops, Belohnungen und vom Nutzer als
 *                  „Einkommen" eingeordnete Zuflüsse — zum CHF-Wert beim
 *                  Zufluss (eingefroren in `chfWert`).
 *   Veräusserungen private Kapitalgewinne sind steuerfrei; die Summen dienen
 *                  der Prüfung auf Gewerbsmässigkeit (ESTV-Kreisschreiben 36,
 *                  analog für Krypto: Haltedauer ≥ 6 Monate, Volumen ≤ 5× des
 *                  Anfangsvermögens, Gewinne < 50 % des Reineinkommens,
 *                  keine Fremdfinanzierung, Derivate nur zur Absicherung).
 *
 * Einstand und Haltedauer über FIFO-Lose — über ALLE Orte gemeinsam, denn
 * ein eigener Transfer (Börse → Ledger) ist keine Veräusserung und darf das
 * Los nicht neu starten. Unbekannter Einstand bleibt unbekannt (nie 0).
 */

const MONAT6 = 182.5 * 86400e3

/** Welche Bewegungen sind Einkommen? */
export function istEinkommen(b) {
    if (b.einordnung === 'ignorieren' || b.einordnung === 'transfer') return false
    if (b.einordnung === 'einkommen') return true
    return ['staking', 'airdrop', 'belohnung'].includes(b.art)
}

/** Ist das ein eigener Transfer (zählt weder als Kauf noch als Abgang)? */
export function istTransfer(b) {
    return b.einordnung === 'transfer' || !!b.transferMit || b.art === 'umbuchung'
}

/**
 * Bestand je Ort und Asset bis einschliesslich `bis` (ms).
 * @returns {Map<string, number>}  `${quelle}\u0000${asset}` → Menge
 */
export function bestandAm(bewegungen, bis) {
    const m = new Map()
    const add = (q, a, v) => {
        if (!a || !v) return
        const k = `${q}\u0000${a}`
        m.set(k, (m.get(k) || 0) + v)
    }
    for (const b of bewegungen) {
        if (Number(b.zeit) > bis || b.einordnung === 'ignorieren') continue
        add(b.quelle, b.asset, Number(b.menge) || 0)
        if (b.gegenAsset) add(b.quelle, b.gegenAsset, Number(b.gegenMenge) || 0)
        if (b.gebuehrAsset) add(b.quelle, b.gebuehrAsset, -(Number(b.gebuehrMenge) || 0))
    }
    return m
}

/** Einkommen in [von, bis]: Zeilen + Summen je Art und je Asset. */
export function einkommen(bewegungen, von, bis) {
    const zeilen = bewegungen.filter((b) => Number(b.zeit) >= von && Number(b.zeit) <= bis && istEinkommen(b) && Number(b.menge) > 0)
    let summe = 0, ohneWert = 0
    const jeArt = {}, jeAsset = {}
    for (const b of zeilen) {
        // Ist die Art selbst schon Einkommen, bleibt sie stehen; „eingeordnet" nur für Zuflüsse,
        // die erst die Einordnung des Nutzers zum Einkommen macht (z. B. eine Einzahlung).
        const art = ['staking', 'airdrop', 'belohnung'].includes(b.art) ? b.art : 'eingeordnet'
        if (b.chfWert == null) { ohneWert++; continue }
        summe += Number(b.chfWert)
        jeArt[art] = (jeArt[art] || 0) + Number(b.chfWert)
        jeAsset[b.asset] = (jeAsset[b.asset] || 0) + Number(b.chfWert)
    }
    return { zeilen, summe, ohneWert, jeArt, jeAsset }
}

/**
 * FIFO-Lose über die ganze Historie; liefert die Abgänge eines Jahres mit
 * Erlös, Einstand und Haltedauer.
 *
 * Zugänge:  kauf/tausch (empfangene Seite), Einkommen, nicht eingeordnete
 *           oder als „kauf" eingeordnete Einzahlungen, `bestand`.
 *           Einstand = chfWert der Zeile (bei Tausch/Kauf der Wert des
 *           Gekauften), sonst unbekannt.
 * Abgänge:  verkauf/tausch (abgegebene Seite), Gebühren in Coins,
 *           nicht als Transfer eingeordnete Auszahlungen (Bezahlung,
 *           Abgang an Unbekannt).
 * Fiat (CHF/EUR/USD) und Transfers bilden keine Lose.
 */
export function fifo(bewegungen, { fiat = ['CHF', 'EUR', 'USD'], von = -Infinity, bis = Infinity } = {}) {
    const istFiat = (a) => fiat.includes(a)
    const lose = new Map()           // asset → [{ menge, kostenJe|null, zeit }]
    const abgaenge = []
    const zugang = (asset, menge, kosten, zeit) => {
        if (!asset || istFiat(asset) || !(menge > 0)) return
        const l = lose.get(asset) || []
        l.push({ menge, kostenJe: kosten != null ? kosten / menge : null, zeit })
        lose.set(asset, l)
    }
    const abgang = (asset, menge, erloes, zeit, b, art) => {
        if (!asset || istFiat(asset) || !(menge > 0)) return
        const l = lose.get(asset) || []
        let rest = menge, kosten = 0, kostenBekannt = true, kurzMenge = 0, gedeckt = 0
        while (rest > 1e-12 && l.length) {
            const los = l[0]
            const nimm = Math.min(los.menge, rest)
            if (los.kostenJe == null) kostenBekannt = false; else kosten += nimm * los.kostenJe
            if (zeit - los.zeit < MONAT6) kurzMenge += nimm
            gedeckt += nimm
            los.menge -= nimm
            rest -= nimm
            if (los.menge <= 1e-12) l.shift()
        }
        if (rest > 1e-9) kostenBekannt = false     // mehr abgegeben als je zugegangen → Historie lückenhaft
        if (zeit >= von && zeit <= bis) {
            abgaenge.push({
                id: b.id, zeit, quelle: b.quelle, asset, menge, art,
                erloes: erloes ?? null,
                kosten: kostenBekannt ? kosten : null,
                gewinn: kostenBekannt && erloes != null ? erloes - kosten : null,
                kurzfristigAnteil: menge > 0 ? kurzMenge / menge : 0,
                ungedeckt: rest > 1e-9 ? rest : 0,
            })
        }
    }

    const sortiert = [...bewegungen].filter((b) => b.einordnung !== 'ignorieren').sort((a, b) => Number(a.zeit) - Number(b.zeit) || (a.id || 0) - (b.id || 0))
    for (const b of sortiert) {
        const zeit = Number(b.zeit)
        const m = Number(b.menge) || 0
        const g = Number(b.gegenMenge) || 0
        const wert = b.chfWert != null ? Number(b.chfWert) : null
        if (istTransfer(b)) {
            if (b.gebuehrAsset && Number(b.gebuehrMenge) > 0) abgang(b.gebuehrAsset, Number(b.gebuehrMenge), 0, zeit, b, 'gebuehr')
            continue
        }
        if (['kauf', 'verkauf', 'tausch'].includes(b.art) && b.gegenAsset) {
            // Je Seite: was reinkommt, wird Los; was rausgeht, wird Abgang.
            for (const [asset, menge] of [[b.asset, m], [b.gegenAsset, g]]) {
                if (menge > 0) zugang(asset, menge, wert, zeit)
                else if (menge < 0) abgang(asset, -menge, wert, zeit, b, b.art)
            }
        } else if (m > 0 && (istEinkommen(b) || ['einzahlung', 'bestand', 'kauf', 'sonstiges'].includes(b.art))) {
            zugang(b.asset, m, wert, zeit)
        } else if (m < 0) {
            // Auszahlung ohne Transfer-Einordnung (Bezahlung, Kartenaufladung, Abgang an
            // Unbekannt): Abgang zum Wert der Zeile. `sonstiges` ist ein Verlust ohne
            // Erlös (falsch adressiert, Projekt eingestellt) — der CHF-Wert der Zeile
            // nennt dann, was verloren ging, nicht was hereinkam.
            abgang(b.asset, -m, b.art === 'sonstiges' ? 0 : wert, zeit, b, b.art === 'sonstiges' ? 'verlust' : b.art)
        }
        if (b.gebuehrAsset && Number(b.gebuehrMenge) > 0) abgang(b.gebuehrAsset, Number(b.gebuehrMenge), 0, zeit, b, 'gebuehr')
    }
    return { abgaenge, lose }
}

/** Summen der Abgänge eines Jahres. */
export function veraeusserungen(abgaenge) {
    const handel = abgaenge.filter((a) => a.art !== 'gebuehr')
    const s = { anzahl: handel.length, erloes: 0, kosten: 0, gewinn: 0, ohneEinstand: 0, ohneErloes: 0, kurzfristigErloes: 0 }
    for (const a of handel) {
        if (a.erloes == null) s.ohneErloes++; else s.erloes += a.erloes
        if (a.kosten == null) s.ohneEinstand++; else s.kosten += a.kosten
        if (a.gewinn != null) s.gewinn += a.gewinn
        if (a.erloes != null) s.kurzfristigErloes += a.erloes * a.kurzfristigAnteil
    }
    return s
}

/**
 * Die fünf Kriterien (ESTV KS 36, analog Krypto) als Ampel. `null` = nicht
 * aus den Daten entscheidbar — die Oberfläche sagt dann, was zu prüfen ist.
 *
 * @param {{ volumen:number, vermoegenAnfang:number|null, kurzfristigErloes:number, erloes:number,
 *           futuresTrades:number }} m
 */
export function gewerbsKriterien(m) {
    const haltedauer = m.erloes > 0 ? m.kurzfristigErloes / m.erloes : 0
    return [
        { id: 'haltedauer', erfuellt: haltedauer === 0 ? true : haltedauer < 0.0001 ? true : false, wert: haltedauer },
        { id: 'volumen', erfuellt: m.vermoegenAnfang > 0 ? m.volumen <= 5 * m.vermoegenAnfang : (m.volumen > 0 ? null : true), wert: m.vermoegenAnfang > 0 ? m.volumen / m.vermoegenAnfang : null },
        { id: 'einkommen', erfuellt: null, wert: null },
        { id: 'fremdfinanzierung', erfuellt: null, wert: null },
        { id: 'derivate', erfuellt: m.futuresTrades > 0 ? false : true, wert: m.futuresTrades },
    ]
}
