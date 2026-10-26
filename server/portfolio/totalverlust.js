/**
 * Spot-Portfolio: Coins als Totalverlust markieren (tote Projekte, Konkurs).
 *
 * Ein markierter Coin verschwindet aus dem Portfolio und — ab dem gewählten
 * Steuerjahr — aus dem Vermögen des Steuerberichts. Frühere Jahre bleiben, wie
 * sie waren: ein Coin, der 2024 noch Wert hatte, gehört ins Verzeichnis 2024,
 * auch wenn er 2025 tot ist. Käufe, Verkäufe und Erträge bleiben Geschichte und
 * stehen weiter in Veräusserungen und Einkommen. Der Verlust selbst ist im
 * Privatvermögen nicht abziehbar; die Seite „Totalverluste“ zeigt ihn nur.
 *
 * Bis 26.10.2026 setzte die Markierung nur den Wert auf 0, wo kein Kurs vorlag;
 * der Coin blieb sichtbar. Der Nutzer wollte ihn weg.
 *
 * Gespeichert in `settings.portfolioTotalverlust`: { ASSET: { am: ms, abJahr } }.
 */
import { getKnex } from '../database.js'

async function lese() {
    try {
        const s = await getKnex()('settings').first('portfolioTotalverlust')
        const d = JSON.parse(s?.portfolioTotalverlust || '{}')
        return d && typeof d === 'object' ? d : {}
    } catch { return {} }
}

/** Ohne `abJahr` (Markierung vor dem 26.10.2026): das Jahr vor der Markierung. */
export function abJahrVon(eintrag) {
    const j = Number(eintrag?.abJahr)
    if (Number.isInteger(j) && j > 2000) return j
    return new Date(Number(eintrag?.am) || Date.now()).getUTCFullYear() - 1
}

/** @returns {Promise<Map<string, { am:number, abJahr:number }>>} markierte Assets (gross geschrieben) */
export async function totalverluste() {
    const d = await lese()
    return new Map(Object.entries(d).map(([a, e]) => [a, { am: Number(e?.am) || null, abJahr: abJahrVon(e) }]))
}

/**
 * @param {string} asset
 * @param {boolean} an
 * @param {number} [abJahr]  erstes Steuerjahr ohne den Coin (Vorgabe: Vorjahr)
 */
export async function setzeTotalverlust(asset, an, abJahr) {
    const a = String(asset || '').trim().toUpperCase()
    if (!a) throw new Error('Asset fehlt')
    const d = await lese()
    if (an) {
        const j = Number(abJahr)
        d[a] = { am: Date.now(), abJahr: Number.isInteger(j) && j > 2000 && j <= new Date().getFullYear() ? j : new Date().getFullYear() - 1 }
    } else delete d[a]
    const k = getKnex()
    const s = await k('settings').first('id')
    await k('settings').where({ id: s.id }).update({ portfolioTotalverlust: JSON.stringify(d) })
}
