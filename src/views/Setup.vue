<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Kreisel from '@/components/basis/Kreisel.vue'
import Symbol from '@/components/basis/Symbol.vue'

const { t } = useI18n()
const router = useRouter()

const step = ref(1)
const dbType = ref('sqlite')
const pgHost = ref('localhost')
const pgPort = ref(5432)
const pgUser = ref('postgres')
const pgPassword = ref('')
const pgDatabase = ref('tradejournal')
const testResult = ref(null)
const testLoading = ref(false)
const saving = ref(false)
const error = ref('')
const restarting = ref(false)

// Pruefen ob Setup bereits abgeschlossen
onMounted(async () => {
    try {
        const { data } = await axios.get('/api/setup/status')
        if (data.setupComplete) {
            router.replace('/dashboard')
        }
    } catch (e) {
        // ignore — proceed with setup
    }
})

async function testConnection() {
    testLoading.value = true
    testResult.value = null
    try {
        const { data } = await axios.post('/api/db-config/test', {
            host: pgHost.value,
            port: pgPort.value,
            user: pgUser.value,
            password: pgPassword.value,
            database: pgDatabase.value
        })
        testResult.value = data
    } catch (e) {
        testResult.value = { ok: false, message: t('common.connectionError') + (e.response?.data?.message || e.message) }
    }
    testLoading.value = false
}

async function saveDbConfig() {
    error.value = ''
    try {
        if (dbType.value === 'postgresql') {
            await axios.put('/api/db-config', {
                type: 'postgresql',
                host: pgHost.value,
                port: pgPort.value,
                user: pgUser.value,
                password: pgPassword.value,
                database: pgDatabase.value
            })
        } else {
            await axios.put('/api/db-config', { type: 'sqlite' })
        }
    } catch (e) {
        error.value = t('common.errorSaving') + (e.response?.data?.error || e.message)
    }
}

async function nextStep() {
    if (step.value === 1) {
        step.value = 2
    } else if (step.value === 2) {
        // DB-Config speichern
        saving.value = true
        await saveDbConfig()
        saving.value = false
        if (!error.value) {
            step.value = 3
        }
    }
}

async function completeSetup() {
    saving.value = true
    try {
        await axios.post('/api/setup/complete')
        // Bei PostgreSQL-Wechsel: Neustart-Hinweis
        if (dbType.value === 'postgresql') {
            step.value = 4 // Neustart-Schritt
        } else {
            // Reload damit Router setupComplete neu lädt; direkt weiter zu den
            // Onboarding-Schritten (Standardeinstellungen/KI/News/Mail).
            window.location.href = '/update-assistent?kontext=setup'
        }
    } catch (e) {
        error.value = t('common.errorPrefix') + (e.response?.data?.error || e.message)
    }
    saving.value = false
}

/** Setup als abgeschlossen markieren und zum Dashboard (für Nutzer, die schon alles konfiguriert haben). */
async function skipSetup() {
    saving.value = true
    error.value = ''
    try {
        await axios.post('/api/setup/complete')
        // Vollständiger Reload, damit der Router setupComplete neu lädt und nicht mehr zu /setup umleitet
        window.location.href = '/update-assistent?kontext=setup'
    } catch (e) {
        error.value = t('common.errorPrefix') + (e.response?.data?.error || e.message)
    }
    saving.value = false
}

async function restartServer() {
    restarting.value = true
    try {
        await axios.post('/api/restart')
    } catch (e) {
        // Connection drops during restart — expected
    }
    // Wait for server to come back, then redirect
    const checkServer = async () => {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000))
            try {
                await axios.get('/api/setup/status')
                window.location.href = '/update-assistent?kontext=setup'
                return
            } catch (e) { /* still restarting */ }
        }
        // Fallback: just reload
        window.location.reload()
    }
    checkServer()
}
</script>

<template>
    <div class="setup-container">
        <div class="setup-card">
            <!-- Header -->
            <div class="setup-header">
                <img src="@/assets/icon.png" alt="AutarkTrade" class="setup-logo" onerror="this.style.display='none'" />
                <h2>AutarkTrade</h2>
                <!-- Step indicator -->
                <div class="step-indicator">
                    <div class="step-dot" :class="{ active: step >= 1, done: step > 1 }">1</div>
                    <div class="step-line" :class="{ active: step > 1 }"></div>
                    <div class="step-dot" :class="{ active: step >= 2, done: step > 2 }">2</div>
                    <div class="step-line" :class="{ active: step > 2 }"></div>
                    <div class="step-dot" :class="{ active: step >= 3 }">3</div>
                </div>
            </div>

            <!-- Step 1: Willkommen -->
            <div v-if="step === 1" class="setup-body">
                <h3>{{ t('setup.welcome') }}</h3>
                <p class="at-gedaempft">
                    {{ t('setup.welcomeText') }}
                </p>
                <div class="feature-list">
                    <div class="feature-item">
                        <Symbol name="linie" class="feature-symbol" />
                        <div>
                            <strong>{{ t('setup.featureAnalysis') }}</strong>
                            <small>{{ t('setup.featureDashboard') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <Symbol name="buch" class="feature-symbol" />
                        <div>
                            <strong>{{ t('setup.featureJournal') }}</strong>
                            <small>{{ t('setup.featureDiary') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <Symbol name="ki" class="feature-symbol" />
                        <div>
                            <strong>{{ t('setup.featureAiReports') }}</strong>
                            <small>{{ t('setup.featureKi') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <Symbol name="herunterladen" class="feature-symbol" />
                        <div>
                            <strong>{{ t('setup.featureBitunixImport') }}</strong>
                            <small>{{ t('setup.featureImport') }}</small>
                        </div>
                    </div>
                </div>
                <Knopf art="haupt" class="setup-gross at-voll at-mo-4" @click="nextStep">
                    {{ t('common.next') }} <Symbol name="pfeilRechts" />
                </Knopf>
                <p class="at-mo-3 at-mu-0 at-mittig">
                    <Knopf art="leise" klein @click="skipSetup">
                        {{ t('setup.skipSetup') }}
                    </Knopf>
                </p>
            </div>

            <!-- Step 2: Datenbank waehlen -->
            <div v-if="step === 2" class="setup-body">
                <h3>{{ t('setup.chooseDatabase') }}</h3>
                <p class="at-gedaempft at-mu-3">
                    {{ t('setup.chooseDatabaseText') }}
                </p>

                <!-- SQLite -->
                <div class="db-option" :class="{ selected: dbType === 'sqlite' }" @click="dbType = 'sqlite'">
                    <div class="db-option-header">
                        <label class="at-check" for="dbSqlite">
                            <input type="radio" v-model="dbType" value="sqlite" id="dbSqlite">
                            <strong>SQLite</strong>
                            <Pille>{{ t('setup.recommended') }}</Pille>
                        </label>
                    </div>
                    <p class="db-text">
                        {{ t('setup.sqliteDescription') }}
                    </p>
                </div>

                <!-- PostgreSQL -->
                <div class="db-option at-mo-3" :class="{ selected: dbType === 'postgresql' }" @click="dbType = 'postgresql'">
                    <div class="db-option-header">
                        <label class="at-check" for="dbPg">
                            <input type="radio" v-model="dbType" value="postgresql" id="dbPg">
                            <strong>PostgreSQL</strong>
                        </label>
                    </div>
                    <p class="db-text">
                        {{ t('setup.postgresDescription') }}
                    </p>

                    <!-- PostgreSQL Felder -->
                    <div v-if="dbType === 'postgresql'" class="pg-fields">
                        <div class="pg-zeile">
                            <div class="pg-breit">
                                <label class="at-label">{{ t('settings.host') }}</label>
                                <input type="text" class="at-feld klein" v-model="pgHost" placeholder="localhost">
                            </div>
                            <div class="pg-schmal">
                                <label class="at-label">{{ t('settings.port') }}</label>
                                <input type="number" class="at-feld klein" v-model="pgPort" placeholder="5432">
                            </div>
                        </div>
                        <div class="pg-zeile at-mo-1">
                            <div class="pg-halb">
                                <label class="at-label">{{ t('settings.user') }}</label>
                                <input type="text" class="at-feld klein" v-model="pgUser" placeholder="postgres">
                            </div>
                            <div class="pg-halb">
                                <label class="at-label">{{ t('settings.password') }}</label>
                                <input type="password" class="at-feld klein" v-model="pgPassword" :placeholder="t('settings.password')">
                            </div>
                        </div>
                        <div class="at-mo-2">
                            <label class="at-label">{{ t('settings.databaseName') }}</label>
                            <input type="text" class="at-feld klein" v-model="pgDatabase" placeholder="tradejournal">
                        </div>
                        <Knopf klein class="at-mo-2" :laedt="testLoading" @click.stop="testConnection">
                            {{ t('common.testConnection') }}
                        </Knopf>
                        <div v-if="testResult" class="at-mo-2">
                            <div v-if="testResult.ok" class="at-gut at-klein">
                                <Symbol name="hakenKreis" /> {{ testResult.message }}
                            </div>
                            <div v-else class="at-schlecht at-klein">
                                <Symbol name="warnung" /> {{ testResult.message }}
                            </div>
                        </div>
                    </div>
                </div>

                <Hinweis v-if="error" art="fehler" class="at-mo-3">{{ error }}</Hinweis>

                <div class="at-flex at-luecke-2 at-mo-4">
                    <Knopf symbol="pfeilLinks" @click="step = 1">
                        {{ t('common.back') }}
                    </Knopf>
                    <Knopf art="haupt" class="at-wachsen" :laedt="saving" @click="nextStep">
                        {{ t('common.next') }} <Symbol name="pfeilRechts" />
                    </Knopf>
                </div>
            </div>

            <!-- Step 3: Fertig -->
            <div v-if="step === 3" class="setup-body at-mittig">
                <div class="success-icon">
                    <Symbol name="hakenKreis" />
                </div>
                <h3>{{ t('setup.setupComplete') }}</h3>
                <p class="at-gedaempft">
                    {{ t('setup.configSaved') }}
                    <span v-if="dbType === 'sqlite'">{{ t('setup.sqliteAutoCreated') }}</span>
                    <span v-else>{{ t('setup.postgresUsedOnRestart') }}</span>
                </p>

                <div class="next-steps">
                    <p class="at-klein at-gedaempft at-mu-2"><strong>{{ t('setup.nextSteps') }}</strong></p>
                    <ul class="at-klein at-gedaempft">
                        <li v-html="t('setup.nextStepSettings', { settings: '<strong>' + t('nav.settings') + '</strong>' })"></li>
                        <li v-html="t('setup.nextStepImport', { api: '<strong>' + t('setup.apiImportName') + '</strong>' })"></li>
                    </ul>
                </div>

                <Knopf art="haupt" class="setup-gross at-voll at-mo-3" :laedt="saving" @click="completeSetup">
                    {{ t('setup.goToDashboard') }} <Symbol name="pfeilRechts" />
                </Knopf>

                <Hinweis v-if="error" art="fehler" class="at-mo-3">{{ error }}</Hinweis>
            </div>

            <!-- Step 4: Neustart (nur bei PostgreSQL) -->
            <div v-if="step === 4" class="setup-body at-mittig">
                <div class="restart-icon">
                    <Symbol name="aktualisieren" />
                </div>
                <h3>{{ t('setup.serverRestartRequired') }}</h3>
                <p class="at-gedaempft">
                    {{ t('setup.postgresChosen') }}
                    {{ t('setup.restartServer') }}
                </p>
                <Knopf art="haupt" class="at-mo-3" :disabled="restarting" @click="restartServer">
                    <span v-if="restarting" class="at-iflex at-mitte at-luecke-1">
                        <Kreisel still />{{ t('settings.serverRestarting') }}
                    </span>
                    <span v-else class="at-iflex at-mitte at-luecke-1"><Symbol name="aktualisieren" />{{ t('settings.restartServerBtn') }}</span>
                </Knopf>
            </div>
        </div>
    </div>
</template>

<style scoped>
.setup-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    padding: 2rem;
}

.setup-card {
    background: var(--panel);
    border-radius: var(--radius);
    border: 1px solid var(--line);
    max-width: 520px;
    width: 100%;
    overflow: hidden;
}

.setup-header {
    text-align: center;
    padding: 2rem 2rem 1rem;
    border-bottom: 1px solid var(--line);
}

.setup-logo {
    width: 48px;
    height: 48px;
    margin-bottom: 0.5rem;
}

.setup-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 1rem;
}

.step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
}

.step-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    border: 2px solid var(--line-stark);
    color: var(--leise);
    transition: all 0.3s;
}

.step-dot.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-flaeche);
}

.step-dot.done {
    border-color: var(--good);
    color: var(--good);
    background: var(--good-flaeche);
}

.step-line {
    width: 40px;
    height: 2px;
    background: var(--line);
    transition: all 0.3s;
}

.step-line.active {
    background: var(--accent);
}

.setup-body {
    padding: 2rem;
}

.setup-body h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.5rem;
}

.setup-gross {
    padding: 0.75rem 1.1rem;
    font-size: 1.05rem;
}

.feature-list {
    margin-top: 1.5rem;
}

.feature-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--line);
}

.feature-item:last-child {
    border-bottom: none;
}

.feature-symbol {
    font-size: 1.5rem;
    color: var(--accent);
    flex-shrink: 0;
    margin-top: 2px;
}

.feature-item strong {
    display: block;
    color: var(--text);
    font-size: 0.9rem;
}

.feature-item small {
    color: var(--muted);
    font-size: 0.8rem;
}

.db-option {
    border: 2px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
}

.db-option:hover {
    border-color: var(--line-stark);
}

.db-option.selected {
    border-color: var(--accent);
    background: var(--accent-flaeche);
}

.db-text {
    margin: 0.25rem 0 0 1.5rem;
    font-size: 0.875em;
    color: var(--muted);
}

.pg-fields {
    margin: 1rem 0 0 1.5rem;
    border-top: 1px solid var(--line);
    padding-top: 0.75rem;
}

.pg-zeile {
    display: flex;
    gap: 0.5rem;
}

.pg-zeile > * {
    min-width: 0;
}

.pg-breit { flex: 2 1 0; }
.pg-schmal { flex: 1 1 0; }
.pg-halb { flex: 1 1 0; }

.success-icon {
    font-size: 4rem;
    line-height: 1;
    color: var(--good);
    margin-bottom: 0.5rem;
}

.restart-icon {
    font-size: 4rem;
    line-height: 1;
    color: var(--accent);
    margin-bottom: 0.5rem;
}

.next-steps {
    background: var(--bg);
    border-radius: var(--radius-knopf);
    padding: 1rem;
    margin-top: 1rem;
}

.next-steps ul {
    padding-left: 1.2rem;
    margin-bottom: 0;
    text-align: left;
}

.next-steps li {
    margin-bottom: 0.3rem;
}

@media (max-width: 575px) {
    .setup-container {
        padding: 1rem;
    }

    .setup-header {
        padding: 1.5rem 1rem 1rem;
    }

    .setup-body {
        padding: 1.25rem 1rem;
    }

    .db-text,
    .pg-fields {
        margin-left: 0;
    }

    .pg-zeile {
        flex-wrap: wrap;
    }

    .pg-breit,
    .pg-schmal,
    .pg-halb {
        flex-basis: 100%;
    }
}
</style>
