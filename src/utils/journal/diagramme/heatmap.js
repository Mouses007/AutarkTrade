/**
 * Heatmap Wochentag × Stunde: mittlerer Ertrag je Zelle.
 *
 * Belegte Zellen sind Objekte {value:[h, d, μ, n], itemStyle}, leere Zellen
 * nackte Arrays [h, d, 0, 0] in einer zweiten Reihe. Die Farbskala richtet
 * sich nach dem 80-%-Quantil der |μ|, damit ein einzelner Ausreisser nicht
 * alle anderen Zellen blass macht.
 */
import dayjs from '../../dayjs-setup.js'
import { timeZoneTrade } from '../../../stores/ui.js'
import { filteredTradesTrades } from '../../../stores/trades.js'
import { useTwoDecCurrencyFormat } from '../../formatters.js'
import { fall, festkomma, element, instanzFuer } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, mische } from './gestaltung.js'

const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const STUNDEN = Array.from({ length: 24 }, (_, h) => `${h}:00`)

/** Skala: |μ| am 80-%-Platz (0 ⇒ 1), mindestens 0,5. */
function skala(mittel) {
    const sortiert = mittel.map(Math.abs).sort((a, b) => a - b)
    const wert = sortiert[Math.floor(0.8 * sortiert.length)] || 1
    return Math.max(wert, 0.5)
}

function zellFarbe(mu, s, p) {
    const intensitaet = Math.min(Math.abs(mu) / s, 1)
    return mische(p.panelSoft, mu >= 0 ? p.good : p.bad, 0.25 + 0.75 * intensitaet)
}

export function useHeatmapChart(id) {
    const knoten = element(id)
    if (!knoten || knoten.clientWidth === 0) return Promise.resolve()
    if (!filteredTradesTrades.length) return Promise.resolve()

    const f = fall()
    const zone = timeZoneTrade.value
    // Zelle (Tag d 0 = Montag, Stunde h) → Summe, Anzahl
    const zellen = new Map()
    for (const tr of filteredTradesTrades) {
        const z = dayjs.unix(tr.entryTime).tz(zone)
        const d = (z.day() + 6) % 7
        const h = z.hour()
        const schl = d * 24 + h
        const zelle = zellen.get(schl) || { summe: 0, anzahl: 0 }
        zelle.summe += tr[`${f}Proceeds`] || 0
        zelle.anzahl += 1
        zellen.set(schl, zelle)
    }
    if (!zellen.size) return Promise.resolve()

    const s = skala([...zellen.values()].map(z => z.summe / z.anzahl))
    const p = palette()
    const belegt = []
    const leer = []
    for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
            const zelle = zellen.get(d * 24 + h)
            if (!zelle) { leer.push([h, d, 0, 0]); continue }
            const mu = festkomma(zelle.summe / zelle.anzahl, 2)
            belegt.push({ value: [h, d, mu, zelle.anzahl], itemStyle: { color: zellFarbe(mu, s, p) } })
        }
    }

    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
        tooltip: {
            trigger: 'item',
            ...tooltipStil(p),
            formatter: (x) => {
                const [h, d, mu, n] = x.value || x.data || []
                const kopf = `${TAGE[d]} ${h}:00`
                return n ? `${kopf}<br>Ø P&L: ${useTwoDecCurrencyFormat(mu)}<br>Trades: ${n}` : `${kopf}<br>Keine Trades`
            },
        },
        // unsichtbar: die Farben stehen schon an den Zellen
        visualMap: { show: false, min: -s, max: s, dimension: 2, seriesIndex: [], inRange: {} },
        xAxis: { ...kategorieAchse(p, { splitArea: { show: false } }), data: STUNDEN },
        yAxis: { ...kategorieAchse(p, { inverse: true }), data: TAGE },
        series: [
            { type: 'heatmap', itemStyle: { borderColor: p.bg, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: p.accent } }, data: belegt },
            { type: 'heatmap', itemStyle: { color: p.panel, borderColor: p.bg, borderWidth: 2, borderRadius: 3 }, data: leer },
        ],
    })
    return Promise.resolve()
}
