/**
 * Spot-Portfolio: Coins als Totalverlust markieren (tote Projekte, Spam).
 *
 * Eine Markierung setzt den Wert nur dort auf 0, wo es KEINEN Kurs gibt — ein
 * echter Kurs (Börse, Bitpanda, ESTV, von Hand) gewinnt immer. So kann eine
 * Markierung kein Vermögen verstecken, das es noch gibt, und ein Projekt, das
 * wieder gehandelt wird, bekommt seinen Wert von selbst zurück.
 *
 * Gespeichert in `settings.portfolioTotalverlust`: { ASSET: { am: ms } }.
 */
import { getKnex } from '../database.js'

export const TOTALVERLUST = 'Totalverlust (markiert)'

async function lese() {
    try {
        const s = await getKnex()('settings').first('portfolioTotalverlust')
        const d = JSON.parse(s?.portfolioTotalverlust || '{}')
        return d && typeof d === 'object' ? d : {}
    } catch { return {} }
}

/** @returns {Promise<Set<string>>} markierte Assets (gross geschrieben) */
export async function totalverluste() {
    return new Set(Object.keys(await lese()))
}

export async function setzeTotalverlust(asset, an) {
    const a = String(asset || '').trim().toUpperCase()
    if (!a) throw new Error('Asset fehlt')
    const d = await lese()
    if (an) d[a] = { am: Date.now() }
    else delete d[a]
    const k = getKnex()
    const s = await k('settings').first('id')
    await k('settings').where({ id: s.id }).update({ portfolioTotalverlust: JSON.stringify(d) })
}
