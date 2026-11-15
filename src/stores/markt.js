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
