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
import { messeZeitrahmen, findeTreffen, zeitrahmenText } from '../chart-zeitrahmen.js'
import { liqRisiko } from './pionex-bots.js'

/** Höhere Zeitrahmen für die Bot-Vorschläge (dieselbe Messung wie die Chart-KI „Lage über alle Zeitrahmen"). */
export const BOT_ZEITRAHMEN = ['1w', '1d', '4h']

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v)
const runde = (v, stellen = 6) => (istZahl(v) ? Number(v.toPrecision(stellen)) : v)

export const MAX_VORSCHLAEGE = 3

/**
 * Ziel der Vorschläge (21.11.2026). Bis dahin baute der Code immer dasselbe Dutzend Varianten und die KI
 * wählte «die sinnvollen», ohne zu wissen wofür — faktisch immer Absicherung (Extra-Marge, Hebel senken).
 * Jetzt wählt der Nutzer ein Ziel; der Code baut die Kandidaten dafür (Gruppen unten), und die KI begründet
 * im Hinblick darauf. «offen» ist der bisherige Satz. Dazu eine freie Idee in eigenen Worten (`pruefeIdee`).
 */
export const ZIELE = ['offen', 'absichern', 'verlust', 'ertrag', 'abwarten', 'aussteigen']
const ZIEL_GRUPPEN = {
    offen: ['marge', 'hebel', 'band', 'stop', 'bandHebel', 'bandMarge', 'margeStop'],
    absichern: ['marge', 'hebel', 'bandHebel', 'bandMarge', 'margeStop', 'nichts'],
    verlust: ['stop', 'margeStop', 'reduzieren', 'nichts'],
    ertrag: ['band', 'grids', 'bandMarge', 'nichts'],
    abwarten: ['nichts', 'stop', 'band', 'pausieren'],
    aussteigen: ['reduzieren', 'pausieren', 'beenden', 'stop', 'nichts'],
}
const ZIEL_TEXT = {
    offen: 'kein bestimmtes Ziel — Überblick über die Möglichkeiten',
    absichern: 'die Liquidation weiter weg bringen (absichern), auch mit frischem Geld',
    verlust: 'den möglichen Verlust begrenzen',
    ertrag: 'mehr Grid-Ertrag aus den Schwankungen holen',
    abwarten: 'weiterlaufen lassen und abwarten, OHNE Geld nachzuschiessen',
    aussteigen: 'geordnet aussteigen oder das Risiko abbauen',
}
export const zielVon = (z) => (ZIELE.includes(z) ? z : 'offen')
export const MAX_IDEE = 400
/** Die Idee des Nutzers für den Prompt: eine Zeile, ohne Steuerzeichen, begrenzt. Rein. */
export function pruefeIdee(text) {
    return String(text ?? '').replace(/[\u0000-\u001f\u007f«»]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_IDEE)
}

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
 * Lage auf hohen Zeitrahmen (rein): Struktur, letzter Bruch, Lage in der Spanne,
 * Momentum und die nächsten Niveaus je Zeitrahmen, dazu Zusammentreffen von
 * Niveaus verschiedener Zeitrahmen (Toleranz ½ ATR des 4h-Charts).
 * `serien` = { '1w': [...], '1d': [...], '4h': [...] } geschlossene Kerzen.
 */
export function hoheZeitrahmen(serien, kurs) {
    // Marken und Lage gegen den Kurs des Bots, nicht gegen den letzten Schluss je Zeitrahmen (FUN-R-202)
    const zeilen = BOT_ZEITRAHMEN.map((tf) => messeZeitrahmen(serien?.[tf], tf, { kurs: istZahl(kurs) ? kurs : undefined }) || { tf, unbekannt: true })
    const bekannt = zeilen.filter((z) => !z.unbekannt)
    if (!bekannt.length) return null
    const marken = []
    for (const z of bekannt) for (const m of z.marken) marken.push({ ...m, id: `Z${marken.length + 1}`, tf: z.tf })
    const atr4h = bekannt.find((z) => z.tf === '4h')?.atr ?? bekannt[bekannt.length - 1].atr
    const p = istZahl(kurs) ? kurs : bekannt[bekannt.length - 1].kurs
    const treffen = findeTreffen(marken.map((m) => ({ id: m.id, preis: m.preis, quelle: m.tf })), 0.5 * atr4h, p)
    const gleichlauf = { auf: bekannt.filter((z) => z.zustand === 1).length, ab: bekannt.filter((z) => z.zustand === -1).length, offen: bekannt.filter((z) => z.zustand === 0).length }
    return { kurs: p, zeilen, marken, treffen, gleichlauf, tagesbewegung: null }
}

/**
 * Stärkste Niveaus unter und über dem Kurs: zuerst Zusammentreffen mehrerer
 * Zeitrahmen, sonst die nächste Marke des grössten Zeitrahmens. Rein.
 */
export function niveausAusZeitrahmen(zr, kurs) {
    if (!zr) return { unten: [], oben: [] }
    const gewicht = { '1w': 3, '1d': 2, '4h': 1 }
    const liste = [
        ...zr.treffen.map((t) => ({ preis: t.preis, name: `${t.id} (${t.quellen.join('+')})`, rang: 10 + t.quellen.length })),
        ...zr.marken.map((m) => ({ preis: m.preis, name: `${m.id} (${m.tf})`, rang: gewicht[m.tf] || 0 })),
    ]
    const sortiert = (a) => a.sort((x, y) => y.rang - x.rang || Math.abs(x.preis - kurs) - Math.abs(y.preis - kurs))
    return {
        unten: sortiert(liste.filter((n) => n.preis < kurs)).slice(0, 2),
        oben: sortiert(liste.filter((n) => n.preis > kurs)).slice(0, 2),
    }
}

/**
 * Kandidaten aus der Lage. Preise in USDT je Coin, Beträge in der Margin-Münze.
 * Nur, was die Simulation rechnen kann; jeder Kandidat mit Code-Beschreibung.
 */
export function kandidaten(bot, kurs, atr, zr = null, ziel = 'offen') {
    const liste = []
    // `gruppe` sagt, wozu die Variante dient; am Ende bleibt, was zum Ziel gehört (ZIEL_GRUPPEN)
    const neu = (titel, v, gruppe) => { if (Object.keys(v).length) liste.push({ id: '', gruppe, titel, variante: v }) }
    const einsatz = bot.einsatz?.basis ?? (bot.coinM ? bot.einsatz?.aktuell : (bot.einsatz?.usdt ?? bot.einsatz?.aktuell))
    const long = bot.richtung !== 'SHORT'
    const u = bot.grid?.unten, o = bot.grid?.oben
    const hatAtr = istZahl(atr) && atr > 0 && istZahl(kurs)
    const liq = liqRisiko(bot.richtung, bot.liquidation, kurs)

    if (istZahl(einsatz) && einsatz > 0) {
        for (const f of [0.25, 0.5, 1]) neu(`Extra-Marge +${Math.round(f * 100)} % des Einsatzes`, { extraMarge: runde(einsatz * f, 4) }, 'marge')
    }
    if (bot.hebel > 1) {
        const h = new Set([Math.max(1, Math.round(bot.hebel / 2)), Math.max(1, bot.hebel - 1)])
        for (const x of h) if (x < bot.hebel) neu(`Hebel ${x} statt ${bot.hebel}`, { hebel: x }, 'hebel')
    }
    if (hatAtr && istZahl(u) && istZahl(o) && bot.richtung !== 'NEUTRAL') {
        // Band so legen, dass der Kurs wieder im Band liegt: eng (±4 ATR) und breit (−8/+10 ATR)
        const eng = long ? [kurs - 4 * atr, kurs + 6 * atr] : [kurs - 6 * atr, kurs + 4 * atr]
        const breit = long ? [kurs - 8 * atr, kurs + 10 * atr] : [kurs - 10 * atr, kurs + 8 * atr]
        for (const [titel, [a, b]] of [['Band eng um den Kurs', eng], ['Band breit um den Kurs', breit]]) {
            if (a > 0 && b > a) neu(`${titel} (${runde(a, 4)}–${runde(b, 4)})`, { unten: runde(a, 5), oben: runde(b, 5) }, 'band')
        }
        // Untergrenze nur nach unten verlängern, Obergrenze bleibt
        if (long && kurs < u) { const a = kurs - 6 * atr; if (a > 0) neu(`Untergrenze auf ${runde(a, 4)} senken`, { unten: runde(a, 5), oben: o }, 'band') }
        if (!long && kurs > o) { const b = kurs + 6 * atr; neu(`Obergrenze auf ${runde(b, 4)} heben`, { unten: u, oben: runde(b, 5) }, 'band') }
    }
    if (hatAtr && istZahl(liq) && bot.richtung !== 'NEUTRAL') {
        const sl1 = long ? liq + atr : liq - atr
        const sl2 = long ? kurs - 2 * atr : kurs + 2 * atr
        for (const sl of [sl1, sl2]) {
            const ok = long ? sl > liq && sl < kurs : sl < liq && sl > kurs
            if (ok && sl > 0) neu(`Stop-Loss bei ${runde(sl, 4)}`, { stopLoss: runde(sl, 5) }, 'stop')
        }
    }
    // An gemessenen Niveaus der hohen Zeitrahmen: Untergrenze bzw. Stop-Loss knapp jenseits
    // einer Unterstützung (Long) / eines Widerstands (Short), Abstand ½ Tages-ATR.
    if (hatAtr && zr && bot.richtung !== 'NEUTRAL') {
        const nv = niveausAusZeitrahmen(zr, kurs)
        const stuetze = long ? nv.unten : nv.oben
        for (const n of stuetze) {
            const jenseits = long ? n.preis - 0.5 * atr : n.preis + 0.5 * atr
            if (!(jenseits > 0)) continue
            if (long && istZahl(o) && jenseits < kurs) neu(`Untergrenze unter Niveau ${n.name} auf ${runde(jenseits, 4)}`, { unten: runde(jenseits, 5), oben: o }, 'band')
            if (!long && istZahl(u) && jenseits > kurs) neu(`Obergrenze über Niveau ${n.name} auf ${runde(jenseits, 4)}`, { unten: u, oben: runde(jenseits, 5) }, 'band')
            const ok = istZahl(liq) ? (long ? jenseits > liq && jenseits < kurs : jenseits < liq && jenseits > kurs) : (long ? jenseits < kurs : jenseits > kurs)
            if (ok) neu(`Stop-Loss jenseits Niveau ${n.name} bei ${runde(jenseits, 4)}`, { stopLoss: runde(jenseits, 5) }, 'stop')
        }
    }
    // Kombinationen: halber Hebel + breites Band; Extra-Marge 50 % + Stop-Loss
    const breitK = liste.find((k) => k.titel.startsWith('Band breit'))
    const halbH = liste.find((k) => k.variante.hebel && k.variante.hebel === Math.max(1, Math.round(bot.hebel / 2)))
    if (breitK && halbH) neu(`${breitK.titel.split(' (')[0]} und ${halbH.titel}`, { ...breitK.variante, hebel: halbH.variante.hebel }, 'bandHebel')
    // Band neu legen ohne frisches Geld erhöht bei Pionex das Risiko (Position bleibt, Grid wächst nach
    // unten) — darum auch jede Band-Variante zusammen mit Extra-Marge 100 % des Einsatzes.
    const em100 = liste.find((k) => k.titel.startsWith('Extra-Marge +100'))
    if (em100) for (const b of liste.filter((k) => k.variante.unten != null && !k.variante.hebel && !k.variante.extraMarge)) {
        neu(`${b.titel.split(' (')[0]} und ${em100.titel}`, { ...b.variante, extraMarge: em100.variante.extraMarge }, 'bandMarge')
    }
    const em = liste.find((k) => k.titel.startsWith('Extra-Marge +50'))
    const sl = liste.find((k) => k.variante.stopLoss)
    if (em && sl) neu(`${em.titel} und ${sl.titel}`, { ...em.variante, stopLoss: sl.variante.stopLoss }, 'margeStop')

    // Grid-Dichte (Ziel «Ertrag»): gemessen (17.11.2026) bringen Abstände unter etwa 0,5–1 % weniger, weil
    // Gebühren den Zyklus fressen; sehr weite Abstände lassen Schwankungen ungenutzt.
    const n = bot.grid?.anzahl, abst = bot.grid?.abstand?.mitte
    if (Number.isInteger(n) && istZahl(abst)) {
        if (abst < 0.01 && Math.round(n / 2) >= 2) neu(`Halb so viele Grids (${Math.round(n / 2)} statt ${n}), doppelter Abstand`, { anzahl: Math.round(n / 2) }, 'grids')
        if (abst > 0.02 && n * 2 <= 500) neu(`Doppelt so viele Grids (${n * 2} statt ${n}), halber Abstand`, { anzahl: n * 2 }, 'grids')
    }
    // Eingriffe ohne neue Einstellung: sie rechnet nicht die Simulation, sondern `aktionJetzt` aus dem Stand
    // des Bots. Spot kann über die App nur beenden.
    const spot = bot.typ === 'spot_grid'
    if (!spot) for (const anteil of [25, 50]) neu(`Position um ${anteil} % reduzieren`, { aktion: 'reduzieren', anteil }, 'reduzieren')
    if (!spot && bot.status !== 'paused') neu('Bot pausieren (keine neuen Grid-Orders, Position bleibt)', { aktion: 'pausieren' }, 'pausieren')
    neu(spot ? 'Bot beenden (Coins bleiben im Konto)' : 'Bot beenden (Position zum Marktpreis schliessen)', { aktion: 'beenden' }, 'beenden')
    neu('Nichts ändern', { aktion: 'nichts' }, 'nichts')

    const gruppen = ZIEL_GRUPPEN[zielVon(ziel)]
    return liste.filter((k) => gruppen.includes(k.gruppe))
        .sort((a, b) => (zielVon(ziel) === 'offen' ? 0 : gruppen.indexOf(a.gruppe) - gruppen.indexOf(b.gruppe)))
        .map((k, i) => ({ ...k, id: `K${i + 1}` }))
}

/** Folgen eines Eingriffs ohne neue Einstellung, aus dem heutigen Stand des Bots (rein). */
export function aktionJetzt(bot, v) {
    const sw = bot.kennzahlen?.gewinn?.schwebend
    const liq = liqRisiko(bot.richtung, bot.liquidation, bot.kurs)
    if (v.aktion === 'beenden') return { zusatz: 0, geschlossenAnteil: 1, realisiertCa: istZahl(sw) ? sw : null, liqNeu: null }
    if (v.aktion === 'reduzieren') return { zusatz: 0, geschlossenAnteil: v.anteil / 100, realisiertCa: istZahl(sw) ? runde(sw * v.anteil / 100, 6) : null, liqNeu: null }
    return { zusatz: 0, geschlossenAnteil: 0, realisiertCa: 0, liqNeu: istZahl(liq) ? liq : null }
}

/** Alle Kandidaten rechnen (vergleiche nimmt je Aufruf höchstens MAX_VARIANTEN). */
export function rechneKandidaten(bot, kerzen, liste, opt) {
    const gerechnet = new Map()
    let basis = null, eichung = null
    // Eingriffe (pausieren, reduzieren, beenden, nichts) haben keine Einstellung zum Simulieren
    const sim = liste.filter((k) => !k.variante.aktion)
    for (let i = 0; i < Math.max(1, sim.length); i += MAX_VARIANTEN) {
        const teil = sim.slice(i, i + MAX_VARIANTEN)
        const r = vergleiche(bot, kerzen, teil.map((k) => k.variante), { ...opt, basis })
        if (r.fehler) return { fehler: r.fehler }
        basis = basis || r.basis
        eichung = eichung || r.eichung
        teil.forEach((k, j) => gerechnet.set(k.id, { ...k, rueckblick: r.varianten[j], abJetzt: r.abJetzt?.[j] || null }))
    }
    // Rückblick eines Eingriffs = der heutige: er ändert die Vergangenheit nicht
    const aus = liste.map((k) => gerechnet.get(k.id) || { ...k, rueckblick: basis, abJetzt: aktionJetzt(bot, k.variante) })
    return { basis, eichung, kandidaten: aus }
}

const pz = (v, s = 1) => (istZahl(v) ? `${(v * 100).toFixed(s)} %` : '—')
const zl = (v, s = 4) => (istZahl(v) ? Number(v).toFixed(s) : '—')

/** Prompt-Zeilen: Bot, Markt, heutige Simulation, Kandidaten. */
export function bauePrompt(bot, lage, gerechnet, englisch = false, zr = null, { ziel = 'offen', idee = '' } = {}) {
    const wunsch = pruefeIdee(idee)
    const zielZeilen = [
        `ZIEL DES NUTZERS: ${ZIEL_TEXT[zielVon(ziel)]}`,
        ...(wunsch ? [`IDEE DES NUTZERS (seine eigenen Worte; Zahlen darin sind seine Annahmen, keine Messung): «${wunsch}»`] : []),
        '',
    ]
    const mc = bot.marginCoin
    const k = bot.kennzahlen || {}
    const e = gerechnet.eichung
    const liqHeute = liqRisiko(bot.richtung, bot.liquidation, bot.kurs)
    const kopf = [
        wissenAlsText(bot.typ),
        '',
        `BOT ${bot.coin} ${bot.typName}, Richtung ${bot.richtung}, Hebel ${bot.hebel}x, läuft seit ${zl(k.tage, 1)} Tagen`,
        `Band ${zl(bot.grid?.unten)}–${zl(bot.grid?.oben)} USD, ${bot.grid?.anzahl} Grids ${bot.grid?.art}, Netto je Zyklus ${pz(bot.grid?.nettoJeZyklus, 3)}`,
        `Einsatz ${zl(k.gewinn?.basis)} ${mc}, Extra-Marge ${zl(bot.einsatz?.extraMarge)} ${mc}, Gewinn gesamt ${zl(k.gewinn?.gesamt)} ${mc} (realisiert ${zl(k.gewinn?.realisiert)}, schwebend ${zl(k.gewinn?.schwebend)}), Grid-Gewinn ${zl(bot.ergebnis?.gridGewinn)}, Funding ${zl(bot.ergebnis?.funding)}`,
        `Kurs ${zl(bot.kurs)} USD, Lage ${k.band?.lage || '—'}, Liquidation (Pionex) ${zl(liqHeute, 2)} USD, Abstand ${pz(k.liquidation?.abstand)}, Stop-Loss ${stopImPrompt(bot.stops?.stopLoss)}, Take-Profit ${stopImPrompt(bot.stops?.takeProfit)}`,
    ]
    const markt = lage ? [`MARKT: 7 Tage ${pz(lage.aenderung7)}, 30 Tage ${pz(lage.aenderung30)}, 30-Tage-Hoch ${zl(lage.hoch30, 2)}, -Tief ${zl(lage.tief30, 2)}, Tagesspanne Median ${pz(lage.spanneMedian)} / max ${pz(lage.spanneMax)}, grösster 7-Tage-Fall ${pz(lage.maxFall7)}, Tages-ATR ${zl(lage.atr, 2)}`] : []
    const hoch = zr ? ['', zeitrahmenText(zr, (t) => new Date(t).toISOString().slice(0, 10)).replace('ZEITRAHMEN — vom Code gemessen', 'HOHE ZEITRAHMEN — vom Code gemessen')] : []
    const tabelle = gerechnet.kandidaten.map((c) => {
        const r = c.rueckblick, a = c.abJetzt
        const ende = r?.liquidation ? 'LIQUIDIERT' : r?.ausstieg ? r.ausstieg.art : 'läuft'
        const abstand = istZahl(a?.liqNeu) && istZahl(bot.kurs) ? Math.abs(bot.kurs - a.liqNeu) / bot.kurs : null
        const nach = (a?.zusatz || 0) + (c.variante.extraMarge || 0)
        return [c.id, c.titel, zl(r?.gesamt), zl(r?.maxVerlust), ende, nach > 0 ? `${zl(nach)} ${mc}` : '—', pz(a?.geschlossenAnteil, 0), zl(a?.realisiertCa), zl(a?.liqNeu, 2), pz(abstand)].join(' | ')
    })
    return [
        ...zielZeilen, ...kopf, ...markt, ...hoch,
        `SIMULATION heute (Rückblick seit Start): ${zl(gerechnet.basis?.gesamt)} ${mc}; Pionex echt ${zl(e?.echt)} ${mc}; Abweichung ${pz(e?.abweichungAnteil)} des Einsatzes${e?.unsicher ? ' — UNSICHER' : ''}`,
        '',
        'KANDIDATEN (vom Code gerechnet; Rückblick = über die ganze Laufzeit seit Start; jetzt = Folgen eines Umstellens zum heutigen Kurs):',
        'id | Änderung | Rückblick Ergebnis | Rückblick grösster Verlust | Rückblick Ende | jetzt: nachschiessen | jetzt: geschlossen | jetzt: realisiert | jetzt: Liquidation neu | Abstand neu',
        ...tabelle,
        '',
        englisch ? 'Answer in English.' : 'Antworte auf Deutsch (Schweizer Schreibweise, ss statt ß).',
    ].join('\n')
}

export function systemText() {
    return [
        'Du bist der Bot-Assistent von AutarkTrade. Der Nutzer hat für seine eigenen Pionex-Bots ausdrücklich konkrete Vorschläge freigegeben.',
        'Du bekommst Zahlen, die der Code gerechnet hat. Du rechnest NICHT selbst und nennst KEINE Zahl, die nicht in der Eingabe steht.',
        'Wähle aus den KANDIDATEN höchstens drei, die du vorschlägst, und begründe sie mit den Zahlen. Wenn keiner sinnvoll ist, wähle keinen und sag warum.',
        'Oben steht das ZIEL DES NUTZERS; die KANDIDATEN hat der Code für dieses Ziel gebaut. Wähle danach und sag bei jedem Vorschlag in der Begründung, wie er diesem Ziel dient. Steht dort eine IDEE DES NUTZERS, richte Auswahl und Begründung nach ihr; Zahlen aus der Idee sind seine Annahmen — nenne sie als «deine Annahme», nicht als Messung. Spricht die gemessene Lage gegen das Ziel oder die Idee (z. B. die Struktur auf allen Zeitrahmen gegen die Richtung des Bots), sag das klar im Feld "lage", ohne Kursprognose.',
        '«Nichts ändern», «pausieren», «reduzieren» und «beenden» sind gültige Vorschläge, wenn sie unter den KANDIDATEN stehen. Bei «reduzieren» und «beenden» steht in „jetzt: realisiert" der schwebende Gewinn oder Verlust, der damit fest wird; die neue Liquidation nach einem Reduzieren nennt erst Pionex bei der Prüfung (hier «—»).',
        'Beachte: Der Rückblick ist mit dem Wissen um den vergangenen Kursverlauf gerechnet — gewichte die Spalten „jetzt" (Liquidationsabstand, realisierter Verlust) mindestens so stark.',
        'So setzt Pionex Änderungen um: Band/Grids ändern behält die heutige Position (nichts wird realisiert), ein Band weiter nach unten (Long) bringt die Liquidation NÄHER. Hebel senken behält die Position und verlangt mehr Einsatz (Spalte „nachschiessen"). Extra-Marge lässt die Position gleich und schiebt die Liquidation weg. Nachschiessen braucht freies Guthaben auf dem Konto.',
        'Beziehe die HOHEN ZEITRAHMEN ein: Struktur und Bruch auf 1w/1d/4h, wo der Kurs in seiner Spanne steht, und ob Bandgrenzen, Stop-Loss und Liquidation an, über oder unter gemessenen Niveaus (Z…, Zusammentreffen C…) liegen. Nenne Niveaus nur mit ihrer ID und dem Preis aus der Eingabe.',
        'Nenne bei jedem Vorschlag das wichtigste Risiko und wann er nicht passt. Kein Gewinnversprechen, keine Kursprognose als Tatsache, nicht „garantiert", nicht „risikolos", nicht „optimal".',
        'Antworte NUR mit JSON: {"lage": "2–4 Sätze zur Lage des Bots", "vorschlaege": [{"id": "K3", "titel": "kurz", "begruendung": "2–3 Sätze", "risiko": "1 Satz", "passtNichtWenn": "1 Satz"}], "hinweis": "optional, 1 Satz"}',
    ].join('\n')
}

// Deutsch und Englisch (Audit FUN-05: englische Antworten gingen ungeprüft durch)
const VERBOTEN = /\b(garantiert|risikolos|sicherer?\s+gewinn|ohne\s+risiko|optimal\w*|empfehl\w*|anlageberatung|guarantee\w*|risk[-\s]?free|riskless|no\s+risk|recommend\w*|investment\s+advice|financial\s+advice|sure\s+profit)\b/i

/**
 * Zahlen im Text der KI, die in der Eingabe nicht vorkommen (Audit FUN-05).
 * Eine Zahl gilt als belegt, wenn eine Zahl der Eingabe auf ihre Stellen
 * gerundet gleich ist (70.93 ist durch 70.9219 belegt). Kleine ganze Zahlen
 * (Aufzählungen, „3 Vorschläge") werden nicht geprüft. Rein.
 */
export function unbelegteZahlen(text, eingabe) {
    const zahlen = (t) => [...String(t || '').matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'))
    const belegt = zahlen(eingabe).map(Number)
    const aus = []
    for (const roh of zahlen(text)) {
        const x = Number(roh)
        const stellen = roh.includes('.') ? roh.split('.')[1].length : 0
        if (!stellen && Math.abs(x) < 10) continue
        const f = 10 ** stellen
        const ok = belegt.some((y) => Math.round(y * f) === Math.round(x * f) || Math.round(Math.abs(y) * f) === Math.round(Math.abs(x) * f))
        if (!ok && !aus.includes(roh)) aus.push(roh)
    }
    return aus
}
const kuerze = (s, n) => String(s || '').trim().slice(0, n)

/** Stop für den Prompt: ein Preis in USD, sonst Art und Wert (ein Quoten-Stop −0.2 ist kein Preis). */
const stopImPrompt = (stop) => (!stop || stop.wert == null ? 'keiner' : /price/.test(String(stop.art || '')) ? `${stop.wert} USD` : `${stop.wert} (${stop.art || 'ohne Art'})`)

/** Antwort der KI prüfen: nur bekannte IDs, Längen begrenzt, verbotene Wörter verwerfen. */
export function pruefeKiAntwort(json, gerechnet, eingabe = '') {
    if (!json || typeof json !== 'object') return null
    const nachId = new Map(gerechnet.kandidaten.map((c) => [c.id, c]))
    const verworfen = []
    const vorschlaege = []
    for (const v of Array.isArray(json.vorschlaege) ? json.vorschlaege : []) {
        const c = nachId.get(String(v?.id || '').trim().toUpperCase())
        if (!c) { verworfen.push({ id: v?.id, grund: 'unbekannteId' }); continue }
        if (vorschlaege.some((x) => x.id === c.id)) continue
        // Planer «alle Richtungen»: höchstens einer je Gruppe — VOR dem Deckel, sonst füllen drei Longs die
        // Plätze und Short/Neutral fehlen ohne Hinweis (Audit PLN-04)
        if (gerechnet.gruppe) {
            const g = gerechnet.gruppe(c)
            if (vorschlaege.some((x) => x.gruppe === g)) { verworfen.push({ id: c.id, grund: 'zweiterJeRichtung' }); continue }
        }
        const texte = { titel: kuerze(v.titel, 80) || c.titel, begruendung: kuerze(v.begruendung, 600), risiko: kuerze(v.risiko, 300), passtNichtWenn: kuerze(v.passtNichtWenn, 300) }
        if (Object.values(texte).some((t) => VERBOTEN.test(t))) { verworfen.push({ id: c.id, grund: 'wortwahl' }); continue }
        const unbelegt = eingabe ? unbelegteZahlen(`${v.titel ? texte.titel : ''} ${texte.begruendung} ${texte.risiko} ${texte.passtNichtWenn}`, eingabe) : []
        vorschlaege.push({ id: c.id, ...texte, variante: c.variante, codeTitel: c.titel, rueckblick: c.rueckblick, abJetzt: c.abJetzt, unbelegt, ...(gerechnet.gruppe ? { gruppe: gerechnet.gruppe(c) } : {}) })
        if (vorschlaege.length >= MAX_VORSCHLAEGE) break
    }
    let lage = kuerze(json.lage, 900)
    if (VERBOTEN.test(lage)) { verworfen.push({ id: 'lage', grund: 'wortwahl' }); lage = '' }
    let hinweis = kuerze(json.hinweis, 300)
    if (VERBOTEN.test(hinweis)) hinweis = ''
    return { lage, vorschlaege, hinweis, verworfen, lageUnbelegt: eingabe && lage ? unbelegteZahlen(lage, eingabe) : [] }
}

/** Kann dieser Bot KI-Vorschläge bekommen? */
export function kiMoeglich(bot) {
    return !!(bot?.laufend && TYPEN[bot.typ] && ['futures_grid', 'coinm_grid', 'spot_grid'].includes(bot.typ))
}
