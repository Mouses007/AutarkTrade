/**
 * Coin-Ansicht, der Teil ohne Netz und ohne Datenbank.
 *
 * Die Coin-Ansicht (`src/components/coinradar/CoinAnsicht.vue`) ist der
 * Steckbrief eines einzelnen Coins im Coin-Radar: Kurs, Verlauf, Derivate,
 * Messung, Projekt. Hier steht, was davon der Server rechnet und sich ohne
 * Abruf prüfen lässt (`__selftest-ansicht.mjs`):
 *
 *   spanne24h      Hoch, Tief und Veränderung der letzten 24 Stunden aus den
 *                  Kerzen, die die Einzelprüfung ohnehin holt
 *   tageKompakt    Tageskerzen in die schmale Form für den Browser
 *   rangVerlauf    wo der Coin in den letzten Läufen des Coin-Radars stand
 *
 * Grundsatz wie überall im Coin-Radar: Unbekanntes ist `null` und wird nie
 * zu 0 — eine Spanne von 0 hiesse „der Kurs hat sich nicht bewegt".
 */

const TAG_MS = 86_400_000

/** Wie weit der Tagesverlauf zurückreicht (deckt den Umschalter «2 J» der Ansicht). */
export const VERLAUF_TAGE = 800

/** Wie viele Läufe des Coin-Radars die Ansicht zurückblickt. */
export const RANG_LAEUFE = 24

const endlich = (w) => w !== null && w !== undefined && w !== '' && Number.isFinite(Number(w))

/**
 * Hoch, Tief und Veränderung der letzten 24 Stunden.
 *
 * Genommen wird die FEINSTE Zeiteinheit, deren Kerzen die 24 Stunden ganz
 * abdecken — 200 Kerzen auf 5m sind keine 17 Stunden, auf 15m gut zwei Tage.
 * Der laufende Kurs zählt mit: die Kerzen sind geschlossene, ein Ausbruch der
 * letzten Minuten stünde sonst nicht in der Spanne.
 *
 * Die Veränderung nimmt den Wert des Tickers, wenn er da ist (Binance, Bitget);
 * sonst Kurs gegen die Eröffnung der ersten Kerze im Fenster.
 *
 * @param {Record<string, Array<{t,o,h,l,c}>>} kerzenJeZe  geschlossene Kerzen, aufsteigend
 * @param {Record<string, number>} zeMs                    Länge je Zeiteinheit in ms
 * @param {number|null} preis                              laufender Kurs
 * @param {number} jetzt
 * @param {number|null} [tickerAenderungPct]
 * @returns {{hoch:number, tief:number, aenderungPct:number|null, zeiteinheit:string}|null}
 */
export function spanne24h(kerzenJeZe, zeMs, preis, jetzt, tickerAenderungPct = null) {
    const ab = jetzt - TAG_MS
    const kandidaten = Object.entries(kerzenJeZe || {})
        .map(([ze, kerzen]) => ({ ze, ms: Number(zeMs?.[ze]) || 0, kerzen: Array.isArray(kerzen) ? kerzen : [] }))
        // Deckt die Reihe das Fenster? Die erste Kerze muss am oder vor dem Fensterbeginn öffnen.
        .filter((k) => k.ms > 0 && k.ms <= TAG_MS / 4 && k.kerzen.length && k.kerzen[0].t <= ab)
        .sort((a, b) => a.ms - b.ms)
    const wahl = kandidaten[0]
    if (!wahl) return null

    // Kerzen, die ins Fenster hineinragen (die erste beginnt bis zu einer Länge davor).
    const fenster = wahl.kerzen.filter((k) => k.t + wahl.ms > ab && endlich(k.h) && endlich(k.l) && k.l > 0)
    if (!fenster.length) return null
    // Eine Lücke am Ende (Börse lieferte alte Kerzen) wäre keine 24-h-Spanne mehr.
    if (jetzt - (fenster[fenster.length - 1].t + wahl.ms) > 2 * wahl.ms + 5 * 60_000) return null

    let hoch = Math.max(...fenster.map((k) => Number(k.h)))
    let tief = Math.min(...fenster.map((k) => Number(k.l)))
    const p = endlich(preis) && Number(preis) > 0 ? Number(preis) : null
    if (p !== null) { hoch = Math.max(hoch, p); tief = Math.min(tief, p) }

    let aenderungPct = endlich(tickerAenderungPct) ? Number(tickerAenderungPct) : null
    if (aenderungPct === null && p !== null) {
        const start = Number(fenster[0].o)
        if (start > 0) aenderungPct = (p / start - 1) * 100
    }
    return { hoch, tief, aenderungPct, zeiteinheit: wahl.ze }
}

/**
 * Tageskerzen → `[[t, hoch, tief, schluss], …]`, aufsteigend, ohne Doppelte.
 * Volumen und Eröffnung braucht die Ansicht nicht; 800 Zeilen bleiben so bei
 * rund 30 kB.
 */
export function tageKompakt(kerzen) {
    const aus = []
    let zuletzt = -Infinity
    for (const k of [...(kerzen || [])].sort((a, b) => a.t - b.t)) {
        const t = Number(k?.t)
        const c = Number(k?.c)
        if (!Number.isFinite(t) || !(c > 0) || t <= zuletzt) continue
        const h = Number(k.h) >= c ? Number(k.h) : c
        const l = Number(k.l) > 0 && Number(k.l) <= c ? Number(k.l) : c
        aus.push([t, h, l, c])
        zuletzt = t
    }
    return aus
}

/**
 * Reicht die Reihe über das ganze verlangte Fenster? Wenn nicht, ist ihr
 * Anfang der erste Handelstag AN DIESER BÖRSE — eine Angabe zum Alter, die es
 * auch ohne CoinGecko gibt. Drei Tage Spiel, weil die laufende Tageskerze fehlt.
 */
export function ersterHandelstag(reihe, jetzt, tage = VERLAUF_TAGE) {
    if (!reihe?.length) return null
    const beginn = jetzt - tage * TAG_MS
    return reihe[0][0] > beginn + 3 * TAG_MS ? reihe[0][0] : null
}

/**
 * Wo der Coin in den letzten Läufen des Coin-Radars stand.
 *
 * @param {Array<{id:number, zeit:number, gesamt?:number}>} laeufe  fertige Läufe, Reihenfolge egal
 * @param {Array<{laufId:number, rang:number, note:number, status:string, huerdeGrund?:string}>} zeilen
 *        die Zeilen DIESES Symbols in diesen Läufen
 * @returns {{laeufe:number, bewertet:number, top10:number, punkte:Array, letzter:object|null}}
 *          `punkte` chronologisch; ein Lauf ohne Zeile ist `status: 'fehlt'`
 */
export function rangVerlauf(laeufe = [], zeilen = []) {
    const jeLauf = new Map(zeilen.map((z) => [Number(z.laufId), z]))
    const punkte = [...laeufe]
        .sort((a, b) => (Number(a.zeit) || 0) - (Number(b.zeit) || 0) || a.id - b.id)
        .map((l) => {
            const z = jeLauf.get(Number(l.id))
            const bewertet = z?.status === 'bewertet' && Number(z.rang) > 0
            return {
                laufId: l.id,
                zeit: Number(l.zeit) || null,
                status: !z ? 'fehlt' : bewertet ? 'bewertet' : 'huerde',
                // Eine Hürden-Zeile trägt weder Rang noch Note — nur was gemessen ist.
                rang: bewertet ? Number(z.rang) : null,
                note: bewertet && endlich(z.note) ? Number(z.note) : null,
                huerdeGrund: z && !bewertet ? (z.huerdeGrund || 'unbekannt') : null,
                gesamt: Number(l.gesamt) > 0 ? Number(l.gesamt) : null,
            }
        })
    const bewertete = punkte.filter((p) => p.status === 'bewertet')
    return {
        laeufe: punkte.length,
        bewertet: bewertete.length,
        top10: bewertete.filter((p) => p.rang <= 10).length,
        punkte,
        letzter: punkte.length ? punkte[punkte.length - 1] : null,
    }
}

/**
 * Eigene Trades in diesem Coin, verdichtet (Eingabe: `tradesAusZeilen` aus
 * `server/chart-journal.js`). Offene Trades zählen, tragen aber kein Ergebnis.
 */
export function eigeneTrades(trades = []) {
    if (!trades.length) return { anzahl: 0, geschlossen: 0, netto: null, letzter: null }
    const geschlossen = trades.filter((t) => t.ausstieg)
    const mitNetto = geschlossen.filter((t) => endlich(t.netto))
    return {
        anzahl: trades.length,
        geschlossen: geschlossen.length,
        netto: mitNetto.length ? mitNetto.reduce((s, t) => s + Number(t.netto), 0) : null,
        letzter: Math.max(...trades.map((t) => Number(t.einstieg?.t) || 0)) || null,
    }
}
