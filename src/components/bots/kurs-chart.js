/**
 * Optionen des Kurs-Charts der Bot-Seite (ECharts), rein — damit sie sich auch
 * ohne Vue rendern und prüfen lassen. Skala/Grid-Linien: src/utils/bot-chart.js.
 */
import { palette, mitDeckkraft, tooltipStil, schrift, grundOption, wertAchse } from '@/utils/journal/diagramme/gestaltung.js'
import { gridStufen, chartSkala, abstandProzent, duenneAus, legeBeschriftungen, MAX_GRID_LINIEN } from '@/utils/bot-chart.js'
import { preis, zahl, datum } from './format.js'

// Feste Ränder statt `containLabel`: nur so ist bekannt, wo die Zeichenfläche liegt —
// für die Randhinweise (standen auf der obersten Achsenzahl) und die Plätze der Beschriftungen.
const ACHSE_RECHTS = 72     // Platz der Preisachse
const RAND_LINKS = 8
const RAND_OBEN = 10
const RAND_UNTEN = 26       // Zeitachse
const ZEILE = 15            // Höhe eines Randhinweises

/**
 * @param b Bot (normalisiert), kerzen [[t, o, h, l, c], …], t i18n, p Palette
 * @param mass {breite, hoehe} des Chart-Elements in px (für die Plätze der Beschriftungen)
 */
export function kursChartOption(b, kerzen, t, p = palette(), { breite = 900, hoehe = 360 } = {}) {
    const x = kerzen.map((kz) => datum(kz[0]))
    // Linien: `immer` gehört sicher auf die Achse (nur der Kurs), der Rest nur, wenn er nahe liegt —
    // sonst ein Randhinweis oben/unten statt Kerzen, die zum Strich zusammengedrückt werden.
    // Reihenfolge = Rang beim Beschriften: der Kurs zuerst.
    const kandidaten = []
    const kurs = b.laufend ? b.kurs : null
    kandidaten.push({ wert: kurs, name: t('bots.feld.kurs'), farbe: p.text, typ: 'solid', immer: true, pos: 'insideStartBottom' })
    kandidaten.push({ wert: b.position?.einstieg, name: t('bots.feld.einstieg'), farbe: p.accent, typ: 'dotted', pos: 'insideEndTop' })
    kandidaten.push({ wert: b.liquidation?.unten, name: 'Liq', farbe: p.bad, pos: 'insideEndBottom' })
    kandidaten.push({ wert: b.liquidation?.oben, name: 'Liq', farbe: p.bad })
    if (b.laufend && b.stops?.stopLoss && /price/.test(b.stops.stopLoss.art || '')) kandidaten.push({ wert: b.stops.stopLoss.wert, name: 'SL', farbe: p.warn })
    if (b.laufend && b.stops?.stopLossOben && /price/.test(b.stops.stopLossOben.art || '')) kandidaten.push({ wert: b.stops.stopLossOben.wert, name: 'SL', farbe: p.warn })
    if (b.laufend && b.stops?.takeProfit && /price/.test(b.stops.takeProfit.art || '')) kandidaten.push({ wert: b.stops.takeProfit.wert, name: 'TP', farbe: p.good })
    // Startpreis rechts: links stehen die ersten Kerzen genau auf dieser Linie und strichen den Text durch
    kandidaten.push({ wert: b.position?.startPreis, name: t('bots.feld.startPreis'), farbe: p.muted, typ: 'dotted', pos: 'insideEndTop' })
    const da = kandidaten.filter((l) => l.wert != null && Number.isFinite(l.wert))
    const skala = chartSkala(kerzen.flatMap((kz) => [kz[2], kz[3]]), da, { unten: b.grid?.unten, oben: b.grid?.oben })
    // Kerzen ohne brauchbare Zahlen und keine feste Linie: lieber ein leerer Chart als ein TypeError in der Karte
    if (!skala) return { ...grundOption(p), xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [] }
    const { lo, hi } = skala
    const linien = []
    const randOben = [], randUnten = []
    const randText = (name, wert) => {
        const ab = abstandProzent(wert, kurs)
        return `${name} ${preis(wert)}${ab != null ? ` (${ab > 0 ? '+' : '−'}${zahl(Math.abs(ab), 1)} %)` : ''}`
    }
    const beschriftet = []
    for (const l of da) {
        if (skala.innen(l.wert)) beschriftet.push({ ...l, text: `${l.name} ${preis(l.wert)}`, wunsch: l.pos })
        else (l.wert > hi ? randOben : randUnten).push({ text: randText(l.name, l.wert), farbe: l.farbe })
    }
    // Band: Enden als Linie, wenn sichtbar, sonst als Randhinweis
    const gu = b.grid?.unten, go = b.grid?.oben
    const hatBand = gu != null && go != null
    const bandLinien = []
    if (hatBand) {
        for (const [wert, name] of [[gu, t('bots.chartBandUnten')], [go, t('bots.chartBandOben')]]) {
            if (skala.innen(wert)) { bandLinien.push(wert); linien.push({ yAxis: wert, lineStyle: { color: mitDeckkraft(p.accent, 0.7), type: 'solid', width: 1 }, label: { show: false } }) }
            else (wert > hi ? randOben : randUnten).push({ text: randText(name, wert), farbe: p.accent })
        }
    }
    // Randhinweise bekommen eigene Zeilen über bzw. unter der Zeichenfläche, rechtsbündig an ihr
    const oben = RAND_OBEN + randOben.length * ZEILE
    const unten = RAND_UNTEN + randUnten.length * ZEILE
    const flaecheH = Math.max(1, hoehe - oben - unten)
    // Grid-Linien dünn. Sehr viele: jede n-te statt gar keiner (Audit UI-14) — und nie dichter als
    // alle 6 px, sonst verschmelzen sie zu Streifen, die wie eigene Linien aussehen
    let hatGrid = false
    if (hatBand) {
        const stufen = duenneAus(gridStufen(gu, go, b.grid?.anzahl, b.grid?.art, !!b.coinM).slice(1, -1).filter((v) => skala.innen(v)), Math.max(1, Math.min(MAX_GRID_LINIEN, Math.floor(flaecheH / 6)))).werte
        hatGrid = stufen.length > 0
        for (const v of stufen) linien.push({ yAxis: v, lineStyle: { color: mitDeckkraft(p.accent, 0.22), type: 'solid', width: 1 }, label: { show: false } })
    }
    // Beschriftungen so legen, dass kein Text auf einem anderen oder auf einer fremden Linie steht
    const plaetze = legeBeschriftungen(beschriftet, { lo, hi, hoehe: flaecheH, breite: Math.max(1, breite - RAND_LINKS - ACHSE_RECHTS), hindernisse: bandLinien })
    beschriftet.forEach((l, i) => linien.push({
        yAxis: l.wert, name: l.name, lineStyle: { color: l.farbe, type: l.typ || 'dashed', width: 1 },
        label: { formatter: l.text, color: l.farbe, position: plaetze[i], fontSize: 11, distance: 4, ...(p.panel ? { backgroundColor: mitDeckkraft(p.panel, 0.7), padding: [1, 3], borderRadius: 2 } : {}) },
    }))
    const randGrafik = (liste, istOben) => liste.map((r, i) => ({
        type: 'text', right: ACHSE_RECHTS + 4, ...(istOben ? { top: 6 + i * ZEILE } : { bottom: 4 + (liste.length - 1 - i) * ZEILE }), silent: true,
        style: { text: (istOben ? '↑ ' : '↓ ') + r.text, fill: r.farbe, font: `11px ${p.schrift || 'sans-serif'}` },
    }))
    return {
        ...grundOption(p),
        grid: { left: RAND_LINKS, right: ACHSE_RECHTS, top: oben, bottom: unten, containLabel: false, outerBoundsMode: 'none' },
        tooltip: { trigger: 'axis', ...tooltipStil(p), valueFormatter: (v) => preis(v) },
        xAxis: { type: 'category', data: x, axisLabel: { ...schrift(p), hideOverlap: true, alignMinLabel: 'left', alignMaxLabel: 'right' }, axisLine: { lineStyle: { color: p.line } } },
        // die gestrichelten Hilfslinien der Achse nur ohne Grid-Linien: beides zusammen ist nicht zu unterscheiden
        yAxis: { ...wertAchse(p), scale: true, position: 'right', min: lo, max: hi, ...(hatGrid ? { splitLine: { show: false } } : {}), axisLabel: { ...schrift(p), formatter: (v) => preis(v), showMinLabel: false, showMaxLabel: false } },
        graphic: [...randGrafik(randOben, true), ...randGrafik(randUnten, false)],
        // Mausrad und senkrechtes Wischen gehören der Seite: zoomen nur mit Strg+Rad bzw. zwei Fingern,
        // verschieben durch Ziehen (Audit UI-16)
        dataZoom: [{ type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, preventDefaultMouseMove: false }],
        series: [{
            type: 'candlestick',
            // ECharts: [open, close, low, high]
            data: kerzen.map((kz) => [kz[1], kz[4], kz[3], kz[2]]),
            itemStyle: { color: p.good, color0: p.bad, borderColor: p.good, borderColor0: p.bad },
            markArea: b.grid?.unten != null ? {
                silent: true,
                itemStyle: { color: mitDeckkraft(p.accent, 0.08), borderWidth: 0 },
                data: [[{ yAxis: b.grid.unten }, { yAxis: b.grid.oben }]],
            } : undefined,
            // precision: ECharts rundet die Lage der Linien sonst auf 2 Nachkommastellen —
            // SL 1.005 stand auf 1.00, bei Coins unter 0.01 lägen alle Linien auf 0
            markLine: { symbol: 'none', silent: true, precision: 12, data: linien },
        }],
    }
}
