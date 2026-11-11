<script setup>
/**
 * Bot-Seite (/bots, /bots/:id): die Pionex-Bots mit allem, was die Börse
 * liefert, den Kennzahlen der App und dem Wissen über den Bot-Typ.
 * Nur lesend. Server: server/bots/routen.js.
 */
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Seitenkopf from '@/components/basis/Seitenkopf.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Reiter from '@/components/basis/Reiter.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Leerzustand from '@/components/basis/Leerzustand.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import BotKarte from '@/components/bots/BotKarte.vue'
import BotDetail from '@/components/bots/BotDetail.vue'
import { datum } from '@/components/bots/format.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const bots = ref([])
const stand = ref(null)
const laedt = ref(false)
const fehler = ref('')
const nichtEingerichtet = ref(false)
const wissen = ref(null)
const ansicht = ref('laufend')

async function lade(frisch = false) {
    laedt.value = true
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/bots', { params: frisch ? { frisch: 1 } : {} })
        nichtEingerichtet.value = !!data?.nichtEingerichtet
        bots.value = data?.bots || []
        stand.value = data?.stand || null
        if (!bots.value.some((b) => b.laufend) && ansicht.value === 'laufend') ansicht.value = 'beendet'
    } catch (e) {
        fehler.value = e?.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

async function ladeWissen() {
    try { wissen.value = (await axios.get('/api/bots/wissen')).data } catch { wissen.value = null }
}

onMounted(() => { lade(); ladeWissen() })

const laufende = computed(() => bots.value.filter((b) => b.laufend))
const beendete = computed(() => bots.value.filter((b) => !b.laufend).sort((a, b) => (b.beendet || 0) - (a.beendet || 0)))
const sichtbar = computed(() => ({ laufend: laufende.value, beendet: beendete.value, alle: bots.value }[ansicht.value] || []))
const reiter = computed(() => [
    { id: 'laufend', titel: t('bots.laufend'), zahl: laufende.value.length },
    { id: 'beendet', titel: t('bots.beendet'), zahl: beendete.value.length },
    { id: 'alle', titel: t('bots.alle'), zahl: bots.value.length },
])

const gewaehlt = computed(() => (route.params.id ? bots.value.find((b) => b.id === String(route.params.id)) : null))
const oeffnen = (id) => router.push(`/bots/${encodeURIComponent(id)}`)
</script>

<template>
    <div class="botsSeite">
        <Seitenkopf :titel="t('bots.titel')" :unter="stand ? t('bots.stand', { zeit: datum(stand) }) : t('bots.unter')">
            <template #aktionen>
                <Knopf v-if="route.params.id" art="leise" symbol="pfeilLinks" to="/bots">{{ t('bots.zurueck') }}</Knopf>
                <Knopf symbol="aktualisieren" :laedt="laedt" @click="lade(true)">{{ t('bots.aktualisieren') }}</Knopf>
            </template>
        </Seitenkopf>

        <Hinweis v-if="fehler" art="fehler" :titel="t('bots.fehler')">{{ fehler }}</Hinweis>
        <Leerzustand v-else-if="nichtEingerichtet" :titel="t('bots.nichtEingerichtet')" :text="t('bots.nichtEingerichtetText')">
            <Knopf art="haupt" to="/einstellungen/boersen">{{ t('nav.settings') }}</Knopf>
        </Leerzustand>

        <div v-else-if="laedt && !bots.length" class="mitte"><Kreisel :groesse="28" /> {{ t('bots.laden') }}</div>

        <template v-else-if="route.params.id">
            <BotDetail v-if="gewaehlt" :bot="gewaehlt" :wissen="wissen?.typen?.[gewaehlt.typ] || null" :wissen-stand="wissen?.stand || ''" />
            <Leerzustand v-else :titel="t('bots.keine')" />
        </template>

        <template v-else>
            <Reiter v-model="ansicht" :reiter="reiter" />
            <div v-if="sichtbar.length" class="liste">
                <BotKarte v-for="b in sichtbar" :key="b.id" :bot="b" @oeffnen="oeffnen" />
            </div>
            <Leerzustand v-else :titel="t('bots.keine')" />
            <p class="fuss">{{ t('bots.nurPionex') }}</p>
        </template>
    </div>
</template>

<style scoped>
.botsSeite { display: flex; flex-direction: column; gap: var(--abstand-3); }
.liste { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: var(--abstand-3); }
.mitte { display: flex; align-items: center; gap: var(--abstand-2); justify-content: center; padding: var(--abstand-5); color: var(--muted); }
.fuss { color: var(--muted); font-size: 0.8rem; margin: 0; }
</style>
