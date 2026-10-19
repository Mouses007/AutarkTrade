<script setup>
/** KI → Nachrichten, zweiter Teil: Versand, Aufbewahrung, Themen, Darstellung, eigene Anweisung, Umfang, Modelle. */
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import { useKostenAnzeige, useKostenZahl } from '@/utils/formatters.js'
import { empfaengerPruefung, EMPFAENGER_MAX } from '../../../../shared/empfaenger.js'
import { kiSpeichern } from '../gemeinsam/speichern.js'
import { useKiAnbieter } from '../gemeinsam/useKiAnbieter.js'
import { browserNotifications, kanalAn, setzeKanal, mail } from '../gemeinsam/useBenachrichtigungen.js'
import {
    radarNewsAufloesung, radarNewsBerichtAufbewahrung, radarNewsBerichtModell, radarNewsBerichtProvider,
    radarNewsChartFrische, radarNewsLaenge, radarNewsLagenAn, radarNewsLagenSymbol, radarNewsLayout,
    radarNewsMailAktiv, radarNewsMailAn, radarNewsMailInhalt, radarNewsMeldungsTiefe, radarNewsModel,
    radarNewsPromptZusatz, radarNewsPunkte, radarNewsThemen, radarNewsTokenBudget, radarNewsVideoTiefe,
    radarNewsVideoTokens, radarNewsVideos, radarNewsXModell, lagenSymbolWarnung, useRadarEinstellungen,
} from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { aiModel, aiProvider, modellListen, radarNewsRechercheModell } = useKiAnbieter()
const { pruefeLagenSymbol, radarSpeichern } = useRadarEinstellungen()

/* Themennamen aus der Übersetzung — als computed, damit ein Sprachwechsel sie
   sofort mitzieht. */
const themenNamen = computed(() => ({
    crypto: t('settings.ki.news.topicCrypto'),
    finanzen: t('settings.ki.news.topicFinance'),
    tech: t('settings.ki.news.topicTech'),
    chartanalyse: t('settings.ki.news.topicChartanalyse'),
}))

/*
 * Dieselbe Regel wie beim Versand — geteiltes Modul statt zweiter Umsetzung.
 * Zeigte die Oberfläche „4 Empfänger" und der Server schickte an drei, suchte
 * man den Grund am SMTP-Zugang statt an der Adresse.
 */
const newsEmpfaenger = computed(() => empfaengerPruefung(radarNewsMailAn.value))

/* Prüfung der eigenen Anweisungen: Befunde und geschärfte Fassung. */
const anweisungPruefung = ref(null)
const anweisungLaeuft = ref(false)

/**
 * Die eigene Anweisung vom Modell beurteilen lassen.
 *
 * Geprüft wird der Text im Feld, nicht der gespeicherte — sonst müsste man
 * erst speichern, um zu erfahren, ob das Gespeicherte etwas taugt. Gespeichert
 * wird erst mit „Übernehmen".
 */
async function anweisungPruefen() {
    anweisungLaeuft.value = true
    anweisungPruefung.value = null
    try {
        const { data } = await axios.post('/api/marktradar/lagebericht/anweisung-pruefen',
            { text: radarNewsPromptZusatz.value }, { timeout: 120000 })
        anweisungPruefung.value = data
    } catch (e) {
        anweisungPruefung.value = {
            befunde: [{ art: 'wirkungslos', text: e.response?.data?.error || e.message }],
            vorschlag: '',
        }
    } finally {
        anweisungLaeuft.value = false
    }
}

function anweisungUebernehmen() {
    radarNewsPromptZusatz.value = anweisungPruefung.value.vorschlag
    radarSpeichern('radarNewsPromptZusatz')
    anweisungPruefung.value = null
}

/*
 * Eine Prüfung veraltet, sobald sich der Zuschnitt ändert, gegen den
 * `bauAnweisungPruefPrompt` urteilt (siehe `anweisungPruefen`). Ohne das blieb
 * ein "wirkungslos, weil Kapitel X nicht existiert" auf dem Schirm stehen,
 * nachdem X längst angehakt wurde — der Leser sah einen Befund, der sich auf
 * eine Auswahl bezog, die es nicht mehr gab.
 *
 * Punktzahl und Meldungstiefe stehen seit dem Umbau ebenfalls im Prüf-Prompt
 * und gehören deshalb hierher: Eine Anweisung wie „fasse dich kürzer" wird
 * gegen den eingestellten Umfang beurteilt, und der ändert sich hier.
 */
watch([radarNewsThemen, radarNewsLaenge, radarNewsPunkte, radarNewsMeldungsTiefe],
    () => { anweisungPruefung.value = null }, { deep: true })

/* 0 ist kein Wert, sondern „Vorgabe der Länge" — deshalb zeigen die Felder
   dann „auto" statt einer nackten Null, wie in der Schnellleiste auf
   /nachrichten auch. Dafür kein `v-model`, sondern Wert und Änderung getrennt. */
function grenzeZahl(wert, max) {
    return Math.max(0, Math.min(max, Math.round(Number(wert) || 0)))
}

let berichtLaeuft = ref(false)
let berichtMeldung = ref('')
let berichtFehler = ref(false)

/**
 * Was ein Lauf ungefähr kostet — aus den tatsächlich eingestellten Werten,
 * nicht als feste Zahl im Text. Grundlage: Claude-Bericht rund 6 000 Token
 * ein und 900 aus; Video bei Gemini rund 100 Token je Sekunde in niedriger
 * und 300 in Standardauflösung, angenommene 20 Minuten Länge.
 *
 * Bewusst eine Spanne und ein „ungefähr": Videolängen schwanken zwischen fünf
 * und sechzig Minuten, und eine auf den Rappen genaue Zahl wäre hier gelogen.
 */
const kostenSchaetzung = computed(() => {
    const bericht = 0.05                       // Opus 4.6: 6k ein + 900 aus
    const proSekunde = radarNewsAufloesung.value === 'standard' ? 300 : 100
    const proVideo = (20 * 60 * proSekunde / 1e6) * 0.30   // Gemini 0,30 $/Mio.
    const videos = Math.max(0, Math.min(10, Number(radarNewsVideos.value) || 0))
    return { gesamt: bericht + videos * proVideo, proVideo, bericht, videos }
})

/* Der Bericht kostet Geld — deshalb ausschliesslich auf ausdrücklichen
   Knopfdruck, mit sichtbarer Rückmeldung darüber, was er verbraucht hat. */
async function berichtJetzt() {
    berichtLaeuft.value = true
    berichtMeldung.value = ''
    berichtFehler.value = false
    try {
        const { data } = await axios.post('/api/marktradar/lagebericht/erzeugen')
        if (data.uebersprungen) {
            berichtMeldung.value = 'Zuletzt vor Kurzem erzeugt — höchstens alle fünf Minuten.'
        } else if (data.fehler) {
            berichtMeldung.value = data.fehler
            berichtFehler.value = true
        } else {
            berichtMeldung.value = `Fertig: ${data.beitraege} Beiträge, ${data.videos} Video(s), `
                + `${data.tokens} Token via ${data.provider}/${data.modell}`
                + (data.kostenUsd ? ` — ${data.kostenUsd.toFixed(4)} USD` : '')
                + (data.geminiFehler ? ` · Gemini: ${data.geminiFehler}` : '')
        }
    } catch (e) {
        berichtMeldung.value = e.response?.data?.error || e.message
        berichtFehler.value = true
    } finally {
        berichtLaeuft.value = false
    }
}
</script>

<template>
    <div>

        <!--=============== VERSAND ===============-->
        <!-- Der Lagebericht ist der einzige Meldungstyp mit eigener
             Empfängerliste: Er geht oft an mehrere Leser, während
             alle anderen Meldungen den einen Betreiber angehen.
             Deshalb steht der Schalter HIER und nicht in der
             Benachrichtigungs-Tabelle. -->
        <hr class="mt-4" />
        <p class="fw-bold mb-1">{{ t('settings.ki.news.sendTitle') }}</p>
        <p class="fw-lighter" style="font-size:0.85rem;">
            {{ t('settings.ki.news.sendIntro') }}
        </p>

        <!-- Der Browser-Hinweis stand bisher in der
             Benachrichtigungs-Tabelle. Er zieht mit um, sonst wäre
             er nach dem Umbau nirgends mehr erreichbar. Gespeichert
             wird er weiterhin in derselben Kanalwahl. -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.browserLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.browserHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="newsBrowserToggle"
                        :checked="kanalAn('lageberichtFertig', 'browser')"
                        :disabled="!browserNotifications"
                        @change="setzeKanal('lageberichtFertig', 'browser', $event.target.checked)">
                </div>
                <label class="mb-0" for="newsBrowserToggle">
                    {{ kanalAn('lageberichtFertig', 'browser')
                        ? t('settings.ki.news.browserOn') : t('settings.ki.news.browserOff') }}
                </label>
                <span v-if="!browserNotifications" class="text-muted small">
                    {{ t('settings.ki.news.browserGlobalOff') }}
                </span>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.mailOnLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.mailOnHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="radarNewsMailAktivToggle"
                        v-model="radarNewsMailAktiv" @change="radarSpeichern('radarNewsMailAktiv')">
                </div>
                <label class="mb-0" for="radarNewsMailAktivToggle">
                    {{ radarNewsMailAktiv ? t('settings.ki.news.mailOn') : t('settings.ki.news.mailOff') }}
                </label>
                <!-- Ohne SMTP-Zugang ist der Schalter eine leere
                     Zusage — dann steht hier, was fehlt. -->
                <span v-if="radarNewsMailAktiv && !mail.mailAktiv" class="text-warning small">
                    <i class="uil uil-exclamation-triangle me-1"></i>
                    {{ t('settings.ki.news.mailNoSmtp') }}
                </span>
            </div>
        </div>

        <div v-if="radarNewsMailAktiv" class="row align-items-start mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.recipientsLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.recipientsHint', { max: EMPFAENGER_MAX }) }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <textarea class="form-control form-control-sm" rows="3"
                    :placeholder="t('settings.ki.news.recipientsPlaceholder')"
                    v-model="radarNewsMailAn" @change="radarSpeichern('radarNewsMailAn')"></textarea>
                <!-- Was der Server daraus macht, steht direkt darunter.
                     Eine stille Filterung wäre die schlechtere Wahl:
                     Ein Tippfehler fiele erst auf, wenn die Post
                     ausbleibt — und dann sucht man am SMTP-Zugang. -->
                <div class="small mt-1">
                    <template v-if="newsEmpfaenger.gueltig.length">
                        <span class="text-muted">{{ t('settings.ki.news.recipientsOk', {
                            n: newsEmpfaenger.gueltig.length }) }}</span>
                        <span class="ms-1">{{ newsEmpfaenger.gueltig.join(', ') }}</span>
                    </template>
                    <span v-else-if="radarNewsMailAn.trim()" class="text-danger">
                        {{ t('settings.ki.news.recipientsNone') }}
                    </span>
                    <span v-else class="text-muted">
                        {{ t('settings.ki.news.recipientsFallback', { adresse: mail.mailAn || '—' }) }}
                    </span>
                    <div v-if="newsEmpfaenger.verworfen.length" class="text-danger">
                        {{ t('settings.ki.news.recipientsBad', {
                            was: newsEmpfaenger.verworfen.join(', ') }) }}
                    </div>
                </div>
            </div>
        </div>

        <div v-if="radarNewsMailAktiv" class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.mailLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.mailHint') }}
                </small>
            </div>
            <!-- Auswahl statt Schalter: Ein Schalter, dessen Beschriftung
                 sich mitdreht, zeigt immer nur den JETZIGEN Zustand — was
                 beim Umlegen käme, muss man raten. Hier stehen alle
                 Möglichkeiten nebeneinander, wie bei der Aufbewahrung
                 darunter. -->
            <div class="col-12 col-md-8">
                <select class="form-select form-select-sm" style="max-width:26rem;"
                    v-model="radarNewsMailInhalt" @change="radarSpeichern('radarNewsMailInhalt')">
                    <option value="kurz">{{ t('settings.ki.news.mailShort') }}</option>
                    <option value="mittel">{{ t('settings.ki.news.mailMedium') }}</option>
                    <option value="voll">{{ t('settings.ki.news.mailFull') }}</option>
                </select>
            </div>
        </div>

        <!-- Aufbewahrung. Steht bei der Mail und nicht bei den
             Quellen: Es geht um die erzeugten Berichte, nicht um
             die eingesammelten Beiträge — die haben ihre eigenen
             30 Tage im Abruf. -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.keepLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.keepHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <select class="form-select form-select-sm" style="max-width:10rem;"
                    v-model="radarNewsBerichtAufbewahrung"
                    @change="radarSpeichern('radarNewsBerichtAufbewahrung')">
                    <option value="manuell">{{ t('settings.ki.news.keepManual') }}</option>
                    <option value="tag">{{ t('settings.ki.news.keepDay') }}</option>
                    <option value="woche">{{ t('settings.ki.news.keepWeek') }}</option>
                    <option value="monat">{{ t('settings.ki.news.keepMonth') }}</option>
                </select>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.topicsLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.topicsHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-3 flex-wrap">
                <label v-for="(bez, th) in themenNamen" :key="th"
                    class="d-flex align-items-center gap-1 mb-0">
                    <input type="checkbox" :value="th" v-model="radarNewsThemen"
                        :disabled="radarNewsThemen.length === 1 && radarNewsThemen.includes(th)"
                        @change="radarSpeichern('radarNewsThemen')">
                    <span>{{ bez }}</span>
                </label>
                <!-- Nur sinnvoll, wenn das Kapitel überhaupt gewählt
                     ist — sonst steht hier ein Regler für etwas,
                     das gar nicht erzeugt wird. -->
                <select v-if="radarNewsThemen.includes('chartanalyse')"
                    class="form-select form-select-sm" style="max-width:13rem;"
                    v-model="radarNewsChartFrische" :title="t('settings.ki.news.chartHint')"
                    @change="radarSpeichern('radarNewsChartFrische')">
                    <option value="tag">{{ t('settings.ki.news.chartTag') }}</option>
                    <option value="woche">{{ t('settings.ki.news.chartWoche') }}</option>
                    <option value="monat">{{ t('settings.ki.news.chartMonat') }}</option>
                </select>
                <select class="form-select form-select-sm" style="max-width:10rem;"
                    v-model="radarNewsLaenge" @change="radarSpeichern('radarNewsLaenge')">
                    <option value="kurz">{{ t('news.len.kurz') }} — {{ t('news.lenSub.kurz') }}</option>
                    <option value="mittel">{{ t('news.len.mittel') }} — {{ t('news.lenSub.mittel') }}</option>
                    <option value="lang">{{ t('news.len.lang') }} — {{ t('news.lenSub.lang') }}</option>
                </select>
            </div>
        </div>

        <!-- Darstellung des fertigen Berichts. Wirkt sofort, auch auf
             bereits erzeugte Berichte — es ist reine Anzeige. -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.layoutLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.layoutHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-3 flex-wrap">
                <label v-for="l in ['dossier', 'kombiniert', 'artikel', 'kacheln']" :key="l"
                    class="d-flex align-items-center gap-1 mb-0">
                    <input type="radio" :value="l" v-model="radarNewsLayout"
                        @change="radarSpeichern('radarNewsLayout')">
                    <span>{{ t('news.layout.' + l) }}
                        <small class="text-muted">— {{ t('news.layoutSub.' + l) }}</small></span>
                </label>
            </div>
        </div>

        <!-- Eigene Anweisungen an die Berichts-KI. Bewusst NUR hier
             und nicht auf der Nachrichtenseite: Das ist nichts, was
             man zwischen zwei Berichten umwirft, und ein Prompt-Feld
             neben dem Erzeugen-Knopf lädt genau dazu ein. -->
        <div class="row mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.customLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.customHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <textarea class="form-control form-control-sm" rows="4" maxlength="2000"
                    v-model="radarNewsPromptZusatz"
                    :placeholder="t('settings.ki.news.customPlaceholder')"
                    @change="radarSpeichern('radarNewsPromptZusatz')"></textarea>
                <small class="d-block text-muted mt-1" style="font-size:0.75rem;">
                    {{ t('settings.ki.news.customLimits', {
                        n: radarNewsPromptZusatz.length, max: 2000,
                    }) }}
                </small>

                <!-- Prüfen, bevor es einen bezahlten Lauf kostet.
                     Ob ein Satz überhaupt wirkt, sah man bisher
                     erst am fertigen Bericht — und bei dem, was an
                     den Grundregeln abprallt, nie. -->
                <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary"
                        :disabled="anweisungLaeuft || !radarNewsPromptZusatz.trim()"
                        @click="anweisungPruefen">
                        <span v-if="anweisungLaeuft" class="spinner-border spinner-border-sm me-1"></span>
                        <i v-else class="uil uil-check-circle me-1"></i>
                        {{ t('settings.ki.news.checkBtn') }}
                    </button>
                    <small class="text-muted" style="font-size:0.75rem;">
                        {{ t('settings.ki.news.checkHint') }}
                    </small>
                </div>

                <div v-if="anweisungPruefung" class="mt-2 p-2"
                    style="border:1px solid var(--border-color,#2a2a30);border-radius:.4rem;">
                    <div v-for="(b, i) in anweisungPruefung.befunde" :key="i"
                        class="d-flex gap-2 align-items-start mb-1">
                        <span class="badge" :class="{
                            'text-bg-success': b.art === 'wirkt',
                            'text-bg-secondary': b.art === 'wirkungslos',
                            'text-bg-warning': b.art === 'gegenregel',
                        }" style="font-size:.68rem;">{{ t('settings.ki.news.mark.' + b.art) }}</span>
                        <span style="font-size:.8rem;">{{ b.text }}</span>
                    </div>
                    <div v-if="anweisungPruefung.vorschlag" class="mt-2">
                        <div class="text-muted" style="font-size:.75rem;">
                            {{ t('settings.ki.news.suggestion') }}
                        </div>
                        <div style="font-size:.82rem;white-space:pre-wrap;">{{ anweisungPruefung.vorschlag }}</div>
                        <div class="d-flex gap-2 mt-2">
                            <button type="button" class="btn btn-sm btn-outline-primary"
                                :disabled="anweisungPruefung.vorschlag === radarNewsPromptZusatz.trim()"
                                @click="anweisungUebernehmen">
                                {{ t('settings.ki.news.apply') }}
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-secondary"
                                @click="anweisungPruefung = null">
                                {{ t('settings.ki.news.discard') }}
                            </button>
                        </div>
                    </div>
                    <small v-if="anweisungPruefung.kostenUsd" class="d-block text-muted mt-2"
                        style="font-size:.72rem;">
                        {{ anweisungPruefung.modell }} · {{ useKostenAnzeige(anweisungPruefung.kostenUsd) }}
                    </small>
                </div>
            </div>
        </div>

        <!-- Umfang: Meldungen je Kapitel und der Token-Deckel. Beide
             leer/0 = die oben gewählte Länge entscheidet.
             Dazwischen die Tiefe: Anzahl und Ausführlichkeit sind
             zwei Fragen, und wer die Anzahl selbst vorgibt, hatte
             vorher gar keinen Hebel mehr auf den Umfang. -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.scopeLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.scopeHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <span class="small">{{ t('news.points') }}</span>
                <input type="number" min="0" max="12" step="1" class="form-control form-control-sm"
                    style="max-width:6rem;" :placeholder="t('news.auto')"
                    :value="radarNewsPunkte || ''"
                    @change="radarNewsPunkte = grenzeZahl($event.target.value, 12); radarSpeichern('radarNewsPunkte')" />
                <span class="small ms-2">{{ t('settings.ki.news.pointDepthLabel') }}</span>
                <select class="form-select form-select-sm" style="max-width:12rem;"
                    :title="t('news.pointDepthHint')"
                    v-model="radarNewsMeldungsTiefe" @change="radarSpeichern('radarNewsMeldungsTiefe')">
                    <option v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" :value="v">
                        {{ t('news.depth.' + v) }} — {{ t('news.pointDepthSub.' + v) }}
                    </option>
                </select>
                <span class="small ms-2">{{ t('news.budget') }}</span>
                <input type="number" min="0" max="60000" step="500" class="form-control form-control-sm"
                    style="max-width:7rem;" :placeholder="t('news.auto')"
                    :value="radarNewsTokenBudget || ''"
                    @change="radarNewsTokenBudget = grenzeZahl($event.target.value, 60000); radarSpeichern('radarNewsTokenBudget')" />
                <span class="small text-muted">{{ t('settings.ki.news.scopeAuto') }}</span>
            </div>
        </div>

        <!-- Eigene Markteinordnung im Bericht. Steht direkt unter
             Umfang und Tiefe, weil sie denselben Zweck hat: sie
             bestimmt, was im Bericht steht — nur nicht, wie viel,
             sondern was ausser Nachrichten. -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.lagenLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.lagenHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <div class="d-flex align-items-center flex-wrap gap-2">
                    <div class="form-check form-switch mb-0">
                        <input class="form-check-input" type="checkbox" id="radarNewsLagenAn"
                            v-model="radarNewsLagenAn" @change="radarSpeichern('radarNewsLagenAn')" />
                        <label class="form-check-label small" for="radarNewsLagenAn">
                            {{ t('settings.ki.news.lagenAn') }}
                        </label>
                    </div>
                    <template v-if="radarNewsLagenAn">
                        <span class="small ms-2">{{ t('settings.ki.news.lagenSymbol') }}</span>
                        <input type="text" class="form-control form-control-sm text-uppercase"
                            style="max-width:9rem;" placeholder="BTCUSDT"
                            v-model="radarNewsLagenSymbol"
                            @change="radarNewsLagenSymbol = (radarNewsLagenSymbol || 'BTCUSDT').toUpperCase(); radarSpeichern('radarNewsLagenSymbol'); pruefeLagenSymbol()" />
                        <small v-if="lagenSymbolWarnung" class="text-warning">{{ lagenSymbolWarnung }}</small>
                        <small v-else class="text-muted">{{ t('settings.ki.news.lagenSymbolHint') }}</small>
                    </template>
                </div>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.researchLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.researchHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <span class="small text-muted">{{ t('settings.ki.news.grokModel') }}</span>
                <input class="form-control form-control-sm" style="max-width:12rem;"
                    v-model="radarNewsXModell" @change="radarSpeichern('radarNewsXModell')">
                <span class="small text-muted">{{ t('settings.ki.news.perplexityModel') }}</span>
                <select class="form-select form-select-sm" style="max-width:16rem;"
                    v-model="radarNewsRechercheModell"
                    @change="kiSpeichern('radarNewsRechercheModell', radarNewsRechercheModell)">
                    <option v-for="m in (modellListen.perplexity || ['sonar', 'sonar-pro'])" :key="m" :value="m">{{ m }}</option>
                    <option value="deepseek-suche">DeepSeek-Suche + Haiku (billiger)</option>
                </select>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.videosLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.videosHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2">
                <input type="number" class="form-control" style="max-width:6rem;" min="0" max="10"
                    v-model.number="radarNewsVideos" @change="radarSpeichern('radarNewsVideos')" />
                <!-- Aus dem Modellkatalog des Projekts statt freies
                     Textfeld: ein Tippfehler hier fiele erst beim
                     ersten Videolauf auf, und der kostet Geld. -->
                <select class="form-select" style="max-width:16rem;"
                    v-model="radarNewsModel" @change="radarSpeichern('radarNewsModel')">
                    <option value="">{{ t('settings.ki.news.geminiDefault') }}</option>
                    <!-- Ein gespeichertes Modell, das der Katalog nicht (mehr) führt,
                         bleibt wählbar — sonst stünde das Feld leer da und der
                         nächste Speichervorgang hätte die Einstellung gelöscht. -->
                    <option v-if="radarNewsModel && !(modellListen.gemini || []).includes(radarNewsModel)"
                        :value="radarNewsModel">
                        {{ radarNewsModel }} {{ t('settings.ki.news.notInCatalog') }}
                    </option>
                    <option v-for="m in (modellListen.gemini || [])" :key="m" :value="m">{{ m }}</option>
                </select>
            </div>
        </div>

        <!-- Wie ausführlich Gemini beschreibt. Der Token-Deckel dahinter
             begrenzt nur die AUSGABE — der Preis eines Videos entsteht
             auf der Eingabeseite (Länge × Auflösung). -->
        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.videoDepthLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('news.videoDepthHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <select class="form-select form-select-sm" style="max-width:18rem;"
                    v-model="radarNewsVideoTiefe" @change="radarSpeichern('radarNewsVideoTiefe')">
                    <option v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" :value="v">
                        {{ t('news.depth.' + v) }} — {{ t('news.depthSub.' + v) }}
                    </option>
                </select>
                <span class="small ms-2">{{ t('news.budget') }}</span>
                <input type="number" min="0" max="4000" step="100" class="form-control form-control-sm"
                    style="max-width:6.5rem;" :placeholder="t('news.auto')"
                    :value="radarNewsVideoTokens || ''"
                    @change="radarNewsVideoTokens = grenzeZahl($event.target.value, 4000); radarSpeichern('radarNewsVideoTokens')" />
                <span class="small text-muted">{{ t('settings.ki.news.videoTokensHint') }}</span>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.reportModelLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.reportModelHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <AnbieterWahl :provider="radarNewsBerichtProvider" :modell="radarNewsBerichtModell"
                    :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                    @update:provider="w => { radarNewsBerichtProvider = w; radarNewsBerichtModell = ''; radarSpeichern('radarNewsBerichtProvider'); radarSpeichern('radarNewsBerichtModell') }"
                    @update:modell="w => { radarNewsBerichtModell = w; radarSpeichern('radarNewsBerichtModell') }" />
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.resolutionLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.resolutionHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8">
                <select class="form-select form-select-sm" style="max-width:22rem;"
                    v-model="radarNewsAufloesung" @change="radarSpeichern('radarNewsAufloesung')">
                    <option value="niedrig">{{ t('settings.ki.news.resolutionLow') }}</option>
                    <option value="standard">{{ t('settings.ki.news.resolutionStd') }}</option>
                </select>
            </div>
        </div>

        <div class="mt-3">
            <button class="btn btn-outline-primary btn-sm" :disabled="berichtLaeuft" @click="berichtJetzt">
                <span v-if="berichtLaeuft" class="spinner-border spinner-border-sm me-2"></span>
                {{ t('settings.ki.news.generateNow') }}
            </button>
            <span class="ms-2 small text-muted">
                {{ t('settings.ki.news.costAbout') }}
                <strong>{{ useKostenAnzeige(kostenSchaetzung.gesamt) }}</strong>
                <span v-if="kostenSchaetzung.videos">
                    {{ t('settings.ki.news.costSplit', {
                        text: useKostenZahl(kostenSchaetzung.bericht),
                        n: kostenSchaetzung.videos,
                        proVideo: useKostenZahl(kostenSchaetzung.proVideo),
                    }) }}
                </span>
                <span v-else>{{ t('settings.ki.news.costNoVideos') }}</span>
            </span>
            <div v-if="berichtMeldung" class="small mt-2" :class="berichtFehler ? 'text-danger' : 'text-muted'">
                {{ berichtMeldung }}
            </div>
        </div>
    </div>
</template>
