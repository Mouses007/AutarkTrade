<script setup>
/**
 * Geräte → ESP32 → „Board flashen": Board per USB anstecken, verbinden, Chip
 * erkennen, Firmware wählen, flashen — im Browser über Web Serial (esptool-js),
 * ohne PlatformIO am Rechner. Geschrieben werden nur Bootloader, Partitionstabelle,
 * otadata und App; der NVS-Bereich mit WLAN, Server und Schlüssel bleibt stehen.
 *
 * „Einstellungen gleich mitgeben" (Standard an): nach dem Flash-Reset gehen WLAN,
 * Server-Adresse, Port und der Anzeige-Schlüssel über das serielle CFG-Protokoll
 * an die Firmware — der Setup-Hotspot entfällt. WLAN-Passwort, App-Passwort und
 * Schlüssel werden nirgends gespeichert und nach dem Senden verworfen; nur
 * WLAN-Name, Adresse und Port merkt sich dieser Browser.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '@/components/basis/Knopf.vue'
import Hinweis from '@/components/basis/Hinweis.vue'
import Symbol from '@/components/basis/Symbol.vue'
import { ESP32_BOARDS, boardsFuerChip, nvsBereich, hex, cfgFehler, hostVorschlag, httpPortVorschlag, signalBalken } from '../../../../shared/esp32-flashen.js'
import { Esp32Flasher, browserTauglich, ladeFirmwareDateien, vergleicheNvs, ordneFehler, oeffneWieder, CfgVerbindung, istUsbWandler } from '@/utils/esp32Flasher.js'

const { t } = useI18n()

const tauglich = browserTauglich()
const httpsAdresse = computed(() => `https://${location.hostname}:8443${location.pathname}`)

/* schritt: start | bootWarten (USB-Seriell-Wandler: BOOT drücken) | verbinde | bereit | flasht | richtetEin | fertig
 * phase (in richtetEin): wartet (Board startet) | sucht (CFG SCAN) | waehlt | sendet */
const schritt = ref('start')
const fehler = ref(null) // { code, text }
const firmware = ref([])
const geraet = ref(null) // { chip, beschreibung, mac, flashGroesse }
const boardTabelle = ref(null)
const gewaehltId = ref('')
const nvsBestaetigt = ref(false)
const fortschritt = ref({ geschrieben: 0, gesamt: 0 })
const protokoll = ref([])
const protokollOffen = ref(false)
let flasher = null
const usbWandler = ref(false) // CYD & Co.: BOOT-Taste halten (der Browser kann sie nicht automatisch in den Bootloader setzen)

/* ── Einstellungen mitgeben ─────────────────────────────────── */
const MERKEN = 'at.esp32Flashen.verbindung' // nur WLAN-Name, Adresse, Port — nie Passwort oder Schlüssel
function gemerkt() {
    try { return JSON.parse(localStorage.getItem(MERKEN) || '{}') || {} } catch { return {} }
}
const alt = gemerkt()
const mitgeben = ref(true)
const verbindung = reactive({
    ssid: alt.ssid || '',
    invert: alt.invert !== false, // CYD: Farbumkehr, ab Werk an (altes Verhalten); USB-C-Bauart braucht aus
    host: hostVorschlag(location) || alt.host || '',
    port: alt.port || httpPortVorschlag(location),
})
const wlanPass = ref('')
const appPasswort = ref('')
const passwortAktiv = ref(false)
const anzeigeKeyFehlt = ref(false)
const einrichtung = ref(null) // { ok: true, version } | { ok: false, code, text }
let abbruch = null

/* Netzauswahl nach dem Flash-Reset */
const ANDERES = '\u0000anderes' // kann keine echte SSID sein
const phase = ref('wartet')
const netze = ref([])          // [{ ssid, rssi, enc }]
const listeFehlt = ref(false)  // Firmware kann CFG SCAN nicht / Suche fehlgeschlagen
const gewaehltesNetz = ref('')
const eigeneSsid = ref('')
const sendeFehler = ref(null)  // { code, text } — Board hat abgelehnt, nochmals versuchen
let cfgVerbindung = null
let schluessel = null          // Anzeige-Schlüssel, nur bis zum Senden im Speicher

const netz = computed(() => netze.value.find((n) => n.ssid === gewaehltesNetz.value) || null)
const ssidFuerSenden = computed(() => (gewaehltesNetz.value === ANDERES ? eigeneSsid.value : gewaehltesNetz.value))
const brauchtPasswort = computed(() => gewaehltesNetz.value === ANDERES || netz.value?.enc === 1)
const wahlFehler = computed(() => (ssidFuerSenden.value
    ? cfgFehler({ ...verbindung, ssid: ssidFuerSenden.value, pass: brauchtPasswort.value ? wlanPass.value : '', key: 'x' })
        .filter((c) => c === 'ssid' || c === 'pass')
    : ['ssid']))
const kannSenden = computed(() => phase.value === 'waehlt' && !wahlFehler.value.length && (!netz.value || netz.value.enc === 0 || !!wlanPass.value))

watch(verbindung, (v) => {
    try { localStorage.setItem(MERKEN, JSON.stringify({ ssid: v.ssid, host: v.host, port: v.port, invert: v.invert })) } catch { /* privat */ }
})

/* Vor dem Flashen nur Adresse und Port prüfen — WLAN wählt man nach dem Neustart aus der Liste. */
const cfgCodes = computed(() => (mitgeben.value
    ? cfgFehler({ ...verbindung, ssid: 'x', pass: '', key: 'x' }).filter((c) => ['host', 'hostLocal', 'port'].includes(c))
    : []))
const feldFehler = (feld) => cfgCodes.value.includes(feld) || (feld === 'host' && cfgCodes.value.includes('hostLocal'))

async function ladeAuthStatus() {
    try { passwortAktiv.value = !!(await axios.get('/api/auth/status')).data?.authEnabled } catch { passwortAktiv.value = true }
}

/** Anzeige-Schlüssel holen, ohne ihn anzuzeigen. null = es gibt noch keinen. */
async function holeAnzeigeSchluessel() {
    try {
        const { data } = await axios.post('/api/esp32/key/kopieren', { art: 'anzeige', currentPassword: appPasswort.value })
        return data?.key || null
    } catch (e) {
        if (e.response?.status === 404) return null
        throw Object.assign(new Error(e.response?.data?.error || e.message), { code: 'schluessel' })
    }
}

async function erzeugeAnzeigeSchluessel() {
    const { data } = await axios.post('/api/esp32/settings', { regenerate: true, art: 'anzeige' })
    if (!data?.plainKey) throw Object.assign(new Error('Kein Schlüssel erhalten'), { code: 'schluessel' })
    return data.plainKey
}

onMounted(ladeAuthStatus)

/*
 * Alle Boards mit diesem Chip — auch die, deren Firmware nicht abgelegt ist. Sonst
 * stünde bei fehlender Touch-Firmware nur das ePaper zur Wahl und würde vorgewählt:
 * das wäre geraten. Ohne Firmware bleibt die Zeile sichtbar, aber nicht wählbar.
 */
const passende = computed(() => (geraet.value
    ? boardsFuerChip(geraet.value.chip).map((b) => firmware.value.find((f) => f.id === b.id) || { ...b, fehlt: true })
    : []))
const gewaehlt = computed(() => passende.value.find((b) => b.id === gewaehltId.value && !b.fehlt) || null)
const nvsLage = computed(() => (gewaehlt.value ? vergleicheNvs(boardTabelle.value, gewaehlt.value) : null))
const prozent = computed(() => (fortschritt.value.gesamt ? Math.floor((fortschritt.value.geschrieben / fortschritt.value.gesamt) * 100) : 0))
const kannFlashen = computed(() => !!gewaehlt.value && (nvsLage.value !== 'anders' || nvsBestaetigt.value)
    && !cfgCodes.value.length && (!mitgeben.value || !passwortAktiv.value || !!appPasswort.value))

function log(zeile) {
    protokoll.value.push(zeile)
    if (protokoll.value.length > 400) protokoll.value.splice(0, protokoll.value.length - 400)
}

function setzeFehler(e) {
    if (e?.code === 'schluessel') {
        fehler.value = { code: 'schluessel', text: e.message }
        log('Fehler: ' + e.message)
        return
    }
    const f = ordneFehler(e, flasher?.abgebrochen)
    if (f.code === 'keinPort') return // Auswahl geschlossen — kein Fehler
    fehler.value = { code: f.code, text: f.message }
    log('Fehler: ' + f.message)
}

async function ladeFirmware() {
    const { data } = await axios.get('/api/esp32/firmware')
    firmware.value = Array.isArray(data?.boards) ? data.boards : []
}

async function starte() {
    fehler.value = null
    protokoll.value = []
    geraet.value = null
    boardTabelle.value = null
    gewaehltId.value = ''
    nvsBestaetigt.value = false
    einrichtung.value = null
    anzeigeKeyFehlt.value = false
    flasher = new Esp32Flasher({ log })
    try {
        await flasher.waehlePort() // braucht die Geste dieses Klicks — vor jedem await auf das Netz
    } catch (e) {
        setzeFehler(e)
        return
    }
    usbWandler.value = istUsbWandler(flasher.port)
    // CYD & Co.: erst BOOT drücken lassen, dann verbinden — der Port ist noch nicht offen.
    if (usbWandler.value) { schritt.value = 'bootWarten'; return }
    await verbinde()
}

async function verbinde() {
    schritt.value = 'verbinde'
    try {
        await ladeFirmware()
        geraet.value = await flasher.verbinden()
        boardTabelle.value = await flasher.lesePartitionen()
        const bekannt = boardsFuerChip(geraet.value.chip, ESP32_BOARDS)
        const abgelegt = boardsFuerChip(geraet.value.chip, firmware.value)
        if (!bekannt.length || !abgelegt.length) {
            fehler.value = { code: bekannt.length ? 'keineFirmware' : 'falscherChip', text: geraet.value.chip }
            await flasher.trennen({ neustart: true })
            schritt.value = 'start'
            return
        }
        // Eindeutig nur, wenn es für diesen Chip überhaupt nur ein Board gibt — sonst wählt der Nutzer.
        if (bekannt.length === 1) gewaehltId.value = bekannt[0].id
        schritt.value = 'bereit'
    } catch (e) {
        setzeFehler(e)
        await flasher?.trennen({ neustart: false })
        schritt.value = 'start'
    }
}

function vergiss() {
    wlanPass.value = ''
    appPasswort.value = ''
    schluessel = null
}

async function schliesseCfg() {
    const v = cfgVerbindung
    cfgVerbindung = null
    await v?.schliessen()
}

/** @param {boolean} [neuerSchluessel] es gibt noch keinen Anzeige-Schlüssel — einen erzeugen */
async function flashe(neuerSchluessel = false) {
    if (!kannFlashen.value) return
    fehler.value = null
    einrichtung.value = null
    const manifest = gewaehlt.value
    // Den Schlüssel VOR dem Schreiben holen: ein falsches App-Passwort soll nicht
    // erst nach einer halben Minute Flashen auffallen.
    schluessel = null
    if (mitgeben.value) {
        try {
            schluessel = neuerSchluessel ? await erzeugeAnzeigeSchluessel() : await holeAnzeigeSchluessel()
        } catch (e) {
            setzeFehler(e)
            return
        }
        if (!schluessel) { anzeigeKeyFehlt.value = true; return }
        anzeigeKeyFehlt.value = false
    }
    schritt.value = 'flasht'
    fortschritt.value = { geschrieben: 0, gesamt: 0 }
    try {
        const dateien = await ladeFirmwareDateien(manifest)
        // Geschützt: NVS laut neuer Tabelle UND laut der Tabelle, die auf dem Board steht.
        const geschuetzt = [manifest.nvs, nvsBereich(boardTabelle.value)].filter(Boolean)
        log(`Schreibe ${manifest.name} ${manifest.version || ''} — NVS ${geschuetzt.map((g) => hex(g.offset)).join(', ')} bleibt unberührt`)
        await flasher.flashen(dateien, manifest.flash, geschuetzt, (geschrieben, gesamt) => {
            fortschritt.value = { geschrieben, gesamt }
        })
        await flasher.trennen({ neustart: true })
    } catch (e) {
        vergiss()
        setzeFehler(e)
        await flasher?.trennen({ neustart: false })
        schritt.value = 'start'
        return
    }
    if (!mitgeben.value) { vergiss(); schritt.value = 'fertig'; return }
    await verbindeNachReset()
}

function beende(ergebnis) {
    einrichtung.value = ergebnis
    vergiss()
    schritt.value = 'fertig'
}

/*
 * Nach dem Reset läuft die neue Firmware: Port wieder öffnen, CFG? bis BEREIT.
 * Reisst die Verbindung ab (S3: das Gerät meldet sich nach dem Reset neu an),
 * den Port neu suchen — alles zusammen in der ~30-s-Frist der Firmware.
 */
async function verbindeNachReset() {
    schritt.value = 'richtetEin'
    phase.value = 'wartet'
    sendeFehler.value = null
    abbruch = new AbortController()
    try {
        log('Warte auf das Board nach dem Neustart …')
        const bis = Date.now() + 30000
        for (let versuch = 1; ; versuch++) {
            const port = await oeffneWieder(flasher.port, { log, pauseMs: versuch === 1 ? 1500 : 500 })
            flasher.port = port
            cfgVerbindung = new CfgVerbindung(port, { log })
            try {
                await cfgVerbindung.warteBereit({ signal: abbruch.signal, bereitMs: Math.max(2000, bis - Date.now()) })
                break
            } catch (e) {
                await schliesseCfg()
                if (e?.code !== 'getrennt' || versuch >= 3 || Date.now() > bis) throw e
                log('Verbindung abgerissen, suche das Board erneut …')
            }
        }
        await sucheNetze()
    } catch (e) {
        await schliesseCfg()
        const f = ordneFehler(e, abbruch?.signal.aborted)
        log('Einrichten fehlgeschlagen: ' + f.message)
        beende({ ok: false, code: f.code, text: f.message })
    } finally {
        abbruch = null
    }
}

/* CFG SCAN — kann die Firmware es nicht, bleibt „Anderes Netz" mit freiem Feld. */
async function sucheNetze() {
    phase.value = 'sucht'
    sendeFehler.value = null
    try {
        netze.value = await cfgVerbindung.suche()
        listeFehlt.value = false
        log(`${netze.value.length} WLAN(s) gefunden`)
    } catch (e) {
        if (e?.code === 'getrennt') throw e
        log('Netzsuche nicht möglich: ' + e.message)
        netze.value = []
        listeFehlt.value = true
    }
    // Vorwahl: das gemerkte Netz, wenn es in der Liste ist — sonst nichts (nicht raten)
    if (netze.value.some((n) => n.ssid === verbindung.ssid)) gewaehltesNetz.value = verbindung.ssid
    else if (!netze.value.length) { gewaehltesNetz.value = ANDERES; eigeneSsid.value = verbindung.ssid }
    else gewaehltesNetz.value = ''
    phase.value = 'waehlt'
}

async function neuSuchen() {
    try {
        await sucheNetze()
    } catch (e) {
        await schliesseCfg()
        const f = ordneFehler(e)
        beende({ ok: false, code: f.code, text: f.message })
    }
}

async function sendeWahl() {
    if (!kannSenden.value) return
    phase.value = 'sendet'
    sendeFehler.value = null
    const ssid = ssidFuerSenden.value
    try {
        await cfgVerbindung.sende({
            ssid, pass: brauchtPasswort.value ? wlanPass.value : '', host: verbindung.host, port: verbindung.port, key: schluessel,
            // nur beim CYD — die Waveshare-Firmwares kennen das Feld nicht
            ...(gewaehlt.value?.id === 'cyd' ? { invert: verbindung.invert } : {}),
        })
        verbindung.ssid = ssid // merken (nur der Name)
        const version = cfgVerbindung?.version || null
        log('Board eingerichtet, startet neu')
        await schliesseCfg()
        beende({ ok: true, version })
    } catch (e) {
        const f = ordneFehler(e)
        if (f.code === 'cfgAbgelehnt' || f.code === 'cfgKeineAntwort') {
            // Board läuft weiter — korrigieren und nochmals senden
            log('Board hat abgelehnt: ' + f.message)
            sendeFehler.value = { code: f.code, text: f.message }
            phase.value = 'waehlt'
            return
        }
        await schliesseCfg()
        beende({ ok: false, code: f.code, text: f.message })
    }
}

async function ueberspringen() {
    await schliesseCfg()
    beende({ ok: false, code: 'uebersprungen', text: '' })
}

async function abbrechen() {
    if (abbruch) { abbruch.abort(); await schliesseCfg(); return }
    await flasher?.abbrechen()
}

async function schliesse() {
    await flasher?.trennen({ neustart: true })
    schritt.value = 'start'
    geraet.value = null
}

/* Seite verlassen oder Tab schliessen: den Port in JEDEM Zustand freigeben, sonst hält der Browser das Board. */
function freigeben() {
    abbruch?.abort()
    vergiss()
    schliesseCfg()
    flasher?.trennen({ neustart: false })
}
onMounted(() => window.addEventListener('pagehide', freigeben))
onBeforeUnmount(() => { window.removeEventListener('pagehide', freigeben); freigeben() })

const fehlerText = computed(() => {
    if (!fehler.value) return ''
    const c = fehler.value.code
    if (c === 'falscherChip') return t('settings.esp32Flashen.fehlerChip', { chip: fehler.value.text })
    if (c === 'keineFirmware') return t('settings.esp32Flashen.keineFirmware', { chip: fehler.value.text })
    if (c === 'schluessel') return t('settings.esp32Flashen.fehler.schluessel')
    return t(`settings.esp32Flashen.fehler.${['portBelegt', 'keineVerbindung', 'abgebrochen', 'getrennt', 'dateiFehler', 'schutz'].includes(c) ? c : 'unbekannt'}`)
})
const einrichtungText = computed(() => {
    const e = einrichtung.value
    if (!e || e.ok) return ''
    const grund = e.code === 'cfgAbgelehnt' ? e.text : ''
    if (e.code === 'uebersprungen') return t('settings.esp32Flashen.einrichten.uebersprungen')
    const bekannt = ['portWeg', 'cfgKeineAntwort', 'cfgAbgelehnt', 'abgebrochen', 'portBelegt', 'getrennt']
    return t(`settings.esp32Flashen.einrichten.fehler.${bekannt.includes(e.code) ? e.code : 'unbekannt'}`, { grund })
})
const sendeFehlerText = computed(() => {
    const e = sendeFehler.value
    if (!e) return ''
    return e.code === 'cfgAbgelehnt'
        ? t('settings.esp32Flashen.einrichten.fehler.cfgAbgelehnt', { grund: e.text })
        : t('settings.esp32Flashen.einrichten.fehler.cfgKeineAntwort')
})
const fehlerNachFlash = computed(() => ['abgebrochen', 'getrennt'].includes(fehler.value?.code) && fortschritt.value.geschrieben > 0)
</script>

<template>
    <div class="flashen">
        <h4 class="kasten-titel">{{ t('settings.esp32Flashen.titel') }}</h4>

        <Hinweis v-if="tauglich === 'keinSerial'" art="warn">{{ t('settings.esp32Flashen.keinSerial') }}</Hinweis>
        <Hinweis v-else-if="tauglich === 'unsicher'" art="warn">
            {{ t('settings.esp32Flashen.unsicher') }}
            <a :href="httpsAdresse">{{ httpsAdresse }}</a>
        </Hinweis>

        <template v-else>
            <p class="leise text">{{ t('settings.esp32Flashen.text') }}</p>

            <div v-if="schritt === 'start' || schritt === 'verbinde'" class="aktionen">
                <Knopf art="haupt" symbol="code" :laedt="schritt === 'verbinde'" @click="starte">
                    {{ schritt === 'verbinde' ? t('settings.esp32Flashen.verbinde') : t('settings.esp32Flashen.knopf') }}
                </Knopf>
            </div>
            <p v-if="schritt === 'start'" class="leise">{{ t('settings.esp32Flashen.bootVorher') }}</p>
            <template v-if="schritt === 'bootWarten'">
                <Hinweis art="warn" :titel="t('settings.esp32Flashen.bootWartenTitel')">{{ t('settings.esp32Flashen.bootWarten') }}</Hinweis>
                <div class="aktionen">
                    <Knopf art="haupt" @click="verbinde">{{ t('settings.esp32Flashen.bootVerbinden') }}</Knopf>
                    <Knopf art="leise" @click="schritt = 'start'">{{ t('common.cancel') }}</Knopf>
                </div>
            </template>
            <Hinweis v-if="schritt === 'verbinde' && usbWandler" art="warn">{{ t('settings.esp32Flashen.bootHalten') }}</Hinweis>
            <p v-else-if="schritt === 'verbinde'" class="leise">{{ t('settings.esp32Flashen.bootTaste') }}</p>

            <!-- Erkannt: Chip, Board-Wahl, NVS-Lage -->
            <div v-if="schritt === 'bereit' && geraet" class="erkannt">
                <Hinweis v-if="usbWandler" art="gut">{{ t('settings.esp32Flashen.bootLoslassen') }}</Hinweis>
                <dl class="werte">
                    <dt>{{ t('settings.esp32Flashen.chip') }}</dt><dd>{{ geraet.beschreibung || geraet.chip }}</dd>
                    <dt v-if="geraet.flashGroesse">Flash</dt><dd v-if="geraet.flashGroesse">{{ geraet.flashGroesse }}</dd>
                    <dt v-if="geraet.mac">MAC</dt><dd v-if="geraet.mac"><code>{{ geraet.mac }}</code></dd>
                </dl>

                <fieldset class="wahl">
                    <legend>{{ passende.length > 1 ? t('settings.esp32Flashen.waehle') : t('settings.esp32Flashen.firmware') }}</legend>
                    <label v-for="b in passende" :key="b.id" :class="['option', { fehlt: b.fehlt }]">
                        <input type="radio" name="esp32-firmware" :value="b.id" v-model="gewaehltId" :disabled="b.fehlt" />
                        <span>
                            <strong>{{ b.name }}</strong>
                            <span v-if="b.fehlt" class="leise"> · {{ t('settings.esp32Flashen.ohneFirmware') }}</span>
                            <span v-else class="leise"> v{{ b.version || '?' }} · <code>{{ b.ordner }}/</code></span>
                        </span>
                    </label>
                    <p v-if="passende.length > 1" class="leise">{{ t('settings.esp32Flashen.waehleHilfe') }}</p>
                </fieldset>

                <Hinweis v-if="nvsLage === 'gleich'" art="gut">{{ t('settings.esp32Flashen.nvsGleich') }}</Hinweis>
                <Hinweis v-else-if="nvsLage === 'leer'" art="info">{{ t('settings.esp32Flashen.nvsLeer') }}</Hinweis>
                <Hinweis v-else-if="nvsLage === 'anders'" art="warn">
                    {{ t('settings.esp32Flashen.nvsAnders') }}
                    <label class="bestaetigen"><input type="checkbox" v-model="nvsBestaetigt" /> {{ t('settings.esp32Flashen.nvsBestaetigen') }}</label>
                </Hinweis>

                <fieldset class="wahl verbindung">
                    <legend>
                        <label class="schalter-zeile"><input type="checkbox" v-model="mitgeben" /> {{ t('settings.esp32Flashen.einrichten.mitgeben') }}</label>
                    </legend>
                    <template v-if="mitgeben">
                        <p class="leise text">{{ t('settings.esp32Flashen.einrichten.text') }}</p>
                        <div class="felder">
                            <label class="feld">
                                <span>{{ t('settings.esp32Flashen.einrichten.host') }}</span>
                                <input class="eingabe mono" v-model.trim="verbindung.host" placeholder="192.168.178.100" autocomplete="off" spellcheck="false" :aria-invalid="feldFehler('host') && !!verbindung.host" />
                                <small :class="feldFehler('host') && verbindung.host ? 'falsch' : 'leise'">
                                    {{ cfgCodes.includes('hostLocal') ? t('settings.esp32Flashen.einrichten.hostLocal') : t('settings.esp32Flashen.einrichten.hostHilfe') }}
                                </small>
                            </label>
                            <label class="feld kurz">
                                <span>{{ t('settings.esp32Flashen.einrichten.port') }}</span>
                                <input class="eingabe mono" v-model.trim="verbindung.port" inputmode="numeric" :aria-invalid="feldFehler('port') && !!verbindung.port" />
                                <small :class="feldFehler('port') ? 'falsch' : 'leise'">{{ t('settings.esp32Flashen.einrichten.portHilfe') }}</small>
                            </label>
                            <label v-if="passwortAktiv" class="feld">
                                <span>{{ t('settings.esp32Flashen.einrichten.appPasswort') }}</span>
                                <input class="eingabe" type="password" v-model="appPasswort" autocomplete="current-password" />
                                <small class="leise">{{ t('settings.esp32Flashen.einrichten.appPasswortHilfe') }}</small>
                            </label>
                        </div>
                        <label v-if="gewaehlt?.id === 'cyd'" class="schalter-zeile invert">
                            <input type="checkbox" v-model="verbindung.invert" /> {{ t('settings.esp32Flashen.einrichten.invert') }}
                        </label>
                        <p v-if="gewaehlt?.id === 'cyd'" class="leise klein-text">{{ t('settings.esp32Flashen.einrichten.invertHilfe') }}</p>
                        <p class="leise">{{ t('settings.esp32Flashen.einrichten.schluessel') }}</p>
                    </template>
                    <p v-else class="leise text">{{ t('settings.esp32Flashen.einrichten.hotspot') }}</p>
                </fieldset>

                <Hinweis v-if="anzeigeKeyFehlt" art="warn">
                    {{ t('settings.esp32Flashen.einrichten.keinSchluessel') }}
                    <span class="block"><Knopf klein @click="flashe(true)">{{ t('settings.esp32Flashen.einrichten.erzeugenUndFlashen') }}</Knopf></span>
                </Hinweis>

                <div class="aktionen">
                    <Knopf art="haupt" :disabled="!kannFlashen" @click="flashe()">{{ t('settings.esp32Flashen.flashen') }}</Knopf>
                    <Knopf art="leise" @click="schliesse">{{ t('settings.esp32Flashen.trennen') }}</Knopf>
                </div>
            </div>

            <!-- Fortschritt -->
            <div v-if="schritt === 'flasht'" class="laeuft">
                <div class="balken" role="progressbar" :aria-valuenow="prozent" aria-valuemin="0" aria-valuemax="100" :aria-label="t('settings.esp32Flashen.fortschritt')">
                    <div class="fuellung" :style="{ width: prozent + '%' }"></div>
                </div>
                <p class="leise">{{ t('settings.esp32Flashen.schreibt', { prozent }) }}</p>
                <div class="aktionen">
                    <Knopf art="gefahr" @click="abbrechen">{{ t('settings.esp32Flashen.abbrechen') }}</Knopf>
                </div>
            </div>

            <div v-if="schritt === 'richtetEin'" class="laeuft">
                <template v-if="phase === 'wartet' || phase === 'sucht'">
                    <p class="leise">{{ phase === 'wartet' ? t('settings.esp32Flashen.einrichten.laeuft') : t('settings.esp32Flashen.einrichten.sucht') }}</p>
                    <div class="aktionen">
                        <Knopf art="leise" @click="abbrechen">{{ t('settings.esp32Flashen.abbrechen') }}</Knopf>
                    </div>
                </template>

                <!-- WLAN aus der Liste des Boards wählen -->
                <fieldset v-else class="wahl netze">
                    <legend>{{ t('settings.esp32Flashen.einrichten.netzWaehlen') }}</legend>
                    <p v-if="listeFehlt" class="leise text">{{ t('settings.esp32Flashen.einrichten.listeFehlt') }}</p>
                    <p v-else-if="!netze.length" class="leise text">{{ t('settings.esp32Flashen.einrichten.keineNetze') }}</p>
                    <div class="netzliste" role="radiogroup" :aria-label="t('settings.esp32Flashen.einrichten.netzWaehlen')">
                        <label v-for="n in netze" :key="n.ssid" :class="['netz', { aktiv: gewaehltesNetz === n.ssid }]">
                            <input type="radio" name="esp32-netz" :value="n.ssid" v-model="gewaehltesNetz" :disabled="phase === 'sendet'" />
                            <span class="netz-name">{{ n.ssid }}</span>
                            <span class="staerke" :title="`${n.rssi} dBm`" :aria-label="t('settings.esp32Flashen.einrichten.staerke', { n: signalBalken(n.rssi) })">
                                <i v-for="b in 4" :key="b" :class="{ an: b <= signalBalken(n.rssi) }" :style="{ height: (b * 3 + 2) + 'px' }"></i>
                            </span>
                            <Symbol v-if="n.enc === 1" name="schloss" :groesse="14" class="schloss" :title="t('settings.esp32Flashen.einrichten.mitPasswort')" />
                            <span v-else class="offen leise">{{ t('settings.esp32Flashen.einrichten.offen') }}</span>
                        </label>
                        <label :class="['netz', { aktiv: gewaehltesNetz === ANDERES }]">
                            <input type="radio" name="esp32-netz" :value="ANDERES" v-model="gewaehltesNetz" :disabled="phase === 'sendet'" />
                            <span class="netz-name">{{ t('settings.esp32Flashen.einrichten.anderes') }}</span>
                        </label>
                    </div>

                    <div class="felder">
                        <label v-if="gewaehltesNetz === ANDERES" class="feld">
                            <span>{{ t('settings.esp32Flashen.einrichten.ssid') }}</span>
                            <input class="eingabe" v-model="eigeneSsid" autocomplete="off" spellcheck="false" :aria-invalid="wahlFehler.includes('ssid') && !!eigeneSsid" />
                            <small v-if="wahlFehler.includes('ssid') && eigeneSsid" class="falsch">{{ t('settings.esp32Flashen.einrichten.ssidFalsch') }}</small>
                        </label>
                        <label v-if="brauchtPasswort" class="feld">
                            <span>{{ t('settings.esp32Flashen.einrichten.pass') }}</span>
                            <input class="eingabe" type="password" v-model="wlanPass" autocomplete="new-password" :aria-invalid="wahlFehler.includes('pass')" />
                            <small :class="wahlFehler.includes('pass') ? 'falsch' : 'leise'">
                                {{ gewaehltesNetz === ANDERES ? t('settings.esp32Flashen.einrichten.passHilfe') : t('settings.esp32Flashen.einrichten.passHilfeListe') }}
                            </small>
                        </label>
                    </div>

                    <Hinweis v-if="sendeFehler" art="fehler">{{ sendeFehlerText }}</Hinweis>

                    <div class="aktionen">
                        <Knopf art="haupt" :laedt="phase === 'sendet'" :disabled="!kannSenden" @click="sendeWahl">{{ t('settings.esp32Flashen.einrichten.senden') }}</Knopf>
                        <Knopf :disabled="phase === 'sendet'" @click="neuSuchen">{{ t('settings.esp32Flashen.einrichten.neuSuchen') }}</Knopf>
                        <Knopf art="leise" :disabled="phase === 'sendet'" @click="ueberspringen">{{ t('settings.esp32Flashen.einrichten.ueberspringen') }}</Knopf>
                    </div>
                </fieldset>
            </div>

            <template v-if="schritt === 'fertig'">
                <Hinweis v-if="einrichtung?.ok" art="gut" :titel="t('settings.esp32Flashen.fertigTitel')">
                    {{ t('settings.esp32Flashen.einrichten.ok') }}
                </Hinweis>
                <Hinweis v-else-if="einrichtung" art="warn" :titel="t('settings.esp32Flashen.einrichten.teilweiseTitel')">
                    {{ einrichtungText }}
                    <span class="block">{{ t('settings.esp32Flashen.einrichten.hotspot') }}</span>
                </Hinweis>
                <Hinweis v-else art="gut" :titel="t('settings.esp32Flashen.fertigTitel')">
                    {{ t('settings.esp32Flashen.fertig') }}
                    <span class="block">{{ t('settings.esp32Flashen.einrichten.hotspot') }}</span>
                </Hinweis>
            </template>

            <Hinweis v-if="fehler" art="fehler">
                {{ fehlerText }}
                <span v-if="fehlerNachFlash" class="block">{{ t('settings.esp32Flashen.halbGeschrieben') }}</span>
                <code v-if="fehler.text && !['falscherChip', 'keineFirmware'].includes(fehler.code)" class="block klein">{{ fehler.text }}</code>
            </Hinweis>

            <details v-if="protokoll.length" class="protokoll" :open="protokollOffen" @toggle="protokollOffen = $event.target.open">
                <summary>{{ t('settings.esp32Flashen.protokoll') }}</summary>
                <pre>{{ protokoll.join('\n') }}</pre>
            </details>
        </template>
    </div>
</template>

<style scoped>
.flashen {
    margin-top: var(--abstand-2);
    padding-top: var(--abstand-2);
    border-top: 1px solid var(--line);
}
.kasten-titel { margin: 0 0 var(--abstand-2); font-size: 0.9rem; font-weight: 600; color: var(--text); }
.leise { color: var(--muted); margin: var(--abstand-2) 0 0; overflow-wrap: anywhere; }
.text { margin: 0; }
.aktionen { display: flex; flex-wrap: wrap; gap: var(--abstand-2); margin-top: var(--abstand-3); }
.erkannt { margin-top: var(--abstand-3); display: grid; gap: var(--abstand-3); }
.werte { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem var(--abstand-3); margin: 0; }
.werte dt { color: var(--muted); }
.werte dd { margin: 0; overflow-wrap: anywhere; }
.wahl { border: 1px solid var(--line); border-radius: var(--radius-knopf); padding: var(--abstand-2) var(--abstand-3); margin: 0; }
.wahl legend { padding: 0 0.3rem; color: var(--text); font-weight: 600; }
.option { display: flex; gap: var(--abstand-2); align-items: baseline; padding: 0.3rem 0; cursor: pointer; }
.option.fehlt { cursor: default; opacity: 0.6; }
.verbindung legend { font-weight: 600; }
.invert { margin-top: var(--abstand-3); }
.klein-text { font-size: 0.78rem; margin-top: 0.2rem; }
.schalter-zeile { display: inline-flex; gap: 0.4rem; align-items: center; cursor: pointer; }
.felder { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--abstand-2) var(--abstand-3); margin-top: var(--abstand-2); }
.feld { display: grid; gap: 0.25rem; }
.feld > span { color: var(--text); font-size: 0.85rem; }
.feld small { font-size: 0.75rem; }
.falsch { color: var(--bad); }
.eingabe {
    min-width: 0;
    padding: 0.5rem 0.7rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.9rem;
}
.eingabe:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-flaeche); }
.eingabe[aria-invalid="true"] { border-color: var(--bad); }
.mono { font-family: var(--schrift-mono); }
.netzliste { display: grid; gap: 2px; margin-top: var(--abstand-2); max-height: 18rem; overflow: auto; }
.netz {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: var(--abstand-2);
    align-items: center;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius-knopf);
    cursor: pointer;
}
.netz:hover { background: var(--panel-soft); }
.netz.aktiv { background: var(--accent-flaeche); }
.netz-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.staerke { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.staerke i { width: 3px; border-radius: 1px; background: var(--line-stark); }
.staerke i.an { background: var(--accent); }
.schloss { color: var(--muted); }
.offen { font-size: 0.75rem; margin: 0; }
.bestaetigen { display: flex; gap: 0.4rem; align-items: center; margin-top: var(--abstand-2); cursor: pointer; }
.laeuft { margin-top: var(--abstand-3); }
.balken { height: 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.fuellung { height: 100%; background: var(--accent); transition: width 0.2s linear; }
.block { display: block; margin-top: 0.3rem; }
.klein { font-size: 0.78rem; overflow-wrap: anywhere; }
.protokoll { margin-top: var(--abstand-3); }
.protokoll summary { cursor: pointer; color: var(--muted); }
.protokoll pre {
    max-height: 14rem;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-2);
    font-size: 0.75rem;
    white-space: pre-wrap;
}
</style>
