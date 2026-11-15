/**
 * Optionen des Kurs-Charts der Bot-Seite (ECharts), rein — damit sie sich auch
 * ohne Vue rendern und prüfen lassen. Skala/Grid-Linien: src/utils/bot-chart.js.
 */
import { palette, mitDeckkraft, tooltipStil, schrift, grundOption, wertAchse } from '@/utils/journal/diagramme/gestaltung.js'
import { gridStufen, chartSkala, abstandProzent } from '@/utils/bot-chart.js'
import { preis, zahl, datum } from './format.js'

/** @param b Bot (normalisiert), kerzen [[t, o, h, l, c], …], t i18n, p Palette */
export function kursChartOption(b, kerzen, t, p = palette()) {
    const x = kerzen.map((kz) => datum(kz[0]))
    // Linien: `immer` gehört sicher auf die Achse, der Rest nur, wenn er nahe liegt —
    // sonst ein Randhinweis oben/unten statt Kerzen, die zum Strich zusammengedrückt werden.
    const kandidaten = []
    const kurs = b.laufend ? b.kurs : null
    kandidaten.push({ wert: b.liquidation?.unten, name: 'Liq', farbe: p.bad })
    kandidaten.push({ wert: b.liquidation?.oben, name: 'Liq', farbe: p.bad })
    kandidaten.push({ wert: b.position?.einstieg, name: t('bots.feld.einstieg'), farbe: p.accent, typ: 'dotted', immer: true })
    kandidaten.push({ wert: b.position?.startPreis, name: t('bots.feld.startPreis'), farbe: p.muted, typ: 'dotted', pos: 'insideStartTop' })
    kandidaten.push({ wert: kurs, name: t('bots.feld.kurs'), farbe: p.text, typ: 'solid', immer: true, pos: 'insideStartBottom' })
    if (b.stops?.stopLoss && /price/.test(b.stops.stopLoss.art || '')) kandidaten.push({ wert: b.stops.stopLoss.wert, name: 'SL', farbe: p.warn })
    if (b.stops?.takeProfit && /price/.test(b.stops.takeProfit.art || '')) kandidaten.push({ wert: b.stops.takeProfit.wert, name: 'TP', farbe: p.good })
    const da = kandidaten.filter((l) => l.wert != null && Number.isFinite(l.wert))
    const skala = chartSkala(kerzen.flatMap((kz) => [kz[2], kz[3]]), da, { unten: b.grid?.unten, oben: b.grid?.oben })
    const { lo, hi } = skala
    const linien = []
    const randOben = [], randUnten = []
    const randText = (name, wert) => {
        const ab = abstandProzent(wert, kurs)
        return `${name} ${preis(wert)}${ab != null ? ` (${ab > 0 ? '+' : '−'}${zahl(Math.abs(ab), 1)} %)` : ''}`
    }
    for (const l of da) {
        if (skala.innen(l.wert)) linien.push({ yAxis: l.wert, name: l.name, lineStyle: { color: l.farbe, type: l.typ || 'dashed', width: 1 }, label: { formatter: `${l.name} ${preis(l.wert)}`, color: l.farbe, position: l.pos || 'insideEndTop' } })
        else (l.wert > hi ? randOben : randUnten).push({ text: randText(l.name, l.wert), farbe: l.farbe })
    }
    // Band: Enden als Linie, wenn sichtbar, sonst als Randhinweis; Grid-Linien dazwischen dünn
    const gu = b.grid?.unten, go = b.grid?.oben
    if (gu != null && go != null) {
        for (const [wert, name] of [[gu, t('bots.chartBandUnten')], [go, t('bots.chartBandOben')]]) {
            if (skala.innen(wert)) linien.push({ yAxis: wert, lineStyle: { color: mitDeckkraft(p.accent, 0.7), type: 'solid', width: 1 }, label: { show: false } })
            else (wert > hi ? randOben : randUnten).push({ text: randText(name, wert), farbe: p.accent })
        }
        const stufen = gridStufen(gu, go, b.grid?.anzahl, b.grid?.art, !!b.coinM).slice(1, -1).filter((v) => skala.innen(v))
        if (stufen.length <= 80) for (const v of stufen) linien.push({ yAxis: v, lineStyle: { color: mitDeckkraft(p.accent, 0.22), type: 'solid', width: 1 }, label: { show: false } })
    }
    // je Hinweis eine Zeile in seiner Farbe; oben von oben nach unten, unten von unten nach oben
    const randGrafik = (liste, oben) => liste.map((r, i) => ({
        type: 'text', right: 78, ...(oben ? { top: 18 + i * 15 } : { bottom: 44 + i * 15 }), silent: true,
        style: { text: (oben ? '↑ ' : '↓ ') + r.text, fill: r.farbe, font: `11px ${p.schrift || 'sans-serif'}` },
    }))
    return {
        ...grundOption(p),
        grid: { left: 28, right: 70, top: 16, bottom: 28, containLabel: true },
        tooltip: { trigger: 'axis', ...tooltipStil(p), valueFormatter: (v) => preis(v) },
        xAxis: { type: 'category', data: x, axisLabel: { ...schrift(p) }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: { ...wertAchse(p), scale: true, position: 'right', min: lo, max: hi, axisLabel: { ...schrift(p), formatter: (v) => preis(v), showMinLabel: false, showMaxLabel: false } },
        graphic: [...randGrafik(randOben, true), ...randGrafik(randUnten, false)],
        dataZoom: [{ type: 'inside' }],
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
            markLine: { symbol: 'none', silent: true, data: linien },
        }],
    }
}
