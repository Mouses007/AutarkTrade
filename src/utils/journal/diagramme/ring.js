/**
 * Ring mit zwei Anteilen (Gewinnquote, Zufriedenheit, RRR) und die
 * Doppellinie der Tagesansicht.
 */
import { seitenId } from '../../../stores/ui.js'
import { formProzent1 } from '../format.js'
import { element, instanzFuer, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, mitDeckkraft } from './gestaltung.js'

/** Ø RRR aus dem Gewinnanteil des Rings: 1:x. */
const rrrText = (gruen) => `1:${gruen > 0 && gruen < 1 ? (gruen / (1 - gruen)).toFixed(1) : '0'}`

/** Text in der Ringmitte, je nach Seite und Ring. */
function mittelText(id, gruen) {
    const prozent = formProzent1(gruen)
    if (seitenId.value === 'journalUebersicht') {
        if (id === 'ringGewinnquote') return `${prozent}\nWin rate`
        if (id === 'ringZufriedenheit') return `${prozent}\nSatisfaction`
        if (id === 'ringChanceRisiko') return `${rrrText(gruen)}\nØ RRR`
    }
    return prozent
}

/*
 * Zugänglicher Name (Cursor-Audit A11Y-01): der Ring ist `silent`, sein
 * Mitteltext steckt im Canvas — ein Screenreader fand nichts. Darum trägt der
 * Container `role="img"` und ein `aria-label` mit Name und Wert.
 */
function zugaenglicherName(id, gruen) {
    if (id === 'ringChanceRisiko') return `Ø RRR: ${rrrText(gruen)}`
    const name = id === 'ringZufriedenheit' ? t('options.satisfaction') : t('dashboard.winRate')
    return `${name}: ${formProzent1(gruen)}`
}

/**
 * Ring zeichnen. Datenpunkte tragen nur `value` — die Farbe kommt über die
 * Reihe, damit die Werte unverändert (nicht normiert) bleiben.
 */
export function ringDiagramm(id, gruen, rot, grau = 0) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    const text = mittelText(id, gruen)
    const [oben, unten] = text.split('\n')
    // `?.`: im Golden Master ist der Knoten eine Attrappe ohne DOM
    knoten.setAttribute?.('role', 'img')
    knoten.setAttribute?.('aria-label', zugaenglicherName(id, gruen))
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        series: [{
            type: 'pie',
            radius: ['70%', '100%'],
            avoidLabelOverlap: false,
            emphasis: { disabled: true, scale: false },
            silent: true,
            itemStyle: {
                // drittes Segment (Zufriedenheit „gemischt"): gedämpft
                color: (punkt) => (punkt.dataIndex === 0 ? p.good : punkt.dataIndex === 2 ? mitDeckkraft(p.muted, 0.6) : mitDeckkraft(p.bad, 0.85)),
                borderColor: p.panel,
                borderWidth: 2,
            },
            label: {
                show: true,
                position: 'center',
                formatter: () => (unten ? `{wert|${oben}}\n{name|${unten}}` : `{wert|${oben}}`),
                rich: {
                    wert: { color: p.text, fontFamily: p.schrift, fontSize: 15, fontWeight: 600, lineHeight: 20 },
                    name: { color: p.muted, fontFamily: p.schrift, fontSize: 10, lineHeight: 14 },
                },
            },
            labelLine: { show: false },
            data: grau > 0 ? [{ value: gruen }, { value: rot }, { value: grau }] : [{ value: gruen }, { value: rot }],
        }],
    })
    return Promise.resolve()
}

/** Zwei kumulierte Linien (brutto, netto) über die Ausstiegszeiten. */
export function doppellinieDiagramm(id, brutto, netto, kategorien) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const p = palette()
    instanzFuer(knoten).setOption({
        ...grundOption(p),
        grid: { left: 8, right: 8, top: 10, bottom: 22 },
        tooltip: {
            trigger: 'axis',
            ...tooltipStil(p),
            formatter: (punkte) => {
                const zeit = punkte[0]?.axisValue ?? ''
                const b = punkte[0] ? Math.round(punkte[0].value) : ''
                const n = punkte[1] ? Math.round(punkte[1].value) : ''
                return `${zeit}<br>Gross: ${b}$<br>Net: ${n}$`
            },
        },
        xAxis: { ...kategorieAchse(p, { boundaryGap: false }), data: kategorien },
        yAxis: wertAchse(p, { axisLabel: { show: false } }),
        series: [
            { type: 'line', smooth: true, showSymbol: false, lineStyle: { color: p.muted, width: 1.5 }, itemStyle: { color: p.muted }, data: brutto },
            { type: 'line', smooth: true, showSymbol: false, lineStyle: { color: p.accent, width: 2 }, itemStyle: { color: p.accent }, data: netto },
        ],
    })
    return Promise.resolve()
}
