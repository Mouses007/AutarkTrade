<script setup>
/**
 * Einstellungen einer Instanz: Parameter, Risiko, Veto — dazu die Versionen
 * mit dem, was jede gebracht hat, die Vorschläge des KI-Coachs (sie gehören zu
 * genau dieser Instanz, bis 01.11.2026 standen sie im Labor) und die Aktionen.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InstanzFormular from '../InstanzFormular.vue'
import { rText, prozent, tonVon } from '../../../utils/strategien/format.js'
import { apiFehlerText } from '../../../utils/apiError.js'
import { Knopf, Pille, Hinweis, Kreisel, Symbol } from '../../basis'

const props = defineProps({
    instanz: { type: Object, required: true },
    registry: { type: Object, required: true },
})
const emit = defineEmits(['geaendert', 'meldung'])
const { t } = useI18n()
const router = useRouter()

const archiviert = computed(() => Number(props.instanz.archiviert) === 1)
const entwurf = ref(JSON.parse(JSON.stringify(props.instanz)))
const speichern = ref(false)
const fehler = ref('')

async function sichern() {
    speichern.value = true
    fehler.value = ''
    try {
        const { data } = await axios.put(`/api/strategies/instances/${props.instanz.id}`, entwurf.value)
        emit('meldung', data.hinweise?.length
            ? t('strategies.clamped', { keys: data.hinweise.join(', ') })
            : data.paramsVersionErhoeht ? t('strategies.newParamsVersion', { v: data.paramsVersion }) : t('strategies.saved'))
        emit('geaendert')
        await versionenLaden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichern.value = false
    }
}

// ── Versionen: was wurde wann geändert, und was hat es gebracht ─────────
const versionen = ref(null)
function parameterDiff(alt, neu) {
    const aus = []
    for (const [bereich, a, b] of [['', alt.params, neu.params], ['risk.', alt.risk, neu.risk]]) {
        for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
            if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) aus.push({ key: bereich + k, alt: a?.[k] ?? '–', neu: b?.[k] ?? '–' })
        }
    }
    return aus
}
async function versionenLaden() {
    try {
        const { data } = await axios.get(`/api/strategies/instances/${props.instanz.id}/history`)
        for (let i = 0; i < data.length; i++) data[i].diff = data[i + 1] ? parameterDiff(data[i + 1], data[i]) : []
        versionen.value = data
    } catch { versionen.value = [] }
}
const quelleText = (q) => {
    if (q === 'angelegt') return t('strategies.historySourceCreated')
    if (q === 'manuell') return t('strategies.historySourceManual')
    if (q === 'bestand') return t('strategies.historySourceBackfill')
    if (String(q).startsWith('vorschlag')) return t('strategies.historySourceSuggestion') + ' ' + String(q).replace('vorschlag ', '')
    return q
}

// ── Vorschläge des KI-Coachs ─────────────────────────────────────────────
const vorschlaege = ref([])
async function vorschlaegeLaden() {
    try {
        const { data } = await axios.get('/api/strategies/suggestions', { params: { instanceId: props.instanz.id, status: 'pending' } })
        vorschlaege.value = data
    } catch { vorschlaege.value = [] }
}
async function entscheiden(v, was) {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/suggestions/${v.id}/${was}`)
        await vorschlaegeLaden()
        emit('geaendert')
        if (was === 'accept') {
            entwurf.value = JSON.parse(JSON.stringify((await axios.get(`/api/strategies/instances/${props.instanz.id}`)).data))
            await versionenLaden()
        }
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

onMounted(() => { versionenLaden(); vorschlaegeLaden() })

// ── Aktionen ─────────────────────────────────────────────────────────────
function imLabor() { router.push({ path: '/strategien/labor/test', query: { instanz: props.instanz.id } }) }
function kiCoach() {
    router.push({ path: '/ki-coach', query: { agentPrompt: t('strategies.optimizePrompt', { name: props.instanz.name, id: props.instanz.id }) } })
}
const frage = ref('')     // '' | 'neustart' | 'loeschen'
async function neuStarten() {
    try {
        const { data } = await axios.post(`/api/strategies/instances/${props.instanz.id}/neustart`)
        emit('geaendert')
        router.push(`/strategien/instanzen/${data.neuId}`)
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategien.einstellungen.neustartFehler'), t)
    }
}
async function loeschen() {
    try {
        await axios.delete(`/api/strategies/instances/${props.instanz.id}`)
        emit('geaendert')
        router.push('/strategien/instanzen')
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}
</script>

<template>
    <div class="einstellungen">
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <div v-if="vorschlaege.length" class="journalKarte karte">
            <div class="abschnittTitel"><Symbol name="idee" /> {{ t('strategies.suggestions') }}</div>
            <p class="at-gedaempft">{{ t('strategies.suggestionsHint') }}</p>
            <div v-for="v in vorschlaege" :key="v.id" class="vorschlag">
                <strong>{{ v.title }}</strong>
                <p class="at-gedaempft" :data-ki-generiert="v.source === 'agent' ? 'true' : null">{{ v.rationale }}</p>
                <div class="pillen">
                    <Pille v-for="(wert, key) in v.proposedParams" :key="key" ton="neutral">{{ key }}: {{ entwurf.params?.[key] ?? '–' }} → {{ wert }}</Pille>
                </div>
                <div class="knopfzeile">
                    <Knopf art="haupt" klein :disabled="archiviert" @click="entscheiden(v, 'accept')">{{ t('strategies.acceptSuggestion') }}</Knopf>
                    <Knopf klein @click="entscheiden(v, 'reject')">{{ t('strategies.rejectSuggestion') }}</Knopf>
                </div>
            </div>
        </div>

        <div class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategien.reiter.einstellungen') }}</div>
            <Hinweis v-if="archiviert" art="info">{{ t('strategien.einstellungen.archivNurLesen') }}</Hinweis>
            <fieldset :disabled="archiviert" class="rahmenlos">
                <InstanzFormular v-model="entwurf" :registry="registry" />
            </fieldset>
            <div v-if="!archiviert" class="knopfzeile abstand">
                <Knopf art="haupt" klein symbol="speichern" :disabled="speichern" @click="sichern">{{ t('common.save') }}</Knopf>
                <small class="at-gedaempft">{{ t('strategien.einstellungen.versionHinweis') }}</small>
            </div>
        </div>

        <div class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategien.einstellungen.versionen') }}</div>
            <Kreisel v-if="!versionen" />
            <p v-else-if="!versionen.length" class="at-gedaempft">{{ t('strategies.historyEmpty') }}</p>
            <div v-for="z in versionen || []" :key="z.paramsVersion" class="version">
                <div class="zeile">
                    <Pille :ton="z.paramsVersion === instanz.paramsVersion ? 'akzent' : 'neutral'">v{{ z.paramsVersion }}</Pille>
                    <small class="at-gedaempft">{{ new Date(z.createdAt).toLocaleString() }} · {{ quelleText(z.source) }}</small>
                    <span class="platz"></span>
                    <small>{{ z.trades }} {{ t('strategies.trades') }}</small>
                    <small v-if="z.trades" :class="tonVon(z.summeR)">{{ rText(z.summeR) }}</small>
                    <small v-if="z.trades" class="at-gedaempft">{{ prozent(z.winRate) }}</small>
                </div>
                <div v-if="z.diff?.length" class="pillen">
                    <span v-for="d in z.diff" :key="d.key" class="diff">{{ d.key }}: {{ d.alt }} → {{ d.neu }}</span>
                </div>
            </div>
        </div>

        <div class="journalKarte karte">
            <div class="abschnittTitel">{{ t('strategien.einstellungen.aktionen') }}</div>
            <div class="knopfzeile">
                <Knopf klein symbol="test" @click="imLabor">{{ t('strategien.einstellungen.imLabor') }}</Knopf>
                <Knopf klein symbol="ki" @click="kiCoach">{{ t('strategies.aiOptimize') }}</Knopf>
                <Knopf v-if="!archiviert" klein symbol="aktualisieren" @click="frage = 'neustart'">{{ t('strategien.einstellungen.neustart') }}</Knopf>
                <Knopf art="gefahr" klein symbol="muell" @click="frage = 'loeschen'">{{ t('common.delete') }}</Knopf>
            </div>
            <div v-if="frage === 'neustart'" class="frage">
                <p>{{ t('strategien.einstellungen.neustartFrage') }}</p>
                <div class="knopfzeile">
                    <Knopf art="haupt" klein @click="neuStarten">{{ t('strategien.einstellungen.neustart') }}</Knopf>
                    <Knopf art="leise" klein @click="frage = ''">{{ t('common.cancel') }}</Knopf>
                </div>
            </div>
            <div v-if="frage === 'loeschen'" class="frage">
                <p>{{ t('strategien.einstellungen.loeschFrage', { n: instanz.totalTrades }) }}</p>
                <div class="knopfzeile">
                    <Knopf art="gefahr" klein @click="loeschen">{{ t('common.delete') }}</Knopf>
                    <Knopf art="leise" klein @click="frage = ''">{{ t('common.cancel') }}</Knopf>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.einstellungen { display: flex; flex-direction: column; gap: 12px; }
.abschnittTitel { font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.knopfzeile { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.abstand { margin-top: 12px; }
.rahmenlos { border: 0; padding: 0; margin: 0; min-width: 0; }
.vorschlag { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.pillen { display: flex; flex-wrap: wrap; gap: 6px; }
.version { border-top: 1px solid var(--line); padding: 8px 0; }
.zeile { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.zeile .platz { flex: 1; }
.diff { font-size: 0.8rem; background: var(--panel-soft); border-radius: 6px; padding: 2px 6px; }
.frage { margin-top: 10px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-knopf); }
</style>
