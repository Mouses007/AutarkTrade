<script setup>
/**
 * Karte «Einreichungen (SEC)» der Titel-Seite: was Yahoo nicht liefert —
 * Börsenprospekt, Angebote (Kapitalerhöhungen) und Insider-Meldungen im
 * Original bei der US-Börsenaufsicht (`server/aktien/edgar.js`).
 *
 * Lädt für sich, getrennt von den Yahoo-Daten: fällt EDGAR aus, bleibt die
 * Titel-Seite stehen — und umgekehrt.
 *
 * Zustände, die KEIN Fehler sind:
 *   aus           keine Kontaktangabe hinterlegt → `QuelleAus` mit Verweis auf die Einstellung
 *   nicht geführt Titel ohne US-Listung bzw. ohne Eintrag bei der SEC
 *
 * Haltefrist: Die gerechnete Frist (180 Tage ab erstem Handelstag,
 * `shared/aktien-newcomer.js`) steht neben dem Link auf den Börsenprospekt.
 * Ein Wert «laut Prospekt» erscheint nur, wenn der Server im Text genau EINE
 * Dauer gefunden hat — dann mit der Textstelle. Sonst bleibt es beim Link.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '../basis/Karte.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { HALTEFRIST_TAGE } from '../../../shared/aktien-newcomer.js'

const props = defineProps({
    ticker: { type: String, required: true },
    /** Erster Handelstag laut Kursquelle (ms) — für die gerechnete Haltefrist. */
    ipoDatum: { type: Number, default: null },
})
const { t, te, locale } = useI18n()

const TAG = 86_400_000
const KURZ = 5

const daten = ref(null)
const aus = ref(null)
const laedt = ref(true)
const fehler = ref('')
const alleInsider = ref(false)
const alleAngebote = ref(false)

async function lade() {
    laedt.value = true
    fehler.value = ''
    aus.value = null
    daten.value = null
    const fuer = props.ticker
    try {
        const { data } = await axios.get(`/api/aktien/titel/${encodeURIComponent(fuer)}/einreichungen`, { timeout: 90000 })
        if (fuer !== props.ticker) return
        if (data?.aus) aus.value = data
        else daten.value = data
    } catch (e) {
        if (fuer === props.ticker) fehler.value = e?.response?.data?.error || e.message
    } finally {
        if (fuer === props.ticker) laedt.value = false
    }
}
watch(() => props.ticker, lade, { immediate: true })

// Die SEC nennt Tage ohne Uhrzeit — als UTC-Mitternacht geliefert, also auch in UTC anzeigen.
const tag = (ms) => (ms ? new Date(ms).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '—')
const artText = (z) => (z.art && te(`edgar.art.${z.art}`) ? t(`edgar.art.${z.art}`) : (z.beschreibung || ''))
const zaehler = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([form, n]) => `${form}: ${n}`).join(' · ')

const d = computed(() => (daten.value?.ok && daten.value.gefuehrt ? daten.value : null))
/** Der Titel fehlt im Stamm — das sagt schon die Titel-Seite, die Karte schweigt. */
const verborgen = computed(() => daten.value?.ok === false && daten.value.grund === 'unbekannt')
const nichtGefuehrt = computed(() => (daten.value?.ok && daten.value.gefuehrt === false ? daten.value.grund : null))
const stoerung = computed(() => (daten.value?.ok === false && ['gebremst', 'abgelehnt'].includes(daten.value.grund) ? daten.value.grund : null))

const unter = computed(() => (d.value ? [d.value.firma.name, `CIK ${Number(d.value.firma.cik)}`, ...d.value.firma.boersen].filter(Boolean).join(' · ') : ''))
const angebote = computed(() => (alleAngebote.value ? d.value?.angebot : d.value?.angebot?.slice(0, KURZ)) || [])
const insider = computed(() => (alleInsider.value ? d.value?.insider?.liste : d.value?.insider?.liste?.slice(0, KURZ)) || [])
const gerechnet = computed(() => (Number.isFinite(props.ipoDatum) && props.ipoDatum > 0 ? props.ipoDatum + HALTEFRIST_TAGE * TAG : null))
const fund = computed(() => d.value?.haltefrist?.fund || null)
const mehrdeutig = computed(() => d.value?.haltefrist?.mehrdeutig || null)
const fundAblauf = computed(() => (fund.value && d.value?.prospekt ? d.value.prospekt.zeit + fund.value.tage * TAG : null))
</script>

<template>
    <Karte v-if="!verborgen" :titel="t('edgar.titel')" :unter="unter" class="edgar-karte" data-edgar>
        <template v-if="d" #aktionen>
            <a :href="d.firma.uebersicht" target="_blank" rel="noopener noreferrer">{{ t('edgar.alle') }}</a>
        </template>

        <Kreisel v-if="laedt" />
        <QuelleAus v-else-if="aus" :aus="aus" klein />
        <Hinweis v-else-if="fehler" art="fehler">{{ t('edgar.fehler', { fehler }) }}</Hinweis>
        <Hinweis v-else-if="stoerung" art="warn">{{ t('edgar.grund_' + stoerung) }}</Hinweis>
        <p v-else-if="nichtGefuehrt" class="leer" data-edgar-nicht-gefuehrt>
            <strong>{{ t('edgar.nichtGefuehrt') }}</strong>
            <span>{{ t('edgar.nichtGefuehrt_' + nichtGefuehrt) }}</span>
        </p>

        <template v-else-if="d">
            <!-- Kennzahl -->
            <dl class="kennzahl">
                <div>
                    <dt>{{ t('edgar.angebote12m') }}</dt>
                    <dd :class="{ viel: d.kennzahl.angebote12m > 0 }">{{ d.kennzahl.angebote12m ?? '—' }}</dd>
                </div>
                <div>
                    <dt>{{ t('edgar.juengstesAngebot') }}</dt>
                    <dd>{{ d.kennzahl.juengstesAngebot ? tag(d.kennzahl.juengstesAngebot) : (d.vollstaendig ? t('edgar.keines') : '—') }}</dd>
                </div>
                <div v-if="d.insider.tage90">
                    <dt>{{ t('edgar.insider90') }}</dt>
                    <dd>{{ zaehler(d.insider.tage90) || t('edgar.keine') }}</dd>
                </div>
                <div v-if="d.berichte.monate12">
                    <dt>{{ t('edgar.berichte12m') }}</dt>
                    <dd>{{ zaehler(d.berichte.monate12) || t('edgar.keine') }}</dd>
                </div>
            </dl>
            <p v-if="d.kennzahl.angebote12m == null" class="klein">{{ t('edgar.nichtGanzGesehen', { datum: tag(d.reichtBis) }) }}</p>

            <!-- Börsengang und Haltefrist -->
            <h4>{{ t('edgar.boersengang') }}</h4>
            <div v-if="d.prospekt" class="prospekt">
                <a class="haupt" :href="d.prospekt.link" target="_blank" rel="noopener noreferrer">{{ t('edgar.prospekt', { datum: tag(d.prospekt.zeit) }) }}</a>
                <p v-if="gerechnet" class="klein">{{ t('edgar.fristGerechnet', { tage: HALTEFRIST_TAGE, datum: tag(gerechnet) }) }}</p>
                <div v-if="fund" class="fund" data-edgar-fund>
                    <p><b>{{ t(fund.hoechstens ? 'edgar.fundHoechstens' : 'edgar.fund', { tage: fund.tage }) }}</b> {{ t('edgar.fundAblauf', { datum: tag(fundAblauf), eingereicht: tag(d.prospekt.zeit) }) }}</p>
                    <blockquote lang="en">{{ fund.stelle }}</blockquote>
                    <p class="klein">{{ t(fund.ausnahmen ? 'edgar.fundAusnahmen' : 'edgar.fundHinweis') }}</p>
                </div>
                <div v-else-if="mehrdeutig" class="fund">
                    <p>{{ t('edgar.fundMehrdeutig', { werte: mehrdeutig.werte.join(', ') }) }}</p>
                    <blockquote lang="en">{{ mehrdeutig.stelle }}</blockquote>
                </div>
                <p v-else-if="d.haltefrist" class="klein">{{ t(d.haltefrist.gelesen ? 'edgar.fundNichts' : 'edgar.fundNichtGelesen') }}</p>
                <p v-else class="klein">{{ t('edgar.fundAlt') }}</p>
            </div>
            <p v-else class="klein">{{ d.vollstaendig ? t('edgar.keinProspekt') : t('edgar.keinProspektGesehen', { datum: tag(d.reichtBis) }) }}</p>
            <ol v-if="d.boersengang.length" class="liste">
                <li v-for="z in d.boersengang" :key="z.link">
                    <span class="tag">{{ tag(z.zeit) }}</span>
                    <a :href="z.link" target="_blank" rel="noopener noreferrer">{{ z.form }}</a>
                    <span class="was">{{ artText(z) }}</span>
                </li>
            </ol>

            <!-- Angebote -->
            <h4>{{ t('edgar.angebot') }}</h4>
            <ol v-if="angebote.length" class="liste">
                <li v-for="z in angebote" :key="z.link">
                    <span class="tag">{{ tag(z.zeit) }}</span>
                    <a :href="z.link" target="_blank" rel="noopener noreferrer">{{ z.form }}</a>
                    <span class="was">{{ artText(z) }}</span>
                </li>
            </ol>
            <p v-else class="klein">{{ d.vollstaendig ? t('edgar.keineAngebote') : t('edgar.keineAngeboteGesehen', { datum: tag(d.reichtBis) }) }}</p>
            <button v-if="d.angebot.length > KURZ" type="button" class="mehr" @click="alleAngebote = !alleAngebote">
                {{ alleAngebote ? t('edgar.weniger') : t('edgar.mehr', { n: d.angebot.length - KURZ }) }}
            </button>
            <p v-if="d.angebot.length" class="klein">{{ t('edgar.angebotHinweis') }}</p>

            <!-- Insider -->
            <h4>{{ t('edgar.insider') }}</h4>
            <ol v-if="insider.length" class="liste">
                <li v-for="z in insider" :key="z.link">
                    <span class="tag">{{ tag(z.zeit) }}</span>
                    <a :href="z.link" target="_blank" rel="noopener noreferrer">{{ z.form }}</a>
                    <span class="was">{{ artText(z) }}</span>
                </li>
            </ol>
            <p v-else class="klein">{{ t('edgar.keineInsider') }}</p>
            <button v-if="d.insider.liste.length > KURZ" type="button" class="mehr" @click="alleInsider = !alleInsider">
                {{ alleInsider ? t('edgar.weniger') : t('edgar.mehr', { n: d.insider.liste.length - KURZ }) }}
            </button>

            <p class="klein quelle">{{ t('edgar.quelle', { datum: new Date(d.stand).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }) }}</p>
        </template>
    </Karte>
</template>

<style scoped>
p { margin: 0; }

a {
    color: var(--accent);
    text-decoration: none;
}
a:hover { text-decoration: underline; }

h4 {
    margin: 1rem 0 0.4rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.klein {
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
    margin-top: 0.35rem;
}

.leer {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.86rem;
    line-height: 1.45;
}
.leer strong { color: var(--text); font-weight: 600; }

.kennzahl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.6rem 1.2rem;
    margin: 0;
}
.kennzahl dt {
    color: var(--muted);
    font-size: 0.78rem;
}
.kennzahl dd {
    margin: 0.1rem 0 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}
.kennzahl dd.viel { color: var(--warn, var(--bad)); }

.prospekt {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
}
.prospekt .haupt { font-weight: 600; }

.fund {
    margin-top: 0.55rem;
    font-size: 0.86rem;
    line-height: 1.45;
}
blockquote {
    margin: 0.4rem 0 0;
    padding: 0.1rem 0 0.1rem 0.7rem;
    border-left: 2px solid var(--line-stark, var(--line));
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.liste {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
}
.liste li {
    display: grid;
    grid-template-columns: 5.4rem 4.6rem minmax(0, 1fr);
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.3rem 0;
    border-top: 1px solid var(--line);
    font-size: 0.85rem;
}
.liste li:first-child { border-top: 0; }
.liste .tag {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}
.liste .was {
    color: var(--muted);
    min-width: 0;
}

.mehr {
    margin-top: 0.5rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.quelle { margin-top: 0.9rem; }

@media (max-width: 520px) {
    .liste li { grid-template-columns: 5.2rem minmax(0, 1fr); }
    .liste .was { grid-column: 1 / -1; }
}
</style>
