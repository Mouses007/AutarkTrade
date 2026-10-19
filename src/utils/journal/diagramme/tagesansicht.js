/**
 * Diagramme der Tagesansicht: kumulierte Tageslinien und Gewinnquote je Tag.
 *
 * Beide arbeiten synchron und geben ein erfülltes Promise zurück — Aufrufer
 * lesen die Option auch ohne `await` sofort danach.
 *
 * Mehrere Tageszeilen desselben Tages (verschiedene Börsen) zielen auf
 * dieselbe Element-ID; die zuletzt verarbeitete Zeile bestimmt das Bild.
 */
import { journalTage } from '../../../stores/trades.js'
import { betragArt } from '../../../stores/filters.js'
import { useHourMinuteFormat } from '../format.js'
import { fall, festkomma } from './grundlagen.js'
import { useDoubleLineChart, usePieChart } from './ring.js'

export function zeichneDoppellinie() {
    const f = fall()
    for (const zeile of journalTage) {
        const brutto = []
        const netto = []
        const zeiten = []
        for (const tr of zeile.trades || []) {
            const b = festkomma(tr.grossProceeds, 2)
            const n = festkomma(tr[`${f}Proceeds`], 2)
            brutto.push(brutto.length ? brutto[brutto.length - 1] + b : b)
            netto.push(netto.length ? netto[netto.length - 1] + n : n)
            zeiten.push(useHourMinuteFormat(tr.exitTime))
        }
        useDoubleLineChart(`doubleLineChart${zeile.dateUnix}`, brutto, netto, zeiten)
    }
    return Promise.resolve()
}

export function zeichneTorte() {
    const art = betragArt.value === 'net' ? 'net' : 'gross'
    for (const zeile of journalTage) {
        const pl = zeile.pAndL || {}
        const anzahl = Number(pl.trades) || 0
        const gewinne = Number(pl[`${art}WinsCount`])
        const verluste = Number(pl[`${art}LossCount`])
        const bekannt = anzahl > 0 && Number.isFinite(gewinne) && Number.isFinite(verluste)
        usePieChart(`pieChart${zeile.dateUnix}`, bekannt ? gewinne / anzahl : 0, bekannt ? verluste / anzahl : 0)
    }
    return Promise.resolve()
}
