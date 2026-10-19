<script setup>
/**
 * Allgemein → Layout & Stil: Sprache, Profil, erweiterte Infos,
 * Onboarding-Assistent, Modi und Startseite.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Knopf, Eingabe } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { pruefeEinstellungen, ladeZeitraeume } from '../../../utils/journal/app.js'
import { currentUser, profilZaehler } from '@/stores/settings.js'
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
const SPRACHEN = [{ wert: 'de', text: 'Deutsch' }, { wert: 'en', text: 'English' }]

async function changeLanguage(lang) {
    // `setLocale` laedt die Sprachdatei bei Bedarf nach und ist deshalb async.
    await setLocale(lang)
    await dbUpdateSettings({ language: lang })
    currentUser.value.language = lang
    await ladeZeitraeume()
}

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

/* Profil: Name und Bild. Das Bild wird erst beim Speichern gelesen und als
   Daten-URL in den Einstellungen abgelegt — ein eigener Upload-Weg wäre für
   ein einzelnes kleines Bild zu viel. */
const gewaehltesBild = ref(null)

function bildGewaehlt(ereignis) {
    gewaehltesBild.value = ereignis.target.files?.[0] || null
}

function alsDatenUrl(datei) {
    return new Promise((fertig, fehler) => {
        const leser = new FileReader()
        leser.onload = () => fertig(leser.result)
        leser.onerror = () => fehler(leser.error)
        leser.readAsDataURL(datei)
    })
}

async function profilNeuLaden() {
    await pruefeEinstellungen()
    profilZaehler.value += 1
}

async function deleteAvatar() {
    await dbUpdateSettings({ avatar: '' })
    gewaehltesBild.value = null
    await profilNeuLaden()
}

async function profilSpeichern() {
    const aenderung = { username: username.value || '' }
    if (gewaehltesBild.value) aenderung.avatar = await alsDatenUrl(gewaehltesBild.value)
    await dbUpdateSettings(aenderung)
    gewaehltesBild.value = null
    await profilNeuLaden()
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
    <Abschnitt v-model:offen="layoutExpanded" :titel="t('settings.layoutAndStyle')" symbol="raster">

        <!-- Sprache / Language -->
        <Feld :label="t('settings.languageLabel')">
            <Eingabe v-model="selectedLanguage" art="auswahl" :optionen="SPRACHEN"
                @update:model-value="changeLanguage" />
        </Feld>

        <Feld :label="t('settings.username')">
            <Eingabe v-model="username" :platzhalter="t('settings.usernamePlaceholder')" />
        </Feld>

        <Feld :label="t('settings.profilePicture')">
            <div class="avatar-zeile">
                <img v-if="currentUser?.avatar" :src="currentUser.avatar" class="avatar" alt="" />
                <img v-else src="@/assets/icon.png" class="avatar" alt="" />
                <Knopf v-if="currentUser?.avatar" art="gefahr" klein @click="deleteAvatar">{{ t('common.remove') }}</Knopf>
            </div>
            <input type="file" class="datei" @change="bildGewaehlt" />
        </Feld>

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
                @click="router.push({ path: '/update-assistent', query: { kontext: 'manuell', rueckkehr: '/settings' } })">
                {{ t('onboarding.reopenButton') }}
            </Knopf>
        </div>

        <!-- Modi ein-/ausblenden. Journal fehlt bewusst: nicht abschaltbar. -->
        <div class="block">
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
            <p class="hinweis">{{ t('settings.modesJournalFix') }}</p>
        </div>

        <!-- Live-Trading-Fenster auf dem Handy zeigen -->
        <div class="block">
            <Schalter v-model="livetradingMobil" :disabled="!modusLiveAn" :label="t('settings.livetradingMobile')"
                :hilfe="t('settings.livetradingMobileHint')"
                @change="(v) => kiSpeichern('livetradingMobil', v ? 1 : 0)" />
            <!-- Ausgrauen statt verstecken: ein verschwundener Schalter lässt
                 offen, ob die Einstellung überlebt hat. -->
            <p v-if="!modusLiveAn" class="hinweis warn">{{ t('settings.livetradingModeOffHint') }}</p>
        </div>

        <div class="fuss">
            <Knopf art="haupt" @click="profilSpeichern">{{ t('common.save') }}</Knopf>
        </div>
    </Abschnitt>
</template>

<style scoped>
.avatar-zeile {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}
.avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
}
.datei {
    max-width: 100%;
    color: var(--muted);
    font-size: 0.85rem;
}
.datei::file-selector-button {
    margin-right: var(--abstand-2);
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    font: inherit;
    cursor: pointer;
}
.datei::file-selector-button:hover { background: var(--panel-hoch); }
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
.hinweis.warn { color: var(--warn); }
.fuss {
    margin-top: var(--abstand-4);
}
</style>
