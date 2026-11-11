/**
 * Bot-Planer: einen NEUEN Futures-Grid-Bot von Grund auf planen — rein, ohne Netz.
 *
 * Ein Plan hat dieselbe Form wie ein echter Bot (`planBot` baut ein rohes
 * Pionex-Objekt und schickt es durch `normalisiereBot`). So rechnen Simulation,
 * KI-Prüfung und der Start über die Steuerung ohne Sonderwege.
 *
 * Ablauf (routen in planer-routen.js):
 *  1. Der Code misst die Lage (Kurs, Tages-ATR, Niveaus auf 1w/1d/4h) und baut
 *     Kandidaten: Bänder eng/mittel/breit um den Kurs und Bänder knapp jenseits
 *     gemessener Niveaus, je mit dichten und weiten Grids, gerichtet auch mit
 *     Stop-Loss.
 *  2. Jeder Kandidat läuft durch die geeichte Grid-Simulation — RELATIV zum
 *     Kurs: dasselbe Band in Prozent um den Kurs, gestartet vor N Tagen. Ein
 *     Band in absoluten Preisen von heute sagt über die letzten Wochen nichts.
 *  3. Dazu „Start heute": Menge je Grid, Startposition und geschätzte
 *     Liquidation beim heutigen Kurs.
 *
 * Menge je Grid aus Einsatz × Hebel (Pionex rechnet sie selbst und nennt die
 * Formel nicht). Gemessen an 168 echten Futures-Grid-Bots des Entwicklers
 * (11.11.2026): Menge × Σ(Füllpreis je Zelle) / (Start-Einsatz × Hebel) lag im
 * Median bei 0,93 und bei den meisten zwischen 0,90 und 0,95 — Füllpreis =
 * Startkurs für die beim Start schon gefüllten Zellen, sonst die Linie, an der
 * die Zelle eröffnet. Den Rest behält Pionex offenbar für Gebühren und Puffer.
 * Neutrale Bots streuten stärker (0,46–0,95). Es bleibt eine Schätzung; die
 * Prüfung bei Pionex (checkParams) vor dem Start nennt die echte Liquidation.
 */
import { normalisiereBot, liqRisiko } from './pionex-bots.js'
import { gridLinien, simuliereBot } from '../../shared/grid-simulation.js'
import { GEBUEHREN } from './pionex-wissen.js'
import { niveausAusZeitrahmen } from './bot-ki.js'
import { DURCHSTICH, MMR_VORGABE } from './simulation.js'

export const PLAN_ID = 'plan'
export const PLAN_RESERVE = 0.93
export const RICHTUNGEN = ['LONG', 'SHORT', 'NEUTRAL']
export const PLAN_TAGE = [30, 60, 90]
export const MAX_PLAN_GRIDS = 500
export const MAX_HEBEL = 125
export const MAX_KANDIDATEN = 24
export const MAX_EIGENE = 3

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const leer = (v) => v === undefined || v === null || v === ''
const runde = (v, stellen = 6) => (istZahl(v) ? Number(v.toPrecision(stellen)) : v)
const zahlAus = (v) => {
    if (leer(v)) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
    const s = String(v).trim()
    return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN
}

/** Trend-Feld von Pionex: Coin-M ist invers, ein Long der Coin ist dort „short". */
export function trendFuer(richtung, coinM) {
    if (richtung === 'NEUTRAL') return 'no_trend'
    const long = richtung === 'LONG'
    return coinM ? (long ? 'short' : 'long') : (long ? 'long' : 'short')
}

/**
 * Menge je Grid (im Instrument) für Einsatz × Hebel, siehe Kopf. Rein.
 * `L` Linien im Instrument, `start` Startkurs im Instrument, `trend` Pionex-Trend.
 */
export function mengeJeGrid({ L, trend, start, einsatz, hebel, reserve = PLAN_RESERVE }) {
    if (!L?.length || L.length < 2 || !(start > 0) || !(einsatz > 0) || !(hebel > 0)) return null
    let nominal = 0
    for (let i = 0; i < L.length - 1; i++) {
        const lo = L[i], hi = L[i + 1]
        let p
        if (trend === 'long') p = hi > start ? start : lo            // über dem Kurs beim Start gekauft
        else if (trend === 'short') p = lo < start ? start : hi      // unter dem Kurs beim Start verkauft
        else p = hi <= start ? lo : lo >= start ? hi : start
        nominal += p
    }
    return nominal > 0 ? reserve * einsatz * hebel / nominal : null
}

/**
 * Ein Plan als Bot (Form von normalisiereBot). Preise in USD je Coin.
 * @param e { coin, coinM, richtung, unten, oben, anzahl, art, hebel, einsatz, startKurs, start, kurs }
 */
export function planBot(e) {
    const coinM = !!e.coinM
    const art = e.art === 'geometric' ? 'geometric' : 'arithmetic'
    const iu = coinM ? 1 / e.oben : e.unten, io = coinM ? 1 / e.unten : e.oben
    const trend = trendFuer(e.richtung, coinM)
    const startInst = coinM ? 1 / e.startKurs : e.startKurs
    const q = mengeJeGrid({ L: gridLinien(iu, io, e.anzahl, art), trend, start: startInst, einsatz: e.einsatz, hebel: e.hebel })
    const d = {
        top: String(io), bottom: String(iu), row: e.anzahl, gridType: art, trend,
        leverage: String(e.hebel), quoteInvestment: String(e.einsatz), initQuoteInvestment: String(e.einsatz),
        perVolume: q != null ? String(q) : '', status: 'plan', initPrice: String(startInst),
        ...(coinM
            ? { cateType: 'FUTURE_GRID_COIN_MARGINED', investCoin: e.coin, uiExtraData: '{"mode":"coin_margin","custom_type":"normal"}' }
            : { investCoin: 'USDT', usdtInvestment: String(e.einsatz), initUsdtInvestment: String(e.einsatz) }),
    }
    const o = {
        buOrderId: PLAN_ID, buOrderType: 'futures_grid', createTime: e.start ?? Date.now(),
        base: coinM ? 'USDT.PERP' : `${e.coin}.PERP`, quote: coinM ? e.coin : 'USDT', buOrderData: d,
    }
    const b = normalisiereBot(o)
    b.plan = true
    b.laufend = false
    b.kurs = e.kurs ?? null
    b.name = null
    return b
}

/** Eingabe des Planers prüfen. `coins` = Map coin → {linear, coinM} (aus der Symboltabelle). */
export function pruefePlanEingabe(e, coins = null) {
    const coin = String(e?.coin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{1,15}$/.test(coin)) return { fehler: 'coin' }
    const coinM = e?.coinM === true
    if (coins) {
        const c = coins.get(coin)
        if (!c || !(coinM ? c.coinM : c.linear)) return { fehler: 'coinNichtHandelbar' }
    }
    const richtung = String(e?.richtung || '').toUpperCase()
    if (!RICHTUNGEN.includes(richtung)) return { fehler: 'richtung' }
    const einsatz = zahlAus(e?.einsatz)
    if (!istZahl(einsatz) || einsatz <= 0) return { fehler: 'einsatz' }
    const hebel = zahlAus(e?.hebel)
    if (!Number.isInteger(hebel) || hebel < 1 || hebel > MAX_HEBEL) return { fehler: 'hebel' }
    const tage = Number(e?.tage ?? 30)
    if (!PLAN_TAGE.includes(tage)) return { fehler: 'tage' }
    return { coin, coinM, richtung, einsatz, hebel, tage }
}

/** Eine Band-Variante prüfen (eigene Eingabe oder Übernahme). Preise USD. */
export function pruefePlanVariante(v, kurs, richtung) {
    const unten = zahlAus(v?.unten), oben = zahlAus(v?.oben), anzahl = zahlAus(v?.anzahl)
    if (!istZahl(unten) || !istZahl(oben) || unten <= 0 || oben <= unten) return { fehler: 'band' }
    if (istZahl(kurs) && kurs > 0) {
        if (oben < kurs / 5 || unten > kurs * 5) return { fehler: 'weitWeg' }
        if (!(unten < kurs && kurs < oben)) return { fehler: 'kursAusserhalb' }
    }
    if (!Number.isInteger(anzahl) || anzahl < 2 || anzahl > MAX_PLAN_GRIDS) return { fehler: 'anzahl' }
    const aus = { unten, oben, anzahl, art: v?.art === 'geometric' ? 'geometric' : 'arithmetic' }
    const sl = zahlAus(v?.stopLoss), tp = zahlAus(v?.takeProfit)
    if (Number.isNaN(sl) || Number.isNaN(tp)) return { fehler: Number.isNaN(sl) ? 'stopLoss' : 'takeProfit' }
    if (sl != null || tp != null) {
        if (richtung === 'NEUTRAL') return { fehler: 'neutralStop' }
        const long = richtung === 'LONG'
        if (sl != null && (sl <= 0 || (istZahl(kurs) && (long ? sl >= kurs : sl <= kurs)))) return { fehler: 'stopLoss' }
        if (tp != null && (tp <= 0 || (istZahl(kurs) && (long ? tp <= kurs : tp >= kurs)))) return { fehler: 'takeProfit' }
        if (sl != null) aus.stopLoss = sl
        if (tp != null) aus.takeProfit = tp
    }
    return aus
}

/** Anzahl Grids für einen Abstand `schritt` (Anteil) im Band. */
export function anzahlFuerSchritt(unten, oben, schritt, art = 'arithmetic') {
    if (!(unten > 0) || !(oben > unten) || !(schritt > 0)) return null
    const n = art === 'geometric' ? Math.log(oben / unten) / Math.log(1 + schritt) : (oben - unten) / (schritt * (oben + unten) / 2)
    return Math.max(2, Math.min(MAX_PLAN_GRIDS, Math.round(n)))
}

/**
 * Kandidaten aus der Lage (rein). Preise USD je Coin.
 * Bänder um den Kurs in Tages-ATR und an gemessenen Niveaus; je zwei Dichten.
 */
export function planKandidaten({ kurs, atr, zr = null, richtung }) {
    if (!istZahl(kurs) || kurs <= 0 || !istZahl(atr) || atr <= 0) return []
    const a = atr
    const long = richtung === 'LONG', neutral = richtung === 'NEUTRAL'
    const baender = []
    const band = (titel, u, o) => {
        if (!(u > 0) || !(o > u) || !(u < kurs && kurs < o)) return
        // Fast gleiche Bänder nur einmal
        if (baender.some((b) => Math.abs(b.unten - u) < 0.5 * a && Math.abs(b.oben - o) < 0.5 * a)) return
        baender.push({ titel, unten: runde(u, 5), oben: runde(o, 5) })
    }
    // Abstände in Tages-ATR unter/über dem Kurs; gerichtet mehr Raum in Gewinnrichtung.
    // Im Testcontainer 11.11.2026 gegen SOL/BTC/ETH: 4/6 und 14 ATR ergaben bei 5 % ATR
    // „eng" ±25 % und „breit" −70 % — zu weit für das, was die Namen sagen.
    const um = neutral
        ? [['eng', 4, 4], ['mittel', 7, 7], ['breit', 11, 11]]
        : long ? [['eng', 3, 4], ['mittel', 6, 8], ['breit', 10, 12]] : [['eng', 4, 3], ['mittel', 8, 6], ['breit', 12, 10]]
    for (const [name, unter, ueber] of um) band(`Band ${name} um den Kurs`, kurs - unter * a, kurs + ueber * a)
    // An Niveaus der hohen Zeitrahmen: Grenzen ½ Tages-ATR jenseits, mindestens 3 ATR breit
    const nv = niveausAusZeitrahmen(zr, kurs)
    for (const nu of nv.unten) for (const no of nv.oben) {
        const u = nu.preis - 0.5 * a, o = no.preis + 0.5 * a
        if (o - u >= 3 * a) band(`Band an Niveaus ${nu.name} bis ${no.name}`, u, o)
    }

    const liste = []
    const neu = (titel, variante) => { if (liste.length < MAX_KANDIDATEN) liste.push({ id: `P${liste.length + 1}`, titel, variante }) }
    const atrAnteil = a / kurs
    // Abstand je Grid: dicht ≈ 0,1 Tages-ATR (min 0,25 %), weit ≈ 0,25 Tages-ATR (min 0,6 %).
    // Unter ~0,1 % fressen die Gebühren (2 × Maker 0,02 %) den Zyklus.
    const dichten = [['dichte Grids', Math.max(0.0025, 0.1 * atrAnteil)], ['weite Grids', Math.max(0.006, 0.25 * atrAnteil)]]
    for (const b of baender) {
        const gesehen = new Set()
        for (const [dName, schritt] of dichten) {
            const anzahl = anzahlFuerSchritt(b.unten, b.oben, schritt)
            if (anzahl == null || gesehen.has(anzahl)) continue
            gesehen.add(anzahl)
            neu(`${b.titel}, ${dName}`, { unten: b.unten, oben: b.oben, anzahl, art: 'arithmetic' })
        }
        // Gerichtet: dieselbe dichte Variante mit Stop-Loss 1 Tages-ATR jenseits der Gegengrenze
        if (!neutral) {
            const sl = long ? b.unten - a : b.oben + a
            const anzahl = anzahlFuerSchritt(b.unten, b.oben, dichten[0][1])
            if (sl > 0 && anzahl != null) neu(`${b.titel}, dichte Grids, Stop-Loss ${runde(sl, 4)}`, { unten: b.unten, oben: b.oben, anzahl, art: 'arithmetic', stopLoss: runde(sl, 5) })
        }
    }
    return liste
}

/** Gebühren für einen neuen Bot: Grid-Orders Maker, Start/Schluss Taker. */
export function planGebuehren() {
    return { gebuehr: GEBUEHREN.futures.maker, gebuehrMarkt: GEBUEHREN.futures.taker }
}

function kurz(r) {
    if (!r) return null
    return {
        gesamt: r.gesamt, gridGewinn: r.gridGewinn, realisiert: r.realisiert, schwebend: r.schwebend,
        gebuehren: r.gebuehren, funding: r.funding, zyklen: r.zyklen, position: r.position, maxVerlust: r.maxVerlust,
        zeitImBand: r.zeitImBand, liquidation: r.liquidation, ausstieg: r.ausstieg, menge: r.menge,
        startPreis: r.startPreis, endPreis: r.endPreis,
        kurve: (r.kurve || []).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 200)) === 0 || i === a.length - 1),
    }
}

/**
 * Einen Kandidaten rechnen: Start heute (Menge, Position, Liquidation) und der
 * relative Rückblick über `kerzen` (USD, aufsteigend). Rein.
 * @param e  geprüfte Eingabe (pruefePlanEingabe)
 * @param v  Variante {unten, oben, anzahl, art, stopLoss?, takeProfit?}
 * @param opt { kurs, funding, mmr, minMenge }
 */
export function rechnePlanVariante(e, v, kerzen, { kurs, funding = null, mmr = MMR_VORGABE, minMenge = null } = {}) {
    const geb = planGebuehren()
    const warnungen = []
    let anzahl = v.anzahl
    // Pionex verlangt eine Mindestmenge je Order: zu viele Grids für den Einsatz → weniger Grids
    if (istZahl(minMenge) && minMenge > 0) {
        const probe = planBot({ ...e, ...v, anzahl, startKurs: kurs, kurs })
        const q = probe.grid.mengeJeGrid
        if (istZahl(q) && q < minMenge) {
            const neu = Math.floor(anzahl * q / minMenge)
            if (neu < 2) return { fehler: 'einsatzZuKlein' }
            anzahl = neu
            warnungen.push('gridsGekuerzt')
        }
    }
    const variante = { ...v, anzahl }
    const heute = planBot({ ...e, ...variante, startKurs: kurs, kurs })
    const jetzt = [{ t: Date.now(), o: kurs, h: kurs, l: kurs, c: kurs }]
    const probe = simuliereBot(heute, jetzt, { ...geb, mmr, startPreis: kurs })
    const liq = probe ? liqRisiko(e.richtung, probe.liqSchaetzung, kurs) : null
    const liqAbstand = istZahl(liq) ? Math.abs(kurs - liq) / kurs : null
    if (istZahl(liq) && (e.richtung === 'LONG' ? liq > variante.unten : e.richtung === 'SHORT' ? liq < variante.oben : (liq > variante.unten && liq < variante.oben))) warnungen.push('liqImBand')
    if (istZahl(liqAbstand) && liqAbstand < 0.1) warnungen.push('liqNah')
    if (istZahl(variante.stopLoss) && istZahl(liq) && (e.richtung === 'LONG' ? variante.stopLoss <= liq : variante.stopLoss >= liq)) warnungen.push('stopHinterLiq')
    if (istZahl(heute.grid.nettoJeZyklus) && heute.grid.nettoJeZyklus <= 0) warnungen.push('gebuehrFrisst')
    const start = {
        menge: heute.grid.mengeJeGrid, position: probe?.position ?? null, liq, liqAbstand,
        // Startposition in USD, Vorzeichen = Richtung der Coin (Coin-M: Instrument „USDT in Coin" invers)
        nominalUsd: istZahl(probe?.position) ? (e.coinM ? -probe.position : probe.position * kurs) : null,
        abstand: heute.grid.abstand, nettoJeZyklus: heute.grid.nettoJeZyklus,
        startGebuehr: probe?.gebuehren ?? null,
    }

    // Rückblick relativ zum Kurs: Band, Stops in Prozent um den Kurs, gestartet beim ersten Kerzenkurs
    let rueckblick = null
    if (kerzen?.length) {
        const k0 = kerzen[0].o
        const f = k0 / kurs
        const alt = planBot({ ...e, ...variante, unten: variante.unten * f, oben: variante.oben * f, startKurs: k0, start: kerzen[0].t })
        const aenderung = {}
        if (istZahl(variante.stopLoss)) aenderung.stopLoss = variante.stopLoss * f
        if (istZahl(variante.takeProfit)) aenderung.takeProfit = variante.takeProfit * f
        rueckblick = kurz(simuliereBot(alt, kerzen, { ...geb, mmr, funding, durchstich: DURCHSTICH, startPreis: k0, aenderung }))
        if (rueckblick) rueckblick.faktor = f
    }
    return { variante, start, rueckblick, warnungen }
}

/** Alle Kandidaten (und eigene Varianten) rechnen. */
export function rechnePlan(e, kerzen, liste, opt) {
    const aus = []
    const gesehen = new Set()
    for (const c of liste) {
        const r = rechnePlanVariante(e, c.variante, kerzen, opt)
        if (r.fehler) { aus.push({ ...c, fehler: r.fehler }); continue }
        // Nach dem Kürzen auf die Mindestmenge können Varianten gleich werden — nur einmal zeigen
        const v = r.variante
        const schluessel = [v.unten, v.oben, v.anzahl, v.art, v.stopLoss ?? '', v.takeProfit ?? ''].join('|')
        if (gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        // `abJetzt` trägt „Start heute" für die gemeinsame KI-Prüfung (pruefeKiAntwort)
        aus.push({ ...c, variante: r.variante, start: r.start, abJetzt: r.start, rueckblick: r.rueckblick, warnungen: r.warnungen })
    }
    return aus
}

// ── KI ───────────────────────────────────────────────────────────────────
const pz = (v, s = 1) => (istZahl(v) ? `${(v * 100).toFixed(s)} %` : '—')
const zl = (v, s = 4) => (istZahl(v) ? Number(v).toFixed(s) : '—')

/** Prompt für die Auswahl unter den Plan-Kandidaten. `wissen` = wissenAlsText(typ), `zrText` = Zeitrahmen-Block. */
export function bauePlanPrompt(e, { wissen = '', lage = null, zrText = '', kandidaten = [], tf = null, englisch = false } = {}) {
    const einheit = e.coinM ? e.coin : 'USDT'
    const kopf = [
        wissen, '',
        `NEUER BOT (Plan, noch nicht gestartet): ${e.coin} ${e.coinM ? 'Coin-M' : 'USDT-M'} Futures-Grid, Richtung ${e.richtung}, Hebel ${e.hebel}x, Einsatz ${zl(e.einsatz)} ${einheit}`,
        `Kurs ${zl(lage?.kurs)} USD`,
    ]
    const markt = lage ? [`MARKT: 7 Tage ${pz(lage.aenderung7)}, 30 Tage ${pz(lage.aenderung30)}, 30-Tage-Hoch ${zl(lage.hoch30, 2)}, -Tief ${zl(lage.tief30, 2)}, Tagesspanne Median ${pz(lage.spanneMedian)} / max ${pz(lage.spanneMax)}, grösster 7-Tage-Fall ${pz(lage.maxFall7)}, Tages-ATR ${zl(lage.atr, 2)}`] : []
    const zeilen = kandidaten.filter((c) => !c.fehler).map((c) => {
        const r = c.rueckblick, s = c.start, v = c.variante
        const ende = r?.liquidation ? 'LIQUIDIERT' : r?.ausstieg ? r.ausstieg.art : 'läuft'
        return [c.id, c.titel, `${zl(v.unten, 2)}–${zl(v.oben, 2)}`, v.anzahl, pz(s?.nettoJeZyklus, 2), zl(r?.gesamt), pz(istZahl(r?.gesamt) ? r.gesamt / e.einsatz : null), zl(r?.maxVerlust), ende, pz(r?.zeitImBand, 0), r?.zyklen ?? '—', zl(s?.liq, 2), pz(s?.liqAbstand), (c.warnungen || []).join(',') || '—'].join(' | ')
    })
    return [
        ...kopf, ...markt, ...(zrText ? ['', zrText] : []),
        '',
        `KANDIDATEN (vom Code gerechnet). Rückblick = dasselbe Band RELATIV zum Kurs (gleiche Prozente), gestartet vor ${e.tage} Tagen, simuliert auf ${tf || '?'}-Kerzen mit Gebühren${kandidaten.some((c) => c.rueckblick?.funding) ? ' und Funding' : ''}. Start heute = beim heutigen Kurs gestartet.`,
        `id | Beschreibung | Band USD | Grids | netto je Zyklus | Rückblick Ergebnis ${einheit} | in % des Einsatzes | Rückblick grösster Verlust | Rückblick Ende | Zeit im Band | Zyklen | Start heute: Liquidation | Abstand | Warnungen`,
        ...zeilen,
        '',
        englisch ? 'Answer in English.' : 'Antworte auf Deutsch (Schweizer Schreibweise, ss statt ß).',
    ].join('\n')
}

export function planSystemText() {
    return [
        'Du bist der Bot-Assistent von AutarkTrade. Der Nutzer plant einen NEUEN Pionex-Futures-Grid-Bot und hat dafür ausdrücklich konkrete Vorschläge freigegeben.',
        'Du bekommst Zahlen, die der Code gerechnet hat. Du rechnest NICHT selbst und nennst KEINE Zahl, die nicht in der Eingabe steht.',
        'Wähle aus den KANDIDATEN höchstens drei und begründe sie mit den Zahlen. Wenn keiner sinnvoll ist (z. B. alle liquidiert oder die Lage passt nicht zur gewählten Richtung), wähle keinen und sag warum.',
        'Der Rückblick zeigt nur, wie sich dieselbe Einstellung in den letzten Wochen geschlagen hätte; er sagt nichts über die Zukunft. Gewichte den Liquidationsabstand beim Start heute und den grössten Verlust mindestens so stark wie das Ergebnis.',
        'Beziehe die HOHEN ZEITRAHMEN ein: Struktur und Bruch auf 1w/1d/4h, wo der Kurs in seiner Spanne steht, ob die Bandgrenzen und der Stop-Loss an, über oder unter gemessenen Niveaus (Z…, Zusammentreffen C…) liegen und ob die gewählte Richtung zur Struktur passt. Nenne Niveaus nur mit ID und Preis aus der Eingabe.',
        'Nenne bei jedem Vorschlag das wichtigste Risiko und wann er nicht passt. Kein Gewinnversprechen, keine Kursprognose als Tatsache, nicht „garantiert", nicht „risikolos", nicht „optimal".',
        'Antworte NUR mit JSON: {"lage": "2–4 Sätze zur Lage für diesen Bot", "vorschlaege": [{"id": "P3", "titel": "kurz", "begruendung": "2–3 Sätze", "risiko": "1 Satz", "passtNichtWenn": "1 Satz"}], "hinweis": "optional, 1 Satz"}',
    ].join('\n')
}
