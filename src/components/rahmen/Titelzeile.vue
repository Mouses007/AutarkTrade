<script setup>
/**
 * Titelzeile über dem Inhalt: links der Seitentitel (im Journal mit einer
 * Kurzfassung der aktiven Filter), rechts Zensur, KI-Schnellzugriff und Export.
 *
 * Die Modi stehen nicht hier, sondern in der Kopfleiste. Am Telefon ist der
 * Titel zugleich der Knopf, der das Seitenmenü ausfährt.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Symbol from '../basis/Symbol.vue'
import { appMode, pageId, screenType, privacyMode } from '../../stores/ui.js'
import { currentUser } from '../../stores/settings.js'
import { selectedPeriodRange, selectedGrossNet, selectedPositions, selectedMonth, selectedDateRange } from '../../stores/filters.js'
import { filteredTradesTrades } from '../../stores/trades.js'
import { pageById } from '../../config/menu.js'
import { useToggleMobileMenu, useInitTooltip, useExport } from '../../utils/utils.js'
import { useDateCalFormat } from '../../utils/formatters.js'
import dayjs from '../../utils/dayjs-setup.js'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

const mobil = computed(() => screenType.value === 'mobile')

/** Titel: Registry, sonst Routen-Meta, sonst leer — darf nie werfen. */
const titel = computed(() => {
    const key = pageById(pageId.value)?.titleKey || route.meta?.titleKey
    if (key && te(key)) return t(key)
    return route.meta?.title || ''
})

/* ── Filter-Zusammenfassung (nur Journal-Seiten mit Filtern) ── */
const FILTER_SEITEN = ['dashboard', 'daily', 'calendar', 'screenshots', 'auswertung']

function zeitraum() {
    const id = pageId.value
    if (id === 'dashboard' || id === 'auswertung') return selectedPeriodRange.value?.label || ''
    if (id === 'daily' || id === 'calendar') {
        const start = selectedMonth.value?.start
        return start ? dayjs.unix(start).format('MMM YYYY') : ''
    }
    return ''
}

const filterText = computed(() => {
    if (!FILTER_SEITEN.includes(pageId.value)) return ''
    const teile = [zeitraum()]
    if (selectedGrossNet.value === 'gross') teile.push(t('options.gross'))
    else if (selectedGrossNet.value === 'net') teile.push(t('options.net'))
    const pos = Array.isArray(selectedPositions.value) ? selectedPositions.value : []
    if (pos.length === 1) teile.push(pos[0] === 'long' ? t('nav.long') : t('nav.short'))
    return teile.filter(Boolean).join(' · ')
})

/* ── Zensur (nur Journal) ── */
function schalteZensur() {
    privacyMode.value = !privacyMode.value
    try { localStorage.setItem('privacyMode', privacyMode.value ? '1' : '0') } catch { /* privater Modus */ }
}

/* ── KI-Schnellzugriff ── */
const kiAn = computed(() => currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0)
// `route.name` statt `pageId`: so stimmt es auch unmittelbar nach einer SPA-Navigation.
const zeigeKi = computed(() => kiAn.value && route.name !== 'kiAgent')
function oeffneKi() {
    // Der KI-Coach öffnet den Chat-Reiter und gibt die Herkunftsseite an den Server weiter.
    router.push({ path: '/ki-coach', query: { tab: 'agent', sourcePage: pageId.value } })
}

/* ── Export (nur Dashboard) ── */
const exportOffen = ref(false)
const exportEl = ref(null)
function exportiere(format) {
    exportOffen.value = false
    useExport(format, useDateCalFormat(selectedDateRange.value?.start), useDateCalFormat(selectedDateRange.value?.end), filteredTradesTrades)
}
function klickDraussen(e) {
    if (exportOffen.value && exportEl.value && !exportEl.value.contains(e.target)) exportOffen.value = false
}
function taste(e) {
    if (e.key === 'Escape') exportOffen.value = false
}

onMounted(() => {
    // Bootstrap-Tooltips der Seiten (z. B. Info-Symbole im Journal-Dashboard)
    // werden bis zur Ablösung von Bootstrap hier einmal je Seitenaufruf
    // eingerichtet. S9-Teil2: entfällt mit Bootstrap.
    useInitTooltip()
    document.addEventListener('click', klickDraussen)
    document.addEventListener('keydown', taste)
})
onBeforeUnmount(() => {
    document.removeEventListener('click', klickDraussen)
    document.removeEventListener('keydown', taste)
})
</script>

<template>
    <div class="at-titelzeile">
        <div class="links">
            <button v-if="mobil" type="button" class="mobile-menu-toggle" :aria-label="t('nav.menueOeffnen')"
                @click="useToggleMobileMenu()">
                <Symbol name="menue" :groesse="22" />
                <span class="titelblock">
                    <span class="seitentitel">{{ titel }}</span>
                    <span v-if="filterText" class="nav-filter-info">{{ filterText }}</span>
                </span>
            </button>
            <template v-else>
                <h1 class="seitentitel">{{ titel }}</h1>
                <span v-if="filterText" class="nav-filter-info">{{ filterText }}</span>
            </template>
        </div>

        <div class="rechts">
            <button v-if="appMode === 'journal'" type="button" class="symbolknopf" :class="{ aktiv: privacyMode }"
                :aria-pressed="privacyMode" :title="privacyMode ? t('nav.showNumbers') : t('nav.hideNumbers')"
                :aria-label="privacyMode ? t('nav.showNumbers') : t('nav.hideNumbers')" @click="schalteZensur">
                <Symbol :name="privacyMode ? 'augeAus' : 'auge'" :groesse="18" />
            </button>

            <button v-if="zeigeKi" type="button" class="symbolknopf" :title="t('nav.kiAgent')" :aria-label="t('nav.kiAgent')"
                @click="oeffneKi">
                <Symbol name="ki" :groesse="18" />
            </button>

            <div v-if="pageId === 'dashboard'" ref="exportEl" class="export">
                <button type="button" class="exportknopf" aria-haspopup="menu" :aria-expanded="exportOffen"
                    @click="exportOffen = !exportOffen">
                    {{ t('nav.export') }}
                    <Symbol name="runter" :groesse="14" />
                </button>
                <div v-if="exportOffen" class="exportmenue" role="menu">
                    <button type="button" role="menuitem" @click="exportiere('json')">JSON</button>
                    <button type="button" role="menuitem" @click="exportiere('csv')">CSV</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.at-titelzeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--abstand-3);
    padding: var(--abstand-4) clamp(0.6rem, 1.6vw, 1.2rem) var(--abstand-1);
    background: transparent;
}

.links {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.2rem var(--abstand-3);
    min-width: 0;
}

.seitentitel {
    margin: 0;
    color: var(--text);
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
}

.nav-filter-info {
    color: var(--muted);
    font-size: 0.82rem;
}

.mobile-menu-toggle {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
}

.mobile-menu-toggle .titelblock {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.mobile-menu-toggle .seitentitel {
    font-size: 1.15rem;
}

.rechts {
    display: flex;
    align-items: center;
    gap: var(--abstand-2);
    flex: 0 0 auto;
}

.symbolknopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.symbolknopf:hover {
    color: var(--text);
    border-color: var(--accent-rand);
}

.symbolknopf.aktiv {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
}

.export {
    position: relative;
}

.exportknopf {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 34px;
    padding: 0 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.exportknopf:hover {
    border-color: var(--accent-rand);
}

.exportmenue {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
    min-width: 7rem;
    padding: var(--abstand-1);
    border: 1px solid var(--line-stark);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    box-shadow: var(--schatten);
}

.exportmenue button {
    display: block;
    width: 100%;
    padding: 0.4rem 0.7rem;
    border: 0;
    border-radius: var(--radius-klein);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
}

.exportmenue button:hover {
    background: var(--accent-flaeche);
}

@media (max-width: 991.98px) {
    .at-titelzeile {
        padding-top: var(--abstand-3);
        align-items: flex-start;
    }
}
</style>
