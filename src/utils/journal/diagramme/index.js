/**
 * Journal-Diagramme — öffentliche Schnittstelle (Neubau S4, Spezifikation
 * diagramme.md (Beleg)).
 *
 * Aufbau:
 *   gestaltung.js   Farben/Schrift aus den Design-Tokens, Achsen, Tooltip
 *   grundlagen.js   Instanzen holen/entsorgen, Grössenänderung, Rundung, Fall
 *   verteiler.js    zeichneDiagramme — zeichnet bzw. leert das Dashboard
 *   ring.js         Ring (Quote) und Doppellinie
 *   tagesansicht.js Tagesansicht: Linien und Ring je Tag
 *   zeitraum.js     Ertrag/Kennzahl je Tag, Woche, Monat
 *   gruppenAlt.js   Kennzahl je Gruppe (balkenGruppe…)
 *   gruppen.js      Kennzahl je Gruppe (Richtung, Strategie, Wochentag …)
 *   heatmap.js      Wochentag × Stunde
 *   gebuehren.js    Gebühren je Symbol
 *   performance.js  Equity, HWM, Drawdown, PnL je Trade
 *   kerzen.js       Kerzenchart eines Trades
 *   strategie.js    Setup und Zeitstrahl der Strategie-Schicht
 *   auswertung.js   Auswertungsseite
 *
 * ECharts zieht das ganze Bundle nach: Aufrufer ausserhalb lazy geladener
 * Ansichten laden dieses Modul dynamisch.
 */
export { zeichneDiagramme } from './verteiler.js'
export { disposeCharts } from './grundlagen.js'
export { zeichneDoppellinie, zeichneTorte } from './tagesansicht.js'
export { doppellinieDiagramm, ringDiagramm } from './ring.js'
export { linienBalkenDiagramm, balkenDiagramm } from './zeitraum.js'
export { balkenNegativDiagramm } from './gruppenAlt.js'
export { usePositionChart, useStrategyChart, useWeekdayChart, useEntryTimeChart, useDurationChart, useSymbolChart } from './gruppen.js'
export { useHeatmapChart } from './heatmap.js'
export { useFeesChart } from './gebuehren.js'
export { usePerfChart } from './performance.js'
export { kerzenDiagramm } from './kerzen.js'
export { useSetupChart, useAgentTimelineChart } from './strategie.js'
export { useGaugeChart, useHorizontalBarChart, useSplitBarChart, useStressLineChart, useRadarChart } from './auswertung.js'
export { farbeText, farbeGedaempft, farbeLinie, farbeFlaeche, greenColor, redColor } from './gestaltung.js'
