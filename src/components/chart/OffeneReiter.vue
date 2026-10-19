<script setup>
/**
 * Offene Trades über alle Symbole und Börsen (Tabelle `incoming_positions`,
 * die das globale Polling aktuell hält). Klick auf eine Zeile zeigt ihr
 * Symbol im aktiven Chart; das Auge blendet die einzelne Position im Chart
 * aus, der Schalter oben alle (Overlay „Positionen" des aktiven Charts).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ladeAlleOffenen } from '../../utils/chart/overlays/positionen.js'
import { positionenAus, schaltePosition } from '../../stores/chartPositionen.js'
import { overlayAn } from '../../utils/chart/overlays/liste.js'
import { Symbol } from '../basis'

const props = defineProps({ panel: { type: Object, required: true } })
const emit = defineEmits(['waehle', 'overlay'])
const { t } = useI18n()

const liste = ref([])
const laedt = ref(true)
let uhr = null

async function lade() {
    try { liste.value = (await ladeAlleOffenen()).sort((a, b) => (b.einstiegT || 0) - (a.einstiegT || 0)) } catch { /* bleibt */ }
    laedt.value = false
}
onMounted(() => { lade(); uhr = setInterval(() => { if (!document.hidden) lade() }, 15_000) })
onBeforeUnmount(() => clearInterval(uhr))

const zahl = (p) => (p == null ? '—' : Math.abs(p) >= 1000 ? p.toFixed(1) : Math.abs(p) >= 1 ? p.toFixed(3) : p.toPrecision(4))
const aus = (p) => positionenAus.value.has(String(p.id))
</script>

<template>
    <div class="offen">
        <label class="alle">
            <input type="checkbox" :checked="overlayAn(panel, 'positionen')" @change="emit('overlay', $event.target.checked)" />
            {{ t('chart.offen.imChart') }}
        </label>
        <div v-if="!laedt && !liste.length" class="leer">{{ t('chart.offen.leer') }}</div>
        <div v-for="p in liste" :key="p.id" class="zeile" :class="{ aktiv: p.symbol === panel.symbol, aus: aus(p) }" @click="emit('waehle', p.symbol)">
            <div class="kopf">
                <span class="sym">{{ p.symbol }}</span>
                <span class="seite" :class="p.richtung">{{ p.richtung === 'long' ? 'LONG' : 'SHORT' }}</span>
                <span v-if="p.hebel" class="hebel">{{ p.hebel }}x</span>
                <span class="boerse">{{ p.broker }}</span>
                <span class="pnl" :class="p.upnl >= 0 ? 'plus' : 'minus'">{{ p.upnl >= 0 ? '+' : '' }}{{ p.upnl.toFixed(2) }}</span>
                <button type="button" class="auge" :title="t(aus(p) ? 'chart.einblenden' : 'chart.ausblenden')" :aria-label="t(aus(p) ? 'chart.einblenden' : 'chart.ausblenden')"
                    @click.stop="schaltePosition(p.id)"><Symbol :name="aus(p) ? 'augeAus' : 'auge'" /></button>
            </div>
            <div class="werte">
                <span>{{ zahl(p.menge) }} @ {{ zahl(p.einstieg) }}</span>
                <span class="sl">SL {{ zahl(p.sl) }}</span>
                <span class="tp">TP {{ zahl(p.tp) }}</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.offen {
    overflow-y: auto;
    min-height: 0;
    font-size: 12px;
}
.alle input { accent-color: var(--accent); }
.alle {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 11px;
    padding: 2px 4px 8px;
    cursor: pointer;
}
.leer {
    color: var(--muted);
    padding: 8px 4px;
}
.zeile {
    padding: 6px;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    margin-bottom: 4px;
}
.zeile:hover { background: var(--line); }
.zeile.aktiv { border-color: var(--accent-rand); background: var(--accent-flaeche); }
.zeile.aus { opacity: 0.5; }
.kopf {
    display: flex;
    align-items: center;
    gap: 6px;
}
.sym { font-weight: 600; }
.seite {
    font-size: 10px;
    font-weight: 600;
    padding: 0 5px;
    border-radius: 3px;
}
.seite.long { color: var(--good); background: var(--good-flaeche); }
.seite.short { color: var(--bad); background: var(--bad-flaeche); }
.hebel, .boerse { color: var(--muted); font-size: 10px; }
.pnl { margin-left: auto; font-variant-numeric: tabular-nums; }
.pnl.plus { color: var(--good); }
.pnl.minus { color: var(--bad); }
.auge {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 0 2px;
    cursor: pointer;
    display: inline-flex;
}
.auge:hover { color: var(--text); }
.werte {
    display: flex;
    gap: 10px;
    color: var(--muted);
    font-size: 11px;
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
}
.werte .sl { color: var(--bad); }
.werte .tp { color: var(--good); }
</style>
