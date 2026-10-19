<script setup>
/** Journal → Kontostand: Start-Einzahlung je Börse, auf Wunsch aus der API errechnet. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { selectedBroker } from '@/stores/filters.js'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings, dbFind } from '@/utils/db.js'

const { t } = useI18n()

let balanceExpanded = ref(false)
let startBalance = ref(0)

/* KONTOSTAND (per broker) */
const balanceLoading = ref(false)
const apiBalanceValue = ref(null)

async function loadBalanceFromApi() {
    const broker = selectedBroker.value || 'bitunix'
    balanceLoading.value = true
    apiBalanceValue.value = null
    try {
        // 1. Get current balance from exchange API
        const response = await axios.get(`/api/${broker}/balance`)
        if (!response.data.ok) {
            alert('API Fehler: ' + (response.data.error || 'Unbekannter Fehler'))
            balanceLoading.value = false
            return
        }
        const apiBalance = response.data.balance
        apiBalanceValue.value = apiBalance

        // Subtract unrealized P&L of open positions — otherwise the start
        // balance would absorb it and double-count once the positions close.
        const unrealized = (Number(response.data.crossUnrealizedPNL) || 0)
            + (Number(response.data.isolationUnrealizedPNL) || 0)
            + (Number(response.data.unrealizedPL) || 0)
        const realizedEquity = apiBalance - unrealized

        // 2. Calculate all-time net P&L for this broker
        const trades = await dbFind('trades', { equalTo: { broker }, limit: 100000 })
        let totalNetPnL = 0
        for (const day of trades) {
            if (day.pAndL && typeof day.pAndL === 'object') {
                const np = Number(day.pAndL.netProceeds)
                if (Number.isFinite(np)) totalNetPnL += np
            }
        }

        // 3. Start-Einzahlung = realized equity - alle Journal-P&L
        const calculatedStart = realizedEquity - totalNetPnL
        startBalance.value = Math.round(calculatedStart * 100) / 100

        const bonus = Number(response.data.bonus) || 0
        console.log(` -> ${broker}: API=${apiBalance.toFixed(2)} (Bonus: ${bonus.toFixed(2)}), unrealized=${unrealized.toFixed(2)}, realized=${realizedEquity.toFixed(2)}, P&L=${totalNetPnL.toFixed(2)}, Start=${calculatedStart.toFixed(2)}`)
    } catch (error) {
        alert('Kontostand konnte nicht geladen werden: ' + (error.response?.data?.error || error.message))
    }
    balanceLoading.value = false
}

async function saveBalances() {
    try {
        const broker = selectedBroker.value || 'bitunix'
        const start = parseFloat(startBalance.value) || 0

        // Save start balance per broker (no offset needed — Dashboard calculates current from P&L)
        const existingBalances = currentUser.value?.balances || {}
        const balances = { ...existingBalances, [broker]: { start } }

        await dbUpdateSettings({ balances, startBalance: start })
        currentUser.value.balances = balances
        currentUser.value.startBalance = start

        apiBalanceValue.value = null

        console.log(` -> Start-Einzahlung gespeichert für ${broker}:`, start)
    } catch (error) {
        alert('Fehler beim Speichern: ' + error.message)
    }
}

/* Start-Einzahlung der gewählten Börse (mit Rückfall auf das alte Einzelfeld). */
function ausEinstellungen() {
    const settings = currentUser.value || {}
    const broker = selectedBroker.value || 'bitunix'
    const balances = settings.balances || {}
    if (balances[broker]) {
        startBalance.value = balances[broker].start || 0
    } else {
        startBalance.value = settings.startBalance || 0
    }
}
ausEinstellungen()
</script>

<template>
    <div>
        <hr />

        <!--=============== KONTOSTAND ===============-->
        <div class="d-flex align-items-center pointerClass" @click="balanceExpanded = !balanceExpanded">
            <i class="uil me-2" :class="balanceExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
            <p class="fs-5 fw-bold mb-0">{{ t('settings.balance') }}</p>
        </div>
        <div v-show="balanceExpanded" class="mt-2 ms-3 row align-items-center">
            <p class="fw-lighter" v-html="t('settings.balanceDescription', { broker: (selectedBroker || 'bitunix').charAt(0).toUpperCase() + (selectedBroker || 'bitunix').slice(1) })"></p>
            <div class="row mt-2">
                <div class="col-12 col-md-4">{{ t('settings.startDeposit') }}</div>
                <div class="col-12 col-md-8">
                    <div class="input-group">
                        <input type="number" class="form-control" v-model="startBalance" :placeholder="t('settings.startDepositPlaceholder')" step="0.01" />
                        <button type="button" class="btn btn-outline-primary" @click="loadBalanceFromApi" :disabled="balanceLoading">
                            <span v-if="balanceLoading" class="spinner-border spinner-border-sm" style="width: 0.7rem; height: 0.7rem;"></span>
                            <span v-else><i class="uil uil-cloud-download me-1"></i>{{ t('settings.calculateFromApi') }}</span>
                        </button>
                    </div>
                    <small v-if="apiBalanceValue !== null" class="text-success">{{ t('settings.apiBalance', { value: apiBalanceValue.toFixed(2) }) }}</small>
                    <small v-else class="text-muted">{{ t('settings.manualOrApi') }}</small>
                </div>
            </div>
            <div class="mt-3 mb-3">
                <button type="button" v-on:click="saveBalances" class="btn btn-success">{{ t('common.save') }}</button>
            </div>
        </div>

    </div>
</template>
