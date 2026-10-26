<script setup>
/** Allgemein → Sicherheit: optionales Passwort-Gate und Abmelden. */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { loescheFinanzdaten } from '@/utils/finanzSpeicher.js'
import { Knopf, Pille } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'

const { t } = useI18n()

// ── Sicherheit: optionales Passwort-Gate ──
let authExpanded = ref(false)
let authEnabled = ref(false)
let authCurrentPassword = ref('')
let authNewPassword = ref('')
let authNewPassword2 = ref('')
let authSaveLoading = ref(false)
let authSaveResult = ref(null)

async function loadAuthStatus() {
    try {
        const { data } = await axios.get('/api/auth/status')
        authEnabled.value = !!data.authEnabled
    } catch (e) {
        authEnabled.value = false
    }
}

async function saveAuthPassword() {
    authSaveResult.value = null
    if (authNewPassword.value.length < 10) {
        authSaveResult.value = { success: false, message: t('settings.sicherheit.zuKurz') }
        return
    }
    if (authNewPassword.value !== authNewPassword2.value) {
        authSaveResult.value = { success: false, message: t('settings.sicherheit.ungleich') }
        return
    }
    authSaveLoading.value = true
    try {
        await axios.post('/api/auth/set-password', {
            currentPassword: authCurrentPassword.value,
            newPassword: authNewPassword.value
        })
        authEnabled.value = true
        authCurrentPassword.value = ''
        authNewPassword.value = ''
        authNewPassword2.value = ''
        authSaveResult.value = { success: true, message: t('settings.sicherheit.istAktiv') }
        setTimeout(() => authSaveResult.value = null, 5000)
    } catch (e) {
        authSaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    authSaveLoading.value = false
}

async function logout() {
    try {
        await axios.post('/api/logout')
    } catch (e) { /* egal — danach neu laden */ }
    // Positions-/Kontodaten nicht im Browser liegen lassen (Audit SEC-WEB-005)
    loescheFinanzdaten()
    window.location.reload()
}

// Alle Geräte abmelden (A2-22): entwertet das gemeinsame Sitzungs-Token.
async function logoutEverywhere() {
    if (!confirm(t('settings.sicherheit.ueberallFrage'))) return
    try {
        await axios.post('/api/auth/ueberall-abmelden')
    } catch (e) { /* egal — danach neu laden */ }
    loescheFinanzdaten()
    window.location.reload()
}

async function disableAuth() {
    authSaveResult.value = null
    if (!confirm(t('settings.sicherheit.deaktivierenFrage'))) return
    authSaveLoading.value = true
    try {
        await axios.post('/api/auth/disable', { currentPassword: authCurrentPassword.value })
        authEnabled.value = false
        authCurrentPassword.value = ''
        authSaveResult.value = { success: true, message: t('settings.sicherheit.istDeaktiviert') }
        setTimeout(() => authSaveResult.value = null, 5000)
    } catch (e) {
        authSaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    authSaveLoading.value = false
}

onMounted(loadAuthStatus)
</script>

<template>
    <!--=============== SICHERHEIT / PASSWORT-GATE ===============-->
    <Abschnitt v-model:offen="authExpanded" :titel="t('settings.sicherheit.titel')" symbol="schloss">
        <template #kopf>
            <Pille :ton="authEnabled ? 'gut' : 'neutral'">
                {{ authEnabled ? t('settings.sicherheit.aktiv') : t('settings.sicherheit.aus') }}
            </Pille>
        </template>

        <p class="hinweis">
            {{ t('settings.sicherheit.einleitung') }} <strong>{{ t('settings.sicherheit.nurNoetig') }}</strong>
            {{ t('settings.sicherheit.beispielVor') }}<code>AT_HOST=0.0.0.0</code>{{ t('settings.sicherheit.beispielNach') }}
        </p>

        <Feld v-if="authEnabled" :label="t('settings.sicherheit.aktuell')" fuer="auth-aktuell">
            <input id="auth-aktuell" type="password" class="eingabe" v-model="authCurrentPassword"
                autocomplete="current-password" :placeholder="t('settings.sicherheit.aktuellPlatzhalter')" />
        </Feld>
        <Feld :label="authEnabled ? t('settings.sicherheit.neu') : t('settings.sicherheit.passwort')" fuer="auth-neu">
            <input id="auth-neu" type="password" class="eingabe" v-model="authNewPassword"
                autocomplete="new-password" :placeholder="t('settings.sicherheit.neuPlatzhalter')" />
        </Feld>
        <Feld :label="t('settings.sicherheit.bestaetigen')" fuer="auth-neu2">
            <input id="auth-neu2" type="password" class="eingabe" v-model="authNewPassword2"
                autocomplete="new-password" :placeholder="t('settings.sicherheit.bestaetigenPlatzhalter')" />
        </Feld>

        <div class="knoepfe">
            <Knopf art="haupt" :laedt="authSaveLoading" @click="saveAuthPassword">
                {{ authEnabled ? t('settings.sicherheit.aendern') : t('settings.sicherheit.aktivieren') }}
            </Knopf>
            <Knopf v-if="authEnabled" art="gefahr" :disabled="authSaveLoading" @click="disableAuth">
                {{ t('settings.sicherheit.deaktivieren') }}
            </Knopf>
            <Knopf v-if="authEnabled" class="rechts" symbol="abmelden" @click="logout">
                {{ t('settings.sicherheit.abmelden') }}
            </Knopf>
            <Knopf v-if="authEnabled" symbol="abmelden" @click="logoutEverywhere">
                {{ t('settings.sicherheit.ueberallAbmelden') }}
            </Knopf>
        </div>

        <p v-if="authSaveResult" class="meldung" :class="authSaveResult.success ? 'gut' : 'schlecht'">
            {{ authSaveResult.message }}
        </p>
    </Abschnitt>
</template>

<style scoped>
.hinweis {
    margin: 0 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.88rem;
}
.hinweis strong { color: var(--text); }
.eingabe {
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
}
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.knoepfe .rechts { margin-left: auto; }
.meldung {
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
}
.meldung.gut { color: var(--good); }
.meldung.schlecht { color: var(--bad); }
</style>
