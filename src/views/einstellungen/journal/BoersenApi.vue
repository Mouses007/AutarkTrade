<script setup>
/** Journal → API-Anbindung: Bitunix, Bitget, Pionex (Schlüssel, Test, Import ab Datum). */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { currentUser } from '@/stores/settings.js'
import { useQuickApiImport } from '@/utils/quickImport.js'
import { sendNotification } from '@/utils/notify.js'

const { t } = useI18n()

let apiExpanded = ref(false)

let bitunixApiKey = ref('')
let bitunixSecretKey = ref('')
let bitunixImportStartDate = ref('')
let bitunixTestResult = ref(null)
let bitunixTestLoading = ref(false)

let bitgetApiKey = ref('')
let bitgetSecretKey = ref('')
let bitgetPassphrase = ref('')
let bitgetImportStartDate = ref('')
let bitgetTestResult = ref(null)
let bitgetTestLoading = ref(false)
let bitunixSubExpanded = ref(false)
let bitgetSubExpanded = ref(false)

/*
 * Börsen, deren Schlüssel die Börse zurückweist.
 *
 * Gelesen aus `settings.boersenStatus`, geschrieben ausschliesslich vom Server
 * (`server/boersen-status.js`). Die Anzeige steht hier, weil hier der neue
 * Schlüssel eingetragen wird — und verschwindet von selbst, sobald ein Abruf
 * wieder gelingt.
 */
const BOERSEN_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const boersenZugangKaputt = computed(() => {
    let st = {}
    try { st = JSON.parse(currentUser.value?.boersenStatus || '{}') } catch { st = {} }
    return Object.entries(st)
        .filter(([, v]) => v?.kaputt)
        .map(([broker, v]) => ({
            broker,
            name: BOERSEN_NAME[broker] || broker,
            meldung: v.meldung || '',
            seitText: v.seit ? dayjs(Number(v.seit)).format('DD.MM.YYYY HH:mm') : '—',
        }))
})

/* BITUNIX API */
async function loadBitunixConfig() {
    try {
        const response = await axios.get('/api/bitunix/config')
        bitunixApiKey.value = response.data.apiKey || ''
        bitunixImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            bitunixSecretKey.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Bitunix config: ' + error)
    }
}

async function saveBitunixConfig() {
    try {
        const data = { apiKey: bitunixApiKey.value, apiImportStartDate: bitunixImportStartDate.value }
        if (bitunixSecretKey.value && bitunixSecretKey.value !== '••••••••') {
            data.secretKey = bitunixSecretKey.value
        }
        await axios.post('/api/bitunix/config', data)
        alert(t('settings.bitunixSaved'))
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

async function testBitunixConnection() {
    bitunixTestLoading.value = true
    bitunixTestResult.value = null
    try {
        const response = await axios.post('/api/bitunix/test')
        if (response.data.ok) {
            bitunixTestResult.value = 'success'
        } else {
            bitunixTestResult.value = 'error'
        }
    } catch (error) {
        bitunixTestResult.value = 'error'
    }
    bitunixTestLoading.value = false
}

/* BITGET API */
async function loadBitgetConfig() {
    try {
        const response = await axios.get('/api/bitget/config')
        bitgetApiKey.value = response.data.apiKey || ''
        bitgetImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            bitgetSecretKey.value = '••••••••'
        }
        if (response.data.hasPassphrase) {
            bitgetPassphrase.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Bitget config: ' + error)
    }
}

const bitgetImporting = ref(false)

async function saveBitgetConfig() {
    try {
        const data = { apiKey: bitgetApiKey.value, apiImportStartDate: bitgetImportStartDate.value }
        if (bitgetSecretKey.value && bitgetSecretKey.value !== '••••••••') {
            data.secretKey = bitgetSecretKey.value
        }
        if (bitgetPassphrase.value && bitgetPassphrase.value !== '••••••••') {
            data.passphrase = bitgetPassphrase.value
        }
        await axios.post('/api/bitget/config', data)
        alert(t('settings.bitgetSaved'))

        // Auto-trigger historical import if start date is set
        if (bitgetImportStartDate.value) {
            bitgetImporting.value = true
            try {
                const result = await useQuickApiImport('bitget')
                if (result.count > 0) {
                    sendNotification('importFertig', 'Bitget Import', result.message || t('messages.importCount', { count: result.count }))
                } else {
                    sendNotification('importFertig', 'Bitget Import', result.message || t('messages.noNewTrades'))
                }
            } catch (importError) {
                console.log(' -> Bitget auto-import error:', importError.message)
                sendNotification('importFertig', 'Bitget Import', t('messages.importFailed') + (importError.response?.data?.error || importError.message))
            }
            bitgetImporting.value = false
        }
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

let bitgetTestError = ref('')

async function testBitgetConnection() {
    bitgetTestLoading.value = true
    bitgetTestResult.value = null
    bitgetTestError.value = ''
    try {
        const response = await axios.post('/api/bitget/test')
        if (response.data.ok) {
            bitgetTestResult.value = 'success'
        } else {
            bitgetTestResult.value = 'error'
            bitgetTestError.value = response.data.error || t('settings.unknownError')
        }
    } catch (error) {
        bitgetTestResult.value = 'error'
        bitgetTestError.value = error.response?.data?.error || error.message || t('common.connectionFailed')
    }
    bitgetTestLoading.value = false
}

/* ==================== PIONEX ==================== */
let pionexApiKey = ref('')
let pionexSecretKey = ref('')
let pionexImportStartDate = ref('')
let pionexTestResult = ref(null)
let pionexTestLoading = ref(false)
let pionexTestError = ref('')
let pionexSubExpanded = ref(false)
const pionexImporting = ref(false)

async function loadPionexConfig() {
    try {
        const response = await axios.get('/api/pionex/config')
        pionexApiKey.value = response.data.apiKey || ''
        pionexImportStartDate.value = response.data.apiImportStartDate || ''
        if (response.data.hasSecret) {
            pionexSecretKey.value = '••••••••'
        }
    } catch (error) {
        console.log(' -> Error loading Pionex config: ' + error)
    }
}

async function savePionexConfig() {
    try {
        const data = { apiKey: pionexApiKey.value, apiImportStartDate: pionexImportStartDate.value }
        if (pionexSecretKey.value && pionexSecretKey.value !== '••••••••') {
            data.secretKey = pionexSecretKey.value
        }
        await axios.post('/api/pionex/config', data)
        alert(t('settings.pionexSaved'))

        // Auto-Import wenn Startdatum gesetzt
        if (pionexImportStartDate.value) {
            pionexImporting.value = true
            try {
                const result = await useQuickApiImport('pionex')
                if (result.count > 0) {
                    sendNotification('importFertig', 'Pionex Import', result.message || t('messages.importCount', { count: result.count }))
                } else {
                    sendNotification('importFertig', 'Pionex Import', result.message || t('messages.noNewTrades'))
                }
            } catch (importError) {
                console.log(' -> Pionex auto-import error:', importError.message)
                sendNotification('importFertig', 'Pionex Import', t('messages.importFailed') + (importError.response?.data?.error || importError.message))
            }
            pionexImporting.value = false
        }
    } catch (error) {
        alert(t('settings.savingConfigError') + error.message)
    }
}

async function testPionexConnection() {
    pionexTestLoading.value = true
    pionexTestResult.value = null
    pionexTestError.value = ''
    try {
        const response = await axios.post('/api/pionex/test')
        if (response.data.ok) {
            pionexTestResult.value = 'success'
        } else {
            pionexTestResult.value = 'error'
            pionexTestError.value = response.data.error || t('settings.unknownError')
        }
    } catch (error) {
        pionexTestResult.value = 'error'
        pionexTestError.value = error.response?.data?.error || error.message || t('common.connectionFailed')
    }
    pionexTestLoading.value = false
}

// Query-Parameter: ?section=api → API-Sektion aufklappen
const urlParams = new URLSearchParams(window.location.search)
if (urlParams.get('section') === 'api') {
    apiExpanded.value = true
    bitunixSubExpanded.value = true
    bitgetSubExpanded.value = true
}

onMounted(async () => {
    await loadBitunixConfig()
    await loadBitgetConfig()
    await loadPionexConfig()
})
</script>

<template>
    <div>
        <hr />

        <!--=============== API ANBINDUNG ===============-->
        <div class="d-flex align-items-center pointerClass" @click="apiExpanded = !apiExpanded">
            <i class="uil me-2" :class="apiExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.apiConnection') }}</p>
        </div>
        <div v-show="apiExpanded" class="mt-2 ms-3">
            <p class="fw-lighter">{{ t('settings.apiConnectionDescription') }}</p>

            <!-- Zugang abgelehnt: der Server merkt es beim Abrufen, die Meldung
                 gehört dorthin, wo der neue Schlüssel eingetragen wird. -->
            <div v-for="z in boersenZugangKaputt" :key="'zugang_' + z.broker"
                 class="alert alert-warning py-2 px-3">
                <i class="uil uil-key-skeleton me-1"></i>
                <strong>{{ t('settings.zugangAbgelehnt', { boerse: z.name }) }}</strong>
                <div class="small mt-1 opacity-75">{{ z.meldung }}</div>
                <div class="small">{{ t('settings.zugangSeit', { zeit: z.seitText }) }}</div>
            </div>

            <!-- BITUNIX -->
            <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitunixSubExpanded = !bitunixSubExpanded"
                    style="background-color: var(--black-bg-5);">
                    <i class="uil me-2" :class="bitunixSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <strong>Bitunix</strong>
                    <span v-if="bitunixApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                </div>
                <div v-show="bitunixSubExpanded" class="row align-items-center px-3 py-3">
                    <div class="row mt-1">
                        <div class="col-12 col-md-4">{{ t('settings.apiKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="bitunixApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.secretKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="bitunixSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="date" class="form-control" v-model="bitunixImportStartDate" />
                            <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                        </div>
                    </div>
                    <div class="mt-3">
                        <button type="button" v-on:click="saveBitunixConfig" class="btn btn-success me-2">{{ t('common.save') }}</button>
                        <button type="button" v-on:click="testBitunixConnection" class="btn btn-outline-primary" :disabled="bitunixTestLoading">
                            <span v-if="bitunixTestLoading">{{ t('common.testing') }}</span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="bitunixTestResult === 'success'" class="ms-2 text-success">{{ t('common.connected') }}</span>
                        <span v-if="bitunixTestResult === 'error'" class="ms-2 text-danger">{{ t('common.connectionFailed') }}</span>
                    </div>
                </div>
            </div>

            <!-- BITGET -->
            <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                <div class="d-flex align-items-center pointerClass px-3 py-2" @click="bitgetSubExpanded = !bitgetSubExpanded"
                    style="background-color: var(--black-bg-5);">
                    <i class="uil me-2" :class="bitgetSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <strong>Bitget</strong>
                    <span v-if="bitgetApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                </div>
                <div v-show="bitgetSubExpanded" class="row align-items-center px-3 py-3">
                    <div class="row mt-1">
                        <div class="col-12 col-md-4">{{ t('settings.apiKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="bitgetApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.secretKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="bitgetSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.passphrase') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="bitgetPassphrase" :placeholder="t('settings.passphrasePlaceholder')" />
                            <small class="text-muted">{{ t('settings.passphraseHint') }}</small>
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="date" class="form-control" v-model="bitgetImportStartDate" />
                            <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                        </div>
                    </div>
                    <div class="mt-3">
                        <button type="button" v-on:click="saveBitgetConfig" class="btn btn-success me-2" :disabled="bitgetImporting">
                            <span v-if="bitgetImporting" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                            {{ bitgetImporting ? t('common.importing') : t('common.save') }}
                        </button>
                        <button type="button" v-on:click="testBitgetConnection" class="btn btn-outline-primary" :disabled="bitgetTestLoading">
                            <span v-if="bitgetTestLoading">{{ t('common.testing') }}</span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="bitgetTestResult === 'success'" class="ms-2 text-success"><i class="uil uil-check-circle"></i> {{ t('common.connected') }}</span>
                        <span v-if="bitgetTestResult === 'error'" class="ms-2 text-danger"><i class="uil uil-exclamation-triangle"></i> {{ t('common.failed') }}</span>
                    </div>
                    <div v-if="bitgetTestResult === 'error' && bitgetTestError" class="mt-2">
                        <div class="p-2" style="background: rgba(255,0,0,0.1); border-radius: var(--border-radius); font-size: 0.85rem;">
                            <strong>{{ t('common.error') }}:</strong> {{ bitgetTestError }}
                            <div v-if="bitgetTestError.includes('40012')" class="mt-2 text-muted" style="font-size: 0.8rem;">
                                <strong>{{ t('settings.possibleCausesLabel') }}</strong>
                                <ul class="mb-0 mt-1">
                                    <li>{{ t('settings.bitgetCauseWrongKeys') }}</li>
                                    <li>{{ t('settings.bitgetCauseIpWhitelist') }}</li>
                                    <li>{{ t('settings.bitgetCauseKeyType') }}</li>
                                    <li>{{ t('settings.bitgetCausePermissions') }}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- PIONEX -->
            <div class="mb-3" style="border: var(--border-subtle); border-radius: var(--border-radius); overflow: hidden;">
                <div class="d-flex align-items-center pointerClass px-3 py-2" @click="pionexSubExpanded = !pionexSubExpanded"
                    style="background-color: var(--black-bg-5);">
                    <i class="uil me-2" :class="pionexSubExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                    <strong>Pionex</strong>
                    <span v-if="pionexApiKey" class="ms-2 badge bg-success" style="font-size: 0.65rem;">{{ t('common.configured') }}</span>
                </div>
                <div v-show="pionexSubExpanded" class="row align-items-center px-3 py-3">
                    <div class="row mt-1">
                        <div class="col-12 col-md-4">{{ t('settings.apiKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="text" class="form-control" v-model="pionexApiKey" :placeholder="t('settings.apiKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.secretKeyLabel') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="password" class="form-control" v-model="pionexSecretKey" :placeholder="t('settings.secretKeyPlaceholder')" />
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-12 col-md-4">{{ t('settings.importFromDate') }}</div>
                        <div class="col-12 col-md-8">
                            <input type="date" class="form-control" v-model="pionexImportStartDate" />
                            <small class="text-muted">{{ t('settings.importFromDateHint') }}</small>
                        </div>
                    </div>
                    <div class="mt-3">
                        <button type="button" v-on:click="savePionexConfig" class="btn btn-success me-2" :disabled="pionexImporting">
                            <span v-if="pionexImporting" class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                            {{ pionexImporting ? t('common.importing') : t('common.save') }}
                        </button>
                        <button type="button" v-on:click="testPionexConnection" class="btn btn-outline-primary" :disabled="pionexTestLoading">
                            <span v-if="pionexTestLoading">{{ t('common.testing') }}</span>
                            <span v-else>{{ t('common.testConnection') }}</span>
                        </button>
                        <span v-if="pionexTestResult === 'success'" class="ms-2 text-success"><i class="uil uil-check-circle"></i> {{ t('common.connected') }}</span>
                        <span v-if="pionexTestResult === 'error'" class="ms-2 text-danger"><i class="uil uil-exclamation-triangle"></i> {{ t('common.failed') }}</span>
                    </div>
                    <div v-if="pionexTestResult === 'error' && pionexTestError" class="mt-2">
                        <div class="p-2" style="background: rgba(255,0,0,0.1); border-radius: var(--border-radius); font-size: 0.85rem;">
                            <strong>{{ t('common.error') }}:</strong> {{ pionexTestError }}
                            <div class="mt-2 text-muted" style="font-size: 0.8rem;">
                                <strong>{{ t('settings.possibleCausesLabel') }}</strong>
                                <ul class="mb-0 mt-1">
                                    <li>{{ t('settings.pionexCauseWrongKeys') }}</li>
                                    <li>{{ t('settings.pionexCauseIpWhitelist') }}</li>
                                    <li>{{ t('settings.pionexCausePermissions') }}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>
