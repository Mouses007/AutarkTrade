/**
 * Performance-Verlauf: Equity, Höchststand (HWM), Drawdown je Trade, dazu der
 * Trade-PnL als Balken auf logarithmischer Zweitachse (sign·log10(|x|+1)),
 * damit ein grosser Trade die kleinen nicht plattdrückt. Tooltip und
 * Achsenbeschriftung rechnen in echte Beträge zurück.
 */
import { gefilterteTradesFlach } from '../../../stores/trades.js'
import { useTwoDecCurrencyFormat, useThousandCurrencyFormat } from '../format.js'
import { fall, festkomma, element, instanzFuer, sichereGroessenanpassung, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft, vorzeichenFarbe, vorzeichenHover } from './gestaltung.js'

const logWert = (x) => Math.sign(x) * Math.log10(Math.abs(x) + 1)
const ausLog = (v) => Math.sign(v) * (10 ** Math.abs(v) - 1)

function kurzSymbol(symbol) {
    return String(symbol || '').replace('/USDT', '').replace('USDT', '')
}

export function usePerfChart(id) {
    sichereGroessenanpassung()
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const instanz = instanzFuer(knoten)
    if (!gefilterteTradesFlach.length) return Promise.resolve()

    const f = fall()
    const trades = [...gefilterteTradesFlach].sort((a, b) => (a.td - b.td) || ((a.entryTime || 0) - (b.entryTime || 0)))
    const p = palette()
    const kategorien = [], balken = [], equity = [], hoch = [], abstand = [], echt = []
    let kum = 0
    let spitze = 0
    trades.forEach((tr, i) => {
        const pnl = tr[`${f}Proceeds`] ?? tr.grossProceeds ?? 0
        kum += pnl
        spitze = Math.max(spitze, kum)
        const kurz = kurzSymbol(tr.symbol)
        kategorien.push(`#${i + 1}${kurz ? ' ' + kurz : ''}`)
        const gut = pnl >= 0
        balken.push({
            value: festkomma(logWert(pnl), 4),
            itemStyle: { color: vorzeichenFarbe(gut, p) },
            emphasis: { itemStyle: { color: vorzeichenHover(gut, p) } },
        })
        echt.push(festkomma(pnl, 2))
        equity.push(festkomma(kum, 2))
        hoch.push(festkomma(spitze, 2))
        abstand.push(festkomma(kum - spitze, 2))
    })

    const n = kategorien.length
    const namen = [t('charts.pnl'), t('charts.equity'), t('charts.highWaterMark'), t('charts.drawdown')]
    instanz.setOption({
        ...grundOption(p),
        grid: { left: 8, right: 8, top: 36, bottom: 48, containLabel: true },
        legend: { data: namen, top: 0, textStyle: { color: p.muted, fontFamily: p.schrift, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
        tooltip: {
            trigger: 'axis',
            ...tooltipStil(p),
            formatter: (punkte) => {
                const i = punkte[0]?.dataIndex ?? 0
                const zeilen = punkte.map(x => {
                    const wert = x.seriesIndex === 0 ? echt[i] : x.value
                    return `${x.marker}${x.seriesName}: ${useTwoDecCurrencyFormat(wert)}`
                })
                return [punkte[0]?.axisValue ?? '', ...zeilen].join('<br>')
            },
        },
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 16, bottom: 6, borderColor: p.line, fillerColor: mitDeckkraft(p.accent, 0.12), handleStyle: { color: p.accent }, textStyle: { color: p.muted } },
        ],
        xAxis: {
            ...kategorieAchse(p),
            axisLabel: {
                ...kategorieAchse(p).axisLabel,
                rotate: n > 30 ? 45 : 0,
                interval: n > 50 ? Math.floor(n / 25) : 0,
            },
            data: kategorien,
        },
        yAxis: [
            wertAchse(p, { name: t('charts.equityDollar'), nameTextStyle: { color: p.muted, fontSize: 10 }, axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => useThousandCurrencyFormat(v) } }),
            wertAchse(p, { name: t('charts.tradePnlDollar'), nameTextStyle: { color: p.muted, fontSize: 10 }, splitLine: { show: false }, axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => useThousandCurrencyFormat(ausLog(v)) } }),
        ],
        series: [
            { name: namen[0], type: 'bar', yAxisIndex: 1, barMaxWidth: 10, itemStyle: { color: p.good }, data: balken },
            { name: namen[1], type: 'line', yAxisIndex: 0, showSymbol: false, lineStyle: { color: p.accent, width: 2 }, itemStyle: { color: p.accent }, data: equity },
            { name: namen[2], type: 'line', yAxisIndex: 0, showSymbol: false, lineStyle: { color: p.muted, width: 1, type: 'dashed' }, itemStyle: { color: p.muted }, data: hoch },
            { name: namen[3], type: 'line', yAxisIndex: 0, showSymbol: false, lineStyle: { color: mitDeckkraft(p.bad, 0.8), width: 1 }, itemStyle: { color: p.bad }, areaStyle: { color: mitDeckkraft(p.bad, 0.12) }, data: abstand },
        ],
    })
    return Promise.resolve()
}
