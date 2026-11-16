/**
 * Rechnungen der Coin-Ansicht (`components/coinradar/CoinAnsicht.vue`) — rein,
 * ohne Netz und ohne Vue, geprüft in `__selftest-coin-ansicht.mjs`.
 *
 * Zwei Dinge ziehen sich durch:
 *
 *   UNBEKANNT IST NICHT NULL. Fehlt eine Zahl, kommt `null` zurück und die
 *   Ansicht zeigt «—». Eine Marktkapitalisierung von 0 oder ein Abstand von
 *   0 % wäre eine Behauptung.
 *
 *   ZWEI QUELLEN, ZWEI ZEITEN. Der Kurs kommt von der Börse und ist frisch;
 *   Mengen und Allzeithoch kommen von CoinGecko und sind bis zu einem Tag alt
 *   (24-h-Vorrat). Darum wird die Marktkapitalisierung aus Umlaufmenge ×
 *   Börsenkurs gerechnet — aber nur, wenn beide Quellen sichtlich denselben
 *   Coin meinen (`preisPasst`): ein Kürzel kann bei CoinGecko einem anderen
 *   Projekt gehören.
 */

const TAG_MS = 86_400_000
const zahl = (w) => (w === null || w === undefined || w === '' || !Number.isFinite(Number(w)) ? null : Number(w))
const positiv = (w) => { const n = zahl(w); return n !== null && n > 0 ? n : null }

/* ── Symbol ─────────────────────────────────────────────────────────────── */

/**
 * Bündelung eines Perpetuals: `1000PEPEUSDT` handelt 1000 PEPE je Einheit,
 * `1000000MOGUSDT` eine Million, `1MBABYDOGEUSDT` ebenso. Alles andere 1.
 * `1INCHUSDT` ist kein Bündel: gebündelt wird ab 1000, und nach der Zahl muss
 * ein Kürzel folgen. Dieselbe Regel wie `basisVon` in `server/coin-radar/coin-info.js`.
 */
export function buendelFaktor(symbol) {
    const s = String(symbol || '').toUpperCase()
    const tausender = s.match(/^(10{3,9})(?=[A-Z])/)
    if (tausender) return Number(tausender[1])
    if (/^1M(?=[A-Z]{2,})/.test(s)) return 1e6
    return 1
}

/** Kurs EINES Coins aus dem Kurs des (gebündelten) Kontrakts. */
export function stueckPreis(preis, symbol) {
    const p = positiv(preis)
    return p === null ? null : p / buendelFaktor(symbol)
}

/** Kürzel ohne Quote: `BTCUSDT` → `BTC`. Die Bündelung bleibt stehen (`1000PEPE`). */
export function basisKurz(symbol) {
    return String(symbol || '').toUpperCase().replace(/USDT$|USDC$|USD$/, '')
}

/* ── Kurs und Spannen ───────────────────────────────────────────────────── */

/** Wie viele Nachkommastellen ein Kurs braucht (ein Meme-Coin steht bei 0,0000042). */
export function preisStellen(preis) {
    const p = Math.abs(Number(preis))
    if (!Number.isFinite(p) || p === 0) return 2
    if (p >= 1000) return 2
    if (p >= 1) return p >= 100 ? 2 : 4
    // Unter 1: vier gültige Stellen, höchstens zehn Nachkommastellen.
    return Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(p))))
}

/** Lage eines Kurses in einer Spanne, 0–100 %. `null`, wenn die Spanne nicht steht. */
export function lageInSpanne(preis, tief, hoch) {
    const [p, t, h] = [positiv(preis), positiv(tief), positiv(hoch)]
    if (p === null || t === null || h === null || !(h > t)) return null
    return Math.min(100, Math.max(0, ((p - t) / (h - t)) * 100))
}

/**
 * Hoch und Tief der letzten 52 Wochen aus Tageskerzen `[t, hoch, tief, schluss]`.
 * Der laufende Kurs zählt mit (die Kerzen sind geschlossene Tage).
 * `tage` sagt, wie viel davon wirklich gedeckt ist — ein vier Monate alter
 * Coin hat keine 52-Wochen-Spanne, sondern eine seit der Listung.
 */
export function jahresSpanne(kerzen, preis, jetzt = Date.now()) {
    const ab = jetzt - 365 * TAG_MS
    const fenster = (kerzen || []).filter((k) => k[0] >= ab)
    if (!fenster.length) return null
    let hoch = Math.max(...fenster.map((k) => k[1]))
    let tief = Math.min(...fenster.map((k) => k[2]))
    const p = positiv(preis)
    if (p !== null) { hoch = Math.max(hoch, p); tief = Math.min(tief, p) }
    if (!(hoch > 0) || !(tief > 0)) return null
    const tage = Math.round((jetzt - fenster[0][0]) / TAG_MS)
    // Älter als das Fenster ist die Reihe, wenn es Kerzen VOR dem Fenster gibt.
    const voll = (kerzen || []).some((k) => k[0] < ab)
    return { hoch, tief, tage, voll, hochAm: fenster.find((k) => k[1] === hoch)?.[0] ?? null, tiefAm: fenster.find((k) => k[2] === tief)?.[0] ?? null }
}

/** Abstand vom Kurs zu einer Marke in Prozent des MARKENWERTS (Kurs 50, Hoch 100 → −50). */
export function abstandZu(preis, marke) {
    const [p, m] = [positiv(preis), positiv(marke)]
    return p === null || m === null ? null : (p / m - 1) * 100
}

/* ── CoinGecko-Stammdaten gegen den Börsenkurs ──────────────────────────── */

/**
 * Meinen Börse und CoinGecko denselben Coin? Der CoinGecko-Kurs ist bis zu
 * einem Tag alt, also grosszügig: Faktor 3 in beide Richtungen. Darüber ist es
 * mit hoher Wahrscheinlichkeit ein namensgleiches Projekt (oder eine nicht
 * erkannte Bündelung). `null` = nicht prüfbar.
 */
export function preisPasst(stueck, cgPreis) {
    const [a, b] = [positiv(stueck), positiv(cgPreis)]
    if (a === null || b === null) return null
    const v = a / b
    return v > 1 / 3 && v < 3
}

/**
 * Marktkapitalisierung, FDV und Mengenverhältnisse.
 *
 * `frisch: true` heisst: aus den Mengen und dem Börsenkurs gerechnet. Sonst
 * stehen die Werte von CoinGecko (mit deren Stand) da — etwa wenn der Kurs
 * nicht passt oder die Umlaufmenge fehlt.
 *
 * @param {object|null} markt   `info.markt` aus `/api/coin-radar/coin-info`
 * @param {number|null} stueck  Börsenkurs je Coin (`stueckPreis`)
 */
export function marktwerte(markt, stueck) {
    const m = markt || {}
    const passt = preisPasst(stueck, m.preisUsd)
    const frisch = passt === true
    const umlauf = positiv(m.umlauf)
    // Höchstmenge, sonst Gesamtmenge — wie CoinGecko die FDV rechnet.
    const decke = positiv(m.hoechst) ?? positiv(m.gesamt)
    const marktkap = frisch && umlauf !== null ? umlauf * stueck : positiv(m.marktkapUsd)
    const fdv = frisch && decke !== null ? decke * stueck : positiv(m.fdvUsd)
    const cgKap = positiv(m.marktkapUsd)
    const cgUmsatz = positiv(m.umsatz24hUsd)
    return {
        passt,
        frisch: frisch && umlauf !== null,
        marktkap,
        fdv,
        deckeArt: positiv(m.hoechst) !== null ? 'hoechst' : positiv(m.gesamt) !== null ? 'gesamt' : null,
        umlaufAnteilPct: umlauf !== null && decke !== null && decke >= umlauf ? (umlauf / decke) * 100 : null,
        // Umsatz und Marktkap aus DEMSELBEN Stand (beide CoinGecko) — sonst teilte man heute durch gestern.
        umsatzZuMarktkapPct: cgKap !== null && cgUmsatz !== null ? (cgUmsatz / cgKap) * 100 : null,
    }
}

/**
 * Verwässerung: wie viel der voll verwässerten Bewertung noch nicht im Umlauf
 * ist. Eine Einordnung in vier Stufen, keine Prognose — ob und wann die
 * Menge frei wird, steht nicht in diesen Zahlen.
 *
 * @returns {{faktor:number, offenPct:number, stufe:'keine'|'gering'|'mittel'|'hoch'}|null}
 */
export function verwaesserung(marktkap, fdv) {
    const [k, f] = [positiv(marktkap), positiv(fdv)]
    if (k === null || f === null) return null
    // FDV unter der Marktkap kommt bei CoinGecko vor (verbrannte Coins, Meldelücken) — dann ist nichts offen.
    const faktor = Math.max(1, f / k)
    const offenPct = (1 - 1 / faktor) * 100
    const stufe = offenPct < 5 ? 'keine' : offenPct < 33 ? 'gering' : offenPct < 66 ? 'mittel' : 'hoch'
    return { faktor, offenPct, stufe }
}

/** Die drei Mengen als Balken gegen die grösste: `[{id, menge, pct}]`, nur was gemeldet ist. */
export function mengenBalken(markt) {
    const m = markt || {}
    const zeilen = [
        { id: 'umlauf', menge: positiv(m.umlauf) },
        { id: 'gesamt', menge: positiv(m.gesamt) },
        { id: 'hoechst', menge: positiv(m.hoechst) },
    ].filter((z) => z.menge !== null)
    const max = Math.max(0, ...zeilen.map((z) => z.menge))
    return zeilen.map((z) => ({ ...z, pct: max > 0 ? (z.menge / max) * 100 : 0 }))
}

/** Alter in ganzen Monaten seit einem Zeitpunkt (`null` ohne Zeitpunkt oder in der Zukunft). */
export function alterMonate(seit, jetzt = Date.now()) {
    const s = positiv(seit)
    if (s === null || s > jetzt) return null
    return Math.floor((jetzt - s) / (30.44 * TAG_MS))
}

/* ── Kursverlauf ────────────────────────────────────────────────────────── */

/**
 * Ausschnitt des Tagesverlaufs als Linie `[[t, schluss]]`, am Ende der
 * laufende Kurs (die Tageskerzen sind geschlossene Tage).
 */
export function verlaufsLinie(kerzen, tage, jetzt = Date.now(), preis = null) {
    const ab = jetzt - tage * TAG_MS
    const linie = (kerzen || []).filter((k) => k[0] >= ab).map((k) => [k[0], k[k.length - 1]])
    const p = positiv(preis)
    if (p !== null && linie.length && jetzt > linie[linie.length - 1][0]) linie.push([jetzt, p])
    return linie
}

/** Veränderung einer Linie vom ersten zum letzten Punkt in Prozent. */
export function linienAenderung(linie) {
    if (!linie || linie.length < 2 || !(linie[0][1] > 0)) return null
    return (linie[linie.length - 1][1] / linie[0][1] - 1) * 100
}

/**
 * Coin und BTC auf denselben Start gestellt (Veränderung in % seit dem ersten
 * GEMEINSAMEN Tag). Ohne gemeinsamen Start gibt es keinen Vergleich — einen
 * jungen Coin gegen ein BTC-Jahr zu halten, vergliche verschiedene Zeiträume.
 *
 * @returns {{coin:Array, btc:Array, coinPct:number, btcPct:number, diffPct:number}|null}
 *          `diffPct` in Prozentpunkten (Coin minus BTC)
 */
export function gegenBtc(coinLinie, btcLinie) {
    if (!coinLinie?.length || !btcLinie?.length) return null
    const start = Math.max(coinLinie[0][0], btcLinie[0][0])
    const c = coinLinie.filter((p) => p[0] >= start)
    const b = btcLinie.filter((p) => p[0] >= start)
    if (c.length < 2 || b.length < 2 || !(c[0][1] > 0) || !(b[0][1] > 0)) return null
    // Der gemeinsame Start muss wirklich derselbe Tag sein (höchstens ein Tag Versatz).
    if (Math.abs(c[0][0] - b[0][0]) > TAG_MS) return null
    const pct = (reihe) => reihe.map((p) => [p[0], (p[1] / reihe[0][1] - 1) * 100])
    const coin = pct(c)
    const btc = pct(b)
    const coinPct = coin[coin.length - 1][1]
    const btcPct = btc[btc.length - 1][1]
    return { coin, btc, coinPct, btcPct, diffPct: coinPct - btcPct }
}

/* ── Derivate ───────────────────────────────────────────────────────────── */

const median = (werte) => {
    const s = [...werte].sort((a, b) => a - b)
    if (!s.length) return null
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/**
 * Funding-Verlauf aufbereiten. Eingabe: `punkte` aus `/api/chart/funding`
 * (`{t, rate}` je Zahlung, `rate` als Dezimalbruch: 0.0001 = 0,01 %).
 *
 * Der Takt wird GEMESSEN (Median der Abstände, auf volle Stunden) statt mit
 * 8 h angenommen — viele Perpetuals zahlen 4-stündlich, und die Jahresrate
 * wäre sonst um den Faktor 2 falsch.
 *
 * @returns {null | {taktH, letztePct, jahr7dPct, jahr30dPct, positivAnteilPct, zahlungen, serie}}
 *          `serie` = `[[t, Jahresrate %]]` der letzten `tage` Tage
 */
export function fundingKennzahlen(punkte, jetzt = Date.now(), tage = 30) {
    const p = (punkte || [])
        .map((x) => ({ t: Number(x?.t), rate: zahl(x?.rate) }))
        .filter((x) => Number.isFinite(x.t) && x.rate !== null)
        .sort((a, b) => a.t - b.t)
    if (p.length < 2) return null
    const jung = p.slice(-60)
    const abstand = median(jung.slice(1).map((x, i) => x.t - jung[i].t))
    const taktH = Math.max(1, Math.round(abstand / 3_600_000))
    const jeJahr = 8760 / taktH
    const jahr = (rate) => rate * 100 * jeJahr
    const schnitt = (n) => {
        const f = p.filter((x) => x.t >= jetzt - n * TAG_MS)
        // Ein Schnitt braucht das Fenster wenigstens zur Hälfte.
        if (f.length < (n * 24) / taktH / 2) return null
        return jahr(f.reduce((s, x) => s + x.rate, 0) / f.length)
    }
    const fenster = p.filter((x) => x.t >= jetzt - tage * TAG_MS)
    return {
        taktH,
        letztePct: p[p.length - 1].rate * 100,
        letzteZeit: p[p.length - 1].t,
        jahr7dPct: schnitt(7),
        jahr30dPct: schnitt(30),
        positivAnteilPct: fenster.length ? (fenster.filter((x) => x.rate > 0).length / fenster.length) * 100 : null,
        zahlungen: fenster.length,
        serie: fenster.map((x) => [x.t, jahr(x.rate)]),
    }
}

/**
 * Open Interest und Long/Short aufbereiten. Eingabe: Antwort von
 * `/api/marktradar/ls-oi` (`punkte` stündlich, `oi` in Einheiten des
 * Kontrakts) und der Kontraktkurs.
 *
 * Die Veränderung wird in KONTRAKTEN gerechnet, nicht in USD: der USD-Wert
 * steigt mit dem Kurs, auch wenn keine einzige Position dazukommt.
 */
export function oiKennzahlen(antwort, preis) {
    const punkte = (antwort?.punkte || []).filter((x) => Number.isFinite(Number(x?.t)))
    if (!punkte.length) return null
    const mitOi = punkte.filter((x) => positiv(x.oi) !== null)
    const letzter = punkte[punkte.length - 1]
    const oi = mitOi.length ? mitOi[mitOi.length - 1].oi : null
    const p = positiv(preis)
    const delta = (stunden) => {
        if (mitOi.length <= stunden) return null
        const alt = mitOi[mitOi.length - 1 - stunden].oi
        return alt > 0 ? (oi / alt - 1) * 100 : null
    }
    const longs = punkte.map((x) => zahl(x.longPct)).filter((x) => x !== null)
    return {
        oi,
        oiUsd: oi !== null && p !== null ? oi * p : null,
        oiDelta24hPct: zahl(antwort?.jetzt?.oiDelta24hPct) ?? delta(24),
        oiDelta7dPct: delta(168),
        preisDelta24hPct: zahl(antwort?.jetzt?.preisDelta24hPct),
        deutung: antwort?.jetzt?.deutung || 'neutral',
        longPct: zahl(letzter.longPct),
        shortPct: zahl(letzter.shortPct),
        ratio: zahl(letzter.ratio),
        longSchnittPct: longs.length ? longs.reduce((s, x) => s + x, 0) / longs.length : null,
        stunden: punkte.length,
        oiSerie: mitOi.map((x) => [Number(x.t), x.oi]),
        longSerie: punkte.filter((x) => zahl(x.longPct) !== null).map((x) => [Number(x.t), Number(x.longPct)]),
    }
}

/** Funding-Rate je Zahlung (in %) aus der Jahresrate — einheitensicher über beide Messpfade. */
export function ratenProzentAusJahr(jahresRatePct, taktH) {
    const [j, h] = [zahl(jahresRatePct), positiv(taktH)]
    return j === null || h === null ? null : j / (8760 / h)
}

/* ── Radar-Messung ──────────────────────────────────────────────────────── */

/**
 * Gleichlauf mit BTC in Worten — dieselben Schlüssel und Schwellen wie in der
 * Rangliste (`deuteKopplung` in `views/CoinRadar.vue`; die Schwellen kommen
 * vom Server). Ungemessen ist `unbekannt`, nicht «eigenständig».
 */
export function kopplungsDeutung(korrelation, schwellen = {}) {
    const r = zahl(korrelation)
    if (r === null) return 'unbekannt'
    const fest = zahl(schwellen.kopplungFest) ?? 0.7
    const lose = zahl(schwellen.kopplungLose) ?? 0.3
    if (r >= fest) return 'laeuftMit'
    if (r <= -fest) return 'laeuftGegen'
    if (Math.abs(r) <= lose) return 'eigenstaendig'
    return 'teilweise'
}

/** Messwerte je Börse, günstigster Rundlauf zuerst: `[[boerse, werte], …]`. */
export function boersenNachRundlauf(jeBoerse) {
    return Object.entries(jeBoerse || {}).sort((a, b) => (a[1]?.rundlaufBp ?? 1e9) - (b[1]?.rundlaufBp ?? 1e9))
}
