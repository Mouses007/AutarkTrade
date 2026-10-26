/**
 * Spot-Portfolio: die Seite „Totalverluste“ — was abgeschrieben ist, was es
 * gekostet hat. Nur zur Information: im Privatvermögen ist der Verlust nicht
 * abziehbar.
 *
 * Verlust = Einstand der noch gehaltenen Lose (FIFO, CHF). Ohne bekannten
 * Einstand (Airdrop ohne Wert, Import ohne CHF) ist der Verlust unbekannt,
 * nicht 0 — die Zeile sagt das.
 */
import { getKnex } from '../database.js'
import { totalverluste } from './totalverlust.js'
import { einstandHeute, bestaendeOhneDoppelte } from './uebersicht.js'
import { spamPruefer } from './spam.js'

/** Reine Statistik über die Zeilen (für den Selbsttest getrennt). */
export function totalverlustStatistik(zeilen, kostenbasisPortfolio) {
    const mitWert = zeilen.filter((z) => z.einstandChf != null)
    const summe = mitWert.reduce((s, z) => s + z.einstandChf, 0)
    const jeJahr = {}
    for (const z of mitWert) jeJahr[z.abJahr] = (jeJahr[z.abJahr] || 0) + z.einstandChf
    const groesster = mitWert.reduce((m, z) => (!m || z.einstandChf > m.einstandChf ? z : m), null)
    const basis = summe + (kostenbasisPortfolio || 0)
    return {
        anzahl: zeilen.length, ohneEinstand: zeilen.length - mitWert.length,
        verlorenChf: summe, jeJahr,
        groesster: groesster ? { asset: groesster.asset, chf: groesster.einstandChf } : null,
        anteilAmEinstand: basis > 0 ? summe / basis : null,
    }
}

export async function totalverlustUebersicht() {
    const k = getKnex()
    const tot = await totalverluste()
    if (!tot.size) return { zeilen: [], statistik: totalverlustStatistik([], 0) }
    const istSpam = await spamPruefer()
    const { einstand } = await einstandHeute(istSpam)
    const bestand = new Map()
    for (const b of await bestaendeOhneDoppelte()) {
        const a = String(b.asset).toUpperCase()
        bestand.set(a, (bestand.get(a) || 0) + Number(b.menge))
    }
    // Letzte bekannte Bewertung: die jüngste Bewegung mit CHF-Wert.
    const letzte = new Map()
    const bew = await k('portfolio_bewegungen').whereIn(k.raw('upper(asset)'), [...tot.keys()]).whereNotNull('chfWert')
        .select('asset', 'zeit', 'menge', 'chfWert').orderBy('zeit', 'desc')
    for (const b of bew) {
        const a = String(b.asset).toUpperCase()
        if (!letzte.has(a) && Math.abs(Number(b.menge)) > 0) letzte.set(a, { zeit: Number(b.zeit), kursChf: Math.abs(Number(b.chfWert) / Number(b.menge)) })
    }
    const zeilen = [...tot].map(([asset, t]) => {
        const e = einstand.get(asset)
        const menge = bestand.get(asset) ?? e?.menge ?? 0
        return {
            asset, am: t.am, abJahr: t.abJahr, menge,
            kaufkurs: e?.schnitt ?? null,
            einstandChf: e?.schnitt != null ? e.schnitt * menge : null,
            einstandTeilweise: !!e && e.ohneKostenMenge > menge * 0.001,
            ersterKauf: e?.ersterKauf ?? null,
            letzterKurs: letzte.get(asset) || null,
        }
    }).sort((a, b) => (b.einstandChf ?? -1) - (a.einstandChf ?? -1))
    // Kostenbasis des übrigen Portfolios — für den Anteil „wie viel des eingesetzten Geldes ist weg“.
    let kostenbasis = 0
    for (const [asset, e] of einstand) {
        if (tot.has(asset) || e.schnitt == null) continue
        kostenbasis += e.schnitt * (bestand.get(asset) ?? 0)
    }
    return { zeilen, statistik: totalverlustStatistik(zeilen, kostenbasis) }
}
