<script setup>
import { ref } from 'vue'
import axios from 'axios'
import Knopf from './basis/Knopf.vue'

// setup=true: Erst-Einrichtung im Netzbetrieb — es existiert noch kein
// Passwort, der Server verteilt keine Cookies. Statt „Anmelden" wird hier das
// erste Passwort festgelegt (der Server lässt das ohne Session zu, solange
// das Gate aus ist).
const props = defineProps({ setup: { type: Boolean, default: false } })

const password = ref('')
const passwordWdh = ref('')
const error = ref('')
const info = ref('')
const loading = ref(false)
const resetting = ref(false)

async function submit() {
    if (loading.value) return
    error.value = ''
    info.value = ''
    loading.value = true
    try {
        if (props.setup) {
            if (password.value !== passwordWdh.value) {
                error.value = 'Die Passwörter stimmen nicht überein.'
                return
            }
            const { data } = await axios.post('/api/auth/set-password', { newPassword: password.value })
            if (data.ok) {
                info.value = 'Passwort gesetzt. Seite wird neu geladen…'
                setTimeout(() => window.location.reload(), 800)
                return
            }
            error.value = 'Passwort setzen fehlgeschlagen.'
            return
        }
        const { data } = await axios.post('/api/login', { password: password.value })
        if (data.ok) {
            window.location.reload()
            return
        }
        error.value = 'Anmeldung fehlgeschlagen.'
    } catch (e) {
        error.value = e.response?.data?.error || (props.setup ? 'Passwort setzen fehlgeschlagen.' : 'Anmeldung fehlgeschlagen.')
    } finally {
        loading.value = false
    }
}

async function forgotPassword() {
    if (resetting.value) return
    if (!confirm('Passwortschutz zurücksetzen? Funktioniert nur, wenn du diese Seite direkt am Server (localhost) geöffnet hast.')) return
    error.value = ''
    info.value = ''
    resetting.value = true
    try {
        const { data } = await axios.post('/api/auth/reset')
        if (data.ok) {
            info.value = 'Passwortschutz zurückgesetzt. Seite wird neu geladen…'
            setTimeout(() => window.location.reload(), 1200)
            return
        }
    } catch (e) {
        error.value = e.response?.status === 403
            ? 'Zurücksetzen nur direkt am Server (localhost) möglich.'
            : (e.response?.data?.error || 'Zurücksetzen fehlgeschlagen.')
    } finally {
        resetting.value = false
    }
}
</script>

<template>
    <div class="login-gate">
        <div class="login-card">
            <h3 class="login-titel">AutarkTrade</h3>
            <p v-if="setup" class="login-sub">Der Dienst ist im Netzwerk erreichbar — lege zuerst ein Passwort fest.</p>
            <p v-else class="login-sub">Passwortgeschützt</p>
            <form @submit.prevent="submit">
                <input
                    v-model="password"
                    type="password"
                    class="at-feld login-input"
                    :placeholder="setup ? 'Neues Passwort (min. 6 Zeichen)' : 'Passwort'"
                    autofocus
                    :autocomplete="setup ? 'new-password' : 'current-password'"
                />
                <input
                    v-if="setup"
                    v-model="passwordWdh"
                    type="password"
                    class="at-feld login-input"
                    placeholder="Passwort wiederholen"
                    autocomplete="new-password"
                />
                <div v-if="error" class="login-error">{{ error }}</div>
                <div v-if="info" class="login-info">{{ info }}</div>
                <Knopf type="submit" art="haupt" class="login-btn" :disabled="loading || !password">
                    {{ loading ? (setup ? 'Speichern…' : 'Anmelden…') : (setup ? 'Passwort festlegen' : 'Anmelden') }}
                </Knopf>
            </form>
            <button v-if="!setup" type="button" class="login-forgot" :disabled="resetting" @click="forgotPassword">
                {{ resetting ? 'Zurücksetzen…' : 'Passwort vergessen?' }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.login-gate {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--bg);
    z-index: 9999;
}
.login-card {
    background: var(--panel);
    border: 1px solid var(--line);
    padding: 2.5rem;
    border-radius: var(--radius);
    box-shadow: var(--schatten);
    width: 320px;
    max-width: 100%;
    text-align: center;
    color: var(--text);
}
.login-titel {
    margin: 0 0 0.25rem;
}
.login-sub {
    color: var(--muted);
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
}
.login-input {
    margin-bottom: 1rem;
}
.login-btn {
    width: 100%;
}
.login-error {
    color: var(--bad);
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
}
.login-info {
    color: var(--good);
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
}
.login-forgot {
    margin-top: 1rem;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
}
.login-forgot:hover {
    color: var(--text);
}
</style>
