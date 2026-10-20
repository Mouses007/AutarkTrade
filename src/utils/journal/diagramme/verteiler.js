/**
 * Verteiler des Journal-Dashboards: `zeichneDiagramme('init' | 'clear')`.
 *
 * Erst die drei Ringe, dann die Familien je ID-Präfix in fester Reihenfolge.
 * Die Reihenfolge zählt, weil spätere Aufrufe frühere am selben Element
 * überschreiben: Das Präfix `balken` trifft auch `balkenGruppe…` —
 * die bekommen erst die Form aus balkenDiagramm und dann (wenn es Werte gibt)
 * die aus balkenNegativDiagramm. Diese Überlappung ist gewollt erhalten.
 */
import { totals, zufriedenheitTage, zufriedenheitTrades, gewinnAnalyse } from '../../../stores/trades.js'
import { fall, element, instanzAn, sichtbar, sichereGroessenanpassung } from './grundlagen.js'
import { ringDiagramm } from './ring.js'
import { usePerfChart } from './performance.js'
import { useFeesChart } from './gebuehren.js'
import { useSymbolChart, useWeekdayChart, useEntryTimeChart, useDurationChart, usePositionChart, useStrategyChart } from './gruppen.js'
import { linienBalkenDiagramm, balkenDiagramm } from './zeitraum.js'
import { balkenNegativDiagramm } from './gruppenAlt.js'
import { useHeatmapChart } from './heatmap.js'

const FAMILIEN = [
    ['perfChart', usePerfChart],
    ['feesChart', useFeesChart],
    ['symbolChart', useSymbolChart],
    ['weekdayChart', useWeekdayChart],
    ['entryTimeChart', useEntryTimeChart],
    ['durationChart', useDurationChart],
    ['positionChart', usePositionChart],
    ['strategyChart', useStrategyChart],
    ['verlaufErtrag', linienBalkenDiagramm],
    ['balken', balkenDiagramm],
    ['balkenGruppe', balkenNegativDiagramm],
    ['heatmapChart', useHeatmapChart],
]

/** Anteile der drei Ringe; null = Ring nicht zeichnen. */
function ringAnteile(id) {
    const f = fall()
    if (id === 'ringGewinnquote') {
        const n = totals.trades
        return n ? [totals[`${f}WinsCount`] / n, totals[`${f}LossCount`] / n] : [0, 0]
    }
    if (id === 'ringZufriedenheit') {
        const liste = [...zufriedenheitTage, ...zufriedenheitTrades]
        if (!liste.length) return null
        /* eslint-disable eqeqeq -- lose Gleichheit ist hier die Regel: 1, true, "1" zufrieden; 0, false, "", "0" nicht */
        const zufrieden = liste.filter(x => x.satisfaction == true || x.satisfaction == 1).length
        const unzufrieden = liste.filter(x => x.satisfaction == false || x.satisfaction == 0).length
        /* eslint-enable eqeqeq */
        return [zufrieden / liste.length, unzufrieden / liste.length]
    }
    const r = gewinnAnalyse[`${f}R`]
    if (!r || Number.isNaN(r) || !(r > 0)) return null
    return [r / (r + 1), 1 / (r + 1)]
}

export async function zeichneDiagramme(param) {
    sichereGroessenanpassung()

    for (const id of ['ringGewinnquote', 'ringZufriedenheit', 'ringChanceRisiko']) {
        const knoten = element(id)
        if (param === 'clear') {
            instanzAn(knoten)?.clear()
            continue
        }
        if (param !== 'init' || !sichtbar(knoten)) continue
        const anteile = ringAnteile(id)
        if (anteile) await ringDiagramm(id, anteile[0], anteile[1])
    }

    if (typeof document === 'undefined') return
    for (const [praefix, zeichne] of FAMILIEN) {
        for (const knoten of document.querySelectorAll(`[id^="${praefix}"]`)) {
            if (param === 'clear') {
                instanzAn(knoten)?.clear()
            } else if (param === 'init' && sichtbar(knoten)) {
                // nicht abgewartet — die Arbeit geschieht synchron; ein
                // abgelehntes Promise (unbekannte Gruppe) soll den Rest nicht stoppen
                zeichne(knoten.id).catch((e) => console.warn(`Diagramm ${knoten.id}:`, e))
            }
        }
    }
}
