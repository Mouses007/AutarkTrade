<script setup>
/** KI → Allgemein: Anbieter, Schlüssel, Modell, Guthaben-Vermerke, Grundschalter. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ModelManager from '@/components/ModelManager.vue'
import { currentUser } from '@/stores/settings.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { kiBereichWechseln } from '../gemeinsam/useKiBereich.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'
import { fluxApiKey, geminiImageApiKey, shareCardProvider } from '../gemeinsam/useShareCard.js'
import { kiEmpfehlungenAn } from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()

let kiExpanded = ref(true)   // eigener Unter-Reiter: offen starten

const {
    aiKeys, aiMaxTokens, aiModel, aiOllamaUrl, aiProvider, aiTemperature, aiTestLoading, aiTestResult,
    aktuellerAnbieter, anbieterListe, anbieterName, anbieterUrl, bereichsNamen, getModelsForProvider,
    guthabenListe, guthabenZuruecksetzen, ladeGuthaben, modellOhneTemperatur, modelleGeaendert,
    ollamaModels, onProviderChange, saveAiSettings, testAiConnection, toggleAiEnabled, zeitpunkt,
} = useKiAnbieter()
</script>

<template>
    <div>
        <div class="d-flex align-items-center pointerClass" @click="kiExpanded = !kiExpanded">
            <i class="uil me-2" :class="kiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.kiAgent') }}</p>
        </div>
        <div v-show="kiExpanded" class="mt-2 ms-3">
            <!-- KI aktivieren/deaktivieren -->
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="aiEnabledToggle"
                    :checked="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0"
                    @change="toggleAiEnabled($event.target.checked)">
                <label class="form-check-label" for="aiEnabledToggle">{{ t('settings.aiEnabled') }}</label>
            </div>
            <small class="text-muted d-block mb-3">{{ t('settings.aiEnabledHint') }}</small>

            <!-- Handelsempfehlungen, Kursziele, Prognosen.
                 Steht hier und nicht bei „Nachrichten", weil er ALLE
                 KI-Ausgaben betrifft: Lagebericht, Gesamtlage-Kachel
                 und Handelslage-Kachel im Live-Trading-Fenster. Vorgabe
                 aus — das ist der Stand, den jeder Bestand hatte. -->
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="kiEmpfehlungenAn"
                    v-model="kiEmpfehlungenAn" @change="kiSpeichern('kiEmpfehlungenAn', kiEmpfehlungenAn ? 1 : 0)">
                <label class="form-check-label" for="kiEmpfehlungenAn">
                    {{ t('settings.ki.empfehlungenAn') }}
                </label>
            </div>
            <small class="text-muted d-block mb-3">{{ t('settings.ki.empfehlungenHint') }}</small>
            <small v-if="kiEmpfehlungenAn" class="d-block text-warning mb-3">
                {{ t('settings.ki.empfehlungenWarnung') }}
            </small>

            <div v-show="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0">
            <p class="fw-lighter">{{ t('settings.kiDescription') }}</p>

            <!-- Anbieter -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.provider') }}</div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model="aiProvider" @change="onProviderChange">
                        <option v-for="a in anbieterListe" :key="a.id" :value="a.id">{{ anbieterName(a) }}</option>
                        <!-- Ein gespeicherter, nicht mehr angebotener Anbieter würde das
                             Feld sonst leer erscheinen lassen. -->
                        <option v-if="aiProvider && !aktuellerAnbieter" :value="aiProvider">
                            {{ aiProvider }} ({{ t('settings.providerRetired') }})
                        </option>
                    </select>
                </div>
            </div>

            <!-- Ollama URL (nur bei Ollama) -->
            <div v-if="aiProvider === 'ollama'" class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.ollamaUrl') }}</div>
                <div class="col-12 col-md-8">
                    <input type="text" class="form-control" v-model="aiOllamaUrl" placeholder="http://localhost:11434" />
                    <small class="text-muted">{{ t('settings.ollamaUrlHint') }}</small>
                </div>
            </div>

            <!-- Basis-URL: eigener Anbieter (Pflicht) und Qwen (Vorbelegung) -->
            <div v-if="aktuellerAnbieter?.urlSpalte" class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.customUrl') }}</div>
                <div class="col-12 col-md-8">
                    <input type="text" class="form-control" v-model="anbieterUrl"
                        :placeholder="aiProvider === 'qwen'
                            ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
                            : 'https://api.groq.com/openai/v1'" />
                    <small class="text-muted">
                        {{ aiProvider === 'qwen' ? t('settings.qwenUrlHint') : t('settings.customUrlHint') }}
                    </small>
                </div>
            </div>

            <!-- Modell -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.model') }}</div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model="aiModel">
                        <option v-for="m in getModelsForProvider()" :key="m" :value="m">{{ m }}</option>
                    </select>
                    <small v-if="aiProvider === 'ollama' && ollamaModels.length === 0" class="text-warning">
                        {{ t('settings.loadModelsHint') }}
                    </small>
                    <ModelManager :provider="aiProvider" :ollama-url="aiOllamaUrl" waehlbar
                        @geaendert="modelleGeaendert" />
                </div>
            </div>

            <!-- API Key (nur bei Online-Providern) -->
            <div v-if="aiProvider !== 'ollama'" class="row mt-2">
                <div class="col-12 col-md-4">
                    {{ t('settings.apiKeyLabel') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                        {{ t('settings.ki.keysHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <!-- Alle Anbieter auf einmal statt nur der gerade gewählte.
                         Vorher hing das Feld am Anbieter-Auswahlfeld: Wer einen
                         zweiten Schlüssel eintragen wollte, musste dafür den
                         Anbieter umstellen — und beim Speichern wurde der
                         Hauptanbieter gleich mit umgestellt. Genau so ist hier
                         schon einmal versehentlich Perplexity zum Hauptanbieter
                         geworden. -->
                    <table class="table table-sm align-middle mb-1">
                        <tbody>
                            <tr v-for="a in anbieterListe.filter(x => x.brauchtKey !== false && x.id !== 'ollama')"
                                :key="a.id">
                                <td style="width:11rem;">
                                    {{ anbieterName(a) }}
                                    <span v-if="a.id === aiProvider" class="badge bg-secondary ms-1">
                                        {{ t('settings.ki.mainProvider') }}
                                    </span>
                                </td>
                                <td>
                                    <div class="input-group input-group-sm">
                                        <input type="password" class="form-control" v-model="aiKeys[a.id]"
                                            :placeholder="t('settings.apiKeyInputPlaceholder')"
                                            @focus="e => { if ((aiKeys[a.id] || '').includes('•')) e.target.select() }" />
                                        <button v-if="aiKeys[a.id]" class="btn btn-outline-secondary" type="button"
                                            @click="aiKeys[a.id] = ''" :title="t('settings.deleteKey')">
                                            <i class="uil uil-times"></i>
                                        </button>
                                    </div>
                                </td>
                                <td class="text-end" style="width:8rem;">
                                    <a v-if="a.keyUrl" :href="'https://' + a.keyUrl" target="_blank"
                                        rel="noopener noreferrer" class="small">
                                        {{ t('settings.ki.console') }} <i class="uil uil-external-link-alt"></i>
                                    </a>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Bild-Generierung: FLUX.2/Gemini-Bild sprechen kein Chat-Protokoll
                 und stehen deshalb nicht in `anbieterListe` oben — ohne diese Zeile
                 fiel FLUX komplett aus der KI-Übersicht. Schlüssel bleiben bewusst
                 nur im Bilder-Reiter editierbar (ein Ort pro Schlüssel), hier nur
                 Sichtbarkeit + Sprung dorthin. -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.imageProvidersTitle') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.imageProvidersHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <table class="table table-sm align-middle mb-1">
                        <tbody>
                            <tr>
                                <td style="width:11rem;">
                                    FLUX.2 <small class="text-muted">(Black Forest Labs)</small>
                                    <span v-if="shareCardProvider === 'flux'" class="badge bg-secondary ms-1">
                                        {{ t('settings.ki.mainProvider') }}
                                    </span>
                                </td>
                                <td>
                                    <span v-if="fluxApiKey" class="text-success small">
                                        <i class="uil uil-check-circle"></i> {{ t('settings.ki.keySet') }}
                                    </span>
                                    <span v-else class="text-muted small">{{ t('settings.ki.keyMissing') }}</span>
                                </td>
                                <td class="text-end" style="width:8rem;">
                                    <a href="#" class="small" @click.prevent="kiBereichWechseln('bilder')">
                                        {{ t('kiUebersicht.einstellen') }}
                                    </a>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    Google Gemini <small class="text-muted">(Nano Banana)</small>
                                    <span v-if="shareCardProvider === 'gemini'" class="badge bg-secondary ms-1">
                                        {{ t('settings.ki.mainProvider') }}
                                    </span>
                                </td>
                                <td>
                                    <span v-if="geminiImageApiKey" class="text-success small">
                                        <i class="uil uil-check-circle"></i> {{ t('settings.ki.keySet') }}
                                    </span>
                                    <span v-else class="text-muted small">{{ t('settings.ki.keyMissing') }}</span>
                                </td>
                                <td class="text-end">
                                    <a href="#" class="small" @click.prevent="kiBereichWechseln('bilder')">
                                        {{ t('kiUebersicht.einstellen') }}
                                    </a>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Guthaben-Status: kein Anbieter verrät sein Restguthaben über
                 den API-Key. Gezeigt wird, was der Server WEISS — scheiterte
                 ein Aufruf an fehlendem Guthaben, steht das hier, bis wieder
                 einer gelingt. Der Konsole-Link führt zum echten Kontostand. -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">
                    {{ t('settings.ki.quotaTitle') }}
                    <small class="d-block text-muted" style="font-size:0.78rem;">
                        {{ t('settings.ki.quotaHint') }}
                    </small>
                </div>
                <div class="col-12 col-md-8">
                    <table v-if="guthabenListe.length" class="table table-sm align-middle mb-1">
                        <tbody>
                            <tr v-for="g in guthabenListe.filter(x => x.keySet && x.id !== 'ollama')" :key="g.id">
                                <td>
                                    {{ anbieterName(g) }}
                                    <span v-if="g.aktiv" class="badge bg-secondary ms-1">
                                        {{ t('settings.ki.mainProvider') }}
                                    </span>
                                </td>
                                <td>
                                    <!-- Frischer Vermerk: rot. Ein Vermerk, den seit zwei
                                         Wochen niemand mehr bestätigt oder widerlegt hat,
                                         ist dagegen ein alter Stand und keine Warnung —
                                         der Anbieter wurde einfach nicht mehr angefragt. -->
                                    <span v-if="g.leer && !g.veraltet" class="text-danger" :title="g.meldung">
                                        <i class="uil uil-exclamation-triangle"></i>
                                        {{ t('settings.ki.quotaEmpty') }}
                                        <small v-if="g.seit">{{ t('settings.ki.quotaSince', { zeit: zeitpunkt(g.seit) }) }}</small>
                                    </span>
                                    <span v-else-if="g.leer" class="text-muted" :title="g.meldung">
                                        <i class="uil uil-info-circle"></i>
                                        {{ t('settings.ki.quotaStale') }}
                                        <small v-if="g.seit">{{ t('settings.ki.quotaStaleSince', { zeit: zeitpunkt(g.seit) }) }}</small>
                                    </span>
                                    <span v-else-if="g.okSeit" class="text-success">
                                        <i class="uil uil-check-circle"></i>
                                        {{ t('settings.ki.quotaOk') }}
                                        <small class="text-muted">{{ t('settings.ki.quotaLast', { zeit: zeitpunkt(g.okSeit) }) }}</small>
                                    </span>
                                    <span v-else class="text-muted">{{ t('settings.ki.quotaNone') }}</span>
                                    <!-- Wen es trifft. Ohne diese Zeile nennt ein Vermerk
                                         nur einen Namen, und man sucht selbst zusammen,
                                         welche Funktion damit stillsteht. -->
                                    <small v-if="g.leer && g.bereiche?.length" class="d-block text-muted"
                                        style="font-size:0.72rem;">
                                        {{ t('settings.ki.quotaAffects', { liste: bereichsNamen(g) }) }}
                                    </small>
                                </td>
                                <td class="text-end">
                                    <button v-if="g.leer" class="btn btn-outline-secondary btn-sm me-2"
                                        @click="guthabenZuruecksetzen(g.id)">
                                        {{ t('settings.ki.quotaReset') }}
                                    </button>
                                    <a v-if="g.keyUrl" :href="'https://' + g.keyUrl" target="_blank"
                                        rel="noopener noreferrer" class="small">
                                        {{ t('settings.ki.console') }} <i class="uil uil-external-link-alt"></i>
                                    </a>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <span v-else class="small text-muted">{{ t('settings.ki.noKeys') }}</span>
                    <button class="btn btn-outline-secondary btn-sm" @click="ladeGuthaben">
                        <i class="uil uil-sync"></i> {{ t('settings.ki.refresh') }}
                    </button>
                </div>
            </div>

            <!-- Temperatur -->
            <div class="row mt-3">
                <div class="col-12 col-md-4">{{ t('settings.creativity') }}</div>
                <div class="col-12 col-md-8">
                    <div class="d-flex align-items-center gap-2">
                        <input type="range" class="form-range flex-grow-1" v-model="aiTemperature"
                            min="0" max="1" step="0.1" :disabled="modellOhneTemperatur" />
                        <span class="badge bg-secondary" style="min-width: 40px;">{{ aiTemperature }}</span>
                    </div>
                    <small v-if="modellOhneTemperatur" class="text-warning">
                        {{ t('settings.temperatureIgnored', { model: aiModel }) }}
                    </small>
                    <small v-else class="text-muted">{{ t('settings.creativityFactual') }}</small>
                </div>
            </div>

            <!-- Max Tokens -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.maxTextLength') }}</div>
                <div class="col-12 col-md-8">
                    <input type="number" class="form-control" v-model="aiMaxTokens" min="500" max="4000" step="100" />
                    <small class="text-muted">{{ t('settings.maxTokensHint') }}</small>
                </div>
            </div>

            <!-- Buttons -->
            <div class="mt-3 mb-3">
                <button type="button" @click="saveAiSettings" class="btn btn-success me-2">{{ t('common.save') }}</button>
                <button type="button" @click="testAiConnection" class="btn btn-outline-primary" :disabled="aiTestLoading">
                    <span v-if="aiTestLoading">
                        <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                    </span>
                    <span v-else>{{ t('common.testConnection') }}</span>
                </button>
                <span v-if="aiTestResult" class="ms-2" :class="aiTestResult.success ? 'text-success' : 'text-danger'">
                    {{ aiTestResult.message }}
                </span>
            </div>
            </div><!-- /v-show aiEnabled -->
        </div>
    </div>
</template>
