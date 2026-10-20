/**
 * Gemeinsame Hilfen der Journal-Diagramme: Instanzen holen und entsorgen,
 * Grössenänderung, Rundung, Fall (netto/brutto), Übersetzung.
 *
 * ECharts wird mit dem Spezifizierer 'echarts' geladen — der Golden-Master-Test
 * ersetzt genau diesen durch eine Attrappe, die sich die Optionen merkt.
 * Benutzt werden deshalb nur init, getInstanceByDom, setOption, clear,
 * dispose, resize, on, off, getOption und graphic.LinearGradient.
 */
import * as echarts from 'echarts'
import i18n from '../../../i18n/index.js'
import { betragArt } from '../../../stores/filters.js'

export { echarts }

export const t = (schluessel) => i18n.global.t(schluessel)

/** Element zur ID oder null. */
export function element(id) {
    if (typeof document === 'undefined') return null
    return document.getElementById(id) || null
}

/** Vorhandene Instanz am Knoten (oder undefined). */
export function instanzAn(knoten) {
    if (!knoten) return undefined
    return echarts.getInstanceByDom(knoten) || undefined
}

/**
 * Instanz am Knoten wiederverwenden, sonst anlegen. Zweimal init auf
 * denselben Knoten wirft in ECharts — darum immer erst nachsehen.
 */
export function instanzFuer(knoten) {
    return instanzAn(knoten) || echarts.init(knoten)
}

/** Vorhandene Instanz entsorgen und eine frische anlegen. */
export function frischeInstanz(knoten) {
    const alt = instanzAn(knoten)
    if (alt) alt.dispose()
    return echarts.init(knoten)
}

/**
 * Instanzen zu einer Liste von Knoten entsorgen. Der Nachschlag geht über den
 * Knoten selbst, nicht über getElementById — so klappt es auch für Knoten,
 * die schon aus dem Dokument entfernt sind.
 */
export function disposeCharts(knoten) {
    for (const k of knoten || []) {
        const inst = instanzAn(k)
        if (inst) inst.dispose()
    }
}

/** Sichtbar heisst: Breite und Höhe > 0 (versteckter Bootstrap-Tab hat 0). */
export function sichtbar(knoten) {
    return !!knoten && knoten.clientWidth !== 0 && knoten.clientHeight !== 0
}

let groesseAngemeldet = false
let groesseTimer = null
/** Einmalig einen gebremsten resize-Listener für alle Journal-Diagramme anmelden. */
export function sichereGroessenanpassung() {
    if (groesseAngemeldet || typeof window === 'undefined' || !window.addEventListener) return
    groesseAngemeldet = true
    window.addEventListener('resize', () => {
        clearTimeout(groesseTimer)
        groesseTimer = setTimeout(() => {
            if (typeof document === 'undefined') return
            for (const k of document.querySelectorAll('.diagrammFlaeche, .diagrammKarteFlaeche')) {
                instanzAn(k)?.resize()
            }
        }, 150)
    })
}

/** Aktueller Fall: 'net' oder 'gross' (roh aus dem Store). */
export function fall() {
    return betragArt.value
}

/** Auf n Nachkommastellen über die Festkomma-Darstellung, zurück als Zahl. */
export function festkomma(x, n) {
    if (x === Infinity || x === -Infinity) return x
    return Number(Number(x).toFixed(n))
}

/** Englische Wochentagsnamen, 0 = Sonntag. */
export const WOCHENTAGE_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Dauerklasse aus der Minuten-Untergrenze. */
export function dauerKlasse(schluessel) {
    const klassen = {
        0: '00:00-00:59', 1: '01:00-01:59', 2: '02:00-04:59', 5: '05:00-09:59',
        10: '10:00-19:59', 20: '20:00-39:59', 40: '40:00-59:59', 60: '+60:00',
    }
    return klassen[Number(schluessel)] ?? String(schluessel)
}

/** Tiefe Kopie eines (reaktiven) Objekts. */
export function kopie(x) {
    return JSON.parse(JSON.stringify(x ?? {}))
}
