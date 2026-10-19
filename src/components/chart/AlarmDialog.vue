<script setup>
/**
 * Alarm anlegen oder ändern. Drei Arten:
 *   preis  über/unter/kreuzt einen festen Preis
 *   linie  über/unter/kreuzt eine gezeichnete Linie (auch schräg — der Server
 *          rechnet den Linienpreis zur jeweiligen Zeit)
 *   zone   Rechteck oder Kanal betreten/verlassen
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { legeAlarmAn, aendereAlarm } from '../../stores/chartAlarme.js'
import { Symbol, Knopf } from '../basis'

const props = defineProps({
    // Neu: { symbol, markt, art, preis?, zeichnung? } — Ändern: der Alarm selbst (mit id)
    vorlage: { type: Object, required: true },
})
const emit = defineEmits(['schliesse'])

// Esc schliesst — im Erfassungsmodus, damit die Chart-Tastatur (Entf, Strg+Z) es nicht zuerst sieht.
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); emit('schliesse') } }
onMounted(() => window.addEventListener('keydown', esc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', esc, true))
const { t } = useI18n()

const istNeu = !props.vorlage.id
const v = props.vorlage
const zeichnungTyp = v.zeichnung?.typ || null
const art = v.art
const richtung = ref(v.bedingung?.richtung || (art === 'zone' ? 'betreten' : 'kreuzt'))
const preis = ref(v.bedingung?.preis ?? v.preis ?? '')
const kante = ref(v.bedingung?.kante || 'oben')
const einmalig = ref(v.einmalig ?? true)
const sperreMin = ref(v.bedingung?.sperreMin ?? 15)
const schwere = ref(v.bedingung?.schwere || 'warnung')
const push = ref(v.kanaele?.push !== false)
const mail = ref(v.kanaele?.mail !== false)
const notiz = ref(v.notiz || '')
const fehler = ref('')
const speichert = ref(false)

const richtungen = computed(() => (art === 'zone' ? ['betreten', 'verlassen'] : ['kreuzt', 'ueber', 'unter']))

async function speichern() {
    fehler.value = ''
    speichert.value = true
    const bedingung = { richtung: richtung.value, schwere: schwere.value }
    if (art === 'preis') bedingung.preis = Number(preis.value)
    if (zeichnungTyp === 'kanal' && art === 'linie') bedingung.kante = kante.value
    if (!einmalig.value) bedingung.sperreMin = Number(sperreMin.value) || 0
    const gemeinsam = { bedingung, einmalig: einmalig.value, kanaele: { push: push.value, mail: mail.value }, notiz: notiz.value }
    try {
        if (istNeu) {
            await legeAlarmAn({ symbol: v.symbol, markt: v.markt, art, zeichnungId: v.zeichnung?.id ?? null, ...gemeinsam })
        } else {
            await aendereAlarm(v.id, { ...gemeinsam, aktiv: true })
        }
        emit('schliesse')
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        speichert.value = false
    }
}
</script>

<template>
    <div class="dialogHintergrund" @click.self="emit('schliesse')">
        <div class="dialog">
            <div class="kopf">
                <b class="titel"><Symbol name="glocke" /> {{ t(istNeu ? 'chart.alarm.neu' : 'chart.alarm.aendern') }} — {{ v.symbol }}{{ v.markt === 'spot' ? ' Spot' : '' }}</b>
                <button type="button" class="zu" @click="emit('schliesse')"><Symbol name="schliessen" /></button>
            </div>
            <div class="art">{{ t('chart.alarm.art.' + art) }}<template v-if="zeichnungTyp"> · {{ t('chart.wz.' + zeichnungTyp) }}</template></div>
            <label class="zeile">
                <span>{{ t('chart.alarm.bedingung') }}</span>
                <select v-model="richtung" class="at-feld klein">
                    <option v-for="r in richtungen" :key="r" :value="r">{{ t('chart.alarm.richtung.' + r) }}</option>
                </select>
            </label>
            <label v-if="art === 'preis'" class="zeile">
                <span>{{ t('chart.alarm.preis') }}</span>
                <input v-model="preis" type="number" step="any" class="at-feld klein" />
            </label>
            <label v-if="art === 'linie' && zeichnungTyp === 'kanal'" class="zeile">
                <span>{{ t('chart.alarm.kante') }}</span>
                <select v-model="kante" class="at-feld klein">
                    <option value="oben">{{ t('chart.alarm.kanten.oben') }}</option>
                    <option value="mitte">{{ t('chart.alarm.kanten.mitte') }}</option>
                    <option value="unten">{{ t('chart.alarm.kanten.unten') }}</option>
                </select>
            </label>
            <label class="haken"><input v-model="einmalig" type="checkbox" /> {{ t('chart.alarm.einmalig') }}</label>
            <label v-if="!einmalig" class="zeile">
                <span>{{ t('chart.alarm.sperre') }}</span>
                <input v-model="sperreMin" type="number" min="0" class="at-feld klein" />
            </label>
            <label class="zeile">
                <span>{{ t('chart.alarm.schwere') }}</span>
                <select v-model="schwere" class="at-feld klein">
                    <option value="info">{{ t('chart.alarm.schweren.info') }}</option>
                    <option value="warnung">{{ t('chart.alarm.schweren.warnung') }}</option>
                    <option value="kritisch">{{ t('chart.alarm.schweren.kritisch') }}</option>
                </select>
            </label>
            <div class="haken">
                <label><input v-model="push" type="checkbox" /> {{ t('chart.alarm.push') }}</label>
                <label><input v-model="mail" type="checkbox" /> {{ t('chart.alarm.mail') }}</label>
            </div>
            <input v-model="notiz" class="at-feld klein" maxlength="300" :placeholder="t('chart.alarm.notiz')" />
            <div class="hinweis">{{ t('chart.alarm.hinweis') }}</div>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
            <div class="fuss">
                <Knopf art="leise" klein @click="emit('schliesse')">{{ t('chart.alarm.abbrechen') }}</Knopf>
                <Knopf art="haupt" klein :disabled="speichert || (art === 'preis' && !(Number(preis) > 0))" @click="speichern">
                    {{ t('chart.alarm.speichern') }}</Knopf>
            </div>
        </div>
    </div>
</template>

<style scoped>
.dialogHintergrund {
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 16px 16px;
}

.dialog {
    width: 380px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--panel);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    padding: 12px;
    font-size: 12px;
}

.kopf {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.titel {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-1);
}

.zu {
    background: transparent;
    border: none;
    color: var(--muted);
    display: inline-flex;
    cursor: pointer;
}

.zu:hover {
    color: var(--text);
}

.art {
    color: var(--muted);
}

.zeile {
    display: grid;
    grid-template-columns: 1fr 170px;
    align-items: center;
    gap: 8px;
}

.haken {
    display: flex;
    gap: 14px;
    align-items: center;
}

.haken label {
    display: flex;
    gap: 6px;
    align-items: center;
}

.hinweis {
    color: var(--muted);
    font-size: 11px;
}

.fehler {
    color: var(--bad);
}

.fuss {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
</style>
