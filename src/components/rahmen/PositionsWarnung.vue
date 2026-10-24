<script setup>
/**
 * Warnleiste für offene Positionen ohne Stop-Loss oder mit Stop hinter dem
 * Liquidationspreis (Regel: `utils/positionsWarnung.js`). Steht im Rahmen über
 * jeder Seite — ein Trade wird nicht nur im Chart eröffnet. Gleiche Form wie
 * die Alarm-Meldungen im Chart: öffnen oder schliessen. Weggeklickt gilt je
 * Position und Grund; ändert sich der Grund (SL nachgetragen, aber hinter dem
 * Liq), meldet sie sich wieder.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Symbol } from '../basis'
import { ladeAlleOffenen } from '../../utils/chart/overlays/positionen.js'
import { positionsWarnungen } from '../../utils/positionsWarnung.js'

const { t } = useI18n()
const router = useRouter()
const SCHLUESSEL = 'positionsWarnungWeg'
const TAKT_MS = 30_000

const warnungen = ref([])
const weg = ref(lese())
function lese() { try { return JSON.parse(localStorage.getItem(SCHLUESSEL) || '[]') } catch { return [] } }
function schreibe(liste) { try { localStorage.setItem(SCHLUESSEL, JSON.stringify(liste)) } catch { /* kein Speicher */ } }

const sichtbar = computed(() => warnungen.value.filter((w) => !weg.value.includes(w.schluessel)))
const preis = (v) => (v == null ? '—' : Number(v).toPrecision(6).replace(/\.?0+$/, ''))
const text = (w) => t('positionsWarnung.' + w.art, {
    symbol: w.symbol, seite: w.richtung === 'short' ? 'Short' : 'Long', sl: preis(w.sl), liq: preis(w.liq),
})

let uhr = null
async function pruefe() {
    if (document.hidden) return
    try {
        warnungen.value = positionsWarnungen(await ladeAlleOffenen())
        // Weggeklicktes für Positionen, die es nicht mehr gibt, vergessen
        const aktuell = new Set(warnungen.value.map((w) => w.schluessel))
        const rest = weg.value.filter((k) => aktuell.has(k))
        if (rest.length !== weg.value.length) { weg.value = rest; schreibe(rest) }
    } catch { /* nächster Takt */ }
}
function schliesse(w) { weg.value = [...weg.value, w.schluessel]; schreibe(weg.value) }
function oeffne(w) { router.push({ path: '/chart', query: { symbol: w.symbol } }) }

onMounted(() => { pruefe(); uhr = setInterval(pruefe, TAKT_MS); document.addEventListener('visibilitychange', pruefe) })
onBeforeUnmount(() => { clearInterval(uhr); document.removeEventListener('visibilitychange', pruefe) })
</script>

<template>
    <div v-if="sichtbar.length" class="positionsWarnung">
        <div v-for="w in sichtbar" :key="w.schluessel" class="meldung" role="alert">
            <Symbol name="warnung" /> <span class="text">{{ text(w) }}</span>
            <span class="knoepfe">
                <button type="button" class="knopf haupt" @click="oeffne(w)">{{ t('positionsWarnung.oeffnen') }}</button>
                <button type="button" class="knopf" @click="schliesse(w)">{{ t('positionsWarnung.schliessen') }}</button>
            </span>
        </div>
    </div>
</template>

<style scoped>
.positionsWarnung {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-1);
    margin: var(--abstand-1) 0;
}

.meldung {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--abstand-1);
    padding: var(--abstand-1) var(--abstand-2);
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    border-radius: var(--radius-klein);
    background: color-mix(in srgb, var(--bad) 12%, var(--panel));
    color: var(--text);
    font-size: 0.85rem;
}

.meldung > :first-child {
    flex: 0 0 auto;
    color: var(--bad);
}

.text {
    flex: 1 1 12rem;
    min-width: 0;
}

.knoepfe {
    margin-left: auto;
    display: inline-flex;
    gap: 6px;
}

.knopf {
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font-size: 0.8rem;
    cursor: pointer;
}

.knopf.haupt {
    border-color: var(--accent);
    color: var(--accent);
}
</style>
