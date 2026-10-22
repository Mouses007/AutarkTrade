<script setup>
/**
 * Push-Kanäle (ntfy, Telegram, Webhook) — EINE Stelle für alle Handy-Meldungen:
 * Chart-Alarme, Hype-Radar, Frühphase, Börsen-Beobachter, Abverkauf.
 *
 * Steht unter Einstellungen › Benachrichtigungen. Bis 22.10.2026 lag dieser
 * Teil nur im Zahnrad des Hype-Radars, weil die Kanäle dort zuerst gebaut
 * wurden — wer einen Chart-Alarm aufs Handy wollte, fand ihn nicht.
 *
 * Gespeichert wird weiter über `/api/hype-radar/einstellungen` (dort lebt
 * `alarmKanaele`, `server/hype-radar/zustellung.js` liest es). Geschickt werden
 * NUR die Kanäle und ihre Geheimnisse: der Server speichert je Schlüssel, die
 * übrigen Hype-Radar-Einstellungen bleiben unberührt. Geheimnisse kommen
 * maskiert zurück; ein unangetastetes Feld überschreibt den gespeicherten
 * Schlüssel nicht (der Server übernimmt nur Werte ohne Maskierungspunkte).
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Knopf, Kreisel } from '@/components/basis/index.js'

const { t } = useI18n()

const kanaele = ref(null)
const schluessel = ref({ ntfyToken: '', telegramToken: '', webhookUrl: '' })
const fehler = ref('')
const testLaeuft = ref(false)
const testErgebnis = ref('')

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/hype-radar/einstellungen')
        kanaele.value = data.alarmKanaele
        schluessel.value = {
            ntfyToken: data.schluessel?.ntfyToken || '',
            telegramToken: data.schluessel?.telegramToken || '',
            webhookUrl: data.schluessel?.webhookUrl || '',
        }
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
})

async function speichern() {
    fehler.value = ''
    try {
        const { data } = await axios.put('/api/hype-radar/einstellungen', { alarmKanaele: kanaele.value, schluessel: schluessel.value })
        // Was gilt, nicht was getippt wurde: Geheimnisse wieder maskiert.
        schluessel.value = {
            ntfyToken: data.schluessel?.ntfyToken || '',
            telegramToken: data.schluessel?.telegramToken || '',
            webhookUrl: data.schluessel?.webhookUrl || '',
        }
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function testen() {
    testLaeuft.value = true
    testErgebnis.value = ''
    try {
        const { data } = await axios.post('/api/hype-radar/alarme/test')
        testErgebnis.value = Object.entries(data).map(([kanal, stand]) => `${kanal}: ${stand}`).join(' · ')
    } catch {
        testErgebnis.value = t('hype.testFehlgeschlagen')
    } finally {
        testLaeuft.value = false
    }
}
</script>

<template>
    <div class="push">
        <div v-if="fehler" class="fehler">{{ fehler }}</div>
        <template v-if="kanaele">
            <div class="kanal">
                <div class="at-check schalter">
                    <input id="pushNtfy" v-model="kanaele.ntfy.an" type="checkbox" @change="speichern">
                    <label for="pushNtfy"><strong>ntfy</strong> <span class="leise">{{ t('settings.push.ntfyKurz') }}</span></label>
                </div>
                <div v-if="kanaele.ntfy.an" class="felder">
                    <input v-model="kanaele.ntfy.url" class="at-feld klein" :placeholder="t('hype.ntfyUrl')" @change="speichern">
                    <input v-model="kanaele.ntfy.topic" class="at-feld klein" placeholder="Topic" @change="speichern">
                    <input v-model="schluessel.ntfyToken" type="password" class="at-feld klein" :placeholder="t('hype.tokenOptional')" @change="speichern">
                    <select v-model="kanaele.ntfy.minSchwere" class="at-feld klein" @change="speichern">
                        <option value="info">{{ t('hype.abInfo') }}</option>
                        <option value="warnung">{{ t('hype.abWarnung') }}</option>
                        <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                    </select>
                </div>
            </div>

            <div class="kanal">
                <div class="at-check schalter">
                    <input id="pushTg" v-model="kanaele.telegram.an" type="checkbox" @change="speichern">
                    <label for="pushTg"><strong>Telegram</strong></label>
                </div>
                <div v-if="kanaele.telegram.an" class="felder">
                    <input v-model="schluessel.telegramToken" type="password" class="at-feld klein" :placeholder="t('hype.botToken')" @change="speichern">
                    <input v-model="kanaele.telegram.chatId" class="at-feld klein" placeholder="Chat-ID" @change="speichern">
                    <select v-model="kanaele.telegram.minSchwere" class="at-feld klein" @change="speichern">
                        <option value="info">{{ t('hype.abInfo') }}</option>
                        <option value="warnung">{{ t('hype.abWarnung') }}</option>
                        <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                    </select>
                </div>
            </div>

            <div class="kanal">
                <div class="at-check schalter">
                    <input id="pushWh" v-model="kanaele.webhook.an" type="checkbox" @change="speichern">
                    <label for="pushWh"><strong>Webhook</strong> <span class="leise">{{ t('hype.webhookHa') }}</span></label>
                </div>
                <div v-if="kanaele.webhook.an" class="felder">
                    <input v-model="schluessel.webhookUrl" type="password" class="at-feld klein breit" :placeholder="t('hype.webhookUrl')" @change="speichern">
                    <select v-model="kanaele.webhook.minSchwere" class="at-feld klein" @change="speichern">
                        <option value="info">{{ t('hype.abInfo') }}</option>
                        <option value="warnung">{{ t('hype.abWarnung') }}</option>
                        <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                    </select>
                    <div class="leise ganz">{{ t('hype.webhookPayload') }}</div>
                </div>
            </div>

            <div class="test">
                <Knopf klein :disabled="testLaeuft" @click="testen">
                    <Kreisel v-if="testLaeuft" still />
                    {{ t('hype.kanaeleTesten') }}
                </Knopf>
                <span v-if="testErgebnis" class="leise">{{ testErgebnis }}</span>
            </div>
        </template>
    </div>
</template>

<style scoped>
.push {
    display: flex;
    flex-direction: column;
}

.kanal {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
}

.felder {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
    padding-left: 2.4rem;
}

.felder .at-feld {
    width: auto;
    min-width: 9rem;
}

.felder .breit {
    min-width: min(22rem, 100%);
}

.leise {
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: normal;
}

.ganz {
    flex-basis: 100%;
}

.test {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
}

.fehler {
    color: var(--bad);
}

@media (max-width: 600px) {
    .felder {
        padding-left: 0;
    }
}
</style>
