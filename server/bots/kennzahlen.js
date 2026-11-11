/**
 * Kennzahlen eines Bots — rein, ohne Netz.
 *
 * Eingabe ist ein Bot aus `normalisiereBot` (Preise in USDT je Coin) plus der
 * aktuelle Kurs und, wo vorhanden, Kerzen der Laufzeit. Ergebnisse in der
 * Margin-Münze (USDT, bei Coin-M die Coin).
 *
 * Gewinn eines LAUFENDEN Bots: Pionex liefert keinen schwebenden PnL als Feld.
 * Dieselbe Rechnung wie die Pendente Trades (`normalizeRunningBot`, gegen die
 * Pionex-Oberfläche geprüft): realisiert = Marge − (Einsatz + Extra-Marge),
 * schwebend = Position × (Kurs − Einstieg), bei Coin-M invers
 * Position × (1/Kurs − 1/Einstieg).
 *
 * Hinweise sind Codes (i18n `bots.hinweis.*`) und beschreiben nur, was ist —
 * keine Empfehlung. Empfehlungen macht erst die KI-Optimierung, mit Nachrechnung.
 */
import { atr } from '../../shared/indicators.js'

const TAG_MS = 86_400_000
const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)

/** Grenze, ab der der Abstand zur Liquidation als nah gilt (Anteil vom Kurs). */
export const LIQ_NAH = 0.15
/** Laufzeit, ab der eine Hochrechnung aufs Jahr gezeigt wird (Tage). */
export const MIN_TAGE_JAHR = 7
/** Netto-Gewinn je Zyklus, unter dem ein Grid als zu eng gilt (Anteil). */
export const ZYKLUS_KNAPP = 0.001

/** Gewinn in der Margin-Münze: realisiert, schwebend, gesamt. */
export function gewinn(bot, kurs) {
    const e = bot.einsatz || {}
    const basis = bot.coinM ? e.aktuell : (e.usdt ?? e.aktuell)
    if (!bot.laufend) {
        // Beendet: linear ist totalRealizedProfit das Wallet-Delta; Coin-M aus der Marge.
        if (bot.coinM && istZahl(e.marge) && istZahl(basis)) {
            const g = e.marge - (basis + (e.extraMarge || 0))
            return { realisiert: g, schwebend: 0, gesamt: g, basis }
        }
        const g = bot.ergebnis?.gesamt
        return { realisiert: istZahl(g) ? g : null, schwebend: 0, gesamt: istZahl(g) ? g : null, basis: istZahl(basis) ? basis : null }
    }
    if (!istZahl(e.marge) || !istZahl(basis)) return { realisiert: null, schwebend: null, gesamt: null, basis: istZahl(basis) ? basis : null }
    const realisiert = e.marge - (basis + (e.extraMarge || 0))
    const menge = bot.position?.menge, einstieg = bot.position?.einstieg
    let schwebend = null
    if (istZahl(menge) && istZahl(einstieg) && einstieg > 0 && istZahl(kurs) && kurs > 0) {
        schwebend = bot.coinM ? menge * (1 / kurs - 1 / einstieg) : menge * (kurs - einstieg)
    } else if (menge === 0) schwebend = 0
    return { realisiert, schwebend, gesamt: schwebend == null ? null : realisiert + schwebend, basis }
}

/** Wo steht der Kurs zum Band? */
export function lageImBand(kurs, unten, oben) {
    if (!istZahl(kurs) || !istZahl(unten) || !istZahl(oben) || oben <= unten) return null
    const lage = kurs < unten ? 'darunter' : kurs > oben ? 'darueber' : 'innen'
    return {
        lage,
        anteil: (kurs - unten) / (oben - unten),          // 0 = Untergrenze, 1 = Obergrenze
        abstandUnten: (kurs - unten) / kurs,               // > 0: Kurs über der Untergrenze
        abstandOben: (oben - kurs) / kurs,                 // > 0: Kurs unter der Obergrenze
    }
}

/**
 * Abstand zur nächsten Liquidation, als Anteil vom Kurs (immer ≥ 0 solange
 * nicht erreicht). Long liquidiert unten, Short oben, Neutral auf beiden Seiten.
 */
export function liquidationsAbstand(bot, kurs, atrTag = null) {
    if (!istZahl(kurs) || kurs <= 0) return null
    const l = bot.liquidation || {}
    const kandidaten = []
    const unten = istZahl(l.unten) ? l.unten : (bot.richtung === 'LONG' ? l.preis : null)
    const oben = istZahl(l.oben) ? l.oben : (bot.richtung === 'SHORT' ? l.preis : null)
    if (bot.richtung !== 'SHORT' && istZahl(unten) && unten < kurs) kandidaten.push({ seite: 'unten', preis: unten, abstand: (kurs - unten) / kurs })
    if (bot.richtung !== 'LONG' && istZahl(oben) && oben > kurs) kandidaten.push({ seite: 'oben', preis: oben, abstand: (oben - kurs) / kurs })
    // Ein Short mit nur „unten" (Coin-M-Schätzung) ist kein Kandidat — Seite passt nicht.
    if (!kandidaten.length) return null
    const n = kandidaten.sort((a, b) => a.abstand - b.abstand)[0]
    return { ...n, inAtr: istZahl(atrTag) && atrTag > 0 ? (n.abstand * kurs) / atrTag : null }
}

/** Anteil der Kerzen-Schlusskurse im, unter und über dem Band; nur Kerzen ab `ab`. */
export function zeitImBand(kerzen, unten, oben, ab = 0, bis = Infinity) {
    if (!Array.isArray(kerzen) || !istZahl(unten) || !istZahl(oben)) return null
    let innen = 0, darunter = 0, darueber = 0
    for (const k of kerzen) {
        if (k.t < ab || k.t > bis || !istZahl(k.c)) continue
        if (k.c < unten) darunter++
        else if (k.c > oben) darueber++
        else innen++
    }
    const n = innen + darunter + darueber
    if (!n) return null
    return { innen: innen / n, darunter: darunter / n, darueber: darueber / n, kerzen: n }
}

/** ATR der Tageskerzen (letzter Wert) — die übliche Tagesbewegung in USDT. */
export function atrTag(tagesKerzen, laenge = 14) {
    if (!Array.isArray(tagesKerzen) || tagesKerzen.length < laenge) return null
    const a = atr(tagesKerzen, laenge)
    for (let i = a.length - 1; i >= 0; i--) if (istZahl(a[i])) return a[i]
    return null
}

/** Alle Kennzahlen eines Bots. `markt` = { kurs, atrTag, kerzen } — jedes Feld darf fehlen. */
export function kennzahlen(bot, markt = {}, jetzt = Date.now()) {
    const kurs = istZahl(markt.kurs) ? markt.kurs : (bot.laufend ? null : bot.position?.schlussPreis ?? null)
    const ende = bot.beendet || jetzt
    const tage = istZahl(bot.erstellt) ? Math.max((ende - bot.erstellt) / TAG_MS, 1 / 24) : null
    const g = gewinn(bot, markt.kurs)
    const r = (wert) => (istZahl(wert) && istZahl(g.basis) && g.basis > 0 ? wert / g.basis : null)
    const rendite = r(g.gesamt)
    const gridRendite = r(bot.ergebnis?.gridGewinn)
    // Hochrechnung aufs Jahr erst ab MIN_TAGE_JAHR Laufzeit: −79 % in einem Monat
    // ergab „−941 % aufs Jahr", 1,5 Tage „+2176 %" — Zahlen ohne Bedeutung.
    // Ein Verlust, hochgerechnet über −100 %, ist ebenso leer (mehr als alles verlieren geht nicht).
    const jahr = (anteil) => {
        if (!istZahl(anteil) || !(tage >= MIN_TAGE_JAHR)) return null
        const j = anteil / tage * 365
        return j < -1 ? null : j
    }

    const band = bot.laufend ? lageImBand(kurs, bot.grid?.unten, bot.grid?.oben) : null
    const liq = bot.laufend ? liquidationsAbstand(bot, kurs, markt.atrTag) : null
    const zeit = markt.kerzen ? zeitImBand(markt.kerzen, bot.grid?.unten, bot.grid?.oben, bot.erstellt || 0, ende) : null
    const bandInAtr = istZahl(markt.atrTag) && markt.atrTag > 0 && istZahl(bot.grid?.oben) && istZahl(bot.grid?.unten)
        ? (bot.grid.oben - bot.grid.unten) / markt.atrTag : null

    const hinweise = []
    if (band?.lage === 'darunter') hinweise.push('unterBand')
    if (band?.lage === 'darueber') hinweise.push('ueberBand')
    if (liq && liq.abstand < LIQ_NAH) hinweise.push('liqNah')
    if (bot.laufend && bot.hebel > 1 && !bot.stops?.stopLoss) hinweise.push('ohneStop')
    if (istZahl(bot.grid?.nettoJeZyklus) && bot.grid.nettoJeZyklus < ZYKLUS_KNAPP) hinweise.push('gridEng')
    if (bot.laufend && bot.ergebnis?.trades24h === 0) hinweise.push('keineTrades24h')
    if (istZahl(g.gesamt) && istZahl(bot.ergebnis?.gridGewinn) && bot.ergebnis.gridGewinn > 0 && g.gesamt < 0) hinweise.push('gridPlusGesamtMinus')
    if (bot.endGrund === 'force_liquidation') hinweise.push('liquidiert')

    return {
        tage,
        gewinn: g,
        rendite: { gesamt: rendite, proTag: istZahl(rendite) && tage ? rendite / tage : null, jahr: jahr(rendite) },
        gridRendite: { gesamt: gridRendite, jahr: jahr(gridRendite) },
        zyklenProTag: istZahl(bot.ergebnis?.zyklen) && tage ? bot.ergebnis.zyklen / tage : null,
        band, liquidation: liq, zeitImBand: zeit, bandInAtr,
        hinweise,
    }
}
