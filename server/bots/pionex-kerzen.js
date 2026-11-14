/**
 * Spot-Kerzen und Spot-Symbole direkt von Pionex (öffentlich, ohne Schlüssel).
 *
 * Für den Spot-Grid-Planer: tokenisierte Aktien (xStocks wie NVDAX) gibt es nur
 * bei Pionex, nicht bei Binance oder Bitget — und ein Spot-Grid läuft genau auf
 * diesem Markt. Gemessen 14.11.2026 an NVDAX_USDT:
 *   - Intervalle 1M 5M 15M 30M 60M 4H 8H 12H 1D, KEIN 1W (wird aus 1D gebaut)
 *   - höchstens 500 Kerzen je Abruf, ältere über `endTime` (ms)
 *   - Tiefe: 5M etwa 40 Tage, 15M etwa 100 Tage, 60M und 1D weiter;
 *     zu weit zurück antwortet Pionex „endTime param error"
 *   - neueste Kerze zuerst, die laufende ist dabei
 */
const BASIS = 'https://api.pionex.com'
const MAX_JE_ABRUF = 500
const PAUSE_MS = 120

const IV_MS = { '5M': 300_000, '15M': 900_000, '60M': 3_600_000, '4H': 14_400_000, '1D': 86_400_000 }

/** Antwort → aufsteigende Kerzen {t, o, h, l, c, v}. Rein. */
export function kerzenAusPionex(json) {
    const roh = json?.data?.klines
    if (!Array.isArray(roh)) return []
    return roh.map((k) => ({ t: Number(k.time), o: Number(k.open), h: Number(k.high), l: Number(k.low), c: Number(k.close), v: Number(k.volume) }))
        .filter((k) => Number.isFinite(k.t) && [k.o, k.h, k.l, k.c].every((x) => Number.isFinite(x) && x > 0))
        .sort((a, b) => a.t - b.t)
}

/** Wochenkerzen (Montag 00:00 UTC) aus Tageskerzen. Rein. */
export function wochenAusTagen(tage) {
    const aus = []
    for (const k of tage || []) {
        const d = new Date(k.t)
        const montag = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000
        const w = aus[aus.length - 1]
        if (w && w.t === montag) { w.h = Math.max(w.h, k.h); w.l = Math.min(w.l, k.l); w.c = k.c; w.v += k.v || 0 }
        else aus.push({ t: montag, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v || 0 })
    }
    return aus
}

/** Nur abgeschlossene Kerzen (die laufende fällt weg). Rein. */
export function nurGeschlossen(kerzen, ivMs, jetzt = Date.now()) {
    return (kerzen || []).filter((k) => k.t + ivMs <= jetzt)
}

async function hole(pfad) {
    const r = await fetch(`${BASIS}${pfad}`, { signal: AbortSignal.timeout(15_000) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.result) throw new Error(`Pionex: ${j?.message || r.status}`)
    return j
}

/**
 * Kerzen eines Spot-Paars zwischen `von` und `bis` (ms), rückwärts gepaged.
 * Hört auf, wenn Pionex nichts Älteres mehr hat (dann beginnt die Reihe später).
 */
export async function pionexKerzen(paar, intervall, { von, bis = Date.now(), maxAbrufe = 40 } = {}) {
    const ms = IV_MS[intervall]
    if (!ms) throw new Error(`Intervall ${intervall} unbekannt`)
    const alle = new Map()
    let ende = bis
    for (let i = 0; i < maxAbrufe; i++) {
        let k
        try { k = kerzenAusPionex(await hole(`/api/v1/market/klines?symbol=${encodeURIComponent(paar)}&interval=${intervall}&limit=${MAX_JE_ABRUF}&endTime=${ende}`)) } catch (e) {
            if (i > 0 && /endTime/i.test(e.message)) break   // weiter zurück gibt es nichts
            throw e
        }
        if (!k.length) break
        for (const x of k) alle.set(x.t, x)
        const aeltest = k[0].t
        if (von != null && aeltest <= von) break
        if (k.length < MAX_JE_ABRUF) break
        ende = aeltest - 1
        await new Promise((r) => setTimeout(r, PAUSE_MS))
    }
    return [...alle.values()].filter((x) => (von == null || x.t >= von) && x.t <= bis).sort((a, b) => a.t - b.t)
}

/** Die letzten `anzahl` abgeschlossenen Kerzen (1w aus 1D gebaut). */
export async function pionexLetzte(paar, tf, anzahl = 300) {
    if (tf === '1w') {
        const tage = await pionexKerzen(paar, '1D', { von: Date.now() - (anzahl * 7 + 7) * 86_400_000, maxAbrufe: 6 })
        const wochen = wochenAusTagen(tage)
        return nurGeschlossen(wochen, 7 * 86_400_000).slice(-anzahl)
    }
    const iv = { '1d': '1D', '4h': '4H', '1h': '60M', '15m': '15M' }[tf]
    if (!iv) throw new Error(`Zeitrahmen ${tf} unbekannt`)
    const k = await pionexKerzen(paar, iv, { von: Date.now() - (anzahl + 2) * IV_MS[iv], maxAbrufe: Math.ceil(anzahl / MAX_JE_ABRUF) + 1 })
    return nurGeschlossen(k, IV_MS[iv]).slice(-anzahl)
}

/**
 * Kerzen für den Rückblick eines Spot-Grids: so fein, wie Pionex so weit zurück
 * reicht (5M bis 35 Tage, sonst 15M).
 */
export async function pionexSimKerzen(paar, von, bis = Date.now()) {
    const tf = bis - von <= 35 * 86_400_000 ? '5M' : '15M'
    const kerzen = await pionexKerzen(paar, tf, { von, bis })
    return { kerzen: nurGeschlossen(kerzen, IV_MS[tf]), tf: tf.toLowerCase(), funding: null, quelle: 'pionex' }
}

/** Spot-Symbole: Map coin → { minAmount (USDT je Order), minTradeSize (Coin), quotePrecision }. */
export async function pionexSpotSymbole() {
    const j = await hole('/api/v1/common/symbols')
    return spotAusTabelle(j?.data?.symbols)
}

/** Rein: nur aktive USDT-Paare. */
export function spotAusTabelle(liste) {
    const m = new Map()
    for (const s of liste || []) {
        if (s?.type !== 'SPOT' || s.enable === false || s.quoteCurrency !== 'USDT') continue
        m.set(String(s.baseCurrency).toUpperCase(), {
            minAmount: Number(s.minAmount) || null, minTradeSize: Number(s.minTradeSize) || null,
            quotePrecision: Number.isInteger(Number(s.quotePrecision)) ? Number(s.quotePrecision) : null,
        })
    }
    return m
}
