/**
 * Bot-Trades im Journal exakt aus Pionex nachrechnen (16.11.2026).
 *
 * Die Start-Migration `migrationen/bot-netto.js` konnte Alt-Trades nur nähern (Gewinn − Gebühr +
 * Funding), weil die Marge am Trade nicht gespeichert ist. Pionex liefert die beendeten Bots aber noch:
 * dieser Abgleich holt sie einmal mit dem Lese-Schlüssel des Journals und setzt jeden Bot-Trade auf
 * `nettoAusMarge` (shared/botNetto.js). Danach trägt der Trade die Marke `nettoAusPionex` und wird nie
 * wieder angefasst; neue Importe bringen sie schon mit.
 *
 * Läuft kurz nach dem Start, nur wenn es etwas zu tun gibt, nie im Testbetrieb. Scheitert der Abruf,
 * bleibt alles wie es ist und der nächste Start versucht es wieder. Schreibt nur die eigene Tabelle
 * `trades` (Zeilen `broker = pionex`), sendet nichts an Pionex.
 */
import { getKnex } from './database.js'
import { getDecryptedPionexConfig, holeAlleBeendetenBots } from './pionex-api.js'
import { nettoAusMarge, tagAusPionex, brauchtPionexAbgleich, istSpotBot } from '../shared/botNetto.js'
import { istTestbetrieb } from './testbetrieb.js'
import { logInfo, logWarn } from './logger.js'

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v)

/** Map buOrderId → Netto aus den Rohdaten (nur Futures-Grids). Rein. */
export function nettoNachBot(orders) {
    const m = new Map()
    for (const o of orders || []) {
        const id = o?.buOrderId, d = o?.buOrderData
        if (!id || !d || istSpotBot(o.buOrderType) || istSpotBot(d.cateType)) continue
        const n = nettoAusMarge(d)
        if (n !== null) m.set(String(id), n)
    }
    return m
}

/** Abgleich gegen eine Datenbank; `holeBots` liefert die Rohliste. Gibt Zähler zurück. */
export async function gleicheBotNettoAb(knex, holeBots) {
    if (!(await knex.schema.hasTable('trades'))) return { tage: 0 }
    const zeilen = await knex('trades').where('broker', 'pionex').select('id', 'trades', 'executions')
    const offen = []
    for (const z of zeilen) {
        try { const trades = json(z.trades); if (Array.isArray(trades) && trades.some(brauchtPionexAbgleich)) offen.push({ id: z.id, trades, executions: json(z.executions) }) } catch { /* unlesbare Zeile bleibt */ }
    }
    if (!offen.length) return { tage: 0 }
    const netto = nettoNachBot(await holeBots())
    let tage = 0, exakt = 0, unbekannt = 0, summe = 0
    for (const z of offen) {
        const neu = tagAusPionex({ trades: z.trades, executions: z.executions }, netto)
        if (!neu.geaendert) continue
        neu.trades.forEach((t, i) => {
            if (t === z.trades[i]) return
            if (t.nettoAusPionex === true) { exakt++; if (!t.coinM) summe += (Number(t.netProceeds) || 0) - (Number(z.trades[i].netProceeds) || 0) } else unbekannt++
        })
        await knex('trades').where('id', z.id).update({
            trades: JSON.stringify(neu.trades), executions: JSON.stringify(neu.executions ?? []),
            blotter: JSON.stringify(neu.blotter), pAndL: JSON.stringify(neu.pAndL),
        })
        tage++
    }
    return { tage, exakt, unbekannt, summe }
}

/** Einmal nach dem Start; Fehler werden nur gemeldet. */
export function starteBotNettoAbgleich(verzoegerungMs = 45_000) {
    if (istTestbetrieb()) return
    const t = setTimeout(async () => {
        try {
            const k = await getDecryptedPionexConfig()
            if (!k?.apiKey || !k?.secretKey) return
            const r = await gleicheBotNettoAb(getKnex(), () => holeAlleBeendetenBots(k.apiKey, k.secretKey))
            if (r.tage) logInfo('bots', `Journal: ${r.exakt} Bot-Trade(s) in ${r.tage} Tag(en) exakt aus Pionex nachgerechnet (USDT-Bots zusammen ${r.summe >= 0 ? '+' : ''}${r.summe.toFixed(2)} USDT), ${r.unbekannt} kennt Pionex nicht mehr`)
        } catch (e) {
            logWarn('bots', `Journal-Abgleich der Bot-Trades mit Pionex nicht möglich (nächster Start versucht es wieder): ${e.message}`)
        }
    }, verzoegerungMs)
    t.unref?.()
}
