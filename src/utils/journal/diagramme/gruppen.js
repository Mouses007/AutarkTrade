/**
 * Kennzahl je Gruppe, horizontal — das neue Inventar des Dashboards:
 * Richtung, Strategie, Wochentag, Einstiegszeit, Haltedauer, Symbol.
 *
 * Eine Beschreibung je Diagramm (Teilgruppe, Name, Sortierung), ein
 * gemeinsamer Zeichner. Ohne gewählte Kennzahl (oder bei 'apps', das diese
 * Familie nicht kennt) entsteht kein Eintrag — die Option wird trotzdem
 * gesetzt, mit leerer Reihe und leeren Kategorien.
 */
import { selectedRatio } from '../../../stores/filters.js'
import { groups, verfuegbareTags } from '../../../stores/trades.js'
import { useCapitalizeFirstLetter, useXDecCurrencyFormat, useXDecFormat, useThousandCurrencyFormat } from '../format.js'
import { fall, festkomma, element, instanzFuer, dauerKlasse, WOCHENTAGE_EN, t } from './grundlagen.js'
import { palette, grundOption, tooltipStil, kategorieAchse, wertAchse, vorzeichenFarbe } from './gestaltung.js'

/**
 * `groups.tags`, eingeschränkt auf die Tags der ERSTEN Tag-Gruppe
 * („Strategie"). Ohne Tag-Gruppe oder ohne groups.tags: groups.tags roh.
 * Die Einfügereihenfolge von groups.tags bleibt.
 */
export function strategieTags() {
    const erste = verfuegbareTags[0]
    const alle = groups.tags
    if (!erste || !alle) return alle
    const erlaubt = new Set((erste.tags || []).map(x => x.id))
    const aus = {}
    for (const k of Object.keys(alle)) if (erlaubt.has(k)) aus[k] = alle[k]
    return aus
}

/** Differenz, bei der ∞ − ∞ (NaN) als gleich gilt. */
const differenz = (a, b) => {
    const d = a - b
    return Number.isNaN(d) ? 0 : d
}
const nachWert = (a, b) => differenz(a.wert, b.wert)
const nachZahlSchluessel = (a, b) => differenz(Number(a.schluessel), Number(b.schluessel))

const BESCHREIBUNG = {
    position: {
        daten: () => groups.position,
        name: (k) => useCapitalizeFirstLetter(String(k)),
        sortierung: nachWert,
    },
    strategie: {
        daten: strategieTags,
        name: (k, liste) => {
            for (let i = liste.length - 1; i >= 0; i--) if (liste[i]?.tagName) return liste[i].tagName
            return k
        },
        sortierung: nachWert,
    },
    wochentag: {
        daten: () => groups.day,
        name: (k) => WOCHENTAGE_EN[Number(k)] ?? k,
        sortierung: (a, b) => ((Number(a.schluessel) + 6) % 7) - ((Number(b.schluessel) + 6) % 7),
    },
    einstiegszeit: {
        daten: () => groups.timeframe,
        name: (k) => k,
        kategorie: (k) => `${k}:00`,
        sortierung: nachZahlSchluessel,
    },
    dauer: {
        daten: () => groups.duration,
        name: (k) => dauerKlasse(k),
        sortierung: nachZahlSchluessel,
    },
    symbol: {
        daten: () => groups.symbols,
        name: (k) => k,
        sortierung: nachWert,
    },
}

function kennzahl(liste, f, verhaeltnis) {
    let wins = 0, loss = 0, proceeds = 0, n = 0
    for (const e of liste) {
        wins += e[`${f}Wins`]
        loss += e[`${f}Loss`]
        proceeds += e[`${f}Proceeds`]
        n += e.tradesCount
    }
    if (verhaeltnis === 'appt') return proceeds === 0 && n === 0 ? null : proceeds / n
    if (verhaeltnis === 'profitFactor') return loss === 0 ? (wins > 0 ? Infinity : null) : wins / -loss
    return null
}

function zeichneGruppe(id, art) {
    const knoten = element(id)
    if (!knoten) return Promise.resolve()
    const instanz = instanzFuer(knoten)
    const b = BESCHREIBUNG[art]
    const daten = b.daten()
    if (!daten || !Object.keys(daten).length) return Promise.resolve()

    const f = fall()
    const verhaeltnis = selectedRatio.value
    const eintraege = []
    for (const k of Object.keys(daten)) {
        const r = kennzahl(daten[k], f, verhaeltnis)
        if (r === null) continue
        eintraege.push({ schluessel: k, name: b.name(k, daten[k]), wert: festkomma(r, 4) })
    }
    eintraege.sort(b.sortierung)

    const p = palette()
    const istPf = verhaeltnis === 'profitFactor'
    const wertText = (v) => (istPf ? useXDecFormat(v, 2) : useXDecCurrencyFormat(v, 2))
    instanz.setOption({
        ...grundOption(p),
        grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
        tooltip: {
            trigger: 'item',
            ...tooltipStil(p),
            formatter: (x) => {
                const eintrag = eintraege[x.dataIndex]
                const kopf = art === 'einstiegszeit' ? `${eintrag?.name}:00` : eintrag?.name
                return `${kopf}<br>${istPf ? t('options.profitFactor') : 'APPT'}: ${wertText(x.value)}`
            },
        },
        xAxis: wertAchse(p, {
            axisLabel: { ...wertAchse(p).axisLabel, formatter: (v) => (istPf ? useXDecFormat(v, 1) : useThousandCurrencyFormat(v)) },
        }),
        yAxis: { ...kategorieAchse(p), data: eintraege.map(e => (b.kategorie ? b.kategorie(e.schluessel) : e.name)) },
        series: [{
            type: 'bar',
            barMaxWidth: 18,
            itemStyle: { borderRadius: 3 },
            label: { show: true, position: 'right', color: p.muted, fontSize: 10, formatter: (x) => wertText(x.value) },
            data: eintraege.map(e => ({ value: e.wert, itemStyle: { color: vorzeichenFarbe(e.wert >= 0, p) } })),
        }],
    })
    return Promise.resolve()
}

export const usePositionChart = (id) => zeichneGruppe(id, 'position')
export const useStrategyChart = (id) => zeichneGruppe(id, 'strategie')
export const useWeekdayChart = (id) => zeichneGruppe(id, 'wochentag')
export const useEntryTimeChart = (id) => zeichneGruppe(id, 'einstiegszeit')
export const useDurationChart = (id) => zeichneGruppe(id, 'dauer')
export const useSymbolChart = (id) => zeichneGruppe(id, 'symbol')
