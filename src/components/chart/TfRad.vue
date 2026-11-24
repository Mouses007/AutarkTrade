<script setup>
/*
 * Zeiteinheit am Handy: ein Knopf links neben den Coin-Tabs, der ein Scrollrad mit
 * allen Zeiteinheiten aufklappt (statt der Knopfreihe in der Kopfleiste — die frass
 * eine ganze Zeile). Tippen wählt und schliesst. Der Stern legt wie am PC fest, welche
 * Zeiteinheiten im Vollbild als Schnellwahl stehen (`chartTfFavoriten` im Browser).
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { INTERVALLE, INTERVALLE_SICHTBAR } from '../../utils/chart/kerzenQuelle.js'
import { Symbol } from '../basis'

const props = defineProps({
    interval: { type: String, required: true },
    gesperrt: { type: Object, default: () => new Set() },   // Set der Zeiteinheiten, die die Kursquelle nicht kennt
})
const emit = defineEmits(['waehle'])
const { t } = useI18n()

const offen = ref(false)
const wurzel = ref(null)
const rad = ref(null)

const FAV_SCHLUESSEL = 'chartTfFavoriten'
function leseFavoriten() {
    try {
        const roh = JSON.parse(localStorage.getItem(FAV_SCHLUESSEL) || 'null')
        const gueltig = Array.isArray(roh) ? roh.filter((i) => INTERVALLE.includes(i)) : []
        if (gueltig.length) return gueltig
    } catch { /* kaputt oder kein Speicher */ }
    return [...INTERVALLE_SICHTBAR]
}
const favoriten = ref(leseFavoriten())
function schalteFavorit(i) {
    const an = favoriten.value.includes(i)
    if (an && favoriten.value.length <= 1) return
    favoriten.value = an ? favoriten.value.filter((x) => x !== i) : [...favoriten.value, i]
    try { localStorage.setItem(FAV_SCHLUESSEL, JSON.stringify(favoriten.value)) } catch { /* kein Speicher */ }
}

async function umschalten() {
    offen.value = !offen.value
    if (!offen.value) return
    favoriten.value = leseFavoriten()
    await nextTick()
    // Die aktuelle Zeiteinheit steht beim Öffnen in der Mitte des Rads.
    const el = rad.value?.querySelector('.zeile.an')
    if (el && rad.value) rad.value.scrollTop = el.offsetTop - (rad.value.clientHeight - el.offsetHeight) / 2
}
function waehle(i) {
    if (props.gesperrt.has(i)) return
    emit('waehle', i)
    offen.value = false
}
function draussen(e) { if (offen.value && wurzel.value && !wurzel.value.contains(e.target)) offen.value = false }
onMounted(() => document.addEventListener('pointerdown', draussen))
onBeforeUnmount(() => document.removeEventListener('pointerdown', draussen))
</script>

<template>
    <div ref="wurzel" class="tfRad">
        <button type="button" class="knopf" :class="{ an: offen }" aria-haspopup="listbox" :aria-expanded="offen"
            :title="t('chart.tfFavoritenTitel')" :aria-label="t('chart.zeiteinheit') + ': ' + interval" @click="umschalten">
            {{ interval }} <Symbol name="runter" :groesse="12" />
        </button>
        <div v-if="offen" class="aufklapp">
            <div ref="rad" class="rad" role="listbox" :aria-label="t('chart.zeiteinheit')">
                <div v-for="i in INTERVALLE" :key="i" class="zeile" :class="{ an: i === interval, gesperrt: gesperrt.has(i) }">
                    <button type="button" class="wahl" role="option" :aria-selected="i === interval" :disabled="gesperrt.has(i)"
                        :title="gesperrt.has(i) ? t('chart.quelle.tfFehlt') : ''" @click="waehle(i)">{{ i }}</button>
                    <button type="button" class="stern" :class="{ an: favoriten.includes(i) }"
                        :disabled="favoriten.includes(i) && favoriten.length <= 1"
                        :title="t(favoriten.includes(i) ? 'chart.tfFavoritWeg' : 'chart.tfFavoritHinzu')"
                        :aria-label="t(favoriten.includes(i) ? 'chart.tfFavoritWeg' : 'chart.tfFavoritHinzu')"
                        @click.stop="schalteFavorit(i)"><Symbol name="stern" :gefuellt="favoriten.includes(i)" /></button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tfRad {
    position: relative;
    flex: 0 0 auto;
}

.knopf {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 46px;
    justify-content: center;
    padding: 4px 8px;
    border: 1px solid var(--accent-rand);
    border-radius: var(--radius-klein);
    background: var(--accent-flaeche);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}

.aufklapp {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 45;
    width: 124px;
    border: 1px solid var(--line-stark);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: var(--schatten);
    overflow: hidden;
}

/* Rad: fünf Zeilen sichtbar, die mittlere rastet ein; oben und unten läuft es aus. */
.rad {
    --zeile: 40px;
    height: calc(var(--zeile) * 5);
    padding: calc(var(--zeile) * 2) 0;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    scrollbar-width: none;
    overscroll-behavior: contain;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent);
    mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent);
}

.rad::-webkit-scrollbar {
    display: none;
}

.zeile {
    display: flex;
    align-items: center;
    height: var(--zeile);
    scroll-snap-align: center;
}

.wahl {
    flex: 1;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 15px;
    text-align: center;
    padding-left: 28px;
    cursor: pointer;
}

.zeile.an .wahl {
    color: var(--accent);
    font-weight: 700;
}

.zeile.gesperrt .wahl {
    opacity: 0.35;
}

.stern {
    width: 34px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
}

.stern.an {
    color: var(--warn);
}

.stern:disabled {
    opacity: 0.5;
}
</style>
