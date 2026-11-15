/**
 * fruehphase-ansicht.js — was der Reiter „Frühphase" des Hype-Radars zeigt.
 *
 * Bis zum Umbau des KI-Coachs (15.11.2026) stand dieser Rumpf in der Route
 * `GET /api/hype-radar/frueh`. Jetzt rufen ihn zwei: die Route und das
 * Coach-Werkzeug `query_hype_radar` — der Coach soll dieselben Kandidaten,
 * dieselbe Rohliste und denselben Trichter sehen wie die Seite, nicht eine
 * zweite, leicht andere Abfrage.
 */
import { leseEinstellungen } from './einstellungen.js'
import { normChain } from './quellen.js'
import { freigabeAn } from '../quellen/freigabe.js'
import { kurzfassung, gespeichertePruefungen, schluesselFuer } from './projekt.js'
import { fruehStand } from './fruehphase.js'
import { istDuenn, kandidatStatus, KANDIDAT_AB } from './fruehphase-bewertung.js'
import { ladeStaende } from './boersenwacht.js'
import { leiterFuer, boersenFuer } from './boersenwacht-bewertung.js'

/** Vertrag als Schlüssel: Solana unterscheidet Gross/Klein, EVM nicht. */
export const vertragsSchluessel = (chain, contract) => {
    const c = normChain(chain)
    return `${c}|${c === 'solana' ? String(contract || '') : String(contract || '').toLowerCase()}`
}

export function sicherParse(text, rueckfall) {
    try {
        const j = JSON.parse(text)
        return j ?? rueckfall
    } catch {
        return rueckfall
    }
}

/**
 * Kandidaten, Beobachtungsliste, Trichter und (auf Wunsch) die Rohliste.
 *
 * @param {import('knex').Knex} knex
 * @param {{roh?: boolean, alle?: boolean, limit?: number|string}} [wahl]
 *   roh: Rohliste mitliefern; alle: darin auch die Verworfenen
 */
export async function fruehUebersicht(knex, { roh: mitRohliste = false, alle = false, limit = 150 } = {}) {
    const einst = await leseEinstellungen()
    const schwelle = Number(einst.fruehKandidatAb) || KANDIDAT_AB
    const projektPflicht = einst.projektPruefung !== false
    const aktiv = await knex('hype_frueh').select('*').whereNot('status', 'verworfen')
    /*
     * Der letzte Durchgang ist der jüngste `letzterBlick` — aus der
     * Datenbank, nicht aus dem Prozess: NAS und Entwicklungsrechner
     * schreiben in dieselbe Tabelle.
     */
    const letzterLauf = aktiv.reduce((m, z) => Math.max(m, Number(z.letzterBlick) || 0), 0)

    const favoriten = await knex('hype_favoriten').select('*').whereNot('quelle', 'coinradar').catch(() => [])
    const favNach = new Map(favoriten.filter((f) => f.contractAddress)
        .map((f) => [vertragsSchluessel(f.chain, f.contractAddress), f]))
    const favVon = (z) => favNach.get(vertragsSchluessel(z.chain, z.contract)) || null

    const pruefe = (z, stand) => kandidatStatus({ ...z, stand }, { letzterLauf, schwelle, projektPflicht })
    const geparst = aktiv.map((z) => {
        const stand = sicherParse(z.stand, {})
        return { z, stand, k: pruefe(z, stand) }
    })
    const trichter = {}
    for (const g of geparst) {
        const grund = g.k.ja ? 'kandidat' : g.k.grund
        trichter[grund] = (trichter[grund] || 0) + 1
    }
    const kandidaten = geparst.filter((g) => g.k.ja).sort((a, b) => b.z.note - a.z.note)

    // Favoriten: ihre Zeile auch dann, wenn sie verworfen ist.
    const favVertraege = favoriten.filter((f) => f.contractAddress)
        .flatMap((f) => [String(f.contractAddress), String(f.contractAddress).toLowerCase()])
    const favZeilen = favVertraege.length
        ? (await knex('hype_frueh').select('*').whereIn('contract', [...new Set(favVertraege)]))
            .filter((z) => favVon(z))
        : []
    const zeileZuFav = new Map(favZeilen.map((z) => [vertragsSchluessel(z.chain, z.contract), z]))

    let roh = []
    if (mitRohliste) {
        let q = knex('hype_frueh').select('*')
        if (!alle) q = q.whereNot('status', 'verworfen')
        roh = await q.orderBy('note', 'desc').limit(Math.min(300, Number(limit) || 150))
    }

    const projekte = await gespeichertePruefungen([...kandidaten.map((g) => g.z), ...favZeilen, ...roh])
    const staende = await ladeStaende()
    const boersen = boersenFuer(await freigabeAn())
    const VOLLER_VERLAUF = ['ts', 'note', 'mcap', 'liq', 'halter', 'tx1h', 'kaeufer1h', 'verkaeufer1h']
    const ansicht = (z, stand = sicherParse(z.stand, {}), { voll = false } = {}) => ({
        ...z,
        stand,
        duenn: istDuenn(stand),
        kandidat: pruefe(z, stand),
        favoritId: favVon(z)?.id ?? null,
        quellen: sicherParse(z.quellen, []),
        links: sicherParse(z.links, {}),
        // Für die Liste nur die Notenreihe — die vollen Momentaufnahmen wären
        // bei 150 Zeilen ein paar hundert Kilobyte. Kandidaten bekommen mehr.
        verlauf: sicherParse(z.verlauf, []).map((v) => Object.fromEntries((voll ? VOLLER_VERLAUF : ['ts', 'note', 'mcap', 'halter'])
            .map((f) => [f, v[f] ?? null]))),
        befunde: sicherParse(z.befunde, []),
        projekt: kurzfassung(projekte.get(schluesselFuer(z)) || null),
        // Auf welchen Börsen der Token schon steht (über das Kürzel, ab Listungsgrösse).
        leiter: leiterFuer({ symbol: z.symbol, chain: z.chain, contract: z.contract,
            bewertungUsd: stand?.mcap }, staende, boersen),
    })

    const zeilen = roh.map((z) => ansicht(z))
    // Belastbare Noten zuerst; eine Note aus ein, zwei Teilnoten ist leicht extrem.
    zeilen.sort((a, b) => (Number(a.duenn) - Number(b.duenn)) || (b.note - a.note))

    return {
        stand: fruehStand(),
        letzterLauf,
        schwelle,
        beobachtet: aktiv.length,
        trichter,
        kandidaten: kandidaten.map((g) => ansicht(g.z, g.stand, { voll: true })),
        beobachtung: favoriten.map((f) => {
            const z = f.contractAddress ? zeileZuFav.get(vertragsSchluessel(f.chain, f.contractAddress)) : null
            return {
                favorit: { id: f.id, symbol: f.symbol, name: f.name, chain: f.chain, contractAddress: f.contractAddress,
                    stumm: Boolean(f.stumm), erstelltAm: f.erstelltAm, letzteDaten: sicherParse(f.letzteDaten, {}) },
                zeile: z ? ansicht(z, undefined, { voll: true }) : null,
            }
        }),
        zeilen,
    }
}
