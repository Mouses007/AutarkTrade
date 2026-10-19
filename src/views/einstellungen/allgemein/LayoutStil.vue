<script setup>
/**
 * Allgemein → Layout & Stil: Sprache, Profil, erweiterte Infos,
 * Onboarding-Assistent, Modi und Startseite.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import InfoTipp from '@/components/InfoTipp.vue'
import { useCheckCurrentUser, useGetPeriods } from '@/utils/utils.js'
import { currentUser, renderProfile } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { merkeErweiterteInfos } from '@/composables/useErweiterteInfos.js'
import { setLocale } from '@/i18n'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import {
    modusLiveAn, modusResearchAn, modusStrategieAn, modusLernenAn, modusSpeichern,
} from '../gemeinsam/useModi.js'

const { t } = useI18n()
const router = useRouter()

let layoutExpanded = ref(false)

let selectedLanguage = ref('de')

async function changeLanguage(lang) {
    // `setLocale` laedt die Sprachdatei bei Bedarf nach und ist deshalb async.
    await setLocale(lang)
    await dbUpdateSettings({ language: lang })
    currentUser.value.language = lang
    await useGetPeriods()
}

let profileAvatar = null
let username = ref('')
// Layout & Stil
let livetradingMobil = ref(false)    // Live-Trading-Fenster auch am Telefon zeigen
let startseiteAn = ref(true)         // Startseite als Landing-Page + Modus-Tab
let erweiterteInfosAn = ref(true)    // kleines „i" an Werten und Bedienelementen

/**
 * Startseiten-Schalter speichern. Zusätzlich zum DB-Wert wird der Zustand nach
 * localStorage gespiegelt, damit der Root-Redirect (`/`) beim nächsten Start
 * synchron weiß, ob er auf die Startseite oder ins Journal leiten soll.
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

/* PROFILE */
async function uploadProfileAvatar(event) {
    const file = event.target.files[0];
    profileAvatar = file
}

async function deleteAvatar() {
    await dbUpdateSettings({ avatar: '' })
    profileAvatar = null
    await useCheckCurrentUser()
    renderProfile.value += 1
    console.log(' -> Avatar gelöscht')
}

async function updateProfile() {
    console.log(" update profile")
    return new Promise(async (resolve, reject) => {
        console.log("\nUPDATING PROFILE")
        // Always save username
        await dbUpdateSettings({ username: username.value || '' })

        if (profileAvatar != null) {
            const reader = new FileReader()
            reader.onloadend = async () => {
                await dbUpdateSettings({ avatar: reader.result })
                await useCheckCurrentUser()
                await (renderProfile.value += 1)
                console.log(" -> Profile updated")
                resolve()
            }
            reader.readAsDataURL(profileAvatar)
        } else {
            await useCheckCurrentUser()
            await (renderProfile.value += 1)
            resolve()
        }
    })
}

/* Stand aus den Einstellungen — Settings.vue hat sie vor dem Mount geladen. */
function ausEinstellungen() {
    const settings = currentUser.value || {}
    username.value = settings.username || ''
    selectedLanguage.value = settings.language || 'de'
    erweiterteInfosAn.value = Number(settings.erweiterteInfos ?? 1) === 1
    livetradingMobil.value = Number(settings.livetradingMobil ?? 0) === 1
    startseiteAn.value = Number(settings.startseiteAn ?? 1) === 1
}
ausEinstellungen()
</script>

<template>
    <div>
        <div class="d-flex align-items-center pointerClass" @click="layoutExpanded = !layoutExpanded">
            <i class="uil me-2" :class="layoutExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.layoutAndStyle') }}</p>
        </div>

        <div v-show="layoutExpanded" class="row align-items-center mt-2 ms-3">

            <!-- Sprache / Language -->
            <div class="col-12 col-md-4">
                {{ t('settings.languageLabel') }}
            </div>
            <div class="col-12 col-md-8">
                <select class="form-select" v-model="selectedLanguage" @change="changeLanguage(selectedLanguage)">
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                </select>
            </div>

            <!-- Username -->
            <div class="col-12 col-md-4 mt-2">
                {{ t('settings.username') }}
            </div>
            <div class="col-12 col-md-8">
                <input type="text" class="form-control" v-model="username" :placeholder="t('settings.usernamePlaceholder')" />
            </div>

            <!-- Profile Picture -->
            <div class="col-12 col-md-4 mt-2">
                {{ t('settings.profilePicture') }}
            </div>
            <div class="col-12 col-md-8 mt-2">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <img v-if="currentUser?.avatar" :src="currentUser.avatar" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                    <img v-else src="@/assets/icon.png" class="rounded-circle" style="width: 40px; height: 40px; object-fit: cover;" />
                    <button v-if="currentUser?.avatar" type="button" class="btn btn-outline-danger btn-sm" @click="deleteAvatar">
                        <i class="uil uil-trash-alt me-1"></i>{{ t('common.remove') }}
                    </button>
                </div>
                <input type="file" @change="uploadProfileAvatar" />
            </div>

            <!-- Erweiterte Infos: das kleine „i" an Werten und Bedienelementen -->
            <div class="col-12 mt-4">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="erweiterteInfosToggle"
                        v-model="erweiterteInfosAn" @change="erweiterteInfosSpeichern(erweiterteInfosAn)">
                    <label class="form-check-label" for="erweiterteInfosToggle">{{ t('settings.erweiterteInfos') }}</label>
                    <InfoTipp schluessel="settings.erweiterteInfosInfo" />
                </div>
                <p class="fw-lighter small mb-0">{{ t('settings.erweiterteInfosHint') }}</p>
            </div>

            <!-- Manueller Wiederaufruf des Onboarding-Assistenten — unabhängig
                 vom Versionsabgleich, z.B. um eine Nachrichtenquelle
                 nachzutragen, die man beim ersten Mal übersprungen hat. -->
            <div class="col-12 mt-4">
                <button type="button" class="btn btn-outline-secondary btn-sm"
                    @click="router.push({ path: '/update-assistent', query: { kontext: 'manuell', rueckkehr: '/settings' } })">
                    <i class="uil uil-magic me-1"></i>{{ t('onboarding.reopenButton') }}
                </button>
            </div>

            <!-- Modi ein-/ausblenden. Journal fehlt bewusst: nicht abschaltbar. -->
            <div class="col-12 mt-4">
                <h6 class="mb-1">{{ t('settings.modesTitle') }}</h6>
                <p class="fw-lighter small mb-2">{{ t('settings.modesHint') }}</p>

                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="startseiteAnToggle"
                        v-model="startseiteAn" @change="startseiteSpeichern(startseiteAn)">
                    <label class="form-check-label" for="startseiteAnToggle">{{ t('modes.start') }}</label>
                    <InfoTipp schluessel="settings.startpageOnHint" />
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="modusLiveAnToggle"
                        v-model="modusLiveAn" @change="modusSpeichern('modusLiveAn', modusLiveAn)">
                    <label class="form-check-label" for="modusLiveAnToggle">{{ t('modes.live') }}</label>
                    <InfoTipp schluessel="settings.modeLiveInfo" />
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="modusResearchAnToggle"
                        v-model="modusResearchAn" @change="modusSpeichern('modusResearchAn', modusResearchAn)">
                    <label class="form-check-label" for="modusResearchAnToggle">{{ t('modes.research') }}</label>
                    <InfoTipp schluessel="settings.modeResearchInfo" />
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="modusStrategieAnToggle"
                        v-model="modusStrategieAn" @change="modusSpeichern('modusStrategieAn', modusStrategieAn)">
                    <label class="form-check-label" for="modusStrategieAnToggle">{{ t('modes.agent') }}</label>
                    <InfoTipp schluessel="settings.modeStrategyInfo" />
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="modusLernenAnToggle"
                        v-model="modusLernenAn" @change="modusSpeichern('modusLernenAn', modusLernenAn)">
                    <label class="form-check-label" for="modusLernenAnToggle">{{ t('modes.lernen') }}</label>
                    <InfoTipp schluessel="settings.modeLernenInfo" />
                </div>
                <p class="fw-lighter small mb-0 mt-2">{{ t('settings.modesJournalFix') }}</p>
            </div>

            <!-- Live-Trading-Fenster auf dem Handy zeigen -->
            <div class="col-12 mt-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="livetradingMobilToggle"
                        :disabled="!modusLiveAn"
                        v-model="livetradingMobil" @change="kiSpeichern('livetradingMobil', livetradingMobil ? 1 : 0)">
                    <label class="form-check-label" for="livetradingMobilToggle">{{ t('settings.livetradingMobile') }}</label>
                </div>
                <p class="fw-lighter small mb-0">{{ t('settings.livetradingMobileHint') }}</p>
                <!-- Ausgrauen statt verstecken: ein verschwundener Schalter lässt
                     offen, ob die Einstellung überlebt hat. -->
                <p v-if="!modusLiveAn" class="fw-lighter small mb-0 text-warning">{{ t('settings.livetradingModeOffHint') }}</p>
            </div>

            <div class="col-12 mt-3 mb-3">
                <button type="button" v-on:click="updateProfile" class="btn btn-success">{{ t('common.save') }}</button>
            </div>
        </div>

    </div>
</template>
