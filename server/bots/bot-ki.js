/**
 * KI-Vorschläge für einen Grid-Bot (Schritt 4 der Bot-Seite).
 *
 * Nach dem Muster der Chart-KI: der CODE misst, die KI wählt. `kandidaten`
 * erzeugt einen festen Satz von Varianten aus der Lage des Bots (Extra-Marge,
 * weniger Hebel, Band um den heutigen Kurs, Stop-Loss über der Liquidation,
 * Kombinationen), die Simulation rechnet jede davon — Rückblick über die
 * Laufzeit UND was ein Umstellen jetzt bewirkt. Die KI bekommt diese Zahlen,
 * das Wissen über den Bot-Typ und die Marktlage und darf nur Kandidaten-IDs
 * wählen und begründen. Sie kann keine Zahl erfinden, die nicht nachgerechnet ist.
 *
 * Ausnahme von der Empfehlungs-Sperre (S12): nur hier dürfen konkrete
 * Vorschläge stehen (Entscheid des Entwicklers 11.11.2026). Wörter nach der
 * rechtlichen Recherche: „Vorschlag", nie „Empfehlung/Beratung/optimal";
 * Gewinnversprechen werden verworfen. Jede Ausgabe trägt kiGeneriert.
 */
import { wissenAlsText, TYPEN } from './pionex-wissen.js'
import { vergleiche, MAX_VARIANTEN } from './simulation.js'

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const runde = (v, stellen = 6) => (istZahl(v) ? Number(v.toPrecision(stellen)) : v)

export const MAX_VORSCHLAEGE = 3

/** Marktlage aus Tageskerzen (aufsteigend). */
export function marktLage(tagesKerzen, kurs) {
    const k = (tagesKerzen || []).filter((x) => istZahl(x.c))
    if (k.length < 8) return null
    const letzte = (n) => k.slice(-n)
    const vor = (n) => k[Math.max(0, k.length - 1 - n)].c
    const spannen = letzte(30).map((x) => (x.h - x.l) / x.o).sort((a, b) => a - b)
    const p = istZahl(kurs) ? kurs : k[k.length - 1].c
    let maxFall7 = 0
    for (let i = 7; i < k.length; i++) maxFall7 = Math.min(maxFall7, (k[i].l - k[i - 7].c) / k[i - 7].c)
    return {
        kurs: p,
        aenderung7: p / vor(7) - 1,
        aenderung30: k.length > 30 ? p / vor(30) - 1 : null,
        hoch30: Math.max(...letzte(30).map((x) => x.h)),
        tief30: Math.min(...letzte(30).map((x) => x.l)),
        spanneMedian: spannen[Math.floor(spannen.length / 2)],
        spanneMax: spannen[spannen.length - 1],
        maxFall7,
    }
}

/**
 * Kandidaten aus der Lage. Preise in USDT je Coin, Beträge in der Margin-Münze.
 * Nur, was die Simulation rechnen kann; jeder Kandidat mit Code-Beschreibung.
 */
export function kandidaten(bot, kurs, atr) {
    const liste = []
    const neu = (titel, v) => { if (Object.keys(v).length) liste.push({ id: `K${liste.length + 1}`, titel, variante: v }) }
    const einsatz = bot.coinM ? bot.einsatz?.aktuell : (bot.einsatz?.usdt ?? bot.einsatz?.aktuell)
    const long = bot.richtung !== 'SHORT'
    const u = bot.grid?.unten, o = bot.grid?.oben
    const hatAtr = istZahl(atr) && atr > 0 && istZahl(kurs)

    if (istZahl(einsatz) && einsatz > 0) {
        for (const f of [0.25, 0.5, 1]) neu(`Extra-Marge +${Math.round(f * 100)} % des Einsatzes`, { extraMarge: runde(einsatz * f, 4) })
    }
    if (bot.hebel > 1) {
        const h = new Set([Math.max(1, Math.round(bot.hebel / 2)), Math.max(1, bot.hebel - 1)])
        for (const x of h) if (x < bot.hebel) neu(`Hebel ${x} statt ${bot.hebel}`, { hebel: x })
    }
    if (hatAtr && istZahl(u) && istZahl(o) && bot.richtung !== 'NEUTRAL') {
        // Band so legen, dass der Kurs wieder im Band liegt: eng (±4 ATR) und breit (−8/+10 ATR)
        const eng = long ? [kurs - 4 * atr, kurs + 6 * atr] : [kurs - 6 * atr, kurs + 4 * atr]
        const breit = long ? [kurs - 8 * atr, kurs + 10 * atr] : [kurs - 10 * atr, kurs + 8 * atr]
        for (const [titel, [a, b]] of [['Band eng um den Kurs', eng], ['Band breit um den Kurs', breit]]) {
            if (a > 0 && b > a) neu(`${titel} (${runde(a, 4)}–${runde(b, 4)})`, { unten: runde(a, 5), oben: runde(b, 5) })
        }
        // Untergrenze nur nach unten verlängern, Obergrenze bleibt
        if (long && kurs < u) { const a = kurs - 6 * atr; if (a > 0) neu(`Untergrenze auf ${runde(a, 4)} senken`, { unten: runde(a, 5), oben: o }) }
        if (!long && kurs > o) { const b = kurs + 6 * atr; neu(`Obergrenze auf ${runde(b, 4)} heben`, { unten: u, oben: runde(b, 5) }) }
    }
    const liq = long ? bot.liquidation?.unten ?? bot.liquidation?.preis : bot.liquidation?.oben ?? bot.liquidation?.preis
    if (hatAtr && istZahl(liq) && bot.richtung !== 'NEUTRAL') {
        const sl1 = long ? liq + atr : liq - atr
        const sl2 = long ? kurs - 2 * atr : kurs + 2 * atr
        for (const sl of [sl1, sl2]) {
            const ok = long ? sl > liq && sl < kurs : sl < liq && sl > kurs
            if (ok && sl > 0) neu(`Stop-Loss bei ${runde(sl, 4)}`, { stopLoss: runde(sl, 5) })
        }
    }
    // Kombinationen: halber Hebel + breites Band; Extra-Marge 50 % + Stop-Loss
    const breitK = liste.find((k) => k.titel.startsWith('Band breit'))
    const halbH = liste.find((k) => k.variante.hebel && k.variante.hebel === Math.max(1, Math.round(bot.hebel / 2)))
    if (breitK && halbH) neu(`${breitK.titel.split(' (')[0]} und ${halbH.titel}`, { ...breitK.variante, hebel: halbH.variante.hebel })
    // Band neu legen ohne frisches Geld erhöht bei Pionex das Risiko (Position bleibt, Grid wächst nach
    // unten) — darum auch jede Band-Variante zusammen mit Extra-Marge 100 % des Einsatzes.
    const em100 = liste.find((k) => k.titel.startsWith('Extra-Marge +100'))
    if (em100) for (const b of liste.filter((k) => k.variante.unten != null && !k.variante.hebel && !k.variante.extraMarge)) {
        neu(`${b.titel.split(' (')[0]} und ${em100.titel}`, { ...b.variante, extraMarge: em100.variante.extraMarge })
    }
    const em = liste.find((k) => k.titel.startsWith('Extra-Marge +50'))
    const sl = liste.find((k) => k.variante.stopLoss)
    if (em && sl) neu(`${em.titel} und ${sl.titel}`, { ...em.variante, stopLoss: sl.variante.stopLoss })
    return liste
}

/** Alle Kandidaten rechnen (vergleiche nimmt je Aufruf höchstens MAX_VARIANTEN). */
export function rechneKandidaten(bot, kerzen, liste, opt) {
    const aus = []
    let basis = null, eichung = null
    for (let i = 0; i < liste.length; i += MAX_VARIANTEN) {
        const teil = liste.slice(i, i + MAX_VARIANTEN)
        const r = vergleiche(bot, kerzen, teil.map((k) => k.variante), opt)
        if (r.fehler) return { fehler: r.fehler }
        basis = basis || r.basis
        eichung = eichung || r.eichung
        teil.forEach((k, j) => aus.push({ ...k, rueckblick: r.varianten[j], abJetzt: r.abJetzt?.[j] || null }))
    }
    return { basis, eichung, kandidaten: aus }
}

const pz = (v, s = 1) => (istZahl(v) ? `${(v * 100).toFixed(s)} %` : '—')
const zl = (v, s = 4) => (istZahl(v) ? Number(v).toFixed(s) : '—')

/** Prompt-Zeilen: Bot, Markt, heutige Simulation, Kandidaten. */
export function bauePrompt(bot, lage, gerechnet, englisch = false) {
    const mc = bot.marginCoin
    const k = bot.kennzahlen || {}
    const z = []
    z.push(wissenAlsText(bot.typ))
    z.push('')
    z.push(`BOT ${bot.coin} ${bot.typName}, Richtung ${bot.richtung}, Hebel ${bot.hebel}x, läuft seit ${zl(k.tage, 1)} Tagen`)
    z.push(`Band ${zl(bot.grid?.unten)}–${zl(bot.grid?.oben)} USD, ${bot.grid?.anzahl} Grids ${bot.grid?.art}, Netto je Zyklus ${pz(bot.grid?.nettoJeZyklus, 3)}`)
    z.push(`Einsatz ${zl(k.gewinn?.basis)} ${mc}, Extra-Marge ${zl(bot.einsatz?.extraMarge)} ${mc}, Gewinn gesamt ${zl(k.gewinn?.gesamt)} ${mc} (realisiert ${zl(k.gewinn?.realisiert)}, schwebend ${zl(k.gewinn?.schwebend)}), Grid-Gewinn ${zl(bot.ergebnis?.gridGewinn)}, Funding ${zl(bot.ergebnis?.funding)}`)
    z.push(`Kurs ${zl(bot.kurs)} USD, Lage ${k.band?.lage || '—'}, Liquidation (Pionex) ${zl(bot.liquidation?.unten ?? bot.liquidation?.oben ?? bot.liquidation?.preis, 2)} USD, Abstand ${pz(k.liquidation?.abstand)}, Stop-Loss ${bot.stops?.stopLoss?.wert ?? 'keiner'}, Take-Profit ${bot.stops?.takeProfit?.wert ?? 'keiner'}`)
    if (lage) {
        z.push(`MARKT: 7 Tage ${pz(lage.aenderung7)}, 30 Tage ${pz(lage.aenderung30)}, 30-Tage-Hoch ${zl(lage.hoch30, 2)}, -Tief ${zl(lage.tief30, 2)}, Tagesspanne Median ${pz(lage.spanneMedian)} / max ${pz(lage.spanneMax)}, grösster 7-Tage-Fall ${pz(lage.maxFall7)}, Tages-ATR ${zl(lage.atr, 2)}`)
    }
    const e = gerechnet.eichung
    z.push(`SIMULATION heute (Rückblick seit Start): ${zl(gerechnet.basis?.gesamt)} ${mc}; Pionex echt ${zl(e?.echt)} ${mc}; Abweichung ${pz(e?.abweichungAnteil)} des Einsatzes${e?.unsicher ? ' — UNSICHER' : ''}`)
    z.push('')
    z.push(`KANDIDATEN (vom Code gerechnet; Rückblick = über die ganze Laufzeit seit Start; jetzt = Folgen eines Umstellens zum heutigen Kurs):`)
    z.push('id | Änderung | Rückblick Ergebnis | Rückblick grösster Verlust | Rückblick Ende | jetzt: nachschiessen | jetzt: geschlossen | jetzt: realisiert | jetzt: Liquidation neu | Abstand neu')
    for (const c of gerechnet.kandidaten) {
        const r = c.rueckblick, a = c.abJetzt
        const ende = r?.liquidation ? 'LIQUIDIERT' : r?.ausstieg ? r.ausstieg.art : 'läuft'
        const abstand = istZahl(a?.liqNeu) && istZahl(bot.kurs) ? Math.abs(bot.kurs - a.liqNeu) / bot.kurs : null
        const nach = (a?.zusatz || 0) + (c.variante.extraMarge || 0)
        z.push(`${c.id} | ${c.titel} | ${zl(r?.gesamt)} | ${zl(r?.maxVerlust)} | ${ende} | ${nach > 0 ? zl(nach) + ' ' + bot.marginCoin : '—'} | ${pz(a?.geschlossenAnteil, 0)} | ${zl(a?.realisiertCa)} | ${zl(a?.liqNeu, 2)} | ${pz(abstand)}`)
    }
    z.push('')
    z.push(englisch ? 'Answer in English.' : 'Antworte auf Deutsch (Schweizer Schreibweise, ss statt ß).')
    return z.join('\n')
}

export function systemText() {
    return [
        'Du bist der Bot-Assistent von AutarkTrade. Der Nutzer hat für seine eigenen Pionex-Bots ausdrücklich konkrete Vorschläge freigegeben.',
        'Du bekommst Zahlen, die der Code gerechnet hat. Du rechnest NICHT selbst und nennst KEINE Zahl, die nicht in der Eingabe steht.',
        'Wähle aus den KANDIDATEN höchstens drei, die du vorschlägst, und begründe sie mit den Zahlen. Wenn keiner sinnvoll ist, wähle keinen und sag warum.',
        'Beachte: Der Rückblick ist mit dem Wissen um den vergangenen Kursverlauf gerechnet — gewichte die Spalten „jetzt" (Liquidationsabstand, realisierter Verlust) mindestens so stark.',
        'So setzt Pionex Änderungen um: Band/Grids ändern behält die heutige Position (nichts wird realisiert), ein Band weiter nach unten (Long) bringt die Liquidation NÄHER. Hebel senken behält die Position und verlangt mehr Einsatz (Spalte „nachschiessen"). Extra-Marge lässt die Position gleich und schiebt die Liquidation weg. Nachschiessen braucht freies Guthaben auf dem Konto.',
        'Nenne bei jedem Vorschlag das wichtigste Risiko und wann er nicht passt. Kein Gewinnversprechen, keine Kursprognose als Tatsache, nicht „garantiert", nicht „risikolos", nicht „optimal".',
        'Antworte NUR mit JSON: {"lage": "2–4 Sätze zur Lage des Bots", "vorschlaege": [{"id": "K3", "titel": "kurz", "begruendung": "2–3 Sätze", "risiko": "1 Satz", "passtNichtWenn": "1 Satz"}], "hinweis": "optional, 1 Satz"}',
    ].join('\n')
}

const VERBOTEN = /\b(garantiert|risikolos|sicherer?\s+gewinn|ohne\s+risiko|optimal\w*|empfehl\w*|anlageberatung)\b/i
const kuerze = (s, n) => String(s || '').trim().slice(0, n)

/** Antwort der KI prüfen: nur bekannte IDs, Längen begrenzt, verbotene Wörter verwerfen. */
export function pruefeKiAntwort(json, gerechnet) {
    if (!json || typeof json !== 'object') return null
    const nachId = new Map(gerechnet.kandidaten.map((c) => [c.id, c]))
    const verworfen = []
    const vorschlaege = []
    for (const v of Array.isArray(json.vorschlaege) ? json.vorschlaege : []) {
        const c = nachId.get(String(v?.id || '').trim().toUpperCase())
        if (!c) { verworfen.push({ id: v?.id, grund: 'unbekannteId' }); continue }
        if (vorschlaege.some((x) => x.id === c.id)) continue
        const texte = { titel: kuerze(v.titel, 80) || c.titel, begruendung: kuerze(v.begruendung, 600), risiko: kuerze(v.risiko, 300), passtNichtWenn: kuerze(v.passtNichtWenn, 300) }
        if (Object.values(texte).some((t) => VERBOTEN.test(t))) { verworfen.push({ id: c.id, grund: 'wortwahl' }); continue }
        vorschlaege.push({ id: c.id, ...texte, variante: c.variante, codeTitel: c.titel, rueckblick: c.rueckblick, abJetzt: c.abJetzt })
        if (vorschlaege.length >= MAX_VORSCHLAEGE) break
    }
    let lage = kuerze(json.lage, 900)
    if (VERBOTEN.test(lage)) { verworfen.push({ id: 'lage', grund: 'wortwahl' }); lage = '' }
    let hinweis = kuerze(json.hinweis, 300)
    if (VERBOTEN.test(hinweis)) hinweis = ''
    return { lage, vorschlaege, hinweis, verworfen }
}

/** Kann dieser Bot KI-Vorschläge bekommen? */
export function kiMoeglich(bot) {
    return !!(bot?.laufend && TYPEN[bot.typ] && ['futures_grid', 'coinm_grid', 'spot_grid'].includes(bot.typ))
}
