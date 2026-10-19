<script setup>
/** KI → Nachrichten, zweiter Teil: Versand, Aufbewahrung, Themen, Darstellung, eigene Anweisung, Umfang, Modelle. */
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import AnbieterWahl from '@/components/AnbieterWahl.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Pille from '@/components/basis/Pille.vue'
import Symbol from '@/components/basis/Symbol.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { useKostenAnzeige, useKostenZahl } from '../../../utils/journal/format.js'
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
        <h3 class="zwischentitel">{{ t('settings.ki.news.sendTitle') }}</h3>
        <p class="einleitung">{{ t('settings.ki.news.sendIntro') }}</p>

        <!-- Der Browser-Hinweis stand bisher in der
             Benachrichtigungs-Tabelle. Er zieht mit um, sonst wäre
             er nach dem Umbau nirgends mehr erreichbar. Gespeichert
             wird er weiterhin in derselben Kanalwahl. -->
        <Feld :label="t('settings.ki.news.browserLabel')" :hilfe="t('settings.ki.news.browserHint')">
            <div class="reihe">
                <Schalter :model-value="kanalAn('lageberichtFertig', 'browser')"
                    :disabled="!browserNotifications"
                    :label="kanalAn('lageberichtFertig', 'browser')
                        ? t('settings.ki.news.browserOn') : t('settings.ki.news.browserOff')"
                    @change="v => setzeKanal('lageberichtFertig', 'browser', v)" />
                <span v-if="!browserNotifications" class="leise">
                    {{ t('settings.ki.news.browserGlobalOff') }}
                </span>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.news.mailOnLabel')" :hilfe="t('settings.ki.news.mailOnHint')">
            <div class="reihe">
                <Schalter v-model="radarNewsMailAktiv"
                    :label="radarNewsMailAktiv ? t('settings.ki.news.mailOn') : t('settings.ki.news.mailOff')"
                    @change="radarSpeichern('radarNewsMailAktiv')" />
                <!-- Ohne SMTP-Zugang ist der Schalter eine leere
                     Zusage — dann steht hier, was fehlt. -->
                <span v-if="radarNewsMailAktiv && !mail.mailAktiv" class="leise warn">
                    <Symbol name="warnung" />
                    {{ t('settings.ki.news.mailNoSmtp') }}
                </span>
            </div>
        </Feld>

        <Feld v-if="radarNewsMailAktiv" :label="t('settings.ki.news.recipientsLabel')"
            :hilfe="t('settings.ki.news.recipientsHint', { max: EMPFAENGER_MAX })" fuer="kiNewsEmpfaenger">
            <textarea id="kiNewsEmpfaenger" rows="3"
                :placeholder="t('settings.ki.news.recipientsPlaceholder')"
                v-model="radarNewsMailAn" @change="radarSpeichern('radarNewsMailAn')"></textarea>
            <!-- Was der Server daraus macht, steht direkt darunter.
                 Eine stille Filterung wäre die schlechtere Wahl:
                 Ein Tippfehler fiele erst auf, wenn die Post
                 ausbleibt — und dann sucht man am SMTP-Zugang. -->
            <div class="meldung">
                <template v-if="newsEmpfaenger.gueltig.length">
                    <span class="leise">{{ t('settings.ki.news.recipientsOk', {
                        n: newsEmpfaenger.gueltig.length }) }}</span>
                    {{ ' ' }}<span class="adressen">{{ newsEmpfaenger.gueltig.join(', ') }}</span>
                </template>
                <span v-else-if="radarNewsMailAn.trim()" class="schlecht">
                    {{ t('settings.ki.news.recipientsNone') }}
                </span>
                <span v-else class="leise">
                    {{ t('settings.ki.news.recipientsFallback', { adresse: mail.mailAn || '—' }) }}
                </span>
                <div v-if="newsEmpfaenger.verworfen.length" class="schlecht">
                    {{ t('settings.ki.news.recipientsBad', {
                        was: newsEmpfaenger.verworfen.join(', ') }) }}
                </div>
            </div>
        </Feld>

        <!-- Auswahl statt Schalter: Ein Schalter, dessen Beschriftung
             sich mitdreht, zeigt immer nur den JETZIGEN Zustand — was
             beim Umlegen käme, muss man raten. Hier stehen alle
             Möglichkeiten nebeneinander, wie bei der Aufbewahrung
             darunter. -->
        <Feld v-if="radarNewsMailAktiv" :label="t('settings.ki.news.mailLabel')"
            :hilfe="t('settings.ki.news.mailHint')" fuer="kiNewsMailInhalt">
            <select id="kiNewsMailInhalt" class="breit"
                v-model="radarNewsMailInhalt" @change="radarSpeichern('radarNewsMailInhalt')">
                <option value="kurz">{{ t('settings.ki.news.mailShort') }}</option>
                <option value="mittel">{{ t('settings.ki.news.mailMedium') }}</option>
                <option value="voll">{{ t('settings.ki.news.mailFull') }}</option>
            </select>
        </Feld>

        <!-- Aufbewahrung. Steht bei der Mail und nicht bei den
             Quellen: Es geht um die erzeugten Berichte, nicht um
             die eingesammelten Beiträge — die haben ihre eigenen
             30 Tage im Abruf. -->
        <Feld :label="t('settings.ki.news.keepLabel')" :hilfe="t('settings.ki.news.keepHint')" fuer="kiNewsAufbewahrung">
            <select id="kiNewsAufbewahrung" class="mittel"
                v-model="radarNewsBerichtAufbewahrung"
                @change="radarSpeichern('radarNewsBerichtAufbewahrung')">
                <option value="manuell">{{ t('settings.ki.news.keepManual') }}</option>
                <option value="tag">{{ t('settings.ki.news.keepDay') }}</option>
                <option value="woche">{{ t('settings.ki.news.keepWeek') }}</option>
                <option value="monat">{{ t('settings.ki.news.keepMonth') }}</option>
            </select>
        </Feld>

        <Feld :label="t('settings.ki.news.topicsLabel')" :hilfe="t('settings.ki.news.topicsHint')">
            <div class="stapel">
                <div class="reihe auswahl">
                    <label v-for="(bez, th) in themenNamen" :key="th">
                        <input type="checkbox" :value="th" v-model="radarNewsThemen"
                            :disabled="radarNewsThemen.length === 1 && radarNewsThemen.includes(th)"
                            @change="radarSpeichern('radarNewsThemen')">
                        <span>{{ bez }}</span>
                    </label>
                </div>
                <div class="reihe">
                    <!-- Nur sinnvoll, wenn das Kapitel überhaupt gewählt
                         ist — sonst steht hier ein Regler für etwas,
                         das gar nicht erzeugt wird. -->
                    <select v-if="radarNewsThemen.includes('chartanalyse')"
                        v-model="radarNewsChartFrische" :title="t('settings.ki.news.chartHint')"
                        :aria-label="t('settings.ki.news.chartHint')"
                        @change="radarSpeichern('radarNewsChartFrische')">
                        <option value="tag">{{ t('settings.ki.news.chartTag') }}</option>
                        <option value="woche">{{ t('settings.ki.news.chartWoche') }}</option>
                        <option value="monat">{{ t('settings.ki.news.chartMonat') }}</option>
                    </select>
                    <select v-model="radarNewsLaenge" :aria-label="t('settings.ki.news.topicsLabel')"
                        @change="radarSpeichern('radarNewsLaenge')">
                        <option value="kurz">{{ t('news.len.kurz') }} — {{ t('news.lenSub.kurz') }}</option>
                        <option value="mittel">{{ t('news.len.mittel') }} — {{ t('news.lenSub.mittel') }}</option>
                        <option value="lang">{{ t('news.len.lang') }} — {{ t('news.lenSub.lang') }}</option>
                    </select>
                </div>
            </div>
        </Feld>

        <!-- Darstellung des fertigen Berichts. Wirkt sofort, auch auf
             bereits erzeugte Berichte — es ist reine Anzeige. -->
        <Feld :label="t('settings.ki.news.layoutLabel')" :hilfe="t('settings.ki.news.layoutHint')">
            <div class="stapel auswahl" role="radiogroup" :aria-label="t('settings.ki.news.layoutLabel')">
                <label v-for="l in ['dossier', 'kombiniert', 'artikel', 'kacheln']" :key="l">
                    <input type="radio" :value="l" v-model="radarNewsLayout"
                        @change="radarSpeichern('radarNewsLayout')">
                    <span>{{ t('news.layout.' + l) }}
                        <span class="leise">— {{ t('news.layoutSub.' + l) }}</span></span>
                </label>
            </div>
        </Feld>

        <!-- Eigene Anweisungen an die Berichts-KI. Bewusst NUR hier
             und nicht auf der Nachrichtenseite: Das ist nichts, was
             man zwischen zwei Berichten umwirft, und ein Prompt-Feld
             neben dem Erzeugen-Knopf lädt genau dazu ein. -->
        <Feld :label="t('settings.ki.news.customLabel')" :hilfe="t('settings.ki.news.customHint')" fuer="kiNewsAnweisung">
            <div class="stapel">
                <textarea id="kiNewsAnweisung" rows="4" maxlength="2000"
                    v-model="radarNewsPromptZusatz"
                    :placeholder="t('settings.ki.news.customPlaceholder')"
                    @change="radarSpeichern('radarNewsPromptZusatz')"></textarea>
                <span class="leise">
                    {{ t('settings.ki.news.customLimits', {
                        n: radarNewsPromptZusatz.length, max: 2000,
                    }) }}
                </span>

                <!-- Prüfen, bevor es einen bezahlten Lauf kostet.
                     Ob ein Satz überhaupt wirkt, sah man bisher
                     erst am fertigen Bericht — und bei dem, was an
                     den Grundregeln abprallt, nie. -->
                <div class="reihe">
                    <Knopf klein symbol="haken" :laedt="anweisungLaeuft"
                        :disabled="!radarNewsPromptZusatz.trim()" @click="anweisungPruefen">
                        {{ t('settings.ki.news.checkBtn') }}
                    </Knopf>
                    <span class="leise">{{ t('settings.ki.news.checkHint') }}</span>
                </div>

                <div v-if="anweisungPruefung" class="flaeche pruefung">
                    <div v-for="(b, i) in anweisungPruefung.befunde" :key="i" class="befund">
                        <Pille :ton="{ wirkt: 'gut', wirkungslos: 'neutral', gegenregel: 'warn' }[b.art] || 'neutral'">
                            {{ t('settings.ki.news.mark.' + b.art) }}
                        </Pille>
                        <span>{{ b.text }}</span>
                    </div>
                    <div v-if="anweisungPruefung.vorschlag" class="vorschlag">
                        <div class="leise">{{ t('settings.ki.news.suggestion') }}</div>
                        <div class="vorschlag-text">{{ anweisungPruefung.vorschlag }}</div>
                        <div class="reihe">
                            <Knopf klein art="haupt"
                                :disabled="anweisungPruefung.vorschlag === radarNewsPromptZusatz.trim()"
                                @click="anweisungUebernehmen">
                                {{ t('settings.ki.news.apply') }}
                            </Knopf>
                            <Knopf klein art="leise" @click="anweisungPruefung = null">
                                {{ t('settings.ki.news.discard') }}
                            </Knopf>
                        </div>
                    </div>
                    <span v-if="anweisungPruefung.kostenUsd" class="leise block kosten">
                        {{ anweisungPruefung.modell }} · {{ useKostenAnzeige(anweisungPruefung.kostenUsd) }}
                    </span>
                </div>
            </div>
        </Feld>

        <!-- Umfang: Meldungen je Kapitel und der Token-Deckel. Beide
             leer/0 = die oben gewählte Länge entscheidet.
             Dazwischen die Tiefe: Anzahl und Ausführlichkeit sind
             zwei Fragen, und wer die Anzahl selbst vorgibt, hatte
             vorher gar keinen Hebel mehr auf den Umfang. -->
        <Feld :label="t('settings.ki.news.scopeLabel')" :hilfe="t('settings.ki.news.scopeHint')">
            <div class="reihe">
                <label class="beschriftet">
                    <span>{{ t('news.points') }}</span>
                    <input type="number" min="0" max="12" step="1" class="zahl-kurz"
                        :placeholder="t('news.auto')"
                        :value="radarNewsPunkte || ''"
                        @change="radarNewsPunkte = grenzeZahl($event.target.value, 12); radarSpeichern('radarNewsPunkte')" />
                </label>
                <label class="beschriftet">
                    <span>{{ t('settings.ki.news.pointDepthLabel') }}</span>
                    <select :title="t('news.pointDepthHint')"
                        v-model="radarNewsMeldungsTiefe" @change="radarSpeichern('radarNewsMeldungsTiefe')">
                        <option v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" :value="v">
                            {{ t('news.depth.' + v) }} — {{ t('news.pointDepthSub.' + v) }}
                        </option>
                    </select>
                </label>
                <label class="beschriftet">
                    <span>{{ t('news.budget') }}</span>
                    <input type="number" min="0" max="60000" step="500" class="zahl-mittel"
                        :placeholder="t('news.auto')"
                        :value="radarNewsTokenBudget || ''"
                        @change="radarNewsTokenBudget = grenzeZahl($event.target.value, 60000); radarSpeichern('radarNewsTokenBudget')" />
                </label>
                <span class="leise">{{ t('settings.ki.news.scopeAuto') }}</span>
            </div>
        </Feld>

        <!-- Eigene Markteinordnung im Bericht. Steht direkt unter
             Umfang und Tiefe, weil sie denselben Zweck hat: sie
             bestimmt, was im Bericht steht — nur nicht, wie viel,
             sondern was ausser Nachrichten. -->
        <Feld :label="t('settings.ki.news.lagenLabel')" :hilfe="t('settings.ki.news.lagenHint')">
            <div class="reihe">
                <Schalter v-model="radarNewsLagenAn" :label="t('settings.ki.news.lagenAn')"
                    @change="radarSpeichern('radarNewsLagenAn')" />
                <template v-if="radarNewsLagenAn">
                    <label class="beschriftet">
                        <span>{{ t('settings.ki.news.lagenSymbol') }}</span>
                        <input type="text" class="zahl-mittel gross" placeholder="BTCUSDT"
                            v-model="radarNewsLagenSymbol"
                            @change="radarNewsLagenSymbol = (radarNewsLagenSymbol || 'BTCUSDT').toUpperCase(); radarSpeichern('radarNewsLagenSymbol'); pruefeLagenSymbol()" />
                    </label>
                    <span v-if="lagenSymbolWarnung" class="leise warn">{{ lagenSymbolWarnung }}</span>
                    <span v-else class="leise">{{ t('settings.ki.news.lagenSymbolHint') }}</span>
                </template>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.news.researchLabel')" :hilfe="t('settings.ki.news.researchHint')">
            <div class="reihe">
                <label class="beschriftet">
                    <span class="leise">{{ t('settings.ki.news.grokModel') }}</span>
                    <input class="mittel" v-model="radarNewsXModell" @change="radarSpeichern('radarNewsXModell')">
                </label>
                <label class="beschriftet">
                    <span class="leise">{{ t('settings.ki.news.perplexityModel') }}</span>
                    <select v-model="radarNewsRechercheModell"
                        @change="kiSpeichern('radarNewsRechercheModell', radarNewsRechercheModell)">
                        <option v-for="m in (modellListen.perplexity || ['sonar', 'sonar-pro'])" :key="m" :value="m">{{ m }}</option>
                        <option value="deepseek-suche">{{ t('settings.ki.deepseekSearch') }}</option>
                    </select>
                </label>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.news.videosLabel')" :hilfe="t('settings.ki.news.videosHint')">
            <div class="reihe">
                <input type="number" class="zahl-kurz" min="0" max="10"
                    :aria-label="t('settings.ki.news.videosLabel')"
                    v-model.number="radarNewsVideos" @change="radarSpeichern('radarNewsVideos')" />
                <!-- Aus dem Modellkatalog des Projekts statt freies
                     Textfeld: ein Tippfehler hier fiele erst beim
                     ersten Videolauf auf, und der kostet Geld. -->
                <select v-model="radarNewsModel" :aria-label="t('settings.ki.news.geminiDefault')"
                    @change="radarSpeichern('radarNewsModel')">
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
        </Feld>

        <!-- Wie ausführlich Gemini beschreibt. Der Token-Deckel dahinter
             begrenzt nur die AUSGABE — der Preis eines Videos entsteht
             auf der Eingabeseite (Länge × Auflösung). -->
        <Feld :label="t('settings.ki.news.videoDepthLabel')" :hilfe="t('news.videoDepthHint')">
            <div class="reihe">
                <select v-model="radarNewsVideoTiefe" :aria-label="t('settings.ki.news.videoDepthLabel')"
                    @change="radarSpeichern('radarNewsVideoTiefe')">
                    <option v-for="v in ['knapp', 'normal', 'ausfuehrlich']" :key="v" :value="v">
                        {{ t('news.depth.' + v) }} — {{ t('news.depthSub.' + v) }}
                    </option>
                </select>
                <label class="beschriftet">
                    <span>{{ t('news.budget') }}</span>
                    <input type="number" min="0" max="4000" step="100" class="zahl-mittel"
                        :placeholder="t('news.auto')"
                        :value="radarNewsVideoTokens || ''"
                        @change="radarNewsVideoTokens = grenzeZahl($event.target.value, 4000); radarSpeichern('radarNewsVideoTokens')" />
                </label>
                <span class="leise">{{ t('settings.ki.news.videoTokensHint') }}</span>
            </div>
        </Feld>

        <Feld :label="t('settings.ki.news.reportModelLabel')" :hilfe="t('settings.ki.news.reportModelHint')">
            <AnbieterWahl :provider="radarNewsBerichtProvider" :modell="radarNewsBerichtModell"
                :modell-listen="modellListen" :global-provider="aiProvider" :global-modell="aiModel"
                @update:provider="w => { radarNewsBerichtProvider = w; radarNewsBerichtModell = ''; radarSpeichern('radarNewsBerichtProvider'); radarSpeichern('radarNewsBerichtModell') }"
                @update:modell="w => { radarNewsBerichtModell = w; radarSpeichern('radarNewsBerichtModell') }" />
        </Feld>

        <Feld :label="t('settings.ki.news.resolutionLabel')" :hilfe="t('settings.ki.news.resolutionHint')" fuer="kiNewsAufloesung">
            <select id="kiNewsAufloesung" class="breit"
                v-model="radarNewsAufloesung" @change="radarSpeichern('radarNewsAufloesung')">
                <option value="niedrig">{{ t('settings.ki.news.resolutionLow') }}</option>
                <option value="standard">{{ t('settings.ki.news.resolutionStd') }}</option>
            </select>
        </Feld>

        <div class="knoepfe">
            <Knopf :laedt="berichtLaeuft" symbol="zeitung" @click="berichtJetzt">
                {{ t('settings.ki.news.generateNow') }}
            </Knopf>
            <span class="leise">
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
        </div>
        <p v-if="berichtMeldung" class="meldung" :class="berichtFehler ? 'schlecht' : 'leise'">
            {{ berichtMeldung }}
        </p>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.auswahl { gap: var(--abstand-2) var(--abstand-4); }
.auswahl label,
.beschriftet {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-2);
    min-width: 0;
    cursor: pointer;
}
.stapel.auswahl label { align-items: flex-start; }
.stapel.auswahl input { margin-top: 0.3rem; }
.beschriftet { flex-wrap: wrap; cursor: default; font-size: 0.88rem; }
.beschriftet select,
.beschriftet input { width: auto; max-width: 100%; }
.beschriftet .zahl-kurz,
.reihe > .zahl-kurz { width: 6rem; }
.beschriftet .zahl-mittel { width: 9rem; }
.gross { text-transform: uppercase; }
.adressen { overflow-wrap: anywhere; }
.pruefung { margin: 0; }
.befund {
    display: flex;
    align-items: flex-start;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-1);
    font-size: 0.85rem;
}
.befund :deep(.at-pille) { flex: none; }
.vorschlag {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    margin-top: var(--abstand-2);
}
.vorschlag-text {
    font-size: 0.85rem;
    white-space: pre-wrap;
}
.kosten { margin-top: var(--abstand-2); font-size: 0.75rem; }
</style>
