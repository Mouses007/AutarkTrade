/**
 * Diagramme je Zeitraum (Tag / Woche / Monat) aus den Tagessummen:
 *   - useLineBarChart: kumulierter Ertrag (Linie) + Ertrag je Zeitraum (Balken)
 *   - useBarChart:     Kennzahl (barChart1) bzw. Gewinnquote (barChart2)
 *
 * Bündelung: Woche = ISO-Kalenderwoche, Monat = Monat 0–11, beide in der
 * Zeitzone des PROZESSES und OHNE Jahr verglichen (bekannte Eigenheit, siehe
 * docs/spec/diagramme.md 6.4). Ohne gültigen Zeitrahmen gibt es keine Einträge.
 */
import dayjs from '../zeit.js'
import { selectedTimeFrame, selectedRatio } from '../../../stores/filters.js'
import { summenJeTag } from '../../../stores/trades.js'
import { useChartFormat, useThousandCurrencyFormat, useXDecCurrencyFormat, useXDecFormat, useOneDecPercentFormat } from '../format.js'
import { fall, kopie, element, instanzFuer } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, vorzeichenFarbe, vorzeichenHover } from './gestaltung.js'

/** Ab so vielen TAGESschlüsseln entfallen die Balkenbeschriftungen. */
const BESCHRIFTUNG_BIS = 20

/**
 * Tagesschlüssel in Zeiträume zerlegen.
 * @returns {Array<{kategorie: string, tage: string[]}>}
 */
export function zeitraeume(schluessel, rahmen) {
    if (rahmen === 'daily') return schluessel.map(k => ({ kategorie: useChartFormat(Number(k)), tage: [k] }))
    if (rahmen !== 'weekly' && rahmen !== 'monthly') return []
    const merkmal = (k) => (rahmen === 'weekly' ? dayjs.unix(Number(k)).isoWeek() : dayjs.unix(Number(k)).month())
    const beginn = (k) => dayjs.unix(Number(k)).startOf(rahmen === 'weekly' ? 'isoWeek' : 'month').unix()
    const liste = []
    let aktuell
    for (const k of schluessel) {
        const m = merkmal(k)
        if (!liste.length) {
            liste.push({ kategorie: useChartFormat(Number(k)), tage: [k] })
        } else if (m === aktuell) {
            liste[liste.length - 1].tage.push(k)
        } else {
            liste.push({ kategorie: useChartFormat(beginn(k)), tage: [k] })
        }
        aktuell = m
    }
    return liste
}

function balkenPunkt(wert, gut, mitBeschriftung, position, formatierer, p) {
    const punkt = { value: wert }
    if (mitBeschriftung) punkt.label = { show: true, position, color: p.muted, fontSize: 10, formatter: formatierer }
    punkt.itemStyle = { color: vorzeichenFarbe(gut, p), borderRadius: 3 }
    punkt.emphasis = { itemStyle: { color: vorzeichenHover(gut, p) } }
    return punkt
}

function vertikaleOption(p, kategorien, reihen, tooltip) {
    return {
        ...grundOption(p),
        grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltipStil(p), formatter: tooltip },
        xAxis: { ...kategorieAchse(p), data: kategorien },
        yAxis: wertAchse(p, { axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => useThousandCurrencyFormat(v) } }),
        series: reihen,
    }
}

export function useLineBarChart(id) {
    try {
        const tage = kopie(summenJeTag)
        const schluessel = Object.keys(tage)
        const f = fall()
        const p = palette()
        const mitBeschriftung = schluessel.length <= BESCHRIFTUNG_BIS
        const linie = []
        const balken = []
        const kategorien = []
        for (const zr of zeitraeume(schluessel, selectedTimeFrame.value)) {
            let summe = 0
            for (const k of zr.tage) summe += tage[k][`${f}Proceeds`]
            kategorien.push(zr.kategorie)
            linie.push(linie.length ? linie[linie.length - 1] + summe : summe)
            const gut = summe >= 0
            balken.push(balkenPunkt(summe, gut, mitBeschriftung, gut ? 'top' : 'bottom', (x) => useThousandCurrencyFormat(x.value), p))
        }
        instanzFuer(element(id)).setOption(vertikaleOption(p, kategorien, [
            { type: 'line', smooth: true, showSymbol: false, z: 3, lineStyle: { color: p.accent, width: 2 }, itemStyle: { color: p.accent }, data: linie },
            { type: 'bar', barMaxWidth: 28, data: balken },
        ], (punkte) => {
            const kat = punkte[0]?.axisValue ?? ''
            const bal = punkte.find(x => x.seriesType === 'bar')
            const lin = punkte.find(x => x.seriesType === 'line')
            return `${kat}<br>Proceeds: ${useThousandCurrencyFormat(bal?.value ?? 0)}<br>Cumulated: ${useThousandCurrencyFormat(lin?.value ?? 0)}`
        }))
        return Promise.resolve()
    } catch (e) {
        return Promise.reject(e)
    }
}

/** Kennzahlen eines Zeitraums. Tagesweise und gebündelt rechnen leicht verschieden (Spec 3.4). */
function kennzahlen(tage, liste, f, rahmen) {
    if (rahmen === 'daily') {
        const e = tage[liste[0]]
        const proceeds = e[`${f}Proceeds`]
        const w = Number(e[`${f}Wins`]) || 0
        const l = Math.abs(Number(e[`${f}Loss`]) || 0)
        return {
            pf: l > 0 ? w / l : (w > 0 ? null : 0),
            appt: e.trades ? proceeds / e.trades : 0,
            apps: e.buyQuantity ? proceeds / e.buyQuantity : 0,
            quote: e.trades ? e[`${f}WinsCount`] / e.trades : 0,
        }
    }
    let proceeds = 0, trades = 0, menge = 0, w = 0, l = 0, gewinne = 0, tradesQ = 0
    for (const k of liste) {
        const e = tage[k]
        proceeds += e[`${f}Proceeds`]
        trades += e.trades
        menge += e.buyQuantity
        w += e[`${f}Wins`]
        l += -e[`${f}Loss`]
        gewinne += e[`${f}WinsCount`]
        tradesQ += e.trades
    }
    return {
        pf: l > 0 ? w / l : (w > 0 ? null : 0),
        appt: trades ? proceeds / trades : 0,
        apps: menge ? proceeds / menge : 0,
        quote: tradesQ ? gewinne / tradesQ : 0,
    }
}

function kennzahlText(wert, verhaeltnis, alsQuote) {
    if (alsQuote) return useOneDecPercentFormat(wert)
    if (verhaeltnis === 'appt') return useXDecCurrencyFormat(wert, 2)
    if (verhaeltnis === 'apps') return useXDecCurrencyFormat(wert, 4)
    if (verhaeltnis === 'profitFactor') return useXDecFormat(wert, 2)
    return String(wert)
}

export function useBarChart(id) {
    try {
        const tage = kopie(summenJeTag)
        const schluessel = Object.keys(tage)
        const f = fall()
        const rahmen = selectedTimeFrame.value
        const verhaeltnis = selectedRatio.value
        const p = palette()
        const mitBeschriftung = schluessel.length <= BESCHRIFTUNG_BIS
        const alsQuote = id === 'barChart2'
        const punkte = []
        const kategorien = []
        for (const zr of zeitraeume(schluessel, rahmen)) {
            kategorien.push(zr.kategorie)
            const kz = kennzahlen(tage, zr.tage, f, rahmen)
            const r = verhaeltnis === 'appt' ? kz.appt : verhaeltnis === 'apps' ? kz.apps : verhaeltnis === 'profitFactor' ? kz.pf : undefined
            const text = (x) => kennzahlText(x.value, verhaeltnis, alsQuote)
            if (id === 'barChart1') {
                const gut = verhaeltnis === 'profitFactor' ? (r === 0 || r >= 1) : r >= 0
                punkte.push(balkenPunkt(r, gut, mitBeschriftung, r >= 0 ? 'top' : 'bottom', text, p))
            } else if (alsQuote) {
                const gut = kz.quote === 0 || kz.quote > 0.5
                punkte.push(balkenPunkt(kz.quote, gut, mitBeschriftung, 'top', text, p))
            }
        }
        const option = vertikaleOption(p, kategorien, [{ type: 'bar', barMaxWidth: 28, data: punkte }],
            (liste) => `${liste[0]?.axisValue ?? ''}<br>${kennzahlText(liste[0]?.value, verhaeltnis, alsQuote)}`)
        option.yAxis.axisLabel.formatter = alsQuote
            ? (v) => useOneDecPercentFormat(v)
            : (verhaeltnis === 'profitFactor' ? (v) => useXDecFormat(v, 0) : (v) => useThousandCurrencyFormat(v))
        instanzFuer(element(id)).setOption(option)
        return Promise.resolve()
    } catch (e) {
        return Promise.reject(e)
    }
}
