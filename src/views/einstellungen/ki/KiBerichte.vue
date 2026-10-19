<script setup>
/** KI → Berichte: Anbieter/Modell, Prompt-Vorlage, Chat und Screenshots der KI-Berichte. */
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'

const { t } = useI18n()

const {
    aiBerichtModell, aiBerichtProvider, aiChatEnabled, aiModel, aiProvider, aiReportPrompt,
    aiReportPromptPreset, aiScreenshots, aiTestResult, modellListen, onPromptPresetChange,
    promptPresets, saveAiSettings,
} = useKiAnbieter()
</script>

<template>
    <div>
        <!-- Keine Überschrift: Der aktive Reiter darüber trägt
             denselben Namen, und zweimal dasselbe Wort untereinander
             erklärt nichts, was der Reiter nicht schon sagt. -->
        <p class="einleitung">{{ t('settings.ki.berichteHint') }}</p>

        <Feld :label="t('settings.ki.providerFor')" :hilfe="t('settings.ki.providerForHint')">
            <AnbieterWahl :provider="aiBerichtProvider" :modell="aiBerichtModell"
                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                @update:provider="w => { aiBerichtProvider = w; aiBerichtModell = ''; kiSpeichern('aiBerichtProvider', w); kiSpeichern('aiBerichtModell', '') }"
                @update:modell="w => { aiBerichtModell = w; kiSpeichern('aiBerichtModell', w) }" />
        </Feld>

        <!-- Bericht-Prompt -->
        <Feld :label="t('settings.reportStyle')" fuer="kiBerichtVorlage">
            <div class="stapel">
                <select id="kiBerichtVorlage" v-model="aiReportPromptPreset" @change="onPromptPresetChange">
                    <option v-for="p in promptPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
                </select>
                <textarea v-model="aiReportPrompt" rows="3" :placeholder="t('settings.reportPromptPlaceholder')"></textarea>
                <span class="leise">{{ t('settings.reportPromptHint') }}</span>
            </div>
        </Feld>

        <!-- Chat/Rückfragen -->
        <Feld :label="t('settings.reportChat')">
            <Schalter v-model="aiChatEnabled" :label="t('settings.enableChat')" :hilfe="t('settings.enableChatHint')" />
        </Feld>

        <!-- Screenshots: das Feld wurde gespeichert und gelesen, hatte
             aber seit Längerem gar kein Bedienelement mehr — der
             Schalter war unsichtbar auf seinem letzten Stand eingefroren. -->
        <Feld :label="t('settings.ki.screenshots')" :hilfe="t('settings.ki.screenshotsHint')">
            <Schalter v-model="aiScreenshots" :label="t('settings.ki.screenshotsLabel')" />
        </Feld>

        <div class="knoepfe">
            <Knopf art="haupt" @click="saveAiSettings">{{ t('common.save') }}</Knopf>
            <span v-if="aiTestResult" :class="aiTestResult.success ? 'gut' : 'schlecht'">
                {{ aiTestResult.message }}
            </span>
        </div>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
