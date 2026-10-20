/**
 * Meldungs-Register, Kanalwahl, Browser-Hauptschalter und Mail-Zugang —
 * Modul-Singleton.
 *
 * Geteilt zwischen dem Bereich Benachrichtigungen und KI → Nachrichten (der
 * Lagebericht zeigt Browser-Kanal und Mail-Zugang an). Einstellungen.vue lädt alles
 * beim Öffnen der Seite (`ladeBrowserNotifications`, `ladeBenachrichtigungen`).
 */
import { ref } from 'vue'
import axios from 'axios'
import { dbUpdateSettings } from '@/utils/db.js'
import { appEinstellungen } from '@/stores/settings.js'
import { requestNotificationPermission } from '@/utils/notify'

export let browserNotifications = ref(true)

/** Hauptschalter aus den gerade geladenen Einstellungen übernehmen. */
export function ladeBrowserNotifications() {
    const settings = appEinstellungen.value || {}
    browserNotifications.value = settings.browserNotifications !== 0
}

/* BROWSER NOTIFICATIONS */
export async function saveNotificationSetting() {
    try {
        if (browserNotifications.value) {
            const granted = await requestNotificationPermission()
            if (!granted) {
                browserNotifications.value = false
                return
            }
        }
        await dbUpdateSettings({ browserNotifications: browserNotifications.value ? 1 : 0 })
        appEinstellungen.value.browserNotifications = browserNotifications.value ? 1 : 0
        console.log(' -> Benachrichtigungs-Einstellung gespeichert:', browserNotifications.value)
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Benachrichtigungs-Einstellung:', error)
    }
}

/* ================= BENACHRICHTIGUNGEN ================= */
/*
 * Das Register kommt vom Server (`/api/benachrichtigungen/typen`) — genau wie
 * die Modell-Liste. So muss ein neuer Meldungstyp nur dort eingetragen werden
 * und taucht hier automatisch auf, statt in zwei Listen gepflegt zu werden,
 * die zuverlässig auseinanderlaufen.
 */
export const meldeTypen = ref([])
export const kanalWahl = ref({})

export function kanalAn(id, kanal) {
    const e = kanalWahl.value[id] || {}
    // Ohne gespeicherte Wahl: Browser an, E-Mail aus — E-Mail ist immer eine
    // bewusste Entscheidung, sonst verschickt ein Update ungefragt Post.
    return e[kanal] !== undefined ? Boolean(e[kanal]) : kanal === 'browser'
}

export async function setzeKanal(id, kanal, wert) {
    // Beim Einschalten des Browser-Kanals gleich die Erlaubnis holen —
    // sonst hakt man etwas an, das der Browser stumm verwirft.
    if (kanal === 'browser' && wert) await requestNotificationPermission()
    kanalWahl.value = {
        ...kanalWahl.value,
        [id]: { ...(kanalWahl.value[id] || {}), [kanal]: Boolean(wert) },
    }
    try {
        await dbUpdateSettings({ benachrichtigungen: kanalWahl.value })
        if (appEinstellungen.value) appEinstellungen.value.benachrichtigungen = kanalWahl.value
    } catch (e) {
        console.error(' -> Kanalwahl nicht gespeichert:', e)
    }
}

// ── E-Mail-Zugang ────────────────────────────────────────────────────────
export const mail = ref({
    mailAktiv: 0, mailHost: '', mailPort: 587, mailSicherheit: 'starttls',
    mailUser: '', mailVon: '', mailAn: '', mailPasswort: '', mailPasswortSet: false,
    mailSchriftGroesse: 'gross',
})

/*
 * Mail-Zugang laden — dieselbe Abfrage wie `ladeMailKonfig` in
 * SchrittMailKonfiguration.vue. Hier eigens, weil der Lagebericht unter
 * KI → Nachrichten `mail.mailAktiv`/`mailAn` liest, auch wenn der Bereich
 * Benachrichtigungen (und mit ihm die Mail-Komponente) nie geöffnet wurde.
 * Früher stellte das die immer gemountete Komponente (v-show) sicher.
 */
export async function ladeMail() {
    try {
        const { data } = await axios.get('/api/mail/settings')
        mail.value = { ...data, mailPasswort: data.mailPasswortSet ? '••••••••' : '' }
    } catch (e) {
        console.error(' -> Mail-Einstellungen nicht ladbar:', e)
    }
}

export async function ladeBenachrichtigungen() {
    try {
        const { data } = await axios.get('/api/benachrichtigungen/typen')
        meldeTypen.value = data.typen || []
    } catch (e) {
        console.error(' -> Meldungs-Register nicht ladbar:', e)
    }
    const roh = appEinstellungen.value?.benachrichtigungen
    kanalWahl.value = roh && typeof roh === 'object' && !Array.isArray(roh) ? { ...roh } : {}
    await ladeMail()
}
