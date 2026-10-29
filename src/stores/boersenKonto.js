/**
 * Kontostand der Journal-Börse für den Positionsrechner im Chart: ist dort kein
 * Kontostand eingetragen, rechnet er das Risiko in % gegen diesen Wert (Feld
 * und Zeichnung). Gespeichert wird er nie in der Zeichnung — der Stand ändert
 * sich mit jedem Trade, ein eingefrorener Wert würde still falsch.
 * Ein Abruf höchstens jede Minute, auch bei mehreren Panels.
 */
import { ref } from 'vue'
import axios from 'axios'
import { gewaehlteBoerse } from './filters.js'

const KONTO_BOERSEN = ['bitunix', 'bitget', 'pionex']
const GILT_MS = 60_000

/** `{ boerse, wert }` oder null (keine Börse eingerichtet, kein Zugang, Bot-Konto …). */
export const boersenKonto = ref(null)
let zuletzt = 0
let laeuft = null

export function ladeBoersenKonto() {
    const b = gewaehlteBoerse.value || 'bitunix'
    if (!KONTO_BOERSEN.includes(b)) { boersenKonto.value = null; return Promise.resolve(null) }
    if (laeuft) return laeuft
    if (boersenKonto.value?.boerse === b && Date.now() - zuletzt < GILT_MS) return Promise.resolve(boersenKonto.value)
    if (!boersenKonto.value && Date.now() - zuletzt < GILT_MS) return Promise.resolve(null)
    laeuft = (async () => {
        try {
            const { data } = await axios.get(`/api/${b}/balance`)
            const w = Number(data?.balance)
            boersenKonto.value = data?.ok && w > 0 ? { boerse: b, wert: w } : null
        } catch { boersenKonto.value = null }
        zuletzt = Date.now()
        laeuft = null
        return boersenKonto.value
    })()
    return laeuft
}
