/**
 * Kerzenchart eines einzelnen Trades (Tagesansicht-Modal, Bot-Trades).
 *
 * Eingabe der Kerzen in AUFRUFERFORM [Schluss, Eröffnung, Tief, Hoch]
 * (Tagesansicht.vue, botChart.js). ECharts erwartet [Eröffnung, Schluss, Tief, Hoch]
 * — umgestellt wird hier an genau einer Stelle (`zuEcharts`), damit steigende
 * Kerzen auch als steigend gefärbt sind (Spec 6.1).
 */
import dayjs from '../zeit.js'
import { tradeZeitzone, tagesChartZoom } from '../../../stores/ui.js'
import { element, instanzFuer, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft } from './gestaltung.js'

/** Zuletzt mit init = true geholte Instanz (Tagesansicht.vue zeichnet danach mit init = false weiter). */
let aktuelleKerzen = null

const zuEcharts = ([schluss, eroeffnung, tief, hoch]) => [eroeffnung, schluss, tief, hoch]

/** Index der letzten Kerze mit Öffnung ≤ T (Sekunden), −1 wenn keine. */
function kerzenIndex(zeiten, sekunden) {
    let idx = -1
    for (let i = 0; i < zeiten.length; i++) {
        if (zeiten[i] / 1000 <= sekunden) idx = i
        else break
    }
    return idx
}

function istEntsorgt(inst) {
    return !inst || (typeof inst.isDisposed === 'function' && inst.isDisposed())
}

/** Start/Ende des Anfangsausschnitts je Zoomstufe (Sekunden, in tradeZeitzone). */
function ausschnitt(trade, zone) {
    const ein = dayjs.unix(trade.entryTime).tz(zone)
    const aus = dayjs.unix(trade.exitTime).tz(zone)
    if (tagesChartZoom.value === 1) return [ein.startOf('minute'), aus.endOf('minute')]
    if (tagesChartZoom.value === 2) {
        // Mitte zwischen Tagesbeginn und Einstieg bzw. Ausstieg und Tagesende
        const von = ein.subtract(Math.floor((trade.entryTime - ein.startOf('day').unix()) / 2), 'second')
        const bis = aus.add(Math.floor((aus.endOf('day').unix() - trade.exitTime) / 2), 'second')
        return [von.startOf('minute'), bis.endOf('minute')]
    }
    return [ein.startOf('day'), aus.endOf('day')]
}

export function kerzenDiagramm(zeiten, preise, _volumen, trade, init, elementId = 'tagesKerzen', zonen = null, mitSlider = false) {
    try {
        if (init) {
            const knoten = element(elementId)
            if (!knoten) return Promise.reject(new Error('Candlestick chart container not found'))
            aktuelleKerzen = instanzFuer(knoten)
        } else if (istEntsorgt(aktuelleKerzen)) {
            const knoten = element(elementId)
            if (!knoten) return Promise.reject(new Error('Candlestick chart container not found'))
            aktuelleKerzen = instanzFuer(knoten)
        }
        const instanz = aktuelleKerzen
        const p = palette()
        const zone = tradeZeitzone.value
        const lang = trade.strategy === 'long'
        const farbeEin = lang ? p.good : p.bad
        const farbeAus = lang ? p.bad : p.good

        const zeitText = (ms, format) => dayjs(ms).tz(zone).format(format)
        const einTag = zeiten.length < 2 || zeitText(zeiten[0], 'YYYY-MM-DD') === zeitText(zeiten[zeiten.length - 1], 'YYYY-MM-DD')
        const kategorien = zeiten.map(z => zeitText(z, einTag ? 'HH:mm' : 'DD.MM HH:mm'))
        const schritt = zeiten.length >= 2 ? (zeiten[1] - zeiten[0]) / 1000 : 60
        const letzter = zeiten.length - 1

        const idxEin = kerzenIndex(zeiten, trade.entryTime)
        const idxAus = kerzenIndex(zeiten, trade.exitTime)
        const einImBild = idxEin >= 0
        const ausImBild = idxAus >= 0 && trade.exitTime <= zeiten[letzter] / 1000 + schritt

        // Marker
        const marker = []
        if (einImBild) {
            marker.push({ name: 'Entry', coord: [idxEin, trade.entryPrice], symbol: 'triangle', symbolSize: 12, symbolRotate: lang ? 0 : 180, symbolOffset: [0, lang ? 12 : -12], itemStyle: { color: farbeEin } })
        } else if (kategorien.length) {
            marker.push({ name: t('charts.entryPrevDay'), coord: [0, trade.entryPrice], symbol: 'arrow', symbolSize: 12, symbolRotate: 90, itemStyle: { color: farbeEin } })
        }
        if (ausImBild) {
            marker.push({ name: 'Exit', coord: [idxAus, trade.exitPrice], symbol: 'triangle', symbolSize: 12, symbolRotate: lang ? 180 : 0, symbolOffset: [0, lang ? -12 : 12], itemStyle: { color: farbeAus } })
        } else {
            marker.push({ name: t('charts.exitNextDay'), coord: [Math.max(letzter, 0), trade.exitPrice], symbol: 'arrow', symbolSize: 12, symbolRotate: -90, itemStyle: { color: farbeAus } })
        }

        // Preislinien
        const meta = trade._tradingMeta || {}
        const linie = (name, wert, farbe, typ = 'dashed') => ({
            name, yAxis: wert,
            lineStyle: { color: farbe, type: typ, width: 1 },
            label: { formatter: name, position: 'insideEndTop', color: farbe, fontSize: 10 },
        })
        const linien = [
            linie(`Entry ${trade.entryPrice}`, trade.entryPrice, p.accent, 'solid'),
            linie(`Exit ${trade.exitPrice}`, trade.exitPrice, p.muted, 'solid'),
        ]
        if (meta.sl) linien.push(linie(`SL ${meta.sl}`, Number(meta.sl), p.bad))
        if (meta.tp) linien.push(linie(`TP ${meta.tp}`, Number(meta.tp), p.good))
        if (meta.breakeven) linien.push(linie(`BE ${Number(meta.breakeven).toFixed(2)}`, Number(meta.breakeven), p.warn))

        // Teilausführungen
        const fills = Array.isArray(meta.fills) ? meta.fills : []
        if (fills.length > 1) {
            let einstiegGesehen = false
            for (const fill of fills) {
                const idx = kerzenIndex(zeiten, fill.time / 1000)
                if (idx < 0) continue
                if (fill.reduceOnly) {
                    marker.push({ name: `Teil-TP (${fill.qty})`, coord: [kategorien[idx], Number(fill.price)], symbol: 'triangle', symbolSize: 9, symbolRotate: lang ? 180 : 0, itemStyle: { color: farbeAus } })
                } else if (einstiegGesehen) {
                    marker.push({ name: `Compound (${fill.qty})`, coord: [kategorien[idx], Number(fill.price)], symbol: 'diamond', symbolSize: 9, symbolOffset: [0, lang ? 10 : -10], itemStyle: { color: p.good } })
                } else {
                    einstiegGesehen = true
                }
            }
        }

        // SL/TP-Verlauf als Stufenlinien
        const spaetesterFill = fills.reduce((m, x) => Math.max(m, Number(x.time) || 0), 0)
        const grenze = fills.length && spaetesterFill > 0 ? spaetesterFill + 60000 : Infinity
        const stufen = { SL: new Map(), TP: new Map() }
        for (const e of Array.isArray(meta.tpslHistory) ? meta.tpslHistory : []) {
            if (!(e.time <= grenze) || !stufen[e.type]) continue
            const idx = kerzenIndex(zeiten, e.time / 1000)
            if (idx < 0) continue
            const wert = e.action === 'set' || e.action === 'moved' ? Number(e.newVal) : null
            stufen[e.type].set(kategorien[idx], wert)
        }
        const stufenReihe = (karte) => {
            let lauf = null
            return kategorien.map(k => { if (karte.has(k)) lauf = karte.get(k); return lauf })
        }

        // Zonen
        const bereiche = (zonen || []).map(z => [
            {
                yAxis: Math.min(z.von, z.bis),
                name: z.name || '',
                itemStyle: { color: z.farbe || mitDeckkraft(p.accent, 0.1), borderColor: z.rand || 'transparent', borderWidth: z.rand ? 1 : 0 },
                label: { color: p.muted, fontSize: 10, position: 'insideTopLeft' },
            },
            { yAxis: Math.max(z.von, z.bis) },
        ])

        // Anfangsausschnitt
        const [von, bis] = ausschnitt(trade, zone)
        let startWert = einImBild && einTag ? von.format('HH:mm') : ''
        const endWert = ausImBild && einTag ? bis.format('HH:mm') : ''
        if (ausImBild && !einImBild) startWert = kategorien[0]
        const innen = { type: 'inside' }
        if (startWert) innen.startValue = startWert
        if (endWert) innen.endValue = endWert

        const reihen = [{
            type: 'candlestick',
            data: preise.map(zuEcharts),
            itemStyle: { color: p.good, color0: p.bad, borderColor: p.good, borderColor0: p.bad },
            markPoint: { data: marker, label: { show: false }, tooltip: { formatter: (x) => `${x.name}<br>${x.data.coord[1]}` } },
            markLine: { symbol: 'none', silent: true, data: linien },
            markArea: { silent: true, data: bereiche },
        }]
        if (stufen.SL.size) reihen.push({ name: 'SL-Verlauf', type: 'line', step: 'end', showSymbol: false, lineStyle: { color: p.bad, width: 1.5 }, itemStyle: { color: p.bad }, data: stufenReihe(stufen.SL) })
        if (stufen.TP.size) reihen.push({ name: 'TP-Verlauf', type: 'line', step: 'end', showSymbol: false, lineStyle: { color: p.good, width: 1.5 }, itemStyle: { color: p.good }, data: stufenReihe(stufen.TP) })

        instanz.setOption({
            ...grundOption(p),
            grid: { left: 8, right: 64, top: 16, bottom: mitSlider ? 56 : 28, containLabel: true },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross', lineStyle: { color: p.line } },
                ...tooltipStil(p),
                formatter: (punkte) => {
                    const k = punkte.find(x => x.seriesType === 'candlestick')
                    if (!k) return punkte[0]?.axisValue ?? ''
                    const [, o, c, l, h] = k.data.length === 5 ? k.data : [null, ...k.data]
                    const farbe = c >= o ? p.good : p.bad
                    const z = (x) => Number(x).toFixed(2)
                    return `${k.axisValue}<br><span style="color:${farbe}">O ${z(o)} · H ${z(h)} · L ${z(l)} · C ${z(c)}</span>`
                },
            },
            xAxis: { ...kategorieAchse(p), data: kategorien },
            yAxis: wertAchse(p, { scale: true, position: 'right' }),
            dataZoom: mitSlider
                ? [innen, { type: 'slider', height: 16, bottom: 8, borderColor: p.line, fillerColor: mitDeckkraft(p.accent, 0.12), handleStyle: { color: p.accent }, textStyle: { color: p.muted }, startValue: innen.startValue, endValue: innen.endValue }]
                : [innen],
            series: reihen,
        }, true)
        return Promise.resolve(instanz)
    } catch (e) {
        return Promise.reject(e)
    }
}
