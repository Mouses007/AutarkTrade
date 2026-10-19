<script setup>
/**
 * Tabelle: Spalten beschrieben, Zeilen als Objekte. Zahlen rechtsbündig mit
 * gleich breiten Ziffern. Eigene Zellen über Slots `zelle-<schluessel>`.
 * Auf schmalen Schirmen scrollt die Tabelle in sich, nie die Seite.
 *
 *   <Tabelle :spalten="[{ schluessel: 'symbol', titel: 'Symbol' },
 *                       { schluessel: 'pnl', titel: 'P&L', zahl: true }]"
 *            :zeilen="trades" schluessel-feld="id">
 *     <template #zelle-pnl="{ wert }"><span :class="wert >= 0 ? 'gut' : 'schlecht'">{{ wert }}</span></template>
 *   </Tabelle>
 */
defineProps({
    spalten: { type: Array, required: true }, // [{ schluessel, titel, zahl?, breite? }]
    zeilen: { type: Array, default: () => [] },
    schluesselFeld: { type: String, default: 'id' },
    leerText: { type: String, default: 'Keine Einträge' },
    dicht: { type: Boolean, default: false },
    klickbar: { type: Boolean, default: false },
})
const emit = defineEmits(['zeile'])
</script>

<template>
    <div class="at-tabelle-rahmen">
        <table :class="['at-tabelle', { dicht, klickbar }]">
            <thead>
                <tr>
                    <th v-for="s in spalten" :key="s.schluessel" :class="{ zahl: s.zahl }"
                        :style="s.breite ? { width: s.breite } : undefined">{{ s.titel }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(z, i) in zeilen" :key="z[schluesselFeld] ?? i" @click="klickbar && emit('zeile', z)">
                    <td v-for="s in spalten" :key="s.schluessel" :class="{ zahl: s.zahl }">
                        <slot :name="'zelle-' + s.schluessel" :zeile="z" :wert="z[s.schluessel]">{{ z[s.schluessel] }}</slot>
                    </td>
                </tr>
                <tr v-if="!zeilen.length" class="leer">
                    <td :colspan="spalten.length">{{ leerText }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.at-tabelle-rahmen {
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
}

.at-tabelle {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    color: var(--text);
}

th {
    position: sticky;
    top: 0;
    text-align: left;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--panel);
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
}

td {
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--line);
}

tbody tr:last-child td {
    border-bottom: none;
}

.dicht th,
.dicht td {
    padding: 0.4rem 0.6rem;
}

.zahl {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

tbody tr:hover td {
    background: var(--panel-soft);
}

.klickbar tbody tr {
    cursor: pointer;
}

.leer td {
    text-align: center;
    color: var(--muted);
    padding: 1.4rem;
}

:deep(.gut) { color: var(--good); }
:deep(.schlecht) { color: var(--bad); }
</style>
