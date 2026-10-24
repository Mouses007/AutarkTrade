/**
 * Welche Börsen haben einen API-Schlüssel? Eine Stelle für alles, was
 * regelmässig Börsen-Daten abfragt (globales Positions-Polling, Kontostand).
 *
 * Bis 20.10.2026 fiel das Polling ohne eingerichtete Börse auf Bitunix
 * zurück, und eine frische Installation erntete bei jedem Seitenaufruf und
 * alle 60 s HTTP 400 von `/api/bitunix/open-positions` und `/balance`
 * (Audit A4-06). Jetzt gilt: nur eingerichtete Börsen werden gefragt. Sagt
 * eine Lese-Route trotzdem `nichtEingerichtet` (Schlüssel inzwischen
 * gelöscht), wird das gemerkt und die Börse nicht mehr gefragt, bis die
 * Einstellungen einen Schlüssel speichern (`vergissBoersenZugang`).
 */
import axios from 'axios'
import { brokers } from '../stores/filters.js'
import { appEinstellungen } from '../stores/settings.js'

/** Futures für diese Börse abgeschaltet (Einstellung `portfolioBoersen`)? */
export function futuresAus(boerse, einstellungen = appEinstellungen.value) {
    try { return Number(JSON.parse(einstellungen?.portfolioBoersen || '{}')?.[boerse]?.futures ?? 1) === 0 } catch { return false }
}

const GUELTIG_MS = 5 * 60 * 1000
let stand = null          // { liste: string[], ts }
let abruf = null

/** Börsen mit hinterlegtem Schlüssel (kurz gemerkt, ein Abruf für alle Rufer). */
export async function eingerichteteBoersen() {
    if (stand && Date.now() - stand.ts < GUELTIG_MS) return stand.liste
    if (abruf) return abruf
    abruf = (async () => {
        const liste = []
        for (const b of brokers) {
            try {
                const { data } = await axios.get(`/api/${b.value}/config`)
                if (data && (data.apiKey || data.hasSecret) && !futuresAus(b.value)) liste.push(b.value)
            } catch { /* ohne Config-Endpunkt: nicht eingerichtet */ }
        }
        stand = { liste, ts: Date.now() }
        return liste
    })().finally(() => { abruf = null })
    return abruf
}

/** Ist diese Börse eingerichtet? Ohne bekannten Stand: erst nachfragen. */
export async function istEingerichtet(boerse) {
    return (await eingerichteteBoersen()).includes(boerse)
}

/** Antwort einer Lese-Route sagt „nicht eingerichtet" → Börse austragen. */
export function pruefeNichtEingerichtet(boerse, antwort) {
    if (!antwort?.nichtEingerichtet) return false
    if (stand) stand = { ...stand, liste: stand.liste.filter((b) => b !== boerse) }
    return true
}

/** Nach dem Speichern eines Schlüssels: neu nachfragen. */
export function vergissBoersenZugang() {
    stand = null
}
