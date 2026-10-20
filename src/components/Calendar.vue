<script setup>
/**
 * Monatskalender des Journals (Spezifikation ansichten.md K.2–K.6): Raster
 * aus `kalenderDaten`, gefärbt nach P&L oder Zufriedenheit, Klick auf einen
 * Handelstag springt in die Tagesansicht.
 *
 * Ohne Props und Events — die Kalenderseite ist der einzige Ort, der ihn
 * einbindet. Mini-Kalender werden nicht gerendert: `miniKalenderDaten`
 * bekommt nie Monate (journal-kern.md §7.4), sie erschienen also auch früher
 * nie.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { kalenderDaten } from '../stores/trades.js'
import { betragArt, gewaehltPlOderZufriedenheit, gewaehlterMonat, selectedMonthPreset } from '../stores/filters.js'
import { seiteLaedt, tradeZeitzone, scrollToDateUnix } from '../stores/ui.js'
import { starteKalender } from '../utils/journal/ablauf.js'
import { formGeld0 } from '../utils/journal/format.js'
import dayjs from '../utils/journal/zeit.js'
import Symbol from '@/components/basis/Symbol.vue'

const { t } = useI18n()
const router = useRouter()

const TAGE = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const wochen = computed(() => Object.keys(kalenderDaten)
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map(k => kalenderDaten[k]))
const titel = computed(() => wochen.value[0]?.[0]?.month || '')

const erloes = (feld) => feld?.pAndL?.[betragArt.value + 'Proceeds']

function farbe(feld) {
    if (gewaehltPlOderZufriedenheit.value === 'pl') {
        const e = erloes(feld)
        if (e === undefined || e === null) return ''
        return e >= 0 ? 'gruen' : 'rot'
    }
    /* eslint-disable eqeqeq -- lose Gleichheit wie gespeichert: 1/true, 0/false */
    if (feld?.satisfaction == true) return 'gruen'
    if (feld?.satisfaction == false) return 'rot'   // null/undefined sind nicht == false
    /* eslint-enable eqeqeq */
    return ''
}

const klickbar = (feld) => !!feld?.pAndL?.trades

function oeffne(feld) {
    if (!(feld?.dateUnix && feld.pAndL && feld.pAndL.trades)) return
    scrollToDateUnix.value = feld.dateUnix
    router.push('/tagesansicht')
}

/**
 * Erlös als ganze Zahl: abgeschnitten mit Math.trunc. parseInt machte aus
 * einer Zahl in Exponentialschreibweise Unsinn (1e-7 wurde zu 1).
 */
const ganz = (x) => formGeld0(Math.trunc(Number(x)))

function wechsle(schritt) {
    seiteLaedt.value = true
    const zone = tradeZeitzone.value
    const anfang = dayjs.unix(gewaehlterMonat.value.start).tz(zone).add(schritt, 'month').startOf('month')
    gewaehlterMonat.value.start = anfang.unix()
    gewaehlterMonat.value.end = anfang.endOf('month').unix()
    try { localStorage.setItem('at.journal.monat', JSON.stringify(gewaehlterMonat.value)) } catch { /* privater Modus */ }
    const jetzt = dayjs().tz(zone).startOf('month').unix()
    selectedMonthPreset.value = anfang.unix() === jetzt ? 'current' : 'custom'
    try { localStorage.setItem('selectedMonthPreset', selectedMonthPreset.value) } catch { /* privater Modus */ }
    starteKalender()
}
</script>

<template>
    <div class="kal">
        <div class="kal-kopf">
            <button type="button" class="kal-pfeil" :title="t('calendar.prevMonth')" :aria-label="t('calendar.prevMonth')" @click="wechsle(-1)">
                <Symbol name="einklappen" />
            </button>
            <div class="kal-titel">{{ titel }}</div>
            <button type="button" class="kal-pfeil" :title="t('calendar.nextMonth')" :aria-label="t('calendar.nextMonth')" @click="wechsle(1)">
                <Symbol name="ausklappen" />
            </button>
        </div>

        <div class="kal-raster">
            <div v-for="tg in TAGE" :key="tg" class="kal-name">{{ t('calendar.' + tg) }}</div>
            <template v-for="(woche, w) in wochen" :key="'w' + w">
                <div v-for="(feld, i) in woche" :key="w + '-' + i"
                    :class="['kal-feld', farbe(feld), { klickbar: klickbar(feld), fuell: !feld.day }]"
                    :role="klickbar(feld) ? 'button' : undefined" :tabindex="klickbar(feld) ? 0 : undefined"
                    @click="oeffne(feld)" @keydown.enter="oeffne(feld)">
                    <div v-if="feld.day" class="kal-tag">{{ feld.day }}</div>
                    <div class="kal-werte">
                        <div v-if="feld.pAndL?.trades" class="kal-trades">{{ feld.pAndL.trades }} {{ t('common.trades') }}</div>
                        <div v-if="erloes(feld)" class="kal-erloes zahl">{{ ganz(erloes(feld)) }}</div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.kal-kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    max-width: 22rem;
    margin: 0 auto 0.8rem;
}

.kal-titel {
    font-weight: 700;
    font-size: 1.05rem;
    text-align: center;
}

.kal-pfeil {
    display: inline-flex;
    padding: 0.4rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--muted);
    cursor: pointer;
}

.kal-pfeil:hover {
    color: var(--accent);
    border-color: var(--accent-rand);
}

.kal-raster {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.3rem;
}

.kal-name {
    padding: 0.2rem 0;
    text-align: center;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
}

.kal-feld {
    min-height: 3rem;
    padding: 0.3rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-klein);
    background: var(--panel-soft);
    min-width: 0;
    overflow: hidden;
}

.kal-feld.fuell {
    background: transparent;
    border-color: transparent;
}

.kal-feld.gruen {
    background: var(--good-flaeche);
    border-color: color-mix(in srgb, var(--good) 40%, transparent);
}

.kal-feld.rot {
    background: var(--bad-flaeche);
    border-color: color-mix(in srgb, var(--bad) 40%, transparent);
}

.kal-feld.klickbar {
    cursor: pointer;
}

.kal-feld.klickbar:hover,
.kal-feld.klickbar:focus-visible {
    outline: none;
    border-color: var(--accent);
}

.kal-tag {
    font-size: 0.8rem;
    font-weight: 600;
}

/* Trades und Erlös erst ab Tablet-Breite — auf dem Telefon reicht die Farbe. */
.kal-werte {
    display: none;
}

@media (min-width: 768px) {
    .kal-feld {
        min-height: 5rem;
        padding: 0.45rem;
    }

    .kal-werte {
        display: block;
        margin-top: 0.25rem;
        font-size: 0.78rem;
    }

    .kal-trades {
        color: var(--muted);
    }

    .kal-erloes {
        font-weight: 600;
        overflow-wrap: anywhere;
    }
}
</style>
