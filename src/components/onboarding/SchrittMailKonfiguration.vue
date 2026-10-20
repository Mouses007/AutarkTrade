<script setup>
/**
 * Mail-Konfiguration (SMTP) — extrahiert aus Einstellungen.vue (Bereich
 * Benachrichtigungen), dort self-contained über /api/mail/settings und
 * /api/mail/test. Wiederverwendet im Onboarding-Assistenten und weiterhin
 * in Einstellungen.vue.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '../InfoTipp.vue'
import Knopf from '../basis/Knopf.vue'
import Feld from '@/views/einstellungen/gemeinsam/Feld.vue'
import Schalter from '@/views/einstellungen/gemeinsam/Schalter.vue'

const { t } = useI18n()

/*
 * v-model statt eigenem State: Einstellungen.vue liest `mail.mailAktiv`/`mailAn`
 * an zwei weiteren Stellen (News-Mailversand-Hinweis, Kanal-Checkbox) und
 * braucht deshalb dieselbe Referenz. Ohne gebundenes v-model (Onboarding-
 * Kontext) liefert `defineModel` automatisch einen lokalen Fallback-Ref.
 */
const mail = defineModel('mail', {
    default: () => ({
        mailAktiv: 0, mailHost: '', mailPort: 587, mailSicherheit: 'starttls',
        mailUser: '', mailVon: '', mailAn: '', mailPasswort: '', mailPasswortSet: false,
        mailSchriftGroesse: 'gross',
    }),
})
const mailTestLaeuft = ref(false)
const mailMeldung = ref('')
const mailFehler = ref(false)

const MAIL_VORLAGEN = [
    { name: 'Gmail', mailHost: 'smtp.gmail.com', mailPort: 465, mailSicherheit: 'tls' },
    { name: 'Outlook', mailHost: 'smtp-mail.outlook.com', mailPort: 587, mailSicherheit: 'starttls' },
    { name: 'GMX', mailHost: 'mail.gmx.net', mailPort: 587, mailSicherheit: 'starttls' },
]

function mailVorlage(v) {
    mail.value.mailHost = v.mailHost
    mail.value.mailPort = v.mailPort
    mail.value.mailSicherheit = v.mailSicherheit
}

async function ladeMailKonfig() {
    try {
        const { data } = await axios.get('/api/mail/settings')
        mail.value = { ...data, mailPasswort: data.mailPasswortSet ? '••••••••' : '' }
    } catch (e) {
        console.error(' -> Mail-Einstellungen nicht ladbar:', e)
    }
}

async function speichereMail() {
    mailMeldung.value = ''
    try {
        await axios.post('/api/mail/settings', mail.value)
        mailFehler.value = false
        mailMeldung.value = 'Gespeichert.'
        await ladeMailKonfig()
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    }
}

/**
 * Vom Onboarding-Assistenten beim Verlassen gerufen (Fertig/Später) — anders
 * als `speichereMail()` (Klick auf den eigenen "Speichern"-Button) wird ein
 * Fehler hier NICHT geschluckt: der Elternteil fängt ihn ab und zeigt ihn an,
 * statt stillschweigend weiterzuleiten und die eingegebenen SMTP-Daten zu
 * verlieren.
 */
async function uebernehmen() {
    await axios.post('/api/mail/settings', mail.value)
}

/*
 * `laden` zusätzlich exponiert: Einstellungen.vue hat vor der Extraktion
 * `ladeMailKonfig()` explizit in seiner eigenen, sequenzierten Mount-Kette
 * abgewartet (drei andere Stellen dort lesen `mail.mailAktiv`/`mailAn`
 * reaktiv). Ohne diesen Zugriff hinge die Reihenfolge nur noch daran, dass
 * die umschliessenden `v-show`-Bereiche die Komponente immer mounten — ändert
 * sich das je zu `v-if`, würden die drei Lesestellen dauerhaft auf den
 * Default-Werten einfrieren, ohne dass ein Fehler sichtbar würde.
 */
defineExpose({ uebernehmen, laden: ladeMailKonfig })

async function testeMail() {
    mailTestLaeuft.value = true
    mailMeldung.value = ''
    try {
        await axios.post('/api/mail/settings', mail.value)
        await axios.post('/api/mail/test')
        mailFehler.value = false
        mailMeldung.value = 'Testmail verschickt — schau ins Postfach.'
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    } finally {
        mailTestLaeuft.value = false
    }
}

onMounted(ladeMailKonfig)
</script>

<template>
    <div>
        <Schalter class="at-mo-2" :model-value="mail.mailAktiv === 1"
            :label="t('settings.benachrichtigungen.mailAktiv')"
            @change="v => { mail.mailAktiv = v ? 1 : 0; speichereMail() }" />

        <div class="at-flex at-mitte at-luecke-2 at-umbruch at-mo-3">
            <span class="at-gedaempft mail-klein">{{ t('settings.benachrichtigungen.vorlage') }}</span>
            <Knopf v-for="v in MAIL_VORLAGEN" :key="v.name" klein @click="mailVorlage(v)">{{ v.name }}</Knopf>
        </div>

        <Feld class="at-mo-2">
            <template #label>{{ t('settings.benachrichtigungen.schrift') }}<InfoTipp schluessel="settings.info.mailSchrift" /></template>
            <select class="at-feld mail-s" v-model="mail.mailSchriftGroesse" @change="speichereMail">
                <option value="normal">{{ t('settings.benachrichtigungen.schriftNormal') }}</option>
                <option value="gross">{{ t('settings.benachrichtigungen.schriftGross') }}</option>
                <option value="sehrGross">{{ t('settings.benachrichtigungen.schriftSehrGross') }}</option>
            </select>
        </Feld>

        <Feld>
            <template #label>{{ t('settings.benachrichtigungen.host') }}<InfoTipp schluessel="settings.info.mailSicherheit" /></template>
            <div class="at-flex at-luecke-2 at-umbruch">
                <input type="text" class="at-feld mail-l" v-model="mail.mailHost" placeholder="smtp.example.com" />
                <input type="number" class="at-feld mail-port" v-model.number="mail.mailPort" placeholder="587" />
                <select class="at-feld mail-m" v-model="mail.mailSicherheit">
                    <option value="tls">TLS (465)</option>
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="keine">{{ t('settings.benachrichtigungen.mailSecurityNone') }}</option>
                </select>
            </div>
        </Feld>

        <Feld :label="t('settings.benachrichtigungen.zugang')">
            <div class="at-flex at-luecke-2 at-umbruch">
                <input type="text" class="at-feld mail-l" v-model="mail.mailUser"
                    :placeholder="t('settings.benachrichtigungen.benutzer')" />
                <input type="password" class="at-feld mail-s" v-model="mail.mailPasswort"
                    :placeholder="t('settings.benachrichtigungen.passwort')" />
            </div>
        </Feld>

        <Feld :label="t('settings.benachrichtigungen.adressen')">
            <div class="at-flex at-luecke-2 at-umbruch">
                <input type="email" class="at-feld mail-l" v-model="mail.mailVon"
                    :placeholder="t('settings.benachrichtigungen.von')" />
                <input type="email" class="at-feld mail-l" v-model="mail.mailAn"
                    :placeholder="t('settings.benachrichtigungen.an')" />
            </div>
        </Feld>

        <div class="at-flex at-mitte at-luecke-2 at-umbruch at-mo-3">
            <Knopf art="haupt" klein @click="speichereMail">
                {{ t('settings.benachrichtigungen.speichern') }}
            </Knopf>
            <Knopf klein :laedt="mailTestLaeuft" @click="testeMail">
                {{ mailTestLaeuft ? t('settings.benachrichtigungen.testLaeuft') : t('settings.benachrichtigungen.test') }}
            </Knopf>
            <span v-if="mailMeldung" :class="mailFehler ? 'at-schlecht' : 'at-gut'" class="mail-meldung">{{ mailMeldung }}</span>
        </div>
        <p class="at-gedaempft at-mo-2 mail-klein">
            {{ t('settings.benachrichtigungen.passwortHinweis') }}
        </p>
    </div>
</template>

<style scoped>
.mail-klein {
    font-size: 0.8rem;
}

.mail-meldung {
    font-size: 0.85rem;
}

/* Feldbreiten wie zuvor; am Telefon nie breiter als die Zeile. */
.mail-l { max-width: 18rem; }
.mail-m { max-width: 11rem; }
.mail-s { max-width: 14rem; }
.mail-port { max-width: 7rem; }
.at-flex > .at-feld { flex: 1 1 7rem; }
</style>
