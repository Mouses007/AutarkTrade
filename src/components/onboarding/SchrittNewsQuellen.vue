<script setup>
/**
 * Nachrichtenquellen-Verwaltung — extrahiert aus Settings.vue (Bereich KI →
 * Nachrichten), dort war die Logik bereits vollständig self-contained
 * (eigene Refs, eigene Endpunkte). Eine Komponente statt zweier Kopien:
 * genutzt sowohl hier im Onboarding-Assistenten als auch weiterhin in
 * Settings.vue, damit künftige Änderungen nicht auseinanderlaufen.
 *
 * Bestehende Quellen werden nie angetastet — dieser Schritt bietet nur das
 * Hinzufügen neuer.
 *
 * Seit S12 (Verkaufs-Prüfung Massnahme 10, Z. 46/52/53):
 *   - nichts vorbelegt: die Vorschlagsliste ist leer, der Nutzer trägt
 *     seine Quellen selbst ein (Verlags-Feeds, Kanäle, Spiegel);
 *   - Telegram ist keine wählbare Art mehr. Bereits eingetragene
 *     Telegram-Quellen stehen abgeschaltet in der Liste, lassen sich löschen,
 *     aber nicht wieder einschalten.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'

const { t } = useI18n()

const newsQuellen = ref([])
/** Arten, die nur noch als Altbestand vorkommen (wie `ARTEN_ENTFERNT` im Server). */
const ENTFERNT = ['telegram']
const neueQuelle = ref({ art: 'youtube', name: '', url: '' })
const newsMeldung = ref('')
const newsFehler = ref(false)
const newsTestet = ref(false)

async function ladeNewsQuellen() {
    try {
        const { data } = await axios.get('/api/marktradar/news/sources')
        newsQuellen.value = data.quellen || []
    } catch (e) {
        newsQuellen.value = []
    }
}

function meldung(text, fehler = false) {
    newsMeldung.value = text
    newsFehler.value = fehler
    setTimeout(() => { newsMeldung.value = '' }, 6000)
}

async function quelleTesten() {
    newsTestet.value = true
    try {
        const { data } = await axios.post('/api/marktradar/news/test', {
            url: neueQuelle.value.url, art: neueQuelle.value.art,
        })
        meldung(data.hinweis || `${data.anzahl} Einträge gefunden — z.B. „${(data.beispiel[0] || '').slice(0, 60)}"`)
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    } finally {
        newsTestet.value = false
    }
}

async function quelleAnlegen() {
    try {
        await axios.post('/api/marktradar/news/sources', neueQuelle.value)
        neueQuelle.value = { art: 'youtube', name: '', url: '' }
        await ladeNewsQuellen()
        meldung('Quelle hinzugefügt.')
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

async function quelleAendern(q, felder) {
    try {
        await axios.put(`/api/marktradar/news/sources/${q.id}`, felder)
        await ladeNewsQuellen()
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

async function quelleLoeschen(q) {
    if (!confirm(`Quelle „${q.name || q.url}" mitsamt ihren Beiträgen löschen?`)) return
    try {
        await axios.delete(`/api/marktradar/news/sources/${q.id}`)
        await ladeNewsQuellen()
    } catch (e) {
        meldung(e.response?.data?.error || e.message, true)
    }
}

onMounted(ladeNewsQuellen)
</script>

<template>
    <div>
        <table class="table table-sm align-middle" v-if="newsQuellen.length">
            <thead>
                <tr>
                    <th style="width:6rem;">{{ t('settings.ki.news.colType') }}</th>
                    <th>{{ t('settings.ki.news.colName') }}</th>
                    <th>{{ t('settings.ki.news.colAddress') }}</th>
                    <th style="width:5rem;" class="text-center">{{ t('settings.ki.news.colActive') }}</th>
                    <th style="width:6rem;" class="text-center" :title="t('settings.ki.news.colExcludeTitle')">
                        {{ t('settings.ki.news.colExclude') }}</th>
                    <th style="width:5rem;" class="text-center" :title="t('settings.ki.news.colVideosTitle')">{{ t('settings.ki.news.colVideos') }}</th>
                    <th style="width:7rem;"></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="q in newsQuellen" :key="q.id">
                    <td class="text-muted">{{ q.art }}</td>
                    <td>{{ q.name || '—' }}</td>
                    <td class="text-truncate" style="max-width:22rem;">
                        <span :title="q.url">{{ q.url }}</span>
                        <div v-if="q.letzterFehler" class="small" style="color:rgb(250,190,60);">
                            {{ q.letzterFehler }}
                        </div>
                    </td>
                    <td class="text-center">
                        <input type="checkbox" :checked="!!q.enabled" :disabled="ENTFERNT.includes(q.art)"
                            :title="ENTFERNT.includes(q.art) ? t('onboarding.news.telegramEntfernt') : ''"
                            @change="quelleAendern(q, { enabled: $event.target.checked ? 1 : 0 })">
                    </td>
                    <td class="text-center">
                        <input type="checkbox" :checked="!!q.laerm"
                            @change="quelleAendern(q, { laerm: $event.target.checked ? 1 : 0 })">
                    </td>
                    <td class="text-center">
                        <input v-if="q.art === 'youtube'" type="checkbox"
                            :checked="Number(q.videoAnalyse ?? 1) === 1"
                            @change="quelleAendern(q, { videoAnalyse: $event.target.checked ? 1 : 0 })">
                        <span v-else class="text-muted">—</span>
                    </td>
                    <td class="text-end">
                        <button class="btn btn-outline-danger btn-sm" @click="quelleLoeschen(q)">
                            <i class="uil uil-trash"></i>
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div class="row g-2 align-items-center">
            <div class="col-6 col-md-2">
                <select class="form-select form-select-sm" v-model="neueQuelle.art">
                    <option value="youtube">YouTube</option>
                    <option value="rss">RSS</option>
                    <option value="truth">Truth Social</option>
                    <option value="x">X (via Grok)</option>
                </select>
            </div>
            <div class="col-6 col-md-3">
                <input class="form-control form-control-sm" v-model="neueQuelle.name" :placeholder="t('settings.ki.news.sourceNamePlaceholder')">
            </div>
            <div class="col-12 col-md-5">
                <input class="form-control form-control-sm" v-model="neueQuelle.url"
                    :placeholder="neueQuelle.art === 'x' ? '@handle'
                        : neueQuelle.art === 'youtube' ? 'https://www.youtube.com/feeds/videos.xml?channel_id=…'
                            : 'https://…'">
            </div>
            <div class="col-12 col-md-2 d-flex gap-1">
                <button class="btn btn-outline-secondary btn-sm" :disabled="newsTestet"
                    @click="quelleTesten">{{ t('settings.ki.news.testSourceBtn') }}</button>
                <button class="btn btn-outline-primary btn-sm" @click="quelleAnlegen">{{ t('settings.ki.news.addSourceBtn') }}</button>
            </div>
        </div>
        <div v-if="newsMeldung" class="small mt-2" :class="newsFehler ? 'text-danger' : 'text-muted'">
            {{ newsMeldung }}
        </div>

        <!-- Bewusst ohne Vorschläge: welche Verlage und Kanäle gelesen und von
             der KI zusammengefasst werden, entscheidet der Nutzer (S12). -->
        <p class="small text-muted mt-2 mb-0">{{ t('onboarding.news.eigeneQuellen') }}</p>
    </div>
</template>
