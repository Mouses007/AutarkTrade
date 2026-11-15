/**
 * Anlageklasse eines Journal-Trades (`krypto` | `aktien`) — rein, für Browser
 * und Selbsttest dieselbe Regel.
 *
 * Ob `NVDAUSDT` eine Aktie ist, steht nicht im Symbol; das weiss nur der
 * Titel-Stamm (`server/aktien/journal-klasse.js` liefert je Börse die Symbole
 * der Aktien-Listungen). Zwei Quellen, ODER:
 *
 *   1. `trade.anlageklasse === 'aktien'` — beim Import festgehalten. Bleibt
 *      wahr, auch wenn die Börse den Kontrakt später streicht.
 *   2. Das Symbol steht HEUTE im Stamm als Aktien-Listung dieser Börse. So
 *      werden alte Trades ohne Angabe eingeordnet, ohne dass eine gespeicherte
 *      Tageszeile umgeschrieben wird — und ein beim Import als `krypto`
 *      vermerkter Trade wird Aktie, sobald der Stamm den Titel kennt.
 *
 * Alles andere ist Krypto, auch wenn der Stamm nicht zu erreichen ist.
 */
import { normSymbol } from './symbol.js'

export const ANLAGEKLASSEN = ['krypto', 'aktien']

/**
 * @param {Record<string, string[]>|null} symbole  `{ bitunix: ['NVDAUSDT', …], … }`; `null` = Stamm unbekannt
 * @returns {Map<string, Set<string>>|null}
 */
export function baueKlassenNachschlag(symbole) {
    if (!symbole || typeof symbole !== 'object') return null
    const n = new Map()
    for (const [boerse, liste] of Object.entries(symbole)) {
        if (!Array.isArray(liste)) continue
        n.set(boerse, new Set(liste.map(normSymbol).filter(Boolean)))
    }
    return n
}

/** Führt der Stamm dieses Symbol bei dieser Börse als Aktie? Ohne Stamm: nein. */
export function istAktienSymbol(nachschlag, boerse, symbol) {
    const satz = nachschlag?.get(String(boerse || ''))
    return !!satz && satz.has(normSymbol(symbol))
}

/** @returns {'krypto'|'aktien'} */
export function klasseVonTrade(trade, nachschlag) {
    if (trade?.anlageklasse === 'aktien') return 'aktien'
    return istAktienSymbol(nachschlag, trade?.broker, trade?.symbol) ? 'aktien' : 'krypto'
}
