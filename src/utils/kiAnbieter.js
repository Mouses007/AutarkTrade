/**
 * Anzeigeangaben der KI-Anbieter (Name, Pflichthinweis) für die Oberfläche.
 *
 * Die Wahrheit steht in `server/ai-models.js` (`ANBIETER_REG`, Feld `hinweis`)
 * und kommt über `/api/ai/models`. Hier wird sie EINMAL je Seite geladen und
 * geteilt, damit jede Auswahl-Komponente denselben Namen und denselben Hinweis
 * zeigt, ohne die Liste ein zweites Mal fest zu verdrahten (S12, 2.8).
 */
import { ref } from 'vue'
import axios from 'axios'

/** id → { id, name, hinweis, ausgeblendet } */
export const kiAnbieter = ref({})

let laden = null

export function ladeKiAnbieter() {
    if (laden) return laden
    laden = axios.get('/api/ai/models').then(({ data }) => {
        const karte = {}
        for (const a of data?.anbieter || []) karte[a.id] = { ...a, ausgeblendet: false }
        for (const a of data?.ausgeblendet || []) karte[a.id] = { ...a, ausgeblendet: true }
        for (const a of data?.bildAnbieter || []) karte[a.id] = { ...a, ausgeblendet: false, bild: true }
        kiAnbieter.value = karte
        return karte
    }).catch(() => {
        laden = null   // beim nächsten Mal erneut versuchen
        return {}
    })
    return laden
}

/*
 * Anzeigename einer Anbieter-ID. Drei IDs brauchen eine Übersetzung statt des
 * (deutschen) Registry-Namens; `deepseek` ist seit S12 der neutrale zweite
 * Endpunkt und darf nie unter dem Markennamen erscheinen (89d).
 */
const NAMEN_I18N = { ollama: 'settings.ki.provOllama', custom: 'settings.ki.provCustom', deepseek: 'kiHinweis.namen.endpunkt2' }

/** @param {string} id  @param {Function} t  i18n-Funktion der Komponente */
export function anbieterAnzeige(id, t) {
    if (!id) return ''
    if (NAMEN_I18N[id]) return t(NAMEN_I18N[id])
    return kiAnbieter.value[id]?.name || id
}
