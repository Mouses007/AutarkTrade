<script setup>
/**
 * Aktien-Radar: welche Aktien-Futures lassen sich JETZT handeln — dieselbe
 * Messung wie der Coin-Radar (Bewegung, Volumen, Trend, Haltekosten,
 * Ausführung), über die Aktien-Kontrakte der Marktdatenquelle.
 *
 * Bewusst eine eigene, schlanke Seite statt eines Schalters in `CoinRadar.vue`:
 * Abverkaufs-Wache, Tiefensuche, Favoriten und Erfolgskontrolle dort sind auf
 * Coins gebaut. Der Server ist derselbe (`/api/coin-radar/*?markt=aktien`).
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import Knopf from '../components/basis/Knopf.vue'
import Pille from '../components/basis/Pille.vue'
import Hinweis from '../components/basis/Hinweis.vue'
import Leerzustand from '../components/basis/Leerzustand.vue'
import Kreisel from '../components/basis/Kreisel.vue'

const { t, locale } = useI18n()

const PLATZ = { binance: 'Binance', bitget: 'Bitget', bitunix: 'Bitunix', pionex: 'Pionex', bitpanda: 'Bitpanda' }
const TON = { perp: 'akzent', 'token-spot': 'gut', 'broker-spot': 'neutral' }
const RANG = { perp: 0, 'token-spot': 1, 'broker-spot': 2 }
const MARKT = { markt: 'aktien' }

const zeilen = ref([])
const lauf = ref(null)
const mitHuerden = ref(false)
const laedt = ref(true)
const laeuft = ref(false)
const fortschritt = ref(null)
const fehler = ref('')

async function lade() {
    fehler.value = ''
    try {
        const { data } = await axios.get('/api/coin-radar/zeilen', { params: { ...MARKT, huerden: mitHuerden.value ? 1 : 0 } })
        lauf.value = data?.lauf || null
        zeilen.value = data?.zeilen || []
    } catch (e) {
        fehler.value = `${t('aktienradar.ladeFehler')}: ${e?.response?.data?.error || e.message}`
    } finally {
        laedt.value = false
    }
}

// Der Lauf meldet seinen Fortschritt als Ereignisstrom — wie beim Coin-Radar.
let strom = null
async function starteLauf() {
    if (laeuft.value) return
    laeuft.value = true
    fehler.value = ''
    fortschritt.value = { schritt: 'universum' }
    strom = new AbortController()
    try {
        const antwort = await fetch('/api/coin-radar/lauf?markt=aktien', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: strom.signal,
        })
        if (!antwort.ok) {
            const j = await antwort.json().catch(() => ({}))
            throw new Error(j.error || `HTTP ${antwort.status}`)
        }
        const leser = antwort.body.getReader()
        const dekoder = new TextDecoder()
        let puffer = ''
        while (true) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekoder.decode(value, { stream: true })
            const teile = puffer.split('\n')
            puffer = teile.pop() || ''
            for (const z of teile) {
                if (!z.startsWith('data: ')) continue
                let e
                try { e = JSON.parse(z.slice(6)) } catch { continue }
                if (e.type === 'fortschritt') fortschritt.value = e
                else if (e.type === 'fehler') fehler.value = e.aus ? t('aktienradar.quelleAus') : e.fehler
            }
        }
        await lade()
    } catch (e) {
        if (e.name !== 'AbortError') fehler.value = e.message
    } finally {
        laeuft.value = false
        fortschritt.value = null
        strom = null
    }
}

watch(mitHuerden, lade)
onMounted(lade)
onBeforeUnmount(() => strom?.abort())

const referenz = computed(() => lauf.value?.quellenStand?.referenz?.ticker || null)
const schrittText = computed(() => {
    const f = fortschritt.value
    if (!f) return ''
    const name = t('aktienradar.schritt_' + (f.schritt || 'universum'))
    return f.gesamt ? `${name} ${f.fertig ?? 0}/${f.gesamt}` : name
})

const zahl = (x, stellen = 1) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(x))
const gross = (x) => (x == null ? '—' : new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(x)))
const zeit = (ms) => (ms ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(ms))) : '—')
const geordnet = (liste = []) => [...liste].sort((a, b) => RANG[a.art] - RANG[b.art] || a.boerse.localeCompare(b.boerse))
const teilText = (n) => t('aktienradar.teilnoten', { bewegung: n?.bewegung ?? '—', imSpiel: n?.imSpiel ?? '—', trend: n?.trend ?? '—', kosten: n?.kosten ?? '—' })
</script>

<template>
    <div class="aktienradar-seite">
        <div class="leiste">
            <label class="haken"><input v-model="mitHuerden" type="checkbox" /> {{ t('aktienradar.zeigeHuerden') }}</label>
            <Knopf klein symbol="aktualisieren" :laedt="laeuft" @click="starteLauf">{{ t('aktienradar.lauf') }}</Knopf>
        </div>

        <p v-if="laeuft" class="leise" role="status">{{ schrittText }}</p>
        <p v-else-if="lauf" class="leise">
            {{ t('aktienradar.stand', { zeit: zeit(lauf.beendetAm || lauf.erstelltAm), geprueft: lauf.geprueft, bewertet: lauf.geprueft - lauf.verworfenHuerde }) }}
            <template v-if="referenz"> {{ t('aktienradar.referenz', { ticker: referenz }) }}</template>
            <template v-else> {{ t('aktienradar.ohneReferenz') }}</template>
        </p>
        <Hinweis v-if="fehler" art="fehler">{{ fehler }}</Hinweis>

        <Kreisel v-if="laedt" />
        <Leerzustand v-else-if="!lauf && !laeuft" :titel="t('aktienradar.leerTitel')" :text="t('aktienradar.leerText')" symbol="listeNummer">
            <Knopf art="haupt" symbol="aktualisieren" @click="starteLauf">{{ t('aktienradar.lauf') }}</Knopf>
        </Leerzustand>
        <Leerzustand v-else-if="!zeilen.length && !laeuft" :titel="t('aktienradar.keineTitel')" :text="t('aktienradar.keineTitelText')" symbol="suche" />

        <div v-else-if="zeilen.length" class="rolle">
            <table class="liste">
                <thead>
                    <tr>
                        <th class="rechts">{{ t('aktienradar.rang') }}</th>
                        <th class="rechts" :title="t('aktienradar.noteInfo')">{{ t('aktienradar.note') }}</th>
                        <th>{{ t('aktienradar.ticker') }}</th>
                        <th>{{ t('aktienradar.name') }}</th>
                        <th class="rechts">{{ t('aktienradar.umsatz') }}</th>
                        <th class="rechts">{{ t('aktienradar.spread') }}</th>
                        <template v-if="!mitHuerden">
                            <th class="rechts" :title="t('aktienradar.atrInfo')">ATR %</th>
                            <th class="rechts" :title="t('aktienradar.rvolInfo')">RVOL</th>
                            <th class="rechts" :title="t('aktienradar.adxInfo')">ADX</th>
                            <th class="rechts" :title="t('aktienradar.fundingInfo')">{{ t('aktienradar.funding') }}</th>
                            <th class="rechts" :title="t('aktienradar.ausfuehrungInfo')">{{ t('aktienradar.ausfuehrung') }}</th>
                            <th class="rechts" :title="t('aktienradar.kopplungInfo')">{{ referenz ? t('aktienradar.kopplung', { ticker: referenz }) : t('aktienradar.kopplungOhne') }}</th>
                        </template>
                        <th v-else>{{ t('aktienradar.grund') }}</th>
                        <th>{{ t('aktienradar.handelbar') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="z in zeilen" :key="z.symbol">
                        <td class="rechts">{{ z.rang || '—' }}</td>
                        <td class="rechts note" :title="teilText(z.teilnoten)">{{ z.note == null ? '—' : zahl(z.note, 0) }}</td>
                        <td class="ticker" :title="z.symbol">
                            {{ z.boersen?.ticker || z.symbol }}
                            <span v-if="z.boersen?.unterart && z.boersen.unterart !== 'aktie'" class="art">{{ t('aktien.art_' + z.boersen.unterart) }}</span>
                        </td>
                        <td class="name">{{ z.boersen?.name || '—' }}</td>
                        <td class="rechts">{{ gross(z.umsatz24h) }}</td>
                        <td class="rechts">{{ z.spreadBp == null ? '—' : zahl(z.spreadBp, 1) + ' bp' }}</td>
                        <template v-if="!mitHuerden">
                            <td class="rechts">{{ zahl(z.atrPct, 2) }}</td>
                            <td class="rechts">{{ z.rvol == null ? '—' : zahl(z.rvol, 1) + '×' }}</td>
                            <td class="rechts">{{ zahl(z.adx, 0) }}</td>
                            <td class="rechts">{{ z.fundingJahresRate == null ? '—' : zahl(z.fundingJahresRate, 0) + ' %' }}</td>
                            <td class="rechts" :title="z.besteBoerse ? t('aktienradar.besteBoerse', { boerse: PLATZ[z.besteBoerse] || z.besteBoerse, bp: zahl(z.rundlaufBp, 1) }) : ''">
                                {{ z.noteAusfuehrung == null ? '—' : zahl(z.noteAusfuehrung, 0) }}
                            </td>
                            <td class="rechts">
                                {{ z.btcKorrelation == null ? '—' : zahl(z.btcKorrelation * 100, 0) + ' %' }}
                                <span v-if="z.btcBeta != null" class="leise">β {{ zahl(z.btcBeta, 1) }}</span>
                            </td>
                        </template>
                        <td v-else class="name">{{ t('aktienradar.huerde_' + (z.huerdeGrund || 'unbekannt')) }}</td>
                        <td class="plaetze">
                            <Pille v-for="l in geordnet(z.boersen?.liste)" :key="l.boerse + l.art" :ton="TON[l.art]" :title="l.symbol">
                                {{ PLATZ[l.boerse] || l.boerse }} · {{ t('aktien.art_' + l.art) }}
                            </Pille>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="leise">{{ t('aktienradar.hinweis') }}</p>
    </div>
</template>

<style scoped>
.aktienradar-seite {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem clamp(0.8rem, 2.4vw, 1.6rem) 2rem;
}

.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem 1rem;
}

.haken {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.88rem;
    cursor: pointer;
}

.leise {
    margin: 0;
    color: var(--muted);
    font-size: 0.86rem;
}

.rolle {
    overflow-x: auto;
}

.liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}

.liste th {
    text-align: left;
    padding: 0.5rem 0.6rem;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
}

.liste th[title] {
    cursor: help;
}

.liste td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    white-space: nowrap;
}

.liste .rechts {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.note {
    font-weight: 700;
    color: var(--accent);
    cursor: help;
}

.ticker {
    font-weight: 700;
}

.art {
    margin-left: 0.3rem;
    color: var(--muted);
    font-weight: 400;
    font-size: 0.78rem;
}

.liste td.name {
    color: var(--muted);
    white-space: normal;
    min-width: 9rem;
}

.liste td.plaetze {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    white-space: normal;
    /* Fünf Handelsplätze in zwei Zeilen statt in fünf — sonst wird jede Zeile turmhoch. */
    min-width: 22rem;
}
</style>
