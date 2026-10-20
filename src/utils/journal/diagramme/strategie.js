/**
 * Diagramme der Strategie-Schicht: ein einzelnes Setup und der Zeitstrahl
 * eines Symbols (Setups als Zonen, Trades als Punkte).
 *
 * Beide synchron: Instanz frisch anlegen (vorhandene entsorgen), Option
 * setzen, Instanz zurückgeben — oder null ohne Element/Kerzen.
 * Kerzen kommen als [{t (ms), o, h, l, c}] aufsteigend.
 */
import dayjs from '../zeit.js'
import { tradeZeitzone } from '../../../stores/ui.js'
import { element, frischeInstanz, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft } from './gestaltung.js'

function kerzenBasis(kerzen) {
    const zone = tradeZeitzone.value
    return {
        kategorien: kerzen.map(k => dayjs.unix(Math.floor(k.t / 1000)).tz(zone).format('DD.MM HH:mm')),
        daten: kerzen.map(k => [k.o, k.c, k.l, k.h]),
    }
}

function grundgeruest(p, kategorien) {
    return {
        ...grundOption(p),
        grid: { left: 8, right: 64, top: 16, bottom: 56, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross', lineStyle: { color: p.line } }, ...tooltipStil(p) },
        xAxis: { ...kategorieAchse(p), data: kategorien },
        yAxis: wertAchse(p, { scale: true, position: 'right' }),
        dataZoom: [
            { type: 'inside' },
            { type: 'slider', height: 16, bottom: 8, borderColor: p.line, fillerColor: mitDeckkraft(p.accent, 0.12), handleStyle: { color: p.accent }, textStyle: { color: p.muted } },
        ],
    }
}

const kerzenStil = (p) => ({ color: p.good, color0: p.bad, borderColor: p.good, borderColor0: p.bad })

export function useSetupChart(elementId, kerzen, setup) {
    const knoten = element(elementId)
    if (!knoten || !kerzen?.length) return null
    const instanz = frischeInstanz(knoten)
    const p = palette()
    const { kategorien, daten } = kerzenBasis(kerzen)
    const s = setup || {}

    const linie = (wert, name, farbe) => ({
        yAxis: wert, name,
        lineStyle: { color: farbe, type: 'dashed', width: 1 },
        label: { formatter: `${name} ${wert}`, position: 'insideEndTop', color: farbe, fontSize: 10 },
    })
    const linien = []
    if (s.entry) linien.push(linie(s.entry, t('strategies.chartEntry'), p.accent))
    if (s.stopLoss) linien.push(linie(s.stopLoss, t('strategies.chartStop'), p.bad))
    if (s.takeProfit) linien.push(linie(s.takeProfit, t('strategies.chartTarget'), p.good))
    if (s.sweepLevel) linien.push(linie(s.sweepLevel, t('strategies.chartSweep'), p.warn))

    const bereiche = []
    if (Number(s.obHigh) > Number(s.obLow)) {
        const treffer = kerzen.findIndex(k => k.t === s.obCandleTime)
        const farbe = s.direction === 'long' ? p.good : p.bad
        bereiche.push([
            {
                xAxis: kategorien[treffer >= 0 ? treffer : 0], yAxis: Number(s.obLow), name: t('strategies.chartOrderBlock'),
                itemStyle: { color: mitDeckkraft(farbe, 0.12), borderColor: mitDeckkraft(farbe, 0.5), borderWidth: 1 },
                label: { color: p.muted, fontSize: 10, position: 'insideTopLeft' },
            },
            { xAxis: kategorien[kategorien.length - 1], yAxis: Number(s.obHigh) },
        ])
    }

    instanz.setOption({
        ...grundgeruest(p, kategorien),
        series: [{
            type: 'candlestick',
            data: daten,
            itemStyle: kerzenStil(p),
            markLine: { symbol: 'none', silent: true, data: linien },
            markArea: { silent: true, data: bereiche },
        }],
    })
    return instanz
}

/** Index der letzten Kerze mit t ≤ T (ms); ausserhalb oder ungültig −1. */
function indexVon(kerzen, ms) {
    if (!Number.isFinite(ms) || ms < kerzen[0].t || ms > kerzen[kerzen.length - 1].t) return -1
    let lo = 0, hi = kerzen.length - 1
    while (lo < hi) {
        const mitte = (lo + hi + 1) >> 1
        if (kerzen[mitte].t <= ms) lo = mitte
        else hi = mitte - 1
    }
    return lo
}

const GEHANDELT = new Set(['triggered', 'open', 'closed'])
const WARTEND = new Set(['waiting_retest', 'armed'])

export function useAgentTimelineChart(elementId, kerzen, setups = [], trades = []) {
    const knoten = element(elementId)
    if (!knoten || !kerzen?.length) return null
    const instanz = frischeInstanz(knoten)
    const p = palette()
    const { kategorien, daten } = kerzenBasis(kerzen)
    const zahl = (x) => (x == null || x === '' ? NaN : Number(x))

    const bereiche = []
    for (const s of setups || []) {
        if (!(Number(s.obHigh) > Number(s.obLow))) continue
        let start = indexVon(kerzen, zahl(s.obCandleTime))
        if (start < 0) start = indexVon(kerzen, zahl(s.sweepCandleTime))
        if (start < 0) continue
        const ende = indexVon(kerzen, zahl(s.triggeredAt))
        const lang = s.direction === 'long'
        const farbe = lang ? p.good : p.bad
        const stufe = GEHANDELT.has(s.status) ? 'gehandelt' : WARTEND.has(s.status) ? 'wartend' : 'verworfen'
        const deck = { gehandelt: [0.22, 0.7], wartend: [0.12, 0.45], verworfen: [0.05, 0.25] }[stufe]
        const rr = s.rr != null && s.rr !== '' ? ` ${Number(s.rr).toFixed(1)}` : ''
        bereiche.push([
            {
                xAxis: kategorien[start], yAxis: Number(s.obLow), name: `${lang ? '▲' : '▼'}${rr}`,
                itemStyle: { color: mitDeckkraft(farbe, deck[0]), borderColor: mitDeckkraft(farbe, deck[1]), borderWidth: 1, borderType: stufe === 'verworfen' ? 'dashed' : 'solid' },
                label: { color: p.muted, fontSize: 10, position: 'insideTopLeft' },
            },
            { xAxis: kategorien[ende >= 0 ? ende : kategorien.length - 1], yAxis: Number(s.obHigh) },
        ])
    }

    const einstiege = []
    const ausstiege = []
    const verbindungen = []
    for (const tr of trades || []) {
        const lang = tr.direction === 'long'
        const iEin = indexVon(kerzen, zahl(tr.entryTime))
        const iAus = indexVon(kerzen, zahl(tr.exitTime))
        let ein = null, aus = null
        if (iEin >= 0) {
            ein = { value: [iEin, Number(tr.entryPrice)], name: `${t('strategies.chartEntry')} ${lang ? '▲' : '▼'}`, symbol: lang ? 'triangle' : 'pin', symbolRotate: lang ? 0 : 180 }
            einstiege.push(ein)
        }
        if (iAus >= 0) {
            const r = Number(tr.rMultiple) || 0
            aus = { value: [iAus, Number(tr.exitPrice)], name: `${tr.exitReason || ''} ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`, itemStyle: { color: r >= 0 ? p.good : p.bad } }
            ausstiege.push(aus)
        }
        if (ein && aus) {
            verbindungen.push([
                { coord: ein.value, lineStyle: { color: mitDeckkraft(p.muted, 0.7), type: 'dotted', width: 1 } },
                { coord: aus.value },
            ])
        }
    }

    const punktTooltip = { trigger: 'item', ...tooltipStil(p), formatter: (x) => `${x.name}<br>${x.value?.[1]}` }
    instanz.setOption({
        ...grundgeruest(p, kategorien),
        series: [
            {
                type: 'candlestick',
                data: daten,
                itemStyle: kerzenStil(p),
                markArea: { silent: true, data: bereiche },
                markLine: { symbol: 'none', silent: true, data: verbindungen },
            },
            { name: t('strategies.chartEntry'), type: 'scatter', symbolSize: 11, itemStyle: { color: p.accent }, tooltip: punktTooltip, data: einstiege },
            { name: t('strategies.chartExit'), type: 'scatter', symbol: 'circle', symbolSize: 8, itemStyle: { color: p.muted }, tooltip: punktTooltip, data: ausstiege },
        ],
    })
    return instanz
}
