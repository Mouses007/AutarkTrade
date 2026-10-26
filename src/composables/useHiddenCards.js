import { reactive, ref, getCurrentScope, onScopeDispose } from 'vue'

/**
 * Sichtbarkeit und Reihenfolge von Karten — gespeichert je Gerät im localStorage.
 *
 * Die Mechanik stand wortgleich in `JournalUebersicht.vue` und `Auswertung.vue`; mit dem
 * Marktradar wäre sie dreimal im Baum. Herausgezogen ist nur die Mechanik, nicht
 * das Zahnrad-Markup: die drei Seiten setzen es in ganz verschiedene Leisten.
 *
 * Das Speicherformat der Sichtbarkeit bleibt unverändert (Array von Schlüsseln
 * unter demselben Namen), damit vorhandene Einträge weiter gelten. Die
 * Reihenfolge kommt als zweiter Eintrag `<key>_order` dazu.
 *
 * `standardVersteckt` belegt die Ausblend-Menge beim ERSTEN Aufruf vor (solange
 * unter `storageKey` noch nichts gespeichert ist). Gedacht für Seiten mit
 * grossem Katalog, die aufgeräumt starten sollen (Startseite): dort sind fünf
 * Kacheln sichtbar, der Rest wartet im Zahnrad. Sobald der Nutzer einmal
 * umschaltet, gilt ausschliesslich sein localStorage — die Vorgabe drängt sich
 * nie ein zweites Mal auf. Marktradar/Live-Trading rufen ohne das Argument auf
 * und starten damit wie bisher mit allen Kacheln sichtbar.
 *
 * Seit Audit B (FUN-WEB-004): Schreiben in `try` (voller oder gesperrter
 * Speicher darf das Umschalten nicht mit einem Fehler abbrechen) und ein
 * `storage`-Listener — in einem zweiten Tab derselben Seite übernimmt die
 * Ansicht die Änderung, statt sie beim nächsten eigenen Schreiben zu überschreiben.
 *
 * @param {string} storageKey z.B. 'marktradar_hidden_cards'
 * @param {string[]} [standardVersteckt=[]] beim Erststart ausgeblendete Ids
 */
export function useHiddenCards(storageKey, standardVersteckt = []) {
    const orderKey = `${storageKey}_order`

    const lies = (key, vorgabe) => {
        try {
            const roh = JSON.parse(localStorage.getItem(key) || 'null')
            return Array.isArray(roh) ? roh : vorgabe
        } catch {
            // Kaputter Eintrag (von Hand bearbeitet, halb geschrieben) darf die
            // Seite nicht lahmlegen — dann eben mit der Vorgabe weiter.
            return vorgabe
        }
    }

    const sizeKey = `${storageKey}_size`

    // Fehlt der Eintrag (Erststart), gilt `standardVersteckt`; sobald einmal
    // gespeichert wurde (auch ein leeres Array durch „alle zeigen"), gewinnt der
    // gespeicherte Stand.
    const hiddenCards = reactive(new Set(lies(storageKey, standardVersteckt)))
    const reihenfolge = ref(lies(orderKey, []))

    // id → { spalten, hoehe } aus dem Ziehen am Eckanfasser
    const groessen = reactive((() => {
        try {
            const roh = JSON.parse(localStorage.getItem(sizeKey) || 'null')
            return roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}
        } catch {
            return {}
        }
    })())

    /** Schreiben darf scheitern (voll, privater Modus) — dann gilt es nur in diesem Tab. */
    const schreibe = (key, wert) => {
        try { localStorage.setItem(key, JSON.stringify(wert)) } catch { /* nur in diesem Tab */ }
    }
    const schreibeSichtbarkeit = () => schreibe(storageKey, [...hiddenCards])

    // Zweiter Tab hat umgestellt: übernehmen (das Ereignis kommt nur in ANDEREN Tabs an)
    const ausAnderemTab = (e) => {
        if (e.storageArea && e.storageArea !== localStorage) return
        if (e.key === storageKey) {
            hiddenCards.clear()
            for (const k of lies(storageKey, standardVersteckt)) hiddenCards.add(k)
        } else if (e.key === orderKey) {
            reihenfolge.value = lies(orderKey, [])
        } else if (e.key === sizeKey) {
            let neu = {}
            try {
                const roh = JSON.parse(e.newValue || 'null')
                if (roh && typeof roh === 'object' && !Array.isArray(roh)) neu = roh
            } catch { /* kaputt: leer */ }
            for (const k of Object.keys(groessen)) if (!(k in neu)) delete groessen[k]
            Object.assign(groessen, neu)
        }
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('storage', ausAnderemTab)
        if (getCurrentScope()) onScopeDispose(() => window.removeEventListener('storage', ausAnderemTab))
    }

    function toggleCard(key) {
        if (hiddenCards.has(key)) hiddenCards.delete(key)
        else hiddenCards.add(key)
        schreibeSichtbarkeit()
    }

    function isVisible(key) {
        return !hiddenCards.has(key)
    }

    function zeigeAlle() {
        hiddenCards.clear()
        schreibeSichtbarkeit()
    }

    function setzeReihenfolge(ids) {
        reihenfolge.value = [...ids]
        schreibe(orderKey, reihenfolge.value)
    }

    /** Beim Ziehen ohne Schreiben aufrufen, am Ende einmal mit `sichern`. */
    function setzeGroesse(id, wert, sichern = false) {
        if (wert === null) delete groessen[id]
        else groessen[id] = { ...groessen[id], ...wert }
        if (sichern) schreibe(sizeKey, groessen)
    }

    return {
        hiddenCards, reihenfolge, groessen,
        toggleCard, isVisible, zeigeAlle, setzeReihenfolge, setzeGroesse,
    }
}
