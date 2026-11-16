<script setup>
/**
 * Ein Bot in der Übersicht der Bot-Seite. Klick öffnet die Detailansicht.
 * Daten: ein Eintrag aus GET /api/bots (normalisiereBot + kennzahlen).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Pille from '@/components/basis/Pille.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { preis, betrag, prozent, menge, dauer, laufzeitTage, ton } from './format.js'

const props = defineProps({ bot: { type: Object, required: true } })
const emit = defineEmits(['oeffnen'])
const { t, te } = useI18n()

const k = computed(() => props.bot.kennzahlen || {})
const statusText = computed(() => {
    const s = props.bot.status
    return te(`bots.status.${s}`) ? t(`bots.status.${s}`) : s
})
const grundText = computed(() => {
    const g = props.bot.endGrund
    if (!g) return ''
    return te(`bots.grund.${g}`) ? t(`bots.grund.${g}`) : g
})
const richtungTon = computed(() => ({ LONG: 'gut', SHORT: 'schlecht' }[props.bot.richtung] || 'neutral'))
</script>

<template>
    <button type="button" class="botKarte" :class="{ laufend: bot.laufend }" @click="emit('oeffnen', bot.id)">
        <div class="kopf">
            <span class="coin">{{ bot.coin }}</span>
            <Pille ton="neutral">{{ bot.typName }}</Pille>
            <Pille v-if="bot.richtung" :ton="richtungTon">{{ t(`bots.richtung.${bot.richtung}`) }}</Pille>
            <Pille v-if="bot.hebel" ton="neutral">{{ bot.hebel }}x</Pille>
            <span class="status">{{ statusText }}<template v-if="grundText"> · {{ grundText }}</template></span>
        </div>

        <dl class="werte">
            <div>
                <dt>{{ t('bots.feld.band') }}</dt>
                <dd>{{ preis(bot.grid?.unten) }} – {{ preis(bot.grid?.oben) }}</dd>
            </div>
            <div v-if="bot.laufend">
                <dt>{{ t('bots.feld.kurs') }}</dt>
                <dd>
                    {{ bot.kurs != null ? preis(bot.kurs) : t('bots.kursUnbekannt') }}
                    <span v-if="k.band" class="lage" :class="k.band.lage">{{ t(`bots.lage.${k.band.lage}`) }}</span>
                </dd>
            </div>
            <div>
                <dt>{{ t('bots.feld.gewinn') }}</dt>
                <dd :class="ton(k.gewinn?.gesamt, bot.marginCoin)">
                    {{ betrag(k.gewinn?.gesamt, bot.marginCoin, { vorzeichen: true }) }}
                    <span class="leise">{{ prozent(k.rendite?.gesamt, { vorzeichen: true }) }}</span>
                </dd>
            </div>
            <div>
                <dt>{{ t('bots.feld.gridGewinn') }}</dt>
                <dd :class="ton(bot.ergebnis?.gridGewinn, bot.marginCoin)">{{ betrag(bot.ergebnis?.gridGewinn, bot.marginCoin, { vorzeichen: true }) }}</dd>
            </div>
            <div v-if="bot.laufend && bot.typ === 'spot_grid'">
                <dt>{{ t('bots.feld.position') }}</dt>
                <dd>{{ menge(bot.position?.menge, bot.coin) }}</dd>
            </div>
            <div v-else-if="bot.laufend">
                <dt>{{ t('bots.feld.liqAbstand') }}</dt>
                <dd>{{ k.liquidation ? prozent(k.liquidation.abstand) : '—' }}</dd>
            </div>
            <div>
                <dt>{{ t('bots.feld.laufzeit') }}</dt>
                <dd>{{ dauer(laufzeitTage(bot, k.tage)) }}</dd>
            </div>
        </dl>

        <ul v-if="k.hinweise?.length" class="hinweise">
            <li v-for="h in k.hinweise" :key="h"><Symbol name="warnung" :groesse="13" /> {{ t(`bots.hinweis.${h}`) }}</li>
        </ul>
    </button>
</template>

<style scoped>
.botKarte {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    width: 100%;
    padding: var(--abstand-3);
    border: 1px solid var(--line);
    border-left: 3px solid var(--line-stark);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.botKarte:hover { border-color: var(--accent-rand); }
.botKarte.laufend { border-left-color: var(--accent); }
.kopf { display: flex; flex-wrap: wrap; align-items: center; gap: var(--abstand-2); }
.coin { font-weight: 600; font-size: 1.05rem; }
.status { margin-left: auto; color: var(--muted); font-size: 0.85rem; }
.werte {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--abstand-2) var(--abstand-3);
    margin: 0;
}
.werte dt { color: var(--muted); font-size: 0.75rem; }
.werte dd { margin: 0; font-variant-numeric: tabular-nums; }
.leise { color: var(--muted); font-size: 0.8rem; margin-left: 0.3em; }
.gut { color: var(--good); }
.schlecht { color: var(--bad); }
.lage { font-size: 0.75rem; margin-left: 0.3em; color: var(--muted); }
.lage.darunter, .lage.darueber { color: var(--warn); }
.hinweise { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.hinweise li { color: var(--warn); font-size: 0.8rem; display: flex; align-items: center; gap: 0.35em; }
</style>
