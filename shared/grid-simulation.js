/**
 * Grid-Simulation — spielt ein Futures- oder Spot-Grid auf Kerzen durch.
 * Rein, ohne Netz; läuft im Server (Bot-Seite) und könnte im Browser laufen.
 *
 * Modell (nach der Funktionsbeschreibung von Pionex, keine Kopie ihres Codes):
 *  - Das Band [unten, oben] wird in `anzahl` Zellen geteilt (arithmetisch:
 *    gleiche Preisschritte, geometrisch: gleiche Prozentschritte).
 *  - Jede Zelle i zwischen L[i] und L[i+1] handelt `menge` Einheiten:
 *    eine Long-Zelle kauft bei L[i] und verkauft bei L[i+1], eine Short-Zelle
 *    verkauft bei L[i+1] und kauft bei L[i] zurück. Jeder abgeschlossene
 *    Durchgang ist ein Zyklus.
 *  - Grid-Gewinn je Zyklus = menge × (L[i+1] − L[i]) MINUS die Gebühren der
 *    beiden Ausführungen. So meldet Pionex `gridProfit` — gemessen an den
 *    beendeten Bots des Entwicklers (11.11.2026): bei 14 Coin-M-Bots lag
 *    gridProfit / (brutto − 2 × Maker je Zyklus) im Median bei 0,99, gegen
 *    brutto allein bei 0,82. `gridBrutto` gibt es zusätzlich.
 *  - Long-Grid: alle Zellen long; beim Start sind die Zellen ÜBER dem Kurs
 *    schon gekauft (zum Startkurs) — das ist die Startposition.
 *    Short-Grid: alle Zellen short, die Zellen UNTER dem Kurs sind beim Start
 *    verkauft. Neutral: unter dem Kurs long, darüber short, ohne Startposition.
 *  - Weg in einer Kerze: Eröffnung → zuerst das Extrem gegen die Kerzenfarbe
 *    (grün: Tief, rot: Hoch) → das andere Extrem → Schluss. Was innerhalb
 *    einer Kerze sonst noch pendelt, sieht die Simulation nicht — mit gröberen
 *    Kerzen zählt sie zu wenige Zyklen. Deshalb wird gegen echte Bots geeicht.
 *  - Gebühr je Ausführung: `gebuehr` × Menge × Preis.
 *  - Funding (optional): zu jedem Zeitpunkt aus `funding` [{t, rate}] zahlt
 *    die Position rate × Position × Preis × `fundingFaktor` (+1 linear;
 *    −1 für das inverse Instrument, wo eine Short-Position in „USDT" ein Long
 *    der Coin ist).
 *  - Ausstieg (optional): kreuzt der Preis `ausstiegUnten`/`ausstiegOben`,
 *    schliesst alles zu diesem Preis, danach ist Schluss (Stop-Loss/Take-Profit).
 *  - Liquidation (isolierte Marge): wenn Marge + realisiert + schwebend am
 *    jeweiligen Wegpunkt unter die Erhaltungsmarge (`mmr` × |Position| × Preis)
 *    fällt. Danach ist Schluss, die Marge weg.
 *  - `liqSchaetzung`: der Preis, bei dem liquidiert würde, wenn ab dem Stand
 *    alle Orders auf der Risikoseite gefüllt werden — so beschreibt Pionex den
 *    geschätzten Liquidationspreis.
 *
 * Coin-M (invers): der Aufrufer rechnet die Kerzen in den inversen Preis um
 * (`inverseKerzen`) und simuliert das Instrument „USDT in Coin" — dann sind
 * Gewinn und Marge in der Coin, wie bei Pionex. Siehe `simuliereBot`.
 *
 * Alle Zahlen in Preis-Einheiten des simulierten Instruments.
 */

/** Grid-Linien L[0..anzahl]. */
export function gridLinien(unten, oben, anzahl, art = 'arithmetic') {
    if (!(unten > 0) || !(oben > unten) || !(anzahl >= 1)) return []
    const n = Math.round(anzahl)
    const L = new Array(n + 1)
    if (String(art).toLowerCase() === 'geometric') {
        const f = Math.pow(oben / unten, 1 / n)
        for (let i = 0; i <= n; i++) L[i] = unten * Math.pow(f, i)
    } else {
        const s = (oben - unten) / n
        for (let i = 0; i <= n; i++) L[i] = unten + s * i
    }
    L[n] = oben
    return L
}

/** Kerzen eines inversen Kontrakts: Preis q = 1/P, Hoch und Tief tauschen. */
export function inverseKerzen(kerzen) {
    return kerzen.map((k) => ({ t: k.t, o: 1 / k.o, h: 1 / k.l, l: 1 / k.h, c: 1 / k.c }))
}

/**
 * Menge je Grid für dieselbe Kapitalwirkung bei anderem Band: die volle
 * Position (alle Zellen offen) soll denselben Nominalwert haben.
 * Σ L[i] der Zellen-Untergrenzen steht für den Nominalwert je Mengeneinheit.
 */
export function mengeFuerGleichesKapital(mengeAlt, linienAlt, linienNeu) {
    const summe = (L) => L.slice(0, -1).reduce((a, b) => a + b, 0)
    const a = summe(linienAlt), b = summe(linienNeu)
    return a > 0 && b > 0 ? mengeAlt * a / b : null
}

/** Startzustand der Zellen. */
function startZellen(L, richtung, start) {
    const n = L.length - 1
    const zellen = []
    for (let i = 0; i < n; i++) {
        let art = richtung === 'short' ? 'S' : 'L'
        if (richtung === 'neutral') art = L[i] >= start ? 'S' : 'L'
        let offen = false
        if (richtung === 'long' && L[i] > start) offen = true
        if (richtung === 'short' && L[i + 1] < start) offen = true
        zellen.push({ art, offen, einstieg: offen ? start : null })
    }
    return zellen
}

const positionVon = (zellen, q) => zellen.reduce((s, z) => s + (z.offen ? (z.art === 'L' ? q : -q) : 0), 0)
const schwebendVon = (zellen, q, preis) => zellen.reduce((s, z) => s + (!z.offen ? 0 : z.art === 'L' ? q * (preis - z.einstieg) : q * (z.einstieg - preis)), 0)

/**
 * Geschätzte Liquidationspreise ab einem Stand: der Preis läuft von `preis`
 * nach unten (bzw. oben), jede Order auf dem Weg wird gefüllt; gesucht ist
 * der erste Preis mit Eigenkapital ≤ mmr × |Position| × Preis.
 * `kapital` = Marge + realisiert − Gebühren. Gibt {unten, oben} (null = keiner).
 */
export function liqSchaetzung({ L, zellen, menge: q, preis, kapital, mmr = 0, gebuehr = 0 }) {
    const n = L.length - 1
    const ergebnis = { unten: null, oben: null }
    for (const richtung of ['unten', 'oben']) {
        const z = zellen.map((c) => ({ ...c }))
        let kasse = kapital
        let p0 = preis
        // Ereignis-Preise in Laufrichtung (Grid-Linien jenseits des Startpreises)
        const stufen = []
        if (richtung === 'unten') { for (let i = n; i >= 0; i--) if (L[i] < preis) stufen.push(i) }
        else { for (let i = 0; i <= n; i++) if (L[i] > preis) stufen.push(i) }
        let gefunden = null
        const loese = (grenze) => {
            const pos = positionVon(z, q)
            if (!pos) return null
            const e0 = kasse + schwebendVon(z, q, p0)
            // e0 + pos × (p − p0) = mmr × |pos| × p
            const nenner = mmr * Math.abs(pos) - pos
            if (Math.abs(nenner) < 1e-18) return null
            const p = (e0 - pos * p0) / nenner
            const imAbschnitt = richtung === 'unten' ? (p <= p0 && (grenze == null || p >= grenze)) : (p >= p0 && (grenze == null || p <= grenze))
            return imAbschnitt && p > 0 ? p : null
        }
        if (kasse + schwebendVon(z, q, p0) <= mmr * Math.abs(positionVon(z, q)) * p0 && positionVon(z, q)) { ergebnis[richtung] = p0; continue }
        for (const i of stufen) {
            gefunden = loese(L[i])
            if (gefunden != null) break
            // bis zur Linie laufen und dort füllen
            const lv = L[i]
            if (richtung === 'unten' && i < n) {
                const c = z[i]
                if (c.art === 'L' && !c.offen) { c.offen = true; c.einstieg = lv; kasse -= gebuehr * q * lv }
                else if (c.art === 'S' && c.offen) { kasse += q * (c.einstieg - lv) - gebuehr * q * lv; c.offen = false; c.einstieg = null }
            }
            if (richtung === 'oben' && i > 0) {
                const c = z[i - 1]
                if (c.art === 'L' && c.offen) { kasse += q * (lv - c.einstieg) - gebuehr * q * lv; c.offen = false; c.einstieg = null }
                else if (c.art === 'S' && !c.offen) { c.offen = true; c.einstieg = lv; kasse -= gebuehr * q * lv }
            }
            p0 = lv
        }
        if (gefunden == null) gefunden = loese(null)
        ergebnis[richtung] = gefunden
    }
    return ergebnis
}

/**
 * Simulation. `p`:
 *   kerzen [{t,o,h,l,c}] aufsteigend, unten, oben, anzahl, art,
 *   richtung 'long' | 'short' | 'neutral', menge (je Zelle),
 *   startPreis (Default: Eröffnung der ersten Kerze), einsatz (Marge),
 *   gebuehr (Grid-Orders, Maker, Anteil), gebuehrMarkt (Startposition und Schliessen, Taker),
 *   mmr (Erhaltungsmarge, Anteil),
 *   funding [{t, rate}], fundingFaktor (±1), ausstiegUnten, ausstiegOben, ab, bis (ms),
 *   durchstich (Anteil, um den der Kurs eine Linie überschreiten muss)
 */
export function simuliereGrid(p) {
    const L = gridLinien(p.unten, p.oben, p.anzahl, p.art)
    const kerzen = (p.kerzen || []).filter((k) => (p.ab == null || k.t >= p.ab) && (p.bis == null || k.t <= p.bis))
    if (L.length < 2 || !kerzen.length || !(p.menge > 0)) return null
    const n = L.length - 1
    const q = p.menge
    const gebuehr = p.gebuehr ?? 0
    const gebuehrMarkt = p.gebuehrMarkt ?? gebuehr
    const mmr = p.mmr ?? 0
    const einsatz = p.einsatz ?? null
    const richtung = String(p.richtung || 'long').toLowerCase()
    const start = p.startPreis ?? kerzen[0].o
    const fundingListe = (p.funding || []).filter((f) => f.t >= kerzen[0].t && f.t <= kerzen[kerzen.length - 1].t + 60_000).sort((a, b) => a.t - b.t)
    const fundingFaktor = p.fundingFaktor ?? 1

    const zellen = startZellen(L, richtung, start)
    let kasse = 0, gridGewinn = 0, gridBrutto = 0, gebuehren = 0, funding = 0, zyklen = 0, ausfuehrungen = 0
    // Laufende Summen statt jedes Mal über alle Zellen (Audit FUN-02): Anzahl offener
    // Long-/Short-Zellen und die Summe ihrer Einstiege genügen für Position und Schwebendes.
    let nL = 0, sumL = 0, nS = 0, sumS = 0
    const oeffne = (z, preis) => { z.offen = true; z.einstieg = preis; if (z.art === 'L') { nL++; sumL += preis } else { nS++; sumS += preis } }
    const schliesse = (z) => { if (z.art === 'L') { nL--; sumL -= z.einstieg } else { nS--; sumS -= z.einstieg } z.offen = false; z.einstieg = null }
    for (const z of zellen) if (z.offen) { if (z.art === 'L') { nL++; sumL += z.einstieg } else { nS++; sumS += z.einstieg } gebuehren += gebuehrMarkt * q * start; ausfuehrungen++ }

    const position = () => q * (nL - nS)
    const schwebend = (preis) => q * (nL * preis - sumL) + q * (sumS - nS * preis)
    const fuelle = (preis) => { gebuehren += gebuehr * q * preis; ausfuehrungen++ }
    const zyklus = (i) => {
        const brutto = q * (L[i + 1] - L[i])
        gridBrutto += brutto
        gridGewinn += brutto - gebuehr * q * (L[i] + L[i + 1])
        zyklen++
    }

    // Preis bewegt sich von a nach b (monoton)
    // Eine Order gilt erst als gefüllt, wenn der Kurs die Linie um `durchstich`
    // (Anteil) überschreitet: ein Berühren genau am Kerzenextrem füllt an der
    // Börse oft nicht, und die Kerzen stammen von einer anderen Börse.
    const eps = p.durchstich ?? 0
    // Erster Index mit L[i] >= x (bzw. > x) — Binärsuche über die aufsteigenden Linien
    const abIndex = (x, streng) => {
        let lo = 0, hi = L.length
        while (lo < hi) { const m = (lo + hi) >> 1; if (streng ? L[m] > x : L[m] >= x) hi = m; else lo = m + 1 }
        return lo
    }
    // Nur die Linien zwischen a und b anfassen (Audit FUN-02), dieselben Bedingungen wie zuvor
    function bewege(a, b) {
        if (b < a) {
            const bis = Math.min(abIndex(a, false) - 1, n - 1)
            for (let i = bis; i >= 0; i--) {
                const lv = L[i]
                if (lv * (1 - eps) < b) break
                const z = zellen[i]
                if (z.art === 'L' && !z.offen) { oeffne(z, lv); fuelle(lv) }
                else if (z.art === 'S' && z.offen) {
                    kasse += q * (z.einstieg - lv); zyklus(i)
                    schliesse(z); fuelle(lv)
                }
            }
        } else if (b > a) {
            for (let j = Math.max(abIndex(a, true), 1); j <= n; j++) {
                const lv = L[j]
                if (lv * (1 + eps) > b) break
                const i = j - 1
                const z = zellen[i]
                if (z.art === 'L' && z.offen) {
                    kasse += q * (lv - z.einstieg); zyklus(i)
                    schliesse(z); fuelle(lv)
                } else if (z.art === 'S' && !z.offen) { oeffne(z, lv); fuelle(lv) }
            }
        }
    }

    const eigen = (preis) => (einsatz ?? 0) + kasse - gebuehren + funding + schwebend(preis)
    function liquidiertBei(preis) {
        if (einsatz == null) return false
        const pos = Math.abs(position())
        if (!pos) return false
        return eigen(preis) <= mmr * pos * preis
    }
    function schliesseAlles(preis) {
        for (const z of zellen) {
            if (!z.offen) continue
            kasse += z.art === 'L' ? q * (preis - z.einstieg) : q * (z.einstieg - preis)
            gebuehren += gebuehrMarkt * q * preis; ausfuehrungen++
            schliesse(z)
        }
    }

    let preis = start
    let liquidation = null, ausstieg = null
    let innen = 0, maxVerlust = 0, fi = 0
    const kurve = []
    for (const k of kerzen) {
        while (fi < fundingListe.length && fundingListe[fi].t <= k.t) {
            funding += -fundingListe[fi].rate * position() * preis * fundingFaktor
            fi++
        }
        const weg = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]
        for (const ziel of weg) {
            // Ausstieg auf dem Weg: zuerst bis zur Marke laufen, dort schliessen
            const marke = p.ausstiegUnten != null && ziel <= p.ausstiegUnten && preis > p.ausstiegUnten ? p.ausstiegUnten
                : p.ausstiegOben != null && ziel >= p.ausstiegOben && preis < p.ausstiegOben ? p.ausstiegOben : null
            if (marke != null) {
                bewege(preis, marke); preis = marke
                if (liquidiertBei(preis)) { liquidation = { t: k.t, preis }; break }
                schliesseAlles(marke)
                ausstieg = { t: k.t, preis: marke, art: marke === p.ausstiegUnten ? 'unten' : 'oben' }
                break
            }
            bewege(preis, ziel)
            preis = ziel
            if (liquidiertBei(preis)) { liquidation = { t: k.t, preis }; break }
        }
        const stand = liquidation ? -(einsatz ?? 0) : kasse - gebuehren + funding + schwebend(ausstieg ? preis : k.c)
        if (stand < maxVerlust) maxVerlust = stand
        if (k.c >= L[0] && k.c <= L[n]) innen++
        kurve.push([k.t, stand])
        if (liquidation || ausstieg) break
    }

    const ende = liquidation || ausstieg ? preis : kerzen[kerzen.length - 1].c
    const sw = liquidation ? 0 : schwebend(ende)
    const gesamt = liquidation ? -(einsatz ?? 0) : kasse - gebuehren + funding + sw
    const liq = !liquidation && !ausstieg && einsatz != null
        ? liqSchaetzung({ L, zellen, menge: q, preis: ende, kapital: einsatz + kasse - gebuehren + funding, mmr, gebuehr })
        : { unten: null, oben: null }
    return {
        linien: L.length,
        menge: q,
        startPreis: start,
        endPreis: ende,
        zyklen, ausfuehrungen,
        gridGewinn, gridBrutto,
        realisiert: kasse,
        gebuehren: -gebuehren,
        funding,
        schwebend: sw,
        gesamt,
        position: liquidation ? 0 : position(),
        maxVerlust,
        zeitImBand: kurve.length ? innen / kurve.length : null,
        liquidation,
        ausstieg,
        liqSchaetzung: liq,
        kurve,
    }
}

/**
 * Simulation für einen Bot aus `normalisiereBot` (Preise in USDT je Coin) mit
 * optional geänderten Einstellungen. Coin-M wird invers gerechnet, Ergebnisse
 * dann in der Coin. `aenderung` = { unten, oben, anzahl, art, hebel, einsatz,
 * extraMarge (zusätzlich, gleiche Position), stopLoss, takeProfit } (Preise in USDT je Coin, Einsatz in der Margin-Münze).
 * Ohne Angabe gilt die heutige Einstellung; Stop-Loss/Take-Profit nur, wenn
 * angegeben (die heutigen Pionex-Werte setzt der Aufrufer selbst ein).
 *
 * Geeicht am 11.11.2026 an 53 beendeten Pionex-Bots (1-Minuten-Kerzen von
 * Binance, Funding-Verlauf von Binance): mit Grid-Orders als Maker (höchstens
 * 0,02 %), Startposition und Schliessen als Taker (0,05 %) und `durchstich`
 * 2 bp lagen die Zyklen im Median bei 1,00 × Pionex, der Grid-Gewinn bei
 * 0,98 ×, das Gesamtergebnis 1,8 % des Einsatzes daneben; ohne Durchstich
 * zählte die Simulation 16 % zu viele Zyklen. Beim laufenden SOL-Coin-M-Bot
 * traf die Liquidationsschätzung 71,45 gegen 70,92 USD bei Pionex.
 */
export function simuliereBot(bot, kerzenUsd, { aenderung = {}, gebuehr = 0.0002, gebuehrMarkt = gebuehr, mmr = 0.005, ab, bis, startPreis, funding = null, durchstich = 0, marge = null, mengeFest = null } = {}) {
    const d = bot.roh || {}
    const coinM = !!bot.coinM
    const richtungApi = String(d.trend || '').toLowerCase()
    const richtung = richtungApi === 'no_trend' || richtungApi === 'neutral' ? 'neutral' : (richtungApi || 'long')
    const inv = (x) => (x > 0 ? 1 / x : null)

    const altUnten = coinM ? Number(d.bottom) : bot.grid.unten
    const altOben = coinM ? Number(d.top) : bot.grid.oben
    const altAnzahl = bot.grid.anzahl
    const art = aenderung.art || bot.grid.art || 'arithmetic'
    const bandNeu = aenderung.unten != null || aenderung.oben != null
    const usdUnten = aenderung.unten ?? bot.grid.unten
    const usdOben = aenderung.oben ?? bot.grid.oben
    const neuUnten = bandNeu ? (coinM ? inv(usdOben) : usdUnten) : altUnten
    const neuOben = bandNeu ? (coinM ? inv(usdUnten) : usdOben) : altOben
    const neuAnzahl = aenderung.anzahl ?? altAnzahl

    const einsatzAlt = (bot.einsatz?.basis ?? (coinM ? bot.einsatz?.aktuell : (bot.einsatz?.usdt ?? bot.einsatz?.aktuell))) ?? null
    const hebelAlt = bot.hebel || 1
    const hebelNeu = aenderung.hebel ?? hebelAlt
    // Pionex „Hebel anpassen" behält die Position und verlangt die Investition
    // Einsatz × alter Hebel ÷ neuer Hebel (gesehen 11.11.2026 in der App: 4x → 3x
    // bei 3,068 SOL verlangte +1,022 SOL, Liquidation 70,928 → 65,964). Ohne
    // eigene Angabe folgt der Einsatz also dem Hebel; das Nominal bleibt.
    const einsatzNeu = aenderung.einsatz ?? (aenderung.hebel != null && einsatzAlt != null ? einsatzAlt * hebelAlt / hebelNeu : einsatzAlt)
    const mengeAlt = bot.grid.mengeJeGrid
    let menge = (bandNeu || aenderung.anzahl != null || aenderung.art)
        ? mengeFuerGleichesKapital(mengeAlt, gridLinien(altUnten, altOben, altAnzahl, bot.grid.art), gridLinien(neuUnten, neuOben, neuAnzahl, art))
        : mengeAlt
    // Nominal = Einsatz × Hebel: die Menge je Grid folgt diesem Produkt. Ein reiner
    // Hebelwechsel ändert es nicht (der Einsatz gleicht aus), mehr Einsatz bei
    // gleichem Hebel vergrössert die Position (Pionex „Investition erhöhen").
    if (menge != null && einsatzAlt > 0 && einsatzNeu > 0 && hebelAlt > 0 && hebelNeu > 0) {
        menge *= (einsatzNeu * hebelNeu) / (einsatzAlt * hebelAlt)
    }

    // Extra-Marge (Pionex addMargin): mehr Marge, gleiche Position. Ein höherer
    // Hebel gibt Investition frei, Pionex schiebt sie in die dynamische Marge
    // (App 11.11.2026: 4x → 8x „Ausstieg 1,534 in dynamische Marge", Liquidation
    // unverändert 70,928) — die Marge insgesamt sinkt also nie durch den Hebel.
    const freiDurchHebel = aenderung.hebel != null && aenderung.einsatz == null && einsatzAlt != null && einsatzNeu < einsatzAlt ? einsatzAlt - einsatzNeu : 0
    if (mengeFest != null) menge = mengeFest
    const extra = (bot.einsatz?.extraMarge || 0) + (aenderung.extraMarge || 0) + freiDurchHebel
    const kerzen = coinM ? inverseKerzen(kerzenUsd) : kerzenUsd
    const start = startPreis != null ? (coinM ? inv(startPreis) : startPreis) : undefined

    // Stop-Loss / Take-Profit (USD) ins Instrument: Coin-M tauscht die Seiten
    const sl = aenderung.stopLoss ?? null, tp = aenderung.takeProfit ?? null
    const richtungCoin = coinM ? (richtung === 'short' ? 'long' : richtung === 'long' ? 'short' : 'neutral') : richtung
    let ausstiegUnten = null, ausstiegOben = null
    const marke = (usd, seiteUsd) => {
        if (usd == null) return
        if (!coinM) { if (seiteUsd === 'unten') ausstiegUnten = usd; else ausstiegOben = usd; return }
        if (seiteUsd === 'unten') ausstiegOben = inv(usd); else ausstiegUnten = inv(usd)
    }
    // Long der Coin: SL unten, TP oben; Short: umgekehrt; Neutral: SL ausserhalb beider Seiten nicht abbildbar → SL unten
    if (richtungCoin === 'short') { marke(sl, 'oben'); marke(tp, 'unten') } else { marke(sl, 'unten'); marke(tp, 'oben') }

    const r = simuliereGrid({
        kerzen, unten: neuUnten, oben: neuOben, anzahl: neuAnzahl, art, richtung, menge,
        // `marge` setzt die Marge direkt (Umstellen zum heutigen Kurs: das Eigenkapital
        // bleibt, die Position wird neu eröffnet), sonst Einsatz + Extra-Marge.
        startPreis: start, einsatz: marge != null ? marge + (aenderung.extraMarge || 0) : einsatzNeu != null ? einsatzNeu + extra : null, gebuehr, gebuehrMarkt, mmr, ab, bis,
        funding, fundingFaktor: coinM ? -1 : 1, ausstiegUnten, ausstiegOben, durchstich,
    })
    if (!r) return null
    const zuUsd = (x) => (x == null ? null : coinM ? inv(x) : x)
    const liqU = zuUsd(coinM ? r.liqSchaetzung.oben : r.liqSchaetzung.unten)
    const liqO = zuUsd(coinM ? r.liqSchaetzung.unten : r.liqSchaetzung.oben)
    return {
        ...r,
        einstellung: { unten: usdUnten, oben: usdOben, anzahl: neuAnzahl, art, menge, richtung, hebel: hebelNeu, einsatz: einsatzNeu, extraMarge: aenderung.extraMarge || 0, stopLoss: sl, takeProfit: tp },
        liquidation: r.liquidation ? { t: r.liquidation.t, preis: zuUsd(r.liquidation.preis) } : null,
        ausstieg: r.ausstieg ? { t: r.ausstieg.t, preis: zuUsd(r.ausstieg.preis), art: (coinM ? { unten: 'oben', oben: 'unten' }[r.ausstieg.art] : r.ausstieg.art) === 'unten' ? (richtungCoin === 'short' ? 'takeProfit' : 'stopLoss') : (richtungCoin === 'short' ? 'stopLoss' : 'takeProfit') } : null,
        liqSchaetzung: { unten: liqU, oben: liqO },
        startPreis: zuUsd(r.startPreis),
        endPreis: zuUsd(r.endPreis),
        einheit: bot.marginCoin,
    }
}
