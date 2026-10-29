/**
 * Bewertungs-Popup: Meldungen vom Server holen und quittieren.
 *
 * Neu und gemeldet entscheidet der Server (`server/trade-popups.js`); dieser
 * Tab hält nur seine letzte Antwort in `evalMeldungen`. Die Antwort ERSETZT
 * die Liste: sie enthält alles noch nicht Quittierte, also auch, was gerade
 * im Popup steht — eine neue Meldung kommt dazu, statt die offene zu
 * verdrängen, und was ein anderes Gerät quittiert oder die Seite „Pendente
 * Trades" bewertet hat, fällt weg.
 *
 * Quittiert wird erst, wenn das Popup geschlossen wird. Andere Tabs dieses
 * Browsers erfahren es über den BroadcastChannel und schliessen ihres sofort;
 * andere Geräte beim nächsten Abruf.
 */
import axios from 'axios'
import { evalMeldungen } from '../stores/trades.js'
import { appEinstellungen } from '../stores/settings.js'

const KANAL = 'autarktrade-trade-popup'

export const meldungsSchluessel = (m) => `${m.art}_${m.positionId}`

/**
 * In diesem Browser quittiert. Eine Antwort, die vor dem Quittieren
 * abgeschickt wurde, brächte die Meldungen sonst gleich wieder.
 */
const quittiertHier = new Set()

let kanal = null
function holeKanal() {
    if (kanal || typeof BroadcastChannel === 'undefined') return kanal
    kanal = new BroadcastChannel(KANAL)
    kanal.onmessage = (e) => {
        const d = e.data || {}
        if (d.art === 'quittiert' && Array.isArray(d.schluessel)) {
            for (const k of d.schluessel) quittiertHier.add(k)
            evalMeldungen.value = evalMeldungen.value.filter((m) => !quittiertHier.has(meldungsSchluessel(m)))
        } else if (d.art === 'schalter') {
            setzeSchalter(d.an)
        }
    }
    return kanal
}

/** Schalterstand übernehmen (Server-Antwort oder anderer Tab); startet/stoppt über den Rahmen. */
function setzeSchalter(an) {
    if (!appEinstellungen.value || typeof an !== 'boolean') return
    const wert = an ? 1 : 0
    if (appEinstellungen.value.showTradePopups !== wert) appEinstellungen.value.showTradePopups = wert
    if (!an) evalMeldungen.value = []
}

/** Anderen Tabs den neuen Schalterstand sagen (Einstellungsseite). */
export function meldeSchalter(an) {
    holeKanal()?.postMessage({ art: 'schalter', an: !!an })
}

/** Rein: Meldungen → Anzahl und Börsen je Art, wie das Popup sie zeigt. */
export function zusammenfassen(meldungen) {
    const leer = () => ({ anzahl: 0, jeBroker: {} })
    const aus = { oeffnung: leer(), schluss: leer() }
    for (const m of meldungen || []) {
        const ziel = m.art === 'open' ? aus.oeffnung : m.art === 'close' ? aus.schluss : null
        if (!ziel) continue
        const b = m.broker || 'unbekannt'
        ziel.anzahl++
        ziel.jeBroker[b] = (ziel.jeBroker[b] || 0) + 1
    }
    return aus
}

let laufend = null

/**
 * Offene Meldungen holen. Fragt auch bei ausgeschaltetem Schalter — der
 * Server sagt, ob er an ist, und so wirkt ein Umschalten in einem anderen Tab
 * oder auf einem anderen Gerät hier ohne Neuladen.
 */
export function holeNeueBewertungen() {
    if (laufend) return laufend
    holeKanal()
    laufend = (async () => {
        try {
            const { data } = await axios.get('/api/trade-popups/neu')
            setzeSchalter(data?.an)
            if (data?.an === false) return
            const liste = Array.isArray(data?.meldungen) ? data.meldungen : []
            // Hier quittiert, beim Server aber noch offen (Netzfehler beim
            // Quittieren): nicht zeigen, noch einmal quittieren.
            const nachholen = liste.filter((m) => quittiertHier.has(meldungsSchluessel(m)))
            if (nachholen.length) sendeQuittung(nachholen).catch(() => { })
            const offen = new Set(liste.map(meldungsSchluessel))
            for (const k of [...quittiertHier]) if (!offen.has(k)) quittiertHier.delete(k)
            evalMeldungen.value = liste.filter((m) => !quittiertHier.has(meldungsSchluessel(m)))
        } catch (e) {
            // Nächster Abgleich versucht es wieder; die Liste bleibt, wie sie ist.
            console.log(' -> Bewertungs-Meldungen nicht abgerufen:', e?.message || e)
        } finally {
            laufend = null
        }
    })()
    return laufend
}

function sendeQuittung(meldungen) {
    return axios.post('/api/trade-popups/quittieren', {
        open: meldungen.filter((m) => m.art === 'open').map((m) => m.positionId),
        close: meldungen.filter((m) => m.art === 'close').map((m) => m.positionId),
    })
}

/** Gezeigte Meldungen quittieren — hier, in den anderen Tabs und beim Server. */
export async function quittiereBewertungen(meldungen) {
    const liste = (meldungen || []).filter(Boolean)
    if (!liste.length) return
    const schluessel = liste.map(meldungsSchluessel)
    for (const k of schluessel) quittiertHier.add(k)
    evalMeldungen.value = evalMeldungen.value.filter((m) => !quittiertHier.has(meldungsSchluessel(m)))
    holeKanal()?.postMessage({ art: 'quittiert', schluessel })
    try {
        await sendeQuittung(liste)
    } catch (e) {
        console.log(' -> Quittieren fehlgeschlagen, wird beim nächsten Abruf nachgeholt:', e?.message || e)
    }
}
