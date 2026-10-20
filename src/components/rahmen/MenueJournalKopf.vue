<script setup>
/**
 * Oberer Teil des Journal-Menüs: Börse, Kategorie und das Filterpanel.
 *
 * Börse und Kategorie gelten für das ganze Journal und werden im localStorage
 * gemerkt; ein Wechsel lädt die Seite neu, weil die Journal-Daten beim Laden
 * des Layouts für genau diese Auswahl geholt werden.
 *
 * Konfiguriert ist eine Börse, wenn ihr Konfigurations-Endpunkt einen Schlüssel
 * meldet. Ist es keine (frische Installation), erscheinen alle — sonst gäbe es
 * nichts zu wählen und man säße fest. Die Auswahl erscheint nur, wenn es mehr
 * als eine Börse gibt.
 */
import { ref, computed, onMounted, defineAsyncComponent } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import { seitenId } from '../../stores/ui.js'
import { gewaehlteBoerse, brokers, selectedTradeCategory, BOT_BROKERS } from '../../stores/filters.js'

// Das Filterpanel zieht viel Journal-Code nach sich; geladen wird es erst,
// wenn das Journal-Menü wirklich erscheint.
const SidebarFilters = defineAsyncComponent(() => import('../journal/FilterLeiste.vue'))

const props = defineProps({
    /** Menü eingeklappt (nur Symbole): Pillen und Filter fallen weg. */
    schmal: { type: Boolean, default: false },
})

const { t } = useI18n()

const konfiguriert = ref([])

async function ladeKonfigurierte() {
    const gefunden = []
    await Promise.all(brokers.map(async (b) => {
        try {
            const { data } = await axios.get(`/api/${b.value}/config`)
            if (data && (data.apiKey || data.hasSecret)) gefunden.push(b.value)
        } catch { /* ohne Konfiguration: nicht anbieten */ }
    }))
    konfiguriert.value = gefunden
}

const boersen = computed(() => {
    const liste = brokers.filter((b) => konfiguriert.value.includes(b.value))
    return liste.length ? liste : brokers
})

function waehleBoerse(wert) {
    if (wert === gewaehlteBoerse.value) return
    gewaehlteBoerse.value = wert
    try { localStorage.setItem('at.journal.boerse', wert) } catch { /* privater Modus */ }
    window.location.reload()
}

const aufKonten = computed(() => seitenId.value === 'accounts')
const mitBot = computed(() => BOT_BROKERS.includes(gewaehlteBoerse.value))

function waehleKategorie(kat) {
    if (kat === selectedTradeCategory.value && !aufKonten.value) return
    selectedTradeCategory.value = kat
    try { localStorage.setItem('selectedTradeCategory', kat) } catch { /* privater Modus */ }
    // Auf der Kontenübersicht ist keine Kategorie aktiv — der Klick führt
    // zurück in die Trading-Ansicht, auch wenn die Kategorie gleich bleibt.
    if (aufKonten.value) window.location.href = '/journal'
    else window.location.reload()
}

onMounted(() => {
    // „Alle" und die Agent-Pille gibt es nicht mehr; wer sie gespeichert hat,
    // säße sonst unsichtbar fest.
    if (!selectedTradeCategory.value || ['all', 'agent'].includes(selectedTradeCategory.value)) {
        selectedTradeCategory.value = 'futures'
        try { localStorage.setItem('selectedTradeCategory', 'futures') } catch { /* privater Modus */ }
    }
    ladeKonfigurierte()
})
</script>

<template>
    <template v-if="!props.schmal">
        <section v-if="boersen.length > 1" class="at-menue-block">
            <div class="at-menue-ueberschrift">{{ t('nav.exchange') }}</div>
            <div class="pillen">
                <button v-for="b in boersen" :key="b.value" type="button" class="pille"
                    :class="{ aktiv: gewaehlteBoerse === b.value }" :aria-pressed="gewaehlteBoerse === b.value"
                    @click="waehleBoerse(b.value)">{{ b.label }}</button>
            </div>
        </section>

        <section class="at-menue-block">
            <div class="pillen">
                <a href="/accounts" class="pille pille-breit" :class="{ aktiv: aufKonten }"
                    :aria-current="aufKonten ? 'page' : undefined">
                    <Symbol name="geldboerse" />{{ t('nav.accountsOverview') }}
                </a>
                <button type="button" class="pille" :class="{ aktiv: !aufKonten && selectedTradeCategory !== 'bot' }"
                    @click="waehleKategorie('futures')">{{ t('nav.kategorieFutures') }}</button>
                <button v-if="mitBot" type="button" class="pille"
                    :class="{ aktiv: !aufKonten && selectedTradeCategory === 'bot' }"
                    @click="waehleKategorie('bot')">{{ t('nav.kategorieBot') }}</button>
            </div>
            <SidebarFilters />
        </section>
    </template>
</template>

<style scoped>
.pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--abstand-2);
    margin-bottom: var(--abstand-2);
}

.pille {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.28rem 0.8rem;
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-pille);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.3;
    text-decoration: none;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.pille:hover {
    color: var(--text);
    border-color: var(--accent-rand);
}

.pille.aktiv {
    background: var(--accent-flaeche);
    border-color: var(--accent-rand);
    color: var(--accent);
}

.pille-breit {
    flex: 1 0 100%;
    justify-content: center;
}
</style>
