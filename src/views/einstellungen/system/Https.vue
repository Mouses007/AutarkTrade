<script setup>
/**
 * System → HTTPS: die eigene Stamm-CA der App (`server/tls/dienst.js`).
 *
 * Fingerabdruck zum Vergleichen beim Installieren, Download der CA, Namen und
 * IPs im Server-Zertifikat (mit Vorschlägen aus den Adressen, unter denen die
 * App aufgerufen wurde), Erneuern, neue CA. Dazu kurze Anleitungen je
 * Plattform — eine eigene Hilfeseite gibt es bewusst nicht.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Knopf, Pille, Hinweis, Symbol } from '@/components/basis/index.js'
import Abschnitt from '../gemeinsam/Abschnitt.vue'
import Feld from '../gemeinsam/Feld.vue'
import dayjs from 'dayjs'

const { t } = useI18n()

const offen = ref(false)
const status = ref(null)
const laedt = ref(false)
const meldung = ref(null)
const neuerName = ref('')

const datum = (ms) => (ms ? dayjs(ms).format('DD.MM.YYYY') : '—')
const restTage = computed(() => {
    const ende = status.value?.server?.nichtNach
    return ende ? Math.max(0, Math.floor((ende - Date.now()) / 86400000)) : null
})

/* Seite über HTTP geöffnet, HTTPS läuft aber: Wechsel anbieten. */
const httpsAdresse = computed(() => {
    const port = status.value?.aktiv ? status.value.port : null
    if (!port || typeof window === 'undefined') return ''
    return `https://${window.location.hostname.includes(':') ? `[${window.location.hostname}]` : window.location.hostname}:${port}${window.location.pathname}`
})
const ueberHttp = computed(() => typeof window !== 'undefined' && window.location.protocol === 'http:')

function zeige(ok, text, ms = 5000) {
    meldung.value = { ok, text }
    if (ms) setTimeout(() => { if (meldung.value?.text === text) meldung.value = null }, ms)
}

async function lade() {
    try {
        const { data } = await axios.get('/api/tls/status')
        status.value = data
    } catch (e) {
        zeige(false, e.response?.data?.error || e.message, 0)
    }
}

async function aufruf(methode, pfad, body, erfolg) {
    laedt.value = true
    meldung.value = null
    try {
        const { data } = await axios({ method: methode, url: pfad, data: body })
        status.value = data
        if (erfolg) zeige(true, erfolg)
    } catch (e) {
        if (e.response?.data?.status) status.value = e.response.data.status
        zeige(false, e.response?.data?.error || e.message, 0)
    }
    laedt.value = false
}

function speichereNamen(liste) {
    return aufruf('put', '/api/tls/namen', { namen: liste }, t('settings.tls.namenGespeichert'))
}
function fuegeHinzu() {
    const n = neuerName.value.trim()
    if (!n) return
    neuerName.value = ''
    speichereNamen([...(status.value?.namen?.eigene || []), n])
}
function entferne(name) {
    speichereNamen((status.value?.namen?.eigene || []).filter((x) => x !== name))
}
function vorschlag(name, aufnehmen) {
    aufruf('post', '/api/tls/vorschlag', { name, aufnehmen }, aufnehmen ? t('settings.tls.namenGespeichert') : '')
}
function erneuern() {
    aufruf('post', '/api/tls/erneuern', {}, t('settings.tls.erneuert'))
}
function neueCa() {
    if (!confirm(t('settings.tls.caNeuFrage'))) return
    aufruf('post', '/api/tls/ca-neu', { bestaetigt: true }, t('settings.tls.caNeuFertig'))
}

/* Im Template ist `navigator` kein erlaubtes Global — deshalb hier. */
async function kopiere() {
    try {
        await navigator.clipboard.writeText(status.value?.ca?.sha256 || '')
        zeige(true, t('settings.tls.kopiert'), 3000)
    } catch (e) {
        zeige(false, e.message)
    }
}

const ANLEITUNGEN = ['android', 'windows', 'linux', 'apple']

onMounted(lade)
</script>

<template>
    <Abschnitt v-model:offen="offen" :titel="t('settings.tls.titel')" symbol="schildHaken">
        <template #kopf>
            <Pille v-if="status" :ton="status.aktiv ? 'gut' : 'neutral'">
                {{ status.aktiv ? t('settings.tls.aktivPort', { port: status.lauschPort || status.port }) : t('settings.tls.aus') }}
            </Pille>
        </template>

        <p class="hinweis">{{ t('settings.tls.einleitung') }}</p>

        <Hinweis v-if="ueberHttp && httpsAdresse" art="warn" :titel="t('settings.tls.httpTitel')">
            {{ t('settings.tls.httpText') }}
            <a :href="httpsAdresse" class="link">{{ httpsAdresse }}</a>
        </Hinweis>
        <Hinweis v-if="status?.fehler" art="fehler" :titel="t('settings.tls.fehlerTitel')">{{ status.fehler }}</Hinweis>
        <Hinweis v-if="status && status.port === null" art="info">{{ t('settings.tls.abgeschaltet') }}</Hinweis>

        <template v-if="status?.ca">
            <!-- Fingerabdruck: beim Installieren mit dem Gerät vergleichen -->
            <div class="kasten">
                <h4 class="kasten-titel">{{ t('settings.tls.fingerabdruck') }}</h4>
                <p class="leise">{{ t('settings.tls.fingerabdruckHilfe') }}</p>
                <div class="abdruck-reihe">
                    <code class="abdruck" :aria-label="t('settings.tls.fingerabdruck')">{{ status.ca.sha256 }}</code>
                    <Knopf symbol="kopieren" @click="kopiere">{{ t('settings.tls.kopieren') }}</Knopf>
                </div>
                <dl class="daten">
                    <dt>{{ t('settings.tls.caName') }}</dt><dd>AutarkTrade Lokale CA ({{ status.ca.id }})</dd>
                    <dt>{{ t('settings.tls.caGueltig') }}</dt><dd>{{ datum(status.ca.nichtNach) }}</dd>
                    <template v-if="status.server">
                        <dt>{{ t('settings.tls.serverGueltig') }}</dt>
                        <dd>{{ datum(status.server.nichtNach) }} · {{ t('settings.tls.restTage', { tage: restTage }) }}</dd>
                        <dt>{{ t('settings.tls.erneuertAm') }}</dt><dd>{{ datum(status.server.erstellt) }}</dd>
                    </template>
                </dl>
                <p class="leise">{{ t('settings.tls.automatisch', { tage: status.erneuernTage }) }}</p>
                <div class="knoepfe">
                    <Knopf art="haupt" symbol="herunterladen" href="/api/tls/ca.crt" download>{{ t('settings.tls.herunterladen') }}</Knopf>
                    <Knopf symbol="aktualisieren" :laedt="laedt" @click="erneuern">{{ t('settings.tls.erneuern') }}</Knopf>
                </div>
            </div>

            <!-- Namen und IPs im Server-Zertifikat -->
            <div class="kasten">
                <h4 class="kasten-titel">{{ t('settings.tls.namenTitel') }}</h4>
                <p class="leise">{{ t('settings.tls.namenHilfe') }}</p>
                <ul class="namen">
                    <li v-for="n in status.namen.basis" :key="'b' + n"><code>{{ n }}</code> <span class="herkunft">{{ t('settings.tls.herkunftBasis') }}</span></li>
                    <li v-for="n in status.namen.umgebung" :key="'u' + n"><code>{{ n }}</code> <span class="herkunft">AT_TLS_NAMEN</span></li>
                    <li v-for="n in status.namen.eigene" :key="'e' + n">
                        <code>{{ n }}</code> <span class="herkunft">{{ t('settings.tls.herkunftEigen') }}</span>
                        <Knopf art="leise" klein symbol="schliessen" nur-symbol :titel="t('settings.tls.entfernen', { name: n })" :disabled="laedt" @click="entferne(n)" />
                    </li>
                </ul>
                <Feld :label="t('settings.tls.hinzufuegen')" fuer="tls-neuer-name">
                    <div class="reihe">
                        <input id="tls-neuer-name" v-model="neuerName" type="text" class="eingabe mono"
                            :placeholder="t('settings.tls.hinzufuegenPlatzhalter')" @keyup.enter="fuegeHinzu" />
                        <Knopf :disabled="laedt || !neuerName.trim()" @click="fuegeHinzu">{{ t('settings.tls.aufnehmen') }}</Knopf>
                    </div>
                </Feld>

                <template v-if="status.vorschlaege.length">
                    <h4 class="kasten-titel vorschlaege">{{ t('settings.tls.vorschlaegeTitel') }}</h4>
                    <p class="leise">{{ t('settings.tls.vorschlaegeHilfe') }}</p>
                    <ul class="namen">
                        <li v-for="v in status.vorschlaege" :key="'v' + v.name">
                            <code>{{ v.name }}</code> <span class="herkunft">{{ t('settings.tls.gesehen', { datum: datum(v.zuletzt) }) }}</span>
                            <Knopf klein :disabled="laedt" @click="vorschlag(v.name, true)">{{ t('settings.tls.aufnehmen') }}</Knopf>
                            <Knopf art="leise" klein :disabled="laedt" @click="vorschlag(v.name, false)">{{ t('settings.tls.verwerfen') }}</Knopf>
                        </li>
                    </ul>
                </template>
            </div>

            <!-- Anleitungen je Plattform -->
            <div class="kasten">
                <h4 class="kasten-titel">{{ t('settings.tls.anleitungTitel') }}</h4>
                <p class="leise">{{ t('settings.tls.anleitungEinleitung') }}</p>
                <details v-for="p in ANLEITUNGEN" :key="p" class="anleitung">
                    <summary>{{ t('settings.tls.anleitung.' + p + '.titel') }}</summary>
                    <p>{{ t('settings.tls.anleitung.' + p + '.text') }}</p>
                </details>
            </div>

            <!-- Neue CA: trennt jedes Gerät -->
            <div class="kasten gefahr">
                <h4 class="kasten-titel"><Symbol name="warnung" /> {{ t('settings.tls.caNeuTitel') }}</h4>
                <p class="leise">{{ t('settings.tls.caNeuText') }}</p>
                <Knopf art="gefahr" :disabled="laedt" @click="neueCa">{{ t('settings.tls.caNeu') }}</Knopf>
            </div>
        </template>

        <p v-if="meldung" :class="['meldung', meldung.ok ? 'gut' : 'schlecht']" role="status">{{ meldung.text }}</p>
    </Abschnitt>
</template>

<style scoped>
.hinweis { margin: 0 0 var(--abstand-3); color: var(--muted); font-size: 0.88rem; }
.kasten {
    background: var(--panel-soft);
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    padding: var(--abstand-3);
    margin: var(--abstand-3) 0;
    font-size: 0.88rem;
}
.kasten.gefahr { border-color: var(--bad); }
.kasten-titel {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0 0 var(--abstand-2);
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
}
.kasten-titel.vorschlaege { margin-top: var(--abstand-4); }
.leise { color: var(--muted); margin: 0 0 var(--abstand-2); }
.abdruck-reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    align-items: center;
    margin: var(--abstand-2) 0 var(--abstand-3);
}
.abdruck {
    flex: 1 1 18rem;
    min-width: 0;
    font-family: var(--schrift-mono);
    font-size: 1.05rem;
    line-height: 1.5;
    letter-spacing: 0.02em;
    color: var(--accent);
    overflow-wrap: anywhere;
    user-select: all;
}
.daten {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.25rem var(--abstand-3);
    margin: 0 0 var(--abstand-2);
}
.daten dt { color: var(--muted); }
.daten dd { margin: 0; }
.namen { list-style: none; margin: 0 0 var(--abstand-3); padding: 0; }
.namen li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0.2rem 0;
}
.namen code { font-family: var(--schrift-mono); }
.herkunft { color: var(--muted); font-size: 0.8rem; }
.reihe { display: flex; gap: var(--abstand-2); align-items: center; }
.eingabe {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    font: inherit;
    font-size: 0.92rem;
}
.eingabe:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-flaeche); }
.mono { font-family: var(--schrift-mono); }
.knoepfe { display: flex; flex-wrap: wrap; gap: var(--abstand-2); margin-top: var(--abstand-3); }
.anleitung { border-top: 1px solid var(--line); padding: var(--abstand-2) 0; }
.anleitung summary { cursor: pointer; color: var(--text); }
.anleitung p { margin: var(--abstand-2) 0 0; color: var(--muted); white-space: pre-line; }
.link { color: var(--accent); overflow-wrap: anywhere; }
.meldung { margin: var(--abstand-2) 0 0; font-size: 0.85rem; }
.meldung.gut { color: var(--good); }
.meldung.schlecht { color: var(--bad); }
</style>
