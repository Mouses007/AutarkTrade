<script setup>
/**
 * Allgemein → Profil & Sprache: App-Sprache, Zeitzone, Anzeigewährung,
 * Benutzername und Profilbild. Alles speichert sofort wie die übrigen Felder:
 * der Name beim Verlassen des Feldes, das Bild beim Auswählen der Datei. Name
 * und Bild stehen im Seitenmenü und auf der Share-Karte (KI › Bilder).
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Knopf, Eingabe } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import { pruefeEinstellungen, ladeZeitraeume, leseZeitzone } from '../../../utils/journal/app.js'
import { ZEITZONE_VORGABE, zeitzoneAus, alleZeitzonen } from '../../../../shared/zeitzone.js'
import { appEinstellungen, profilZaehler } from '@/stores/settings.js'
import { dbUpdateSettings } from '@/utils/db.js'
import { setLocale } from '@/i18n'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { anzeigeKurs, ladeAnzeigeKurs } from '@/stores/app/waehrung.js'

const { t } = useI18n()

const offen = ref(false)

const selectedLanguage = ref('de')
const SPRACHEN = [{ wert: 'de', text: 'Deutsch' }, { wert: 'en', text: 'English' }]

async function changeLanguage(lang) {
    // `setLocale` laedt die Sprachdatei bei Bedarf nach und ist deshalb async.
    await setLocale(lang)
    await dbUpdateSettings({ language: lang })
    appEinstellungen.value.language = lang
    await ladeZeitraeume()
}

/* Anzeigewährung für Kosten (KI-Verbrauch, Budgets) — Kurs vom Server */
const WAEHRUNGEN = ['USD', 'CHF', 'EUR'].map((w) => ({ wert: w, text: w }))
const waehrung = ref('USD')
async function waehrungSpeichern(code) {
    await kiSpeichern('waehrungCode', code)
    await ladeAnzeigeKurs()
}
const waehrungStand = computed(() => {
    if (waehrung.value === 'USD') return ''
    const k = anzeigeKurs.value
    if (!k || k.code !== waehrung.value) return t('settings.waehrungKursFehlt')
    const kurs = Number(k.faktor).toFixed(4)
    if (k.quelle === 'einstellung') return t('settings.waehrungKursGespeichert', { kurs, code: k.code })
    return t('settings.waehrungKurs', { kurs, code: k.code, quelle: k.datum ? `${k.quelle}, ${k.datum}` : k.quelle })
})

/*
 * Zeitzone des Journals (`settings.timeZone`): Tagesgrenzen der Trades,
 * Uhrzeiten im Lagebericht, in Mails, auf dem ESP32. Wurde überall gelesen,
 * liess sich aber nirgends einstellen. Vorschlag: die Zone dieses Browsers.
 */
const ZONEN = alleZeitzonen().map((z) => ({ wert: z, text: z.replace(/_/g, ' ') }))
const zeitzone = ref(ZEITZONE_VORGABE)
const browserZone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
})()
async function zeitzoneSpeichern(zone) {
    zeitzone.value = zeitzoneAus(zone)
    await kiSpeichern('timeZone', zeitzone.value)
    leseZeitzone()
}

/* Profil: Name und Bild. Das Bild wird als Daten-URL in den Einstellungen
   abgelegt — ein eigener Upload-Weg wäre für ein einzelnes kleines Bild zu viel. */
const username = ref('')
const gespeichert = ref(false)
const fehler = ref('')

/* Nur, was die Share-Karte zeichnen kann (`kartenBild` in server/flux-api.js) —
   ein SVG oder BMP landete sonst still als App-Logo auf der Karte. */
const BILD_TYPEN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const BILD_MAX_BYTES = 10 * 1024 * 1024
const BILD_KANTE = 512

function alsDatenUrl(datei) {
    return new Promise((fertig, fehler) => {
        const leser = new FileReader()
        leser.onload = () => fertig(leser.result)
        leser.onerror = () => fehler(leser.error)
        leser.readAsDataURL(datei)
    })
}

/** Grosse Bilder auf höchstens 512 px Kantenlänge verkleinern (Leinwand, wie beim Chartbild der KI). */
async function verkleinert(datei) {
    const url = await alsDatenUrl(datei)
    const bild = await new Promise((fertig, fehler) => {
        const b = new Image()
        b.onload = () => fertig(b)
        b.onerror = () => fehler(new Error(t('settings.profilBildUnlesbar')))
        b.src = url
    })
    const kante = Math.max(bild.naturalWidth, bild.naturalHeight)
    if (kante <= BILD_KANTE && datei.size <= 1024 * 1024) return url
    const f = Math.min(1, BILD_KANTE / kante)
    const leinwand = document.createElement('canvas')
    leinwand.width = Math.max(1, Math.round(bild.naturalWidth * f))
    leinwand.height = Math.max(1, Math.round(bild.naturalHeight * f))
    leinwand.getContext('2d').drawImage(bild, 0, 0, leinwand.width, leinwand.height)
    return datei.type === 'image/jpeg' ? leinwand.toDataURL('image/jpeg', 0.9) : leinwand.toDataURL('image/png')
}

async function profilNeuLaden() {
    await pruefeEinstellungen()
    profilZaehler.value += 1
    gespeichert.value = true
    setTimeout(() => { gespeichert.value = false }, 2000)
}

async function nameSpeichern() {
    const name = username.value.trim()
    if (name === String(appEinstellungen.value?.username || '')) return
    fehler.value = ''
    try {
        await dbUpdateSettings({ username: name })
        await profilNeuLaden()
    } catch (e) {
        fehler.value = t('common.errorSaving') + (e?.response?.data?.error || e.message)
    }
}

async function bildGewaehlt(ereignis) {
    const datei = ereignis.target.files?.[0]
    ereignis.target.value = ''
    if (!datei) return
    fehler.value = ''
    if (!BILD_TYPEN.includes(datei.type)) {
        fehler.value = t('settings.profilBildTyp')
        return
    }
    if (datei.size > BILD_MAX_BYTES) {
        fehler.value = t('settings.profilBildGross', { mb: BILD_MAX_BYTES / 1024 / 1024 })
        return
    }
    try {
        await dbUpdateSettings({ avatar: await verkleinert(datei) })
        await profilNeuLaden()
    } catch (e) {
        fehler.value = t('common.errorSaving') + (e?.response?.data?.error || e.message)
    }
}

async function deleteAvatar() {
    fehler.value = ''
    try {
        await dbUpdateSettings({ avatar: '' })
        await profilNeuLaden()
    } catch (e) {
        fehler.value = t('common.errorSaving') + (e?.response?.data?.error || e.message)
    }
}

/* Stand aus den Einstellungen — Einstellungen.vue hat sie vor dem Mount geladen. */
function ausEinstellungen() {
    const settings = appEinstellungen.value || {}
    username.value = settings.username || ''
    selectedLanguage.value = settings.language || 'de'
    zeitzone.value = zeitzoneAus(settings.timeZone)
    const code = String(settings.waehrungCode || '').toUpperCase()
    waehrung.value = ['CHF', 'EUR'].includes(code) ? code : 'USD'
}
ausEinstellungen()
if (!anzeigeKurs.value) ladeAnzeigeKurs()
</script>

<template>
    <Abschnitt v-model:offen="offen" :titel="t('settings.profilSprache')" symbol="globus">
        <!-- Sprache / Language -->
        <Feld :label="t('settings.languageLabel')">
            <Eingabe v-model="selectedLanguage" art="auswahl" :optionen="SPRACHEN"
                @update:model-value="changeLanguage" />
        </Feld>

        <Feld :label="t('settings.zeitzoneLabel')" :hilfe="t('settings.zeitzoneHint')">
            <Eingabe v-model="zeitzone" art="auswahl" :optionen="ZONEN" @update:model-value="zeitzoneSpeichern" />
            <p v-if="browserZone && browserZone !== zeitzone" class="hinweis">
                {{ t('settings.zeitzoneBrowser', { zone: browserZone }) }}
                <Knopf klein art="leise" @click="zeitzoneSpeichern(browserZone)">{{ t('settings.zeitzoneUebernehmen') }}</Knopf>
            </p>
        </Feld>

        <Feld :label="t('settings.waehrungLabel')" :hilfe="t('settings.waehrungHint')">
            <Eingabe v-model="waehrung" art="auswahl" :optionen="WAEHRUNGEN"
                @update:model-value="waehrungSpeichern" />
            <p v-if="waehrungStand" class="hinweis">{{ waehrungStand }}</p>
        </Feld>

        <Feld :label="t('settings.username')" :hilfe="t('settings.profilHint')">
            <Eingabe v-model="username" :platzhalter="t('settings.usernamePlaceholder')" @change="nameSpeichern" />
        </Feld>

        <Feld :label="t('settings.profilePicture')">
            <div class="avatar-zeile">
                <img v-if="appEinstellungen?.avatar" :src="appEinstellungen.avatar" class="avatar" alt="" />
                <img v-else src="@/assets/icon.png" class="avatar" alt="" />
                <Knopf v-if="appEinstellungen?.avatar" art="gefahr" klein @click="deleteAvatar">{{ t('common.remove') }}</Knopf>
                <span v-if="gespeichert" class="gut">{{ t('common.saved') }}</span>
            </div>
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="datei" @change="bildGewaehlt" />
        </Feld>
        <p v-if="fehler" class="schlecht">{{ fehler }}</p>
    </Abschnitt>
</template>

<style scoped>
.avatar-zeile {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}
.avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--line);
}
.datei {
    max-width: 100%;
    color: var(--muted);
    font-size: 0.85rem;
}
.datei::file-selector-button {
    margin-right: var(--abstand-2);
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    font: inherit;
    cursor: pointer;
}
.datei::file-selector-button:hover { background: var(--panel-hoch); }
.hinweis {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.82rem;
}
.gut { color: var(--good); font-size: 0.85rem; }
</style>
