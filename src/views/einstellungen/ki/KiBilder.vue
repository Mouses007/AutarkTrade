<script setup>
/** KI → Bilder: Share-Karten (FLUX.2 + Gemini) und ihre Prompt-Vorlagen. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import ModelManager from '@/components/ModelManager.vue'
import { useVorlagenKategorieLabel } from '@/utils/formatters.js'
import { useShareCard } from '../gemeinsam/useShareCard.js'

const { t } = useI18n()

let fluxExpanded = ref(true) // eigener Unter-Reiter: offen starten

const {
    cancelEditTemplate, deleteShareCardTemplate, deletingTemplateId, editTemplateName, editingTemplateId,
    fluxApiKey, fluxAvatar, fluxDisplayName, fluxModel, fluxModelleGeaendert, fluxModels, fluxTestLoading,
    fluxTestResult, fluxUseCustomAvatar, geminiBildModelleGeaendert, geminiImageApiKey, geminiImageModel,
    geminiImageModels, geminiTestLoading, geminiTestResult, onFluxAvatarUpload, saveFluxSettings,
    saveTemplateEdit, savingTemplateEdit, shareCardProvider, shareCardTemplates, startEditTemplate,
    templatesLoading, testFluxConnection, testGeminiConnection,
} = useShareCard()
</script>

<template>
    <div>
        <hr />

        <!--=============== SHARE CARDS (FLUX.2 + Gemini) ===============-->
        <div class="d-flex align-items-center pointerClass" @click="fluxExpanded = !fluxExpanded">
            <i class="uil me-2" :class="fluxExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.shareCardsTitle') }}</p>
        </div>
        <div v-show="fluxExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.shareCardsDescription') }}</p>

            <!-- Provider Selection -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.imageProviderLabel') }}</div>
                <div class="col-12 col-md-8">
                    <div class="d-flex gap-4">
                        <div class="form-check">
                            <input class="form-check-input" type="radio" id="provFlux" value="flux" v-model="shareCardProvider" />
                            <label class="form-check-label" for="provFlux">FLUX.2 <small class="text-muted">(Black Forest Labs)</small></label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" id="provGemini" value="gemini" v-model="shareCardProvider" />
                            <label class="form-check-label" for="provGemini">Google Gemini <small class="text-muted">(Nano Banana)</small></label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- FLUX-specific settings -->
            <div v-show="shareCardProvider === 'flux'">
                <div class="row mt-3">
                    <div class="col-12 col-md-4">{{ t('settings.fluxApiKey') }}</div>
                    <div class="col-12 col-md-8">
                        <div class="input-group">
                            <input type="password" class="form-control" v-model="fluxApiKey" placeholder="bfl-..."
                                   @focus="e => { if (fluxApiKey.includes('•')) e.target.select() }" />
                            <button v-if="fluxApiKey" class="btn btn-outline-secondary" type="button"
                                    @click="fluxApiKey = ''">
                                <i class="uil uil-times"></i>
                            </button>
                        </div>
                        <small class="text-muted">
                            <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                            — <a href="https://api.bfl.ai" target="_blank" rel="noopener" class="text-info">api.bfl.ai</a>
                        </small>
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.fluxModel') }}<InfoTipp schluessel="settings.info.fluxModel" /></div>
                    <div class="col-12 col-md-8">
                        <select class="form-select" v-model="fluxModel">
                            <option v-for="m in fluxModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                        <ModelManager provider="flux" @geaendert="fluxModelleGeaendert" />
                    </div>
                </div>
            </div>

            <!-- Gemini-specific settings -->
            <div v-show="shareCardProvider === 'gemini'">
                <div class="row mt-3">
                    <div class="col-12 col-md-4">{{ t('settings.geminiApiKeyLabel') }}</div>
                    <div class="col-12 col-md-8">
                        <div class="input-group">
                            <input type="password" class="form-control" v-model="geminiImageApiKey" placeholder="AIza..."
                                   @focus="e => { if (geminiImageApiKey.includes('•')) e.target.select() }" />
                            <button v-if="geminiImageApiKey" class="btn btn-outline-secondary" type="button"
                                    @click="geminiImageApiKey = ''">
                                <i class="uil uil-times"></i>
                            </button>
                        </div>
                        <small class="text-muted">
                            <i class="uil uil-lock me-1"></i>{{ t('settings.encryptedStored') }}
                            — <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="text-info">aistudio.google.com</a>
                        </small>
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.geminiModelLabel') }}<InfoTipp schluessel="settings.info.geminiImageModel" /></div>
                    <div class="col-12 col-md-8">
                        <select class="form-select" v-model="geminiImageModel">
                            <option v-for="m in geminiImageModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                        <ModelManager provider="geminiBild" @geaendert="geminiBildModelleGeaendert" />
                    </div>
                </div>
            </div>

            <!-- Shared settings (always visible) -->
            <hr class="my-3" />

            <!-- Display Name -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.fluxDisplayName') }}</div>
                <div class="col-12 col-md-8">
                    <input type="text" class="form-control" v-model="fluxDisplayName" :placeholder="t('settings.usernamePlaceholder')" />
                    <small class="text-muted">{{ t('settings.fluxDisplayNameHint') }}</small>
                </div>
            </div>

            <!-- Avatar -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.fluxAvatar') }}</div>
                <div class="col-12 col-md-8">
                    <div class="form-check">
                        <input type="checkbox" class="form-check-input" id="fluxUseCustomAvatarCheck" v-model="fluxUseCustomAvatar" />
                        <label class="form-check-label" for="fluxUseCustomAvatarCheck">{{ t('settings.fluxUseCustomAvatar') }}</label>
                    </div>
                    <div v-if="fluxUseCustomAvatar" class="mt-2">
                        <div class="d-flex align-items-center gap-2">
                            <img v-if="fluxAvatar" :src="fluxAvatar" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                            <input type="file" class="form-control form-control-sm" accept="image/*" @change="onFluxAvatarUpload" />
                            <button v-if="fluxAvatar" class="btn btn-outline-secondary btn-sm" @click="fluxAvatar = ''">
                                <i class="uil uil-times"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Buttons -->
            <div class="mt-3 mb-3">
                <button type="button" @click="saveFluxSettings" class="btn btn-success me-2">{{ t('common.save') }}</button>
                <button v-if="shareCardProvider === 'flux'" type="button" @click="testFluxConnection" class="btn btn-outline-primary" :disabled="fluxTestLoading">
                    <span v-if="fluxTestLoading">
                        <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                    </span>
                    <span v-else>{{ t('common.testConnection') }}</span>
                </button>
                <button v-if="shareCardProvider === 'gemini'" type="button" @click="testGeminiConnection" class="btn btn-outline-primary" :disabled="geminiTestLoading">
                    <span v-if="geminiTestLoading">
                        <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                    </span>
                    <span v-else>{{ t('common.testConnection') }}</span>
                </button>
                <span v-if="shareCardProvider === 'flux' && fluxTestResult" class="ms-2" :class="fluxTestResult.success ? 'text-success' : 'text-danger'">
                    {{ fluxTestResult.message }}
                </span>
                <span v-if="shareCardProvider === 'gemini' && geminiTestResult" class="ms-2" :class="geminiTestResult.success ? 'text-success' : 'text-danger'">
                    {{ geminiTestResult.message }}
                </span>
            </div>

            <!-- Prompt-Vorlagen: anlegen/anwenden geschieht im Trade-Modal
                 (ShareCardModal.vue) beim Erzeugen einer Share-Karte;
                 hier — zentral in den Einstellungen — lassen sie sich
                 benennen, der Prompt-Text bearbeiten und löschen. -->
            <hr class="my-3" />
            <p class="fs-6 fw-bold mb-1">{{ t('settings.shareCardTemplatesTitle') }}</p>
            <p class="fw-lighter">{{ t('settings.shareCardTemplatesHint') }}</p>
            <div v-if="templatesLoading" class="text-muted small">{{ t('common.loading') }}</div>
            <div v-else-if="!shareCardTemplates.length" class="text-muted small">
                {{ t('settings.shareCardTemplatesEmpty') }}
            </div>
            <!-- Bootstraps `.list-group-item` legt eine eigene (helle-Theme-)
                 Textfarbe fest, die die geerbte `body`-Farbe überstimmt — auf
                 dunklem Grund praktisch unlesbar. Deshalb einfache divs statt
                 `list-group`, Farbe kommt von den App-eigenen CSS-Variablen. -->
            <div v-else class="shareCardVorlagen">
                <div v-for="tpl in shareCardTemplates" :key="tpl.id" class="shareCardVorlagenZeile">
                    <div v-if="editingTemplateId !== tpl.id" class="d-flex align-items-center gap-2">
                        <img v-if="tpl.imageBase64" :src="'data:image/png;base64,' + tpl.imageBase64"
                             class="rounded" style="width: 36px; height: 36px; object-fit: cover; flex-shrink: 0;" />
                        <div class="flex-grow-1" style="min-width: 0;">
                            <div class="fw-bold text-truncate">
                                {{ tpl.name }}
                                <span v-if="tpl.category" class="badge ms-1"
                                      :class="tpl.category === 'win' ? 'bg-success' : 'bg-danger'">{{ useVorlagenKategorieLabel(tpl.category) }}</span>
                            </div>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-secondary" @click="startEditTemplate(tpl)">
                            <i class="uil uil-edit-alt"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" :disabled="deletingTemplateId === tpl.id"
                                @click="deleteShareCardTemplate(tpl.id)">
                            <i class="uil uil-trash-alt"></i>
                        </button>
                    </div>
                    <div v-else class="d-flex flex-column gap-2">
                        <!-- Nur der Name ist hier bearbeitbar. Der Prompt-Text
                             hat mit dem gespeicherten Bild nichts zu tun — die App
                             kann kein Bild nachträglich bearbeiten, „Text ändern"
                             hätte also nie etwas am Bild bewirkt. Ein frei
                             eintragbares Feld suggerierte genau das fälschlich. -->
                        <input type="text" class="form-control form-control-sm" v-model="editTemplateName" />
                        <div>
                            <button type="button" class="btn btn-sm btn-success me-2" :disabled="savingTemplateEdit || !editTemplateName.trim()"
                                    @click="saveTemplateEdit">{{ t('common.save') }}</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary" @click="cancelEditTemplate">{{ t('common.cancel') }}</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>

<style scoped>
/* Prompt-Vorlagen der Share-Karten. Bewusst kein Bootstrap `.list-group-item`:
   das legt eine eigene (helle-Theme-)Textfarbe fest, die die geerbte
   `body`-Farbe überstimmt und auf dunklem Grund unlesbar wird. */
.shareCardVorlagen {
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    border-radius: var(--border-radius, 0.5rem);
}
.shareCardVorlagenZeile {
    padding: 0.5rem 0.75rem;
    color: var(--white-87);
}
.shareCardVorlagenZeile + .shareCardVorlagenZeile {
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
}
</style>
