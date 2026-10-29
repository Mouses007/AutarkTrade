<script setup>
/** KI → Bilder: Share-Karten (FLUX.2 + Gemini) und ihre Prompt-Vorlagen. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { appEinstellungen } from '@/stores/settings.js'
import InfoTipp from '@/components/InfoTipp.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import ModelManager from '@/components/ModelManager.vue'
import { useVorlagenKategorieLabel } from '../../../utils/journal/format.js'
import { useShareCard } from '../gemeinsam/useShareCard.js'

const { t } = useI18n()

let fluxExpanded = ref(true) // eigener Unter-Reiter: offen starten

const {
    cancelEditTemplate, deleteShareCardTemplate, deletingTemplateId, editTemplateName, editingTemplateId,
    fluxApiKey, fluxModel, fluxModelleGeaendert, fluxModels, fluxTestLoading,
    fluxNameZeigen, fluxTestResult, fluxUseCustomAvatar, geminiBildModelleGeaendert, geminiImageApiKey, geminiImageModel,
    geminiImageModels, geminiTestLoading, geminiTestResult, saveFluxSettings,
    saveTemplateEdit, savingTemplateEdit, shareCardProvider, shareCardTemplates, startEditTemplate,
    templatesLoading, testFluxConnection, testGeminiConnection,
} = useShareCard()
</script>

<template>
    <div>
        <!--=============== SHARE CARDS (FLUX.2 + Gemini) ===============-->
        <Abschnitt :titel="t('settings.shareCardsTitle')" symbol="bild" v-model:offen="fluxExpanded">
            <p class="einleitung">{{ t('settings.shareCardsDescription') }}</p>

            <!-- Provider Selection -->
            <Feld :label="t('settings.imageProviderLabel')">
                <div class="reihe auswahl" role="radiogroup" :aria-label="t('settings.imageProviderLabel')">
                    <label>
                        <input type="radio" value="flux" v-model="shareCardProvider" />
                        <span>FLUX.2 <span class="leise">(Black Forest Labs)</span></span>
                    </label>
                    <label>
                        <input type="radio" value="gemini" v-model="shareCardProvider" />
                        <span>Google Gemini <span class="leise">(Nano Banana)</span></span>
                    </label>
                </div>
            </Feld>

            <!-- FLUX-specific settings -->
            <div v-show="shareCardProvider === 'flux'">
                <Feld :label="t('settings.fluxApiKey')" fuer="kiFluxKey">
                    <div class="mit-knopf">
                        <input id="kiFluxKey" type="password" v-model="fluxApiKey" placeholder="bfl-..."
                            @focus="e => { if (fluxApiKey.includes('•')) e.target.select() }" />
                        <Knopf v-if="fluxApiKey" art="leise" symbol="schliessen" nur-symbol klein
                            :titel="t('settings.deleteKey')" @click="fluxApiKey = ''" />
                    </div>
                    <p class="leise schluessel-hinweis">
                        {{ t('settings.encryptedStored') }}
                        — <a href="https://api.bfl.ai" target="_blank" rel="noopener">api.bfl.ai</a>
                    </p>
                </Feld>
                <Feld fuer="kiFluxModell">
                    <template #label>
                        <label for="kiFluxModell">{{ t('settings.fluxModel') }}</label><InfoTipp schluessel="settings.info.fluxModel" />
                    </template>
                    <div class="stapel">
                        <select id="kiFluxModell" v-model="fluxModel">
                            <option v-for="m in fluxModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                        <ModelManager provider="flux" @geaendert="fluxModelleGeaendert" />
                    </div>
                </Feld>
            </div>

            <!-- Gemini-specific settings -->
            <div v-show="shareCardProvider === 'gemini'">
                <Feld :label="t('settings.geminiApiKeyLabel')" fuer="kiGeminiBildKey">
                    <div class="mit-knopf">
                        <input id="kiGeminiBildKey" type="password" v-model="geminiImageApiKey" placeholder="AIza..."
                            @focus="e => { if (geminiImageApiKey.includes('•')) e.target.select() }" />
                        <Knopf v-if="geminiImageApiKey" art="leise" symbol="schliessen" nur-symbol klein
                            :titel="t('settings.deleteKey')" @click="geminiImageApiKey = ''" />
                    </div>
                    <p class="leise schluessel-hinweis">
                        {{ t('settings.encryptedStored') }}
                        — <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>
                    </p>
                </Feld>
                <Feld>
                    <template #label>
                        <label for="kiGeminiBildModell">{{ t('settings.geminiModelLabel') }}</label><InfoTipp schluessel="settings.info.geminiImageModel" />
                    </template>
                    <div class="stapel">
                        <select id="kiGeminiBildModell" v-model="geminiImageModel">
                            <option v-for="m in geminiImageModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                        </select>
                        <ModelManager provider="geminiBild" @geaendert="geminiBildModelleGeaendert" />
                    </div>
                </Feld>
            </div>

            <!-- Shared settings (always visible) -->
            <hr class="trenner" />

            <!-- Name und Bild der Karte kommen aus dem Profil (Allgemein › Profil & Sprache);
                 hier bleibt nur die Wahl Profilbild oder App-Logo. -->
            <Feld :label="t('settings.fluxAvatar')" :hilfe="t('settings.fluxProfilHint')">
                <div class="stapel">
                    <!-- Name nur auf Wunsch: Bis 10/2026 stand nur ein eigens
                         gesetzter Kartenname auf dem Bild, sonst gar keiner. -->
                    <label class="reihe ankreuzen">
                        <input type="checkbox" v-model="fluxNameZeigen" />
                        <span>{{ t('settings.fluxNameZeigen') }}</span>
                    </label>
                    <label class="reihe ankreuzen">
                        <input type="checkbox" v-model="fluxUseCustomAvatar" />
                        <span>{{ t('settings.fluxUseCustomAvatar') }}</span>
                    </label>
                    <div class="reihe">
                        <img v-if="fluxUseCustomAvatar && appEinstellungen?.avatar" :src="appEinstellungen.avatar" class="avatar" alt="" />
                        <span class="leise">{{ fluxNameZeigen && appEinstellungen?.username ? appEinstellungen.username : t('settings.fluxOhneName') }}</span>
                    </div>
                </div>
            </Feld>

            <!-- Buttons -->
            <div class="knoepfe">
                <Knopf art="haupt" @click="saveFluxSettings">{{ t('common.save') }}</Knopf>
                <Knopf v-if="shareCardProvider === 'flux'" :laedt="fluxTestLoading" @click="testFluxConnection">
                    {{ fluxTestLoading ? t('common.testing') : t('common.testConnection') }}
                </Knopf>
                <Knopf v-if="shareCardProvider === 'gemini'" :laedt="geminiTestLoading" @click="testGeminiConnection">
                    {{ geminiTestLoading ? t('common.testing') : t('common.testConnection') }}
                </Knopf>
                <span v-if="shareCardProvider === 'flux' && fluxTestResult" :class="fluxTestResult.success ? 'gut' : 'schlecht'">
                    {{ fluxTestResult.message }}
                </span>
                <span v-if="shareCardProvider === 'gemini' && geminiTestResult" :class="geminiTestResult.success ? 'gut' : 'schlecht'">
                    {{ geminiTestResult.message }}
                </span>
            </div>

            <!-- Prompt-Vorlagen: anlegen/anwenden geschieht im Trade-Modal
                 (ShareCardModal.vue) beim Erzeugen einer Share-Karte;
                 hier — zentral in den Einstellungen — lassen sie sich
                 benennen und löschen. -->
            <hr class="trenner" />
            <h3 class="zwischentitel oben">{{ t('settings.shareCardTemplatesTitle') }}</h3>
            <p class="einleitung">{{ t('settings.shareCardTemplatesHint') }}</p>
            <p v-if="templatesLoading" class="leise">{{ t('common.loading') }}</p>
            <p v-else-if="!shareCardTemplates.length" class="leise">
                {{ t('settings.shareCardTemplatesEmpty') }}
            </p>
            <div v-else class="liste">
                <div v-for="tpl in shareCardTemplates" :key="tpl.id" class="liste-zeile">
                    <template v-if="editingTemplateId !== tpl.id">
                        <img v-if="tpl.imageBase64" :src="'data:image/png;base64,' + tpl.imageBase64"
                            class="vorschau" alt="" />
                        <span class="vorlage-name">
                            <strong>{{ tpl.name }}</strong>
                            <Pille v-if="tpl.category" :ton="tpl.category === 'win' ? 'gut' : 'schlecht'">
                                {{ useVorlagenKategorieLabel(tpl.category) }}
                            </Pille>
                        </span>
                        <span class="liste-ende">
                            <Knopf klein @click="startEditTemplate(tpl)">{{ t('common.edit') }}</Knopf>
                            <Knopf klein art="gefahr" :disabled="deletingTemplateId === tpl.id"
                                @click="deleteShareCardTemplate(tpl.id)">{{ t('common.delete') }}</Knopf>
                        </span>
                    </template>
                    <div v-else class="stapel volle-breite">
                        <!-- Nur der Name ist hier bearbeitbar. Der Prompt-Text
                             hat mit dem gespeicherten Bild nichts zu tun — die App
                             kann kein Bild nachträglich bearbeiten, „Text ändern"
                             hätte also nie etwas am Bild bewirkt. Ein frei
                             eintragbares Feld suggerierte genau das fälschlich. -->
                        <input type="text" v-model="editTemplateName" :aria-label="t('common.edit')" />
                        <div class="reihe">
                            <Knopf art="haupt" klein :disabled="savingTemplateEdit || !editTemplateName.trim()"
                                @click="saveTemplateEdit">{{ t('common.save') }}</Knopf>
                            <Knopf klein art="leise" @click="cancelEditTemplate">{{ t('common.cancel') }}</Knopf>
                        </div>
                    </div>
                </div>
            </div>
        </Abschnitt>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.oben { margin-top: 0; }
.auswahl { gap: var(--abstand-2) var(--abstand-5); }
.auswahl label,
.ankreuzen {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    cursor: pointer;
}
.schluessel-hinweis { margin: var(--abstand-1) 0 0; }
.avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex: none;
}
.vorschau {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-klein);
    object-fit: cover;
    flex: none;
}
.vorlage-name {
    flex: 1 1 10rem;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    overflow-wrap: anywhere;
}
.volle-breite { flex: 1 1 100%; }
</style>
