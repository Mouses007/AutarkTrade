<script setup>
/**
 * System → Sicherheit: zweiter Faktor beim Anmelden.
 *
 * Zwei Wege, beide nur bei aktivem Passwortschutz:
 * - Authenticator-App (TOTP): QR-Code scannen, mit dem ersten Code und dem
 *   Passwort bestätigen. Erst danach verlangt der Login den Code.
 * - YubiKey / Sicherheitsschlüssel (WebAuthn): registrieren, umbenennen,
 *   entfernen. Ein registrierter Schlüssel gilt als zweiter Faktor — aber nur
 *   unter dem Namen, unter dem er registriert wurde (nie über eine IP).
 *   „Mit YubiKey anmelden" ohne Passwort gibt es nur mit dem Schalter
 *   „Anmelden nur mit dem YubiKey", ab Werk aus (Audit 4.3.4 SEC-S1-002);
 *   Einschalten verlangt das aktuelle Passwort.
 *
 * Keine Wiederherstellungscodes: verloren ist verloren, der Rückweg ist der
 * Rücksetzcode aus dem Server-Log bzw. AT_RESET_AUTH=1 (löscht beides).
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import qrcode from 'qrcode-generator'
import { Knopf, Pille } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import Schalter from '../gemeinsam/Schalter.vue'
import { schluesselAnlegen, schluesselMoeglich } from '@/utils/webauthn.js'

const props = defineProps({
    authEnabled: { type: Boolean, default: false },
})
const { t } = useI18n()

const status = ref({})
async function ladeStatus() {
    try { status.value = (await axios.get('/api/auth/status')).data || {} } catch { status.value = {} }
}

const fehlerText = (e) => e.response?.data?.error || e.message

// ── Authenticator-App ──
const appOffen = ref(false)
const totpAn = computed(() => !!status.value.zweiFaktor?.totp)
const neu = ref(null)          // { geheimnis, uri } während der Einrichtung
const appCode = ref('')
const appPasswort = ref('')
const appLaedt = ref(false)
const appMeldung = ref(null)

/** QR-Code der otpauth-Adresse als SVG-Pfad (ein Quadrat je dunklem Modul). */
const qr = computed(() => {
    if (!neu.value?.uri) return null
    const q = qrcode(0, 'M')
    q.addData(neu.value.uri)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { n, d }
})
const geheimnisGruppen = computed(() => (neu.value?.geheimnis || '').match(/.{1,4}/g)?.join(' ') || '')

async function appEinrichten() {
    appMeldung.value = null
    appLaedt.value = true
    try {
        const { data } = await axios.post('/api/auth/totp/einrichten')
        neu.value = { geheimnis: data.geheimnis, uri: data.uri }
    } catch (e) {
        appMeldung.value = { gut: false, text: fehlerText(e) }
    }
    appLaedt.value = false
}

async function appBestaetigen() {
    appMeldung.value = null
    appLaedt.value = true
    try {
        await axios.post('/api/auth/totp/bestaetigen', { code: appCode.value, currentPassword: appPasswort.value })
        neu.value = null
        appCode.value = ''
        appPasswort.value = ''
        appMeldung.value = { gut: true, text: t('settings.sicherheit.app.istAktiv') }
        await ladeStatus()
    } catch (e) {
        appMeldung.value = { gut: false, text: fehlerText(e) }
    }
    appLaedt.value = false
}

async function appAus() {
    if (!confirm(t('settings.sicherheit.app.ausFrage'))) return
    appMeldung.value = null
    appLaedt.value = true
    try {
        await axios.post('/api/auth/totp/aus', { currentPassword: appPasswort.value })
        appPasswort.value = ''
        appMeldung.value = { gut: true, text: t('settings.sicherheit.app.istAus') }
        await ladeStatus()
    } catch (e) {
        appMeldung.value = { gut: false, text: fehlerText(e) }
    }
    appLaedt.value = false
}

// ── YubiKey / Sicherheitsschlüssel ──
const schluesselOffen = ref(false)
const liste = ref([])
const kontext = ref('ok')
const adresse = ref(null)
const neuName = ref('')
const schluesselPasswort = ref('')
const schluesselLaedt = ref(false)
const schluesselMeldung = ref(null)
const umbenennen = ref({ id: null, name: '' })
// „Anmelden nur mit dem YubiKey" (Server-Schalter `schluesselDirekt`)
const direkt = ref(false)

// Taugt dieser Aufruf zum Registrieren? Server (Name/HTTPS) und Browser müssen zustimmen.
const kannHier = computed(() => kontext.value === 'ok' && schluesselMoeglich())

async function ladeSchluessel() {
    try {
        const { data } = await axios.get('/api/auth/schluessel')
        liste.value = data.schluessel || []
        kontext.value = data.kontext
        adresse.value = data.adresse
        direkt.value = !!data.direkt
    } catch { liste.value = [] }
}

const datum = (ms) => (ms ? new Date(Number(ms)).toLocaleString() : t('settings.sicherheit.schluessel.nie'))

async function schluesselHinzufuegen() {
    schluesselMeldung.value = null
    schluesselLaedt.value = true
    try {
        const { data: o } = await axios.post('/api/auth/schluessel/registrieren/optionen')
        schluesselMeldung.value = { gut: true, text: t('settings.sicherheit.schluessel.antippen') }
        const antwort = await schluesselAnlegen(o.optionen)
        const { data } = await axios.post('/api/auth/schluessel/registrieren', {
            antwort, name: neuName.value, currentPassword: schluesselPasswort.value,
        })
        neuName.value = ''
        schluesselPasswort.value = ''
        schluesselMeldung.value = { gut: true, text: t(data.sitzungenEntwertet ? 'settings.sicherheit.schluessel.erster' : 'settings.sicherheit.schluessel.hinzugefuegt') }
        await Promise.all([ladeSchluessel(), ladeStatus()])
    } catch (e) {
        schluesselMeldung.value = { gut: false, text: e.grund ? t(`login.fehler.${e.grund}`) : fehlerText(e) }
    }
    schluesselLaedt.value = false
}

/** Schalter umlegen; Einschalten nur mit dem Passwort aus dem Feld darüber. */
async function direktUmschalten(an) {
    schluesselMeldung.value = null
    if (an && !schluesselPasswort.value) {
        // Erst zurückstellen, wenn Vue das `true` aus v-model gezeichnet hat:
        // im selben Takt sähe Vue keine Änderung, und die Checkbox bliebe
        // sichtbar eingeschaltet, obwohl der Schalter aus ist.
        await nextTick()
        direkt.value = false
        schluesselMeldung.value = { gut: false, text: t('settings.sicherheit.schluessel.direktPasswort') }
        return
    }
    try {
        const { data } = await axios.post('/api/auth/schluessel/direkt', an ? { an, currentPassword: schluesselPasswort.value } : { an })
        direkt.value = !!data.direkt
        if (an) schluesselPasswort.value = ''
        schluesselMeldung.value = { gut: true, text: t(data.direkt ? 'settings.sicherheit.schluessel.direktIstAn' : 'settings.sicherheit.schluessel.direktIstAus') }
        await ladeStatus()
    } catch (e) {
        direkt.value = !an
        schluesselMeldung.value = { gut: false, text: fehlerText(e) }
    }
}

async function namenSpeichern() {
    try {
        await axios.put(`/api/auth/schluessel/${umbenennen.value.id}`, { name: umbenennen.value.name })
        umbenennen.value = { id: null, name: '' }
        await ladeSchluessel()
    } catch (e) {
        schluesselMeldung.value = { gut: false, text: fehlerText(e) }
    }
}

async function entfernen(s) {
    if (!confirm(t('settings.sicherheit.schluessel.entfernenFrage', { name: s.name }))) return
    schluesselMeldung.value = null
    try {
        await axios.delete(`/api/auth/schluessel/${s.id}`, { data: { currentPassword: schluesselPasswort.value } })
        schluesselMeldung.value = { gut: true, text: t('settings.sicherheit.schluessel.entfernt') }
        await Promise.all([ladeSchluessel(), ladeStatus()])
    } catch (e) {
        schluesselMeldung.value = { gut: false, text: fehlerText(e) }
    }
}

onMounted(() => Promise.all([ladeStatus(), ladeSchluessel()]))
defineExpose({ neuLaden: () => Promise.all([ladeStatus(), ladeSchluessel()]) })
</script>

<template>
    <!--=============== AUTHENTICATOR-APP ===============-->
    <Abschnitt v-model:offen="appOffen" :titel="t('settings.sicherheit.app.titel')" symbol="schildHaken">
        <template #kopf>
            <Pille :ton="totpAn ? 'gut' : 'neutral'">
                {{ totpAn ? t('settings.sicherheit.aktiv') : t('settings.sicherheit.aus') }}
            </Pille>
        </template>

        <p class="hinweis">{{ t('settings.sicherheit.app.einleitung') }}</p>
        <p v-if="!props.authEnabled" class="hinweis">{{ t('settings.sicherheit.zuerstPasswort') }}</p>

        <template v-else-if="!totpAn">
            <div v-if="!neu" class="knoepfe">
                <Knopf art="haupt" :laedt="appLaedt" @click="appEinrichten">{{ t('settings.sicherheit.app.einrichten') }}</Knopf>
            </div>
            <template v-else>
                <p class="hinweis">{{ t('settings.sicherheit.app.scannen') }}</p>
                <div class="qr">
                    <svg v-if="qr" :viewBox="`-4 -4 ${qr.n + 8} ${qr.n + 8}`" role="img" :aria-label="t('settings.sicherheit.app.qrBeschreibung')"
                        shape-rendering="crispEdges">
                        <rect x="-4" y="-4" :width="qr.n + 8" :height="qr.n + 8" fill="#fff" />
                        <path :d="qr.d" fill="#000" />
                    </svg>
                </div>
                <p class="hinweis">{{ t('settings.sicherheit.app.abtippen') }} <code class="geheimnis">{{ geheimnisGruppen }}</code></p>
                <Feld :label="t('settings.sicherheit.app.code')" fuer="totp-code">
                    <input id="totp-code" v-model="appCode" type="text" class="eingabe" inputmode="numeric"
                        autocomplete="one-time-code" maxlength="7" :placeholder="t('settings.sicherheit.app.codePlatzhalter')" />
                </Feld>
                <Feld :label="t('settings.sicherheit.aktuell')" fuer="totp-pw">
                    <input id="totp-pw" v-model="appPasswort" type="password" class="eingabe" autocomplete="current-password" />
                </Feld>
                <div class="knoepfe">
                    <Knopf art="haupt" :laedt="appLaedt" :disabled="!appCode || !appPasswort" @click="appBestaetigen">
                        {{ t('settings.sicherheit.app.bestaetigen') }}
                    </Knopf>
                    <Knopf art="leise" @click="neu = null">{{ t('settings.sicherheit.app.abbrechen') }}</Knopf>
                </div>
            </template>
        </template>

        <template v-else>
            <Feld :label="t('settings.sicherheit.aktuell')" fuer="totp-aus-pw">
                <input id="totp-aus-pw" v-model="appPasswort" type="password" class="eingabe" autocomplete="current-password" />
            </Feld>
            <div class="knoepfe">
                <Knopf art="gefahr" :laedt="appLaedt" :disabled="!appPasswort" @click="appAus">{{ t('settings.sicherheit.app.ausschalten') }}</Knopf>
            </div>
        </template>

        <p v-if="appMeldung" class="meldung" :class="appMeldung.gut ? 'gut' : 'schlecht'">{{ appMeldung.text }}</p>
    </Abschnitt>

    <!--=============== YUBIKEY / SICHERHEITSSCHLÜSSEL ===============-->
    <Abschnitt v-model:offen="schluesselOffen" :titel="t('settings.sicherheit.schluessel.titel')" symbol="schluessel">
        <template #kopf>
            <Pille :ton="liste.length ? 'gut' : 'neutral'">
                {{ liste.length ? t('settings.sicherheit.schluessel.anzahl', { n: liste.length }) : t('settings.sicherheit.aus') }}
            </Pille>
        </template>

        <p class="hinweis">{{ t('settings.sicherheit.schluessel.einleitung') }}</p>
        <p v-if="!props.authEnabled" class="hinweis">{{ t('settings.sicherheit.zuerstPasswort') }}</p>

        <template v-else>
            <p v-if="!kannHier" class="hinweis warnung">
                {{ t(`settings.sicherheit.schluessel.kontext.${kontext === 'ok' ? 'browser' : kontext || 'fehlt'}`) }}
                <template v-if="adresse">
                    {{ t('settings.sicherheit.schluessel.adresseVor') }}
                    <a :href="adresse">{{ adresse }}</a>
                    {{ t('settings.sicherheit.schluessel.adresseNach') }}
                </template>
                <!-- Kein Name, den der Host-Schutz kennt (FUN-S1-004): sagen, was fehlt. -->
                <template v-else-if="kontext === 'ip' || kontext === 'name'">{{ t('settings.sicherheit.schluessel.ohneAdresse') }}</template>
            </p>

            <ul v-if="liste.length" class="liste">
                <li v-for="s in liste" :key="s.id">
                    <div class="zeile">
                        <template v-if="umbenennen.id === s.id">
                            <input v-model="umbenennen.name" type="text" class="eingabe klein" maxlength="64"
                                :aria-label="t('settings.sicherheit.schluessel.name')" @keyup.enter="namenSpeichern" />
                            <Knopf klein @click="namenSpeichern">{{ t('settings.sicherheit.schluessel.speichern') }}</Knopf>
                        </template>
                        <template v-else>
                            <strong>{{ s.name }}</strong>
                            <span class="leise">{{ s.rpId }}</span>
                        </template>
                        <span class="rechts">
                            <Knopf klein art="leise" symbol="stift" @click="umbenennen = { id: s.id, name: s.name }">
                                {{ t('settings.sicherheit.schluessel.umbenennen') }}
                            </Knopf>
                            <Knopf klein art="gefahr" symbol="muell" :disabled="!schluesselPasswort" @click="entfernen(s)">
                                {{ t('settings.sicherheit.schluessel.entfernen') }}
                            </Knopf>
                        </span>
                    </div>
                    <div class="leise">
                        {{ t('settings.sicherheit.schluessel.angelegt') }} {{ datum(s.erstelltAm) }} ·
                        {{ t('settings.sicherheit.schluessel.zuletzt') }} {{ datum(s.zuletztAm) }}
                    </div>
                </li>
            </ul>

            <p class="hinweis">{{ t('settings.sicherheit.schluessel.empfehlung') }}</p>

            <Feld :label="t('settings.sicherheit.schluessel.name')" fuer="schluessel-name">
                <input id="schluessel-name" v-model="neuName" type="text" class="eingabe" maxlength="64"
                    :placeholder="t('settings.sicherheit.schluessel.namePlatzhalter')" />
            </Feld>
            <Feld :label="t('settings.sicherheit.aktuell')" fuer="schluessel-pw">
                <input id="schluessel-pw" v-model="schluesselPasswort" type="password" class="eingabe" autocomplete="current-password"
                    :placeholder="t('settings.sicherheit.schluessel.passwortPlatzhalter')" />
            </Feld>
            <div class="knoepfe">
                <Knopf art="haupt" symbol="plus" :laedt="schluesselLaedt" :disabled="!kannHier || !schluesselPasswort" @click="schluesselHinzufuegen">
                    {{ t('settings.sicherheit.schluessel.hinzufuegen') }}
                </Knopf>
            </div>

            <div class="direkt">
                <Schalter v-model="direkt" :label="t('settings.sicherheit.schluessel.direkt')"
                    :hilfe="t('settings.sicherheit.schluessel.direktHilfe')" @change="direktUmschalten" />
            </div>
        </template>

        <p v-if="schluesselMeldung" class="meldung" :class="schluesselMeldung.gut ? 'gut' : 'schlecht'">{{ schluesselMeldung.text }}</p>
    </Abschnitt>
</template>

<style scoped>
.hinweis {
    margin: 0 0 var(--abstand-2);
    color: var(--muted);
    font-size: 0.88rem;
}
.hinweis.warnung { color: var(--warn); }
.hinweis a { color: var(--accent); word-break: break-all; }
.eingabe {
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
}
.eingabe.klein { width: auto; flex: 1; min-width: 8rem; padding: 0.35rem 0.6rem; }
.eingabe:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-flaeche);
}
.qr {
    width: 200px;
    max-width: 100%;
    margin: 0 0 var(--abstand-2);
}
.qr svg { display: block; width: 100%; height: auto; border-radius: var(--radius-knopf); }
.geheimnis {
    font-size: 0.95rem;
    letter-spacing: 0.05em;
    user-select: all;
    color: var(--text);
}
.knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-top: var(--abstand-3);
}
.liste {
    list-style: none;
    margin: 0 0 var(--abstand-3);
    padding: 0;
}
.liste li {
    padding: var(--abstand-2) 0;
    border-bottom: 1px solid var(--line);
}
.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
}
.zeile .rechts { margin-left: auto; display: flex; gap: var(--abstand-1); }
.leise { color: var(--muted); font-size: 0.82rem; }
.direkt {
    margin-top: var(--abstand-3);
    padding-top: var(--abstand-2);
    border-top: 1px solid var(--line);
}
.meldung {
    margin: var(--abstand-2) 0 0;
    font-size: 0.85rem;
}
.meldung.gut { color: var(--good); }
.meldung.schlecht { color: var(--bad); }
</style>
