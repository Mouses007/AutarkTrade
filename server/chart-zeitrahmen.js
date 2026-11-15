/**
 * Lage über alle Zeitrahmen für die KI-Analyse — rein, kein Netz, kein Modell.
 *
 * Ersetzt seit 10.11.2026 „Meine Zeichnungen analysieren": Dort durfte das Modell
 * nur die eigenen Zeichnungen nennen und schrieb darum eine Beschreibung von ihnen.
 * Jetzt misst der Code je Zeitrahmen Struktur, Lage in der Spanne, Momentum und die
 * nächsten Marken und findet, wo Marken mehrerer Zeitrahmen (und eigene Zeichnungen)
 * zusammentreffen. Das Modell ordnet ein und misst nichts selbst.
 *
 * IDs: `Z…` = Marke eines Zeitrahmens, `C…` = Zusammentreffen, `U…` = eigene Zeichnung.
 */
import { atr } from '../shared/indicators.js'
import { kandidatenNiveaus, marktstruktur, spanneLetzte, massstab, zahl } from './chart-kandidaten.js'
import { welle, zustand, OB_LVL } from './momentum-radar.js'
import { rechneTagesbild } from './handelsbild.js'

/** Von gross nach klein: so liest man einen Chart von oben herab. */
export const ZEITRAHMEN = ['1w', '1d', '4h', '1h', '15m']
export const ZEITRAHMEN_KERZEN = 300
const MIN_KERZEN = 30
const SPANNE_KERZEN = 50
const MARKEN_JE_SEITE = 2
const TREFFEN_MAX = 5
const TREFFEN_ATR = 0.5

const MINUTEN = { m: 1, h: 60, d: 1440, w: 10080, M: 43200 }
const minuten = (tf) => {
    const m = /^(\d+)([mhdwM])$/.exec(String(tf))
    return m ? Number(m[1]) * MINUTEN[m[2]] : 0
}

/** Die festen Zeitrahmen plus der des Charts, falls er nicht dabei ist (5m, 30m …). */
export function zeitrahmenFuer(interval) {
    const liste = [...ZEITRAHMEN]
    if (interval && !liste.includes(interval) && minuten(interval) > 0) liste.push(interval)
    return liste.sort((a, b) => minuten(b) - minuten(a))
}

/**
 * Ein Zeitrahmen: nur geschlossene Kerzen; zu wenige → `null`, nie ein erfundener Stand.
 *
 * `kurs` = der Kurs des Charts (Audit 15.11.2026, FUN-R-202). Struktur, Momentum, ATR
 * und Marken kommen aus den geschlossenen Kerzen DIESES Zeitrahmens; «über/unter dem
 * Kurs», der Abstand und die Lage in der Spanne aber werden gegen den Kurs gemessen,
 * den der Nutzer sieht. Der letzte Wochenschluss ist bis zu sieben Tage alt — eine
 * Marke bei 100,3 stand sonst als «über dem Kurs» da, während der Kurs bei 104 lag.
 * Ohne `kurs` gilt der letzte Schluss der Reihe (`kursQuelle: 'schluss'`).
 * Die Lage kann darum unter 0 % oder über 100 % liegen: der Kurs hat die Spanne der
 * geschlossenen Kerzen dann verlassen.
 */
export function messeZeitrahmen(kerzen, tf, { grenze = OB_LVL, kurs: chartKurs } = {}) {
    if (!Array.isArray(kerzen) || kerzen.length < MIN_KERZEN) return null
    const a = atr(kerzen, 14)
    const atrWert = a[a.length - 1]
    if (!(atrWert > 0)) return null
    const schluss = kerzen[kerzen.length - 1].c
    const vomChart = Number.isFinite(chartKurs) && chartKurs > 0
    const kurs = vomChart ? chartKurs : schluss
    const s = marktstruktur(kerzen)
    const sp = spanneLetzte(kerzen, SPANNE_KERZEN, atrWert)
    const w1 = welle(kerzen).w1
    const w = w1[w1.length - 1]
    const niveaus = kandidatenNiveaus(kerzen, { atrWert, M: massstab(kerzen.length) })
    const oben = niveaus.filter((x) => x.preis > kurs).sort((x, y) => x.preis - y.preis).slice(0, MARKEN_JE_SEITE)
    const unten = niveaus.filter((x) => x.preis <= kurs).sort((x, y) => y.preis - x.preis).slice(0, MARKEN_JE_SEITE)
    return {
        tf,
        kurs,
        kursQuelle: vomChart ? 'chart' : 'schluss',
        schluss,
        atr: atrWert,
        atrPct: (atrWert / schluss) * 100,
        zustand: s.zustand,
        bruch: s.bruch,
        lagePct: !sp ? null : sp.hoch > sp.tief ? ((kurs - sp.tief) / (sp.hoch - sp.tief)) * 100 : 50,
        tief: sp?.tief ?? null,
        hoch: sp?.hoch ?? null,
        welle: Number.isFinite(w) ? w : null,
        momentum: zustand(w, grenze).code,
        marken: [...oben, ...unten].map((x) => ({
            preis: x.preis,
            beruehrungen: x.beruehrungen,
            durchquerungen: x.durchquerungen,
            abstandAtr: (x.preis - kurs) / atrWert,
        })),
    }
}

/**
 * Marken, die dicht beieinander liegen und aus mindestens zwei Quellen kommen
 * (zwei Zeitrahmen, oder Zeitrahmen und eigene Zeichnung). Zwei Marken desselben
 * Zeitrahmens bestätigen einander nicht — das ist nur ein breites Band.
 */
export function findeTreffen(marken, toleranz, kurs) {
    if (!(toleranz > 0)) return []
    const sortiert = [...marken].filter((m) => Number.isFinite(m.preis)).sort((a, b) => a.preis - b.preis)
    const gruppen = []
    let g = []
    for (const m of sortiert) {
        if (g.length && m.preis - g[0].preis > toleranz) { gruppen.push(g); g = [] }
        g.push(m)
    }
    if (g.length) gruppen.push(g)
    return gruppen
        .filter((x) => new Set(x.map((m) => m.quelle)).size >= 2)
        .map((x) => ({ preis: x.reduce((s, m) => s + m.preis, 0) / x.length, ids: x.map((m) => m.id), quellen: [...new Set(x.map((m) => m.quelle))] }))
        .sort((a, b) => Math.abs(a.preis - kurs) - Math.abs(b.preis - kurs))
        .slice(0, TREFFEN_MAX)
        .map((x, i) => ({ id: `C${i + 1}`, ...x }))
}

/**
 * Das ganze Bild aus den Kerzen aller Zeitrahmen.
 * @param {object} p
 * @param {Record<string, Array>} p.serien  tf → geschlossene Kerzen (fehlend: null)
 * @param {string} p.interval               Zeiteinheit des Charts
 * @param {number} p.kurs                   Kurs des Charts (letzter Schluss der Chart-Zeiteinheit); fehlt er,
 *                                          gilt der jüngste Schluss des feinsten Zeitrahmens mit Kerzen
 * @param {number} p.atrChart               ATR des Charts (Ersatz für die Toleranz)
 * @param {Array}  p.eigene                 `paket.beziehungen.marken`: [{u, art, preis}]
 */
export function baueZeitrahmen({ serien, interval, kurs: kursEin, atrChart, eigene = [], grenze = OB_LVL, jetzt = Date.now() }) {
    const reihenfolge = zeitrahmenFuer(interval)
    // Ein Kurs für alle Zeilen: der des Charts, sonst der jüngste Schluss des feinsten Zeitrahmens.
    let kurs = Number.isFinite(kursEin) && kursEin > 0 ? kursEin : null
    for (let i = reihenfolge.length - 1; kurs == null && i >= 0; i--) {
        const k = serien[reihenfolge[i]]
        const c = Array.isArray(k) && k.length ? k[k.length - 1].c : null
        if (Number.isFinite(c) && c > 0) kurs = c
    }
    const zeilen = reihenfolge.map((tf) => messeZeitrahmen(serien[tf], tf, { grenze, kurs }) || { tf, unbekannt: true })
    const marken = []
    for (const z of zeilen) {
        if (z.unbekannt) continue
        for (const m of z.marken) marken.push({ ...m, id: `Z${marken.length + 1}`, tf: z.tf })
    }
    const stunde = zeilen.find((z) => z.tf === '1h' && !z.unbekannt)
    const toleranz = TREFFEN_ATR * (stunde?.atr ?? atrChart)
    const fuerTreffen = [
        ...marken.map((m) => ({ id: m.id, preis: m.preis, quelle: m.tf })),
        ...eigene.map((m) => ({ id: m.u, preis: m.preis, quelle: 'eigene' })),
    ]
    const treffen = findeTreffen(fuerTreffen, toleranz, kurs)
    const bekannt = zeilen.filter((z) => !z.unbekannt)
    const gleichlauf = {
        auf: bekannt.filter((z) => z.zustand === 1).length,
        ab: bekannt.filter((z) => z.zustand === -1).length,
        offen: bekannt.filter((z) => z.zustand === 0).length,
    }
    // Wie viel der üblichen Tagesbewegung ist durch? 15m statt 5m reicht für Hoch und Tief des Tages.
    const tag = rechneTagesbild({ k5m: serien['15m'] || [], k1h: serien['1h'] || [], kTag: serien['1d'] || [], jetzt })
    const tagesbewegung = Number.isFinite(tag.ueblich?.genutztPct)
        ? { genutztPct: tag.ueblich.genutztPct, spannePct: tag.tag?.spannePct ?? null, ueblichPct: tag.ueblich.spannePct }
        : null
    return { kurs, zeilen, marken, treffen, gleichlauf, tagesbewegung }
}

const STRUKTUR = { 1: 'aufwärts', '-1': 'abwärts', 0: 'offen' }
const MOMENTUM = { long: 'überverkauft', fastLong: 'nahe überverkauft', neutral: 'neutral', fastShort: 'nahe überkauft', short: 'überkauft' }

/** Der Block für das Modell. */
export function zeitrahmenText(zr, zeit) {
    const z = ['ZEITRAHMEN — vom Code gemessen, nur geschlossene Kerzen, von gross nach klein (Struktur = gilt bis zum Bruch; Lage in der Spanne und Abstand der Marken gegen den Kurs des Charts):']
    for (const x of zr.zeilen) {
        if (x.unbekannt) { z.push(`${x.tf}: unbekannt (zu wenige Kerzen)`); continue }
        const bruch = x.bruch ? `, letzter Bruch ${x.bruch.richtung === 'auf' ? 'über' : 'unter'} ${zahl(x.bruch.marke)} am ${zeit(x.bruch.t)}` : ''
        const spanne = `der Spanne der letzten ${SPANNE_KERZEN} Kerzen (${zahl(x.tief)}–${zahl(x.hoch)})`
        // Der Kurs des Charts kann die Spanne der geschlossenen Kerzen verlassen haben: das sagen, statt «135 %»
        const lage = !Number.isFinite(x.lagePct) ? 'Spanne unbekannt'
            : x.lagePct > 100 ? `Kurs über ${spanne}`
            : x.lagePct < 0 ? `Kurs unter ${spanne}`
            : `Kurs bei ${x.lagePct.toFixed(0)} % ${spanne}`
        const mom = x.welle == null ? 'Momentum unbekannt' : `Momentum ${MOMENTUM[x.momentum] || x.momentum} (${x.welle.toFixed(0)})`
        z.push(`${x.tf}: Struktur ${STRUKTUR[x.zustand]}${bruch}; ${lage}; ${mom}; ATR ${x.atrPct.toFixed(2)} %`)
    }
    const g = zr.gleichlauf
    z.push('', `GLEICHLAUF: ${g.auf} aufwärts, ${g.ab} abwärts, ${g.offen} offen.`)
    if (zr.tagesbewegung) z.push(`TAGESBEWEGUNG: heute ${zr.tagesbewegung.genutztPct.toFixed(0)} % der üblichen Tagesspanne genutzt (Median der letzten Tage).`)
    if (zr.marken.length) {
        z.push('', 'MARKEN JE ZEITRAHMEN — geclusterte Hochs/Tiefs mit mindestens zwei Berührungen, die nächsten über und unter dem Kurs (id | Zeitrahmen | Preis | Berührungen | Durchquerungen | Abstand in ATR dieses Zeitrahmens):')
        for (const m of zr.marken) z.push(`${m.id} | ${m.tf} | ${zahl(m.preis)} | ${m.beruehrungen} | ${m.durchquerungen} | ${m.abstandAtr >= 0 ? '+' : ''}${m.abstandAtr.toFixed(1)}`)
    }
    if (zr.treffen.length) {
        z.push('', 'ZUSAMMENTREFFEN — Marken verschiedener Quellen auf gleicher Höhe (id | Preis | beteiligte Marken):')
        for (const t of zr.treffen) z.push(`${t.id} | ${zahl(t.preis)} | ${t.ids.join(', ')}`)
    } else z.push('', 'ZUSAMMENTREFFEN: keine.')
    return z.join('\n')
}

/** Die Tabelle für den Reiter: nur Gemessenes, kostet keinen KI-Aufruf. */
export function zeitrahmenTabelle(zr) {
    return zr.zeilen.map((x) => (x.unbekannt ? { tf: x.tf, unbekannt: true } : {
        tf: x.tf,
        zustand: x.zustand,
        bruchRichtung: x.bruch?.richtung ?? null,
        bruchMarke: x.bruch?.marke ?? null,
        lagePct: x.lagePct,
        momentum: x.momentum,
        welle: x.welle,
    }))
}
