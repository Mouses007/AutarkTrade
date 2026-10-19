<script setup>
/** KI → Allgemein: Anbieter, Schlüssel, Modell, Guthaben-Vermerke, Grundschalter. */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ModelManager from '@/components/ModelManager.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { currentUser } from '@/stores/settings.js'
import { kiBereichWechseln } from '../gemeinsam/useKiBereich.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'
import { fluxApiKey, geminiImageApiKey, shareCardProvider } from '../gemeinsam/useShareCard.js'

const { t } = useI18n()

let kiExpanded = ref(true)   // eigener Unter-Reiter: offen starten

/* Fehlt der Wert, gilt die KI als an — wie bisher im Markup. */
const kiAn = computed(() => currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0)

const {
    aiKeys, aiMaxTokens, aiModel, aiOllamaUrl, aiProvider, aiTemperature, aiTestLoading, aiTestResult,
    aktuellerAnbieter, anbieterListe, anbieterName, anbieterUrl, bereichsNamen, getModelsForProvider,
    guthabenListe, guthabenZuruecksetzen, ladeGuthaben, modellOhneTemperatur, modelleGeaendert,
    ollamaModels, onProviderChange, saveAiSettings, testAiConnection, toggleAiEnabled, zeitpunkt,
} = useKiAnbieter()
</script>

<template>
    <div>
        <Abschnitt :titel="t('settings.kiAgent')" symbol="ki" v-model:offen="kiExpanded">
            <!-- KI aktivieren/deaktivieren -->
            <Schalter :model-value="kiAn" :label="t('settings.aiEnabled')" :hilfe="t('settings.aiEnabledHint')"
                @change="toggleAiEnabled" />

            <!-- S12: KI-Ausgaben geben nie Handelsempfehlungen, Kursziele oder
                 Prognosen; den früheren Schalter dafür gibt es nicht mehr. -->
            <p class="leise block abstand">{{ t('settings.ki.keineEmpfehlungen') }}</p>

            <div v-show="kiAn">
                <p class="einleitung abstand">{{ t('settings.kiDescription') }}</p>

                <!-- Anbieter -->
                <Feld :label="t('settings.provider')" fuer="kiAnbieter">
                    <select id="kiAnbieter" v-model="aiProvider" @change="onProviderChange">
                        <option v-for="a in anbieterListe" :key="a.id" :value="a.id">{{ anbieterName(a) }}</option>
                        <!-- Ein gespeicherter, nicht mehr angebotener Anbieter würde das
                             Feld sonst leer erscheinen lassen. -->
                        <option v-if="aiProvider && !aktuellerAnbieter" :value="aiProvider">
                            {{ aiProvider }} ({{ t('settings.providerRetired') }})
                        </option>
                    </select>
                    <!-- Pflichthinweis des Anbieters (Text aus server/ai-models.js `hinweis`). -->
                    <span v-if="aktuellerAnbieter?.hinweis" class="leise block">{{ t(aktuellerAnbieter.hinweis) }}</span>
                    <span v-else-if="aiProvider === 'minimax'" class="warnung block">{{ t('kiHinweis.anbieter.minimax') }}</span>
                </Feld>

                <!-- Ollama URL (nur bei Ollama) -->
                <Feld v-if="aiProvider === 'ollama'" :label="t('settings.ollamaUrl')" fuer="kiOllamaUrl">
                    <input id="kiOllamaUrl" type="text" v-model="aiOllamaUrl" placeholder="http://localhost:11434" />
                    <span class="leise block">{{ t('settings.ollamaUrlHint') }}</span>
                </Feld>

                <!-- Basis-URL: eigener Anbieter (Pflicht) und Qwen (Vorbelegung) -->
                <Feld v-if="aktuellerAnbieter?.urlSpalte" :label="t('settings.customUrl')" fuer="kiAnbieterUrl">
                    <input id="kiAnbieterUrl" type="text" v-model="anbieterUrl"
                        :placeholder="aiProvider === 'qwen'
                            ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
                            : 'https://api.groq.com/openai/v1'" />
                    <span class="leise block">
                        {{ aiProvider === 'qwen' ? t('settings.qwenUrlHint') : t('settings.customUrlHint') }}
                    </span>
                </Feld>

                <!-- Modell -->
                <Feld :label="t('settings.model')" fuer="kiModell">
                    <div class="stapel">
                        <select id="kiModell" v-model="aiModel">
                            <option v-for="m in getModelsForProvider()" :key="m" :value="m">{{ m }}</option>
                        </select>
                        <span v-if="aiProvider === 'ollama' && ollamaModels.length === 0" class="leise warn">
                            {{ t('settings.loadModelsHint') }}
                        </span>
                        <ModelManager :provider="aiProvider" :ollama-url="aiOllamaUrl" waehlbar
                            @geaendert="modelleGeaendert" />
                    </div>
                </Feld>

                <!-- API Key (nur bei Online-Providern) -->
                <Feld v-if="aiProvider !== 'ollama'" :label="t('settings.apiKeyLabel')"
                    :hilfe="t('settings.encryptedStored') + ' ' + t('settings.ki.keysHint')">
                    <!-- Alle Anbieter auf einmal statt nur der gerade gewählte.
                         Vorher hing das Feld am Anbieter-Auswahlfeld: Wer einen
                         zweiten Schlüssel eintragen wollte, musste dafür den
                         Anbieter umstellen — und beim Speichern wurde der
                         Hauptanbieter gleich mit umgestellt. Genau so ist hier
                         schon einmal versehentlich Perplexity zum Hauptanbieter
                         geworden. -->
                    <div class="liste">
                        <div v-for="a in anbieterListe.filter(x => x.brauchtKey !== false && x.id !== 'ollama')"
                            :key="a.id" class="liste-zeile">
                            <span class="liste-name">
                                {{ anbieterName(a) }}
                                <Pille v-if="a.id === aiProvider" ton="neutral">{{ t('settings.ki.mainProvider') }}</Pille>
                                <span v-if="a.hinweis && a.id !== 'ollama'" class="leise block klein">{{ t(a.hinweis) }}</span>
                            </span>
                            <span class="liste-mitte mit-knopf">
                                <input type="password" v-model="aiKeys[a.id]"
                                    :aria-label="t('settings.apiKeyLabel') + ' ' + anbieterName(a)"
                                    :placeholder="t('settings.apiKeyInputPlaceholder')"
                                    @focus="e => { if ((aiKeys[a.id] || '').includes('•')) e.target.select() }" />
                                <Knopf v-if="aiKeys[a.id]" art="leise" symbol="schliessen" nur-symbol klein
                                    :titel="t('settings.deleteKey')" @click="aiKeys[a.id] = ''" />
                            </span>
                            <span class="liste-ende konsole">
                                <a v-if="a.keyUrl" :href="'https://' + a.keyUrl" target="_blank"
                                    rel="noopener noreferrer" class="link">
                                    {{ t('settings.ki.console') }} <Symbol name="extern" />
                                </a>
                            </span>
                        </div>
                    </div>
                </Feld>

                <!-- Bild-Generierung: FLUX.2/Gemini-Bild sprechen kein Chat-Protokoll
                     und stehen deshalb nicht in `anbieterListe` oben — ohne diese Zeile
                     fiel FLUX komplett aus der KI-Übersicht. Schlüssel bleiben bewusst
                     nur im Bilder-Reiter editierbar (ein Ort pro Schlüssel), hier nur
                     Sichtbarkeit + Sprung dorthin. -->
                <Feld :label="t('settings.ki.imageProvidersTitle')" :hilfe="t('settings.ki.imageProvidersHint')">
                    <div class="liste">
                        <div class="liste-zeile">
                            <span class="liste-name">
                                FLUX.2 <span class="leise">(Black Forest Labs)</span>
                                <Pille v-if="shareCardProvider === 'flux'" ton="neutral">{{ t('settings.ki.mainProvider') }}</Pille>
                                <span class="leise block klein">{{ t('kiHinweis.anbieter.flux') }}</span>
                            </span>
                            <span class="liste-mitte">
                                <span v-if="fluxApiKey" class="gut klein">
                                    <Symbol name="haken" /> {{ t('settings.ki.keySet') }}
                                </span>
                                <span v-else class="leise">{{ t('settings.ki.keyMissing') }}</span>
                            </span>
                            <span class="liste-ende">
                                <button type="button" class="link" @click="kiBereichWechseln('bilder')">
                                    {{ t('kiUebersicht.einstellen') }}
                                </button>
                            </span>
                        </div>
                        <div class="liste-zeile">
                            <span class="liste-name">
                                Google Gemini <span class="leise">(Nano Banana)</span>
                                <Pille v-if="shareCardProvider === 'gemini'" ton="neutral">{{ t('settings.ki.mainProvider') }}</Pille>
                                <span class="leise block klein">{{ t('kiHinweis.anbieter.gemini') }}</span>
                            </span>
                            <span class="liste-mitte">
                                <span v-if="geminiImageApiKey" class="gut klein">
                                    <Symbol name="haken" /> {{ t('settings.ki.keySet') }}
                                </span>
                                <span v-else class="leise">{{ t('settings.ki.keyMissing') }}</span>
                            </span>
                            <span class="liste-ende">
                                <button type="button" class="link" @click="kiBereichWechseln('bilder')">
                                    {{ t('kiUebersicht.einstellen') }}
                                </button>
                            </span>
                        </div>
                    </div>
                </Feld>

                <!-- Guthaben-Status: kein Anbieter verrät sein Restguthaben über
                     den API-Key. Gezeigt wird, was der Server WEISS — scheiterte
                     ein Aufruf an fehlendem Guthaben, steht das hier, bis wieder
                     einer gelingt. Der Konsole-Link führt zum echten Kontostand. -->
                <Feld :label="t('settings.ki.quotaTitle')" :hilfe="t('settings.ki.quotaHint')">
                    <div class="stapel">
                        <div v-if="guthabenListe.length" class="liste">
                            <div v-for="g in guthabenListe.filter(x => x.keySet && x.id !== 'ollama')" :key="g.id"
                                class="liste-zeile">
                                <span class="liste-name">
                                    {{ anbieterName(g) }}
                                    <Pille v-if="g.aktiv" ton="neutral">{{ t('settings.ki.mainProvider') }}</Pille>
                                </span>
                                <span class="liste-mitte">
                                    <!-- Frischer Vermerk: rot. Ein Vermerk, den seit zwei
                                         Wochen niemand mehr bestätigt oder widerlegt hat,
                                         ist dagegen ein alter Stand und keine Warnung —
                                         der Anbieter wurde einfach nicht mehr angefragt. -->
                                    <span v-if="g.leer && !g.veraltet" class="schlecht" :title="g.meldung">
                                        <Symbol name="warnung" />
                                        {{ t('settings.ki.quotaEmpty') }}
                                        <small v-if="g.seit">{{ t('settings.ki.quotaSince', { zeit: zeitpunkt(g.seit) }) }}</small>
                                    </span>
                                    <span v-else-if="g.leer" class="leise" :title="g.meldung">
                                        <Symbol name="info" />
                                        {{ t('settings.ki.quotaStale') }}
                                        <small v-if="g.seit">{{ t('settings.ki.quotaStaleSince', { zeit: zeitpunkt(g.seit) }) }}</small>
                                    </span>
                                    <span v-else-if="g.okSeit" class="gut">
                                        <Symbol name="haken" />
                                        {{ t('settings.ki.quotaOk') }}
                                        <small class="leise">{{ t('settings.ki.quotaLast', { zeit: zeitpunkt(g.okSeit) }) }}</small>
                                    </span>
                                    <span v-else class="leise">{{ t('settings.ki.quotaNone') }}</span>
                                    <!-- Wen es trifft. Ohne diese Zeile nennt ein Vermerk
                                         nur einen Namen, und man sucht selbst zusammen,
                                         welche Funktion damit stillsteht. -->
                                    <span v-if="g.leer && g.bereiche?.length" class="leise block betrifft">
                                        {{ t('settings.ki.quotaAffects', { liste: bereichsNamen(g) }) }}
                                    </span>
                                </span>
                                <span class="liste-ende konsole">
                                    <Knopf v-if="g.leer" klein @click="guthabenZuruecksetzen(g.id)">
                                        {{ t('settings.ki.quotaReset') }}
                                    </Knopf>
                                    <a v-if="g.keyUrl" :href="'https://' + g.keyUrl" target="_blank"
                                        rel="noopener noreferrer" class="link">
                                        {{ t('settings.ki.console') }} <Symbol name="extern" />
                                    </a>
                                </span>
                            </div>
                        </div>
                        <span v-else class="leise">{{ t('settings.ki.noKeys') }}</span>
                        <div>
                            <Knopf klein symbol="aktualisieren" @click="ladeGuthaben">{{ t('settings.ki.refresh') }}</Knopf>
                        </div>
                    </div>
                </Feld>

                <!-- Temperatur -->
                <Feld :label="t('settings.creativity')" fuer="kiTemperatur">
                    <div class="reihe">
                        <input id="kiTemperatur" type="range" v-model="aiTemperature"
                            min="0" max="1" step="0.1" :disabled="modellOhneTemperatur" />
                        <Pille ton="neutral" class="temperatur">{{ aiTemperature }}</Pille>
                    </div>
                    <span v-if="modellOhneTemperatur" class="leise warn block">
                        {{ t('settings.temperatureIgnored', { model: aiModel }) }}
                    </span>
                    <span v-else class="leise block">{{ t('settings.creativityFactual') }}</span>
                </Feld>

                <!-- Max Tokens -->
                <Feld :label="t('settings.maxTextLength')" fuer="kiMaxTokens">
                    <input id="kiMaxTokens" type="number" class="mittel" v-model="aiMaxTokens" min="500" max="4000" step="100" />
                    <span class="leise block">{{ t('settings.maxTokensHint') }}</span>
                </Feld>

                <!-- Buttons -->
                <div class="knoepfe">
                    <Knopf art="haupt" @click="saveAiSettings">{{ t('common.save') }}</Knopf>
                    <Knopf :laedt="aiTestLoading" @click="testAiConnection">
                        {{ aiTestLoading ? t('common.testing') : t('common.testConnection') }}
                    </Knopf>
                    <span v-if="aiTestResult" :class="aiTestResult.success ? 'gut' : 'schlecht'">
                        {{ aiTestResult.message }}
                    </span>
                </div>
            </div><!-- /v-show aiEnabled -->
        </Abschnitt>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.abstand { margin-top: var(--abstand-3); }
.konsole { font-size: 0.85rem; }
.klein { font-size: 0.85rem; }
.warnung { color: var(--warn); }
.betrifft { font-size: 0.75rem; margin-top: 0.15rem; }
.temperatur { min-width: 2.75rem; justify-content: center; }
.link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0;
    background: none;
    border: 0;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    text-decoration: none;
    cursor: pointer;
}
.link:hover { color: var(--accent-hover); text-decoration: underline; }
</style>
