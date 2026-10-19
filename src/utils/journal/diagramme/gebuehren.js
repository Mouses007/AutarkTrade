/**
 * Gebühren je Symbol: Trading-Gebühr, bezahltes und erhaltenes Funding.
 *
 * Funding ist signiert (+ erhalten, − bezahlt); die Aufteilung macht
 * ausschliesslich `splitFunding` (src/utils/funding.js). Erhaltenes Funding
 * wird als negativer Balken auf eigenem Stapel gezeigt — es mindert die Kosten.
 */
import { gefilterteTradesFlach } from '../../../stores/trades.js'
import { useTwoDecCurrencyFormat } from '../format.js'
import { splitFunding } from '../../funding.js'
import { festkomma, element, instanzFuer, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft } from './gestaltung.js'

function sammleGebuehren(trades) {
    const jeSymbol = new Map()
    let mitFunding = false
    let mitErhalt = false
    for (const tr of trades) {
        const s = tr.symbol || 'Unbekannt'
        const e = jeSymbol.get(s) || { trading: 0, bezahlt: 0, erhalten: 0 }
        const tf = Math.abs(tr.tradingFee || 0)
        const ff = tr.fundingFee || 0
        const c = tr.commission || 0
        if (tf > 0 || ff !== 0) {
            const { paid, received } = splitFunding(ff)
            e.trading += tf
            e.bezahlt += paid
            e.erhalten += received
            if (ff !== 0) mitFunding = true
            if (e.erhalten > 0) mitErhalt = true
        } else if (Math.abs(c) > 0) {
            e.trading += Math.abs(c)
        }
        jeSymbol.set(s, e)
    }
    const zeilen = [...jeSymbol.entries()].map(([symbol, e]) => ({
        symbol,
        trading: festkomma(e.trading, 2),
        bezahlt: festkomma(e.bezahlt, 2),
        erhalten: festkomma(e.erhalten, 2),
        total: festkomma(e.trading + e.bezahlt, 2),
        netto: festkomma(e.trading + e.bezahlt - e.erhalten, 2),
    }))
    zeilen.sort((a, b) => a.netto - b.netto)
    return { zeilen, mitFunding, mitErhalt }
}

export function useFeesChart(id) {
    const knoten = element(id)
    if (!knoten || !gefilterteTradesFlach.length) return Promise.resolve()
    const { zeilen, mitFunding, mitErhalt } = sammleGebuehren(gefilterteTradesFlach)
    const p = palette()
    const ende = { show: true, position: 'right', color: p.muted, fontSize: 10 }

    const reihen = [{
        name: t('dashboard.tradingFees'),
        type: 'bar',
        stack: 'fees',
        barMaxWidth: 18,
        itemStyle: { color: mitDeckkraft(p.muted, 0.55) },
        label: mitFunding ? { show: false } : { ...ende, formatter: (x) => useTwoDecCurrencyFormat(x.value) },
        data: zeilen.map(z => z.trading),
    }]
    if (mitFunding) {
        reihen.push({
            name: t('dashboard.fundingPaid'),
            type: 'bar',
            stack: 'fees',
            barMaxWidth: 18,
            itemStyle: { color: mitDeckkraft(p.bad, 0.75), borderRadius: [0, 3, 3, 0] },
            label: mitErhalt ? { show: false } : { ...ende, formatter: (x) => useTwoDecCurrencyFormat(zeilen[x.dataIndex].total) },
            data: zeilen.map(z => z.bezahlt),
        })
    }
    if (mitErhalt) {
        reihen.push({
            name: t('dashboard.fundingReceived'),
            type: 'bar',
            stack: 'erhalten',
            barMaxWidth: 18,
            itemStyle: { color: mitDeckkraft(p.good, 0.75), borderRadius: [3, 0, 0, 3] },
            label: { ...ende, position: 'left', formatter: (x) => useTwoDecCurrencyFormat(zeilen[x.dataIndex].netto) },
            data: zeilen.map(z => (z.erhalten > 0 ? -z.erhalten : 0)),
        })
    }

    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 56, top: mitFunding ? 30 : 8, bottom: 8, containLabel: true },
        legend: mitFunding
            ? { data: reihen.map(r => r.name), top: 0, textStyle: { color: p.muted, fontFamily: p.schrift, fontSize: 11 }, itemWidth: 10, itemHeight: 10 }
            : undefined,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            ...tooltipStil(p),
            formatter: (punkte) => {
                const i = punkte[0]?.dataIndex ?? 0
                const zeilenText = punkte.filter(x => x.value !== 0).map(x => `${x.marker}${x.seriesName}: ${useTwoDecCurrencyFormat(x.value)}`)
                return [zeilen[i]?.symbol, ...zeilenText, `Netto: ${useTwoDecCurrencyFormat(zeilen[i]?.netto ?? 0)}`].join('<br>')
            },
        },
        xAxis: wertAchse(p, { axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => useTwoDecCurrencyFormat(v) } }),
        yAxis: { ...kategorieAchse(p), data: zeilen.map(z => z.symbol) },
        series: reihen,
    })
    return Promise.resolve()
}
