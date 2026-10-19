/**
 * Rechnungen der Auswertungsseite (Spezifikation ansichten.md W.2–W.6).
 *
 * Rein: Eingaben herein, Zahlen heraus. „Gewinner" heisst hier überall
 * `trade[fall + 'Wins'] > 0` — Break-even zählt damit als Verlierer, anders
 * als auf dem Dashboard (`istGewinn`). Das ist die gespeicherte Rechenregel
 * dieser Seite und bleibt, bis jemand sie bewusst umstellt.
 */

const rund = (x) => Math.round(x)

export function istGewinner(trade, fall) {
    return Number(trade?.[`${fall}Wins`]) > 0
}

/** Tag-Liste eines Eintrags aus `tags`: Liste, JSON-Text oder nichts. */
function tagListe(wert) {
    if (Array.isArray(wert)) return wert
    if (typeof wert === 'string') {
        try {
            const l = JSON.parse(wert)
            return Array.isArray(l) ? l : []
        } catch {
            return []
        }
    }
    return []
}

/** Die Basisdaten aus W.2 in einem Zug. */
export function basis({ gefilterteTage, notizen, tagZeilen, katalog }) {
    const trades = []
    for (const tag of gefilterteTage || []) for (const t of tag?.trades || []) trades.push(t)
    const ids = new Set(trades.map(t => t.id))

    const notizJeTrade = new Map()
    for (const n of notizen || []) if (n?.tradeId) notizJeTrade.set(n.tradeId, n)
    const brokerNotizen = (notizen || []).filter(n => n?.tradeId && ids.has(n.tradeId))

    const tagsJeTrade = new Map()
    for (const z of tagZeilen || []) if (z?.tradeId) tagsJeTrade.set(z.tradeId, tagListe(z.tags))

    const gesehen = new Set()
    const gruppen = []
    for (const g of katalog || []) {
        const k = g?.id ?? g?.name
        if (gesehen.has(k)) continue
        gesehen.add(k)
        gruppen.push(g)
    }

    const tradeVon = new Map(trades.map(t => [t.id, t]))
    return { trades, notizJeTrade, brokerNotizen, tagsJeTrade, gruppen, tradeVon }
}

const anteil = (teil, ganz) => (ganz ? rund((teil / ganz) * 100) : 0)

/** Tachos (W.4). */
export function tachos(b, fall, zufriedenheiten) {
    const { trades, notizJeTrade, tagsJeTrade } = b
    const long = trades.filter(t => t.strategy === 'long')
    const short = trades.filter(t => t.strategy === 'short')
    const quote = (liste) => anteil(liste.filter(t => istGewinner(t, fall)).length, liste.length)

    /* eslint-disable-next-line eqeqeq -- lose Gleichheit: 1, true, "1" zufrieden */
    const zufrieden = zufriedenheiten.filter(x => x?.satisfaction == true || x?.satisfaction == 1).length

    const erfasst = trades.filter(t => {
        const n = notizJeTrade.get(t.id)
        const hatNotiz = n && (n.playbook || n.timeframe || n.entryStressLevel > 0 || n.emotionLevel > 0 || n.feelings || n.entryNote)
        return hatNotiz || (tagsJeTrade.get(t.id) || []).length > 0
    }).length

    return {
        longAnteil: trades.length ? anteil(long.length, trades.length) : 50,
        long: { anzahl: long.length, quote: quote(long) },
        short: { anzahl: short.length, quote: quote(short) },
        zufriedenheit: anteil(zufrieden, zufriedenheiten.length),
        bewertungen: zufriedenheiten.length,
        vollstaendig: anteil(erfasst, trades.length),
        anzahl: trades.length,
    }
}

/** Tag-Gruppen-Karten (W.5). */
export function tagGruppen(b, fall) {
    const aus = []
    for (const g of b.gruppen) {
        if (!g?.tags?.length) continue
        const zeilen = []
        for (const tag of g.tags) {
            const liste = b.trades.filter(t => (b.tagsJeTrade.get(t.id) || []).includes(tag.id))
            if (!liste.length) continue
            const gewinner = liste.filter(t => istGewinner(t, fall)).length
            zeilen.push({
                id: tag.id,
                name: tag.name,
                anzahl: liste.length,
                gewinner,
                verlierer: liste.length - gewinner,
                quote: rund((gewinner / liste.length) * 100),
                pnl: liste.reduce((s, t) => s + (Number(t[`${fall}Proceeds`]) || 0), 0),
            })
        }
        if (!zeilen.length) continue
        zeilen.sort((a, b2) => b2.anzahl - a.anzahl)
        aus.push({ name: g.name, farbe: g.color || '', zeilen })
    }
    return aus
}

/** Diagrammdaten je Gruppe: Verluste negativ, damit die Balken nach links zeigen. */
export function tagGruppenDiagramme(gruppen) {
    return gruppen.map((g, i) => ({
        element: `hbarTagGroup${i}`,
        kategorien: g.zeilen.map(z => z.name),
        gewinne: g.zeilen.map(z => z.gewinner),
        verluste: g.zeilen.map(z => -z.verlierer),
    }))
}

/** Zeitrahmen-Nutzung (W.6.1). */
export function zeitrahmen(b, fall) {
    const je = new Map()
    for (const n of b.brokerNotizen) {
        if (!n.timeframe) continue
        const e = je.get(n.timeframe) || { name: n.timeframe, anzahl: 0, gewinner: 0 }
        e.anzahl += 1
        if (istGewinner(b.tradeVon.get(n.tradeId), fall)) e.gewinner += 1
        je.set(n.timeframe, e)
    }
    return [...je.values()].sort((a, c) => c.anzahl - a.anzahl)
}

/** Verlauf eines Pegels (Stress, Emotion) über die Zeit, nur Werte > 0. */
export function verlauf(b, feld) {
    const liste = b.brokerNotizen.filter(n => n[feld] > 0).sort((a, c) => a.dateUnix - c.dateUnix)
    const summe = liste.reduce((s, n) => s + Number(n[feld]), 0)
    return { liste, schnitt: liste.length ? summe / liste.length : 0 }
}

/**
 * Gewinnquote je Pegelstufe. Stress läuft 0…5 (0 = „nicht erfasst", weil
 * fehlender Stress zu 0 normalisiert ist; 6–10 fallen heraus) — Rechenregel
 * der Seite, so nachgebildet. Emotion läuft 1…10.
 */
export function quoteJeStufe(b, feld, von, bis, fall) {
    const aus = []
    for (let s = von; s <= bis; s++) {
        const liste = b.brokerNotizen.filter(n => Number(n[feld]) === s)
        if (!liste.length) continue
        const gew = liste.filter(n => istGewinner(b.tradeVon.get(n.tradeId), fall)).length
        aus.push({ stufe: s, quote: rund((gew / liste.length) * 100) })
    }
    return aus
}

/** Vollständigkeits-Radar (W.6.6): sechs Anteile in Prozent. */
export function radarWerte(b) {
    const n = b.trades.length
    if (!n) return [0, 0, 0, 0, 0, 0]
    const mit = (pruef) => anteil(b.trades.filter(t => pruef(b.notizJeTrade.get(t.id), t)).length, n)
    return [
        mit(x => !!x?.playbook),
        mit(x => !!x?.timeframe),
        mit(x => x?.entryStressLevel > 0),
        mit(x => x?.emotionLevel > 0),
        mit(x => !!(x?.entryNote || x?.note)),
        mit((_x, t) => (b.tagsJeTrade.get(t.id) || []).length > 0),
    ]
}
