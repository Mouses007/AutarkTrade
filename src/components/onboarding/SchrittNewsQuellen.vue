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
 * Vorschläge und Telegram haben keine Verkaufsfreigabe (Verkaufs-Prüfung
 * Massnahme 10, Z. 46/52/53). Seit S15 hängen sie am Schalter „Quellen ohne
 * Verkaufsfreigabe" (`src/utils/quellenFreigabe.js`):
 *   - an: wie vor S12 — Vorschläge (YouTube, Verlags-RSS, Telegram-Kanäle,
 *     Truth-Social-Spiegel) zum Übernehmen, Telegram wählbar;
 *   - aus: wie nach S12 — nichts vorbelegt (der Server liefert keine
 *     Vorschläge), Telegram keine wählbare Art; eingetragene Telegram-Quellen
 *     stehen abgeschaltet in der Liste, lassen sich löschen, aber nicht
 *     wieder einschalten.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../basis/Knopf.vue'
import { ladeFreigabe, freigabeAn } from '../../utils/quellenFreigabe.js'

const { t } = useI18n()

const newsQuellen = ref([])
const newsVorschlaege = ref([])
/** Arten, die gerade nicht laufen dürfen (wie `artenEntfernt()` im Server). */
const ENTFERNT = computed(() => (freigabeAn() ? [] : ['telegram']))
const neueQuelle = ref({ art: 'youtube', name: '', url: '' })
const newsMeldung = ref('')
const newsFehler = ref(false)
const newsTestet = ref(false)

async function ladeNewsQuellen() {
    try {
        const { data } = await axios.get('/api/marktradar/news/sources')
        newsQuellen.value = data.quellen || []
        // Mit Schalter aus liefert der Server keine (S12)
        const vorhanden = new Set(newsQuellen.value.map(q => q.url))
        newsVorschlaege.value = (data.vorschlaege || []).filter(v => !vorhanden.has(v.url))
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

async function vorschlagUebernehmen(v) {
    neueQuelle.value = { art: v.art, name: v.name, url: v.url, laerm: v.laerm }
    await quelleAnlegen()
}

onMounted(() => { ladeFreigabe(); ladeNewsQuellen() })
</script>

<template>
    <div>
        <div v-if="newsQuellen.length" class="at-tabelle-huelle at-mu-3">
            <table class="at-tabelle dicht">
                <thead>
                    <tr>
                        <th class="sp-art">{{ t('settings.ki.news.colType') }}</th>
                        <th>{{ t('settings.ki.news.colName') }}</th>
                        <th>{{ t('settings.ki.news.colAddress') }}</th>
                        <th class="sp-schmal at-mittig">{{ t('settings.ki.news.colActive') }}</th>
                        <th class="sp-art at-mittig" :title="t('settings.ki.news.colExcludeTitle')">
                            {{ t('settings.ki.news.colExclude') }}</th>
                        <th class="sp-schmal at-mittig" :title="t('settings.ki.news.colVideosTitle')">{{ t('settings.ki.news.colVideos') }}</th>
                        <th class="sp-aktion"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="q in newsQuellen" :key="q.id">
                        <td class="at-gedaempft">{{ q.art }}</td>
                        <td>{{ q.name || '—' }}</td>
                        <td class="at-kuerzen sp-adresse">
                            <span :title="q.url">{{ q.url }}</span>
                            <div v-if="q.letzterFehler" class="at-klein at-warn">
                                {{ q.letzterFehler }}
                            </div>
                        </td>
                        <td class="at-mittig">
                            <input type="checkbox" :checked="!!q.enabled" :disabled="ENTFERNT.includes(q.art)"
                                :title="ENTFERNT.includes(q.art) ? t('onboarding.news.telegramEntfernt') : ''"
                                @change="quelleAendern(q, { enabled: $event.target.checked ? 1 : 0 })">
                        </td>
                        <td class="at-mittig">
                            <input type="checkbox" :checked="!!q.laerm"
                                @change="quelleAendern(q, { laerm: $event.target.checked ? 1 : 0 })">
                        </td>
                        <td class="at-mittig">
                            <input v-if="q.art === 'youtube'" type="checkbox"
                                :checked="Number(q.videoAnalyse ?? 1) === 1"
                                @change="quelleAendern(q, { videoAnalyse: $event.target.checked ? 1 : 0 })">
                            <span v-else class="at-gedaempft">—</span>
                        </td>
                        <td class="at-rechtsbuendig">
                            <Knopf art="gefahr" klein nur-symbol symbol="muell" titel="Löschen" @click="quelleLoeschen(q)" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="at-formzeile eng">
            <div class="neu-art">
                <select class="at-feld klein" v-model="neueQuelle.art">
                    <option value="youtube">YouTube</option>
                    <option value="rss">RSS</option>
                    <option v-if="freigabeAn()" value="telegram">Telegram</option>
                    <option value="truth">Truth Social</option>
                    <option value="x">X (via Grok)</option>
                </select>
            </div>
            <div class="neu-name">
                <input class="at-feld klein" v-model="neueQuelle.name" :placeholder="t('settings.ki.news.sourceNamePlaceholder')">
            </div>
            <div class="neu-url">
                <input class="at-feld klein" v-model="neueQuelle.url"
                    :placeholder="neueQuelle.art === 'x' ? '@handle'
                        : neueQuelle.art === 'telegram' ? 'https://t.me/s/kanalname'
                            : neueQuelle.art === 'youtube' ? 'https://www.youtube.com/feeds/videos.xml?channel_id=…'
                                : 'https://…'">
            </div>
            <div class="at-flex at-luecke-1">
                <Knopf klein :disabled="newsTestet" @click="quelleTesten">{{ t('settings.ki.news.testSourceBtn') }}</Knopf>
                <Knopf klein @click="quelleAnlegen">{{ t('settings.ki.news.addSourceBtn') }}</Knopf>
            </div>
        </div>
        <div v-if="newsMeldung" class="at-klein at-mo-2" :class="newsFehler ? 'at-schlecht' : 'at-gedaempft'">
            {{ newsMeldung }}
        </div>

        <!-- Vorschläge nur mit Schalter (S15); ohne ihn entscheidet der Nutzer
             allein, welche Verlage und Kanäle die KI zusammenfasst (S12). -->
        <div v-if="newsVorschlaege.length" class="at-klein at-mo-2 vorschlaege">
            <span class="at-gedaempft">{{ t('settings.ki.news.suggestionsLabel') }}</span>
            <Knopf v-for="v in newsVorschlaege" :key="v.url" klein @click="vorschlagUebernehmen(v)">
                {{ v.name }}<span v-if="v.laerm" class="at-gedaempft">&nbsp;{{ t('settings.ki.news.noiseSuffix') }}</span>
            </Knopf>
        </div>
        <p v-else class="at-klein at-gedaempft at-mo-2 at-mu-0">{{ t('onboarding.news.eigeneQuellen') }}</p>
    </div>
</template>

<style scoped>
.sp-art { width: 6rem; }
.sp-schmal { width: 5rem; }
.sp-aktion { width: 4rem; }
.sp-adresse { max-width: 22rem; }

.vorschlaege {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
}

td input[type='checkbox'] {
    accent-color: var(--accent);
    cursor: pointer;
}

/* Neue Quelle: Art + Name nebeneinander, die Adresse darf wachsen; am
   Telefon bricht alles einspaltig um. */
.neu-art { flex: 1 1 7rem; max-width: 10rem; }
.neu-name { flex: 1 1 9rem; }
.neu-url { flex: 3 1 14rem; }

@media (max-width: 575px) {
    .neu-art,
    .neu-name,
    .neu-url { flex-basis: 100%; max-width: none; }
}
</style>
