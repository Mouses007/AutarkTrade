<script setup>
/**
 * Alles zu EINER Instanz, in fünf Reitern:
 *
 *   Überblick      Status, Kennzahlen, Kapitalkurve, Trichter, Symbole
 *   Chart          derselbe Chart wie im Arbeitsplatz, mit Setups und Trades
 *   Signale        der ganze Lebenslauf Setup → Trade, offene Positionen
 *   Auswertung     R-Verteilung, Gruppen, Risiko
 *   Einstellungen  Parameter, Risiko, Veto, Versionen, Vorschläge, Aktionen
 *
 * Ein Klick auf ein Symbol, ein Signal oder einen Trade führt in den Chart an
 * genau diese Stelle (`fokus`).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { Knopf, Pille, Hinweis, Reiter, Symbol } from '../basis'
import Ueberblick from './instanz/Ueberblick.vue'
import ChartReiter from './instanz/ChartReiter.vue'
import Signale from './instanz/Signale.vue'
import Auswertung from './instanz/Auswertung.vue'
import Einstellungen from './instanz/Einstellungen.vue'
import { apiFehlerText } from '../../utils/apiError.js'
import { logError } from '../../utils/logger.js'

const props = defineProps({
    id: { type: Number, required: true },
    registry: { type: Object, required: true },
})
const emit = defineEmits(['geaendert'])
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const instanz = ref(null)
const perf = ref(null)
const positionen = ref([])
const fehler = ref('')
const meldung = ref('')
let takt = null

const REITER = ['ueberblick', 'chart', 'signale', 'auswertung', 'einstellungen']
const reiter = computed({
    get: () => (REITER.includes(route.params.reiter) ? route.params.reiter : 'ueberblick'),
    set: (r) => router.replace(`/strategien/instanzen/${props.id}/${r}`),
})
const reiterListe = computed(() => REITER.map((id) => ({
    id, titel: t('strategien.reiter.' + id),
    zahl: id === 'signale' ? (positionen.value.length || undefined)
        : id === 'einstellungen' ? (instanz.value?.offeneVorschlaege || undefined) : undefined,
})))

async function laden() {
    try {
        const [i, p, z] = await Promise.all([
            axios.get(`/api/strategies/instances/${props.id}`),
            axios.get('/api/strategies/performance', { params: { instanceId: props.id } }),
            axios.get('/api/strategies/positions/zwischenstand', { params: { instanceId: props.id } }).catch(() => ({ data: {} })),
        ])
        instanz.value = i.data
        perf.value = p.data
        positionen.value = z.data?.positionen || []
        fehler.value = ''
    } catch (e) {
        logError('InstanzAnsicht', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}
onMounted(() => {
    laden()
    takt = setInterval(() => { if (!document.hidden) laden() }, 30000)
})
onBeforeUnmount(() => clearInterval(takt))
watch(() => props.id, laden)

async function geaendert() { await laden(); emit('geaendert') }

const archiviert = computed(() => Number(instanz.value?.archiviert) === 1)
const strategie = computed(() => props.registry.strategies.find((s) => s.id === instanz.value?.strategyId) || null)

async function umschalten() {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/instances/${props.id}/enabled`, { enabled: !instanz.value.enabled })
        await geaendert()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.toggleFailed'), t)
    }
}

// ── Fokus: wohin der Chart springt ───────────────────────────────────────
const fokus = ref(null)   // { symbol, timeframe, art?, id?, t? }
function zumChart(ziel) {
    fokus.value = { ...ziel, n: Date.now() }
    reiter.value = 'chart'
}
</script>

<template>
    <div class="instanzAnsicht">
        <div class="kopf">
            <Knopf klein art="leise" symbol="pfeilLinks" to="/strategien/instanzen">{{ t('strategien.liste.titel') }}</Knopf>
        </div>

        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>
        <Hinweis v-if="meldung" art="info">{{ meldung }}</Hinweis>

        <template v-if="instanz">
            <div class="titel">
                <h5 class="seitentitel">{{ instanz.name }}</h5>
                <Pille v-if="archiviert" ton="neutral" symbol="archiv">{{ t('strategien.status.archiviert') }}</Pille>
                <Pille v-else :ton="instanz.enabled ? 'gut' : 'neutral'">{{ instanz.enabled ? t('strategien.status.laeuft') : t('strategien.status.pausiert') }}</Pille>
                <Pille :ton="instanz.mode === 'shadow' ? 'warn' : 'neutral'">{{ t('strategies.mode_' + instanz.mode) }}</Pille>
                <Pille ton="neutral">{{ strategie?.name || instanz.strategyId }}</Pille>
                <Pille ton="neutral">{{ (instanz.timeframes?.length ? instanz.timeframes : [instanz.timeframe]).join(' · ') }}</Pille>
                <Pille ton="neutral">v{{ instanz.paramsVersion }}</Pille>
                <span class="platz"></span>
                <Knopf v-if="!archiviert" klein :symbol="instanz.enabled ? 'pause' : 'play'" :art="instanz.enabled ? 'leise' : 'haupt'" @click="umschalten">
                    {{ instanz.enabled ? t('strategies.stop') : t('strategies.start') }}
                </Knopf>
            </div>

            <Hinweis v-if="archiviert" art="info">
                {{ t('strategien.ansicht.archivHinweis') }}
                <router-link v-if="instanz.nachfolger" :to="`/strategien/instanzen/${instanz.nachfolger}`">
                    {{ t('strategien.ansicht.zurKopie') }}
                </router-link>
            </Hinweis>
            <Hinweis v-if="instanz.lastError" art="warn"><Symbol name="warnung" /> {{ instanz.lastError }}</Hinweis>

            <Reiter v-model="reiter" :reiter="reiterListe" class="reiter" />

            <Ueberblick v-if="reiter === 'ueberblick'" :instanz="instanz" :perf="perf" :positionen="positionen"
                @zum-chart="zumChart" />
            <ChartReiter v-else-if="reiter === 'chart'" :instanz="instanz" :fokus="fokus" />
            <Signale v-else-if="reiter === 'signale'" :instanz="instanz" :positionen="positionen"
                @zum-chart="zumChart" @geaendert="geaendert" />
            <Auswertung v-else-if="reiter === 'auswertung'" :instanz="instanz" :perf="perf" />
            <Einstellungen v-else-if="reiter === 'einstellungen'" :instanz="instanz" :registry="registry"
                @geaendert="geaendert" @meldung="(m) => (meldung = m)" />
        </template>
    </div>
</template>

<style scoped>
.instanzAnsicht { display: flex; flex-direction: column; gap: 12px; }
.titel { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.titel .platz { flex: 1; }
.seitentitel { margin: 0; }
.reiter { margin-top: 4px; }
</style>
