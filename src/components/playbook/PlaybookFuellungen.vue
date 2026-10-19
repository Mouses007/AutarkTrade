<script setup>
/**
 * Block „Füllungen“ einer Bewertung: Füllungen gruppiert, Positionsgrösse,
 * SL/BE/TP und das SL/TP-Protokoll. Nur gelesen — `tradingMetadata` schreiben
 * Incoming und der Import.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Symbol from '@/components/basis/Symbol.vue'
import { timeZoneTrade } from '@/stores/app/rahmen.js'
import { usePlaybook } from './usePlaybook.js'
import {
    durchschnittEroeffnung, gruppiereFuellungen, gefiltertesProtokoll, fuellZeit, fest,
} from './playbookDaten.js'

const props = defineProps({
    eintrag: { type: Object, required: true },
})
const { t } = useI18n()
const pb = usePlaybook()

const m = computed(() => props.eintrag.tradingMetadata || {})
const fills = computed(() => (Array.isArray(m.value.fills) ? m.value.fills : []))
const eroeffnungen = computed(() => fills.value.filter(f => !f.reduceOnly))
const gruppen = computed(() => gruppiereFuellungen(fills.value, timeZoneTrade.value, props.eintrag.tradeId))
const summeEroeffnet = computed(() => eroeffnungen.value.reduce((s, f) => s + (Number(f.qty) || 0), 0))
const summeGebuehr = computed(() => fills.value.reduce((s, f) => s + (Number(f.fee) || 0), 0))
const protokoll = computed(() => gefiltertesProtokoll(m.value))
const protokollOffen = computed(() => !pb.zugeklappteProtokolle.has(props.eintrag.tradeId))

const PLAKETTE = {
    close: { schluessel: 'incoming.fillClose', ton: 'schlecht' },
    partialClose: { schluessel: 'incoming.fillPartialClose', ton: 'warn' },
    initial: { schluessel: 'incoming.fillInitial', ton: 'neutral' },
    compound: { schluessel: 'incoming.fillCompound', ton: 'blau' },
}

function gruppeUmschalten(g) {
    if (g.fills.length < 2) return
    if (pb.aufgeklappteGruppen.has(g.schluessel)) pb.aufgeklappteGruppen.delete(g.schluessel)
    else pb.aufgeklappteGruppen.add(g.schluessel)
}

function protokollUmschalten() {
    const id = props.eintrag.tradeId
    if (pb.zugeklappteProtokolle.has(id)) pb.zugeklappteProtokolle.delete(id)
    else pb.zugeklappteProtokolle.add(id)
}

const zeit = (x) => fuellZeit(x, timeZoneTrade.value)
const wert = (f) => fest((Number(f.qty) || 0) * (Number(f.price) || 0), 2)
</script>

<template>
    <section class="block grau">
        <header class="block-kopf">
            <h4>
                <Symbol name="ebenen" />
                {{ t('incoming.fills') }}
                <span v-if="eroeffnungen.length > 1" class="leise">({{ eroeffnungen.length }} {{ t('incoming.fillEntries') }})</span>
            </h4>
            <span v-if="eroeffnungen.length > 0" class="leise">
                {{ t('incoming.fillAvgPrice') }}: {{ fest(durchschnittEroeffnung(fills), 5) }}
            </span>
        </header>

        <div v-if="gruppen.length" class="tabellen-huelle">
            <table class="fuellungen">
                <tbody>
                    <template v-for="g in gruppen" :key="g.schluessel">
                        <tr :class="{ schliessend: g.reduceOnly, klickbar: g.fills.length > 1 }" @click="gruppeUmschalten(g)">
                            <td class="zeit">
                                <Symbol v-if="g.fills.length > 1" :name="pb.aufgeklappteGruppen.has(g.schluessel) ? 'runter' : 'ausklappen'" :groesse="12" />
                                {{ g.zeit }}
                            </td>
                            <td class="zahl">{{ g.menge }}</td>
                            <td class="zeichen">×</td>
                            <td class="zahl">{{ g.fills.length > 1 ? fest(g.preis, 5) : g.preis }}</td>
                            <td class="zeichen">=</td>
                            <td class="zahl">{{ fest(g.wert, 2) }}</td>
                            <td>
                                <span :class="['plakette', PLAKETTE[g.art].ton]">{{ t(PLAKETTE[g.art].schluessel) }}</span>
                                <span v-if="g.fills.length > 1" class="leise"> ({{ g.fills.length }})</span>
                            </td>
                            <td class="zahl rechts leise">{{ t('incoming.fillFee') }}: {{ fest(g.gebuehr, 4) }}</td>
                        </tr>
                        <template v-if="g.fills.length > 1 && pb.aufgeklappteGruppen.has(g.schluessel)">
                            <tr v-for="(f, i) in g.fills" :key="g.schluessel + ':' + i" class="einzeln">
                                <td class="zeit">{{ zeit(f.time) }}</td>
                                <td class="zahl">{{ Number(f.qty) || 0 }}</td>
                                <td class="zeichen">×</td>
                                <td class="zahl">{{ Number(f.price) || 0 }}</td>
                                <td class="zeichen">=</td>
                                <td class="zahl">{{ wert(f) }}</td>
                                <td></td>
                                <td class="zahl rechts">{{ fest(f.fee, 4) }}</td>
                            </tr>
                        </template>
                    </template>
                </tbody>
            </table>
        </div>

        <div v-if="fills.length > 1" class="zeile summe">
            <span>{{ t('incoming.fillTotal') }}: {{ summeEroeffnet }}</span>
            <span>{{ t('incoming.fillFee') }}: {{ fest(summeGebuehr, 4) }}</span>
        </div>

        <div v-if="m.positionSize" class="zeile">
            {{ t('incoming.positionSize') }}: {{ fest(m.margin, 2) }} × {{ m.leverage }}x = {{ fest(m.positionSize, 2) }} USDT
        </div>

        <div v-if="m.sl != null || m.tp != null || m.breakeven" class="zeile sltp">
            <span v-if="m.sl != null" :class="m.slAboveBreakeven ? 'hellgruen' : 'rot'">
                SL: {{ m.sl }}<span v-if="m.slQty"> ({{ m.slQty }})</span>
            </span>
            <span v-if="m.breakeven">BE: {{ fest(m.breakeven, 2) }}</span>
            <span v-if="m.tp != null" class="orange">
                TP: {{ m.tp }}<span v-if="m.tpQty"> ({{ m.tpQty }})</span>
            </span>
            <span v-if="m.rrr" class="violett rechts">RRR 1:{{ m.rrr }}</span>
        </div>

        <div v-if="protokoll.length" class="protokoll">
            <button type="button" class="protokoll-kopf" :aria-expanded="protokollOffen" @click="protokollUmschalten">
                <Symbol name="verlauf" />
                {{ t('playbook.sltpProtokoll') }}
                <Symbol :name="protokollOffen ? 'hoch' : 'runter'" :groesse="12" />
            </button>
            <ul v-if="protokollOffen" class="protokoll-liste">
                <li v-for="(h, i) in protokoll" :key="i">
                    <span class="leise">{{ zeit(h.time) }}</span>
                    <span :class="h.type === 'SL'
                        ? (m.slAboveBreakeven ? 'hellgruen' : 'rot')
                        : (h.action === 'triggered' ? 'gruen fett' : 'orange')">{{ h.type }}</span>
                    <template v-if="h.action === 'set'">
                        <span>→ {{ h.newVal }}<span v-if="h.qty"> ({{ h.qty }})</span></span>
                        <span class="plakette neutral">{{ t('playbook.gesetzt') }}</span>
                    </template>
                    <template v-else-if="h.action === 'moved'">
                        <span><s class="leise">{{ h.oldVal }}</s> → {{ h.newVal }}<span v-if="h.qty"> ({{ h.qty }})</span></span>
                        <span class="plakette blau">{{ t('playbook.verschoben') }}</span>
                    </template>
                    <template v-else-if="h.action === 'triggered'">
                        <span><s class="leise">{{ h.oldVal }}</s> → <span class="gruen">{{ t('playbook.ausgeloest') }}</span></span>
                    </template>
                    <template v-else-if="h.action === 'removed'">
                        <span><s class="leise">{{ h.oldVal }}</s> → {{ t('playbook.entfernt') }}</span>
                    </template>
                    <span v-if="h.rrr" class="violett rechts">1:{{ h.rrr }}</span>
                </li>
            </ul>
        </div>
    </section>
</template>

<style scoped>
.block {
    padding: var(--abstand-3) var(--abstand-4);
    border: 1px solid var(--line);
    border-left: 3px solid var(--muted);
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
}

.block-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

h4 {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
}

.leise {
    color: var(--muted);
    font-weight: 400;
    font-size: 0.82rem;
}

/* Telefon: die Tabelle scrollt in ihrer Hülle, die Seite nicht. */
.tabellen-huelle {
    overflow-x: auto;
}

.fuellungen {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.fuellungen td {
    padding: 0.2rem 0.4rem;
    border-bottom: 1px solid var(--line);
}

.fuellungen tr.klickbar {
    cursor: pointer;
}

.fuellungen tr.klickbar:hover td {
    background: var(--panel-hoch);
}

.fuellungen tr.schliessend td {
    color: var(--bad);
}

.fuellungen tr.einzeln td {
    color: var(--muted);
    font-size: 0.76rem;
}

.zahl {
    text-align: right;
}

.zeichen {
    color: var(--muted);
    text-align: center;
}

.rechts {
    margin-left: auto;
    text-align: right;
}

.zeit {
    color: var(--muted);
}

.zeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-3);
    margin-top: var(--abstand-2);
    font-size: 0.85rem;
}

.summe {
    justify-content: space-between;
    color: var(--muted);
}

.plakette {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-pille);
    font-size: 0.72rem;
    font-weight: 600;
}

.plakette.schlecht { background: var(--bad-flaeche); color: var(--bad); }
.plakette.warn { background: var(--warn-flaeche); color: var(--warn); }
.plakette.neutral { background: var(--panel-hoch); color: var(--muted); }
.plakette.blau { background: var(--accent-flaeche); color: var(--accent); }

/*
 * Fachfarben des SL/TP-Blocks. Das Gestaltungssystem hat nur Gut/Schlecht/
 * Warnung und Türkis; Orange (TP) und Violett (RRR) werden daraus gemischt,
 * damit keine Farbwerte ausserhalb der Token entstehen.
 */
.rot { color: var(--bad); }
.gruen { color: var(--good); }
.hellgruen { color: color-mix(in srgb, var(--good) 65%, var(--text)); }
.orange { color: color-mix(in srgb, var(--warn) 70%, var(--bad)); }
.violett { color: color-mix(in srgb, var(--accent) 35%, var(--bad)); }
.fett { font-weight: 700; }

.protokoll {
    margin-top: var(--abstand-3);
}

.protokoll-kopf {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
}

.protokoll-kopf:hover {
    color: var(--text);
}

.protokoll-liste {
    margin: var(--abstand-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.8rem;
}

.protokoll-liste li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0.15rem 0;
    border-bottom: 1px solid var(--line);
}
</style>
