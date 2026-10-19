<script setup>
/** Allgemein → Sicherheit: optionales Passwort-Gate und Abmelden. */
import { ref, onMounted } from 'vue'
import axios from 'axios'

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
    if (authNewPassword.value.length < 6) {
        authSaveResult.value = { success: false, message: 'Passwort muss mindestens 6 Zeichen haben.' }
        return
    }
    if (authNewPassword.value !== authNewPassword2.value) {
        authSaveResult.value = { success: false, message: 'Passwörter stimmen nicht überein.' }
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
        authSaveResult.value = { success: true, message: 'Passwortschutz aktiv.' }
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
    window.location.reload()
}

async function disableAuth() {
    authSaveResult.value = null
    if (!confirm('Passwortschutz wirklich deaktivieren? Danach hat jeder mit Zugriff aufs Netzwerk vollen Zugang.')) return
    authSaveLoading.value = true
    try {
        await axios.post('/api/auth/disable', { currentPassword: authCurrentPassword.value })
        authEnabled.value = false
        authCurrentPassword.value = ''
        authSaveResult.value = { success: true, message: 'Passwortschutz deaktiviert.' }
        setTimeout(() => authSaveResult.value = null, 5000)
    } catch (e) {
        authSaveResult.value = { success: false, message: e.response?.data?.error || e.message }
    }
    authSaveLoading.value = false
}

onMounted(loadAuthStatus)
</script>

<template>
    <div>
        <hr />

        <!--=============== SICHERHEIT / PASSWORT-GATE ===============-->
        <div class="d-flex align-items-center pointerClass" @click="authExpanded = !authExpanded">
            <i class="uil me-2" :class="authExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">Sicherheit · Passwortschutz</p>
            <span class="badge ms-2" :class="authEnabled ? 'bg-success' : 'bg-secondary'">
                {{ authEnabled ? 'aktiv' : 'aus' }}
            </span>
        </div>
        <div v-show="authExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">
                Optionaler Login-Schutz. <strong>Nur nötig, wenn die App im Netzwerk/öffentlich erreichbar ist</strong>
                (z. B. <code>AT_HOST=0.0.0.0</code> oder Cloud-Server). Für reinen lokalen Betrieb nicht erforderlich.
                Für echten Cloud-Betrieb zusätzlich HTTPS via Reverse-Proxy/VPN verwenden.
            </p>

            <div v-if="authEnabled" class="row mt-2">
                <div class="col-12 col-md-4">Aktuelles Passwort</div>
                <div class="col-12 col-md-8">
                    <input type="password" class="form-control" v-model="authCurrentPassword"
                        autocomplete="current-password" placeholder="(zum Ändern/Deaktivieren)" />
                </div>
            </div>

            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ authEnabled ? 'Neues Passwort' : 'Passwort' }}</div>
                <div class="col-12 col-md-8">
                    <input type="password" class="form-control" v-model="authNewPassword"
                        autocomplete="new-password" placeholder="mindestens 6 Zeichen" />
                </div>
            </div>
            <div class="row mt-2">
                <div class="col-12 col-md-4">Passwort bestätigen</div>
                <div class="col-12 col-md-8">
                    <input type="password" class="form-control" v-model="authNewPassword2"
                        autocomplete="new-password" placeholder="Passwort wiederholen" />
                </div>
            </div>

            <div class="mt-3 d-flex gap-2">
                <button class="btn btn-primary" @click="saveAuthPassword" :disabled="authSaveLoading">
                    <span v-if="authSaveLoading" class="spinner-border spinner-border-sm me-1"></span>
                    {{ authEnabled ? 'Passwort ändern' : 'Passwortschutz aktivieren' }}
                </button>
                <button v-if="authEnabled" class="btn btn-outline-danger" @click="disableAuth" :disabled="authSaveLoading">
                    Deaktivieren
                </button>
                <button v-if="authEnabled" class="btn btn-outline-secondary ms-auto" @click="logout">
                    <i class="uil uil-signout me-1"></i>Abmelden
                </button>
            </div>

            <div v-if="authSaveResult" class="mt-2">
                <small :class="authSaveResult.success ? 'text-success' : 'text-danger'">
                    <i class="uil me-1" :class="authSaveResult.success ? 'uil-check' : 'uil-exclamation-triangle'"></i>
                    {{ authSaveResult.message }}
                </small>
            </div>
        </div>

    </div>
</template>
