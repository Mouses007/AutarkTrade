<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from './basis/Knopf.vue'
import { schluesselAntippen, frischAbgemeldet } from '@/utils/webauthn.js'

// setup=true: Erst-Einrichtung im Netzbetrieb — es existiert noch kein
// Passwort, der Server verteilt keine Cookies. Statt „Anmelden" wird hier das
// erste Passwort festgelegt (der Server lässt das ohne Session zu, solange
// das Gate aus ist).
const props = defineProps({
    setup: { type: Boolean, default: false },
    // Aus dem Netz verlangt der Server beim ersten Passwort den Code aus dem
    // Server-Log (Audit A2-16) — am Server-Rechner selbst nicht.
    codeNoetig: { type: Boolean, default: false },
    // GET /api/auth/status: passwortMin, zweiFaktor, schluesselLogin,
    // schluesselKontext, schluesselAdresse
    status: { type: Object, default: () => ({}) },
})

const { t } = useI18n()

const password = ref('')
const passwordWdh = ref('')
const code = ref('')
const MIN = computed(() => Number(props.status?.passwortMin) || 10)
const error = ref('')
const info = ref('')
const loading = ref(false)
const resetting = ref(false)
// „Passwort vergessen" braucht seit dem Audit vom 26.10.2026 (SEC-SRV-009)
// den Rücksetzcode, den der Server auf Anfrage in sein Log schreibt.
const resetCodeFeld = ref(false)
const resetCode = ref('')

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
            if (password.value.length < MIN.value) {
                error.value = `Das Passwort braucht mindestens ${MIN.value} Zeichen.`
                return
            }
            const { data } = await axios.post('/api/auth/set-password', {
                newPassword: password.value,
                einrichtungsCode: code.value,
            })
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
        if (Array.isArray(data.zweiterFaktor)) {
            // Passwort stimmt, jetzt Code oder YubiKey (Halb-Cookie liegt beim Browser).
            arten.value = data.zweiterFaktor
            schritt.value = 'zweit'
            password.value = ''
            if (!arten.value.length) error.value = t('login.keinFaktorHier')
            // Gibt es hier nur den YubiKey, gleich danach fragen — ein Knopf,
            // den man ohnehin drücken muss, ist ein Schritt zu viel.
            else if (!arten.value.includes('totp')) nextTick(() => mitSchluessel('zweit', { auto: true }))
            return
        }
        error.value = 'Anmeldung fehlgeschlagen.'
    } catch (e) {
        error.value = e.response?.data?.error || (props.setup ? 'Passwort setzen fehlgeschlagen.' : 'Anmeldung fehlgeschlagen.')
    } finally {
        loading.value = false
    }
}

// ── Zweiter Faktor und YubiKey-Login ──
const schritt = ref('passwort')        // passwort | zweit
const arten = ref([])                  // ['totp', 'schluessel'] laut Server
const appCode = ref('')
const tippen = ref(false)

const schluesselDirekt = computed(() => !props.setup && !!props.status?.schluesselLogin)
// Schlüssel eingerichtet, aber dieser Aufruf (IP, http, fremder Name) kann ihn nicht.
// Ohne Adresse (kein AT_MDNS_NAME/AT_ALLOWED_HOSTS, Audit 4.3.4 FUN-S1-004)
// steht statt eines Links, was einzurichten wäre.
const adressHinweis = computed(() => !props.setup && !!props.status?.zweiFaktor?.schluessel
    && props.status?.schluesselKontext !== 'ok')

function zurueckZumPasswort(meldung) {
    schritt.value = 'passwort'
    arten.value = []
    appCode.value = ''
    error.value = meldung || ''
}

function serverFehler(e, standard) {
    if (e.response?.data?.neuAnmelden) { zurueckZumPasswort(e.response.data.error); return }
    error.value = e.response?.data?.error || standard
}

async function codeSenden() {
    if (loading.value) return
    error.value = ''
    loading.value = true
    try {
        const { data } = await axios.post('/api/login/totp', { code: appCode.value })
        if (data.ok) { window.location.reload(); return }
    } catch (e) {
        appCode.value = ''
        serverFehler(e, t('login.codeFalsch'))
    } finally {
        loading.value = false
    }
}

/**
 * YubiKey antippen — als zweiter Schritt oder direkt ohne Passwort.
 * `auto`: von der Seite selbst gestartet, nicht per Klick. Bricht man dann
 * ab, ist das keine Fehlermeldung wert — das Passwortfeld steht ja darunter.
 */
async function mitSchluessel(verwendung, { auto = false } = {}) {
    if (tippen.value) return
    error.value = ''
    info.value = ''
    tippen.value = true
    try {
        const { data: o } = await axios.post('/api/login/schluessel/optionen', { verwendung })
        info.value = t('login.jetztAntippen')
        const antwort = await schluesselAntippen(o.optionen)
        info.value = ''
        const { data } = await axios.post('/api/login/schluessel/pruefen', { antwort })
        if (data.ok) { window.location.reload(); return }
    } catch (e) {
        info.value = ''
        if (auto && e.grund === 'abgebrochen') { /* still: Passwort oder Code bleibt */ }
        else if (e.grund) error.value = t(`login.fehler.${e.grund}`)
        else if (e.response?.data?.grund === 'abgelaufen') error.value = t('login.fehler.zeit')
        else if (e.response?.data?.grund === 'unbekannt' || e.response?.data?.grund === 'falsch') error.value = t('login.fehler.falscherSchluessel')
        else serverFehler(e, t('login.fehler.unbekannt'))
    } finally {
        tippen.value = false
    }
}

/*
 * Unter einer Adresse, die den YubiKey kann, gleich beim Öffnen danach fragen:
 * Schlüssel antippen, angemeldet. Nicht direkt nach einem Abmelden (dann will
 * man gerade NICHT angemeldet sein) und nicht im Einrichtungsmodus.
 */
onMounted(() => {
    if (frischAbgemeldet()) return
    if (schluesselDirekt.value) mitSchluessel('direkt', { auto: true })
})

async function forgotPassword() {
    if (resetting.value) return
    // Erster Schritt: fragen, dann fordert der Server den Code an (er steht
    // danach in seinem Log). Zweiter Schritt: mit Code zurücksetzen.
    if (!resetCodeFeld.value && !confirm('Passwortschutz zurücksetzen? Funktioniert nur, wenn du diese Seite direkt am Server (localhost) geöffnet hast und das Server-Log lesen kannst.')) return
    error.value = ''
    info.value = ''
    resetting.value = true
    try {
        // JSON-Körper ist Pflicht: der Server nimmt den Reset nur so an, weil
        // eine fremde Seite JSON nicht ohne Preflight schicken kann (A2-02).
        const body = { zuruecksetzen: true }
        if (resetCodeFeld.value && resetCode.value.trim()) body.code = resetCode.value.trim()
        const { data } = await axios.post('/api/auth/reset', body)
        if (data.ok) {
            info.value = 'Passwortschutz zurückgesetzt. Seite wird neu geladen…'
            setTimeout(() => window.location.reload(), 1200)
            return
        }
    } catch (e) {
        if (e.response?.status === 403 && e.response?.data?.codeNoetig) {
            const warSchonOffen = resetCodeFeld.value
            resetCodeFeld.value = true
            if (warSchonOffen && resetCode.value.trim()) error.value = e.response.data.error
            else info.value = 'Der Rücksetzcode steht jetzt im Server-Log (Terminal bzw. Container-Protokoll). Hier eingeben und erneut auf „Zurücksetzen" klicken.'
        } else {
            error.value = e.response?.status === 403
                ? 'Zurücksetzen nur direkt am Server (localhost) möglich. Sonst den Server einmal mit AT_RESET_AUTH=1 starten.'
                : (e.response?.data?.error || 'Zurücksetzen fehlgeschlagen.')
        }
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
            <p v-else-if="schritt === 'zweit'" class="login-sub">{{ t('login.zweiterSchritt') }}</p>
            <p v-else class="login-sub">Passwortgeschützt</p>

            <!-- Zweiter Schritt: Code aus der App und/oder YubiKey -->
            <template v-if="schritt === 'zweit'">
                <form v-if="arten.includes('totp')" @submit.prevent="codeSenden">
                    <input
                        v-model="appCode"
                        type="text"
                        class="at-feld login-input login-code"
                        :placeholder="t('login.codePlatzhalter')"
                        :aria-label="t('login.codePlatzhalter')"
                        autocomplete="one-time-code"
                        inputmode="numeric"
                        pattern="[0-9 ]*"
                        maxlength="7"
                        autofocus
                    />
                    <Knopf type="submit" art="haupt" class="login-btn" :disabled="loading || appCode.replace(/\s/g, '').length !== 6">
                        {{ loading ? t('login.pruefe') : t('login.codeBestaetigen') }}
                    </Knopf>
                </form>
                <p v-if="arten.includes('totp') && arten.includes('schluessel')" class="login-oder">{{ t('login.oder') }}</p>
                <Knopf v-if="arten.includes('schluessel')" :art="arten.includes('totp') ? 'normal' : 'haupt'" class="login-btn"
                    symbol="schluessel" :laedt="tippen" @click="mitSchluessel('zweit')">
                    {{ t('login.schluesselAntippen') }}
                </Knopf>
                <div v-if="error" class="login-error login-abstand">{{ error }}</div>
                <div v-if="info" class="login-info login-abstand">{{ info }}</div>
                <p v-if="!arten.length && status.schluesselAdresse" class="login-sub login-adresse">
                    {{ t('login.adressHinweisVor') }}
                    <a :href="status.schluesselAdresse">{{ status.schluesselAdresse }}</a>
                    {{ t('login.adressHinweisNach') }}
                </p>
                <p v-else-if="!arten.length" class="login-sub login-adresse">{{ t('login.adressHinweisOhne') }}</p>
                <button type="button" class="login-forgot" @click="zurueckZumPasswort()">{{ t('login.zurueck') }}</button>
            </template>

            <template v-else>
                <template v-if="schluesselDirekt">
                    <Knopf art="haupt" class="login-btn" symbol="schluessel" :laedt="tippen" @click="mitSchluessel('direkt')">
                        {{ t('login.mitSchluessel') }}
                    </Knopf>
                    <p class="login-oder">{{ t('login.oderPasswort') }}</p>
                </template>
                <form @submit.prevent="submit">
                    <input
                        v-model="password"
                        type="password"
                        class="at-feld login-input"
                        :placeholder="setup ? 'Neues Passwort (min. 10 Zeichen)' : 'Passwort'"
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
                    <template v-if="setup && codeNoetig">
                        <input
                            v-model="code"
                            type="text"
                            class="at-feld login-input"
                            placeholder="Einrichtungscode (Server-Log)"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <p class="login-sub login-code-hinweis">
                            Der Code steht im Protokoll des Servers bzw. Containers
                            („Einrichtungscode für das erste Passwort").
                        </p>
                    </template>
                    <div v-if="error" class="login-error">{{ error }}</div>
                    <div v-if="info" class="login-info">{{ info }}</div>
                    <Knopf type="submit" :art="schluesselDirekt ? 'normal' : 'haupt'" class="login-btn" :disabled="loading || !password">
                        {{ loading ? (setup ? 'Speichern…' : 'Anmelden…') : (setup ? 'Passwort festlegen' : 'Anmelden') }}
                    </Knopf>
                </form>
                <p v-if="adressHinweis && status.schluesselAdresse" class="login-sub login-adresse">
                    {{ t('login.adressHinweisVor') }}
                    <a :href="status.schluesselAdresse">{{ status.schluesselAdresse }}</a>
                    {{ t('login.adressHinweisNach') }}
                </p>
                <p v-else-if="adressHinweis" class="login-sub login-adresse">{{ t('login.adressHinweisOhne') }}</p>
                <input
                    v-if="!setup && resetCodeFeld"
                    v-model="resetCode"
                    type="text"
                    class="at-feld login-input login-reset-code"
                    placeholder="Rücksetzcode (Server-Log)"
                    aria-label="Rücksetzcode aus dem Server-Log"
                    autocomplete="off"
                    spellcheck="false"
                />
                <button v-if="!setup" type="button" class="login-forgot" :disabled="resetting" @click="forgotPassword">
                    {{ resetting ? 'Zurücksetzen…' : (resetCodeFeld ? 'Zurücksetzen' : 'Passwort vergessen?') }}
                </button>
            </template>
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
.login-reset-code {
    margin: 1rem 0 0;
}
.login-code-hinweis {
    margin: -0.5rem 0 1rem;
    font-size: 0.78rem;
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
.login-code {
    text-align: center;
    font-size: 1.3rem;
    letter-spacing: 0.3em;
}
.login-oder {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0.75rem 0;
}
.login-abstand {
    margin-top: 0.75rem;
}
.login-adresse {
    margin: 1rem 0 0;
    font-size: 0.8rem;
}
.login-adresse a {
    color: var(--accent);
    word-break: break-all;
}
</style>
