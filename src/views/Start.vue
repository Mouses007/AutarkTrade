<script setup>
/**
 * Startseite von AutarkTrade: Logo gross, darunter die eingeschalteten Modi als
 * Kacheln — nach dem Vorbild der Spielwahl von AutarkDarts. Ziel eines Klicks
 * auf das Logo in der Kopfleiste. `/` führt weiterhin in den Chart (bzw. das
 * Journal), damit die gewohnte Landeseite bleibt.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Logo from '../components/basis/Logo.vue'
import Symbol from '../components/basis/Symbol.vue'
import Pille from '../components/basis/Pille.vue'
import { appEinstellungen } from '../stores/settings.js'
import { appMode } from '../stores/ui.js'
import { MODES, modeHome, istModusAn } from '../config/menu.js'
import { setzeSeitenId } from '../utils/journal/app.js'

const { t } = useI18n()
const SYMBOL = { journal: 'journal', start: 'chart', live: 'live', research: 'entdecken', agent: 'agent', lernen: 'lernen', portfolio: 'muenzen' }
const modi = computed(() => MODES.filter((m) => istModusAn(m.id, appEinstellungen.value)))
const version = __APP_VERSION__

function waehle(m) {
    localStorage.setItem('appMode', m.id)
    appMode.value = m.id
}

onMounted(() => setzeSeitenId())
</script>

<template>
    <div class="at-start">
        <section class="kopf">
            <div class="text">
                <h1>{{ t('app.startTitel') }}</h1>
                <p class="unter">{{ t('app.startUnter') }}</p>
                <p class="claim">{{ t('app.claim') }}</p>
            </div>
            <Logo class="logo" anordnung="unter" :groesse="200" />
        </section>

        <section class="kacheln">
            <a v-for="m in modi" :key="m.id" class="kachel" :href="modeHome(m.id)" @click="waehle(m)">
                <span class="kreis"><Symbol :name="SYMBOL[m.id] || 'info'" :groesse="24" /></span>
                <span class="titel">
                    {{ t(m.titleKey) }}
                    <Pille v-if="m.beta" ton="warn">Beta</Pille>
                </span>
                <span class="beschreibung">{{ t('app.modusText.' + m.id) }}</span>
                <Symbol name="ausklappen" class="pfeil" />
            </a>
        </section>

        <p class="fuss">{{ t('app.name') }} · {{ t('app.version', { v: version }) }}</p>
    </div>
</template>

<style scoped>
.at-start {
    max-width: 72rem;
    margin: 0 auto;
    padding: clamp(1rem, 4vw, 2.6rem) clamp(0.4rem, 2vw, 1rem);
}

.kopf {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    align-items: end;
    gap: 1.2rem;
    margin-bottom: 2.2rem;
}

h1 {
    margin: 0;
    font-size: clamp(2rem, 4.6vw, 3rem);
    font-weight: 700;
    letter-spacing: -0.03em;
}

.unter {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 1.05rem;
}

.claim {
    margin: 1.2rem 0 0;
    display: inline-block;
    padding: 0.3rem 0.8rem;
    border-radius: var(--radius-pille);
    background: var(--accent-flaeche);
    border: 1px solid var(--accent-rand);
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.logo {
    justify-self: center;
}

.kacheln {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
    gap: clamp(0.7rem, 1.6vw, 1.1rem);
}

.kachel {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: 0.9rem;
    row-gap: 0.25rem;
    align-items: center;
    padding: 1.1rem 2.6rem 1.1rem 1.1rem;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: linear-gradient(160deg, var(--panel-soft), var(--panel));
    color: var(--text);
    text-decoration: none;
    transition: border-color 0.15s, transform 0.15s;
}

.kachel:hover {
    border-color: var(--accent-rand);
    color: var(--text);
    transform: translateY(-1px);
}

.kreis {
    grid-row: 1 / 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent-flaeche);
    color: var(--accent);
}

.titel {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 1.05rem;
}

.beschreibung {
    color: var(--muted);
    font-size: 0.88rem;
}

.pfeil {
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--accent);
}

.fuss {
    margin-top: 2.4rem;
    text-align: center;
    color: var(--leise);
    font-size: 0.8rem;
}

@media (max-width: 47.99rem) {
    .kopf {
        grid-template-columns: minmax(0, 1fr);
    }

    .logo {
        grid-row: 1;
        justify-self: start;
        --logo-groesse: 140px !important;
    }
}
</style>
