<script setup>
/**
 * Allgemein → Bedienung & Menü: Modi ein-/ausblenden, erweiterte Infos
 * und der Onboarding-Assistent. Alles speichert sofort. Die
 * Börsen-Verlinkung steht seit 29.10.2026 bei den Kacheln, die sie betrifft
 * (Chart & Analyse › Marktradar · Kacheln).
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Knopf } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { appEinstellungen } from '@/stores/settings.js'
import { merkeErweiterteInfos } from '@/composables/useErweiterteInfos.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import {
    modusLiveAn, modusResearchAn, modusStrategieAn, modusLernenAn, modusPortfolioAn, modusSpeichern,
} from '../gemeinsam/useModi.js'

const { t } = useI18n()
const router = useRouter()

const offen = ref(false)

const startseiteAn = ref(true)         // Startseite als Landing-Page + Modus-Tab
const erweiterteInfosAn = ref(true)    // kleines „i" an Werten und Bedienelementen

/**
 * Startseiten-Schalter speichern. Zusätzlich zum DB-Wert wird der Zustand nach
 * localStorage gespiegelt, damit der Root-Redirect (`/`) beim nächsten Start
 * synchron weiss, ob er auf die Startseite oder ins Journal leiten soll.
 */
async function startseiteSpeichern(an) {
    try {
        localStorage.setItem('startseiteAn', an ? '1' : '0')
    } catch (_) { /* privater Modus / kein localStorage */ }
    await kiSpeichern('startseiteAn', an ? 1 : 0)
}

/**
 * Erweiterte Infos speichern. Wie beim Startseiten-Schalter wird der Wert nach
 * localStorage gespiegelt: die Vorgabe ist „an", also blitzten bei jemandem,
 * der sie abgeschaltet hat, sonst alle Symbole kurz auf, bis die Einstellungen
 * geladen sind.
 */
async function erweiterteInfosSpeichern(an) {
    merkeErweiterteInfos(an)
    await kiSpeichern('erweiterteInfos', an ? 1 : 0)
}

/* Stand aus den Einstellungen — Einstellungen.vue hat sie vor dem Mount geladen. */
function ausEinstellungen() {
    const settings = appEinstellungen.value || {}
    erweiterteInfosAn.value = Number(settings.erweiterteInfos ?? 1) === 1
    startseiteAn.value = Number(settings.startseiteAn ?? 1) === 1
}
ausEinstellungen()
</script>

<template>
    <Abschnitt v-model:offen="offen" :titel="t('settings.bedienungMenue')" symbol="regler">

        <!-- Modi ein-/ausblenden. Journal fehlt bewusst: nicht abschaltbar. -->
        <h3 class="zwischentitel">{{ t('settings.modesTitle') }}</h3>
        <p class="hinweis">{{ t('settings.modesHint') }}</p>

        <Schalter v-model="startseiteAn" :label="t('modes.start')" info="settings.startpageOnHint"
            @change="startseiteSpeichern" />
        <Schalter v-model="modusLiveAn" :label="t('modes.live')" info="settings.modeLiveInfo"
            @change="(v) => modusSpeichern('modusLiveAn', v)" />
        <Schalter v-model="modusResearchAn" :label="t('modes.research')" info="settings.modeResearchInfo"
            @change="(v) => modusSpeichern('modusResearchAn', v)" />
        <Schalter v-model="modusStrategieAn" :label="t('modes.agent')" info="settings.modeStrategyInfo"
            @change="(v) => modusSpeichern('modusStrategieAn', v)" />
        <Schalter v-model="modusLernenAn" :label="t('modes.lernen')" info="settings.modeLernenInfo"
            @change="(v) => modusSpeichern('modusLernenAn', v)" />
        <Schalter v-model="modusPortfolioAn" :label="t('modes.portfolio') + ' (Beta)'" info="settings.modePortfolioInfo"
            @change="(v) => modusSpeichern('modusPortfolioAn', v)" />
        <p class="hinweis">{{ t('settings.modesJournalFix') }}</p>

        <!-- Erweiterte Infos: das kleine „i" an Werten und Bedienelementen -->
        <div class="block">
            <Schalter v-model="erweiterteInfosAn" :label="t('settings.erweiterteInfos')"
                info="settings.erweiterteInfosInfo" :hilfe="t('settings.erweiterteInfosHint')"
                @change="erweiterteInfosSpeichern" />
        </div>

        <!-- Manueller Wiederaufruf des Onboarding-Assistenten — unabhängig
             vom Versionsabgleich, z.B. um eine Nachrichtenquelle
             nachzutragen, die man beim ersten Mal übersprungen hat. -->
        <div class="block">
            <Knopf klein symbol="rakete"
                @click="router.push({ path: '/update-assistent', query: { kontext: 'manuell', rueckkehr: '/einstellungen/allgemein' } })">
                {{ t('onboarding.reopenButton') }}
            </Knopf>
        </div>
    </Abschnitt>
</template>

<style scoped>
.block {
    margin-top: var(--abstand-4);
}
.zwischentitel {
    margin: 0 0 0.2rem;
    font-size: 0.95rem;
    font-weight: 600;
}
.hinweis {
    margin: 0.2rem 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.82rem;
}
</style>
