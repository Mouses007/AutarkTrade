/**
 * Makro-Umfeld: Stablecoin-Fluss, Dominanz-Zerlegung und die Rechnung für
 * Korrelationen zwischen Tagesreihen.
 *
 * Bis S12 gehörten Aktien-Futures (ES, NQ, RTY) und der Dollar-Index aus
 * Yahoo Finance dazu, samt Korrelation zu Bitcoin — „Nasdaq −1 %" allein ist
 * Dekoration, die Kopplung ist die Aussage. Yahoo ist entfernt (siehe unten);
 * die Korrelationsrechnung bleibt, damit eine lizenzierte Indexquelle sie
 * ohne Neubau wieder nutzen kann.
 *
 * Reines Modul ohne Netz und DB (Selbsttest: __selftest-makro.mjs); die
 * Datenbeschaffung liegt in marktradar-api.js (holeMakro).
 */

/** Ab so vielen gemeinsamen Tagen gilt eine Korrelation als überhaupt zeigbar. */
export const KORR_MIN_PUNKTE = 12
export const KORR_STARK = 0.6
export const KORR_MITTEL = 0.35

/*
 * Hier standen bis S12 zwei Leser für Antworten des Yahoo-Finance-Chart-
 * Endpunkts (`reiheAusChart`, `ohlcAusChart`). Yahoo ist als Quelle entfernt
 * (Verkaufs-Prüfung Z. 28/39: automatisiertes Sammeln und kommerzielle Nutzung
 * verboten), die Leser mit ihr. Die übrige Rechnung bleibt: Korrelation und
 * Delta arbeiten auf jeder Tagesreihe `{tag, close}`, `pearson` braucht der
 * Coin-Radar, Stablecoin-Fluss und Dominanz-Zerlegung die Makro-Kachel.
 */

/**
 * Veränderung zur vorherigen Sitzung in Prozent.
 *
 * Bewusst aus der Reihe gerechnet und NICHT aus `chartPreviousClose`: das Feld
 * meint den Schlusskurs VOR dem abgefragten Zeitraum (bei 3 Monaten also den
 * Kurs von vor drei Monaten) — wer es für „gestern" hält, zeigt Unsinn an.
 */
export function deltaAusReihe(reihe) {
    if (!Array.isArray(reihe) || reihe.length < 2) return null
    const jetzt = reihe[reihe.length - 1].close
    const vorher = reihe[reihe.length - 2].close
    if (!(vorher > 0) || !Number.isFinite(jetzt)) return null
    return ((jetzt - vorher) / vorher) * 100
}

/** Pearson-Korrelation. Ohne Streuung (konstante Reihe) ist sie nicht definiert. */
export function pearson(xs, ys) {
    const n = Math.min(xs?.length || 0, ys?.length || 0)
    if (n < 2) return null
    let sx = 0, sy = 0
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i] }
    const mx = sx / n, my = sy / n
    let zaehler = 0, qx = 0, qy = 0
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my
        zaehler += dx * dy
        qx += dx * dx
        qy += dy * dy
    }
    if (qx <= 0 || qy <= 0) return null
    const r = zaehler / Math.sqrt(qx * qy)
    // Rundungsfehler dürfen nicht zu |r| > 1 führen
    return Math.max(-1, Math.min(1, r))
}

/**
 * Korrelation zweier Tagesreihen über die Renditen gemeinsamer Tage.
 *
 * Erst auf gemeinsame Tage schneiden, DANN Renditen bilden: die Aktienbörse
 * ruht am Wochenende, Krypto nicht. Bildete man die Renditen vorher, vergliche
 * man eine Freitag→Montag-Bewegung der Nasdaq mit einer Sonntag→Montag-
 * Bewegung von Bitcoin — also verschiedene Zeiträume.
 */
export function korrelationAusReihen(reiheA, reiheB) {
    const bNach = new Map((reiheB || []).map(p => [p.tag, p.close]))
    const gemeinsam = []
    for (const p of reiheA || []) {
        const b = bNach.get(p.tag)
        if (Number.isFinite(b) && b > 0) gemeinsam.push({ tag: p.tag, a: p.close, b })
    }
    gemeinsam.sort((x, y) => (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0))

    const ra = [], rb = []
    for (let i = 1; i < gemeinsam.length; i++) {
        const va = gemeinsam[i - 1].a, vb = gemeinsam[i - 1].b
        if (!(va > 0) || !(vb > 0)) continue
        ra.push((gemeinsam[i].a - va) / va)
        rb.push((gemeinsam[i].b - vb) / vb)
    }
    if (ra.length < KORR_MIN_PUNKTE) return { r: null, punkte: ra.length }
    return { r: pearson(ra, rb), punkte: ra.length }
}

/**
 * Wie fest hängt Krypto gerade an den Aktien? Schlüssel, kein Text — übersetzt
 * wird im Frontend.
 */
export function deuteKorrelation(r) {
    if (r === null || r === undefined || !Number.isFinite(r)) return 'unbekannt'
    const b = Math.abs(r)
    if (b >= KORR_STARK) return r > 0 ? 'starkGleich' : 'starkGegen'
    if (b >= KORR_MITTEL) return r > 0 ? 'mittelGleich' : 'mittelGegen'
    return 'entkoppelt'
}

/**
 * Stablecoin-Fluss aus Marktkapitalisierungs-Reihen (USDT + USDC).
 *
 * Bewusst die MENGE und nicht die „USDT-Dominanz": Fällt Krypto um 10 % und
 * die Stablecoin-Menge bleibt gleich, steigt deren Dominanz rein rechnerisch —
 * sie wiederholt dann nur den Kursrückgang, den man ohnehin sieht. Echte
 * Information steckt im Zu- oder Abfluss: neu geprägte Coins heissen frisches
 * Geld im Markt, Rücknahmen heissen abfliessendes Geld.
 */
/**
 * Zwei Stützpunkte für die Dominanz-Zerlegung suchen: den jüngsten Tag, an
 * dem BEIDE Reihen einen Wert haben, und einen rund `tage` davor.
 *
 * Beide Grössen müssen vom selben Tag stammen, sonst rechnet man eine
 * Stablecoin-Menge von heute gegen einen Gesamtmarkt von vorgestern und
 * erzeugt eine Veränderung, die es nie gab.
 *
 * @param {Map<string, number>} stableNachTag  Tag → Stablecoin-Menge
 * @param {Map<string, number>} totalNachTag   Tag → Gesamtmarkt
 */
export function waehleDominanzPunkte(stableNachTag, totalNachTag, tage = 30) {
    const gemeinsam = []
    for (const [tag, s] of stableNachTag || []) {
        const t = totalNachTag?.get(tag)
        if (s > 0 && t > 0 && t > s) gemeinsam.push({ tag, s, t })
    }
    if (gemeinsam.length < 2) return null
    gemeinsam.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

    const bis = gemeinsam[gemeinsam.length - 1]
    const zielMs = Date.parse(bis.tag + 'T00:00:00Z') - tage * 86400000
    // Den Tag nehmen, der dem Ziel am nächsten liegt — Wochenenden und
    // Datenlücken verschieben ihn sonst willkürlich
    let von = null
    let besteEntfernung = Infinity
    for (const p of gemeinsam) {
        if (p.tag === bis.tag) continue
        const d = Math.abs(Date.parse(p.tag + 'T00:00:00Z') - zielMs)
        if (d < besteEntfernung) { besteEntfernung = d; von = p }
    }
    if (!von) return null
    return {
        s0: von.s, s1: bis.s, t0: von.t, t1: bis.t,
        tagVon: von.tag, tagBis: bis.tag,
        tage: Math.round((Date.parse(bis.tag + 'T00:00:00Z') - Date.parse(von.tag + 'T00:00:00Z')) / 86400000),
    }
}

/**
 * Die Stablecoin-Dominanz in ihre zwei Ursachen zerlegen.
 *
 * Warum das nötig ist: Dominanz = Stablecoin-Menge ÷ Gesamtmarkt hat ZWEI
 * bewegliche Teile. Fällt der übrige Markt um 10 %, steigt die Dominanz auch
 * dann, wenn kein einziger USDT geprägt wurde — sie wiederholt dann nur den
 * Kursrückgang. Umgekehrt kann ein echter Zufluss in einer Rally unsichtbar
 * bleiben, weil der Nenner schneller wächst. Die blosse Zahl kann man deshalb
 * nicht deuten; die Zerlegung sagt, welcher Teil sich bewegt hat.
 *
 * Gerechnet wird symmetrisch (beide Reihenfolgen gemittelt), damit nicht
 * willkürlich ist, welcher Faktor „zuerst" wirken darf. Die Summe beider
 * Effekte ergibt exakt die Gesamtveränderung.
 *
 * @returns Prozent-PUNKTE (nicht Prozent vom Wert)
 */
export function zerlegeDominanz({ s0, s1, t0, t1 } = {}) {
    const n0 = t0 - s0
    const n1 = t1 - s1
    if (![s0, s1, t0, t1, n0, n1].every(v => Number.isFinite(v) && v > 0)) return null

    const d0 = s0 / t0
    const d1 = s1 / t1

    // Reihenfolge A: erst die Menge ändern, dann die Kurse
    const nurMengeA = s1 / (s1 + n0)
    const mengeA = nurMengeA - d0
    const kursA = d1 - nurMengeA
    // Reihenfolge B: erst die Kurse, dann die Menge
    const nurKursB = s0 / (s0 + n1)
    const kursB = nurKursB - d0
    const mengeB = d1 - nurKursB

    const punkte = (v) => v * 100
    return {
        vorherPct: punkte(d0),
        jetztPct: punkte(d1),
        deltaPunkte: punkte(d1 - d0),
        mengePunkte: punkte((mengeA + mengeB) / 2),
        kursPunkte: punkte((kursA + kursB) / 2),
    }
}

export function stableFluss(reihen, tage = 30) {
    const gueltig = (reihen || []).filter(r => Array.isArray(r) && r.length >= 2)
    if (!gueltig.length) return { jetztUsd: null, deltaUsd: null, deltaPct: null, tage: 0 }

    // Kürzeste Reihe gibt den Zeitraum vor, damit Summen nicht aus
    // verschieden langen Zeitfenstern zusammengesetzt werden
    const laenge = Math.min(...gueltig.map(r => r.length))
    let jetzt = 0, davor = 0
    for (const r of gueltig) {
        const a = Number(r[r.length - 1]?.[1])
        const b = Number(r[r.length - laenge]?.[1])
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue
        jetzt += a
        davor += b
    }
    if (!(davor > 0) || !(jetzt > 0)) return { jetztUsd: null, deltaUsd: null, deltaPct: null, tage: 0 }
    return {
        jetztUsd: jetzt,
        deltaUsd: jetzt - davor,
        deltaPct: ((jetzt - davor) / davor) * 100,
        tage: Math.min(tage, laenge - 1),
    }
}
