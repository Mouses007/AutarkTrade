/**
 * ECharts-Optionen des Strategien-Modus: Kapitalkurve und R-Verteilung.
 * Farben aus den Gestaltungs-Tokens (journal/diagramme/gestaltung.js).
 */
import dayjs from '../journal/zeit.js'
import { farbeText, farbeGedaempft, farbeLinie, farbeFlaeche, greenColor, redColor } from '../journal/diagramme/gestaltung.js'

const achse = { axisLine: { lineStyle: { color: farbeLinie } }, axisLabel: { color: farbeGedaempft, fontSize: 10 } }
const tooltip = { trigger: 'axis', backgroundColor: farbeFlaeche, borderColor: 'rgba(255,255,255,0.15)', textStyle: { color: farbeText, fontSize: 11 } }
const gitter = { splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } }
const raster = { left: 8, right: 12, top: 16, bottom: 20, containLabel: true }

/** Kapitalkurve aus `[{ t, equity }]`; null ohne Daten. */
export function kapitalkurve(kurve) {
    if (!Array.isArray(kurve) || !kurve.length) return null
    return {
        backgroundColor: 'transparent', grid: raster, tooltip,
        xAxis: { type: 'category', ...achse, data: kurve.map((p) => dayjs(p.t).format('DD.MM.')), splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...achse, ...gitter },
        series: [{
            type: 'line', smooth: true, showSymbol: false, data: kurve.map((p) => Number(p.equity.toFixed(2))),
            lineStyle: { color: '#1fd6c4', width: 2 }, areaStyle: { color: 'rgba(31,214,196,0.12)' },
        }],
    }
}

/** R-Verteilung aus `[{ von, bis, n }]`; null ohne Daten. */
export function rVerteilung(stufen) {
    if (!Array.isArray(stufen) || !stufen.some((s) => s.n > 0)) return null
    return {
        backgroundColor: 'transparent', grid: raster, tooltip,
        xAxis: {
            type: 'category', ...achse, splitLine: { show: false },
            data: stufen.map((b) => (b.bis === null || !Number.isFinite(b.bis) ? `≥${b.von}R` : `${b.von}…${b.bis}R`)),
        },
        yAxis: { type: 'value', ...achse, ...gitter },
        series: [{ type: 'bar', data: stufen.map((b) => ({ value: b.n, itemStyle: { color: b.von < 0 ? redColor : greenColor } })) }],
    }
}
