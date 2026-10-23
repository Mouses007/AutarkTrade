<script setup>
/**
 * Senkrechte Werkzeugleiste links neben dem Chart, wie bei TradingView.
 * Ein Werkzeug gilt für das aktive Panel und schaltet sich nach dem Zeichnen
 * ab; ein zweiter Klick auf dasselbe Werkzeug bricht ab.
 *
 * Ausklappbar: ausgeklappt steht der Name neben jedem Symbol. Der Zustand
 * bleibt im Browser — er hängt am Bildschirm, nicht am Layout.
 *
 * Ganz unten: Börsenlinks (BX, BG, PX untereinander) für das Symbol des aktiven
 * Charts — nur wo der Coin als USDT-Perpetual gelistet ist und die Börse unter
 * „Börsenlinks" in den Einstellungen aktiviert ist (wie in der Watchlist).
 */
import { ref, computed } from 'vue'
import { ladeHandelbar, boersenFuerSymbol } from '../../utils/chart/handelbar.js'
import { aktivierteBoersen } from '../../utils/boersenLinks.js'
import { appEinstellungen } from '../../stores/app/rahmen.js'
import { useI18n } from 'vue-i18n'
import { WERKZEUGE } from '../../utils/chart/zeichnungen/werkzeuge.js'
import { Symbol } from '../basis'

const props = defineProps({
    symbol: { type: String, default: '' },
    markt: { type: String, default: 'futures' },
    werkzeug: { type: String, default: null },
    magnet: { type: Boolean, default: false },
    versteckt: { type: Boolean, default: false },
    /** Handy-Schublade: immer mit Namen, ohne Ein-/Ausklappen. */
    immerOffen: { type: Boolean, default: false },
})
const emit = defineEmits(['werkzeug', 'magnet', 'versteckt', 'alleLoeschen'])
const { t } = useI18n()

/*
 * Symbol je Werkzeug. `WERKZEUGE` (werkzeuge.js) trägt noch die alten
 * Unicons-Klassen; gezeichnet wird hier nach dem Typ, damit die Liste unangetastet bleibt.
 */
const WERKZEUG_SYMBOL = {
    trendlinie: 'linie',
    strahl: 'wachstum',
    horizontale: 'minus',
    strahlH: 'pfeilRechts',
    vertikale: 'spalten',
    kanal: 'zeilen',
    rechteck: 'quadrat',
    fib: 'prozent',
    volprofil: 'rangliste',
    position: 'fadenkreuz',
    text: 'text',
    messen: 'regler',
}

ladeHandelbar()
const boersen = computed(() => {
    const aktiv = aktivierteBoersen(appEinstellungen.value?.boersenLinks)
    return boersenFuerSymbol(props.symbol, props.markt).filter((b) => aktiv.includes(b.id))
})

const SCHLUESSEL = 'chartWerkzeugeOffen'
function lese() {
    try { return localStorage.getItem(SCHLUESSEL) === '1' } catch { return false }
}
const offenGemerkt = ref(lese())
const offen = computed(() => props.immerOffen || offenGemerkt.value)
function umschalten() {
    offenGemerkt.value = !offenGemerkt.value
    try { localStorage.setItem(SCHLUESSEL, offenGemerkt.value ? '1' : '0') } catch { /* kein Speicher */ }
}
</script>

<template>
    <div class="zeichenleiste" :class="{ offen }">
        <button v-if="!immerOffen" class="w klappe" :title="t(offen ? 'chart.wzKurz.einklappen' : 'chart.wzKurz.ausklappen')" @click="umschalten" :aria-label="t(offen ? 'chart.wzKurz.einklappen' : 'chart.wzKurz.ausklappen')">
            <Symbol :name="offen ? 'doppelLinks' : 'doppelRechts'" class="zeichen" />
            <span v-if="offen" class="name">{{ t('chart.wzKurz.einklappen') }}</span>
        </button>
        <hr v-if="!immerOffen" />
        <button class="w" :class="{ an: !werkzeug }" :title="t('chart.wz.zeiger')" @click="emit('werkzeug', null)" :aria-label="t('chart.wz.zeiger')">
            <Symbol name="maus" class="zeichen" />
            <span v-if="offen" class="name">{{ t('chart.wz.zeiger') }}</span>
        </button>
        <hr />
        <template v-for="(w, i) in WERKZEUGE" :key="w.typ">
            <hr v-if="i > 0 && WERKZEUGE[i - 1].gruppe !== w.gruppe" />
            <button class="w" :class="{ an: werkzeug === w.typ }" :title="t('chart.wz.' + w.typ)"
                @click="emit('werkzeug', werkzeug === w.typ ? null : w.typ)" :aria-label="t('chart.wz.' + w.typ)">
                <Symbol :name="WERKZEUG_SYMBOL[w.typ] || 'stift'" class="zeichen" />
                <span v-if="offen" class="name">{{ t('chart.wz.' + w.typ) }}</span>
            </button>
        </template>
        <hr />
        <button class="w" :class="{ an: magnet }" :title="t('chart.wz.magnet')" @click="emit('magnet')" :aria-label="t('chart.wz.magnet')">
            <Symbol name="magnet" class="zeichen" />
            <span v-if="offen" class="name">{{ t('chart.wzKurz.magnet') }}</span>
        </button>
        <button class="w" :class="{ an: versteckt }" :title="t('chart.wz.allesVerstecken')" @click="emit('versteckt')" :aria-label="t('chart.wz.allesVerstecken')">
            <Symbol :name="versteckt ? 'augeAus' : 'auge'" class="zeichen" />
            <span v-if="offen" class="name">{{ t(versteckt ? 'chart.wzKurz.einblenden' : 'chart.wzKurz.ausblenden') }}</span>
        </button>
        <button class="w" :title="t('chart.wz.alleLoeschen')" @click="emit('alleLoeschen')" :aria-label="t('chart.wz.alleLoeschen')">
            <Symbol name="muell" class="zeichen" />
            <span v-if="offen" class="name">{{ t('chart.wzKurz.alleLoeschen') }}</span>
        </button>
        <div v-if="boersen.length" class="boersen">
            <hr />
            <a v-for="b in boersen" :key="b.id" class="w boerse" :class="b.id" :href="b.url" target="_blank" rel="noopener"
                :title="t('chart.watchlistBoerse', { boerse: b.name })" :aria-label="t('chart.watchlistBoerse', { boerse: b.name })">
                <span class="kurz zeichen">{{ b.kurz }}</span>
                <span v-if="offen" class="name">{{ b.name }}</span>
            </a>
        </div>
    </div>
</template>

<style scoped>
.zeichenleiste {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel);
    overflow-y: auto;
    overflow-x: hidden;
}

.zeichenleiste.offen {
    align-items: stretch;
    width: 172px;
    padding: 4px;
}

.w {
    width: 30px;
    height: 28px;
    background: transparent;
    border: none;
    color: var(--muted);
    border-radius: var(--radius-klein);
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.offen .w {
    width: 100%;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 6px;
}

.offen .w > .zeichen {
    width: 18px;
    flex-shrink: 0;
}

.name {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.klappe {
    color: var(--muted);
    opacity: 0.8;
}

.w:hover {
    color: var(--text);
    background: var(--line);
}

.w.an {
    color: var(--accent);
    background: var(--accent-flaeche);
}

hr {
    width: 70%;
    margin: 3px 0;
    border: none;
    border-top: 1px solid var(--line-stark);
    opacity: 1;
}

.offen hr {
    width: auto;
    margin: 3px 4px;
}

/* Börsenlinks ganz unten */
.boersen {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: inherit;
    gap: 3px;
    width: 100%;
}

.boerse {
    text-decoration: none;
}

.boerse .kurz {
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 3px 3px;
    border-radius: 3px;
    border: 1px solid currentColor;
    opacity: 0.8;
    text-align: center;
}

.boerse:hover .kurz {
    opacity: 1;
}

.boerse.bitunix { color: var(--boerse-bitunix); }
.boerse.bitget { color: var(--boerse-bitget); }
.boerse.pionex { color: var(--boerse-pionex); }
</style>
