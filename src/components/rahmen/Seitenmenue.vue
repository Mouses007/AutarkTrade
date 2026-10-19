<script setup>
/**
 * Seitenmenü von AutarkTrade (Inhalt der Menüspalte im Layout).
 *
 * Von oben: Nutzername, Klappknopf (nur Desktop), das Menü des aktuellen
 * Modus, „Verwaltung" (immer), Fuss mit Version und Update.
 *
 * Alle Modus-Menüs kommen aus der Registry `config/menu.js`. Das Journal hat
 * oben zusätzlich Börse, Kategorie und Filter (`MenueJournalKopf.vue`) und
 * erscheint auch im Modus `start` — vom Chart will man direkt ins Journal
 * springen können, ohne erst den Modus zu wechseln.
 *
 * Die Einträge sind gewöhnliche Links mit vollem Seitenaufruf. Darauf baut die
 * Initialisierung des Layouts (Journal-Daten für genau eine Auswahl), und offene
 * WebSockets der Live-Ansichten enden damit sicher.
 */
import { ref, computed, onMounted, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Symbol from '../basis/Symbol.vue'
import MenueJournalKopf from './MenueJournalKopf.vue'
import MenueFuss from './MenueFuss.vue'
import { appMode, pageId, screenType } from '../../stores/ui.js'
import { sideMenuEingeklappt, schalteSideMenu } from '../../stores/app/rahmen.js'
import { currentUser } from '../../stores/settings.js'
import { PAGES, pagesForMode, istModusAn } from '../../config/menu.js'
import { useIstTelefon } from '../../utils/geraet.js'

const LiveSymbolPicker = defineAsyncComponent(() => import('../LiveSymbolPicker.vue'))

const { t } = useI18n()
const route = useRoute()
const istTelefon = useIstTelefon()

const desktop = computed(() => screenType.value === 'computer')
const schmal = computed(() => desktop.value && sideMenuEingeklappt.value)

/** Welche Registry-Gruppen in welchem Modus erscheinen, in dieser Reihenfolge. */
const GRUPPEN = {
    journal: ['analyze', 'reflect', 'add'],
    live: ['liveAnalyze', 'liveTrade'],
    research: ['hypeGruppe', 'coinGruppe'],
    agent: ['agentRun', 'agentBuild', 'agentReview'],
    lernen: ['lernenGruppe'],
}

/** Der Modus `start` (Chart) zeigt das Journal-Menü. */
const menueModus = computed(() => (appMode.value === 'start' ? 'journal' : appMode.value))
const istJournalMenue = computed(() => menueModus.value === 'journal')

const kiAn = computed(() => currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0)

/**
 * Ist die Seite sichtbar? Ein Flag blendet nur bei ausdrücklicher 0 aus —
 * fehlt der Wert (Einstellungen noch nicht da), bleibt der Eintrag, sonst
 * verschwände er kurz und käme wieder. Nur-Desktop-Seiten fallen auf echten
 * Telefonen weg (Breite UND grober Zeiger), nicht in einem schmalen
 * Desktop-Fenster; eine Einstellung kann sie fürs Telefon freischalten.
 */
function sichtbar(seite) {
    const u = currentUser.value
    const v = seite.flag ? u?.[seite.flag] : undefined
    if (v === 0 || v === '0' || v === false) return false
    if (seite.nurDesktop && istTelefon.value && Number(u?.[seite.mobilFlag]) !== 1) return false
    if (seite.id === 'kiAgent' && !kiAn.value) return false
    return true
}

const gruppen = computed(() => {
    const modus = menueModus.value
    const namen = GRUPPEN[modus]
    if (!namen) return []
    // Ganzer Modus abgeschaltet: keine Einträge eines Modus, den die Kopfleiste
    // nicht mehr anbietet. Das Journal ist nie abschaltbar.
    if (modus !== 'journal' && !istModusAn(modus, currentUser.value)) return []
    const seiten = pagesForMode(modus).filter(sichtbar)
    return namen
        .map((g) => ({ id: g, seiten: seiten.filter((s) => s.group === g) }))
        .filter((g) => g.seiten.length)
})

/*
 * Hervorhebung nach Pfad: zwei Einträge können sich einen Routennamen teilen
 * (/hype-radar und /hype-radar/berichte), über `pageId` wären beide aktiv.
 * Steht man auf einer Adresse, die kein Menüeintrag ist, entscheidet `pageId`
 * — sonst gäbe es gar keine Markierung.
 */
const menuePfade = new Set(PAGES.filter((p) => p.group).map((p) => p.path))
function aktiv(seite) {
    const pfad = route.path.replace(/\/+$/, '') || '/'
    if (menuePfade.has(pfad)) return pfad === seite.path
    return pageId.value === seite.id
}

const beschriftung = (seite) => t(seite.menuKey || seite.titleKey)
const symbolVon = (seite) => seite.menuSymbol || seite.symbol || 'info'

/** Seiten mit Symbolwähler — alle drei teilen sich denselben Symbolblock. */
const WAEHLER = { liquidity: 'bookmap', liquidations: 'levmap', openinterest: 'oi' }
const waehlerVariante = computed(() => (menueModus.value === 'live' ? WAEHLER[pageId.value] || null : null))

// Abmelden gibt es nur, wenn das Passwort-Gate aktiv ist.
const mitAnmeldung = ref(false)
async function abmelden() {
    try { await axios.post('/api/logout') } catch { /* egal — neu laden zeigt das Gate */ }
    window.location.reload()
}

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/auth/status')
        mitAnmeldung.value = !!data?.authEnabled
    } catch { /* still */ }
})
</script>

<template>
    <div class="at-seitenmenue" :class="{ schmal }">
        <div v-if="currentUser?.username && !schmal" class="nutzer">
            <img v-if="currentUser.avatar" :src="currentUser.avatar" alt="" class="avatar" />
            <span class="name">{{ currentUser.username }}</span>
        </div>

        <button v-if="desktop" type="button" class="klappe"
            :title="schmal ? t('nav.menuAusklappen') : t('nav.menuEinklappen')"
            :aria-label="schmal ? t('nav.menuAusklappen') : t('nav.menuEinklappen')" :aria-expanded="!schmal"
            @click="schalteSideMenu()">
            <Symbol :name="schmal ? 'doppelRechts' : 'doppelLinks'" :groesse="18" />
            <span v-if="!schmal" class="text">{{ t('nav.menuEinklappen') }}</span>
        </button>

        <nav class="menue" :aria-label="t('nav.menueBeschriftung')">
            <MenueJournalKopf v-if="istJournalMenue" :schmal="schmal" />

            <section v-for="g in gruppen" :key="g.id" class="at-menue-block">
                <div v-if="!schmal" class="at-menue-ueberschrift">{{ t('nav.' + g.id) }}</div>
                <a v-for="s in g.seiten" :key="s.id" :href="s.path" class="eintrag" :class="{ aktiv: aktiv(s) }"
                    :aria-current="aktiv(s) ? 'page' : undefined" :title="beschriftung(s)">
                    <Symbol :name="symbolVon(s)" :groesse="schmal ? 20 : 17" />
                    <span v-if="!schmal" class="text">{{ beschriftung(s) }}</span>
                </a>
            </section>

            <section v-if="waehlerVariante && !schmal" class="at-menue-block">
                <LiveSymbolPicker :variant="waehlerVariante" />
            </section>

            <section class="at-menue-block">
                <div v-if="!schmal" class="at-menue-ueberschrift">{{ t('nav.manage') }}</div>
                <a href="/settings" class="eintrag" :class="{ aktiv: pageId === 'settings' }"
                    :aria-current="pageId === 'settings' ? 'page' : undefined" :title="t('nav.settings')">
                    <Symbol name="einstellungen" :groesse="schmal ? 20 : 17" />
                    <span v-if="!schmal" class="text">{{ t('nav.settings') }}</span>
                </a>
                <button v-if="mitAnmeldung" type="button" class="eintrag" :title="t('nav.abmelden')" @click="abmelden">
                    <Symbol name="abmelden" :groesse="schmal ? 20 : 17" />
                    <span v-if="!schmal" class="text">{{ t('nav.abmelden') }}</span>
                </button>
            </section>
        </nav>

        <MenueFuss v-if="!schmal" />
    </div>
</template>

<style scoped>
.at-seitenmenue {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: var(--abstand-3) var(--abstand-3) var(--abstand-2);
    font-size: 0.92rem;
}

.at-seitenmenue.schmal {
    padding-left: var(--abstand-2);
    padding-right: var(--abstand-2);
    align-items: stretch;
}

.nutzer {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0 var(--abstand-2) var(--abstand-3);
    color: var(--text);
    font-weight: 600;
    min-width: 0;
}

.avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
}

.name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.klappe {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    width: 100%;
    padding: 0.4rem var(--abstand-2);
    margin-bottom: var(--abstand-2);
    border: 0;
    border-radius: var(--radius-knopf);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
}

.schmal .klappe {
    justify-content: center;
}

.klappe:hover {
    color: var(--accent);
    background: var(--panel-soft);
}

.menue {
    display: flex;
    flex-direction: column;
}

/* Gruppenblock — auch für die Blöcke aus MenueJournalKopf.vue. */
.menue :deep(.at-menue-block) {
    padding: var(--abstand-2) 0 var(--abstand-3);
    margin-bottom: var(--abstand-2);
    border-bottom: 1px solid var(--line);
}

.menue :deep(.at-menue-ueberschrift) {
    padding: 0 var(--abstand-2);
    margin-bottom: var(--abstand-2);
    color: var(--leise);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.eintrag {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.42rem var(--abstand-2);
    border: 0;
    border-radius: var(--radius-knopf);
    background: transparent;
    color: var(--muted);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}

.eintrag:hover {
    background: var(--panel-soft);
    color: var(--text);
}

.eintrag.aktiv {
    background: var(--accent-flaeche);
    color: var(--text);
}

.eintrag.aktiv .at-symbol {
    color: var(--accent);
}

/* Akzentstrich links, wie der Unterstrich am aktiven Modus der Kopfleiste. */
.eintrag.aktiv::before {
    content: '';
    position: absolute;
    left: calc(-1 * var(--abstand-2));
    top: 22%;
    bottom: 22%;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
}

.schmal .eintrag {
    justify-content: center;
    padding: 0.55rem 0;
}

.schmal .eintrag.aktiv::before {
    left: calc(-1 * var(--abstand-1));
}

.text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
