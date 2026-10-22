<script setup>
/**
 * Spenden: QR-Codes für BTC und PayPal, dazu „Buy me a coffee", sobald in den
 * Einstellungen ein Link hinterlegt ist. Aus Menü oder Kaffee-Knopf geöffnet zum
 * Ansehen; als Nachfrage (Update, Meilenstein, Zeit, Dank — `server/spenden.js`)
 * mit Antwortknöpfen. Jede Antwort, auch das Schliessen, zählt als beantwortet.
 *
 * Nie mitten in der Arbeit: nicht im Live-Trading/Cockpit, nicht im Chart-Vollbild,
 * nicht im Browser-Vollbild, und erst einige Sekunden nach dem Seitenwechsel.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Dialog, Knopf, Symbol } from '../basis'
import { appEinstellungen } from '../../stores/settings.js'
import { spendenOffen, spendenFrage, spendenAntwort, pruefeSpendenFrage } from '../../stores/spenden.js'
import qrBtc from '../../assets/spenden-btc.png'
import qrPaypal from '../../assets/spenden-paypal.jpg'

const { t } = useI18n()
const route = useRoute()

const an = computed(() => Number(appEinstellungen.value?.spendenAn ?? 1) === 1)
const kaffeeUrl = computed(() => {
    const u = String(appEinstellungen.value?.spendenKaffeeUrl || '').trim()
    return /^https:\/\/(www\.)?buymeacoffee\.com\/[A-Za-z0-9_-]+\/?$/.test(u) ? u : ''
})

function stoert() {
    const p = route.path || ''
    return p.startsWith('/livetrading') || route.query?.cockpit === '1'
        || !!document.fullscreenElement || !!document.querySelector('.chartSeite.vollbild')
}

// Einmal je Sitzung nachsehen — sobald Einstellungen da sind und die Seite passt.
let gefragt = false
let uhr = null
function planeVersuch() {
    clearTimeout(uhr)
    if (gefragt || !appEinstellungen.value || !an.value) return
    uhr = setTimeout(async () => {
        if (gefragt || stoert() || spendenOffen.value) return
        gefragt = true
        await pruefeSpendenFrage()
    }, 6000)
}
watch(appEinstellungen, planeVersuch, { immediate: true })
watch(() => route.fullPath, planeVersuch)

const frageText = computed(() => {
    const f = spendenFrage.value
    if (!f) return t('spenden.text')
    if (f.art === 'meilenstein') return t('spenden.frageMeilenstein', { n: f.wert })
    if (f.art === 'zeit') return t('spenden.frageZeit', { tage: f.wert })
    if (f.art === 'update') return t('spenden.frageUpdate', { version: f.wert })
    if (f.art === 'dank') return t('spenden.frageDank')
    return t('spenden.text')
})
const istDank = computed(() => spendenFrage.value?.art === 'dank')
</script>

<template>
    <Dialog :model-value="spendenOffen" :titel="t(istDank ? 'spenden.titelDank' : 'spenden.titel')" breite="34rem" @zu="spendenAntwort('zu')">
        <p class="frage">{{ frageText }}</p>

        <template v-if="!istDank">
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
        </template>

        <template #fuss>
            <template v-if="istDank">
                <Knopf @click="spendenAntwort('zu')">{{ t('spenden.schliessen') }}</Knopf>
            </template>
            <template v-else>
                <Knopf art="leise" @click="spendenAntwort('gespendet')">{{ t('spenden.schonGespendet') }}</Knopf>
                <Knopf art="leise" @click="spendenAntwort('nein')">{{ t('spenden.definitivNicht') }}</Knopf>
                <Knopf v-if="spendenFrage" @click="spendenAntwort('spaeter')">{{ t('spenden.spaeter') }}</Knopf>
                <Knopf v-else @click="spendenAntwort('zu')">{{ t('spenden.schliessen') }}</Knopf>
            </template>
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
