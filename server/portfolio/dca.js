/**
 * Spot-Portfolio: DCA-Portfolio — nur die regelmässigen Käufe, als eigenes
 * kleines Portfolio. Rein: Käufe, Kurse und Bestand kommen von aussen
 * (`api.js`), hier wird nur gerechnet.
 *
 * Welche Käufe zählen (`istDcaKauf`):
 *   - Bitpanda-Sparplan: `operation_type: savings_plan` (`istSparplan`), seit 2019;
 *   - markierte Käufe: `roh.dca` — am 01.11.2026 die Crypto.com-Kartenkäufe
 *     2022–2024 („Gebühr 1.50 im Kartenbetrag enthalten“, 50/51.50 CHF).
 *
 * Bestand = alles so Gekaufte, auch wenn es später auf den Ledger verschoben
 * oder verkauft wurde (Entscheid des Owners 01.11.2026): gemessen wird die
 * Strategie, nicht der heutige Ort. Wo der Coin heute liegt, steht daneben —
 * aus der Übersicht, ohne zu behaupten, welche Stücke davon DCA-Stücke sind.
 *
 * Eingestellte Coins gehen über ihre Umstellung in den Wert ein (aus Bitpandas
 * `merger_crypto`, z. B. AGIX → FET × 0.43335, BEST → VSN × 4.91): ein
 * AGIX-Sparplan ist heute FET wert, nicht nichts.
 */
import { istSparplan } from './normal.js'

const TAG = 86400e3

function rohVon(z) {
    let roh = z?.roh
    if (typeof roh === 'string') { try { roh = JSON.parse(roh) } catch { roh = null } }
    return roh || null
}

/** Ein Kauf aus einem Sparplan oder als DCA markiert? */
export function istDcaKauf(z) {
    if (z?.art !== 'kauf' || !(Number(z.menge) > 0)) return false
    return istSparplan(z) || !!rohVon(z)?.dca
}

/** Woher die DCA-Marke stammt: 'sparplan' (Bitpanda) oder der Text der Marke. */
export function dcaArt(z) {
    return istSparplan(z) ? 'sparplan' : String(rohVon(z)?.dca || '')
}

const median = (l) => {
    if (!l.length) return null
    const s = [...l].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Umstellungen aus Bitpandas Fusionen: Tausch-Zeilen mit `operation_type:
 * merger_crypto` (alt = Gegenseite, neu = Hauptseite). Faktor = neu je alt.
 * @returns {Record<string, { nach: string, faktor: number, ab: number }>}
 */
export function umstellungenAus(zeilen) {
    const aus = {}
    for (const z of zeilen) {
        if (rohVon(z)?.operation_type !== 'merger_crypto' || !z.gegenAsset) continue
        const alt = -Number(z.gegenMenge), neu = Number(z.menge)
        if (!(alt > 0 && neu > 0)) continue
        const von = String(z.gegenAsset).toUpperCase()
        // Mehrere Zeilen derselben Fusion: der Faktor ist überall gleich, das früheste Datum zählt.
        if (!aus[von] || Number(z.zeit) < aus[von].ab) aus[von] = { nach: String(z.asset).toUpperCase(), faktor: neu / alt, ab: Number(z.zeit) }
    }
    return aus
}

/** Der Coin, in dem ein Bestand heute bewertet wird (Umstellungen folgen, auch mehrfach). */
export function heutigerCoin(asset, umstellungen = {}) {
    let a = String(asset).toUpperCase(), f = 1
    for (let i = 0; i < 5 && umstellungen[a]; i++) { f *= umstellungen[a].faktor; a = umstellungen[a].nach }
    return { asset: a, faktor: f }
}

/**
 * @param {Array} kaeufe  Käufe (`istDcaKauf`), mit quelle, zeit, asset, menge, gegenAsset, gegenMenge, chfWert, roh
 * @param {{ jetzt?, kursChfVon?: (asset) => number|null, bestandVon?: (asset) => object|null,
 *           umstellungen?: object, quelleName?: (quelle) => string }} opt
 */
export function dcaUebersicht(kaeufe, { jetzt = Date.now(), kursChfVon = () => null, bestandVon = () => null, umstellungen = {}, quelleName = (q) => q } = {}) {
    const coins = new Map()
    for (const z of kaeufe) {
        if (!istDcaKauf(z)) continue
        const asset = String(z.asset).toUpperCase()
        if (!coins.has(asset)) coins.set(asset, { asset, kaeufe: [] })
        coins.get(asset).kaeufe.push({
            quelle: z.quelle, zeit: Number(z.zeit), menge: Number(z.menge),
            betrag: z.gegenMenge != null ? -Number(z.gegenMenge) : null, waehrung: z.gegenAsset ? String(z.gegenAsset).toUpperCase() : null,
            chf: z.chfWert != null ? Math.abs(Number(z.chfWert)) : null, art: dcaArt(z),
        })
    }

    const liste = []
    for (const c of coins.values()) {
        const k = c.kaeufe.sort((a, b) => a.zeit - b.zeit)
        // Pläne: je Ort und Zahlungswährung. Der Rhythmus aus den letzten fünf Abständen —
        // ein Plan, der 2019 zweiwöchentlich lief und heute monatlich läuft, ist heute monatlich
        // (mit zwölf Abständen las der ETH-Plan am 01.11.2026 noch „alle 2 Wochen“).
        const plaene = new Map()
        for (const x of k) {
            const key = `${x.quelle}|${x.waehrung}`
            if (!plaene.has(key)) plaene.set(key, [])
            plaene.get(key).push(x)
        }
        const planListe = [...plaene.values()].map((l) => {
            const abstaende = l.slice(1).map((x, i) => (x.zeit - l[i].zeit) / TAG)
            const intervallTage = median(abstaende.slice(-5))
            const bis = l.at(-1).zeit
            return {
                quelle: l[0].quelle, quelleName: quelleName(l[0].quelle), waehrung: l[0].waehrung, art: l[0].art,
                anzahl: l.length, von: l[0].zeit, bis, intervallTage,
                betrag: l.at(-1).betrag, betraege: [...new Set(l.map((x) => x.betrag).filter((b) => b != null))].sort((a, b) => a - b),
                investiertChf: l.reduce((s, x) => s + (x.chf || 0), 0), ohneChf: l.filter((x) => x.chf == null).length,
                menge: l.reduce((s, x) => s + x.menge, 0),
                // Läuft: der letzte Kauf liegt höchstens 2½ Abstände zurück (mindestens 21 Tage Spielraum).
                aktiv: jetzt - bis <= Math.max(21, 2.5 * (intervallTage || 0)) * TAG,
            }
        }).sort((a, b) => (b.aktiv - a.aktiv) || b.bis - a.bis)

        const menge = k.reduce((s, x) => s + x.menge, 0)
        const mitChf = k.filter((x) => x.chf != null)
        const investiertChf = mitChf.reduce((s, x) => s + x.chf, 0)
        const mengeMitChf = mitChf.reduce((s, x) => s + x.menge, 0)
        const heute = heutigerCoin(c.asset, umstellungen)
        const kurs = kursChfVon(heute.asset)
        const wertHeuteChf = kurs != null ? menge * heute.faktor * kurs : null
        // Gewinn nur über die Käufe mit bekanntem Einsatz — sonst rechnete ein Kauf ohne CHF-Wert als geschenkt.
        const wertMitChf = kurs != null ? mengeMitChf * heute.faktor * kurs : null
        liste.push({
            asset: c.asset, heuteAsset: heute.asset, faktor: heute.faktor, umgestellt: heute.asset !== c.asset,
            anzahl: k.length, von: k[0].zeit, bis: k.at(-1).zeit, menge, investiertChf, ohneChf: k.length - mitChf.length,
            schnittChf: mengeMitChf > 0 ? investiertChf / mengeMitChf : null,
            kursChf: kurs, wertHeuteChf,
            gewinnChf: wertMitChf != null ? wertMitChf - investiertChf : null,
            gewinnPct: wertMitChf != null && investiertChf > 0 ? wertMitChf / investiertChf - 1 : null,
            aktiv: planListe.some((p) => p.aktiv),
            plaene: planListe,
            heuteImPortfolio: bestandVon(heute.asset),
        })
    }
    liste.sort((a, b) => (b.aktiv - a.aktiv) || b.investiertChf - a.investiertChf || a.asset.localeCompare(b.asset))

    const mitWert = liste.filter((c) => c.gewinnChf != null)
    const summe = {
        kaeufe: liste.reduce((s, c) => s + c.anzahl, 0),
        investiertChf: liste.reduce((s, c) => s + c.investiertChf, 0),
        wertHeuteChf: liste.reduce((s, c) => s + (c.wertHeuteChf || 0), 0),
        // Gewinn über dieselben Käufe wie der Einsatz: Coins ohne Kurs heute fallen aus beiden heraus.
        gewinnChf: mitWert.reduce((s, c) => s + c.gewinnChf, 0),
        investiertMitKursChf: mitWert.reduce((s, c) => s + c.investiertChf, 0),
        ohneKurs: liste.filter((c) => c.kursChf == null).map((c) => c.asset),
        ohneChf: liste.reduce((s, c) => s + c.ohneChf, 0),
        aktivePlaene: liste.reduce((s, c) => s + c.plaene.filter((p) => p.aktiv).length, 0),
        von: liste.length ? Math.min(...liste.map((c) => c.von)) : null,
    }
    summe.gewinnPct = summe.investiertMitKursChf > 0 ? summe.gewinnChf / summe.investiertMitKursChf : null
    return { coins: liste, summe }
}

/** 'YYYY-MM' eines Zeitpunkts (UTC). */
export const monatVon = (ms) => new Date(Number(ms)).toISOString().slice(0, 7)

/** Alle Monate von–bis einschliesslich ('YYYY-MM'). */
export function monate(von, bis) {
    const aus = []
    let [j, m] = von.split('-').map(Number)
    const [jb, mb] = bis.split('-').map(Number)
    while (j < jb || (j === jb && m <= mb)) {
        aus.push(`${j}-${String(m).padStart(2, '0')}`)
        if (++m > 12) { m = 1; j++ }
    }
    return aus
}

/**
 * Verlauf je Monatsende: eingesetzt (Summe CHF bis dahin) gegen Wert (Menge
 * bis dahin × Monatsschluss in CHF). Kurs eines Coins im Monat: sein eigener
 * Monatsschluss; nach einer Umstellung der des neuen Coins × Faktor; fehlt
 * beides, der letzte eigene Kaufpreis (`geschaetzt`) — so knickt die Kurve
 * nicht auf null, nur weil ein Coin delistet ist.
 *
 * @param {Array} kaeufe
 * @param {Map<string, Map<string, number>>} monatsKurse  Asset → ('YYYY-MM' → CHF je Stück, Monatsschluss)
 * @param {{ umstellungen?, bisMonat? }} opt
 * @returns {Array<{ monat, eingesetztChf, wertChf, geschaetzt: string[] }>}
 */
export function dcaVerlauf(kaeufe, monatsKurse, { umstellungen = {}, bisMonat = monatVon(Date.now()) } = {}) {
    const k = kaeufe.filter(istDcaKauf).map((z) => ({ asset: String(z.asset).toUpperCase(), zeit: Number(z.zeit), menge: Number(z.menge), chf: z.chfWert != null ? Math.abs(Number(z.chfWert)) : null }))
        .sort((a, b) => a.zeit - b.zeit)
    if (!k.length) return []
    const menge = new Map(), letzterPreis = new Map()
    let eingesetzt = 0, i = 0
    const aus = []
    for (const monat of monate(monatVon(k[0].zeit), bisMonat)) {
        while (i < k.length && monatVon(k[i].zeit) <= monat) {
            const x = k[i++]
            menge.set(x.asset, (menge.get(x.asset) || 0) + x.menge)
            if (x.chf != null) { eingesetzt += x.chf; letzterPreis.set(x.asset, x.chf / x.menge) }
        }
        let wert = 0
        const geschaetzt = []
        for (const [asset, m] of menge) {
            let p = monatsKurse.get(asset)?.get(monat)
            const u = umstellungen[asset]
            if (p == null && u && monat >= monatVon(u.ab)) {
                const neu = monatsKurse.get(u.nach)?.get(monat)
                if (neu != null) p = neu * u.faktor
            }
            if (p == null) { p = letzterPreis.get(asset); if (p != null) geschaetzt.push(asset) }
            if (p != null) wert += m * p
        }
        aus.push({ monat, eingesetztChf: eingesetzt, wertChf: wert, geschaetzt })
    }
    return aus
}
