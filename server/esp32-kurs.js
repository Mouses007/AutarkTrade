/**
 * Kursverlauf für die Anzeigen (ESP32-Displays) — reiner Teil.
 *
 * Die Boards zeichnen einen kleinen Chart (Symbol und Zeitraum im Setup-Portal).
 * Sie fragen den Server statt der Börse: die Marktdatenquelle der App gilt auch
 * hier, und das Board braucht kein TLS zu einer Börse. `n` verdichtet auf so
 * viele Kerzen, wie das Display Pixel hat — 180 Kerzen auf 240 px wären Brei.
 */

/** Zeitraum → Kerzenlänge und Anzahl (gleich wie im Desklet). */
export const KURS_SPANNEN = {
    '1h':  { interval: '1m',  limit: 60 },
    '24h': { interval: '15m', limit: 96 },
    '7d':  { interval: '1h',  limit: 168 },
    '30d': { interval: '4h',  limit: 180 },
}

export const KURS_N_MIN = 10
export const KURS_N_MAX = 200

/** „btc" → „BTCUSDT"; null, wenn nach dem Säubern nichts Sinnvolles bleibt. */
export function kursSymbol(roh) {
    const s = String(roh || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    if (s.length < 2) return null
    return /(USDT|USDC)$/.test(s) ? s : s + 'USDT'
}

export function kursSpanne(roh) {
    return Object.hasOwn(KURS_SPANNEN, roh) ? roh : '24h'
}

/** Gewünschte Kerzenzahl in Grenzen; ohne Angabe die volle Anzahl. */
export function kursN(roh, limit) {
    const n = parseInt(roh, 10)
    if (!Number.isFinite(n)) return limit
    return Math.max(KURS_N_MIN, Math.min(KURS_N_MAX, limit, n))
}

/**
 * Kerzen [{o,h,l,c}] auf höchstens `n` zusammenfassen: aufeinanderfolgende
 * Kerzen zu einer (erstes o, max h, min l, letztes c). Die Fächer werden
 * gleichmässig verteilt, die neueste Kerze bleibt immer die letzte.
 */
export function verdichte(kerzen, n) {
    if (kerzen.length <= n) return kerzen.map(({ o, h, l, c }) => ({ o, h, l, c }))
    const aus = []
    for (let i = 0; i < n; i++) {
        const von = Math.floor(i * kerzen.length / n)
        const bis = Math.floor((i + 1) * kerzen.length / n)
        const teil = kerzen.slice(von, bis)
        aus.push({
            o: teil[0].o,
            h: Math.max(...teil.map(k => k.h)),
            l: Math.min(...teil.map(k => k.l)),
            c: teil[teil.length - 1].c,
        })
    }
    return aus
}

/** Antwort für das Board: kompakte Kerzen [o,h,l,c] plus Kopfwerte. */
export function kursAntwort(symbol, spanne, kerzen, n) {
    const k = verdichte(kerzen, n)
    if (k.length < 2) return null
    const start = k[0].o
    const jetzt = k[k.length - 1].c
    return {
        symbol,
        spanne,
        jetzt,
        start,
        hoch: Math.max(...k.map(x => x.h)),
        tief: Math.min(...k.map(x => x.l)),
        aenderung: start > 0 ? Math.round((jetzt - start) / start * 10000) / 100 : 0,
        kerzen: k.map(x => [x.o, x.h, x.l, x.c]),
    }
}
