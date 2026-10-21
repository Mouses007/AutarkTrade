<script setup>
/**
 * Spenden: QR-Codes für BTC und PayPal, dazu „Buy me a coffee", sobald in den
 * Einstellungen ein Link hinterlegt ist. Aus dem Menü geöffnet nur zum Ansehen;
 * als Nachfrage (50 / 200 bewertete Trades) mit Antwortknöpfen — jede Antwort
 * und auch das Schliessen zählt als beantwortet.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Dialog, Knopf, Symbol } from '../basis'
import { appEinstellungen } from '../../stores/settings.js'
import { spendenOffen, spendenFrage, spendenFrageErledigt, pruefeSpendenFrage } from '../../stores/spenden.js'
import qrBtc from '../../assets/spenden-btc.png'
import qrPaypal from '../../assets/spenden-paypal.jpg'

const { t } = useI18n()

const an = computed(() => Number(appEinstellungen.value?.spendenAn ?? 1) === 1)
const kaffeeUrl = computed(() => {
    const u = String(appEinstellungen.value?.spendenKaffeeUrl || '').trim()
    return /^https:\/\/(www\.)?buymeacoffee\.com\/[A-Za-z0-9_-]+\/?$/.test(u) ? u : ''
})

// Erst nach dem Laden der Einstellungen nachfragen — und nur, wenn Spenden an sind.
let geprueft = false
watch(appEinstellungen, (s) => {
    if (geprueft || !s) return
    geprueft = true
    if (an.value) setTimeout(pruefeSpendenFrage, 4000)
}, { immediate: true })

function zu() {
    spendenFrageErledigt()
}
</script>

<template>
    <Dialog :model-value="spendenOffen" :titel="t('spenden.titel')" breite="34rem" @zu="zu">
        <p v-if="spendenFrage === 1" class="frage">{{ t('spenden.frage1') }}</p>
        <p v-else-if="spendenFrage === 2" class="frage">{{ t('spenden.frage2') }}</p>
        <p v-else class="frage">{{ t('spenden.text') }}</p>

        <a v-if="kaffeeUrl" class="kaffee" :href="kaffeeUrl" target="_blank" rel="noopener noreferrer">
            <Symbol name="kaffee" /> Buy me a coffee
        </a>

        <div class="qr">
            <figure>
                <img :src="qrBtc" alt="Bitcoin QR-Code" />
                <figcaption>Bitcoin</figcaption>
            </figure>
            <figure>
                <img :src="qrPaypal" alt="PayPal QR-Code" />
                <figcaption>PayPal</figcaption>
            </figure>
        </div>

        <template #fuss>
            <template v-if="spendenFrage === 2">
                <Knopf art="leise" @click="zu">{{ t('spenden.schonGespendet') }}</Knopf>
                <Knopf art="leise" @click="zu">{{ t('spenden.definitivNicht') }}</Knopf>
            </template>
            <Knopf v-else-if="spendenFrage === 1" art="leise" @click="zu">{{ t('spenden.spaeter') }}</Knopf>
            <Knopf v-else @click="zu">{{ t('spenden.schliessen') }}</Knopf>
        </template>
    </Dialog>
</template>

<style scoped>
.frage {
    margin: 0 0 12px;
    color: var(--text);
    line-height: 1.5;
}

.kaffee {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 9px 16px;
    border-radius: 10px;
    background: #ffdd00;
    color: #0d0c22;
    font-weight: 700;
    text-decoration: none;
}

.kaffee:hover {
    filter: brightness(1.05);
}

.qr {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    justify-content: center;
}

.qr figure {
    margin: 0;
    flex: 1 1 140px;
    max-width: 200px;
    text-align: center;
}

.qr img {
    width: 100%;
    border-radius: 10px;
    background: #fff;
}

.qr figcaption {
    margin-top: 6px;
    font-size: 12px;
    color: var(--muted);
}
</style>
