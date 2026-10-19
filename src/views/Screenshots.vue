<script setup>
/**
 * Seite `/screenshots` (Spec S.7): alle Bilder, neueste zuerst, in Seiten zu
 * vier nachgeladen (Endlos-Scroll), gefiltert nach Tags und Börse (Filterleiste,
 * serverseitig in `ladeBilder`) und hier zusätzlich nach Bildtyp.
 *
 * Kein Monatsfilter: die Seite zeigt alle Zeiten.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Screenshot from '../components/Screenshot.vue'
import SeiteLaedt from '../components/SeiteLaedt.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'
import Reiter from '../components/basis/Reiter.vue'
import Symbol from '../components/basis/Symbol.vue'
import { seiteLaedt, ladeMehr } from '../stores/app/laden.js'
import { listeZuEnde } from '../stores/app/rahmen.js'
import { screenshots, expandedScreenshot, bildSeite, bildAbfrageGrenze } from '../stores/journal/screenshots.js'
import { starteBilder, pruefeSichtbarkeit, ladeWeitere } from '../utils/journal/ablauf.js'

const { t } = useI18n()

// ── Typ-Filter (nur über die geladene Liste, nicht gespeichert) ──

const typ = ref('alle')
const TYPEN = computed(() => [
    { id: 'alle', titel: t('common.all') },
    { id: 'eroeffnung', titel: t('screenshots.opening') },
    { id: 'abschluss', titel: t('screenshots.closing') },
])

const EROEFFNUNG_SEITEN = ['B', 'SS', 'long', 'short']
const name = (b) => String(b?.name || '')

/**
 * Abschluss: Seite `BC` oder Namensendung `_closing`. Eröffnung: Long/Short in
 * beiden Schreibweisen (`B`/`SS` vom Journal, `long`/`short` vom Playbook) oder
 * Endung `_entry`/`_trend` — die Altregel kannte `long`/`short` nicht, und
 * Playbook-Bilder fehlten unter „Eröffnung“ (A-S6).
 */
function istAbschluss(b) {
    return b.side === 'BC' || name(b).includes('_closing')
}
function istEroeffnung(b) {
    if (istAbschluss(b)) return false
    return EROEFFNUNG_SEITEN.includes(b.side) || /_(entry|trend)$/.test(name(b))
}

/** Gefiltert, aber mit dem Index in der UNGEFILTERTEN Liste — das Vollbild blättert dort. */
const sichtbar = computed(() => {
    const aus = []
    screenshots.forEach((b, index) => {
        if (!b || b.objectId == null) return
        if (typ.value === 'eroeffnung' && !istEroeffnung(b)) return
        if (typ.value === 'abschluss' && !istAbschluss(b)) return
        aus.push({ b, index })
    })
    return aus
})

/**
 * Trade-ID aus dem Bildnamen für den Playbook-Link: Endungen
 * `_entry`/`_trend`/`_closing` abschneiden; ohne erkennbare Trade-ID
 * (`t<Tag>_<Index>_<Position>`) kein Link (A-S7).
 */
function tradeIdAus(n) {
    const ohne = String(n || '').replace(/_(entry|trend|closing)$/, '')
    return /^t\d+_\d+_.+/.test(ohne) ? ohne : ''
}
const playbookLink = (b) => {
    const id = tradeIdAus(b.name)
    return id ? `/playbook?tradeId=${encodeURIComponent(id)}` : ''
}

// ── Endlos-Scroll ──

function beimScrollen() {
    const rest = document.documentElement.scrollHeight - window.scrollY
    if (window.innerHeight + 200 < rest) return
    if (ladeMehr.value || seiteLaedt.value || listeZuEnde.value) return
    if (expandedScreenshot.value != null) return
    ladeWeitere()
}

onMounted(async () => {
    // Jeder Besuch beginnt vorn — sonst setzte ein zweiter Besuch beim Offset
    // des ersten fort. Eine gemerkte Menge (SS) setzt starteBilder danach.
    listeZuEnde.value = false
    screenshots.length = 0
    bildSeite.value = 0
    bildAbfrageGrenze.value = 4
    await starteBilder()
    window.addEventListener('scroll', beimScrollen, { passive: true })
    pruefeSichtbarkeit()
})

onBeforeUnmount(() => {
    window.removeEventListener('scroll', beimScrollen)
})
</script>

<template>
    <SeiteLaedt />
    <div v-show="!seiteLaedt" class="seite">
        <Reiter v-model="typ" :reiter="TYPEN" class="typen" />

        <Leerzustand v-if="sichtbar.length === 0" :titel="t('common.noData')" symbol="bild" />

        <div v-else class="raster">
            <article v-for="{ b, index } in sichtbar" :id="String(b.objectId)" :key="b.objectId" class="karte">
                <Screenshot :screenshot-data="b" source="screenshots" :index="index" />
                <router-link v-if="playbookLink(b)" :to="playbookLink(b)" class="playbook at-klein">
                    <Symbol name="buch" :groesse="15" />{{ t('nav.playbook') }}
                </router-link>
            </article>
        </div>

        <div v-if="spinnerLoadMore" class="nachladen">
            <Kreisel :groesse="22" />
        </div>
    </div>
</template>

<style scoped>
.seite {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-4);
    min-width: 0;
}

.typen {
    align-self: flex-start;
    max-width: 100%;
}

.raster {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--abstand-4);
}

@media (min-width: 768px) {
    .raster {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (min-width: 1200px) {
    .raster {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.karte {
    display: flex;
    flex-direction: column;
    gap: var(--abstand-2);
    min-width: 0;
    padding: var(--abstand-3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    scroll-margin-top: calc(var(--kopf-hoehe) + var(--abstand-4));
}

.playbook {
    display: inline-flex;
    align-items: center;
    gap: var(--abstand-1);
    align-self: flex-start;
    color: var(--accent);
    text-decoration: none;
}

.playbook:hover {
    color: var(--accent-hover);
}

.nachladen {
    display: flex;
    justify-content: center;
    padding: var(--abstand-4) 0;
}
</style>
