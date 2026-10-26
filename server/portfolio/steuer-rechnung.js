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
 *
 * Identität eines Coins: `token-id.js` (seit Audit FUN-PRT-001). Bestand und
 * Lose zählen je `ASSET|kontrakt`, sobald ein Vertrag fremd ist — ein falscher
 * „USDT“ an derselben Adresse ist ein eigener Posten, kein Teil des echten.
 */
import { tokenIdentitaet } from './token-id.js'


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
 * Token-Umstellungen: der alte Coin wird vom Projekt in den neuen getauscht —
 * kein Verkauf, nur ein neuer Name (bzw. eine neue Stückelung). Einstand und
 * Kaufdatum gehen auf den neuen Coin über.
 * - CHSB → BORG 1:1, SwissBorg, Fenster bis 21.10.2023, in der App automatisch
 * - MATIC → POL 1:1, Polygon, ab 04.09.2024
 * `faktor` = neue Stück je altem Stück.
 */
export const MIGRATIONEN = {
    CHSB: { nach: 'BORG', faktor: 1 },
    MATIC: { nach: 'POL', faktor: 1 },
}

/**
 * Ist diese Bewegung eine Umstellung? Ein Tausch zwischen einem bekannten Paar
 * im erwarteten Verhältnis (±1 %), oder ausdrücklich `einordnung: 'migration'`.
 * Bis 25.10.2026 zählte die CHSB→BORG-Umstellung als Verkauf: 728 CHF Erlös
 * und Handelsvolumen, die es nie gab.
 * @returns {{ von, nach, faktor }|null}
 */
export function istMigration(b) {
    if (b.art !== 'tausch' || !b.gegenAsset) return null
    const m = Number(b.menge) || 0, g = Number(b.gegenMenge) || 0
    const [alt, altMenge, neu, neuMenge] = m < 0 ? [b.asset, -m, b.gegenAsset, g] : [b.gegenAsset, -g, b.asset, m]
    if (!(altMenge > 0 && neuMenge > 0)) return null
    if (b.einordnung === 'migration') return { von: alt, nach: neu, faktor: neuMenge / altMenge }
    const regel = MIGRATIONEN[String(alt).toUpperCase()]
    if (!regel || regel.nach !== String(neu).toUpperCase()) return null
    return Math.abs(neuMenge / altMenge / regel.faktor - 1) <= 0.01 ? { von: alt, nach: neu, faktor: neuMenge / altMenge } : null
}

/**
 * Schlüssel eines Postens je Ort: `quelle\0ASSET`, bei fremdem Vertrag
 * `quelle\0ASSET\0kontrakt`. Teil [1] ist immer das Kürzel.
 */
export function ortSchluessel(quelle, asset, fremd = null) {
    return fremd ? `${quelle}\u0000${asset}\u0000${fremd}` : `${quelle}\u0000${asset}`
}

/**
 * Bestand je Ort und Asset bis einschliesslich `bis` (ms). Echte und falsche
 * Token gleichen Kürzels an derselben Adresse bleiben getrennt.
 * @param {ReturnType<typeof tokenIdentitaet>} [ident]  Vorgabe: aus `bewegungen`
 * @returns {Map<string, number>}  `ortSchluessel` → Menge
 */
export function bestandAm(bewegungen, bis, ident = tokenIdentitaet(bewegungen)) {
    const m = new Map()
    const add = (q, a, f, v) => {
        if (!a || !v) return
        const k = ortSchluessel(q, a, f)
        m.set(k, (m.get(k) || 0) + v)
    }
    for (const b of bewegungen) {
        if (Number(b.zeit) > bis || b.einordnung === 'ignorieren') continue
        for (const s of ident.seiten(b)) add(b.quelle, s.asset, s.fremd, s.menge)
        if (b.gebuehrAsset) add(b.quelle, b.gebuehrAsset, null, -(Number(b.gebuehrMenge) || 0))
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
 * Zugänge:  kauf/tausch (empfangene Seite, auch Swap-Hälften ohne Gegen-Asset), Einkommen, nicht eingeordnete
 *           oder als „kauf" eingeordnete Einzahlungen, `bestand`.
 *           Einstand = chfWert der Zeile (bei Tausch/Kauf der Wert des
 *           Gekauften), sonst unbekannt.
 * Abgänge:  verkauf/tausch (abgegebene Seite), Gebühren in Coins,
 *           nicht als Transfer eingeordnete Auszahlungen (Bezahlung,
 *           Abgang an Unbekannt).
 * Fiat (CHF/EUR/USD) und Transfers bilden keine Lose.
 * Lose je Identität (`token-id.js`): `ASSET` bzw. `ASSET|kontrakt` für fremde Verträge.
 */
export function fifo(bewegungen, { fiat = ['CHF', 'EUR', 'USD'], von = -Infinity, bis = Infinity, halteMonate = 6, ident = tokenIdentitaet(bewegungen) } = {}) {
    // Haltedauer-Grenze des Kriterienkatalogs: KS 36 sechs Monate, Thurgau zwölf.
    const kurzGrenze = (halteMonate * 365 / 12) * 86400e3
    const istFiat = (a) => fiat.includes(a)
    const lose = new Map()           // Identität → [{ menge, kostenJe|null, zeit }]
    const abgaenge = []
    const zugang = (asset, menge, kosten, zeit) => {
        if (!asset || istFiat(asset) || !(menge > 0)) return
        const l = lose.get(asset) || []
        l.push({ menge, kostenJe: kosten != null ? kosten / menge : null, zeit })
        lose.set(asset, l)
    }
    const abgang = (asset, menge, erloes, zeit, b, art) => {
        if (!asset || istFiat(asset) || !(menge > 0)) return
        const trenn = asset.indexOf('|')
        const l = lose.get(asset) || []
        let rest = menge, kosten = 0, kostenBekannt = true, kurzMenge = 0, gedeckt = 0
        // Toleranz relativ zur Menge: bei Mengen in Millionen (SHIB, PEPE) liegt der
        // Rundungsrest von Fliesskommazahlen über einer festen Grenze von 1e-9.
        const tol = Math.max(1e-12, menge * 1e-10)
        while (rest > tol && l.length) {
            const los = l[0]
            const nimm = Math.min(los.menge, rest)
            if (los.kostenJe == null) kostenBekannt = false; else kosten += nimm * los.kostenJe
            if (zeit - los.zeit < kurzGrenze) kurzMenge += nimm
            gedeckt += nimm
            los.menge -= nimm
            rest -= nimm
            if (los.menge <= tol) l.shift()
        }
        const ungedeckt = rest > tol ? rest : 0
        if (ungedeckt) kostenBekannt = false     // mehr abgegeben als je zugegangen → Historie lückenhaft
        if (zeit >= von && zeit <= bis) {
            abgaenge.push({
                id: b.id, zeit, quelle: b.quelle, asset: trenn < 0 ? asset : asset.slice(0, trenn), menge, art,
                ...(trenn < 0 ? {} : { kontrakt: asset.slice(trenn + 1) }),
                erloes: erloes ?? null,
                kosten: kostenBekannt ? kosten : null,
                gewinn: kostenBekannt && erloes != null ? erloes - kosten : null,
                // Ungedeckter Teil: Kaufdatum unbekannt → Haltedauer nicht entscheidbar.
                kurzfristigAnteil: menge > 0 ? kurzMenge / menge : 0,
                unbekanntAnteil: menge > 0 ? ungedeckt / menge : 0,
                ungedeckt,
            })
        }
    }

    // Gleiche Zeit: Zugänge vor Abgängen — Kauf und sofortiger Verkauf in derselben
    // Sekunde (Bitpanda-Tausch in zwei Zeilen) sonst „ungedeckt".
    const zuerst = (b) => (Number(b.menge) > 0 && !b.gegenAsset ? 0 : 1)
    const sortiert = [...bewegungen].filter((b) => b.einordnung !== 'ignorieren')
        .sort((a, b) => Number(a.zeit) - Number(b.zeit) || zuerst(a) - zuerst(b) || (a.id || 0) - (b.id || 0))
    for (const b of sortiert) {
        const zeit = Number(b.zeit)
        const m = Number(b.menge) || 0
        const g = Number(b.gegenMenge) || 0
        const wert = b.chfWert != null ? Number(b.chfWert) : null
        const gebuehrId = b.gebuehrAsset ? ident.id(b.gebuehrAsset) : null
        if (istTransfer(b)) {
            if (b.gebuehrAsset && Number(b.gebuehrMenge) > 0) abgang(gebuehrId, Number(b.gebuehrMenge), 0, zeit, b, 'gebuehr')
            continue
        }
        const [seiteA, seiteG] = ident.seiten(b)
        const idA = seiteA?.id, idG = seiteG?.id
        const mig = istMigration(b)
        if (mig) {
            // Lose umhängen: gleiche Kosten, gleiches Kaufdatum, Menge × Faktor.
            const vonA = m < 0      // wie in istMigration: die abgegebene Seite ist die alte
            const [vonId, nachId] = vonA ? [idA, idG] : [idG, idA]
            const alt = lose.get(vonId) || []
            let rest = Math.abs(vonA ? m : g)
            const tol = Math.max(1e-12, rest * 1e-10)
            const neu = lose.get(nachId) || []
            while (rest > tol && alt.length) {
                const los = alt[0]
                const nimm = Math.min(los.menge, rest)
                neu.push({ menge: nimm * mig.faktor, kostenJe: los.kostenJe != null ? los.kostenJe / mig.faktor : null, zeit: los.zeit })
                los.menge -= nimm
                rest -= nimm
                if (los.menge <= tol) alt.shift()
            }
            // Mehr umgestellt als je zugegangen: der Rest kommt ohne bekannten Einstand.
            if (rest > tol) neu.push({ menge: rest * mig.faktor, kostenJe: null, zeit })
            neu.sort((x, y) => x.zeit - y.zeit)
            lose.set(nachId, neu)
        } else if (['kauf', 'verkauf', 'tausch'].includes(b.art) && b.gegenAsset) {
            // Je Seite: was reinkommt, wird Los; was rausgeht, wird Abgang.
            for (const [asset, menge] of [[idA, m], [idG, g]]) {
                if (menge > 0) zugang(asset, menge, wert, zeit)
                else if (menge < 0) abgang(asset, -menge, wert, zeit, b, b.art)
            }
        } else if (m > 0 && (istEinkommen(b) || ['einzahlung', 'bestand', 'kauf', 'tausch', 'sonstiges'].includes(b.art))) {
            // `tausch` ohne Gegen-Asset: Bitpanda bucht einen Swap (Crypto-Index,
            // VSN) als zwei Zeilen. Bis 26.10.2026 wurde nur der Abgang gebucht,
            // der Zugang bildete kein Los → 2021: 222 Verkäufe „ohne Einstand".
            zugang(idA, m, wert, zeit)
        } else if (m < 0) {
            // Auszahlung ohne Transfer-Einordnung (Bezahlung, Kartenaufladung, Abgang an
            // Unbekannt): Abgang zum Wert der Zeile. `sonstiges` ist ein Verlust ohne
            // Erlös (falsch adressiert, Projekt eingestellt) — der CHF-Wert der Zeile
            // nennt dann, was verloren ging, nicht was hereinkam.
            abgang(idA, -m, b.art === 'sonstiges' ? 0 : wert, zeit, b, b.art === 'sonstiges' ? 'verlust' : b.art)
        }
        if (b.gebuehrAsset && Number(b.gebuehrMenge) > 0) abgang(gebuehrId, Number(b.gebuehrMenge), 0, zeit, b, 'gebuehr')
    }
    return { abgaenge, lose }
}

/**
 * Einstand je Asset aus den noch gehaltenen FIFO-Losen: Ø-Kaufkurs, Kostenbasis,
 * erster Kauf. Lose ohne bekannte Kosten (Import ohne CHF-Wert, Quelle ohne volle
 * Historie) zählen in `ohneKostenMenge` und NICHT in den Durchschnitt — ein
 * Durchschnitt über „0 CHF“ würde den Kaufkurs schönrechnen.
 * @param {Map<string, {menge, kostenJe, zeit}[]>} lose  aus `fifo()`
 * @returns {Map<string, { menge, kosten, mitKostenMenge, ohneKostenMenge, schnitt, ersterKauf, letzterKauf, lose }>}
 */
export function einstandJeAsset(lose) {
    const aus = new Map()
    for (const [asset, liste] of lose) {
        const l = liste.filter((x) => x.menge > 1e-12)
        if (!l.length) continue
        let menge = 0, kosten = 0, mitKosten = 0
        for (const x of l) {
            menge += x.menge
            if (x.kostenJe != null) { kosten += x.menge * x.kostenJe; mitKosten += x.menge }
        }
        aus.set(asset, {
            menge, kosten: mitKosten > 0 ? kosten : null, mitKostenMenge: mitKosten, ohneKostenMenge: menge - mitKosten,
            schnitt: mitKosten > 0 ? kosten / mitKosten : null,
            ersterKauf: Math.min(...l.map((x) => x.zeit)), letzterKauf: Math.max(...l.map((x) => x.zeit)),
            lose: l.map((x) => ({ zeit: x.zeit, menge: x.menge, kursChf: x.kostenJe })),
        })
    }
    return aus
}

/**
 * Einstand mehrerer Identitäten zusammen (eine Zeile im Vermögen kann den
 * Börsen-Coin und einen gleich bewerteten Token desselben Kürzels tragen).
 * @returns {object|undefined}  dieselbe Form wie ein Eintrag von `einstandJeAsset`
 */
export function einstandZusammen(einstand, ids) {
    const teile = [...new Set(ids)].map((i) => einstand.get(i)).filter(Boolean)
    if (teile.length <= 1) return teile[0]
    const menge = teile.reduce((s, e) => s + e.menge, 0)
    const mitKosten = teile.reduce((s, e) => s + e.mitKostenMenge, 0)
    const kosten = teile.reduce((s, e) => s + (e.kosten || 0), 0)
    const lose = teile.flatMap((e) => e.lose).sort((x, y) => x.zeit - y.zeit)
    return {
        menge, kosten: mitKosten > 0 ? kosten : null, mitKostenMenge: mitKosten, ohneKostenMenge: menge - mitKosten,
        schnitt: mitKosten > 0 ? kosten / mitKosten : null,
        ersterKauf: Math.min(...teile.map((e) => e.ersterKauf)), letzterKauf: Math.max(...teile.map((e) => e.letzterKauf)), lose,
    }
}

/** Summen der Abgänge eines Jahres. */
export function veraeusserungen(abgaenge) {
    const handel = abgaenge.filter((a) => a.art !== 'gebuehr')
    const s = { anzahl: handel.length, erloes: 0, kosten: 0, gewinn: 0, ohneEinstand: 0, ohneErloes: 0, kurzfristigErloes: 0, haltedauerUnbekanntErloes: 0 }
    for (const a of handel) {
        if (a.erloes == null) s.ohneErloes++; else s.erloes += a.erloes
        if (a.kosten == null) s.ohneEinstand++; else s.kosten += a.kosten
        if (a.gewinn != null) s.gewinn += a.gewinn
        if (a.erloes != null) s.kurzfristigErloes += a.erloes * a.kurzfristigAnteil
        if (a.erloes != null) s.haltedauerUnbekanntErloes += a.erloes * (a.unbekanntAnteil || 0)
    }
    return s
}

/**
 * Die fünf Kriterien (ESTV KS 36, analog Krypto) als Ampel. `null` = nicht
 * aus den Daten entscheidbar — die Oberfläche sagt dann, was zu prüfen ist.
 *
 * @param {{ volumen:number, vermoegenAnfang:number|null, kurzfristigErloes:number, haltedauerUnbekanntErloes?:number, erloes:number,
 *           futuresTrades:number }} m
 */
export function gewerbsKriterien(m) {
    const haltedauer = m.erloes > 0 ? m.kurzfristigErloes / m.erloes : 0
    return [
        // Kurzfristig verkauft → nicht erfüllt. Sonst: Erlös aus Losen mit unbekanntem
        // Kaufdatum (mehr verkauft als belegt zugegangen) → nicht entscheidbar.
        { id: 'haltedauer', erfuellt: haltedauer >= 0.0001 ? false : (m.haltedauerUnbekanntErloes > 0.0001 * m.erloes ? null : true), wert: haltedauer, unbekannt: m.erloes > 0 ? (m.haltedauerUnbekanntErloes || 0) / m.erloes : 0 },
        { id: 'volumen', erfuellt: m.vermoegenAnfang > 0 ? m.volumen <= 5 * m.vermoegenAnfang : (m.volumen > 0 ? null : true), wert: m.vermoegenAnfang > 0 ? m.volumen / m.vermoegenAnfang : null },
        { id: 'einkommen', erfuellt: null, wert: null },
        { id: 'fremdfinanzierung', erfuellt: null, wert: null },
        { id: 'derivate', erfuellt: m.futuresTrades > 0 ? false : true, wert: m.futuresTrades },
    ]
}
