<script setup>
/** KI → Nachrichten, erster Teil: News-Profile, Quellen, Filter, Rhythmus und Zwischenmeldungen. */
import { ref, computed } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import InfoTipp from '@/components/InfoTipp.vue'
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
        <div class="mb-3 p-2 rounded" style="background: rgba(255,255,255,.03);">
            <p class="fw-bold mb-1" style="font-size:0.9rem;">
                {{ t('settings.ki.news.profilesTitle') }}
                <InfoTipp schluessel="settings.info.newsProfile" />
            </p>
            <p class="fw-lighter" style="font-size:0.8rem;">
                {{ t('settings.ki.news.profilesDescription') }}
            </p>
            <table class="table table-sm align-middle mb-2" v-if="newsProfile.length">
                <tbody>
                    <tr v-for="p in newsProfile" :key="p.id">
                        <td>
                            <input v-if="profilUmbenennen === p.id" class="form-control form-control-sm"
                                style="max-width:14rem;" v-model="profilUmbenennenName"
                                @keyup.enter="profilNameSpeichern(p)" @keyup.esc="profilUmbenennen = null">
                            <span v-else>{{ p.name }}</span>
                        </td>
                        <td class="text-muted small">
                            {{ new Date(Number(p.aktualisiertAm)).toLocaleString() }}
                        </td>
                        <td class="text-end">
                            <template v-if="profilUmbenennen === p.id">
                                <button class="btn btn-success btn-sm me-1" @click="profilNameSpeichern(p)">
                                    <i class="uil uil-check"></i>
                                </button>
                                <button class="btn btn-outline-secondary btn-sm" @click="profilUmbenennen = null">
                                    <i class="uil uil-times"></i>
                                </button>
                            </template>
                            <template v-else>
                                <button class="btn btn-outline-secondary btn-sm me-1" :title="t('settings.ki.news.renameTitle')"
                                    @click="profilUmbenennen = p.id; profilUmbenennenName = p.name">
                                    <i class="uil uil-edit-alt"></i>
                                </button>
                                <button class="btn btn-outline-primary btn-sm me-1" @click="profilAnwenden(p)">
                                    {{ t('common.apply') }}
                                </button>
                                <button class="btn btn-outline-secondary btn-sm me-1" @click="profilAktualisieren(p)"
                                    :title="t('settings.ki.news.updateProfileTitle')">
                                    {{ t('settings.ki.news.updateProfileBtn') }}
                                </button>
                                <template v-if="profilLoeschBestaetigung === p.id">
                                    <button class="btn btn-danger btn-sm me-1" @click="profilLoeschen(p)">{{ t('common.yes') }}</button>
                                    <button class="btn btn-outline-secondary btn-sm" @click="profilLoeschBestaetigung = null">{{ t('common.no') }}</button>
                                </template>
                                <button v-else class="btn btn-outline-danger btn-sm" @click="profilLoeschBestaetigung = p.id">
                                    <i class="uil uil-trash-alt"></i>
                                </button>
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
            <p v-else class="small text-muted">{{ t('settings.ki.news.noProfiles') }}</p>
            <div class="d-flex gap-2 align-items-center">
                <input class="form-control form-control-sm" style="max-width:16rem;"
                    v-model="neuesProfilName" :placeholder="t('settings.ki.news.newProfileNamePlaceholder')"
                    @keyup.enter="profilAnlegen">
                <button class="btn btn-outline-primary btn-sm" :disabled="!neuesProfilName.trim()" @click="profilAnlegen">
                    {{ t('settings.ki.news.saveAsProfileBtn') }}
                </button>
            </div>
            <div v-if="profilMeldung" class="small mt-2" :class="profilFehler ? 'text-danger' : 'text-muted'">
                {{ profilMeldung }}
            </div>
        </div>

        <!--=============== NACHRICHTENQUELLEN ===============-->
        <hr class="mt-4" />
        <p class="fw-bold mb-1">{{ t('settings.ki.news.sourcesTitle') }}</p>
        <p class="fw-lighter">
            {{ t('settings.ki.news.sourcesDescription') }}
        </p>
        <p class="fw-lighter" style="font-size:0.82rem;">
            {{ t('settings.ki.news.xSourceHint') }}
        </p>

        <div class="row align-items-center mb-2">
            <div class="col-12 col-md-3">
                <label class="fw-lighter">{{ t('settings.ki.news.tempExcludeLabel') }}<InfoTipp schluessel="settings.info.laermfilter" /></label>
            </div>
            <div class="col-12 col-md-9">
                <label class="switch">
                    <input type="checkbox" v-model="radarNewsQuellenAusschluss" @change="radarSpeichern('radarNewsQuellenAusschluss')">
                    <span class="slider round"></span>
                </label>
                <span class="ms-2 small text-muted">
                    {{ radarNewsQuellenAusschluss ? t('settings.ki.news.tempExcludeOn') : t('settings.ki.news.tempExcludeOff') }}
                </span>
            </div>
        </div>

        <!-- Der NEUE Ruhe-Filter: automatisch Truth Social, dazu
             Stichwörter. Wirkt auf Liste UND Berichtsgrundlage —
             gespeichert bleibt alles, eine geänderte Liste greift
             also auch rückwirkend. -->
        <div class="row mb-2">
            <div class="col-12 col-md-3">
                <label class="fw-lighter">{{ t('settings.ki.news.quietFilterLabel') }}<InfoTipp schluessel="settings.info.wortfilter" /></label>
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.quietFilterHint') }}
                </small>
            </div>
            <div class="col-12 col-md-9">
                <label class="switch">
                    <input type="checkbox" v-model="radarNewsRuheAn" @change="radarSpeichern('radarNewsRuheAn')">
                    <span class="slider round"></span>
                </label>
                <textarea class="form-control form-control-sm mt-2" rows="3" style="max-width:26rem;"
                    v-model="radarNewsRuheWoerter" :disabled="!radarNewsRuheAn"
                    placeholder="Donald Trump&#10;Michael Saylor"
                    @change="radarSpeichern('radarNewsRuheWoerter')"></textarea>
            </div>
        </div>

        <!-- Fokus-Filter: das Gegenstück. Wer ihn anschaltet, will
             NUR NOCH Beiträge zu seinen Stichwörtern sehen — sonst
             genau wie der Ruhe-Filter aufgebaut. -->
        <div class="row mb-2">
            <div class="col-12 col-md-3">
                <label class="fw-lighter">{{ t('settings.ki.news.focusFilterLabel') }}<InfoTipp schluessel="settings.info.fokusfilter" /></label>
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.focusFilterHint') }}
                </small>
            </div>
            <div class="col-12 col-md-9">
                <label class="switch">
                    <input type="checkbox" v-model="radarNewsFokusAn" @change="radarSpeichern('radarNewsFokusAn')">
                    <span class="slider round"></span>
                </label>
                <textarea class="form-control form-control-sm mt-2" rows="3" style="max-width:26rem;"
                    v-model="radarNewsFokusWoerter" :disabled="!radarNewsFokusAn"
                    placeholder="Bitcoin&#10;BTC"
                    @change="radarSpeichern('radarNewsFokusWoerter')"></textarea>
            </div>
        </div>

        <SchrittNewsQuellen :key="newsQuellenKey" />

        <div class="row align-items-center mt-2">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.autoLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.autoHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <!-- Bootstrap-Schalter wie im Rest der KI-Sektion; der
                     eigene `.switch` bleibt dem Marktradar vorbehalten. -->
                <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="radarNewsAutoToggle"
                        v-model="radarNewsAuto" @change="radarSpeichern('radarNewsAuto')">
                </div>
                <select class="form-select form-select-sm" style="max-width:8.5rem;"
                    v-model="radarNewsRhythmus" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsRhythmus')">
                    <option value="taeglich">{{ t('settings.ki.news.daily') }}</option>
                    <option value="woechentlich">{{ t('settings.ki.news.weekly') }}</option>
                    <option value="manuell">{{ t('settings.ki.news.manual') }}</option>
                </select>
                <InfoTipp schluessel="settings.info.newsRhythmus" />
                <select v-if="radarNewsRhythmus === 'woechentlich'" class="form-select form-select-sm" style="max-width:8.5rem;"
                    v-model.number="radarNewsWochentag" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsWochentag')">
                    <option v-for="(tag, i) in wochentagNamen" :key="i" :value="i + 1">{{ tag }}</option>
                </select>
                <!-- Bei „nur manuell" gibt es keine Stunde: Der Takt
                     erzeugt nichts, ein Uhrzeitfeld daneben würde
                     etwas anderes behaupten. -->
                <select v-if="radarNewsRhythmus !== 'manuell'" class="form-select form-select-sm" style="max-width:8rem;"
                    v-model.number="radarNewsStunde" :disabled="!radarNewsAuto" @change="radarSpeichern('radarNewsStunde')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                        {{ String(h - 1).padStart(2, '0') }}:00
                    </option>
                </select>
                <span v-if="radarNewsRhythmus !== 'manuell'" class="small text-muted">
                    {{ currentUser?.timeZone || t('settings.ki.news.localTime') }}
                </span>
                <span v-else class="small text-muted">{{ t('settings.ki.news.manualHint') }}</span>
            </div>
        </div>

        <!-- Zwischenmeldungen. Sie setzen auf dem Bericht des Tages auf —
             nicht um ihn umzuschreiben, sondern um zu melden, was
             seither dazukam. Bei „nur manuell" nicht wählbar: ohne
             automatischen Bericht gibt es nichts, worauf sie
             aufsetzen könnten. Von Hand geht es weiterhin über den
             Knopf auf der Nachrichtenseite. -->
        <div v-if="radarNewsRhythmus !== 'manuell'" class="row align-items-center mt-3">
            <div class="col-12 col-md-4">
                {{ t('settings.ki.news.updatesLabel') }}
                <small class="d-block text-muted" style="font-size:0.78rem;">
                    {{ t('settings.ki.news.updatesHint') }}
                </small>
            </div>
            <div class="col-12 col-md-8 d-flex align-items-center gap-2 flex-wrap">
                <select class="form-select form-select-sm" style="max-width:9.5rem;"
                    v-model.number="radarNewsUpdates" :disabled="!radarNewsAuto"
                    @change="radarSpeichern('radarNewsUpdates')">
                    <option :value="0">{{ t('settings.ki.news.updates0') }}</option>
                    <option :value="1">{{ t('settings.ki.news.updates1') }}</option>
                    <option :value="2">{{ t('settings.ki.news.updates2') }}</option>
                </select>
                <select v-if="radarNewsUpdates >= 1" class="form-select form-select-sm" style="max-width:8rem;"
                    v-model.number="radarNewsUpdateStunde1" :disabled="!radarNewsAuto"
                    @change="radarSpeichern('radarNewsUpdateStunden')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                        {{ String(h - 1).padStart(2, '0') }}:00
                    </option>
                </select>
                <select v-if="radarNewsUpdates >= 2" class="form-select form-select-sm" style="max-width:8rem;"
                    v-model.number="radarNewsUpdateStunde2" :disabled="!radarNewsAuto"
                    @change="radarSpeichern('radarNewsUpdateStunden')">
                    <option v-for="h in 24" :key="h - 1" :value="h - 1">
                        {{ String(h - 1).padStart(2, '0') }}:00
                    </option>
                </select>
                <span v-if="radarNewsUpdates" class="small text-muted">
                    {{ t('settings.ki.news.updatesCost') }}
                </span>
            </div>
        </div>
    </div>
</template>
