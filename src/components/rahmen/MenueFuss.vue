<script setup>
/**
 * Fuss des Seitenmenüs: Versionsstand, Update und Rollback.
 *
 * Zwei Wege zum Update:
 *   - Docker: Watchtower spielt neue Abbilder selbst ein. Hier steht nur ein
 *     Verweis auf die Release-Seite, ein Knopf hätte nichts zu tun.
 *   - Direkt installiert: ein Knopf, der nach Rückfrage `git fetch/reset` und
 *     `npm install` auf dem Server anstösst und danach wartet, bis der Server
 *     wieder antwortet.
 *
 * Destruktive Aufrufe (Installieren, Zurückrollen) verlangen ein frisches
 * Einmal-Token aus `GET /api/update/check?force=1` — der Server nimmt sie nur
 * mit Token und nur von localhost an.
 *
 * Seit 22.10.2026 (AGPL-3.0) ohne Lizenzschlüssel: jedes neuere Release ist installierbar.
 * Darunter der Einstieg in den Dialog „Rechtliches" (`stores/rechtliches.js`).
 */
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import { oeffneRechtliches } from '../../stores/rechtliches.js'
import { oeffneSpenden } from '../../stores/spenden.js'
import { appEinstellungen } from '../../stores/settings.js'
import { computed } from 'vue'

const { t } = useI18n()

const version = __APP_VERSION__
const spendenAn = computed(() => Number(appEinstellungen.value?.spendenAn ?? 1) === 1)
const RELEASES_URL = 'https://github.com/Mouses007/AutarkTrade/releases'

const stand = ref(null)            // Antwort von /api/update/check
const rollbackMoeglich = ref(false)
const installiert = ref(false)
const rollt = ref(false)
const fehler = ref('')

async function ladeStand() {
    try {
        const { data } = await axios.get('/api/update/check')
        stand.value = data
    } catch { /* ohne Update-Endpunkt: nichts anzeigen */ }
    try {
        const { data } = await axios.get('/api/update/rollback-status')
        rollbackMoeglich.value = !!data?.available
    } catch { /* still */ }
}

async function holeToken() {
    const { data } = await axios.get('/api/update/check', { params: { force: 1 } })
    if (!data?.confirmToken) throw new Error(data?.error || 'confirmToken fehlt')
    return data.confirmToken
}

/** Wartet, bis der Server nach dem Neustart wieder antwortet, und lädt dann neu (spätestens nach 90 s). */
function warteAufServer() {
    const beginn = Date.now()
    const versuch = async () => {
        if (Date.now() - beginn > 90000) { window.location.reload(); return }
        try {
            await axios.get('/api/update/check', { params: { _: Date.now() }, headers: { 'Cache-Control': 'no-cache' } })
            window.location.reload()
        } catch {
            setTimeout(versuch, 1500)
        }
    }
    versuch()
}

async function installiere() {
    const s = stand.value
    if (!s) return
    let frage = `Update v${s.localVersion} → v${s.remoteVersion}\n\n`
    if (s.releaseNotes) frage += `${t('nav.changes')}\n${s.releaseNotes}\n\n`
    frage += `${t('nav.updateBackupWarning')}\n${t('nav.updateBackupPath')}\n\n${t('nav.updateConfirm')}`
    if (!window.confirm(frage)) return

    fehler.value = ''
    installiert.value = true
    try {
        const token = await holeToken()
        const { data } = await axios.post('/api/update/install', { confirmToken: token })
        if (!data?.ok) throw new Error(data?.error || t('nav.updateFehlgeschlagen'))
        setTimeout(warteAufServer, data.isDocker || s.isDocker ? 8000 : 4000)
    } catch (e) {
        fehler.value = e?.response?.data?.error || e?.message || String(e)
        installiert.value = false
    }
}

async function rolleZurueck() {
    if (!window.confirm(t('nav.rollbackConfirm'))) return
    fehler.value = ''
    rollt.value = true
    try {
        const token = await holeToken()
        const { data } = await axios.post('/api/update/rollback', { confirmToken: token })
        if (!data?.ok) throw new Error(data?.error || t('nav.rollbackFehlgeschlagen'))
        setTimeout(() => window.location.reload(), 5000)
    } catch (e) {
        fehler.value = e?.response?.data?.error || e?.message || String(e)
        rollt.value = false
    }
}

onMounted(ladeStand)
</script>

<template>
    <footer class="at-menue-fuss">
        <button v-if="spendenAn" type="button" class="fuss-eintrag" @click="oeffneSpenden()">
            <Symbol name="herz" />{{ t('spenden.menue') }}
        </button>
        <button type="button" class="fuss-eintrag" @click="oeffneRechtliches()">
            <Symbol name="waage" />{{ t('rechtliches.titel') }}
        </button>

        <div class="version">{{ t('nav.versionText', { version }) }}</div>

        <template v-if="stand?.updateAvailable">
            <a v-if="stand.isDocker" class="fuss-eintrag hervor" :href="stand.releaseUrl || RELEASES_URL" target="_blank"
                rel="noopener" :title="t('nav.updateDockerHinweis')">
                <Symbol name="extern" />{{ t('nav.updateAuf', { version: stand.remoteVersion }) }}
            </a>
            <span v-else-if="installiert" class="fuss-eintrag">
                <span class="kreisel" aria-hidden="true"></span>{{ t('nav.installing') }}
            </span>
            <button v-else type="button" class="fuss-eintrag hervor pulsiert" @click="installiere">
                <Symbol name="download" />{{ t('nav.updateAuf', { version: stand.remoteVersion }) }}
            </button>
        </template>

        <template v-if="rollbackMoeglich">
            <span v-if="rollt" class="fuss-eintrag">
                <span class="kreisel" aria-hidden="true"></span>{{ t('nav.rollback') }}
            </span>
            <button v-else type="button" class="fuss-eintrag" @click="rolleZurueck">
                <Symbol name="zurueckdrehen" />{{ t('nav.rollbackKnopf') }}
            </button>
        </template>

        <div v-if="fehler" class="fehler" role="alert">{{ fehler }}</div>
    </footer>
</template>

<style scoped>
.at-menue-fuss {
    margin-top: auto;
    padding: var(--abstand-3) var(--abstand-2) var(--abstand-2);
    display: flex;
    flex-direction: column;
    gap: var(--abstand-1);
    font-size: 0.78rem;
}

.version {
    color: var(--leise);
    padding: 0 var(--abstand-2);
}

.fuss-eintrag {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem var(--abstand-2);
    border: 0;
    border-radius: var(--radius-klein);
    background: transparent;
    color: var(--muted);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
}

.fuss-eintrag:hover {
    color: var(--text);
    background: var(--panel-soft);
}

.fuss-eintrag.hervor {
    color: var(--accent);
}

.pulsiert {
    animation: at-puls 2s ease-in-out infinite;
}

@keyframes at-puls {
    0%, 100% { background: transparent; }
    50% { background: var(--accent-flaeche); }
}

.kreisel {
    width: 0.85em;
    height: 0.85em;
    border: 2px solid var(--line-stark);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: at-dreh 0.8s linear infinite;
}

@keyframes at-dreh {
    to { transform: rotate(360deg); }
}

.fehler {
    color: var(--bad);
    padding: 0 var(--abstand-2);
    word-break: break-word;
}

@media (prefers-reduced-motion: reduce) {
    .pulsiert, .kreisel { animation: none; }
}
</style>
