<script setup>
/**
 * Einstellungen › Datenquellen (S12, Verkaufs-Prüfung Massnahmen 1 und 5).
 *
 * Zwei Dinge, die der KUNDE entscheidet und verantwortet, nicht AutarkTrade:
 *
 *   1. Die Marktdatenquelle. Öffentliche Kurse, Kerzen und Orderbücher kommen
 *      direkt von der Börse auf diesen Rechner. Keine Börse erlaubt das
 *      ausdrücklich für ein verkauftes Programm; ob die eigene Nutzung von den
 *      Bedingungen gedeckt ist, prüft der Kunde selbst. Darum ist die Quelle
 *      wählbar — auch „aus".
 *   2. Schlüssel für Quellen, die nur mit Kundenschlüssel laufen (CoinGecko).
 *      Ohne Schlüssel ist die Funktion aus und sagt warum.
 *
 * Der Schlüssel verlässt den Server nie im Klartext: angezeigt werden nur
 * „hinterlegt" und die letzten vier Zeichen.
 *
 * S15: Schalter „Quellen ohne Verkaufsfreigabe" (Vorgabe an) — die Liste,
 * was darunter fällt, kommt vom Server (`server/quellen/freigabe.js`).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { Karte, Knopf, Hinweis, Pille, Quellenhinweis } from '@/components/basis/index.js'
import { setzeMarktdaten } from '@/utils/marktdaten.js'
import { setzeFreigabe } from '@/utils/quellenFreigabe.js'
import Schalter from './gemeinsam/Schalter.vue'

const { t } = useI18n()

const stand = ref(null)
const fehler = ref('')
const speichertWahl = ref(false)

const cgSchluessel = ref('')
const cgTarif = ref('demo')
const cgMeldung = ref(null)   // { art, text }
const cgLaeuft = ref(false)

async function lade() {
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/quellen')
        stand.value = data
        cgTarif.value = data.coingecko?.tarif || 'demo'
    } catch (e) {
        fehler.value = e?.response?.data?.error || e.message
    }
}
onMounted(lade)

const wahl = computed(() => stand.value?.marktdaten?.wahl || 'binance')
const wahlen = computed(() => stand.value?.marktdaten?.wahlen || [])
const alleFaehigkeiten = computed(() => {
    const s = new Set()
    for (const w of wahlen.value) for (const f of w.faehigkeiten) s.add(f)
    return [...s]
})

async function waehle(id) {
    if (id === wahl.value || speichertWahl.value) return
    speichertWahl.value = true
    try {
        const neu = await setzeMarktdaten(id)
        stand.value = { ...stand.value, marktdaten: neu }
    } catch (e) {
        fehler.value = e?.response?.data?.error || e.message
    } finally {
        speichertWahl.value = false
    }
}

const freigabeLaeuft = ref(false)
async function freigabeSetzen(an) {
    freigabeLaeuft.value = true
    try {
        const neu = await setzeFreigabe(an)
        stand.value = { ...stand.value, ohneFreigabe: neu }
        const { data } = await axios.get('/api/quellen')
        stand.value = data
    } catch (e) {
        fehler.value = e?.response?.data?.error || e.message
    } finally {
        freigabeLaeuft.value = false
    }
}

async function cgTesten() {
    cgLaeuft.value = true
    cgMeldung.value = null
    try {
        const { data } = await axios.post('/api/quellen/coingecko/test', { schluessel: cgSchluessel.value, tarif: cgTarif.value })
        cgMeldung.value = data.ok
            ? { art: 'gut', text: t('datenquellen.cg.testOk') }
            : { art: 'fehler', text: t('datenquellen.cg.testFehler', { fehler: data.fehler }) }
    } catch (e) {
        cgMeldung.value = { art: 'fehler', text: e.message }
    } finally {
        cgLaeuft.value = false
    }
}

async function cgSpeichern(loeschen = false) {
    cgLaeuft.value = true
    cgMeldung.value = null
    try {
        const koerper = { tarif: cgTarif.value }
        if (loeschen) koerper.schluessel = ''
        else if (cgSchluessel.value.trim()) koerper.schluessel = cgSchluessel.value.trim()
        const { data } = await axios.put('/api/quellen/coingecko', koerper)
        stand.value = { ...stand.value, coingecko: data }
        cgSchluessel.value = ''
        cgMeldung.value = { art: 'gut', text: t(loeschen ? 'datenquellen.cg.geloescht' : 'datenquellen.cg.gespeichert') }
    } catch (e) {
        cgMeldung.value = { art: 'fehler', text: e?.response?.data?.error || e.message }
    } finally {
        cgLaeuft.value = false
    }
}
</script>

<template>
    <div class="datenquellen">
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Karte :titel="t('datenquellen.md.titel')" :unter="t('datenquellen.md.unter')">
            <Hinweis art="warn" :titel="t('datenquellen.md.verantwortungTitel')">
                {{ t('datenquellen.md.verantwortung') }}
            </Hinweis>

            <div class="wahlen" role="radiogroup" :aria-label="t('datenquellen.md.titel')">
                <button v-for="w in wahlen" :key="w.id" type="button" role="radio"
                    :aria-checked="w.id === wahl" :class="['wahl', { aktiv: w.id === wahl }]"
                    :disabled="speichertWahl" @click="waehle(w.id)">
                    <span class="kopf">
                        <span class="punkt" aria-hidden="true"></span>
                        <strong>{{ w.name || t('datenquellen.md.aus') }}</strong>
                        <Pille v-if="w.id === wahl" ton="akzent">{{ t('datenquellen.md.gewaehlt') }}</Pille>
                    </span>
                    <span class="beschreibung">{{ t('datenquellen.md.beschreibung_' + w.id) }}</span>
                    <span v-if="w.id !== 'aus'" class="faehig">
                        <span v-for="f in alleFaehigkeiten" :key="f"
                            :class="['f', { fehlt: !w.faehigkeiten.includes(f) }]">
                            {{ t('datenquellen.faehigkeit.' + f) }}
                        </span>
                    </span>
                </button>
            </div>
            <p class="leise">{{ t('datenquellen.md.weiterhin') }}</p>
        </Karte>

        <Karte v-if="stand?.ohneFreigabe" :titel="t('datenquellen.of.titel')" :unter="t('datenquellen.of.unter')">
            <Schalter :model-value="stand.ohneFreigabe.an" :label="t('datenquellen.of.schalter')"
                :disabled="freigabeLaeuft" @change="freigabeSetzen" />
            <Hinweis art="warn" :titel="t('datenquellen.md.verantwortungTitel')">
                {{ t(stand.ohneFreigabe.an ? 'datenquellen.of.anText' : 'datenquellen.of.ausText') }}
            </Hinweis>
            <ul class="of-liste">
                <!-- Die Zeilen der Verkaufsprüfung sind ein Arbeitsvermerk, kein
                     Nutzertext — nur noch als Tooltip (Audit A4-18). -->
                <li v-for="q in stand.ohneFreigabe.quellen" :key="q.id" :class="{ aus: !stand.ohneFreigabe.an }"
                    :title="t('datenquellen.of.zeilen', { zeilen: q.zeilen.join(', ') })">
                    <strong>{{ q.name }}</strong> — {{ q.was }}
                </li>
            </ul>
        </Karte>

        <Karte :titel="t('datenquellen.cg.titel')"
            :unter="t(stand?.ohneFreigabe?.an ? 'datenquellen.cg.unterOffen' : 'datenquellen.cg.unter')">
            <p class="status">
                <Pille v-if="stand?.coingecko?.hinterlegt" ton="gut">
                    {{ t('datenquellen.cg.hinterlegt', { ende: stand.coingecko.ende, tarif: stand.coingecko.tarif }) }}
                </Pille>
                <Pille v-else-if="stand?.coingecko?.oeffentlich" ton="neutral">{{ t('datenquellen.cg.oeffentlich') }}</Pille>
                <Pille v-else ton="neutral">{{ t('datenquellen.cg.keiner') }}</Pille>
            </p>
            <p class="leise">{{ t('datenquellen.cg.wofuer') }}</p>

            <div class="zeile">
                <label class="feld">
                    <span class="at-label">{{ t('datenquellen.cg.schluessel') }}</span>
                    <input v-model="cgSchluessel" class="at-feld" type="password" autocomplete="off"
                        :placeholder="stand?.coingecko?.hinterlegt ? '••••' + stand.coingecko.ende : 'CG-…'">
                </label>
                <label class="feld schmal">
                    <span class="at-label">{{ t('datenquellen.cg.tarif') }}</span>
                    <select v-model="cgTarif" class="at-feld">
                        <option value="demo">Demo</option>
                        <option value="pro">Pro / Analyst</option>
                    </select>
                </label>
            </div>
            <div class="knoepfe">
                <Knopf art="haupt" :laedt="cgLaeuft" @click="cgSpeichern(false)">{{ t('datenquellen.cg.speichern') }}</Knopf>
                <Knopf :disabled="cgLaeuft" @click="cgTesten">{{ t('datenquellen.cg.testen') }}</Knopf>
                <Knopf v-if="stand?.coingecko?.hinterlegt" art="gefahr" :disabled="cgLaeuft" @click="cgSpeichern(true)">
                    {{ t('datenquellen.cg.loeschen') }}
                </Knopf>
                <a class="extern" href="https://www.coingecko.com/en/developers/dashboard" target="_blank" rel="noopener noreferrer">
                    {{ t('datenquellen.cg.holen') }}
                </a>
            </div>
            <Hinweis v-if="cgMeldung" :art="cgMeldung.art">{{ cgMeldung.text }}</Hinweis>
            <p class="leise">{{ t('datenquellen.cg.demoHinweis') }}</p>
            <Quellenhinweis :quellen="[{ name: 'CoinGecko', url: 'https://www.coingecko.com/', art: 'powered' }]" />
        </Karte>

        <Karte :titel="t('datenquellen.andere.titel')">
            <ul class="andere">
                <li>{{ t('datenquellen.andere.ki') }}</li>
                <li>{{ t('datenquellen.andere.cryptoquant') }}</li>
                <li>{{ t(stand?.ohneFreigabe?.an ? 'datenquellen.andere.solanaOffen' : 'datenquellen.andere.solana') }}</li>
                <li>{{ t('datenquellen.andere.boersen') }}</li>
            </ul>
        </Karte>
    </div>
</template>

<style scoped>
.datenquellen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.wahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    margin: 0.9rem 0 0.5rem;
}

.wahl {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    text-align: left;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-knopf);
    background: var(--panel-soft);
    color: var(--text);
    cursor: pointer;
}

.wahl:hover:not(:disabled) {
    border-color: var(--accent-rand, var(--accent));
}

.wahl.aktiv {
    border-color: var(--accent);
    background: var(--accent-schwach);
}

.kopf {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.punkt {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    border: 2px solid var(--muted);
    flex: none;
}

.wahl.aktiv .punkt {
    border-color: var(--accent);
    background: var(--accent);
}

.beschreibung {
    font-size: 0.82rem;
    color: var(--muted);
    line-height: 1.4;
}

.faehig {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    font-size: 0.72rem;
}

.f {
    color: var(--text);
}

.f::before {
    content: '✓ ';
    color: var(--good);
}

.f.fehlt {
    color: var(--muted);
    text-decoration: line-through;
}

.f.fehlt::before {
    content: '– ';
    color: var(--muted);
}

.leise {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0.4rem 0 0;
    line-height: 1.45;
}

.status {
    margin: 0 0 0.3rem;
    max-width: 100%;
}
/* Statuspillen tragen ganze Sätze — am Telefon umbrechen statt die Seite
   waagrecht zu verbreitern (Audit A4-05). */
.status :deep(.at-pille) {
    max-width: 100%;
    white-space: normal;
}

.zeile {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.7rem;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 260px;
}

.feld.schmal {
    flex: 0 1 180px;
}

.knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.75rem 0 0.5rem;
}

.extern {
    color: var(--accent);
    font-size: 0.85rem;
    text-decoration: none;
}

.extern:hover {
    text-decoration: underline;
}

.of-liste {
    margin: 0.7rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--text);
}

.of-liste li.aus {
    color: var(--muted);
    text-decoration: line-through;
}

.andere {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.6;
}
</style>
