/**
 * Ist das Symbol eines Chart-Panels ein Aktien-Future — und wann meldet der
 * Titel Quartalszahlen? Ein geteilter Abruf von `/api/aktien/kontext` mit
 * Zwischenspeicher je Symbol; Panel, Kopfleiste und Handy-Schublade lesen
 * denselben Stand.
 *
 * Im Krypto-Markt wird NICHT gefragt: dort ist jedes Symbol ein Coin, der
 * Chart bleibt, wie er war, und es geht kein Abruf hinaus.
 *
 * Stand je Symbol: `undefined` = noch nicht gefragt, `null` = Coin (oder die
 * Frage liess sich nicht beantworten), sonst
 * `{symbol, ticker, name, boerse, termine: {naechster, vergangene, einzelheiten}|null, termineGrund}`
 * (`einzelheiten` = was je vergangenem Termin gemeldet wurde, für `ZahlenKarte.vue`).
 * `termine: null` heisst UNBEKANNT — der Grund steht daneben.
 */
import { reactive } from 'vue'
import axios from 'axios'
import { ermittleMarkt } from '../../stores/markt.js'

// Der Server merkt sich die Auskunft zehn Minuten; öfter zu fragen bringt nichts.
const HALTBAR_MS = 10 * 60_000

const stand = reactive({})
const abrufe = new Map()   // symbol → { zeit, laeuft: Promise }

/** Auskunft holen (oder die gemerkte nehmen). Löst immer auf — bei Fehler mit `null`. */
export function ladeAktienKontext(symbol) {
    const sym = String(symbol || '').toUpperCase()
    if (!sym) return Promise.resolve(null)
    const da = abrufe.get(sym)
    if (da && Date.now() - da.zeit < HALTBAR_MS) return da.laeuft
    const laeuft = (async () => {
        if (await ermittleMarkt() !== 'aktien') return null
        try {
            const { data } = await axios.get('/api/aktien/kontext', { params: { symbol: sym } })
            return data?.aktie || null
        } catch {
            // Nicht merken: der nächste Wechsel auf das Symbol fragt neu.
            abrufe.delete(sym)
            return stand[sym] ?? null
        }
    })().then((aktie) => { stand[sym] = aktie; return aktie })
    abrufe.set(sym, { zeit: Date.now(), laeuft })
    return laeuft
}

/** Die Aktie hinter einem Panel (reaktiv gelesen) — `null` bei Coins, Spot und solange nichts bekannt ist. */
export function aktieVon(panel) {
    if (!panel?.symbol || panel.markt === 'spot') return null
    return stand[String(panel.symbol).toUpperCase()] || null
}

/** i18n-Schlüssel des Grunds, warum die Zahlentermine fehlen — oder null, wenn sie da sind. */
export function termineGrundSchluessel(aktie) {
    if (!aktie || aktie.termine) return null
    const bekannt = ['quelleAus', 'gebremst', 'nichtGefunden', 'keinKursSymbol']
    return 'chart.aktien.grund.' + (bekannt.includes(aktie.termineGrund) ? aktie.termineGrund : 'abrufFehlgeschlagen')
}
