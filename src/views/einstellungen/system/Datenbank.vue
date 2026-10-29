<script setup>
/**
 * System → Datenbank (SQLite/PostgreSQL, Neustart) und, als eigener
 * Abschnitt, Sicherung (Export und Import) — die stand bis 10/2026 versteckt
 * am Ende des Datenbank-Abschnitts.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '@/components/InfoTipp.vue'
import { Knopf, Pille, Eingabe } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'

const { t } = useI18n()

let dbExpanded = ref(false)

const DB_TYPEN = computed(() => [
    { wert: 'sqlite', text: t('settings.sqliteLocal') },
    { wert: 'postgresql', text: t('settings.postgresRemote') },
])

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
let sicherungOffen = ref(false)
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
            dbSaveResult.value = { ok: false, message: t('settings.neustartNurLokal') }
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
    <!--=============== DATENBANK ===============-->
    <Abschnitt v-model:offen="dbExpanded" :titel="t('settings.database')" symbol="ebenen">
        <template #kopf>
            <Pille :ton="dbType === 'postgresql' ? 'akzent' : 'neutral'">
                {{ dbType === 'postgresql' ? 'PostgreSQL' : 'SQLite' }}
            </Pille>
        </template>

        <p class="hinweis">{{ t('settings.dbDescription') }}</p>

        <Feld :label="t('settings.dbType')">
            <Eingabe v-model="dbType" art="auswahl" :optionen="DB_TYPEN" />
        </Feld>

        <!-- PostgreSQL-Felder -->
        <template v-if="dbType === 'postgresql'">
            <Feld :label="t('settings.hostLabel')">
                <Eingabe v-model="dbHost" :platzhalter="t('settings.hostPlaceholder')" />
            </Feld>
            <Feld>
                <template #label>
                    <span class="label">{{ t('settings.portLabel') }}<InfoTipp schluessel="settings.info.dbPort" /></span>
                </template>
                <Eingabe v-model="dbPort" art="number" platzhalter="5432" />
            </Feld>
            <Feld :label="t('settings.user')">
                <Eingabe v-model="dbUser" platzhalter="tradejournal" />
            </Feld>
            <Feld :label="t('settings.password')">
                <Eingabe v-model="dbPassword" art="password"
                    :platzhalter="dbHasPassword ? t('settings.passwordSaved') : t('settings.password')" />
            </Feld>
            <Feld :label="t('settings.databaseName')">
                <Eingabe v-model="dbDatabase" platzhalter="tradejournal" />
            </Feld>
        </template>

        <!-- Buttons -->
        <div class="knoepfe">
            <Knopf art="haupt" @click="saveDbConfig">{{ t('common.save') }}</Knopf>
            <Knopf v-if="dbType === 'postgresql'" :laedt="dbTestLoading" @click="testDbConnection">
                {{ dbTestLoading ? t('common.testing') : t('common.testConnection') }}
            </Knopf>
            <span v-if="dbTestResult" class="meldung" :class="dbTestResult.ok ? 'gut' : 'schlecht'">
                {{ dbTestResult.message }}
            </span>
            <span v-if="dbSaveResult" class="meldung" :class="dbSaveResult.ok ? 'gut' : 'schlecht'">
                {{ dbSaveResult.message }}
            </span>
        </div>

        <div v-if="dbSaveResult?.ok" class="knoepfe">
            <Knopf klein symbol="aktualisieren" :laedt="dbRestartLoading" @click="restartServer">
                {{ dbRestartLoading ? t('settings.serverRestarting') : t('settings.restartServerBtn') }}
            </Knopf>
        </div>

        <!-- Wo PostgreSQL laufen kann, wenn kein eigener Server da ist — bewusst ohne Anbieternamen -->
        <p v-if="dbType === 'postgresql'" class="hinweis hosting">{{ t('settings.pgHosting') }}</p>
    </Abschnitt>

    <!--=============== SICHERUNG ===============-->
    <Abschnitt v-model:offen="sicherungOffen" kennung="sicherung" :titel="t('settings.backup')" symbol="herunterladen">
        <div>
            <p class="hinweis">{{ t('settings.backupDescription') }}</p>
            <div class="knoepfe">
                <Knopf klein symbol="download" :laedt="dbExportLoading" @click="exportDb">
                    {{ dbExportLoading ? t('settings.exporting') : t('settings.export') }}
                </Knopf>
                <Knopf klein symbol="eingang" :laedt="dbImportLoading" @click="importDb">
                    {{ dbImportLoading ? t('settings.importingData') : t('settings.import') }}
                </Knopf>
            </div>
            <p v-if="dbMigrationResult" class="meldung" :class="dbMigrationResult.ok ? 'gut' : 'schlecht'">
                {{ dbMigrationResult.message }}
            </p>
        </div>
    </Abschnitt>
</template>

<style scoped>
.hinweis {
    margin: 0 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.88rem;
}
.label { color: var(--text); }
.hosting { margin-top: var(--abstand-3); }
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.meldung {
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
}
.knoepfe .meldung { margin: 0; }
.meldung.gut { color: var(--good); }
.meldung.schlecht { color: var(--bad); }
</style>
