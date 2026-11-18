<script setup>
/**
 * Coin-Ansicht, Karte «Projekt-Lage»: was sich am Projekt in den letzten
 * zwölf Monaten geändert hat.
 *
 * Anlass: Hivemapper (HONEY) stand mit guter Projektnote da, während die
 * Bee-App seit August 2026 in USDC statt HONEY auszahlte und den Vertrag mit
 * der Stiftung gekündigt hatte. Die Stammdaten sagen, was ein Projekt sein
 * will; was sich geändert hat, steht in den Meldungen.
 *
 * KOSTENLOS, lädt mit der Ansicht (`GET /api/coin-radar/ansicht/lage`):
 * Schlagzeilen aus Google News (nur mit «Quellen mit eingeschränkten
 * Nutzungsbedingungen» an) und aus den eigenen Nachrichten. Schlagzeilen mit
 * Warnsignal (Token-Nutzen, Delisting, Sicherheit, Recht, Angebot) sind
 * markiert und oben gezählt.
 *
 * BEZAHLT, nur per Knopf (`POST …/lage/recherche`): Perplexity mit dem
 * Schlüssel des Kunden. Das Ergebnis bleibt 24 h gespeichert und kommt beim
 * nächsten Öffnen ohne neuen Abruf mit.
 *
 * FREMDTEXT. Titel und Befunde sind reiner Text (nie HTML), Links gehen durch
 * `sichereUrl` und öffnen in einem neuen Tab ohne Referrer.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Karte from '../basis/Karte.vue'
import Knopf from '../basis/Knopf.vue'
import Hinweis from '../basis/Hinweis.vue'
import Kreisel from '../basis/Kreisel.vue'
import Pille from '../basis/Pille.vue'
import Quellenhinweis from '../basis/Quellenhinweis.vue'
import QuelleAus from '../quellen/QuelleAus.vue'
import { useCoinFormat } from '../../composables/useCoinFormat.js'
import { sichereUrl } from '../../utils/sanitize.js'

const props = defineProps({
    /** Handelssymbol, z. B. «HONEYUSDT». */
    symbol: { type: String, required: true },
})
const { t } = useI18n()
const { zahl, datum, zeit } = useCoinFormat()

const WARNARTEN = ['tokenZweck', 'delisting', 'sicherheit', 'recht', 'angebot']
const ROT = new Set(['tokenZweck', 'delisting', 'sicherheit'])

const lage = ref(null)
const laedt = ref(false)
const fehler = ref('')
const recherche = ref(null)
const rechercheLaeuft = ref(false)
const rechercheFehler = ref('')
const alle = ref(false)

let lauf = 0
async function lade() {
    const eigener = ++lauf
    lage.value = null
    recherche.value = null
    fehler.value = ''
    rechercheFehler.value = ''
    alle.value = false
    laedt.value = true
    try {
        const { data } = await axios.get('/api/coin-radar/ansicht/lage', { params: { symbol: props.symbol }, timeout: 40000 })
        if (eigener !== lauf) return
        lage.value = data
        recherche.value = data?.recherche?.ergebnis || null
    } catch (e) {
        if (eigener === lauf) fehler.value = e.response?.data?.error || e.message
    } finally {
        if (eigener === lauf) laedt.value = false
    }
}
watch(() => props.symbol, lade, { immediate: true })

async function recherchiere() {
    if (rechercheLaeuft.value || !lage.value?.recherche?.moeglich) return
    const fuer = props.symbol
    rechercheLaeuft.value = true
    rechercheFehler.value = ''
    try {
        const { data } = await axios.post('/api/coin-radar/ansicht/lage/recherche', { symbol: fuer }, { timeout: 120000 })
        if (fuer === props.symbol) recherche.value = data
    } catch (e) {
        if (fuer === props.symbol) rechercheFehler.value = e.response?.data?.error || e.message
    } finally {
        rechercheLaeuft.value = false
    }
}

const eintraege = computed(() => (lage.value?.eintraege || []).map((e) => ({ ...e, link: sichereUrl(e.url) })))
const sichtbar = computed(() => (alle.value ? eintraege.value : eintraege.value.slice(0, 8)))
const warnZeilen = computed(() => {
    const w = lage.value?.warnungen || {}
    return WARNARTEN.filter((a) => w[a]).map((a) => ({ art: a, rot: ROT.has(a), text: t('coinAnsicht.lage.warn_' + a, { n: w[a] }, w[a]) }))
})
const warnRot = computed(() => warnZeilen.value.some((w) => w.rot))
const gn = computed(() => lage.value?.googleNews || {})
const eigene = computed(() => lage.value?.eigene || {})
const zaehler = computed(() => {
    const teile = []
    if (gn.value.zustand === 'ok') teile.push(t('coinAnsicht.lage.zaehlerGn', { n: gn.value.anzahl }))
    if (eigene.value.zustand === 'ok') teile.push(t('coinAnsicht.lage.zaehlerEigene', { n: eigene.value.anzahl }))
    return teile.join(' · ')
})
const quellen = computed(() => {
    const q = []
    if (gn.value.zustand === 'ok') q.push({ name: 'Google News', url: 'https://news.google.com/', art: 'daten' })
    if (eigene.value.zustand === 'ok') q.push({ name: t('coinAnsicht.lage.eigeneNachrichten'), art: 'daten' })
    return q
})

const worte = computed(() => ({ daten: t('hype.quelleDaten'), quelle: t('hype.quelleQuelle') }))

const rechercheGrund = computed(() => {
    const g = lage.value?.recherche?.grund
    return g === 'ohneSchluessel' ? t('coinAnsicht.lage.ohneSchluessel') : g === 'ohneName' ? t('coinAnsicht.lage.ohneNameKi') : ''
})
const befunde = computed(() => (recherche.value?.befunde || []).map((b) => ({ ...b, link: sichereUrl(b.quelleUrl) })))
const rechercheQuellen = computed(() => (recherche.value?.quellen || []).map((q) => ({ ...q, link: sichereUrl(q.url) })).filter((q) => q.link))
const kurzUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)
</script>

<template>
    <Karte :titel="t('coinAnsicht.lage.titel')" :unter="t('coinAnsicht.lage.unter')" class="coin-lage">
        <div v-if="laedt" class="ca-laedt"><Kreisel :groesse="22" :titel="t('coinAnsicht.laedt')" /></div>
        <p v-else-if="fehler" class="ca-klein">{{ fehler }}</p>
        <template v-else-if="lage">
            <!-- Warnzeile: was die Schlagzeilen sagen, gezählt nach Art -->
            <div v-if="warnZeilen.length" :class="['warnzeile', warnRot ? 'rot' : 'gelb']" role="status">
                <strong>{{ t('coinAnsicht.lage.warnKopf') }}</strong>
                <span v-for="w in warnZeilen" :key="w.art" :class="['warnart', w.rot ? 'rot' : 'gelb']">{{ w.text }}</span>
            </div>
            <p v-else-if="eintraege.length" class="ca-klein">{{ t('coinAnsicht.lage.keineWarnung') }}</p>

            <QuelleAus v-if="gn.zustand === 'aus' && gn.aus" :aus="gn.aus" klein />
            <p v-else-if="gn.zustand === 'fehler'" class="ca-klein">{{ t('coinAnsicht.lage.gnFehler') }}</p>
            <p v-if="lage.googleNews?.zustand === 'ohneName'" class="ca-klein">{{ t('coinAnsicht.lage.ohneName') }}</p>
            <p v-if="eigene.zustand === 'fehler'" class="ca-klein">{{ t('coinAnsicht.lage.eigenFehler') }}</p>

            <ul v-if="eintraege.length" class="meldungen">
                <li v-for="e in sichtbar" :key="e.url" :class="e.art ? ['warn', e.schwere === 'rot' ? 'rot' : 'gelb'] : []">
                    <span class="wann">{{ datum(e.zeit) }}</span>
                    <div class="was">
                        <!-- Fremdtext: reiner Text -->
                        <a v-if="e.link" :href="e.link" target="_blank" rel="noopener noreferrer">{{ e.titel }}</a>
                        <span v-else>{{ e.titel }}</span>
                        <span class="ca-klein wer">
                            <Pille v-if="e.art" :ton="e.schwere === 'rot' ? 'schlecht' : 'warn'">{{ t('coinAnsicht.lage.art_' + e.art) }}</Pille>
                            {{ e.quelle || '—' }}<template v-if="e.herkunft === 'eigene'"> · {{ t('coinAnsicht.lage.eigeneNachrichten') }}</template>
                            <template v-if="e.weitere?.length"> · {{ t('coinAnsicht.lage.auch', { quellen: e.weitere.slice(0, 3).join(', ') }) }}</template>
                        </span>
                    </div>
                </li>
            </ul>
            <button v-if="eintraege.length > 8" type="button" class="ca-mehr" :aria-expanded="alle ? 'true' : 'false'" @click="alle = !alle">
                {{ alle ? t('coinAnsicht.lage.weniger') : t('coinAnsicht.lage.alle', { n: eintraege.length }) }}
            </button>
            <p v-else-if="!eintraege.length && gn.zustand !== 'ohneName'" class="ca-klein">{{ t('coinAnsicht.lage.keine') }}</p>
            <p v-if="zaehler" class="ca-klein ca-fuss">{{ zaehler }}</p>
            <p v-if="warnZeilen.length" class="ca-klein">{{ t('coinAnsicht.lage.warnHinweis') }}</p>
            <Quellenhinweis v-if="quellen.length" :quellen="quellen" :worte="worte" />

            <!-- KI-Recherche: kostet, nur auf Knopfdruck -->
            <section class="recherche" :aria-label="t('coinAnsicht.lage.rechercheTitel')">
                <div class="rKopf">
                    <h4 class="ca-h4">{{ t('coinAnsicht.lage.rechercheTitel') }}</h4>
                    <Knopf klein symbol="suche" :laedt="rechercheLaeuft" :disabled="!lage.recherche?.moeglich"
                        :titel="rechercheGrund || t('coinAnsicht.lage.rechercheKosten')" @click="recherchiere">
                        {{ t(recherche ? 'coinAnsicht.lage.rechercheNeu' : 'coinAnsicht.lage.rechercheKnopf') }}
                    </Knopf>
                </div>
                <p class="ca-klein">{{ rechercheGrund || t('coinAnsicht.lage.rechercheKosten') }}</p>
                <Hinweis v-if="rechercheFehler" art="warn">{{ rechercheFehler }}</Hinweis>

                <!-- KI-Text: maschinenlesbar markiert (das sichtbare Pflichtlabel steht seit 30.10.2026 einmal unter Einstellungen › KI). -->
                <div v-if="recherche" class="ergebnis" data-ki-generiert="true">
                    <p v-if="recherche.fazit" class="fazit"><strong>{{ t('coinAnsicht.lage.fazit') }}:</strong> {{ recherche.fazit }}</p>
                    <ul v-if="befunde.length" class="befunde">
                        <li v-for="(b, i) in befunde" :key="i" :class="ROT.has(b.art) ? 'rot' : (b.art === 'recht' || b.art === 'angebot') ? 'gelb' : ''">
                            <Pille :ton="ROT.has(b.art) ? 'schlecht' : (b.art === 'recht' || b.art === 'angebot') ? 'warn' : 'neutral'">{{ t('coinAnsicht.lage.art_' + b.art) }}</Pille>
                            <span class="wann">{{ b.datum || '—' }}</span>
                            <span class="btext">{{ b.text }}<a v-if="b.link" :href="b.link" target="_blank" rel="noopener noreferrer" class="ca-link">{{ t('coinAnsicht.lage.quelle') }}</a></span>
                        </li>
                    </ul>
                    <template v-else-if="recherche.kaputt && recherche.rohText">
                        <p class="ca-klein">{{ t('coinAnsicht.lage.rohHinweis') }}</p>
                        <p class="roh">{{ recherche.rohText }}</p>
                    </template>
                    <p v-else class="ca-klein">{{ t('coinAnsicht.lage.befundeKeine') }}</p>

                    <template v-if="rechercheQuellen.length">
                        <h4 class="ca-h4">{{ t('coinAnsicht.lage.quellen') }}</h4>
                        <ol class="belege">
                            <li v-for="q in rechercheQuellen" :key="q.url">
                                <a :href="q.link" target="_blank" rel="noopener noreferrer">{{ kurzUrl(q.url) }}</a>
                                <span v-if="q.datum" class="ca-klein"> · {{ q.datum }}</span>
                            </li>
                        </ol>
                    </template>
                    <p class="ca-klein ca-fuss">
                        {{ t('coinAnsicht.lage.stand', { zeit: zeit(recherche.erstelltAm), modell: recherche.modell || 'Perplexity' }) }}
                        <template v-if="recherche.kostenUsd"> · {{ t('coinAnsicht.lage.kosten', { usd: zahl(recherche.kostenUsd, 3) }) }}</template>
                    </p>
                    <p class="ca-klein">{{ t('coinAnsicht.lage.kiHinweis') }}</p>
                </div>
            </section>
        </template>
    </Karte>
</template>

<style scoped>
.warnzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.8rem;
    margin-bottom: 0.7rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--warn);
    border-radius: var(--radius-knopf);
    background: var(--warn-flaeche);
    font-size: 0.86rem;
}

.warnzeile.rot {
    border-color: var(--bad);
    background: var(--bad-flaeche);
}

.warnart.rot {
    color: var(--bad);
}

.warnart.gelb {
    color: var(--warn);
}

.meldungen,
.befunde,
.belege {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
}

.meldungen li {
    display: grid;
    grid-template-columns: 5.6rem minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.45rem 0.5rem;
    border-top: 1px solid var(--line);
    border-left: 3px solid transparent;
    font-size: 0.86rem;
}

.meldungen li:first-child {
    border-top: 0;
}

.meldungen li.warn.rot,
.befunde li.rot {
    border-left-color: var(--bad);
    background: var(--bad-flaeche);
}

.meldungen li.warn.gelb,
.befunde li.gelb {
    border-left-color: var(--warn);
    background: var(--warn-flaeche);
}

.wann {
    color: var(--muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.was {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
}

.was a,
.belege a {
    color: var(--text);
    text-decoration: none;
    overflow-wrap: anywhere;
}

.was a:hover,
.was a:focus-visible,
.belege a:hover,
.belege a:focus-visible {
    color: var(--accent);
    text-decoration: underline;
}

.wer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
}

.recherche {
    margin-top: 1rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
}

.rKopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}

.rKopf .ca-h4 {
    margin: 0;
}

.ergebnis {
    margin-top: 0.7rem;
}

.fazit {
    font-size: 0.9rem;
    line-height: 1.5;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-flaeche);
}

.befunde li {
    display: grid;
    grid-template-columns: auto 5.6rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.45rem 0.5rem;
    border-top: 1px solid var(--line);
    border-left: 3px solid transparent;
    font-size: 0.86rem;
}

.btext {
    overflow-wrap: anywhere;
}

.roh {
    margin-top: 0.3rem;
    font-size: 0.86rem;
    white-space: pre-line;
    overflow-wrap: anywhere;
    color: var(--muted);
}

.belege {
    padding-left: 1.3rem;
    list-style: decimal;
    font-size: 0.8rem;
}

@media (max-width: 479.98px) {
    .meldungen li,
    .befunde li {
        grid-template-columns: minmax(0, 1fr);
        gap: 0.2rem;
    }
}
</style>
