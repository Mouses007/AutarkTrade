<script setup>
/**
 * Bot-Vorlage im Chart (18.11.2026): Rechtsklick auf einen Preis → Vorlage wählen → der
 * gewohnte Start-Dialog (Prüfen bei Pionex → Haken → Senden), mit dem geklickten Preis als
 * Trigger. Pionex legt den Bot an und startet ihn, sobald der Kurs den Preis erreicht; die
 * App wartet auf nichts und sendet nichts ohne den Klick im Dialog.
 *
 * Band und Stops der Vorlage sind Anteile vom Preis (shared/botVorlage.js) und werden hier
 * um den geklickten Preis gelegt.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Dialog from '@/components/basis/Dialog.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import BotAktionDialog from './BotAktionDialog.vue'
import { preis as preisText, vorlageZeile } from './format.js'
import { vorlageAnwenden, vorlagePasst, coinAusSymbol } from '../../../shared/botVorlage.js'

const props = defineProps({
    symbol: { type: String, required: true },
    preis: { type: Number, required: true },
})
const emit = defineEmits(['zu'])
const { t, locale } = useI18n()

const coin = computed(() => coinAusSymbol(props.symbol))
const laedt = ref(true)
const fehler = ref('')
const vorlagen = ref([])
const steuerung = ref(null)
const coins = ref([])
const gewaehlt = ref(null)
const listeOffen = ref(true)
const startOffen = ref(false)

onMounted(async () => {
    try {
        const [v, s, c] = await Promise.all([
            axios.get('/api/bots/vorlagen'),
            axios.get('/api/bots/steuerung', { params: { sprache: locale.value } }),
            axios.get('/api/bots/plan/coins', { timeout: 60_000 }).catch(() => ({ data: { coins: [] } })),
        ])
        vorlagen.value = v.data?.vorlagen || []
        steuerung.value = s.data || null
        coins.value = c.data?.coins || []
    } catch (e) { fehler.value = e?.response?.data?.error || e.message } finally { laedt.value = false }
})

const steuerungAktiv = computed(() => !!(steuerung.value?.schluessel && steuerung.value?.freigeschaltet))
const coinInfo = computed(() => coins.value.find((c) => c.coin === coin.value) || null)
// Ohne Coin-Liste (Pionex nicht erreichbar) nicht aussperren: die Prüfung bei Pionex sagt es dann
const handelbar = (v) => !coins.value.length || !!coinInfo.value?.[v.art]
const passende = computed(() => vorlagen.value.filter((v) => vorlagePasst(v, coin.value)))

const text = (x) => (x == null ? '' : String(Number(Number(x).toPrecision(6))))
const plan = computed(() => (gewaehlt.value ? vorlageAnwenden(gewaehlt.value, props.preis) : null))
const planBot = computed(() => {
    const v = gewaehlt.value, p = plan.value
    if (!v || !p) return null
    const spot = v.art === 'spot', coinM = v.art === 'coinM'
    return {
        id: 'plan', plan: true, richtung: v.richtung, coin: coin.value, coinM, marginCoin: coinM ? coin.value : 'USDT',
        typ: spot ? 'spot_grid' : coinM ? 'coinm_grid' : 'futures_grid',
        grid: { unten: p.unten, oben: p.oben, anzahl: p.anzahl }, hebel: v.hebel, einsatz: { basis: v.einsatz }, stops: {},
    }
})
const vorgabe = computed(() => {
    const v = gewaehlt.value, p = plan.value
    if (!v || !p) return {}
    return {
        unten: text(p.unten), oben: text(p.oben), anzahl: String(p.anzahl), hebel: String(v.hebel), einsatz: text(v.einsatz),
        ...(p.stopLoss != null ? { stopLoss: text(p.stopLoss) } : {}), ...(p.takeProfit != null ? { takeProfit: text(p.takeProfit) } : {}),
        trigger: text(props.preis),
    }
})
const feste = computed(() => {
    const v = gewaehlt.value
    if (!v) return null
    return { coin: coin.value, coinM: v.art === 'coinM', spot: v.art === 'spot', richtung: v.richtung, art: v.gridArt, ...(v.art === 'spot' ? { hebel: '1' } : {}) }
})

function waehle(v) {
    gewaehlt.value = v
    listeOffen.value = false
    startOffen.value = true
}
function listeZu(offen) { listeOffen.value = offen; if (!offen && !startOffen.value) emit('zu') }
function startZu(offen) { startOffen.value = offen; if (!offen) emit('zu') }
</script>

<template>
    <Dialog :model-value="listeOffen" :titel="t('bots.vorlage.chartTitel', { preis: preisText(preis) })" breite="38rem" @update:model-value="listeZu">
        <div class="wahl">
            <p v-if="laedt" class="leise">{{ t('bots.vorlage.laedt') }}</p>
            <Hinweis v-else-if="fehler" art="fehler">{{ fehler }}</Hinweis>
            <p v-else-if="!coin" class="leise">{{ t('bots.vorlage.keineCoin') }}</p>
            <template v-else>
                <Hinweis v-if="!steuerungAktiv" art="warn">
                    <p class="abs">{{ t('bots.vorlage.ohneSteuerung') }}</p>
                    <Knopf klein to="/bots">{{ t('bots.vorlage.zurBotSeite') }}</Knopf>
                </Hinweis>
                <template v-if="passende.length">
                    <p class="leise">{{ t('bots.vorlage.chartText', { preis: preisText(preis) }) }}</p>
                    <ul class="liste">
                        <li v-for="v in passende" :key="v.id">
                            <button type="button" :disabled="!steuerungAktiv || !handelbar(v)" @click="waehle(v)">
                                <strong>{{ v.name }}</strong>
                                <span>{{ vorlageZeile(v, t) }}</span>
                                <span v-if="!handelbar(v)" class="warn">{{ t('bots.vorlage.nichtHandelbar') }}</span>
                            </button>
                        </li>
                    </ul>
                </template>
                <template v-else>
                    <p class="leise">{{ t('bots.vorlage.leer', { coin }) }}</p>
                    <div class="knoepfe"><Knopf art="haupt" to="/bots/plan">{{ t('bots.vorlage.zumPlaner') }}</Knopf></div>
                </template>
            </template>
        </div>
    </Dialog>
    <BotAktionDialog v-if="planBot" :model-value="startOffen" :bot="planBot" aktion="starten" :vorgabe="vorgabe" :feste="feste" :steuerung="steuerung" @update:model-value="startZu" />
</template>

<style scoped>
.wahl { display: flex; flex-direction: column; gap: var(--abstand-3); }
.leise { color: var(--muted); font-size: 0.85rem; margin: 0; line-height: 1.5; }
.abs { margin: 0 0 var(--abstand-2); }
.liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--abstand-2); }
.liste button { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); background: transparent; color: var(--text); border-radius: var(--radius); padding: var(--abstand-2) var(--abstand-3); font: inherit; cursor: pointer; }
.liste button:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-flaeche); }
.liste button:disabled { opacity: 0.5; cursor: default; }
.liste button span { color: var(--muted); font-size: 0.82rem; }
.liste button .warn { color: var(--warn); }
.knoepfe { display: flex; justify-content: flex-end; }
</style>
