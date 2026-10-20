/**
 * Diagramme der Auswertungsseite (`src/views/Auswertung.vue`): Tacho,
 * horizontale Balken, geteilte Gewinn/Verlust-Balken, Verlaufslinie, Radar.
 * Die Datenaufbereitung liegt in der Ansicht; hier wird nur gezeichnet.
 */
import { escHtml } from '../../escHtml.js'
import { element, instanzFuer, echarts, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft } from './gestaltung.js'

export function useGaugeChart(id, wert, titel, farbstopps) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    const stopps = farbstopps || [[0.3, mitDeckkraft(p.bad, 0.85)], [0.7, mitDeckkraft(p.warn, 0.85)], [1, mitDeckkraft(p.good, 0.85)]]
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        series: [{
            type: 'gauge',
            startAngle: 180,
            endAngle: 0,
            min: 0,
            max: 100,
            radius: '100%',
            center: ['50%', '72%'],
            splitNumber: 2,
            axisLine: { lineStyle: { width: 12, color: stopps } },
            pointer: { length: '58%', width: 4, itemStyle: { color: p.text } },
            anchor: { show: true, size: 8, itemStyle: { color: p.text } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: {
                color: p.muted, fontSize: 10, distance: -30,
                formatter: (v) => (v === 0 || v === 50 || v === 100 ? String(v) : ''),
            },
            title: { offsetCenter: [0, '38%'], color: p.muted, fontSize: 11, fontFamily: p.schrift },
            detail: { offsetCenter: [0, '16%'], color: p.text, fontSize: 18, fontWeight: 600, fontFamily: p.schrift, formatter: (v) => `${Math.round(v)}%` },
            data: [{ value: Math.round(Number(wert) * 10) / 10, name: titel }],
        }],
    })
    return Promise.resolve()
}

export function useHorizontalBarChart(id, kategorien, werte, farben) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    const zahlText = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(1))
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
        tooltip: { trigger: 'item', ...tooltipStil(p), formatter: (x) => `${escHtml(x.name)}: ${zahlText(x.value)}` },
        xAxis: wertAchse(p),
        yAxis: { ...kategorieAchse(p), data: kategorien },
        series: [{
            type: 'bar',
            barMaxWidth: 18,
            label: { show: true, position: 'right', color: p.muted, fontSize: 10, formatter: (x) => zahlText(x.value) },
            data: (werte || []).map((v, i) => ({ value: v, itemStyle: { color: farben?.[i] || p.goodBalken, borderRadius: 3 } })),
        }],
    })
    return Promise.resolve()
}

export function useSplitBarChart(id, kategorien, gewinne, verluste) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    const grenze = Math.max(...[...(gewinne || []), ...(verluste || [])].map(v => Math.abs(v)), 0) + 1
    const beschriftung = (vorzeichen) => (x) => (x.value === 0 ? '' : `${vorzeichen}${Math.abs(x.value)}`)
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            ...tooltipStil(p),
            formatter: (punkte) => {
                const i = punkte[0]?.dataIndex ?? 0
                return `${escHtml(kategorien[i])}<br>${t('charts.wins')}: ${Math.abs(gewinne[i] ?? 0)}<br>${t('charts.losses')}: ${Math.abs(verluste[i] ?? 0)}`
            },
        },
        xAxis: wertAchse(p, { min: -grenze, max: grenze, axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => String(Math.abs(v)) } }),
        yAxis: { ...kategorieAchse(p), data: kategorien },
        series: [
            {
                name: t('charts.wins'), type: 'bar', stack: 'gesamt', barMaxWidth: 18,
                label: { show: true, position: 'right', color: p.muted, fontSize: 10, formatter: beschriftung('+') },
                data: (gewinne || []).map(v => ({ value: v, itemStyle: { color: p.goodBalken, borderRadius: [0, 3, 3, 0] } })),
            },
            {
                name: t('charts.losses'), type: 'bar', stack: 'gesamt', barMaxWidth: 18,
                label: { show: true, position: 'left', color: p.muted, fontSize: 10, formatter: beschriftung('−') },
                data: (verluste || []).map(v => ({ value: v, itemStyle: { color: p.badBalken, borderRadius: [3, 0, 0, 3] } })),
            },
        ],
    }, true)
    return Promise.resolve()
}

export function useStressLineChart(id, daten, werte, optionen = {}) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    const { max = 5, color = p.accent, name = 'Stresslevel' } = optionen
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', ...tooltipStil(p) },
        xAxis: { ...kategorieAchse(p, { boundaryGap: false }), axisLabel: { ...kategorieAchse(p).axisLabel, rotate: (daten || []).length > 15 ? 40 : 0 }, data: daten },
        yAxis: wertAchse(p, { min: 0, max, interval: max <= 5 ? 1 : 2 }),
        series: [{
            name,
            type: 'line',
            smooth: true,
            symbolSize: 5,
            lineStyle: { color, width: 2 },
            itemStyle: { color },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: mitDeckkraft(color, 0.3) },
                    { offset: 1, color: mitDeckkraft(color, 0) },
                ]),
            },
            data: werte,
        }],
    })
    return Promise.resolve()
}

export function useRadarChart(id, indikatoren, werte) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        tooltip: { trigger: 'item', ...tooltipStil(p) },
        radar: {
            shape: 'circle',
            indicator: indikatoren,
            radius: '68%',
            axisName: { color: p.muted, fontSize: 10, fontFamily: p.schrift },
            splitLine: { lineStyle: { color: p.gitter } },
            splitArea: { show: false },
            axisLine: { lineStyle: { color: p.gitter } },
        },
        series: [{
            type: 'radar',
            symbolSize: 4,
            lineStyle: { color: p.accent, width: 2 },
            itemStyle: { color: p.accent },
            areaStyle: { color: mitDeckkraft(p.accent, 0.18) },
            data: [{ value: werte, name: t('charts.completeness') }],
        }],
    })
    return Promise.resolve()
}
