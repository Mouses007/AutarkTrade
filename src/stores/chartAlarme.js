/**
 * Chart-Alarme im Browser: Liste, Anlegen/Ändern/Löschen und ein Blick alle
 * zehn Sekunden, ob einer ausgelöst hat.
 *
 * Geprüft wird auf dem SERVER (`server/chart-alarme.js`) — auch bei
 * geschlossener Seite, Meldung per Push/Mail. Hier geht es nur darum, eine
 * Auslösung auch auf der offenen Seite zu zeigen: als Banner, und als
 * Browser-Meldung, wenn der Tab im Hintergrund liegt.
 */
import { ref } from 'vue'
import axios from 'axios'
import { sendNotification } from '../utils/notify.js'

export const alarme = ref([])
// Bis zu 50 Hinweise gemerkt; die Leiste zeigt fünf, der Rest ist darunter scrollbar.
const MAX_HINWEISE = 50
export const neueAusloesungen = ref([])     // [{ id, symbol, titel, text, t, ziel: { symbol, markt, tf } }]

let uhr = null
let nutzer = 0
let gesehenBis = Date.now()

export async function ladeAlarme() {
    try {
        const { data } = await axios.get('/api/chart/alarme')
        const neu = data.filter((a) => a.ausgeloestAm > gesehenBis)
        if (neu.length) {
            gesehenBis = Math.max(...neu.map((a) => a.ausgeloestAm))
            for (const a of neu) {
                const letzte = a.verlauf[a.verlauf.length - 1]
                const mehrfach = MEHRFACH.includes(a.art)
                const symbol = a.symbol || letzte?.treffer?.[0]?.symbol || (a.art === 'lsob' ? 'LSOB' : 'Momentum')
                const kurz = mehrfach && letzte?.treffer?.length
                    ? letzte.treffer.map(trefferText).join(' · ')
                    : `${a.symbol}: ${beschreibe(a)}${letzte ? ` — ${letzte.p}` : ''}`
                // Leiste und Desktop-Meldung sagen dasselbe wie Push und Handy (Text vom Server, seit 22.10.2026
                // im Verlauf); ältere Einträge ohne Text: die Kurzform.
                const text = letzte?.text ? letzte.text.split('\n').filter(Boolean).join(' · ') : kurz
                // Wohin ein Klick auf den Hinweis führt: Momentum/LSOB → der (erste) Treffer mit
                // seiner Zeiteinheit; Preis/Linie/Zone → das Symbol des Alarms (Zeiteinheit bleibt).
                const tr = mehrfach ? letzte?.treffer?.[0] : null
                const ziel = tr ? { symbol: tr.symbol, markt: tr.markt || 'futures', tf: tr.tf || null }
                    : a.symbol ? { symbol: a.symbol, markt: a.markt || 'futures', tf: null } : null
                const titel = letzte?.titel || `Alarm ${symbol}`
                neueAusloesungen.value = [...neueAusloesungen.value, { id: a.id, symbol, titel, text, t: a.ausgeloestAm, ziel }].slice(-MAX_HINWEISE)
                sendNotification('chartAlarm', titel, letzte?.text || kurz, { tag: `chartAlarm-${a.id}-${a.ausgeloestAm}` })
            }
        }
        alarme.value = data
    } catch { /* nächster Versuch in zehn Sekunden */ }
}

const MEHRFACH = ['momentum', 'lsob']
const LSOB_WAS = { retest: 'Retest', box: 'neue Box' }

/**
 * Ein Treffer eines Momentum-Alarms: „BTCUSDT 15m ● Long" (● gross, • klein);
 * eines LSOB-Alarms: „BTCUSDT 1h LSOB Retest Long".
 */
export function trefferText(tr) {
    if (Array.isArray(tr.ereignisse)) {
        const was = tr.ereignisse.map((e) => `${LSOB_WAS[e.typ] || e.typ} ${e.seite === 'long' ? 'Long' : 'Short'}`).join(', ')
        return `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf} LSOB ${was}`
    }
    return `${tr.symbol}${tr.markt === 'spot' ? ' Spot' : ''} ${tr.tf} ${tr.stark ? '●' : '•'} ${tr.seite === 'long' ? 'Long' : 'Short'}${tr.divergenz ? ' Div' : ''}`
}

/** Kurzbeschreibung für Liste, Banner und Preislinie. */
export function beschreibe(a) {
    const b = a.bedingung || {}
    if (a.art === 'momentum') {
        const groesse = a.punktgroesse === 'alle' ? '●• grosse + kleine' : '● grosse'
        const r = b.richtung === 'long' ? ' Long' : b.richtung === 'short' ? ' Short' : ''
        return `Momentum ${groesse}${b.divergenz ? ' mit Divergenz' : ''}${r} · ${(a.zeiteinheiten || []).join(', ')}`
    }
    if (a.art === 'lsob') {
        const was = { retest: 'Retest', box: 'neue Box', beide: 'Retest + neue Box' }[b.ereignis] || 'Retest'
        const r = b.richtung === 'long' ? ' Long' : b.richtung === 'short' ? ' Short' : ''
        return `LSOB ${was}${r} · ${(a.zeiteinheiten || []).join(', ')}`
    }
    const r = { ueber: '↑ über', unter: '↓ unter', kreuzt: '↕ kreuzt', betreten: '→ Zone betreten', verlassen: '← Zone verlassen' }[b.richtung || (a.art === 'zone' ? 'betreten' : 'kreuzt')]
    if (a.art === 'preis') return `${r} ${b.preis}`
    const profil = { poc: 'POC', vah: 'VAH', val: 'VAL' }[b.kante]
    if (a.art === 'linie' && profil) return `${r} ${profil}${Number(b.niveau) > 0 ? ` ${Number(Number(b.niveau).toPrecision(7))}` : ''}`
    if (a.art === 'linie') return `${r} Linie${b.kante && b.kante !== 'oben' ? ` (${b.kante})` : ''}`
    return r
}

/** Polling starten — mehrere Nutzer (Seite, Reiter) teilen einen Takt. */
export function abonniereAlarme() {
    nutzer++
    if (!uhr) {
        ladeAlarme()
        uhr = setInterval(ladeAlarme, 10_000)
    }
    return () => {
        nutzer--
        if (nutzer <= 0) { clearInterval(uhr); uhr = null; nutzer = 0 }
    }
}

export async function legeAlarmAn(daten) {
    const { data } = await axios.post('/api/chart/alarme', daten)
    alarme.value = [data, ...alarme.value]
    return data
}

export async function aendereAlarm(id, patch) {
    const { data } = await axios.put(`/api/chart/alarme/${id}`, patch)
    alarme.value = alarme.value.map((a) => (a.id === id ? data : a))
    return data
}

export async function loescheAlarm(id) {
    await axios.delete(`/api/chart/alarme/${id}`)
    alarme.value = alarme.value.filter((a) => a.id !== id)
}

/** Einen Hinweis schliessen — mit `t` genau diesen (ein wiederholender Alarm kann mehrere haben), ohne alle des Alarms. */
export function quittiere(id, t = null) {
    neueAusloesungen.value = neueAusloesungen.value.filter((x) => !(x.id === id && (t == null || x.t === t)))
}

export function alleQuittieren() {
    neueAusloesungen.value = []
}
