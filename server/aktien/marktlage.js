/**
 * Marktlage für Aktien: Tageskurse holen und zur Lage zusammensetzen.
 *
 * 18 Abrufe der Kursquelle (Yahoo, hinter dem Quellen-Schalter): drei Index-
 * ETFs, VIX und Dreimonats-VIX, Zehnjahresrendite, Dollar-Index, elf Sektor-
 * ETFs. Eine halbe Stunde im Speicher, gleichzeitige Aufrufe teilen sich den
 * Abruf. Fällt ein einzelner Wert aus, fehlt nur er; fehlt der Leitindex,
 * gibt es kein Urteil. Gerechnet wird in `marktlage-kern.js`.
 *
 * Die Kursquelle liefert nur ABGESCHLOSSENE Tageskerzen. `stand` ist deshalb
 * der Zeitpunkt des Abrufs, nicht der der Kurse: von welchem Handelstag die
 * Schlusskurse je Block stammen, steht in `schluss`; `sitzungLaeuft` sagt, ob
 * die reguläre US-Sitzung gerade läuft (dann ist der Markt seither gelaufen).
 */
import { getKnex } from '../database.js'
import { holeChart, Gebremst } from '../newcomer-radar/kursquelle.js'
import { istAus } from '../quellen/aus.js'
import { logWarn } from '../logger.js'
import { indexLage, schwankung, sektorStaerke, standUndAenderung, breite, urteile, runde, kursStand, sitzungsStand } from './marktlage-kern.js'

export const INDIZES = ['SPY', 'QQQ', 'IWM']
/** Die elf Sektor-ETFs des S&P 500 (Select Sector SPDR). */
export const SEKTOREN = ['XLK', 'XLC', 'XLY', 'XLF', 'XLI', 'XLV', 'XLE', 'XLB', 'XLP', 'XLU', 'XLRE']
const SYMBOL = { vix: '^VIX', vix3m: '^VIX3M', zins: '^TNX', dollar: 'DX-Y.NYB' }
const GILT_MS = 30 * 60_000
const BREITE_FRISCH_MS = 4 * 24 * 60 * 60_000
const PAUSE_MS = 100
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let cache = null     // { zeit, wert }
let laeuft = null

const gerundet = (o, stellen = 2) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && k !== 'stand' ? runde(v, stellen) : v])) : null)

/** Anteil der Stamm-Titel über ihrer 50-Tage-Linie, aus dem letzten Newcomer-Lauf. */
async function breiteImFeld(jetzt) {
    try {
        const knex = getKnex()
        if (!(await knex.schema.hasTable('newcomer_titel'))) return null
        const zeilen = await knex('newcomer_titel').where('stand', '>', jetzt - BREITE_FRISCH_MS).select('kennzahlen', 'stand')
        const werte = zeilen.map((z) => { try { return JSON.parse(z.kennzahlen || '{}').ueberSma50 ?? null } catch { return null } })
        const b = breite(werte)
        return b ? { ...b, anteilPct: runde(b.anteilPct, 1), stand: Math.max(...zeilen.map((z) => Number(z.stand) || 0)) } : null
    } catch {
        return null
    }
}

async function baue(jetzt) {
    const kerzen = {}
    const fehlend = []
    for (const symbol of [...INDIZES, ...Object.values(SYMBOL), ...SEKTOREN]) {
        try {
            kerzen[symbol] = (await holeChart(symbol, jetzt)).kerzen
        } catch (e) {
            // Quelle aus oder Bremse: der ganze Abruf ist hinfällig — das meldet der Aufrufer.
            if (istAus(e) || e instanceof Gebremst) throw e
            fehlend.push(symbol)
            logWarn('aktien', `Marktlage ${symbol}: ${e.message}`)
        }
        await warte(PAUSE_MS)
    }
    const index = Object.fromEntries(INDIZES.map((s) => [s, indexLage(kerzen[s] || [])]))
    const vola = schwankung(kerzen[SYMBOL.vix] || [], kerzen[SYMBOL.vix3m] || [])
    const breiteFeld = await breiteImFeld(jetzt)
    return {
        ok: true,
        index: Object.fromEntries(INDIZES.map((s) => [s, gerundet(index[s])])),
        schwankung: gerundet(vola),
        sektoren: sektorStaerke(SEKTOREN.map((id) => ({ id, kerzen: kerzen[id] || [] })), kerzen.SPY || []).map((s) => gerundet(s)),
        zins: gerundet(standUndAenderung(kerzen[SYMBOL.zins] || [], 'punkte'), 3),
        dollar: gerundet(standUndAenderung(kerzen[SYMBOL.dollar] || [], 'prozent')),
        breite: breiteFeld,
        ...urteile({ spy: index.SPY, qqq: index.QQQ, iwm: index.IWM, vola, breiteFeld }),
        fehlend,
        // Handelstag des letzten Schlusskurses je Block — die Zahlen sind nie «jetzt».
        ...kursStand({
            index: INDIZES.map((s) => kerzen[s] || []),
            schwankung: [kerzen[SYMBOL.vix] || [], kerzen[SYMBOL.vix3m] || []],
            sektoren: [...SEKTOREN.map((s) => kerzen[s] || []), kerzen.SPY || []],
            zins: [kerzen[SYMBOL.zins] || []],
            dollar: [kerzen[SYMBOL.dollar] || []],
        }, jetzt),
        stand: jetzt,
    }
}

/** Die Marktlage, höchstens alle 30 Minuten neu geholt (`neu` umgeht den Speicher). */
export async function holeMarktlage({ neu = false } = {}) {
    const jetzt = Date.now()
    // Die Sitzung gilt für den Augenblick der Antwort, nicht für den des Abrufs.
    const mitSitzung = (wert) => ({ ...wert, ...sitzungsStand(Date.now()) })
    if (!neu && cache && jetzt - cache.zeit < GILT_MS) return mitSitzung(cache.wert)
    if (!laeuft) {
        laeuft = baue(jetzt).then((wert) => { cache = { zeit: Date.now(), wert }; return wert }).finally(() => { laeuft = null })
    }
    return laeuft.then(mitSitzung)
}
