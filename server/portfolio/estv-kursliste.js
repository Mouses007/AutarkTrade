/**
 * Spot-Portfolio: ESTV-Kursliste für Kryptowährungen (ICTax) holen und
 * als Steuerkurse speichern.
 *
 * Der Weg (gemessen 26.10.2026): `publicationCategories/{Jahr}.json` nennt je
 * Steuerjahr einen Eintrag `publicationType: "TOKENS"` mit Datei-ID und Hash,
 * der Download liegt unter `/extern/api/download/{id}/{hash}/{Dateiname}`.
 * Seit dem Steuerjahr 2023 (85 Coins), 2024: 84, 2025: 81 — je Zeile Ticker,
 * Name, Einheit, Valorennummer, CHF. Erscheint jeweils am 1. Januar.
 *
 * Der ESTV-Kurs geht jedem Börsenkurs vor (ESTV-Arbeitspapier, alle Kantone).
 * Ein Kurs „von Hand“ wird nie überschrieben.
 */
import { getKnex } from '../database.js'
import { pdfZeilen } from './pdf-text.js'

const ICTAX = 'https://www.ictax.admin.ch/extern/api'

/** ESTV-Kürzel, die bei uns (Börsen, Wallets) anders heissen. */
export const ESTV_AUCH = { IOT: ['IOTA', 'MIOTA'], BTT: ['BTTC'] }

/**
 * Zeilen der Kursliste → Einträge (rein).
 * @param {string[]} zeilen  aus `pdfZeilen`, Zellen mit \t getrennt
 * @returns {{ datum: string|null, eintraege: { ticker, name, valor, chf }[] }}
 */
export function leseKursliste(zeilen) {
    let datum = null
    const eintraege = []
    for (const z of zeilen) {
        if (!datum && /^\d{2}\.\d{2}\.\d{4}$/.test(z.trim())) datum = z.trim()
        const c = z.split('\t').map((x) => x.trim())
        // „Virtuelle Währungen | BTC | Bitcoin | 1 | 39 714 275 | 69571.988489“
        if (c.length < 5 || !/^virtuelle/i.test(c[0])) continue
        const chf = Number(c[c.length - 1].replace(/['\s]/g, ''))
        const valor = c[c.length - 2].replace(/\s/g, '')
        const ticker = c[1].toUpperCase()
        if (!/^\d{5,12}$/.test(valor) || !(chf > 0) || !/^[A-Z0-9]{1,12}$/.test(ticker)) continue
        eintraege.push({ ticker, name: c.slice(2, -3).join(' ') || null, valor, chf })
    }
    return { datum, eintraege }
}

/** Plausibel? Sonst lieber nichts speichern als falsche Kurse. */
export function pruefeKursliste(liste, jahr) {
    const fehler = []
    if (liste.datum && liste.datum !== `31.12.${jahr}`) fehler.push(`Stichtag ${liste.datum} statt 31.12.${jahr}`)
    if (liste.eintraege.length < 20) fehler.push(`nur ${liste.eintraege.length} Coins erkannt`)
    if (!liste.eintraege.some((e) => e.ticker === 'BTC')) fehler.push('BTC fehlt')
    if (new Set(liste.eintraege.map((e) => e.ticker)).size !== liste.eintraege.length) fehler.push('Kürzel doppelt')
    return fehler
}

async function holeJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) throw new Error(`ICTax HTTP ${r.status}`)
    return r.json()
}

/** Datei-Eintrag der Krypto-Kursliste eines Jahres, oder null (noch nicht erschienen). */
async function dateiFuer(jahr) {
    const d = await holeJson(`${ICTAX}/publication/publicationCategories/${jahr}.json`)
    const funde = []
    const lauf = (o) => {
        if (Array.isArray(o)) return o.forEach(lauf)
        if (!o || typeof o !== 'object') return
        if (o.publicationType === 'TOKENS' && o.publicationFile && !o.publicationFile.deleted) funde.push(o.publicationFile)
        Object.values(o).forEach(lauf)
    }
    lauf(d)
    // Mehrere Fassungen (…_V1, …_V2): die höchste ID ist die neueste.
    return funde.sort((a, b) => b.id - a.id)[0] || null
}

/** Holt und liest die Liste eines Jahres (ohne zu speichern). */
export async function holeKursliste(jahr) {
    const datei = await dateiFuer(jahr)
    if (!datei) return { erschienen: false }
    const url = `${ICTAX}/download/${datei.id}/${datei.fileHash}/${encodeURIComponent(datei.fileName)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`ICTax-Download HTTP ${r.status}`)
    const liste = leseKursliste(pdfZeilen(Buffer.from(await r.arrayBuffer())))
    const fehler = pruefeKursliste(liste, jahr)
    if (fehler.length) throw new Error(`Kursliste ${datei.fileName} nicht lesbar: ${fehler.join(', ')}`)
    return { erschienen: true, datei: datei.fileName, url, ...liste }
}

/**
 * Holt die Liste und speichert sie als Steuerkurse (`quelle: 'estv'`, mit Valor).
 * @returns {{ erschienen, datei?, anzahl?, uebersprungen? }}
 */
export async function importiereKursliste(jahr) {
    const l = await holeKursliste(jahr)
    if (!l.erschienen) return l
    const k = getKnex()
    const hand = new Set((await k('portfolio_steuerkurse').where({ jahr }).whereNot('quelle', 'estv').select('asset')).map((z) => z.asset))
    const jetzt = Date.now()
    const zeilen = []
    for (const e of l.eintraege) {
        for (const asset of [e.ticker, ...(ESTV_AUCH[e.ticker] || [])]) {
            if (!hand.has(asset)) zeilen.push({ jahr, asset, chf: e.chf, quelle: 'estv', valor: e.valor, updatedAt: jetzt })
        }
    }
    await k.transaction(async (trx) => {
        await trx('portfolio_steuerkurse').where({ jahr, quelle: 'estv' }).del()
        for (let i = 0; i < zeilen.length; i += 200) await trx('portfolio_steuerkurse').insert(zeilen.slice(i, i + 200))
    })
    return { erschienen: true, datei: l.datei, anzahl: l.eintraege.length, uebersprungen: hand.size }
}

/** Stand je Jahr: wie viele ESTV-Kurse, wann geholt. */
export async function kurslisteStand(jahr) {
    const r = await getKnex()('portfolio_steuerkurse').where({ jahr, quelle: 'estv' }).countDistinct('valor as n').max('updatedAt as am').first()
    return { anzahl: Number(r?.n) || 0, am: r?.am ? Number(r.am) : null }
}
