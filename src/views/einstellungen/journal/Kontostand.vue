<script setup>
/** Journal → Kontostand: Start-Einzahlung je Börse, auf Wunsch aus der API errechnet. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { selectedBroker } from '@/stores/filters.js'
import { currentUser } from '@/stores/settings.js'
import { dbUpdateSettings, dbFind } from '@/utils/db.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Knopf from '@/components/basis/Knopf.vue'

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
    <Abschnitt :titel="t('settings.balance')" symbol="geldboerse" v-model:offen="balanceExpanded">
        <p class="beschreibung" v-html="t('settings.balanceDescription', { broker: (selectedBroker || 'bitunix').charAt(0).toUpperCase() + (selectedBroker || 'bitunix').slice(1) })"></p>

        <Feld :label="t('settings.startDeposit')" fuer="kontostand-start">
            <div class="reihe">
                <input id="kontostand-start" type="number" class="eingabe" v-model="startBalance"
                    :placeholder="t('settings.startDepositPlaceholder')" step="0.01" />
                <Knopf symbol="download" :laedt="balanceLoading" @click="loadBalanceFromApi">{{ t('settings.calculateFromApi') }}</Knopf>
            </div>
            <p v-if="apiBalanceValue !== null" class="notiz gut">{{ t('settings.apiBalance', { value: apiBalanceValue.toFixed(2) }) }}</p>
            <p v-else class="notiz">{{ t('settings.manualOrApi') }}</p>
        </Feld>

        <div class="aktionen">
            <Knopf art="haupt" @click="saveBalances">{{ t('common.save') }}</Knopf>
        </div>
    </Abschnitt>
</template>

<style scoped>
.beschreibung { color: var(--muted); margin: 0 0 var(--abstand-2); }
.reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    align-items: center;
}
.eingabe {
    flex: 1 1 10rem;
    min-width: 0;
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
.notiz { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.82rem; }
.notiz.gut { color: var(--good); }
.aktionen { margin-top: var(--abstand-3); }
</style>
