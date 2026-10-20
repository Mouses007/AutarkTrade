/**
 * Kennzahl je Gruppe, horizontal — das „Altinventar" (`barChartNegative<n>`).
 *
 * Werte sind nackte Zahlen. Nicht gewählte Kennzahl ⇒ `undefined` je Gruppe;
 * gezeichnet wird, sobald die Werteliste überhaupt einen Eintrag hat (auch
 * `undefined`). Leere Liste ⇒ bisherige Option bleibt stehen.
 */
import { negativeTagGruppen } from '../../../stores/ui.js'
import { gewaehlteKennzahl } from '../../../stores/filters.js'
import { groups, verfuegbareTags } from '../../../stores/trades.js'
import { formGrossAnfang, formGeld0, formGeldStellen, formZahlStellen, formGeld2 } from '../format.js'
import { fall, element, instanzFuer, dauerKlasse, WOCHENTAGE_EN } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, vorzeichenFarbe } from './gestaltung.js'
import { strategieTags } from './gruppen.js'

const TEILGRUPPE = {
    barChartNegative1: 'timeframe',
    barChartNegative2: 'duration',
    barChartNegative3: 'day',
    barChartNegative4: 'trades',
    barChartNegative7: 'executions',
    barChartNegative12: 'shareFloat',
    barChartNegative13: 'entryPrice',
    barChartNegative14: 'mktCap',
    barChartNegative16: 'symbols',
    barChartNegative17: 'position',
}

/** Welche Teilgruppe gehört zur ID, und ist es ein Tag-Diagramm? */
function waehleTeilgruppe(id) {
    const tagGruppe = (negativeTagGruppen.value || []).find(g => id.includes(g.id))
    if (tagGruppe) return { daten: groups[tagGruppe.id], tags: true }
    if (id === 'barChartNegative18') return { daten: strategieTags(), tags: true }
    return { daten: groups[TEILGRUPPE[id]], tags: false }
}

/** Achsentexte je Diagramm (nur Darstellung). */
function achsenText(id, wert) {
    const k = Number(wert)
    switch (id) {
        case 'barChartNegative2': return dauerKlasse(wert)
        case 'barChartNegative3': return WOCHENTAGE_EN[k] ?? wert
        case 'barChartNegative4': return k <= 5 ? `${k - 5}-${k}` : k <= 30 ? `${k - 4}-${k}` : '+30'
        case 'barChartNegative13': return k < 5 ? '0-4.99$' : k < 30 ? `${k}-${k + 4.99}$` : '+30$'
        case 'barChartNegative12': {
            if (k >= 50) return '+50M'
            const breite = k < 10 ? 4.9 : 9.9
            return `${k}-${(k + breite).toFixed(1)}M`
        }
        case 'barChartNegative14': {
            const namen = ['Nano-cap', 'Micro-cap', 'Small-cap', 'Mid-cap', 'Big-cap']
            return namen[k] ?? wert
        }
        case 'barChartNegative17': return formGrossAnfang(String(wert))
        default: return wert
    }
}

/** Aufsteigend, undefined/gleich bleiben stehen (stabil). */
const nachWert = (a, b) => (a.wert < b.wert ? -1 : a.wert == b.wert ? 0 : 1) // eslint-disable-line eqeqeq

export function balkenNegativDiagramm(id) {
    try {
        const { daten, tags } = waehleTeilgruppe(id)
        const schluessel = Object.keys(daten) // undefined ⇒ TypeError ⇒ abgelehnt (Spec 3.5)
        const f = fall()
        const verhaeltnis = gewaehlteKennzahl.value
        let werte = []
        let kategorien = []
        const tagNamen = {}
        for (const g of schluessel) {
            const liste = daten[g]
            let wins = 0, loss = 0, proceeds = 0, n = 0, q = 0
            for (const e of liste) {
                wins += e[`${f}Wins`]
                loss += e[`${f}Loss`]
                proceeds += e[`${f}Proceeds`]
                n += id === 'barChartNegative4' ? e.trades : e.tradesCount
                q += e.buyQuantity
            }
            const appt = proceeds === 0 && n === 0 ? null : proceeds / n
            const apps = proceeds === 0 && q === 0 ? null : proceeds / q
            const pf = wins > 0 ? wins / -loss : 0
            const r = verhaeltnis === 'appt' ? appt : verhaeltnis === 'apps' ? apps : verhaeltnis === 'profitFactor' ? pf : undefined
            werte.unshift(r)
            kategorien.unshift(g)
            if (tags && liste.length) tagNamen[g] = liste[liste.length - 1].tagName
        }

        if (id === 'barChartNegative16' || id === 'barChartNegative17') {
            const paare = werte.map((wert, i) => ({ wert, schluessel: kategorien[i] })).filter(x => x.wert != null)
            paare.sort(nachWert)
            werte = paare.map(x => x.wert)
            kategorien = paare.map(x => x.schluessel)
        } else if (tags) {
            const paare = werte.map((wert, i) => ({ wert, schluessel: kategorien[i] }))
            paare.sort(nachWert)
            werte = paare.map(x => x.wert)
            paare.forEach((x, i) => { if (tagNamen[x.schluessel] !== undefined) kategorien[i] = tagNamen[x.schluessel] })
        }

        if (!werte.length) return Promise.resolve()

        const p = palette()
        const wertText = (v) => (verhaeltnis === 'profitFactor' ? formZahlStellen(v, 2)
            : verhaeltnis === 'apps' ? formGeldStellen(v, 4) : formGeldStellen(v, 2))
        instanzFuer(element(id)).setOption({
            ...grundOption(p),
            grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'item',
                ...tooltipStil(p),
                formatter: (x) => (id === 'barChartNegative16' ? `${x.name}: ` : '') + formGeld2(x.value),
            },
            xAxis: wertAchse(p, {
                axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => (verhaeltnis === 'profitFactor' ? formZahlStellen(v, 0) : formGeld0(v)) },
            }),
            yAxis: {
                ...kategorieAchse(p),
                axisLabel: { ...kategorieAchse(p).axisLabel, formatter: (v) => achsenText(id, v) },
                data: kategorien,
            },
            series: [{
                type: 'bar',
                barMaxWidth: 18,
                itemStyle: { color: (x) => vorzeichenFarbe(!(x.value < 0), p), borderRadius: 3 },
                label: { show: true, position: 'right', color: p.muted, fontSize: 10, formatter: (x) => wertText(x.value) },
                data: werte,
            }],
        })
        return Promise.resolve()
    } catch (e) {
        return Promise.reject(e)
    }
}
