<script setup>
/**
 * Aktionen an einem Pionex-Bot (Bot-Detail): Knöpfe je Aktion, die Schritte
 * eines übernommenen Vorschlags (KI oder Simulation) und das Änderungsprotokoll.
 * Jede Aktion läuft einzeln durch BotAktionDialog (Prüfen → Haken → Senden).
 * Den Hebel eines laufenden Bots kann die Pionex-API nicht ändern — das steht
 * als Schritt mit Hinweis da, nicht als Knopf.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import BotAktionDialog from './BotAktionDialog.vue'
import { preis, betrag, datum } from './format.js'

const props = defineProps({
    bot: { type: Object, required: true },
    steuerung: { type: Object, default: null },
    vorschlag: { type: Object, default: null },   // Variante aus KI oder Simulation
})
const emit = defineEmits(['gesendet', 'vorschlagWeg'])
const { t, te } = useI18n()

const dialog = ref(false)
const aktion = ref('')
const vorgabe = ref({})
const protokoll = ref([])

// Spot-Grid: nur Beenden und einen neuen starten (für den Rest hat Pionex keine Prüfabfrage)
const AKTIONEN = computed(() => (props.bot.typ === 'spot_grid'
    ? (props.bot.laufend ? ['beenden', 'starten'] : ['starten'])
    : props.bot.laufend
        ? ['band', 'margeDazu', 'margeWeg', 'investieren', 'stops', 'reduzieren', props.bot.status === 'paused' ? 'fortsetzen' : 'pausieren', 'beenden', 'starten']
        : ['starten']))
const SYMBOL = { band: 'regler', margeDazu: 'plusKreis', margeWeg: 'minus', investieren: 'muenzen', stops: 'schildWarnung', reduzieren: 'minus', pausieren: 'pause', fortsetzen: 'play', beenden: 'stopp', starten: 'rakete' }

function oeffne(a, v = {}) { aktion.value = a; vorgabe.value = v; dialog.value = true }

/** Vorschlag → einzelne Schritte in sinnvoller Reihenfolge: zuerst Marge, dann Band, dann Stops. */
const schritte = computed(() => {
    const v = props.vorschlag
    if (!v) return []
    const s = []
    const einsatzHeute = props.bot.einsatz?.basis ?? props.bot.einsatz?.aktuell ?? 0
    if (v.hebel != null && v.hebel !== props.bot.hebel) {
        const noetig = v.einsatz == null && props.bot.hebel ? einsatzHeute * props.bot.hebel / v.hebel - einsatzHeute : null
        s.push({ hebel: true, text: t('bots.st.schrittHebel', { von: props.bot.hebel, auf: v.hebel, betrag: noetig > 0 ? betrag(noetig, props.bot.marginCoin) : '—' }) })
    }
    if (v.extraMarge > 0) s.push({ aktion: 'margeDazu', vorgabe: { betrag: v.extraMarge }, text: t('bots.st.schrittMarge', { betrag: betrag(v.extraMarge, props.bot.marginCoin) }) })
    if (v.einsatz != null && v.einsatz > einsatzHeute) s.push({ aktion: 'investieren', vorgabe: { betrag: Number((v.einsatz - einsatzHeute).toPrecision(6)) }, text: t('bots.st.schrittInvest', { betrag: betrag(v.einsatz - einsatzHeute, props.bot.marginCoin) }) })
    if (v.unten != null || v.oben != null || v.anzahl != null) s.push({ aktion: 'band', vorgabe: { unten: v.unten, oben: v.oben, anzahl: v.anzahl }, text: t('bots.st.schrittBand', { unten: preis(v.unten ?? props.bot.grid?.unten), oben: preis(v.oben ?? props.bot.grid?.oben), anzahl: v.anzahl ?? props.bot.grid?.anzahl }) })
    if (v.stopLoss != null || v.takeProfit != null) s.push({ aktion: 'stops', vorgabe: { stopLoss: v.stopLoss, takeProfit: v.takeProfit }, text: t('bots.st.schrittStops', { sl: preis(v.stopLoss), tp: preis(v.takeProfit) }) })
    return s
})

async function ladeProtokoll() {
    try { protokoll.value = (await axios.get(`/api/bots/${encodeURIComponent(props.bot.id)}/aenderungen`)).data?.aenderungen || [] } catch { protokoll.value = [] }
}
onMounted(ladeProtokoll)
watch(() => props.bot.id, ladeProtokoll)
function gesendet() { ladeProtokoll(); emit('gesendet') }
</script>

<template>
    <div class="akt">
        <Hinweis v-if="steuerung?.testbetrieb" art="info">{{ t('bots.st.testbetrieb') }}</Hinweis>

        <section v-if="schritte.length" class="vorschlag">
            <div class="kopf">
                <h4>{{ t('bots.st.vorschlagTitel') }}</h4>
                <Knopf art="leise" symbol="schliessen" nur-symbol klein :titel="t('bots.st.vorschlagWeg')" @click="emit('vorschlagWeg')" />
            </div>
            <p class="leise">{{ t('bots.st.vorschlagText') }}</p>
            <ol>
                <li v-for="(s, i) in schritte" :key="i">
                    <span>{{ s.text }}</span>
                    <Knopf v-if="s.aktion" klein symbol="pfeilRechts" @click="oeffne(s.aktion, s.vorgabe)">{{ t('bots.st.schrittOeffnen') }}</Knopf>
                    <span v-else class="leise">{{ t('bots.st.nurApp') }}</span>
                </li>
            </ol>
        </section>

        <div class="knopfreihe">
            <Knopf v-for="a in AKTIONEN" :key="a" klein :art="a === 'beenden' ? 'gefahr' : 'normal'" :symbol="SYMBOL[a]" @click="oeffne(a)">{{ t(`bots.st.aktion.${a}`) }}</Knopf>
        </div>
        <p class="leise">{{ t('bots.st.hebelHinweis') }}</p>

        <details v-if="protokoll.length" class="protokoll">
            <summary>{{ t('bots.st.protokoll', { n: protokoll.length }) }}</summary>
            <ul>
                <li v-for="p in protokoll" :key="p.id" :class="p.zustand">
                    <span>{{ datum(p.zeit) }}</span>
                    <strong>{{ te(`bots.st.aktion.${p.aktion}`) ? t(`bots.st.aktion.${p.aktion}`) : p.aktion }}</strong>
                    <span>{{ t(`bots.st.zustand.${p.zustand}`) }}<template v-if="p.code"> ({{ te(`bots.st.fehler.${p.code}`) ? t(`bots.st.fehler.${p.code}`) : p.code }})</template><template v-else-if="!p.ok && p.antwort?.message"> — {{ p.antwort.message }}</template></span>
                </li>
            </ul>
        </details>

        <BotAktionDialog v-model="dialog" :bot="bot" :aktion="aktion" :vorgabe="vorgabe" :steuerung="steuerung" @gesendet="gesendet" />
    </div>
</template>

<style scoped>
.akt { display: flex; flex-direction: column; gap: var(--abstand-3); }
.leise { color: var(--muted); font-size: 0.82rem; margin: 0; }
.knopfreihe { display: flex; gap: var(--abstand-2); flex-wrap: wrap; }
.vorschlag { border: 1px solid var(--accent-rand); border-radius: var(--radius); padding: var(--abstand-3); display: flex; flex-direction: column; gap: var(--abstand-2); }
.vorschlag .kopf { display: flex; justify-content: space-between; align-items: center; }
.vorschlag h4 { margin: 0; font-size: 0.95rem; }
.vorschlag ol { margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: var(--abstand-2); }
.vorschlag li span { margin-right: var(--abstand-2); }
.protokoll summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
.protokoll ul { list-style: none; margin: var(--abstand-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
.protokoll li { display: flex; gap: var(--abstand-2); flex-wrap: wrap; }
.protokoll li.abgelehnt, .protokoll li.abgewiesen { color: var(--bad); }
.protokoll li.unklar, .protokoll li.laeuft { color: var(--warn); }
</style>
