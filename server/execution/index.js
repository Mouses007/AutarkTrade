/**
 * Broker-Registry — für welche Börse rechnet eine Instanz?
 *
 * Seit S13 (19.10.2026) sendet AutarkTrade KEINE Orders mehr. Der scharfe
 * Handel (Order-Adapter, Stop-Wächter, Margen-Netz, Abgleich, Live-Freigabe)
 * liegt auf dem Branch `spaeter/scharfer-handel` — wie man ihn zurückholt,
 * steht in `docs/SPAETER-SCHARFER-HANDEL.md`. Was hier bleibt, ist die Frage,
 * deren Regeln Papier- und Schattenbetrieb benutzen: `strategy_instances.broker`
 * nennt die Börse, deren Rundungsregeln (Schritt, Mindestmenge, Tick) der
 * Schattenbetrieb anlegt. Der Papierbetrieb rechnet wie der Backtest mit den
 * Regeln der Marktdatenquelle.
 *
 * Ein Eintrag hier hat darum keine einzige Funktion, die eine Börse verändert.
 * `__selftest-broker-registry.mjs` prüft das: taucht ein Order-Verb wieder
 * auf, ist das ein Rückbau ohne Entscheidung.
 *
 * **Kein Rückfall auf einen Vorgabe-Broker.** `holeAdapter` wirft bei einem
 * unbekannten Namen — auch hier: ein Tippfehler soll laut scheitern, nicht
 * still mit den Regeln einer anderen Börse rechnen.
 */

import { holeSymbolMeta as pionexSymbolMeta } from './pionex-meta.js'

/** Fähigkeiten, die jeder Eintrag beantworten muss — Vorgabe `false`. */
const FAEHIGKEITEN_VORGABE = {
    // Eigene Kontraktdaten (Rundung) statt derer der Marktdatenquelle.
    orderMeta: false,
}

const BESCHREIBUNG = {
    bitunix: {
        id: 'bitunix',
        label: 'Bitunix',
        faehigkeiten: {},
    },
    pionex: {
        id: 'pionex',
        label: 'Pionex',
        // Pionex hält getrennte Limits und Schritte — der Schattenbetrieb
        // soll zeigen, welche Menge dort tatsächlich zulässig wäre.
        faehigkeiten: { orderMeta: true },
        holeSymbolMeta: pionexSymbolMeta,
    },
}

const REGISTRY = new Map()

for (const [name, b] of Object.entries(BESCHREIBUNG)) {
    REGISTRY.set(name, {
        ...b,
        faehigkeiten: { ...FAEHIGKEITEN_VORGABE, ...(b.faehigkeiten || {}) },
    })
}

/**
 * Eintrag zu einem Broker-Namen. Leer = Altbestand vor der Broker-Spalte → bitunix.
 * @throws bei unbekanntem Namen — absichtlich, siehe Dateikopf.
 */
export function holeAdapter(broker) {
    const name = String(broker || '').toLowerCase().trim() || 'bitunix'
    const a = REGISTRY.get(name)
    if (!a) {
        throw new Error(`Unbekannter Broker "${broker}" — bekannt sind: ${[...REGISTRY.keys()].join(', ')}`)
    }
    return a
}

/** Gibt es diesen Broker? Für Eingabeprüfungen, die nicht werfen sollen. */
export function kenntBroker(broker) {
    return REGISTRY.has(String(broker || '').toLowerCase().trim())
}

/** Für die Registry-Route und die Broker-Auswahl in der Oberfläche. */
export function holeAdapterListe() {
    return [...REGISTRY.values()].map((a) => ({
        id: a.id,
        label: a.label,
        faehigkeiten: a.faehigkeiten,
    }))
}
