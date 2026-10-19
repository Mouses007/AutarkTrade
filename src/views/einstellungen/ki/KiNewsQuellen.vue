<script setup>
/** KI → Nachrichten, erster Teil: News-Profile, Quellen, Filter, Rhythmus und Zwischenmeldungen. */
import { ref, computed } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
import Knopf from '@/components/basis/Knopf.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import SchrittNewsQuellen from '@/components/onboarding/SchrittNewsQuellen.vue'
import { currentUser } from '@/stores/settings.js'
import { dbGetSettings } from '@/utils/db.js'
import {
    newsProfile, radarNewsQuellenAusschluss, radarNewsRuheAn, radarNewsRuheWoerter, radarNewsFokusAn,
    radarNewsFokusWoerter, radarNewsAuto, radarNewsStunde, radarNewsRhythmus, radarNewsWochentag,
    radarNewsUpdates, radarNewsUpdateStunde1, radarNewsUpdateStunde2, useRadarEinstellungen,
} from '../gemeinsam/useRadarEinstellungen.js'

const { t } = useI18n()
const { loadRadarSettings, ladeNewsProfile, radarSpeichern } = useRadarEinstellungen()

/* Wochentage aus der Übersetzung — als computed, damit ein Sprachwechsel sie
   sofort mitzieht. */
const wochentagNamen = computed(() => [1, 2, 3, 4, 5, 6, 7].map(i => t('settings.ki.news.wd' + i)))

/* Erzwingt einen Remount von <SchrittNewsQuellen>, wenn ein Profil die
   Quellen serverseitig ändert — siehe profilAnwenden(). */
let newsQuellenKey = ref(0)
let neuesProfilName = ref('')
let profilLoeschBestaetigung = ref(null)
let profilMeldung = ref('')
let profilFehler = ref(false)
/* Umbenennen inline in der Zeile statt eigenem Formular — bei einem einzigen
   Feld wäre ein zweiter Editier-Modus wie bei den Strategie-Instanzen
   überdimensioniert. */
let profilUmbenennen = ref(null)
let profilUmbenennenName = ref('')

function profilMelden(text, fehler = false) {
    profilMeldung.value = text
    profilFehler.value = fehler
    setTimeout(() => { profilMeldung.value = '' }, 6000)
}

/** Diff-/Fehlwerte aus der Anwenden-Antwort in eine Zeile für den Nutzer. */
function profilHinweis(antwort) {
    const teile = []
    const geaendertFelder = Object.keys(antwort.geaendert || {})
    if (geaendertFelder.length) {
        teile.push(`Mail-/Modellwahl wurde mit übernommen (${geaendertFelder.length} Feld/Felder geändert)`)
    }
    if (antwort.fehlendeQuellen?.length) {
        teile.push(`Quellen aus dem Profil nicht mehr vorhanden: ${antwort.fehlendeQuellen.join(', ')}`)
    }
    return teile.join(' · ')
}

async function profilAnlegen() {
    const name = neuesProfilName.value.trim()
    if (!name) return
    try {
        await axios.post('/api/marktradar/news-profile', { name })
        neuesProfilName.value = ''
        await ladeNewsProfile()
        profilMelden(`Profil "${name}" angelegt.`)
    } catch (e) {
        profilMelden(e.response?.data?.error || e.message, true)
    }
}

async function profilNameSpeichern(p) {
    const name = profilUmbenennenName.value.trim()
    if (!name) return
    try {
        await axios.put(`/api/marktradar/news-profile/${p.id}`, { name })
        profilUmbenennen.value = null
        await ladeNewsProfile()
    } catch (e) {
        profilMelden(e.response?.data?.error || e.message, true)
    }
}

async function profilAnwenden(p) {
    try {
        const { data } = await axios.post(`/api/marktradar/news-profile/${p.id}/anwenden`)
        // Die Anwenden-Route schreibt direkt per Knex, nicht über
        // dbUpdateSettings — currentUser muss deshalb frisch geholt werden,
        // sonst zeigt die Seite noch den alten Stand.
        currentUser.value = await dbGetSettings()
        loadRadarSettings()
        // Die Quellen-Tabelle lebt jetzt in einer eigenen, self-contained
        // Komponente (lädt nur bei ihrem eigenen Mount) — ein Profilwechsel
        // ändert `news_sources` aber serverseitig direkt, also erzwingt der
        // Schlüsselwechsel einen Remount statt eines toten Reload-Aufrufs.
        newsQuellenKey.value++
        const hinweis = profilHinweis(data)
        profilMelden(`Profil "${p.name}" angewendet.${hinweis ? ' ' + hinweis : ''}`)
    } catch (e) {
        profilMelden(e.response?.data?.error || e.message, true)
    }
}

async function profilAktualisieren(p) {
    try {
        await axios.put(`/api/marktradar/news-profile/${p.id}`, { uebernehmen: true })
        await ladeNewsProfile()
        profilMelden(`Profil "${p.name}" mit den aktuellen Einstellungen aktualisiert.`)
    } catch (e) {
        profilMelden(e.response?.data?.error || e.message, true)
    }
}

async function profilLoeschen(p) {
    try {
        const warAktiv = Number(currentUser.value?.radarNewsAktivesProfil) === p.id
        await axios.delete(`/api/marktradar/news-profile/${p.id}`)
        profilLoeschBestaetigung.value = null
        await ladeNewsProfile()
        // Der Server hat radarNewsAktivesProfil zurückgesetzt, wenn es das
        // gelöschte Profil war — den lokalen Stand nachziehen, sonst zeigt
        // das Dropdown auf der Nachrichten-Seite weiter eine tote Auswahl.
        if (warAktiv) currentUser.value = await dbGetSettings()
    } catch (e) {
        profilMelden(e.response?.data?.error || e.message, true)
    }
}
</script>

<template>
    <div>

        <!--=============== NEWS-PROFILE ===============-->
        <!-- Benannte Sammlungen aller Felder unten auf dieser Seite
             PLUS Fokus-/Ausschluss-Filter und Quellen-Auswahl von
             der Marktradar-Unterseite. Anlegen/Aktualisieren
             schnappt einfach ein, was hier gerade eingestellt ist —
             kein zweites Formular, das dieselben ~30 Felder noch
             einmal abfragt. -->
        <div class="flaeche">
            <h4 class="profil-titel">
                {{ t('settings.ki.news.profilesTitle') }}
                <InfoTipp schluessel="settings.info.newsProfile" />
            </h4>
            <p class="leise">{{ t('settings.ki.news.profilesDescription') }}</p>
            <div v-if="newsProfile.length" class="liste profile">
                <div v-for="p in newsProfile" :key="p.id" class="liste-zeile">
                    <span class="liste-name profil-name">
                        <input v-if="profilUmbenennen === p.id" class="mittel" v-model="profilUmbenennenName"
                            :aria-label="t('settings.ki.news.renameTitle')"
                            @keyup.enter="profilNameSpeichern(p)" @keyup.esc="profilUmbenennen = null">
                        <span v-else>{{ p.name }}</span>
                    </span>
                    <span class="liste-mitte leise">
                        {{ new Date(Number(p.aktualisiertAm)).toLocaleString() }}
                    </span>
                    <span class="liste-ende">
                        <template v-if="profilUmbenennen === p.id">
                            <Knopf art="haupt" klein symbol="haken" nur-symbol :titel="t('common.save')"
                                @click="profilNameSpeichern(p)" />
                            <Knopf klein art="leise" symbol="schliessen" nur-symbol :titel="t('common.cancel')"
                                @click="profilUmbenennen = null" />
                        </template>
                        <template v-else>
                            <Knopf klein art="leise" :titel="t('settings.ki.news.renameTitle')"
                                @click="profilUmbenennen = p.id; profilUmbenennenName = p.name">
                                {{ t('common.edit') }}
                            </Knopf>
                            <Knopf klein @click="profilAnwenden(p)">{{ t('common.apply') }}</Knopf>
                            <Knopf klein :titel="t('settings.ki.news.updateProfileTitle')" @click="profilAktualisieren(p)">
                                {{ t('settings.ki.news.updateProfileBtn') }}
                            </Knopf>
                            <template v-if="profilLoeschBestaetigung === p.id">
                                <Knopf klein art="gefahr" @click="profilLoeschen(p)">{{ t('common.yes') }}</Knopf>
                                <Knopf klein art="leise" @click="profilLoeschBestaetigung = null">{{ t('common.no') }}</Knopf>
                            </template>
                            <Knopf v-else klein art="gefahr" @click="profilLoeschBestaetigung = p.id">
                                {{ t('common.delete') }}
                            </Knopf>
                        </template>
                    </span>
                </div>
            </div>
            <p v-else class="leise">{{ t('settings.ki.news.noProfiles') }}</p>
            <div class="reihe neu">
                <input class="mittel" v-model="neuesProfilName"
                    :placeholder="t('settings.ki.news.newProfileNamePlaceholder')"
                    :aria-label="t('settings.ki.news.newProfileNamePlaceholder')"
                    @keyup.enter="profilAnlegen">
                <Knopf klein :disabled="!neuesProfilName.trim()" @click="profilAnlegen">
                    {{ t('settings.ki.news.saveAsProfileBtn') }}
                </Knopf>
            </div>
            <p v-if="profilMeldung" class="meldung" :class="profilFehler ? 'schlecht' : 'leise'">
                {{ profilMeldung }}
            </p>
        </div>

        <!--=============== NACHRICHTENQUELLEN ===============-->
        <h3 class="zwischentitel">{{ t('settings.ki.news.sourcesTitle') }}</h3>
        <p class="einleitung">{{ t('settings.ki.news.sourcesDescription') }}</p>
        <p class="leise">{{ t('settings.ki.news.xSourceHint') }}</p>

        <Feld>
            <template #label>
                <span>{{ t('settings.ki.news.tempExcludeLabel') }}</span><InfoTipp schluessel="settings.info.laermfilter" />
            </template>
            <Schalter v-model="radarNewsQuellenAusschluss"
                :label="radarNewsQuellenAusschluss ? t('settings.ki.news.tempExcludeOn') : t('settings.ki.news.tempExcludeOff')"
                @change="radarSpeichern('radarNewsQuellenAusschluss')" />
        </Feld>

        <!-- Der NEUE Ruhe-Filter: automatisch Truth Social, dazu
             Stichwörter. Wirkt auf Liste UND Berichtsgrundlage —
             gespeichert bleibt alles, eine geänderte Liste greift
             also auch rückwirkend. -->
        <Feld :hilfe="t('settings.ki.news.quietFilterHint')">
            <template #label>
                <span>{{ t('settings.ki.news.quietFilterLabel') }}</span><InfoTipp schluessel="settings.info.wortfilter" />
            </template>
            <div class="stapel">
                <Schalter v-model="radarNewsRuheAn" @change="radarSpeichern('radarNewsRuheAn')" />
                <textarea class="breit" rows="3"
                    v-model="radarNewsRuheWoerter" :disabled="!radarNewsRuheAn"
                    :aria-label="t('settings.ki.news.quietFilterLabel')"
                    placeholder="Donald Trump&#10;Michael Saylor"
                    @change="radarSpeichern('radarNewsRuheWoerter')"></textarea>
            </div>
        </Feld>

        <!-- Fokus-Filter: das Gegenstück. Wer ihn anschaltet, will
             NUR NOCH Beiträge zu seinen Stichwörtern sehen — sonst
             genau wie der Ruhe-Filter aufgebaut. -->
        <Feld :hilfe="t('settings.ki.news.focusFilterHint')">
            <template #label>
                <span>{{ t('settings.ki.news.focusFilterLabel') }}</span><InfoTipp schluessel="settings.info.fokusfilter" />
            </template>
            <div class="stapel">
                <Schalter v-model="radarNewsFokusAn" @change="radarSpeichern('radarNewsFokusAn')" />
                <textarea class="breit" rows="3"
                    v-model="radarNewsFokusWoerter" :disabled="!radarNewsFokusAn"
                    :aria-label="t('settings.ki.news.focusFilterLabel')"
                    placeholder="Bitcoin&#10;BTC"
                    @change="radarSpeichern('radarNewsFokusWoerter')"></textarea>
            </div>
        </Feld>

        <SchrittNewsQuellen :key="newsQuellenKey" />

        <Feld :label="t('settings.ki.news.autoLabel')" :hilfe="t('settings.ki.news.autoHint')">
            <div class="reihe">
                <Schalter v-model="radarNewsAuto" @change="radarSpeichern('radarNewsAuto')" />
                <select v-model="radarNewsRhythmus" :disabled="!radarNewsAuto"
                    :aria-label="t('settings.ki.news.autoLabel')" @change="radarSpeichern('radarNewsRhythmus')">
                    <option value="taeglich">{{ t('settings.ki.news.daily') }}</option>
                    <option value="woechentlich">{{ t('settings.ki.news.weekly') }}</option>
                    <option value="manuell">{{ t('settings.ki.news.manual') }}</option>
                </select>
                <InfoTipp schluessel="settings.info.newsRhythmus" />
                <select v-if="radarNewsRhythmus === 'woechentlich'"
                    v-model.number="radarNewsWochentag" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsWochentag')">
                    <option v-for="(tag, i) in wochentagNamen" :key="i" :value="i + 1">{{ tag }}</option>
                </select>
                <!-- Bei „nur manuell" gibt es keine Stunde: Der Takt
                     erzeugt nichts, ein Uhrzeitfeld daneben würde
                     etwas anderes behaupten. -->
                <select v-if="radarNewsRhythmus !== 'manuell'"
                    v-model.number="radarNewsStunde" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsStunde')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                            {{ String(h - 1).padStart(2, '0') }}:00
                        </option>
                </select>
                <span v-if="radarNewsRhythmus !== 'manuell'" class="leise">
                    {{ currentUser?.timeZone || t('settings.ki.news.localTime') }}
                </span>
                <span v-else class="leise">{{ t('settings.ki.news.manualHint') }}</span>
            </div>
        </Feld>

        <!-- Zwischenmeldungen. Sie setzen auf dem Bericht des Tages auf —
             nicht um ihn umzuschreiben, sondern um zu melden, was
             seither dazukam. Bei „nur manuell" nicht wählbar: ohne
             automatischen Bericht gibt es nichts, worauf sie
             aufsetzen könnten. Von Hand geht es weiterhin über den
             Knopf auf der Nachrichtenseite. -->
        <Feld v-if="radarNewsRhythmus !== 'manuell'" :label="t('settings.ki.news.updatesLabel')"
            :hilfe="t('settings.ki.news.updatesHint')">
            <div class="reihe">
                <select v-model.number="radarNewsUpdates" :disabled="!radarNewsAuto"
                    :aria-label="t('settings.ki.news.updatesLabel')"
                    @change="radarSpeichern('radarNewsUpdates')">
                    <option :value="0">{{ t('settings.ki.news.updates0') }}</option>
                    <option :value="1">{{ t('settings.ki.news.updates1') }}</option>
                    <option :value="2">{{ t('settings.ki.news.updates2') }}</option>
                </select>
                <select v-if="radarNewsUpdates >= 1"
                    v-model.number="radarNewsUpdateStunde1" :disabled="!radarNewsAuto"
                    @change="radarSpeichern('radarNewsUpdateStunden')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                            {{ String(h - 1).padStart(2, '0') }}:00
                        </option>
                </select>
                <select v-if="radarNewsUpdates >= 2"
                    v-model.number="radarNewsUpdateStunde2" :disabled="!radarNewsAuto"
                    @change="radarSpeichern('radarNewsUpdateStunden')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                            {{ String(h - 1).padStart(2, '0') }}:00
                        </option>
                </select>
                <span v-if="radarNewsUpdates" class="leise">
                    {{ t('settings.ki.news.updatesCost') }}
                </span>
            </div>
        </Feld>
    </div>
</template>

<style scoped src="./ki-formular.css"></style>
<style scoped>
.profil-titel {
    margin: 0 0 var(--abstand-1);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
}
.profile { margin-bottom: var(--abstand-3); background: var(--panel); }
.profil-name { flex-basis: 14rem; }
.neu { margin-top: var(--abstand-2); }
</style>
