<script setup>
/** Journal → API-Anbindung: Bitunix, Bitget, Pionex (Schlüssel, Test, Import ab Datum). */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { appEinstellungen } from '@/stores/settings.js'
import { useQuickApiImport } from '@/utils/quickImport.js'
import { sendNotification } from '@/utils/notify.js'
import { vergissBoersenZugang } from '@/utils/boersenZugang.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Eingabe from '@/components/basis/Eingabe.vue'
import Symbol from '@/components/basis/Symbol.vue'
import MarktWahl from '@/components/portfolio/MarktWahl.vue'
import BitpandaZugang from '@/components/portfolio/BitpandaZugang.vue'

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
    try { st = JSON.parse(appEinstellungen.value?.boersenStatus || '{}') } catch { st = {} }
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
        vergissBoersenZugang()
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
        vergissBoersenZugang()
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
        vergissBoersenZugang()
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
    <Abschnitt :titel="t('settings.boersenKonten')" symbol="gebaeude" v-model:offen="apiExpanded">
        <p class="beschreibung">{{ t('settings.apiConnectionDescription') }}</p>

        <!-- Audit SEC-SRV-006: AutarkTrade sendet keine Orders (S13) — ein
             Schlüssel mit Handels- oder Auszahlungsrecht wäre nur Risiko. -->
        <Hinweis art="info" :titel="t('settings.nurLeserechteTitel')" class="zugang">
            {{ t('settings.nurLeserechteText') }}
        </Hinweis>

        <!-- Zugang abgelehnt: der Server merkt es beim Abrufen, die Meldung
             gehört dorthin, wo der neue Schlüssel eingetragen wird. -->
        <Hinweis v-for="z in boersenZugangKaputt" :key="'zugang_' + z.broker" art="warn"
            :titel="t('settings.zugangAbgelehnt', { boerse: z.name })" class="zugang">
            <span class="zugang-meldung">{{ z.meldung }}</span>
            <span class="zugang-seit">{{ t('settings.zugangSeit', { zeit: z.seitText }) }}</span>
        </Hinweis>

        <!-- BITUNIX -->
        <Abschnitt titel="Bitunix" unter v-model:offen="bitunixSubExpanded">
            <template #kopf>
                <Pille v-if="bitunixApiKey" ton="gut">{{ t('common.configured') }}</Pille>
            </template>
            <MarktWahl boerse="bitunix" />
            <div class="felder">
                <Eingabe v-model="bitunixApiKey" :label="t('settings.apiKeyLabel')" :platzhalter="t('settings.apiKeyPlaceholder')" />
                <Eingabe v-model="bitunixSecretKey" art="password" :label="t('settings.secretKeyLabel')" :platzhalter="t('settings.secretKeyPlaceholder')" />
                <Eingabe v-model="bitunixImportStartDate" art="date" :label="t('settings.importFromDate')" :hilfe="t('settings.importFromDateHint')" />
            </div>
            <div class="aktionen">
                <Knopf art="haupt" @click="saveBitunixConfig">{{ t('common.save') }}</Knopf>
                <Knopf :laedt="bitunixTestLoading" @click="testBitunixConnection">
                    {{ bitunixTestLoading ? t('common.testing') : t('common.testConnection') }}
                </Knopf>
                <span v-if="bitunixTestResult === 'success'" class="ergebnis gut"><Symbol name="haken" :groesse="16" /> {{ t('common.connected') }}</span>
                <span v-if="bitunixTestResult === 'error'" class="ergebnis schlecht"><Symbol name="fehler" :groesse="16" /> {{ t('common.connectionFailed') }}</span>
            </div>
        </Abschnitt>

        <!-- BITGET -->
        <Abschnitt titel="Bitget" unter v-model:offen="bitgetSubExpanded">
            <template #kopf>
                <Pille v-if="bitgetApiKey" ton="gut">{{ t('common.configured') }}</Pille>
            </template>
            <MarktWahl boerse="bitget" />
            <div class="felder">
                <Eingabe v-model="bitgetApiKey" :label="t('settings.apiKeyLabel')" :platzhalter="t('settings.apiKeyPlaceholder')" />
                <Eingabe v-model="bitgetSecretKey" art="password" :label="t('settings.secretKeyLabel')" :platzhalter="t('settings.secretKeyPlaceholder')" />
                <Eingabe v-model="bitgetPassphrase" art="password" :label="t('settings.passphrase')" :platzhalter="t('settings.passphrasePlaceholder')" :hilfe="t('settings.passphraseHint')" />
                <Eingabe v-model="bitgetImportStartDate" art="date" :label="t('settings.importFromDate')" :hilfe="t('settings.importFromDateHint')" />
            </div>
            <div class="aktionen">
                <Knopf art="haupt" :laedt="bitgetImporting" @click="saveBitgetConfig">
                    {{ bitgetImporting ? t('common.importing') : t('common.save') }}
                </Knopf>
                <Knopf :laedt="bitgetTestLoading" @click="testBitgetConnection">
                    {{ bitgetTestLoading ? t('common.testing') : t('common.testConnection') }}
                </Knopf>
                <span v-if="bitgetTestResult === 'success'" class="ergebnis gut"><Symbol name="haken" :groesse="16" /> {{ t('common.connected') }}</span>
                <span v-if="bitgetTestResult === 'error'" class="ergebnis schlecht"><Symbol name="fehler" :groesse="16" /> {{ t('common.failed') }}</span>
            </div>
            <Hinweis v-if="bitgetTestResult === 'error' && bitgetTestError" art="fehler" :titel="t('common.error')" class="fehlerbox">
                <span class="fehlertext">{{ bitgetTestError }}</span>
                <div v-if="bitgetTestError.includes('40012')" class="ursachen">
                    <strong>{{ t('settings.possibleCausesLabel') }}</strong>
                    <ul>
                        <li>{{ t('settings.bitgetCauseWrongKeys') }}</li>
                        <li>{{ t('settings.bitgetCauseIpWhitelist') }}</li>
                        <li>{{ t('settings.bitgetCauseKeyType') }}</li>
                        <li>{{ t('settings.bitgetCausePermissions') }}</li>
                    </ul>
                </div>
            </Hinweis>
        </Abschnitt>

        <!-- PIONEX -->
        <Abschnitt titel="Pionex" unter v-model:offen="pionexSubExpanded">
            <template #kopf>
                <Pille v-if="pionexApiKey" ton="gut">{{ t('common.configured') }}</Pille>
            </template>
            <MarktWahl boerse="pionex" />
            <div class="felder">
                <Eingabe v-model="pionexApiKey" :label="t('settings.apiKeyLabel')" :platzhalter="t('settings.apiKeyPlaceholder')" />
                <Eingabe v-model="pionexSecretKey" art="password" :label="t('settings.secretKeyLabel')" :platzhalter="t('settings.secretKeyPlaceholder')" />
                <Eingabe v-model="pionexImportStartDate" art="date" :label="t('settings.importFromDate')" :hilfe="t('settings.importFromDateHint')" />
            </div>
            <div class="aktionen">
                <Knopf art="haupt" :laedt="pionexImporting" @click="savePionexConfig">
                    {{ pionexImporting ? t('common.importing') : t('common.save') }}
                </Knopf>
                <Knopf :laedt="pionexTestLoading" @click="testPionexConnection">
                    {{ pionexTestLoading ? t('common.testing') : t('common.testConnection') }}
                </Knopf>
                <span v-if="pionexTestResult === 'success'" class="ergebnis gut"><Symbol name="haken" :groesse="16" /> {{ t('common.connected') }}</span>
                <span v-if="pionexTestResult === 'error'" class="ergebnis schlecht"><Symbol name="fehler" :groesse="16" /> {{ t('common.failed') }}</span>
            </div>
            <Hinweis v-if="pionexTestResult === 'error' && pionexTestError" art="fehler" :titel="t('common.error')" class="fehlerbox">
                <span class="fehlertext">{{ pionexTestError }}</span>
                <div class="ursachen">
                    <strong>{{ t('settings.possibleCausesLabel') }}</strong>
                    <ul>
                        <li>{{ t('settings.pionexCauseWrongKeys') }}</li>
                        <li>{{ t('settings.pionexCauseIpWhitelist') }}</li>
                        <li>{{ t('settings.pionexCausePermissions') }}</li>
                    </ul>
                </div>
            </Hinweis>
        </Abschnitt>

        <!-- BITPANDA (Spot-Portfolio) -->
        <BitpandaZugang v-if="Number(appEinstellungen?.modusPortfolioAn ?? 1) === 1" />
    </Abschnitt>
</template>

<style scoped>
.beschreibung { color: var(--muted); margin: 0 0 var(--abstand-3); }
.zugang { margin-bottom: var(--abstand-3); }
.zugang-meldung, .zugang-seit { display: block; font-size: 0.85rem; }
.zugang-meldung { color: var(--muted); margin-top: 0.2rem; overflow-wrap: anywhere; }
.felder {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    gap: var(--abstand-3);
}
.aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.ergebnis {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.88rem;
}
.ergebnis.gut { color: var(--good); }
.ergebnis.schlecht { color: var(--bad); }
.fehlerbox { margin-top: var(--abstand-3); font-size: 0.85rem; }
.fehlertext { overflow-wrap: anywhere; }
.ursachen { margin-top: var(--abstand-2); color: var(--muted); font-size: 0.8rem; }
.ursachen ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
</style>
