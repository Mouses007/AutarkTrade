/** Aktiver Markt (Krypto | Aktien) als Vue-Zustand; Regeln in `config/markt.js`. */
import { computed } from 'vue'
import { appEinstellungen } from './settings.js'
import { dbUpdateSettings, dbGetSettings } from '../utils/db.js'
import { istAktienAn, marktAus, MAERKTE } from '../config/markt.js'

export const aktienAn = computed(() => istAktienAn(appEinstellungen.value))
export const aktiverMarkt = computed(() => marktAus(appEinstellungen.value))

/** Markt speichern. Der Aufrufer lädt danach neu, damit Abrufe und Timer des alten Markts enden. */
export async function speichereMarkt(markt) {
    if (!MAERKTE.includes(markt)) return
    await dbUpdateSettings({ aktiverMarkt: markt })
    if (appEinstellungen.value) appEinstellungen.value.aktiverMarkt = markt
}

/**
 * Der Markt, auch wenn die Einstellungen beim Seitenstart noch nicht geladen
 * sind (der Chart lädt seine Layouts sofort — ungeladen gälte sonst Krypto).
 */
export async function ermittleMarkt() {
    const da = appEinstellungen.value
    if (da && Object.keys(da).length) return marktAus(da)
    try { return marktAus(await dbGetSettings()) } catch { return 'krypto' }
}

/**
 * Der Markt als Filter für Listen: `krypto` | `aktien` — oder `''`, solange
 * der Aktien-Teil aus ist. Dann wird nichts getrennt, und was im Aktien-Markt
 * angelegt wurde, verschwindet nicht hinter einem Filter, den niemand sieht.
 */
export async function ermittleMarktFilter() {
    let e = appEinstellungen.value
    if (!e || !Object.keys(e).length) {
        try { e = await dbGetSettings() } catch { return '' }
    }
    return istAktienAn(e) ? marktAus(e) : ''
}
