<script setup>
/**
 * Kopfleiste von AutarkTrade: Logo links, Modi als Navigation (Unterstrich in
 * Akzentfarbe wie bei AutarkDarts), rechts Einstellungen.
 *
 * Hat den früheren Modus-Umschalter unter dem Seitentitel (ModeSwitcher.vue,
 * in S9 entfernt) abgelöst und dessen Logik übernommen: nur
 * eingeschaltete Modi (`istModusAn`), Wechsel per vollem Seitenaufruf, damit
 * offene WebSockets und Timer der Live-Ansicht sicher enden.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import Logo from '../basis/Logo.vue'
import Symbol from '../basis/Symbol.vue'
import { appMode, pageId, screenType } from '../../stores/ui.js'
import { currentUser } from '../../stores/settings.js'
import { MODES, modeHome, pageById, istModusAn } from '../../config/menu.js'

const { t } = useI18n()

const SYMBOL = { journal: 'journal', start: 'chart', live: 'live', research: 'entdecken', agent: 'agent', lernen: 'lernen' }

const route = useRoute()
// Auf der Startseite (/start) ist kein Modus aktiv.
const aktiverModus = computed(() => (route.meta?.mode === 'uebersicht' ? null : appMode.value))
const modi = computed(() => MODES.filter((m) => istModusAn(m.id, currentUser.value)))
const mobil = computed(() => screenType.value === 'mobile')

function beschriftung(m) {
    return mobil.value ? t(m.shortKey || m.titleKey) : t(m.titleKey)
}

function wechsle(m, e) {
    if (!m.enabled) { e.preventDefault(); return }
    // Schon auf einer Seite dieses Modus: nichts tun.
    const seitenModus = pageById(pageId.value)?.mode ?? null
    if (seitenModus === m.id) { e.preventDefault(); return }
    localStorage.setItem('appMode', m.id)
    appMode.value = m.id
    // Kein preventDefault: der Link lädt die Seite voll neu.
}
</script>

<template>
    <header class="at-kopfleiste">
        <a class="marke" href="/start" :title="t('app.name')">
            <Logo :groesse="30" />
        </a>
        <nav class="modi" :aria-label="t('app.modi')">
            <a v-for="m in modi" :key="m.id" :href="modeHome(m.id)" :class="{ aktiv: aktiverModus === m.id }"
                :aria-current="aktiverModus === m.id ? 'page' : undefined"
                :title="m.beta ? t(m.betaHintKey || 'modes.betaHint') : undefined" @click="wechsle(m, $event)">
                <Symbol :name="SYMBOL[m.id] || 'info'" />
                <span>{{ beschriftung(m) }}</span>
                <span v-if="m.beta" class="beta">Beta</span>
            </a>
        </nav>
        <div class="rechts">
            <a class="knopf" href="/settings" :class="{ aktiv: pageId === 'settings' }" :title="t('nav.settings')"
                :aria-label="t('nav.settings')">
                <Symbol name="einstellungen" :groesse="20" />
            </a>
        </div>
    </header>
</template>

<style scoped>
.at-kopfleiste {
    position: sticky;
    top: 0;
    z-index: 1030;
    display: flex;
    align-items: center;
    gap: 1.6rem;
    height: var(--kopf-hoehe);
    padding: 0 clamp(0.8rem, 2.4vw, 1.6rem);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
}

.marke {
    display: inline-flex;
    text-decoration: none;
    flex: 0 0 auto;
}

.modi {
    display: flex;
    align-items: stretch;
    gap: 1.3rem;
    height: 100%;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
}

.modi::-webkit-scrollbar {
    display: none;
}

.modi a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    text-decoration: none;
    font-size: 0.92rem;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    padding-top: 2px;
    transition: color 0.15s;
}

.modi a:hover {
    color: var(--text);
}

.modi a.aktiv {
    color: var(--text);
    border-bottom-color: var(--accent);
}

.modi a.aktiv .at-symbol {
    color: var(--accent);
}

.beta {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius-pille);
    background: var(--warn-flaeche);
    color: var(--warn);
}

.rechts {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: 0 0 auto;
}

.knopf {
    display: inline-flex;
    padding: 0.45rem;
    border-radius: var(--radius-knopf);
    color: var(--muted);
}

.knopf:hover,
.knopf.aktiv {
    color: var(--accent);
    background: var(--panel-soft);
}

/* Telefon: Logo und Einstellungen oben, die Modi als scrollende Zeile darunter. */
@media (max-width: 767.98px) {
    .at-kopfleiste {
        flex-wrap: wrap;
        height: auto;
        gap: 0;
        padding-top: 0.5rem;
    }

    .marke {
        order: 1;
        flex: 1 1 auto;
    }

    .rechts {
        order: 2;
    }

    .modi {
        order: 3;
        flex: 1 0 100%;
        height: 44px;
        gap: 1.1rem;
        margin-top: 0.3rem;
    }

    .modi a {
        font-size: 0.85rem;
    }

    /* Das Banner darunter sagt es schon — oben wäre es doppelt. */
    .rechts .at-pille {
        display: none;
    }
}
</style>
