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

/* ── Coin ohne Future (CoinGecko statt Börse) ───────────────────────────── */

/** Wie weit der CoinGecko-Verlauf zurückreicht (öffentlicher Endpunkt: höchstens 365 Tage). */
export const CG_VERLAUF_TAGE = 365

/**
 * CoinGecko `market_chart` (`prices: [[ms, kurs], …]`, `interval=daily`) →
 * Tagesreihe im Format von `tageKompakt` (`[t, hoch, tief, schluss]`).
 *
 * CoinGecko liefert je Tag EINEN Kurs, Stand 00:00 UTC — das ist der Schluss
 * des Vortags. Der Punkt wird deshalb dem Vortag zugeschrieben (`t` = Beginn
 * des Vortags, wie die Eröffnungszeit einer Börsen-Tageskerze); so liegen
 * Coin und BTC-Vergleichslinie auf denselben Tagen. Hoch und Tief sind nicht
 * bekannt und stehen deshalb gleich dem Schluss — erfunden wird nichts, die
 * Antwort trägt `nurSchluss`. Der letzte Punkt mitten im Tag (der laufende
 * Kurs) fällt weg; den laufenden Kurs zeigt die Ansicht ohnehin.
 *
 * @param {object} j  Antwort von `/coins/{id}/market_chart`
 * @returns {Array<[number, number, number, number]>} aufsteigend, ein Eintrag je Tag
 */
export function tageAusMarketChart(j) {
    const jeTag = new Map()
    for (const p of Array.isArray(j?.prices) ? j.prices : []) {
        const t = Number(p?.[0])
        const c = Number(p?.[1])
        if (!Number.isFinite(t) || !(c > 0)) continue
        const tag = Math.floor(t / TAG_MS) * TAG_MS
        // Nur Tagesgrenzen (CoinGecko stempelt sie auf 00:00, gelegentlich ein paar Minuten später).
        if (t - tag > 2 * 3_600_000) continue
        jeTag.set(tag - TAG_MS, c)
    }
    return [...jeTag.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => [t, c, c, c])
}

const basisAus = (symbol) => String(symbol || '').toUpperCase().replace(/USDT$|USDC$|USD$/, '').replace(/^1000+/, '')

/**
 * Coin-Ansicht «ohne Future»: Die Einzelprüfung fand kein Perpetual, aber
 * CoinGecko kennt das Kürzel. Dann entsteht ein Bericht, der die Ansicht mit
 * CoinGecko-Daten öffnet — gekennzeichnet (`ohneFuture`), ohne Messung,
 * Derivate und Börsen.
 *
 * Nichts geraten: nur bei «unbekannt» (nicht bei Eingabefehlern) und nur, wenn
 * CoinGecko GENAU dieses Kürzel führt (`holeCoinInfo` nimmt bei mehrdeutigen
 * Kürzeln den bedeutendsten exakten Treffer, nie einen Ähnlichen). Die
 * Vorschläge ähnlicher Futures bleiben am Bericht.
 *
 * @param {object} bericht  Antwort von `pruefeEinzeln` (`gefunden: false`)
 * @param {object|null} info  `holeCoinInfo`
 * @returns {object|null}
 */
export function berichtOhneFuture(bericht, info, jetzt = Date.now()) {
    if (!bericht || bericht.gefunden !== false || bericht.fehler !== 'unbekannt') return null
    const basis = basisAus(bericht.symbol)
    if (!info || !basis || String(info.symbol || '').toUpperCase() !== basis) return null
    const m = info.markt || {}
    const preis = Number(m.preisUsd) > 0 ? Number(m.preisUsd) : null
    const hoch = Number(m.hoch24hUsd) > 0 ? Number(m.hoch24hUsd) : null
    const tief = Number(m.tief24hUsd) > 0 ? Number(m.tief24hUsd) : null
    return {
        gefunden: true,
        ohneFuture: true,
        symbol: bericht.symbol,
        eingabe: bericht.eingabe || '',
        quelle: 'coingecko',
        cg: { id: info.id || '', name: info.name || basis },
        preis,
        gemessenAm: Number(m.stand) || jetzt,
        tag: preis === null ? null : {
            hoch: hoch !== null && tief !== null && hoch >= tief ? Math.max(hoch, preis) : null,
            tief: hoch !== null && tief !== null && hoch >= tief ? Math.min(tief, preis) : null,
            aenderungPct: endlich(m.aenderung24hPct) ? Number(m.aenderung24hPct) : null,
        },
        aenderungen: {
            d7: endlich(m.aenderung7dPct) ? Number(m.aenderung7dPct) : null,
            d30: endlich(m.aenderung30dPct) ? Number(m.aenderung30dPct) : null,
            j1: endlich(m.aenderung1jPct) ? Number(m.aenderung1jPct) : null,
        },
        umsatz24h: null,
        boersen: null,
        aufBitunix: false,
        vorschlaege: Array.isArray(bericht.vorschlaege) ? bericht.vorschlaege : [],
    }
}
