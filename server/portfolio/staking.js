/**
 * Spot-Portfolio: Staking-Produkte — was an einem Ort laufend Ertrag abwirft,
 * je Ort, Coin und Produkt. Rein: Bewegungen, Bestand und Kurs kommen von
 * aussen (`api.js`), hier wird nur gerechnet.
 *
 * Bitpanda nennt das Produkt im `operation_type` der Belohnung:
 *   reward               Staking (Coins im `staking-service`, Einsatz über
 *                        `stake`/`unstake`, die als Umbuchung ankommen)
 *   passive_earn_reward  Passive Earn (ohne Einsatz, Feb.–Juni 2026 für
 *                        ALGO/FET/VSN, danach dieselben Coins im Staking)
 * Belohnungen anderer Orte (Importe: SwissBorg, Ledger, Stakeit …) tragen
 * keinen Typ und heissen schlicht „Ertrag“. Wechselt ein Coin das Produkt,
 * sind es zwei Zeilen: das alte endet, das neue beginnt.
 *
 * Gemessene Rendite: Erträge der letzten 90 Tage gegen den HEUTIGEN Bestand
 * am Ort, hochgerechnet aufs Jahr. Gezählt wird zwischen der ersten und der
 * letzten Auszahlung im Fenster, ohne die erste — sie bezahlt die Zeit VOR
 * dem Fenster. Eine Messung, keine Zusage: mit Zinseszins und schwankendem
 * Satz liegt sie neben dem, was die Börse anschreibt.
 */

export const PRODUKT_VON_TYP = { reward: 'staking', passive_earn_reward: 'passiveEarn' }
export const AKTIV_TAGE = 21
export const RENDITE_TAGE = 90
const TAG = 86400e3

function typVon(b) {
    let roh = b.roh
    if (typeof roh === 'string') { try { roh = JSON.parse(roh) } catch { roh = null } }
    return roh?.operation_type || null
}

const median = (l) => {
    if (!l.length) return null
    const s = [...l].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * @param {Array<{quelle, zeit, art, asset, menge, chfWert, einordnung, roh}>} bewegungen  (art `staking` und `umbuchung` genügen)
 * @param {{ jetzt?: number, bestandVon?: (quelle, asset) => ({menge, chf}|null), kursChfVon?: (asset) => number|null }} opt
 * @returns {{ produkte: object[], summe: { aktiv, bestandChf, ertragChf, ertragOhneChf, laufendErtragChf, laufendErtragHeuteChf } }}
 */
export function stakingUebersicht(bewegungen, { jetzt = Date.now(), bestandVon = () => null, kursChfVon = () => null } = {}) {
    const je = new Map()
    const produkt = (quelle, asset, art) => {
        const key = `${quelle}|${asset}|${art}`
        if (!je.has(key)) je.set(key, { quelle, asset, produkt: art, ertraege: [], eingesetzt: null, ersterEinsatz: null })
        return je.get(key)
    }
    for (const b of bewegungen) {
        const m = Number(b.menge) || 0
        if (b.einordnung === 'ignorieren' || b.einordnung === 'transfer' || !(m > 0)) continue
        const asset = String(b.asset || '').toUpperCase()
        if (b.art === 'staking') {
            produkt(b.quelle, asset, PRODUKT_VON_TYP[typVon(b)] || 'ertrag').ertraege.push({ zeit: Number(b.zeit), menge: m, chf: b.chfWert != null ? Number(b.chfWert) : null })
        } else if (b.art === 'umbuchung') {
            // Bitpanda bucht stake/unstake als zwei Zeilen (+/−) zwischen Teil-Wallets; die Plus-Zeile ist der Betrag.
            const typ = typVon(b)
            if (typ !== 'stake' && typ !== 'unstake') continue
            const p = produkt(b.quelle, asset, 'staking')
            p.eingesetzt = (p.eingesetzt || 0) + (typ === 'stake' ? m : -m)
            if (typ === 'stake') p.ersterEinsatz = Math.min(p.ersterEinsatz ?? Infinity, Number(b.zeit))
        }
    }

    const produkte = []
    for (const p of je.values()) {
        const e = p.ertraege.sort((a, b) => a.zeit - b.zeit)
        const ersterErtrag = e[0]?.zeit ?? null
        const letzte = e.at(-1)?.zeit ?? null
        const abstaende = e.slice(1).map((x, i) => (x.zeit - e[i].zeit) / TAG)
        const intervallTage = median(abstaende)
        const ruheTage = Math.max(AKTIV_TAGE, 3 * (intervallTage || 0))
        const eingesetzt = p.eingesetzt != null ? Math.max(0, p.eingesetzt) : null
        // Laufend: Einsatz da, oder wiederholte Auszahlungen bis vor Kurzem. Eine einzelne
        // Buchung (Import eines Sammelbetrags, VTHO 23.10.2026) zeigt keinen laufenden Ertrag.
        const aktiv = (eingesetzt || 0) > 0
            ? letzte == null || jetzt - letzte <= ruheTage * TAG
            : e.length >= 2 && jetzt - letzte <= ruheTage * TAG
        const bestand = bestandVon(p.quelle, p.asset)
        const kurs = kursChfVon(p.asset)
        const menge = e.reduce((s, x) => s + x.menge, 0)
        const mitChf = e.filter((x) => x.chf != null)
        const anfang = Math.min(p.ersterEinsatz ?? Infinity, ersterErtrag ?? Infinity)

        let renditePa = null, renditeTage = null
        if (aktiv && letzte != null && bestand?.menge > 0) {
            const fenster = e.filter((x) => x.zeit >= letzte - RENDITE_TAGE * TAG)
            const tage = fenster.length ? (letzte - fenster[0].zeit) / TAG : 0
            if (fenster.length >= 3 && tage >= 14) {
                const ertrag = fenster.slice(1).reduce((s, x) => s + x.menge, 0)
                renditePa = (ertrag / bestand.menge) * (365 / tage)
                renditeTage = Math.round(tage)
            }
        }
        produkte.push({
            quelle: p.quelle, asset: p.asset, produkt: p.produkt, aktiv,
            seit: Number.isFinite(anfang) ? anfang : null,
            letzte, anzahl: e.length, intervallTage,
            eingesetzt,
            ertragMenge: menge,
            ertragChf: mitChf.length ? mitChf.reduce((s, x) => s + x.chf, 0) : null,
            ertragOhneChf: e.length - mitChf.length,
            ertragHeuteChf: kurs != null ? menge * kurs : null,
            // Bestand nur für ein laufendes Produkt: ein beendetes hat keinen „Bestand im Produkt“.
            bestandMenge: aktiv ? bestand?.menge ?? null : null,
            bestandChf: aktiv ? bestand?.chf ?? null : null,
            renditePa, renditeTage,
        })
    }
    produkte.sort((a, b) => (b.aktiv - a.aktiv) || ((b.aktiv ? b.bestandChf : b.ertragChf) || 0) - ((a.aktiv ? a.bestandChf : a.ertragChf) || 0) || a.asset.localeCompare(b.asset))

    const aktive = produkte.filter((p) => p.aktiv)
    const summe = {
        aktiv: aktive.length,
        // Ein Coin in zwei Produkten am selben Ort hat EINEN Bestand.
        bestandChf: [...new Map(aktive.map((p) => [`${p.quelle}|${p.asset}`, p.bestandChf || 0])).values()].reduce((s, v) => s + v, 0),
        ertragChf: produkte.reduce((s, p) => s + (p.ertragChf || 0), 0),
        ertragOhneChf: produkte.reduce((s, p) => s + p.ertragOhneChf, 0),
        // Erhalt ↔ heute nur über dieselben Produkte (laufende): ein beendetes hat oft keinen Kurs mehr.
        laufendErtragChf: aktive.reduce((s, p) => s + (p.ertragChf || 0), 0),
        laufendErtragHeuteChf: aktive.reduce((s, p) => s + (p.ertragHeuteChf || 0), 0),
    }
    return { produkte, summe }
}
