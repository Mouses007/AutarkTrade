<script setup>
/** KI → Berichte: Anbieter/Modell, Prompt-Vorlage, Chat und Screenshots der KI-Berichte. */
import { useI18n } from 'vue-i18n'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
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
            <p class="fw-lighter">{{ t('settings.ki.berichteHint') }}</p>

            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.providerFor') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.providerForHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <AnbieterWahl :provider="aiBerichtProvider" :modell="aiBerichtModell"
                        :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                        @update:provider="w => { aiBerichtProvider = w; aiBerichtModell = ''; kiSpeichern('aiBerichtProvider', w); kiSpeichern('aiBerichtModell', '') }"
                        @update:modell="w => { aiBerichtModell = w; kiSpeichern('aiBerichtModell', w) }" />
                </div>
            </div>

            <!-- Bericht-Prompt -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">{{ t('settings.reportStyle') }}</div>
                <div class="col-12 col-md-8">
                    <select class="form-select mb-2" v-model="aiReportPromptPreset" @change="onPromptPresetChange">
                        <option v-for="p in promptPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
                    </select>
                    <textarea class="form-control" v-model="aiReportPrompt" rows="3" :placeholder="t('settings.reportPromptPlaceholder')"></textarea>
                    <small class="text-muted">{{ t('settings.reportPromptHint') }}</small>
                </div>
            </div>

            <!-- Chat/Rückfragen -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">{{ t('settings.reportChat') }}</div>
                <div class="col-12 col-md-8">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="aiChatToggle" v-model="aiChatEnabled">
                        <label class="form-check-label" for="aiChatToggle">{{ t('settings.enableChat') }}</label>
                    </div>
                    <small class="text-muted">{{ t('settings.enableChatHint') }}</small>
                </div>
            </div>

            <!-- Screenshots: das Feld wurde gespeichert und gelesen, hatte
                 aber seit Längerem gar kein Bedienelement mehr — der
                 Schalter war unsichtbar auf seinem letzten Stand eingefroren. -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.screenshots') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.screenshotsHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="aiScreenshotsToggle"
                            v-model="aiScreenshots">
                        <label class="form-check-label" for="aiScreenshotsToggle">
                            {{ t('settings.ki.screenshotsLabel') }}
                        </label>
                    </div>
                </div>
            </div>

            <div class="mt-3">
                <button type="button" @click="saveAiSettings" class="btn btn-success">{{ t('common.save') }}</button>
                <span v-if="aiTestResult" class="ms-2" :class="aiTestResult.success ? 'text-success' : 'text-danger'">
                    {{ aiTestResult.message }}
                </span>
            </div>
    </div>
</template>
