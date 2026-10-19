<script setup>
/** Allgemein → Datenbank: SQLite/PostgreSQL, Neustart, Export und Import. */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '@/components/InfoTipp.vue'

const { t } = useI18n()

let dbExpanded = ref(false)
let pgProvidersExpanded = ref(false)

/* DATENBANK-KONFIGURATION */
let dbType = ref('sqlite')
let dbHost = ref('localhost')
let dbPort = ref(5432)
let dbUser = ref('tradejournal')
let dbPassword = ref('')
let dbDatabase = ref('tradejournal')
let dbHasPassword = ref(false)
let dbTestLoading = ref(false)
let dbTestResult = ref(null)
let dbSaveResult = ref(null)
let dbRestartLoading = ref(false)
let dbExportLoading = ref(false)
let dbImportLoading = ref(false)
let dbMigrationResult = ref(null)

async function loadDbConfig() {
    try {
        const res = await axios.get('/api/db-config')
        dbType.value = res.data.type || 'sqlite'
        if (res.data.type === 'postgresql') {
            dbHost.value = res.data.host || 'localhost'
            dbPort.value = res.data.port || 5432
            dbUser.value = res.data.user || 'tradejournal'
            dbDatabase.value = res.data.database || 'tradejournal'
            dbHasPassword.value = res.data.hasPassword || false
        }
    } catch (e) {
        console.error('Fehler beim Laden der DB-Konfiguration:', e)
    }
}

async function testDbConnection() {
    dbTestLoading.value = true
    dbTestResult.value = null
    try {
        const res = await axios.post('/api/db-config/test', {
            host: dbHost.value,
            port: dbPort.value,
            user: dbUser.value,
            password: dbPassword.value,
            database: dbDatabase.value
        })
        dbTestResult.value = res.data
    } catch (e) {
        dbTestResult.value = { ok: false, message: e.message }
    }
    dbTestLoading.value = false
}

async function saveDbConfig() {
    dbSaveResult.value = null
    try {
        const data = { type: dbType.value }
        if (dbType.value === 'postgresql') {
            data.host = dbHost.value
            data.port = dbPort.value
            data.user = dbUser.value
            data.password = dbPassword.value
            data.database = dbDatabase.value
        }
        const res = await axios.put('/api/db-config', data)
        dbSaveResult.value = { ok: true, message: res.data.message }
    } catch (e) {
        dbSaveResult.value = { ok: false, message: t('common.errorPrefix') + e.message }
    }
}

async function restartServer() {
    dbRestartLoading.value = true
    try {
        // Bestätigungs-Token holen (nur von localhost erlaubt) und mitsenden
        const { data: tok } = await axios.get('/api/restart/token')
        await axios.post('/api/restart', { confirmToken: tok?.token })
    } catch (e) {
        // Connection will drop during restart — that's expected.
        // 403 = nicht von localhost: Neustart muss lokal auf dem Server erfolgen.
        if (e.response?.status === 403) {
            dbRestartLoading.value = false
            dbSaveResult.value = { ok: false, message: 'Neustart nur direkt auf dem Server (localhost) möglich.' }
            return
        }
    }
    // Wait for server to come back
    let retries = 0
    while (retries < 20) {
        await new Promise(r => setTimeout(r, 1500))
        try {
            await axios.get('/api/db/settings')
            // Server is back — reload page to get new session cookie
            window.location.reload()
            return
        } catch (e) {
            retries++
        }
    }
    dbRestartLoading.value = false
    dbSaveResult.value = { ok: false, message: t('common.serverNotResponding') }
}

async function exportDb() {
    dbExportLoading.value = true
    dbMigrationResult.value = null
    try {
        const res = await axios.get('/api/db-export')
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `tradejournal-backup-${new Date().toISOString().slice(0,10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        dbMigrationResult.value = { ok: true, message: t('settings.exportSuccess') }
    } catch (e) {
        dbMigrationResult.value = { ok: false, message: t('settings.exportFailed') + e.message }
    }
    dbExportLoading.value = false
}

async function importDb() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        dbImportLoading.value = true
        dbMigrationResult.value = null
        try {
            const text = await file.text()
            const data = JSON.parse(text)
            const res = await axios.post('/api/db-import', data, {
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            })
            if (res.data.ok) {
                const counts = Object.entries(res.data.imported).map(([t, n]) => `${t}: ${n}`).join(', ')
                dbMigrationResult.value = { ok: true, message: t('settings.importSuccess', { counts }) }
            } else {
                dbMigrationResult.value = { ok: false, message: res.data.error || t('settings.importFailed') }
            }
        } catch (e) {
            dbMigrationResult.value = { ok: false, message: t('settings.importFailed') + ': ' + e.message }
        }
        dbImportLoading.value = false
    }
    input.click()
}

onMounted(loadDbConfig)
</script>

<template>
    <div>
        <hr />

        <!--=============== DATENBANK ===============-->
        <div class="d-flex align-items-center pointerClass" @click="dbExpanded = !dbExpanded">
            <i class="uil me-2" :class="dbExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.database') }}</p>
            <span class="badge ms-2" :class="dbType === 'postgresql' ? 'bg-primary' : 'bg-secondary'">
                {{ dbType === 'postgresql' ? 'PostgreSQL' : 'SQLite' }}
            </span>
        </div>
        <div v-show="dbExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.dbDescription') }}</p>

            <!-- DB-Typ -->
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.dbType') }}</div>
                <div class="col-12 col-md-8">
                    <select class="form-select" v-model="dbType">
                        <option value="sqlite">{{ t('settings.sqliteLocal') }}</option>
                        <option value="postgresql">{{ t('settings.postgresRemote') }}</option>
                    </select>
                </div>
            </div>

            <!-- PostgreSQL Provider-Info -->
            <div v-if="dbType === 'postgresql'" class="mt-3 p-3" style="background: var(--black-bg-2); border-radius: var(--border-radius); border: 1px solid var(--white-10);">
                <div class="d-flex align-items-center pointerClass" @click="pgProvidersExpanded = !pgProvidersExpanded">
                    <i class="uil me-1" :class="pgProvidersExpanded ? 'uil-angle-down' : 'uil-angle-right'" style="font-size: 1.1rem;"></i>
                    <span class="fw-bold small"><i class="uil uil-info-circle me-1"></i>{{ t('settings.pgProviderTitle') }}</span>
                </div>
                <div v-show="pgProvidersExpanded" class="mt-2">
                    <p class="fw-lighter small mb-2">{{ t('settings.pgProviderDesc') }}</p>
                    <table class="table table-sm table-borderless mb-0" style="font-size: 0.82rem;">
                        <thead>
                            <tr style="color: var(--white-50);">
                                <th>{{ t('settings.pgProvider') }}</th>
                                <th>{{ t('settings.freeTierCol') }}</th>
                                <th>{{ t('settings.pgFeature') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><a href="https://neon.tech" target="_blank" class="text-decoration-none">Neon <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                <td>512 MB</td>
                                <td>Branching, Autoscaling</td>
                            </tr>
                            <tr>
                                <td><a href="https://supabase.com" target="_blank" class="text-decoration-none">Supabase <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                <td>500 MB</td>
                                <td>Auth, API, Realtime</td>
                            </tr>
                            <tr>
                                <td><a href="https://aiven.io" target="_blank" class="text-decoration-none">Aiven <i class="uil uil-external-link-alt" style="font-size: 0.75rem;"></i></a></td>
                                <td>1 GB</td>
                                <td>{{ t('settings.pgAivenFeature') }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- PostgreSQL-Felder -->
            <template v-if="dbType === 'postgresql'">
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.hostLabel') }}</div>
                    <div class="col-12 col-md-8">
                        <input type="text" class="form-control" v-model="dbHost" :placeholder="t('settings.hostPlaceholder')" />
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.portLabel') }}<InfoTipp schluessel="settings.info.dbPort" /></div>
                    <div class="col-12 col-md-8">
                        <input type="number" class="form-control" v-model="dbPort" placeholder="5432" />
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.user') }}</div>
                    <div class="col-12 col-md-8">
                        <input type="text" class="form-control" v-model="dbUser" placeholder="tradejournal" />
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.password') }}</div>
                    <div class="col-12 col-md-8">
                        <input type="password" class="form-control" v-model="dbPassword" :placeholder="dbHasPassword ? t('settings.passwordSaved') : t('settings.password')" />
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-12 col-md-4">{{ t('settings.databaseName') }}</div>
                    <div class="col-12 col-md-8">
                        <input type="text" class="form-control" v-model="dbDatabase" placeholder="tradejournal" />
                    </div>
                </div>
            </template>

            <!-- Buttons -->
            <div class="mt-3 mb-3">
                <button type="button" @click="saveDbConfig" class="btn btn-success me-2">{{ t('common.save') }}</button>
                <button v-if="dbType === 'postgresql'" type="button" @click="testDbConnection" class="btn btn-outline-primary" :disabled="dbTestLoading">
                    <span v-if="dbTestLoading">
                        <span class="spinner-border spinner-border-sm me-1"></span>{{ t('common.testing') }}
                    </span>
                    <span v-else>{{ t('common.testConnection') }}</span>
                </button>
                <span v-if="dbTestResult" class="ms-2" :class="dbTestResult.ok ? 'text-success' : 'text-danger'">
                    {{ dbTestResult.message }}
                </span>
                <span v-if="dbSaveResult" class="ms-2" :class="dbSaveResult.ok ? 'text-success' : 'text-danger'">
                    {{ dbSaveResult.message }}
                </span>
            </div>

            <div v-if="dbSaveResult?.ok" class="mt-2">
                <button type="button" @click="restartServer" class="btn btn-warning btn-sm" :disabled="dbRestartLoading">
                    <span v-if="dbRestartLoading">
                        <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.serverRestarting') }}
                    </span>
                    <span v-else><i class="uil uil-redo me-1"></i>{{ t('settings.restartServerBtn') }}</span>
                </button>
            </div>

            <!-- Export / Import -->
            <div class="mt-3 pt-3" style="border-top: 1px solid var(--white-10);">
                <p class="fw-bold mb-2">{{ t('settings.backup') }}</p>
                <p class="fw-lighter small">{{ t('settings.backupDescription') }}</p>
                <div class="d-flex align-items-center gap-2">
                    <button type="button" @click="exportDb" class="btn btn-outline-primary btn-sm" :disabled="dbExportLoading">
                        <span v-if="dbExportLoading">
                            <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.exporting') }}
                        </span>
                        <span v-else><i class="uil uil-export me-1"></i>{{ t('settings.export') }}</span>
                    </button>
                    <button type="button" @click="importDb" class="btn btn-outline-warning btn-sm" :disabled="dbImportLoading">
                        <span v-if="dbImportLoading">
                            <span class="spinner-border spinner-border-sm me-1"></span>{{ t('settings.importingData') }}
                        </span>
                        <span v-else><i class="uil uil-import me-1"></i>{{ t('settings.import') }}</span>
                    </button>
                </div>
                <span v-if="dbMigrationResult" class="small mt-1 d-block" :class="dbMigrationResult.ok ? 'text-success' : 'text-danger'">
                    {{ dbMigrationResult.message }}
                </span>
            </div>
        </div>

    </div>
</template>
